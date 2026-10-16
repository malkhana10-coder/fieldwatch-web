# Fieldwatch Web (unofficial)

A bilingual (العربية / English) web port of [Fieldwatch](https://github.com/OffGridPete/Fieldwatch), the passive Wi-Fi and Bluetooth LE field watcher for Android by Off Grid Pete LLC (MIT License). Off Grid Pete LLC did not make or review this port. Version 1.3.1 runs in the browser and as an [Android app](#android-app).

**Guides:** [Android app (English)](docs/ANDROID.md) · [تطبيق أندرويد (العربية)](docs/ANDROID.ar.md) · [دليل المستخدم (العربية)](docs/USER-GUIDE.ar.md) · [Bridge for real Wi-Fi/BLE](bridge/README.md)

## What it does

- **Live** shows every radio heard, with five views: strength list, radar, by class, timeline and map. It also has search, sorting, and Extra attention / Mine / Moving with you badges.
- **Signature engine** is a port of the Android `SignatureEngine`. It runs the stock catalog #94 (254 signatures, 6,973 rules) against OUI, MAC prefix, name glob/contains, service UUID, service data, manufacturer ID/data, and vendor IE rules, with the same disambiguation (iBeacon, DJI/Osmo, Polar/GoPro, Meraki/Cisco).
- **BLE field decoder** reads Remote ID (Open Drone ID), TPMS, Ruuvi, Govee, Tile, Kontakt.io and other payloads from the catalog's decode maps.
- **Vendor lookup** covers about 40k IEEE OUIs and 4k Bluetooth SIG company IDs, converted from the app's `radiodb.bin` by `scripts/convert_radiodb.py`.
- **Filters** cover radio type, minimum RSSI, max age, matched only, Extra attention only, hide Mine, hide randomized BLE, and classes, with saved presets.
- **Radio detail** shows decoded fields, why a radio matched, custom name, Mine, per-radio alert, notes, copy as text, and creating a signature from the radio.
- **Hunt** has a smoothed RSSI gauge, warmer/colder trend, peak, and a Geiger-style tone.
- **Signatures** lets you search, filter by class, filter live hits, keep a watchlist, enable or disable signatures, use a full rule editor, and import or export in the same JSON format as the Android app.
- **Sits and reports** cover the path plot, counts by class, signature and channel, Extra attention, possible co-travel, floods, compare between two sits, and exports to CSV, JSON, GPX, KML, WiGLE CSV, Print/PDF (Share report (HTML) in the Android app) and an AI prompt.
- **Log** is capped at 6,000 rows and exports to CSV (Android header) or JSONL. Logs from the Android app can be replayed.
- **Alerts** can play a sound, vibrate, speak (Arabic or English voice) and send a system notification, with a cooldown. A pairing/name flood detector is included.
- **Language and theme:** Arabic (RTL) and English, with System, Light, Dark and Night (red) themes. Privacy mode masks MAC tails and coordinates.
- **PWA:** the app is installable and works offline. Settings can be exported and imported.

## Field intelligence (v1.3)

- **Rotating addresses.** Phones and trackers change their random BLE address every few minutes. The engine links the new address to the one that just went quiet when the advert fingerprint (name, services, manufacturer and payload type) and signal strength match and the match is unambiguous. "Moving with you" and Mine then follow the device across rotations.
- **Trackers away from their owner.** Apple Find My items broadcast a different advert when separated from their owner. Any tracker that keeps one address for over 30 minutes is flagged the same way. If one also travels with you, you get an alert (sound, vibration, voice, notification, Telegram).
- **Places.** The app remembers which devices it heard in each ~330 m area and on which days. "This place" shows familiar versus new devices, and "Learn this place" marks what is around you as familiar. Sentinel can stay quiet for familiar devices. "Seen in several places" lists devices heard in places at least 1 km apart, across sessions.
- **Locate.** In Hunt, readings taken while walking are fitted to a path-loss model to estimate where the device is, with an honest ± radius, drawn on the map. This works outdoors and in large spaces. Indoors, use the warmer/colder gauge.
- **Drones.** Remote ID (ASTM F3411 / Open Drone ID) adverts are fully decoded: serial, aircraft type, status, position, height, speed, heading, operator position and ID. They are shown on a live map with the flight track.
- **Claude analysis.** **Analyze now** on the Dashboard ("Analysis by Claude") and in a sit's Debrief ("Analyze this sit with Claude") streams a written report from Claude (`claude-opus-5-5`) using your own Anthropic API key. Only a text summary is sent: no coordinates, and MACs are masked in privacy mode. Each analysis is a paid API call on your account, so set a spending limit in the Anthropic Console.
- **Real data via the bridge.** See below.

The Telegram bot, the bridge URL and the Anthropic API key stay on the device. They are never exported, and imports can't set them. In the Android app the API key is also excluded from Android backups.

## Sources

Browsers cannot see Wi-Fi networks, and most cannot scan BLE. The app has four sources:

1. **Field simulator.** Synthetic radios built from real catalog rules. Every sighting goes through the real engine.
2. **Web Bluetooth scan.** Real BLE advertisements through `navigator.bluetooth.requestLEScan`. This needs Chrome with experimental web platform features turned on. It is not available in the Android app.
3. **Bridge.** Real Wi-Fi and BLE from `bridge/fieldwatch_bridge.py`. The bridge runs on a laptop (Linux, Windows, macOS), a Raspberry Pi, or Android under Termux (Wi-Fi only), and streams to the app over a local WebSocket protected by a token. See [bridge/README.md](bridge/README.md).
4. **Log replay.** A Fieldwatch CSV or JSONL log.

## Android app

The same app is packaged for Android with [Capacitor](https://capacitorjs.com/) (`android/`, app ID `io.github.malkhana10.fieldwatch`). GitHub Actions builds it on every push to `main` or `fix/v1.2-review` and publishes a pre-release named **Fieldwatch &lt;version&gt; (Android build N)** with the `.apk` attached.

- **Install:** open the [Releases](https://github.com/malkhana10-coder/fieldwatch-web/releases) page on the phone, download the newest `.apk`, allow **Install unknown apps** for your browser or Files app, and open the file. Google Play Protect may warn about a sideloaded app.
- **Updates:** builds are release builds signed with a fixed sideload key committed in this repository. Each newer build installs over the previous one and keeps your data. The trade-off is that anyone who can read the repository could sign an update, which is fine for personal sideloading but not for public distribution. For distribution, use your own key through the `KEYSTORE_*` repository secrets.
- **Scanning:** the app cannot scan Wi-Fi or Bluetooth by itself, because Android's WebView has no Web Bluetooth and web apps cannot scan Wi-Fi. For real data, run the bridge in Termux on the same phone (Wi-Fi only; BLE is not expected to work in Termux) or on a laptop or Raspberry Pi on the same network, and paste its `ws://` URL into Settings › **Bridge URL**.
- **Permissions:** location is optional and is used for Locate, places and sits. The app asks for no Bluetooth or Wi-Fi scanning permissions.
- **Files:** exports open the Android share sheet.

Full instructions: [docs/ANDROID.md](docs/ANDROID.md) (English) and [docs/ANDROID.ar.md](docs/ANDROID.ar.md) (العربية).

## Develop

```bash
npm ci
npm run dev      # local dev server
npm test         # engine, intel, Remote ID and bridge-protocol unit tests
python3 -m unittest bridge/test_bridge.py   # bridge parsers (no dependencies needed)
npm run build    # production build in dist/
```

Android (JDK 21 and the Android SDK):

```bash
npm run build && npx cap sync android   # copy dist/ into the Android project
cd android && ./gradlew assembleRelease # APK in android/app/build/outputs/apk/release/
```

## Deploy to Netlify

`netlify.toml` builds the site (publish `dist`). In Netlify, choose **Add new site → Import from Git**, pick this repository and branch, and keep the detected settings. You can also deploy by hand: `npm run build && npx netlify-cli deploy --dir=dist`, adding `--prod` when you're ready.

The Android APK is built by `.github/workflows/android.yml`, not by Netlify. See [HERMES.md](HERMES.md) for both pipelines.

## License

The original Fieldwatch is © 2026 Off Grid Pete LLC under the MIT License. Keep [LICENSE](LICENSE) and [NOTICE](NOTICE) in every copy, web or APK, and keep the "Unofficial web port" labels.
