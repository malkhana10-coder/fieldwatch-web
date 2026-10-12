import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { compileCatalog, matchRadio } from '../src/engine/catalog.js'
import { appleKind, linkSig, stableId, riskScore, riskLevel, distanceBand, placeAt, guidance, explainPlain, CLASS_INFO } from '../src/engine/intel.js'
import { encryptExport, decryptExport, deriveKey, sealJson, openJson, randomSalt } from '../src/engine/secure.js'
import { parseSensorLine } from '../src/engine/serial.js'
import { GULF_FLEETS } from '../src/engine/gulf.js'
import { CLASSES } from '../src/i18n.js'
import { makeT } from '../src/i18n.js'

const cat = JSON.parse(readFileSync(new URL('../public/data/signatures.json', import.meta.url)))
const notesAr = JSON.parse(readFileSync(new URL('../public/data/notes-ar.json', import.meta.url)))
const base = { mfg: [], uuids: [], svcData: [], vendorIe: [], name: '', positions: [], history: [] }

// Minimal engine stand-in for the pure intelligence functions.
function fakeEngine(over = {}) {
  return {
    settings: { lang: 'en', privacy: false }, named: {},
    isMine(r) { return !!this.named[r.key]?.mine },
    coTravel: () => false, currentPlace: () => null, t: makeT('en'),
    ...over,
  }
}

describe('Arabic notes overlay', () => {
  it('covers every stock signature and keeps empty fields empty', () => {
    for (const f of cat.fleets) {
      expect(notesAr[f.id]).toBeDefined()
      expect(!!notesAr[f.id].notes).toBe(!!f.notes)
      expect(!!notesAr[f.id].attentionNote).toBe(!!f.attentionNote)
    }
  })
  it('keeps technical tokens in Latin script', () => {
    expect(notesAr['fleet-flock-cameras'].attentionNote).toContain('B4:1E:52')
  })
})

describe('Apple continuity', () => {
  it('flags Find My separated (type 0x12)', () => {
    const r = { ...base, kind: 'BLE', mfg: [{ companyId: 76, dataHex: '1219AABB' }] }
    expect(appleKind(r).findMySeparated).toBe(true)
  })
  it('names AirPods pairing (type 0x07)', () => {
    expect(appleKind({ ...base, mfg: [{ companyId: 76, dataHex: '0719' }] }).en).toMatch(/AirPods/)
  })
  it('ignores non-Apple data', () => {
    expect(appleKind({ ...base, mfg: [{ companyId: 6, dataHex: '0109' }] })).toBeNull()
  })
})

describe('identity linking', () => {
  it('gives two rotated addresses with the same advertisement shape the same link signature', () => {
    const a = { ...base, kind: 'BLE', mac: 'C1:00:00:00:00:01', randomized: true, mfg: [{ companyId: 76, dataHex: '1219' + '00'.repeat(25) }] }
    const b = { ...a, mac: 'D3:11:22:33:44:55', mfg: [{ companyId: 76, dataHex: '1219' + 'FF'.repeat(25) }] }
    expect(linkSig(a)).toBe(linkSig(b))
    expect(stableId(a)).toBe(stableId(b))
  })
  it('keeps factory addresses as their own identity', () => {
    const r = { ...base, kind: 'BLE', key: 'BLE:00:1A:11:00:00:01', randomized: false }
    expect(stableId(r)).toBe(r.key)
  })
})

describe('risk score', () => {
  const e = fakeEngine()
  it('scores a tracker higher than headphones', () => {
    const tag = { ...base, key: 'k1', kind: 'BLE', cls: 'FINDER', rssi: -70, firstSeen: 0, lastSeen: 1000 }
    const audio = { ...base, key: 'k2', kind: 'BLE', cls: 'AUDIO', rssi: -70, firstSeen: 0, lastSeen: 1000 }
    expect(riskScore(tag, { engine: e }).score).toBeGreaterThan(riskScore(audio, { engine: e }).score)
  })
  it('co-travel pushes a tracker into high risk', () => {
    const e2 = fakeEngine({ coTravel: () => true })
    const tag = { ...base, key: 'k1', kind: 'BLE', cls: 'FINDER', rssi: -70, firstSeen: 0, lastSeen: 1000 }
    expect(riskLevel(riskScore(tag, { engine: e2 }).score)).toBe('high')
  })
  it('marked-mine radios score 0', () => {
    const e3 = fakeEngine({ named: { k1: { mine: true } } })
    expect(riskScore({ ...base, key: 'k1', cls: 'FINDER', rssi: -40, firstSeen: 0, lastSeen: 1 }, { engine: e3 }).score).toBe(0)
  })
  it('known-at-place lowers the score', () => {
    const r = { ...base, key: 'BLE:00:1A:11:00:00:01', kind: 'BLE', cls: 'CAMERA', rssi: -70, firstSeen: 0, lastSeen: 1 }
    const place = { known: { [r.key]: 1 }, learnedAt: 0 }
    expect(riskScore(r, { engine: e, place }).score).toBeLessThan(riskScore(r, { engine: e }).score)
  })
  it('every class has knowledge text in both languages', () => {
    for (const c of CLASSES) { expect(CLASS_INFO[c].en.what).toBeTruthy(); expect(CLASS_INFO[c].ar.what).toBeTruthy() }
  })
  it('guidance and explanation exist for findings', () => {
    const r = { ...base, key: 'k', kind: 'BLE', cls: 'FINDER' }
    expect(guidance(r, e).length).toBeGreaterThan(2)
    expect(explainPlain(r, e)).toMatch(/tracker/i)
  })
})

