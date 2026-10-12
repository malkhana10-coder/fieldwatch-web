# Fieldwatch Web (unofficial)

A bilingual (العربية / English) web port of [Fieldwatch](https://github.com/OffGridPete/Fieldwatch), the passive Wi-Fi and Bluetooth LE field watcher for Android by Off Grid Pete LLC (MIT License). Off Grid Pete LLC did not make or review this port.

## What it does

- **Live** shows every radio heard, with four views: strength list, radar, by class, and timeline. It also has search, sorting, and Extra attention / Mine / Moving with you badges.
- **Signature engine** is a port of the Android `SignatureEngine`. It runs the stock catalog #94 (254 signatures, 6,973 rules) against OUI, MAC prefix, name glob/contains, service UUID, service data, manufacturer ID/data, and vendor IE rules, with the same disambiguation (iBeacon, DJI/Osmo, Polar/GoPro, Meraki/Cisco).
- **BLE field decoder** reads Remote ID (Open Drone ID), TPMS, Ruuvi, Govee, Tile, Kontakt.io and other payloads from the catalog's decode maps.
- **Vendor lookup** covers about 40k IEEE OUIs and 4k Bluetooth SIG company IDs, converted from the app's `radiodb.bin` by `scripts/convert_radiodb.py`.
- **Filters** cover radio type, minimum RSSI, max age, matched only, Extra attention only, hide Mine, hide randomized BLE, and classes, with saved presets.
- **Radio detail** shows decoded fields, why a radio matched, custom name, Mine, per-radio alert, notes, copy as text, and creating a signature from the radio.
- **Hunt** has a smoothed RSSI gauge, warmer/colder trend, peak, and a Geiger-style tone.
- **Signatures** lets you search, filter by class, filter live hits, keep a watchlist, enable or disable signatures, use a full rule editor, and import or export in the same JSON format as the Android app.
- **Sits and reports** cover the path plot, counts by class, signature and channel, Extra attention, possible co-travel, floods, compare between two sits, and exports to CSV, JSON, GPX, KML, WiGLE CSV, Print/PDF and an AI prompt.
- **Log** is capped at 6,000 rows and exports to CSV (Android header) or JSONL. Logs from the Android app can be replayed.
- **Alerts** can play a sound, vibrate, speak (Arabic or English voice) and send a system notification, with a cooldown. A pairing/name flood detector is included.
- **Language and theme:** Arabic (RTL) and English, with System, Light, Dark and Night (red) themes. Privacy mode masks MAC tails and coordinates.
- **PWA:** the app is installable and works offline. Settings can be exported and imported.

## Sources

Browsers cannot see Wi-Fi networks, and most cannot scan BLE. The app has three sources:

1. **Field simulator.** Synthetic radios built from real catalog rules. Every sighting goes through the real engine.
2. **Web Bluetooth scan.** Real BLE advertisements through `navigator.bluetooth.requestLEScan`. This needs Chrome with experimental web platform features turned on.
3. **Log replay.** A Fieldwatch CSV or JSONL log.

## Develop

```bash
npm ci
npm run dev      # local dev server
npm test         # engine unit tests
npm run build    # production build in dist/
```

## Deploy to Netlify

`netlify.toml` builds the site (publish `dist`). In Netlify, choose **Add new site → Import from Git**, pick this repository and branch, and keep the detected settings. You can also deploy by hand: `npm run build && npx netlify-cli deploy --dir=dist`, adding `--prod` when you're ready.
