import { useEffect, useRef, useState } from 'react'
import { useEngine, Icon, Glyph, Sparkline, Switch } from '../ui.jsx'
import { maskMac } from '../engine/geo.js'
import { radioColor } from './Live.jsx'
import { LocateCard } from './Intel.jsx'

export function Hunt() {
  const e = useEngine()
  const t = e.t
  const r = e.huntKey ? e.radios.get(e.huntKey) : null
  const [tone, setTone] = useState(true)
  const peak = useRef({ key: null, v: -120 })
  const now = Date.now()

  if (r && peak.current.key !== r.key) peak.current = { key: r.key, v: -120 }
  if (r) peak.current.v = Math.max(peak.current.v, r.rssi)

  // Geiger-style clicks: faster as the smoothed signal rises.
  useEffect(() => {
    if (!r || !tone || !e.running) return
    let stop = false
    let timer
    const loop = () => {
      if (stop) return
      const cur = e.radios.get(e.huntKey)
      const live = cur && Date.now() - cur.lastSeen < 6000
      const v = live ? e.avgRssi(cur, 4000) : -110
      const norm = Math.max(0, Math.min(1, (v + 100) / 60))
      if (live) e.beep(400 + norm * 900, 0.03, 1, 0.05)
      timer = setTimeout(loop, live ? 1100 - norm * 1000 : 800)
    }
    loop()
    return () => { stop = true; clearTimeout(timer) }
  }, [r?.key, tone, e.running])

  const candidates = e.visibleRadios(now).slice(0, 30)

  if (!r) {
    return (
      <div className="stack">
        <div className="note info">{t('huntPick')}</div>
        <div className="radio-list">
          {candidates.map((c) => (
            <button key={c.key} className="radio" onClick={() => { e.huntKey = c.key; e.emit() }}>
              <Glyph r={c} color={radioColor(e, c)} />
              <div style={{ minWidth: 0 }}>
                <div className="radio-name ellipsis">{e.displayName(c) || <span className="muted">{c.hidden ? t('hidden') : t('unknown')}</span>}</div>
                <div className="radio-meta"><span className="mono faint">{maskMac(c.mac, e.settings.privacy)}</span>{c.fleetIds[0] && <span className="tag">{e.fleetById(c.fleetIds[0])?.name}</span>}</div>
              </div>
              <div className="rssi"><b className="ltr">{c.rssi}</b></div>
            </button>
          ))}
        </div>
      </div>
    )
  }

  const live = now - r.lastSeen < 6000
  const avg = e.avgRssi(r, 4000)
  const tr = e.trend(r)
  const state = !live ? 'lost' : tr > 2 ? 'hot' : tr < -2 ? 'cold' : 'steady'
  const pct = Math.max(0, Math.min(1, (avg + 100) / 65))
  const R = 110
  const C = 2 * Math.PI * R
  return (
    <div className="stack">
      <div className="card card-pad">
        <div className="row">
          <Glyph r={r} color={radioColor(e, r)} />
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="ellipsis" style={{ fontWeight: 700 }}>{e.displayName(r) || (r.hidden ? t('hidden') : t('unknown'))}</div>
            <div className="small muted mono">{maskMac(r.mac, e.settings.privacy)}</div>
          </div>
          <button className="btn sm" onClick={() => { e.huntKey = null; e.emit() }}><Icon name="x" size={14} />{t('close')}</button>
        </div>
        <div className="hunt-gauge">
          <svg width="260" height="260" viewBox="0 0 260 260" style={{ direction: 'ltr' }}>
            <circle cx="130" cy="130" r={R} fill="none" stroke="var(--surface-2)" strokeWidth="18" />
            <circle cx="130" cy="130" r={R} fill="none" stroke={state === 'hot' ? 'var(--danger)' : state === 'cold' ? 'var(--info)' : 'var(--accent)'} strokeWidth="18" strokeLinecap="round"
              strokeDasharray={`${C * pct} ${C}`} transform="rotate(-90 130 130)" style={{ transition: 'stroke-dasharray .5s' }} />
            <text x="130" y="138" textAnchor="middle" fontSize="60" fontWeight="800" fill="var(--text)">{live ? Math.round(avg) : '—'}</text>
            <text x="130" y="170" textAnchor="middle" fontSize="14" fill="var(--text-2)">dBm</text>
          </svg>
          <div className={'hunt-state ' + state}>
            {state === 'hot' ? '▲ ' + t('huntHotter') : state === 'cold' ? '▼ ' + t('huntColder') : state === 'lost' ? t('huntLost') : '• ' + t('huntSteady')}
          </div>
          <div className="small muted">{t('huntPeak')}: <span className="ltr">{peak.current.v}</span> dBm · {t('rssi')}: <span className="ltr">{r.rssi}</span></div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <Sparkline data={r.history.slice(-90)} width={320} height={60} color={radioColor(e, r) || 'var(--accent)'} />
        </div>
      </div>
      <LocateCard r={r} />
      <div className="card">
        <div className="setting">
          <div className="grow">{t('huntTone')}</div>
          <Switch checked={tone} onChange={setTone} />
        </div>
      </div>
      {!e.running && <button className="btn primary big" onClick={() => e.start()}><Icon name="play" />{t('start')}</button>}
      <div className="note info small">{t('huntTip')}</div>
    </div>
  )
}
