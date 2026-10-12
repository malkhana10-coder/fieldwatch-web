import { useEffect, useRef, useState } from 'react'
import { useEngine, Icon, Sheet, fmtDur } from '../ui.jsx'
import { formalReportHtml, previousAtPlace, compareSits, trendSeries, weeklySummary, debrief } from '../engine/reports.js'
import { localAdvice, snapshot } from '../engine/advisor.js'
import { download, inViewer } from '../engine/storage.js'
import { encryptExport } from '../engine/secure.js'
import { maskMac } from '../engine/geo.js'

/** OpenStreetMap view of the path and attention spots. Falls back when tiles cannot load. */
export function MapView({ sit, fallback }) {
  const e = useEngine()
  const ref = useRef(null)
  const [failed, setFailed] = useState(inViewer || e.settings.privacy)
  useEffect(() => {
    if (failed || !ref.current) return
    let map
    let cancelled = false
    ;(async () => {
      try {
        const L = (await import('leaflet')).default
        await import('leaflet/dist/leaflet.css')
        if (cancelled || !ref.current) return
        const pts = sit.path.map((p) => [p.lat, p.lon])
        const marks = Object.values(sit.radios).filter((r) => r.pts.length && ((r.risk || 0) >= 30 || r.fleetIds.some((id) => e.fleetById(id)?.attentionNote)))
        const all = [...pts, ...marks.flatMap((r) => r.pts.map((p) => [p.lat, p.lon]))]
        if (!all.length) { setFailed(true); return }
        map = L.map(ref.current, { attributionControl: true, zoomControl: true })
        const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' })
        let errors = 0
        tiles.on('tileerror', () => { if (++errors > 4) setFailed(true) })
        tiles.addTo(map)
        if (pts.length > 1) L.polyline(pts, { color: '#0a8f5a', weight: 4 }).addTo(map)
        for (const r of marks) {
          const p = r.pts.reduce((a, b) => (b.rssi > a.rssi ? b : a), r.pts[0])
          L.circleMarker([p.lat, p.lon], { radius: 8, color: '#c62839', fillOpacity: 0.7 }).addTo(map)
            .bindPopup(`${(r.fleetIds.map((id) => e.fleetById(id)?.name).join(' + ') || r.name || r.mac).replace(/[<>&]/g, '')}<br>${p.rssi} dBm`)
        }
        map.fitBounds(L.latLngBounds(all), { padding: [20, 20], maxZoom: 17 })
      } catch { setFailed(true) }
    })()
    return () => { cancelled = true; map?.remove() }
  }, [sit.id, failed])
  if (failed) return fallback
  return <div ref={ref} className="map-box" role="region" aria-label="map" />
}

