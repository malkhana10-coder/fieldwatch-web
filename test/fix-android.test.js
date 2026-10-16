import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'

// The native plugins are mocked: storage.js imports them on demand, and vi.mock also
// covers those dynamic imports.
const fs = vi.hoisted(() => ({ writeFile: vi.fn() }))
const share = vi.hoisted(() => ({ share: vi.fn() }))

vi.mock('@capacitor/filesystem', () => ({
  Filesystem: fs,
  Directory: { Cache: 'CACHE', Documents: 'DOCUMENTS' },
  Encoding: { UTF8: 'utf8' },
}))
vi.mock('@capacitor/share', () => ({ Share: share }))

const root = new URL('../', import.meta.url)
const read = (p) => readFileSync(new URL(p, root), 'utf8')

// A minimal browser: window (event target + optional Capacitor), document and URL blobs.
function fakeBrowser({ native }) {
  const events = []
  const anchors = []
  const win = {
    dispatchEvent: (ev) => { events.push(ev); return true },
    Capacitor: native === undefined ? undefined : { isNativePlatform: () => native },
  }
  const doc = {
    createElement: (tag) => {
      const el = { tag, href: '', download: '', clicked: 0, removed: false, click() { this.clicked++ }, remove() { this.removed = true } }
      anchors.push(el)
      return el
    },
    body: { appendChild: () => {} },
  }
  vi.stubGlobal('window', win)
  vi.stubGlobal('document', doc)
  vi.stubGlobal('CustomEvent', class { constructor(type, init) { this.type = type; this.detail = init?.detail } })
  return { events, anchors }
}

async function loadStorage() {
  vi.resetModules()
  return import('../src/engine/storage.js')
}

beforeEach(() => {
  fs.writeFile.mockReset().mockResolvedValue({ uri: 'file:///data/user/0/io.github.malkhana10.fieldwatch/cache/exports/fieldwatch-backup.json' })
  share.share.mockReset().mockResolvedValue({ activityType: 'com.google.android.apps.docs' })
})
afterEach(() => { vi.unstubAllGlobals() })

describe('isNative()', () => {
  it('is false without window, without Capacitor, or on the web platform', async () => {
    const { isNative } = await import('../src/native.js')
    expect(isNative()).toBe(false) // node: no window
    fakeBrowser({ native: undefined })
    expect(isNative()).toBe(false)
    fakeBrowser({ native: false })
    expect(isNative()).toBe(false)
  })
  it('is true inside the Capacitor app, and never throws', async () => {
    const { isNative } = await import('../src/native.js')
    fakeBrowser({ native: true })
    expect(isNative()).toBe(true)
    vi.stubGlobal('window', { Capacitor: { isNativePlatform: () => { throw new Error('boom') } } })
    expect(isNative()).toBe(false)
  })
})

describe('download() in the Android app', () => {
  it('writes the file to the cache and opens the share sheet with its uri', async () => {
    const { anchors, events } = fakeBrowser({ native: true })
    const { download } = await loadStorage()
    const ok = await download('fieldwatch-backup.json', '{"v":1}', 'application/json')
    expect(ok).toBe(true)
    expect(fs.writeFile).toHaveBeenCalledWith({
      path: 'exports/fieldwatch-backup.json',
      data: '{"v":1}',
      directory: 'CACHE',
      encoding: 'utf8',
      recursive: true,
    })
    expect(share.share).toHaveBeenCalledTimes(1)
    expect(share.share.mock.calls[0][0].files).toEqual(['file:///data/user/0/io.github.malkhana10.fieldwatch/cache/exports/fieldwatch-backup.json'])
    expect(anchors).toHaveLength(0) // no <a download>, which the WebView ignores
    expect(events).toHaveLength(0)
  })

  it('keeps file names inside the export folder', async () => {
    fakeBrowser({ native: true })
    const { download } = await loadStorage()
    await download('../../shared_prefs/x.json', '{}')
    await download('سجل-الموقع.csv', 'x')
    await download('...', 'x')
    const paths = fs.writeFile.mock.calls.map((c) => c[0].path)
    expect(paths[0]).toBe('exports/_.._shared_prefs_x.json')
    expect(paths[1]).toBe('exports/سجل-الموقع.csv')
    expect(paths[2]).toBe('exports/fieldwatch-export.txt')
    for (const p of paths) expect(p.split('/')).toHaveLength(2)
  })

  it('returns false quietly when the user closes the share sheet', async () => {
    const { events } = fakeBrowser({ native: true })
    share.share.mockRejectedValue(new Error('Share canceled'))
    const { download } = await loadStorage()
    expect(await download('fieldwatch-log.jsonl', '{}\n{}')).toBe(false)
    expect(events).toHaveLength(0)
  })

  it('returns false and reports the error when the file cannot be written', async () => {
    const { events } = fakeBrowser({ native: true })
    fs.writeFile.mockRejectedValue(new Error('No space left on device'))
    const { download } = await loadStorage()
    expect(await download('fieldwatch-settings.json', '{}')).toBe(false)
    expect(share.share).not.toHaveBeenCalled()
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('fw-download-failed')
    expect(events[0].detail).toEqual({ file: 'fieldwatch-settings.json', error: 'No space left on device' })
  })

  it('reports a share failure that is not a cancel', async () => {
    const { events } = fakeBrowser({ native: true })
    share.share.mockRejectedValue(new Error("Can't share while sharing is in progress"))
    const { download } = await loadStorage()
    expect(await download('sit.gpx', '<gpx/>')).toBe(false)
    expect(events.map((e) => e.type)).toEqual(['fw-download-failed'])
  })
})

