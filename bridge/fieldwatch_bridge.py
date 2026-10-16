#!/usr/bin/env python3
"""Fieldwatch bridge: feeds real Wi-Fi / Bluetooth LE scan data to Fieldwatch Web.

Browsers cannot scan Wi-Fi (and Web Bluetooth scanning is limited), so this
small program runs the platform's own scanners and streams what they see to the
web app over a local WebSocket.

    python3 fieldwatch_bridge.py                 # ws://127.0.0.1:8765/?token=...
    python3 fieldwatch_bridge.py --no-ble --wifi-interval 10

Protocol (server -> client, JSON text frames):
    {"type":"hello","agent":"fieldwatch-bridge","version":1,
     "caps":{"wifi":bool,"ble":bool},"platform":"linux|windows|darwin|termux"}
    {"type":"sightings","items":[<sighting>, ...]}

    BLE sightings carry "addrType": "public" | "random" | null (BlueZ reports
    it; macOS pseudo MACs are "random"; elsewhere null). Wi-Fi items omit it.
    Remote ID (service data FFFA) is never merged away inside a window: each
    distinct payload is its own svcData entry (up to 16 per address).
    A BLE window is sent as frames of <= 1500 items (<= 3000 per window),
    known addresses and ones carrying data first, so a flood of random
    addresses cannot push real devices out.

Security: every client must present ?token=<token> in the connect URL, else the
connection is closed with code 1008 (policy violation). Without it, any web page
the user happens to visit could open ws://127.0.0.1:8765 and read nearby-device
data. The bridge itself makes no network connections; it only listens. (With
--host 0.0.0.0 or :: it also prints a connect URL per LAN address; finding the
primary one uses a UDP socket connect(), which sends no packet.)

Third-party imports (websockets, bleak) are lazy so the pure parsing functions
can be imported and unit-tested without them.

macOS BLE note: CoreBluetooth exposes per-host UUIDs instead of MAC addresses.
The bridge derives a stable pseudo MAC from that UUID: sha1(uuid.lower()), take
the first 6 bytes, then byte0 = (byte0 & 0xFC) | 0x02 (unicast, locally
administered). The same device keeps the same pseudo MAC on the same Mac, but
it is not the device's real address and will look "randomized" in the app.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import hmac
import ipaddress
import json
import logging
import os
import re
import secrets
import shutil
import socket
import subprocess
import sys
import time
from typing import Any, Callable, Dict, Iterable, List, Optional
from urllib.parse import parse_qs, quote, urlsplit

PROTOCOL_VERSION = 1
AGENT = "fieldwatch-bridge"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765
BLE_FREQ = 2402
SEND_TIMEOUT = 5.0      # seconds a client may take to accept one frame
SHUTDOWN_TIMEOUT = 5.0  # seconds allowed for a clean shutdown before forcing it

log = logging.getLogger("fieldwatch-bridge")

# --------------------------------------------------------------------------
# Small pure helpers
# --------------------------------------------------------------------------

_HEX12 = re.compile(r"^[0-9A-F]{12}$")
_SIG_UUID = re.compile(r"^0000([0-9a-f]{4})-0000-1000-8000-00805f9b34fb$")
_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
)


def norm_mac(value: Any) -> Optional[str]:
    """'aa-bb-cc-dd-ee-ff' / 'aabbccddeeff' / 'aa:bb:..' -> 'AA:BB:CC:DD:EE:FF'.

    Returns None if the value is not a 48-bit MAC address.
    """
    if value is None:
        return None
    h = re.sub(r"[\s:\-.]", "", str(value)).upper()
    if not _HEX12.match(h):
        return None
    return ":".join(h[i:i + 2] for i in range(0, 12, 2))


def pct_to_dbm(pct: Any) -> int:
    """Signal quality 0-100 % -> approximate dBm: round(pct/2 - 100)."""
    p = max(0.0, min(100.0, float(pct)))
    return int(round(p / 2 - 100))


def freq_to_channel(freq: Any) -> int:
    """Centre frequency (MHz) -> Wi-Fi channel number (0 if unknown)."""
    try:
        f = int(freq)
    except (TypeError, ValueError):
        return 0
    if f == 2484:
        return 14
    if 2412 <= f <= 2472:
        return (f - 2407) // 5
    if 5150 <= f <= 5925:
        return (f - 5000) // 5
    if f == 5935:  # 6 GHz channel 2 sits below channel 1 (5955 MHz)
        return 2
    if 5955 <= f <= 7125:
        return (f - 5950) // 5
    return 0


def channel_to_freq(channel: Any, band: Optional[str] = None) -> int:
    """Wi-Fi channel -> centre frequency (MHz); 0 if unknown.

    `band` may be '2.4', '5' or '6' (GHz) to disambiguate 6 GHz channels,
    whose numbers overlap the 2.4 GHz range.
    """
    try:
        c = int(channel)
    except (TypeError, ValueError):
        return 0
    if c <= 0:
        return 0
    if band and str(band).startswith("6"):
        if c == 2:  # 6 GHz channel 2 is the odd one out: 5935 MHz, not 5960
            return 5935
        return 5950 + 5 * c
    if 1 <= c <= 13:
        return 2407 + 5 * c
    if c == 14:
        return 2484
    if c >= 32:
        return 5000 + 5 * c
    return 0


def shorten_uuid(value: Any) -> str:
    """16-bit Bluetooth SIG UUIDs -> 'XXXX' (upper); others -> full lowercase."""
    s = str(value).strip().lower()
    m = _SIG_UUID.match(s)
    if m:
        return m.group(1).upper()
    if re.fullmatch(r"(0x)?[0-9a-f]{4}", s):
        return s[-4:].upper()
    return s


def pseudo_mac_from_uuid(value: str) -> str:
    """Stable, locally administered pseudo MAC for a CoreBluetooth UUID."""
    digest = hashlib.sha1(str(value).strip().lower().encode("ascii", "replace")).digest()
    b = bytearray(digest[:6])
    b[0] = (b[0] & 0xFC) | 0x02
    return ":".join("%02X" % x for x in b)


def check_token(path: Optional[str], expected: str) -> bool:
    """True iff the request path's query carries ?token=<expected>.

    Constant-time comparison; an empty expected token never matches.
    """
    if not expected or not path:
        return False
    try:
        query = urlsplit(path).query
        values = parse_qs(query, keep_blank_values=True).get("token") or []
    except Exception:
        return False
    if len(values) != 1:
        return False
    return hmac.compare_digest(values[0].encode("utf-8"), expected.encode("utf-8"))


def wifi_item(mac: str, name: str, rssi: int, channel: int, freq: int,
              security: str) -> Dict[str, Any]:
    name = name or ""
    return {
        "kind": "WIFI",
        "mac": mac,
        "name": name,
        "hidden": name == "",
        "rssi": int(rssi),
        "channel": int(channel),
        "freq": int(freq),
        "security": security,
        "mfg": [],
        "uuids": [],
        "svcData": [],
        "vendorIe": [],
    }


# --------------------------------------------------------------------------
# Wi-Fi: Termux (Android, termux-wifi-scaninfo)
# --------------------------------------------------------------------------


def termux_security(capabilities: Optional[str]) -> str:
    """Android capability string ('[WPA2-PSK-CCMP][RSN-PSK-CCMP][ESS]') -> label.

    Returns '' when the field is missing (older Termux:API builds omit it).
    """
    if capabilities is None:
        return ""
    c = str(capabilities).upper()
    if "SAE" in c:
        return "WPA3-SAE"
    if "EAP" in c:
        return "WPA2-EAP"
    if "PSK" in c:
        return "WPA2-PSK"
    if "WEP" in c:
        return "WEP"
    return "OPEN"


def parse_termux(text: str) -> List[Dict[str, Any]]:
    """Parse `termux-wifi-scaninfo` JSON output into sightings."""
    data = json.loads(text or "[]")
    if isinstance(data, dict):
        # e.g. {"API_ERROR": "Location needs to be enabled on the device"}
        raise RuntimeError("termux-wifi-scaninfo: %s" % "; ".join(
            "%s=%s" % (k, v) for k, v in data.items()))
    items = []
    for ap in data or []:
        if not isinstance(ap, dict):
            continue
        mac = norm_mac(ap.get("bssid"))
        if not mac:
            continue
        ssid = ap.get("ssid") or ""
        if ssid == "<unknown ssid>":
            ssid = ""
        try:
            freq = int(ap.get("frequency_mhz") or ap.get("frequency") or 0)
        except (TypeError, ValueError):
            freq = 0
        try:
            rssi = int(ap.get("rssi"))
        except (TypeError, ValueError):
            continue
        items.append(wifi_item(mac, ssid, rssi, freq_to_channel(freq), freq,
                               termux_security(ap.get("capabilities"))))
    return items


# --------------------------------------------------------------------------
# Wi-Fi: Linux (NetworkManager nmcli, terse mode)
# --------------------------------------------------------------------------

NMCLI_CMD = ["nmcli", "-t", "-e", "yes", "-f", "BSSID,SSID,CHAN,FREQ,SIGNAL,SECURITY",
             "dev", "wifi", "list", "--rescan", "auto"]


def split_terse(line: str) -> List[str]:
    """Split one nmcli terse line on unescaped ':' and unescape '\\:' / '\\\\'."""
    fields, cur, i = [], [], 0
    while i < len(line):
        ch = line[i]
        if ch == "\\" and i + 1 < len(line):
            cur.append(line[i + 1])
            i += 2
            continue
        if ch == ":":
            fields.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
        i += 1
    fields.append("".join(cur))
    return fields


def nmcli_security(sec: str) -> str:
    tokens = set(str(sec or "").upper().replace("--", "").split())
    if not tokens:
        return "OPEN"
    eap = "802.1X" in tokens
    if "WPA3" in tokens:
        return "WPA3-EAP" if eap else "WPA3-SAE"
    if "WPA2" in tokens:
        return "WPA2-EAP" if eap else "WPA2-PSK"
    if "WPA1" in tokens or "WPA" in tokens:
        return "WPA-EAP" if eap else "WPA-PSK"
    if "WEP" in tokens:
        return "WEP"
    if "OWE" in tokens:
        return "OWE"
    if eap:
        return "WPA2-EAP"
    return " ".join(sorted(tokens))


def _leading_int(s: str) -> Optional[int]:
    m = re.match(r"\s*(-?\d+)", s or "")
    return int(m.group(1)) if m else None


def parse_nmcli(text: str) -> List[Dict[str, Any]]:
    """Parse `nmcli -t -e yes -f BSSID,SSID,CHAN,FREQ,SIGNAL,SECURITY dev wifi list`."""
    items = []
    for line in (text or "").splitlines():
        if not line.strip():
            continue
        f = split_terse(line)
        if len(f) < 6:
            continue
        bssid, ssid, chan, freq_s, signal, security = f[:6]
        mac = norm_mac(bssid)
        if not mac:
            continue
        if ssid == "--":
            ssid = ""
        freq = _leading_int(freq_s) or 0
        channel = _leading_int(chan) or freq_to_channel(freq)
        if not freq:
            freq = channel_to_freq(channel)
        pct = _leading_int(signal)
        if pct is None:
            continue
        items.append(wifi_item(mac, ssid, pct_to_dbm(pct), channel, freq,
                               nmcli_security(security)))
    return items


# --------------------------------------------------------------------------
# Wi-Fi: Windows (netsh wlan show networks mode=bssid)
# --------------------------------------------------------------------------

NETSH_CMD = ["netsh", "wlan", "show", "networks", "mode=bssid"]

# Lower-cased label fragments, English first, then common locales.
_AUTH_LABELS = ("authentication", "authentification", "authentifizierung", "autenticación",
                "autenticacion", "autenticação", "autenticazione", "verificatie",
                "uwierzytelnianie", "kimlik doğrulama", "проверка подлинности",
                "المصادقة", "認証", "身份验证", "驗證")
_CHAN_LABELS = ("channel", "canal", "kanal", "canale", "kanaal", "канал", "القناة",
                "チャネル", "信道", "通道")
_BAND_LABELS = ("band", "bande", "banda", "frequenzband", "диапазон", "النطاق")


def _label_is(label: str, choices: Iterable[str]) -> bool:
    lab = label.strip().lower()
    return any(lab == c or lab.startswith(c) for c in choices)


def windows_security(auth: str, encryption: str = "") -> str:
    a = (auth or "").upper().replace(" ", "")
    if "WPA3" in a:
        return "WPA3-EAP" if ("ENTERPRISE" in a or "802.1X" in a) else "WPA3-SAE"
    if "WPA2" in a:
        return "WPA2-EAP" if ("ENTERPRISE" in a or "802.1X" in a) else "WPA2-PSK"
    if "WPA" in a:
        return "WPA-EAP" if ("ENTERPRISE" in a or "802.1X" in a) else "WPA-PSK"
    if "OWE" in a:
        return "OWE"
    if "WEP" in a or "SHARED" in a or "WEP" in (encryption or "").upper():
        return "WEP"
    if not a:
        return ""
    return "OPEN"


def parse_netsh(text: str) -> List[Dict[str, Any]]:
    """Parse `netsh wlan show networks mode=bssid` output into sightings."""
    items: List[Dict[str, Any]] = []
    ssid: Optional[str] = None
    auth = enc = ""
    cur: Optional[Dict[str, Any]] = None

    def flush():
        nonlocal cur
        if cur and cur.get("mac") and cur.get("pct") is not None:
            ch = cur.get("channel") or 0
            freq = channel_to_freq(ch, cur.get("band"))
            items.append(wifi_item(cur["mac"], cur["ssid"], pct_to_dbm(cur["pct"]), ch,
                                   freq, windows_security(cur["auth"], cur["enc"])))
        cur = None

    for raw in (text or "").splitlines():
        if ":" not in raw:
            continue
        label, _, value = raw.partition(":")
        label_s = label.strip()
        value = value.strip()
        m_ssid = re.match(r"^SSID\s*\d*\s*$", label_s, re.I)
        if m_ssid:
            flush()
            ssid, auth, enc = value, "", ""
            continue
        if re.match(r"^BSSID\s*\d*\s*$", label_s, re.I):
            flush()
            mac = norm_mac(value)
            if mac and ssid is not None:
                cur = {"mac": mac, "ssid": ssid, "auth": auth, "enc": enc, "pct": None,
                       "channel": 0, "band": None}
            continue
        if cur is None:
            # Network-level fields (before the first BSSID of an SSID block).
            if _label_is(label_s, _AUTH_LABELS):
                auth = value
            elif re.search(r"(encryption|chiffrement|verschlüsselung|cifrado|criptografia|"
                           r"crittografia|التشفير)", label_s, re.I):
                enc = value
            continue
        m_pct = re.match(r"^(\d{1,3})\s*%$", value)
        if m_pct and cur["pct"] is None:
            cur["pct"] = int(m_pct.group(1))
        elif _label_is(label_s, _CHAN_LABELS) and re.match(r"^\d+$", value):
            cur["channel"] = int(value)
        elif _label_is(label_s, _BAND_LABELS):
            m_band = re.match(r"^(2\.4|5|6)", value.replace(",", "."))
            if m_band:
                cur["band"] = m_band.group(1)
    flush()
    return items


# --------------------------------------------------------------------------
# Wi-Fi: macOS (system_profiler SPAirPortDataType -json), best effort
# --------------------------------------------------------------------------

SYSPROF_CMD = ["system_profiler", "SPAirPortDataType", "-json"]


def macos_security(mode: str) -> str:
    m = (mode or "").lower()
    if "wpa3" in m:
        return "WPA3-EAP" if "enterprise" in m else "WPA3-SAE"
    if "wpa2" in m:
        return "WPA2-EAP" if "enterprise" in m else "WPA2-PSK"
    if "wpa" in m:
        return "WPA-EAP" if "enterprise" in m else "WPA-PSK"
    if "wep" in m:
        return "WEP"
    if "owe" in m:
        return "OWE"
    if "none" in m or "open" in m:
        return "OPEN"
    return ""


def parse_system_profiler(text: str) -> "tuple[List[Dict[str, Any]], int]":
    """Parse system_profiler Wi-Fi JSON. Returns (items, networks_without_bssid)."""
    data = json.loads(text or "{}")
    items: List[Dict[str, Any]] = []
    skipped = 0
    for entry in data.get("SPAirPortDataType", []) or []:
        for iface in entry.get("spairport_airport_interfaces", []) or []:
            nets = list(iface.get("spairport_airport_other_local_wireless_networks", []) or [])
            curnet = iface.get("spairport_current_network_information")
            if isinstance(curnet, dict):
                nets.append(curnet)
            for n in nets:
                if not isinstance(n, dict):
                    continue
                mac = None
                for k, v in n.items():
                    if "bssid" in k.lower():
                        mac = norm_mac(v)
                        break
                if not mac:
                    skipped += 1
                    continue
                ch_s = str(n.get("spairport_network_channel", ""))
                channel = _leading_int(ch_s) or 0
                band = None
                m_band = re.search(r"(2|5|6)\s*GHz", ch_s, re.I)
                if m_band:
                    band = {"2": "2.4", "5": "5", "6": "6"}[m_band.group(1)]
                rssi = _leading_int(str(n.get("spairport_signal_noise", "")))
                if rssi is None:
                    continue
                name = n.get("_name") or ""
                items.append(wifi_item(mac, name, rssi, channel, channel_to_freq(channel, band),
                                       macos_security(str(n.get("spairport_security_mode", "")))))
    return items, skipped


# --------------------------------------------------------------------------
# BLE (bleak)
# --------------------------------------------------------------------------


def _hex(data: Any) -> str:
    try:
        return bytes(data).hex().upper()
    except Exception:
        return ""


def ble_address_to_mac(address: str) -> Optional[str]:
    mac = norm_mac(address)
    if mac:
        return mac
    s = str(address or "").strip().lower()
    if _UUID_RE.match(s):
        return pseudo_mac_from_uuid(s)
    return None


ADDR_TYPES = ("public", "random")


def ble_addr_type(device: Any) -> Optional[str]:
    """Best-effort BLE address type for a bleak device: 'public', 'random' or None.

    - macOS (CoreBluetooth): the address is a per-host UUID that the bridge
      turns into a pseudo MAC, so it is reported as 'random'.
    - Linux (BlueZ): bleak exposes the D-Bus device properties, whose
      'AddressType' is 'public' or 'random'. Depending on the bleak version,
      `device.details` is {"path": ..., "props": {...}} or the props dict
      itself; both shapes (and anything else) are handled defensively.
    - Anything else (Windows, unknown shapes): None.
    """
    address = str(getattr(device, "address", "") or "").strip().lower()
    if _UUID_RE.match(address):
        return "random"
    details = getattr(device, "details", None)
    if not isinstance(details, dict):
        return None
    props = details.get("props")
    for cand in ((props if isinstance(props, dict) else None), details):
        if not isinstance(cand, dict):
            continue
        v = cand.get("AddressType")
        if v is None:
            continue
        v = str(getattr(v, "value", v)).strip().lower()  # dbus Variant or str
        return v if v in ADDR_TYPES else None
    return None


def ble_to_item(address: str, adv: Any, fallback_rssi: Optional[int] = None,
                addr_type: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """bleak (device.address, AdvertisementData) -> sighting dict, or None."""
    mac = ble_address_to_mac(address)
    if not mac:
        return None
    rssi = getattr(adv, "rssi", None)
    if rssi is None:
        rssi = fallback_rssi
    if rssi is None:
        return None
    mfg = [{"companyId": int(cid), "dataHex": _hex(data)}
           for cid, data in sorted((getattr(adv, "manufacturer_data", None) or {}).items())]
    uuids: List[str] = []
    for u in getattr(adv, "service_uuids", None) or []:
        su = shorten_uuid(u)
        if su not in uuids:
            uuids.append(su)
    svc = [{"uuid": shorten_uuid(u), "dataHex": _hex(data)}
           for u, data in (getattr(adv, "service_data", None) or {}).items()]
    return {
        "kind": "BLE",
        "mac": mac,
        "name": getattr(adv, "local_name", None) or "",
        "rssi": int(rssi),
        "channel": 0,
        "freq": BLE_FREQ,
        "security": "",
        "mfg": mfg,
        "uuids": uuids,
        "svcData": svc,
        "vendorIe": [],
        "hidden": False,
        "addrType": addr_type if addr_type in ADDR_TYPES else None,
    }


# ASTM F3411 / ASD-STAN Remote ID service data UUID. Drones (BT4 legacy
# adverts) rotate one message per advert -- Basic ID, Location, Self-ID,
# System, Operator ID -- so every distinct payload must reach the app.
ODID_UUID = "FFFA"
MAX_SVC_DATA = 16  # per address per window; matches the app's svcData cap


def _odid_kind(data_hex: str) -> str:
    """Eviction key of an FFFA payload (0D <counter> <header> <byte 1> ...).

    The message-type nibble (header high nibble), refined where a transmitter
    legitimately rotates several messages of one type:
    - Basic ID (type 0): plus the ID-type nibble (byte 1 high nibble), since
      ASTM F3411 allows two Basic IDs (e.g. serial number + session/CAA ID).
    - Authentication (type 2): plus the page-number nibble (byte 1 low nibble).
    """
    if len(data_hex) < 6:
        return ""
    kind = data_hex[4:5].upper()
    if len(data_hex) >= 8:
        if kind == "0":
            return kind + data_hex[6:7].upper()
        if kind == "2":
            return kind + data_hex[7:8].upper()
    return kind


def _merge_svc(prev: List[Dict[str, Any]], new: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Window-merge service data.

    Non-Remote-ID entries: the latest advert's, else the earlier one's.
    Remote ID (FFFA) entries: every distinct payload of the window, in arrival
    order, identical hex de-duplicated. Total length is capped at MAX_SVC_DATA;
    on overflow the oldest FFFA entry whose message kind (_odid_kind: type, and
    the ID type for Basic ID / the page for Authentication) is also carried by
    a newer entry is evicted first, so each kind keeps its latest copy.
    """
    other_new = [s for s in new if s.get("uuid") != ODID_UUID]
    other = other_new or [s for s in prev if s.get("uuid") != ODID_UUID]
    other = other[:MAX_SVC_DATA]
    cap = max(0, MAX_SVC_DATA - len(other))
    odid: List[Dict[str, Any]] = []
    seen = set()
    for s in list(prev) + list(new):
        if s.get("uuid") != ODID_UUID:
            continue
        h = s.get("dataHex", "")
        if h in seen:
            continue
        seen.add(h)
        odid.append(s)
        while len(odid) > cap:
            kinds = [_odid_kind(x.get("dataHex", "")) for x in odid]
            victim = 0
            for i, k in enumerate(kinds):
                if k and k in kinds[i + 1:]:
                    victim = i
                    break
            odid.pop(victim)
    return other + odid


