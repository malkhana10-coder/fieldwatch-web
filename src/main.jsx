import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { engine } from './engine/engine.js'
import './styles.css'

engine.init()
// Handy for support and automated tests: inspect state from the console.
window.fieldwatch = engine
createRoot(document.getElementById('root')).render(<App />)

window.addEventListener('pagehide', () => { if (engine.running) engine.stop() })

// Offline cache + "new version available" notice.
if ('serviceWorker' in navigator && import.meta.env.PROD && location.protocol === 'https:' && typeof window.claude?.use !== 'function') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      reg.addEventListener('updatefound', () => {
        const w = reg.installing
        w?.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) { engine.updateReady = true; engine.emit() }
        })
      })
      setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000)
    }).catch(() => {})
  })
}
