// Cards for the intelligence features: trackers, this place, devices seen in
// several places, Remote ID drones, Claude analysis and device localization.
import { useRef, useState } from 'react'
import { useEngine, Icon, Glyph, Bars, ago, copyText } from '../ui.jsx'
import { radioColor } from './Live.jsx'
import { maskMac, distM } from '../engine/geo.js'
import { trackerState, locate } from '../engine/intel.js'
import { UA_TYPES } from '../engine/odid.js'
import { GeoMap } from '../leaflet.jsx'
import { analyze } from '../engine/ai.js'

const fmtM = (m) => (m == null ? '—' : m >= 1000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m) + ' m')
const rowStyle = { width: '100%', background: 'none', border: 0, borderBlockStart: '1px solid var(--line)', textAlign: 'start' }

function RowButton({ r, onOpen, children, right }) {
  const e = useEngine()
  return (
    <button className="sig" style={rowStyle} onClick={() => onOpen?.(r.key)}>
      <Glyph r={r} color={radioColor(e, r)} />
      <div className="grow" style={{ minWidth: 0 }}>{children}</div>
      {right ?? <div className="rssi"><b className="ltr">{r.rssi}</b><Bars rssi={r.rssi} /></div>}
    </button>
  )
}

const fleetNames = (e, r) => r.fleetIds.map((id) => e.fleetById(id)?.name).filter(Boolean).join(' + ')

export function TrackerTag({ ts }) {
  const e = useEngine()
  const t = e.t
  if (!ts) return null
  const cls = ts.separated === true ? 'attn' : ts.separated === false ? 'ok' : ''
  return <span className={'tag ' + cls}>{t(ts.why)}{ts.battery ? ` · ${t('battery')} ${t('batt_' + ts.battery)}` : ''}</span>
}

/** AirTag / SmartTag / Tile and similar around you, those away from their owner first. */
export function TrackersCard({ onOpen }) {
  const e = useEngine()
  const t = e.t
  const now = Date.now()
  const list = [...e.radios.values()]
    .filter((r) => now - r.lastSeen < 60000)
    .map((r) => ({ r, ts: trackerState(r, now) }))
    .filter((x) => x.ts)
    .sort((a, b) => (b.ts.separated === true) - (a.ts.separated === true) || b.r.rssi - a.r.rssi)
  if (!list.length) return null
  return (
    <div className="card card-pad">
      <h3>{t('trackersTitle')} ({list.length})</h3>
      <div className="small muted" style={{ marginBottom: 6 }}>{t('trackersHint')}</div>
      {list.slice(0, 10).map(({ r, ts }) => (
        <RowButton key={r.key} r={r} onOpen={onOpen}>
          <div className="row wrap" style={{ gap: 6 }}>
            <b className="ellipsis">{fleetNames(e, r) || e.displayName(r) || t('unknown')}</b>
            <TrackerTag ts={ts} />
            {e.coTravel(r) && !e.isMine(r) && <span className="tag warn">{t('movingWithYou')}</span>}
            {r.prevMacs?.length > 0 && <span className="tag" title={t('rotatedHint')}>↻ {r.prevMacs.length}</span>}
          </div>
          <div className="tiny faint ellipsis">{maskMac(r.mac, e.settings.privacy)} · {ago(t, r.lastSeen, now)}</div>
        </RowButton>
      ))}
    </div>
  )
}

/** Familiar vs new devices in the current place, with "learn this place". */
export function PlaceCard({ onOpen }) {
  const e = useEngine()
  const t = e.t
  const p = e.placeSummary()
  return (
    <div className="card card-pad">
      <div className="row wrap">
        <h3 className="grow" style={{ margin: 0 }}>{t('placeTitle')}</h3>
        <button className="btn sm" onClick={() => e.toast(t('placeLearned', { n: e.learnPlace() }))}><Icon name="check" size={14} />{t('placeLearn')}</button>
      </div>
      <div className="row" style={{ gap: 8, margin: '10px 0' }}>
        <span className="tag ok">{t('placeFamiliar')} {p.familiar.length}</span>
        <span className={'tag ' + (p.fresh.length ? 'warn' : '')}>{t('placeNew')} {p.fresh.length}</span>
      </div>
      {!p.located && <div className="small muted" style={{ marginBottom: 6 }}>{t('placeNoGps')}</div>}
      {p.fresh.slice(0, 6).map((r) => (
        <RowButton key={r.key} r={r} onOpen={onOpen}>
          <b className="ellipsis">{e.displayName(r) || fleetNames(e, r) || (r.hidden ? t('hidden') : t('unknown'))}</b>
          <div className="tiny faint ellipsis">{maskMac(r.mac, e.settings.privacy)} · {r.kind} · {r.vendor || r.company || ''}</div>
        </RowButton>
      ))}
      {!p.fresh.length && <span className="faint small">{t('placeNoneNew')}</span>}
      <div className="tiny faint" style={{ marginTop: 8 }}>{t('placeHint')}</div>
    </div>
  )
}

