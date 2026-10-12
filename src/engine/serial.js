// External ESP32 sensor over Web Serial (Chrome/Edge desktop and Android).
// The firmware in firmware/esp32-fieldwatch prints one JSON object per line:
// {"t":"ble","mac":"AA:..","rssi":-60,"name":"..","mfg":[[76,"1005.."]],"uuids":["FEAA"],"svc":[["FEAA","00.."]]}
// {"t":"wifi","mac":"AA:..","rssi":-70,"ssid":"..","ch":6,"sec":"WPA2-PSK"}
export const serialSupported = () => typeof navigator !== 'undefined' && 'serial' in navigator

export function parseSensorLine(line) {
  let j
  try { j = JSON.parse(line) } catch { return null }
  if (!j || typeof j.mac !== 'string' || typeof j.rssi !== 'number') return null
  if (j.t === 'wifi') {
    const ch = Number(j.ch) || 0
    return { kind: 'WIFI', mac: j.mac, name: String(j.ssid || ''), hidden: !j.ssid, rssi: j.rssi, channel: ch, freq: ch <= 14 ? 2407 + ch * 5 : 5000 + ch * 5, security: String(j.sec || ''), mfg: [], uuids: [], svcData: [], vendorIe: [] }
  }
  if (j.t === 'ble') {
    return {
      kind: 'BLE', mac: j.mac, name: String(j.name || ''), rssi: j.rssi, channel: 0, freq: 2402,
      mfg: (j.mfg || []).filter(Array.isArray).map(([id, hex]) => ({ companyId: Number(id), dataHex: String(hex || '') })),
      uuids: (j.uuids || []).map(String),
      svcData: (j.svc || []).filter(Array.isArray).map(([uuid, hex]) => ({ uuid: String(uuid), dataHex: String(hex || '') })),
      vendorIe: [],
    }
  }
  return null
}

export class SerialSensor {
  constructor(push) { this.push = push; this.port = null; this.reader = null; this.stopped = false }

  async start() {
    this.port = await navigator.serial.requestPort()
    await this.port.open({ baudRate: 115200 })
    this.stopped = false
    const decoder = new TextDecoderStream()
    this.port.readable.pipeTo(decoder.writable).catch(() => {})
    this.reader = decoder.readable.getReader()
    let buf = ''
    ;(async () => {
      while (!this.stopped) {
        const { value, done } = await this.reader.read().catch(() => ({ done: true }))
        if (done) break
        buf += value
        let i
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim()
          buf = buf.slice(i + 1)
          const s = line && parseSensorLine(line)
          if (s) this.push(s)
        }
      }
    })()
  }

  async stop() {
    this.stopped = true
    try { await this.reader?.cancel() } catch { /* ignore */ }
    try { await this.port?.close() } catch { /* ignore */ }
  }
}
