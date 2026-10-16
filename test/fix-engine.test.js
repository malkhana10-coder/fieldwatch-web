// Regression tests for the engine fixes from the v1.3.1 verification round:
// import sanitizers, mid-scan imports, sit caps and size, place-memory leaks,
// hidden devices, the live-table cap and log replay coercion.
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { engine, sanitizeSettings, sanitizeFleet, sanitizeDecode, parseLog, APP_VERSION } from '../src/engine/engine.js'
import { matchRadio } from '../src/engine/catalog.js'
import { debrief, sitCsv, sitGpx, sitKml, sitWigle, aiPrompt, compareSits } from '../src/engine/reports.js'
import { idb } from '../src/engine/storage.js'
import { makeT, CLASSES } from '../src/i18n.js'

const catalog = JSON.parse(readFileSync(new URL('../public/data/signatures.json', import.meta.url)))
const stock = catalog.fleets
const base = { mfg: [], uuids: [], svcData: [], vendorIe: [], name: '' }
const airtag = (mac) => ({ kind: 'BLE', mac, name: '', rssi: -55, mfg: [{ companyId: 76, dataHex: '1219' + '10' + 'AB'.repeat(24) }] })
const hex6 = (i) => i.toString(16).toUpperCase().padStart(6, '0').match(/.{2}/g).join(':')
const resetSits = () => { engine.sits = []; engine.activeSitId = null }

// One fake Web Bluetooth scanner for the whole file (the engine registers its listener once).
const ble = { scans: [], listeners: [] }
const advert = (id) => ({ device: { id }, name: 'Real ' + id, rssi: -60, manufacturerData: new Map(), serviceData: new Map() })

beforeAll(async () => {
  Object.assign(engine.settings, { sound: false, vibrate: false, voice: false, notify: false, tgEnabled: false, location: false, cooldown: 60 })
  Object.defineProperty(globalThis.navigator, 'bluetooth', {
    configurable: true,
    value: {
      requestLEScan: async () => { const s = { stopped: 0, stop() { this.stopped++ } }; ble.scans.push(s); return s },
      addEventListener: (_, fn) => ble.listeners.push(fn),
    },
  })
  await engine.saveFleets(structuredClone(stock))
})
afterEach(() => { if (engine.running) engine.stop() })

describe('settings import: enum-like values are whitelisted', () => {
  it('drops unknown or prototype values for sort, source, lang, theme, density, view and filters', () => {
    const cur = engine.settings
    const s = sanitizeSettings(JSON.parse('{"__proto__":{"polluted":1},"sort":"__proto__","source":"wifi","lang":"fr","theme":"neon","density":"MAX","view":"GRID","filters":{"radio":"__proto__","classes":["FINDER","__proto__","NOPE","FINDER"],"__proto__":{"x":1}}}'), cur)
    for (const k of ['sort', 'source', 'lang', 'theme', 'density', 'view']) expect(s[k]).toBe(cur[k])
    expect(s.filters.radio).toBe(cur.filters.radio)
    expect(s.filters.classes).toEqual(['FINDER'])
    expect(Object.getPrototypeOf(s)).toBe(Object.prototype)
    expect(s.polluted).toBeUndefined()
    expect({}.polluted).toBeUndefined()
  })
  it('accepts every value the UI offers', () => {
    const ok = { sort: 'NAME', source: 'bridge', lang: 'ar', theme: 'night', density: 'SAVER', view: 'MAP', filters: { radio: 'BLE', classes: [...CLASSES] } }
    const s = sanitizeSettings(ok, engine.settings)
    expect(s).toMatchObject(ok)
    for (const sort of ['STRENGTH', 'NEWEST', 'FIRST_SEEN', 'NAME', 'SIGNATURES']) expect(sanitizeSettings({ sort }, engine.settings).sort).toBe(sort)
    for (const view of ['LIST', 'RADAR', 'CLASS', 'TIMELINE', 'MAP']) expect(sanitizeSettings({ view }, engine.settings).view).toBe(view)
    for (const source of ['demo', 'ble', 'bridge', 'replay']) expect(sanitizeSettings({ source }, engine.settings).source).toBe(source)
  })
  it('the live list never looks a sort key up on the prototype', () => {
    engine.radios.clear()
    engine.ingest([{ kind: 'BLE', mac: 'C2:10:00:00:00:01', rssi: -50 }, { kind: 'BLE', mac: 'C2:10:00:00:00:02', rssi: -40 }])
    const before = engine.settings.sort
    engine.settings.sort = '__proto__'
    expect(engine.visibleRadios().map((r) => r.rssi)).toEqual([-40, -50])
    engine.settings.sort = before
    engine.radios.clear()
  })
})

