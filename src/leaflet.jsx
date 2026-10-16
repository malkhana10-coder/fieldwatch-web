// Leaflet is bundled and loaded on first use, so the app shell works offline
// (only the OpenStreetMap tiles need the network).
import { useEffect, useRef, useState } from 'react'
import { engine } from './engine/engine.js'

let leaflet = null
let loading = null
export function loadLeaflet() {
  if (!loading) loading = Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')]).then(([m]) => (leaflet = m.default || m))
  return loading
}
export function useLeaflet() {
  const [L, setL] = useState(leaflet)
  useEffect(() => {
    if (L) return
    let live = true
    loadLeaflet().then((x) => { if (live) setL(x) }).catch(() => { /* offline before first load */ })
    return () => { live = false }
  }, [L])
  return L
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

/** Red shades that keep signature colours apart in the night theme. */
export const NIGHT_SHADES = ['#ff3b3b', '#c23434', '#ff6a5a', '#e04848', '#a82828', '#ff5c5c', '#c84a4a', '#8f2020']

const OSM = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const REDRAW_MS = 2000

/**
 * A small OpenStreetMap. `draw(L, layerGroup)` adds the layers and returns the
 * [lat, lon] points to frame; the view is fitted once per `fitKey`. Redraws are
 * throttled to one every 2 s, except when `keys` (the set of things drawn), the
 * language or the theme change.
 */
export function GeoMap({ draw, fitKey = 'once', keys = '', height = 280, label, minHeight }) {
  const L = useLeaflet()
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
    const m = L.map(ref.current, { zoomControl: false })
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
      if (pts.length > 1) map.current.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 18 })
      else map.current.setView(pts[0], 17)
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

  return <div ref={ref} className="geomap" role="region" aria-label={label} style={{ height, minHeight, borderRadius: 'var(--radius)' }} />
}
