# Fieldwatch ESP32 sensor

A small external sensor for Fieldwatch Web. It listens to Bluetooth LE advertisements and Wi-Fi access points and prints them as JSON lines over USB. It only receives: BLE scanning is passive and the Wi-Fi scan is passive.

1. Install the Arduino IDE and the **esp32** boards package (Espressif).
2. Open `esp32-fieldwatch.ino`, choose your board, and upload.
3. In Fieldwatch Web on Chrome or Edge (desktop or Android), open **Live → Source → ESP32 sensor (USB)** and press **Start**. Pick the board's serial port when the browser asks.

Protocol (one object per line, 115200 baud):

```json
{"t":"ble","mac":"C2:00:00:00:00:01","rssi":-61,"name":"Tile","mfg":[[76,"1219AA"]],"uuids":["FEED"],"svc":[["FEED","02AA"]]}
{"t":"wifi","mac":"00:0F:B3:00:00:01","rssi":-70,"ssid":"Home","ch":36,"sec":"WPA2-PSK"}
```

Status: the web side of the protocol is covered by unit tests. The sketch itself has not yet been verified on real hardware.
