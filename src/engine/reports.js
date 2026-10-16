// Debrief / compare / exports for sits and the log.
import { csvCell, xmlEsc, distM, spreadM, maskMac } from './geo.js'
import { LOG_HEADER, APP_VERSION } from './engine.js'
import { isLocationField } from './decode.js'
import { maskMacText } from './catalog.js'

export function sitRadios(sit) {
  return Object.values(sit.radios).filter((r) => !r.flood)
}

export function debrief(sit, engine) {
  const radios = sitRadios(sit)
  const fleetName = (id) => engine.fleetById(id)?.name || id
  const byClass = {}
  const bySig = {}
  const byChannel = {}
  let wifi = 0
  let ble = 0
  const attention = []
  const coTravel = []
  const mine = []
  for (const r of radios) {
    r.kind === 'WIFI' ? wifi++ : ble++
    const fleets = r.fleetIds.map((id) => engine.fleetById(id)).filter(Boolean)
    const cls = fleets[0]?.kind || (r.fleetIds.length ? 'OTHER' : null)
    if (cls) byClass[cls] = (byClass[cls] || 0) + 1
    for (const f of fleets) bySig[f.name] = (bySig[f.name] || 0) + 1
    if (r.kind === 'WIFI' && r.channel) byChannel[r.channel] = (byChannel[r.channel] || 0) + 1
    if (fleets.some((f) => f.attentionNote)) attention.push({ r, fleets })
    if (r.mine) mine.push(r)
    else if (r.pts.length >= 3 && spreadM(r.pts) > 200 && r.last - r.first > 3 * 60 * 1000) coTravel.push({ r, spread: spreadM(r.pts) })
  }
  const pathLen = sit.path.reduce((acc, p, i) => (i ? acc + distM(sit.path[i - 1], p) : 0), 0)
  return {
    total: radios.length, wifi, ble, matched: radios.filter((r) => r.fleetIds.length).length,
    floods: sit.floods, floodHidden: Object.values(sit.radios).filter((r) => r.flood).length,
    byClass: Object.entries(byClass).sort((a, b) => b[1] - a[1]),
    bySig: Object.entries(bySig).sort((a, b) => b[1] - a[1]).slice(0, 15),
    byChannel: Object.entries(byChannel).sort((a, b) => Number(a[0]) - Number(b[0])),
    attention, coTravel: coTravel.sort((a, b) => b.spread - a.spread), mine,
    duration: (sit.end || Date.now()) - sit.start, pathLen, fleetName,
    // Devices heard after the sit was full and not recorded (trackers and other priority devices always are).
    dropped: sit.dropped || 0,
  }
}

export function compareSits(a, b) {
  const ka = new Set(Object.keys(a.radios))
  const kb = new Set(Object.keys(b.radios))
  return {
    both: [...ka].filter((k) => kb.has(k)).map((k) => b.radios[k]),
    onlyA: [...ka].filter((k) => !kb.has(k)).map((k) => a.radios[k]),
    onlyB: [...kb].filter((k) => !ka.has(k)).map((k) => b.radios[k]),
  }
}

const iso = (ms) => new Date(ms).toISOString()

export function sitCsv(sit, engine, privacy) {
  const head = ['kind', 'mac', 'name', 'vendor', 'signatures', 'first_seen', 'last_seen', 'max_rssi', 'min_rssi', 'avg_rssi', 'count', 'channel', 'lat', 'lon']
  const rows = Object.values(sit.radios).map((r) => {
    const p = r.pts[0]
    return [r.kind, maskMac(r.mac, privacy), r.name, r.vendor || '', r.fleetIds.map((id) => engine.fleetById(id)?.name).join('+'), iso(r.first), iso(r.last), r.maxRssi, r.minRssi, Math.round(r.sum / Math.max(1, r.count)), r.count, r.channel || '', privacy || !p ? '' : p.lat.toFixed(6), privacy || !p ? '' : p.lon.toFixed(6)].map(csvCell).join(',')
  })
  return [head.join(','), ...rows].join('\n') + '\n'
}

