import { useEffect, useState } from 'react'
import { useEngine, Icon, Sheet } from './ui.jsx'
import { Live } from './screens/Live.jsx'
import { Detail } from './screens/Detail.jsx'
import { Hunt } from './screens/Hunt.jsx'
import { Reports } from './screens/Reports.jsx'
import { Home } from './screens/Home.jsx'
import { More } from './screens/More.jsx'
import { SCENARIOS } from './engine/intel.js'

function useTheme(theme) {
  const [sys, setSys] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!mq) return
    const h = () => setSys(mq.matches)
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [])
  const resolved = theme === 'system' ? (sys ? 'dark' : 'light') : theme
  useEffect(() => {
    document.documentElement.dataset.theme = resolved
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.content = resolved === 'light' ? '#f4f6f5' : resolved === 'night' ? '#000000' : '#0a0f0d'
  }, [resolved])
  return resolved
}

/** Hands-free control: "scan / stop / hunt / report" or the Arabic equivalents. */
function useVoiceCommands(enabled, actions, lang) {
  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!enabled || !SR) return
    const rec = new SR()
    rec.lang = lang === 'ar' ? 'ar-SA' : 'en-US'
    rec.continuous = true
    rec.interimResults = false
    let alive = true
    rec.onresult = (ev) => {
      const said = ev.results[ev.results.length - 1][0].transcript.trim().toLowerCase()
      if (/افحص|فحص|scan|start/.test(said)) actions.scan()
      else if (/توقف|أوقف|stop/.test(said)) actions.stop()
      else if (/تعقب|تعقّب|hunt|find/.test(said)) actions.hunt()
      else if (/تقرير|report/.test(said)) actions.report()
    }
    rec.onend = () => { if (alive) try { rec.start() } catch { /* ignore */ } }
    try { rec.start() } catch { /* ignore */ }
    return () => { alive = false; try { rec.stop() } catch { /* ignore */ } }
  }, [enabled, lang])
}

function LockScreen() {
  const e = useEngine()
  const t = e.t
  const [pin, setPin] = useState('')
  const [bad, setBad] = useState(false)
  return (
    <div className="lock-screen">
      <form className="card card-pad stack" style={{ maxWidth: 360, width: '100%' }} onSubmit={async (ev) => { ev.preventDefault(); setBad(!(await e.unlock(pin))); setPin('') }}>
        <div className="brand-mark" style={{ width: 52, height: 52, borderRadius: 14, margin: '0 auto' }}><Icon name="lock" size={26} /></div>
        <h2 style={{ textAlign: 'center', margin: 0 }}>{t('locked')}</h2>
        <input id="unlock-pin" className="input" type="password" inputMode="numeric" autoFocus autoComplete="current-password" value={pin} onChange={(ev) => setPin(ev.target.value)} placeholder={t('pin')} aria-label={t('pin')} />
        {bad && <div className="small" style={{ color: 'var(--danger)', textAlign: 'center' }}>{t('wrongPin')}</div>}
        <button className="btn primary big" type="submit">{t('unlock')}</button>
      </form>
    </div>
  )
}

function Onboarding() {
  const e = useEngine()
  const t = e.t
  const s = e.settings
  const [step, setStep] = useState(0)
  const steps = [
    { icon: 'radar', title: t('onbTitle1'), body: t('onbBody1') },
    { icon: 'shield', title: t('onbTitle2'), body: t('onbBody2') },
  ]
  const finish = () => e.set({ onboarded: true })
  return (
    <Sheet title={t('welcome')} className="dialog onboarding">
      <div className="stack">
        <div className="onb-dots" aria-hidden="true">{[0, 1, 2].map((i) => <i key={i} className={i === step ? 'on' : ''} />)}</div>
        {step < 2 ? (
          <div className="stack" style={{ textAlign: 'center' }}>
            <div className="onb-icon"><Icon name={steps[step].icon} size={44} /></div>
            <h2 style={{ margin: 0 }}>{steps[step].title}</h2>
            <p className="muted" style={{ margin: 0 }}>{steps[step].body}</p>
          </div>
        ) : (
          <div className="stack">
            <h2 style={{ margin: 0, textAlign: 'center' }}>{t('onbTitle3')}</h2>
            <div className="scenario-grid">
              {['simple', 'advanced'].map((m) => (
                <button key={m} className={'scenario' + (s.mode === m ? ' on' : '')} onClick={() => e.set({ mode: m })} aria-pressed={s.mode === m}>
                  <Icon name={m === 'simple' ? 'radar' : 'list'} size={22} />
                  <b>{t(m === 'simple' ? 'simpleMode' : 'advancedMode')}</b>
                  <small>{m === 'simple' ? (t.lang === 'ar' ? 'زر فحص ونتيجة واضحة' : 'One scan button, clear results') : (t.lang === 'ar' ? 'كل التفاصيل والأدوات' : 'Every detail and tool')}</small>
                </button>
              ))}
            </div>
            <div className="small muted">{t('scenarios')}</div>
            <div className="row wrap">
              {Object.entries(SCENARIOS).map(([k, v]) => <button key={k} className={'chip' + (s.scenario === k ? ' on' : '')} onClick={() => e.set({ scenario: k })}><Icon name={v.icon} size={14} />{t.lang === 'ar' ? v.ar.name : v.en.name}</button>)}
            </div>
          </div>
        )}
        <div className="row">
          <button className="btn ghost" onClick={finish}>{t('skip')}</button>
          <span className="spacer" />
          {step < 2 ? <button className="btn primary" onClick={() => setStep(step + 1)}>{t('next')}</button> : <button className="btn primary" onClick={finish}>{t('getStarted')}</button>}
        </div>
      </div>
    </Sheet>
  )
}

