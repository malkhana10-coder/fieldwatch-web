// Open Drone ID (ASTM F3411-22a) Remote ID decoder / encoder.
// Pure ES module, no dependencies. Field layouts follow opendroneid-core-c
// (opendroneid.c / opendroneid.h). All multi-byte fields are little-endian.
//
// BLE legacy (BT4) advertising service data under UUID 0xFFFA:
//   byte0 = application code 0x0D, byte1 = message counter, then one 25-byte message.

export const ODID_UUID = 'FFFA'

const APP_CODE = 0x0d
const MSG_SIZE = 25
const PROTO_VERSION = 2
const MAX_PACK = 9

export const UA_TYPES = [
  'None',
  'Aeroplane',
  'Helicopter/Multirotor',
  'Gyroplane',
  'Hybrid lift',
  'Ornithopter',
  'Glider',
  'Kite',
  'Free balloon',
  'Captive balloon',
  'Airship',
  'Free fall/Parachute',
  'Rocket',
  'Tethered powered aircraft',
  'Ground obstacle',
  'Other',
]

export const ID_TYPES = [
  'None',
  'Serial number (CTA-2063-A)',
  'CAA registration',
  'UTM assigned UUID',
  'Specific session ID',
]

export const STATUS = ['Undeclared', 'Ground', 'Airborne', 'Emergency', 'Remote ID system failure']

// 4-bit protocol code (0–15) or null. Every enum the decoder reads is one nibble,
// so anything else (from a corrupt state or a hand-built message) is dropped.
const nibble = (v) => (Number.isInteger(v) && v >= 0 && v <= 15 ? v : null)
const known = (table) => (n) => Number.isInteger(n) && n >= 0 && n < table.length
/** True when the code has a defined meaning; reserved codes (ID type 5–15, status 5–15) give false. */
export const isKnownIdType = known(ID_TYPES)
export const isKnownUaType = known(UA_TYPES)
export const isKnownStatus = known(STATUS)
const label = (table) => (n) => (known(table)(n) ? table[n] : nibble(n) !== null ? `Reserved (${n})` : null)
/** English label; 'Reserved (n)' for a reserved 4-bit code; null when there is no valid code. */
export const idTypeLabel = label(ID_TYPES)
export const uaTypeLabel = label(UA_TYPES)
export const statusLabel = label(STATUS)

const MSG_TYPES = { 0x0: 'basic', 0x1: 'location', 0x2: 'auth', 0x3: 'selfid', 0x4: 'system', 0x5: 'operator', 0xf: 'pack' }

// --- sentinels (opendroneid.h) ---
const INV_DIR = 361
const INV_SPEED_H = 255
const INV_SPEED_V = 63
const INV_ALT = -1000
const INV_TIMESTAMP = 0xffff
const SPEED_DIV0 = 0.25
const SPEED_DIV1 = 0.75
const MAX_SPEED_H = 254.25
const MAX_SPEED_V = 62
const ODID_EPOCH_MS = Date.UTC(2019, 0, 1)

// --- helpers ---
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

function u16(b, o) { return b[o] | (b[o + 1] << 8) }
function i32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) | 0 }
function u32(b, o) { return i32(b, o) >>> 0 }
function i8(v) { return v > 127 ? v - 256 : v }

function put16(b, o, v) { b[o] = v & 0xff; b[o + 1] = (v >>> 8) & 0xff }
function put32(b, o, v) { b[o] = v & 0xff; b[o + 1] = (v >>> 8) & 0xff; b[o + 2] = (v >>> 16) & 0xff; b[o + 3] = (v >>> 24) & 0xff }

function readStr(b, o, len) {
  let s = ''
  for (let i = o; i < o + len && i < b.length; i++) {
    const c = b[i]
    if (c === 0) break
    if (c >= 0x20 && c < 0x7f) s += String.fromCharCode(c)
  }
  return s.trimEnd()
}

function writeStr(b, o, len, s) {
  const str = String(s ?? '')
  for (let i = 0; i < len; i++) {
    const c = i < str.length ? str.charCodeAt(i) : 0
    b[o + i] = c >= 0x20 && c < 0x7f ? c : 0
  }
}

function hexToBytes(hex) {
  if (typeof hex !== 'string') return null
  const h = hex.replace(/[^0-9a-fA-F]/g, '')
  if (h.length % 2) return null
  const out = new Uint8Array(h.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16)
  return out
}

function bytesToHex(b) {
  let s = ''
  for (const x of b) s += x.toString(16).padStart(2, '0')
  return s.toUpperCase()
}

function header(type) { return ((type & 0x0f) << 4) | PROTO_VERSION }

// --- field codecs ---
function decodeLatLon(raw) { return raw === 0 ? null : raw * 1e-7 }
function encodeLatLon(v, lim) { return isNum(v) ? Math.round(clamp(v, -lim, lim) * 1e7) : 0 }

