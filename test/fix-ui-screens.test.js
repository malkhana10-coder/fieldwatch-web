// Screen-level fixes from the v1.3.1 verification round: i18n parity and hardening,
// plural forms, privacy masking helpers, enum fallbacks, the named-map revision and the
// standalone report document used by the Android "Share report (HTML)" button.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { isValidElement } from 'react'
import { DICT, makeT } from '../src/i18n.js'
import { suggestFleet } from '../src/engine/catalog.js'
import {
  tNode, enumLabel, maskMacsIn, isCoordField, decodedView, namedRev, privateSuggestion,
  isPrivateMacRule, reportDocument, isNativeApp,
} from '../src/screens/format.jsx'

const en = makeT('en')
const ar = makeT('ar')
const screensDir = new URL('../src/screens/', import.meta.url)
const screens = readdirSync(screensDir).filter((f) => f.endsWith('.jsx')).map((f) => [f, readFileSync(new URL(f, screensDir), 'utf8')])
const FULL_MAC = /\b(?:[0-9A-F]{2}:){5}[0-9A-F]{2}\b/i

describe('i18n dictionaries', () => {
  it('have the same keys in English and Arabic', () => {
    const a = Object.keys(DICT.en).sort()
    const b = Object.keys(DICT.ar).sort()
    expect(a.filter((k) => !b.includes(k))).toEqual([])
    expect(b.filter((k) => !a.includes(k))).toEqual([])
  })

  it('define the keys added for this round in both languages', () => {
    const keys = ['viewCrashed', 'resetView', 'idTypeOther', 'sitDropped', 'shareReport', 'sourceBleApp', 'bleAppHint',
      'exportAllPrivacy', 'radiosN', 'pointsN', 'attnN', 'ruleCount_zero', 'ruleCount_one', 'ruleCount_two', 'ruleCount_few']
    for (const k of keys) for (const lang of ['en', 'ar']) expect(typeof DICT[lang][k], `${lang}.${k}`).toBe('string')
    for (const k of ['mapLoadFailed', 'retry', 'mapRetry', 'bridgeInsecure']) for (const lang of ['en', 'ar']) expect(typeof DICT[lang][k], `${lang}.${k}`).toBe('string')
    expect(DICT.en.viewCrashed).toBe('This view stopped because of an error.')
    expect(DICT.en.resetView).toBe('Reset this view')
    expect(DICT.ar.viewCrashed).toBe('توقّف هذا العرض بسبب خطأ.')
    expect(DICT.ar.resetView).toBe('إعادة تشغيل هذا العرض')
  })

  it('has every key the screens use, in both languages', () => {
    const used = new Set()
    // Static keys only: `t('batt_' + x)` style prefixes are dynamic.
    const patterns = [/\bt\(\s*'([A-Za-z0-9_]+)'\s*[,)]/g, /\bt\.plural\(\s*'([A-Za-z0-9_]+)'/g, /\btNode\(\s*t,\s*'([A-Za-z0-9_]+)'/g, /\bt\(\s*isNativeApp\(\)\s*\?\s*'(\w+)'\s*:\s*'(\w+)'/g]
    for (const [, src] of screens) for (const re of patterns) for (const m of src.matchAll(re)) m.slice(1).forEach((k) => used.add(k))
    expect(used.size).toBeGreaterThan(150)
    const missing = [...used].filter((k) => !(k in DICT.en) || !(k in DICT.ar))
    expect(missing).toEqual([])
  })

  it('templates with a distance take the number and unit as one value', () => {
    for (const lang of ['en', 'ar']) {
      expect(DICT[lang].locateEst).toContain('{r}')
      expect(DICT[lang].locateEst).not.toMatch(/±|\{r\} (m|م)/)
      expect(DICT[lang].coTravelHint).not.toMatch(/\{m\} (m|م)/)
    }
  })
})

describe('makeT hardening and plurals', () => {
  it('never returns inherited properties for keys from untrusted data', () => {
    for (const t of [en, ar]) {
      expect(t('__proto__')).toBe('__proto__')
      expect(t('constructor')).toBe('constructor')
      expect(t('hasOwnProperty')).toBe('hasOwnProperty')
      expect(t.cls('__proto__')).toBe(t.cls('OTHER'))
      expect(t.cls('constructor')).toBe(t.cls('OTHER'))
    }
    expect(makeT('__proto__')('start')).toBe('Start')
    expect(makeT('constructor').cls('FINDER')).toBe('Finder tags')
  })

  it('picks Arabic and English plural forms for rule counts', () => {
    expect(en.plural('ruleCount', 1)).toBe('1 rule')
    expect(en.plural('ruleCount', 2)).toBe('2 rules')
    expect(en.plural('ruleCount', 0)).toBe('0 rules')
    expect(ar.plural('ruleCount', 0)).toBe('بلا قواعد')
    expect(ar.plural('ruleCount', 1)).toBe('قاعدة واحدة')
    expect(ar.plural('ruleCount', 2)).toBe('قاعدتان')
    expect(ar.plural('ruleCount', 3)).toBe('3 قواعد')
    expect(ar.plural('ruleCount', 10)).toBe('10 قواعد')
    expect(ar.plural('ruleCount', 11)).toBe('11 قاعدة')
    expect(ar.plural('ruleCount', 146)).toBe('146 قاعدة')
  })
})

describe('Remote ID enum labels', () => {
  it('fall back to "Reserved (n)" instead of a raw i18n key', () => {
    expect(enumLabel(en, 'idType', 2, 4)).toBe('CAA registration')
    expect(enumLabel(en, 'idType', 7, 4)).toBe('Reserved (7)')
    expect(enumLabel(ar, 'idType', 15, 4)).toBe('محجوز (15)')
    expect(enumLabel(en, 'uaType', 15, 15)).toBe('Other')
    expect(enumLabel(en, 'uaType', 16, 15)).toBe('Reserved (16)')
    expect(enumLabel(en, 'uaType', -1, 15)).toBe('Reserved (-1)')
    expect(enumLabel(en, 'droneSt', 9, 4)).toBe('Reserved (9)')
    expect(enumLabel(en, 'droneSt', '__proto__', 4)).toBe('Reserved (__proto__)')
    for (let n = 0; n < 16; n++) expect(enumLabel(en, 'idType', n, 4)).not.toMatch(/^idType/)
  })
})

describe('privacy helpers', () => {
  it('masks full MACs inside free text only when privacy is on', () => {
    const s = 'Created from BLE C4:11:22:33:44:66. Also c4-11-22-33-44-67.'
    expect(maskMacsIn(s, true)).toBe('Created from BLE C4:11:22:**:**:**. Also C4:11:22:**:**:**.')
    expect(maskMacsIn(s, false)).toBe(s)
    expect(maskMacsIn('OUI C4:11:22', true)).toBe('OUI C4:11:22')
    expect(maskMacsIn(undefined, true)).toBe(undefined)
  })

  it('recognises decoded coordinate fields by id or label', () => {
    for (const f of [{ id: 'latitude' }, { id: 'longitude' }, { id: 'op_lat' }, { id: 'op_lon' }, { label: 'Operator lat' }, { label: 'Lon' }]) expect(isCoordField(f), JSON.stringify(f)).toBe(true)
    for (const f of [{ id: 'platform', label: 'Platform' }, { id: 'alt_geo', label: 'Altitude (HAE)' }, { id: 'battery' }, { label: 'Salon' }, {}]) expect(isCoordField(f), JSON.stringify(f)).toBe(false)
  })

  it('masks decoded coordinates and MACs in privacy mode and always returns strings', () => {
    expect(decodedView({ id: 'latitude', label: 'Latitude', value: '24.7 °' }, true)).toEqual({ label: 'Latitude', value: '••' })
    expect(decodedView({ id: 'op_lon', label: 'Operator lon', value: '46.7 °' }, true).value).toBe('••')
    expect(decodedView({ id: 'latitude', label: 'Latitude', value: '24.7 °' }, false).value).toBe('24.7 °')
    expect(decodedView({ id: 'mac', label: 'MAC in payload', value: 'AA:BB:CC:DD:EE:FF' }, true).value).toBe('AA:BB:CC:**:**:**')
    expect(decodedView({ id: 'battery', label: 'Battery', value: '80 %' }, true).value).toBe('80 %')
    const odd = decodedView({ id: 'x', label: { a: 1 }, value: 42 }, false)
    expect(typeof odd.label).toBe('string')
    expect(odd.value).toBe('42')
  })

  it('keeps the full MAC out of a suggested signature in privacy mode, but not its rule', () => {
    const r = { kind: 'BLE', mac: '66:5B:80:E0:CD:A5', name: '', hidden: false, randomized: true, uuids: [], mfg: [] }
    const f = privateSuggestion(suggestFleet(r, { privacy: true }), r.mac, true)
    expect(f.name).not.toMatch(/E0:CD:A5/)
    expect(f.notes).not.toMatch(FULL_MAC)
    expect(f.rules.length).toBeGreaterThan(0)
    // Exact masking on a fixed input (independent of how suggestFleet words its notes).
    const fixed = privateSuggestion({ name: 'BLE E0:CD:A5', notes: 'Created from BLE 66:5B:80:E0:CD:A5.', rules: [{ kind: 'MAC_PREFIX', text: '66:5B:80:E0:CD:A5' }] }, r.mac, true)
    expect(fixed.name).toBe('BLE 66:5B:80:**:**:**')
    expect(fixed.notes).toBe('Created from BLE 66:5B:80:**:**:**.')
    expect(fixed.rules[0].text).toBe('66:5B:80:E0:CD:A5')
    const plain = privateSuggestion(suggestFleet(r), r.mac, false)
    expect(plain.notes).toMatch(/66:5B:80:E0:CD:A5/)
    expect(isPrivateMacRule({ kind: 'MAC_PREFIX', text: '66:5B:80:E0:CD:A5' }, true)).toBe(true)
    expect(isPrivateMacRule({ kind: 'MAC_PREFIX', text: '66:5B:80:E0:CD:A5' }, false)).toBe(false)
    expect(isPrivateMacRule({ kind: 'OUI', text: '66:5B:80' }, true)).toBe(false)
    expect(isPrivateMacRule({ kind: 'NAME_GLOB', text: 'AA:BB:CC:DD:EE:FF' }, true)).toBe(false)
  })
})

describe('named-map revision', () => {
  it('changes when the map is mutated in place (as engine.setNamed does)', () => {
    const named = { 'BLE:AA': { name: 'x', mine: false } }
    const before = namedRev(named)
    named['BLE:AA'].mine = true
    expect(namedRev(named)).not.toBe(before)
    const mid = namedRev(named)
    delete named['BLE:AA']
    expect(namedRev(named)).not.toBe(mid)
  })
})

describe('tNode', () => {
  it('splices React nodes into a translated template', () => {
    const node = { type: 'span', props: {}, key: null, $$typeof: Symbol.for('react.element') }
    const out = tNode(en, 'droneFromYou', { d: node })
    expect(out[0].props.children).toBe(node)
    expect(out.filter((x) => typeof x === 'string').join('')).toBe(' from you')
    const outAr = tNode(ar, 'droneFromYou', { d: 'X' })
    expect(outAr.filter((x) => typeof x === 'string').join('|')).toBe('على بعد | منك')
    expect(isValidElement(outAr[1])).toBe(true)
    expect(tNode(en, 'droneLegend')).toEqual(['Drone'])
  })
})

describe('report document', () => {
  it('is a standalone light page with the body and CSS inlined', () => {
    const html = reportDocument({ title: 'Fieldwatch — Report · <Sit> "1"', lang: 'ar', dir: 'rtl', css: '.a{color:red}</style><script>x()</script>', body: '<div class="stack">ok</div>', fontHref: 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans' })
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('<html lang="ar" dir="rtl" data-theme="light">')
    expect(html).toContain('<title>Fieldwatch — Report · &lt;Sit&gt; &quot;1&quot;</title>')
    // The CSS cannot close its <style> element early (anything else inside it is inert text).
    expect(html).not.toMatch(/<\/style><script>/i)
    expect(html.match(/<\/style>/gi).length).toBe(2)
    expect(html).toContain('<div class="stack">ok</div>')
    expect(html).toContain('.print-only { display: block !important; }')
    expect(html).toContain('href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans"')
    expect(reportDocument({ title: 't', lang: 'en', dir: 'ltr', body: '', fontHref: 'https://evil.example/x.css' })).not.toContain('evil.example')
  })

  it('is offered only inside the Capacitor app', () => {
    expect(isNativeApp()).toBe(false)
    globalThis.window = { Capacitor: { isNativePlatform: () => true } }
    try { expect(isNativeApp()).toBe(true) } finally { delete globalThis.window }
  })
})

describe('screen sources', () => {
  it('do not import src/native.js and render no raw enum keys', () => {
    for (const [f, src] of screens) {
      expect(src, f).not.toMatch(/from '\.\.\/native\.js'/)
      expect(src, f).not.toMatch(/t\('(idType|uaType|droneSt)' \+/)
    }
  })
})
