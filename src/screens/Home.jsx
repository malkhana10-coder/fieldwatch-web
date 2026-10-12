import { useState, useEffect } from 'react'
import { useEngine, Icon, Glyph, Sheet } from '../ui.jsx'
import { SCENARIOS, riskLevel, explainPlain } from '../engine/intel.js'
import { snapshot, localAdvice, askClaude, hasClaude } from '../engine/advisor.js'
import { maskMac } from '../engine/geo.js'
import { radioColor } from './Live.jsx'
import { weeklySummary } from '../engine/reports.js'

export function RiskBadge({ score, big }) {
  const lvl = riskLevel(score)
  const color = lvl === 'high' ? 'var(--danger)' : lvl === 'medium' ? 'var(--warn)' : 'var(--accent)'
  return (
    <span className={'risk-badge ' + lvl + (big ? ' big' : '')} style={{ '--rc': color }} aria-label={'risk ' + score}>
      <b className="ltr">{score}</b>
    </span>
  )
}

function ScanRing({ progress, active, onClick, label, sub }) {
  const R = 92
  const C = 2 * Math.PI * R
  return (
    <button className={'scan-ring' + (active ? ' active' : '')} onClick={onClick} aria-label={label}>
      <svg viewBox="0 0 220 220" aria-hidden="true">
        <circle cx="110" cy="110" r={R} className="scan-track" />
        {active && <circle cx="110" cy="110" r={R} className="scan-prog" strokeDasharray={`${C * progress} ${C}`} transform="rotate(-90 110 110)" />}
      </svg>
      <span className="scan-ring-inner">
        <Icon name={active ? 'radar' : 'play'} size={34} className={active ? 'spin-slow' : ''} />
        <b>{label}</b>
        {sub && <small>{sub}</small>}
      </span>
    </button>
  )
}

function LearnPlaceDialog({ onClose }) {
  const e = useEngine()
  const t = e.t
  const cur = e.currentPlace()
  const [name, setName] = useState(cur?.name || '')
  return (
    <Sheet title={t('learnPlace')} onClose={onClose} className="dialog">
      <div className="stack">
        <p className="small muted" style={{ margin: 0 }}>{t('learnPlaceHint')}</p>
        <label className="field"><span>{t('placeName')}</span>
          <input id="place-name" className="input" value={name} onChange={(ev) => setName(ev.target.value)} placeholder={t.lang === 'ar' ? 'البيت، المكتب، السيارة…' : 'Home, office, car…'} />
        </label>
        <button className="btn primary" disabled={!name.trim()} onClick={() => {
          const n = [...e.radios.values()].filter((r) => Date.now() - r.lastSeen < 120000).length
          e.learnPlace(name.trim())
          e.toast(t('placeLearned', { n, p: name.trim() }))
          onClose()
        }}>{t('save')}</button>
      </div>
    </Sheet>
  )
}

function Advisor({ radios }) {
  const e = useEngine()
  const t = e.t
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState(null)
  const [canClaude, setCanClaude] = useState(null)
  useEffect(() => { hasClaude(e).then(setCanClaude) }, [e.aiKey])
  const run = async () => {
    const question = q.trim() || t('advisorDefaultQ')
    const snap = snapshot(e, radios)
    const local = localAdvice(e, snap)
    setAnswer({ local, question })
    if (!canClaude) return
    setBusy(true)
    try {
      const text = await askClaude(e, question, snap)
      setAnswer({ local, question, claude: text })
      e.auditLog('advisor-asked')
    } catch (err) {
      setAnswer({ local, question, error: err.message === 'no-key' ? t('advisorNoKey') : err.message })
    } finally { setBusy(false) }
  }
  return (
    <div className="card card-pad stack">
      <div className="row"><Icon name="sparkle" /><b className="grow">{t('advisor')}</b><span className={'tag ' + (canClaude ? 'info' : '')}>{canClaude ? t('advisorClaude') : t('advisorLocal')}</span></div>
      <form className="row" onSubmit={(ev) => { ev.preventDefault(); run() }}>
        <input id="advisor-q" className="input grow" value={q} onChange={(ev) => setQ(ev.target.value)} placeholder={t('advisorHint')} dir="auto" />
        <button className="btn primary" type="submit" disabled={busy}>{busy ? t('thinking') : t('ask')}</button>
      </form>
      {answer && (
        <div className="stack">
          <div className="note info small"><b>{answer.local.title}.</b> {answer.local.summary}</div>
          {answer.claude && <div className="advisor-answer" dir="auto">{answer.claude}</div>}
          {answer.error && <div className="note small">{answer.error}</div>}
        </div>
      )}
      {!canClaude && canClaude !== null && <div className="tiny faint">{t('advisorNoKey')}</div>}
    </div>
  )
}

