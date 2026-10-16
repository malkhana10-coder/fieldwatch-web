# CLAUDE.md — Fieldwatch Web

## What this is
An **unofficial bilingual (Arabic/English) web port** of [Fieldwatch](https://github.com/OffGridPete/Fieldwatch), the passive Wi-Fi & Bluetooth LE field watcher for Android by Off Grid Pete LLC (MIT). This port is NOT made or reviewed by Off Grid Pete LLC — keep the "Unofficial web port" labels.

## Stack
- Vite 5 + React 18, plain JSX, no backend, no database, no secrets.
- Node 20+ required. Build/test:
  ```bash
  npm ci
  npm test        # 18 unit tests — must all pass
  npm run build   # outputs dist/
  ```

## Architecture (key files)
- `src/engine/engine.js` — the engine: sources → sightings → matcher → live table, sits, log, alerts, flood detection, plus `trackingAssessment()` / `hiddenDevices()` / `watchedNetFor()` / `sentinelAlert()`.
- `src/engine/catalog.js` — signature matcher (254 signatures, ~7k rules).
- `src/engine/decode.js` — BLE field decoder (Remote ID, TPMS, Ruuvi, Govee, Tile…).
- `src/engine/lookup.js` — ~40k IEEE OUIs + 4k Bluetooth company IDs.
- `src/engine/simulator.js` — synthetic radios (browsers can't scan Wi-Fi).
- `src/screens/*.jsx` — Live, Detail, Hunt, Signatures, Reports, Settings, Dashboard.
- `src/i18n.js` — ALL user-facing strings live here (en + ar). **Every new string must be added to BOTH dicts.**
- `src/styles.css` — theming via CSS vars (`--bg`, `--accent`, `--danger`…), themes: light/dark/night.

## Conventions (respect these)
- Bilingual: add every string to both `en` and `ar` in `src/i18n.js`. App is RTL in Arabic.
- UI primitives in `src/ui.jsx` (`Icon`, `Sheet`, `Seg`, `Switch`, `Setting`, `Glyph`, `Bars`, `ConfirmButton`). Icons are inline SVG paths keyed by name.
- Radio colour: `radioColor(engine, r)` in `Live.jsx` returns a CSS var (`var(--danger)`) or a PALETTE hex. For Leaflet (real map) use the local `mapHex()` which returns actual hex.
- Real map uses Leaflet (CDN in `index.html`) + OpenStreetMap tiles — needs internet.
- Keep `LICENSE` and `NOTICE`. Never commit tokens.

## Recent changes (v1.2.0)
- Added: Dashboard tab, real OpenStreetMap map (Leaflet), Sentinel mode, "Am I being followed?" detector, "Hidden devices" detector, Telegram alerts, watched networks, full backup/restore, PDF report header.

## Sources
Browsers can't see Wi-Fi. Three data sources: field simulator (demo), Web Bluetooth LE scan (needs Chrome + experimental flags), and log replay (Fieldwatch CSV/JSONL).

## Deploy
`netlify.toml` builds the site (publish `dist`). Netlify: Import from Git, keep detected settings. Or `npm run build && npx netlify-cli deploy --dir=dist --prod`.
