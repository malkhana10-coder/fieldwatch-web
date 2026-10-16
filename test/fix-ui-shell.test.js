import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { PALETTE } from '../src/engine/catalog.js'
import { NIGHT_SHADES, loadLeaflet, pickLeaflet, failedModuleUrl, resetLeafletForTests } from '../src/leaflet.jsx'

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
/** The declarations of the first rule whose selector list is exactly `sel`. */
const rule = (sel) => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = css.match(new RegExp('(?:^|\\n|\\})\\s*' + esc + '\\s*\\{([^}]*)\\}'))
  return m ? m[1] : null
}

describe('night signature shades', () => {
  it('has one shade per palette colour, all distinct', () => {
    expect(NIGHT_SHADES.length).toBe(PALETTE.length)
    expect(new Set(NIGHT_SHADES.map((c) => c.toLowerCase())).size).toBe(NIGHT_SHADES.length)
    // fleetColor() picks NIGHT_SHADES[i % length]: no index may fold onto another
    const picked = PALETTE.map((_, i) => NIGHT_SHADES[i % NIGHT_SHADES.length])
    expect(new Set(picked).size).toBe(PALETTE.length)
  })
  it('stays red-only (red is the strongest channel of every shade)', () => {
    for (const c of NIGHT_SHADES) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16))
      expect(r).toBeGreaterThan(g * 1.6)
      expect(r).toBeGreaterThan(b * 1.6)
    }
  })
})

describe('loadLeaflet', () => {
  const fakeL = { map() {}, tileLayer() {}, version: 'test' }
  beforeEach(() => resetLeafletForTests())

  it('retries after a failed import instead of caching the rejection', async () => {
    let calls = 0
    const importer = () => { calls++; return calls === 1 ? Promise.reject(new Error('offline')) : Promise.resolve({ default: fakeL }) }
    await expect(loadLeaflet(importer)).rejects.toThrow('offline')
    await expect(loadLeaflet(importer)).resolves.toBe(fakeL)
    expect(calls).toBe(2)
    // loaded: no more imports
    await expect(loadLeaflet(importer)).resolves.toBe(fakeL)
    expect(calls).toBe(2)
  })

  it('shares one attempt between concurrent callers', async () => {
    let calls = 0
    const importer = () => { calls++; return new Promise((res) => setTimeout(() => res({ default: fakeL }), 5)) }
    const [a, b] = await Promise.all([loadLeaflet(importer), loadLeaflet(importer)])
    expect(a).toBe(fakeL)
    expect(b).toBe(fakeL)
    expect(calls).toBe(1)
  })

  it('re-imports the failed chunk URL with a cache-busting query (browsers cache failed module fetches)', async () => {
    const url = 'http://localhost:4221/assets/leaflet-src-B9Fc9vmw.js'
    const importer = () => Promise.reject(new TypeError('Failed to fetch dynamically imported module: ' + url))
    const seen = []
    const byUrl = (u) => { seen.push(u); return seen.length === 1 ? Promise.reject(new TypeError('still offline')) : Promise.resolve({ l: { default: fakeL } }) }
    await expect(loadLeaflet(importer, byUrl)).rejects.toThrow('Failed to fetch')
    await expect(loadLeaflet(importer, byUrl)).rejects.toThrow('still offline')
    await expect(loadLeaflet(importer, byUrl)).resolves.toBe(fakeL)
    expect(seen).toEqual([url + '?retry=1', url + '?retry=2'])
  })

  it('rejects a module that is not Leaflet, and a throwing importer, without getting stuck', async () => {
    await expect(loadLeaflet(() => Promise.resolve({ default: {} }))).rejects.toThrow('Leaflet did not load')
    await expect(loadLeaflet(() => { throw new Error('sync boom') })).rejects.toThrow('sync boom')
    await expect(loadLeaflet(() => Promise.resolve(fakeL))).resolves.toBe(fakeL)
  })

  it('finds the Leaflet namespace in the export shapes Vite produces', () => {
    expect(pickLeaflet({ default: fakeL })).toBe(fakeL)
    expect(pickLeaflet(fakeL)).toBe(fakeL)
    expect(pickLeaflet({ l: { default: fakeL } })).toBe(fakeL)
    expect(pickLeaflet({ l: fakeL })).toBe(fakeL)
    expect(pickLeaflet({ nothing: 1 })).toBe(null)
  })

  it('reads the chunk URL out of Chromium and Firefox import errors', () => {
    expect(failedModuleUrl(new TypeError('Failed to fetch dynamically imported module: https://x.app/assets/leaflet-src-AB12.js'))).toBe('https://x.app/assets/leaflet-src-AB12.js')
    expect(failedModuleUrl(new TypeError('error loading dynamically imported module: http://localhost:5173/node_modules/.vite/deps/leaflet.js?v=1a2b'))).toBe('http://localhost:5173/node_modules/.vite/deps/leaflet.js')
    expect(failedModuleUrl(new TypeError('Importing a module script failed.'))).toBe(null)
    expect(failedModuleUrl(null)).toBe(null)
  })
})

