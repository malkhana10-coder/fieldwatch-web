// Fieldwatch ESP32 sensor: passive BLE + Wi-Fi AP scanner that prints one JSON
// object per line over USB serial (115200 baud). Fieldwatch Web reads it through
// Web Serial (Live → Source → "ESP32 sensor"). Receive only: it never connects,
// pairs or transmits anything beyond the radio's normal scan requests.
//
// Board: any ESP32 with BLE (ESP32, ESP32-S3, ESP32-C3) on the Arduino-ESP32 core 2.x or 3.x.
// Status: written for the published protocol; not yet verified on hardware.
#include <WiFi.h>
#include <BLEDevice.h>
#include <BLEScan.h>
#include <BLEAdvertisedDevice.h>

static BLEScan *bleScan;

static String hexOf(const uint8_t *d, size_t n) {
  static const char *h = "0123456789ABCDEF";
  String s;
  s.reserve(n * 2);
  for (size_t i = 0; i < n; i++) { s += h[d[i] >> 4]; s += h[d[i] & 15]; }
  return s;
}

static String esc(const String &in) {
  String o;
  for (size_t i = 0; i < in.length(); i++) {
    char c = in[i];
    if (c == '"' || c == '\\') { o += '\\'; o += c; }
    else if ((uint8_t)c >= 0x20) o += c;
  }
  return o;
}

class AdvCallbacks : public BLEAdvertisedDeviceCallbacks {
  void onResult(BLEAdvertisedDevice d) override {
    String line = "{\"t\":\"ble\",\"mac\":\"" + String(d.getAddress().toString().c_str()) + "\",\"rssi\":" + String(d.getRSSI());
    if (d.haveName()) line += ",\"name\":\"" + esc(String(d.getName().c_str())) + "\"";
    if (d.haveManufacturerData()) {
      auto m = d.getManufacturerData();
      const uint8_t *p = (const uint8_t *)m.c_str();
      if (m.length() >= 2) {
        uint16_t company = p[0] | (p[1] << 8);
        line += ",\"mfg\":[[" + String(company) + ",\"" + hexOf(p + 2, m.length() - 2) + "\"]]";
      }
    }
    if (d.haveServiceUUID()) line += ",\"uuids\":[\"" + String(d.getServiceUUID().toString().c_str()) + "\"]";
    if (d.haveServiceData()) {
      auto sd = d.getServiceData();
      line += ",\"svc\":[[\"" + String(d.getServiceDataUUID().toString().c_str()) + "\",\"" + hexOf((const uint8_t *)sd.c_str(), sd.length()) + "\"]]";
    }
    line += "}";
    Serial.println(line);
  }
};

static const char *authName(wifi_auth_mode_t a) {
  switch (a) {
    case WIFI_AUTH_OPEN: return "OPEN";
    case WIFI_AUTH_WEP: return "WEP";
    case WIFI_AUTH_WPA_PSK: return "WPA-PSK";
    case WIFI_AUTH_WPA2_PSK: return "WPA2-PSK";
    case WIFI_AUTH_WPA_WPA2_PSK: return "WPA/WPA2";
    case WIFI_AUTH_WPA2_ENTERPRISE: return "WPA2-EAP";
    case WIFI_AUTH_WPA3_PSK: return "WPA3-SAE";
    case WIFI_AUTH_WPA2_WPA3_PSK: return "WPA2/WPA3";
    default: return "";
  }
}

void setup() {
  Serial.begin(115200);
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  BLEDevice::init("");
  bleScan = BLEDevice::getScan();
  bleScan->setAdvertisedDeviceCallbacks(new AdvCallbacks(), true);
  bleScan->setActiveScan(false);  // passive: listen only, no scan requests
  bleScan->setInterval(100);
  bleScan->setWindow(99);
}

void loop() {
  bleScan->start(5, false);
  bleScan->clearResults();
  int n = WiFi.scanNetworks(false, true, true);  // async=false, show_hidden=true, passive=true
  for (int i = 0; i < n; i++) {
    Serial.println("{\"t\":\"wifi\",\"mac\":\"" + WiFi.BSSIDstr(i) + "\",\"rssi\":" + String(WiFi.RSSI(i)) +
                   ",\"ssid\":\"" + esc(WiFi.SSID(i)) + "\",\"ch\":" + String(WiFi.channel(i)) + ",\"sec\":\"" + authName(WiFi.encryptionType(i)) + "\"}");
  }
  WiFi.scanDelete();
}
