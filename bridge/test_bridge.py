"""Unit tests for fieldwatch_bridge's pure functions.

Run from the repo root:  python3 -m unittest bridge/test_bridge.py
"""

import argparse
import asyncio
import json
import logging
import os
import sys
import time
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import fieldwatch_bridge as fb  # noqa: E402

ITEM_KEYS = {"kind", "mac", "name", "hidden", "rssi", "channel", "freq", "security",
             "mfg", "uuids", "svcData", "vendorIe"}

NMCLI_OUT = "\n".join([
    r"AA\:BB\:CC\:11\:22\:33:HomeNet:6:2437 MHz:70:WPA2",
    r"AA\:BB\:CC\:11\:22\:34:Cafe\: Free WiFi:11:2462 MHz:55:",
    r"aa\:bb\:cc\:11\:22\:35::36:5180 MHz:90:WPA3",
    r"AA\:BB\:CC\:11\:22\:36:Corp\\Net:149:5745 MHz:40:WPA2 802.1X",
    r"AA\:BB\:CC\:11\:22\:37:Legacy:1:2412 MHz:100:WPA1 WPA2",
    "",
    "garbage line",
])

NETSH_OUT = """
Interface name : Wi-Fi
There are 2 networks currently visible.

SSID 1 : HomeNet
    Network type            : Infrastructure
    Authentication          : WPA2-Personal
    Encryption              : CCMP
    BSSID 1                 : a4:2b:b0:11:22:33
         Signal             : 85%
         Radio type         : 802.11ac
         Band               : 5 GHz
         Channel            : 36
         Basic rates (Mbps) : 6 12 24
         Other rates (Mbps) : 9 18 36 48 54
    BSSID 2                 : a4:2b:b0:11:22:34
         Signal             : 60%
         Radio type         : 802.11n
         Channel            : 6
         Connected Stations:        3
         Channel Utilization:       40 (15 %)
         Basic rates (Mbps) : 1 2 5.5 11
         Other rates (Mbps) : 6 9 12 18 24 36 48 54

SSID 2 :
    Network type            : Infrastructure
    Authentication          : Open
    Encryption              : None
    BSSID 1                 : 00-11-22-AA-BB-CC
         Signal             : 41%
         Radio type         : 802.11n
         Channel            : 14
"""

NETSH_FR = """
SSID 1 : Maison
    Type de réseau          : Infrastructure
    Authentification        : WPA3-Personnel
    Chiffrement             : CCMP
    BSSID 1                 : 10:20:30:40:50:60
         Signal             : 100%
         Type de radio      : 802.11ax
         Bande              : 6 GHz
         Canal              : 5
"""

TERMUX_OUT = json.dumps([
    {"bssid": "aa:bb:cc:dd:ee:01", "frequency_mhz": 2437, "rssi": -48, "ssid": "Cafe",
     "timestamp": 123456, "channel_bandwidth_mhz": "20",
     "capabilities": "[WPA2-PSK-CCMP][RSN-PSK-CCMP][ESS]"},
    {"bssid": "aa:bb:cc:dd:ee:02", "frequency_mhz": 5180, "rssi": -70, "ssid": "",
     "channel_bandwidth_mhz": "80", "capabilities": "[RSN-SAE-CCMP][ESS]"},
    {"bssid": "aa:bb:cc:dd:ee:03", "frequency_mhz": 6115, "rssi": -80, "ssid": "Six",
     "capabilities": "[ESS]"},
    {"bssid": "aa:bb:cc:dd:ee:04", "frequency_mhz": 2484, "rssi": -90, "ssid": "Corp",
     "capabilities": "[WPA2-EAP-CCMP][ESS]"},
    {"bssid": "aa:bb:cc:dd:ee:05", "frequency_mhz": 2412, "rssi": -60, "ssid": "Old"},
    {"bssid": "not-a-mac", "frequency_mhz": 2412, "rssi": -60, "ssid": "Bad"},
])

SYSPROF_OUT = json.dumps({"SPAirPortDataType": [{"spairport_airport_interfaces": [{
    "_name": "en0",
    "spairport_airport_other_local_wireless_networks": [
        {"_name": "WithBssid", "spairport_network_bssid": "aa:bb:cc:00:11:22",
         "spairport_network_channel": "149 (5GHz, 80MHz)",
         "spairport_security_mode": "spairport_security_mode_wpa2_personal",
         "spairport_signal_noise": "-61 dBm / -92 dBm"},
        {"_name": "Redacted", "spairport_network_channel": "6 (2GHz, 20MHz)",
         "spairport_security_mode": "spairport_security_mode_wpa3_transition",
         "spairport_signal_noise": "-70 dBm / -90 dBm"},
    ]}]}]})


class FakeAdv:
    def __init__(self, **kw):
        self.rssi = kw.get("rssi")
        self.local_name = kw.get("local_name")
        self.manufacturer_data = kw.get("manufacturer_data", {})
        self.service_data = kw.get("service_data", {})
        self.service_uuids = kw.get("service_uuids", [])


