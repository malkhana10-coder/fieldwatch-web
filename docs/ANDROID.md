# Fieldwatch for Android (unofficial)

[العربية](ANDROID.ar.md) · [دليل المستخدم بالعربية](USER-GUIDE.ar.md) · [Project README](../README.md) · [Bridge](../bridge/README.md)

The Android app is Fieldwatch Web 1.3.1 packaged with Capacitor. It runs the same app inside Android's WebView, with the same screens, features and languages (Arabic and English). It is an **unofficial** port of [Fieldwatch](https://github.com/OffGridPete/Fieldwatch) by Off Grid Pete LLC (MIT License). Off Grid Pete LLC did not make or review it.

## What the app can and cannot do by itself

- **It cannot scan Wi-Fi or Bluetooth on its own.** Android's WebView has no Web Bluetooth, and web apps cannot scan Wi-Fi. For real radios, run the [bridge](#real-wi-fi-and-bluetooth-the-bridge).
- Without a bridge you still get the **Field simulator** (demo data that runs through the real engine), **Log replay** of a Fieldwatch CSV/JSONL log, signatures, sits, reports and maps.
- There is no background service. Keep Fieldwatch open on screen while you scan or record a sit. Android may pause or close it in the background.

## Install

1. On the phone, open the repository's Releases page: <https://github.com/malkhana10-coder/fieldwatch-web/releases>. If the repository is private, sign in to GitHub in the browser first.
2. Open the newest pre-release named **Fieldwatch &lt;version&gt; (Android build N)**. The highest build number is the newest build. Under **Assets**, tap the `.apk` file. The browser may warn that this type of file can be harmful. Download it only from this page.
3. Open the downloaded file. If Android blocks it, allow **Install unknown apps** for the app you opened it from (your browser or Files app). The setting is usually under Settings › Apps › *that app* › Install unknown apps. The wording differs between phone makers.
4. Google Play Protect may warn about an unknown app or offer to scan it. This is normal for apps installed from outside Google Play. The source code is in this repository.
5. Open **Fieldwatch**, read **Before you start**, choose a language and tap **I understand**.

## Update

- Install a newer APK over the old one in the same way. Every build is a release build signed with the same key, so Android treats it as an update and keeps your data: settings, sits, log, signatures, place memory and the keys you entered.
- The build number is the Android version code. Android will not install a lower build over a higher one. To go back, uninstall first, which deletes the app's data.
- If Android says the app conflicts with an existing package, or shows **App not installed**, the installed copy was signed with a different key (for example an early debug build). Back up first: Settings › **Export all data**. Then uninstall, install the new APK, and use Settings › **Import all data**. The Telegram bot token and chat ID, the bridge URL and the Anthropic API key are never in exports, so enter them again.

## Permissions

| Permission | Used for | When it is asked |
|---|---|---|
| Location (optional) | Records where **your phone** was when it heard a radio. Needed for Locate, place memory, sit paths, maps, and "Moving with you" / tracker alerts. | The first time you press **Start** with Settings › **Tag sightings with location** on and a source other than the Field simulator (the simulator uses simulated GPS). |
| Internet | Map tiles (OpenStreetMap), Telegram alerts, Claude analysis, and the connection to the bridge. | Granted at install, no prompt. |
| Vibration | Alert vibration. | Granted at install, no prompt. |

Choose **While using the app** for location. Precise location gives better Locate results. If you refuse location, everything else still works, and all sessions count as one place.

The app does **not** ask for Bluetooth, Wi-Fi scanning or Nearby devices permissions, because it does not scan by itself. Settings › **Diagnostics** shows which features are available inside the app on your phone. Web Bluetooth and Wi-Fi scanning always show **Not supported** there.

## Real Wi-Fi and Bluetooth: the bridge

The bridge is a small Python program, `bridge/fieldwatch_bridge.py`. It runs the system's own scanners and streams what it hears to the app over a local WebSocket protected by a token. The app accepts unencrypted `ws://` connections to the phone itself (`localhost`) and to local-network addresses for this purpose. Full details are in [bridge/README.md](../bridge/README.md).

### Option A: Termux on the same phone (Wi-Fi only)

1. Install **Termux** and **Termux:API** from the same source (F-Droid, or both from their GitHub releases). The two apps only work together when they come from the same source.
2. Give **Termux:API** the Location permission (Android Settings › Apps › Termux:API › Permissions) and turn Location on.
3. In Termux:
   ```sh
   pkg install python termux-api git
   pip install websockets
   git clone https://github.com/malkhana10-coder/fieldwatch-web
   termux-wake-lock          # keeps Termux running while the screen is off
   python fieldwatch-web/bridge/fieldwatch_bridge.py --no-ble
   ```
