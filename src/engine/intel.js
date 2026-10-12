// Intelligence layer: plain-language meaning of what was heard, risk scoring,
// identity linking across address rotation, place memory and anomaly hints.
// Everything here is a hypothesis; the UI always says so.
import { hexOnly } from './catalog.js'
import { distM } from './geo.js'

// ---------- Apple Continuity (company 0x004C) ----------
// The first byte of each TLV names the message type. These are public, widely
// documented values; they describe what kind of Apple advertisement it is.
const APPLE_TYPES = {
  0x02: { en: 'iBeacon', ar: 'منارة iBeacon' },
  0x05: { en: 'AirDrop', ar: 'AirDrop' },
  0x07: { en: 'AirPods / Beats (pairing)', ar: 'سماعات AirPods أو Beats' },
  0x09: { en: 'AirPlay target', ar: 'جهاز AirPlay' },
  0x0a: { en: 'AirPlay source', ar: 'مصدر AirPlay' },
  0x0c: { en: 'Handoff', ar: 'Handoff (جهاز Apple مستخدم)' },
  0x0d: { en: 'Wi-Fi settings sharing', ar: 'مشاركة إعدادات Wi-Fi' },
  0x0e: { en: 'Instant Hotspot', ar: 'نقطة اتصال فورية' },
  0x0f: { en: 'Nearby Action', ar: 'إجراء قريب (إعداد جهاز)' },
  0x10: { en: 'Nearby Info (iPhone, iPad, Mac or Watch)', ar: 'جهاز Apple قريب (iPhone أو iPad أو Mac أو ساعة)' },
  0x12: { en: 'Find My network (separated from owner)', ar: 'شبكة Find My (جهاز بعيد عن صاحبه)' },
  0x16: { en: 'Find My (nearby owner)', ar: 'شبكة Find My (قرب صاحبه)' },
}

export function appleKind(r) {
  const m = (r.mfg || []).find((x) => x.companyId === 0x004c)
  if (!m) return null
  const h = hexOnly(m.dataHex)
  if (h.length < 2) return null
  const type = parseInt(h.slice(0, 2), 16)
  const k = APPLE_TYPES[type]
  return k ? { type, ...k, findMySeparated: type === 0x12 } : null
}