describe('signature import', () => {
  it('a class that is not a real class becomes OTHER, so the class label always renders', () => {
    const t = makeT('en')
    for (const kind of ['__proto__', 'constructor', 'toString', 42, null, 'WIFI']) {
      const f = sanitizeFleet({ id: 'x', name: 'x', kind, rules: [] })
      expect(f.kind).toBe('OTHER')
      expect(typeof t.cls(f.kind)).toBe('string')
    }
    expect(sanitizeFleet({ id: 'x', name: 'x', kind: 'BODYWORN', rules: [] }).kind).toBe('BODYWORN')
    expect(sanitizeFleet({ id: 'x', name: 'x', kind: 'FINDER', rules: [] }).kind).toBe('FINDER')
  })
  it('every stock signature survives the sanitizer unchanged, Huawei and Cisco included', () => {
    for (const f of stock) expect(sanitizeFleet(f)).toEqual(f)
    expect(sanitizeFleet(stock.find((f) => f.id === 'fleet-huawei')).rules.length).toBe(2051)
    expect(sanitizeFleet(stock.find((f) => f.id === 'fleet-cisco')).rules.length).toBe(1291)
  })
  it('a signature export, or a full backup, restores every rule and still recognises Huawei and Cisco APs', async () => {
    const counts = Object.fromEntries(stock.map((f) => [f.id, f.rules.length]))
    const check = () => {
      for (const f of engine.fleets) expect(f.rules.length).toBe(counts[f.id])
      expect(matchRadio(engine.compiled, { ...base, kind: 'WIFI', mac: 'B8:75:2E:11:22:33' })).toContain('fleet-huawei')
      expect(matchRadio(engine.compiled, { ...base, kind: 'WIFI', mac: 'AC:A0:16:11:22:33' })).toContain('fleet-cisco')
    }
    engine.importSignatures(engine.exportSignatures())
    check()
    await engine.importAll(engine.exportAll())
    check()
    expect(engine.fleets.length).toBe(stock.length)
  })
  it('decode specs are rebuilt field by field: malformed fields are dropped, labels are text', () => {
    const d = sanitizeDecode({
      source: 'manufacturerData', companyId: 76, fields: [
        null, 7, 'x',
        { id: 'ok', label: 'Byte', offset: 0, type: 'u8' },
        { id: 'objlabel', label: { a: 1 }, offset: 1, type: 'u8' },
        { id: 'badoff', offset: '2', type: 'u8' },
        { id: 'negoff', offset: -1, type: 'u8' },
        { id: 'badtype', offset: 0, type: 'evil' },
        { id: 'badlen', offset: 0, length: 'all', type: 'hex' },
        { id: 'badgate', offset: 0, type: 'u8', when: { op: 'eq', offset: 0, valueHex: 5 } },
        { id: 'badand', offset: 0, type: 'u8', when: { op: 'eq', offset: 0, valueHex: '10', and: { op: 'xor' } } },
        { id: 'enum', offset: 0, type: 'u8', enum: JSON.parse('{"1":"one","2":{"x":1},"__proto__":"p"}'), unit: 5 },
      ],
    })
    expect(d.fields.map((f) => f.id)).toEqual(['ok', 'objlabel', 'enum'])
    expect(d.fields[1].label).toBe('objlabel')
    expect(d.fields[2].enum).toEqual({ 1: 'one' })
    expect(Object.getPrototypeOf(d.fields[2].enum)).toBe(Object.prototype)
    expect(d.fields[2].unit).toBe(null)
    expect(sanitizeDecode({ source: 'manufacturerData', fields: [null] })).toBe(null)
    expect(sanitizeDecode({ source: 'nope', fields: [{ id: 'a', offset: 0, type: 'u8' }] })).toBe(null)
    expect(sanitizeFleet({ id: 'x', name: 'x', rules: [], decode: { source: 'serviceData', fields: [null] } })).not.toHaveProperty('decode')
  })
  it('an imported signature with a hostile decode spec decodes Apple devices into plain text', () => {
    const evil = {
      id: 'custom-evil', name: 'Evil', kind: 'PHONE', rules: [{ kind: 'MANUFACTURER_ID', companyId: 76 }],
      decode: { source: 'manufacturerData', companyId: 76, fields: [null, { id: 'a', label: { a: 1 }, offset: 0, type: 'u8' }] },
    }
    engine.importSignatures(JSON.stringify({ fleets: [evil] }))
    engine.radios.clear()
    expect(() => engine.ingest([{ kind: 'BLE', mac: 'C2:20:00:00:00:01', rssi: -50, mfg: [{ companyId: 76, dataHex: '1005AABB' }] }])).not.toThrow()
    const r = engine.radios.get('BLE:C2:20:00:00:00:01')
    expect(r.fleetIds).toContain('custom-evil')
    expect(r.decoded.length).toBeGreaterThan(0)
    for (const d of r.decoded) { expect(typeof d.label).toBe('string'); expect(typeof d.value).toBe('string') }
    engine.deleteFleet('custom-evil')
    engine.radios.clear()
  })
  it('a malformed decode spec already in the catalog cannot break ingest', async () => {
    await engine.saveFleets([...engine.fleets, { id: 'custom-broken', name: 'Broken', enabled: true, kind: 'OTHER', rules: [{ kind: 'MANUFACTURER_ID', companyId: 76 }], decode: { source: 'manufacturerData', fields: [null] } }])
    engine.radios.clear()
    expect(() => engine.ingest([{ kind: 'BLE', mac: 'C2:20:00:00:00:02', rssi: -50, mfg: [{ companyId: 76, dataHex: '1005AABB' }] }])).not.toThrow()
    expect(engine.radios.get('BLE:C2:20:00:00:00:02').fleetIds).toContain('custom-broken')
    await engine.saveFleets(structuredClone(stock))
    engine.radios.clear()
  })
})

