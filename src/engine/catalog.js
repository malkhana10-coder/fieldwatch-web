// Port of Fieldwatch's SignatureEngine: compile the catalog once, index OUI rules
// by 24-bit prefix, then evaluate the remaining rules per radio.

const WIFI_PROTOCOL_IE_OUIS = new Set(['0050F2', '000FAC'])

export const hexOnly = (s) => (s || '').replace(/[^0-9a-fA-F]/g, '').toUpperCase()
export const normMac = (mac) => {
  const h = hexOnly(mac)
  return h.match(/.{1,2}/g)?.join(':') ?? ''
}
export const oui24 = (mac) => hexOnly(mac).slice(0, 6)

/** Locally-administered bit set → randomized / virtual address. */
export function isRandomized(mac) {
  const h = hexOnly(mac)
  if (h.length < 2) return false
  return (parseInt(h.slice(0, 2), 16) & 0x02) !== 0
}

/** Universal OUI with the local bit cleared (mesh / guest BSSIDs). */
export function universalOui(mac) {
  const h = hexOnly(mac)
  if (h.length < 6) return null
  const first = parseInt(h.slice(0, 2), 16)
  if ((first & 0x02) === 0 || (first & 0x01) !== 0) return null
  return (first & 0xfd).toString(16).toUpperCase().padStart(2, '0') + h.slice(2, 6)
}

export function uuidAliases(raw) {
  const hex = hexOnly(raw)
  const out = new Set([String(raw).toUpperCase(), hex])
  if (hex.length === 4) {
    out.add('0000' + hex + '00001000800000805F9B34FB')
  } else if (hex.length === 32 && hex.startsWith('0000') && hex.endsWith('00001000800000805F9B34FB')) {
    out.add(hex.slice(4, 8))
  }
  return out
}

const uuidKey = (u) => {
  const h = hexOnly(u)
  if (h.length === 4) return '0000' + h + '00001000800000805F9B34FB'
  return h
}

