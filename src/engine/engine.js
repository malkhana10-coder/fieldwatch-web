// The Fieldwatch web engine: sources → sightings → matcher → live table, sits,
// log, alerts and flood detection. UI subscribes via useEngine().
import { compileCatalog, matchRadio, normMac, isRandomized, oui24, hexOnly, hex4 } from './catalog.js'
import { decodeFields } from './decode.js'
import { loadRadioDb, ouiVendor, companyName } from './lookup.js'
import { Simulator } from './simulator.js'
import { ls, idb } from './storage.js'
import { distM, maskMac } from './geo.js'
import { makeT } from '../i18n.js'

const DEFAULT_FILTERS = { radio: 'BOTH', minRssi: -100, onlyMatched: false, onlyAttention: false, hideMine: false, hideRandom: false, classes: [], maxAge: 60, q: '' }

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
    tgEnabled: false, tgToken: '', tgChatId: '', watchedNets: [], sentinel: false,
    accepted: false, filters: { ...DEFAULT_FILTERS }, presets: [],
  }
}

const LOG_CAP = 6000
// Telegram credentials never leave this device: they are stripped from every
// export and ignored on every import.
const DEVICE_ONLY_SETTINGS = ['tgEnabled', 'tgToken', 'tgChatId']
const TG_MIN_GAP_MS = 5000
const TG_QUEUE_CAP = 20
const HISTORY_CAP = 180
const PRUNE_MS = 10 * 60 * 1000

