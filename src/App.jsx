import { useEffect, useState } from 'react'
import { useEngine, Icon, Sheet } from './ui.jsx'
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

const TABS = [
  { id: 'home', icon: 'home', key: 'tabHome' },
  { id: 'live', icon: 'radar', key: 'tabLive' },
  { id: 'hunt', icon: 'target', key: 'tabHunt' },
  { id: 'sigs', icon: 'book', key: 'tabSignatures' },
  { id: 'reports', icon: 'file', key: 'tabReports' },
  { id: 'settings', icon: 'gear', key: 'tabSettings' },
]

export default function App() {
  const e = useEngine()
  const t = e.t
  const s = e.settings
  const resolved = useTheme(s.theme)
  const [tab, setTab] = useState(() => (location.hash.slice(1) || 'home'))
  const [detail, setDetail] = useState(null)

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
        {!e.ready ? <div className="empty"><Icon name="radar" size={40} /><div>…</div></div>
          : tab === 'home' ? <Dashboard onOpen={setDetail} />
            : tab === 'live' ? <Live onOpen={setDetail} />
            : tab === 'hunt' ? <Hunt />
              : tab === 'sigs' ? <Signatures />
                : tab === 'reports' ? <Reports />
                  : <Settings />}
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

      {detail && <Detail radioKey={detail} onClose={() => setDetail(null)} onHunt={(k) => { e.huntKey = k; setDetail(null); setTab('hunt'); e.emit() }} />}

      {e.flood?.open && (
        <Sheet title={<span className="row"><Icon name="alert" style={{ color: 'var(--warn)' }} />{t('floodTitle')}</span>} className="dialog">
          <p style={{ marginTop: 0 }}>{t('floodBody', { n: e.flood.n })}</p>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => e.resolveFlood(false)}>{t('continue')}</button>
            <button className="btn primary" onClick={() => e.resolveFlood(true)}>{t('hideThese')}</button>
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
            <div className="note info small">{t('tourLive')}</div>
            <button className="btn primary big" onClick={() => e.set({ accepted: true })}>{t('accept')}</button>
          </div>
        </Sheet>
      )}
    </div>
  )
}
