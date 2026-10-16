// The Fieldwatch web engine: sources → sightings → matcher → live table, sits,
// log, alerts and flood detection. UI subscribes via useEngine().
import { compileCatalog, matchRadio, normMac, isRandomized, oui24, hexOnly, hex4 } from './catalog.js'
import { decodeFields } from './decode.js'
import { loadRadioDb, ouiVendor, companyName } from './lookup.js'
import { Simulator } from './simulator.js'
import { ls, idb } from './storage.js'
import { distM, maskMac } from './geo.js'
import { findPredecessor, linkRadios, trackerState, PlaceMemory, cellOf, memoryKey, addSample, NO_PLACE } from './intel.js'
import { decodeAdvert, mergeDrone } from './odid.js'
import { parseBridgeMessage, validBridgeUrl } from './bridge.js'
import { makeT } from '../i18n.js'

const DEFAULT_FILTERS = { radio: 'BOTH', minRssi: -100, onlyMatched: false, onlyAttention: false, hideMine: false, hideRandom: false, classes: [], maxAge: 60, q: '' }

const TYPES = { string: (v) => typeof v === 'string', boolean: (v) => typeof v === 'boolean', number: (v) => typeof v === 'number' && Number.isFinite(v) }

/**
 * Merge an untrusted settings object onto `base`: unknown keys are dropped and
 * every known key must keep the type of its default, so a hand-edited or
 * malicious file can't leave the app in a state that crashes on every render.
 */
export function sanitizeSettings(input, base) {
  const out = { ...base }
  if (!input || typeof input !== 'object') return out
  const defaults = defaultSettings()
  for (const [k, v] of Object.entries(input)) {
    if (!(k in defaults) || k === 'filters' || k === 'presets' || k === 'watchedNets') continue
    const d = defaults[k]
    if (TYPES[typeof d]?.(v)) out[k] = v
  }
  if (input.filters && typeof input.filters === 'object') {
    const f = { ...DEFAULT_FILTERS, ...base.filters }
    for (const [k, v] of Object.entries(input.filters)) {
      if (!(k in DEFAULT_FILTERS)) continue
      if (k === 'classes') { if (Array.isArray(v)) f.classes = v.filter((x) => typeof x === 'string').slice(0, 64) }
      else if (TYPES[typeof DEFAULT_FILTERS[k]]?.(v)) f[k] = v
    }
    out.filters = f
  }
  if (Array.isArray(input.watchedNets)) out.watchedNets = input.watchedNets.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.slice(0, 64)).slice(0, 50)
  if (Array.isArray(input.presets)) out.presets = input.presets.filter((x) => x && typeof x.name === 'string' && x.filters && typeof x.filters === 'object').slice(0, 30).map((x) => ({ name: x.name.slice(0, 40), filters: sanitizeSettings({ filters: x.filters }, { filters: DEFAULT_FILTERS }).filters }))
  if (out.cooldown < 0) out.cooldown = 60
  return out
}

/** One signature from an untrusted file, normalised to the catalog shape (or null). */
export function sanitizeFleet(f) {
  if (!f || typeof f.id !== 'string' || typeof f.name !== 'string' || !Array.isArray(f.rules)) return null
  return {
    id: f.id.slice(0, 80), name: String(f.name).slice(0, 80), enabled: f.enabled !== false, matchAny: f.matchAny !== false,
    colorIndex: Number(f.colorIndex) || 0, minPeers: 0, peerWindowSec: 60, clusterByOui: false, sequentialMac: false,
    notes: String(f.notes || '').slice(0, 2000), attentionNote: String(f.attentionNote || '').slice(0, 1000), builtIn: !!f.builtIn, kind: String(f.kind || 'OTHER').slice(0, 32),
    rules: f.rules.filter((r) => r && typeof r.kind === 'string').slice(0, 500).map((r) => ({ kind: r.kind, text: String(r.text || '').slice(0, 128), companyId: Number(r.companyId) || 0, dataPrefixHex: String(r.dataPrefixHex || '').slice(0, 128), radio: r.radio === 'WIFI' || r.radio === 'BLE' ? r.radio : null, enabled: r.enabled !== false })),
    ...(f.decode && Array.isArray(f.decode.fields) ? { decode: f.decode } : {}),
  }
}

/** Settings safe to put in a file: drops `accepted` and the device-only Telegram fields. */
function portableSettings(settings) {
  const out = { ...settings }
  delete out.accepted
  for (const k of DEVICE_ONLY_SETTINGS) delete out[k]
  return out
}

function defaultSettings() {
  let lang = 'en'
  try { if ((navigator.language || '').toLowerCase().startsWith('ar')) lang = 'ar' } catch { /* ignore */ }
  return {
    lang, theme: 'system', privacy: false, sound: true, vibrate: true, voice: false, notify: false, cooldown: 60,
    location: false, density: 'BALANCED', floodDetect: true, source: 'demo', view: 'LIST', sort: 'STRENGTH',
    tgEnabled: false, tgToken: '', tgChatId: '', watchedNets: [], sentinel: false, sentinelNewOnly: true,
    trackerAlerts: true, bridgeUrl: '', aiKey: '',
    accepted: false, filters: { ...DEFAULT_FILTERS }, presets: [],
  }
}

// Injected by Vite from package.json (falls back in plain Node, e.g. ad-hoc scripts).
export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'

const LOG_CAP = 6000
// Credentials never leave this device: the Telegram bot, the bridge URL (it
// carries the bridge's access token) and the Anthropic API key are stripped from
// every export and ignored on every import.
const DEVICE_ONLY_SETTINGS = ['tgEnabled', 'tgToken', 'tgChatId', 'bridgeUrl', 'aiKey']
const TG_MIN_GAP_MS = 5000
const TG_QUEUE_CAP = 20
const HISTORY_CAP = 180
const SIT_RADIO_CAP = 4000
const SIT_PATH_CAP = 20000
const PRUNE_MS = 10 * 60 * 1000