describe('backup import: sits and places', () => {
  it('sit device entries are normalised so Reports, the debrief and every export work', async () => {
    resetSits()
    const backup = JSON.parse(engine.exportAll())
    backup.sits = [
      {
        id: 's1', name: 'bad', start: 1000, end: 9000, path: [{ lat: 24.7, lon: 46.6 }, { lat: 'x', lon: 1 }, null], floods: [null, { t: 'x' }],
        radios: JSON.parse(JSON.stringify({
          'BLE:C2:00:00:00:00:01': { key: 'BLE:C2:00:00:00:00:01', kind: 'BLE', mac: 'C2:00:00:00:00:01', first: 1, last: 2, pts: [{ lat: 24.7, lon: 46.6 }] },
          'WIFI:F4:F2:6D:00:00:01': { name: { x: 1 }, fleetIds: [1, 'fleet-huawei'], pts: 'nope', maxRssi: 'loud', mine: 'yes' },
          a: null, 'BLE:C2:00:00:00:00:02': null, 'BLE:C2:00:00:00:00:03': [1],
        })),
      },
      { id: 's2', start: 1, radios: { a: null } },
      { id: 's1', start: 5, radios: {} },
      null, { id: 5, start: 1, radios: {} }, { id: 's3', start: 'x', radios: {} },
    ]
    const res = await engine.importAll(JSON.stringify(backup))
    expect(res.sits).toBe(2)
    const s = engine.sits[0]
    expect(Object.keys(s.radios)).toEqual(['BLE:C2:00:00:00:00:01', 'WIFI:F4:F2:6D:00:00:01'])
    for (const r of Object.values(s.radios)) {
      expect(Array.isArray(r.fleetIds) && r.fleetIds.every((x) => typeof x === 'string')).toBe(true)
      expect(typeof r.name).toBe('string')
      expect(typeof r.mac).toBe('string')
      for (const p of r.pts) for (const k of ['lat', 'lon', 't', 'rssi']) expect(Number.isFinite(p[k])).toBe(true)
    }
    expect(s.radios['WIFI:F4:F2:6D:00:00:01']).toMatchObject({ kind: 'WIFI', mac: 'F4:F2:6D:00:00:01', name: '', fleetIds: ['fleet-huawei'], pts: [], maxRssi: -100 })
    expect(s.radios['WIFI:F4:F2:6D:00:00:01']).not.toHaveProperty('mine')
    expect(s.path).toEqual([{ lat: 24.7, lon: 46.6, t: 1000 }])
    expect(s.floods).toEqual([{ t: 1000, n: 0, kind: 'pairing' }])
    // Exactly what the Reports list, debrief and exports read.
    for (const sit of engine.sits) {
      expect(() => Object.values(sit.radios).filter((r) => r.fleetIds.some((id) => engine.fleetById(id)?.attentionNote))).not.toThrow()
      expect(() => [debrief(sit, engine), sitCsv(sit, engine, false), sitGpx(sit, engine), sitKml(sit, engine), sitWigle(sit), aiPrompt(sit, engine, true)]).not.toThrow()
    }
    expect(() => compareSits(engine.sits[0], engine.sits[1])).not.toThrow()
    resetSits()
  })
  it('a sit recorded by the app survives export and import unchanged', async () => {
    resetSits()
    engine.radios.clear()
    engine.set({ source: 'ble' })
    const s = engine.startSit('round trip')
    const t0 = Date.now()
    for (let k = 0; k < 5; k++) {
      engine.pos = { lat: 24.7 + k * 0.001, lon: 46.6 }
      engine.ingest([airtag('C2:30:00:00:00:01'), { kind: 'WIFI', mac: 'B8:75:2E:11:22:33', name: 'HUAWEI-1', rssi: -60, security: 'WPA2-PSK' }], t0 + k * 1000)
      engine.sitPath(t0 + k * 1000)
    }
    engine.endSit()
    const before = JSON.parse(JSON.stringify(s))
    await engine.importAll(engine.exportAll())
    expect(engine.sits[0]).toEqual(before)
    engine.pos = null
    resetSits()
    engine.radios.clear()
  })
  it('place memory keys and classes from a file are whitelisted', async () => {
    const backup = JSON.parse(engine.exportAll())
    backup.places = JSON.parse(JSON.stringify({ devices: {} }))
    backup.places.devices = JSON.parse('{"__proto__":{"cells":{}},"constructor":{"cells":{}},"BLE:C2:40:00:00:00:01":{"kind":"BLE","cls":"__proto__","cells":{"1:1":{"days":["2026-10-01"]},"__proto__":{"days":[]},"9000:9000":{"days":["2026-10-02"]},"x":{"days":[]}}},"WIFI:F4:F2:6D:00:00:09":{"kind":"WIFI","cls":"FINDER","cells":{"here":{"days":["2026-10-02"]}}}}')
    await engine.importAll(JSON.stringify(backup))
    const devs = engine.mem.devices
    expect(Object.keys(devs).sort()).toEqual(['BLE:C2:40:00:00:00:01', 'WIFI:F4:F2:6D:00:00:09'])
    expect(Object.getPrototypeOf(devs)).toBe(Object.prototype)
    expect(devs['BLE:C2:40:00:00:00:01'].cls).toBe(null)
    expect(Object.keys(devs['BLE:C2:40:00:00:00:01'].cells)).toEqual(['1:1', '9000:9000'])
    expect(devs['WIFI:F4:F2:6D:00:00:09'].cls).toBe('FINDER')
    engine.forgetPlaces()
  })
})