4. The bridge prints `Connect URL: ws://127.0.0.1:8765/?token=…`. Copy the whole URL, from `ws://` to the end of the token.
5. In Fieldwatch, go to Settings › **Source** › **Bridge URL** and paste it.
6. Go to **Live**. Stop scanning if it is running, choose the source **Bridge (real Wi-Fi + BLE)**, and press **Start**.

Wi-Fi works through Termux:API (`termux-wifi-scaninfo`) when Termux:API has the Location permission. **Bluetooth LE in Termux is not expected to work**, so run the bridge with `--no-ble`. Android limits how often apps may scan Wi-Fi, so the list refreshes slowly and results can repeat. To test Wi-Fi on its own, run `termux-wifi-scaninfo` in Termux. It should print a JSON list of networks.

### Option B: a laptop or Raspberry Pi on the same network (Wi-Fi and Bluetooth LE)

1. On the computer: `python3 -m pip install -r bridge/requirements.txt` (`websockets` is required; `bleak` adds Bluetooth LE).
2. Find the computer's local IP address (for example `192.168.1.20`) and start the bridge on it:
   ```sh
   python3 bridge/fieldwatch_bridge.py --host 192.168.1.20
   ```
   The printed URL then contains that address and can be used as is. If you use `--host 0.0.0.0` and the printed URL shows `127.0.0.1`, replace `127.0.0.1` with the computer's IP address.
3. The phone and the computer must be on the same network: the same Wi-Fi, or the computer joined to the phone's hotspot (that way it can come with you). If the computer has a firewall, allow incoming TCP on port 8765.
4. Put the URL into Settings › **Bridge URL** on the phone, then **Live** › **Bridge (real Wi-Fi + BLE)** › **Start**.

The connection is plain `ws://`, which is not encrypted, and the token is part of the URL. Use it only on networks you trust. Your own hotspot is better than public Wi-Fi. The bridge makes a new token every time it starts. Use `--token <your-token>` to keep the same URL.

Under **Bridge URL**, the app shows the connection state (**Connecting…**, **Connected**, **Reconnecting…**, **Disconnected**, **Token rejected**, **Error**) and whether the bridge has Wi-Fi and BLE.

## Saving and sharing files

- Every export opens the Android **share sheet**: sit CSV, JSON, GPX, KML and WiGLE CSV, **Export log**, **Export signatures**, **Export settings** and **Export all data**. From there, choose where the file goes, such as a files app, cloud storage, email or a chat.
- In a sit's **Debrief**, **Print / PDF** becomes **Share report (HTML)**. It shares the report as an HTML file. To get a PDF, open that file in a browser and print or save it as PDF from there.
- Imports (**Choose log file**, **Import settings**, **Import all data**, **Import signatures**) open Android's file picker.
- **Export all data** contains your sits with their GPS paths, the log and your place memory. Keep the file private.

## Claude analysis (your own API key)

