// Field intelligence on top of raw sightings: linking rotating BLE addresses back
// to one physical device, tracker "separated from owner" state, a per-place
// memory of devices (familiar here / seen in several places), and RSSI-based
// localization of a device from readings taken while walking.
// Everything here is pure or self-contained so it can be unit-tested.
import { distM } from './geo.js'

// ---------- address rotation linking ----------

/**
 * What a device keeps constant when it rotates its random BLE address: name,
 * advertised services, manufacturer and the payload type byte. RSSI and the
 * address itself are deliberately left out.
 */
export function advFingerprint(r) {
  if (r.kind !== 'BLE') return null
  const parts = [r.name || '']
  parts.push([...(r.uuids || [])].map((u) => String(u).toUpperCase()).sort().join(','))
  parts.push([...(r.svcData || [])].map((s) => String(s.uuid).toUpperCase()).sort().join(','))
  parts.push((r.mfg || []).map((m) => `${m.companyId}/${String(m.dataHex || '').slice(0, 2).toUpperCase()}`).sort().join(','))
  // Manufacturer data alone (every iPhone sends Apple 0x10…) is far too common to
  // tell two devices apart: require a name, a service UUID or service data.
  if (!parts[0] && !parts[1] && !parts[2]) return null
  return parts.join('|')
}

export const LINK_WINDOW_MS = 20000
const LINK_SETTLE_MS = 3000
const LINK_MAX_RSSI_GAP = 10
const LINK_MARGIN = 6

/**
 * Find the radio that `r` most likely replaced after an address rotation.
 * The predecessor must have gone quiet before `r` appeared (never overlapping),
 * share the fingerprint, sound about as loud, and be clearly the best match
 * when several candidates exist. Returns the candidate or null.
 */
export function findPredecessor(radios, r, now) {
  if (r.kind !== 'BLE' || !r.randomized || now - r.firstSeen < LINK_SETTLE_MS) return null
  const fp = advFingerprint(r)
  if (!fp) return null
  const scored = []
  for (const c of radios) {
    if (c === r || c.kind !== 'BLE' || !c.randomized || c.succeededBy) continue
    if (!(c.lastSeen < r.firstSeen) || r.firstSeen - c.lastSeen > LINK_WINDOW_MS) continue
    if (advFingerprint(c) !== fp) continue
    const rssiGap = Math.abs((r.history?.[0]?.[1] ?? r.rssi) - c.rssi)
    if (rssiGap > LINK_MAX_RSSI_GAP) continue
    scored.push({ c, score: rssiGap + (r.firstSeen - c.lastSeen) / 2000 })
  }
  if (!scored.length) return null
  scored.sort((a, b) => a.score - b.score)
  if (scored.length > 1 && scored[1].score - scored[0].score < LINK_MARGIN) return null
  return scored[0].c
}

/** Carry identity, earlier addresses and the co-travel trail from `prev` onto `r`. */
export function linkRadios(prev, r) {
  prev.succeededBy = r.key
  r.identity = prev.identity || prev.key
  r.identityFirstSeen = prev.identityFirstSeen || prev.firstSeen
  r.prevMacs = [...(prev.prevMacs || []), prev.mac].slice(-12)
  r.positions = [...(prev.positions || []), ...(r.positions || [])].slice(-40)
  r.samples = [...(prev.samples || []), ...(r.samples || [])].slice(-150)
  return r
}

// ---------- trackers ----------

const BATTERY = ['full', 'medium', 'low', 'critical']

/**
 * Is this a tracker that is away from its owner?
 * - Apple Find My: the full "offline finding" advert (type 0x12, length 0x19)
 *   is only broadcast when the item is separated from its owner; the short
 *   0x12/0x02 form means the owner's device is nearby.
 * - Any tracker: while near its owner it rotates its address about every
 *   15 minutes; separated, it keeps one address for many hours. An unchanged
 *   address for over 30 minutes is therefore a strong hint.
 * Returns null for non-trackers, else { separated: true|false|null, why, battery? }.
 */
