import { Component, Fragment, useEffect, useState } from 'react'
import { useEngine, Icon, Sheet } from './ui.jsx'
import { engine } from './engine/engine.js'
import { Dashboard } from './screens/Dashboard.jsx'
import { Live } from './screens/Live.jsx'
import { Detail } from './screens/Detail.jsx'
import { Hunt } from './screens/Hunt.jsx'
import { Signatures } from './screens/Signatures.jsx'
import { Reports } from './screens/Reports.jsx'
import { Settings } from './screens/Settings.jsx'

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
  // Set during render (idempotent) so children that pick colours for canvases and
  // Leaflet layers in this same render already see the new theme.
  if (document.documentElement.dataset.theme !== resolved) document.documentElement.dataset.theme = resolved
  useEffect(() => {
    document.documentElement.dataset.theme = resolved
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.content = resolved === 'light' ? '#f4f6f5' : resolved === 'night' ? '#000000' : '#0a0f0d'
  }, [resolved])
  return resolved
}

/** Translated text, or a built-in fallback while the key is missing from i18n.js. */
function tx(key, en, ar) {
  try {
    const t = engine.t
    const s = t(key)
    if (typeof s === 'string' && s && s !== key) return s
    return t.lang === 'ar' ? ar : en
  } catch {
    return en
  }
}
const crashText = () => tx('viewCrashed', 'This view stopped because of an error.', 'توقّف هذا العرض بسبب خطأ.')
const resetText = () => tx('resetView', 'Reset this view', 'إعادة تشغيل هذا العرض')
const errorText = (err) => {
  try { return String((err && (err.message || err.name)) || err || 'Error').slice(0, 400) } catch { return 'Error' }
}

/**
 * Catches render errors in one part of the app (a tab, a sheet, or the shell) so one
 * bad record can't blank the whole app. `fallback({ error, reset })` is shown in its
 * place; reset() mounts the children again from scratch. Give it a `key` that
 * changes with what it shows (the tab, the radio) to start clean on navigation.
 */
class Boundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null, gen: 0 }
    this.reset = () => this.setState((s) => ({ error: null, gen: s.gen + 1 }))
  }

  static getDerivedStateFromError(error) { return { error: error || new Error('Unknown error') } }

  componentDidCatch(error, info) {
    console.error(`[Fieldwatch] ${this.props.name || 'view'} crashed:`, error, info?.componentStack || '')
  }

  render() {
    if (this.state.error) return this.props.fallback({ error: this.state.error, reset: this.reset })
    return <Fragment key={this.state.gen}>{this.props.children}</Fragment>
  }
}

/** The fallback body: what happened, the error message, and a way out. */
function CrashNote({ error, reset, heading = true, children }) {
  return (
    <>
      {heading && (
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <Icon name="alert" style={{ color: 'var(--danger)', flex: 'none', marginTop: 2 }} />
          <b>{crashText()}</b>
        </div>
      )}
      <code className="crash-msg">{errorText(error)}</code>
      <div className="row wrap">
        <button type="button" className="btn primary" onClick={reset}><Icon name="refresh" size={16} />{resetText()}</button>
        {children}
      </div>
    </>
  )
}

/** A crashed tab: an inline card; the tab bar stays usable, Settings is one tap away. */
function TabCrash({ error, reset, tab, setTab }) {
  return (
    <div className="card card-pad crash" role="alert">
      <CrashNote error={error} reset={reset}>
        {tab !== 'settings' && <button type="button" className="btn" onClick={() => setTab('settings')}><Icon name="gear" size={16} />{tx('tabSettings', 'Settings', 'الإعدادات')}</button>}
      </CrashNote>
    </div>
  )
}

/** A crashed sheet: the same note in a dialog that can be closed. */
function SheetCrash({ error, reset, onClose }) {
  return (
    <Sheet title={crashText()} onClose={onClose} className="dialog">
      <div role="alert"><CrashNote error={error} reset={reset} heading={false} /></div>
    </Sheet>
  )
}

const TABS = [
  { id: 'home', icon: 'home', key: 'tabHome' },
  { id: 'live', icon: 'radar', key: 'tabLive' },
  { id: 'hunt', icon: 'target', key: 'tabHunt' },
  { id: 'sigs', icon: 'book', key: 'tabSignatures' },
  { id: 'reports', icon: 'file', key: 'tabReports' },
  { id: 'settings', icon: 'gear', key: 'tabSettings' },
]

/** Last line of defence: the shell itself (top bar, toasts) failed to render. */
function ShellCrash({ error, reset }) {
  return (
    <div className="app">
      <main>
        <div className="card card-pad crash" role="alert">
          <CrashNote error={error} reset={reset}>
            <button type="button" className="btn" onClick={() => { history.replaceState(null, '', '#settings'); reset() }}><Icon name="gear" size={16} />{tx('tabSettings', 'Settings', 'الإعدادات')}</button>
          </CrashNote>
        </div>
      </main>
    </div>
  )
}

export default function App() {
  return <Boundary name="app" fallback={(p) => <ShellCrash {...p} />}><Shell /></Boundary>
}

