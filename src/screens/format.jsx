// Small display helpers shared by the screens. Everything here is pure (no engine
// import), so test/fix-ui-screens.test.js can exercise it directly.
import { Fragment } from 'react'
import { maskMac } from '../engine/geo.js'
import { normMac } from '../engine/catalog.js'

const has = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k)

/** True inside the Capacitor Android app (no Web Bluetooth, Notification API or print there). */
export const isNativeApp = () => typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.()

/**
 * A number and its unit that must never be split across lines ("187 m", "-0.5 م/ث", "-56 dBm").
 * The number is its own LTR isolate, so a minus sign stays on its left in Arabic; the
 * pair itself takes its direction from the unit (dir=auto), so Latin units read "-56 dBm".
 */
export function NumUnit({ v, u }) {
  return <span className="num-unit" dir="auto"><bdi dir="ltr">{v}</bdi>{u ? ' ' + u : null}</span>
}

/** Distance node with localized units, kept on one line. */
export function Dist({ m, t }) {
  if (m == null || !Number.isFinite(m)) return '—'
  return m >= 1000 ? <NumUnit v={(m / 1000).toFixed(1)} u={t('km')} /> : <NumUnit v={Math.round(m)} u={t('m')} />
}

/** Like t(key, vars), but vars may be React nodes: returns an array of strings and nodes. */
export function tNode(t, key, vars = {}) {
  return String(t(key)).split(/(\{\w+\})/).filter((p) => p !== '').map((p, i) => {
    const m = /^\{(\w+)\}$/.exec(p)
    return m && has(vars, m[1]) ? <Fragment key={i}>{vars[m[1]]}</Fragment> : p
  })
}

/** Label for a numbered enum (ID type, UA type, status): out-of-range values read "Reserved (n)", never a raw key. */
export function enumLabel(t, prefix, n, max) {
  return Number.isInteger(n) && n >= 0 && n <= max ? t(prefix + n) : t('idTypeOther', { n: String(n) })
}

const MAC_RE = /\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g
/** Mask every full MAC address inside free text (notes, rule descriptions) when privacy mode is on. */
export const maskMacsIn = (s, on) => (on && typeof s === 'string' ? s.replace(MAC_RE, (m) => maskMac(normMac(m), true)) : s)

/** Decoded field that holds a latitude or longitude (Remote ID position, operator position…). */
export const isCoordField = (f) => [f?.id, f?.label].some((x) => typeof x === 'string' && /(^|[^a-z])(lat|lon|latitude|longitude)([^a-z]|$)/i.test(x))

/** What to show for one decoded field: strings only (imported specs are untrusted), coordinates and MACs masked in privacy mode. */
export function decodedView(f, privacy) {
  const label = String(f?.label ?? f?.id ?? '')
  const value = String(f?.value ?? '')
  if (!privacy) return { label, value }
  return { label, value: isCoordField(f) ? '••' : maskMacsIn(value, true) }
}

/**
 * A revision of the named-device map. engine.setNamed mutates `named` in place, so memos
 * that depend on Mine / names must key on its content, not on the object.
 */
export const namedRev = (named) => {
  try { return JSON.stringify(named) } catch { return String(Math.random()) }
}

/** In privacy mode, keep the full MAC out of a suggested signature's name and notes (its rules keep it, so it still matches). */
export function privateSuggestion(fleet, mac, on) {
  if (!on || !fleet || !mac) return fleet
  const full = normMac(mac)
  if (full.length < 17) return fleet
  const masked = maskMac(full, true)
  const tail = full.slice(-8)
  const fix = (s) => (typeof s === 'string' ? s.split(full).join(masked).split(tail).join(masked) : s)
  return { ...fleet, name: fix(fleet.name), notes: fix(fleet.notes), attentionNote: fix(fleet.attentionNote) }
}

/** MAC-valued signature rule whose value privacy mode hides (an OUI alone is not personal). */
export const isPrivateMacRule = (r, on) => !!on && (r?.kind === 'MAC_PREFIX' || r?.kind === 'OUI') && normMac(r.text).length > 8

/**
 * One-line "MAC · kind · vendor · time" row. The fixed parts never shrink; only the vendor
 * does, with an ellipsis that keeps the start of its (usually Latin) text.
 */
export function MetaLine({ start, shrink, end }) {
  const sep = ' · '
  return (
    <div className="tiny faint" style={{ display: 'flex', alignItems: 'baseline', whiteSpace: 'nowrap', overflow: 'hidden', minWidth: 0 }}>
      <span style={{ flex: 'none' }}>{start}</span>
      {shrink ? <><span style={{ flex: 'none' }}>{sep}</span><bdi className="ellipsis ellipsis-start" dir="auto">{shrink}</bdi></> : null}
      {end ? <span style={{ flex: 'none' }}>{sep}{end}</span> : null}
    </div>
  )
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

/**
 * A standalone, light, print-friendly HTML document around a report body (used to share
 * the debrief from the Android app, which cannot print). `body` is serialized DOM.
 */
export function reportDocument({ title, lang, dir, css = '', body, fontHref }) {
  const safeCss = String(css).replace(/<\/style/gi, '<\\/style')
  const font = fontHref && /^https:\/\/fonts\.googleapis\.com\//.test(fontHref) ? `<link rel="stylesheet" href="${esc(fontHref)}">\n` : ''
  return `<!doctype html>
<html lang="${esc(lang)}" dir="${esc(dir)}" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${esc(title)}</title>
${font}<style>${safeCss}</style>
<style>
html, body { background: #fff !important; color: #0f1a17; }
body { margin: 0; padding: 16px; font-family: var(--font); }
.fw-report { max-width: 960px; margin: 0 auto; }
.print-only { display: block !important; }
.no-print { display: none !important; }
.card, .hero, .stat { box-shadow: none !important; break-inside: avoid; }
.report-head { padding: 8px 0 16px; border-bottom: 2px solid #000; margin-bottom: 12px; }
</style>
</head>
<body>
<main class="fw-report">${body}</main>
</body>
</html>
`
}
