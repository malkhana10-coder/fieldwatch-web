import { useState, useMemo } from 'react'
import { useEngine, Icon, Glyph, Bars, Sparkline, Seg, ago, CLASS_ICON } from '../ui.jsx'
import { PALETTE } from '../engine/catalog.js'
import { maskMac } from '../engine/geo.js'
import { CLASSES } from '../i18n.js'
import { Filters } from './Filters.jsx'
import { GeoMap, textNode, mapColors, currentTheme, NIGHT_SHADES } from '../leaflet.jsx'
import { trackerState } from '../engine/intel.js'

/** Signature colour for a radio; red shades only in the night theme. */
export function fleetColor(colorIndex, theme = currentTheme()) {
  return theme === 'night' ? NIGHT_SHADES[colorIndex % NIGHT_SHADES.length] : PALETTE[colorIndex % PALETTE.length]
}

export function radioColor(engine, r) {
  if (r.attention) return 'var(--danger)'
  const f = r.fleetIds[0] && engine.fleetById(r.fleetIds[0])
  return f ? fleetColor(f.colorIndex) : null
}

export function SourcePicker() {
  const e = useEngine()
  const t = e.t
  return (
    <select className="input" style={{ width: 'auto', minHeight: 38 }} value={e.settings.source} disabled={e.running}
      onChange={(ev) => e.set({ source: ev.target.value })} aria-label={t('source')}>
      <option value="demo">{t('sourceDemo')}</option>
      <option value="ble">{t('sourceBle')}</option>
      <option value="bridge">{t('sourceBridge')}</option>
      <option value="replay">{t('sourceReplay')}</option>
    </select>
  )
}

function RadioRow({ r, onOpen, now }) {
  const e = useEngine()
  const t = e.t
  const privacy = e.settings.privacy
  const named = e.named[r.key]
  const fleets = r.fleetIds.map((id) => e.fleetById(id)).filter(Boolean)
  const name = e.displayName(r) || (r.hidden ? t('hidden') : t('unknown'))
  const stale = now - r.lastSeen > 15000
  const tr = e.trend(r)
  return (
    <button className={`radio${r.attention ? ' attn' : ''}${stale ? ' stale' : ''}`} onClick={() => onOpen(r.key)}>
      <Glyph r={r} color={radioColor(e, r)} />
      <div style={{ minWidth: 0 }}>
        <div className="row wrap" style={{ gap: 6 }}>
          <span className={'radio-name ellipsis' + (!e.displayName(r) ? ' muted' : '')} dir="auto">{name}</span>
          {named?.mine && <span className="tag ok">{t('mine')}</span>}
          {e.watchedNetFor(r) && <span className="tag info">{t('watchedTag')}</span>}
          {e.coTravel(r) && !named?.mine && <span className="tag warn">{t('movingWithYou')}</span>}
          {trackerState(r, now)?.separated && <span className="tag attn">{t('tagSeparated')}</span>}
          {r.prevMacs?.length > 0 && <span className="tag" title={t('rotatedHint')}>↻ {r.prevMacs.length}</span>}
          {r.drone?.height != null && <span className="tag info"><span className="nowrap">{r.drone.height} {t('m')}</span></span>}
        </div>
        <div className="radio-meta">
          <span className={'tag ' + (r.kind === 'WIFI' ? 'wifi' : 'ble')}>{r.kind === 'WIFI' ? 'Wi-Fi' : 'BLE'}</span>
          {fleets.slice(0, 2).map((f) => <span key={f.id} className={'tag' + (f.attentionNote ? ' attn' : '')}><bdi>{f.name}</bdi></span>)}
          {!fleets.length && (r.vendor || r.company) && <span className="ellipsis" dir="auto" style={{ maxWidth: 180 }}>{r.vendor || r.company}</span>}
          <span className="mono faint">{maskMac(r.mac, privacy)}</span>
          {r.kind === 'WIFI' && r.channel ? <span className="faint nowrap">{t('chN', { n: r.channel })}</span> : null}
          {r.decoded?.[0] && <span className="faint ellipsis" dir="auto" style={{ maxWidth: 200 }}>{r.decoded[0].label}: {r.decoded[0].value}</span>}
        </div>
      </div>
      <div className="rssi">
        <b className="ltr">{r.rssi}</b>
        <div className="row" style={{ justifyContent: 'flex-end', gap: 4 }}>
          <small style={{ color: tr > 3 ? 'var(--accent)' : tr < -3 ? 'var(--info)' : undefined }}>{tr > 3 ? '▲' : tr < -3 ? '▼' : '•'}</small>
          <Bars rssi={r.rssi} />
        </div>
        <small>{ago(t, r.lastSeen, now)}</small>
      </div>
    </button>
  )
}

