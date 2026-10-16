// Tiny persistence layer: localStorage for small settings, IndexedDB for sits,
// the log and an imported catalog. Every access is guarded; the app still runs
// (in memory only) when storage is blocked.

import { isNative } from '../native.js'

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

// The Android WebView ignores <a download> (Capacitor registers no DownloadListener),
// so in the app the file is written to the app's private cache and handed to the
// Android share sheet, where the user picks where it goes (Files, Drive, mail…).
// The plugins are imported on demand so the website never downloads them.
function exportName(filename) {
  const name = String(filename).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/^\.+/, '')
  return name || 'fieldwatch-export.txt'
}

async function shareNative(filename, text) {
  const name = exportName(filename)
  try {
    const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([
      import('@capacitor/filesystem'),
      import('@capacitor/share'),
    ])
    // The cache is private to the app (like its IndexedDB) and Android may clear it when space is low.
    // Old exports are not deleted here: the app the user shared to may still be reading one.
    const { uri } = await Filesystem.writeFile({
      path: 'exports/' + name,
      data: text,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
      recursive: true,
    })
    await Share.share({ title: name, dialogTitle: name, files: [uri] })
    return true
  } catch (err) {
    const msg = String(err?.message ?? err)
    // Closing the share sheet is the user's choice, not an error worth a toast.
    if (!/cancel/i.test(msg)) window.dispatchEvent(new CustomEvent('fw-download-failed', { detail: { file: name, error: msg } }))
    return false
  }
}

export async function download(filename, text, mime = 'text/plain') {
  if (isNative()) return shareNative(filename, text)
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
