import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { engine } from './engine/engine.js'
import './styles.css'

engine.init()
createRoot(document.getElementById('root')).render(<App />)

window.addEventListener('pagehide', () => { if (engine.running) engine.stop() })

// The Android app (Capacitor) already ships every file inside the APK, so it needs no service worker.
const native = !!window.Capacitor?.isNativePlatform?.()
if ('serviceWorker' in navigator && import.meta.env.PROD && location.protocol === 'https:' && !native) {
  navigator.serviceWorker.register('sw.js').catch(() => {})
}
