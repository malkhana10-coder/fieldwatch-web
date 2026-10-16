// Leaflet is bundled and loaded on first use, so the app shell works offline
// (only the OpenStreetMap tiles need the network).
import { useEffect, useRef, useState } from 'react'

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

const OSM = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'

/**
 * A small OpenStreetMap. `draw(L, layerGroup)` adds the layers on every render
 * and returns the [lat, lon] points to frame; the view is fitted once per `fitKey`.
 */
export function GeoMap({ draw, fitKey = 'once', height = 280 }) {
  const L = useLeaflet()
  const ref = useRef(null)
  const map = useRef(null)
  const layer = useRef(null)
  const fitted = useRef(null)
  useEffect(() => {
    if (!L || !ref.current || map.current) return
    const m = L.map(ref.current, { zoomControl: true })
    L.tileLayer(OSM, { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(m)
    layer.current = L.layerGroup().addTo(m)
    map.current = m
    return () => { try { m.remove() } catch { /* ignore */ } map.current = null; layer.current = null; fitted.current = null }
  }, [L])
  useEffect(() => {
    if (!L || !map.current) return
    layer.current.clearLayers()
    const pts = (draw(L, layer.current) || []).filter((p) => p && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    if (fitted.current !== fitKey && pts.length) {
      if (pts.length > 1) map.current.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 18 })
      else map.current.setView(pts[0], 17)
      fitted.current = fitKey
    }
  })
  return <div ref={ref} className="geomap" style={{ height, borderRadius: 'var(--radius)' }} />
}
