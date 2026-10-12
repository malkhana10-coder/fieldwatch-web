# Fieldwatch Web for Android

The same app, wrapped with Capacitor so it can scan for real: Bluetooth LE through `@capacitor-community/bluetooth-le`, and Wi-Fi access points through the small `WifiScan` plugin in `android/app/src/main/java/app/fieldwatch/web/WifiScanPlugin.java`.

## Get the APK

Every push runs **CI → Build Android APK** on GitHub Actions. Download `Fieldwatch-Web-debug-apk` from the run's artifacts, or the `android-preview` release (built from `main`). Install it by sideloading and allow Location and Nearby devices when asked.

## Build it yourself

```bash
npm ci
npm run build
npx cap sync android
cd android && ./gradlew assembleDebug   # needs JDK 21 and the Android SDK
```

## What Android allows

- Wi-Fi: access points only (no client devices). Android limits fresh scans to about four every two minutes; turning off "Wi-Fi scan throttling" in Developer options makes it faster.
- Bluetooth LE: advertisements from nearby devices, including the real MAC address (the browser hides it).
- Location must be on, or Android returns no scan results.
- Scanning runs while the app is open. Background scanning with the screen off needs a foreground service and is not included yet.
