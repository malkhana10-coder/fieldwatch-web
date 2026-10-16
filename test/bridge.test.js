import { describe, it, expect } from 'vitest'
import { parseBridgeMessage, sanitizeSighting, MAX_DATA_BYTES, MAX_SVC_DATA } from '../src/engine/bridge.js'
import { decodeAdvert, wrapAdvert, encodeBasicId, encodeLocation, encodeSelfId, encodeSystem, encodeOperatorId } from '../src/engine/odid.js'

const ble = (extra = {}) => ({ kind: 'BLE', mac: 'C2:00:00:00:00:01', rssi: -60, ...extra })
const hexOf = (n, byte = 'AB') => byte.repeat(n)

// BT5 long-range advert: 0D, counter, message pack F2 19 n + n*25 bytes
function packAdvert(msgs) {
  const p = new Uint8Array(3 + 25 * msgs.length)
  p[0] = 0xf2; p[1] = 25; p[2] = msgs.length
  msgs.forEach((m, i) => p.set(m, 3 + 25 * i))
  return wrapAdvert(7, p)
}
const MSGS = [
  encodeBasicId({ idType: 1, uaType: 2, id: '1581F5FJD239C00DX8' }),
  encodeLocation({ status: 2, lat: 24.7, lon: 46.7, altGeo: 650, height: 50, speed: 5, direction: 90 }),
  encodeSelfId({ desc: 'Survey' }),
  encodeSystem({ opLat: 24.69, opLon: 46.69, opAlt: 600 }),
  encodeOperatorId({ id: 'FIN87astrdge12k8' }),
]

describe('bridge payload size limits', () => {
  it('keeps payloads up to 255 bytes intact (svcData and mfg)', () => {
    expect(MAX_DATA_BYTES).toBe(255)
    const s = sanitizeSighting(ble({ svcData: [{ uuid: 'FFFA', dataHex: hexOf(255) }], mfg: [{ companyId: 76, dataHex: hexOf(255, 'cd') }] }))
    expect(s.svcData[0].dataHex).toBe(hexOf(255))
    expect(s.mfg[0].dataHex).toBe(hexOf(255, 'CD'))
  })
  it('caps longer payloads at 255 bytes', () => {
    const s = sanitizeSighting(ble({ svcData: [{ uuid: 'FFFA', dataHex: hexOf(300) }], mfg: [{ companyId: 76, dataHex: hexOf(256) }] }))
    expect(s.svcData[0].dataHex.length).toBe(510)
    expect(s.mfg[0].dataHex.length).toBe(510)
  })
  it('keeps 130-byte (5 msg) and 230-byte (9 msg) Remote ID message packs decodable', () => {
    for (const n of [5, 9]) {
      const msgs = Array.from({ length: n }, (_, i) => MSGS[i % MSGS.length])
      const hex = packAdvert(msgs)
      expect(hex.length / 2).toBe(5 + 25 * n)
      const m = parseBridgeMessage(JSON.stringify({ type: 'sightings', items: [ble({ svcData: [{ uuid: 'FFFA', dataHex: hex }] })] }))
      const out = m.items[0].svcData[0].dataHex
      expect(out).toBe(hex.toUpperCase())
      expect(decodeAdvert(out).length).toBe(n)
    }
  })
})

describe('bridge svcData cap', () => {
  it('keeps up to 16 svcData entries (every distinct FFFA payload of a window)', () => {
    expect(MAX_SVC_DATA).toBe(16)
    const svcData = Array.from({ length: 20 }, (_, i) => ({ uuid: 'FFFA', dataHex: '0D' + i.toString(16).padStart(2, '0') + '12' }))
    const s = sanitizeSighting(ble({ svcData }))
    expect(s.svcData.length).toBe(16)
    expect(s.svcData.map((x) => x.dataHex)).toEqual(svcData.slice(0, 16).map((x) => x.dataHex.toUpperCase()))
  })
  it('still drops entries without a uuid and non-arrays', () => {
    expect(sanitizeSighting(ble({ svcData: [{ dataHex: '00' }, { uuid: 'FFFA', dataHex: 'zz' }] })).svcData).toEqual([{ uuid: 'FFFA', dataHex: '' }])
    expect(sanitizeSighting(ble({ svcData: 'FFFA' })).svcData).toEqual([])
  })
})

describe('bridge addrType', () => {
  it("accepts exactly 'public' and 'random'", () => {
    expect(sanitizeSighting(ble({ addrType: 'public' })).addrType).toBe('public')
    expect(sanitizeSighting(ble({ addrType: 'random' })).addrType).toBe('random')
  })
  it('maps anything else to null', () => {
    for (const v of [undefined, null, '', 'Public', 'RANDOM', ' random', 'random ', 'static', 1, true, {}, ['public'], { toString: () => 'public' }]) {
      expect(sanitizeSighting(ble({ addrType: v })).addrType).toBe(null)
    }
  })
  it('is present (null) on Wi-Fi items and survives parseBridgeMessage', () => {
    const m = parseBridgeMessage(JSON.stringify({ type: 'sightings', items: [
      { kind: 'WIFI', mac: 'AA:BB:CC:DD:EE:FF', rssi: -50 },
      ble({ addrType: 'random' }),
      ble({ mac: 'C2:00:00:00:00:02', addrType: 'evil' }),
    ] }))
    expect(m.items.map((x) => x.addrType)).toEqual([null, 'random', null])
  })
})