def merge_ble(prev: Optional[Dict[str, Any]], new: Dict[str, Any]) -> Dict[str, Any]:
    """De-duplicate two sightings of one address inside a flush window.

    Keeps the latest reading, but the strongest RSSI of the window, and fills
    name / mfg / uuids / addrType from earlier packets when the latest one
    lacks them (devices alternate adverts and scan responses). Remote ID
    (FFFA) service data is never merged away: every distinct payload is kept
    as its own svcData entry (see _merge_svc).
    """
    if not prev:
        return new
    out = dict(new)
    out["rssi"] = max(int(prev["rssi"]), int(new["rssi"]))
    for k in ("name",):
        if not out.get(k):
            out[k] = prev.get(k, "")
    for k in ("mfg", "uuids"):
        if not out.get(k):
            out[k] = prev.get(k, [])
    out["svcData"] = _merge_svc(prev.get("svcData") or [], new.get("svcData") or [])
    if out.get("addrType") is None and prev.get("addrType") is not None:
        out["addrType"] = prev["addrType"]
    return out


# BLE flood protection. The app keeps only the first 2000 items of a frame and
# drops frames over 2 MB, so an attacker cycling thousands of random addresses
# could push real devices out. Each window is therefore sent as frames of at
# most FRAME_ITEMS items / FRAME_BYTES bytes, at most WINDOW_ITEMS items in all,
# best candidates first.
FRAME_ITEMS = 1500
FRAME_BYTES = 1_500_000
WINDOW_ITEMS = 3000
MAX_PENDING = 8000         # distinct new addresses buffered per window
SEEN_TTL = 120.0           # seconds an address counts as "seen before"
MAX_SEEN = 20000


