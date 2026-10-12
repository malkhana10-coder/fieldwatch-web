// End-to-end smoke test: builds must already be in dist/. Serves it, walks every
// screen in Arabic (dark, phone) and English (light, desktop), fails on any page error.
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'

const OUT = 'e2e-shots'
mkdirSync(OUT, { recursive: true })
const server = spawn('npx', ['vite', 'preview', '--port', '4180', '--strictPort'], { stdio: 'ignore' })
await new Promise((r) => setTimeout(r, 2500))
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
const errors = []
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function run(lang, scheme, w, h, tag, extra = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, geolocation: { latitude: 24.71, longitude: 46.67 }, permissions: ['geolocation'] })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`${tag} pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error' && !/tile\.openstreetmap|ERR_|net::/.test(m.text())) errors.push(`${tag} console: ${m.text()}`) })
  await page.addInitScript(([lang, extra]) => localStorage.setItem('fw.settings', JSON.stringify({ lang, location: true, density: 'BALANCED', accepted: true, ...extra })), [lang, extra])
  await page.goto('http://localhost:4180/')
  await wait(1500)
  const shot = (n) => page.screenshot({ path: `${OUT}/${tag}-${n}.png` })
  const dismiss = async () => { for (const sel of ['.dialog .btn.primary']) { const d = page.locator(sel); if (await d.count()) await d.first().click().catch(() => {}) } }
  const tab = async (i) => { await dismiss(); await page.locator('.tab').nth(i).click() }

  // onboarding
  await shot('00-onboarding')
  for (let i = 0; i < 3; i++) await page.locator('.onboarding .btn.primary').click()
  // home scan
  await page.locator('.scan-ring').click()
  await wait(9000)
  await shot('01-scanning')
  await page.evaluate(() => window.fieldwatch.finishScan())
  await wait(600)
  await dismiss()
  await shot('02-verdict')
  // ask the offline analyst
  await page.locator('#advisor-q').fill(lang === 'ar' ? 'هل أحد يلاحقني؟' : 'Is someone following me?')
  await page.locator('form button[type=submit]').first().click()
  await wait(500)
  await shot('03-advisor')
  // detail of first finding
  const f = page.locator('.finding').first()
  if (await f.count()) { await f.click(); await wait(500); await shot('04-detail'); await page.keyboard.press('Escape') }
  // learn place
  await dismiss()
  await page.locator('.home-hero .btn.sm').first().click()
  await page.locator('#place-name').fill(lang === 'ar' ? 'المكتب' : 'Office')
  await page.locator('.dialog .btn.primary').click()
  // hunt
  await tab(1); await wait(400)
  const cand = page.locator('.radio').first(); if (await cand.count()) { await cand.click(); await wait(1500) }
  await shot('05-hunt')
  // reports + debrief
  await tab(2); await wait(400); await shot('06-reports')
  await page.locator('.card .sig button.grow').first().click(); await wait(800)
  await shot('07-debrief')
  await page.locator('.sheet .btn.sm.primary').first().click(); await wait(300); await shot('08-formal')
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape')
  // more pages
  await tab(3); await wait(300); await shot('09-more')
  for (const [i, n] of [[0, 'places'], [1, 'learn'], [2, 'stats'], [3, 'team'], [4, 'privacy']].entries ? [[0, 'places'], [1, 'learn'], [2, 'stats'], [3, 'team'], [4, 'privacy']] : []) {
    await page.locator('.more-tile').nth(i).click(); await wait(500)
    if (n === 'learn') await page.locator('.card .sig').first().click()
    await shot(`10-${n}`)
    if (n === 'privacy') {
      await page.locator('#pin1').fill('2468'); await page.locator('#pin2').fill('2468')
      await page.locator('.card .btn.primary').first().click(); await wait(1500)
      await page.locator('.topbar .btn[aria-label]').first().click(); await wait(300)
      await shot('11-locked')
      await page.locator('#unlock-pin').fill('2468'); await page.locator('.lock-screen .btn.primary').click(); await wait(1500)
      if (await page.locator('.lock-screen').count()) errors.push(`${tag}: unlock failed`)
      await shot('12-unlocked')
      break
    }
    await page.locator('.back-btn').click(); await wait(200)
  }
  // advanced mode → live grouped
  await page.evaluate(() => window.fieldwatch.set({ mode: 'advanced' }))
  await wait(300)
  await tab(1); await wait(1500); await shot('13-live')
  const s = await page.evaluate(() => ({ dir: document.documentElement.dir, theme: document.documentElement.dataset.theme, sits: window.fieldwatch.sits.length, places: window.fieldwatch.places.length }))
  console.log(tag, JSON.stringify(s))
  if (s.sits < 1 || s.places < 1) errors.push(`${tag}: expected a sit and a place, got ${JSON.stringify(s)}`)
  await ctx.close()
}

try {
  await run('ar', 'dark', 390, 844, 'ar-dark-phone')
  await run('en', 'light', 1280, 860, 'en-light-desktop')
  await run('ar', 'dark', 1280, 860, 'ar-night-desktop', { theme: 'night', highContrast: true, fontScale: 115 })
} catch (e) {
  errors.push('script: ' + e.message)
} finally {
  await browser.close()
  server.kill()
}
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'E2E OK: no page errors')
process.exit(errors.length ? 1 : 0)