function decodeAlt(raw) { return raw === 0 ? null : raw * 0.5 - 1000 }
function encodeAlt(v) {
  if (!isNum(v) || v <= INV_ALT) return 0
  return clamp(Math.round((v - INV_ALT) / 0.5), 0, 0xffff)
}

function decodeDirection(raw, ew) {
  const d = ew ? raw + 180 : raw
  if (d > 360) return null
  return d === 360 ? 0 : d
}
// returns [raw, ewBit]
function encodeDirection(v) {
  if (!isNum(v)) return [INV_DIR - 180, 1]
  let d = Math.round(v) % 360
  if (d < 0) d += 360
  return d < 180 ? [d, 0] : [d - 180, 1]
}

function decodeSpeedH(raw, mult) {
  if (mult && raw === INV_SPEED_H) return null
  return mult ? raw * SPEED_DIV1 + 255 * SPEED_DIV0 : raw * SPEED_DIV0
}
// returns [raw, multBit]
function encodeSpeedH(v) {
  if (!isNum(v)) return [INV_SPEED_H, 1]
  const s = clamp(v, 0, MAX_SPEED_H)
  if (s <= 255 * SPEED_DIV0) return [Math.round(s / SPEED_DIV0), 0]
  return [clamp(Math.round((s - 255 * SPEED_DIV0) / SPEED_DIV1), 0, 254), 1]
}

function decodeSpeedV(raw) {
  const v = i8(raw) * 0.5
  return v === INV_SPEED_V ? null : v
}
function encodeSpeedV(v) {
  if (!isNum(v)) return (INV_SPEED_V / 0.5) & 0xff
  return Math.round(clamp(v, -MAX_SPEED_V, MAX_SPEED_V) / 0.5) & 0xff
}

// --- decoders ---
function decodeBasic(b) {
  return { type: 'basic', idType: b[1] >> 4, uaType: b[1] & 0x0f, id: readStr(b, 2, 20) }
}

function decodeLocation(b) {
  const f = b[1]
  const ts = u16(b, 21)
  return {
    type: 'location',
    status: f >> 4,
    heightType: (f >> 2) & 1,
    direction: decodeDirection(b[2], (f >> 1) & 1),
    speed: decodeSpeedH(b[3], f & 1),
    vspeed: decodeSpeedV(b[4]),
    lat: decodeLatLon(i32(b, 5)),
    lon: decodeLatLon(i32(b, 9)),
    altBaro: decodeAlt(u16(b, 13)),
    altGeo: decodeAlt(u16(b, 15)),
    height: decodeAlt(u16(b, 17)),
    horizAcc: b[19] & 0x0f,
    vertAcc: b[19] >> 4,
    speedAcc: b[20] & 0x0f,
    baroAcc: b[20] >> 4,
    timestamp: ts === INV_TIMESTAMP ? null : ts / 10, // seconds since the full hour
    tsAcc: b[23] & 0x0f, // raw, units of 0.1 s (0 = unknown)
  }
}

function decodeAuth(b) {
  return { type: 'auth', authType: b[1] >> 4, page: b[1] & 0x0f }
}

function decodeSelfId(b) {
  return { type: 'selfid', descType: b[1], desc: readStr(b, 2, 23) }
}

function decodeSystem(b) {
  const f = b[1]
  const ts = u32(b, 20)
  return {
    type: 'system',
    operatorLocationType: f & 0x03,
    classificationType: (f >> 2) & 0x07,
    opLat: decodeLatLon(i32(b, 2)),
    opLon: decodeLatLon(i32(b, 6)),
    areaCount: u16(b, 10),
    areaRadius: b[12] * 10,
    areaCeiling: decodeAlt(u16(b, 13)),
    areaFloor: decodeAlt(u16(b, 15)),
    category: b[17] >> 4,
    class: b[17] & 0x0f,
    opAlt: decodeAlt(u16(b, 18)),
    timestamp: ts === 0 ? null : ts, // seconds since 2019-01-01T00:00:00Z
    timeMs: ts === 0 ? null : ODID_EPOCH_MS + ts * 1000,
  }
}

function decodeOperator(b) {
  return { type: 'operator', operatorIdType: b[1], operatorId: readStr(b, 2, 20) }
}

function decodePack(b) {
  const size = b[1]
  const n = b[2]
  const messages = []
  if (size !== MSG_SIZE || n > MAX_PACK) return { type: 'pack', messages }
  for (let i = 0; i < n; i++) {
    const o = 3 + i * MSG_SIZE
    if (o + MSG_SIZE > b.length) break
    const m = decodeMessage(b.subarray(o, o + MSG_SIZE))
    if (m.type !== 'pack') messages.push(m) // no nested packs
  }
  return { type: 'pack', messages }
}