// ---------- class knowledge ----------
// risk: base weight 0..40, used by riskScore. Text explains in plain words.
export const CLASS_INFO = {
  FINDER: { risk: 34, en: { what: 'A Bluetooth tracker tag such as AirTag, Tile or SmartTag.', why: 'Usually attached to keys or bags. If an unknown tag keeps moving with you, someone may be tracking you.', check: 'Walk somewhere else and rescan. Check bags, coat pockets, the car boot, under seats and the wheel arches.' }, ar: { what: 'علامة تتبّع بلوتوث مثل AirTag أو Tile أو SmartTag.', why: 'تُعلَّق عادة بالمفاتيح أو الحقائب. إذا ظلت علامة مجهولة تتحرك معك، فقد يكون أحد يتتبعك.', check: 'انتقل لمكان آخر وأعد الفحص. افحص الحقائب والجيوب وصندوق السيارة وتحت المقاعد وحول العجلات.' } },
  BEACON: { risk: 6, en: { what: 'A retail or indoor-location beacon.', why: 'Shops and venues use these for indoor maps and promotions.', check: 'Normal in malls and stores. No action needed.' }, ar: { what: 'منارة تجارية أو لتحديد الموقع داخل المباني.', why: 'تستخدمها المتاجر والمرافق للخرائط الداخلية والعروض.', check: 'طبيعية في المجمعات والمتاجر. لا يلزم أي إجراء.' } },
  SIGNAGE: { risk: 4, en: { what: 'A digital sign or electronic shelf label.', why: 'Common in shops.', check: 'No action needed.' }, ar: { what: 'لوحة رقمية أو بطاقة سعر إلكترونية.', why: 'شائعة في المتاجر.', check: 'لا يلزم أي إجراء.' } },
  WEARABLE: { risk: 14, en: { what: 'A wearable: watch, band, ring, or a recording pendant.', why: 'Most are fitness devices. Some pendants record conversations.', check: 'If the name suggests a recorder (pendant, note-taker), look around for someone wearing one.' }, ar: { what: 'جهاز قابل للارتداء: ساعة أو سوار أو خاتم أو قلادة تسجيل.', why: 'معظمها أجهزة لياقة. بعض القلائد تسجّل المحادثات.', check: 'إذا كان الاسم يدل على جهاز تسجيل (قلادة أو مدوّن ملاحظات)، فانتبه لمن يرتدي واحداً حولك.' } },
  SURVEILLANCE: { risk: 22, en: { what: 'A surveillance camera or plate-reader system.', why: 'Fixed cameras on buildings, poles and parking lots.', check: 'Usually fixed infrastructure. In a private room it deserves a closer look.' }, ar: { what: 'كاميرا مراقبة أو نظام قراءة لوحات.', why: 'كاميرات ثابتة على المباني والأعمدة والمواقف.', check: 'غالباً بنية تحتية ثابتة. لكن وجودها داخل غرفة خاصة يستحق الفحص.' } },
  DRONE: { risk: 24, en: { what: 'A drone or its controller.', why: 'Remote ID broadcasts the drone serial and sometimes its position.', check: 'Look up. The decoded fields may include the serial and type.' }, ar: { what: 'طائرة مسيّرة أو جهاز التحكم بها.', why: 'إشارة Remote ID تبث الرقم التسلسلي للطائرة وأحياناً موقعها.', check: 'انظر للأعلى. قد تتضمن الحقول المفكوكة الرقم التسلسلي ونوع الطائرة.' } },
  HACKING: { risk: 36, en: { what: 'A penetration-testing or hacking gadget (Flipper, Pineapple, ESP32 tools).', why: 'Hobbyists carry these, but they can also spoof networks or spam pairing popups.', check: 'Do not join unknown Wi-Fi networks. Ignore surprise pairing requests.' }, ar: { what: 'أداة اختبار اختراق (Flipper أو Pineapple أو أدوات ESP32).', why: 'يحملها الهواة، لكنها قد تنتحل شبكات أو ترسل طلبات اقتران مزعجة.', check: 'لا تتصل بشبكات Wi-Fi مجهولة، وتجاهل طلبات الاقتران المفاجئة.' } },
  BODYWORN: { risk: 18, en: { what: 'A body-worn camera.', why: 'Used by security and police.', check: 'Usually visible on a uniform.' }, ar: { what: 'كاميرا محمولة على الجسم.', why: 'يستخدمها الأمن والشرطة.', check: 'تكون ظاهرة غالباً على الزي.' } },
  LAW_ENFORCEMENT: { risk: 16, en: { what: 'Public-safety equipment (vehicle routers, body cameras).', why: 'Police, ambulance and municipal fleets use these.', check: 'Usually a nearby service vehicle.' }, ar: { what: 'معدات السلامة العامة (موجّهات المركبات وكاميرات الجسم).', why: 'تستخدمها الشرطة والإسعاف والأساطيل البلدية.', check: 'غالباً مركبة خدمة قريبة.' } },
  VEHICLE: { risk: 8, en: { what: 'A car system: infotainment, tyre sensors, hotspot.', why: 'Every modern car advertises something.', check: 'Normal on streets and in parking lots.' }, ar: { what: 'نظام سيارة: الترفيه أو حساسات الإطارات أو نقطة اتصال.', why: 'كل سيارة حديثة تبث شيئاً.', check: 'طبيعي في الشوارع والمواقف.' } },
  GLASSES: { risk: 30, en: { what: 'Smart glasses that can have a camera (e.g. Ray-Ban Meta).', why: 'They can photograph or record video discreetly.', check: 'Look for someone wearing thick-framed glasses, especially in private settings.' }, ar: { what: 'نظارات ذكية قد تحتوي كاميرا (مثل Ray-Ban Meta).', why: 'يمكنها التصوير أو تسجيل الفيديو بشكل خفي.', check: 'انتبه لمن يرتدي نظارة بإطار سميك، خصوصاً في الأماكن الخاصة.' } },
  AUDIO: { risk: 4, en: { what: 'Headphones or a speaker.', why: 'Everyday audio gear.', check: 'No action needed.' }, ar: { what: 'سماعات أو مكبر صوت.', why: 'أجهزة صوت يومية.', check: 'لا يلزم أي إجراء.' } },
  CAMERA: { risk: 20, en: { what: 'A consumer camera (action cam, home camera).', why: 'Home cameras record video. In a rental or hotel room they deserve attention.', check: 'Check smoke detectors, clocks, chargers and vents facing the bed or shower.' }, ar: { what: 'كاميرا استهلاكية (كاميرا حركة أو كاميرا منزلية).', why: 'الكاميرات المنزلية تسجّل الفيديو، ووجودها في شقة إيجار أو فندق يستحق الانتباه.', check: 'افحص كواشف الدخان والساعات والشواحن والفتحات المواجهة للسرير أو الحمّام.' } },
  THERMOSTAT: { risk: 3, en: { what: 'A smart thermostat.', why: 'Home climate control.', check: 'No action needed.' }, ar: { what: 'منظم حرارة ذكي.', why: 'للتحكم بتكييف المنزل.', check: 'لا يلزم أي إجراء.' } },
  LOCK: { risk: 6, en: { what: 'A smart lock or access-control reader.', why: 'Doors and gates.', check: 'No action needed.' }, ar: { what: 'قفل ذكي أو قارئ دخول.', why: 'للأبواب والبوابات.', check: 'لا يلزم أي إجراء.' } },
  HEALTH: { risk: 3, en: { what: 'A medical device (glucose monitor, blood pressure).', why: 'Personal health equipment.', check: 'No action needed. Respect the owner’s privacy.' }, ar: { what: 'جهاز طبي (مراقب سكر أو ضغط).', why: 'معدات صحية شخصية.', check: 'لا يلزم أي إجراء. احترم خصوصية صاحبه.' } },
  HOME: { risk: 5, en: { what: 'A smart-home device.', why: 'Speakers, plugs, appliances.', check: 'Normal in homes and offices.' }, ar: { what: 'جهاز منزل ذكي.', why: 'مكبرات وقوابس وأجهزة منزلية.', check: 'طبيعي في البيوت والمكاتب.' } },
  ISP: { risk: 2, en: { what: 'A router or access point.', why: 'Wi-Fi networks around you.', check: 'Avoid joining open or unknown networks.' }, ar: { what: 'موجّه أو نقطة وصول.', why: 'شبكات Wi-Fi من حولك.', check: 'تجنّب الاتصال بالشبكات المفتوحة أو المجهولة.' } },
  MESH: { risk: 6, en: { what: 'An off-grid mesh radio (Meshtastic, goTenna).', why: 'Hikers and hobbyists use them to text without a network.', check: 'Usually harmless.' }, ar: { what: 'جهاز شبكة Mesh بدون إنترنت (Meshtastic أو goTenna).', why: 'يستخدمه الرحّالة والهواة للمراسلة دون شبكة.', check: 'غير ضار غالباً.' } },
  PHONE: { risk: 3, en: { what: 'A phone, tablet or computer.', why: 'Everyone carries one.', check: 'No action needed.' }, ar: { what: 'هاتف أو جهاز لوحي أو حاسوب.', why: 'الجميع يحمل واحداً.', check: 'لا يلزم أي إجراء.' } },
  OTHER: { risk: 5, en: { what: 'A device the catalog recognises but does not classify.', why: '', check: 'Look at the signature notes for details.' }, ar: { what: 'جهاز يعرفه الكتالوج لكن دون تصنيف محدد.', why: '', check: 'راجع ملاحظات البصمة للتفاصيل.' } },
}