class Engine {
  constructor() {
    this.listeners = new Set()
    this.version = 0
    this.settings = sanitizeSettings(ls.get('settings', {}), defaultSettings())
    this.named = ls.get('named', {})
    this.watch = new Set(ls.get('watch', null) || [])
    this.watchInit = ls.get('watch', null) != null
    this.fleets = []
    this.stockFleets = []
    this.catalogVersion = null
    this.compiled = compileCatalog([])
    this.radios = new Map()
    this.log = []
    this.sits = []
    this.activeSitId = null
    this.running = false
    this.pos = null
    this.toasts = []
    this.flood = null
    this.floodHoldUntil = 0
    this.hiddenKeys = new Set()
    this.recentNew = []
    this.huntKey = null
    this.ready = false
    this.error = null
    this.bleState = null
    this.replay = null
    this.stats = { packets: 0, started: 0 }
    this.lastAlert = new Map()
    this.audio = null
    this.tgQueue = []
    this.tgDropped = 0
    this.tgTimer = null
    this.tgNextAt = 0
    this.mem = new PlaceMemory()
    this.trackerAlerted = new Set()
    this.bridge = null
    this.bridgeQueue = []
    this.bridgeState = null
    this.bridgeInfo = null
    this.t = makeT(this.settings.lang)
    if (typeof window !== 'undefined') {
      window.addEventListener('fw-download-unavailable', (ev) => this.toast(this.t('downloadUnavailable', { ext: ev.detail.toUpperCase() }), 'warn'))
    }
  }

  // ---------- subscription ----------
  subscribe = (fn) => { this.listeners.add(fn); return () => this.listeners.delete(fn) }
  getVersion = () => this.version
  emit() { this.version++; this.listeners.forEach((fn) => fn()) }

  // ---------- boot ----------
  async init() {
    await loadRadioDb()
    let stock
    try {
      const res = await fetch(new URL('data/signatures.json', document.baseURI))
      stock = await res.json()
    } catch (e) {
      stock = { fleets: [], catalogVersion: '?' }
      this.error = String(e)
    }
    this.stockFleets = stock.fleets || []
    this.catalogVersion = stock.catalogVersion
    const savedFleets = await idb.get('fleets')
    this.fleets = Array.isArray(savedFleets) && savedFleets.length ? savedFleets : structuredClone(this.stockFleets)
    if (!this.watchInit) {
      // Default watchlist: trackers, drones, pentest gear, smart glasses, and flagged recorders / cameras.
      this.watch = new Set(this.fleets.filter((f) => ['DRONE', 'FINDER', 'HACKING', 'GLASSES'].includes(f.kind) || (f.attentionNote && ['WEARABLE', 'SURVEILLANCE'].includes(f.kind))).map((f) => f.id))
      ls.set('watch', [...this.watch])
    }
    this.compiled = compileCatalog(this.fleets)
    this.log = (await idb.get('log')) || []
    this.sits = (await idb.get('sits')) || []
    this.mem = new PlaceMemory(await idb.get('places'))
    const open = this.sits.find((s) => !s.end)
    if (open) this.activeSitId = open.id
    this.ready = true
    this.emit()
  }