function hashAngle(key) {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0
  return ((h >>> 0) % 3600) / 3600 * Math.PI * 2
}

function Radar({ radios, onOpen }) {
  const e = useEngine()
  const t = e.t
  const privacy = e.settings.privacy
  const size = 400
  const c = size / 2
  const rings = [-50, -65, -80, -95]
  const rad = (rssi) => Math.max(0.04, Math.min(1, (-30 - rssi) / 70)) * (c - 14)
  return (
    <div className="radar-wrap">
      <div className="radar-box card card-pad">
        <svg className="radar" viewBox={`0 0 ${size} ${size}`} style={{ direction: 'ltr' }} role="group" aria-label={t('radarList')}>
          <defs>
            <linearGradient id="sweep" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="var(--accent)" stopOpacity="0" />
              <stop offset="1" stopColor="var(--accent)" stopOpacity=".28" />
            </linearGradient>
          </defs>
          {rings.map((v) => (
            <g key={v}>
              <circle cx={c} cy={c} r={rad(v)} fill="none" stroke="var(--radar-line)" />
              <text x={c + 4} y={c - rad(v) + 12} fontSize="10" fill="var(--text-3)">{v}</text>
            </g>
          ))}
          <line x1={c} y1={8} x2={c} y2={size - 8} stroke="var(--radar-line)" />
          <line x1={8} y1={c} x2={size - 8} y2={c} stroke="var(--radar-line)" />
          {e.running && (
            <g style={{ transformOrigin: `${c}px ${c}px`, animation: 'spin 4s linear infinite' }}>
              <path d={`M${c},${c} L${size - 14},${c} A${c - 14},${c - 14} 0 0,0 ${c + (c - 14) * Math.cos(-0.6)},${c + (c - 14) * Math.sin(-0.6)} Z`} fill="url(#sweep)" />
            </g>
          )}
          {radios.slice(0, 160).map((r) => {
            const a = hashAngle(r.key)
            const d = rad(r.rssi)
            const col = radioColor(e, r) || (r.kind === 'WIFI' ? 'var(--wifi)' : 'var(--ble)')
            const x = c + Math.cos(a) * d
            const y = c + Math.sin(a) * d
            const label = (e.displayName(r) || maskMac(r.mac, privacy)) + ' ' + r.rssi + ' dBm'
            return (
              <g key={r.key} className="radar-dot" onClick={() => onOpen(r.key)} style={{ cursor: 'pointer' }} role="button" tabIndex={0} aria-label={label}
                onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onOpen(r.key) } }}>
                {r.attention && <circle cx={x} cy={y} r={11} fill="none" stroke="var(--danger)" strokeWidth="1.5" opacity=".7" />}
                <circle cx={x} cy={y} r={r.fleetIds.length ? 6 : 4} fill={col} opacity={r.fleetIds.length ? 1 : 0.6}>
                  <title>{label}</title>
                </circle>
              </g>
            )
          })}
          <circle cx={c} cy={c} r={4} fill="var(--text)" />
        </svg>
        <div className="tiny faint" style={{ marginTop: 6, textAlign: 'center' }}>
          {t('radarNote')}
        </div>
      </div>
      <div className="radio-list">
        {radios.filter((r) => r.fleetIds.length).slice(0, 12).map((r) => <RadioRow key={r.key} r={r} onOpen={onOpen} now={Date.now()} />)}
      </div>
    </div>
  )
}

