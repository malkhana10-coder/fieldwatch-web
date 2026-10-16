import { useEffect, useState, Fragment } from 'react'
import { useEngine, Icon, Seg, Switch, Setting, ConfirmButton } from '../ui.jsx'
import { download, pickFile } from '../engine/storage.js'
import { APP_VERSION } from '../engine/engine.js'
import { isNativeApp } from './format.jsx'

let deferredInstall = null
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (ev) => { ev.preventDefault(); deferredInstall = ev })
}

export function Settings() {
  const e = useEngine()
  const t = e.t
  const s = e.settings
  const [canInstall, setCanInstall] = useState(!!deferredInstall)
  const [showBridge, setShowBridge] = useState(false)
  const native = isNativeApp()
  useEffect(() => {
    const h = () => setCanInstall(true)
    window.addEventListener('beforeinstallprompt', h)
    return () => window.removeEventListener('beforeinstallprompt', h)
  }, [])
  const caps = [
    ['capBleScan', !!navigator.bluetooth?.requestLEScan],
    ['capBlePicker', !!navigator.bluetooth],
    ['capGeo', 'geolocation' in navigator],
    ['capNotify', typeof Notification !== 'undefined'],
    ['capVibrate', 'vibrate' in navigator],
    ['capSpeech', 'speechSynthesis' in window],
    ['capSw', 'serviceWorker' in navigator],
    ['capIdb', 'indexedDB' in window],
    ['capWifi', false],
  ]
  return (
    <div className="stack">
      <div className="card">
        <Setting title={<span className="row"><Icon name="globe" />{t('language')}</span>}>
          <Seg value={s.lang} label={t('language')} onChange={(v) => e.set({ lang: v })} options={[{ value: 'ar', label: 'العربية' }, { value: 'en', label: 'English' }]} />
        </Setting>
        <div className="setting" style={{ flexWrap: 'wrap' }}>
          <div className="row" style={{ flex: '1 0 100%' }}><Icon name="sun" />{t('theme')}</div>
          <Seg value={s.theme} label={t('theme')} onChange={(v) => e.set({ theme: v })} options={[
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
        {/* The Android app's WebView has no Notification API, so the switch would do nothing there. */}
        {!native && <Setting title={t('notify')}><Switch checked={s.notify} onChange={async (v) => {
          if (v && typeof Notification === 'undefined') return e.toast(t('notSupported'), 'warn')
          if (v && Notification.permission !== 'granted') {
            const p = await Notification.requestPermission().catch(() => 'denied')
            if (p !== 'granted') return e.toast(t('notSupported'), 'warn')
          }
          e.set({ notify: v })
        }} /></Setting>}
        <Setting title={t('alertCooldown')}>
          <select className="input" style={{ width: 'auto' }} aria-label={t('alertCooldown')} value={s.cooldown} onChange={(ev) => e.set({ cooldown: Number(ev.target.value) })}>
            {[15, 30, 60, 300, 900].map((n) => <option key={n} value={n}>{n >= 60 ? t('nMin', { n: n / 60 }) : t('nSec', { n })}</option>)}
          </select>
        </Setting>
        <Setting title={t('floodDetect')}><Switch checked={s.floodDetect} onChange={(v) => e.set({ floodDetect: v })} /></Setting>
        <Setting title={t('sentinel')} hint={t('sentinelHint')}><Switch checked={s.sentinel} onChange={(v) => e.set({ sentinel: v })} /></Setting>
        {s.sentinel && <Setting title={t('sentinelNewOnly')} hint={t('sentinelNewOnlyHint')}><Switch checked={s.sentinelNewOnly} onChange={(v) => e.set({ sentinelNewOnly: v })} /></Setting>}
        <Setting title={t('trackerAlerts')} hint={t('trackerAlertsHint')}><Switch checked={s.trackerAlerts} onChange={(v) => e.set({ trackerAlerts: v })} /></Setting>
      </div>

      <div className="section-title">{t('watchedNets')}</div>
      <div className="card">
        <form className="setting" style={{ flexWrap: 'wrap' }} onSubmit={(ev) => {
          ev.preventDefault()
          const v = ev.target.net.value.trim()
          if (!v) return
          const cur = s.watchedNets || []
          if (!cur.some((w) => w.toLowerCase() === v.toLowerCase())) e.set({ watchedNets: [...cur, v] })
          ev.target.net.value = ''
        }}>
          <div className="grow" style={{ flex: '1 0 100%' }}>
            <div>{t('watchedNets')}</div>
            <div className="small muted">{t('watchedNetsHint')}</div>
          </div>
          <input className="input grow" name="net" dir="auto" placeholder={t('netName')} aria-label={t('netName')} style={{ minWidth: 0, minHeight: 38 }} />
          <button className="btn sm" type="submit"><Icon name="plus" size={14} />{t('addNet')}</button>
        </form>
        {(s.watchedNets || []).length > 0 && (
          <div className="setting" style={{ flexWrap: 'wrap', gap: 8 }}>
            {(s.watchedNets || []).map((w) => (
              <span key={w} className="chip">{w}<button className="btn sm icon ghost" onClick={() => e.set({ watchedNets: (s.watchedNets || []).filter((x) => x !== w) })} aria-label={t('delete')}><Icon name="x" size={13} /></button></span>
            ))}
          </div>
        )}
      </div>

      <div className="section-title">{t('tgSection')}</div>
      <div className="card">
        <Setting title={t('tgEnabled')} hint={t('tgHint')}><Switch checked={s.tgEnabled} onChange={(v) => e.set({ tgEnabled: v })} /></Setting>
        <div className="setting" style={{ flexWrap: 'wrap' }}>
          <div style={{ flex: '1 0 100%' }}>{t('tgToken')}</div>
          <input className="input" type="password" dir="ltr" aria-label={t('tgToken')} value={s.tgToken || ''} placeholder="123456789:AA…" autoComplete="off" onChange={(ev) => e.set({ tgToken: ev.target.value.trim() })} />
        </div>
        <div className="setting" style={{ flexWrap: 'wrap' }}>
          <div style={{ flex: '1 0 100%' }}>{t('tgChatId')}</div>
          <input className="input" dir="ltr" aria-label={t('tgChatId')} value={s.tgChatId || ''} placeholder="123456789" autoComplete="off" onChange={(ev) => e.set({ tgChatId: ev.target.value.trim() })} />
        </div>
        <div className="setting" style={{ justifyContent: 'flex-end' }}>
          <button className="btn sm" onClick={async () => {
            if (!s.tgToken || !s.tgChatId) return e.toast(t('tgNeedToken'), 'warn')
            const err = await e.sendTelegram(t('appName') + ' — ' + t('tgTest'))
            err ? e.toast(t('tgFail', { e: err }), 'warn') : e.toast(t('tgSent'))
          }}><Icon name="bell" size={14} />{t('tgTest')}</button>
        </div>
      </div>

      <div className="section-title">{t('source')}</div>
      <div className="card">
        <Setting title={t('location')} hint={t('locationHint')}><Switch checked={s.location} onChange={(v) => e.set({ location: v })} /></Setting>
        <div className="setting" style={{ flexWrap: 'wrap' }}>
          <div style={{ flex: '1 0 100%' }}>{t('scanIntensity')}</div>
          <Seg value={s.density} label={t('scanIntensity')} onChange={(v) => e.set({ density: v })} options={[{ value: 'SAVER', label: t('saver') }, { value: 'BALANCED', label: t('balanced') }, { value: 'PERFORMANCE', label: t('performance') }]} />
        </div>
        <div className="setting" style={{ flexWrap: 'wrap' }}>
          <div style={{ flex: '1 0 100%' }}>
            <div>{t('bridgeUrl')}</div>
            <div className="small muted">{t('bridgeUrlHint')}</div>
          </div>
          <div className="row" style={{ flex: '1 0 100%', minWidth: 0 }}>
            <input className="input grow" type={showBridge ? 'text' : 'password'} dir="ltr" aria-label={t('bridgeUrl')} value={s.bridgeUrl || ''} placeholder="ws://127.0.0.1:8765/?token=…" autoComplete="off" spellCheck={false} onChange={(ev) => e.set({ bridgeUrl: ev.target.value.trim() })} />
            <button type="button" className="btn icon" aria-pressed={showBridge} aria-label={showBridge ? t('hideSecret') : t('showSecret')} title={showBridge ? t('hideSecret') : t('showSecret')} onClick={() => setShowBridge(!showBridge)}>
              <Icon name={showBridge ? 'eyeOff' : 'eye'} size={16} />
            </button>
          </div>
          {e.bridgeState && <div className="small" style={{ flex: '1 0 100%' }}>
            <span className={'tag ' + (e.bridgeState === 'open' ? 'ok' : e.bridgeState === 'denied' || e.bridgeState === 'error' ? 'attn' : '')}>{t('bridge_' + e.bridgeState)}</span>
            {e.bridgeInfo && <span className="faint"> · {e.bridgeInfo.platform} · Wi-Fi {e.bridgeInfo.caps.wifi ? '✓' : '✗'} · BLE {e.bridgeInfo.caps.ble ? '✓' : '✗'}</span>}
          </div>}
        </div>
        <Setting title={t('sourceReplay')} hint={t('sourceReplayHint')}>
          <button className="btn sm" disabled={e.running} onClick={async () => {
            if (e.running) return
            const f = await pickFile('.csv,.jsonl,.json,.txt')
            if (!f) return
            try { e.loadReplay(f.text); e.set({ source: 'replay' }) } catch (err) { e.toast(t('importFailed', { e: err.message }), 'warn') }
          }}><Icon name="upload" size={14} />{t('pickLog')}</button>
        </Setting>
      </div>

      <div className="section-title">{t('aiSection')}</div>
      <div className="card">
        <div className="setting" style={{ flexWrap: 'wrap' }}>
          <div style={{ flex: '1 0 100%' }}>
            <div>{t('aiKey')}</div>
            <div className="small muted">{t('aiKeyHint')}</div>
          </div>
          <input className="input" type="password" dir="ltr" aria-label={t('aiKey')} value={s.aiKey || ''} placeholder="sk-ant-…" autoComplete="off" onChange={(ev) => e.set({ aiKey: ev.target.value.trim() })} />
        </div>
      </div>

      <div className="section-title">{t('placeTitle')}</div>
      <div className="card">
        <Setting title={t('forgetPlaces')} hint={t('forgetPlacesHint', { n: Object.keys(e.mem.devices).length })}>
          <ConfirmButton className="btn sm danger" confirmLabel={t('tapConfirm')} onConfirm={() => e.forgetPlaces()}><Icon name="trash" size={14} />{t('forgetPlaces')}</ConfirmButton>
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
        {/* Like the sit and log exports, the backup holds full MACs and coordinates: off in privacy mode. */}
        <button className="btn" disabled={s.privacy} title={s.privacy ? t('privacyHint') : undefined} onClick={() => download('fieldwatch-backup.json', e.exportAll(), 'application/json')}><Icon name="download" size={15} />{t('exportAll')}</button>
        <button className="btn" onClick={async () => {
          const f = await pickFile('.json')
          if (!f) return
          try { const r = await e.importAll(f.text); e.toast(t('importedAll', { n: r.sits, m: r.log })) } catch (err) { e.toast(t('importFailed', { e: err.message }), 'warn') }
        }}><Icon name="upload" size={15} />{t('importAll')}</button>
        {canInstall && <button className="btn primary" onClick={async () => { deferredInstall?.prompt(); deferredInstall = null; setCanInstall(false) }}><Icon name="download" size={15} />{t('install')}</button>}
      </div>
      <div className="small muted" style={{ padding: '0 4px 8px' }}>{t('backupHint')}{s.privacy && <> {t('exportAllPrivacy')}</>}</div>

      <div className="section-title">{t('diagnostics')}</div>
      <div className="card card-pad">
        <dl className="kv">
          {caps.map(([k, v]) => <Fragment key={k}><dt>{t(k)}</dt><dd><span className={'tag ' + (v ? 'ok' : 'warn')}>{v ? t('supported') : t('notSupported')}</span></dd></Fragment>)}
          <dt>{t('catalogVersion')}</dt><dd>#{e.catalogVersion} · {e.fleets.length}</dd>
          <dt>{t('radios')}</dt><dd>{e.radios.size}</dd>
          <dt>{t('log')}</dt><dd>{e.log.length}</dd>
        </dl>
      </div>

      <div className="section-title">{t('about')}</div>
      <div className="card card-pad stack small">
        <div><b>{t('appName')} Web</b> · {t('version')} {APP_VERSION} · {t('unofficial')}</div>
        <div className="muted">{t('disclaimer')}</div>
        <div className="muted">{t('disclaimerPort')}</div>
        <div className="muted" dir="ltr" style={{ textAlign: 'start' }}>Fieldwatch © 2026 Off Grid Pete LLC — MIT License. IEEE and Bluetooth SIG assigned-number tables are subject to those organizations' terms.</div>
        <a className="btn sm" href="https://github.com/OffGridPete/Fieldwatch" target="_blank" rel="noreferrer" style={{ alignSelf: 'flex-start', width: 'fit-content', textDecoration: 'none' }}><Icon name="github" size={14} />{t('original')}</a>
      </div>
      <ConfirmButton title={t('confirmResetAll')} confirmLabel={t('confirmResetAll')} onConfirm={() => e.resetAll()}><Icon name="trash" size={15} />{t('resetAll')}</ConfirmButton>
    </div>
  )
}