  // ---------- settings ----------
  set(patch) {
    this.settings = { ...this.settings, ...patch }
    if (patch.lang) this.t = makeT(patch.lang)
    if (patch.density && this.sim) this.sim.density = patch.density
    // Typing in search writes on every key: batch the localStorage write.
    clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => ls.set('settings', this.settings), 300)
    if ('location' in patch) this.syncGeo()
    if ('source' in patch) this.pos = null
    this.emit()
  }
  setFilters(patch) { this.set({ filters: { ...this.settings.filters, ...patch } }) }
  resetFilters() { this.set({ filters: { ...DEFAULT_FILTERS } }) }

  // ---------- catalog ----------
  fleetById(id) { return this.compiled.byId.get(id) }
  async saveFleets(next) {
    this.fleets = next
    this.compiled = compileCatalog(next)
    for (const r of this.radios.values()) this.classify(r)
    await idb.set('fleets', next)
    this.emit()
  }
  toggleFleet(id, enabled) { this.saveFleets(this.fleets.map((f) => (f.id === id ? { ...f, enabled } : f))) }
  setAllFleets(enabled, ids) { const s = ids ? new Set(ids) : null; this.saveFleets(this.fleets.map((f) => (!s || s.has(f.id) ? { ...f, enabled } : f))) }
  upsertFleet(f) {
    const i = this.fleets.findIndex((x) => x.id === f.id)
    this.saveFleets(i >= 0 ? this.fleets.map((x) => (x.id === f.id ? f : x)) : [...this.fleets, f])
  }
  deleteFleet(id) { this.saveFleets(this.fleets.filter((f) => f.id !== id)); this.watch.delete(id); ls.set('watch', [...this.watch]) }
  async resetCatalog() { await this.saveFleets(structuredClone(this.stockFleets)) }
  toggleWatch(id) {
    this.watch.has(id) ? this.watch.delete(id) : this.watch.add(id)
    ls.set('watch', [...this.watch])
    this.emit()
  }
  importSignatures(text) {
    const j = JSON.parse(text)
    const list = Array.isArray(j) ? j : j.fleets
    if (!Array.isArray(list)) throw new Error('no "fleets" array')
    const clean = list.map(sanitizeFleet).filter(Boolean)
    const byId = new Map(this.fleets.map((f) => [f.id, f]))
    clean.forEach((f) => byId.set(f.id, f))
    this.saveFleets([...byId.values()])
    return clean.length
  }
  exportSignatures() {
    return JSON.stringify({ format: 'fieldwatch-signatures', formatVersion: 1, exportedAt: new Date().toISOString(), appVersion: 'web-' + APP_VERSION, catalogVersion: this.catalogVersion, fleets: this.fleets }, null, 1)
  }

  // ---------- named radios ----------
  setNamed(key, patch) {
    const cur = this.named[key] || {}
    const next = { ...cur, ...patch }
    if (!next.name && !next.mine && !next.alert && !next.notes) delete this.named[key]
    else this.named[key] = next
    ls.set('named', this.named)
    this.emit()
  }

  // ---------- radios ----------
  classify(r) {
    r.fleetIds = matchRadio(this.compiled, r)
    const fleets = r.fleetIds.map((id) => this.compiled.byId.get(id)).filter(Boolean)
    r.cls = fleets[0]?.kind === 'BODYWORN' ? 'WEARABLE' : fleets[0]?.kind || null
    r.attention = fleets.some((f) => f.attentionNote)
    r.decoded = []
    for (const f of fleets) { if (f.decode) { r.decoded = decodeFields(f, r); if (r.decoded.length) break } }
  }

  ingest(batch, now = Date.now()) {
    const pos = this.pos
    const cell = cellOf(pos)
    const sit = this.activeSit()
    for (const s of batch) {
      const mac = normMac(s.mac)
      const key = s.kind + ':' + mac
      let r = this.radios.get(key)
      const isNew = !r
      if (!r) {
        r = { key, kind: s.kind, mac, firstSeen: now, history: [], count: 0, positions: [], name: '' }
        r.vendor = ouiVendor(mac)
        // BLE random addresses (resolvable private, static random…) don't reliably set the
        // "locally administered" bit Wi-Fi uses. Trust the address type when the source
        // reports it; otherwise treat a BLE address with no registered vendor as random.
        r.randomized = s.kind === 'BLE'
          ? (s.addrType === 'random' ? true : s.addrType === 'public' ? false : isRandomized(mac) || !r.vendor)
          : isRandomized(mac)
        this.radios.set(key, r)
      }
      const nameChanged = (s.name || '') !== r.name
      Object.assign(r, {
        name: s.name || r.name || '', hidden: !!s.hidden, rssi: s.rssi, lastSeen: now,
        channel: s.channel ?? r.channel, freq: s.freq ?? r.freq, security: s.security ?? r.security,
        mfg: s.mfg?.length ? s.mfg : r.mfg || [], uuids: s.uuids?.length ? s.uuids : r.uuids || [],
        svcData: s.svcData?.length ? s.svcData : r.svcData || [], vendorIe: s.vendorIe?.length ? s.vendorIe : r.vendorIe || [],
      })
      r.company = r.mfg[0] ? companyName(r.mfg[0].companyId) : null
      if (r.kind === 'BLE' && s.svcData?.length) {
        const msgs = s.svcData.filter((x) => isOdidUuid(x.uuid)).flatMap((x) => decodeAdvert(x.dataHex))
        if (msgs.length) r.drone = mergeDrone(r.drone, msgs, now)
      }
      r.count++
      r.history.push([now, s.rssi])
      if (r.history.length > HISTORY_CAP) r.history.shift()
      if (isNew || nameChanged || s.svcData?.length) this.classify(r)
      if (pos) {
        const last = r.positions[r.positions.length - 1]
        if (!last || distM(last, pos) > 15) { r.positions.push({ lat: pos.lat, lon: pos.lon, t: now }); if (r.positions.length > 40) r.positions.shift() }
        addSample(r, pos, now)
      }
      this.placeMem().observe(r, cell, now)
      this.stats.packets++
      this.logRow(r, now)
      if (sit) this.sitRecord(sit, r, now)
      if (isNew && r.kind === 'BLE') this.trackFlood(r, now)
      this.maybeAlert(r, now, isNew)
      if (isNew && this.settings.sentinel) this.sentinelAlert(r)
    }
  }

  prune(now = Date.now()) {
    for (const [k, r] of this.radios) if (now - r.lastSeen > PRUNE_MS) this.radios.delete(k)
  }

  isMine(r) { return !!this.named[r.key]?.mine }
  displayName(r) { return this.named[r.key]?.name || r.name }
  /** First watched network whose SSID matches (case-insensitive). */
  watchedNetFor(r) {
    const list = this.settings.watchedNets || []
    const name = (r.name || '').toLowerCase().trim()
    if (!name) return null
    return list.find((w) => w && name === String(w).toLowerCase().trim()) || null
  }

  /** Live list after filters. */
  visibleRadios(now = Date.now()) {
    const f = this.settings.filters
    const q = f.q.trim().toLowerCase()
    const cls = new Set(f.classes)
    const out = []
    for (const r of this.radios.values()) {
      if (now - r.lastSeen > f.maxAge * 1000) continue
      if (this.hiddenKeys.has(r.key)) continue
      if (f.radio !== 'BOTH' && r.kind !== f.radio) continue
      if (r.rssi < f.minRssi) continue
      if (f.onlyMatched && !r.fleetIds.length) continue
      if (f.onlyAttention && !r.attention) continue
      if (f.hideMine && this.isMine(r)) continue
      if (f.hideRandom && r.kind === 'BLE' && r.randomized && !r.fleetIds.length) continue
      if (cls.size && !cls.has(r.cls || 'OTHER')) continue
      if (q) {
        const hay = [this.displayName(r), r.mac, r.vendor, r.company, ...r.fleetIds.map((id) => this.fleetById(id)?.name)].join(' ').toLowerCase()
        if (!hay.includes(q)) continue
      }
      out.push(r)
    }
    const sort = this.settings.sort
    const by = {
      STRENGTH: (a, b) => b.rssi - a.rssi,
      NEWEST: (a, b) => b.lastSeen - a.lastSeen,
      FIRST_SEEN: (a, b) => b.firstSeen - a.firstSeen,
      NAME: (a, b) => (this.displayName(a) || '￿').localeCompare(this.displayName(b) || '￿'),
      SIGNATURES: (a, b) => (b.attention - a.attention) || (b.fleetIds.length - a.fleetIds.length) || b.rssi - a.rssi,
    }[sort] || ((a, b) => b.rssi - a.rssi)
    return out.sort(by)
  }

  avgRssi(r, windowMs = 15000) {
    const cut = (r.lastSeen || 0) - windowMs
    const h = r.history.filter(([t]) => t >= cut)
    return h.length ? h.reduce((a, [, v]) => a + v, 0) / h.length : r.rssi
  }
  trend(r) {
    const h = r.history
    if (h.length < 6) return 0
    const a = h.slice(-3).reduce((s, [, v]) => s + v, 0) / 3
    const b = h.slice(-8, -3).reduce((s, [, v]) => s + v, 0) / Math.max(1, h.slice(-8, -3).length)
    return a - b
  }
  coTravel(r, minM = 200, minMs = 3 * 60 * 1000) {
    if (r.positions.length < 3) return false
    const first = r.positions[0]
    return r.positions.some((p) => distM(first, p) > minM) && r.lastSeen - (r.identityFirstSeen || r.firstSeen) > minMs
  }

  /** Sentinel mode: announce any brand-new device. */
  sentinelAlert(r) {
    if (this.isMine(r) || this.hiddenKeys.has(r.key)) return
    // "New here only": skip devices this place already knows, and random phone
    // addresses that can never be recognised again (they would alert constantly).
    if (this.settings.sentinelNewOnly && (!memoryKey(r) || this.placeMem().familiar(r, cellOf(this.pos)))) return
    const nm = this.displayName(r) || maskMac(r.mac, this.settings.privacy)
    this.toast(`${this.t('newDevice')}: ${nm}`, 'info', r.key)
    this.notifyTelegram(`${this.t('newDevice')}: ${this.tgName(r)} (${r.kind}) @ ${r.rssi} dBm`)
  }

  /**
   * Heuristic: how likely the user is being followed. Returns { level, reasons:[{r,why}] }.
   * Trackers and Extra-attention devices are strong evidence after the normal co-travel
   * test. Anything else (a companion's phone, the car's own radios) must travel with
   * you much longer and further, and only several of them together raise the level.
   */
  trackingAssessment(now = Date.now()) {
    const reasons = []
    let strong = 0
    for (const r of this.radios.values()) {
      if (now - r.lastSeen > 10 * 60 * 1000) continue
      if (this.isMine(r)) continue
      const isStrong = r.cls === 'FINDER' || r.attention || !!trackerState(r, now)?.separated
      if (!(isStrong ? this.coTravel(r) : this.coTravel(r, 1000, 10 * 60 * 1000))) continue
      let why
      if (trackerState(r, now)?.separated) why = 'whySeparated'
      else if (r.cls === 'FINDER') why = 'whyFinder'
      else if (r.attention) why = 'whyAttn'
      else if (r.kind === 'BLE' && r.randomized) why = 'whyBle'
      else why = 'whyCotravel'
      if (isStrong) strong++
      reasons.push({ r, why })
    }
    reasons.sort((a, b) => b.r.rssi - a.r.rssi)
    const weak = reasons.length - strong
    const level = strong >= 2 || (strong >= 1 && weak >= 2) ? 'HIGH'
      : strong >= 1 || weak >= 3 ? 'MEDIUM' : 'LOW'
    return { level, reasons }
  }

  /** Devices that look like they are trying to stay hidden. */
  hiddenDevices(now = Date.now()) {
    const out = []
    for (const r of this.radios.values()) {
      if (now - r.lastSeen > 10 * 60 * 1000) continue
      if (this.isMine(r)) continue
      if (r.hidden) { out.push({ r, why: 'hiddenSsid' }); continue }
      const noName = !r.name
      const noFleet = !r.fleetIds.length
      if (noName && r.randomized && !r.vendor) out.push({ r, why: 'hiddenRand' })
      else if (noName && !r.vendor && noFleet && r.kind === 'BLE') out.push({ r, why: 'hiddenAnon' })
    }
    out.sort((a, b) => b.r.rssi - a.r.rssi)
    return out
  }

  // ---------- rotation linking, trackers, places, drones ----------
  /** Link freshly settled random BLE addresses to the address they replaced. */
  linkRotations(now) {
    const all = [...this.radios.values()]
    for (const r of all) {
      if (r.linkChecked || r.kind !== 'BLE' || !r.randomized || now - r.firstSeen < 3000) continue
      r.linkChecked = true
      const prev = findPredecessor(all, r, now)
      if (!prev) continue
      linkRadios(prev, r)
      // A device marked Mine or named stays so after it changes address. Move the
      // entry rather than copy it, so rotations don't pile up in storage.
      if (this.named[prev.key] && !this.named[r.key]) {
        this.named[r.key] = this.named[prev.key]
        delete this.named[prev.key]
        ls.set('named', this.named)
      }
    }
  }

  /** Alert once per device when a tracker that is away from its owner moves with you. */
  checkTrackers(now) {
    if (!this.settings.trackerAlerts) return
    for (const r of this.radios.values()) {
      if (now - r.lastSeen > 60000 || this.isMine(r)) continue
      const id = r.identity || r.key
      if (this.trackerAlerted.has(id)) continue
      if (!trackerState(r, now)?.separated || !this.coTravel(r)) continue
      this.trackerAlerted.add(id)
      const name = this.displayName(r) || r.fleetIds.map((x) => this.fleetById(x)?.name).filter(Boolean)[0] || maskMac(r.mac, this.settings.privacy)
      const body = this.t('trackerAlert', { name: '\u2068' + name + '\u2069' })
      this.toast(body, 'alert', r.key)
      if (this.settings.sound) this.beep(660, 0.18, 3)
      if (this.settings.vibrate) try { navigator.vibrate?.([300, 100, 300, 100, 300]) } catch { /* ignore */ }
      if (this.settings.voice) this.speak(this.t('trackerAlertSpeak'))
      if (this.settings.notify && typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
        try { new Notification(this.t('alertTitle'), { body, tag: 'tracker-' + id, icon: 'icon.svg' }) } catch { /* ignore */ }
      }
      this.notifyTelegram(`${this.t('trackerAlertSpeak')}: ${this.tgName(r)} @ ${r.rssi} dBm`)
    }
  }

  currentCell() { return cellOf(this.pos) }
  /** The simulator gets its own throwaway memory so demo devices never mix with real places. */
  placeMem() {
    if (this.settings.source !== 'demo') return this.mem
    return this.demoMem || (this.demoMem = new PlaceMemory())
  }
  /** Teach the current place: every device heard in the last minute becomes familiar here. */
  learnPlace(now = Date.now()) {
    const recent = [...this.radios.values()].filter((r) => now - r.lastSeen < 60000)
    // Never learn trackers or anything already travelling with you as "familiar".
    const safe = recent.filter((r) => !trackerState(r, now) && !this.coTravel(r))
    const mem = this.placeMem()
    const n = mem.learn(safe, this.currentCell(), now)
    if (mem === this.mem) idb.set('places', this.mem.toJSON())
    this.emit()
    return n
  }
  /** Familiar vs new devices around you right now. */
  placeSummary(now = Date.now()) {
    const cell = this.currentCell()
    const familiar = []
    const fresh = []
    for (const r of this.radios.values()) {
      if (now - r.lastSeen > 60000 || this.isMine(r) || !memoryKey(r)) continue
      ;(this.placeMem().familiar(r, cell) ? familiar : fresh).push(r)
    }
    fresh.sort((a, b) => b.rssi - a.rssi)
    return { cell, located: cell !== NO_PLACE, familiar, fresh }
  }
  /** Devices remembered in places at least 1 km apart, excluding Mine. */
  multiPlace() {
    return this.placeMem().multiPlace({ exclude: (key) => !!this.named[key]?.mine })
  }
  forgetPlaces() {
    this.demoMem = null
    this.mem = new PlaceMemory()
    idb.set('places', this.mem.toJSON())
    this.emit()
  }
  /** Remote ID drones heard in the last two minutes. */
  drones(now = Date.now()) {
    return [...this.radios.values()].filter((r) => r.drone && now - r.lastSeen < 120000).sort((a, b) => b.lastSeen - a.lastSeen)
  }

  // ---------- flood ----------
  trackFlood(r, now) {
    if (!this.settings.floodDetect) return
    this.recentNew.push({ t: now, key: r.key, rssi: r.rssi })
    this.recentNew = this.recentNew.filter((x) => now - x.t < 5000)
    if (this.recentNew.length < 12) return
    const vals = this.recentNew.map((x) => x.rssi)
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length)
    if (sd > 7) return
    const keys = this.recentNew.map((x) => x.key)
    this.recentNew = []
    const sit = this.activeSit()
    if (sit) sit.floods.push({ t: now, n: keys.length, kind: 'pairing' })
    if (this.flood?.hide && now < this.floodHoldUntil) { keys.forEach((k) => this.hiddenKeys.add(k)); return }
    if (now < this.floodHoldUntil) { this.toast(this.t('floodTitle') + ' · ' + keys.length, 'warn'); return }
    this.flood = { open: true, n: keys.length, keys, t: now }
    this.floodHoldUntil = now + 15 * 60 * 1000
    this.notifyTelegram(`${this.t('floodTitle')}: ${keys.length}`)
    this.beep(520, 0.25)
  }
  resolveFlood(hide) {
    if (!this.flood) return
    if (hide) this.flood.keys.forEach((k) => this.hiddenKeys.add(k))
    this.flood = { ...this.flood, open: false, hide }
    this.emit()
  }

  // ---------- alerts ----------
  maybeAlert(r, now, isNew) {
    const named = this.named[r.key]
    if (named?.mine) return
    const watchHit = r.fleetIds.find((id) => this.watch.has(id))
    const watchedNet = this.watchedNetFor(r)
    if (watchedNet && !isNew) return
    if (!watchHit && !named?.alert && !watchedNet) return
    const last = this.lastAlert.get(r.key) || 0
    if (now - last < this.settings.cooldown * 1000) return
    this.lastAlert.set(r.key, now)
    const t = this.t
    const sig = watchedNet ? `${t('alertWatched')}: ${watchedNet}` : watchHit ? this.fleetById(watchHit)?.name : named?.name || t('alertOn')
    // Unicode isolates keep Latin names and negative numbers in order inside Arabic sentences.
    const iso = (v) => '\u2068' + v + '\u2069'
    const body = t('alertBody', { sig: iso(sig), name: iso(this.displayName(r) || maskMac(r.mac, this.settings.privacy)), rssi: '\u2066' + r.rssi + '\u2069' })
    this.toast(body, 'alert', r.key)
    if (this.settings.sound) this.beep(880, 0.12, 2)
    if (this.settings.vibrate) try { navigator.vibrate?.([120, 60, 120]) } catch { /* ignore */ }
    if (this.settings.voice) this.speak(t('speakHit', { sig }))
    if (this.settings.notify && typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
      try { new Notification(t('alertTitle'), { body, tag: r.key, icon: 'icon.svg' }) } catch { /* ignore */ }
    }
    this.notifyTelegram(`${t('alertTitle')}: ${sig} — ${this.tgName(r)} @ ${r.rssi} dBm`)
  }

  toast(text, kind = 'info', key) {
    const id = Math.random().toString(36).slice(2)
    let extra = 0
    if (kind === 'alert') {
      // Coalesce: one alert toast on screen, with a count of the others it replaced.
      const prev = this.toasts.find((x) => x.kind === 'alert')
      if (prev) extra = (prev.extra || 0) + 1
      this.toasts = this.toasts.filter((x) => x.kind !== 'alert')
    }
    this.toasts = [...this.toasts.slice(-2), { id, text, kind, key, extra }]
    setTimeout(() => { this.toasts = this.toasts.filter((x) => x.id !== id); this.emit() }, 5000)
    this.emit()
  }

  ac() {
    if (!this.audio) { try { this.audio = new (window.AudioContext || window.webkitAudioContext)() } catch { return null } }
    if (this.audio.state === 'suspended') this.audio.resume()
    return this.audio
  }
  beep(freq = 880, dur = 0.1, times = 1, vol = 0.08) {
    const ac = this.ac()
    if (!ac) return
    for (let i = 0; i < times; i++) {
      const o = ac.createOscillator()
      const g = ac.createGain()
      const t0 = ac.currentTime + i * (dur + 0.06)
      o.frequency.value = freq
      o.type = 'sine'
      g.gain.setValueAtTime(vol, t0)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
      o.connect(g).connect(ac.destination)
      o.start(t0)
      o.stop(t0 + dur + 0.02)
    }
  }
  speak(text) {
    try {
      const u = new SpeechSynthesisUtterance(text)
      u.lang = this.settings.lang === 'ar' ? 'ar-SA' : 'en-US'
      speechSynthesis.cancel()
      speechSynthesis.speak(u)
    } catch { /* ignore */ }
  }

  /** Name for an outgoing Telegram line; honours privacy mode like the screen does. */
  tgName(r) { return this.displayName(r) || maskMac(r.mac, this.settings.privacy) }

  /**
   * Queue an alert line for Telegram. Lines are batched into one message at most
   * every TG_MIN_GAP_MS so a busy place (or sentinel mode) can't flood the bot or
   * hit Telegram's rate limit; overflow is summarised as "+N more".
   */
  notifyTelegram(text) {
    if (!this.settings.tgEnabled) return
    this.tgQueue.push(text)
    if (this.tgQueue.length > TG_QUEUE_CAP) this.tgDropped += this.tgQueue.splice(0, this.tgQueue.length - TG_QUEUE_CAP).length
    if (!this.tgTimer) this.tgTimer = setTimeout(() => this.flushTelegram(), Math.max(0, this.tgNextAt - Date.now()))
  }
  async flushTelegram() {
    this.tgTimer = null
    if (!this.tgQueue.length) return
    const lines = this.tgQueue.splice(0)
    if (this.tgDropped) { lines.unshift(this.t('tgMore', { n: this.tgDropped })); this.tgDropped = 0 }
    this.tgNextAt = Date.now() + TG_MIN_GAP_MS
    await this.sendTelegram(lines.join('\n').slice(0, 4000))
  }

  /** Fire-and-forget push to the user's own Telegram bot (Bot API). Token is the user's, entered at runtime. */
  async sendTelegram(text) {
    const { tgToken, tgChatId } = this.settings
    if (!tgToken || !tgChatId) return 'missing credentials'
    try {
      const res = await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: tgChatId, text, disable_web_page_preview: true }),
      })
      const j = await res.json()
      if (!j.ok) throw new Error(j.description || ('HTTP ' + res.status))
      return null
    } catch (e) {
      console.warn('telegram send failed', e)
      return e && e.message ? e.message : String(e)
    }
  }

  // ---------- log ----------
  logRow(r, now) {
    this.log.push({
      ts: now, kind: r.kind, mac: r.mac, name: r.name, rssi: r.rssi, channel: r.channel || 0, freq: r.freq || 0,
      oui: oui24(r.mac), vendor: r.vendor || '', fleets: r.fleetIds.map((id) => this.fleetById(id)?.name).join('+'),
      mfg: r.mfg[0] ? hex4(r.mfg[0].companyId) : '', uuids: r.uuids.join('|'), rand: r.randomized, hidden: r.hidden,
      raw: (r.mfg[0]?.dataHex || r.svcData[0]?.dataHex || '').slice(0, 80), lat: this.pos?.lat ?? null, lon: this.pos?.lon ?? null,
      vendor_ie: (r.vendorIe || []).join('|'),
    })
    if (this.log.length > LOG_CAP) this.log.splice(0, this.log.length - LOG_CAP)
  }
  clearLog() { this.log = []; idb.set('log', []); this.emit() }

  // ---------- sits ----------
  activeSit() { return this.activeSitId ? this.sits.find((s) => s.id === this.activeSitId) : null }
  startSit(name) {
    const now = Date.now()
    const s = { id: 'sit-' + now.toString(36), name: name || this.t('sit') + ' ' + this.t.date(now), start: now, end: null, path: [], radios: {}, floods: [], source: this.settings.source }
    this.sits = [s, ...this.sits]
    this.activeSitId = s.id
    this.persistSits()
    this.emit()
    return s
  }
  endSit() {
    const s = this.activeSit()
    if (s) s.end = Date.now()
    this.activeSitId = null
    this.persistSits()
    this.emit()
  }
  deleteSit(id) {
    this.sits = this.sits.filter((s) => s.id !== id)
    if (this.activeSitId === id) this.activeSitId = null
    this.persistSits()
    this.emit()
  }
  renameSit(id, name) { const s = this.sits.find((x) => x.id === id); if (s) { s.name = name; this.persistSits(); this.emit() } }
  sitRecord(s, r, now) {
    let e = s.radios[r.key]
    if (!e && Object.keys(s.radios).length >= SIT_RADIO_CAP) return
    this.sitsDirty = true
    if (!e) e = s.radios[r.key] = { key: r.key, kind: r.kind, mac: r.mac, name: r.name, vendor: r.vendor, first: now, last: now, maxRssi: r.rssi, minRssi: r.rssi, sum: 0, count: 0, channel: r.channel || 0, fleetIds: [], pts: [], security: r.security || '' }
    e.last = now
    e.name = r.name || e.name
    e.maxRssi = Math.max(e.maxRssi, r.rssi)
    e.minRssi = Math.min(e.minRssi, r.rssi)
    e.sum += r.rssi
    e.count++
    e.fleetIds = r.fleetIds
    e.mine = this.isMine(r)
    e.flood = this.hiddenKeys.has(r.key)
    if (this.pos) {
      const last = e.pts[e.pts.length - 1]
      if (!last || distM(last, this.pos) > 20) { e.pts.push({ lat: this.pos.lat, lon: this.pos.lon, t: now, rssi: r.rssi }); if (e.pts.length > 40) e.pts.shift() }
    }
  }
  sitPath(now) {
    const s = this.activeSit()
    if (!s || !this.pos) return
    const last = s.path[s.path.length - 1]
    if ((!last || distM(last, this.pos) > 8) && s.path.length < SIT_PATH_CAP) { s.path.push({ lat: this.pos.lat, lon: this.pos.lon, t: now }); this.sitsDirty = true }
  }
  persistSits() { this.sitsDirty = false; idb.set('sits', this.sits) }

  // ---------- geolocation ----------
  syncGeo() {
    const want = this.settings.location && this.running && this.settings.source !== 'demo'
    if (want && this.geoWatch == null && navigator.geolocation) {
      this.geoWatch = navigator.geolocation.watchPosition(
        (p) => { this.pos = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }; },
        () => { this.pos = null },
        { enableHighAccuracy: true, maximumAge: 5000 },
      )
    } else if (!want && this.geoWatch != null) {
      navigator.geolocation.clearWatch(this.geoWatch)
      this.geoWatch = null
      if (this.settings.source !== 'demo') this.pos = null
    }
  }

  // ---------- scanning ----------
  async start() {
    if (this.running || this.starting) return
    this.starting = true
    try { await this.startSource() } finally { this.starting = false }
  }
  async startSource() {
    this.ac()
    const src = this.settings.source
    this.stats.started = Date.now()
    if (src === 'ble') {
      const ok = await this.startBle()
      if (!ok) return
    }
    if (src === 'bridge' && !this.startBridge()) return
    if (src === 'demo') this.sim = new Simulator(() => this.fleets, this.settings.density)
    if (src === 'replay' && !this.replay) { this.toast(this.t('sourceReplayHint')); return }
    this.running = true
    this.syncGeo()
    clearInterval(this.timer)
    this.timer = setInterval(() => this.tick(), 1000)
    this.tick()
    this.emit()
  }
  stop() {
    this.running = false
    clearInterval(this.timer)
    this.timer = null
    this.pos = null
    try { this.bleScan?.stop() } catch { /* ignore */ }
    this.bleScan = null
    this.stopBridge()
    this.syncGeo()
    idb.set('log', this.log)
    this.persistSits()
    this.savePlaces()
    this.emit()
  }
  savePlaces() {
    if (!this.mem.dirty) return
    this.mem.dirty = false
    this.mem.prune()
    idb.set('places', this.mem.toJSON())
  }
  tick() {
    const now = Date.now()
    if (this.settings.source === 'demo' && this.sim) {
      if (this.settings.location || this.activeSit()) this.pos = this.sim.step(1)
      else this.pos = null
      this.ingest(this.sim.tick(1), now)
    } else if (this.settings.source === 'replay' && this.replay) {
      this.replayStep(now)
    } else if (this.settings.source === 'ble' && this.bleQueue?.length) {
      const q = this.bleQueue
      this.bleQueue = []
      this.ingest(q, now)
    } else if (this.settings.source === 'bridge' && this.bridgeQueue.length) {
      const q = this.bridgeQueue
      this.bridgeQueue = []
      this.ingest(q, now)
    }
    this.sitPath(now)
    this.linkRotations(now)
    // Elapsed-time gates rather than `now % N`: background tabs only wake every
    // minute or so, and a modulo test would then almost never fire.
    if (now - (this.lastTrackerCheck || 0) >= 5000) { this.lastTrackerCheck = now; this.checkTrackers(now) }
    this.prune(now)
    if (now - (this.lastSave || 0) >= 15000) {
      this.lastSave = now
      if (this.sitsDirty) this.persistSits()
      this.savePlaces()
    }
    if (now - (this.lastLogSave || 0) >= 60000) { this.lastLogSave = now; idb.set('log', this.log) }
    this.emit()
  }

  async startBle() {
    const t = this.t
    if (!navigator.bluetooth?.requestLEScan) { this.bleState = 'unsupported'; this.toast(t('bleUnsupported'), 'warn'); this.emit(); return false }
    try {
      this.bleQueue = []
      this.bleScan = await navigator.bluetooth.requestLEScan({ acceptAllAdvertisements: true, keepRepeatedDevices: true })
      if (!this.bleListener) {
        this.bleListener = (ev) => {
          const mfg = []
          ev.manufacturerData?.forEach((dv, id) => mfg.push({ companyId: id, dataHex: dvHex(dv) }))
          const svcData = []
          ev.serviceData?.forEach((dv, uuid) => svcData.push({ uuid, dataHex: dvHex(dv) }))
          this.bleQueue.push({
            kind: 'BLE', mac: ev.device?.id ? pseudoMac(ev.device.id) : '00:00:00:00:00:00', name: ev.name || ev.device?.name || '',
            rssi: ev.rssi ?? -100, mfg, svcData, uuids: ev.uuids || [], vendorIe: [], channel: 0, freq: 2402,
          })
        }
        navigator.bluetooth.addEventListener('advertisementreceived', this.bleListener)
      }
      this.bleState = 'scanning'
      return true
    } catch {
      this.bleState = 'denied'
      this.toast(t('bleDenied'), 'warn')
      this.emit()
      return false
    }
  }

  // ---------- bridge (real Wi-Fi + BLE from bridge/fieldwatch_bridge.py) ----------
  startBridge() {
    const url = (this.settings.bridgeUrl || '').trim()
    if (!validBridgeUrl(url)) { this.toast(this.t('bridgeNeedUrl'), 'warn'); return false }
    this.bridgeQueue = []
    this.bridgeWanted = true
    this.connectBridge(url)
    return true
  }
  connectBridge(url) {
    let ws
    try { ws = new WebSocket(url) } catch { this.bridgeState = 'error'; this.toast(this.t('bridgeFailed'), 'warn'); this.emit(); return }
    this.bridge = ws
    this.bridgeState = 'connecting'
    ws.onopen = () => { if (this.bridge === ws) { this.bridgeState = 'open'; this.emit() } }
    ws.onmessage = (ev) => {
      if (this.bridge !== ws) return
      const msg = parseBridgeMessage(ev.data)
      if (msg?.type === 'hello') { this.bridgeInfo = msg; this.emit() }
      else if (msg?.type === 'sightings') {
        this.bridgeQueue.push(...msg.items)
        if (this.bridgeQueue.length > 5000) this.bridgeQueue.splice(0, this.bridgeQueue.length - 5000)
      }
    }
    ws.onclose = (ev) => {
      // A socket closed by an earlier stop() can report after a new start(); ignore it.
      if (this.bridge !== ws) return
      this.bridge = null
      if (ev.code === 1008) { this.bridgeState = 'denied'; this.bridgeWanted = false; this.toast(this.t('bridgeDenied'), 'warn') }
      else if (this.bridgeWanted && this.running) {
        this.bridgeState = 'retrying'
        this.bridgeRetry = setTimeout(() => { if (this.bridgeWanted && this.running) this.connectBridge(url) }, 3000)
      } else this.bridgeState = 'closed'
      this.emit()
    }
    this.emit()
  }
  stopBridge() {
    this.bridgeWanted = false
    clearTimeout(this.bridgeRetry)
    const ws = this.bridge
    if (ws) { ws.onopen = ws.onmessage = ws.onclose = null }
    try { ws?.close() } catch { /* ignore */ }
    this.bridge = null
    if (this.bridgeState) this.bridgeState = 'closed'
  }

  // ---------- replay ----------
  loadReplay(text) {
    if (this.running) this.stop()
    const rows = parseLog(text)
    if (!rows.length) throw new Error('no rows')
    rows.sort((a, b) => a.ts - b.ts)
    this.replay = { rows, i: 0, t0: rows[0].ts, wall0: null, speed: 5 }
    this.radios.clear()
    this.toast(this.t('replayLoaded', { n: rows.length }))
    this.emit()
    return rows.length
  }
  replayStep(now) {
    const rp = this.replay
    if (rp.wall0 == null) rp.wall0 = now
    const until = rp.t0 + (now - rp.wall0) * rp.speed
    const batch = []
    while (rp.i < rp.rows.length && rp.rows[rp.i].ts <= until) {
      const row = rp.rows[rp.i++]
      if (row.lat != null && row.lon != null) this.pos = { lat: row.lat, lon: row.lon }
      batch.push(row)
    }
    if (batch.length) this.ingest(batch, now)
    if (rp.i >= rp.rows.length) { rp.i = 0; rp.wall0 = null; this.stop() }
  }

  // ---------- settings exchange ----------
  exportSettings() {
    return JSON.stringify({ format: 'fieldwatch-web-settings', version: 1, settings: portableSettings(this.settings), named: this.named, watch: [...this.watch] }, null, 1)
  }
  importSettings(text) {
    const j = JSON.parse(text)
    if (j.format !== 'fieldwatch-web-settings') throw new Error('not a Fieldwatch web settings file')
    if (j.settings && typeof j.settings === 'object') this.set({ ...sanitizeSettings(portableSettings(j.settings), portableSettings(this.settings)), accepted: true })
    if (j.named && typeof j.named === 'object') { this.named = sanitizeNamed(j.named); ls.set('named', this.named) }
    if (Array.isArray(j.watch)) { this.watch = new Set(j.watch.filter((x) => typeof x === 'string')); ls.set('watch', [...this.watch]) }
    this.emit()
  }
  exportAll() {
    return JSON.stringify({
      format: 'fieldwatch-web-backup', version: 1, exportedAt: new Date().toISOString(),
      settings: portableSettings(this.settings), named: this.named, watch: [...this.watch],
      fleets: this.fleets, sits: this.sits, log: this.log, places: this.mem.toJSON(),
    }, null, 1)
  }
  async importAll(text) {
    const j = JSON.parse(text)
    if (j.format !== 'fieldwatch-web-backup') throw new Error('not a Fieldwatch backup file')
    if (j.settings && typeof j.settings === 'object') this.set({ ...sanitizeSettings(portableSettings(j.settings), portableSettings(this.settings)), accepted: true })
    if (j.named && typeof j.named === 'object') { this.named = sanitizeNamed(j.named); ls.set('named', this.named) }
    if (Array.isArray(j.watch)) { this.watch = new Set(j.watch.filter((x) => typeof x === 'string')); ls.set('watch', [...this.watch]) }
    const fleets = Array.isArray(j.fleets) ? j.fleets.map(sanitizeFleet).filter(Boolean) : []
    if (fleets.length) await this.saveFleets(fleets)
    if (Array.isArray(j.sits)) { this.sits = j.sits.filter(validSit); await idb.set('sits', this.sits) }
    if (Array.isArray(j.log)) { this.log = j.log.filter((x) => x && typeof x === 'object').slice(-LOG_CAP); await idb.set('log', this.log) }
    if (j.places && typeof j.places === 'object') { this.mem = new PlaceMemory(sanitizePlaces(j.places)); await idb.set('places', this.mem.toJSON()) }
    const open = this.sits.find((s) => !s.end)
    this.activeSitId = open ? open.id : null
    this.emit()
    return { sits: this.sits.length, log: this.log.length }
  }
  async resetAll() {
    this.stop()
    ls.clear()
    await idb.clear()
    location.reload()
  }
}