def _dumps(obj: Any) -> str:
    return json.dumps(obj, separators=(",", ":"))


def ble_priority(item: Dict[str, Any], seen: Any) -> "tuple":
    """Sort key: known addresses, then ones carrying data/name, then stronger RSSI."""
    has_data = bool(item.get("svcData") or item.get("mfg") or item.get("name"))
    return (item.get("mac") not in seen, not has_data, -int(item.get("rssi", -127)))


def plan_ble_frames(items: List[Dict[str, Any]], seen: Any,
                    frame_items: int = FRAME_ITEMS, window_items: int = WINDOW_ITEMS,
                    frame_bytes: int = FRAME_BYTES) -> "tuple[List[List[Dict[str, Any]]], int]":
    """Order one window's BLE items by priority and split into frames.

    Returns (frames, dropped). Frames hold at most `frame_items` items and
    roughly `frame_bytes` of JSON; at most `window_items` items are kept.
    """
    ranked = sorted(items, key=lambda it: ble_priority(it, seen))
    keep, dropped = ranked[:window_items], max(0, len(ranked) - window_items)
    frames: List[List[Dict[str, Any]]] = []
    cur: List[Dict[str, Any]] = []
    size = 0
    for it in keep:
        n = len(_dumps(it)) + 1
        if cur and (len(cur) >= frame_items or size + n > frame_bytes):
            frames.append(cur)
            cur, size = [], 0
        cur.append(it)
        size += n
    if cur:
        frames.append(cur)
    return frames, dropped