describe('imports while scanning', () => {
  it('importing settings stops the scan first, so the source never switches under a running scan', async () => {
    engine.set({ source: 'ble' })
    await engine.start()
    expect(engine.running).toBe(true)
    const scan = ble.scans.at(-1)
    const file = JSON.parse(engine.exportSettings())
    file.settings.source = 'demo'
    engine.importSettings(JSON.stringify(file))
    expect(engine.running).toBe(false)
    expect(scan.stopped).toBe(1)
    expect(engine.settings.source).toBe('demo')
    // Adverts that still arrive after the scan stopped are dropped, not queued forever.
    ble.listeners[0](advert('late'))
    expect(engine.bleQueue.length).toBe(0)
  })
  it('importing a backup stops the scan first', async () => {
    engine.set({ source: 'ble' })
    await engine.start()
    const scan = ble.scans.at(-1)
    await engine.importAll(engine.exportAll())
    expect(engine.running).toBe(false)
    expect(scan.stopped).toBe(1)
  })
  it('the BLE queue is bounded while the scan runs', async () => {
    engine.set({ source: 'ble' })
    await engine.start()
    for (let i = 0; i < 6000; i++) ble.listeners[0](advert('d' + i))
    expect(engine.bleQueue.length).toBe(5000)
    engine.stop()
  })
  it('switching source mid-scan stops the scan; switching while stopped clears the old radios and position', async () => {
    engine.set({ source: 'demo' })
    await engine.start()
    expect(engine.radios.size).toBeGreaterThan(0)
    engine.set({ source: 'ble' })
    expect(engine.running).toBe(false)
    expect(engine.radios.size).toBe(0)
    engine.ingest([{ kind: 'WIFI', mac: 'F4:F2:6D:00:00:30', name: 'Real', rssi: -50 }])
    engine.pos = { lat: 24.7, lon: 46.6 }
    engine.set({ source: 'ble' }) // same source: nothing to clear
    expect(engine.radios.size).toBe(1)
    expect(engine.pos).not.toBe(null)
    engine.set({ source: 'demo' })
    expect(engine.radios.size).toBe(0)
    expect(engine.pos).toBe(null)
  })
  it('loading a replay while running stops the scan first', async () => {
    engine.set({ source: 'demo' })
    await engine.start()
    expect(engine.running).toBe(true)
    engine.loadReplay('{"ts":1,"kind":"WIFI","mac":"F4:F2:6D:00:00:31","rssi":-50}')
    expect(engine.running).toBe(false)
    expect(engine.radios.size).toBe(0)
  })
})

