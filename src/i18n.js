// Bilingual strings (English / Arabic). Catalog prose (signature names and notes)
// stays as published in the stock catalog, matching the original app's policy:
// it is data, not app chrome.

export const CLASSES = [
  'FINDER', 'BEACON', 'SIGNAGE', 'WEARABLE', 'SURVEILLANCE', 'DRONE', 'HACKING',
  'LAW_ENFORCEMENT', 'VEHICLE', 'GLASSES', 'AUDIO', 'CAMERA', 'THERMOSTAT', 'LOCK',
  'HEALTH', 'HOME', 'ISP', 'MESH', 'PHONE', 'OTHER',
]

const classLabels = {
  en: {
    FINDER: 'Finder tags', BEACON: 'Retail beacons', SIGNAGE: 'Signage', WEARABLE: 'Wearables',
    SURVEILLANCE: 'Surveillance', DRONE: 'Drones', HACKING: 'Pentest', BODYWORN: 'Wearables',
    LAW_ENFORCEMENT: 'Public safety', VEHICLE: 'Vehicle', GLASSES: 'Glasses', AUDIO: 'Audio',
    CAMERA: 'Cameras', THERMOSTAT: 'Thermostats', LOCK: 'Access control', HEALTH: 'Health',
    HOME: 'Home IoT', ISP: 'ISP / routers', MESH: 'Mesh', PHONE: 'Phones / PCs', OTHER: 'Other',
  },
  ar: {
    FINDER: 'أجهزة التتبّع', BEACON: 'منارات تجارية', SIGNAGE: 'لافتات رقمية', WEARABLE: 'أجهزة قابلة للارتداء',
    SURVEILLANCE: 'مراقبة', DRONE: 'طائرات مسيّرة', HACKING: 'أدوات اختبار الاختراق', BODYWORN: 'أجهزة قابلة للارتداء',
    LAW_ENFORCEMENT: 'السلامة العامة', VEHICLE: 'مركبات', GLASSES: 'نظارات ذكية', AUDIO: 'صوتيات',
    CAMERA: 'كاميرات', THERMOSTAT: 'منظمات حرارة', LOCK: 'التحكم بالدخول', HEALTH: 'صحة',
    HOME: 'إنترنت الأشياء المنزلي', ISP: 'مزودو الخدمة / موجّهات', MESH: 'شبكات Mesh', PHONE: 'هواتف / حواسيب', OTHER: 'أخرى',
  },
}