# --------------------------------------------------------------------------
# Platform + scanner selection
# --------------------------------------------------------------------------


def detect_platform() -> str:
    if os.environ.get("TERMUX_VERSION") or shutil.which("termux-wifi-scaninfo"):
        return "termux"
    if sys.platform.startswith("win"):
        return "windows"
    if sys.platform == "darwin":
        return "darwin"
    return "linux"


def _decode(raw: bytes) -> str:
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        for enc in ("oem", "mbcs", "latin-1"):
            try:
                return raw.decode(enc)
            except (LookupError, UnicodeDecodeError):
                continue
    return raw.decode("utf-8", "replace")


def run_cmd(cmd: List[str], timeout: float = 30.0) -> str:
    """Run a scanner command; raise FileNotFoundError / RuntimeError on failure."""
    kwargs: Dict[str, Any] = {}
    if sys.platform.startswith("win"):
        kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          stdin=subprocess.DEVNULL, timeout=timeout, **kwargs)
    out = _decode(proc.stdout)
    if proc.returncode != 0:
        err = _decode(proc.stderr).strip() or out.strip()
        raise RuntimeError("%s exited %d: %s" % (cmd[0], proc.returncode, err[:300]))
    return out


class WifiScanner:
    """A command plus a pure parser for one platform."""

    def __init__(self, name: str, cmd: List[str], parse: Callable[[str], Any]):
        self.name, self.cmd, self.parse = name, cmd, parse
        self._warned_no_bssid = False

    def available(self) -> bool:
        return shutil.which(self.cmd[0]) is not None

    def scan(self) -> List[Dict[str, Any]]:
        res = self.parse(run_cmd(self.cmd))
        if isinstance(res, tuple):  # system_profiler: (items, skipped)
            res, skipped = res
            if skipped and not self._warned_no_bssid:
                self._warned_no_bssid = True
                log.warning("macOS hid the BSSID of %d network(s); they are skipped. Grant "
                            "Location Services to the terminal app to see them.", skipped)
        return res


