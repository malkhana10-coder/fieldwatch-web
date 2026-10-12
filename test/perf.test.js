import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { compileCatalog } from '../src/engine/catalog.js'
import { engine } from '../src/engine/engine.js'

const cat = JSON.parse(readFileSync(new URL('../public/data/signatures.json', import.meta.url)))

describe('engine throughput', () => {
  it('ingests 2,000 radios per tick well inside a 1 s scan interval', () => {
    engine.fleets = cat.fleets
    engine.compiled = compileCatalog(cat.fleets)
    const hex = (n) => n.toString(16).toUpperCase().padStart(2, '0')
    const batch = Array.from({ length: 2000 }, (_, i) => ({
      kind: i % 2 ? 'BLE' : 'WIFI',
      mac: [i % 3 ? 'C2' : '00', '0F', 'B3', hex((i >> 8) & 255), hex(i & 255), '01'].join(':'),
      name: i % 5 ? '' : 'Flipper ' + i, rssi: -40 - (i % 55), channel: 6, freq: 2437,
      mfg: i % 2 ? [{ companyId: 76, dataHex: '1005AABBCC' }] : [], uuids: i % 7 ? [] : ['FEED'], svcData: [], vendorIe: [],
    }))
    const t0 = performance.now()
    for (let k = 0; k < 5; k++) engine.ingest(batch, Date.now() + k * 1000)
    const perTick = (performance.now() - t0) / 5
    console.log(`ingest: ${perTick.toFixed(1)} ms per tick of 2000 radios`)
    const t1 = performance.now()
    const vis = engine.visibleRadios(Date.now() + 5000)
    console.log(`visibleRadios: ${(performance.now() - t1).toFixed(1)} ms for ${vis.length} radios`)
    expect(perTick).toBeLessThan(400)
  })
})
