import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { compileCatalog, matchRadio, globToRegex, isRandomized, suggestFleet } from '../src/engine/catalog.js'
import { decodeFields } from '../src/engine/decode.js'
import { parseLog } from '../src/engine/engine.js'
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
