// Debrief / compare / exports for sits and the log.
import { csvCell, xmlEsc, distM, spreadM, maskMac } from './geo.js'
import { LOG_HEADER } from './engine.js'

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
  const head = 'WigleWifi-1.4,appRelease=fieldwatch-web-1.0.0,model=browser,release=web,device=browser,display=web,board=web,brand=fieldwatch'
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
    ...(r.decoded || []).map((f) => `${f.label}: ${f.value}`),
    `${t('firstSeen')}: ${new Date(r.firstSeen).toISOString()}`,
  ]
  return out.filter(Boolean).join('\n')
}

// ---------- v2: weekly, trends, place comparison, CoT, formal report ----------
const WEEK = 7 * 86400000

export function weeklySummary(engine, now = Date.now()) {
  const sits = engine.sits.filter((s) => s.start >= now - WEEK)
  const devices = new Set()
  let attention = 0
  let coTravel = 0
  for (const s of sits) {
    const d = debrief(s, engine)
    Object.keys(s.radios).forEach((k) => devices.add(k))
    attention += d.attention.length
    coTravel += d.coTravel.length
  }
  return { scans: sits.length, devices: devices.size, attention, coTravel }
}

export function trendSeries(engine, limit = 20) {
  return [...engine.sits].filter((s) => s.end).sort((a, b) => a.start - b.start).slice(-limit).map((s) => {
    const rs = sitRadios(s)
    return { id: s.id, t: s.start, name: s.name, total: rs.length, attention: rs.filter((r) => r.fleetIds.some((id) => engine.fleetById(id)?.attentionNote)).length, risky: rs.filter((r) => (r.risk || 0) >= 30).length }
  })
}

/** Previous finished scan at the same place, for "what changed here". */
export function previousAtPlace(engine, sit) {
  if (!sit.placeId) return null
  return engine.sits.filter((s) => s.id !== sit.id && s.placeId === sit.placeId && s.end && s.start < sit.start).sort((a, b) => b.start - a.start)[0] || null
}

/** ATAK / TAK Cursor-on-Target events for attention radios (where this device heard them). */
export function sitCot(sit, engine) {
  const stale = new Date(Date.now() + 3600000).toISOString()
  const ev = Object.values(sit.radios).filter((r) => r.pts.length && r.fleetIds.some((id) => engine.fleetById(id)?.attentionNote)).map((r) => {
    const p = r.pts.reduce((a, b) => (b.rssi > a.rssi ? b : a), r.pts[0])
    const sig = r.fleetIds.map((id) => engine.fleetById(id)?.name).join('+')
    return `<event version="2.0" uid="fieldwatch-${xmlEsc(r.key.replace(/[^A-Za-z0-9]/g, ''))}" type="a-u-G" how="m-g" time="${iso(p.t)}" start="${iso(p.t)}" stale="${stale}"><point lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}" hae="0" ce="50" le="9999999"/><detail><contact callsign="${xmlEsc(sig || r.name || r.mac)}"/><remarks>${xmlEsc(`Fieldwatch: ${r.kind} ${r.mac} ${p.rssi} dBm. Heard here by the scanning device; not the radio's position.`)}</remarks></detail></event>`
  })
  return `<?xml version="1.0" encoding="UTF-8"?>\n<events>\n${ev.join('\n')}\n</events>\n`
}

