"""Unit tests for fieldwatch_bridge's pure functions.

Run from the repo root:  python3 -m unittest bridge/test_bridge.py
"""

import json
import os
import sys
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
        self.assertEqual(fb.channel_to_freq(0), 0)
        self.assertEqual(fb.channel_to_freq("x"), 0)

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

    def test_url_encoding(self):
        self.assertTrue(fb.check_token("/?token=a%2Bb", "a+b"))

    def test_connect_url(self):
        self.assertEqual(fb.connect_url("127.0.0.1", 8765, "abc"), "ws://127.0.0.1:8765/?token=abc")
        self.assertEqual(fb.connect_url("::1", 9000, "abc"), "ws://[::1]:9000/?token=abc")
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
            "vendorIe": [], "hidden": False,
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

    def test_merge(self):
        a = fb.ble_to_item("AA:BB:CC:DD:EE:FF", FakeAdv(rssi=-50, local_name="X",
                                                         manufacturer_data={76: b"\x01"}))
        b = fb.ble_to_item("AA:BB:CC:DD:EE:FF", FakeAdv(rssi=-70, service_uuids=["180f"]))
        m = fb.merge_ble(a, b)
        self.assertEqual(m["rssi"], -50)             # strongest of the window
        self.assertEqual(m["name"], "X")             # filled from earlier packet
        self.assertEqual(m["uuids"], ["180F"])       # latest
        self.assertEqual(m["mfg"], [{"companyId": 76, "dataHex": "01"}])
        self.assertIs(fb.merge_ble(None, b), b)

    def test_bridge_on_ble_dedupes(self):
        import argparse
        br = fb.Bridge(argparse.Namespace(token="t"))

        class Dev:
            address = "aa:bb:cc:dd:ee:ff"
            rssi = None

        br.on_ble(Dev(), FakeAdv(rssi=-60))
        br.on_ble(Dev(), FakeAdv(rssi=-55))
        br.on_ble(Dev(), FakeAdv(rssi=-75))
        self.assertEqual(list(br.ble_pending), ["AA:BB:CC:DD:EE:FF"])
        self.assertEqual(br.ble_pending["AA:BB:CC:DD:EE:FF"]["rssi"], -55)


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