class HelperTests(unittest.TestCase):
    def test_pct_to_dbm(self):
        self.assertEqual(fb.pct_to_dbm(100), -50)
        self.assertEqual(fb.pct_to_dbm(0), -100)
        self.assertEqual(fb.pct_to_dbm(70), -65)
        self.assertEqual(fb.pct_to_dbm(85), round(85 / 2 - 100))
        self.assertEqual(fb.pct_to_dbm(150), -50)  # clamped
        self.assertIsInstance(fb.pct_to_dbm("55"), int)

    def test_freq_to_channel(self):
        self.assertEqual(fb.freq_to_channel(2412), 1)
        self.assertEqual(fb.freq_to_channel(2437), 6)
        self.assertEqual(fb.freq_to_channel(2472), 13)
        self.assertEqual(fb.freq_to_channel(2484), 14)
        self.assertEqual(fb.freq_to_channel(5180), 36)
        self.assertEqual(fb.freq_to_channel(5745), 149)
        self.assertEqual(fb.freq_to_channel(5955), 1)
        self.assertEqual(fb.freq_to_channel(6115), 33)
        self.assertEqual(fb.freq_to_channel(5935), 2)   # 6 GHz channel 2
        self.assertEqual(fb.freq_to_channel(5930), 0)
        self.assertEqual(fb.freq_to_channel(5940), 0)
        self.assertEqual(fb.freq_to_channel(None), 0)
        self.assertEqual(fb.freq_to_channel(900), 0)

    def test_channel_to_freq(self):
        self.assertEqual(fb.channel_to_freq(1), 2412)
        self.assertEqual(fb.channel_to_freq(6), 2437)
        self.assertEqual(fb.channel_to_freq(13), 2472)
        self.assertEqual(fb.channel_to_freq(14), 2484)
        self.assertEqual(fb.channel_to_freq(36), 5180)
        self.assertEqual(fb.channel_to_freq(165), 5825)
        self.assertEqual(fb.channel_to_freq(5, "6"), 5975)
        self.assertEqual(fb.channel_to_freq(1, "6"), 5955)
        self.assertEqual(fb.channel_to_freq(2, "6"), 5935)  # not 5960
        self.assertEqual(fb.channel_to_freq(233, "6"), 7115)
        self.assertEqual(fb.channel_to_freq(0), 0)
        self.assertEqual(fb.channel_to_freq("x"), 0)

    def test_6ghz_roundtrip(self):
        for ch in [1, 2, 5, 9, 33, 93, 233]:
            self.assertEqual(fb.freq_to_channel(fb.channel_to_freq(ch, "6")), ch)

    def test_freq_channel_roundtrip(self):
        for ch in list(range(1, 15)) + [36, 40, 44, 48, 52, 100, 149, 165]:
            self.assertEqual(fb.freq_to_channel(fb.channel_to_freq(ch)), ch)

    def test_norm_mac(self):
        self.assertEqual(fb.norm_mac("aa:bb:cc:dd:ee:ff"), "AA:BB:CC:DD:EE:FF")
        self.assertEqual(fb.norm_mac("aa-bb-cc-dd-ee-ff"), "AA:BB:CC:DD:EE:FF")
        self.assertEqual(fb.norm_mac("aabbccddeeff"), "AA:BB:CC:DD:EE:FF")
        self.assertIsNone(fb.norm_mac("not-a-mac"))
        self.assertIsNone(fb.norm_mac(None))

    def test_shorten_uuid(self):
        self.assertEqual(fb.shorten_uuid("0000180f-0000-1000-8000-00805f9b34fb"), "180F")
        self.assertEqual(fb.shorten_uuid("0000FEAA-0000-1000-8000-00805F9B34FB"), "FEAA")
        self.assertEqual(fb.shorten_uuid("fffa"), "FFFA")
        full = "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
        self.assertEqual(fb.shorten_uuid(full), full.lower())
        # 32-bit SIG-base UUIDs are not 16-bit: keep full.
        self.assertEqual(fb.shorten_uuid("1234180f-0000-1000-8000-00805f9b34fb"),
                         "1234180f-0000-1000-8000-00805f9b34fb")

    def test_pseudo_mac(self):
        u = "3F2504E0-4F89-11D3-9A0C-0305E82C3301"
        a = fb.pseudo_mac_from_uuid(u)
        self.assertEqual(a, fb.pseudo_mac_from_uuid(u.lower()))  # deterministic, case-insensitive
        self.assertEqual(a, fb.pseudo_mac_from_uuid(" " + u + " "))
        self.assertRegex(a, r"^([0-9A-F]{2}:){5}[0-9A-F]{2}$")
        b0 = int(a[:2], 16)
        self.assertEqual(b0 & 0x02, 0x02)  # locally administered
        self.assertEqual(b0 & 0x01, 0x00)  # unicast
        import hashlib
        h = hashlib.sha1(u.lower().encode()).digest()[:6]
        expected = bytes([(h[0] & 0xFC) | 0x02]) + h[1:]
        self.assertEqual(a, ":".join("%02X" % x for x in expected))
        self.assertNotEqual(a, fb.pseudo_mac_from_uuid("3F2504E0-4F89-11D3-9A0C-0305E82C3302"))


