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

function fmt(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(Math.abs(n) < 10 ? 2 : 1).replace(/\.?0+$/, '')
}

export function decodeFields(fleet, d) {
  const dec = fleet.decode
  if (!dec || d.kind !== 'BLE') return []
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
      if (!gateOk(f.when, p)) continue
      const len = f.length ?? TYPE_LEN[f.type] ?? Math.max(0, p.length - f.offset)
      if (f.offset < 0 || len < 1 || f.offset + len > p.length) continue
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
        if (f.modulo) num %= f.modulo
        if (f.scale != null) num *= f.scale
        if (f.offsetAdd != null) num += f.offsetAdd
        text = fmt(num)
      }
      const mapped = f.enum?.[key]
      const shown = mapped ?? text
      out.push({ id: f.id, label: f.label || f.id, value: f.unit && !mapped ? `${shown} ${f.unit}` : shown })
    }
    if (out.length) break
  }
  return out
}
