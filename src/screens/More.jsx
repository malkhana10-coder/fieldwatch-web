import { useEffect, useRef, useState } from 'react'
import { useEngine, Icon, Switch, Setting, ConfirmButton, CLASS_ICON, Seg } from '../ui.jsx'
import { CLASS_INFO, fingerprintSeeds } from '../engine/intel.js'
import { CLASSES } from '../i18n.js'
import { pickFile, download } from '../engine/storage.js'
import { decryptExport } from '../engine/secure.js'
import { debrief, sitRadios } from '../engine/reports.js'
import { Signatures } from './Signatures.jsx'
import { Settings } from './Settings.jsx'
import { PALETTE } from '../engine/catalog.js'

const PAGES = [
  { id: 'places', icon: 'pin', key: 'places' },
  { id: 'learn', icon: 'book', key: 'learn' },
  { id: 'stats', icon: 'chart', key: 'stats' },
  { id: 'team', icon: 'user', key: 'team' },
  { id: 'privacy', icon: 'lock', key: 'privacySec' },
  { id: 'sigs', icon: 'book', key: 'tabSignatures', advanced: true },
  { id: 'audit', icon: 'file', key: 'audit' },
  { id: 'settings', icon: 'gear', key: 'tabSettings' },
]

export function More({ page, setPage }) {
  const e = useEngine()
  const t = e.t
  if (page) {
    const P = { places: Places, learn: Learn, stats: Stats, team: Team, privacy: Privacy, sigs: Signatures, audit: Audit, settings: Settings }[page]
    const meta = PAGES.find((p) => p.id === page)
    return (
      <div className="stack">
        <button className="btn sm ghost back-btn" onClick={() => setPage(null)}><Icon name="back" size={16} className="flip-rtl" />{t('back')}</button>
        <h2 className="page-title">{t(meta.key)}</h2>
        <P />
      </div>
    )
  }
  return (
    <div className="stack">
      <div className="more-grid">
        {PAGES.filter((p) => !p.advanced || e.settings.mode === 'advanced').map((p) => (
          <button key={p.id} className="more-tile card" onClick={() => setPage(p.id)}>
            <Icon name={p.icon} size={24} />
            <b>{t(p.key)}</b>
          </button>
        ))}
      </div>
      <div className="card card-pad stack">
        <div className="row"><Icon name="alert" style={{ color: 'var(--danger)' }} /><b className="grow">{t('panic')}</b></div>
        <div className="small muted">{t('panicHint')}</div>
        <ConfirmButton className="btn danger" confirmLabel={t('tapConfirm')} onConfirm={() => e.resetAll()}><Icon name="trash" size={15} />{t('panic')}</ConfirmButton>
      </div>
    </div>
  )
}