function ByClass({ radios, onOpen, now }) {
  const e = useEngine()
  const t = e.t
  const groups = useMemo(() => {
    const m = new Map()
    for (const r of radios) {
      const k = r.cls || (r.kind === 'WIFI' ? '_WIFI' : '_BLE')
      if (!m.has(k)) m.set(k, [])
      m.get(k).push(r)
    }
    const order = [...CLASSES, '_WIFI', '_BLE']
    return [...m.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
  }, [radios])
  const [open, setOpen] = useState({})
  return groups.map(([k, list]) => {
    const label = k === '_WIFI' ? `Wi-Fi · ${t('unmatched')}` : k === '_BLE' ? `BLE · ${t('unmatched')}` : t.cls(k)
    const icon = k === '_WIFI' ? 'wifi' : k === '_BLE' ? 'ble' : CLASS_ICON[k]
    const collapsed = open[k] ?? k.startsWith('_')
    return (
      <div className="class-group" key={k}>
        <button className="class-group-head btn ghost" style={{ width: '100%', justifyContent: 'flex-start', padding: '4px 2px' }} aria-expanded={!collapsed} onClick={() => setOpen({ ...open, [k]: !collapsed })}>
          <Icon name={icon} />
          <span>{label}</span>
          <span className="tag">{list.length}</span>
          {list.some((r) => r.attention) && <span className="tag attn"><Icon name="alert" size={12} /></span>}
          <span className="spacer" />
          <span className="faint" aria-hidden="true">{collapsed ? (t.dir === 'rtl' ? '◂' : '▸') : '▾'}</span>
        </button>
        {!collapsed && <div className="radio-list">{list.map((r) => <RadioRow key={r.key} r={r} onOpen={onOpen} now={now} />)}</div>}
      </div>
    )
  })
}

function Timeline({ radios, onOpen, now }) {
  const e = useEngine()
  const t = e.t
  const span = 3 * 60 * 1000
  return (
    <div className="card timeline">
      {radios.slice(0, 80).map((r) => {
        const data = r.history.filter(([ts]) => ts > now - span)
        return (
          <button key={r.key} className="sig" style={{ width: '100%', background: 'none', border: 0, borderBlockStart: '1px solid var(--line)', textAlign: 'start' }} onClick={() => onOpen(r.key)}>
            <div className="grow" style={{ minWidth: 120, maxWidth: 260 }}>
              <div className="ellipsis" dir="auto" style={{ fontWeight: 600 }}>{e.displayName(r) || <span className="muted">{r.hidden ? t('hidden') : t('unknown')}</span>}</div>
              <div className="tiny faint ellipsis" dir="auto">{r.fleetIds.map((id) => e.fleetById(id)?.name).join(' · ') || r.vendor || r.company || maskMac(r.mac, e.settings.privacy)}</div>
            </div>
            <div className="grow" style={{ direction: 'ltr' }}>
              <svg width="100%" height="30" viewBox="0 0 300 30" preserveAspectRatio="none">
                {data.map(([ts, v], i) => {
                  const x = 300 - ((now - ts) / span) * 300
                  const h = Math.max(2, ((v + 100) / 70) * 28)
                  return <rect key={i} x={x} y={30 - h} width="2.2" height={h} fill={radioColor(e, r) || (r.kind === 'WIFI' ? 'var(--wifi)' : 'var(--ble)')} opacity=".85" />
                })}
              </svg>
            </div>
            <b className="ltr" style={{ width: 36, textAlign: 'end' }}>{r.rssi}</b>
          </button>
        )
      })}
      <div className="tiny faint" style={{ padding: '6px 12px', display: 'flex', justifyContent: 'space-between', direction: 'ltr' }}><span>−3:00</span><span>{t('justNow')}</span></div>
    </div>
  )
}

/** Real hex colour for Leaflet (CSS vars don't work there). */
function mapHex(e, r, C) {
  if (r.attention) return C.attn
  const f = r.fleetIds[0] && e.fleetById(r.fleetIds[0])
  if (f) return fleetColor(f.colorIndex, C.night ? 'night' : 'light')
  return r.kind === 'WIFI' ? C.wifi : C.ble
}

function MapView({ radios, onOpen }) {
  const e = useEngine()
  const t = e.t
  const privacy = e.settings.privacy
  const sit = e.activeSit()
  const hasData = radios.some((r) => r.positions.length) || (sit?.path?.length >= 2) || !!e.pos
  const placed = radios.filter((r) => r.positions.length)

  return (
    <div className="card">
      {hasData
        ? <GeoMap height="52vh" minHeight={340} fitKey="live" label={t('mapLabel')} keys={placed.map((r) => r.key).join(',') + '|' + privacy} draw={(L, lg) => {
          const C = mapColors()
          const path = sit ? [...sit.path] : []
          const pts = []
          if (path.length > 1) {
            L.polyline(path.map((p) => [p.lat, p.lon]), { color: C.path, weight: 3, opacity: 0.8 }).addTo(lg)
            for (const p of path) pts.push([p.lat, p.lon])
          }
          for (const r of placed) {
            const p = r.positions[r.positions.length - 1]
            const col = mapHex(e, r, C)
            const mk = L.circleMarker([p.lat, p.lon], { radius: r.attention ? 8 : 5, color: col, weight: 1.5, fillColor: col, fillOpacity: 0.9 })
            mk.bindPopup(textNode((e.displayName(r) || maskMac(r.mac, privacy)) + ' @ ' + r.rssi + ' dBm'))
            mk.on('click', () => onOpen(r.key))
            mk.addTo(lg)
            pts.push([p.lat, p.lon])
          }
          const you = e.pos || path[path.length - 1]
          if (you) {
            L.circleMarker([you.lat, you.lon], { radius: 7, color: C.youStroke, weight: 2, fillColor: C.youFill, fillOpacity: 1 })
              .addTo(lg).bindPopup(textNode(t('mapYou')))
            pts.push([you.lat, you.lon])
          }
          return pts
        }} />
        : <div className="empty"><Icon name="pin" size={40} /><div>{t('mapNoGps')}</div></div>}
      <div className="tiny faint" style={{ padding: '8px 12px' }}>{t('mapHint')}</div>
    </div>
  )
}

export function Live({ onOpen }) {
  const e = useEngine()
  const t = e.t
  const [showFilters, setShowFilters] = useState(false)
  const now = Date.now()
  const radios = e.visibleRadios(now)
  const all = [...e.radios.values()].filter((r) => now - r.lastSeen < e.settings.filters.maxAge * 1000)
  const f = e.settings.filters
  const filtersOn = f.radio !== 'BOTH' || f.minRssi > -100 || f.onlyMatched || f.onlyAttention || f.hideMine || f.hideRandom || f.classes.length
  const view = e.settings.view
  return (
    <div>
      <div className="controls">
        {e.running
          ? <button className="btn danger solid" onClick={() => e.stop()}><Icon name="stop" size={15} />{t('stop')}</button>
          : <button className="btn primary" onClick={() => e.start()} disabled={!e.ready}><Icon name="play" size={15} />{t('start')}</button>}
        <SourcePicker />
        <span className="spacer" />
        <Seg value={view} label={t('view')} onChange={(v) => e.set({ view: v })} options={[
          { value: 'LIST', icon: 'list', aria: t('viewList'), label: <span className="sr-only-sm">{t('viewList')}</span> },
          { value: 'RADAR', icon: 'radar', aria: t('viewRadar'), label: <span className="sr-only-sm">{t('viewRadar')}</span> },
          { value: 'CLASS', icon: 'grid', aria: t('viewClass'), label: <span className="sr-only-sm">{t('viewClass')}</span> },
          { value: 'TIMELINE', icon: 'chart', aria: t('viewTimeline'), label: <span className="sr-only-sm">{t('viewTimeline')}</span> },
          { value: 'MAP', icon: 'pin', aria: t('viewMap'), label: <span className="sr-only-sm">{t('viewMap')}</span> },
        ]} />
      </div>
      <div className="stats">
        <div className="stat"><b>{all.length}</b><span>{t('radios')}</span></div>
        <div className="stat"><b>{all.filter((r) => r.fleetIds.length).length}</b><span>{t('matched')}</span></div>
        <div className="stat attn"><b>{all.filter((r) => r.attention).length}</b><span>{t('attention')}</span></div>
        <div className="stat"><b><span className="ltr"><span style={{ color: 'var(--wifi)' }}>{all.filter((r) => r.kind === 'WIFI').length}</span><span className="faint"> / </span><span style={{ color: 'var(--ble)' }}>{all.filter((r) => r.kind === 'BLE').length}</span></span></b><span dir="ltr" className="ltr">{t('wifiBle')}</span></div>
      </div>
      <div className="controls">
        <div className="search grow" style={{ minWidth: 200 }}>
          <Icon name="search" size={16} />
          <input className="input" type="search" value={f.q} placeholder={t('search')} aria-label={t('search')} onChange={(ev) => e.setFilters({ q: ev.target.value })} />
        </div>
        <select className="input" style={{ width: 'auto' }} value={e.settings.sort} onChange={(ev) => e.set({ sort: ev.target.value })} aria-label={t('sort')}>
          <option value="STRENGTH">{t('sortStrength')}</option>
          <option value="NEWEST">{t('sortNewest')}</option>
          <option value="FIRST_SEEN">{t('sortFirst')}</option>
          <option value="NAME">{t('sortName')}</option>
          <option value="SIGNATURES">{t('sortSig')}</option>
        </select>
        <button className={'btn' + (filtersOn ? ' primary' : '')} onClick={() => setShowFilters(true)}><Icon name="filter" size={15} />{t('filters')}</button>
      </div>
      {e.flood && !e.flood.open && e.hiddenKeys.size > 0 && (
        <div className="note" style={{ marginBottom: 10 }}>
          <b>{t('floodTitle')}</b> · {t('floodHiddenNote', { n: e.hiddenKeys.size })}
          <button className="btn sm ghost" onClick={() => { e.hiddenKeys.clear(); e.emit() }}>{t('clearFilters')}</button>
        </div>
      )}
      {!radios.length ? (
        <div className="empty card">
          <Icon name={e.running ? 'radar' : 'wifi'} size={40} />
          <div>{all.length ? t('noMatchFilters') : t('noRadios')}</div>
          <div className="small faint" style={{ marginTop: 6, maxWidth: 460, marginInline: 'auto' }}>
            {e.settings.source === 'demo' ? t('sourceDemoHint') : e.settings.source === 'ble' ? t('sourceBleHint') : e.settings.source === 'bridge' ? t('sourceBridgeHint') : t('sourceReplayHint')}
          </div>
          {all.length > 0 && <button className="btn" style={{ marginTop: 12 }} onClick={() => e.resetFilters()}>{t('clearFilters')}</button>}
        </div>
      ) : view === 'RADAR' ? <Radar radios={radios} onOpen={onOpen} />
        : view === 'CLASS' ? <ByClass radios={radios} onOpen={onOpen} now={now} />
          : view === 'TIMELINE' ? <Timeline radios={radios} onOpen={onOpen} now={now} />
            : view === 'MAP' ? <MapView radios={radios} onOpen={onOpen} />
            : <div className="radio-list">{radios.slice(0, 300).map((r) => <RadioRow key={r.key} r={r} onOpen={onOpen} now={now} />)}</div>}
      {showFilters && <Filters onClose={() => setShowFilters(false)} />}
    </div>
  )
}

export { RadioRow, Sparkline }
