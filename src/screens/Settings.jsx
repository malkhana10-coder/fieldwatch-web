import { useEffect, useState, Fragment } from 'react'
import { useEngine, Icon, Seg, Switch, Setting, ConfirmButton } from '../ui.jsx'
import { download, pickFile } from '../engine/storage.js'

let deferredInstall = null
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (ev) => { ev.preventDefault(); deferredInstall = ev })
}

export function Settings() {
  const e = useEngine()
  const t = e.t
  const s = e.settings
  const [canInstall, setCanInstall] = useState(!!deferredInstall)
  useEffect(() => {
    const h = () => setCanInstall(true)
    window.addEventListener('beforeinstallprompt', h)
    return () => window.removeEventListener('beforeinstallprompt', h)
  }, [])
  const caps = [
    ['Web Bluetooth (LE scan)', !!navigator.bluetooth?.requestLEScan],
    ['Web Bluetooth (device picker)', !!navigator.bluetooth],
    ['Geolocation', 'geolocation' in navigator],
    ['Notifications', typeof Notification !== 'undefined'],
    ['Vibration', 'vibrate' in navigator],
    ['Speech synthesis', 'speechSynthesis' in window],
    ['Service worker (offline)', 'serviceWorker' in navigator],
    ['IndexedDB', 'indexedDB' in window],
    ['Wi-Fi scanning', false],
  ]
  return (
    <div className="stack">
      <div className="card">
        <Setting title={<span className="row"><Icon name="globe" />{t('language')}</span>}>
          <Seg value={s.lang} onChange={(v) => e.set({ lang: v })} options={[{ value: 'ar', label: 'العربية' }, { value: 'en', label: 'English' }]} />
        </Setting>
        <div className="setting" style={{ flexWrap: 'wrap' }}>
          <div className="row" style={{ flex: '1 0 100%' }}><Icon name="sun" />{t('theme')}</div>
          <Seg value={s.theme} onChange={(v) => e.set({ theme: v })} options={[
            { value: 'system', label: t('themeSystem') }, { value: 'light', icon: 'sun', label: t('themeLight') },
            { value: 'dark', icon: 'moon', label: t('themeDark') }, { value: 'night', label: t('themeNight') },
          ]} />
        </div>
        <Setting title={t('privacy')} hint={t('privacyHint')}><Switch checked={s.privacy} onChange={(v) => e.set({ privacy: v })} /></Setting>
      </div>

      <div className="section-title">{t('alerts')}</div>
      <div className="card">
        <Setting title={t('sound')}><Switch checked={s.sound} onChange={(v) => e.set({ sound: v })} /></Setting>
        <Setting title={t('vibrate')}><Switch checked={s.vibrate} onChange={(v) => e.set({ vibrate: v })} /></Setting>
        <Setting title={t('voice')}><Switch checked={s.voice} onChange={(v) => { e.set({ voice: v }); if (v) e.speak(t('speakHit', { sig: 'Fieldwatch' })) }} /></Setting>
        <Setting title={t('notify')}><Switch checked={s.notify} onChange={async (v) => {
          if (v && typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
            const p = await Notification.requestPermission().catch(() => 'denied')
            if (p !== 'granted') return e.toast(t('notSupported'), 'warn')
          }
          e.set({ notify: v })
        }} /></Setting>
        <Setting title={t('alertCooldown')}>
          <select className="input" style={{ width: 'auto' }} value={s.cooldown} onChange={(ev) => e.set({ cooldown: Number(ev.target.value) })}>
            {[15, 30, 60, 300, 900].map((n) => <option key={n} value={n}>{n >= 60 ? `${n / 60} ${t.lang === 'ar' ? 'د' : 'min'}` : `${n} ${t.lang === 'ar' ? 'ث' : 's'}`}</option>)}
          </select>
        </Setting>
        <Setting title={t('floodDetect')}><Switch checked={s.floodDetect} onChange={(v) => e.set({ floodDetect: v })} /></Setting>
      </div>

      <div className="section-title">{t('source')}</div>
      <div className="card">
        <Setting title={t('location')} hint={t('locationHint')}><Switch checked={s.location} onChange={(v) => e.set({ location: v })} /></Setting>
        <div className="setting" style={{ flexWrap: 'wrap' }}>
          <div style={{ flex: '1 0 100%' }}>{t('scanIntensity')}</div>
          <Seg value={s.density} onChange={(v) => e.set({ density: v })} options={[{ value: 'SAVER', label: t('saver') }, { value: 'BALANCED', label: t('balanced') }, { value: 'PERFORMANCE', label: t('performance') }]} />
        </div>
        <Setting title={t('sourceReplay')} hint={t('sourceReplayHint')}>
          <button className="btn sm" onClick={async () => {
            const f = await pickFile('.csv,.jsonl,.json,.txt')
            if (!f) return
            try { e.loadReplay(f.text); e.set({ source: 'replay' }) } catch (err) { e.toast(t('importFailed', { e: err.message }), 'warn') }
          }}><Icon name="upload" size={14} />{t('pickLog')}</button>
        </Setting>
      </div>

      <div className="section-title">{t('exportSettings')}</div>
      <div className="card card-pad row wrap">
        <button className="btn" onClick={() => download('fieldwatch-web-settings.json', e.exportSettings(), 'application/json')}><Icon name="download" size={15} />{t('exportSettings')}</button>
        <button className="btn" onClick={async () => {
          const f = await pickFile('.json')
          if (!f) return
          try { e.importSettings(f.text); e.toast('✓') } catch (err) { e.toast(t('importFailed', { e: err.message }), 'warn') }
        }}><Icon name="upload" size={15} />{t('importSettings')}</button>
        {canInstall && <button className="btn primary" onClick={async () => { deferredInstall?.prompt(); deferredInstall = null; setCanInstall(false) }}><Icon name="download" size={15} />{t('install')}</button>}
      </div>

      <div className="section-title">{t('diagnostics')}</div>
      <div className="card card-pad">
        <dl className="kv">
          {caps.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd><span className={'tag ' + (v ? 'ok' : 'warn')}>{v ? t('supported') : t('notSupported')}</span></dd></Fragment>)}
          <dt>{t('catalogVersion')}</dt><dd>#{e.catalogVersion} · {e.fleets.length}</dd>
          <dt>{t('radios')}</dt><dd>{e.radios.size}</dd>
          <dt>{t('log')}</dt><dd>{e.log.length}</dd>
        </dl>
      </div>

      <div className="section-title">{t('about')}</div>
      <div className="card card-pad stack small">
        <div><b>{t('appName')} Web</b> · {t('version')} 1.0.0 · {t('unofficial')}</div>
        <div className="muted">{t('disclaimer')}</div>
        <div className="muted">{t('disclaimerPort')}</div>
        <div className="muted" dir="ltr" style={{ textAlign: 'start' }}>Fieldwatch © 2026 Off Grid Pete LLC — MIT License. IEEE and Bluetooth SIG assigned-number tables are subject to those organizations' terms.</div>
        <a className="btn sm" href="https://github.com/OffGridPete/Fieldwatch" target="_blank" rel="noreferrer" style={{ alignSelf: 'flex-start', width: 'fit-content', textDecoration: 'none' }}><Icon name="github" size={14} />{t('original')}</a>
      </div>
      <ConfirmButton title={t('confirmResetAll')} confirmLabel={t('confirmResetAll')} onConfirm={() => e.resetAll()}><Icon name="trash" size={15} />{t('resetAll')}</ConfirmButton>
    </div>
  )
}
