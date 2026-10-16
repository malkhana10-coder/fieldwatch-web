// Offline-first cache: app shell + catalog.
// - HTML: network first, cached copy when offline.
// - data/*.json (catalog, vendor DB): stale-while-revalidate, so an updated catalog
//   reaches installed users on the next visit instead of being pinned forever.
// - everything else (hashed build assets, icons, fonts): cache first.
// Bump CACHE when the precache list or caching rules change.
const CACHE = 'fieldwatch-web-v2'
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './index.html', './data/signatures.json', './data/radiodb.json', './icon.svg', './manifest.webmanifest'])).then(() => self.skipWaiting()))
})
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()))
})
const cacheable = (url, res) => res.ok && (url.origin === location.origin || url.host.includes('fonts.g'))
self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((res) => { caches.open(CACHE).then((c) => c.put('./index.html', res.clone())); return res }).catch(() => caches.match('./index.html')))
    return
  }
  if (url.origin === location.origin && url.pathname.includes('/data/')) {
    e.respondWith(caches.open(CACHE).then((c) => c.match(req).then((hit) => {
      const fresh = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res })
      if (hit) { e.waitUntil(fresh.catch(() => null)); return hit }
      return fresh
    })))
    return
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
    if (cacheable(url, res)) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)) }
    return res
  })))
})