/** Devices remembered in places at least 1 km apart. */
export function MultiPlaceCard({ onOpen }) {
  const e = useEngine()
  const t = e.t
  const list = e.multiPlace()
  const now = Date.now()
  return (
    <div className="card card-pad">
      <h3>{t('multiTitle')} ({list.length})</h3>
      <div className="small muted" style={{ marginBottom: 6 }}>{t('multiHint')}</div>
      {list.slice(0, 10).map(({ key, d, places }) => {
        const live = e.radios.get(key) || [...e.radios.values()].find((r) => r.identity === key)
        return (
          <button key={key} className="sig" style={rowStyle} onClick={() => live && onOpen?.(live.key)} disabled={!live}>
            <span className="glyph"><Icon name={d.kind === 'WIFI' ? 'wifi' : 'ble'} size={18} /></span>
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="row wrap" style={{ gap: 6 }}>
                <b className="ellipsis">{d.name || (d.cls ? t.cls(d.cls) : t('unknown'))}</b>
                <span className="tag warn">{t('multiPlaces', { n: places.length })}</span>
                {live && <span className="tag info">{t('nowNearby')}</span>}
              </div>
              <div className="tiny faint ellipsis">{maskMac(d.mac, e.settings.privacy)} · {d.kind} · {ago(t, d.last, now)}</div>
            </div>
          </button>
        )
      })}
      {!list.length && <span className="faint small">{t('multiNone')}</span>}
    </div>
  )
}

/** Remote ID drones: live data and a map with the drone, its track and its operator. */
export function DronesCard({ onOpen }) {
  const e = useEngine()
  const t = e.t
  const now = Date.now()
  const drones = e.drones(now)
  if (!drones.length) return null
  const you = e.pos
  return (
    <div className="card card-pad">
      <h3>{t('dronesTitle')} ({drones.length})</h3>
      <GeoMap height={260} fitKey={drones.map((r) => r.key).join(',')} draw={(L, g) => {
        const pts = []
        for (const r of drones) {
          const d = r.drone
          if (d.track?.length > 1) L.polyline(d.track.map((p) => [p.lat, p.lon]), { color: '#e08a00', weight: 2, opacity: 0.7 }).addTo(g)
          if (d.lat != null && d.lon != null) {
            L.circleMarker([d.lat, d.lon], { radius: 8, color: '#7a4a00', weight: 2, fillColor: '#ffb020', fillOpacity: 1 }).addTo(g).bindTooltip(`${d.id || r.mac} · ${d.height ?? '?'} m`)
            pts.push([d.lat, d.lon])
            if (d.opLat != null) L.polyline([[d.lat, d.lon], [d.opLat, d.opLon]], { color: '#7a4fd6', weight: 1.5, dashArray: '6 6' }).addTo(g)
          }
          if (d.opLat != null && d.opLon != null) {
            L.circleMarker([d.opLat, d.opLon], { radius: 7, color: '#3b2470', weight: 2, fillColor: '#a98bff', fillOpacity: 1 }).addTo(g).bindTooltip(t('droneOperator'))
            pts.push([d.opLat, d.opLon])
          }
        }
        if (you) { L.circleMarker([you.lat, you.lon], { radius: 7, color: '#0f1a17', weight: 2, fillColor: '#ffffff', fillOpacity: 1 }).addTo(g).bindTooltip(t('mapYou')); pts.push([you.lat, you.lon]) }
        return pts
      }} />
      <div className="row wrap tiny faint" style={{ gap: 12, margin: '6px 0' }}>
        <span><span style={{ color: '#ffb020' }}>●</span> {t('droneLegend')}</span>
        <span><span style={{ color: '#a98bff' }}>●</span> {t('droneOperator')}</span>
        <span>○ {t('mapYou')}</span>
      </div>
      {drones.map((r) => {
        const d = r.drone
        const here = d.lat != null ? { lat: d.lat, lon: d.lon } : null
        return (
          <RowButton key={r.key} r={r} onOpen={onOpen}>
            <div className="row wrap" style={{ gap: 6 }}>
              <b className="mono ellipsis">{d.id || t('unknown')}</b>
              {d.uaType != null && <span className="tag">{UA_TYPES[d.uaType]}</span>}
              {d.status != null && <span className={'tag ' + (d.status === 3 || d.status === 4 ? 'attn' : d.status === 2 ? 'info' : '')}>{t('droneSt' + d.status)}</span>}
            </div>
            <div className="tiny faint">
              {here ? <>
                {t('droneHeight')} <span className="ltr">{d.height ?? '—'} m</span> · {t('droneSpeed')} <span className="ltr">{d.speed ?? '—'} m/s</span>
                {d.direction != null && <> · {t('droneHeading')} <span className="ltr">{Math.round(d.direction)}°</span></>}
                {you && <> · {t('droneFromYou', { d: fmtM(distM(you, here)) })}</>}
                {d.opLat != null && <> · {t('droneOpDist', { d: fmtM(distM(here, { lat: d.opLat, lon: d.opLon })) })}</>}
              </> : t('droneNoFix')}
              {d.operatorId && <> · {t('droneOpId')} <span className="mono">{d.operatorId}</span></>}
            </div>
          </RowButton>
        )
      })}
      <div className="tiny faint" style={{ marginTop: 6 }}>{t('droneMapHint')}</div>
    </div>
  )
}

