import { useSyncExternalStore, useEffect, useLayoutEffect, useState, useRef, useId, Children, cloneElement, isValidElement } from 'react'
import { engine } from './engine/engine.js'

export function useEngine() {
  useSyncExternalStore(engine.subscribe, engine.getVersion)
  return engine
}

const P = {
  wifi: 'M5 12.55a11 11 0 0 1 14.08 0M1.42 9a16 16 0 0 1 21.16 0M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01',
  ble: 'm7 7 10 10-5 5V2l5 5L7 17',
  tag: 'M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42zM7.5 7.5h.01',
  beacon: 'M4.9 16.1C1 12.2 1 5.8 4.9 1.9M7.8 4.7a6.14 6.14 0 0 0-.8 7.5M16.2 4.8c2 2 2.26 5.11.8 7.47M19.1 1.9a10 10 0 0 1 0 14.1M9.5 18h5M8 22l4-11 4 11',
  monitor: 'M2 3h20v14H2zM8 21h8M12 17v4',
  watch: 'M12 10v2.2l1.6 1M16.13 7.66l-.81-4.05a2 2 0 0 0-2-1.61h-2.68a2 2 0 0 0-2 1.61l-.78 4.05M7.88 16.36l.8 4a2 2 0 0 0 2 1.61h2.72a2 2 0 0 0 2-1.61l.81-4.05M18 12a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z',
  cctv: 'M16.75 12h3.632a1 1 0 0 1 .894 1.447l-2.034 4.069a1 1 0 0 1-1.708.134l-2.124-2.97M17.106 9.053a1 1 0 0 1 .447 1.341l-3.106 6.211a1 1 0 0 1-1.342.447L3.61 12.3a2.92 2.92 0 0 1-1.3-3.91L3.69 5.6a2.92 2.92 0 0 1 3.92-1.3zM2 19h3.76a2 2 0 0 0 1.8-1.1L9 15M2 21v-4M7 9h.01',
  drone: 'M12 10h.01M5 5a2 2 0 1 0 0 .01M19 5a2 2 0 1 0 0 .01M5 19a2 2 0 1 0 0 .01M19 19a2 2 0 1 0 0 .01M7 7l3 3m4 0 3-3M7 17l3-3m4 0 3 3M10 10h4v4h-4z',
  bug: 'm8 2 1.88 1.88M14.12 3.88 16 2M9 7.13v-1a3.003 3.003 0 1 1 6 0v1M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6M12 20v-9M6.53 9C4.6 8.8 3 7.1 3 5M6 13H2M3 21c0-2.1 1.7-3.9 3.8-4M20.97 5c0 2.1-1.6 3.8-3.5 4M22 13h-4M17.2 17c2.1.1 3.8 1.9 3.8 4',
  shield: 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z',
  car: 'M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2M7 17a2 2 0 1 0 0 .01M9 17h6M17 17a2 2 0 1 0 0 .01',
  glasses: 'M6 15a4 4 0 1 0 0 .01M18 15a4 4 0 1 0 0 .01M14 15a2 2 0 0 0-4 0M2.5 13 5 7c.7-1.3 1.4-2 3-2M21.5 13 19 7c-.7-1.3-1.5-2-3-2',
  headphones: 'M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3',
  camera: 'M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3zM12 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  thermo: 'M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z',
  lock: 'M5 11h14v10H5zM7 11V7a5 5 0 0 1 10 0v4',
  heart: 'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z',
  home: 'M3 10l9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 22V12h6v10',
  router: 'M2 14h20v6H2zM6.01 18H6M10.01 18H10M15 10v4M17.84 7.17a4 4 0 0 0-5.66 0M20.66 4.34a8 8 0 0 0-11.31 0',
  mesh: 'M16 16h6v6h-6zM2 16h6v6H2zM9 2h6v6H9zM5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3M12 12V8',
  phone: 'M5 2h14v20H5zM12 18h.01',
  dot: 'M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
  play: 'M6 3l14 9-14 9V3z',
  stop: 'M6 6h12v12H6z',
  radar: 'M19.07 4.93A10 10 0 0 0 6.99 3.34M4 6h.01M2.29 9.62A10 10 0 1 0 21.31 8.35M16.24 7.76A6 6 0 1 0 8.23 16.67M12 18h.01M17.99 11.66A6 6 0 0 1 15.77 16.67M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M13.41 10.59l5.66-5.66',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  chart: 'M3 3v18h18M7 16l4-6 4 3 5-7',
  target: 'M12 12m-10 0a10 10 0 1 0 20 0a10 10 0 1 0-20 0M12 12m-6 0a6 6 0 1 0 12 0a6 6 0 1 0-12 0M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
  book: 'M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8',
  gear: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  filter: 'M22 3H2l8 9.46V19l4 2v-8.54L22 3z',
  x: 'M18 6 6 18M6 6l12 12',
  back: 'm15 18-6-6 6-6',
  star: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
  alert: 'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01',
  copy: 'M8 8h12v12H8zM16 8V4H4v12h4',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  plus: 'M12 5v14M5 12h14',
  trash: 'M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4h6v2',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41',
  moon: 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z',
  globe: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z',
  user: 'M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  bell: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0',
  pin: 'M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0ZM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01',
  check: 'M20 6 9 17l-5-5',
  eye: 'M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  eyeOff: 'M9.88 9.88a3 3 0 1 0 4.24 4.24M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61M2 2l20 20',
  github: 'M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4M9 18c-4.51 2-5-2-7-2',
  sparkle: 'M12 3l1.9 5.8L20 10l-6.1 1.2L12 17l-1.9-5.8L4 10l6.1-1.2z',
}