// CSS filter functions (Filter Effects 1), applied in order with clamping, like Chromium.
const clamp = (c) => c.map((x) => Math.min(1, Math.max(0, x)))
const mul = (m, c) => m.map((row) => row[0] * c[0] + row[1] * c[1] + row[2] * c[2])
const FILTERS = {
  grayscale: (c, a) => { const y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; return c.map((x) => x + (y - x) * a) },
  invert: (c, a) => c.map((x) => a * (1 - x) + (1 - a) * x),
  brightness: (c, k) => c.map((x) => x * k),
  sepia: (c, a) => c.map((x, i) => x + (mul([[0.393, 0.769, 0.189], [0.349, 0.686, 0.168], [0.272, 0.534, 0.131]], c)[i] - x) * a),
  saturate: (c, s) => mul([[0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s], [0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s], [0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s]], c),
  'hue-rotate': (c, deg) => {
    const a = (deg * Math.PI) / 180, co = Math.cos(a), si = Math.sin(a)
    return mul([[0.213 + co * 0.787 - si * 0.213, 0.715 - co * 0.715 - si * 0.715, 0.072 - co * 0.072 + si * 0.928],
      [0.213 - co * 0.213 + si * 0.143, 0.715 + co * 0.285 + si * 0.140, 0.072 - co * 0.072 - si * 0.283],
      [0.213 - co * 0.213 - si * 0.787, 0.715 - co * 0.715 + si * 0.715, 0.072 + co * 0.928 + si * 0.072]], c)
  },
}
const applyFilter = (filter, hex) => {
  let c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  for (const [, fn, arg] of filter.matchAll(/([a-z-]+)\(([-\d.]+)(?:deg)?\)/g)) {
    expect(FILTERS[fn], 'unknown filter ' + fn).toBeTypeOf('function')
    c = clamp(FILTERS[fn](c, Number(arg)))
  }
  return c.map((x) => Math.round(x * 255))
}

describe('night map tiles', () => {
  const decl = rule(":root[data-theme='night'] .leaflet-tile-pane")
  const filter = decl && decl.match(/filter:\s*([^;]+);/)[1]
  it('folds tiles into dim red on black', () => {
    expect(filter).toBeTruthy()
    const out = Object.fromEntries(['#ffffff', '#f2efe9', '#aad3df', '#808080', '#333333', '#000000'].map((h) => [h, applyFilter(filter, h)]))
    // light map areas (white roads, OSM land) end up (near) black
    expect(Math.max(...out['#ffffff'])).toBeLessThanOrEqual(5)
    expect(out['#f2efe9'][0]).toBeLessThan(30)
    // nothing is brighter than #b40000 (dimmer than any night text), and it is pure red
    for (const [r, g, b] of Object.values(out)) {
      expect(r).toBeLessThanOrEqual(0xb4)
      expect(Math.max(g, b)).toBeLessThanOrEqual(6)
    }
    // still a usable map: darker input -> brighter red, with room between levels
    expect(out['#000000'][0]).toBeGreaterThan(out['#333333'][0])
    expect(out['#333333'][0]).toBeGreaterThan(out['#808080'][0] + 20)
    expect(out['#808080'][0]).toBeGreaterThan(out['#aad3df'][0] + 20)
  })
  it('the old chain fails the same check (the test can see the bug)', () => {
    const old = applyFilter('grayscale(1) brightness(.45) sepia(1) hue-rotate(-50deg) saturate(4)', '#ffffff')
    expect(old).toEqual([255, 102, 105])
  })
})