function Shell() {
  const e = useEngine()
  const t = e.t
  const s = e.settings
  const resolved = useTheme(s.theme)
  const [tab, setTab] = useState(() => (location.hash.slice(1) || 'home'))
  const [detail, setDetail] = useState(null)
  const closeDetail = () => setDetail(null)

  useEffect(() => {
    document.documentElement.lang = s.lang
    document.documentElement.dir = t.dir
    document.title = t('docTitle')
  }, [s.lang])
  useEffect(() => { history.replaceState(null, '', '#' + tab) }, [tab])

  const now = Date.now()
  const attn = [...e.radios.values()].filter((r) => r.attention && now - r.lastSeen < 60000).length
  const sit = e.activeSit()
  const toggleTheme = () => e.set({ theme: resolved === 'light' ? 'dark' : resolved === 'dark' ? 'night' : 'light' })

  return (
    <div className="app">
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
            {e.pos && <span className="status-dot" role="img" title={e.pos.simulated ? t('gpsSimulated') : t('gps')} aria-label={e.pos.simulated ? t('gpsSimulated') : t('gps')}><Icon name="pin" size={13} style={{ color: 'var(--accent)' }} /></span>}
            <button className="btn sm icon ghost" onClick={() => e.set({ lang: s.lang === 'ar' ? 'en' : 'ar' })} title={t('language')} aria-label={t('language')} style={{ width: 'auto', padding: '0 8px', fontWeight: 700 }}>
              {s.lang === 'ar' ? 'EN' : 'ع'}
            </button>
            <button className="btn sm icon ghost" onClick={toggleTheme} title={t('theme')} aria-label={t('theme')}>
              <Icon name={resolved === 'light' ? 'moon' : resolved === 'dark' ? 'eye' : 'sun'} />
            </button>
          </div>
        </div>
      </header>

      <main>
        {!e.ready ? <div className="empty"><Icon name="radar" size={40} /><div>…</div></div> : (
          <Boundary key={tab} name={'tab ' + tab} fallback={(p) => <TabCrash {...p} tab={tab} setTab={setTab} />}>
            {tab === 'home' ? <Dashboard onOpen={setDetail} />
              : tab === 'live' ? <Live onOpen={setDetail} />
              : tab === 'hunt' ? <Hunt />
                : tab === 'sigs' ? <Signatures />
                  : tab === 'reports' ? <Reports />
                    : <Settings />}
          </Boundary>
        )}
      </main>

      <nav className="tabbar" aria-label={t('tabsNav')}>
        <div className="tabbar-inner">
          {TABS.map((x) => (
            <button key={x.id} className={'tab' + (tab === x.id ? ' active' : '')} onClick={() => setTab(x.id)} aria-current={tab === x.id ? 'page' : undefined}>
              <Icon name={x.icon} size={21} />
              <span>{t(x.key)}</span>
              {x.id === 'live' && attn > 0 && <span className="badge">{attn}</span>}
              {x.id === 'reports' && sit && <span className="badge badge-accent" aria-label={t('sitRunning')}>●</span>}
            </button>
          ))}
        </div>
      </nav>

      <div className="toasts" aria-live="polite">
        {e.toasts.map((x) => {
          const body = <>{x.kind === 'alert' && <Icon name="bell" size={16} />}<span>{x.text}</span>{x.extra > 0 && <span className="badge badge-invert" dir="ltr">+{x.extra}</span>}</>
          return x.key && e.radios.has(x.key)
            ? <button key={x.id} type="button" className={'toast ' + x.kind} onClick={() => setDetail(x.key)}>{body}</button>
            : <div key={x.id} className={'toast ' + x.kind}>{body}</div>
        })}
      </div>

      {detail && (
        <Boundary key={detail} name="detail sheet" fallback={(p) => <SheetCrash {...p} onClose={closeDetail} />}>
          <Detail radioKey={detail} onClose={closeDetail} onHunt={(k) => { e.huntKey = k; setDetail(null); setTab('hunt'); e.emit() }} />
        </Boundary>
      )}

      {e.flood?.open && (
        <Boundary name="flood dialog" fallback={(p) => <SheetCrash {...p} onClose={() => e.resolveFlood(false)} />}>
          <Sheet title={<span className="row"><Icon name="alert" style={{ color: 'var(--warn)' }} />{t('floodTitle')}</span>} className="dialog">
            <p style={{ marginTop: 0 }}>{t('floodBody', { n: e.flood.n })}</p>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => e.resolveFlood(false)}>{t('continue')}</button>
              <button className="btn primary" onClick={() => e.resolveFlood(true)}>{t('hideThese')}</button>
            </div>
          </Sheet>
        </Boundary>
      )}

      {e.ready && !s.accepted && (
        <Boundary name="disclaimer" fallback={(p) => <SheetCrash {...p} />}>
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
            <div className="note info small">{t('tourLive')}</div>
            <button className="btn primary big" onClick={() => e.set({ accepted: true })}>{t('accept')}</button>
          </div>
        </Sheet>
        </Boundary>
      )}
    </div>
  )
}