export function Icon({ name, size = 18, stroke = 2, style, className }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" style={style} className={className} aria-hidden="true">
      <path d={P[name] || P.dot} />
    </svg>
  )
}

export const CLASS_ICON = {
  FINDER: 'tag', BEACON: 'beacon', SIGNAGE: 'monitor', WEARABLE: 'watch', BODYWORN: 'watch', SURVEILLANCE: 'cctv', DRONE: 'drone',
  HACKING: 'bug', LAW_ENFORCEMENT: 'shield', VEHICLE: 'car', GLASSES: 'glasses', AUDIO: 'headphones', CAMERA: 'camera',
  THERMOSTAT: 'thermo', LOCK: 'lock', HEALTH: 'heart', HOME: 'home', ISP: 'router', MESH: 'mesh', PHONE: 'phone', OTHER: 'dot',
}

export function Glyph({ r, color }) {
  const name = r.cls ? CLASS_ICON[r.cls] : r.kind === 'WIFI' ? 'wifi' : 'ble'
  return (
    <div className="glyph" style={color ? { color, background: `color-mix(in srgb, ${color} 14%, transparent)` } : undefined}>
      <Icon name={name} size={20} />
    </div>
  )
}

export function Bars({ rssi }) {
  const lvl = rssi >= -55 ? 4 : rssi >= -67 ? 3 : rssi >= -78 ? 2 : rssi >= -90 ? 1 : 0
  return (
    <span className="bars" aria-hidden="true">
      {[4, 7, 10, 14].map((h, i) => <i key={i} className={i < lvl ? 'on' : ''} style={{ height: h }} />)}
    </span>
  )
}

export function Sparkline({ data, width = 120, height = 28, min = -100, max = -30, color = 'var(--accent)' }) {
  if (!data || data.length < 2) return <svg width={width} height={height} />
  const t0 = data[0][0]
  const t1 = data[data.length - 1][0] || t0 + 1
  const x = (t) => ((t - t0) / Math.max(1, t1 - t0)) * (width - 2) + 1
  const y = (v) => height - 1 - ((Math.max(min, Math.min(max, v)) - min) / (max - min)) * (height - 2)
  const d = data.map(([t, v], i) => `${i ? 'L' : 'M'}${x(t).toFixed(1)},${y(v).toFixed(1)}`).join('')
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ direction: 'ltr' }}>
      <path d={d} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  )
}

/** Toggle. Give it an accessible name with `label` (text) or `labelledBy` (element id). */
export function Switch({ checked, onChange, label, labelledBy }) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" checked={!!checked} onChange={(e) => onChange(e.target.checked)}
        aria-label={labelledBy ? undefined : label} aria-labelledby={labelledBy} />
      <span />
    </label>
  )
}

