import { describe, it, expect } from 'vitest'
import { advFingerprint, findPredecessor, linkRadios, trackerState, PlaceMemory, cellOf, memoryKey, locate, addSample } from '../src/engine/intel.js'
import { distM } from '../src/engine/geo.js'

const ble = (o) => ({ kind: 'BLE', randomized: true, name: '', uuids: [], svcData: [], mfg: [], history: [], positions: [], ...o })

describe('address rotation linking', () => {
  const t0 = 1_000_000
  it('links a new random address to the one that just went quiet with the same fingerprint', () => {
    const old = ble({ key: 'BLE:A', mac: 'C2:00:00:00:00:01', svcData: [{ uuid: 'FD5A', dataHex: '1234' }], firstSeen: t0 - 60000, lastSeen: t0 - 2000, rssi: -60, positions: [{ lat: 1, lon: 1 }] })
    const neu = ble({ key: 'BLE:B', mac: 'C2:00:00:00:00:02', svcData: [{ uuid: 'FD5A', dataHex: '9999' }], firstSeen: t0, lastSeen: t0 + 4000, rssi: -62, history: [[t0, -61]] })
    const other = ble({ key: 'BLE:C', mac: 'C2:00:00:00:00:03', svcData: [{ uuid: 'FEED', dataHex: '00' }], firstSeen: t0 - 9000, lastSeen: t0 - 1000, rssi: -61 })
    expect(advFingerprint(old)).toBe(advFingerprint(neu))
    expect(findPredecessor([old, neu, other], neu, t0 + 4000)).toBe(old)
    linkRadios(old, neu)
    expect(neu.identity).toBe('BLE:A')
    expect(neu.identityFirstSeen).toBe(t0 - 60000)
    expect(neu.prevMacs).toEqual(['C2:00:00:00:00:01'])
    expect(neu.positions.length).toBe(1)
    expect(old.succeededBy).toBe('BLE:B')
    // already succeeded: can't be claimed twice
    const third = ble({ ...neu, key: 'BLE:D', firstSeen: t0 + 1000 })
    expect(findPredecessor([old, third], third, t0 + 5000)).toBe(null)
  })
  it('refuses overlapping, too-different or ambiguous candidates', () => {
    const mk = (k, o) => ble({ key: k, mac: k, mfg: [{ companyId: 76, dataHex: '1005AA' }], ...o })
    const neu = mk('N', { firstSeen: t0, lastSeen: t0 + 4000, rssi: -60, history: [[t0, -60]] })
    expect(findPredecessor([mk('O', { firstSeen: 0, lastSeen: t0 + 3000, rssi: -60 }), neu], neu, t0 + 4000)).toBe(null) // still alive
    expect(findPredecessor([mk('O', { firstSeen: 0, lastSeen: t0 - 1000, rssi: -80 }), neu], neu, t0 + 4000)).toBe(null) // 20 dB louder
    const a = mk('A', { firstSeen: 0, lastSeen: t0 - 1000, rssi: -61 })
    const b = mk('B', { firstSeen: 0, lastSeen: t0 - 1200, rssi: -59 })
    expect(findPredecessor([a, b, neu], neu, t0 + 4000)).toBe(null) // two equally good phones
    expect(findPredecessor([mk('O', { firstSeen: 0, lastSeen: t0 - 1000, rssi: -60 }), neu], neu, t0 + 1000)).toBe(null) // not settled yet
  })
})

describe('tracker state', () => {
  const apple = (hex) => ble({ mfg: [{ companyId: 76, dataHex: hex }], firstSeen: Date.now() })
  it('reads Find My separated vs near-owner adverts', () => {
    const full = '1219' + 'C0' + 'AB'.repeat(24)
    expect(trackerState(apple(full))).toEqual({ separated: true, why: 'tsAppleSeparated', battery: 'critical' })
    expect(trackerState(apple('1202' + '0011')).separated).toBe(false)
  })
  it('flags any tracker that keeps its address for over 30 minutes', () => {
    const now = Date.now()
    expect(trackerState(ble({ cls: 'FINDER', firstSeen: now - 31 * 60000 }), now).why).toBe('tsStableAddress')
    expect(trackerState(ble({ cls: 'FINDER', firstSeen: now - 5 * 60000 }), now).separated).toBe(null)
    expect(trackerState(ble({ cls: 'AUDIO', firstSeen: now }), now)).toBe(null)
  })
})