export function Home({ onOpen, goto }) {
  const e = useEngine()
  const t = e.t
  const [learn, setLearn] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const scan = e.scan
  const scenario = e.settings.scenario || 'quick'
  const sc = SCENARIOS[scenario]
  const now = Date.now()
  const active = scan && !scan.done
  const elapsed = scan ? ((scan.end || now) - scan.start) / 1000 : 0
  const progress = scan?.duration ? Math.min(1, elapsed / scan.duration) : (elapsed % 10) / 10
  const radios = scan ? e.scanRadios() : []
  const snap = scan ? snapshot(e, radios) : null
  const advice = snap ? localAdvice(e, snap) : null
  const place = e.currentPlace()
  const week = weeklySummary(e)

  const begin = () => e.startScan(scenario, sc.duration)
  const sub = active ? (scan.duration ? t('scanSecondsLeft', { n: Math.max(0, Math.ceil(scan.duration - elapsed)) }) : t('scanContinuous')) : (t.lang === 'ar' ? sc.ar.name : sc.en.name)

  return (
    <div className="stack">
      <div className="hero home-hero">
        <div className="row wrap" style={{ justifyContent: 'space-between' }}>
          <div className="row place-pill">
            <Icon name="pin" size={15} />
            <span>{place ? place.name : t('noPlace')}</span>
            {place && <span className="tag">{t('knownDevices', { n: Object.keys(place.known || {}).length })}</span>}
          </div>
          <button className="btn sm" onClick={() => setLearn(true)} disabled={!e.radios.size}><Icon name="check" size={14} />{t('learnPlace')}</button>
        </div>
        <div className="scan-center">
          <ScanRing active={!!active} progress={progress} label={active ? t('scanning2') : scan?.done ? t('scanAgain') : t('scanPlace')} sub={sub}
            onClick={() => (active ? (scan.duration ? e.finishScan() : e.finishScan()) : begin())} />
          {active && <div className="small muted" aria-live="polite">{radios.length} {t('radios')}</div>}
          {active && <button className="btn sm ghost" onClick={() => e.finishScan()}>{t('stopScan')}</button>}
        </div>
        <div className="section-title" style={{ marginTop: 4 }}>{t('scenarios')}</div>
        <div className="scenario-grid">
          {Object.entries(SCENARIOS).map(([k, v]) => (
            <button key={k} className={'scenario' + (scenario === k ? ' on' : '')} onClick={() => e.set({ scenario: k })} disabled={!!active} aria-pressed={scenario === k}>
              <Icon name={v.icon} size={20} />
              <b>{t.lang === 'ar' ? v.ar.name : v.en.name}</b>
              <small>{t.lang === 'ar' ? v.ar.desc : v.en.desc}</small>
            </button>
          ))}
        </div>
      </div>

      {advice && (
        <div className={'verdict card card-pad ' + advice.level} aria-live="polite">
          <div className="row" style={{ gap: 12 }}>
            <RiskBadge score={advice.max} big />
            <div className="grow">
              <div className="verdict-title">{t('verdict_' + advice.level)}</div>
              <div className="small muted">{advice.summary}</div>
            </div>
          </div>
        </div>
      )}

      {advice && (
        <div className="card">
          <div className="card-pad" style={{ paddingBottom: 4 }}><h3 style={{ margin: 0 }}>{t('findings')} ({advice.items.length})</h3></div>
          {!advice.items.length && <div className="card-pad small muted">{radios.length ? t('noFindings') : t('scenarioNoMatch')}</div>}
          {advice.items.map(({ r, risk }) => (
            <button key={r.key} className="finding" onClick={() => onOpen(r.key)}>
              <Glyph r={r} color={radioColor(e, r)} />
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="row" style={{ gap: 6 }}>
                  <b className="ellipsis">{e.displayName(r) || r.fleetIds.map((id) => e.fleetById(id)?.name)[0] || (r.hidden ? t('hidden') : t('unknown'))}</b>
                  {e.coTravel(r) && <span className="tag warn">{t('movingWithYou')}</span>}
                </div>
                <div className="small muted clamp2">{explainPlain(r, e)}</div>
                <div className="tiny faint mono">{maskMac(r.mac, e.settings.privacy)}</div>
              </div>
              <RiskBadge score={risk.score} />
            </button>
          ))}
          {radios.length > 0 && (
            <div className="card-pad" style={{ paddingTop: 6 }}>
              <button className="btn sm ghost" onClick={() => setShowAll(!showAll)}>{t('allDevices', { n: radios.length })} {showAll ? '▾' : '▸'}</button>
              {showAll && (
                <div className="radio-list" style={{ marginTop: 8 }}>
                  {snap.rows.slice(0, 120).map(({ r, risk }) => (
                    <button key={r.key} className="finding compact" onClick={() => onOpen(r.key)}>
                      <Glyph r={r} color={radioColor(e, r)} />
                      <div className="grow ellipsis">{e.displayName(r) || r.fleetIds.map((id) => e.fleetById(id)?.name)[0] || r.vendor || r.company || (r.kind === 'WIFI' ? 'Wi-Fi' : 'BLE')}</div>
                      <RiskBadge score={risk.score} />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {(advice || e.radios.size > 0) && <Advisor radios={scan ? radios : [...e.radios.values()].filter((r) => now - r.lastSeen < 60000)} />}

      {week.scans > 0 && (
        <button className="card card-pad row weekly" onClick={() => goto('reports')}>
          <Icon name="chart" />
          <div className="grow" style={{ textAlign: 'start' }}>
            <b>{t('weekly')}</b>
            <div className="small muted">{t('weeklyLine', { s: week.scans, d: week.devices, a: week.attention, c: week.coTravel })}</div>
          </div>
          <span className="faint">›</span>
        </button>
      )}
      {learn && <LearnPlaceDialog onClose={() => setLearn(false)} />}
    </div>
  )
}