/** Segmented control. An option may carry `aria` (its accessible name and tooltip) for icon-only layouts. */
export function Seg({ value, options, onChange, label }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}
          aria-label={o.aria} title={o.aria}>
          {o.icon && <Icon name={o.icon} size={15} />}{o.label}
        </button>
      ))}
    </div>
  )
}

// Open dialogs, innermost last: only the topmost one reacts to Escape and traps Tab.
const sheetStack = []
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function Sheet({ title, onClose, children, actions, className = '' }) {
  const ref = useRef(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const titleId = useId()
  useLayoutEffect(() => {
    const node = ref.current
    const opener = document.activeElement
    sheetStack.push(node)
    node.focus({ preventScroll: true })
    const onKey = (ev) => {
      if (sheetStack[sheetStack.length - 1] !== node) return
      if (ev.key === 'Escape') {
        if (closeRef.current) { ev.preventDefault(); closeRef.current() }
        return
      }
      if (ev.key !== 'Tab') return
      const items = [...node.querySelectorAll(FOCUSABLE)].filter((el) => el.getClientRects().length)
      if (!items.length) { ev.preventDefault(); node.focus(); return }
      const first = items[0]
      const last = items[items.length - 1]
      const cur = document.activeElement
      if (!node.contains(cur)) { ev.preventDefault(); (ev.shiftKey ? last : first).focus() }
      else if (ev.shiftKey && (cur === first || cur === node)) { ev.preventDefault(); last.focus() }
      else if (!ev.shiftKey && cur === last) { ev.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      const i = sheetStack.lastIndexOf(node)
      if (i >= 0) sheetStack.splice(i, 1)
      const back = sheetStack[sheetStack.length - 1]
      if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus({ preventScroll: true })
      else if (back) back.focus({ preventScroll: true })
    }
  }, [])
  return (
    <div className="scrim" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      <div ref={ref} className={'sheet ' + className} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className="sheet-head">
          <div className="grow" id={titleId} style={{ fontWeight: 700, fontSize: 17, minWidth: 0 }}>{title}</div>
          {actions}
          {onClose && <button className="btn sm icon ghost" onClick={onClose} aria-label={engine.t('close')} title={engine.t('close')}><Icon name="x" /></button>}
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  )
}

/** A settings row. A Switch placed directly inside is named by the row's title. */
export function Setting({ title, hint, children }) {
  const id = useId()
  const kids = Children.map(children, (c) => (isValidElement(c) && c.type === Switch && !c.props.label && !c.props.labelledBy
    ? cloneElement(c, typeof title === 'string' ? { label: title } : { labelledBy: id })
    : c))
  return (
    <div className="setting">
      <div className="grow">
        <div id={id}>{title}</div>
        {hint && <div className="small muted">{hint}</div>}
      </div>
      {kids}
    </div>
  )
}

export function ago(t, ms, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 2) return t('justNow')
  if (s < 120) return t('ago', { n: s })
  const m = Math.round(s / 60)
  return t('agoMin', { n: m })
}

export function fmtDur(ms, t) {
  const s = Math.round(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    try { document.execCommand('copy') } catch { /* ignore */ }
    ta.remove()
    return true
  }
}

/** Two-tap confirmation: first tap arms the button, second tap within 4 s runs it. Works where confirm() is blocked. */
/** Recompute heavy derived data at most once per `ms` (plus whenever `deps` change). */
export const tickOf = (ms, now = Date.now()) => Math.floor(now / ms)

export function ConfirmButton({ onConfirm, children, confirmLabel, className = 'btn danger', ...rest }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const id = setTimeout(() => setArmed(false), 4000)
    return () => clearTimeout(id)
  }, [armed])
  return (
    <button {...rest} aria-label={armed ? confirmLabel : rest['aria-label']} className={className + (armed ? ' solid' : '')} onClick={() => (armed ? (setArmed(false), onConfirm()) : setArmed(true))}>
      {armed ? confirmLabel : children}
    </button>
  )
}