/** One-paragraph plain-language explanation of a radio. */
export function explainPlain(r, engine) {
  const lang = engine.settings.lang
  const L = (o) => o[lang] || o.en
  const apple = appleKind(r)
  if (apple?.findMySeparated) {
    return lang === 'ar'
      ? 'جهاز من شبكة Find My من Apple (مثل AirTag) بعيد عن صاحبه. إذا لم يكن لك وظهر في أكثر من مكان معك، فتحقق منه.'
      : 'An Apple Find My accessory (such as an AirTag) away from its owner. If it is not yours and it appears in several places with you, check for it.'
  }
  if (r.cls && CLASS_INFO[r.cls]) {
    const c = L(CLASS_INFO[r.cls])
    return [c.what, c.why].filter(Boolean).join(' ')
  }
  if (apple) return lang === 'ar' ? `إعلان Apple: ${apple.ar}.` : `Apple advertisement: ${apple.en}.`
  if (r.kind === 'WIFI') return lang === 'ar' ? 'شبكة Wi-Fi أو نقطة وصول لا يعرفها الكتالوج.' : 'A Wi-Fi network or access point the catalog does not recognise.'
  return lang === 'ar' ? 'جهاز بلوتوث لا يعرفه الكتالوج. معظم هذه هواتف وسماعات وأجهزة يومية.' : 'A Bluetooth device the catalog does not recognise. Most of these are phones, earbuds and everyday gadgets.'
}