def pick_wifi_scanner(plat: str) -> Optional[WifiScanner]:
    if plat == "termux":
        return WifiScanner("termux-wifi-scaninfo", ["termux-wifi-scaninfo"], parse_termux)
    if plat == "linux":
        return WifiScanner("nmcli", NMCLI_CMD, parse_nmcli)
    if plat == "windows":
        return WifiScanner("netsh", NETSH_CMD, parse_netsh)
    if plat == "darwin":
        return WifiScanner("system_profiler", SYSPROF_CMD, parse_system_profiler)
    return None


def is_loopback(host: str) -> bool:
    if host in ("localhost",):
        return True
    try:
        return ipaddress.ip_address(host.strip("[]")).is_loopback
    except ValueError:
        return False


WILDCARD_HOSTS = ("", "0.0.0.0", "::")


def connect_url(host: str, port: int, token: str) -> str:
    h = host
    if h in ("", "0.0.0.0"):
        h = "127.0.0.1"
    elif h == "::":
        h = "[::1]"  # asyncio makes a "::" socket IPv6-only, so 127.0.0.1 would not answer
    elif ":" in h and not h.startswith("["):
        h = "[%s]" % h
    return "ws://%s:%d/?token=%s" % (h, port, quote(token, safe=""))


def local_addresses(family: int = socket.AF_INET) -> List[str]:
    """This machine's addresses of one family, best effort, stdlib only.

    The primary interface comes from a UDP socket "connect" to a documentation
    address (connect() on UDP only picks a route; no packet is sent); the rest
    from resolving the host name. May include loopback; see lan_connect_urls.
    """
    found: List[str] = []
    probe = ("192.0.2.1", 9) if family == socket.AF_INET else ("2001:db8::1", 9)
    try:
        with socket.socket(family, socket.SOCK_DGRAM) as s:
            s.connect(probe)
            found.append(s.getsockname()[0])
    except (OSError, ValueError):
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, family, socket.SOCK_DGRAM):
            found.append(info[4][0])
    except (OSError, UnicodeError, ValueError):
        pass
    return found