/** Decode one ODID message (25 bytes; a message pack may be longer). */
export function decodeMessage(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes || [])
  if (b.length < 1) return { type: 'unknown' }
  const msgType = b[0] >> 4
  if (msgType === 0xf) return b.length >= 3 ? decodePack(b) : { type: 'unknown', msgType }
  if (b.length < MSG_SIZE) return { type: 'unknown', msgType }
  switch (msgType) {
    case 0x0: return decodeBasic(b)
    case 0x1: return decodeLocation(b)
    case 0x2: return decodeAuth(b)
    case 0x3: return decodeSelfId(b)
    case 0x4: return decodeSystem(b)
    case 0x5: return decodeOperator(b)
    default: return { type: 'unknown', msgType }
  }
}

/** Decode BLE service data (UUID FFFA) hex into a flat array of decoded messages. */
export function decodeAdvert(hex) {
  const b = hexToBytes(hex)
  if (!b || b.length < 2 + MSG_SIZE || b[0] !== APP_CODE) return []
  const body = b.subarray(2)
  const m = decodeMessage(body)
  if (m.type === 'pack') return m.messages
  return [m]
}

// --- merge ---
function haversineM(a, b) {
  const R = 6371008.8
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLon = (b.lon - a.lon) * rad
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}

const TRACK_MAX = 300
const TRACK_MIN_M = 2
const TRACK_MIN_MS = 5000

const EMPTY = {
  id: null, idType: null, uaType: null, operatorId: null, selfId: null, status: null,
  lat: null, lon: null, altGeo: null, altBaro: null, height: null, heightType: null,
  speed: null, vspeed: null, direction: null, opLat: null, opLon: null, opAlt: null,
  areaCount: null, areaRadius: null,
}

function setIf(o, k, v) { if (v !== null && v !== undefined) o[k] = v }

// Copy of an { [idType]: value } map keeping only nibble keys with valid values.
function cleanByType(o, ok) {
  const out = {}
  if (!o || typeof o !== 'object') return out
  for (const k of Object.keys(o)) {
    if (/^\d{1,2}$/.test(k) && nibble(Number(k)) !== null && ok(o[k])) out[Number(k)] = o[k]
  }
  return out
}

/** Merge decoded messages into a drone state; returns a NEW object (input untouched). */
export function mergeDrone(state, msgs, now) {
  const s = { ...EMPTY, ...(state || {}) }
  s.ids = cleanByType(state?.ids, (v) => typeof v === 'string' && v !== '')
  s.uaTypes = cleanByType(state?.uaTypes, (v) => nibble(v) !== null)
  s.idType = nibble(s.idType)
  s.uaType = nibble(s.uaType)
  s.status = nibble(s.status)
  let track = Array.isArray(state?.track) ? state.track.slice() : []
  const flat = []
  for (const m of msgs || []) {
    if (!m) continue
    if (m.type === 'pack') flat.push(...(m.messages || []))
    else flat.push(m)
  }
  let lastBasicType = null
  for (const m of flat) {
    switch (m.type) {
      case 'basic': {
        // Reserved ID types (5–15) are kept under their own number; a Basic ID
        // with no valid ID type or no ID text is ignored.
        const t = nibble(m.idType)
        if (t === null || typeof m.id !== 'string' || !m.id) break
        s.ids[t] = m.id
        const ua = nibble(m.uaType)
        if (ua !== null) s.uaTypes[t] = ua
        lastBasicType = t
        break
      }
      case 'location': {
        setIf(s, 'status', nibble(m.status))
        setIf(s, 'heightType', m.heightType)
        setIf(s, 'direction', m.direction)
        setIf(s, 'speed', m.speed)
        setIf(s, 'vspeed', m.vspeed)
        setIf(s, 'altGeo', m.altGeo)
        setIf(s, 'altBaro', m.altBaro)
        setIf(s, 'height', m.height)
        if (m.lat !== null && m.lon !== null && isNum(m.lat) && isNum(m.lon)) {
          s.lat = m.lat
          s.lon = m.lon
          const pt = { lat: m.lat, lon: m.lon, alt: m.altGeo ?? m.altBaro ?? null, t: now }
          const last = track[track.length - 1]
          if (!last || haversineM(last, pt) > TRACK_MIN_M || now - last.t > TRACK_MIN_MS) {
            track.push(pt)
            if (track.length > TRACK_MAX) track = track.slice(track.length - TRACK_MAX)
          }
        }
        break
      }
      case 'selfid':
        setIf(s, 'selfId', m.desc || null)
        break
      case 'system':
        setIf(s, 'opLat', m.opLat)
        setIf(s, 'opLon', m.opLon)
        setIf(s, 'opAlt', m.opAlt)
        setIf(s, 'areaCount', m.areaCount)
        setIf(s, 'areaRadius', m.areaRadius)
        break
      case 'operator':
        setIf(s, 'operatorId', m.operatorId || null)
        break
      default:
        break
    }
  }
  // Prefer the serial number (idType 1); otherwise the most recently seen defined
  // ID type. A reserved ID type (5–15) is shown only when no defined one was ever
  // heard, so a reserved Basic ID can't keep displacing a real one.
  const has = (t) => t !== null && t !== undefined && s.ids[t] !== undefined
  const types = Object.keys(s.ids).map(Number)
  const prev = s.idType
  const pick = has(1) ? 1
    : isKnownIdType(lastBasicType) ? lastBasicType
      : isKnownIdType(prev) && has(prev) ? prev
        : types.find(isKnownIdType) ?? lastBasicType ?? (has(prev) ? prev : types[0] ?? null)
  if (pick !== null) {
    s.idType = pick
    s.id = s.ids[pick]
    if (s.uaTypes[pick] !== undefined) s.uaType = s.uaTypes[pick]
  }
  s.track = track
  s.updated = now
  return s
}