class Engine {
  constructor() {
    this.listeners = new Set()
    this.version = 0
    const saved = ls.get('settings', {})
    this.settings = { ...defaultSettings(), ...saved, filters: { ...DEFAULT_FILTERS, ...(saved.filters || {}) } }
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
    ls.set('settings', this.settings)
    if ('location' in patch) this.syncGeo()
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
    const clean = list.filter((f) => f && typeof f.id === 'string' && typeof f.name === 'string' && Array.isArray(f.rules)).map((f) => ({
      id: f.id, name: String(f.name).slice(0, 80), enabled: f.enabled !== false, matchAny: f.matchAny !== false,
      colorIndex: Number(f.colorIndex) || 0, minPeers: 0, peerWindowSec: 60, clusterByOui: false, sequentialMac: false,
      notes: String(f.notes || ''), attentionNote: String(f.attentionNote || ''), builtIn: !!f.builtIn, kind: String(f.kind || 'OTHER'),
      rules: f.rules.filter((r) => r && typeof r.kind === 'string').map((r) => ({ kind: r.kind, text: String(r.text || ''), companyId: Number(r.companyId) || 0, dataPrefixHex: String(r.dataPrefixHex || ''), radio: r.radio === 'WIFI' || r.radio === 'BLE' ? r.radio : null, enabled: r.enabled !== false })),
      ...(f.decode && Array.isArray(f.decode.fields) ? { decode: f.decode } : {}),
    }))
    const byId = new Map(this.fleets.map((f) => [f.id, f]))
    clean.forEach((f) => byId.set(f.id, f))
    this.saveFleets([...byId.values()])
    return clean.length
  }
  exportSignatures() {
    return JSON.stringify({ format: 'fieldwatch-signatures', formatVersion: 1, exportedAt: new Date().toISOString(), appVersion: 'web-1.2.0', catalogVersion: this.catalogVersion, fleets: this.fleets }, null, 1)
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
    const sit = this.activeSit()
    for (const s of batch) {
      const mac = normMac(s.mac)
      const key = s.kind + ':' + mac
      let r = this.radios.get(key)
      const isNew = !r
      if (!r) {
        r = { key, kind: s.kind, mac, firstSeen: now, history: [], count: 0, positions: [], name: '' }
        r.randomized = s.kind === 'BLE' ? isRandomized(mac) : isRandomized(mac)
        r.vendor = ouiVendor(mac)
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
      r.count++
      r.history.push([now, s.rssi])
      if (r.history.length > HISTORY_CAP) r.history.shift()
      if (isNew || nameChanged || s.svcData?.length) this.classify(r)
      if (pos) {
        const last = r.positions[r.positions.length - 1]
        if (!last || distM(last, pos) > 15) { r.positions.push({ lat: pos.lat, lon: pos.lon, t: now }); if (r.positions.length > 40) r.positions.shift() }
      }
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
    return r.positions.some((p) => distM(first, p) > minM) && r.lastSeen - r.firstSeen > minMs
  }

  /** Sentinel mode: announce any brand-new device. */
  sentinelAlert(r) {
    if (this.isMine(r) || this.hiddenKeys.has(r.key)) return
    const nm = this.displayName(r) || r.mac
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
      const isStrong = r.cls === 'FINDER' || r.attention
      if (!(isStrong ? this.coTravel(r) : this.coTravel(r, 1000, 10 * 60 * 1000))) continue
      let why
      if (r.cls === 'FINDER') why = 'whyFinder'
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
    const body = t('alertBody', { sig: iso(sig), name: iso(this.displayName(r) || r.mac), rssi: '\u2066' + r.rssi + '\u2069' })
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
    if (!last || distM(last, this.pos) > 8) s.path.push({ lat: this.pos.lat, lon: this.pos.lon, t: now })
  }
  persistSits() { idb.set('sits', this.sits) }

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
    if (this.running) return
    this.ac()
    const src = this.settings.source
    this.stats.started = Date.now()
    if (src === 'ble') {
      const ok = await this.startBle()
      if (!ok) return
    }
    if (src === 'demo') this.sim = new Simulator(() => this.fleets, this.settings.density)
    if (src === 'replay' && !this.replay) { this.toast(this.t('sourceReplayHint')); return }
    this.running = true
    this.syncGeo()
    this.timer = setInterval(() => this.tick(), 1000)
    this.tick()
    this.emit()
  }
  stop() {
    this.running = false
    clearInterval(this.timer)
    try { this.bleScan?.stop() } catch { /* ignore */ }
    this.bleScan = null
    this.syncGeo()
    idb.set('log', this.log)
    this.persistSits()
    this.emit()
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
    }
    this.sitPath(now)
    this.prune(now)
    if (now % 15000 < 1000) { idb.set('log', this.log); this.persistSits() }
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

  // ---------- replay ----------
  loadReplay(text) {
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
    if (j.settings && typeof j.settings === 'object') this.set({ ...portableSettings(j.settings), accepted: true })
    if (j.named && typeof j.named === 'object') { this.named = j.named; ls.set('named', this.named) }
    if (Array.isArray(j.watch)) { this.watch = new Set(j.watch); ls.set('watch', j.watch) }
    this.emit()
  }
  exportAll() {
    return JSON.stringify({
      format: 'fieldwatch-web-backup', version: 1, exportedAt: new Date().toISOString(),
      settings: portableSettings(this.settings), named: this.named, watch: [...this.watch],
      fleets: this.fleets, sits: this.sits, log: this.log,
    }, null, 1)
  }
  async importAll(text) {
    const j = JSON.parse(text)
    if (j.format !== 'fieldwatch-web-backup') throw new Error('not a Fieldwatch backup file')
    if (j.settings && typeof j.settings === 'object') this.set({ ...portableSettings(j.settings), accepted: true })
    if (j.named && typeof j.named === 'object') { this.named = j.named; ls.set('named', this.named) }
    if (Array.isArray(j.watch)) { this.watch = new Set(j.watch); ls.set('watch', j.watch) }
    if (Array.isArray(j.fleets) && j.fleets.length) await this.saveFleets(j.fleets)
    if (Array.isArray(j.sits)) { this.sits = j.sits; await idb.set('sits', this.sits) }
    if (Array.isArray(j.log)) { this.log = j.log.slice(0, LOG_CAP); await idb.set('log', this.log) }
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
      o = { ts: Number(o.ts), kind: o.kind, mac: o.mac, name: o.name || '', rssi: Number(o.rssi), channel: Number(o.channel) || 0, freq: Number(o.freq) || 0, mfgId: o.mfg, raw: o.raw, uuids: String(o.uuids || '').split(/[,|]/).filter(Boolean), lat: o.lat, lon: o.lon, vendorIe: String(o.vendor_ie || '').split('|').filter(Boolean), hidden: !!o.hidden }
    } else {
      const c = splitCsv(line)
      if (c[0] === 'timestamp' || c.includes('kind') && c.includes('mac')) { header = c; continue }
      const g = (k) => c[header.indexOf(k)] ?? ''
      const mfgHex = g('mfg')
      o = { ts: Number(g('timestamp')), kind: g('kind'), mac: g('mac'), name: g('name').replace(/^'/, ''), rssi: Number(g('rssi')), channel: Number(g('channel')) || 0, freq: Number(g('freq')) || 0, mfgId: mfgHex ? parseInt(mfgHex, 16) : null, raw: g('raw'), uuids: g('uuids').split('|').filter(Boolean), lat: g('lat') ? Number(g('lat')) : null, lon: g('lon') ? Number(g('lon')) : null, vendorIe: g('vendor_ie').split('|').filter(Boolean), hidden: g('flags').includes('HIDDEN') }
    }
    if (!o.ts || (o.kind !== 'WIFI' && o.kind !== 'BLE') || !o.mac) continue
    rows.push({
      ts: o.ts, kind: o.kind, mac: o.mac, name: o.name, hidden: o.hidden, rssi: Number.isFinite(o.rssi) ? o.rssi : -100, channel: o.channel, freq: o.freq,
      mfg: o.mfgId != null && !Number.isNaN(o.mfgId) ? [{ companyId: o.mfgId, dataHex: hexOnly(o.raw) }] : [],
      uuids: o.uuids, svcData: [], vendorIe: o.vendorIe, lat: o.lat, lon: o.lon,
    })
  }
  return rows
}

export const engine = new Engine()
export { LOG_HEADER }