// ---------- identity linking across address rotation ----------
/** A stable "shape" of an advertisement that survives MAC rotation. */
export function linkSig(r) {
  if (r.kind !== 'BLE') return null
  const m = (r.mfg || [])[0]
  const s = (r.svcData || [])[0]
  const parts = []
  if (m) parts.push('m' + m.companyId + ':' + hexOnly(m.dataHex).slice(0, 4) + ':' + Math.round(hexOnly(m.dataHex).length / 2))
  if (s) parts.push('s' + hexOnly(s.uuid).slice(-4) + ':' + Math.round(hexOnly(s.dataHex).length / 2))
  if ((r.uuids || []).length) parts.push('u' + r.uuids.map((u) => hexOnly(u).slice(-4)).sort().join(','))
  if (r.name) parts.push('n' + r.name)
  return parts.length ? parts.join('|') : null
}

/** Stable identity used by place memory: factory MAC for fixed radios, ad shape for rotating ones. */
export function stableId(r) {
  if (!r.randomized || r.kind === 'WIFI') return r.key
  return linkSig(r) || r.key
}

// ---------- places ----------
export function placeAt(places, pos) {
  if (!pos) return null
  let best = null
  for (const p of places) {
    if (p.lat == null) continue
    const d = distM(p, pos)
    if (d <= (p.radius || 150) && (!best || d < best.d)) best = { p, d }
  }
  return best?.p || null
}

// ---------- risk ----------
/**
 * 0..100 risk score with the reasons that produced it.
 * ctx: { engine, place, now }
 */
