# CLAUDE.md — Fieldwatch Web

## What this is
An **unofficial bilingual (Arabic/English) web port** of [Fieldwatch](https://github.com/OffGridPete/Fieldwatch), the passive Wi-Fi & Bluetooth LE field watcher for Android by Off Grid Pete LLC (MIT). This port is NOT made or reviewed by Off Grid Pete LLC — keep the "Unofficial web port" labels.

## Stack
- Vite 5 + React 18, plain JSX, no backend, no database, no secrets.
- Node 20+ required. Build/test:
  ```bash
  npm ci
  npm test        # all unit tests must pass
  npm run build   # outputs dist/
  ```

## Architecture (key files)
- `src/engine/engine.js` — the engine: sources → sightings → matcher → live table, sits, log, alerts, flood detection, plus `trackingAssessment()` / `hiddenDevices()` / `watchedNetFor()` / `sentinelAlert()`.
- `src/engine/catalog.js` — signature matcher (254 signatures, ~7k rules).
- `src/engine/decode.js` — BLE field decoder (Remote ID, TPMS, Ruuvi, Govee, Tile…).
- `src/engine/lookup.js` — ~40k IEEE OUIs + 4k Bluetooth company IDs.
- `src/engine/simulator.js` — synthetic radios (browsers can't scan Wi-Fi). Most sit at a fixed spot so RSSI follows distance; also a separated AirTag, an address-rotating SmartTag and Remote ID drone flights.
- `src/engine/intel.js` — pure: BLE address-rotation linking, tracker separated-from-owner state, `PlaceMemory` (familiar here / seen in several places, persisted in IndexedDB `places`), `locate()` RSSI localization.
- `src/engine/odid.js` — Open Drone ID (ASTM F3411) decode/encode + `mergeDrone()`.
- `src/engine/bridge.js` — validates WebSocket frames from `bridge/fieldwatch_bridge.py` (untrusted input).
- `src/engine/ai.js` — Claude analysis via `@anthropic-ai/sdk` in the browser (user's own key, `claude-opus-5-5`, server-side fallback). `livePrompt()` must never include coordinates.
- `src/leaflet.jsx` — lazy Leaflet loader + `GeoMap` component. `src/screens/Intel.jsx` — trackers / place / multi-place / drones / AI / locate cards.
- `bridge/` — Python companion (websockets + optional bleak) for real Wi-Fi/BLE; token-protected; `python3 -m unittest bridge/test_bridge.py`.
- `src/screens/*.jsx` — Live, Detail, Hunt, Signatures, Reports, Settings, Dashboard, Intel (cards).
- `src/i18n.js` — ALL user-facing strings live here (en + ar). **Every new string must be added to BOTH dicts.**
- `src/styles.css` — theming via CSS vars (`--bg`, `--accent`, `--danger`…), themes: light/dark/night.

## Conventions (respect these)
- Bilingual: add every string to both `en` and `ar` in `src/i18n.js`. App is RTL in Arabic.
- UI primitives in `src/ui.jsx` (`Icon`, `Sheet`, `Seg`, `Switch`, `Setting`, `Glyph`, `Bars`, `ConfirmButton`). Icons are inline SVG paths keyed by name.
- Radio colour: `radioColor(engine, r)` in `Live.jsx` returns a CSS var (`var(--danger)`) or a PALETTE hex. For Leaflet (real map) use the local `mapHex()` which returns actual hex.
- Real map uses Leaflet (npm dependency, lazy-loaded by `MapView` so it works offline) + OpenStreetMap tiles — the tiles need internet.
- Telegram token/chat ID, `bridgeUrl` and `aiKey` are device-only (`DEVICE_ONLY_SETTINGS`): `portableSettings()` strips them from every export and import. Send alerts through `notifyTelegram()` (batched + rate-limited), not `sendTelegram()` directly.
- Keep `LICENSE` and `NOTICE`. Never commit tokens.

## Recent changes (v1.3.0)
- Added: address-rotation linking, trackers away from owner + alert, place memory (familiar/new, learn place, sentinel "new here only", seen in several places), RSSI localization in Hunt, full Remote ID drone panel + map, Claude analysis (live + per sit), bridge source for real Wi-Fi/BLE.

## v1.2.0
- Added: Dashboard tab, real OpenStreetMap map (Leaflet), Sentinel mode, "Am I being followed?" detector, "Hidden devices" detector, Telegram alerts, watched networks, full backup/restore, PDF report header.

## Sources
Browsers can't see Wi-Fi. Four data sources: field simulator (demo), Web Bluetooth LE scan (needs Chrome + experimental flags), the bridge (real Wi-Fi + BLE from `bridge/`), and log replay (Fieldwatch CSV/JSONL).

## Deploy
`netlify.toml` builds the site (publish `dist`). Netlify: Import from Git, keep detected settings. Or `npm run build && npx netlify-cli deploy --dir=dist --prod`.