// ---------- places ----------
function Places() {
  const e = useEngine()
  const t = e.t
  const cur = e.currentPlace()
  return (
    <div className="stack">
      <div className="note info small">{t('placesHint')}</div>
      <label className="field"><span>{t('choosePlace')}</span>
        <select id="place-select" className="input" value={e.manualPlaceId || ''} onChange={(ev) => e.setManualPlace(ev.target.value)}>
          <option value="">{t('noPlace')} / GPS</option>
          {e.places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      {!e.places.length && <div className="empty card">{t('learnPlaceHint')}</div>}
      {e.places.map((p) => {
        const scans = e.sits.filter((s) => s.placeId === p.id)
        return (
          <div key={p.id} className="card card-pad stack">
            <div className="row">
              <Icon name="pin" />
              <b className="grow">{p.name}</b>
              {cur?.id === p.id && <span className="tag ok">●</span>}
              <ConfirmButton className="btn sm ghost danger" confirmLabel={t('tapConfirm')} onConfirm={() => e.deletePlace(p.id)} aria-label={t('delete')}><Icon name="trash" size={14} /></ConfirmButton>
            </div>
            <div className="small muted">{t('knownDevices', { n: Object.keys(p.known || {}).length })}{p.lat != null ? ' · GPS' : ''} · {t.date(p.learnedAt)}</div>
            <Setting title={t('ignoreAlertsHere')}><Switch checked={p.ignoreAlerts} onChange={(v) => e.updatePlace(p.id, { ignoreAlerts: v })} /></Setting>
            {scans.length > 0 && <div className="small"><b>{t('lastScans')}:</b> {scans.slice(0, 5).map((s) => t.date(s.start)).join(' · ')}</div>}
          </div>
        )
      })}
    </div>
  )
}

// ---------- learn ----------
function Learn() {
  const e = useEngine()
  const t = e.t
  const L = (c) => CLASS_INFO[c][t.lang] || CLASS_INFO[c].en
  const [open, setOpen] = useState(null)
  const sorted = [...CLASSES].sort((a, b) => CLASS_INFO[b].risk - CLASS_INFO[a].risk)
  return (
    <div className="stack">
      <div className="card card-pad stack">
        <h3>{t('howRadioWorks')}</h3>
        <p style={{ margin: 0 }}>{t('learnRadio')}</p>
        <div className="note small">{t('learnLimits')}</div>
      </div>
      <div className="small muted">{t('learnHint')}</div>
      <div className="card">
        {sorted.map((c) => {
          const info = L(c)
          const risk = CLASS_INFO[c].risk
          const lvl = risk >= 30 ? 'attn' : risk >= 14 ? 'warn' : 'ok'
          return (
            <div key={c}>
              <button className="sig" style={{ width: '100%', background: 'none', border: 0, borderBlockStart: '1px solid var(--line)', textAlign: 'start' }} onClick={() => setOpen(open === c ? null : c)} aria-expanded={open === c}>
                <Icon name={CLASS_ICON[c]} />
                <b className="grow">{t.cls(c)}</b>
                <span className={'tag ' + lvl}>{t('learnRisk')}: {risk >= 30 ? t('riskHigh') : risk >= 14 ? t('riskMedium') : t('riskLow')}</span>
              </button>
              {open === c && (
                <div style={{ padding: '0 14px 14px' }} className="stack small">
                  <div><b>{t('learnWhat')}:</b> {info.what}</div>
                  {info.why && <div><b>{t('learnWhy')}:</b> {info.why}</div>}
                  <div><b>{t('learnCheck')}:</b> {info.check}</div>
                  <div className="faint">{e.fleets.filter((f) => f.kind === c).length} {t('tabSignatures')}: {e.fleets.filter((f) => f.kind === c).slice(0, 8).map((f) => f.name).join(', ')}</div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------- stats + generative fingerprint ----------
function Fingerprint() {
  const e = useEngine()
  const t = e.t
  const ref = useRef(null)
  const radios = [...e.radios.values()].filter((r) => Date.now() - r.lastSeen < 120000)
  const seeds = fingerprintSeeds(radios)
  const sig = seeds.map((s) => s.h).join(',')
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const ctx = c.getContext('2d')
    const W = c.width
    const theme = document.documentElement.dataset.theme
    const dark = theme !== 'light'
    const night = theme === 'night'
    ctx.fillStyle = night ? '#000000' : dark ? '#0a0f0d' : '#f4f6f5'
    ctx.fillRect(0, 0, W, W)
    ctx.globalCompositeOperation = dark ? 'lighter' : 'multiply'
    const cx = W / 2
    seeds.forEach((s, i) => {
      const a = (s.h % 3600) / 3600 * Math.PI * 2
      const rad = (0.15 + ((s.h >>> 12) % 1000) / 1000 * 0.8) * (W / 2 - 10)
      // Night mode keeps everything in red to protect dark-adapted eyes.
      const col = night ? ['#ff3b3b', '#c22a2a', '#ff7a7a', '#8a1c1c'][s.h % 4] : s.cls ? PALETTE[(CLASSES.indexOf(s.cls) + 9) % PALETTE.length] : s.kind === 'WIFI' ? '#4FC3F7' : '#B388FF'
      const size = 4 + Math.max(0, s.rssi + 100) / 6
      ctx.strokeStyle = col + '88'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(cx, cx)
      const cp = (s.h >>> 5) % 200 - 100
      ctx.quadraticCurveTo(cx + Math.cos(a + 0.6) * (rad / 2) + cp / 3, cx + Math.sin(a + 0.6) * (rad / 2), cx + Math.cos(a) * rad, cx + Math.sin(a) * rad)
      ctx.stroke()
      ctx.fillStyle = col + 'cc'
      ctx.beginPath()
      ctx.arc(cx + Math.cos(a) * rad, cx + Math.sin(a) * rad, size, 0, Math.PI * 2)
      ctx.fill()
      if (i % 3 === 0) {
        ctx.strokeStyle = col + '33'
        ctx.beginPath()
        ctx.arc(cx, cx, rad, a - 0.4, a + 0.4)
        ctx.stroke()
      }
    })
    ctx.globalCompositeOperation = 'source-over'
  }, [sig, document.documentElement.dataset.theme])
  return (
    <div className="card card-pad stack">
      <h3>{t('fingerprint')}</h3>
      <div className="small muted">{t('fingerprintHint')}</div>
      <canvas ref={ref} width="480" height="480" className="fingerprint" role="img" aria-label={t('fingerprint')} />
      <button className="btn sm" onClick={() => {
        const url = ref.current.toDataURL('image/png')
        if (typeof window.claude?.use === 'function') { e.toast(t('downloadUnavailable', { ext: 'PNG' }), 'warn'); return }
        const a = document.createElement('a'); a.href = url; a.download = 'fieldwatch-fingerprint.png'; a.click()
      }}><Icon name="download" size={14} />{t('saveImage')}</button>
    </div>
  )
}

function Stats() {
  const e = useEngine()
  const t = e.t
  const devices = new Set()
  const sigCount = {}
  let attention = 0
  for (const s of e.sits) {
    const d = debrief(s, e)
    sitRadios(s).forEach((r) => devices.add(r.key))
    attention += d.attention.length
    d.bySig.forEach(([n, c]) => { sigCount[n] = (sigCount[n] || 0) + c })
  }
  const top = Object.entries(sigCount).sort((a, b) => b[1] - a[1]).slice(0, 8)
  const series = e.sits.filter((s) => s.end).slice(0, 14).reverse().map((s) => sitRadios(s).length)
  const max = Math.max(1, ...series)
  return (
    <div className="stack">
      <div className="small muted">{t('statsHint')}</div>
      <div className="stats">
        <div className="stat"><b>{e.sits.length}</b><span>{t('statScans')}</span></div>
        <div className="stat"><b>{devices.size}</b><span>{t('statDevices')}</span></div>
        <div className="stat attn"><b>{attention}</b><span>{t('statAttention')}</span></div>
        <div className="stat"><b>{e.places.length}</b><span>{t('places')}</span></div>
      </div>
      {series.length > 1 && (
        <div className="card card-pad">
          <h3>{t('statPerDay')}</h3>
          <svg viewBox={`0 0 ${series.length * 24} 90`} style={{ width: '100%', height: 110, direction: 'ltr' }} role="img" aria-label={t('statPerDay')}>
            <line x1="0" y1="80" x2={series.length * 24} y2="80" stroke="var(--line)" />
            {series.map((v, i) => <g key={i}><rect x={i * 24 + 5} y={80 - (v / max) * 70} width="14" height={(v / max) * 70} rx="3" fill="var(--accent)" /><text x={i * 24 + 12} y={76 - (v / max) * 70} fontSize="9" textAnchor="middle" fill="var(--text-2)">{v}</text></g>)}
          </svg>
        </div>
      )}
      <div className="card card-pad">
        <h3>{t('statTopBrands')}</h3>
        {top.map(([n, c]) => <div key={n} className="bar-row"><span className="ellipsis">{n}</span><div className="bar-track"><div className="bar-fill" style={{ width: `${(c / top[0][1]) * 100}%` }} /></div><b>{c}</b></div>)}
        {!top.length && <span className="faint">—</span>}
      </div>
      <Fingerprint />
    </div>
  )
}

// ---------- team ----------
function Team() {
  const e = useEngine()
  const t = e.t
  const [member, setMember] = useState('')
  const [pw, setPw] = useState('')
  const [tasks, setTasks] = useState(() => { try { return JSON.parse(localStorage.getItem('fw.tasks') || '[]') } catch { return [] } })
  const [task, setTask] = useState('')
  const saveTasks = (v) => { setTasks(v); try { localStorage.setItem('fw.tasks', JSON.stringify(v)) } catch { /* ignore */ } }
  const imported = e.sits.filter((s) => s.member)
  const members = [...new Set(imported.map((s) => s.member))]
  const doImport = async () => {
    const f = await pickFile('.json')
    if (!f) return
    try {
      let j = JSON.parse(f.text)
      if (j.format === 'fieldwatch-encrypted') j = await decryptExport(pw, j)
      const list = Array.isArray(j) ? j : j.sits || [j]
      e.toast(`+${e.importSits(list, member.trim() || f.name.replace(/\.json$/, ''))}`)
    } catch (err) { e.toast(err?.name === 'OperationError' ? t('decryptFailed') : t('importFailed', { e: err.message }), 'warn') }
  }
  const all = imported
  const totals = all.reduce((acc, s) => { const d = debrief(s, e); acc.radios += d.total; acc.attention += d.attention.length; acc.co += d.coTravel.length; return acc }, { radios: 0, attention: 0, co: 0 })
  return (
    <div className="stack">
      <div className="note info small">{t('teamHint')}</div>
      <div className="card card-pad stack">
        <div className="row wrap">
          <input id="team-member" className="input grow" placeholder={t('memberName')} value={member} onChange={(ev) => setMember(ev.target.value)} />
          <input id="team-pw" className="input grow" type="password" placeholder={t('password') + ' (' + t('encryptedExport') + ')'} value={pw} onChange={(ev) => setPw(ev.target.value)} />
          <button className="btn primary" onClick={doImport}><Icon name="upload" size={15} />{t('importScans')}</button>
        </div>
      </div>
      {all.length > 0 && (
        <div className="card card-pad stack">
          <h3>{t('merged')}</h3>
          <div className="stats">
            <div className="stat"><b>{members.length}</b><span>{t('members')}</span></div>
            <div className="stat"><b>{all.length}</b><span>{t('statScans')}</span></div>
            <div className="stat attn"><b>{totals.attention}</b><span>{t('attention')}</span></div>
            <div className="stat"><b>{totals.co}</b><span>{t('coTravel')}</span></div>
          </div>
          {members.map((m) => {
            const ss = all.filter((s) => s.member === m)
            return <div key={m} className="row small"><Icon name="user" size={14} /><b className="grow">{m}</b><span>{ss.length} {t('statScans')} · {ss.reduce((a, s) => a + debrief(s, e).attention.length, 0)} {t('attention')}</span></div>
          })}
        </div>
      )}
      <div className="card card-pad stack">
        <h3>{t('tasks')}</h3>
        <form className="row" onSubmit={(ev) => { ev.preventDefault(); if (task.trim()) { saveTasks([...tasks, { id: Date.now(), text: task.trim(), done: false }]); setTask('') } }}>
          <input id="task-text" className="input grow" placeholder={t('taskPlaceholder')} value={task} onChange={(ev) => setTask(ev.target.value)} />
          <button className="btn" type="submit"><Icon name="plus" size={15} />{t('addTask')}</button>
        </form>
        {tasks.map((x) => (
          <div key={x.id} className="row">
            <input type="checkbox" id={'task-' + x.id} checked={x.done} onChange={() => saveTasks(tasks.map((y) => (y.id === x.id ? { ...y, done: !y.done } : y)))} style={{ width: 18, height: 18, accentColor: 'var(--accent)' }} />
            <label htmlFor={'task-' + x.id} className="grow" style={x.done ? { textDecoration: 'line-through', color: 'var(--text-3)' } : undefined}>{x.text}</label>
            <button className="btn sm icon ghost" aria-label={t('delete')} onClick={() => saveTasks(tasks.filter((y) => y.id !== x.id))}><Icon name="x" size={14} /></button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------- privacy & security ----------
function Privacy() {
  const e = useEngine()
  const t = e.t
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [err, setErr] = useState('')
  const [key, setKey] = useState('')
  const [contact, setContact] = useState(e.settings.trustedContact || '')
  const submitPin = async () => {
    if (pin.length < 4) return setErr(t('pinShort'))
    if (pin !== pin2) return setErr(t('pinMismatch'))
    setErr('')
    await e.setPin(pin)
    setPin(''); setPin2('')
    e.toast('✓')
  }
  return (
    <div className="stack">
      <div className="card card-pad stack">
        <div className="row"><Icon name="lock" /><b className="grow">{t('pinLock')}</b>{e.lock && <span className="tag ok">AES-256</span>}</div>
        <div className="small muted">{t('pinHint')}</div>
        <div className="row wrap">
          <input id="pin1" className="input grow" type="password" inputMode="numeric" autoComplete="new-password" placeholder={t('pin')} value={pin} onChange={(ev) => setPin(ev.target.value)} />
          <input id="pin2" className="input grow" type="password" inputMode="numeric" autoComplete="new-password" placeholder={t('pinConfirm')} value={pin2} onChange={(ev) => setPin2(ev.target.value)} />
        </div>
        {err && <div className="small" style={{ color: 'var(--danger)' }}>{err}</div>}
        <div className="row wrap">
          <button className="btn primary" onClick={submitPin}>{e.lock ? t('changePin') : t('setPin')}</button>
          {e.lock && <button className="btn" onClick={() => e.lockNow()}><Icon name="lock" size={14} />{t('lockNow')}</button>}
          {e.lock && <ConfirmButton className="btn danger" confirmLabel={t('tapConfirm')} onConfirm={() => e.removePin()}>{t('removePin')}</ConfirmButton>}
        </div>
      </div>
      <div className="card">
        <Setting title={t('privacy')} hint={t('privacyHint')}><Switch checked={e.settings.privacy} onChange={(v) => e.set({ privacy: v })} /></Setting>
        <Setting title={t('retention')}>
          <select id="retention" className="input" style={{ width: 'auto' }} value={e.settings.retentionDays} onChange={(ev) => { e.set({ retentionDays: Number(ev.target.value) }); e.applyRetention() }}>
            <option value="0">{t('retentionForever')}</option>
            {[1, 7, 30, 90].map((d) => <option key={d} value={d}>{d} {t('days')}</option>)}
          </select>
        </Setting>
      </div>
      <div className="card card-pad stack">
        <b>{t('trusted')}</b>
        <div className="small muted">{t('trustedHint')}</div>
        <div className="row">
          <input id="trusted" className="input grow" value={contact} onChange={(ev) => setContact(ev.target.value)} placeholder="+9665… / name@example.com" dir="ltr" />
          <button className="btn" onClick={() => { e.set({ trustedContact: contact.trim() }); e.toast('✓') }}>{t('save')}</button>
        </div>
      </div>
      <div className="card card-pad stack">
        <b>{t('aiKey')}</b>
        <div className="small muted">{t('aiKeyHint')}</div>
        <div className="row">
          <input id="ai-key" className="input grow" type="password" autoComplete="off" value={key} onChange={(ev) => setKey(ev.target.value)} placeholder={e.aiKey ? '•••••• ' + e.aiKey.slice(-4) : 'sk-ant-…'} dir="ltr" />
          <button className="btn" disabled={!key.trim()} onClick={() => { e.setAiKey(key); setKey(''); e.toast(t('aiKeySaved')) }}>{t('save')}</button>
          {e.aiKey && <button className="btn ghost" onClick={() => e.setAiKey('')}>{t('clear')}</button>}
        </div>
      </div>
    </div>
  )
}

// ---------- audit ----------
function Audit() {
  const e = useEngine()
  const t = e.t
  return (
    <div className="stack">
      <div className="small muted">{t('auditHint')}</div>
      <div className="row"><span className="spacer" /><button className="btn sm" onClick={() => download('fieldwatch-audit.json', JSON.stringify(e.audit, null, 1), 'application/json')}><Icon name="download" size={14} />JSON</button></div>
      <div className="card">
        {[...e.audit].reverse().slice(0, 300).map((a, i) => (
          <div key={i} className="sig small"><span className="mono faint" style={{ minWidth: 130 }}>{t.date(a.t)}</span><b>{a.action}</b><span className="muted ellipsis">{a.detail}</span></div>
        ))}
        {!e.audit.length && <div className="empty">—</div>}
      </div>
    </div>
  )
}