export function riskScore(r, ctx) {
  const { engine, place } = ctx
  const now = ctx.now || Date.now()
  const reasons = []
  if (engine.isMine(r)) return { score: 0, reasons: [{ k: 'mine', w: 0 }] }
  let s = 0
  const base = r.cls ? CLASS_INFO[r.cls]?.risk ?? 5 : 2
  s += base
  if (r.cls) reasons.push({ k: 'class', w: base })
  if (r.attention) { s += 14; reasons.push({ k: 'attention', w: 14 }) }
  const apple = appleKind(r)
  if (apple?.findMySeparated) { s += 26; reasons.push({ k: 'findmy', w: 26 }) }
  if (engine.coTravel(r)) { s += 34; reasons.push({ k: 'cotravel', w: 34 }) }
  const dur = (r.lastSeen - (r.linkedFirstSeen || r.firstSeen)) / 60000
  if (dur > 10) { const w = Math.min(10, Math.round(dur / 6)); s += w; reasons.push({ k: 'persistent', w }) }
  if (r.rssi > -55) { s += 6; reasons.push({ k: 'close', w: 6 }) }
  if (r.linkedFrom) { s += 6; reasons.push({ k: 'rotating', w: 6 }) }
  if (place) {
    const known = place.known?.[stableId(r)]
    if (known) { s -= 30; reasons.push({ k: 'known', w: -30 }) } else if (place.learnedAt && r.firstSeen > place.learnedAt) { s += 8; reasons.push({ k: 'new', w: 8 }) }
  }
  const hour = new Date(now).getHours()
  if (r.anomaly) { s += 10; reasons.push({ k: 'anomaly', w: 10 }) }
  if (hour >= 0 && hour < 5 && r.cls && base >= 20) { s += 4; reasons.push({ k: 'night', w: 4 }) }
  return { score: Math.max(0, Math.min(100, Math.round(s))), reasons }
}

export const RISK_TEXT = {
  class: { en: 'Device type', ar: 'نوع الجهاز' },
  attention: { en: 'Flagged in the catalog', ar: 'مُعلَّم في الكتالوج' },
  findmy: { en: 'Find My tag away from its owner', ar: 'علامة Find My بعيدة عن صاحبها' },
  cotravel: { en: 'Moving with you', ar: 'يتحرك معك' },
  persistent: { en: 'Present for a long time', ar: 'موجود منذ مدة طويلة' },
  close: { en: 'Very close', ar: 'قريب جداً' },
  rotating: { en: 'Changes its address', ar: 'يغيّر عنوانه' },
  known: { en: 'Normal for this place', ar: 'معتاد في هذا المكان' },
  new: { en: 'New at this place', ar: 'جديد في هذا المكان' },
  anomaly: { en: 'Unusual for this place', ar: 'غير معتاد في هذا المكان' },
  night: { en: 'Late at night', ar: 'في وقت متأخر من الليل' },
  mine: { en: 'Marked as yours', ar: 'مُعلَّم كجهازك' },
}

export function riskLevel(score) {
  return score >= 60 ? 'high' : score >= 30 ? 'medium' : 'low'
}

// ---------- distance bands ----------
export function distanceBand(rssi) {
  if (rssi >= -50) return { k: 'touch', en: 'Within about 1 m', ar: 'في حدود متر تقريباً' }
  if (rssi >= -65) return { k: 'room', en: 'Same room', ar: 'في نفس الغرفة' }
  if (rssi >= -80) return { k: 'near', en: 'Nearby (next room or a few metres)', ar: 'قريب (غرفة مجاورة أو أمتار قليلة)' }
  return { k: 'far', en: 'Far or behind walls', ar: 'بعيد أو خلف جدران' }
}

// ---------- scenarios ----------
export const SCENARIOS = {
  quick: { icon: 'radar', duration: 30, classes: null, en: { name: 'Quick check', desc: 'Scan around you for 30 seconds.' }, ar: { name: 'فحص سريع', desc: 'افحص ما حولك خلال 30 ثانية.' } },
  car: { icon: 'car', duration: 45, classes: ['FINDER', 'HACKING', 'CAMERA', 'WEARABLE'], en: { name: 'Check my car', desc: 'Look for hidden trackers. Scan inside the car with the engine off, then walk around it.' }, ar: { name: 'فحص السيارة', desc: 'ابحث عن أجهزة تتبّع مخفية. افحص داخل السيارة والمحرك مطفأ، ثم امشِ حولها.' } },
  room: { icon: 'home', duration: 60, classes: ['CAMERA', 'SURVEILLANCE', 'GLASSES', 'WEARABLE', 'HOME', 'FINDER'], en: { name: 'Hotel or rental room', desc: 'Look for cameras and recorders. Walk slowly through every room.' }, ar: { name: 'غرفة فندق أو شقة', desc: 'ابحث عن الكاميرات وأجهزة التسجيل. امشِ ببطء في كل الغرف.' } },
  followed: { icon: 'user', duration: 0, classes: ['FINDER', 'WEARABLE', 'PHONE', 'GLASSES'], en: { name: 'Is someone following me?', desc: 'Keeps watching while you move. Alerts if the same device shows up in several places.' }, ar: { name: 'هل أحد يلاحقني؟', desc: 'يراقب باستمرار أثناء تنقلك، وينبهك إذا ظهر الجهاز نفسه في عدة أماكن.' } },
  meeting: { icon: 'shield', duration: 60, classes: ['GLASSES', 'WEARABLE', 'HACKING', 'CAMERA', 'FINDER'], en: { name: 'Before a private meeting', desc: 'Look for recorders, smart glasses and hacking gear in the room.' }, ar: { name: 'قبل اجتماع خاص', desc: 'ابحث عن أجهزة التسجيل والنظارات الذكية وأدوات الاختراق في القاعة.' } },
}