class TokenTests(unittest.TestCase):
    T = "s3cr3t-Token_x"

    def test_accepts(self):
        self.assertTrue(fb.check_token("/?token=s3cr3t-Token_x", self.T))
        self.assertTrue(fb.check_token("/?foo=1&token=s3cr3t-Token_x", self.T))
        self.assertTrue(fb.check_token("/ws?token=s3cr3t-Token_x", self.T))

    def test_rejects(self):
        self.assertFalse(fb.check_token("/", self.T))
        self.assertFalse(fb.check_token("/?token=", self.T))
        self.assertFalse(fb.check_token("/?token=wrong", self.T))
        self.assertFalse(fb.check_token("/?token=s3cr3t-Token_", self.T))
        self.assertFalse(fb.check_token("/?TOKEN=s3cr3t-Token_x", self.T))
        self.assertFalse(fb.check_token("/?token=s3cr3t-Token_x&token=x", self.T))
        self.assertFalse(fb.check_token(None, self.T))
        self.assertFalse(fb.check_token("/?token=", ""))  # empty expected never matches

    def test_connect_url_encodes_token(self):
        for tok in ["a+b", "x&token=y", "p#frag", "s p/a?ce=%", "\u00e9t\u00e9", "a+b&c#d"]:
            url = fb.connect_url("127.0.0.1", 8765, tok)
            q = url.split("?", 1)[1]
            self.assertNotIn("#", q)
            self.assertEqual(q.count("&"), 0, url)
            self.assertTrue(fb.check_token(url[len("ws://127.0.0.1:8765"):], tok), url)
        self.assertEqual(fb.connect_url("127.0.0.1", 8765, "a+b&c#d"),
                         "ws://127.0.0.1:8765/?token=a%2Bb%26c%23d")

    def test_url_encoding(self):
        self.assertTrue(fb.check_token("/?token=a%2Bb", "a+b"))

    def test_connect_url(self):
        self.assertEqual(fb.connect_url("127.0.0.1", 8765, "abc"), "ws://127.0.0.1:8765/?token=abc")
        self.assertEqual(fb.connect_url("::1", 9000, "abc"), "ws://[::1]:9000/?token=abc")
        self.assertEqual(fb.connect_url("0.0.0.0", 1, "Q2x9_-"), "ws://127.0.0.1:1/?token=Q2x9_-")
        self.assertTrue(fb.is_loopback("127.0.0.1"))
        self.assertTrue(fb.is_loopback("localhost"))
        self.assertTrue(fb.is_loopback("::1"))
        self.assertFalse(fb.is_loopback("0.0.0.0"))
        self.assertFalse(fb.is_loopback("192.168.1.5"))


class NmcliTests(unittest.TestCase):
    def test_split_terse(self):
        self.assertEqual(fb.split_terse(r"AA\:BB:x\:y:z\\w:"), ["AA:BB", "x:y", "z\\w", ""])

    def test_parse(self):
        items = fb.parse_nmcli(NMCLI_OUT)
        self.assertEqual(len(items), 5)
        for it in items:
            self.assertEqual(set(it), ITEM_KEYS)
            self.assertEqual(it["kind"], "WIFI")
        a, b, c, d, e = items
        self.assertEqual(a["mac"], "AA:BB:CC:11:22:33")
        self.assertEqual((a["name"], a["hidden"], a["channel"], a["freq"], a["rssi"], a["security"]),
                         ("HomeNet", False, 6, 2437, -65, "WPA2-PSK"))
        self.assertEqual(b["name"], "Cafe: Free WiFi")
        self.assertEqual(b["security"], "OPEN")
        self.assertEqual(c["mac"], "AA:BB:CC:11:22:35")
        self.assertEqual((c["name"], c["hidden"], c["channel"], c["freq"], c["rssi"], c["security"]),
                         ("", True, 36, 5180, -55, "WPA3-SAE"))
        self.assertEqual(d["name"], "Corp\\Net")
        self.assertEqual((d["channel"], d["freq"], d["security"]), (149, 5745, "WPA2-EAP"))
        self.assertEqual((e["rssi"], e["security"]), (-50, "WPA2-PSK"))

    def test_security(self):
        self.assertEqual(fb.nmcli_security(""), "OPEN")
        self.assertEqual(fb.nmcli_security("--"), "OPEN")
        self.assertEqual(fb.nmcli_security("WPA1"), "WPA-PSK")
        self.assertEqual(fb.nmcli_security("WEP"), "WEP")
        self.assertEqual(fb.nmcli_security("WPA2 WPA3"), "WPA3-SAE")


