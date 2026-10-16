// Offline-first cache. The build fills in BUILD_ID and PRECACHE (vite.config.js),
// so the whole app — including lazy chunks like the map and the Claude SDK — is
// cached on install and the app starts offline after the first visit. Each build
// gets its own cache; activating a new one deletes the old.
// - HTML: network first, cached copy when offline.
// - data/*.json (catalog, vendor DB): stale-while-revalidate.
// - everything else: cache first.
const BUILD_ID = '__BUILD_ID__'
const PRECACHE = [/* __PRECACHE__ */]
const CACHE = 'fieldwatch-web-' + BUILD_ID
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com']

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', ...PRECACHE])).then(() => self.skipWaiting()))
})
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()))
})
self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((res) => {
      // Clone before handing the response to the page; only keep good pages.
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('./index.html', copy)) }
      return res
    }).catch(() => caches.match('./index.html')))
    return
  }
  if (url.origin === location.origin && url.pathname.includes('/data/')) {
    e.respondWith(caches.open(CACHE).then((c) => c.match(req).then((hit) => {
      const fresh = fetch(req, { cache: 'no-cache' }).then((res) => { if (res.ok) c.put(req, res.clone()); return res })
      if (hit) { e.waitUntil(fresh.catch(() => null)); return hit }
      return fresh
    })))
    return
  }
  const sameOrigin = url.origin === location.origin
  const font = FONT_HOSTS.includes(url.host)
  if (!sameOrigin && !font) return
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
    // Google Fonts' stylesheet comes back opaque (no-cors); cache it anyway so text renders offline.
    if (res.ok || (font && res.type === 'opaque')) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)) }
    return res
  })))
})
