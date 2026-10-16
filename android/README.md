# Fieldwatch Web — Android app

[English](#english) · [العربية](#arabic)

<a id="english"></a>

## English

This folder is a [Capacitor](https://capacitorjs.com/) 8 project that wraps the web build (`dist/`) as an Android app. The workflow `.github/workflows/android.yml` builds it on every push to `main` and publishes the APK on a GitHub pre-release named `android-build-<run number>`.

### Build locally

Needs Node 20+, JDK 21 and the Android SDK (platform 36).

```sh
npm ci
npm run build
npx cap sync android          # copies dist/ and registers the plugins
cd android && ./gradlew assembleRelease
# → android/app/build/outputs/apk/release/app-release.apk
```

`npx cap sync android` rewrites `capacitor.settings.gradle` and `app/capacitor.build.gradle`. Commit those changes when plugins change. Do not commit `app/src/main/assets/public` (it is ignored).

### Signing and updates

Android installs an update only when it is signed with the same key as the installed app. The APK is a **release** build (not debuggable), always signed with one stable key:

- **Default: the committed sideload key** `app/fieldwatch-sideload.keystore` (alias `fieldwatch`, store and key password `fieldwatch-sideload`, RSA 2048, valid until 2056).
- **Your own key:** set the repository secrets `KEYSTORE_BASE64` (`base64 -w0 my.keystore`), `KEYSTORE_PASSWORD`, `KEY_ALIAS` and optionally `KEY_PASSWORD` (defaults to `KEYSTORE_PASSWORD`). The workflow decodes the keystore and Gradle reads `KEYSTORE_FILE`, `KEYSTORE_PASSWORD`, `KEY_ALIAS` and `KEY_PASSWORD` from the environment. Local builds do the same if you export those variables.

**Trade-off of the committed key.** It is public, not a secret. Anyone with this repository can sign an APK that Android accepts as an update to yours, and that update could read the app's data (including the device-only Anthropic key, Telegram token and bridge token). That is acceptable for personal sideloading from this repository's own releases. Before sharing the app more widely, or in any store, create a private key and set the secrets above:

```sh
keytool -genkeypair -keystore fieldwatch-release.keystore -alias fieldwatch \
  -keyalg RSA -keysize 2048 -validity 10950
```

Changing keys is a one-time break: phones that have the app signed with the old key must uninstall it (which deletes its data) before they can install a build signed with the new one. Export a backup first (Settings › Export all data).

Builds 1–3 (before this setup) were debug builds signed with throwaway keys and cannot be updated in place.

### Versions

- `versionName` is read from `package.json` (`version`) by `app/build.gradle`.
- `versionCode` is `100 + GITHUB_RUN_NUMBER` on CI (100 for local builds). Builds 1–3 used the bare run number. The run number restarts if the workflow file is renamed or recreated. If that happens, raise the offset so `versionCode` keeps growing, or Android refuses the update.

### What the app needs from Android

- **Exports** (backup, settings, signatures, sit and log files): the WebView cannot save `<a download>` links, so `download()` in `src/engine/storage.js` writes the file to the app's private cache (`cache/exports/`) with `@capacitor/filesystem` and opens the share sheet with `@capacitor/share`. Choose Files, Drive, email or another app there. If saving fails, the app shows a toast; closing the share sheet saves nothing.
- **Bridge over plain `ws://`** (`app/src/main/res/xml/network_security_config.xml`): `127.0.0.1` and `localhost` (bridge in Termux on the phone) are allowed explicitly. Cleartext is also allowed for other hosts, and `capacitor.config.json` sets `android.allowMixedContent`, so a bridge on a laptop or Raspberry Pi on the same Wi-Fi (`ws://192.168.x.x`) works too. The page's Content-Security-Policy (`index.html`) still decides what the app may load or connect to: it has no `http:` source, so the only plain-text traffic is the `ws:` WebSocket to the bridge URL you enter. That traffic and its token are not encrypted, so only use a network bridge on networks you trust (see `bridge/README.md`). To allow only a bridge on the phone, set `cleartextTrafficPermitted="false"` on `base-config`.
- **No backups**: `allowBackup="false"`, `fullBackupContent="false"` and `data_extraction_rules.xml` keep the app's data (device-only secrets, sits, places, location history) out of cloud backup and device-to-device transfer. Move data with Settings › Export all data / Import all data.
- **WebView remote debugging** is on only in debuggable builds (Capacitor's default), so it is off in the published release APK.
- **Splash**: Android 12+ draws the system splash from `windowSplashScreenBackground` and `windowSplashScreenAnimatedIcon` (`res/values/styles.xml`). Android 7–11 show `drawable*/splash.png`, which is the Fieldwatch icon on `#0a0f0d`.
- **User agent**: `capacitor.config.json` appends `FieldwatchWeb-Android (+repo URL)` to the WebView user agent, so services such as the OpenStreetMap tile servers can tell which app is calling. The page origin in the app is `https://localhost`.

### Known gaps

- Reports › Print / PDF calls `window.print()`, which does nothing in an Android WebView.
- The WebView has no `Notification` API and no Web Bluetooth. Use Telegram alerts, and the bridge for real Wi-Fi/BLE data.

---

<a id="arabic"></a>

<div dir="rtl">

## العربية

هذا المجلد مشروع [Capacitor](https://capacitorjs.com/) 8 يغلّف نسخة الويب (`dist/`) في تطبيق أندرويد. يبني سير العمل `.github/workflows/android.yml` التطبيق مع كل دفع إلى `main` وينشر ملف APK في إصدار تجريبي على GitHub باسم `android-build-<رقم التشغيل>`.

### التوقيع والتحديث

لا يقبل أندرويد التحديث إلا إذا كان موقّعًا بالمفتاح نفسه الذي وُقّع به التطبيق المثبّت. لذلك يُبنى ملف APK بنسخة إصدار (غير قابلة للتصحيح) ويُوقَّع دائمًا بمفتاح ثابت واحد:

- **الافتراضي: مفتاح التثبيت اليدوي المحفوظ في المستودع** `app/fieldwatch-sideload.keystore` (الاسم المستعار `fieldwatch`، وكلمة المرور `fieldwatch-sideload`).
- **مفتاحك الخاص:** أضف أسرار المستودع `KEYSTORE_BASE64` و`KEYSTORE_PASSWORD` و`KEY_ALIAS`، و`KEY_PASSWORD` اختياريًا.

**تنبيه:** المفتاح المحفوظ في المستودع علني وليس سرًّا. يستطيع أي شخص لديه المستودع أن يوقّع تحديثًا يقبله أندرويد فوق تطبيقك، وقد يقرأ هذا التحديث بيانات التطبيق، ومنها مفتاح Anthropic ورمز تيليجرام ورمز الجسر. هذا مقبول للاستخدام الشخصي من إصدارات هذا المستودع فقط. قبل نشر التطبيق على نطاق أوسع، أنشئ مفتاحًا خاصًا وأضفه في الأسرار. تغيير المفتاح يتطلب حذف التطبيق مرة واحدة، وهذا يحذف بياناته، لذا صدّر نسخة احتياطية أولًا (الإعدادات › تصدير كل البيانات).

الإصدارات 1 إلى 3 وُقّعت بمفاتيح تصحيح مؤقتة، ولا يمكن تحديثها مباشرة: احذفها ثم ثبّت الإصدار الجديد.

### ما يحتاجه التطبيق من أندرويد

- **التصدير:** يُكتب الملف في ذاكرة التطبيق المؤقتة ثم تُفتح قائمة المشاركة لتختار مكان حفظه أو إرساله.
- **الجسر عبر `ws://`:** مسموح على الجهاز نفسه (`127.0.0.1` في Termux) وعلى الشبكة المحلية (لابتوب أو Raspberry Pi). الاتصال غير مشفّر، فاستخدم الجسر عبر الشبكة على الشبكات الموثوقة فقط.
- **بلا نسخ احتياطي:** لا تُنسخ بيانات التطبيق إلى السحابة ولا تُنقل إلى جهاز جديد. انقل بياناتك عبر الإعدادات › تصدير كل البيانات ثم استيرادها.

</div>
