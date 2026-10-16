// Port of SignatureFieldDecoder: decode cleartext BLE fields described by a
// signature's `decode` map (Remote ID, TPMS, Ruuvi, Govee, …).
import { hexOnly } from './catalog.js'

const TYPE_LEN = { u8: 1, i8: 1, u16: 2, i16: 2, u24: 3, u32: 4, i32: 4, f32: 4, bool: 1, bits: 1, mac: 6 }
const uuidKey = (u) => {
  const h = hexOnly(u)
  return h.length === 32 && h.startsWith('0000') && h.endsWith('00001000800000805F9B34FB') ? h.slice(4, 8) : h
}

function toBytes(hex) {
  const h = hexOnly(hex)
  const out = new Uint8Array(h.length >> 1)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16)
  return out
}

function readU(b, le) {
  let v = 0
  if (le) for (let i = b.length - 1; i >= 0; i--) v = v * 256 + b[i]
  else for (let i = 0; i < b.length; i++) v = v * 256 + b[i]
  return v
}

function gateOk(gate, p) {
  if (!gate) return true
  if (gate.op === 'len') return p.length === Math.max(1, gate.length || 1)
  const want = toBytes(gate.valueHex)
  const len = Math.max(1, want.length)
  if (gate.offset < 0 || gate.offset + len > p.length) return false
  const got = p.slice(gate.offset, gate.offset + len)
  const eq = got.every((x, i) => x === want[i])
  return gate.op === 'eq' ? eq : !eq
}

// Readable precision for ordinary values; fields scaled by less than 1e-5 (Remote ID
// latitude/longitude use 1e-7) keep every decimal the scale carries, so 24.6912345
// is not shown as 24.7 (about 1 km off).
function fmt(n, scale) {
  if (Number.isInteger(n)) return String(n)
  let dp = Math.abs(n) < 10 ? 2 : 1
  const sc = Math.abs(Number(scale))
  if (sc > 0 && sc < 1e-5) dp = Math.max(dp, Math.min(9, Math.round(-Math.log10(sc))))
  return n.toFixed(dp).replace(/\.?0+$/, '')
}

// Words that name a coordinate. 'long' only counts as a whole label ("Lat" / "Long"),
// never as one word of a longer one ("Long range").
const COORD_WORDS = new Set(['lat', 'latitude', 'lon', 'lng', 'longitude'])

/**
 * True for a decoded field (or decode spec field) that holds a latitude or
 * longitude, judged by its id (`latitude`, `op_lat`, `opLat`, …) or its label
 * ('Latitude', 'Operator lon', 'خط العرض', …), so the UI can mask it in privacy mode.
 */
export function isLocationField(field) {
  if (!field || typeof field !== 'object') return false
  const id = typeof field.id === 'string' ? field.id.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase() : ''
  if (id.split(/[^a-z0-9]+/).some((t) => COORD_WORDS.has(t)) || /^(op|operator|home|takeoff|pilot)(lat|lon|lng)$/.test(id)) return true
  const label = typeof field.label === 'string' ? field.label.toLowerCase().trim() : ''
  if (!label) return false
  if (label === 'long' || /خط\s*(العرض|الطول)/.test(label)) return true
  return label.split(/[^\p{L}\p{N}]+/u).some((t) => COORD_WORDS.has(t))
}

// A decode spec can arrive from an imported signature file: only plain values pass.
const str = (v) => (typeof v === 'string' ? v : '')
const enumValue = (en, key) => {
  if (!en || typeof en !== 'object' || !Object.prototype.hasOwnProperty.call(en, key)) return undefined
  const v = en[key]
  return typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)) ? String(v) : undefined
}

export function decodeFields(fleet, d) {
  const dec = fleet?.decode
  if (!dec || typeof dec !== 'object' || d.kind !== 'BLE' || !Array.isArray(dec.fields)) return []
  let payloads = []
  if (dec.source === 'manufacturerData') {
    const want = dec.companyId || null
    payloads = (d.mfg || []).filter((r) => !want || r.companyId === want).map((r) => r.dataHex)
  } else if (dec.source === 'serviceData' && dec.serviceUuid) {
    const want = uuidKey(dec.serviceUuid)
    payloads = (d.svcData || []).filter((s) => uuidKey(s.uuid) === want).map((s) => s.dataHex)
  }
  const out = []
  for (const hex of payloads) {
    const p = toBytes(hex)
    if (!p.length) continue
    for (const f of dec.fields) {
      if (!f || typeof f !== 'object' || !Number.isInteger(f.offset)) continue
      if (!gateOk(f.when && typeof f.when === 'object' ? f.when : null, p)) continue
      const len = f.length ?? TYPE_LEN[f.type] ?? Math.max(0, p.length - f.offset)
      if (!Number.isInteger(len) || f.offset < 0 || len < 1 || f.offset + len > p.length) continue
      const s = p.slice(f.offset, f.offset + len)
      const le = f.endian !== 'be'
      let num = null
      let text
      switch (f.type) {
        case 'utf8': text = new TextDecoder().decode(s).replace(/^[\s\0]+|[\s\0]+$/g, ''); break
        case 'hex': text = [...s].map((x) => x.toString(16).toUpperCase().padStart(2, '0')).join(' '); break
        case 'mac': text = [...s].slice(0, 6).map((x) => x.toString(16).toUpperCase().padStart(2, '0')).join(':'); break
        case 'bool': num = s.some((x) => x) ? 1 : 0; text = num ? 'yes' : 'no'; break
        case 'bits': {
          const w = Math.min(32, Math.max(1, f.bitWidth || 1))
          num = Math.floor(readU(s, le) / 2 ** (f.bitOffset || 0)) % 2 ** w
          text = String(num); break
        }
        case 'f32': num = new DataView(s.buffer.slice(s.byteOffset, s.byteOffset + 4)).getFloat32(0, le); text = fmt(num); break
        case 'i8': case 'i16': case 'i32': {
          const bits = s.length * 8
          num = readU(s, le)
          if (num >= 2 ** (bits - 1)) num -= 2 ** bits
          text = String(num); break
        }
        default: num = readU(s, le); text = String(num)
      }
      if (!text) continue
      const key = text
      if (num != null && (f.scale != null || f.offsetAdd != null || f.modulo != null)) {
        if (f.modulo) num %= Number(f.modulo)
        if (f.scale != null) num *= Number(f.scale)
        if (f.offsetAdd != null) num += Number(f.offsetAdd)
        if (!Number.isFinite(num)) continue
        text = fmt(num, f.scale)
      }
      const mapped = enumValue(f.enum, key)
      const shown = mapped ?? text
      const id = str(f.id)
      const unit = str(f.unit)
      out.push({ id, label: str(f.label) || id, value: unit && !mapped ? `${shown} ${unit}` : shown })
    }
    if (out.length) break
  }
  return out
}