export function globToRegex(pattern) {
  const body = pattern.split('').map((ch) => (ch === '*' ? '.*' : ch === '?' ? '.' : ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('')
  return new RegExp('^' + body + '$', 'i')
}

function ruleScope(rule) {
  switch (rule.kind) {
    case 'VENDOR_IE_OUI': case 'HIDDEN_SSID': return 'WIFI'
    case 'RADIO_KIND': return rule.radio
    case 'SERVICE_UUID': case 'SERVICE_DATA': case 'MANUFACTURER_ID': case 'MANUFACTURER_DATA': return rule.radio || 'BLE'
    default: return rule.radio || null
  }
}

function radioOk(rule, kind) {
  const s = ruleScope(rule)
  return !s || s === kind
}

function mfgRecords(d) {
  return d.mfg || []
}

/** Evaluate one rule against a radio. Used for matchAll fleets and the "why" explainer. */
export function ruleHits(d, rule) {
  if (!rule.enabled && rule.enabled !== undefined) return false
  if (!radioOk(rule, d.kind)) return false
  const name = d.name || ''
  switch (rule.kind) {
    case 'OUI': {
      const want = hexOnly(rule.text)
      if (!want) return false
      const mac = hexOnly(d.mac)
      if (mac.startsWith(want)) return true
      const u = d.kind === 'WIFI' ? universalOui(d.mac) : null
      if (u && (u + mac.slice(6)).startsWith(want)) return true
      return d.kind === 'WIFI' && !WIFI_PROTOCOL_IE_OUIS.has(want) && (d.vendorIe || []).some((v) => hexOnly(v) === want)
    }
    case 'MAC_PREFIX': {
      const want = hexOnly(rule.text)
      return !!want && hexOnly(d.mac).startsWith(want)
    }
    case 'VENDOR_IE_OUI': {
      const want = hexOnly(rule.text)
      return !!want && (d.vendorIe || []).some((v) => hexOnly(v).startsWith(want))
    }
    case 'NAME_CONTAINS':
      return !!rule.text && !d.hidden && name.toLowerCase().includes(rule.text.toLowerCase())
    case 'NAME_GLOB':
      return !!rule.text && !d.hidden && !!name && (rule._re || (rule._re = globToRegex(rule.text))).test(name)
    case 'SERVICE_UUID': {
      if (!rule.text) return false
      const al = rule._al || (rule._al = new Set([...uuidAliases(rule.text)].map(uuidKey)))
      return (d.uuids || []).some((u) => al.has(uuidKey(u)))
    }
    case 'SERVICE_DATA': {
      const prefix = hexOnly(rule.dataPrefixHex)
      const want = rule.text ? uuidKey(rule.text) : null
      return (d.svcData || []).some((s) => (!want || uuidKey(s.uuid) === want) && (!prefix || hexOnly(s.dataHex).startsWith(prefix)))
    }
    case 'MANUFACTURER_ID':
      return mfgRecords(d).some((r) => r.companyId === rule.companyId)
    case 'MANUFACTURER_DATA': {
      const prefix = hexOnly(rule.dataPrefixHex)
      if (!prefix) return false
      return mfgRecords(d).some((r) => r.companyId === rule.companyId && hexOnly(r.dataHex).startsWith(prefix))
    }
    case 'RADIO_KIND':
      return rule.radio === d.kind
    case 'HIDDEN_SSID':
      return d.kind === 'WIFI' && !!d.hidden
    default:
      return false
  }
}

export function compileCatalog(fleets) {
  const ouiWifi = new Map()
  const ouiBle = new Map()
  const longOui = []
  const plans = fleets.map((f, idx) => {
    const active = (f.rules || []).filter((r) => r.enabled !== false)
    const other = []
    for (const r of active) {
      if (r.kind === 'OUI' || r.kind === 'MAC_PREFIX') {
        const h = hexOnly(r.text)
        if (!h) continue
        if (h.length !== 6) { longOui.push({ h, radio: r.radio, idx }); continue }
        if (r.radio !== 'BLE') push(ouiWifi, h, idx)
        if (r.radio !== 'WIFI') push(ouiBle, h, idx)
      } else {
        other.push(r)
      }
    }
    const scopes = new Set(active.map(ruleScope))
    const scope = scopes.has(null) || (scopes.has('WIFI') && scopes.has('BLE')) ? null : scopes.has('WIFI') ? 'WIFI' : scopes.has('BLE') ? 'BLE' : null
    return { idx, fleet: f, active, other, scope }
  })
  return { plans, ouiWifi, ouiBle, longOui, byId: new Map(fleets.map((f) => [f.id, f])) }
}

function push(map, k, v) {
  const l = map.get(k)
  if (l) { if (!l.includes(v)) l.push(v) } else map.set(k, [v])
}

/** Returns matching fleet ids for a radio. */
export function matchRadio(compiled, d) {
  const ouiHits = new Set()
  const mac = hexOnly(d.mac)
  const map = d.kind === 'WIFI' ? compiled.ouiWifi : compiled.ouiBle
  const add = (k) => (map.get(k) || []).forEach((i) => ouiHits.add(i))
  add(mac.slice(0, 6))
  if (d.kind === 'WIFI') {
    const u = universalOui(d.mac)
    if (u) add(u)
    for (const v of d.vendorIe || []) {
      const h = hexOnly(v).slice(0, 6)
      if (!WIFI_PROTOCOL_IE_OUIS.has(h)) (compiled.ouiWifi.get(h) || []).forEach((i) => ouiHits.add(i))
    }
  }
  for (const l of compiled.longOui) {
    if ((!l.radio || l.radio === d.kind) && mac.startsWith(l.h)) ouiHits.add(l.idx)
  }
  const hits = []
  for (const p of compiled.plans) {
    const f = p.fleet
    if (!f.enabled) continue
    if (p.scope && p.scope !== d.kind) continue
    if (!p.active.length) continue
    let ok
    if (f.matchAny === false) ok = p.active.every((r) => ruleHits(d, r))
    else ok = ouiHits.has(p.idx) || p.other.some((r) => ruleHits(d, r))
    if (ok) hits.push(f.id)
  }
  // Same disambiguation the Android engine applies.
  const has = (id) => hits.includes(id)
  const drop = (id) => { const i = hits.indexOf(id); if (i >= 0) hits.splice(i, 1) }
  if (has('fleet-ibeacon') && hits.some((id) => id !== 'fleet-ibeacon' && compiled.byId.get(id)?.kind !== 'BEACON')) drop('fleet-ibeacon')
  if (has('fleet-osmo') || has('fleet-dji-power')) drop('fleet-dji')
  if (has('fleet-polar')) drop('fleet-gopro')
  if (has('fleet-meraki')) drop('fleet-cisco')
  return hits
}

/** Human-readable reasons a radio matched a fleet. */
export function explainMatch(d, fleet) {
  return (fleet.rules || []).filter((r) => r.enabled !== false && ruleHits(d, r)).slice(0, 6).map(describeRule)
}

export function describeRule(r) {
  const radio = r.radio ? ` · ${r.radio === 'WIFI' ? 'Wi-Fi' : 'BLE'}` : ''
  switch (r.kind) {
    case 'OUI': return `OUI ${normMac(r.text)}${radio}`
    case 'MAC_PREFIX': return `MAC ${normMac(r.text)}${radio}`
    case 'VENDOR_IE_OUI': return `Vendor IE ${normMac(r.text)}`
    case 'NAME_GLOB': return `Name ≈ "${r.text}"${radio}`
    case 'NAME_CONTAINS': return `Name ∋ "${r.text}"${radio}`
    case 'SERVICE_UUID': return `Service UUID ${r.text.toUpperCase()}`
    case 'SERVICE_DATA': return `Service data ${r.text.toUpperCase()} ${r.dataPrefixHex || ''}`.trim()
    case 'MANUFACTURER_ID': return `Company 0x${hex4(r.companyId)}`
    case 'MANUFACTURER_DATA': return `Company 0x${hex4(r.companyId)} · ${r.dataPrefixHex}`
    case 'HIDDEN_SSID': return 'Hidden SSID'
    case 'RADIO_KIND': return `Radio ${r.radio}`
    default: return r.kind
  }
}

export const hex4 = (n) => (n >>> 0).toString(16).toUpperCase().padStart(4, '0')

/** Build a custom fleet from a heard radio (port of SignatureEngine.suggestFleet). */
export function suggestFleet(d) {
  const rules = [{ kind: 'MAC_PREFIX', text: normMac(d.mac), companyId: 0, dataPrefixHex: '', radio: null, enabled: true }]
  if (d.name && !d.hidden) {
    const m = d.name.match(/^([A-Za-z][A-Za-z ._-]{2,})[-_ ]?[0-9A-Fa-f]{2,}$/)
    rules.push(m
      ? { kind: 'NAME_GLOB', text: m[1] + '*', companyId: 0, dataPrefixHex: '', radio: null, enabled: true }
      : { kind: 'NAME_CONTAINS', text: d.name.slice(0, 32), companyId: 0, dataPrefixHex: '', radio: null, enabled: true })
  }
  for (const u of (d.uuids || []).slice(0, 3)) {
    const h = hexOnly(u)
    const short = h.length >= 8 ? h.slice(4, 8) : h.slice(0, 4)
    if (short) rules.push({ kind: 'SERVICE_UUID', text: short, companyId: 0, dataPrefixHex: '', radio: null, enabled: true })
  }
  const m0 = (d.mfg || [])[0]
  if (m0) {
    const p = hexOnly(m0.dataHex).slice(0, 2)
    rules.push(p
      ? { kind: 'MANUFACTURER_DATA', text: '', companyId: m0.companyId, dataPrefixHex: p, radio: null, enabled: true }
      : { kind: 'MANUFACTURER_ID', text: '', companyId: m0.companyId, dataPrefixHex: '', radio: null, enabled: true })
  }
  const name = d.name && !d.hidden ? d.name.replace(/[^A-Za-z0-9 _.-]/g, '').slice(0, 22) : `${d.kind === 'WIFI' ? 'Wi-Fi' : 'BLE'} ${normMac(d.mac).slice(-8)}`
  return {
    id: 'custom-' + Math.random().toString(36).slice(2, 10),
    name: name || 'Custom signature',
    enabled: true, matchAny: true, colorIndex: d.kind === 'BLE' ? 3 : 0, rules,
    minPeers: 0, peerWindowSec: 60, clusterByOui: false, sequentialMac: false,
    notes: `Created from ${d.kind === 'WIFI' ? 'Wi-Fi' : 'BLE'} ${normMac(d.mac)}.${d.randomized ? ' Address is randomized and may change; prefer name / UUID / manufacturer rules.' : ''}`,
    attentionNote: '', builtIn: false, kind: 'OTHER',
  }
}

export const PALETTE = ['#3DFF9A', '#FFB020', '#FF3D5A', '#4FC3F7', '#B388FF', '#FF8A4C', '#9AA7B0', '#3D8B6E', '#5BA3D9']
