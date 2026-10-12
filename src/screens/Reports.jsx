import { useState } from 'react'
import { useEngine, Icon, Sheet, fmtDur, copyText, ConfirmButton } from '../ui.jsx'
import { debrief, compareSits, sitCsv, sitGpx, sitKml, sitWigle, logCsv, aiPrompt } from '../engine/reports.js'
import { download, inViewer } from '../engine/storage.js'
import { maskMac } from '../engine/geo.js'

function Bar({ label, n, max, color }) {
  return (
    <div className="bar-row">
      <span className="ellipsis">{label}</span>
      <div className="bar-track"><div className="bar-fill" style={{ width: `${(n / Math.max(1, max)) * 100}%`, background: color }} /></div>
      <b style={{ textAlign: 'end' }}>{n}</b>
    </div>
  )
}

function PathPlot({ sit, privacy }) {
  const e = useEngine()
  const t = e.t
  const pts = [...sit.path]
  const marks = Object.values(sit.radios).filter((r) => r.pts.length && r.fleetIds.some((id) => e.fleetById(id)?.attentionNote))
  const all = [...pts, ...marks.flatMap((r) => r.pts)]
  if (all.length < 2) return <div className="empty small" style={{ padding: 24 }}><Icon name="pin" size={28} /><div>{t('noGps')}</div></div>
  const lats = all.map((p) => p.lat)
  const lons = all.map((p) => p.lon)
  const [a, b, c, d] = [Math.min(...lats), Math.max(...lats), Math.min(...lons), Math.max(...lons)]
  const W = 600
  const H = 260
  const pad = 18
  const sx = (W - 2 * pad) / Math.max(1e-9, d - c)
  const sy = (H - 2 * pad) / Math.max(1e-9, b - a)
  const s = Math.min(sx, sy * 1)
  const X = (lon) => pad + (lon - c) * s + (W - 2 * pad - (d - c) * s) / 2
  const Y = (lat) => H - pad - (lat - a) * s - (H - 2 * pad - (b - a) * s) / 2
  return (
    <svg className="path-svg" viewBox={`0 0 ${W} ${H}`} style={{ direction: 'ltr' }}>
      <path d={pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.lon).toFixed(1)},${Y(p.lat).toFixed(1)}`).join('')} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinejoin="round" strokeDasharray="1 0" />
      {pts[0] && <circle cx={X(pts[0].lon)} cy={Y(pts[0].lat)} r="6" fill="var(--surface)" stroke="var(--accent)" strokeWidth="2" />}
      {pts.length > 1 && <circle cx={X(pts[pts.length - 1].lon)} cy={Y(pts[pts.length - 1].lat)} r="6" fill="var(--accent)" />}
      {marks.map((r) => r.pts.map((p, i) => <path key={r.key + i} d={`M${X(p.lon)},${Y(p.lat) - 6} l6,6 -6,6 -6,-6z`} fill="var(--danger)" opacity=".85"><title>{r.name || r.mac}</title></path>))}
      {privacy && <text x={W - 10} y={18} textAnchor="end" fontSize="11" fill="var(--text-3)">privacy</text>}
    </svg>
  )
}

function Debrief({ sit, onClose }) {
  const e = useEngine()
  const t = e.t
  const privacy = e.settings.privacy
  const d = debrief(sit, e)
  const [prompt, setPrompt] = useState(null)
  const max = d.byClass[0]?.[1] || 1
  const fname = sit.name.replace(/[^\w؀-ۿ-]+/g, '_').slice(0, 40)
  return (
    <Sheet title={`${t('debrief')} · ${sit.name}`} onClose={onClose} className="debrief">
      <div className="stack">
        <div className="row wrap no-print">
          <button className="btn sm" onClick={() => download(fname + '.csv', sitCsv(sit, e, privacy), 'text/csv')}><Icon name="download" size={14} />{t('exportCsv')}</button>
          <button className="btn sm" onClick={() => download(fname + '.json', JSON.stringify(sit, null, 1), 'application/json')}><Icon name="download" size={14} />{t('exportJson')}</button>
          <button className="btn sm" disabled={privacy} onClick={() => download(fname + '.gpx', sitGpx(sit, e), 'application/gpx+xml')}>{t('exportGpx')}</button>
          <button className="btn sm" disabled={privacy} onClick={() => download(fname + '.kml', sitKml(sit, e), 'application/vnd.google-earth.kml+xml')}>{t('exportKml')}</button>
          <button className="btn sm" disabled={privacy} onClick={() => download(fname + '-wigle.csv', sitWigle(sit), 'text/csv')}>{t('exportWigle')}</button>
          {!inViewer && <button className="btn sm" onClick={() => window.print()}><Icon name="file" size={14} />{t('printPdf')}</button>}
          <button className="btn sm" onClick={() => setPrompt(aiPrompt(sit, e, privacy))}><Icon name="sparkle" size={14} />{t('aiExport')}</button>
        </div>
        {privacy && <div className="note small">{t('privacyHint')}</div>}
        <div className="stats">
          <div className="stat"><b>{d.total}</b><span>{t('radios')}</span></div>
          <div className="stat"><b>{d.matched}</b><span>{t('matched')}</span></div>
          <div className="stat attn"><b>{d.attention.length}</b><span>{t('attention')}</span></div>
          <div className="stat"><b>{fmtDur(d.duration)}</b><span>{t('duration')}</span></div>
        </div>
        <div className="small muted">
          {t.date(sit.start)} → {sit.end ? t.date(sit.end) : t('sitRunning')} · Wi-Fi {d.wifi} · BLE {d.ble} · {t('path')} {Math.round(d.pathLen)} {t('m')}
          {d.floods.length > 0 && <> · {t('floodTitle')}: {d.floods.length} ({d.floodHidden})</>}
        </div>
        <div className="card card-pad"><h3>{t('path')}</h3><PathPlot sit={sit} privacy={privacy} /></div>
        <div className="grid-2">
          <div className="card card-pad"><h3>{t('byClass')}</h3>{d.byClass.map(([c, n]) => <Bar key={c} label={t.cls(c)} n={n} max={max} />)}{!d.byClass.length && <span className="faint">—</span>}</div>
          <div className="card card-pad"><h3>{t('topSignatures')}</h3>{d.bySig.map(([s, n]) => <Bar key={s} label={s} n={n} max={d.bySig[0][1]} color="var(--info)" />)}{!d.bySig.length && <span className="faint">—</span>}</div>
        </div>
        {d.byChannel.length > 0 && (
          <div className="card card-pad"><h3>{t('byChannel')}</h3>
            <svg viewBox={`0 0 ${d.byChannel.length * 34} 110`} style={{ width: '100%', height: 120, direction: 'ltr' }}>
              {d.byChannel.map(([ch, n], i) => {
                const m = Math.max(...d.byChannel.map((x) => x[1]))
                const h = (n / m) * 80
                return <g key={ch}><rect x={i * 34 + 6} y={90 - h} width="22" height={h} rx="3" fill="var(--wifi)" /><text x={i * 34 + 17} y="104" fontSize="10" textAnchor="middle" fill="var(--text-2)">{ch}</text><text x={i * 34 + 17} y={86 - h} fontSize="10" textAnchor="middle" fill="var(--text-2)">{n}</text></g>
              })}
            </svg>
          </div>
        )}
        <div className="card card-pad">
          <h3>{t('attention')} ({d.attention.length})</h3>
          {d.attention.map(({ r, fleets }) => (
            <div key={r.key} style={{ padding: '8px 0', borderBlockEnd: '1px solid var(--line)' }}>
              <div className="row wrap"><b>{fleets.map((f) => f.name).join(' + ')}</b><span className={'tag ' + (r.kind === 'WIFI' ? 'wifi' : 'ble')}>{r.kind}</span><span className="mono small faint">{maskMac(r.mac, privacy)}</span></div>
              <div className="small muted">{r.name || '—'} · max <span className="ltr">{r.maxRssi}</span> dBm · {fmtDur(r.last - r.first)} · {t.time(r.first)}</div>
            </div>
          ))}
          {!d.attention.length && <span className="faint">—</span>}
        </div>
        <div className="card card-pad">
          <h3>{t('coTravel')} ({d.coTravel.length})</h3>
          <div className="small muted" style={{ marginBottom: 6 }}>{t('coTravelHint', { m: 200 })}</div>
          {d.coTravel.map(({ r, spread }) => (
            <div key={r.key} className="row wrap" style={{ padding: '6px 0', borderBlockEnd: '1px solid var(--line)' }}>
              <b>{r.name || (r.fleetIds.map(d.fleetName).join('+')) || '—'}</b>
              <span className="mono small faint">{maskMac(r.mac, privacy)}</span>
              <span className="tag warn">{Math.round(spread)} {t('m')}</span>
              <span className="small muted">{fmtDur(r.last - r.first)}</span>
            </div>
          ))}
          {!d.coTravel.length && <span className="faint">—</span>}
          {d.mine.length > 0 && <div className="small muted" style={{ marginTop: 8 }}>{t('mine')}: {d.mine.map((r) => e.named[r.key]?.name || r.name || r.mac).join(', ')}</div>}
        </div>
      </div>
      {prompt && (
        <Sheet title={t('aiExport')} onClose={() => setPrompt(null)} className="dialog" actions={<button className="btn sm primary" onClick={async () => { await copyText(prompt); e.toast(t('copied')) }}><Icon name="copy" size={14} />{t('share')}</button>}>
          <div className="note info small" style={{ marginBottom: 10 }}>{t('aiExportHint')}</div>
          <pre className="prompt">{prompt}</pre>
        </Sheet>
      )}
    </Sheet>
  )
}

function Compare({ a, b, onClose }) {
  const e = useEngine()
  const t = e.t
  const c = compareSits(a, b)
  const privacy = e.settings.privacy
  const col = (title, list, cls) => (
    <div className="card card-pad">
      <h3>{title} ({list.length})</h3>
      {list.sort((x, y) => (y.fleetIds.length - x.fleetIds.length)).slice(0, 100).map((r) => (
        <div key={r.key} className="row small" style={{ padding: '3px 0' }}>
          <span className={'tag ' + (r.kind === 'WIFI' ? 'wifi' : 'ble')}>{r.kind}</span>
          <span className="ellipsis grow">{r.name || r.fleetIds.map((id) => e.fleetById(id)?.name).join('+') || <span className="mono faint">{maskMac(r.mac, privacy)}</span>}</span>
          {r.fleetIds.some((id) => e.fleetById(id)?.attentionNote) && <span className={'tag ' + cls}>!</span>}
        </div>
      ))}
    </div>
  )
  return (
    <Sheet title={`${t('compare')}: ${a.name} ⇄ ${b.name}`} onClose={onClose}>
      <div className="stack">
        {col(t('newInB'), c.onlyB, 'attn')}
        {col(t('inBoth'), c.both, 'warn')}
        {col(t('goneInB'), c.onlyA, '')}
      </div>
    </Sheet>
  )
}

export function Reports() {
  const e = useEngine()
  const t = e.t
  const [open, setOpen] = useState(null)
  const [sel, setSel] = useState([])
  const [cmp, setCmp] = useState(null)
  const [renaming, setRenaming] = useState(null)
  const active = e.activeSit()
  const toggleSel = (id) => setSel(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel.slice(-1), id])
  return (
    <div className="stack">
      <div className="hero">
        <div className="row wrap">
          <div className="grow">
            <div style={{ fontSize: 20, fontWeight: 700 }}>{t('sits')}</div>
            <div className="small muted" style={{ maxWidth: 560 }}>{t('sitHint')}</div>
          </div>
          {active
            ? <button className="btn danger solid" onClick={() => e.endSit()}><Icon name="stop" size={15} />{t('endSit')}</button>
            : <button className="btn primary" onClick={() => { e.startSit(); if (!e.running) e.start() }}><Icon name="play" size={15} />{t('startSit')}</button>}
        </div>
        {active && (
          <div className="row wrap" style={{ marginTop: 10 }}>
            <span className="dot on" />
            <b>{t('sitRunning')}</b>
            <span className="muted">{fmtDur(Date.now() - active.start)} · {Object.keys(active.radios).length} {t('radios')} · {active.path.length} {t('points')}</span>
            <button className="btn sm" onClick={() => setOpen(active.id)}>{t('debrief')}</button>
          </div>
        )}
      </div>

      {sel.length === 2 && (
        <div className="note info row"><span className="grow">{t('pickTwo')} ✓</span><button className="btn sm primary" onClick={() => setCmp(sel.map((id) => e.sits.find((s) => s.id === id)).sort((x, y) => x.start - y.start))}>{t('compare')}</button></div>
      )}

      <div className="card">
        {!e.sits.length && <div className="empty">{t('sitNone')}</div>}
        {e.sits.map((s) => {
          const n = Object.keys(s.radios).length
          const attn = Object.values(s.radios).filter((r) => r.fleetIds.some((id) => e.fleetById(id)?.attentionNote)).length
          return (
            <div key={s.id} className="sig">
              <input type="checkbox" checked={sel.includes(s.id)} onChange={() => toggleSel(s.id)} aria-label={t('compare')} style={{ accentColor: 'var(--accent)', width: 18, height: 18 }} />
              {renaming?.id === s.id ? (
                <form className="grow row" onSubmit={(ev) => { ev.preventDefault(); if (renaming.name.trim()) e.renameSit(s.id, renaming.name.trim()); setRenaming(null) }}>
                  <input id={'rename-' + s.id} className="input grow" autoFocus value={renaming.name} aria-label={t('sitName')} onChange={(ev) => setRenaming({ ...renaming, name: ev.target.value })} />
                  <button className="btn sm primary" type="submit">{t('save')}</button>
                </form>
              ) : (
              <button className="grow" style={{ background: 'none', border: 0, padding: 0, textAlign: 'start', minWidth: 0 }} onClick={() => setOpen(s.id)}>
                <div className="row"><b className="ellipsis">{s.name}</b>{!s.end && <span className="tag ok">●</span>}</div>
                <div className="tiny faint">{t.date(s.start)} · {fmtDur((s.end || Date.now()) - s.start)} · {n} {t('radios')}{attn ? ` · ${attn} ${t('attention')}` : ''}</div>
              </button>
              )}
              <button className="btn sm icon ghost" aria-label={t('edit')} onClick={() => setRenaming({ id: s.id, name: s.name })}><Icon name="gear" size={15} /></button>
              <ConfirmButton className="btn sm ghost danger" aria-label={t('deleteSit')} confirmLabel={t('tapConfirm')} onConfirm={() => e.deleteSit(s.id)}><Icon name="trash" size={15} /></ConfirmButton>
            </div>
          )
        })}
      </div>

      <div className="section-title">{t('log')}</div>
      <div className="card card-pad">
        <div className="row wrap">
          <span className="grow muted">{t('logRows', { n: t.num(e.log.length) })}</span>
          <button className="btn sm" disabled={!e.log.length} onClick={() => download('fieldwatch-log.csv', logCsv(e.log), 'text/csv')}><Icon name="download" size={14} />{t('exportLog')} CSV</button>
          <button className="btn sm" disabled={!e.log.length} onClick={() => download('fieldwatch-log.jsonl', e.log.map((r) => JSON.stringify(r)).join('\n'), 'application/x-ndjson')}>JSONL</button>
          <button className="btn sm danger" disabled={!e.log.length} onClick={() => e.clearLog()}>{t('clearLog')}</button>
        </div>
      </div>

      {open && e.sits.find((s) => s.id === open) && <Debrief sit={e.sits.find((s) => s.id === open)} onClose={() => setOpen(null)} />}
      {cmp && <Compare a={cmp[0]} b={cmp[1]} onClose={() => setCmp(null)} />}
    </div>
  )
}