describe('place memory', () => {
  const day = 24 * 3600 * 1000
  const home = { lat: 24.70, lon: 46.60 }
  const work = { lat: 24.75, lon: 46.70 } // ~11 km away
  const ap = { kind: 'WIFI', key: 'WIFI:AA', mac: 'AA', randomized: false, name: 'Home' }
  it('a device becomes familiar after two different days, or when the place is learned', () => {
    const m = new PlaceMemory()
    const t = new Date(2026, 9, 1, 12).getTime()
    m.observe(ap, cellOf(home), t)
    expect(m.familiar(ap, cellOf(home))).toBe(false)
    m.observe(ap, cellOf(home), t + 3600000)
    expect(m.familiar(ap, cellOf(home))).toBe(false)
    m.observe(ap, cellOf(home), t + day)
    expect(m.familiar(ap, cellOf(home))).toBe(true)
    const tv = { ...ap, key: 'WIFI:BB', mac: 'BB' }
    m.learn([tv], cellOf(work), t)
    expect(m.familiar(tv, cellOf(work))).toBe(true)
    expect(m.familiar(tv, cellOf(home))).toBe(false)
  })
  it('reports devices heard in places far apart, and survives a JSON round trip', () => {
    const m = new PlaceMemory()
    const tag = { kind: 'BLE', key: 'BLE:T', mac: 'T', randomized: true, cls: 'FINDER' }
    const phone = { kind: 'BLE', key: 'BLE:P', mac: 'P', randomized: true, cls: 'PHONE' }
    for (const pos of [home, { lat: 24.7005, lon: 46.6005 }, work]) { m.observe(tag, cellOf(pos), 1); m.observe(ap, cellOf(home), 1); m.observe(phone, cellOf(pos), 1) }
    expect(memoryKey(phone)).toBe(null)
    const m2 = new PlaceMemory(JSON.parse(JSON.stringify(m)))
    const hits = m2.multiPlace()
    expect(hits.map((h) => h.key)).toEqual(['BLE:T'])
    expect(hits[0].places.length).toBe(2)
    expect(m2.multiPlace({ exclude: (k) => k === 'BLE:T' })).toEqual([])
  })
})

describe('localization', () => {
  it('finds a device from readings taken on a walk around it', () => {
    const dev = { lat: 24.7136, lon: 46.6753 }
    const samples = []
    let seed = 7
    const noise = () => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647 - 0.5) * 4 }
    for (let i = 0; i < 40; i++) {
      // L-shaped walk passing ~20-60 m from the device
      const p = i < 20 ? { lat: dev.lat - 0.0004 + i * 0.00004, lon: dev.lon - 0.0003 } : { lat: dev.lat + 0.0004, lon: dev.lon - 0.0003 + (i - 20) * 0.00004 }
      const d = distM(p, dev)
      samples.push({ ...p, rssi: Math.round(-45 - 25 * Math.log10(d) + noise()), t: i * 1000 })
    }
    const est = locate(samples)
    expect(est).not.toBe(null)
    expect(distM(est, dev)).toBeLessThan(20)
    expect(est.radiusM).toBeGreaterThanOrEqual(5)
  })
  it('needs enough readings that spread out', () => {
    expect(locate([])).toBe(null)
    const still = Array.from({ length: 10 }, (_, i) => ({ lat: 24.7, lon: 46.6, rssi: -60, t: i }))
    expect(locate(still)).toBe(null)
  })
  it('addSample keeps readings only when moved or after a pause', () => {
    const r = { rssi: -50 }
    addSample(r, { lat: 24.7, lon: 46.6 }, 0)
    addSample(r, { lat: 24.7, lon: 46.6 }, 1000)
    addSample(r, { lat: 24.7001, lon: 46.6 }, 1500)
    addSample(r, { lat: 24.7001, lon: 46.6 }, 5000)
    expect(r.samples.length).toBe(3)
  })
})