function sanitizeNamed(named) {
  const out = {}
  for (const [k, v] of Object.entries(named)) {
    if (!v || typeof v !== 'object' || !/^(WIFI|BLE):/.test(k)) continue
    out[k] = { name: typeof v.name === 'string' ? v.name.slice(0, 80) : '', mine: !!v.mine, alert: !!v.alert, notes: typeof v.notes === 'string' ? v.notes.slice(0, 2000) : '' }
  }
  return out
}
const finite = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon)
function validSit(s) {
  if (!s || typeof s.id !== 'string' || !Number.isFinite(s.start) || !s.radios || typeof s.radios !== 'object') return false
  s.name = String(s.name || s.id).slice(0, 80)
  s.path = Array.isArray(s.path) ? s.path.filter(finite) : []
  s.floods = Array.isArray(s.floods) ? s.floods : []
  for (const r of Object.values(s.radios)) r.pts = Array.isArray(r?.pts) ? r.pts.filter(finite) : []
  return true
}
function sanitizePlaces(p) {
  const devices = {}
  for (const [k, d] of Object.entries(p.devices || {})) {
    if (!d || typeof d !== 'object' || !d.cells || typeof d.cells !== 'object') continue
    const cells = {}
    for (const [c, v] of Object.entries(d.cells)) if (v && Array.isArray(v.days)) cells[c] = { first: Number(v.first) || 0, last: Number(v.last) || 0, days: v.days.filter((x) => typeof x === 'string').slice(-7), ...(v.learned ? { learned: true } : {}) }
    devices[k] = { kind: d.kind === 'WIFI' ? 'WIFI' : 'BLE', name: typeof d.name === 'string' ? d.name.slice(0, 64) : '', mac: typeof d.mac === 'string' ? d.mac.slice(0, 17) : '', cls: typeof d.cls === 'string' ? d.cls : null, last: Number(d.last) || 0, cells }
  }
  return { devices }
}

