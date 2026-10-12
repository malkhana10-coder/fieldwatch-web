// Real radio scanning inside the Android app (Capacitor). Loaded only when the
// page runs inside the native shell, so the web build stays light.
import { Capacitor, registerPlugin } from '@capacitor/core'
import { BleClient } from '@capacitor-community/bluetooth-le'

/** Custom plugin in android/app/src/main/java/app/fieldwatch/web/WifiScanPlugin.java */
const WifiScan = registerPlugin('WifiScan')

const dvHex = (dv) => {
  let s = ''
  for (let i = 0; i < dv.byteLength; i++) s += dv.getUint8(i).toString(16).toUpperCase().padStart(2, '0')
  return s
}
const chFromFreq = (f) => (f >= 5925 ? Math.round((f - 5950) / 5) : f >= 5000 ? Math.round((f - 5000) / 5) : f === 2484 ? 14 : Math.round((f - 2407) / 5))
const secFromCaps = (c = '') => (c.includes('SAE') ? 'WPA3-SAE' : c.includes('EAP') ? 'WPA2-EAP' : c.includes('WPA2') || c.includes('RSN') ? 'WPA2-PSK' : c.includes('WPA') ? 'WPA-PSK' : c.includes('WEP') ? 'WEP' : 'OPEN')

export const isNativeApp = () => Capacitor.isNativePlatform()

export class NativeScanner {
  constructor(push) {
    this.push = push
    this.wifiEvery = 30000
    this.timer = null
  }

  async start() {
    await BleClient.initialize({ androidNeverForLocation: false })
    await BleClient.requestLEScan({ allowDuplicates: true }, (res) => {
      const mfg = Object.entries(res.manufacturerData || {}).map(([id, dv]) => ({ companyId: Number(id), dataHex: dvHex(dv) }))
      const svcData = Object.entries(res.serviceData || {}).map(([uuid, dv]) => ({ uuid, dataHex: dvHex(dv) }))
      this.push({
        kind: 'BLE', mac: res.device.deviceId, name: res.localName || res.device.name || '', rssi: res.rssi ?? -100,
        mfg, svcData, uuids: res.uuids || [], vendorIe: [], channel: 0, freq: 2402,
      })
    })
    try { await WifiScan.requestPermissions?.() } catch { /* the BLE prompt already covers location on most phones */ }
    const wifi = async () => {
      try {
        await WifiScan.startScan().catch(() => {}) // Android throttles this; cached results still come back
        const { results } = await WifiScan.getResults()
        for (const w of results || []) {
          const ch = chFromFreq(w.frequency)
          this.push({ kind: 'WIFI', mac: w.bssid, name: w.ssid || '', hidden: !w.ssid, rssi: w.level, channel: ch, freq: w.frequency, security: secFromCaps(w.capabilities), mfg: [], uuids: [], svcData: [], vendorIe: [] })
        }
      } catch { /* Wi-Fi or location off: BLE keeps running */ }
      this.timer = setTimeout(wifi, this.wifiEvery)
    }
    wifi()
  }

  /** Adaptive scanning: tighten the Wi-Fi cadence while something deserves attention. */
  setUrgency(high) {
    this.wifiEvery = high ? 10000 : 30000
  }

  async stop() {
    clearTimeout(this.timer)
    try { await BleClient.stopLEScan() } catch { /* ignore */ }
  }
}