class NetshTests(unittest.TestCase):
    def test_parse(self):
        items = fb.parse_netsh(NETSH_OUT)
        self.assertEqual(len(items), 3)
        for it in items:
            self.assertEqual(set(it), ITEM_KEYS)
        a, b, c = items
        self.assertEqual((a["mac"], a["name"], a["rssi"], a["channel"], a["freq"], a["security"]),
                         ("A4:2B:B0:11:22:33", "HomeNet", round(85 / 2 - 100), 36, 5180, "WPA2-PSK"))
        self.assertEqual((b["mac"], b["name"], b["rssi"], b["channel"], b["freq"]),
                         ("A4:2B:B0:11:22:34", "HomeNet", -70, 6, 2437))
        self.assertEqual((c["mac"], c["name"], c["hidden"], c["channel"], c["freq"], c["security"]),
                         ("00:11:22:AA:BB:CC", "", True, 14, 2484, "OPEN"))
        self.assertEqual(c["rssi"], round(41 / 2 - 100))

    def test_french_6ghz(self):
        items = fb.parse_netsh(NETSH_FR)
        self.assertEqual(len(items), 1)
        it = items[0]
        self.assertEqual((it["name"], it["rssi"], it["channel"], it["freq"], it["security"]),
                         ("Maison", -50, 5, 5975, "WPA3-SAE"))

    def test_security(self):
        self.assertEqual(fb.windows_security("WPA2-Enterprise"), "WPA2-EAP")
        self.assertEqual(fb.windows_security("WPA3-Personal"), "WPA3-SAE")
        self.assertEqual(fb.windows_security("Open", "WEP"), "WEP")
        self.assertEqual(fb.windows_security("Open", "None"), "OPEN")

    def test_empty(self):
        self.assertEqual(fb.parse_netsh(""), [])
        self.assertEqual(fb.parse_netsh("There are 0 networks currently visible."), [])


class TermuxTests(unittest.TestCase):
    def test_parse(self):
        items = fb.parse_termux(TERMUX_OUT)
        self.assertEqual(len(items), 5)
        for it in items:
            self.assertEqual(set(it), ITEM_KEYS)
        a, b, c, d, e = items
        self.assertEqual((a["mac"], a["name"], a["rssi"], a["channel"], a["freq"], a["security"]),
                         ("AA:BB:CC:DD:EE:01", "Cafe", -48, 6, 2437, "WPA2-PSK"))
        self.assertEqual((b["hidden"], b["channel"], b["security"]), (True, 36, "WPA3-SAE"))
        self.assertEqual((c["channel"], c["freq"], c["security"]), (33, 6115, "OPEN"))
        self.assertEqual((d["channel"], d["security"]), (14, "WPA2-EAP"))
        self.assertEqual(e["security"], "")  # capabilities missing -> unknown

    def test_security(self):
        self.assertEqual(fb.termux_security("[WPA2-PSK-CCMP+SAE][ESS]"), "WPA3-SAE")
        self.assertEqual(fb.termux_security("[WEP][ESS]"), "WEP")
        self.assertEqual(fb.termux_security("[ESS]"), "OPEN")

    def test_api_error(self):
        with self.assertRaises(RuntimeError):
            fb.parse_termux('{"API_ERROR": "Location needs to be enabled"}')

    def test_empty(self):
        self.assertEqual(fb.parse_termux("[]"), [])


class MacTests(unittest.TestCase):
    def test_parse(self):
        items, skipped = fb.parse_system_profiler(SYSPROF_OUT)
        self.assertEqual(skipped, 1)
        self.assertEqual(len(items), 1)
        it = items[0]
        self.assertEqual(set(it), ITEM_KEYS)
        self.assertEqual((it["mac"], it["name"], it["rssi"], it["channel"], it["freq"], it["security"]),
                         ("AA:BB:CC:00:11:22", "WithBssid", -61, 149, 5745, "WPA2-PSK"))


