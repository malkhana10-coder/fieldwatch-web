import { describe, it, expect } from 'vitest'
import {
  ODID_UUID, UA_TYPES, ID_TYPES, STATUS,
  decodeMessage, decodeAdvert, mergeDrone,
  encodeBasicId, encodeLocation, encodeSystem, encodeOperatorId, encodeSelfId, wrapAdvert,
} from '../src/engine/odid.js'

const hex = (s) => Uint8Array.from(s.replace(/\s+/g, '').match(/../g).map((x) => parseInt(x, 16)))
const asciiHex = (s, len) => [...s.padEnd(len, '\0')].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('').toUpperCase()

describe('odid constants', () => {
  it('exports labels', () => {
    expect(ODID_UUID).toBe('FFFA')
    expect(UA_TYPES).toHaveLength(16)
    expect(UA_TYPES[2]).toBe('Helicopter/Multirotor')
    expect(UA_TYPES[15]).toBe('Other')
    expect(ID_TYPES[1]).toBe('Serial number (CTA-2063-A)')
    expect(STATUS[2]).toBe('Airborne')
    expect(STATUS[4]).toBe('Remote ID system failure')
  })
})

describe('odid round-trips', () => {
  it('Basic ID', () => {
    const b = encodeBasicId({ idType: 1, uaType: 2, id: '1581F5FJD239C00DX8' })
    expect(b).toHaveLength(25)
    expect(b[0]).toBe(0x02)
    expect(b[1]).toBe(0x12)
    expect(decodeMessage(b)).toEqual({ type: 'basic', idType: 1, uaType: 2, id: '1581F5FJD239C00DX8' })
  })

  it('Basic ID truncates to 20 chars', () => {
    const m = decodeMessage(encodeBasicId({ idType: 4, uaType: 15, id: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' }))
    expect(m.id).toBe('ABCDEFGHIJKLMNOPQRST')
    expect(m.idType).toBe(4)
    expect(m.uaType).toBe(15)
  })

  it('Location (low speed, west direction)', () => {
    const inp = {
      status: 2, direction: 271, speed: 12.3, vspeed: -2.4, lat: 24.7136123, lon: 46.6753456,
      altBaro: 612.3, altGeo: 630.2, height: 120.1, heightType: 1, timestamp: 1234.56,
    }
    const m = decodeMessage(encodeLocation(inp))
    expect(m.type).toBe('location')
    expect(m.status).toBe(2)
    expect(m.heightType).toBe(1)
    expect(m.direction).toBe(271)
    expect(Math.abs(m.speed - inp.speed)).toBeLessThanOrEqual(0.125)
    expect(Math.abs(m.vspeed - inp.vspeed)).toBeLessThanOrEqual(0.25)
    expect(m.lat).toBeCloseTo(inp.lat, 7)
    expect(m.lon).toBeCloseTo(inp.lon, 7)
    expect(Math.abs(m.altBaro - inp.altBaro)).toBeLessThanOrEqual(0.25)
    expect(Math.abs(m.altGeo - inp.altGeo)).toBeLessThanOrEqual(0.25)
    expect(Math.abs(m.height - inp.height)).toBeLessThanOrEqual(0.25)
    expect(m.timestamp).toBeCloseTo(1234.6, 5)
  })

  it('Location high speed uses multiplier, clamps and handles directions', () => {
    let b = encodeLocation({ speed: 100, direction: 179, lat: -33.8688, lon: 151.2093 })
    expect(b[1] & 1).toBe(1)
    expect(b[1] & 2).toBe(0)
    let m = decodeMessage(b)
    expect(Math.abs(m.speed - 100)).toBeLessThanOrEqual(0.375)
    expect(m.direction).toBe(179)
    expect(m.lat).toBeCloseTo(-33.8688, 7)
    expect(m.lon).toBeCloseTo(151.2093, 7)

    // boundary: 63.75 still fits multiplier 0
    b = encodeLocation({ speed: 63.75, direction: 180 })
    expect(b[1] & 1).toBe(0)
    expect(b[3]).toBe(255)
    m = decodeMessage(b)
    expect(m.speed).toBe(63.75)
    expect(m.direction).toBe(180)

    // clamp: absurd speed -> max valid 254.25, never the 255 sentinel
    m = decodeMessage(encodeLocation({ speed: 9999, vspeed: 500, direction: 360, altGeo: 99999 }))
    expect(m.speed).toBe(254.25)
    expect(m.vspeed).toBe(62)
    expect(m.direction).toBe(0)
    expect(m.altGeo).toBe(31767.5)
    m = decodeMessage(encodeLocation({ speed: -5, vspeed: -500, direction: -90 }))
    expect(m.speed).toBe(0)
    expect(m.vspeed).toBe(-62)
    expect(m.direction).toBe(270)
  })

  it('Self ID', () => {
    const b = encodeSelfId({ desc: 'Survey flight over site B' })
    const m = decodeMessage(b)
    expect(m.type).toBe('selfid')
    expect(m.descType).toBe(0)
    expect(m.desc).toBe('Survey flight over site') // truncated to 23 chars
    expect(decodeMessage(encodeSelfId({ desc: 'Hello', descType: 1 }))).toEqual({ type: 'selfid', descType: 1, desc: 'Hello' })
  })

  it('System', () => {
    const inp = {
      opLat: 24.70001, opLon: 46.69999, opAlt: 601.7, areaCount: 3, areaRadius: 250,
      classificationType: 1, operatorLocationType: 2, timestamp: 245000000,
    }
    const b = encodeSystem(inp)
    expect(b[0]).toBe(0x42)
    expect(b[1]).toBe((1 << 2) | 2)
    const m = decodeMessage(b)
    expect(m.type).toBe('system')
    expect(m.opLat).toBeCloseTo(inp.opLat, 7)
    expect(m.opLon).toBeCloseTo(inp.opLon, 7)
    expect(Math.abs(m.opAlt - inp.opAlt)).toBeLessThanOrEqual(0.25)
    expect(m.areaCount).toBe(3)
    expect(m.areaRadius).toBe(250)
    expect(m.classificationType).toBe(1)
    expect(m.operatorLocationType).toBe(2)
    expect(m.timestamp).toBe(245000000)
    expect(m.timeMs).toBe(Date.UTC(2019, 0, 1) + 245000000 * 1000)
  })

  it('System EU category/class nibble order', () => {
    const b = encodeSystem({ category: 2, class: 3 })
    expect(b[17]).toBe(0x23)
    const m = decodeMessage(b)
    expect(m.category).toBe(2)
    expect(m.class).toBe(3)
  })

  it('Operator ID', () => {
    const b = encodeOperatorId({ id: 'FIN87astrdge12k8' })
    expect(b[0]).toBe(0x52)
    expect(decodeMessage(b)).toEqual({ type: 'operator', operatorIdType: 0, operatorId: 'FIN87astrdge12k8' })
  })

  it('Auth reports type only', () => {
    const b = new Uint8Array(25)
    b[0] = 0x22
    expect(decodeMessage(b).type).toBe('auth')
  })

  it('unknown message type', () => {
    const b = new Uint8Array(25)
    b[0] = 0x72
    expect(decodeMessage(b).type).toBe('unknown')
  })
})

describe('odid known byte vector', () => {
  it('decodes a hand-built Location message', () => {
    // byte0  12        type 1 (location), protocol version 2
    // byte1  26        0010 0 1 1 0 -> status 2 (Airborne), heightType 1 (AGL), EW 1, speedMult 0
    // byte2  5A        90, EW set -> direction 90 + 180 = 270
    // byte3  28        40 * 0.25 = 10.0 m/s
    // byte4  FA        int8 -6 * 0.5 = -3.0 m/s
    // 5..8   00FFBA0E  0x0EBAFF00 = 247136000 * 1e-7 = 24.7136
    // 9..12  E815D21B  0x1BD215E8 = 466753000 * 1e-7 = 46.6753
    // 13..14 990C      0x0C99 = 3225 * 0.5 - 1000 = 612.5 m (baro)
    // 15..16 BC0C      0x0CBC = 3260 * 0.5 - 1000 = 630.0 m (geo)
    // 17..18 C008      0x08C0 = 2240 * 0.5 - 1000 = 120.0 m (height)
    // byte19 4A        vertAcc 4, horizAcc 10
    // byte20 32        baroAcc 3, speedAcc 2
    // 21..22 3930      0x3039 = 12345 tenths -> 1234.5 s past the hour
    // byte23 05        tsAcc 5 (0.5 s)
    // byte24 00        reserved
    const b = hex('12 26 5A 28 FA 00FFBA0E E815D21B 990C BC0C C008 4A 32 3930 05 00')
    expect(b).toHaveLength(25)
    const m = decodeMessage(b)
    expect(m).toMatchObject({
      type: 'location', status: 2, heightType: 1, direction: 270, speed: 10, vspeed: -3,
      altBaro: 612.5, altGeo: 630, height: 120,
      vertAcc: 4, horizAcc: 10, baroAcc: 3, speedAcc: 2, timestamp: 1234.5, tsAcc: 5,
    })
    expect(m.lat).toBeCloseTo(24.7136, 9)
    expect(m.lon).toBeCloseTo(46.6753, 9)
    // and the encoder produces the same bytes for the same inputs
    const e = encodeLocation({
      status: 2, heightType: 1, direction: 270, speed: 10, vspeed: -3, lat: 24.7136, lon: 46.6753,
      altBaro: 612.5, altGeo: 630, height: 120, timestamp: 1234.5,
      vertAcc: 4, horizAcc: 10, baroAcc: 3, speedAcc: 2, tsAcc: 5,
    })
    expect([...e]).toEqual([...b])
  })

  it('decodes speed multiplier 1 by hand', () => {
    // byte1 = 0x11 -> status 1 (Ground), speedMult 1; byte3 = 0x64 = 100 -> 100*0.75 + 255*0.25 = 138.75
    const b = hex('12 11 0A 64 00 00000000 00000000 0000 0000 0000 00 00 FFFF 00 00')
    const m = decodeMessage(b)
    expect(m.status).toBe(1)
    expect(m.speed).toBe(138.75)
    expect(m.direction).toBe(10)
    expect(m.vspeed).toBe(0)
  })
})

describe('odid invalid sentinels', () => {
  it('maps sentinels to null', () => {
    // direction 361 (181 + EW), speed 255 w/ mult 1, vspeed 63 (raw 126), lat/lon 0, altitudes raw 0 (-1000)
    const b = hex('12 03 B5 FF 7E 00000000 00000000 0000 0000 0000 00 00 FFFF 00 00')
    const m = decodeMessage(b)
    expect(m.direction).toBeNull()
    expect(m.speed).toBeNull()
    expect(m.vspeed).toBeNull()
    expect(m.lat).toBeNull()
    expect(m.lon).toBeNull()
    expect(m.altBaro).toBeNull()
    expect(m.altGeo).toBeNull()
    expect(m.height).toBeNull()
    expect(m.timestamp).toBeNull()
  })

  it('encoder writes sentinels for missing values', () => {
    const b = encodeLocation({})
    expect(b[1] & 0x03).toBe(0x03) // EW + mult
    expect(b[2]).toBe(181)
    expect(b[3]).toBe(255)
    expect(b[4]).toBe(126)
    const m = decodeMessage(b)
    for (const k of ['direction', 'speed', 'vspeed', 'lat', 'lon', 'altBaro', 'altGeo', 'height', 'timestamp']) {
      expect(m[k]).toBeNull()
    }
    const s = decodeMessage(encodeSystem({}))
    expect(s.opLat).toBeNull()
    expect(s.opLon).toBeNull()
    expect(s.opAlt).toBeNull()
    expect(s.timestamp).toBeNull()
  })
})

describe('decodeAdvert', () => {
  it('decodes a wrapped message', () => {
    const adv = wrapAdvert(0x2a, encodeOperatorId({ id: 'OP-123' }))
    expect(adv).toMatch(/^0D2A52/)
    expect(adv).toHaveLength(54)
    expect(adv).toBe(adv.toUpperCase())
    expect(decodeAdvert(adv)).toEqual([{ type: 'operator', operatorIdType: 0, operatorId: 'OP-123' }])
    expect(decodeAdvert(adv.toLowerCase())).toHaveLength(1)
  })

  it('rejects wrong app code and short payloads', () => {
    const adv = wrapAdvert(1, encodeBasicId({ idType: 1, uaType: 2, id: 'X' }))
    expect(decodeAdvert('0E' + adv.slice(2))).toEqual([])
    expect(decodeAdvert(adv.slice(0, 50))).toEqual([])
    expect(decodeAdvert('0D01')).toEqual([])
    expect(decodeAdvert('')).toEqual([])
    expect(decodeAdvert(null)).toEqual([])
    expect(decodeAdvert('0D0Z')).toEqual([])
  })

  it('decodes the simulator payload', () => {
    const serial = '1581F3A9C04D7E12'
    const dataHex = '0D' + '7F' + '02' + '12' + asciiHex(serial, 20) + '000000'
    expect(decodeAdvert(dataHex)).toEqual([{ type: 'basic', idType: 1, uaType: 2, id: serial }])
  })

  it('decodes a message pack with 2 messages', () => {
    const m1 = encodeBasicId({ idType: 1, uaType: 2, id: 'SN-PACK-1' })
    const m2 = encodeLocation({ status: 2, lat: 24.5, lon: 46.5, altGeo: 700, speed: 5, direction: 45 })
    const pack = new Uint8Array(3 + 50)
    pack[0] = 0xf2
    pack[1] = 25
    pack[2] = 2
    pack.set(m1, 3)
    pack.set(m2, 28)
    const p = decodeMessage(pack)
    expect(p.type).toBe('pack')
    expect(p.messages).toHaveLength(2)
    const adv = '0D05' + [...pack].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase()
    const msgs = decodeAdvert(adv)
    expect(msgs).toHaveLength(2)
    expect(msgs[0]).toEqual({ type: 'basic', idType: 1, uaType: 2, id: 'SN-PACK-1' })
    expect(msgs[1].type).toBe('location')
    expect(msgs[1].lat).toBeCloseTo(24.5, 7)
    expect(msgs[1].direction).toBe(45)
  })

  it('ignores malformed packs', () => {
    const pack = new Uint8Array(28)
    pack[0] = 0xf2
    pack[1] = 24 // wrong single message size
    pack[2] = 1
    expect(decodeMessage(pack)).toEqual({ type: 'pack', messages: [] })
  })
})

describe('mergeDrone', () => {
  const adv = (bytes) => decodeAdvert(wrapAdvert(0, bytes))

  it('accumulates fields from separate adverts without mutating input', () => {
    let s = mergeDrone(null, adv(encodeBasicId({ idType: 1, uaType: 2, id: 'SERIAL123' })), 1000)
    expect(s).toMatchObject({ id: 'SERIAL123', idType: 1, uaType: 2, updated: 1000, track: [] })
    const frozen = JSON.stringify(s)
    const s2 = mergeDrone(s, adv(encodeLocation({
      status: 2, lat: 24.7, lon: 46.7, altGeo: 650, altBaro: 640, height: 50, heightType: 1, speed: 7, vspeed: 1, direction: 90,
    })), 2000)
    expect(JSON.stringify(s)).toBe(frozen)
    expect(s2).not.toBe(s)
    expect(s2.track).not.toBe(s.track)
    const s3 = mergeDrone(s2, adv(encodeSystem({ opLat: 24.69, opLon: 46.69, opAlt: 600, areaCount: 1, areaRadius: 100 })), 3000)
    const s4 = mergeDrone(s3, adv(encodeOperatorId({ id: 'OPID-1' })), 4000)
    const s5 = mergeDrone(s4, adv(encodeSelfId({ desc: 'Mapping' })), 5000)
    expect(s5).toMatchObject({
      id: 'SERIAL123', idType: 1, uaType: 2, operatorId: 'OPID-1', selfId: 'Mapping', status: 2,
      altGeo: 650, altBaro: 640, height: 50, heightType: 1, speed: 7, vspeed: 1, direction: 90,
      areaCount: 1, areaRadius: 100, opAlt: 600, updated: 5000,
    })
    expect(s5.lat).toBeCloseTo(24.7, 7)
    expect(s5.opLat).toBeCloseTo(24.69, 7)
    expect(s5.track).toHaveLength(1)
    expect(s5.track[0]).toMatchObject({ alt: 650, t: 2000 })
    expect(s2.operatorId).toBeNull()
  })

  it('keeps last valid position when a location has no fix', () => {
    let s = mergeDrone(null, adv(encodeLocation({ lat: 10, lon: 20 })), 0)
    s = mergeDrone(s, adv(encodeLocation({ status: 1 })), 1000)
    expect(s.lat).toBeCloseTo(10, 7)
    expect(s.status).toBe(1)
    expect(s.track).toHaveLength(1)
  })

  it('prefers serial number id and keeps others', () => {
    let s = mergeDrone(null, [
      { type: 'basic', idType: 4, uaType: 2, id: 'SESSION-XYZ' },
    ], 0)
    expect(s.id).toBe('SESSION-XYZ')
    expect(s.idType).toBe(4)
    s = mergeDrone(s, [{ type: 'basic', idType: 1, uaType: 2, id: 'SN-1' }], 1)
    s = mergeDrone(s, [{ type: 'basic', idType: 3, uaType: 2, id: 'UTM-UUID' }], 2)
    expect(s.id).toBe('SN-1')
    expect(s.idType).toBe(1)
    expect(s.ids).toEqual({ 1: 'SN-1', 3: 'UTM-UUID', 4: 'SESSION-XYZ' })
  })

  it('only appends moved or aged points', () => {
    const loc = (lat, lon) => ({ type: 'location', status: 2, lat, lon, altGeo: 100 })
    let s = mergeDrone(null, [loc(24.7, 46.7)], 0)
    s = mergeDrone(s, [loc(24.700001, 46.7)], 1000) // ~0.11 m, 1 s -> skip
    expect(s.track).toHaveLength(1)
    s = mergeDrone(s, [loc(24.70005, 46.7)], 2000) // ~5.6 m -> append
    expect(s.track).toHaveLength(2)
    s = mergeDrone(s, [loc(24.70005, 46.7)], 6000) // same spot, 4 s -> skip
    expect(s.track).toHaveLength(2)
    s = mergeDrone(s, [loc(24.70005, 46.7)], 7500) // same spot, 5.5 s -> append
    expect(s.track).toHaveLength(3)
    s = mergeDrone(s, [{ type: 'location', status: 2, lat: null, lon: null }], 60000) // no fix -> skip
    expect(s.track).toHaveLength(3)
  })

  it('caps the track at 300 points', () => {
    let s = null
    for (let i = 0; i < 350; i++) {
      s = mergeDrone(s, [{ type: 'location', status: 2, lat: 24 + i * 0.001, lon: 46, altGeo: null, altBaro: 80 }], i * 1000)
    }
    expect(s.track).toHaveLength(300)
    expect(s.track[0].lat).toBeCloseTo(24 + 50 * 0.001, 9)
    expect(s.track[299].lat).toBeCloseTo(24 + 349 * 0.001, 9)
    expect(s.track[299].alt).toBe(80)
  })

  it('flattens packs passed directly', () => {
    const s = mergeDrone(null, [{ type: 'pack', messages: [{ type: 'operator', operatorIdType: 0, operatorId: 'OPX' }] }], 5)
    expect(s.operatorId).toBe('OPX')
  })
})