describe('place memory never receives simulated or replayed devices', () => {
  it('learn this place puts each radio in the memory of the source it came from', () => {
    engine.forgetPlaces()
    engine.set({ source: 'demo' })
    engine.ingest([{ kind: 'WIFI', mac: 'F4:F2:6D:00:00:40', name: 'Sim', rssi: -50 }])
    // A demo radio still in the table after the source changed (bypassing set()).
    engine.settings.source = 'bridge'
    engine.ingest([{ kind: 'WIFI', mac: 'F4:F2:6D:00:00:41', name: 'Real', rssi: -50 }])
    expect(engine.learnPlace()).toBe(2)
    expect(Object.keys(engine.mem.devices)).toEqual(['WIFI:F4:F2:6D:00:00:41'])
    expect(Object.keys(engine.placeMem('demo').devices)).toEqual(['WIFI:F4:F2:6D:00:00:40'])
    expect(engine.placeSummary().familiar.map((r) => r.mac).sort()).toEqual(['F4:F2:6D:00:00:40', 'F4:F2:6D:00:00:41'])
    engine.set({ source: 'demo' })
    engine.forgetPlaces()
  })
  it('replaying a log (e.g. one exported from the demo) uses a throwaway memory', () => {
    engine.forgetPlaces()
    const t = Date.now() - 3600e3
    const rows = []
    for (let k = 0; k < 10; k++) rows.push(JSON.stringify({ ts: t + k * 60000, kind: 'WIFI', mac: 'F4:F2:6D:00:00:50', name: 'Companion', rssi: -50, lat: 24.7 + k * 0.01, lon: 46.6 }))
    engine.loadReplay(rows.join('\n'))
    engine.set({ source: 'replay' })
    engine.replay.speed = 1e9
    const now = Date.now()
    engine.replayStep(now)
    engine.replayStep(now + 1000)
    expect(Object.keys(engine.mem.devices)).toEqual([])
    expect(Object.keys(engine.placeMem().devices)).toEqual(['WIFI:F4:F2:6D:00:00:50'])
    engine.set({ source: 'demo' })
    engine.forgetPlaces()
  })
})

describe('detectors', () => {
  it('hidden devices leave out nameless random devices a signature already identifies', () => {
    engine.radios.clear()
    engine.ingest([
      { kind: 'BLE', mac: '4A:00:00:00:00:01', rssi: -60, mfg: [{ companyId: 76, dataHex: '1005AB12CD34' }], addrType: 'random' }, // iPhone
      { kind: 'BLE', mac: '4A:00:00:00:00:02', rssi: -60, mfg: [{ companyId: 76, dataHex: '07190120140000' }], addrType: 'random' }, // AirPods
      { kind: 'BLE', mac: '4A:00:00:00:00:03', rssi: -60, addrType: 'random' }, // nothing to identify it
    ])
    expect(engine.radios.get('BLE:4A:00:00:00:00:01').fleetIds.length).toBeGreaterThan(0)
    const hidden = engine.hiddenDevices()
    expect(hidden.map((x) => x.r.mac)).toEqual(['4A:00:00:00:00:03'])
    expect(hidden[0].why).toBe('hiddenRand')
    engine.radios.clear()
  })
  it('marking a device Mine gives `named` a new identity, so memoised lists refresh even while stopped', () => {
    const before = engine.named
    engine.setNamed('BLE:4A:00:00:00:00:03', { mine: true })
    expect(engine.named).not.toBe(before)
    expect(before['BLE:4A:00:00:00:00:03']).toBeUndefined()
    const mid = engine.named
    engine.setNamed('BLE:4A:00:00:00:00:03', { mine: false })
    expect(engine.named).not.toBe(mid)
    expect(engine.named['BLE:4A:00:00:00:00:03']).toBeUndefined()
  })
})

