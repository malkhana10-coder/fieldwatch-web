import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { engine } from './engine/engine.js'
import { isNative } from './native.js'
import './styles.css'

engine.init()
createRoot(document.getElementById('root')).render(<App />)

window.addEventListener('pagehide', () => { if (engine.running) engine.stop() })

// download() reports failed saves in the Android app here (exports go through the share sheet there).
window.addEventListener('fw-download-failed', (ev) => {
  engine.toast(engine.t('exportFailed', { file: ev.detail?.file ?? '', e: ev.detail?.error ?? '' }), 'warn')
})

// The Android app (Capacitor) already ships every file inside the APK, so it needs no service worker.
if ('serviceWorker' in navigator && import.meta.env.PROD && location.protocol === 'https:' && !isNative()) {
  navigator.serviceWorker.register('sw.js').catch(() => {})
}