function isOdidUuid(u) {
  const h = hexOnly(u).toUpperCase()
  return h === 'FFFA' || (h.length === 32 && h.slice(4, 8) === 'FFFA')
}

function dvHex(dv) {
  let s = ''
  for (let i = 0; i < dv.byteLength; i++) s += dv.getUint8(i).toString(16).toUpperCase().padStart(2, '0')
  return s
}
/** Web Bluetooth hides real addresses; derive a stable, locally-administered pseudo MAC from the device id. */
function pseudoMac(id) {
  let h = 2166136261
  const bytes = []
  for (let k = 0; k < 6; k++) {
    for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i) ^ k, 16777619)
    bytes.push((h >>> 0) & 0xff)
  }
  bytes[0] = (bytes[0] & 0xfc) | 0x02
  return bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(':')
}

const LOG_HEADER = ['timestamp', 'iso', 'kind', 'mac', 'name', 'rssi', 'channel', 'freq', 'oui', 'vendor', 'fleets', 'mfg', 'uuids', 'flags', 'raw', 'lat', 'lon', 'vendor_ie']

function splitCsv(line) {
  const out = []
  let cur = ''
  let q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ } else if (c === '"') q = false
      else cur += c
    } else if (c === '"') q = true
    else if (c === ',') { out.push(cur); cur = '' } else cur += c
  }
  out.push(cur)
  return out
}