describe('sits', () => {
  it('a full sit still records trackers, Extra attention, watched and named devices, and counts the rest', () => {
    resetSits()
    engine.radios.clear()
    engine.set({ source: 'ble' })
    const s = engine.startSit('busy')
    let now = Date.now()
    for (let i = 0; i < 4000; i += 500) engine.ingest(Array.from({ length: 500 }, (_, k) => ({ kind: 'BLE', mac: '4A:' + hex6(i + k) + ':00:00', rssi: -80 })), now++)
    expect(engine.sitSize(s)).toBe(4000)
    // An ordinary newcomer is left out, and counted once however often it is heard.
    engine.ingest([{ kind: 'BLE', mac: '4A:FF:00:00:00:01', rssi: -80 }], now++)
    engine.ingest([{ kind: 'BLE', mac: '4A:FF:00:00:00:01', rssi: -80 }], now++)
    expect(s.radios['BLE:4A:FF:00:00:00:01']).toBeUndefined()
    expect(s.dropped).toBe(1)
    // A separated AirTag, a watched Flipper and a device the user named still get in.
    const flipper = engine.fleets.find((f) => f.name === 'Flipper Zero').id
    engine.watch.add(flipper)
    engine.setNamed('BLE:4A:FF:00:00:00:04', { name: 'Neighbour' })
    engine.ingest([airtag('C2:FF:00:00:00:02'), { kind: 'BLE', mac: '80:E1:26:00:00:03', name: 'Flipper Kazoo', rssi: -60 }, { kind: 'BLE', mac: '4A:FF:00:00:00:04', rssi: -70 }], now++)
    for (const k of ['BLE:C2:FF:00:00:00:02', 'BLE:80:E1:26:00:00:03', 'BLE:4A:FF:00:00:00:04']) expect(s.radios[k]).toBeDefined()
    expect(engine.sitSize(s)).toBe(4003)
    expect(Object.keys(s.radios).length).toBe(4003)
    expect(debrief(s, engine).dropped).toBe(1)
    expect(aiPrompt(s, engine, true)).toContain('about 1 more')
    engine.watch.delete(flipper)
    engine.setNamed('BLE:4A:FF:00:00:00:04', { name: '' })
  })
  it('priority devices stop at the hard cap, and a full sit never counts its entries per sighting', () => {
    const s = engine.activeSit()
    const fake = (i, attention) => ({ key: 'BLE:4B:' + hex6(i) + ':00:00', kind: 'BLE', mac: '4B:' + hex6(i) + ':00:00', name: '', vendor: null, rssi: -70, channel: 0, fleetIds: [], attention, cls: null, mfg: [] })
    engine.sitSize(s)
    const keys = vi.spyOn(Object, 'keys')
    const now = Date.now()
    for (let i = 0; i < 2000; i++) engine.sitRecord(s, fake(i, true), now)
    for (let i = 0; i < 2000; i++) engine.sitRecord(s, fake(10000 + i, false), now)
    expect(keys).not.toHaveBeenCalled()
    keys.mockRestore()
    expect(Object.keys(s.radios).length).toBe(5000)
    expect(engine.sitSize(s)).toBe(5000)
    expect(s.dropped).toBe(1 + (2000 - 997) + 2000)
    engine.endSit()
    resetSits()
    engine.radios.clear()
  })
  it('per-device points stay few but keep the first, the strongest and the newest, and co-travel is still found', () => {
    resetSits()
    engine.radios.clear()
    engine.set({ source: 'ble' })
    const s = engine.startSit('walk')
    const t0 = Date.now() - 600000
    for (let k = 0; k <= 40; k++) {
      engine.pos = { lat: 24.7 + k * 0.00045 + 1e-9, lon: 46.6 + 1e-9 }
      engine.ingest([{ kind: 'BLE', mac: 'C2:44:44:44:44:44', name: 'Tile', rssi: k === 7 ? -40 : -70, uuids: ['FEED'] }], t0 + k * 10000)
    }
    const e = s.radios['BLE:C2:44:44:44:44:44']
    expect(e.pts.length).toBe(12)
    expect(e.pts[0]).toMatchObject({ lat: 24.7, lon: 46.6, t: t0 })
    expect(e.pts.filter((p) => p.rssi === -40)).toHaveLength(1)
    expect(e.pts.at(-1).t).toBe(t0 + 400000)
    for (const p of e.pts) { expect(p.lat).toBe(Math.round(p.lat * 1e6) / 1e6); expect(p.lon).toBe(46.6) }
    expect(e).not.toHaveProperty('mine')
    expect(e).not.toHaveProperty('flood')
    expect(e).not.toHaveProperty('security')
    const co = debrief(s, engine).coTravel.find((x) => x.r.key === e.key)
    expect(co.spread).toBeGreaterThan(1700)
    expect(sitGpx(s, engine)).toContain(`lat="${(24.7 + 7 * 0.00045).toFixed(6)}"`)
    expect(sitCsv(s, engine, false)).toContain('24.700000,46.600000')
    engine.endSit()
    engine.pos = null
    resetSits()
    engine.radios.clear()
  })
  it('the periodic save writes only the running sit, not every past sit', () => {
    resetSits()
    const writes = []
    const set = idb.set
    idb.set = async (k) => { writes.push(k) }
    try {
      engine.sits = [{ id: 'sit-old', name: 'old', start: 1, end: 2, path: [], radios: {}, floods: [] }]
      engine.set({ source: 'ble' })
      engine.startSit('live')
      expect(writes).toEqual(['sits', 'sitActive'])
      writes.length = 0
      engine.ingest([{ kind: 'WIFI', mac: 'F4:F2:6D:00:00:60', name: 'x', rssi: -50 }])
      engine.lastSave = 0
      engine.lastLogSave = Date.now()
      engine.tick()
      expect(writes).toContain('sitActive')
      expect(writes).not.toContain('sits')
      writes.length = 0
      engine.endSit()
      expect(writes).toEqual(['sits', 'sitActive'])
    } finally {
      idb.set = set
      resetSits()
      engine.radios.clear()
    }
  })
})