/** Streams a written analysis from Claude for the prompt returned by `getPrompt()`. */
export function AiPanel({ getPrompt, title }) {
  const e = useEngine()
  const t = e.t
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const ctl = useRef(null)
  const key = e.settings.aiKey
  const run = async () => {
    setBusy(true); setErr(null); setText('')
    ctl.current = new AbortController()
    const res = await analyze({ apiKey: key, prompt: getPrompt(), lang: e.settings.lang, onText: setText, signal: ctl.current.signal })
    setBusy(false)
    if (res.error && res.error !== 'aborted') setErr(res.error === 'other' ? t('aiErrOther', { e: res.detail }) : t('aiErr_' + res.error))
  }
  return (
    <div className="card card-pad">
      <div className="row wrap">
        <h3 className="grow" style={{ margin: 0 }}><Icon name="sparkle" size={16} /> {title || t('aiTitle')}</h3>
        {busy
          ? <button className="btn sm" onClick={() => ctl.current?.abort()}><Icon name="stop" size={14} />{t('stop')}</button>
          : <button className="btn sm primary" disabled={!key} onClick={run}><Icon name="sparkle" size={14} />{t('aiRun')}</button>}
        {text && !busy && <button className="btn sm" onClick={async () => { await copyText(text); e.toast(t('copied')) }}><Icon name="copy" size={14} /></button>}
      </div>
      {!key && <div className="small muted" style={{ marginTop: 8 }}>{t('aiNeedKey')}</div>}
      {busy && !text && <div className="small muted" style={{ marginTop: 8 }}>{t('aiWorking')}</div>}
      {err && <div className="note small" style={{ marginTop: 8 }}>{err}</div>}
      {text && <div className="ai-text" dir="auto">{text}</div>}
      <div className="tiny faint" style={{ marginTop: 8 }}>{t('aiHint')}</div>
    </div>
  )
}

/** Hunt: estimate where the hunted radio is from readings taken while walking. */
export function LocateCard({ r }) {
  const e = useEngine()
  const t = e.t
  const samples = r.samples || []
  const est = locate(samples)
  if (!e.pos && !samples.length) return <div className="note info small">{t('locateNoLoc')}</div>
  return (
    <div className="card card-pad">
      <h3>{t('locateTitle')}</h3>
      <div className="small" style={{ marginBottom: 8 }}>
        {est ? t('locateEst', { r: est.radiusM, n: est.n }) : t('locateNeed', { n: samples.length })}
        {est && e.pos && <> · {t('droneFromYou', { d: fmtM(distM(e.pos, est)) })}</>}
      </div>
      <GeoMap height={260} fitKey={r.key + (est ? ':est' : '')} draw={(L, g) => {
        const pts = []
        for (const s of samples) {
          const k = Math.max(0, Math.min(1, (s.rssi + 100) / 60))
          L.circleMarker([s.lat, s.lon], { radius: 3 + k * 5, stroke: false, fillColor: '#0a8f5a', fillOpacity: 0.25 + k * 0.6 }).addTo(g)
          pts.push([s.lat, s.lon])
        }
        if (est) {
          L.circle([est.lat, est.lon], { radius: est.radiusM, color: '#c62839', weight: 2, fillOpacity: 0.12 }).addTo(g)
          L.circleMarker([est.lat, est.lon], { radius: 6, color: '#c62839', fillColor: '#c62839', fillOpacity: 1 }).addTo(g).bindTooltip(t('locateDevice'))
          pts.push([est.lat, est.lon])
        }
        if (e.pos) { L.circleMarker([e.pos.lat, e.pos.lon], { radius: 7, color: '#0f1a17', weight: 2, fillColor: '#ffffff', fillOpacity: 1 }).addTo(g).bindTooltip(t('mapYou')); pts.push([e.pos.lat, e.pos.lon]) }
        return pts
      }} />
      <div className="tiny faint" style={{ marginTop: 6 }}>{t('locateHint')}</div>
    </div>
  )
}