/** Parse a Fieldwatch log (CSV with the Android header, or JSONL). */
export function parseLog(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  const rows = []
  let header = LOG_HEADER
  for (const line of lines) {
    let o
    if (line.trim().startsWith('{')) {
      try { o = JSON.parse(line) } catch { continue }
      o = { ts: Number(o.ts), kind: o.kind, mac: o.mac, name: o.name || '', rssi: Number(o.rssi), channel: Number(o.channel) || 0, freq: Number(o.freq) || 0, mfgId: typeof o.mfg === 'string' ? (o.mfg ? parseInt(o.mfg, 16) : null) : (Number.isFinite(o.mfg) ? o.mfg : null), raw: o.raw, rand: !!o.rand, uuids: String(o.uuids || '').split(/[,|]/).filter(Boolean), lat: o.lat, lon: o.lon, vendorIe: String(o.vendor_ie || '').split('|').filter(Boolean), hidden: !!o.hidden }
    } else {
      const c = splitCsv(line)
      if (c[0] === 'timestamp' || c.includes('kind') && c.includes('mac')) { header = c; continue }
      const g = (k) => c[header.indexOf(k)] ?? ''
      const mfgHex = g('mfg')
      o = { ts: Number(g('timestamp')), kind: g('kind'), mac: g('mac'), name: g('name').replace(/^'/, ''), rssi: Number(g('rssi')), channel: Number(g('channel')) || 0, freq: Number(g('freq')) || 0, mfgId: mfgHex ? parseInt(mfgHex, 16) : null, raw: g('raw'), uuids: g('uuids').split('|').filter(Boolean), lat: g('lat') ? Number(g('lat')) : null, lon: g('lon') ? Number(g('lon')) : null, vendorIe: g('vendor_ie').split('|').filter(Boolean), hidden: g('flags').includes('HIDDEN'), rand: g('flags').includes('RAND') || g('rand') === 'true' }
    }
    if (!o.ts || (o.kind !== 'WIFI' && o.kind !== 'BLE') || !o.mac) continue
    rows.push({
      ts: o.ts, kind: o.kind, mac: o.mac, name: o.name, hidden: o.hidden, rssi: Number.isFinite(o.rssi) ? o.rssi : -100, channel: o.channel, freq: o.freq,
      mfg: o.mfgId != null && !Number.isNaN(o.mfgId) ? [{ companyId: o.mfgId, dataHex: hexOnly(o.raw) }] : [],
      uuids: o.uuids, svcData: [], vendorIe: o.vendorIe,
      lat: Number.isFinite(Number(o.lat)) && o.lat !== null && o.lat !== '' ? Number(o.lat) : null,
      lon: Number.isFinite(Number(o.lon)) && o.lon !== null && o.lon !== '' ? Number(o.lon) : null,
      ...(o.kind === 'BLE' && o.rand ? { addrType: 'random' } : {}),
    })
  }
  return rows
}

export const engine = new Engine()
export { LOG_HEADER }