const en = {
  appName: 'Fieldwatch',
  unofficial: 'Unofficial web port',
  tagline: 'Passive Wi-Fi & Bluetooth LE field watcher',
  // tabs
  tabLive: 'Live', tabHunt: 'Hunt', tabSignatures: 'Signatures', tabReports: 'Reports', tabSettings: 'Settings',
  // scanning
  start: 'Start', stop: 'Stop', scanning: 'Scanning', stopped: 'Stopped', paused: 'Paused',
  source: 'Source', sourceDemo: 'Field simulator', sourceBle: 'Web Bluetooth scan', sourceReplay: 'Log replay',
  sourceDemoHint: 'Realistic synthetic radios drawn from the real signature catalog. Nothing is transmitted.',
  sourceBleHint: 'Real BLE advertisements via the browser. Needs Chrome with Web Bluetooth scanning enabled.',
  sourceReplayHint: 'Replay a Fieldwatch log (CSV or JSONL) exported from the Android app or this page.',
  bleUnsupported: 'This browser does not expose BLE scanning. Try Chrome on Android/desktop with chrome://flags/#enable-experimental-web-platform-features.',
  bleDenied: 'Bluetooth scan was refused or cancelled.',
  replayLoaded: 'Loaded {n} log rows',
  pickLog: 'Choose log file',
  // live
  radios: 'Radios', matched: 'Matched', attention: 'Extra attention', wifi: 'Wi-Fi', ble: 'BLE',
  noRadios: 'No radios yet. Press Start to begin listening.',
  noMatchFilters: 'Radios are being heard, but filters hide all of them.',
  view: 'View', viewList: 'Strength list', viewRadar: 'Radar', viewClass: 'By class', viewTimeline: 'Timeline',
  sort: 'Sort', sortStrength: 'Strength', sortNewest: 'Newest', sortFirst: 'First seen', sortName: 'Name', sortSig: 'Signatures',
  search: 'Search name, MAC, vendor, signature…',
  filters: 'Filters', clearFilters: 'Clear filters',
  unknown: '(no name)', hidden: '(hidden network)', randomized: 'Randomized', factory: 'Factory address',
  seen: 'Seen', firstSeen: 'First seen', lastSeen: 'Last seen', count: 'Packets', channel: 'Channel', security: 'Security',
  vendor: 'Vendor', company: 'Company', services: 'Services', mfgData: 'Manufacturer data', rssi: 'Signal',
  ago: '{n}s ago', justNow: 'just now',
  mine: 'Mine', markMine: 'Mark as mine', alertOn: 'Alert on this radio', customName: 'Custom name', notes: 'Observer notes',
  hunt: 'Hunt', share: 'Copy as text', copied: 'Copied', createSignature: 'Create signature from this radio',
  signatureNotes: 'Signature notes', why: 'Why it matched', noSignature: 'No signature matched. Vendor lookup only.',
  decoded: 'Decoded fields', movingWithYou: 'Moving with you', trend: 'Trend', avg: 'Average',
  close: 'Close', back: 'Back', save: 'Save', cancel: 'Cancel', delete: 'Delete', edit: 'Edit', add: 'Add', apply: 'Apply',
  // filters
  fRadio: 'Radio type', fBoth: 'Both', fMinRssi: 'Minimum signal', fOnlyMatched: 'Only matched radios',
  fOnlyAttention: 'Only extra attention', fHideMine: 'Hide my radios', fHideRandom: 'Hide randomized BLE',
  fClasses: 'Classes', all: 'All', none: 'None', fPresets: 'Presets', savePreset: 'Save current as preset', presetName: 'Preset name',
  fMaxAge: 'Hide radios not heard for', seconds: 'seconds',
  // hunt
  huntPick: 'Pick a radio from Live (tap → Hunt) or below.',
  huntHotter: 'Warmer', huntColder: 'Colder', huntSteady: 'Steady', huntLost: 'Not heard',
  huntTone: 'Geiger tone', huntPeak: 'Peak',
  huntTip: 'Move slowly, rotate your body to shield the phone, and watch the trend. Signal strength is not distance.',
  // signatures
  sigCount: '{n} signatures · {r} rules', catalog: 'Catalog', enabled: 'Enabled', bookmarked: 'Watchlist',
  rules: 'Rules', ruleKind: 'Rule', newSignature: 'New signature', importSigs: 'Import signatures', exportSigs: 'Export signatures',
  resetCatalog: 'Reset to stock catalog', builtIn: 'Stock', custom: 'Custom', class: 'Class', name: 'Name',
  matchAny: 'Match any rule', matchAll: 'Match all rules', attentionNote: 'Extra attention note', sigNotes: 'Notes',
  enableAll: 'Enable all', disableAll: 'Disable all', liveHits: 'Live hits', imported: 'Imported {n} signatures',
  importFailed: 'Import failed: {e}', confirmReset: 'Replace all signatures with the stock catalog?',
  // reports
  sits: 'Sits', sit: 'Sit', startSit: 'Start a sit', endSit: 'End sit', sitRunning: 'Sit running', sitNone: 'No sits recorded yet.',
  sitHint: 'A sit records everything heard while it runs: radios, signatures, and (optionally) where this device was.',
  debrief: 'Debrief', compare: 'Compare', duration: 'Duration', points: 'GPS points', path: 'Path',
  exportCsv: 'CSV', exportJson: 'JSON', exportGpx: 'GPX', exportKml: 'KML', exportWigle: 'WiGLE CSV', printPdf: 'Print / PDF',
  byClass: 'By class', byChannel: 'By channel', topSignatures: 'Top signatures', coTravel: 'Possible co-travel',
  coTravelHint: 'Heard at several places more than {m} m apart during this sit. A hypothesis, not proof.',
  newInB: 'New in B', goneInB: 'Gone in B', inBoth: 'In both', pickTwo: 'Pick two sits to compare',
  log: 'Log', logRows: '{n} rows in log', exportLog: 'Export log', clearLog: 'Clear log', aiExport: 'AI export (prompt)',
  aiExportHint: 'Builds a plain-text summary you can paste into an assistant. Review it before sharing.',
  noGps: 'No GPS fix', sitName: 'Sit name', deleteSit: 'Delete sit',
  // alerts
  alertTitle: 'Watchlist hit', alertBody: '{sig} — {name} at {rssi} dBm',
  floodTitle: 'Possible flood', floodBody: '{n} new addresses in a few seconds at about the same loudness. Could be a store full of tags, or one radio rotating its address.',
  continue: 'Continue', hideThese: 'Hide these',
  // settings
  language: 'Language', theme: 'Theme', themeSystem: 'System', themeLight: 'Light', themeDark: 'Dark', themeNight: 'Night (red)',
  privacy: 'Privacy mode', privacyHint: 'Mask MAC tails and coordinates on screen and in reports.',
  alerts: 'Alerts', sound: 'Sound', vibrate: 'Vibrate', voice: 'Voice', notify: 'System notification', alertCooldown: 'Repeat alert after',
  location: 'Tag sightings with location', locationHint: 'Location is this device at hear-time — never the other radio.',
  scanIntensity: 'Simulator density', saver: 'Saver', balanced: 'Balanced', performance: 'Busy street',
  floodDetect: 'Flood detection', exportSettings: 'Export settings', importSettings: 'Import settings',
  diagnostics: 'Diagnostics', about: 'About', resetAll: 'Reset everything', confirmResetAll: 'Erase settings, sits, log, and custom signatures?',
  install: 'Install app', installed: 'Installed', offlineReady: 'Works offline',
  disclaimerTitle: 'Before you start',
  disclaimer: 'Fieldwatch only listens. There is no guarantee that trackers, cameras, tags or any device will be found or named. Signature matches, co-travel and debrief language are hypotheses — not identity and not a legal finding. You are responsible for how you use it and for complying with local law.',
  disclaimerPort: 'This is an unofficial, community web port of the MIT-licensed Fieldwatch Android app by Off Grid Pete LLC. It is not made or reviewed by Off Grid Pete LLC. Browsers cannot see Wi-Fi networks; the simulator and log replay fill that gap.',
  accept: 'I understand',
  tourLive: 'Live lists every radio heard. Tap one for detail, hunt or a new signature.',
  version: 'Version', catalogVersion: 'Catalog', supported: 'Supported', notSupported: 'Not supported',
  dbm: 'dBm', km: 'km', m: 'm',
  hit: 'hit', hits: 'hits', total: 'Total', unique: 'Unique', none_: '—',
  original: 'Original Android app on GitHub',
  quickStats: 'At a glance', strongest: 'Strongest', newest: 'Newest',
  welcome: 'Welcome',
  speakHit: '{sig} nearby',
  tapConfirm: 'Tap again to confirm',
  downloadUnavailable: '{ext} files cannot be saved from this preview. Use the Netlify build.',
}