describe('live table', () => {
  it('is capped at 3000 radios, dropping the longest-silent ones but never the hunted radio', () => {
    engine.radios.clear()
    const now = Date.now()
    for (let i = 0; i < 3500; i++) { const key = 'BLE:4C:' + hex6(i) + ':00:00'; engine.radios.set(key, { key, lastSeen: now - 3500 + i }) }
    engine.huntKey = 'BLE:4C:' + hex6(0) + ':00:00'
    engine.prune(now)
    expect(engine.radios.size).toBe(2700)
    expect(engine.radios.has(engine.huntKey)).toBe(true)
    expect(engine.radios.has('BLE:4C:' + hex6(1) + ':00:00')).toBe(false)
    expect(engine.radios.has('BLE:4C:' + hex6(3499) + ':00:00')).toBe(true)
    engine.huntKey = null
    engine.radios.clear()
  })
})

describe('log replay', () => {
  it('JSONL rows with non-string fields are coerced or dropped, and replaying them cannot crash ingest', () => {
    const text = [
      '{"ts":1,"kind":"BLE","mac":"C2:00:00:00:00:01","name":{"x":1},"rssi":-50}',
      '{"ts":2,"kind":"BLE","mac":"C2:00:00:00:00:02","name":42,"rssi":-50,"raw":12,"mfg":"004C"}',
      '{"ts":3,"kind":"BLE","mac":12,"rssi":-50}',
      '{"ts":4,"kind":"WIFI","mac":{"a":1},"rssi":-50}',
      '{"ts":5,"kind":"BLE","mac":"nope","rssi":-50}',
      '{"ts":"x","kind":"BLE","mac":"C2:00:00:00:00:05","rssi":-50}',
      '{"ts":6,"kind":"WIFI","mac":"F4:F2:6D:00:00:01","name":"Cafe","rssi":"x","uuids":["FEED",5],"vendor_ie":{"a":1},"lat":true,"lon":"46.6"}',
      '[1,2]', 'null', '"str"', '{"ts":7}',
    ].join('\n')
    const rows = parseLog(text)
    expect(rows.map((r) => r.mac)).toEqual(['C2:00:00:00:00:01', 'C2:00:00:00:00:02', 'F4:F2:6D:00:00:01'])
    expect(rows.map((r) => r.name)).toEqual(['', '', 'Cafe'])
    expect(rows[1].mfg).toEqual([{ companyId: 76, dataHex: '' }])
    expect(rows[2]).toMatchObject({ rssi: -100, uuids: ['FEED'], vendorIe: [], lat: null, lon: 46.6 })
    engine.radios.clear()
    expect(() => engine.ingest(rows)).not.toThrow()
    for (const r of engine.radios.values()) { expect(Array.isArray(r.fleetIds)).toBe(true); expect(typeof r.name).toBe('string') }
    engine.radios.clear()
  })
  it('ingest skips malformed sightings instead of leaving a half-built radio behind', () => {
    engine.radios.clear()
    expect(() => engine.ingest([null, { kind: 'BLE', mac: 5 }, { kind: 'ZIGBEE', mac: 'C2:00:00:00:00:08' }, { kind: 'BLE', mac: '' }, { kind: 'BLE', mac: 'C2:00:00:00:00:09', name: {}, rssi: 'x' }])).not.toThrow()
    expect([...engine.radios.keys()]).toEqual(['BLE:C2:00:00:00:00:09'])
    expect(engine.radios.get('BLE:C2:00:00:00:00:09')).toMatchObject({ name: '', rssi: -100 })
    engine.radios.clear()
  })
})

describe('exports', () => {
  it('the WiGLE header carries the real app version', () => {
    const head = sitWigle({ radios: {} }).split('\n')[0]
    expect(head).toContain(`appRelease=fieldwatch-web-${APP_VERSION},`)
    expect(APP_VERSION).not.toBe('1.0.0')
  })
})