/** Scrub through the sit: which radios had been heard by time t, and where the path was. */
export function Replay({ sit }) {
  const e = useEngine()
  const t = e.t
  const end = sit.end || Date.now()
  const [at, setAt] = useState(end)
  const radios = Object.values(sit.radios).filter((r) => r.first <= at)
  const live = radios.filter((r) => r.last >= at - 60000)
  const newest = [...radios].sort((a, b) => b.first - a.first).slice(0, 6)
  return (
    <div className="card card-pad stack">
      <h3>{t('timeline2')}</h3>
      <input id="replay-range" type="range" min={sit.start} max={end} step={1000} value={at} onChange={(ev) => setAt(Number(ev.target.value))} style={{ direction: 'ltr' }} aria-label={t('timeline2')} />
      <div className="row wrap small">
        <b className="ltr">{t.time(at)}</b>
        <span className="muted">+{fmtDur(at - sit.start)}</span>
        <span className="tag">{radios.length} {t('radios')}</span>
        <span className="tag ok">{live.length} {t.lang === 'ar' ? 'نشط' : 'active'}</span>
      </div>
      <div className="small">
        {newest.map((r) => (
          <div key={r.key} className="row" style={{ padding: '2px 0' }}>
            <span className="mono faint ltr" style={{ minWidth: 70 }}>{t.time(r.first)}</span>
            <span className={'tag ' + (r.kind === 'WIFI' ? 'wifi' : 'ble')}>{r.kind}</span>
            <span className="ellipsis grow">{r.fleetIds.map((id) => e.fleetById(id)?.name).join(' + ') || r.name || maskMac(r.mac, e.settings.privacy)}</span>
            {(r.risk || 0) >= 30 && <span className="tag attn">{r.risk}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

/** What changed at this place since the previous scan there. */
export function PlaceDiff({ sit }) {
  const e = useEngine()
  const t = e.t
  const prev = previousAtPlace(e, sit)
  if (!prev) return null
  const c = compareSits(prev, sit)
  const label = (r) => r.fleetIds.map((id) => e.fleetById(id)?.name).join(' + ') || r.name || maskMac(r.mac, e.settings.privacy)
  return (
    <div className="card card-pad stack">
      <h3>{t('compareLast')}</h3>
      <div className="small muted">{t.date(prev.start)}</div>
      <div className="grid-2">
        <div><b className="small">{t('newSinceLast')} ({c.onlyB.length})</b>{c.onlyB.slice(0, 12).map((r) => <div key={r.key} className="small ellipsis">+ {label(r)}</div>)}</div>
        <div><b className="small">{t('goneSinceLast')} ({c.onlyA.length})</b>{c.onlyA.slice(0, 12).map((r) => <div key={r.key} className="small ellipsis faint">− {label(r)}</div>)}</div>
      </div>
    </div>
  )
}

export function FormalReport({ sit, onClose }) {
  const e = useEngine()
  const t = e.t
  const [by, setBy] = useState(() => { try { return localStorage.getItem('fw.preparedBy') || '' } catch { return '' } })
  const [no, setNo] = useState('FW-' + new Date(sit.start).toISOString().slice(0, 10).replace(/-/g, '') + '-' + sit.id.slice(-4).toUpperCase())
  const radios = Object.values(sit.radios).map((r) => ({ ...r, key: r.key, lastSeen: r.last, firstSeen: r.first, rssi: r.maxRssi, positions: r.pts, history: [], uuids: [], mfg: [], svcData: [] }))
  const html = () => {
    const snap = snapshot(e, radios.filter((r) => !r.flood).map((r) => ({ ...r, cls: r.cls, attention: r.fleetIds.some((id) => e.fleetById(id)?.attentionNote) })))
    return formalReportHtml(sit, e, { preparedBy: by, reportNo: no, advice: localAdvice(e, snap) })
  }
  return (
    <Sheet title={t('officialReport')} onClose={onClose} className="dialog">
      <div className="stack">
        <label className="field"><span>{t('preparedBy')}</span><input id="prepared-by" className="input" value={by} onChange={(ev) => { setBy(ev.target.value); try { localStorage.setItem('fw.preparedBy', ev.target.value) } catch { /* ignore */ } }} /></label>
        <label className="field"><span>{t('reportNo')}</span><input id="report-no" className="input" value={no} onChange={(ev) => setNo(ev.target.value)} dir="ltr" /></label>
        <div className="row wrap">
          <button className="btn primary" onClick={() => { download(no + '.html', html(), 'text/html'); e.auditLog('report-exported', no) }}><Icon name="download" size={15} />{t('downloadHtml')}</button>
          {!inViewer && <button className="btn" onClick={() => {
            const w = window.open('', '_blank')
            if (!w) return
            w.document.write(html()); w.document.close(); setTimeout(() => w.print(), 400)
          }}><Icon name="file" size={15} />{t('printPdf')}</button>}
        </div>
      </div>
    </Sheet>
  )
}

export function EncryptedExport({ sit, onClose }) {
  const e = useEngine()
  const t = e.t
  const [pw, setPw] = useState('')
  return (
    <Sheet title={t('encryptedExport')} onClose={onClose} className="dialog">
      <form className="stack" onSubmit={async (ev) => {
        ev.preventDefault()
        if (pw.length < 6) return e.toast(t('pinShort'), 'warn')
        const text = await encryptExport(pw, sit)
        download(sit.id + '.fieldwatch.json', text, 'application/json')
        e.auditLog('encrypted-export', sit.name)
        onClose()
      }}>
        <label className="field"><span>{t('password')}</span><input id="export-pw" className="input" type="password" autoComplete="new-password" value={pw} onChange={(ev) => setPw(ev.target.value)} /></label>
        <div className="tiny faint">AES-256-GCM · PBKDF2-SHA256</div>
        <button className="btn primary" type="submit"><Icon name="lock" size={15} />{t('encryptedExport')}</button>
      </form>
    </Sheet>
  )
}

export function TrendAndWeek() {
  const e = useEngine()
  const t = e.t
  const w = weeklySummary(e)
  const series = trendSeries(e)
  if (!e.sits.length) return null
  const max = Math.max(1, ...series.map((s) => s.total))
  const W = Math.max(1, series.length) * 28
  return (
    <div className="grid-2">
      <div className="card card-pad">
        <h3>{t('weekly')}</h3>
        <div className="stats" style={{ marginBottom: 0 }}>
          <div className="stat"><b>{w.scans}</b><span>{t('statScans')}</span></div>
          <div className="stat"><b>{w.devices}</b><span>{t('statDevices')}</span></div>
          <div className="stat attn"><b>{w.attention}</b><span>{t('attention')}</span></div>
          <div className="stat"><b>{w.coTravel}</b><span>{t('coTravel')}</span></div>
        </div>
      </div>
      {series.length > 1 && (
        <div className="card card-pad">
          <h3>{t('trends')}</h3>
          <svg viewBox={`0 0 ${W} 100`} style={{ width: '100%', height: 120, direction: 'ltr' }} role="img" aria-label={t('trends')}>
            <line x1="0" y1="90" x2={W} y2="90" stroke="var(--line)" />
            {series.map((s, i) => (
              <g key={s.id}>
                <rect x={i * 28 + 6} y={90 - (s.total / max) * 78} width="16" height={(s.total / max) * 78} rx="3" fill="var(--accent)" opacity=".75"><title>{s.name}: {s.total}</title></rect>
                {s.attention > 0 && <rect x={i * 28 + 6} y={90 - (s.attention / max) * 78} width="16" height={(s.attention / max) * 78} rx="3" fill="var(--danger)" />}
              </g>
            ))}
          </svg>
        </div>
      )}
    </div>
  )
}

export { debrief }
