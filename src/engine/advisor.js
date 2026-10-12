// The advisor answers "am I safe here?" in plain Arabic or English.
// 1) A local, offline analyst that always works (rules over risk scores).
// 2) Optionally Claude: inside the claude.ai viewer through the page's `sample`
//    capability, elsewhere with the user's own Anthropic API key, sent straight
//    from this browser to the Anthropic API (no Fieldwatch server exists).
import { riskScore, riskLevel, RISK_TEXT, appleKind, CLASS_INFO } from './intel.js'
import { maskMac } from './geo.js'

/** Compact, privacy-aware picture of what is around right now. */
export function snapshot(engine, radios, { privacy = engine.settings.privacy } = {}) {
  const place = engine.currentPlace()
  const rows = radios.map((r) => ({ r, risk: riskScore(r, { engine, place }) }))
  rows.sort((a, b) => b.risk.score - a.risk.score)
  const byClass = {}
  for (const { r } of rows) if (r.cls) byClass[r.cls] = (byClass[r.cls] || 0) + 1
  return {
    total: rows.length,
    wifi: rows.filter((x) => x.r.kind === 'WIFI').length,
    ble: rows.filter((x) => x.r.kind === 'BLE').length,
    place: place?.name || null,
    byClass,
    top: rows.slice(0, 12).map(({ r, risk }) => ({
      name: engine.displayName(r) || null,
      kind: r.kind,
      mac: maskMac(r.mac, privacy),
      signatures: r.fleetIds.map((id) => engine.fleetById(id)?.name).filter(Boolean),
      cls: r.cls,
      apple: appleKind(r)?.en || null,
      rssi: r.rssi,
      minutes: Math.round((r.lastSeen - (r.linkedFirstSeen || r.firstSeen)) / 60000),
      movingWithYou: engine.coTravel(r),
      score: risk.score,
      reasons: risk.reasons.filter((x) => x.w).map((x) => RISK_TEXT[x.k]?.en || x.k),
    })),
    rows,
  }
}

/** Offline verdict. Returns { level, title, summary, items[] } in the UI language. */
export function localAdvice(engine, snap) {
  const ar = engine.settings.lang === 'ar'
  const findings = snap.rows.filter((x) => x.risk.score >= 30)
  const max = snap.rows[0]?.risk.score || 0
  const level = riskLevel(max)
  const title = level === 'high'
    ? (ar ? 'يوجد ما يستحق الانتباه الآن' : 'Something here needs your attention')
    : level === 'medium'
      ? (ar ? 'لا خطر واضح، لكن راجع هذه الأجهزة' : 'Nothing alarming, but review these devices')
      : (ar ? 'لا شيء مقلق حولك' : 'Nothing concerning around you')
  const parts = []
  parts.push(ar ? `التُقط ${snap.total} جهازاً (${snap.wifi} Wi-Fi و${snap.ble} بلوتوث).` : `Heard ${snap.total} devices (${snap.wifi} Wi-Fi, ${snap.ble} Bluetooth).`)
  const notable = Object.entries(snap.byClass).filter(([c]) => (CLASS_INFO[c]?.risk || 0) >= 20)
  if (notable.length) {
    parts.push(ar
      ? 'منها: ' + notable.map(([c, n]) => `${n} ${engine.t.cls(c)}`).join('، ') + '.'
      : 'Including: ' + notable.map(([c, n]) => `${n} ${engine.t.cls(c).toLowerCase()}`).join(', ') + '.')
  }
  const moving = snap.rows.filter((x) => engine.coTravel(x.r))
  if (moving.length) parts.push(ar ? `${moving.length} جهاز ظهر في أكثر من مكان أثناء تنقلك.` : `${moving.length} device(s) appeared in more than one place while you moved.`)
  if (!findings.length) parts.push(ar ? 'كل ما سُمع يبدو أجهزة يومية معتادة.' : 'Everything heard looks like everyday equipment.')
  parts.push(ar ? 'هذه قراءة احتمالية وليست حكماً قاطعاً.' : 'This is a probability reading, not a certainty.')
  return { level, max, title, summary: parts.join(' '), items: findings.slice(0, 8) }
}

const SYSTEM_PROMPT = `You are the analyst inside Fieldwatch, a passive Wi-Fi and Bluetooth scanner people use to check for trackers, hidden cameras, recorders and hacking gadgets around them.
You receive a JSON snapshot of what the user's phone heard, with risk scores computed on the device. Answer the user's question in the language they use (Arabic or English).
Rules:
- Treat every signature match as a hypothesis, not identity. Locations are where the user's phone was, never where the other device is.
- Give a clear verdict first (one sentence), then at most five short bullet points: what stands out, the most likely innocent explanations, and concrete next steps (move and rescan, use Hunt, check common hiding places).
- If nothing stands out, say so plainly and do not invent threats.
- Never suggest jamming, hacking, disconnecting or interfering with other people's devices. If the user may be in danger, advise contacting local authorities.
- Keep the whole answer under 180 words.`

function promptFor(question, snap) {
  const { rows, ...lean } = snap
  return `Snapshot:\n${JSON.stringify(lean)}\n\nQuestion: ${question}`
}

let sampleCap
async function viewerSample() {
  if (sampleCap !== undefined) return sampleCap
  sampleCap = null
  try { if (typeof window.claude?.use === 'function') sampleCap = await window.claude.use('sample') } catch { /* unavailable */ }
  return sampleCap
}

export async function hasClaude(engine) {
  return !!engine.aiKey || !!(await viewerSample())
}

/** Ask Claude. Resolves to the answer text; throws Error with a readable message. */
export async function askClaude(engine, question, snap) {
  const sample = await viewerSample()
  if (sample) {
    const res = await sample([{ role: 'user', content: SYSTEM_PROMPT + '\n\n' + promptFor(question, snap) }], { modelTier: 'default' })
    return res.text
  }
  if (!engine.aiKey) throw new Error('no-key')
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  // The key stays on this device and goes only to api.anthropic.com.
  const client = new Anthropic({ apiKey: engine.aiKey, dangerouslyAllowBrowser: true })
  try {
    const response = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium' },
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: promptFor(question, snap) }],
    })
    if (response.stop_reason === 'refusal') throw new Error(engine.settings.lang === 'ar' ? 'رفض النموذج هذا السؤال. جرّب صياغة أخرى.' : 'The model declined this question. Try rephrasing it.')
    return response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim()
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new Error(engine.settings.lang === 'ar' ? 'مفتاح API غير صالح.' : 'The API key is not valid.')
    if (err instanceof Anthropic.RateLimitError) throw new Error(engine.settings.lang === 'ar' ? 'تم تجاوز حد الطلبات. انتظر قليلاً ثم حاول.' : 'Rate limited. Wait a moment and try again.')
    if (err instanceof Anthropic.APIConnectionError) throw new Error(engine.settings.lang === 'ar' ? 'تعذّر الاتصال. تحقق من الإنترنت.' : 'Could not connect. Check your internet connection.')
    if (err instanceof Anthropic.APIError) throw new Error(`API ${err.status}: ${err.message}`)
    throw err
  }
}
