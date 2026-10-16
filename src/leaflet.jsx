// Leaflet's code is bundled and loaded on first use, so the app shell works offline
// (only the OpenStreetMap tiles need the network). Its small stylesheet ships with
// the app's own CSS (before styles.css, which overrides it): a lazily added
// stylesheet that failed once is never fetched again by Vite's preload helper.
import { useCallback, useEffect, useRef, useState } from 'react'
import 'leaflet/dist/leaflet.css'
import { engine } from './engine/engine.js'
import { Icon } from './ui.jsx'

let leaflet = null
let loading = null
let failures = 0
let chunkUrl = null
const listeners = new Set()

const isLeaflet = (v) => !!v && (typeof v === 'object' || typeof v === 'function') && typeof v.map === 'function' && typeof v.tileLayer === 'function'
/** The Leaflet namespace out of whatever the chunk exports (ESM default, CJS wrapper, or the window.L it sets). */
export function pickLeaflet(m) {
  const vals = m && typeof m === 'object' ? Object.values(m) : []
  return [m?.default, m, ...vals, ...vals.map((v) => v?.default), globalThis.L].find(isLeaflet) || null
}

/** The chunk URL a failed import names ("Failed to fetch dynamically imported module: <url>"). */
export function failedModuleUrl(err) {
  const s = String(err?.message || err || '')
  const m = s.match(/(?:https?:|file:)\/\/[^\s'"<>]+?\.m?js(?=$|[?#\s'"])/)
  return m ? m[0] : null
}

const importLeaflet = () => import('leaflet')
const importUrl = (url) => import(/* @vite-ignore */ url)

/**
 * Load Leaflet once; concurrent callers share the attempt. A failed attempt is not
 * kept: the next call tries again. Browsers remember a module URL that failed to
 * load (Chromium answers a second import() from that memory without refetching),
 * so a retry imports the chunk URL from the first error with a cache-busting query.
 * The two importers are only swapped by tests.
 */
export function loadLeaflet(importer = importLeaflet, byUrl = importUrl) {
  if (leaflet) return Promise.resolve(leaflet)
  if (!loading) {
    let attempt
    try {
      attempt = failures && chunkUrl ? byUrl(`${chunkUrl}${chunkUrl.includes('?') ? '&' : '?'}retry=${failures}`) : importer()
    } catch (err) {
      attempt = Promise.reject(err)
    }
    loading = Promise.resolve(attempt).then((m) => {
      const L = pickLeaflet(m)
      if (!L) throw new Error('Leaflet did not load')
      leaflet = L
      loading = null
      listeners.forEach((fn) => fn(L))
      return L
    }).catch((err) => {
      failures++
      chunkUrl = chunkUrl || failedModuleUrl(err)
      loading = null
      throw err
    })
  }
  return loading
}

/** Test helper: forget the loaded module and any failures. */
export function resetLeafletForTests() { leaflet = null; loading = null; failures = 0; chunkUrl = null }

/**
 * `{ L, error, retry }`: L once Leaflet has loaded; `error` when the last attempt
 * failed (offline before the first map, or an old tab after a deploy); retry()
 * tries again. Every map on screen picks Leaflet up as soon as any load succeeds.
 */
export function useLeaflet() {
  const [L, setL] = useState(leaflet)
  const [error, setError] = useState(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (L) return
    let live = true
    const done = (x) => { if (live) { setError(null); setL(x) } }
    listeners.add(done)
    loadLeaflet().then(done, (err) => { if (live) setError(err || new Error('Leaflet did not load')) })
    return () => { live = false; listeners.delete(done) }
  }, [L, attempt])
  const retry = useCallback(() => { setError(null); setAttempt((n) => n + 1) }, [])
  return { L, error, retry }
}

/** Translated text, or a built-in fallback while the key is missing from i18n.js. */
function tx(t, key, en, ar) {
  const s = t(key)
  return s && s !== key ? s : t.lang === 'ar' ? ar : en
}

/**
 * Leaflet's bindPopup / bindTooltip treat a string as HTML. Radio names, SSIDs and
 * drone IDs are untrusted, so always hand Leaflet a text-only DOM node instead.
 */
export function textNode(str) {
  const el = document.createElement('span')
  el.textContent = str == null ? '' : String(str)
  return el
}

/** The resolved theme ('light' | 'dark' | 'night'), as App writes it on <html>. */
export const currentTheme = () => (typeof document !== 'undefined' && document.documentElement.dataset.theme) || 'light'

/** Real hex colours for Leaflet layers (CSS vars don't work there). Night keeps everything red. */
export function mapColors(theme = currentTheme()) {
  if (theme === 'night') {
    return {
      night: true, path: '#ff3b3b', youStroke: '#ff4d4d', youFill: '#000000',
      attn: '#ff2a2a', wifi: '#c23434', ble: '#ff6a5a',
      drone: '#ff5c5c', droneStroke: '#ff7060', droneTrack: '#c23434',
      op: '#8a1c1c', opStroke: '#ff6a6a', opLine: '#b33030',
      sample: '#d13a3a', est: '#ff2a2a',
    }
  }
  return {
    night: false, path: '#0a8f5a', youStroke: '#0f1a17', youFill: '#ffffff',
    attn: '#c62839', wifi: '#1a6fb5', ble: '#7a4fd6',
    drone: '#ffb020', droneStroke: '#7a4a00', droneTrack: '#e08a00',
    op: '#a98bff', opStroke: '#3b2470', opLine: '#7a4fd6',
    sample: '#0a8f5a', est: '#c62839',
  }
}

/**
 * Red shades that keep signature colours apart in the night theme: one per PALETTE
 * index (catalog.js), so no two signature colours fold into the same red. The ninth
 * is a muted red, the most distinct red-only colour from the other eight.
 */
export const NIGHT_SHADES = ['#ff3b3b', '#c23434', '#ff6a5a', '#e04848', '#a82828', '#ff5c5c', '#c84a4a', '#8f2020', '#995454']

const OSM = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const REDRAW_MS = 2000

/**
 * A small OpenStreetMap. `draw(L, layerGroup)` adds the layers and returns the
 * [lat, lon] points to frame; the view is fitted once per `fitKey`. Redraws are
 * throttled to one every 2 s, except when `keys` (the set of things drawn), the
 * language or the theme change.
 */
export function GeoMap({ draw, fitKey = 'once', keys = '', height = 280, label, minHeight }) {
  const { L, error, retry } = useLeaflet()
  const ref = useRef(null)
  const map = useRef(null)
  const layer = useRef(null)
  const zoom = useRef(null)
  const fitted = useRef(null)
  const last = useRef({ at: 0, sig: null })
  const timer = useRef(null)
  const drawRef = useRef(draw)
  drawRef.current = draw
  const fitRef = useRef(fitKey)
  fitRef.current = fitKey
  const t = engine.t
  const rtl = t.dir === 'rtl'
  const sig = `${keys}|${currentTheme()}|${t.lang}`

  useEffect(() => {
    if (!L || !ref.current || map.current) return
    // No zoom/fade animation: these maps redraw every few seconds and can be unmounted
    // mid-animation (leaving a tab), which made Leaflet throw reading `_leaflet_pos`.
    const m = L.map(ref.current, { zoomControl: false, zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false })
    L.tileLayer(OSM, { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(m)
    layer.current = L.layerGroup().addTo(m)
    map.current = m
    return () => {
      clearTimeout(timer.current)
      try { m.remove() } catch { /* ignore */ }
      map.current = null; layer.current = null; zoom.current = null; fitted.current = null; last.current = { at: 0, sig: null }
    }
  }, [L])

  // Zoom buttons on the leading side, with localised titles.
  useEffect(() => {
    if (!L || !map.current) return
    zoom.current?.remove()
    zoom.current = L.control.zoom({ position: rtl ? 'topright' : 'topleft', zoomInTitle: t('zoomIn'), zoomOutTitle: t('zoomOut') }).addTo(map.current)
  }, [L, rtl, t.lang, !!map.current])

  const redraw = () => {
    if (!L || !map.current || !layer.current) return
    clearTimeout(timer.current)
    timer.current = null
    last.current = { at: Date.now(), sig }
    layer.current.clearLayers()
    const pts = (drawRef.current(L, layer.current) || []).filter((p) => p && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    const fk = fitRef.current
    if (fitted.current !== fk && pts.length) {
      if (pts.length > 1) map.current.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 18, animate: false })
      else map.current.setView(pts[0], 17, { animate: false })
      fitted.current = fk
    }
  }

  useEffect(() => {
    if (!L || !map.current) return
    const wait = REDRAW_MS - (Date.now() - last.current.at)
    if (last.current.sig !== sig || fitted.current !== fitKey || wait <= 0) redraw()
    else if (!timer.current) timer.current = setTimeout(redraw, wait)
  })
  useEffect(() => () => clearTimeout(timer.current), [])

  // Leaflet takes over this div once loaded; until then it can hold the failure note.
  return (
    <div ref={ref} className="geomap" role="region" aria-label={label} style={{ height, minHeight, borderRadius: 'var(--radius)' }}>
      {!L && error && (
        <div className="geomap-fail">
          <span>{tx(t, 'mapLoadFailed', 'The map could not be loaded.', 'تعذّر تحميل الخريطة.')}</span>
          <button type="button" className="btn sm" onClick={retry} aria-label={tx(t, 'mapRetry', 'Retry loading the map', 'أعد محاولة تحميل الخريطة')}>
            <Icon name="refresh" size={15} />{tx(t, 'retry', 'Retry', 'إعادة المحاولة')}
          </button>
        </div>
      )}
    </div>
  )
}
