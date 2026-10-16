import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * After the build, write the list of every output file and a build id into
 * dist/sw.js, so the service worker precaches the whole app on first visit (it
 * then starts offline) and each deploy gets a fresh cache that replaces the old.
 */
function precacheManifest() {
  let outDir
  return {
    name: 'fieldwatch-precache',
    apply: 'build',
    configResolved(c) { outDir = c.build.outDir },
    closeBundle() {
      const files = []
      const walk = (d) => readdirSync(d).forEach((f) => {
        const p = join(d, f)
        if (statSync(p).isDirectory()) walk(p)
        else files.push(relative(outDir, p).split('\\').join('/'))
      })
      walk(outDir)
      const list = files.filter((f) => f !== 'sw.js' && !f.endsWith('.map')).sort().map((f) => './' + f)
      const hash = createHash('sha256')
      for (const f of list) hash.update(f).update(readFileSync(join(outDir, f)))
      const swPath = join(outDir, 'sw.js')
      const sw = readFileSync(swPath, 'utf8')
        .replace("'__BUILD_ID__'", JSON.stringify(hash.digest('hex').slice(0, 12)))
        .replace('[/* __PRECACHE__ */]', JSON.stringify(list))
      writeFileSync(swPath, sw)
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [react(), precacheManifest()],
  build: { target: 'es2020', chunkSizeWarningLimit: 800 },
  test: { exclude: ['**/node_modules/**', '**/dist/**', '.claude/**'] },
})