describe('places and distance', () => {
  it('finds the place containing a position', () => {
    const places = [{ id: 'a', lat: 24.7, lon: 46.6, radius: 150 }]
    expect(placeAt(places, { lat: 24.7005, lon: 46.6 })?.id).toBe('a')
    expect(placeAt(places, { lat: 24.72, lon: 46.6 })).toBeNull()
  })
  it('maps RSSI to distance bands', () => {
    expect(distanceBand(-45).k).toBe('touch')
    expect(distanceBand(-60).k).toBe('room')
    expect(distanceBand(-90).k).toBe('far')
  })
})

describe('encryption', () => {
  it('round-trips an encrypted export and rejects the wrong password', async () => {
    const text = await encryptExport('correct horse', { a: 1, b: 'نص عربي' })
    expect(text).not.toContain('نص')
    expect(await decryptExport('correct horse', text)).toEqual({ a: 1, b: 'نص عربي' })
    await expect(decryptExport('wrong', text)).rejects.toThrow()
  }, 20000)
  it('seals values with a PIN-derived key', async () => {
    const key = await deriveKey('1234', randomSalt(), 1000)
    const box = await sealJson(key, [1, 2, 3])
    expect(box.__enc).toBe(1)
    expect(await openJson(key, box)).toEqual([1, 2, 3])
  })
})

describe('ESP32 sensor protocol', () => {
  it('parses BLE and Wi-Fi lines', () => {
    const b = parseSensorLine('{"t":"ble","mac":"C2:00:00:00:00:01","rssi":-61,"name":"Tile","mfg":[[76,"1219AA"]],"uuids":["FEED"],"svc":[["FEED","02AA"]]}')
    expect(b.kind).toBe('BLE'); expect(b.mfg[0].companyId).toBe(76); expect(b.svcData[0].uuid).toBe('FEED')
    const w = parseSensorLine('{"t":"wifi","mac":"00:0F:B3:00:00:01","rssi":-70,"ssid":"Home","ch":36,"sec":"WPA2-PSK"}')
    expect(w.kind).toBe('WIFI'); expect(w.freq).toBe(5180)
  })
  it('ignores junk', () => {
    expect(parseSensorLine('boot: ets Jun  8 2016')).toBeNull()
    expect(parseSensorLine('{"t":"ble"}')).toBeNull()
  })
})

describe('Gulf ISP pack', () => {
  it('matches default Saudi carrier SSIDs on Wi-Fi only', () => {
    const c = compileCatalog(GULF_FLEETS)
    expect(matchRadio(c, { ...base, kind: 'WIFI', mac: '00:11:22:33:44:55', name: 'STC_WiFi_5G_AB12' })).toContain('gulf-stc')
    expect(matchRadio(c, { ...base, kind: 'WIFI', mac: '00:11:22:33:44:55', name: 'Zain-4G-1234' })).toContain('gulf-zain')
    expect(matchRadio(c, { ...base, kind: 'BLE', mac: '00:11:22:33:44:55', name: 'STC_WiFi' })).toHaveLength(0)
  })
})

describe('encryption of large data', () => {
  it('seals a multi-megabyte log without overflowing the stack', async () => {
    const key = await deriveKey('1234', randomSalt(), 1000)
    const big = Array.from({ length: 30000 }, (_, i) => ({ ts: i, mac: 'AA:BB:CC:DD:EE:FF', name: 'device ' + i, rssi: -60 }))
    const box = await sealJson(key, big)
    expect((await openJson(key, box)).length).toBe(30000)
  })
})