export function sitGpx(sit, engine) {
  const wpts = Object.values(sit.radios).filter((r) => r.pts.length).map((r) => {
    const best = r.pts.reduce((a, b) => (b.rssi > a.rssi ? b : a), r.pts[0])
    const sig = r.fleetIds.map((id) => engine.fleetById(id)?.name).join(', ')
    return `  <wpt lat="${best.lat.toFixed(6)}" lon="${best.lon.toFixed(6)}"><time>${iso(best.t)}</time><name>${xmlEsc(r.name || r.mac)}</name><desc>${xmlEsc(`${r.kind} ${r.mac} ${best.rssi} dBm${sig ? ' · ' + sig : ''} — where this device was, not the radio`)}</desc></wpt>`
  })
  const trk = sit.path.map((p) => `      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}"><time>${iso(p.t)}</time></trkpt>`)
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Fieldwatch Web" xmlns="http://www.topografix.com/GPX/1/1">\n  <metadata><name>${xmlEsc(sit.name)}</name><time>${iso(sit.start)}</time></metadata>\n${wpts.join('\n')}\n  <trk><name>${xmlEsc(sit.name)}</name><trkseg>\n${trk.join('\n')}\n    </trkseg></trk>\n</gpx>\n`
}

export function sitKml(sit, engine) {
  const pms = Object.values(sit.radios).filter((r) => r.pts.length).map((r) => {
    const best = r.pts.reduce((a, b) => (b.rssi > a.rssi ? b : a), r.pts[0])
    const sig = r.fleetIds.map((id) => engine.fleetById(id)?.name).join(', ')
    return `    <Placemark><name>${xmlEsc(r.name || r.mac)}</name><description>${xmlEsc(`${r.kind} ${r.mac} ${best.rssi} dBm ${sig}`)}</description><Point><coordinates>${best.lon.toFixed(6)},${best.lat.toFixed(6)},0</coordinates></Point></Placemark>`
  })
  const line = sit.path.map((p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)},0`).join(' ')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${xmlEsc(sit.name)}</name>\n${pms.join('\n')}\n    <Placemark><name>Path</name><LineString><tessellate>1</tessellate><coordinates>${line}</coordinates></LineString></Placemark>\n</Document></kml>\n`
}