class BleTests(unittest.TestCase):
    def test_conversion(self):
        adv = FakeAdv(rssi=-67, local_name="Tag",
                      manufacturer_data={0x004C: bytes.fromhex("0215aabb"), 6: b"\x01\x09"},
                      service_data={"0000fffa-0000-1000-8000-00805f9b34fb": b"\x0d\x00\xff",
                                    "6E400001-B5A3-F393-E0A9-E50E24DCCA9E": b""},
                      service_uuids=["0000180f-0000-1000-8000-00805f9b34fb",
                                     "6E400001-B5A3-F393-E0A9-E50E24DCCA9E",
                                     "0000180F-0000-1000-8000-00805F9B34FB"])
        it = fb.ble_to_item("c4:7c:8d:6a:12:34", adv)
        self.assertEqual(it, {
            "kind": "BLE", "mac": "C4:7C:8D:6A:12:34", "name": "Tag", "rssi": -67,
            "channel": 0, "freq": 2402, "security": "",
            "mfg": [{"companyId": 6, "dataHex": "0109"}, {"companyId": 76, "dataHex": "0215AABB"}],
            "uuids": ["180F", "6e400001-b5a3-f393-e0a9-e50e24dcca9e"],
            "svcData": [{"uuid": "FFFA", "dataHex": "0D00FF"},
                        {"uuid": "6e400001-b5a3-f393-e0a9-e50e24dcca9e", "dataHex": ""}],
            "vendorIe": [], "hidden": False, "addrType": None,
        })
        json.dumps(it)  # serialisable

    def test_macos_uuid_address(self):
        u = "3F2504E0-4F89-11D3-9A0C-0305E82C3301"
        it = fb.ble_to_item(u, FakeAdv(rssi=-80))
        self.assertEqual(it["mac"], fb.pseudo_mac_from_uuid(u))
        self.assertEqual(it["name"], "")
        self.assertEqual((it["mfg"], it["uuids"], it["svcData"]), ([], [], []))

    def test_rssi_fallback_and_invalid(self):
        self.assertEqual(fb.ble_to_item("AA:BB:CC:DD:EE:FF", FakeAdv(), fallback_rssi=-90)["rssi"], -90)
        self.assertIsNone(fb.ble_to_item("AA:BB:CC:DD:EE:FF", FakeAdv()))
        self.assertIsNone(fb.ble_to_item("garbage", FakeAdv(rssi=-50)))

    def test_addr_type_field(self):
        self.assertEqual(fb.ble_to_item("AA:BB:CC:DD:EE:FF", FakeAdv(rssi=-1), addr_type="public")["addrType"], "public")
        self.assertEqual(fb.ble_to_item("AA:BB:CC:DD:EE:FF", FakeAdv(rssi=-1), addr_type="random")["addrType"], "random")
        self.assertIsNone(fb.ble_to_item("AA:BB:CC:DD:EE:FF", FakeAdv(rssi=-1), addr_type="Public ")["addrType"])
        self.assertIsNone(fb.ble_to_item("AA:BB:CC:DD:EE:FF", FakeAdv(rssi=-1))["addrType"])
        self.assertNotIn("addrType", fb.wifi_item("AA:BB:CC:DD:EE:FF", "x", -50, 6, 2437, "OPEN"))

    def test_ble_addr_type_shapes(self):
        class D:
            def __init__(self, address="AA:BB:CC:DD:EE:FF", **kw):
                self.address = address
                if "details" in kw:
                    self.details = kw["details"]

        class Variant:  # dbus-fast Variant-like
            def __init__(self, v):
                self.value = v

        at = fb.ble_addr_type
        # bleak >= 0.19 on BlueZ: {"path": ..., "props": {...}}
        self.assertEqual(at(D(details={"path": "/org/bluez/hci0/dev_X", "props": {"AddressType": "public"}})), "public")
        self.assertEqual(at(D(details={"path": "/x", "props": {"AddressType": "random"}})), "random")
        self.assertEqual(at(D(details={"props": {"AddressType": Variant("random")}})), "random")
        # older bleak: details is the props dict itself
        self.assertEqual(at(D(details={"Address": "AA:..", "AddressType": "Random"})), "random")
        # unknown / missing / odd shapes
        self.assertIsNone(at(D(details={"props": {"AddressType": "le-public-identity"}})))
        self.assertIsNone(at(D(details={"path": "/x", "props": {}})))
        self.assertIsNone(at(D(details={"path": "/x", "props": None})))
        self.assertIsNone(at(D(details={"props": "garbage"})))
        self.assertIsNone(at(D(details=None)))
        self.assertIsNone(at(D(details=object())))           # e.g. WinRT raw advert data
        self.assertIsNone(at(D(details=["AddressType", "public"])))
        self.assertIsNone(at(D()))                            # no details attribute
        self.assertIsNone(at(object()))
        # macOS CoreBluetooth UUID -> pseudo MAC -> always "random"
        self.assertEqual(at(D(address="3F2504E0-4F89-11D3-9A0C-0305E82C3301", details={})), "random")
        self.assertEqual(at(D(address="3f2504e0-4f89-11d3-9a0c-0305e82c3301")), "random")

    def test_merge(self):
        a = fb.ble_to_item("AA:BB:CC:DD:EE:FF", FakeAdv(rssi=-50, local_name="X",
                                                         manufacturer_data={76: b"\x01"}),
                           addr_type="random")
        b = fb.ble_to_item("AA:BB:CC:DD:EE:FF", FakeAdv(rssi=-70, service_uuids=["180f"]))
        m = fb.merge_ble(a, b)
        self.assertEqual(m["rssi"], -50)             # strongest of the window
        self.assertEqual(m["name"], "X")             # filled from earlier packet
        self.assertEqual(m["uuids"], ["180F"])       # latest
        self.assertEqual(m["mfg"], [{"companyId": 76, "dataHex": "01"}])
        self.assertEqual(m["addrType"], "random")    # filled from earlier packet
        self.assertIs(fb.merge_ble(None, b), b)

    def test_merge_non_odid_service_data(self):
        a = fb.ble_to_item("AA:BB:CC:DD:EE:FF", FakeAdv(rssi=-50, service_data={"feaa": b"\x10"}))
        b = fb.ble_to_item("AA:BB:CC:DD:EE:FF", FakeAdv(rssi=-50, service_data={"feaa": b"\x20"}))
        c = fb.ble_to_item("AA:BB:CC:DD:EE:FF", FakeAdv(rssi=-50))
        self.assertEqual(fb.merge_ble(a, b)["svcData"], [{"uuid": "FEAA", "dataHex": "20"}])  # latest
        self.assertEqual(fb.merge_ble(a, c)["svcData"], [{"uuid": "FEAA", "dataHex": "10"}])  # filled

    @staticmethod
    def _odid(counter, header, uuid="0000fffa-0000-1000-8000-00805f9b34fb", rssi=-60):
        return FakeAdv(rssi=rssi, service_uuids=[uuid],
                       service_data={uuid: bytes([0x0D, counter & 0xFF, header]) + bytes(24)})

    def test_merge_keeps_every_remote_id_message(self):
        # BT4 Remote ID: one message per advert, rotating Basic/Location/Self-ID/System/Operator.
        seq = [0x02, 0x12, 0x32, 0x42, 0x52]
        m = None
        for i in range(10):
            m = fb.merge_ble(m, fb.ble_to_item("AA:BB:CC:DD:EE:01", self._odid(i, seq[i % 5])))
        odid = [s["dataHex"] for s in m["svcData"] if s["uuid"] == "FFFA"]
        self.assertEqual(len(odid), 10)
        self.assertEqual([h[4:6] for h in odid], ["02", "12", "32", "42", "52"] * 2)

    def test_merge_dedupes_identical_remote_id_payloads(self):
        m = None
        for _ in range(5):
            m = fb.merge_ble(m, fb.ble_to_item("AA:BB:CC:DD:EE:01", self._odid(7, 0x12)))
        m = fb.merge_ble(m, fb.ble_to_item("AA:BB:CC:DD:EE:01", FakeAdv(rssi=-60)))  # scan response
        self.assertEqual(len(m["svcData"]), 1)

    def test_merge_remote_id_cap_keeps_every_type(self):
        # 40 distinct Location messages, then one of each other type, then more Location.
        m = None
        n = 0
        for hdr in [0x12] * 40 + [0x02, 0x32, 0x42, 0x52] + [0x12] * 20:
            n += 1
            m = fb.merge_ble(m, fb.ble_to_item("AA:BB:CC:DD:EE:01", self._odid(n, hdr)))
        self.assertEqual(len(m["svcData"]), fb.MAX_SVC_DATA)
        types = [s["dataHex"][4:6] for s in m["svcData"]]
        for t in ("02", "12", "32", "42", "52"):
            self.assertIn(t, types)
        last_counter = "%02X" % (n & 0xFF)
        self.assertIn(last_counter, [s["dataHex"][2:4] for s in m["svcData"]])  # newest kept

    def test_merge_cap_counts_other_service_data(self):
        m = fb.ble_to_item("AA:BB:CC:DD:EE:01", FakeAdv(rssi=-1, service_data={"feaa": b"\x01", "fd6f": b"\x02"}))
        for i in range(30):
            m = fb.merge_ble(m, fb.ble_to_item("AA:BB:CC:DD:EE:01", self._odid(i, 0x12)))
        self.assertEqual(len(m["svcData"]), fb.MAX_SVC_DATA)
        self.assertEqual([s["uuid"] for s in m["svcData"][:2]], ["FEAA", "FD6F"])

    def test_bridge_window_forwards_rotating_remote_id(self):
        # Audit repro: 60 adverts over 6 windows used to forward 6 (all Operator ID).
        br = fb.Bridge(argparse.Namespace(token="t"))

        class Dev:
            address = "AA:BB:CC:DD:EE:01"
            rssi = None

        seq = [0x02, 0x12, 0x32, 0x42, 0x52]
        got = []
        for w in range(6):
            for k in range(10):
                n = w * 10 + k + 1
                br.on_ble(Dev(), self._odid(n, seq[(n - 1) % 5]))
            for frame in br.take_ble_frames():
                for it in frame:
                    got += [s["dataHex"][4:6] for s in it["svcData"] if s["uuid"] == "FFFA"]
        self.assertEqual(len(got), 60)
        self.assertEqual(got.count("52"), 12)

    def test_bridge_on_ble_dedupes(self):
        br = fb.Bridge(argparse.Namespace(token="t"))

        class Dev:
            address = "aa:bb:cc:dd:ee:ff"
            rssi = None
            details = {"path": "/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF", "props": {"AddressType": "public"}}

        br.on_ble(Dev(), FakeAdv(rssi=-60))
        br.on_ble(Dev(), FakeAdv(rssi=-55))
        br.on_ble(Dev(), FakeAdv(rssi=-75))
        self.assertEqual(list(br.ble_pending), ["AA:BB:CC:DD:EE:FF"])
        self.assertEqual(br.ble_pending["AA:BB:CC:DD:EE:FF"]["rssi"], -55)
        self.assertEqual(br.ble_pending["AA:BB:CC:DD:EE:FF"]["addrType"], "public")


