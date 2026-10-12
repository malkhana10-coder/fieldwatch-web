// Tiny persistence layer: localStorage for small settings, IndexedDB for sits,
// the log and an imported catalog. Every access is guarded; the app still runs
// (in memory only) when storage is blocked.

export const ls = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem('fw.' + key)
      return v == null ? fallback : JSON.parse(v)
    } catch { return fallback }
  },
  set(key, value) {
    try { localStorage.setItem('fw.' + key, JSON.stringify(value)) } catch { /* ignore */ }
  },
  clear() {
    try { Object.keys(localStorage).filter((k) => k.startsWith('fw.')).forEach((k) => localStorage.removeItem(k)) } catch { /* ignore */ }
  },
}

let dbp = null
function db() {
  if (!dbp) {
    dbp = new Promise((resolve) => {
      try {
        const req = indexedDB.open('fieldwatch', 1)
        req.onupgradeneeded = () => req.result.createObjectStore('kv')
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => resolve(null)
      } catch { resolve(null) }
    })
  }
  return dbp
}

export const idb = {
  async get(key) {
    const d = await db()
    if (!d) return undefined
    return new Promise((resolve) => {
      try {
        const r = d.transaction('kv').objectStore('kv').get(key)
        r.onsuccess = () => resolve(r.result)
        r.onerror = () => resolve(undefined)
      } catch { resolve(undefined) }
    })
  },
  async set(key, value) {
    const d = await db()
    if (!d) return
    return new Promise((resolve) => {
      try {
        const tx = d.transaction('kv', 'readwrite')
        tx.objectStore('kv').put(value, key)
        tx.oncomplete = () => resolve()
        tx.onerror = () => resolve()
      } catch { resolve() }
    })
  },
  async clear() {
    const d = await db()
    if (!d) return
    return new Promise((resolve) => {
      try {
        const tx = d.transaction('kv', 'readwrite')
        tx.objectStore('kv').clear()
        tx.oncomplete = () => resolve()
        tx.onerror = () => resolve()
      } catch { resolve() }
    })
  },
}

// Inside the claude.ai artifact viewer, plain downloads are blocked; saves go through
// its `downloads` capability instead (only for the file types it allows).
export const inViewer = typeof window !== 'undefined' && typeof window.claude?.use === 'function'
const VIEWER_EXTS = new Set(['txt', 'json', 'md', 'csv', 'html', 'svg', 'pdf'])
let viewerDl = null
if (inViewer) window.claude.use('downloads').then((x) => { viewerDl = x }).catch(() => {})

export async function download(filename, text, mime = 'text/plain') {
  if (inViewer) {
    const ext = filename.split('.').pop().toLowerCase()
    if (!viewerDl || !VIEWER_EXTS.has(ext)) {
      window.dispatchEvent(new CustomEvent('fw-download-unavailable', { detail: ext }))
      return false
    }
    try { await viewerDl.save({ filename, data: text }); return true } catch { return false }
  }
  const blob = new Blob([text], { type: mime + ';charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
  return true
}

export function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.onchange = () => {
      const f = input.files?.[0]
      if (!f) return resolve(null)
      f.text().then((text) => resolve({ name: f.name, text }))
    }
    input.click()
  })
}