/** Ordered guidance steps for a finding. */
export function guidance(r, engine) {
  const ar = engine.settings.lang === 'ar'
  const steps = []
  const apple = appleKind(r)
  const tracker = r.cls === 'FINDER' || apple?.findMySeparated
  if (tracker) {
    steps.push(ar ? 'تأكد أنه ليس لك أو لأحد معك (مفاتيح، حقيبة، سيارة العائلة).' : 'Make sure it is not yours or a companion’s (keys, bag, family car).')
    steps.push(ar ? 'تحرك 100 متر على الأقل وأعد الفحص. إذا بقي معك فهذه علامة مهمة.' : 'Move at least 100 m and rescan. If it is still with you, that matters.')
    steps.push(ar ? 'استخدم وضع «تعقّب» للعثور عليه: الإشارة تقوى كلما اقتربت.' : 'Use Hunt to find it: the signal grows stronger as you get closer.')
    steps.push(ar ? 'إذا وجدت جهاز تتبّع لا تعرفه، لا تتلفه. صوّره وبلّغ الجهات المختصة.' : 'If you find an unknown tracker, do not destroy it. Photograph it and report it to the authorities.')
  } else if (['CAMERA', 'SURVEILLANCE', 'GLASSES'].includes(r.cls)) {
    steps.push(ar ? 'استخدم «تعقّب» وامشِ ببطء لتحديد الاتجاه الأقوى.' : 'Use Hunt and walk slowly to find the strongest direction.')
    steps.push(ar ? 'افحص الأماكن المعتادة لإخفاء الكاميرات: كواشف الدخان والساعات والشواحن والمرايا.' : 'Check common hiding spots: smoke detectors, clocks, chargers and mirrors.')
    steps.push(ar ? 'أطفئ الأنوار وابحث بكشاف الهاتف عن انعكاس عدسة.' : 'Turn off the lights and look for a lens reflection with your phone torch.')
  } else if (r.cls === 'HACKING') {
    steps.push(ar ? 'لا تتصل بأي شبكة Wi-Fi مفتوحة أو مجهولة الآن.' : 'Do not join any open or unknown Wi-Fi now.')
    steps.push(ar ? 'ارفض أي طلب اقتران بلوتوث لم تطلبه.' : 'Decline any Bluetooth pairing request you did not start.')
  } else {
    steps.push(ar ? 'غالباً جهاز عادي. راقبه فقط إذا استمر بالظهور معك.' : 'Probably an everyday device. Keep an eye on it only if it keeps showing up with you.')
  }
  return steps
}

// ---------- generative place fingerprint ----------
export function fingerprintSeeds(radios) {
  return radios.map((r) => {
    let h = 2166136261
    for (const ch of r.key) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
    return { h: h >>> 0, rssi: r.rssi, cls: r.cls, kind: r.kind }
  }).sort((a, b) => a.h - b.h)
}