1. Create an API key in the Anthropic Console (<https://console.anthropic.com>). **Set a spending limit there first.** Each **Analyze now** is a paid API request billed to your account.
2. Paste the key into Settings › **AI analysis** › **Anthropic API key**. It stays on the phone. It is left out of every export and excluded from Android backups.
3. To run an analysis:
   - On the **Dashboard**, use **Analysis by Claude** › **Analyze now**.
   - In **Reports**, open a sit, then use **Analyze this sit with Claude** › **Analyze now**.
   - **Stop** cancels a running analysis. **Copy analysis** copies the result.

Only a text summary is sent to Anthropic: counts, signature names, network and device names, signal strengths, and tracker, place and drone summaries. **No coordinates are sent.** MAC addresses are sent in full unless **Privacy mode** is on, which masks them. The analysis needs an internet connection.

## Using the main features

Labels below are the English ones. The Arabic guide, [USER-GUIDE.ar.md](USER-GUIDE.ar.md), uses the Arabic labels.

- **Night theme.** Use Settings › **Theme** › **Night (red)**, or tap the theme button at the top, which cycles Light › Dark › Night. Night shows dim red on black for use in the dark.
- **Privacy mode.** Turn on Settings › **Privacy mode**. MAC tails and coordinates are masked on screen and in reports. Telegram messages and Claude summaries get masked MACs too. Exports that would contain full addresses or coordinates (sit JSON, GPX, KML, WiGLE CSV and the log export) are disabled. **Export all data** is not affected.
- **Alerts.** Choose what to alert on:
  - Tap the bell next to a signature in **Signatures** to add it to the **Watchlist**.
  - In a radio's detail, turn on **Alert on this radio**.
  - Add network names under Settings › **Watched networks**.

  Settings › **Alerts** sets **Sound**, **Vibrate**, **Voice**, **System notification** and **Repeat alert after**. In a radio's detail, **Mark as mine** silences your own devices.
- **Telegram alerts.**
  1. In Telegram, message **@BotFather**, send `/newbot` and copy the token it gives you.
  2. Send any message to your new bot. A bot cannot message you first.
  3. Open `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy the number after `"chat":{"id":`. That is your chat ID.
  4. In Settings › **External alerts (Telegram)**, fill in **Bot token** and **Chat ID**, tap **Send test**, then turn on **Send alerts to Telegram**.

  Watchlist hits, radio and watched-network alerts, Sentinel, unknown trackers and address floods are sent. They are batched into one message every few seconds at most. Messages carry the device name or MAC (masked in privacy mode) and the signal strength, not your location. The token and chat ID stay on the phone and are never exported.
- **Sentinel mode.** Turn on Settings › **Alerts** › **Sentinel mode** to get a notice, and a Telegram message if enabled, whenever a device is heard for the first time. **New here only** is on by default and skips devices this place already knows and random phone addresses. Without it, Sentinel is very noisy. Use **Learn this place** first at places you know.
- **Trackers away from their owner.** The **Dashboard** card **Trackers near you** lists AirTag, SmartTag, Tile and similar tags, with a state of **Away from its owner (Find My)**, **Near its owner** or **Same address for 30+ min — likely away from its owner**. Settings › **Alerts** › **Unknown tracker alert** (on by default) alerts once per tag when one that is away from its owner is **Moving with you**. That means it was heard with you across more than 200 m for at least 3 minutes, so location must be on. **Am I being followed?** on the Dashboard sums this up. Use **Mark as mine** for your own tags. This needs Bluetooth LE data, which on the phone means a bridge on a laptop or Raspberry Pi (Option B).
- **Places memory.** The **Dashboard** card **This place** shows **Familiar** and **New here** devices for the area you are in (about 330 m). A device becomes familiar after it is heard there on two different days, or when you tap **Learn this place** (tap again to confirm). Trackers and devices moving with you are never learned. **Seen in several places** lists devices remembered in places at least 1 km apart, across sessions. Settings › **This place** › **Forget place memory** clears it all. This needs location; without it, every session counts as one place.
- **Locate.** Open a radio from **Live**, tap **Hunt**, and walk around the area with location on. The **Locate** card shows an estimate (**Estimated within ±R m from N readings**) on a map. It works outdoors and in large spaces. Indoors, follow the **Warmer** / **Colder** gauge instead.
- **Drones (Remote ID).** When a drone's Remote ID broadcast (Bluetooth LE) is heard, the **Dashboard** shows **Drones (Remote ID)** with a map of the drone, its track, its operator and you. Tap a drone for its ID, aircraft type, status, height, speed, heading and operator ID. Positions come from the drone's own broadcast. Map tiles need internet. The Field simulator includes Remote ID flights so you can try it. Real drones need Bluetooth LE data, which means a laptop or Raspberry Pi bridge.

## Troubleshooting

- **Could not connect to the bridge.** Check that the bridge is still running, that the URL was copied completely (including `?token=`), and that the phone can reach the computer (same network, firewall). With Termux, check that Termux has not been closed.
- **The bridge rejected the token / Token rejected.** The bridge was restarted with a new token. Copy the new URL, or start it with `--token`.
- **No Wi-Fi from Termux.** Check that Termux and Termux:API come from the same source, that Termux:API has the Location permission, and that Location is on. Then try `termux-wifi-scaninfo`.
- **No location.** Check the Location permission for Fieldwatch in Android settings and Settings › **Tag sightings with location**. The Field simulator always uses simulated GPS.
- **Blank map.** Map tiles need an internet connection.

## Signing and distribution

The workflow signs every APK with a **fixed sideload key committed to this repository**. Because the key never changes, each build installs over the previous one and keeps your data.

The trade-off: anyone who can read the repository (everyone, if it is public) can sign an APK that Android will accept as an update to yours. That is fine for personal sideloading, but not for public distribution. To distribute the app:

1. Create your own keystore and keep it out of the repository.
2. Set the `KEYSTORE_*` repository secrets. See `.github/workflows/android.yml` for the names.

Switching keys means everyone has to uninstall once. Back up with **Export all data** first.

## License

Fieldwatch is © 2026 Off Grid Pete LLC, under the MIT License. This app is an unofficial port. Keep [LICENSE](../LICENSE) and [NOTICE](../NOTICE) with any copy you share, and do not present it as an official Off Grid Pete LLC build. The IEEE and Bluetooth SIG tables are subject to those organizations' terms (see NOTICE).