/** Self-contained bilingual formal report (HTML) ready to print or archive. */
export function formalReportHtml(sit, engine, { preparedBy = '', reportNo = '', advice = null } = {}) {
  const t = engine.t
  const ar = t.lang === 'ar'
  const privacy = engine.settings.privacy
  const d = debrief(sit, engine)
  const esc = xmlEsc
  const rows = Object.values(sit.radios).filter((r) => !r.flood && ((r.risk || 0) >= 30 || r.fleetIds.some((id) => engine.fleetById(id)?.attentionNote))).sort((a, b) => (b.risk || 0) - (a.risk || 0))
  const tr = rows.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.fleetIds.map((id) => engine.fleetById(id)?.name).join(' + ') || '—')}</td><td>${esc(r.kind)}</td><td dir="ltr">${esc(maskMac(r.mac, privacy))}</td><td>${esc(r.name || '—')}</td><td dir="ltr">${r.maxRssi}</td><td>${r.risk ?? '—'}</td><td dir="ltr">${new Date(r.first).toLocaleString(ar ? 'ar-SA-u-nu-latn-ca-gregory' : 'en-GB')}</td></tr>`).join('')
  const summary = advice?.summary || `${t('radios')}: ${d.total} · ${t('matched')}: ${d.matched} · ${t('attention')}: ${d.attention.length} · ${t('coTravel')}: ${d.coTravel.length}`
  return `<!doctype html><html lang="${t.lang}" dir="${t.dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(t('officialReport'))} — ${esc(sit.name)}</title>
<style>body{font-family:'IBM Plex Sans Arabic','IBM Plex Sans',system-ui,sans-serif;color:#111;margin:32px;line-height:1.5}h1{font-size:22px;margin:0}h2{font-size:15px;border-bottom:2px solid #0a8f5a;padding-bottom:4px;margin-top:28px}.meta{display:grid;grid-template-columns:max-content 1fr;gap:4px 16px;font-size:13px;margin-top:12px}table{width:100%;border-collapse:collapse;font-size:12px}td,th{border:1px solid #ccc;padding:5px 6px;text-align:start}th{background:#eef5f1}.head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #0a8f5a;padding-bottom:12px}.small{font-size:11.5px;color:#555}.sig{margin-top:48px;display:flex;gap:48px}.sig div{flex:1;border-top:1px solid #333;padding-top:6px;font-size:12px}@media print{body{margin:12mm}}</style></head><body>
<div class="head"><div><h1>${esc(t('officialReport'))}</h1><div class="small">Fieldwatch · ${esc(t('unofficial'))}</div></div><div class="small" style="text-align:end">${esc(t('reportNo'))}: ${esc(reportNo || sit.id)}<br>${new Date().toLocaleDateString(ar ? 'ar-SA-u-nu-latn-ca-gregory' : 'en-GB')}</div></div>
<div class="meta"><b>${esc(t('sit'))}</b><span>${esc(sit.name)}</span><b>${esc(t('firstSeen'))}</b><span dir="ltr">${new Date(sit.start).toLocaleString(ar ? 'ar-SA-u-nu-latn-ca-gregory' : 'en-GB')}</span><b>${esc(t('duration'))}</b><span>${Math.round(d.duration / 60000)} min</span><b>${esc(t('preparedBy'))}</b><span>${esc(preparedBy || '—')}</span></div>
<h2>${esc(t('execSummary'))}</h2><p>${esc(summary)}</p>
<h2>${esc(t('findingsTable'))} (${rows.length})</h2>${rows.length ? `<table><thead><tr><th>#</th><th>${ar ? 'البصمة' : 'Signature'}</th><th>Radio</th><th>MAC</th><th>${esc(t('name'))}</th><th>dBm</th><th>${esc(t('riskScore'))}</th><th>${esc(t('firstSeen'))}</th></tr></thead><tbody>${tr}</tbody></table>` : `<p>${esc(t('noFindings'))}</p>`}
<h2>${esc(t('byClass'))}</h2><p>${d.byClass.map(([c, n]) => `${esc(t.cls(c))}: ${n}`).join(' · ') || '—'}</p>
<h2>${esc(t('method'))}</h2><p class="small">${esc(t('learnRadio'))}</p><p class="small">${esc(t('disclaimerShort'))} ${esc(t('learnLimits'))}</p>
<div class="sig"><div>${esc(t('preparedBy'))}</div><div>${esc(t('signature'))}</div></div>
</body></html>`
}
