// On-device encryption with the Web Crypto API: PBKDF2 (SHA-256) derives an
// AES-GCM key from the user's PIN or export password. Nothing leaves the device.
const enc = new TextEncoder()
const dec = new TextDecoder()
// Chunked so large payloads (a long log) do not overflow the call stack.
const b64 = (buf) => {
  const u = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000))
  return btoa(s)
}
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

export const ITERATIONS = 210000

export function randomSalt() {
  return b64(crypto.getRandomValues(new Uint8Array(16)))
}

export async function deriveKey(secret, saltB64, iterations = ITERATIONS) {
  const base = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: unb64(saltB64), iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** Encrypt any JSON-serialisable value. */
export async function sealJson(key, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(value)))
  return { __enc: 1, iv: b64(iv), ct: b64(ct) }
}

export async function openJson(key, box) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, key, unb64(box.ct))
  return JSON.parse(dec.decode(pt))
}

export const isSealed = (v) => !!v && typeof v === 'object' && v.__enc === 1

/** Password-protected export file (self-describing, includes its own salt). */
export async function encryptExport(password, value) {
  const salt = randomSalt()
  const key = await deriveKey(password, salt)
  const box = await sealJson(key, value)
  return JSON.stringify({ format: 'fieldwatch-encrypted', version: 1, kdf: 'PBKDF2-SHA256', iterations: ITERATIONS, salt, iv: box.iv, ct: box.ct })
}

export async function decryptExport(password, text) {
  const j = typeof text === 'string' ? JSON.parse(text) : text
  if (j.format !== 'fieldwatch-encrypted') throw new Error('not an encrypted Fieldwatch file')
  const key = await deriveKey(password, j.salt, j.iterations || ITERATIONS)
  return openJson(key, { iv: j.iv, ct: j.ct })
}