describe('bridge', () => {
  it('a late close from a stopped socket never reconnects, while a live socket still does', () => {
    vi.useFakeTimers()
    const sockets = []
    const realWS = globalThis.WebSocket
    globalThis.WebSocket = class { constructor(url) { this.url = url; sockets.push(this) } close() {} }
    try {
      engine.settings.bridgeUrl = 'ws://127.0.0.1:1/?token=x'
      engine.running = true
      engine.startBridge()
      const staleClose = sockets[0].onclose
      engine.stopBridge()
      engine.startBridge()
      staleClose({ code: 1006 })
      vi.advanceTimersByTime(3500)
      expect(sockets.length).toBe(2)
      expect(engine.bridge).toBe(sockets[1])
      sockets[1].onclose({ code: 1006 })
      vi.advanceTimersByTime(3500)
      expect(sockets.length).toBe(3)
      expect(engine.bridge).toBe(sockets[2])
    } finally {
      engine.stopBridge()
      engine.running = false
      engine.settings.bridgeUrl = ''
      globalThis.WebSocket = realWS
      vi.useRealTimers()
    }
  })
  it('a blocked insecure bridge URL gives a specific message (or the generic one), never a raw key', () => {
    const realWS = globalThis.WebSocket
    globalThis.WebSocket = class { constructor() { const e = new Error('insecure'); e.name = 'SecurityError'; throw e } }
    try {
      engine.connectBridge('ws://192.168.1.20:8765/?token=x')
      const text = engine.toasts.at(-1).text
      const want = engine.t('bridgeInsecure') !== 'bridgeInsecure' ? engine.t('bridgeInsecure') : engine.t('bridgeFailed')
      expect(text).toBe(want)
      expect(engine.bridgeState).toBe('error')
    } finally {
      globalThis.WebSocket = realWS
      engine.bridgeState = null
    }
  })
})

describe('boot repairs data stored by older versions', () => {
  it('merges the separately saved running sit and repairs stored sits, signatures and places', async () => {
    const live = { id: 'sit-live', name: 'live', start: 3000, end: null, path: [], floods: [], radios: { 'BLE:C2:50:00:00:00:01': { key: 'BLE:C2:50:00:00:00:01', kind: 'BLE', mac: 'C2:50:00:00:00:01', name: '', vendor: null, first: 3000, last: 3500, maxRssi: -50, minRssi: -60, sum: -110, count: 2, channel: 0, fleetIds: [], pts: [] } } }
    const newer = { id: 'sit-new', name: 'new', start: 5000, end: 6000, path: [], floods: [], radios: {} }
    const old = { id: 'sit-old', name: 'old', start: 1000, end: 2000, path: [], floods: [], radios: { 'BLE:C2:50:00:00:00:02': { key: 'BLE:C2:50:00:00:00:02', kind: 'BLE', mac: 'C2:50:00:00:00:02', first: 1, last: 2, pts: [] } } }
    const store = {
      // Older storage still holds a stale copy of the running sit in `sits`.
      sits: [newer, { ...live, radios: {} }, old],
      sitActive: live,
      fleets: [...structuredClone(stock), { id: 'custom-proto', name: 'Bad', kind: '__proto__', rules: [null, { kind: 'NAME_GLOB', text: 'x*' }], decode: { source: 'manufacturerData', fields: [null] } }],
      places: JSON.parse('{"devices":{"BLE:C2:50:00:00:00:03":{"kind":"BLE","cls":"__proto__","cells":{"1:1":{"days":["2026-10-01"]}}}}}'),
    }
    const get = idb.get
    const realFetch = globalThis.fetch
    const hadDocument = 'document' in globalThis
    idb.get = async (k) => structuredClone(store[k])
    globalThis.document = { baseURI: 'http://localhost/' }
    globalThis.fetch = async (u) => ({ json: async () => (String(u).endsWith('signatures.json') ? structuredClone(catalog) : { names: [], oui: {}, btc: {}, uuid: {}, app: {} }) })
    try {
      await engine.init()
      expect(engine.sits.map((s) => s.id)).toEqual(['sit-new', 'sit-live', 'sit-old'])
      expect(engine.activeSitId).toBe('sit-live')
      expect(Object.keys(engine.activeSit().radios)).toEqual(['BLE:C2:50:00:00:00:01'])
      expect(engine.sits[2].radios['BLE:C2:50:00:00:00:02'].fleetIds).toEqual([])
      expect(() => engine.sits.forEach((s) => debrief(s, engine))).not.toThrow()
      const bad = engine.fleets.find((f) => f.id === 'custom-proto')
      expect(bad.kind).toBe('OTHER')
      expect(bad.rules).toEqual([{ kind: 'NAME_GLOB', text: 'x*' }])
      expect(bad).not.toHaveProperty('decode')
      expect(engine.fleets.find((f) => f.id === 'fleet-remote-id').decode).toEqual(stock.find((f) => f.id === 'fleet-remote-id').decode)
      expect(engine.mem.devices['BLE:C2:50:00:00:00:03'].cls).toBe(null)
      // Current storage: `sits` without the running sit, which is inserted by start time.
      store.sits = [newer, old]
      resetSits()
      await engine.init()
      expect(engine.sits.map((s) => s.id)).toEqual(['sit-new', 'sit-live', 'sit-old'])
      expect(engine.activeSitId).toBe('sit-live')
      expect(engine.activeSit().radios['BLE:C2:50:00:00:00:01'].count).toBe(2)
    } finally {
      idb.get = get
      globalThis.fetch = realFetch
      if (!hadDocument) delete globalThis.document
      resetSits()
    }
  })
})