const ar = {
  appName: 'فيلدواتش',
  unofficial: 'نسخة ويب غير رسمية',
  tagline: 'مراقب ميداني سلبي لشبكات Wi-Fi وبلوتوث منخفض الطاقة',
  tabLive: 'مباشر', tabHunt: 'تعقّب', tabSignatures: 'البصمات', tabReports: 'التقارير', tabSettings: 'الإعدادات',
  start: 'ابدأ', stop: 'إيقاف', scanning: 'جارٍ المسح', stopped: 'متوقف', paused: 'موقوف مؤقتاً',
  source: 'المصدر', sourceDemo: 'محاكي ميداني', sourceBle: 'مسح Web Bluetooth', sourceReplay: 'إعادة تشغيل سجل',
  sourceDemoHint: 'أجهزة افتراضية واقعية مأخوذة من كتالوج البصمات الحقيقي. لا يُرسَل أي شيء.',
  sourceBleHint: 'إعلانات BLE حقيقية عبر المتصفح. يتطلب Chrome مع تفعيل مسح Web Bluetooth.',
  sourceReplayHint: 'أعد تشغيل سجل فيلدواتش (CSV أو JSONL) مُصدَّر من تطبيق أندرويد أو من هذه الصفحة.',
  bleUnsupported: 'هذا المتصفح لا يتيح مسح BLE. جرّب Chrome على أندرويد أو سطح المكتب مع تفعيل chrome://flags/#enable-experimental-web-platform-features.',
  bleDenied: 'تم رفض مسح البلوتوث أو إلغاؤه.',
  replayLoaded: 'تم تحميل {n} سطراً من السجل',
  pickLog: 'اختر ملف السجل',
  radios: 'الأجهزة', matched: 'مطابَقة', attention: 'انتباه إضافي', wifi: 'Wi-Fi', ble: 'BLE',
  noRadios: 'لا توجد أجهزة بعد. اضغط «ابدأ» لبدء الاستماع.',
  noMatchFilters: 'يتم التقاط أجهزة، لكن المرشّحات تخفيها جميعاً.',
  view: 'العرض', viewList: 'قائمة حسب القوة', viewRadar: 'رادار', viewClass: 'حسب الفئة', viewTimeline: 'خط زمني',
  sort: 'الترتيب', sortStrength: 'القوة', sortNewest: 'الأحدث', sortFirst: 'أول ظهور', sortName: 'الاسم', sortSig: 'البصمات',
  search: 'ابحث بالاسم أو MAC أو المصنّع أو البصمة…',
  filters: 'المرشّحات', clearFilters: 'مسح المرشّحات',
  unknown: '(بدون اسم)', hidden: '(شبكة مخفية)', randomized: 'عنوان عشوائي', factory: 'عنوان المصنع',
  seen: 'شوهد', firstSeen: 'أول ظهور', lastSeen: 'آخر ظهور', count: 'الحزم', channel: 'القناة', security: 'الحماية',
  vendor: 'المصنّع', company: 'الشركة', services: 'الخدمات', mfgData: 'بيانات المصنّع', rssi: 'الإشارة',
  ago: 'قبل {n} ث', justNow: 'الآن',
  mine: 'خاصتي', markMine: 'تمييز كجهازي', alertOn: 'تنبيه لهذا الجهاز', customName: 'اسم مخصص', notes: 'ملاحظات المراقب',
  hunt: 'تعقّب', share: 'نسخ كنص', copied: 'تم النسخ', createSignature: 'إنشاء بصمة من هذا الجهاز',
  signatureNotes: 'ملاحظات البصمة', why: 'سبب المطابقة', noSignature: 'لم تطابق أي بصمة. البحث عن المصنّع فقط.',
  decoded: 'حقول مفكوكة', movingWithYou: 'يتحرك معك', trend: 'الاتجاه', avg: 'المتوسط',
  close: 'إغلاق', back: 'رجوع', save: 'حفظ', cancel: 'إلغاء', delete: 'حذف', edit: 'تعديل', add: 'إضافة', apply: 'تطبيق',
  fRadio: 'نوع الراديو', fBoth: 'كلاهما', fMinRssi: 'أدنى قوة إشارة', fOnlyMatched: 'الأجهزة المطابَقة فقط',
  fOnlyAttention: 'الانتباه الإضافي فقط', fHideMine: 'إخفاء أجهزتي', fHideRandom: 'إخفاء BLE العشوائي',
  fClasses: 'الفئات', all: 'الكل', none: 'لا شيء', fPresets: 'إعدادات محفوظة', savePreset: 'حفظ الحالي كإعداد', presetName: 'اسم الإعداد',
  fMaxAge: 'إخفاء الأجهزة غير المسموعة منذ', seconds: 'ثانية',
  huntPick: 'اختر جهازاً من «مباشر» (اضغط ← تعقّب) أو من الأسفل.',
  huntHotter: 'أقرب', huntColder: 'أبعد', huntSteady: 'ثابت', huntLost: 'غير مسموع',
  huntTone: 'نغمة جايجر', huntPeak: 'الذروة',
  huntTip: 'تحرّك ببطء، واستدر بجسمك لحجب الهاتف، وراقب الاتجاه. قوة الإشارة ليست مسافة.',
  sigCount: '{n} بصمة · {r} قاعدة', catalog: 'الكتالوج', enabled: 'مفعّلة', bookmarked: 'قائمة المراقبة',
  rules: 'القواعد', ruleKind: 'القاعدة', newSignature: 'بصمة جديدة', importSigs: 'استيراد بصمات', exportSigs: 'تصدير البصمات',
  resetCatalog: 'استعادة الكتالوج الأصلي', builtIn: 'أصلية', custom: 'مخصصة', class: 'الفئة', name: 'الاسم',
  matchAny: 'مطابقة أي قاعدة', matchAll: 'مطابقة كل القواعد', attentionNote: 'ملاحظة انتباه إضافي', sigNotes: 'ملاحظات',
  enableAll: 'تفعيل الكل', disableAll: 'تعطيل الكل', liveHits: 'مطابقات مباشرة', imported: 'تم استيراد {n} بصمة',
  importFailed: 'فشل الاستيراد: {e}', confirmReset: 'استبدال جميع البصمات بالكتالوج الأصلي؟',
  sits: 'الجلسات', sit: 'جلسة', startSit: 'بدء جلسة', endSit: 'إنهاء الجلسة', sitRunning: 'جلسة قيد التشغيل', sitNone: 'لا توجد جلسات مسجلة بعد.',
  sitHint: 'تسجّل الجلسة كل ما يُسمع أثناءها: الأجهزة والبصمات و(اختيارياً) موقع هذا الجهاز.',
  debrief: 'ملخص', compare: 'مقارنة', duration: 'المدة', points: 'نقاط GPS', path: 'المسار',
  exportCsv: 'CSV', exportJson: 'JSON', exportGpx: 'GPX', exportKml: 'KML', exportWigle: 'WiGLE CSV', printPdf: 'طباعة / PDF',
  byClass: 'حسب الفئة', byChannel: 'حسب القناة', topSignatures: 'أكثر البصمات', coTravel: 'احتمال مرافقة',
  coTravelHint: 'سُمع في عدة أماكن تبعد أكثر من {m} م أثناء هذه الجلسة. فرضية وليست دليلاً.',
  newInB: 'جديد في ب', goneInB: 'اختفى في ب', inBoth: 'في كليهما', pickTwo: 'اختر جلستين للمقارنة',
  log: 'السجل', logRows: '{n} سطراً في السجل', exportLog: 'تصدير السجل', clearLog: 'مسح السجل', aiExport: 'تصدير للذكاء الاصطناعي',
  aiExportHint: 'يُنشئ ملخصاً نصياً يمكنك لصقه في مساعد ذكي. راجعه قبل المشاركة.',
  noGps: 'لا يوجد موقع GPS', sitName: 'اسم الجلسة', deleteSit: 'حذف الجلسة',
  alertTitle: 'تنبيه قائمة المراقبة', alertBody: '{sig} — {name} بقوة {rssi} dBm',
  floodTitle: 'احتمال إغراق', floodBody: '{n} عنواناً جديداً خلال ثوانٍ بنفس القوة تقريباً. قد يكون متجراً مليئاً بالعلامات، أو جهازاً واحداً يغيّر عنوانه.',
  continue: 'متابعة', hideThese: 'إخفاؤها',
  language: 'اللغة', theme: 'المظهر', themeSystem: 'حسب النظام', themeLight: 'فاتح', themeDark: 'داكن', themeNight: 'ليلي (أحمر)',
  privacy: 'وضع الخصوصية', privacyHint: 'إخفاء نهاية عناوين MAC والإحداثيات على الشاشة وفي التقارير.',
  alerts: 'التنبيهات', sound: 'صوت', vibrate: 'اهتزاز', voice: 'نطق صوتي', notify: 'إشعار النظام', alertCooldown: 'تكرار التنبيه بعد',
  location: 'إرفاق الموقع بالمشاهدات', locationHint: 'الموقع هو موقع هذا الجهاز لحظة الالتقاط — وليس موقع الجهاز الآخر.',
  scanIntensity: 'كثافة المحاكي', saver: 'هادئ', balanced: 'متوازن', performance: 'شارع مزدحم',
  floodDetect: 'كشف الإغراق', exportSettings: 'تصدير الإعدادات', importSettings: 'استيراد الإعدادات',
  diagnostics: 'التشخيص', about: 'حول', resetAll: 'إعادة ضبط كل شيء', confirmResetAll: 'مسح الإعدادات والجلسات والسجل والبصمات المخصصة؟',
  install: 'تثبيت التطبيق', installed: 'مثبّت', offlineReady: 'يعمل دون اتصال',
  disclaimerTitle: 'قبل أن تبدأ',
  disclaimer: 'فيلدواتش يستمع فقط. لا يوجد ضمان بالعثور على أجهزة التتبع أو الكاميرات أو أي جهاز آخر أو تسميته. مطابقات البصمات والمرافقة ولغة الملخص فرضيات — وليست هوية ولا حكماً قانونياً. أنت مسؤول عن طريقة استخدامه وعن الالتزام بالأنظمة المحلية.',
  disclaimerPort: 'هذه نسخة ويب مجتمعية غير رسمية من تطبيق فيلدواتش لأندرويد المرخّص بـ MIT من Off Grid Pete LLC، ولم تُصنع أو تُراجَع من قبلهم. المتصفحات لا ترى شبكات Wi-Fi؛ لذلك يسدّ المحاكي وإعادة تشغيل السجل هذه الفجوة.',
  accept: 'فهمت',
  tourLive: 'تعرض «مباشر» كل جهاز يُسمع. اضغط على أي جهاز للتفاصيل أو التعقّب أو إنشاء بصمة.',
  version: 'الإصدار', catalogVersion: 'الكتالوج', supported: 'مدعوم', notSupported: 'غير مدعوم',
  dbm: 'dBm', km: 'كم', m: 'م',
  hit: 'مطابقة', hits: 'مطابقات', total: 'الإجمالي', unique: 'فريد', none_: '—',
  original: 'تطبيق أندرويد الأصلي على GitHub',
  quickStats: 'نظرة سريعة', strongest: 'الأقوى', newest: 'الأحدث',
  welcome: 'مرحباً',
  speakHit: '{sig} بالقرب منك',
  tapConfirm: 'اضغط مجدداً للتأكيد',
  downloadUnavailable: 'لا يمكن حفظ ملفات {ext} من هذه المعاينة. استخدم نسخة Netlify.',
}

export const DICT = { en, ar }

export function makeT(lang) {
  const d = DICT[lang] || en
  const t = (key, vars) => {
    let s = d[key] ?? en[key] ?? key
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v))
    return s
  }
  t.cls = (c) => (classLabels[lang] || classLabels.en)[c] || classLabels.en.OTHER
  t.lang = lang
  t.dir = lang === 'ar' ? 'rtl' : 'ltr'
  t.num = (n, opts) => new Intl.NumberFormat(lang === 'ar' ? 'ar-SA-u-nu-latn' : 'en-US', opts).format(n)
  t.time = (ms) => new Date(ms).toLocaleTimeString(lang === 'ar' ? 'ar-SA-u-nu-latn' : 'en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  t.date = (ms) => new Date(ms).toLocaleString(lang === 'ar' ? 'ar-SA-u-nu-latn-ca-gregory' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' })
  return t
}
