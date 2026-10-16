import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { compileCatalog, matchRadio, globToRegex, isRandomized, suggestFleet } from '../src/engine/catalog.js'
import { decodeFields } from '../src/engine/decode.js'
import { parseLog, engine } from '../src/engine/engine.js'
import { csvCell } from '../src/engine/geo.js'

const cat = JSON.parse(readFileSync(new URL('../public/data/signatures.json', import.meta.url)))
const compiled = compileCatalog(cat.fleets)
const base = { mfg: [], uuids: [], svcData: [], vendorIe: [], name: '' }
const ids = (d) => matchRadio(compiled, { ...base, ...d })

describe('signature engine', () => {
  it('loads stock catalog 94', () => {
    expect(cat.catalogVersion).toBe(94)
    expect(cat.fleets.length).toBeGreaterThan(250)
  })
  it('matches Wi-Fi OUI rows', () => {
    expect(ids({ kind: 'WIFI', mac: '00:0F:B3:12:34:56', name: 'x' })).toContain('fleet-actiontec')
  })
  it('matches a Flipper Zero by name glob', () => {
    const hits = ids({ kind: 'BLE', mac: '80:E1:26:00:00:01', name: 'Flipper Kazoo' })
    expect(hits.some((id) => cat.fleets.find((f) => f.id === id).name === 'Flipper Zero')).toBe(true)
  })
  it('matches Tile by service UUID FEED (16-bit and 128-bit forms)', () => {
    const tile = cat.fleets.find((f) => f.name === 'Tile Trackers').id
    expect(ids({ kind: 'BLE', mac: 'C2:00:00:00:00:01', uuids: ['FEED'] })).toContain(tile)
    expect(ids({ kind: 'BLE', mac: 'C2:00:00:00:00:01', uuids: ['0000feed-0000-1000-8000-00805f9b34fb'] })).toContain(tile)
  })
  it('does not match BLE-only rows on Wi-Fi', () => {
    const tile = cat.fleets.find((f) => f.name === 'Tile Trackers').id
    expect(ids({ kind: 'WIFI', mac: '00:11:22:33:44:55', uuids: ['FEED'] })).not.toContain(tile)
  })
  it('disabled fleets never match', () => {
    const fl = cat.fleets.map((f) => (f.id === 'fleet-actiontec' ? { ...f, enabled: false } : f))
    expect(matchRadio(compileCatalog(fl), { ...base, kind: 'WIFI', mac: '00:0F:B3:12:34:56' })).not.toContain('fleet-actiontec')
  })
  it('glob is anchored and case-insensitive', () => {
    expect(globToRegex('Flipper*').test('flipper ABC')).toBe(true)
    expect(globToRegex('Flipper*').test('MyFlipper')).toBe(false)
    expect(globToRegex('A?C').test('abc')).toBe(true)
  })
  it('randomized bit', () => {
    expect(isRandomized('C2:00:00:00:00:00')).toBe(true)
    expect(isRandomized('00:0F:B3:00:00:00')).toBe(false)
  })
  it('suggestFleet produces a self-matching signature', () => {
    const d = { ...base, kind: 'BLE', mac: 'D2:11:22:33:44:55', name: 'Widget-A1B2', mfg: [{ companyId: 89, dataHex: '0102' }] }
    const f = suggestFleet(d)
    expect(matchRadio(compileCatalog([f]), d)).toContain(f.id)
  })
})

describe('decoder', () => {
  it('decodes an Open Drone ID basic-ID frame', () => {
    const rid = cat.fleets.find((f) => f.name === 'Remote ID')
    const serial = [...'1581F12345678'.padEnd(20, '\0')].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
    const out = decodeFields(rid, { ...base, kind: 'BLE', svcData: [{ uuid: 'FFFA', dataHex: '0D0102' + '12' + serial + '000000' }] })
    const byId = Object.fromEntries(out.map((f) => [f.id, f.value]))
    expect(byId.app).toBe('Open Drone ID')
    expect(byId.msg_type).toBe('Basic ID')
    expect(byId.id_type).toBe('Serial (CTA-2063)')
  })
})