describe('night theme text contrast', () => {
  const night = rule(":root[data-theme='night']")
  const v = (name) => night.match(new RegExp('--' + name + ':\\s*(#[0-9a-fA-F]{6})'))[1]
  const lum = (hex) => {
    const f = (x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)
    const [r, g, b] = [1, 3, 5].map((i) => f(parseInt(hex.slice(i, i + 2), 16) / 255))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
  it('muted and faint text reach 4.5:1 on every night background, and stay red-only', () => {
    for (const fg of ['text', 'text-2', 'text-3']) {
      for (const bg of ['bg', 'surface', 'surface-2']) expect(ratio(v(fg), v(bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5)
      const c = v(fg)
      expect(parseInt(c.slice(1, 3), 16)).toBeGreaterThan(2 * Math.max(parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)))
    }
    // still a hierarchy: text > text-2 > text-3
    expect(lum(v('text'))).toBeGreaterThan(lum(v('text-2')))
    expect(lum(v('text-2'))).toBeGreaterThan(lum(v('text-3')))
  })
})

describe('shell CSS contracts', () => {
  it('.num-unit: never wraps, isolated LTR inline-block', () => {
    const d = rule('.num-unit')
    expect(d).toMatch(/white-space:\s*nowrap/)
    expect(d).toMatch(/unicode-bidi:\s*isolate/)
    expect(d).toMatch(/direction:\s*ltr/)
    expect(d).toMatch(/display:\s*inline-block/)
  })
  it('signed numbers keep their sign in Arabic (LRM in front of RTL number spans)', () => {
    expect(css).toMatch(/:root\[dir='rtl'\] \.nowrap::before,\s*:root\[dir='rtl'\] \.num-unit::before\s*\{\s*content:\s*'\\200E';/)
  })
  it('.ellipsis-start: truncates at its own end, keeping the start visible', () => {
    const d = rule('.ellipsis-start')
    for (const p of [/direction:\s*ltr/, /text-align:\s*start/, /overflow:\s*hidden/, /text-overflow:\s*ellipsis/, /white-space:\s*nowrap/, /unicode-bidi:\s*plaintext/, /min-width:\s*0/]) expect(d).toMatch(p)
  })
  it('a vendor inside a truncated meta line shrinks instead of being replaced by "…"', () => {
    expect(rule('.ellipsis:has(> .trunc, > .ellipsis-start)')).toMatch(/display:\s*flex/)
    expect(rule('.ellipsis > .trunc, .ellipsis > .ellipsis-start')).toMatch(/min-width:\s*0/)
  })
  it('the toast "+N" badge never shrinks or wraps; only the message wraps', () => {
    expect(rule('.toast')).not.toMatch(/overflow-wrap/)
    expect(rule('.toast > svg, .toast > .badge')).toMatch(/flex:\s*none/)
    expect(rule('.toast > .badge')).toMatch(/white-space:\s*nowrap/)
    expect(rule('.toast > span:not(.badge)')).toMatch(/overflow-wrap:\s*anywhere/)
  })
  it('RSSI numbers line up with the rest of the column in RTL', () => {
    expect(rule(":root[dir='rtl'] .rssi b")).toMatch(/text-align:\s*left/)
  })
})