export function sitWigle(sit) {
  const head = `WigleWifi-1.4,appRelease=fieldwatch-web-${APP_VERSION},model=browser,release=web,device=browser,display=web,board=web,brand=fieldwatch`
  const cols = 'MAC,SSID,AuthMode,FirstSeen,Channel,RSSI,CurrentLatitude,CurrentLongitude,AltitudeMeters,AccuracyMeters,Type'
  const rows = Object.values(sit.radios).filter((r) => r.pts.length).map((r) => {
    const p = r.pts[0]
    const auth = r.kind === 'WIFI' ? `[${(r.security || 'ESS').replace(/\//g, '][')}]` : 'Misc [LE]'
    const d = new Date(r.first)
    const ts = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${d.toTimeString().slice(0, 8)}`
    return [r.mac.toLowerCase(), r.name, auth, ts, r.kind === 'WIFI' ? r.channel : 0, r.maxRssi, p.lat.toFixed(6), p.lon.toFixed(6), 0, 10, r.kind === 'WIFI' ? 'WIFI' : 'BLE'].map(csvCell).join(',')
  })
  return [head, cols, ...rows].join('\n') + '\n'
}

export function logCsv(log) {
  const rows = log.map((r) => [r.ts, iso(r.ts), r.kind, r.mac, r.name, r.rssi, r.channel, r.freq, r.oui, r.vendor, r.fleets, r.mfg, r.uuids, `${r.rand ? 'RAND ' : ''}${r.hidden ? 'HIDDEN' : ''}`.trim(), r.raw, r.lat?.toFixed?.(6) ?? '', r.lon?.toFixed?.(6) ?? '', r.vendor_ie].map(csvCell).join(','))
  return [LOG_HEADER.join(','), ...rows].join('\n') + '\n'
}

export function aiPrompt(sit, engine, privacy) {
  const d = debrief(sit, engine)
  const lines = []
  lines.push('You are helping me review a passive radio survey from Fieldwatch (Wi-Fi APs and Bluetooth LE advertisements heard by my device).')
  lines.push('Treat every signature match as a hypothesis, not identity. Locations are where MY device was when it heard the radio, not where the radio is.')
  lines.push('')
  lines.push(`Sit: ${sit.name}`)
  lines.push(`Window: ${iso(sit.start)} → ${sit.end ? iso(sit.end) : 'running'} (${Math.round(d.duration / 60000)} min), path ≈ ${Math.round(d.pathLen)} m`)
  lines.push(`Radios: ${d.total} (Wi-Fi ${d.wifi}, BLE ${d.ble}), matched ${d.matched}. Floods: ${d.floods.length} (${d.floodHidden} addresses set aside).`)
  if (d.dropped) lines.push(`The sit was full: about ${d.dropped} more ordinary devices were heard but not recorded (trackers, Extra attention and watched devices still were).`)
  lines.push('')
  lines.push('By class: ' + d.byClass.map(([c, n]) => `${c} ${n}`).join(', '))
  lines.push('Top signatures: ' + d.bySig.map(([s, n]) => `${s} ${n}`).join(', '))
  lines.push('')
  if (d.attention.length) {
    lines.push('Extra attention:')
    for (const { r, fleets } of d.attention.slice(0, 30)) lines.push(`- ${fleets.map((f) => f.name).join('+')}: ${r.kind} ${maskMac(r.mac, privacy)} "${r.name || ''}" max ${r.maxRssi} dBm, seen ${Math.round((r.last - r.first) / 1000)} s. Note: ${fleets.find((f) => f.attentionNote)?.attentionNote}`)
    lines.push('')
  }
  if (d.coTravel.length) {
    lines.push('Possible co-travel (heard across > 200 m of my path):')
    for (const { r, spread } of d.coTravel.slice(0, 20)) lines.push(`- ${r.kind} ${maskMac(r.mac, privacy)} "${r.name || ''}" ${(r.fleetIds.map(d.fleetName).join('+')) || 'no signature'} spread ${Math.round(spread)} m over ${Math.round((r.last - r.first) / 60000)} min`)
    lines.push('')
  }
  lines.push('Questions: What stands out? Which items deserve a second look, and what benign explanations exist for each? What would you check next?')
  return lines.join('\n')
}

export function radioText(r, engine, t) {
  const privacy = engine.settings.privacy
  const out = [
    `${engine.displayName(r) || t('unknown')} — ${r.kind === 'WIFI' ? 'Wi-Fi' : 'BLE'}`,
    `MAC ${maskMac(r.mac, privacy)}${r.randomized ? ' (' + t('randomized') + ')' : ''}`,
    `${t('rssi')} ${r.rssi} dBm · ${t('avg')} ${Math.round(engine.avgRssi(r))} dBm`,
    r.vendor ? `${t('vendor')}: ${r.vendor}` : null,
    r.company ? `${t('company')}: ${r.company}` : null,
    r.channel ? `${t('channel')}: ${r.channel} (${r.freq} MHz)` : null,
    ...r.fleetIds.map((id) => `◆ ${engine.fleetById(id)?.name}`),
    // Privacy mode: no decoded coordinates (e.g. a drone's position) and no MACs inside decoded values.
    ...(r.decoded || []).map((f) => `${f.label}: ${privacy && isLocationField(f) ? '••' : maskMacText(String(f.value), privacy)}`),
    `${t('firstSeen')}: ${new Date(r.firstSeen).toISOString()}`,
  ]
  return out.filter(Boolean).join('\n')
}
