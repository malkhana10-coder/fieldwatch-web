// Field simulator. Browsers cannot see Wi-Fi APs and most cannot scan BLE, so the
// demo source synthesizes radios that satisfy real catalog rules. Every emitted
// sighting goes through the same matcher, decoder, filters, sits and alerts as a
// real one would.

const rnd = (a, b) => a + Math.random() * (b - a)
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]
const hexByte = () => Math.floor(Math.random() * 256).toString(16).toUpperCase().padStart(2, '0')
const hexBytes = (n) => Array.from({ length: n }, hexByte).join('')
const macFrom = (prefixHex) => {
  const h = (prefixHex + hexBytes(6)).slice(0, 12)
  return h.match(/.{2}/g).join(':')
}
const randomMac = () => {
  const first = (Math.floor(Math.random() * 64) << 2) | 0x02 // locally administered, unicast
  return macFrom(first.toString(16).toUpperCase().padStart(2, '0') + hexBytes(5))
}
const WIFI_CH = [1, 6, 11, 1, 6, 11, 3, 9, 36, 40, 44, 48, 149, 153, 157, 161]
const chFreq = (c) => (c <= 14 ? 2407 + c * 5 : 5000 + c * 5)
const SEC = ['WPA2-PSK', 'WPA2-PSK', 'WPA3-SAE', 'WPA2/WPA3', 'WPA2-EAP', 'OPEN']
const HOME_SSIDS = ['STC_WiFi_', 'Mobily-', 'Zain-5G-', 'HUAWEI-', 'TP-Link_', 'Home-', 'Majlis_', 'Office-', 'Cafe Guest', 'DIRECT-', 'AndroidAP_', 'iPhone']
const BLE_NAMES = ['', '', '', '', 'Galaxy Buds2', 'Mi Smart Band 7', 'LE-Bose QC', 'JBL Flip 6', 'Apple Watch', 'Fitbit Charge', '[TV] Samsung 7 Series', 'Keyboard K380', 'MX Master 3']

function nameFromGlob(g) {
  return g.replace(/\*/g, () => (Math.random() < 0.5 ? hexBytes(2) : '')).replace(/\?/g, () => pick('ABCDEF0123456789'))
}

/** Pick a rule that can drive a synthetic radio and build one from it. */
function radioFromFleet(f) {
  const rules = (f.rules || []).filter((r) => r.enabled !== false)
  if (!rules.length) return null
  const r = pick(rules)
  const d = { mfg: [], uuids: [], svcData: [], vendorIe: [] }
  const bleOnly = ['SERVICE_UUID', 'SERVICE_DATA', 'MANUFACTURER_ID', 'MANUFACTURER_DATA'].includes(r.kind)
  d.kind = r.radio || (bleOnly ? 'BLE' : f.kind === 'ISP' || f.kind === 'MESH' ? 'WIFI' : Math.random() < 0.5 ? 'WIFI' : 'BLE')
  if (bleOnly) d.kind = 'BLE'
  d.mac = randomMac()
  switch (r.kind) {
    case 'OUI': case 'MAC_PREFIX': {
      const h = r.text.replace(/[^0-9a-fA-F]/g, '').toUpperCase()
      d.mac = macFrom(h)
      break
    }
    case 'VENDOR_IE_OUI':
      d.kind = 'WIFI'; d.vendorIe = [r.text]; break
    case 'NAME_GLOB': d.name = nameFromGlob(r.text); break
    case 'NAME_CONTAINS': d.name = r.text + (Math.random() < 0.5 ? '' : ' ' + hexBytes(1)); break
    case 'SERVICE_UUID': d.uuids = [r.text]; break
    case 'SERVICE_DATA': d.svcData = [{ uuid: r.text || 'FEAA', dataHex: (r.dataPrefixHex || '') + hexBytes(10) }]; break
    case 'MANUFACTURER_ID': d.mfg = [{ companyId: r.companyId, dataHex: hexBytes(rnd(4, 20) | 0) }]; break
    case 'MANUFACTURER_DATA': d.mfg = [{ companyId: r.companyId, dataHex: r.dataPrefixHex + hexBytes(rnd(4, 18) | 0) }]; break
    case 'HIDDEN_SSID': d.kind = 'WIFI'; d.hidden = true; break
    default: return null
  }
  if (f.matchAny === false) return null
  if (d.kind === 'WIFI' && !d.name && !d.hidden) d.name = f.name.replace(/[^A-Za-z0-9]/g, '') + '-' + hexBytes(2)
  return d
}

function remoteIdRadio() {
  const serial = ('1581F' + hexBytes(6)).slice(0, 16)
  const ser = [...serial.padEnd(20, '\0')].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('').toUpperCase()
  return {
    kind: 'BLE', mac: randomMac(), name: '', mfg: [], uuids: ['FFFA'], vendorIe: [],
    svcData: [{ uuid: 'FFFA', dataHex: '0D' + hexBytes(1) + '02' + '12' + ser + '000000' }],
    special: 'drone',
  }
}

function backgroundRadio() {
  if (Math.random() < 0.55) {
    const base = pick(HOME_SSIDS)
    const hidden = Math.random() < 0.06
    return { kind: 'WIFI', mac: macFrom(pick(['F4F26D', 'B0BE76', '3C846A', 'E4C32A', '00E04C', '48A9D2', 'C8D3FF', '6C5AB0']) ), name: hidden ? '' : base.endsWith('_') || base.endsWith('-') ? base + hexBytes(2) : base, hidden, mfg: [], uuids: [], svcData: [], vendorIe: [] }
  }
  const apple = Math.random() < 0.45
  return {
    kind: 'BLE', mac: randomMac(), name: apple ? '' : pick(BLE_NAMES),
    mfg: apple ? [{ companyId: 76, dataHex: pick(['1005', '0C0E', '1007', '0F05', '1219']) + hexBytes(8) }] : Math.random() < 0.3 ? [{ companyId: 6, dataHex: '0109' + hexBytes(10) }] : [{ companyId: pick([117, 224, 89, 13, 301]), dataHex: hexBytes(8) }],
    uuids: Math.random() < 0.2 ? [pick(['180D', '180F', 'FE9F', 'FD6F'])] : [], svcData: [], vendorIe: [],
  }
}