def _ble(mac_i, rssi=-80, data=False, name=""):
    mac = "C2:%02X:%02X:%02X:00:01" % ((mac_i >> 16) & 0xFF, (mac_i >> 8) & 0xFF, mac_i & 0xFF)
    adv = FakeAdv(rssi=rssi, local_name=name or None,
                  manufacturer_data={76: b"\x12\x19"} if data else {})
    return fb.ble_to_item(mac, adv)


class FloodTests(unittest.TestCase):
    def test_small_window_is_one_frame(self):
        items = [_ble(i) for i in range(10)]
        frames, dropped = fb.plan_ble_frames(items, set())
        self.assertEqual((len(frames), len(frames[0]), dropped), (1, 10, 0))

    def test_priority_order(self):
        seen_weak = _ble(1, rssi=-95)
        data_mid = _ble(2, rssi=-70, data=True)
        named = _ble(3, rssi=-90, name="Watch")
        bare_strong = _ble(4, rssi=-30)
        bare_weak = _ble(5, rssi=-99)
        frames, _ = fb.plan_ble_frames([bare_weak, bare_strong, named, data_mid, seen_weak],
                                       {seen_weak["mac"]})
        self.assertEqual([it["mac"] for it in frames[0]],
                         [seen_weak["mac"], data_mid["mac"], named["mac"], bare_strong["mac"], bare_weak["mac"]])

    def test_flood_is_capped_and_real_devices_survive(self):
        real = [_ble(100000 + i, rssi=-90) for i in range(20)]   # weak, already known
        flood = [_ble(i, rssi=-40, data=True) for i in range(5000)]
        frames, dropped = fb.plan_ble_frames(flood + real, {r["mac"] for r in real})
        self.assertEqual([len(f) for f in frames], [1500, 1500])
        self.assertEqual(dropped, 2020)
        first = {it["mac"] for it in frames[0][:20]}
        self.assertEqual(first, {r["mac"] for r in real})
        self.assertTrue(all(len(f) <= 2000 for f in frames))   # app keeps 2000 per frame

    def test_frames_respect_byte_budget(self):
        big = []
        for i in range(400):
            it = _ble(i)
            it["svcData"] = [{"uuid": "FFFA", "dataHex": "AB" * 230}] * 16
            big.append(it)
        frames, dropped = fb.plan_ble_frames(big, set())
        self.assertEqual(dropped, 0)
        self.assertGreater(len(frames), 1)
        for f in frames:
            self.assertLessEqual(len(json.dumps({"type": "sightings", "items": f}, separators=(",", ":"))),
                                 fb.FRAME_BYTES + 100)
        self.assertEqual(sum(map(len, frames)), 400)

    def test_take_ble_frames_seen_and_warning(self):
        br = fb.Bridge(argparse.Namespace(token="t", ble_window=2.0))
        real = _ble(999999, rssi=-95)
        br.ble_pending = {real["mac"]: real}
        t = 1000.0
        self.assertEqual(len(br.take_ble_frames(now=t)), 1)
        self.assertIn(real["mac"], br.ble_seen)
        # Flood window: real device is now "seen", so it goes first.
        with self.assertLogs("fieldwatch-bridge", level="WARNING") as cm:
            br.ble_pending = {it["mac"]: it for it in (_ble(i, rssi=-30, data=True) for i in range(4000))}
            br.ble_pending[real["mac"]] = real
            frames = br.take_ble_frames(now=t + 2)
        self.assertEqual(len(cm.output), 1)
        self.assertIn("BLE flood", cm.output[0])
        self.assertEqual([len(f) for f in frames], [1500, 1500])
        self.assertEqual(frames[0][0]["mac"], real["mac"])
        # Warned at most once per minute.
        log = logging.getLogger("fieldwatch-bridge")
        with self.assertLogs("fieldwatch-bridge", level="WARNING") as cm:
            log.warning("marker")
            br.ble_pending = {it["mac"]: it for it in (_ble(i) for i in range(2000))}
            br.take_ble_frames(now=t + 30)
        self.assertEqual(len(cm.output), 1)   # only the marker
        with self.assertLogs("fieldwatch-bridge", level="WARNING") as cm:
            br.ble_pending = {it["mac"]: it for it in (_ble(i) for i in range(2000))}
            br.take_ble_frames(now=t + 63)
        self.assertEqual(len(cm.output), 1)
        # Seen entries expire.
        br.ble_pending = {}
        br.take_ble_frames(now=t + 63 + fb.SEEN_TTL + 1)
        self.assertEqual(br.ble_seen, {})

    def test_pending_is_bounded(self):
        br = fb.Bridge(argparse.Namespace(token="t", ble_window=2.0))
        known = _ble(777777)
        br.ble_seen[known["mac"]] = time.monotonic()

        class Dev:
            rssi = None

            def __init__(self, a):
                self.address = a

        adv = FakeAdv(rssi=-50)
        for i in range(fb.MAX_PENDING + 500):
            br.on_ble(Dev("C2:%02X:%02X:%02X:00:02" % ((i >> 16) & 255, (i >> 8) & 255, i & 255)), adv)
        self.assertEqual(len(br.ble_pending), fb.MAX_PENDING)
        br.on_ble(Dev(known["mac"]), adv)                 # known devices still get in
        self.assertIn(known["mac"], br.ble_pending)
        self.assertEqual(br._ble_overflow, 500)