def lan_connect_urls(host: str, port: int, token: str, addresses: Iterable[Any]) -> List[str]:
    """Connect URLs for another device on this network, for a wildcard --host.

    "0.0.0.0" (or "") gives one URL per usable IPv4 address; "::" one per
    usable IPv6 address, since that socket is IPv6-only. Loopback, unspecified,
    link-local and multicast addresses are skipped; order is kept and
    duplicates dropped. Any other host gives [] (its own URL is the only one).
    """
    if host not in WILDCARD_HOSTS:
        return []
    version = 6 if host == "::" else 4
    out: List[str] = []
    for a in addresses:
        try:
            ip = ipaddress.ip_address(str(a).split("%", 1)[0].strip("[] "))
        except ValueError:
            continue
        if (ip.version != version or ip.is_loopback or ip.is_unspecified
                or ip.is_link_local or ip.is_multicast):
            continue
        url = connect_url(str(ip), port, token)
        if url not in out:
            out.append(url)
    return out


# --------------------------------------------------------------------------
# Server
# --------------------------------------------------------------------------


class Bridge:
    def __init__(self, args: argparse.Namespace):
        self.args = args
        self.token: str = args.token
        self.platform = detect_platform()
        self.clients: set = set()
        self.caps = {"wifi": False, "ble": False}
        self.ble_pending: Dict[str, Dict[str, Any]] = {}
        self.ble_seen: Dict[str, float] = {}  # mac -> monotonic time last forwarded
        self._ble_overflow = 0                # adverts dropped because ble_pending was full
        self._flood_warned_at: Optional[float] = None
        self.scanner = None
        self.wifi: Optional[WifiScanner] = None

    # ---- clients ----
    def hello(self) -> str:
        return json.dumps({"type": "hello", "agent": AGENT, "version": PROTOCOL_VERSION,
                           "caps": dict(self.caps), "platform": self.platform},
                          separators=(",", ":"))

    async def handler(self, connection, path: Optional[str] = None):
        if path is None:
            req = getattr(connection, "request", None)
            path = getattr(req, "path", None) if req is not None else None
            if path is None:
                path = getattr(connection, "path", None)
        peer = getattr(connection, "remote_address", None)
        if not check_token(path, self.token):
            log.warning("rejected client %s: missing or wrong token", peer)
            await connection.close(code=1008, reason="invalid token")
            return
        log.info("client connected: %s (%d total)", peer, len(self.clients) + 1)
        self.clients.add(connection)
        try:
            await connection.send(self.hello())
            async for _ in connection:  # clients have nothing to say; drain.
                pass
        except Exception as e:  # connection closed / reset
            log.debug("client %s: %r", peer, e)
        finally:
            self.clients.discard(connection)
            log.info("client disconnected: %s (%d left)", peer, len(self.clients))

    def drop_client(self, c, why: str = ""):
        """Forget a client and kill its connection without waiting on it."""
        if c in self.clients:
            self.clients.discard(c)
            log.warning("dropping client %s: %s", getattr(c, "remote_address", None), why)
        transport = getattr(c, "transport", None)
        try:
            if transport is not None and hasattr(transport, "abort"):
                transport.abort()
            else:  # pragma: no cover - very old websockets without .transport
                asyncio.ensure_future(c.close())
        except Exception as e:
            log.debug("abort failed: %r", e)

    async def broadcast(self, items: List[Dict[str, Any]]):
        if not items or not self.clients:
            return
        msg = json.dumps({"type": "sightings", "items": items}, separators=(",", ":"))

        async def one(c):
            # A client that stops reading must not stall everyone else: each
            # send is bounded, and a slow or broken client is cut off.
            try:
                await asyncio.wait_for(c.send(msg), timeout=SEND_TIMEOUT)
            except asyncio.TimeoutError:
                self.drop_client(c, "not reading (send timed out after %ss)" % SEND_TIMEOUT)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                log.debug("send failed: %r", e)
                self.drop_client(c, "send failed: %s" % (e.__class__.__name__,))

        await asyncio.gather(*(one(c) for c in list(self.clients)))

    # ---- Wi-Fi ----
    def setup_wifi(self):
        if self.args.no_wifi:
            log.info("Wi-Fi scanning disabled (--no-wifi).")
            return
        sc = pick_wifi_scanner(self.platform)
        if sc is None or not sc.available():
            name = sc.cmd[0] if sc else "a scanner"
            log.warning("Wi-Fi scanning unavailable: '%s' not found on this %s system. "
                        "BLE (if enabled) keeps running.", name, self.platform)
            return
        self.wifi = sc
        self.caps["wifi"] = True
        log.info("Wi-Fi scanner: %s every %ss", sc.name, self.args.wifi_interval)

    async def wifi_loop(self):
        sc = self.wifi
        assert sc is not None
        loop = asyncio.get_running_loop()
        last_err = None
        while True:
            try:
                items = await loop.run_in_executor(None, sc.scan)
                if last_err:
                    log.info("Wi-Fi scanning recovered.")
                last_err = None
                log.debug("wifi: %d networks", len(items))
                await self.broadcast(items)
            except asyncio.CancelledError:
                raise
            except FileNotFoundError:
                log.warning("Wi-Fi scanner '%s' disappeared; Wi-Fi disabled.", sc.cmd[0])
                self.caps["wifi"] = False
                return
            except Exception as e:
                msg = str(e) or repr(e)
                if msg != last_err:
                    log.warning("Wi-Fi scan failed (will keep retrying): %s", msg)
                else:
                    log.debug("Wi-Fi scan failed again: %s", msg)
                last_err = msg
            await asyncio.sleep(self.args.wifi_interval)

    # ---- BLE ----
    def on_ble(self, device, adv):
        try:
            item = ble_to_item(getattr(device, "address", ""), adv,
                               fallback_rssi=getattr(device, "rssi", None),
                               addr_type=ble_addr_type(device))
        except Exception as e:
            log.debug("bad BLE advert: %r", e)
            return
        if item:
            mac = item["mac"]
            prev = self.ble_pending.get(mac)
            if prev is None and len(self.ble_pending) >= MAX_PENDING and mac not in self.ble_seen:
                self._ble_overflow += 1  # flood: keep memory bounded, favour known devices
                return
            self.ble_pending[mac] = merge_ble(prev, item)

    async def setup_ble(self):
        if self.args.no_ble:
            log.info("BLE scanning disabled (--no-ble).")
            return
        try:
            from bleak import BleakScanner  # lazy: optional dependency
        except ImportError:
            log.warning("BLE scanning disabled: the 'bleak' package is not installed "
                        "(pip install bleak).")
            return
        try:
            scanner = BleakScanner(detection_callback=self.on_ble)
            await scanner.start()
        except Exception as e:
            log.warning("BLE scanning disabled: could not start Bluetooth scanner: %s", e)
            return
        self.scanner = scanner
        self.caps["ble"] = True
        log.info("BLE scanner started; flushing every %ss", self.args.ble_window)

    def take_ble_frames(self, now: Optional[float] = None) -> List[List[Dict[str, Any]]]:
        """Swap out the pending window and plan its frames (see plan_ble_frames)."""
        now = time.monotonic() if now is None else now
        batch, self.ble_pending = self.ble_pending, {}
        overflow, self._ble_overflow = self._ble_overflow, 0
        # Forget addresses not forwarded for a while; keep the table bounded.
        cutoff = now - SEEN_TTL
        self.ble_seen = {m: t for m, t in self.ble_seen.items() if t >= cutoff}
        if not batch:
            return []
        frames, dropped = plan_ble_frames(list(batch.values()), self.ble_seen)
        sent = sum(len(f) for f in frames)
        if len(batch) > FRAME_ITEMS or overflow:
            if self._flood_warned_at is None or now - self._flood_warned_at >= 60:
                self._flood_warned_at = now
                log.warning("BLE flood? %d addresses in one %ss window: sent %d in %d frame(s), "
                            "dropped %d (+%d unbuffered); known devices are sent first.",
                            len(batch) + overflow, self.args.ble_window, sent, len(frames),
                            dropped, overflow)
        for f in frames:
            for it in f:
                self.ble_seen[it["mac"]] = now
        if len(self.ble_seen) > MAX_SEEN:
            newest = sorted(self.ble_seen.items(), key=lambda kv: kv[1])[-MAX_SEEN:]
            self.ble_seen = dict(newest)
        return frames

    async def ble_loop(self):
        while True:
            await asyncio.sleep(self.args.ble_window)
            frames = self.take_ble_frames()
            if frames:
                log.debug("ble: %d devices in %d frame(s)", sum(map(len, frames)), len(frames))
            for f in frames:
                await self.broadcast(f)

    async def stop_ble(self):
        if self.scanner is not None:
            try:
                await self.scanner.stop()
            except Exception as e:
                log.debug("BLE stop: %r", e)
            self.scanner = None

    # ---- main ----
    async def run(self):
        try:
            from websockets.asyncio.server import serve  # websockets >= 13
        except ImportError:
            try:
                from websockets import serve  # older releases
            except ImportError:
                log.error("The 'websockets' package is required: pip install websockets")
                return 2

        self.setup_wifi()
        await self.setup_ble()
        if not (self.caps["wifi"] or self.caps["ble"]):
            log.warning("Neither Wi-Fi nor BLE scanning is available; clients will "
                        "connect but receive no sightings.")

        stop = asyncio.Event()
        loop = asyncio.get_running_loop()
        import signal

        def on_signal():
            if stop.is_set():  # second Ctrl+C: stop waiting for a clean shutdown
                print("forced exit.", file=sys.stderr, flush=True)
                os._exit(130)
            stop.set()

        for sig in (getattr(signal, "SIGINT", None), getattr(signal, "SIGTERM", None)):
            if sig is None:
                continue
            try:
                loop.add_signal_handler(sig, on_signal)
            except (NotImplementedError, RuntimeError):
                pass  # Windows: Ctrl+C arrives as KeyboardInterrupt instead.

        tasks: List[asyncio.Future] = []
        server = await serve(self.handler, self.args.host, self.args.port,
                             max_size=4096, close_timeout=2)
        try:
            url = connect_url(self.args.host, self.args.port, self.token)
            print("Fieldwatch bridge (protocol v%s, %s) listening." % (PROTOCOL_VERSION, self.platform),
                  file=sys.stderr)
            print("Connect URL: %s" % url, flush=True)
            host = self.args.host
            if host in WILDCARD_HOSTS:
                fam = socket.AF_INET6 if host == "::" else socket.AF_INET
                # Resolving the host name can be slow (e.g. mDNS), so keep it off the event loop.
                addrs = await asyncio.get_running_loop().run_in_executor(None, local_addresses, fam)
                lan = lan_connect_urls(host, self.args.port, self.token, addrs)
                for u in lan:
                    print("From another device on this network: %s" % u, flush=True)
                if not lan:
                    log.warning("Could not find this machine's network address. From another device, "
                                "use ws://<this machine's IP>:%d/?token=<token>.", self.args.port)
                if host == "::":
                    log.warning("--host :: listens on IPv6 only; use --host 0.0.0.0 for IPv4 devices.")
            if not is_loopback(self.args.host):
                log.warning("Host %s is not loopback: other machines on the network can "
                            "reach this bridge. Keep the token secret.", self.args.host)
            if self.wifi:
                tasks.append(asyncio.ensure_future(self.wifi_loop()))
            if self.caps["ble"]:
                tasks.append(asyncio.ensure_future(self.ble_loop()))
            await stop.wait()
            log.info("shutting down...")
        finally:
            try:
                await asyncio.wait_for(self.shutdown(server, tasks), SHUTDOWN_TIMEOUT)
            except (asyncio.TimeoutError, asyncio.CancelledError, Exception) as e:
                log.warning("shutdown did not finish cleanly (%r); exiting anyway.", e)
                for c in list(self.clients):
                    self.clients.discard(c)
                    transport = getattr(c, "transport", None)
                    if transport is not None and hasattr(transport, "abort"):
                        transport.abort()
        return 0

    async def shutdown(self, server, tasks: List[asyncio.Future]):
        """Stop loops, cut clients off, close the listener, stop BLE -- all bounded."""
        for t in tasks:
            t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

        async def bye(c):
            try:
                await asyncio.wait_for(c.close(1001, "bridge shutting down"), 1.0)
            except Exception:
                pass
            self.clients.discard(c)
            transport = getattr(c, "transport", None)
            if transport is not None and hasattr(transport, "abort"):
                transport.abort()

        await asyncio.gather(*(bye(c) for c in list(self.clients)), return_exceptions=True)
        server.close()
        try:
            await asyncio.wait_for(server.wait_closed(), 2.0)
        except asyncio.TimeoutError:
            log.debug("listener close timed out")
        try:
            await asyncio.wait_for(self.stop_ble(), 2.0)
        except asyncio.TimeoutError:
            log.debug("BLE stop timed out")


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Stream real Wi-Fi / BLE scan data to Fieldwatch Web over a local WebSocket.")
    p.add_argument("--host", default=DEFAULT_HOST,
                   help="listen address (default 127.0.0.1); 0.0.0.0 also prints a URL per LAN address")
    p.add_argument("--port", type=int, default=DEFAULT_PORT, help="listen port (default 8765)")
    p.add_argument("--token", default=None,
                   help="access token clients must send as ?token= (default: random)")
    p.add_argument("--no-wifi", action="store_true", help="disable Wi-Fi scanning")
    p.add_argument("--no-ble", action="store_true", help="disable Bluetooth LE scanning")
    p.add_argument("--wifi-interval", type=float, default=5.0,
                   help="seconds between Wi-Fi scans (default 5)")
    p.add_argument("--ble-window", type=float, default=2.0,
                   help="seconds between batched BLE flushes (default 2)")
    p.add_argument("--verbose", "-v", action="store_true", help="debug logging")
    return p


def main(argv: Optional[List[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s", stream=sys.stderr)
    # The websockets library logs every frame at DEBUG and each connection at INFO.
    logging.getLogger("websockets").setLevel(logging.WARNING)
    if args.token is None:
        args.token = secrets.token_urlsafe(12)
    if not args.token:
        log.error("--token must not be empty")
        return 2
    if args.wifi_interval <= 0 or args.ble_window <= 0:
        log.error("--wifi-interval and --ble-window must be positive")
        return 2
    try:
        return asyncio.run(Bridge(args).run()) or 0
    except KeyboardInterrupt:
        print("stopped.", file=sys.stderr)
        return 0
    except OSError as e:
        log.error("could not listen on %s:%s: %s", args.host, args.port, e)
        return 1


if __name__ == "__main__":
    sys.exit(main())