export class Simulator {
  constructor(getFleets, density = 'BALANCED') {
    this.getFleets = getFleets
    this.density = density
    this.pool = []
    this.t = 0
    this.pos = { lat: 24.7136 + rnd(-0.01, 0.01), lon: 46.6753 + rnd(-0.01, 0.01) }
    this.heading = rnd(0, Math.PI * 2)
  }

  target() {
    return { SAVER: 18, BALANCED: 40, PERFORMANCE: 85 }[this.density] || 40
  }

  spawn() {
    const fleets = this.getFleets().filter((f) => f.enabled)
    let d
    const roll = Math.random()
    if (roll < 0.03) d = remoteIdRadio()
    else if (roll < 0.5 && fleets.length) {
      // Weight toward interesting classes so the demo shows variety.
      const interesting = fleets.filter((f) => f.attentionNote || ['FINDER', 'DRONE', 'GLASSES', 'WEARABLE', 'VEHICLE', 'AUDIO'].includes(f.kind))
      const f = Math.random() < 0.3 && interesting.length ? pick(interesting) : pick(fleets)
      d = radioFromFleet(f)
    }
    if (!d) d = backgroundRadio()
    d.baseRssi = rnd(-95, -42)
    d.life = rnd(8, 120)
    d.age = 0
    d.drift = rnd(-0.4, 0.4)
    d.channel = d.kind === 'WIFI' ? pick(WIFI_CH) : 0
    d.freq = d.kind === 'WIFI' ? chFreq(d.channel) : 2402
    d.security = d.kind === 'WIFI' ? pick(SEC) : ''
    d.name = d.name || ''
    return d
  }

  /** Persistent "companion" radios that ride along (tests co-travel and Mine). */
  companions() {
    if (this._companions) return this._companions
    const tile = { kind: 'BLE', mac: randomMac(), name: '', mfg: [], uuids: ['FEED'], svcData: [{ uuid: 'FEED', dataHex: '02' + hexBytes(8) }], vendorIe: [] }
    const watch = { kind: 'BLE', mac: randomMac(), name: 'Galaxy Watch6', mfg: [{ companyId: 117, dataHex: '0142' + hexBytes(6) }], uuids: [], svcData: [], vendorIe: [] }
    const hotspot = { kind: 'WIFI', mac: macFrom('A2' + hexBytes(2)), name: 'iPhone', mfg: [], uuids: [], svcData: [], vendorIe: [], channel: 6, freq: 2437, security: 'WPA2-PSK' }
    this._companions = [tile, watch, hotspot].map((d) => ({ ...d, baseRssi: rnd(-62, -48), life: Infinity, age: 0, drift: 0, channel: d.channel || 0, freq: d.freq || 2402, security: d.security || '', companion: true }))
    return this._companions
  }

  /** Walk the simulated observer ~1.4 m/s. Returns simulated position. */
  step(dt) {
    this.heading += rnd(-0.25, 0.25)
    const m = 1.4 * dt * 4 // accelerated so a short demo covers distance
    this.pos.lat += (Math.cos(this.heading) * m) / 111320
    this.pos.lon += (Math.sin(this.heading) * m) / (111320 * Math.cos((this.pos.lat * Math.PI) / 180))
    return { ...this.pos, acc: 8, simulated: true }
  }

  /** Returns a batch of sightings for this tick. */
  tick(dt = 1) {
    this.t += dt
    for (const d of this.pool) d.age += dt
    this.pool = this.pool.filter((d) => d.age < d.life)
    const need = this.target() - this.pool.length
    const spawnN = Math.max(0, Math.min(need, 1 + Math.floor(Math.random() * 4)))
    for (let i = 0; i < spawnN; i++) this.pool.push(this.spawn())
    let burst = []
    if (this.density === 'PERFORMANCE' && Math.random() < 0.012) {
      // Pairing flood: many fresh addresses, same loudness, Fast Pair-like payload.
      const level = rnd(-70, -55)
      burst = Array.from({ length: 18 }, () => ({ kind: 'BLE', mac: randomMac(), name: '', mfg: [{ companyId: 76, dataHex: '0719' + hexBytes(10) }], uuids: [], svcData: [], vendorIe: [], baseRssi: level, life: 6, age: 0, drift: 0, channel: 0, freq: 2402, security: '', flood: true }))
      this.pool.push(...burst)
    }
    const out = []
    for (const d of [...this.pool, ...this.companions()]) {
      // Wi-Fi APs are scanned roughly every few seconds; BLE advertises constantly.
      if (d.kind === 'WIFI' && Math.random() < 0.55 && !d.companion) continue
      if (d.kind === 'BLE' && Math.random() < 0.15) continue
      d.baseRssi = Math.max(-100, Math.min(-30, d.baseRssi + d.drift + rnd(-1.2, 1.2)))
      const rssi = Math.round(d.baseRssi + rnd(-4, 4))
      out.push({
        kind: d.kind, mac: d.mac, name: d.name, hidden: !!d.hidden, rssi,
        channel: d.channel, freq: d.freq, security: d.security,
        mfg: d.mfg, uuids: d.uuids, svcData: d.svcData, vendorIe: d.vendorIe,
      })
    }
    return out
  }
}
