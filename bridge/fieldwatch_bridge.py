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

Security: every client must present ?token=<token> in the connect URL, else the
connection is closed with code 1008 (policy violation). Without it, any web page
the user happens to visit could open ws://127.0.0.1:8765 and read nearby-device
data. The bridge itself makes no network connections; it only listens.

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
import subprocess
import sys
from typing import Any, Callable, Dict, Iterable, List, Optional
from urllib.parse import parse_qs, urlsplit

PROTOCOL_VERSION = 1
AGENT = "fieldwatch-bridge"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765
BLE_FREQ = 2402

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


def ble_to_item(address: str, adv: Any, fallback_rssi: Optional[int] = None) -> Optional[Dict[str, Any]]:
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
    }


def merge_ble(prev: Optional[Dict[str, Any]], new: Dict[str, Any]) -> Dict[str, Any]:
    """De-duplicate two sightings of one address inside a flush window.

    Keeps the latest reading, but the strongest RSSI of the window, and fills
    name / mfg / uuids / svcData from earlier packets when the latest one
    lacks them (devices alternate adverts and scan responses).
    """
    if not prev:
        return new
    out = dict(new)
    out["rssi"] = max(int(prev["rssi"]), int(new["rssi"]))
    for k in ("name",):
        if not out.get(k):
            out[k] = prev.get(k, "")
    for k in ("mfg", "uuids", "svcData"):
        if not out.get(k):
            out[k] = prev.get(k, [])
    return out


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


def connect_url(host: str, port: int, token: str) -> str:
    h = host
    if h in ("", "0.0.0.0", "::"):
        h = "127.0.0.1"
    elif ":" in h and not h.startswith("["):
        h = "[%s]" % h
    return "ws://%s:%d/?token=%s" % (h, port, token)


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

    async def broadcast(self, items: List[Dict[str, Any]]):
        if not items or not self.clients:
            return
        msg = json.dumps({"type": "sightings", "items": items}, separators=(",", ":"))

        async def one(c):
            try:
                await c.send(msg)
            except Exception as e:
                log.debug("send failed: %r", e)

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
                               fallback_rssi=getattr(device, "rssi", None))
        except Exception as e:
            log.debug("bad BLE advert: %r", e)
            return
        if item:
            self.ble_pending[item["mac"]] = merge_ble(self.ble_pending.get(item["mac"]), item)

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

    async def ble_loop(self):
        while True:
            await asyncio.sleep(self.args.ble_window)
            batch, self.ble_pending = self.ble_pending, {}
            if batch:
                log.debug("ble: %d devices", len(batch))
                await self.broadcast(list(batch.values()))

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
        for sig in (getattr(signal, "SIGINT", None), getattr(signal, "SIGTERM", None)):
            if sig is None:
                continue
            try:
                loop.add_signal_handler(sig, stop.set)
            except (NotImplementedError, RuntimeError):
                pass  # Windows: Ctrl+C arrives as KeyboardInterrupt instead.

        tasks = []
        try:
            async with serve(self.handler, self.args.host, self.args.port,
                             max_size=4096):
                url = connect_url(self.args.host, self.args.port, self.token)
                print("Fieldwatch bridge (protocol v%s, %s) listening." % (PROTOCOL_VERSION, self.platform),
                      file=sys.stderr)
                print("Connect URL: %s" % url, flush=True)
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
            for t in tasks:
                t.cancel()
            for t in tasks:
                try:
                    await t
                except (asyncio.CancelledError, Exception):
                    pass
            await self.stop_ble()
        return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Stream real Wi-Fi / BLE scan data to Fieldwatch Web over a local WebSocket.")
    p.add_argument("--host", default=DEFAULT_HOST, help="listen address (default 127.0.0.1)")
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