class FakeTransport:
    def __init__(self):
        self.aborted = False

    def abort(self):
        self.aborted = True


class FakeClient:
    def __init__(self, mode="ok"):
        self.mode, self.sent, self.transport = mode, [], FakeTransport()
        self.remote_address = ("127.0.0.1", 1)

    async def send(self, msg):
        if self.mode == "stall":
            await asyncio.Event().wait()          # never returns: peer stopped reading
        if self.mode == "error":
            raise ConnectionResetError("boom")
        self.sent.append(msg)

    async def close(self, code=1000, reason=""):
        if self.mode == "stall":
            await asyncio.Event().wait()


class FakeServer:
    def __init__(self):
        self.closed = False

    def close(self):
        self.closed = True

    async def wait_closed(self):
        return None


class BroadcastTests(unittest.TestCase):
    def setUp(self):
        self._old = fb.SEND_TIMEOUT
        fb.SEND_TIMEOUT = 0.2
        logging.getLogger("fieldwatch-bridge").setLevel(logging.CRITICAL)

    def tearDown(self):
        fb.SEND_TIMEOUT = self._old
        logging.getLogger("fieldwatch-bridge").setLevel(logging.NOTSET)

    def test_stalled_client_is_dropped_and_others_keep_receiving(self):
        br = fb.Bridge(argparse.Namespace(token="t"))
        good, stalled, broken = FakeClient(), FakeClient("stall"), FakeClient("error")
        br.clients = {good, stalled, broken}
        items = [fb.wifi_item("AA:BB:CC:DD:EE:FF", "x", -50, 6, 2437, "OPEN")]

        async def go():
            t0 = time.monotonic()
            await br.broadcast(items)
            first = time.monotonic() - t0
            for _ in range(5):
                await br.broadcast(items)
            return first, time.monotonic() - t0

        first, total = asyncio.run(go())
        self.assertLess(first, 1.0)
        self.assertLess(total, 1.0)                 # later broadcasts are not held up
        self.assertEqual(len(good.sent), 6)
        self.assertEqual(br.clients, {good})
        self.assertTrue(stalled.transport.aborted)
        self.assertTrue(broken.transport.aborted)
        self.assertFalse(good.transport.aborted)

    def test_shutdown_is_bounded(self):
        br = fb.Bridge(argparse.Namespace(token="t"))
        stalled, good = FakeClient("stall"), FakeClient()
        br.clients = {stalled, good}
        server = FakeServer()

        async def go():
            loop_task = asyncio.ensure_future(asyncio.Event().wait())
            t0 = time.monotonic()
            await asyncio.wait_for(br.shutdown(server, [loop_task]), 10)
            return time.monotonic() - t0, loop_task

        took, loop_task = asyncio.run(go())
        self.assertLess(took, 2.0)
        self.assertTrue(loop_task.cancelled())
        self.assertTrue(server.closed)
        self.assertTrue(stalled.transport.aborted)
        self.assertEqual(br.clients, set())


class ProtocolTests(unittest.TestCase):
    def test_hello(self):
        import argparse
        br = fb.Bridge(argparse.Namespace(token="t"))
        br.caps = {"wifi": True, "ble": False}
        msg = json.loads(br.hello())
        self.assertEqual(msg["type"], "hello")
        self.assertEqual(msg["agent"], "fieldwatch-bridge")
        self.assertEqual(msg["version"], 1)
        self.assertEqual(msg["caps"], {"wifi": True, "ble": False})
        self.assertIn(msg["platform"], ("linux", "windows", "darwin", "termux"))

    def test_parser_defaults(self):
        a = fb.build_parser().parse_args([])
        self.assertEqual((a.host, a.port, a.wifi_interval, a.ble_window), ("127.0.0.1", 8765, 5.0, 2.0))
        self.assertIsNone(a.token)
        self.assertFalse(a.no_wifi or a.no_ble or a.verbose)


if __name__ == "__main__":
    unittest.main()
