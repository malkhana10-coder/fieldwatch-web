export function distM(a, b) {
  const R = 6371000
  const toR = (x) => (x * Math.PI) / 180
  const dLat = toR(b.lat - a.lat)
  const dLon = toR(b.lon - a.lon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Max spread between any two stamps (O(n²) on a capped list). */
export function spreadM(points) {
  let best = 0
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) best = Math.max(best, distM(points[i], points[j]))
  return best
}

export const maskMac = (mac, on) => {
  if (!on || !mac) return mac
  const p = mac.split(':')
  return p.length < 4 ? mac : p.slice(0, p.length - 3).join(':') + ':**:**:**'
}
export const maskCoord = (v, on) => (on ? '••.•••' : v?.toFixed(5))

/** Spreadsheet-safe CSV cell (port of CsvCells.plain). */
export function csvCell(v) {
  let s = v == null ? '' : String(v)
  if (/^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"'
  return s
}

export const xmlEsc = (s) => String(s ?? '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]))
