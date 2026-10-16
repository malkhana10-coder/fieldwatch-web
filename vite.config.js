import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

/** Forward slashes on every platform (precache URLs, Windows build machines). */
const toPosix = (p) => p.replace(/\\/g, '/')

/**
 * After the build, write the list of every output file and a build id into
 * dist/sw.js, so the service worker precaches the whole app on first visit (it
 * then starts offline) and each deploy gets a fresh cache that replaces the old.
 * build.outDir is resolved against the Vite root, not process.cwd(), so
 * `vite build <root>` from another directory patches the right sw.js.
 */
export function precacheManifest() {
  let outDir
  let logger = console
  return {
    name: 'fieldwatch-precache',
    apply: 'build',
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir)
      if (c.logger) logger = c.logger
    },
    closeBundle() {
      const warn = (msg) => logger.warn(`[fieldwatch-precache] ${msg}`)
      const swPath = join(outDir, 'sw.js')
      if (!existsSync(swPath)) {
        warn(`${toPosix(swPath)} not found; the service worker was not given a precache list.`)
        return
      }
      const files = []
      const walk = (d) => readdirSync(d).forEach((f) => {
        const p = join(d, f)
        if (statSync(p).isDirectory()) walk(p)
        else files.push(toPosix(relative(outDir, p)))
      })
      walk(outDir)
      const list = files.filter((f) => f !== 'sw.js' && !f.endsWith('.map')).sort().map((f) => './' + f)
      const hash = createHash('sha256')
      for (const f of list) hash.update(f).update(readFileSync(join(outDir, f)))
      const src = readFileSync(swPath, 'utf8')
      if (!src.includes("'__BUILD_ID__'") || !src.includes('[/* __PRECACHE__ */]')) {
        warn(`${toPosix(swPath)} has no __BUILD_ID__ / __PRECACHE__ placeholders; left unchanged.`)
        return
      }
      const sw = src
        .replace("'__BUILD_ID__'", () => JSON.stringify(hash.digest('hex').slice(0, 12)))
        .replace('[/* __PRECACHE__ */]', () => JSON.stringify(list))
      writeFileSync(swPath, sw)
    },
  }
}

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [react(), precacheManifest()],
  build: { target: 'es2020', chunkSizeWarningLimit: 800 },
  test: { exclude: ['**/node_modules/**', '**/dist/**', '.claude/**'] },
})
