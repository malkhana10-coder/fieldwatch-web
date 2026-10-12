// IEEE OUI + Bluetooth SIG lookup, converted from the app's radiodb.bin.
import { hexOnly } from './catalog.js'

let db = null
let loading = null

export function loadRadioDb() {
  if (db) return Promise.resolve(db)
  if (!loading) {
    loading = fetch(new URL('data/radiodb.json', document.baseURI)).then((r) => r.json()).then((j) => (db = j)).catch(() => (db = { names: [], oui: {}, btc: {}, uuid: {}, app: {} }))
  }
  return loading
}

export const ouiVendor = (mac) => {
  if (!db) return null
  const i = db.oui[hexOnly(mac).slice(0, 6)]
  return i == null ? null : db.names[i]
}
export const companyName = (id) => {
  if (!db || id == null) return null
  const i = db.btc[String(id)]
  return i == null ? null : db.names[i]
}
export const serviceName = (uuid) => {
  if (!db) return null
  let h = hexOnly(uuid)
  if (h.length === 32 && h.startsWith('0000') && h.endsWith('00001000800000805F9B34FB')) h = h.slice(4, 8)
  const i = db.uuid[h]
  return i == null ? null : db.names[i]
}
export const companyIds = () => (db ? Object.keys(db.btc).map(Number) : [])