export function trackerState(r, now = Date.now()) {
  if (r.kind !== 'BLE') return null
  const apple = (r.mfg || []).find((m) => m.companyId === 76 && /^12/i.test(m.dataHex || ''))
  if (apple) {
    const hex = apple.dataHex
    const len = parseInt(hex.slice(2, 4), 16)
    if (len === 0x19 && hex.length >= 2 * (2 + 0x19)) {
      const status = parseInt(hex.slice(4, 6), 16)
      return { separated: true, why: 'tsAppleSeparated', battery: BATTERY[(status >> 6) & 3] }
    }
    if (len === 0x02) return { separated: false, why: 'tsAppleNearOwner' }
  }
  if (!apple && r.cls !== 'FINDER') return null
  if (r.randomized && now - r.firstSeen > 30 * 60 * 1000) return { separated: true, why: 'tsStableAddress' }
  return { separated: null, why: 'tsUnknown' }
}

// ---------- place memory ----------

export const CELL_DEG = 0.003 // ≈ 330 m of latitude
export const NO_PLACE = 'here'

export function cellOf(pos) {
  if (!pos || pos.lat == null || pos.lon == null) return NO_PLACE
  return `${Math.round(pos.lat / CELL_DEG)}:${Math.round(pos.lon / CELL_DEG)}`
}
export function cellCenter(cell) {
  if (!cell || cell === NO_PLACE) return null
  const [a, b] = cell.split(':').map(Number)
  return { lat: a * CELL_DEG, lon: b * CELL_DEG }
}
export function dayOf(ms) {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Key under which a radio is remembered, or null when it can't be recognised again. */
export function memoryKey(r) {
  if (r.identity) return r.identity
  // Random BLE addresses change every few minutes, so remembering them is noise —
  // except trackers, which keep an address for hours once separated.
  if (r.kind === 'BLE' && r.randomized && r.cls !== 'FINDER') return null
  return r.key
}

const MAX_DEVICES = 4000
const MAX_DAYS = 7
export const MULTI_PLACE_M = 1000

/**
 * Remembers which devices were heard in which ~330 m cell and on which days.
 * A device is "familiar" in a cell after two different days there, or after
 * the user taught the place ("learn this place"). A device heard in cells at
 * least MULTI_PLACE_M apart is reported by multiPlace().
 */
export class PlaceMemory {
  constructor(data) {
    this.devices = (data && typeof data.devices === 'object' && data.devices) || {}
    this.dirty = false
  }
  toJSON() { return { version: 1, devices: this.devices } }

  observe(r, cell, now) {
    const key = memoryKey(r)
    if (!key) return
    const day = dayOf(now)
    let d = this.devices[key]
    if (!d) d = this.devices[key] = { kind: r.kind, cells: {} }
    d.name = r.name || d.name || ''
    d.mac = r.mac
    d.cls = r.cls || d.cls || null
    d.last = now
    let c = d.cells[cell]
    if (!c) { c = d.cells[cell] = { first: now, last: now, days: [day] }; this.dirty = true }
    c.last = now
    if (c.days[c.days.length - 1] !== day) { c.days = [...c.days, day].slice(-MAX_DAYS); this.dirty = true }
  }

  familiar(r, cell) {
    const key = memoryKey(r)
    const c = key && this.devices[key]?.cells[cell]
    return !!c && (c.learned || c.days.length >= 2)
  }

  /** Mark every given radio as familiar in `cell`. Returns how many were learned. */
  learn(radios, cell, now) {
    let n = 0
    for (const r of radios) {
      if (!memoryKey(r)) continue
      this.observe(r, cell, now)
      this.devices[memoryKey(r)].cells[cell].learned = true
      n++
    }
    this.dirty = true
    return n
  }

  /** Devices heard in places at least `minM` apart. [{ key, d, places:[{cell, center, last}] }] */
  multiPlace({ minM = MULTI_PLACE_M, exclude = () => false } = {}) {
    const out = []
    for (const [key, d] of Object.entries(this.devices)) {
      if (exclude(key)) continue
      const places = Object.entries(d.cells).filter(([cell]) => cell !== NO_PLACE).map(([cell, c]) => ({ cell, center: cellCenter(cell), last: c.last, days: c.days }))
      if (places.length < 2) continue
      // Greedy: keep places that are far from every place already kept.
      places.sort((a, b) => b.last - a.last)
      const kept = []
      for (const p of places) if (kept.every((k) => distM(k.center, p.center) >= minM)) kept.push(p)
      if (kept.length >= 2) out.push({ key, d, places: kept })
    }
    out.sort((a, b) => b.places.length - a.places.length || b.d.last - a.d.last)
    return out
  }

  /** Keep the most recently heard devices only. */
  prune(max = MAX_DEVICES) {
    const keys = Object.keys(this.devices)
    if (keys.length <= max) return 0
    keys.sort((a, b) => (this.devices[b].last || 0) - (this.devices[a].last || 0))
    for (const k of keys.slice(max)) delete this.devices[k]
    this.dirty = true
    return keys.length - max
  }
}

// ---------- localization ----------

/** Keep a reading for localization when the observer moved or some time passed. */
export function addSample(r, pos, now) {
  if (!pos) return
  const s = r.samples || (r.samples = [])
  const last = s[s.length - 1]
  if (last && now - last.t < 3000 && distM(last, pos) < 2) return
  s.push({ lat: pos.lat, lon: pos.lon, rssi: r.rssi, t: now })
  if (s.length > 150) s.splice(0, s.length - 150)
}

/**
 * Estimate where a radio is from (position, RSSI) readings using the
 * log-distance path-loss model rssi = P0 − 10·n·log10(d). For each candidate
 * point on a grid around the readings, P0 is fitted by least squares and the
 * residual is scored; the best point wins. `radiusM` covers the candidates that
 * fit almost as well, so it grows when the readings can't pin the device down.
 * Returns null when there are too few readings or they don't spread out enough.
 */
export function locate(samples, { n = 2.5, minSamples = 6, minSpreadM = 15 } = {}) {
  if (!samples || samples.length < minSamples) return null
  const lat0 = samples.reduce((a, s) => a + s.lat, 0) / samples.length
  const lon0 = samples.reduce((a, s) => a + s.lon, 0) / samples.length
  const ky = 111320
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180)
  const pts = samples.map((s) => ({ x: (s.lon - lon0) * kx, y: (s.lat - lat0) * ky, rssi: s.rssi }))
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  let [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const spread = Math.hypot(x1 - x0, y1 - y0)
  if (spread < minSpreadM) return null
  const pad = Math.max(30, spread * 0.6)
  x0 -= pad; x1 += pad; y0 -= pad; y1 += pad

  const score = (x, y) => {
    let sum = 0
    const a = pts.map((p) => {
      const v = p.rssi + 10 * n * Math.log10(Math.max(1, Math.hypot(p.x - x, p.y - y)))
      sum += v
      return v
    })
    const p0 = sum / a.length
    return { sse: a.reduce((acc, v) => acc + (v - p0) ** 2, 0), p0 }
  }
  const grid = (ax, bx, ay, by, steps) => {
    const out = []
    for (let i = 0; i <= steps; i++) for (let j = 0; j <= steps; j++) {
      const x = ax + ((bx - ax) * i) / steps
      const y = ay + ((by - ay) * j) / steps
      out.push({ x, y, ...score(x, y) })
    }
    return out
  }
  const coarse = grid(x0, x1, y0, y1, 50)
  coarse.sort((a, b) => a.sse - b.sse)
  const c = coarse[0]
  const sx = (x1 - x0) / 50
  const sy = (y1 - y0) / 50
  const fine = grid(c.x - 2 * sx, c.x + 2 * sx, c.y - 2 * sy, c.y + 2 * sy, 20)
  fine.sort((a, b) => a.sse - b.sse)
  const best = fine[0]
  // Uncertainty: furthest grid point whose fit is within ~1 dB RMS of the best.
  const tol = best.sse + pts.length * 1
  let radius = 0
  for (const g of [...coarse, ...fine]) if (g.sse <= tol) radius = Math.max(radius, Math.hypot(g.x - best.x, g.y - best.y))
  return {
    lat: lat0 + best.y / ky,
    lon: lon0 + best.x / kx,
    radiusM: Math.max(5, Math.round(radius)),
    rmse: Math.sqrt(best.sse / pts.length),
    txPower: best.p0,
    n: pts.length,
  }
}