describe('log + csv', () => {
  it('parses the Android CSV log format', () => {
    const csv = 'timestamp,iso,kind,mac,name,rssi,channel,freq,oui,vendor,fleets,mfg,uuids,flags,raw,lat,lon,vendor_ie\n1760000000000,2025-10-09T00:00:00Z,BLE,C2:00:00:00:00:01,"Tag, x",-60,0,2402,C20000,,Tile,4C,FEED,RAND ,0102,24.7,46.6,\n'
    const rows = parseLog(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Tag, x')
    expect(rows[0].mfg[0].companyId).toBe(0x4c)
    expect(rows[0].uuids).toEqual(['FEED'])
    expect(rows[0].lat).toBeCloseTo(24.7)
  })
  it('guards spreadsheet formulas but keeps numbers', () => {
    expect(csvCell('=HYPERLINK(1)')).toBe("'=HYPERLINK(1)")
    expect(csvCell('-46.6')).toBe('-46.6')
    expect(csvCell('a,b')).toBe('"a,b"')
  })
})

describe('backup + telegram', () => {
  it('exportAll emits a full backup envelope', () => {
    const j = JSON.parse(engine.exportAll())
    expect(j.format).toBe('fieldwatch-web-backup')
    expect(j).toHaveProperty('settings')
    expect(Array.isArray(j.fleets)).toBe(true)
    expect(Array.isArray(j.sits)).toBe(true)
    expect(Array.isArray(j.log)).toBe(true)
    expect(Array.isArray(j.watch)).toBe(true)
  })
  it('sendTelegram reports missing credentials without a token', async () => {
    const before = engine.settings.tgToken
    engine.settings.tgToken = ''
    expect(await engine.sendTelegram('hello')).toBe('missing credentials')
    engine.settings.tgToken = before
  })
  it('importAll restores sits and log from a backup', async () => {
    const backup = JSON.parse(engine.exportAll())
    backup.sits = [{ id: 'sit-test', name: 'T', start: 1, end: 2, path: [], radios: {}, floods: [] }]
    backup.log = [{ ts: 1, kind: 'BLE', mac: 'C2:00:00:00:00:01', name: '', rssi: -60 }]
    const r = await engine.importAll(JSON.stringify(backup))
    expect(r.sits).toBe(1)
    expect(r.log).toBe(1)
    expect(engine.sits[0].id).toBe('sit-test')
  })
})

describe('telegram credentials stay on the device', () => {
  const secret = { tgEnabled: true, tgToken: '111:SECRET', tgChatId: '42' }
  it('exports never contain the token or chat ID', () => {
    const before = { ...engine.settings }
    Object.assign(engine.settings, secret)
    for (const text of [engine.exportSettings(), engine.exportAll()]) {
      expect(text).not.toContain('111:SECRET')
      const j = JSON.parse(text)
      expect(j.settings).not.toHaveProperty('tgToken')
      expect(j.settings).not.toHaveProperty('tgChatId')
      expect(j.settings).not.toHaveProperty('tgEnabled')
    }
    engine.settings = before
  })
  it('imports cannot redirect alerts to another bot', async () => {
    const before = { ...engine.settings }
    Object.assign(engine.settings, { tgEnabled: false, tgToken: 'mine', tgChatId: '1' })
    const evil = { tgEnabled: true, tgToken: '999:EVIL', tgChatId: '666' }
    engine.importSettings(JSON.stringify({ format: 'fieldwatch-web-settings', settings: { ...evil, privacy: true } }))
    const backup = JSON.parse(engine.exportAll())
    backup.settings = { ...backup.settings, ...evil }
    await engine.importAll(JSON.stringify(backup))
    expect(engine.settings.tgToken).toBe('mine')
    expect(engine.settings.tgChatId).toBe('1')
    expect(engine.settings.tgEnabled).toBe(false)
    expect(engine.settings.privacy).toBe(true)
    engine.settings = before
  })
})

describe('telegram batching', () => {
  it('batches a burst into one rate-limited message and masks MACs in privacy mode', async () => {
    vi.useFakeTimers()
    const before = { ...engine.settings }
    Object.assign(engine.settings, { tgEnabled: true, privacy: true })
    const sent = []
    const orig = engine.sendTelegram
    engine.sendTelegram = async (text) => { sent.push(text); return null }
    engine.tgNextAt = 0
    for (let i = 0; i < 30; i++) engine.notifyTelegram('line ' + i)
    await vi.advanceTimersByTimeAsync(0)
    expect(sent.length).toBe(1)
    expect(sent[0].split('\n').length).toBe(21) // 20 kept + "+10 skipped"
    expect(sent[0]).toContain('10')
    engine.notifyTelegram('next')
    await vi.advanceTimersByTimeAsync(1000)
    expect(sent.length).toBe(1) // still inside the minimum gap
    await vi.advanceTimersByTimeAsync(5000)
    expect(sent.length).toBe(2)
    expect(engine.tgName({ key: 'BLE:x', name: '', mac: 'AA:BB:CC:DD:EE:FF' })).not.toContain('EE:FF')
    engine.sendTelegram = orig
    engine.settings = before
    vi.useRealTimers()
  })
})

describe('watched networks', () => {
  it('watchedNetFor matches SSID case-insensitively', () => {
    const before = engine.settings.watchedNets
    engine.settings.watchedNets = ['MyHome', 'Office']
    expect(engine.watchedNetFor({ name: 'myhome' })).toBe('MyHome')
    expect(engine.watchedNetFor({ name: '  OFFICE  ' })).toBe('Office')
    expect(engine.watchedNetFor({ name: 'other' })).toBe(null)
    expect(engine.watchedNetFor({ name: '' })).toBe(null)
    engine.settings.watchedNets = before
  })
})

describe('detectors', () => {
  it('trackingAssessment flags a co-travelling finder as a tracker', () => {
    const r = {
      key: 'BLE:AA:BB:CC:DD:EE:FF', kind: 'BLE', mac: 'AA:BB:CC:DD:EE:FF',
      name: '', rssi: -60, lastSeen: Date.now(), firstSeen: Date.now() - 10 * 60 * 1000,
      positions: [{ lat: 24.7, lon: 46.6 }, { lat: 24.71, lon: 46.61 }, { lat: 24.8, lon: 46.7 }],
      fleetIds: [], cls: 'FINDER', attention: false, randomized: true, vendor: '', hidden: false, history: [],
    }
    engine.radios.set(r.key, r)
    const a = engine.trackingAssessment()
    engine.radios.delete(r.key)
    expect(a.level).toBe('MEDIUM')
    expect(a.reasons.length).toBe(1)
    expect(a.reasons[0].why).toBe('whyFinder')
  })

  it('trackingAssessment ignores a companion phone on a short trip and needs several for MEDIUM', () => {
    const now = Date.now()
    const phone = (i, minutes, far) => ({
      key: 'BLE:00:00:00:00:00:0' + i, kind: 'BLE', mac: '00:00:00:00:00:0' + i,
      name: 'iPhone', rssi: -60, lastSeen: now, firstSeen: now - minutes * 60 * 1000,
      positions: [{ lat: 24.7, lon: 46.6 }, { lat: 24.7, lon: 46.6 + far / 2 }, { lat: 24.7, lon: 46.6 + far }],
      fleetIds: [], cls: 'PHONE', attention: false, randomized: false, vendor: 'Apple', hidden: false, history: [],
    })
    const add = (rs) => rs.forEach((r) => engine.radios.set(r.key, r))
    const del = (rs) => rs.forEach((r) => engine.radios.delete(r.key))
    const short = [phone(1, 5, 0.003)] // ~300 m over 5 min
    add(short)
    expect(engine.trackingAssessment().level).toBe('LOW')
    del(short)
    const long = [phone(1, 20, 0.02), phone(2, 20, 0.02)] // ~2 km over 20 min
    add(long)
    const a = engine.trackingAssessment()
    expect(a.reasons.length).toBe(2)
    expect(a.level).toBe('LOW')
    const third = [phone(3, 20, 0.02)]
    add(third)
    expect(engine.trackingAssessment().level).toBe('MEDIUM')
    del([...long, ...third])
  })

  it('hiddenDevices flags hidden SSID and anonymous randomized BLE', () => {
    const h = { key: 'WIFI:11:22:33:44:55:66', kind: 'WIFI', mac: '11:22:33:44:55:66', name: '', hidden: true, rssi: -70, lastSeen: Date.now(), fleetIds: [], vendor: '', randomized: false, positions: [] }
    const anon = { key: 'BLE:22:33:44:55:66:77', kind: 'BLE', mac: '22:33:44:55:66:77', name: '', hidden: false, rssi: -80, lastSeen: Date.now(), fleetIds: [], vendor: '', randomized: true, positions: [] }
    engine.radios.set(h.key, h)
    engine.radios.set(anon.key, anon)
    const out = engine.hiddenDevices()
    engine.radios.delete(h.key)
    engine.radios.delete(anon.key)
    expect(out.some((x) => x.why === 'hiddenSsid')).toBe(true)
    expect(out.some((x) => x.why === 'hiddenRand')).toBe(true)
  })
})

import { parseBridgeMessage, sanitizeSighting, validBridgeUrl } from '../src/engine/bridge.js'
import { buildRequest, livePrompt, AI_MODEL } from '../src/engine/ai.js'
import { encodeLocation, encodeSystem, wrapAdvert } from '../src/engine/odid.js'

describe('bridge messages', () => {
  it('accepts well-formed sightings and drops malformed ones', () => {
    const m = parseBridgeMessage(JSON.stringify({ type: 'sightings', items: [
      { kind: 'WIFI', mac: 'aa:bb:cc:dd:ee:ff', name: 'Cafe', rssi: -60.4, channel: 6, freq: 2437, security: 'WPA2-PSK' },
      { kind: 'BLE', mac: 'C2:00:00:00:00:01', rssi: -70, mfg: [{ companyId: 76, dataHex: '12zz' }, { companyId: 6, dataHex: '0109' }], svcData: [{ uuid: 'FFFA', dataHex: '0d01' }] },
      { kind: 'ZIGBEE', mac: 'AA:BB:CC:DD:EE:FF' }, { kind: 'BLE', mac: 'nope' }, null,
    ] }))
    expect(m.items.length).toBe(2)
    expect(m.items[0]).toMatchObject({ kind: 'WIFI', mac: 'AA:BB:CC:DD:EE:FF', rssi: -60, channel: 6 })
    expect(m.items[1].mfg).toEqual([{ companyId: 76, dataHex: '' }, { companyId: 6, dataHex: '0109' }])
    expect(m.items[1].svcData).toEqual([{ uuid: 'FFFA', dataHex: '0D01' }])
    expect(parseBridgeMessage('{"type":"hello","agent":"fieldwatch-bridge","version":1,"caps":{"wifi":true,"ble":false},"platform":"linux"}')).toMatchObject({ type: 'hello', caps: { wifi: true, ble: false } })
    expect(parseBridgeMessage('not json')).toBe(null)
    expect(parseBridgeMessage('{"type":"exec","cmd":"x"}')).toBe(null)
    expect(sanitizeSighting({ kind: 'BLE', mac: 'C2:00:00:00:00:01', rssi: 'loud' }).rssi).toBe(-100)
    expect(validBridgeUrl('ws://127.0.0.1:8765/?token=abc')).toBe(true)
    expect(validBridgeUrl('http://127.0.0.1:8765')).toBe(false)
  })
})

describe('engine intelligence', () => {
  const reset = () => { engine.radios.clear(); engine.trackerAlerted.clear() }
  it('follows a tracker across an address rotation and keeps its trail', () => {
    reset()
    const t0 = Date.now()
    const tag = (mac) => ({ kind: 'BLE', mac, name: '', rssi: -55, svcData: [{ uuid: 'FD5A', dataHex: '42AABB' }], mfg: [], uuids: [] })
    engine.pos = { lat: 24.7, lon: 46.6 }
    engine.ingest([tag('C2:11:11:11:11:01')], t0)
    engine.pos = { lat: 24.71, lon: 46.61 }
    engine.ingest([tag('C2:11:11:11:11:01')], t0 + 60000)
    engine.ingest([tag('C2:11:11:11:11:02')], t0 + 62000)
    engine.ingest([tag('C2:11:11:11:11:02')], t0 + 66000)
    engine.linkRotations(t0 + 66000)
    const r = engine.radios.get('BLE:C2:11:11:11:11:02')
    expect(r.prevMacs).toEqual(['C2:11:11:11:11:01'])
    expect(r.identityFirstSeen).toBe(t0)
    expect(r.positions.map((p) => p.lat)).toEqual([24.7, 24.71, 24.71]) // old trail + the new address's first fix
    engine.pos = null
    reset()
  })
  it('decodes Remote ID adverts into a live drone with operator position', () => {
    reset()
    const now = Date.now()
    const mac = 'C2:22:22:22:22:22'
    const adv = (bytes, c) => ({ kind: 'BLE', mac, rssi: -80, svcData: [{ uuid: 'FFFA', dataHex: wrapAdvert(c, bytes) }] })
    engine.ingest([adv(encodeLocation({ status: 2, lat: 24.71, lon: 46.67, height: 80, altGeo: 690, speed: 10, direction: 90 }), 1)], now)
    engine.ingest([adv(encodeSystem({ opLat: 24.709, opLon: 46.669, operatorLocationType: 1 }), 2)], now + 100)
    const [d] = engine.drones(now + 200)
    expect(d.drone.lat).toBeCloseTo(24.71, 5)
    expect(d.drone.height).toBe(80)
    expect(d.drone.opLat).toBeCloseTo(24.709, 5)
    reset()
  })
  it('alerts once when a separated AirTag travels with you', () => {
    reset()
    const before = { ...engine.settings }
    Object.assign(engine.settings, { trackerAlerts: true, sound: false, vibrate: false, voice: false, notify: false, tgEnabled: false })
    const now = Date.now()
    const r = { key: 'BLE:C2:33:33:33:33:33', kind: 'BLE', mac: 'C2:33:33:33:33:33', name: '', rssi: -50, lastSeen: now, firstSeen: now - 10 * 60000,
      mfg: [{ companyId: 76, dataHex: '1219' + '10' + 'AB'.repeat(24) }], svcData: [], uuids: [], fleetIds: [], randomized: true, cls: 'FINDER',
      positions: [{ lat: 24.7, lon: 46.6 }, { lat: 24.702, lon: 46.6 }, { lat: 24.705, lon: 46.6 }], history: [] }
    engine.radios.set(r.key, r)
    const toasts = engine.toasts.length
    engine.checkTrackers(now)
    engine.checkTrackers(now + 5000)
    expect(engine.toasts.filter((x) => x.kind === 'alert').length).toBe(1)
    expect(engine.toasts.length).toBeGreaterThan(toasts - 1)
    expect(engine.trackingAssessment(now).reasons[0].why).toBe('whySeparated')
    engine.settings = before
    reset()
  })
  it('sentinel "new here only" stays quiet for learned devices and random phones', () => {
    reset()
    const before = { ...engine.settings }
    Object.assign(engine.settings, { sentinel: true, sentinelNewOnly: true, tgEnabled: false })
    engine.pos = null
    const now = Date.now()
    const ap = { kind: 'WIFI', mac: 'F4:F2:6D:00:00:01', name: 'Majlis', rssi: -50 }
    engine.ingest([ap], now)
    engine.learnPlace(now)
    engine.radios.clear()
    const n0 = engine.toasts.filter((x) => x.text.includes('Majlis')).length
    engine.ingest([ap], now + 1000)
    engine.ingest([{ kind: 'BLE', mac: 'C2:44:44:44:44:44', name: '', rssi: -60, mfg: [{ companyId: 76, dataHex: '1005AA' }] }], now + 1000)
    expect(engine.toasts.filter((x) => x.text.includes('Majlis')).length).toBe(n0)
    engine.ingest([{ kind: 'WIFI', mac: 'F4:F2:6D:00:00:02', name: 'Stranger', rssi: -50 }], now + 2000)
    expect(engine.toasts.some((x) => x.text.includes('Stranger'))).toBe(true)
    engine.forgetPlaces()
    engine.settings = before
    reset()
  })
  it('keeps the bridge URL and API key out of exports', () => {
    const before = { ...engine.settings }
    Object.assign(engine.settings, { bridgeUrl: 'ws://127.0.0.1:8765/?token=SECRETTOKEN', aiKey: 'sk-ant-SECRETKEY' })
    for (const text of [engine.exportSettings(), engine.exportAll()]) {
      expect(text).not.toContain('SECRETTOKEN')
      expect(text).not.toContain('SECRETKEY')
    }
    engine.settings = before
  })
})

describe('AI analysis request', () => {
  it('uses the current model with server-side fallback and answers in the UI language', () => {
    const req = buildRequest('hello', 'ar')
    expect(req.model).toBe(AI_MODEL)
    expect(req.fallbacks).toBe('default')
    expect(req.betas).toContain('server-side-fallback-2026-07-01')
    expect(req.system).toContain('Arabic')
    expect(req.messages).toEqual([{ role: 'user', content: 'hello' }])
  })
  it('live summary never includes coordinates', () => {
    engine.radios.clear()
    engine.pos = { lat: 24.123456, lon: 46.654321 }
    engine.ingest([{ kind: 'WIFI', mac: 'F4:F2:6D:00:00:09', name: 'Cafe', rssi: -50 }], Date.now())
    const p = livePrompt(engine)
    expect(p).toContain('Radios: 1')
    expect(p).not.toContain('24.12')
    expect(p).not.toContain('46.65')
    engine.pos = null
    engine.radios.clear()
    engine.forgetPlaces()
  })
})
