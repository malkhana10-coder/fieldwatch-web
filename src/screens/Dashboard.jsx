import { useEngine, Icon, Glyph, Bars, ago, CLASS_ICON } from '../ui.jsx'
import { radioColor } from './Live.jsx'
import { CLASSES } from '../i18n.js'
import { maskMac } from '../engine/geo.js'

function Bar({ label, n, max, color }) {
  return (
    <div className="bar-row">
      <span className="ellipsis" title={label}>{label}</span>
      <div className="bar-track"><div className="bar-fill" style={{ width: `${(n / Math.max(1, max)) * 100}%`, background: color }} /></div>
      <b style={{ textAlign: 'end' }}>{n}</b>
    </div>
  )
}

export function Dashboard({ onOpen }) {
  const e = useEngine()
  const t = e.t
  const now = Date.now()
  const maxAge = e.settings.filters.maxAge * 1000
  const radios = [...e.radios.values()]
  const active = radios.filter((r) => now - r.lastSeen < maxAge)
  const matched = active.filter((r) => r.fleetIds.length).length
  const attnList = active.filter((r) => r.attention)
  const vendors = new Map()
  for (const r of active) { const v = r.vendor || r.company; if (v) vendors.set(v, (vendors.get(v) || 0) + 1) }
  const topVendors = [...vendors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)

  // by class
  const byClass = new Map()
  for (const r of active) {
    const k = r.cls || (r.kind === 'WIFI' ? '_WIFI' : '_BLE')
    byClass.set(k, (byClass.get(k) || 0) + 1)
  }
  const classRows = [...byClass.entries()].sort((a, b) => CLASSES.indexOf(a[0]) - CLASSES.indexOf(b[0])).filter(([k]) => k !== '_WIFI' && k !== '_BLE')
  const maxClass = classRows[0]?.[1] || 1

  // channels (Wi-Fi only)
  const chans = new Map()
  for (const r of active) if (r.kind === 'WIFI' && r.channel) chans.set(r.channel, (chans.get(r.channel) || 0) + 1)
  const chanRows = [...chans.entries()].sort((a, b) => a[0] - b[0])
  const maxChan = chanRows.length ? Math.max(...chanRows.map((x) => x[1])) : 1

  // activity: log rows per 30s bucket, last 5 min
  const SPAN = 5 * 60 * 1000, BIN = 30 * 1000, N = 10
  const bins = new Array(N).fill(0)
  for (const row of e.log) { const i = Math.floor((row.ts - (now - SPAN)) / BIN); if (i >= 0 && i < N) bins[i]++ }
  const maxBin = Math.max(1, ...bins)

  const sit = e.activeSit()
  const track = e.trackingAssessment(now)
  const hidden = e.hiddenDevices(now)
  const empty = !radios.length && !e.log.length

  return (
    <div className="stack">
      <div className="hero">
        <div className="row wrap">
          <div className="grow">
            <div style={{ fontSize: 20, fontWeight: 700 }}>{t('welcome')}</div>
            <div className="small muted">{t('tagline')}</div>
          </div>
          <button className="btn primary" onClick={() => e.running ? e.stop() : e.start()} disabled={!e.ready}>
            <Icon name={e.running ? 'stop' : 'play'} size={15} />{e.running ? t('stop') : t('start')}
          </button>
        </div>
      </div>

      {empty ? (
        <div className="empty card">
          <Icon name="radar" size={40} />
          <div>{t('dashNoData')}</div>
        </div>
      ) : (
        <>
          <div className="stats">
            <div className="stat"><b>{active.length}</b><span>{t('dashActive')}</span></div>
            <div className="stat"><b>{matched}</b><span>{t('matched')}</span></div>
            <div className="stat attn"><b>{attnList.length}</b><span>{t('attention')}</span></div>
            <div className="stat"><b>{t.num(e.stats.packets)}</b><span>{t('dashPackets')}</span></div>
          </div>

          <div className="grid-2">
            <div className="card card-pad">
              <h3>{t('dashByClass')}</h3>
              {classRows.map(([k, n]) => (
                <Bar key={k} label={k.startsWith('_') ? k : t.cls(k)} n={n} max={maxClass} color="var(--accent)" />
              ))}
              <div className="row wrap" style={{ marginTop: 6, gap: 6 }}>
                {byClass.has('_WIFI') && <span className="tag wifi">Wi-Fi {byClass.get('_WIFI')}</span>}
                {byClass.has('_BLE') && <span className="tag ble">BLE {byClass.get('_BLE')}</span>}
                {!classRows.length && !byClass.has('_WIFI') && !byClass.has('_BLE') && <span className="faint">—</span>}
              </div>
            </div>
            <div className="card card-pad">
              <h3>{t('dashTopVendors')}</h3>
              {topVendors.map(([v, n]) => <Bar key={v} label={v} n={n} max={topVendors[0]?.[1] || 1} color="var(--info)" />)}
              {!topVendors.length && <span className="faint">—</span>}
            </div>
          </div>

          <div className="grid-2">
            <div className="card card-pad">
              <h3>{t('dashChannels')}</h3>
              {chanRows.length ? (
                <svg viewBox={`0 0 ${chanRows.length * 34} 110`} style={{ width: '100%', height: 120, direction: 'ltr' }}>
                  {chanRows.map(([ch, n], i) => {
                    const h = (n / maxChan) * 80
                    return <g key={ch}><rect x={i * 34 + 6} y={90 - h} width="22" height={h} rx="3" fill="var(--wifi)" /><text x={i * 34 + 17} y="104" fontSize="10" textAnchor="middle" fill="var(--text-2)">{ch}</text><text x={i * 34 + 17} y={86 - h} fontSize="10" textAnchor="middle" fill="var(--text-2)">{n}</text></g>
                  })}
                </svg>
              ) : <span className="faint">—</span>}
            </div>
            <div className="card card-pad">
              <h3>{t('dashActivity')}</h3>
              <div className="row" style={{ alignItems: 'flex-end', height: 120, gap: 4, direction: 'ltr', justifyContent: 'flex-end' }}>
                {bins.map((n, i) => (
                  <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <div style={{ width: '100%', maxWidth: 26, height: Math.max(2, (n / maxBin) * 80), background: 'var(--accent)', borderRadius: 3, opacity: n ? 1 : 0.25 }} title={String(n)} />
                  </div>
                ))}
              </div>
              <div className="tiny faint row" style={{ justifyContent: 'space-between', direction: 'ltr' }}><span>−5:00</span><span>{t('dashLastMin')}</span></div>
            </div>
          </div>

          <div className="card card-pad">
            <h3>{t('dashAttentionList')} ({attnList.length})</h3>
            {attnList.length ? attnList.map((r) => (
              <button key={r.key} className="sig" style={{ width: '100%', background: 'none', border: 0, borderBlockStart: '1px solid var(--line)', textAlign: 'start' }} onClick={() => onOpen(r.key)}>
                <Glyph r={r} color={radioColor(e, r)} />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="row" style={{ gap: 6 }}>
                    <b className="ellipsis">{e.displayName(r) || <span className="muted">{t('unknown')}</span>}</b>
                    <span className="tag attn">{r.fleetIds.map((id) => e.fleetById(id)?.name).filter(Boolean).join(' + ')}</span>
                  </div>
                  <div className="tiny faint ellipsis">{maskMac(r.mac, e.settings.privacy)} · {r.kind} · {ago(t, r.lastSeen, now)}</div>
                </div>
                <div className="rssi"><b className="ltr">{r.rssi}</b><Bars rssi={r.rssi} /></div>
              </button>
            )) : <span className="faint">—</span>}
          </div>

          <div className="card card-pad">
            <h3>{t('trackTitle')}</h3>
            <div className={'note ' + (track.level === 'HIGH' ? '' : track.level === 'MEDIUM' ? 'info' : 'ok')}>
              <b>{track.level === 'HIGH' ? t('trackHigh') : track.level === 'MEDIUM' ? t('trackMedium') : t('trackLow')}</b>
              {track.level !== 'LOW' && <span className="small"> · {track.reasons.length}</span>}
            </div>
            {track.reasons.length ? track.reasons.map(({ r, why }) => (
              <button key={r.key} className="sig" style={{ width: '100%', background: 'none', border: 0, borderBlockStart: '1px solid var(--line)', textAlign: 'start' }} onClick={() => onOpen(r.key)}>
                <Glyph r={r} color={radioColor(e, r)} />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="row" style={{ gap: 6 }}><b className="ellipsis">{e.displayName(r) || maskMac(r.mac, e.settings.privacy)}</b><span className="tag warn">{t(why)}</span></div>
                  <div className="tiny faint ellipsis">{r.fleetIds.map((id) => e.fleetById(id)?.name).filter(Boolean).join(' + ') || r.vendor || r.kind}</div>
                </div>
                <div className="rssi"><b className="ltr">{r.rssi}</b><Bars rssi={r.rssi} /></div>
              </button>
            )) : <span className="faint small">{t('trackNone')}</span>}
          </div>

          <div className="card card-pad">
            <h3>{t('hiddenDevices')} ({hidden.length})</h3>
            <div className="small muted" style={{ marginBottom: 6 }}>{t('hiddenDevicesHint')}</div>
            {hidden.length ? hidden.map(({ r, why }) => (
              <button key={r.key} className="sig" style={{ width: '100%', background: 'none', border: 0, borderBlockStart: '1px solid var(--line)', textAlign: 'start' }} onClick={() => onOpen(r.key)}>
                <Glyph r={r} color={radioColor(e, r)} />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="row" style={{ gap: 6 }}><b className="ellipsis">{r.hidden ? t('hidden') : maskMac(r.mac, e.settings.privacy)}</b><span className="tag attn">{t(why)}</span></div>
                  <div className="tiny faint ellipsis">{r.kind} · {r.vendor || t('unknown')} · {ago(t, r.lastSeen, now)}</div>
                </div>
                <div className="rssi"><b className="ltr">{r.rssi}</b><Bars rssi={r.rssi} /></div>
              </button>
            )) : <span className="faint small">—</span>}
          </div>

          {(sit || radios.length > 0) && (
            <div className="tiny faint" style={{ textAlign: 'center' }}>
              {t('radios')}: {radios.length} · {t('dashVendors')}: {vendors.size} · {t('log')}: {t.num(e.log.length)}
              {sit ? ` · ${t('sitRunning')}: ${Object.keys(sit.radios).length}` : ''}
            </div>
          )}
        </>
      )}
    </div>
  )
}
