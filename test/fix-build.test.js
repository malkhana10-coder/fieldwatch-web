// Build checks: the precache plugin (vite.config.js) and the CSP <meta> of the BUILT index.html.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { precacheManifest } from '../vite.config.js'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const SW_SRC = readFileSync(join(ROOT, 'public/sw.js'), 'utf8')

const buildId = (sw) => (sw.match(/const BUILD_ID = "([0-9a-f]{12})"/) || [])[1]
const precache = (sw) => JSON.parse((sw.match(/const PRECACHE = (\[[^\n]*\])\n/) || [])[1] || 'null')

function walk(dir, base = dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) walk(p, base, out)
    else out.push(relative(base, p).split('\\').join('/'))
  }
  return out
}

/** Run the plugin's hooks the way Vite does, with a root that is NOT process.cwd(). */
function runPlugin(root, outDir) {
  const warnings = []
  const p = precacheManifest()
  p.configResolved({ root, build: { outDir }, logger: { warn: (m) => warnings.push(m) } })
  p.closeBundle()
  return warnings
}

describe('precache plugin', () => {
  let tmp
  beforeAll(() => { tmp = mkdtempSync(join(tmpdir(), 'fw-precache-')) })
  afterAll(() => rmSync(tmp, { recursive: true, force: true }))

  it('resolves a relative build.outDir against the Vite root, not the cwd', () => {
    const root = join(tmp, 'root')
    const out = join(root, 'out')
    mkdirSync(join(out, 'assets'), { recursive: true })
    writeFileSync(join(out, 'sw.js'), SW_SRC)
    writeFileSync(join(out, 'index.html'), '<!doctype html>')
    writeFileSync(join(out, 'assets', 'a-123.js'), 'x')
    writeFileSync(join(out, 'assets', 'a-123.js.map'), '{}')
    expect(resolve(process.cwd())).not.toBe(root)
    expect(runPlugin(root, 'out')).toEqual([])
    const sw = readFileSync(join(out, 'sw.js'), 'utf8')
    expect(buildId(sw)).toMatch(/^[0-9a-f]{12}$/)
    expect(precache(sw)).toEqual(['./assets/a-123.js', './index.html'])
    expect(sw).not.toContain('__BUILD_ID__')
  })

  it('warns instead of crashing when sw.js is missing or has no placeholders', () => {
    const root = join(tmp, 'nosw')
    mkdirSync(join(root, 'dist'), { recursive: true })
    writeFileSync(join(root, 'dist', 'index.html'), '<!doctype html>')
    let w = runPlugin(root, 'dist')
    expect(w).toHaveLength(1)
    expect(w[0]).toMatch(/sw\.js not found/)

    writeFileSync(join(root, 'dist', 'sw.js'), '// already patched\n')
    w = runPlugin(root, 'dist')
    expect(w).toHaveLength(1)
    expect(w[0]).toMatch(/placeholders/)
    expect(readFileSync(join(root, 'dist', 'sw.js'), 'utf8')).toBe('// already patched\n')
  })
})

describe('production build (run from another directory)', () => {
  let tmp, dist, html, sw
  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'fw-build-'))
    dist = join(tmp, 'dist')
    // outDir relative to the root, while the cwd is somewhere else entirely and deeper than
    // the root, so resolving it against the cwd would point at a different directory.
    const cwd = join(tmp, ...ROOT.split(/[\\/]/).filter(Boolean).map(() => 'd'))
    mkdirSync(cwd, { recursive: true })
    const r = spawnSync(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), 'build', ROOT,
      '--outDir', relative(ROOT, dist), '--emptyOutDir', '--logLevel', 'warn'],
    { cwd, encoding: 'utf8', env: { ...process.env, NODE_ENV: 'production' } })
    expect(resolve(cwd, relative(ROOT, dist))).not.toBe(dist)
    if (r.status !== 0) throw new Error('vite build failed:\n' + r.stdout + r.stderr)
    html = readFileSync(join(dist, 'index.html'), 'utf8')
    sw = readFileSync(join(dist, 'sw.js'), 'utf8')
  }, 180_000)
  afterAll(() => tmp && rmSync(tmp, { recursive: true, force: true }))

  const csp = () => {
    const m = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/)
    expect(m).toBeTruthy()
    return Object.fromEntries(m[1].split(';').map((d) => d.trim().split(/\s+/)).filter((d) => d[0]).map(([k, ...v]) => [k, v]))
  }

  it('every inline <script> in the built index.html is allowed by its sha256 in the CSP', () => {
    const inline = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].filter((m) => !/\bsrc=/.test(m[1]))
    expect(inline.length).toBeGreaterThan(0)
    const scriptSrc = csp()['script-src']
    expect(scriptSrc).not.toContain("'unsafe-inline'")
    for (const m of inline) {
      const h = `'sha256-${createHash('sha256').update(m[2], 'utf8').digest('base64')}'`
      expect(scriptSrc, 'CSP hash of the inline script (recompute after editing index.html)').toContain(h)
    }
  })

  it('the CSP allows what the app and the Android app need', () => {
    const p = csp()
    expect(p['script-src']).toContain("'self'")                       // lazy chunks (Leaflet, Claude SDK)
    expect(p['style-src']).toEqual(expect.arrayContaining(["'self'", 'https://fonts.googleapis.com']))
    expect(p['font-src']).toEqual(expect.arrayContaining(["'self'", 'https://fonts.gstatic.com']))
    expect(p['img-src']).toEqual(expect.arrayContaining(["'self'", 'data:', 'https://tile.openstreetmap.org']))
    expect(p['connect-src']).toEqual(expect.arrayContaining(["'self'", 'https://api.anthropic.com', 'https://api.telegram.org', 'ws:', 'wss:']))
    expect(p['worker-src']).toContain("'self'")
    expect(p['manifest-src']).toContain("'self'")
    expect(p['upgrade-insecure-requests']).toBeUndefined()            // would turn ws://127.0.0.1 into wss://
    // Capacitor's fallback injection (old WebViews) puts an inline script right after "<head>",
    // which must stay before the CSP <meta> so the policy does not block it.
    expect(html).toContain('<head>')
    expect(html.indexOf('<head>')).toBeLessThan(html.indexOf('http-equiv="Content-Security-Policy"'))
  })

  it('the service worker gets a build id and a precache list of every output file', () => {
    expect(buildId(sw)).toMatch(/^[0-9a-f]{12}$/)
    const list = precache(sw)
    const files = walk(dist).filter((f) => f !== 'sw.js' && !f.endsWith('.map')).sort().map((f) => './' + f)
    expect(list).toEqual(files)
    expect(list).toEqual(expect.arrayContaining(['./index.html', './data/signatures.json', './data/radiodb.json', './manifest.webmanifest']))
    expect(list.some((f) => /^\.\/assets\/leaflet.*\.js$/.test(f))).toBe(true)
    expect(list.some((f) => /^\.\/assets\/leaflet.*\.css$/.test(f))).toBe(true)
    for (const f of list) expect(existsSync(join(dist, f)), f).toBe(true)
  })
})