describe('download() on the web', () => {
  it('clicks a blob <a download> and never loads the native plugins', async () => {
    const { anchors } = fakeBrowser({ native: false })
    const created = []
    vi.stubGlobal('URL', Object.assign(class extends URL {}, {
      createObjectURL: (b) => { created.push(b); return 'blob:fw/1' },
      revokeObjectURL: () => {},
    }))
    const { download } = await loadStorage()
    const ok = await download('fieldwatch-log.csv', 'a,b', 'text/csv')
    expect(ok).toBe(true)
    expect(anchors).toHaveLength(1)
    expect(anchors[0]).toMatchObject({ href: 'blob:fw/1', download: 'fieldwatch-log.csv', clicked: 1, removed: true })
    expect(created[0].type).toBe('text/csv;charset=utf-8')
    expect(await created[0].text()).toBe('a,b')
    expect(fs.writeFile).not.toHaveBeenCalled()
    expect(share.share).not.toHaveBeenCalled()
  })
})

describe('Android project configuration', () => {
  it('registers the filesystem and share plugins with Gradle', () => {
    const settings = read('android/capacitor.settings.gradle')
    expect(settings).toContain("include ':capacitor-filesystem'")
    expect(settings).toContain("include ':capacitor-share'")
    const build = read('android/app/capacitor.build.gradle')
    expect(build).toContain("implementation project(':capacitor-filesystem')")
    expect(build).toContain("implementation project(':capacitor-share')")
  })

  it('keeps app data out of device backups and allows cleartext only through the config file', () => {
    const manifest = read('android/app/src/main/AndroidManifest.xml')
    expect(manifest).toContain('android:allowBackup="false"')
    expect(manifest).toContain('android:fullBackupContent="false"')
    expect(manifest).toContain('android:dataExtractionRules="@xml/data_extraction_rules"')
    expect(manifest).toContain('android:networkSecurityConfig="@xml/network_security_config"')
    expect(manifest).not.toContain('usesCleartextTraffic')
    const rules = read('android/app/src/main/res/xml/data_extraction_rules.xml')
    expect(rules.match(/<exclude domain="(root|file|database|sharedpref|external)" path="\." \/>/g)).toHaveLength(10)
    const nsc = read('android/app/src/main/res/xml/network_security_config.xml')
    expect(nsc).toContain('<domain includeSubdomains="false">127.0.0.1</domain>')
    expect(nsc).toContain('<domain includeSubdomains="false">localhost</domain>')
  })

  it('signs a release build with one stable key and publishes that APK', () => {
    const gradle = read('android/app/build.gradle')
    expect(gradle).toMatch(/signingConfig signingConfigs\.release/)
    expect(gradle).toContain("System.getenv('KEYSTORE_FILE')")
    expect(gradle).toContain('new groovy.json.JsonSlurper()')
    expect(gradle).not.toMatch(/versionName\s+"\d/)
    expect(existsSync(new URL('android/app/fieldwatch-sideload.keystore', root))).toBe(true)
    const wf = read('.github/workflows/android.yml')
    expect(wf).toContain('assembleRelease')
    expect(wf).not.toContain('assembleDebug')
    expect(wf).toContain('android/app/build/outputs/apk/release/app-release.apk')
    expect(wf).toMatch(/npm test/)
  })

  it('lets the web view reach a ws:// bridge and keeps WebView debugging tied to debug builds', () => {
    const cap = JSON.parse(read('capacitor.config.json'))
    expect(cap.android.allowMixedContent).toBe(true)
    expect(cap.android.webContentsDebuggingEnabled).toBeUndefined()
    // The page's CSP is what still limits where the app may connect: no plain http:.
    const csp = read('index.html').match(/connect-src([^;"]*)/)
    expect(csp).not.toBeNull()
    expect(csp[1]).not.toMatch(/(^|\s)(http:|\*)(\s|$)/)
  })
})
