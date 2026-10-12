// Gulf ISP pack for the web build. These rows match default Wi-Fi network names
// that carriers in Saudi Arabia ship on their home routers. They are name-only
// pattern matches: a renamed router will not match, and anyone can use these names.
const rule = (text) => ({ kind: 'NAME_GLOB', text, companyId: 0, dataPrefixHex: '', radio: 'WIFI', enabled: true })
const base = { enabled: true, matchAny: true, colorIndex: 6, minPeers: 0, peerWindowSec: 60, clusterByOui: false, sequentialMac: false, attentionNote: '', builtIn: true, kind: 'ISP' }

export const GULF_FLEETS = [
  { ...base, id: 'gulf-stc', name: 'STC home router', rules: [rule('STC_WiFi*'), rule('STC-WiFi*'), rule('STC_*')], notes: 'Default network name on stc home and fibre routers. Name-only match: a renamed router will not match, and any device can use this name.' },
  { ...base, id: 'gulf-mobily', name: 'Mobily router', rules: [rule('Mobily*'), rule('MobilyFiber*')], notes: 'Default network name on Mobily home, fibre and mobile routers. Name-only match.' },
  { ...base, id: 'gulf-zain', name: 'Zain router', rules: [rule('Zain*'), rule('ZAIN*')], notes: 'Default network name on Zain home and mobile routers. Name-only match.' },
]
