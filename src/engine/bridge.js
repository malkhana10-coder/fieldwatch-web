// Fieldwatch bridge source: a small local program (bridge/fieldwatch_bridge.py)
// scans real Wi-Fi and BLE and streams sightings over a WebSocket. Everything
// that arrives is untrusted input, so it is validated and normalised here
// before it reaches the engine.

const MAC_RE = /^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/
const HEX_RE = /^[0-9A-F]*$/
const str = (v, max = 64) => (typeof v === 'string' ? v.slice(0, max) : '')
const int = (v, lo, hi, dflt) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Math.round(Number(v)))) : dflt)
const hex = (v, max = 128) => {
  const h = str(v, max * 2).toUpperCase()
  return HEX_RE.test(h) && h.length % 2 === 0 ? h : ''
}

/** One sighting in the shape engine.ingest() expects, or null if it is unusable. */
export function sanitizeSighting(x) {
  if (!x || typeof x !== 'object') return null
  const kind = x.kind === 'WIFI' || x.kind === 'BLE' ? x.kind : null
  const mac = str(x.mac, 17).toUpperCase()
  if (!kind || !MAC_RE.test(mac)) return null
  const arr = (v, n) => (Array.isArray(v) ? v.slice(0, n) : [])
  return {
    kind, mac, name: str(x.name), hidden: !!x.hidden, rssi: int(x.rssi, -127, 20, -100),
    channel: int(x.channel, 0, 255, 0), freq: int(x.freq, 0, 8000, kind === 'BLE' ? 2402 : 0), security: str(x.security, 32),
    mfg: arr(x.mfg, 8).map((m) => ({ companyId: int(m?.companyId, 0, 0xffff, -1), dataHex: hex(m?.dataHex) })).filter((m) => m.companyId >= 0),
    uuids: arr(x.uuids, 16).map((u) => str(u, 36)).filter(Boolean),
    svcData: arr(x.svcData, 8).map((s) => ({ uuid: str(s?.uuid, 36), dataHex: hex(s?.dataHex) })).filter((s) => s.uuid),
    vendorIe: arr(x.vendorIe, 8).map((v) => str(v, 16)).filter(Boolean),
  }
}

/** Parse one WebSocket frame from the bridge. Returns { type, ... } or null. */
export function parseBridgeMessage(text) {
  if (typeof text !== 'string' || text.length > 2_000_000) return null
  let j
  try { j = JSON.parse(text) } catch { return null }
  if (!j || typeof j !== 'object') return null
  if (j.type === 'hello') {
    return { type: 'hello', agent: str(j.agent), version: int(j.version, 0, 999, 0), platform: str(j.platform, 16), caps: { wifi: !!j.caps?.wifi, ble: !!j.caps?.ble } }
  }
  if (j.type === 'sightings' && Array.isArray(j.items)) {
    return { type: 'sightings', items: j.items.slice(0, 2000).map(sanitizeSighting).filter(Boolean) }
  }
  return null
}

/** Accept ws:// or wss:// URLs only. */
export function validBridgeUrl(url) {
  try {
    const u = new URL(String(url || '').trim())
    return u.protocol === 'ws:' || u.protocol === 'wss:'
  } catch { return false }
}
