import { useState, useMemo, useEffect, useRef } from 'react'
import { useEngine, Icon, Glyph, Bars, Sparkline, Seg, ago, CLASS_ICON } from '../ui.jsx'
import { PALETTE } from '../engine/catalog.js'
import { maskMac } from '../engine/geo.js'
import { CLASSES } from '../i18n.js'
import { Filters } from './Filters.jsx'

export function radioColor(engine, r) {
  if (r.attention) return 'var(--danger)'
  const f = r.fleetIds[0] && engine.fleetById(r.fleetIds[0])
  return f ? PALETTE[f.colorIndex % PALETTE.length] : null
}

export function SourcePicker() {
  const e = useEngine()
  const t = e.t
  return (
    <select className="input" style={{ width: 'auto', minHeight: 38 }} value={e.settings.source} disabled={e.running}
      onChange={(ev) => e.set({ source: ev.target.value })} aria-label={t('source')}>
      <option value="demo">{t('sourceDemo')}</option>
      <option value="ble">{t('sourceBle')}</option>
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
        <div className="row" style={{ gap: 6 }}>
          <span className={'radio-name ellipsis' + (!e.displayName(r) ? ' muted' : '')}>{name}</span>
          {named?.mine && <span className="tag ok">{t('mine')}</span>}
          {e.watchedNetFor(r) && <span className="tag info">{t('watchedTag')}</span>}
          {e.coTravel(r) && !named?.mine && <span className="tag warn">{t('movingWithYou')}</span>}
        </div>
        <div className="radio-meta">
          <span className={'tag ' + (r.kind === 'WIFI' ? 'wifi' : 'ble')}>{r.kind === 'WIFI' ? 'Wi-Fi' : 'BLE'}</span>
          {fleets.slice(0, 2).map((f) => <span key={f.id} className={'tag' + (f.attentionNote ? ' attn' : '')}>{f.name}</span>)}
          {!fleets.length && (r.vendor || r.company) && <span className="ellipsis" style={{ maxWidth: 180 }}>{r.vendor || r.company}</span>}
          <span className="mono faint">{maskMac(r.mac, privacy)}</span>
          {r.kind === 'WIFI' && r.channel ? <span className="faint">ch {r.channel}</span> : null}
          {r.decoded?.[0] && <span className="faint ellipsis" style={{ maxWidth: 200 }}>{r.decoded[0].label}: {r.decoded[0].value}</span>}
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
  const size = 400
  const c = size / 2
  const rings = [-50, -65, -80, -95]
  const rad = (rssi) => Math.max(0.04, Math.min(1, (-30 - rssi) / 70)) * (c - 14)
  return (
    <div className="radar-wrap">
      <div className="radar-box card card-pad">
        <svg className="radar" viewBox={`0 0 ${size} ${size}`} style={{ direction: 'ltr' }}>
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
            return (
              <g key={r.key} onClick={() => onOpen(r.key)} style={{ cursor: 'pointer' }}>
                {r.attention && <circle cx={x} cy={y} r={11} fill="none" stroke="var(--danger)" strokeWidth="1.5" opacity=".7" />}
                <circle cx={x} cy={y} r={r.fleetIds.length ? 6 : 4} fill={col} opacity={r.fleetIds.length ? 1 : 0.6}>
                  <title>{(e.displayName(r) || r.mac) + ' ' + r.rssi + ' dBm'}</title>
                </circle>
              </g>
            )
          })}
          <circle cx={c} cy={c} r={4} fill="var(--text)" />
        </svg>
        <div className="tiny faint" style={{ marginTop: 6, textAlign: 'center' }}>
          {t.lang === 'ar' ? 'المسافة من المركز = قوة الإشارة، وليست اتجاهاً أو مسافة حقيقية.' : 'Distance from center = signal strength, not bearing or true distance.'}
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
    const label = k === '_WIFI' ? `Wi-Fi · ${t.lang === 'ar' ? 'بدون بصمة' : 'unmatched'}` : k === '_BLE' ? `BLE · ${t.lang === 'ar' ? 'بدون بصمة' : 'unmatched'}` : t.cls(k)
    const icon = k === '_WIFI' ? 'wifi' : k === '_BLE' ? 'ble' : CLASS_ICON[k]
    const collapsed = open[k] ?? k.startsWith('_')
    return (
      <div className="class-group" key={k}>
        <button className="class-group-head btn ghost" style={{ width: '100%', justifyContent: 'flex-start', padding: '4px 2px' }} onClick={() => setOpen({ ...open, [k]: !collapsed })}>
          <Icon name={icon} />
          <span>{label}</span>
          <span className="tag">{list.length}</span>
          {list.some((r) => r.attention) && <span className="tag attn"><Icon name="alert" size={12} /></span>}
          <span className="spacer" />
          <span className="faint">{collapsed ? '▸' : '▾'}</span>
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
              <div className="ellipsis" style={{ fontWeight: 600 }}>{e.displayName(r) || <span className="muted">{r.hidden ? t('hidden') : t('unknown')}</span>}</div>
              <div className="tiny faint ellipsis">{r.fleetIds.map((id) => e.fleetById(id)?.name).join(' · ') || r.vendor || r.company || maskMac(r.mac, e.settings.privacy)}</div>
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
      <div className="tiny faint" style={{ padding: '6px 12px', display: 'flex', justifyContent: 'space-between' }}><span>−3:00</span><span>{t('justNow')}</span></div>
    </div>
  )
}

