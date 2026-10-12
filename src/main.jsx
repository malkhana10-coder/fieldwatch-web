import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { engine } from './engine/engine.js'
import './styles.css'

engine.init()
createRoot(document.getElementById('root')).render(<App />)

window.addEventListener('pagehide', () => { if (engine.running) engine.stop() })

if ('serviceWorker' in navigator && import.meta.env.PROD && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}))
}
