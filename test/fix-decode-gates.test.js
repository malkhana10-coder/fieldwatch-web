import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { decodeFields } from '../src/engine/decode.js'
import { encodeLocation, wrapAdvert } from '../src/engine/odid.js'

const cat = JSON.parse(readFileSync(new URL('../public/data/signatures.json', import.meta.url)))
const remoteId = cat.fleets.find((f) => f.id === 'fleet-remote-id')
const hex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()

describe('decode gates (and / mask / nmask)', () => {
  it('Remote ID location decodes exactly one heading and one speed for each flag combination', () => {
    for (const [direction, speed] of [[45, 10], [250, 10], [45, 100], [250, 100]]) {
      const msg = encodeLocation({ status: 2, direction, speed, lat: 24.7, lon: 46.7, height: 50 })
      const d = { kind: 'BLE', svcData: [{ uuid: 'FFFA', dataHex: wrapAdvert(1, msg) }] }
      const out = decodeFields(remoteId, d)
      const headings = out.filter((f) => f.id === 'heading')
      const speeds = out.filter((f) => f.id === 'hspeed')
      expect(headings.length, `direction ${direction}`).toBe(1)
      expect(speeds.length, `speed ${speed}`).toBe(1)
      expect(parseFloat(headings[0].value)).toBeCloseTo(direction, 0)
      expect(Math.abs(parseFloat(speeds[0].value) - speed)).toBeLessThan(1)
    }
  })
  it('a chained gate must hold too (Govee: length AND first byte)', () => {
    const fleet = { decode: { source: 'manufacturerData', companyId: 1, fields: [
      { id: 'x', label: 'X', offset: 1, type: 'u8', when: { op: 'len', length: 3, and: { offset: 0, op: 'eq', valueHex: '00' } } },
    ] } }
    const ok = decodeFields(fleet, { kind: 'BLE', mfg: [{ companyId: 1, dataHex: '000507' }] })
    const wrongFirst = decodeFields(fleet, { kind: 'BLE', mfg: [{ companyId: 1, dataHex: '010507' }] })
    expect(ok.map((f) => f.value)).toEqual(['5'])
    expect(wrongFirst).toEqual([])
  })
  it('unknown ops fail closed', () => {
    const fleet = { decode: { source: 'manufacturerData', companyId: 1, fields: [{ id: 'x', label: 'X', offset: 0, type: 'u8', when: { offset: 0, op: 'weird', valueHex: '00' } }] } }
    expect(decodeFields(fleet, { kind: 'BLE', mfg: [{ companyId: 1, dataHex: '00' }] })).toEqual([])
  })
})

import { radioText } from '../src/engine/reports.js'
describe('copy as text in privacy mode', () => {
  it('masks decoded coordinates and MACs inside decoded values', () => {
    const r = { kind: 'BLE', mac: 'C2:11:22:33:44:55', rssi: -60, firstSeen: 0, fleetIds: [], randomized: true,
      decoded: [{ id: 'lat', label: 'Latitude', value: '24.7123456 °' }, { id: 'peer', label: 'MAC in payload', value: 'AA:BB:CC:DD:EE:FF' }, { id: 'bat', label: 'Battery', value: '80 %' }] }
    const engine = { settings: { privacy: true }, displayName: () => 'x', avgRssi: () => -60, fleetById: () => null }
    const text = radioText(r, engine, (k) => k)
    expect(text).not.toContain('24.71')
    expect(text).not.toContain('DD:EE:FF')
    expect(text).toContain('80 %')
    engine.settings.privacy = false
    expect(radioText(r, engine, (k) => k)).toContain('24.7123456')
  })
})