export default function App() {
  const e = useEngine()
  const t = e.t
  const s = e.settings
  const resolved = useTheme(s.theme)
  const advanced = s.mode === 'advanced'
  const [tab, setTab] = useState(() => (location.hash.slice(1).split('/')[0] || 'home'))
  const [morePage, setMorePage] = useState(null)
  const [detail, setDetail] = useState(null)
  const TABS = [
    { id: 'home', icon: 'radar', key: 'tabHome' },
    ...(advanced ? [{ id: 'live', icon: 'list', key: 'tabLive' }] : []),
    { id: 'hunt', icon: 'target', key: 'tabHunt' },
    { id: 'reports', icon: 'file', key: 'tabReports' },
    { id: 'more', icon: 'grid', key: 'tabMore' },
  ]
  const goto = (id) => { setTab(id); if (id !== 'more') setMorePage(null) }

  useEffect(() => {
    document.documentElement.lang = s.lang
    document.documentElement.dir = t.dir
    document.title = s.lang === 'ar' ? 'فيلدواتش — مراقب ميداني' : 'Fieldwatch Web'
  }, [s.lang])
  useEffect(() => {
    const root = document.documentElement
    root.style.fontSize = s.fontScale + '%'
    root.dataset.contrast = s.highContrast ? 'high' : ''
    root.dataset.motion = s.reduceMotion ? 'reduce' : ''
  }, [s.fontScale, s.highContrast, s.reduceMotion])
  useEffect(() => { if (!TABS.some((x) => x.id === tab)) setTab('home') }, [advanced])
  useEffect(() => { history.replaceState(null, '', '#' + tab) }, [tab])
  useVoiceCommands(s.voiceCommands && !e.locked, {
    scan: () => { goto('home'); e.startScan(s.scenario, SCENARIOS[s.scenario]?.duration ?? 30) },
    stop: () => { e.scan && !e.scan.done ? e.finishScan() : e.stop() },
    hunt: () => goto('hunt'),
    report: () => goto('reports'),
  }, s.lang)

  if (e.locked) return <LockScreen />

  const now = Date.now()
  const attn = [...e.radios.values()].filter((r) => (r.risk?.score || 0) >= 30 && now - r.lastSeen < 60000).length
  const sit = e.activeSit()
  const toggleTheme = () => e.set({ theme: resolved === 'light' ? 'dark' : resolved === 'dark' ? 'night' : 'light' })
  const tp = e.trustedPrompt

  return (
    <div className="app">
      <a className="skip-link" href="#main">{t.lang === 'ar' ? 'تخطَّ إلى المحتوى' : 'Skip to content'}</a>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <div className="brand-mark"><Icon name="radar" size={20} stroke={2.2} /></div>
            <div style={{ minWidth: 0 }}>
              <div className="brand-name">{t('appName')}</div>
              <div className="brand-sub ellipsis">{t('unofficial')}</div>
            </div>
          </div>
          <span className="spacer" />
          <div className="status-icons">
            <span className="status-dot" title={e.running ? t('scanning') : t('stopped')}>
              <span className={'dot' + (e.running ? ' on' : '')} />
              <span className="hide-sm">{e.running ? t('scanning') : t('stopped')}</span>
            </span>
            {sit && <span className="status-dot" title={t('sitRunning')}><Icon name="file" size={13} />{Object.keys(sit.radios).length}</span>}
            {e.pos && <span className="status-dot" title={e.pos.simulated ? 'GPS (simulated)' : 'GPS'}><Icon name="pin" size={13} style={{ color: 'var(--accent)' }} /></span>}
            {e.lock && <button className="btn sm icon ghost" onClick={() => e.lockNow()} title={t('lockNow')} aria-label={t('lockNow')}><Icon name="lock" /></button>}
            <button className="btn sm icon ghost" onClick={() => e.set({ lang: s.lang === 'ar' ? 'en' : 'ar' })} title={t('language')} aria-label={t('language')} style={{ width: 'auto', padding: '0 8px', fontWeight: 700 }}>
              {s.lang === 'ar' ? 'EN' : 'ع'}
            </button>
            <button className="btn sm icon ghost" onClick={toggleTheme} title={t('theme')} aria-label={t('theme')}>
              <Icon name={resolved === 'light' ? 'moon' : resolved === 'dark' ? 'eye' : 'sun'} />
            </button>
          </div>
        </div>
      </header>

      {e.updateReady && (
        <div className="update-bar no-print" role="status">
          <span>{t('updateAvailable')}</span>
          <button className="btn sm primary" onClick={() => location.reload()}>{t('reload')}</button>
        </div>
      )}

      <main id="main">
        {!e.ready ? <div className="empty"><Icon name="radar" size={40} /><div>…</div></div>
          : tab === 'home' ? <Home onOpen={setDetail} goto={goto} />
            : tab === 'live' ? <Live onOpen={setDetail} />
              : tab === 'hunt' ? <Hunt />
                : tab === 'reports' ? <Reports />
                  : <More page={morePage} setPage={setMorePage} />}
      </main>

      <nav className="tabbar" aria-label="tabs">
        <div className="tabbar-inner" style={{ gridTemplateColumns: `repeat(${TABS.length}, 1fr)` }}>
          {TABS.map((x) => (
            <button key={x.id} className={'tab' + (tab === x.id ? ' active' : '')} onClick={() => goto(x.id)} aria-current={tab === x.id ? 'page' : undefined}>
              <Icon name={x.icon} size={21} />
              <span>{t(x.key)}</span>
              {(x.id === 'home' || x.id === 'live') && attn > 0 && (x.id === 'live' || !advanced) && <span className="badge">{attn}</span>}
              {x.id === 'reports' && sit && <span className="badge" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>●</span>}
            </button>
          ))}
        </div>
      </nav>

      <div className="toasts" aria-live="polite">
        {e.toasts.map((x) => (
          <div key={x.id} className={'toast ' + x.kind} onClick={() => x.key && e.radios.has(x.key) && setDetail(x.key)}>
            {x.kind === 'alert' && <Icon name="bell" size={16} />}<span>{x.text}</span>{x.extra > 0 && <span className="badge" style={{ background: '#fff', color: 'var(--danger)' }}>+{x.extra}</span>}
          </div>
        ))}
      </div>

      {detail && <Detail radioKey={detail} onClose={() => setDetail(null)} onHunt={(k) => { e.huntKey = k; setDetail(null); goto('hunt'); e.emit() }} />}

      {e.flood?.open && (
        <Sheet title={<span className="row"><Icon name="alert" style={{ color: 'var(--warn)' }} />{t('floodTitle')}</span>} className="dialog">
          <p style={{ marginTop: 0 }}>{t('floodBody', { n: e.flood.n })}</p>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => e.resolveFlood(false)}>{t('continue')}</button>
            <button className="btn primary" onClick={() => e.resolveFlood(true)}>{t('hideThese')}</button>
          </div>
        </Sheet>
      )}

      {tp && (
        <Sheet title={<span className="row"><Icon name="alert" style={{ color: 'var(--danger)' }} />{t('emergency')}</span>} className="dialog" onClose={() => { e.trustedPrompt = null; e.emit() }}>
          <div className="stack">
            <p style={{ margin: 0 }}>{t('trustedPrompt')}</p>
            {(() => {
              const msg = t('trustedMsg', { sig: tp.sig, time: t.date(tp.t) }) + (e.pos && !s.privacy ? ` https://maps.google.com/?q=${e.pos.lat.toFixed(5)},${e.pos.lon.toFixed(5)}` : '')
              const c = s.trustedContact
              const href = c.includes('@') ? `mailto:${encodeURIComponent(c)}?subject=Fieldwatch&body=${encodeURIComponent(msg)}` : `sms:${c.replace(/[^+\d]/g, '')}?body=${encodeURIComponent(msg)}`
              return (
                <>
                  <div className="note small" dir="auto" style={{ userSelect: 'text' }}>{msg}</div>
                  <div className="row wrap">
                    {navigator.share && <button className="btn primary" onClick={() => navigator.share({ text: msg }).catch(() => {})}><Icon name="bell" size={15} />{t('sendMessage')}</button>}
                    <a className="btn" href={href}>{c}</a>
                  </div>
                </>
              )
            })()}
          </div>
        </Sheet>
      )}

      {e.ready && !s.accepted && (
        <Sheet title={t('disclaimerTitle')} className="dialog">
          <div className="stack">
            <div className="row" style={{ gap: 12 }}>
              <div className="brand-mark" style={{ width: 48, height: 48, borderRadius: 14 }}><Icon name="radar" size={28} /></div>
              <div><div style={{ fontWeight: 700, fontSize: 18 }}>{t('appName')}</div><div className="small muted">{t('tagline')}</div></div>
            </div>
            <div className="row" style={{ justifyContent: 'center' }}>
              <div className="seg">
                <button className={s.lang === 'ar' ? 'on' : ''} onClick={() => e.set({ lang: 'ar' })}>العربية</button>
                <button className={s.lang === 'en' ? 'on' : ''} onClick={() => e.set({ lang: 'en' })}>English</button>
              </div>
            </div>
            <p className="small" style={{ margin: 0 }}>{t('disclaimer')}</p>
            <p className="small muted" style={{ margin: 0 }}>{t('disclaimerPort')}</p>
            <button className="btn primary big" onClick={() => e.set({ accepted: true })}>{t('accept')}</button>
          </div>
        </Sheet>
      )}
      {e.ready && s.accepted && !s.onboarded && <Onboarding />}
    </div>
  )
}