/** Real hex colour for Leaflet (CSS vars don't work there). */
function mapHex(e, r) {
  if (r.attention) return '#c62839'
  const f = r.fleetIds[0] && e.fleetById(r.fleetIds[0])
  if (f) return PALETTE[f.colorIndex % PALETTE.length]
  return r.kind === 'WIFI' ? '#1a6fb5' : '#7a4fd6'
}

function MapView({ radios, onOpen }) {
  const e = useEngine()
  const t = e.t
  const mapRef = useRef(null)
  const map = useRef(null)
  const layer = useRef(null)
  const fitted = useRef(false)

  // Leaflet is bundled and loaded on first use, so the app shell works offline
  // (only the OpenStreetMap tiles need the network).
  const [L, setL] = useState(null)
  useEffect(() => {
    let live = true
    Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')])
      .then(([mod]) => { if (live) setL(mod.default || mod) })
      .catch(() => { /* offline before first load: the map card stays empty */ })
    return () => { live = false }
  }, [])

  const hasData = radios.some((r) => r.positions.length) || (e.activeSit()?.path?.length >= 2) || !!e.pos

  // init the OpenStreetMap once Leaflet is loaded and the map container exists
  useEffect(() => {
    if (!L || !hasData || !mapRef.current || map.current) return
    const m = L.map(mapRef.current, { zoomControl: true })
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; OpenStreetMap contributors',
    }).addTo(m)
    layer.current = L.layerGroup().addTo(m)
    map.current = m
    return () => { try { m.remove() } catch { /* ignore */ } map.current = null; layer.current = null; fitted.current = false }
  }, [L, hasData])

  // redraw path + markers each render; auto-fit only the first time
  useEffect(() => {
    if (!map.current || !layer.current) return
    const lg = layer.current
    lg.clearLayers()
    const sit = e.activeSit()
    const path = sit ? [...sit.path] : []
    const marks = []
    for (const r of radios) {
      if (r.positions.length) {
        const p = r.positions[r.positions.length - 1]
        marks.push({ lat: p.lat, lon: p.lon, r })
      }
    }
    if (path.length > 1) {
      L.polyline(path.map((p) => [p.lat, p.lon]), { color: '#0a8f5a', weight: 3, opacity: 0.8 }).addTo(lg)
    }
    for (const p of marks) {
      const col = mapHex(e, p.r)
      const mk = L.circleMarker([p.lat, p.lon], {
        radius: p.r.attention ? 8 : 5, color: p.r.attention ? '#c62839' : col, weight: 1.5,
        fillColor: p.r.attention ? '#c62839' : col, fillOpacity: 0.9,
      })
      mk.bindPopup((e.displayName(p.r) || p.r.mac) + ' @ ' + p.r.rssi + ' dBm')
      mk.on('click', () => onOpen(p.r.key))
      mk.addTo(lg)
    }
    const you = e.pos || path[path.length - 1]
    if (you) {
      L.circleMarker([you.lat, you.lon], { radius: 7, color: '#0f1a17', weight: 2, fillColor: '#ffffff', fillOpacity: 1 })
        .addTo(lg).bindPopup(t('mapYou'))
    }
    const all = [...path, ...marks]
    if (!fitted.current) {
      if (all.length >= 2) map.current.fitBounds(L.latLngBounds(all.map((p) => [p.lat, p.lon])), { padding: [36, 36] })
      else if (you) map.current.setView([you.lat, you.lon], 15)
      if (all.length >= 2 || you) fitted.current = true
    }
  })

  return (
    <div className="card">
      {hasData
        ? <div ref={mapRef} style={{ height: '52vh', minHeight: 340, borderRadius: 'var(--radius)' }} />
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
        <Seg value={view} onChange={(v) => e.set({ view: v })} options={[
          { value: 'LIST', icon: 'list', label: <span className="hide-sm">{t('viewList')}</span> },
          { value: 'RADAR', icon: 'radar', label: <span className="hide-sm">{t('viewRadar')}</span> },
          { value: 'CLASS', icon: 'grid', label: <span className="hide-sm">{t('viewClass')}</span> },
          { value: 'TIMELINE', icon: 'chart', label: <span className="hide-sm">{t('viewTimeline')}</span> },
          { value: 'MAP', icon: 'pin', label: <span className="hide-sm">{t('viewMap')}</span> },
        ]} />
      </div>
      <div className="stats">
        <div className="stat"><b>{all.length}</b><span>{t('radios')}</span></div>
        <div className="stat"><b>{all.filter((r) => r.fleetIds.length).length}</b><span>{t('matched')}</span></div>
        <div className="stat attn"><b>{all.filter((r) => r.attention).length}</b><span>{t('attention')}</span></div>
        <div className="stat"><b><span style={{ color: 'var(--wifi)' }}>{all.filter((r) => r.kind === 'WIFI').length}</span><span className="faint"> / </span><span style={{ color: 'var(--ble)' }}>{all.filter((r) => r.kind === 'BLE').length}</span></b><span>Wi-Fi / BLE</span></div>
      </div>
      <div className="controls">
        <div className="search grow" style={{ minWidth: 200 }}>
          <Icon name="search" size={16} />
          <input className="input" value={f.q} placeholder={t('search')} onChange={(ev) => e.setFilters({ q: ev.target.value })} />
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
          <b>{t('floodTitle')}</b> · {e.hiddenKeys.size} {t.lang === 'ar' ? 'عنواناً مخفياً من العرض المباشر' : 'addresses hidden from Live'}
          <button className="btn sm ghost" onClick={() => { e.hiddenKeys.clear(); e.emit() }}>{t('clearFilters')}</button>
        </div>
      )}
      {!radios.length ? (
        <div className="empty card">
          <Icon name={e.running ? 'radar' : 'wifi'} size={40} />
          <div>{all.length ? t('noMatchFilters') : t('noRadios')}</div>
          <div className="small faint" style={{ marginTop: 6, maxWidth: 460, marginInline: 'auto' }}>
            {e.settings.source === 'demo' ? t('sourceDemoHint') : e.settings.source === 'ble' ? t('sourceBleHint') : t('sourceReplayHint')}
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