// --- encoders ---
export function encodeBasicId({ idType = 0, uaType = 0, id = '' } = {}) {
  const b = new Uint8Array(MSG_SIZE)
  b[0] = header(0x0)
  b[1] = ((idType & 0x0f) << 4) | (uaType & 0x0f)
  writeStr(b, 2, 20, id)
  return b
}

export function encodeLocation({
  status = 0, direction, speed, vspeed, lat, lon, altBaro, altGeo, height, heightType = 0, timestamp,
  horizAcc = 0, vertAcc = 0, baroAcc = 0, speedAcc = 0, tsAcc = 0,
} = {}) {
  const b = new Uint8Array(MSG_SIZE)
  const [dir, ew] = encodeDirection(direction)
  const [spd, mult] = encodeSpeedH(speed)
  b[0] = header(0x1)
  b[1] = ((status & 0x0f) << 4) | ((heightType ? 1 : 0) << 2) | (ew << 1) | mult
  b[2] = dir
  b[3] = spd
  b[4] = encodeSpeedV(vspeed)
  put32(b, 5, encodeLatLon(lat, 90))
  put32(b, 9, encodeLatLon(lon, 180))
  put16(b, 13, encodeAlt(altBaro))
  put16(b, 15, encodeAlt(altGeo))
  put16(b, 17, encodeAlt(height))
  b[19] = ((vertAcc & 0x0f) << 4) | (horizAcc & 0x0f)
  b[20] = ((baroAcc & 0x0f) << 4) | (speedAcc & 0x0f)
  put16(b, 21, isNum(timestamp) ? clamp(Math.round(timestamp * 10), 0, 36000) : INV_TIMESTAMP)
  b[23] = tsAcc & 0x0f
  return b
}

export function encodeSystem({
  opLat, opLon, opAlt, areaCount = 1, areaRadius = 0, areaCeiling, areaFloor,
  classificationType = 0, operatorLocationType = 0, category = 0, class: uaClass = 0, timestamp = 0,
} = {}) {
  const b = new Uint8Array(MSG_SIZE)
  b[0] = header(0x4)
  b[1] = ((classificationType & 0x07) << 2) | (operatorLocationType & 0x03)
  put32(b, 2, encodeLatLon(opLat, 90))
  put32(b, 6, encodeLatLon(opLon, 180))
  put16(b, 10, clamp(Math.round(isNum(areaCount) ? areaCount : 1), 0, 0xffff))
  b[12] = clamp(Math.round((isNum(areaRadius) ? areaRadius : 0) / 10), 0, 255)
  put16(b, 13, encodeAlt(areaCeiling))
  put16(b, 15, encodeAlt(areaFloor))
  b[17] = ((category & 0x0f) << 4) | (uaClass & 0x0f)
  put16(b, 18, encodeAlt(opAlt))
  put32(b, 20, isNum(timestamp) ? clamp(Math.round(timestamp), 0, 0xffffffff) >>> 0 : 0)
  return b
}

export function encodeOperatorId({ id = '', operatorIdType = 0 } = {}) {
  const b = new Uint8Array(MSG_SIZE)
  b[0] = header(0x5)
  b[1] = operatorIdType & 0xff
  writeStr(b, 2, 20, id)
  return b
}

export function encodeSelfId({ desc = '', descType = 0 } = {}) {
  const b = new Uint8Array(MSG_SIZE)
  b[0] = header(0x3)
  b[1] = descType & 0xff
  writeStr(b, 2, 23, desc)
  return b
}

/** BLE legacy advert service data: '0D' + counter + 25-byte message, as UPPERHEX. */
export function wrapAdvert(counter, msgBytes) {
  const c = (Number(counter) || 0) & 0xff
  return '0D' + c.toString(16).padStart(2, '0').toUpperCase() + bytesToHex(msgBytes)
}
