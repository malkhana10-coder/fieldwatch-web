// Helpers for the Android app (a Capacitor wrapper around this same web build).
// Native plugins are never imported here: callers load them with a dynamic import
// only when isNative() is true, so the website does not download them.

/** True inside the Capacitor Android app; false in a browser, the installed PWA or tests. */
export function isNative() {
  try {
    return typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.() === true
  } catch {
    return false
  }
}
