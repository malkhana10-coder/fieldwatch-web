# Fieldwatch bridge

[English](#english) · [العربية](#arabic)

<a id="english"></a>

## English

Browsers cannot scan Wi-Fi. This small Python program runs your system's own Wi-Fi and Bluetooth LE scanners and streams **real** sightings to Fieldwatch Web over a local WebSocket. It only listens. It never connects to the internet or sends anything to other devices.

### Install

Python 3.9 or newer.

```sh
cd bridge
python3 -m pip install -r requirements.txt     # websockets (required), bleak (optional, for BLE)
```

If `bleak` is missing or Bluetooth cannot start, the bridge runs Wi-Fi only and says why.

### Run

```sh
python3 fieldwatch_bridge.py
# Connect URL: ws://127.0.0.1:8765/?token=Q2x9...
```

| Flag | Default | Meaning |
|---|---|---|
| `--host` | `127.0.0.1` | Listen address |
| `--port` | `8765` | Listen port |
| `--token` | random | Access token. A new one is generated on every start unless you set one. |
| `--no-wifi` / `--no-ble` | off | Turn off a radio |
| `--wifi-interval` | `5` | Seconds between Wi-Fi scans |
| `--ble-window` | `2` | Seconds between BLE batches. Repeated adverts from the same device in a window are merged, keeping the strongest RSSI. |
| `--verbose` | off | Debug logging (stderr) |

Stop it with Ctrl+C.

### Connect from the app

Copy the whole **Connect URL** that the bridge prints, including `?token=`, into the app's bridge setting. Use `--token` to keep the same URL across restarts. A connection without the right token is closed with code 1008.

Protocol: the bridge first sends `{"type":"hello",...,"caps":{"wifi":…,"ble":…}}`, then batches shaped `{"type":"sightings","items":[…]}`.

### Platform notes

- **Linux:** Wi-Fi uses NetworkManager (`nmcli`). Signal % is converted to dBm as `pct/2 − 100`. BLE uses BlueZ through bleak. Your user may need to be in the `bluetooth` group.
- **Windows 10/11:** Wi-Fi uses `netsh wlan show networks mode=bssid`. Windows 11 may require **Location** to be enabled for apps (Settings › Privacy › Location). Windows can also cache results for a few seconds. BLE uses WinRT through bleak.
- **macOS:** Wi-Fi is best-effort through `system_profiler`. Recent macOS versions hide BSSIDs unless the terminal app has Location Services permission, and networks without a BSSID are skipped. CoreBluetooth reports per-Mac UUIDs instead of MAC addresses. The bridge turns each UUID into a stable pseudo MAC: `sha1(uuid)`, first 6 bytes, then the locally-administered bit is set. These addresses are consistent on one Mac but are not real, and the app will mark them as randomized.
- **Android (Termux):** install the Termux:API app and `pkg install termux-api python`, then grant Termux the Location permission and turn Location on. Wi-Fi uses `termux-wifi-scaninfo`. Android limits how often apps can scan, so results may repeat. BLE (bleak) is not available in Termux, so run with `--no-ble`.

### Security

- By default the bridge listens on loopback only (`127.0.0.1`). Without the token, any website you visit could open `ws://localhost:8765` and read nearby-device data. The token prevents that, so keep it private.
- `--host 0.0.0.0` exposes the bridge to your network. The bridge prints a warning when you do this. Only do it on networks you trust.
- Traffic is plain `ws://` (not encrypted). That is fine on loopback but not across a network.
- Browsers usually allow an HTTPS page to connect to `ws://127.0.0.1`. Newer Chrome may first ask permission to access devices on your local network. Safari may block it. If so, use another browser.
- Scanning is passive listening. Nothing is stored by the bridge. Respect local laws on radio monitoring and privacy.

### Tests

```sh
python3 -m unittest bridge/test_bridge.py      # from the repo root; no dependencies needed
```

---

<a id="arabic"></a>

<div dir="rtl">

## العربية

لا تستطيع المتصفحات فحص شبكات Wi-Fi. لذلك يشغّل هذا البرنامج الصغير المكتوب بلغة Python أدوات الفحص المدمجة في نظامك لشبكات Wi-Fi وأجهزة Bluetooth LE، ثم يرسل الأجهزة التي يرصدها **فعليًا** إلى تطبيق Fieldwatch Web عبر WebSocket محلي. البرنامج يستقبل الاتصالات فقط، ولا يتصل بالإنترنت ولا يرسل أي بيانات إلى أجهزة أخرى.

### التثبيت

يتطلب Python 3.9 أو أحدث.

<div dir="ltr">

```sh
cd bridge
python3 -m pip install -r requirements.txt
```

</div>

مكتبة `websockets` مطلوبة. أما `bleak` فاختيارية وتُستخدم لفحص البلوتوث. إذا لم تكن `bleak` مثبتة أو تعذّر تشغيل البلوتوث، يعمل الجسر على Wi-Fi فقط ويعرض سبب ذلك.

### التشغيل

<div dir="ltr">

```sh
python3 fieldwatch_bridge.py
# Connect URL: ws://127.0.0.1:8765/?token=Q2x9...
```

</div>

- الخيار `--host` يحدد عنوان الاستماع، والافتراضي `127.0.0.1`.
- الخيار `--port` يحدد المنفذ، والافتراضي `8765`.
- الخيار `--token` يحدد رمز الدخول. إذا لم تحدده، يُنشأ رمز عشوائي جديد في كل تشغيل.
- الخياران `--no-wifi` و`--no-ble` يوقفان فحص Wi-Fi أو البلوتوث.
- الخيار `--wifi-interval` يحدد عدد الثواني بين كل فحص لشبكات Wi-Fi، والافتراضي 5.
- الخيار `--ble-window` يحدد عدد الثواني بين كل دفعة من نتائج البلوتوث، والافتراضي 2. تُدمج الإعلانات المتكررة من الجهاز نفسه خلال الفترة الواحدة، مع الاحتفاظ بأقوى إشارة.
- الخيار `--verbose` يعرض سجلات تفصيلية.

للإيقاف اضغط Ctrl+C.

### الربط بالتطبيق

انسخ **رابط الاتصال (Connect URL)** الذي يطبعه الجسر كاملًا، بما في ذلك الجزء `?token=`، والصقه في إعداد الجسر داخل التطبيق. لتثبيت الرابط نفسه بين مرات التشغيل، استخدم `--token`. أي اتصال لا يحمل الرمز الصحيح يُغلق بالرمز 1008.

### ملاحظات حسب النظام

- **لينكس:** يُفحص Wi-Fi باستخدام `nmcli` من NetworkManager. ويُفحص البلوتوث عبر BlueZ، وقد يلزم أن يكون حسابك ضمن مجموعة `bluetooth`.
- **ويندوز 10/11:** يُفحص Wi-Fi باستخدام `netsh`. في ويندوز 11 قد يلزم تفعيل **الموقع** للتطبيقات من الإعدادات › الخصوصية › الموقع.
- **ماك:** فحص Wi-Fi عبر `system_profiler` غير مضمون النتائج، لأن الإصدارات الحديثة تُخفي عنوان BSSID ما لم يُمنح تطبيق الطرفية إذن خدمات الموقع، وتُتجاهل الشبكات التي لا يظهر عنوانها. كذلك لا يعرض نظام ماك عناوين MAC لأجهزة البلوتوث، بل معرّف UUID خاصًا بكل جهاز ماك. لذلك يحوّل الجسر هذا المعرّف إلى عنوان MAC بديل وثابت كما يلي: يحسب `sha1` للمعرّف، ويأخذ أول 6 بايتات، ثم يضبط بت "الإدارة المحلية". هذا العنوان ثابت على الجهاز نفسه لكنه ليس العنوان الحقيقي، وسيعرضه التطبيق على أنه عنوان عشوائي.
- **أندرويد (Termux):** ثبّت تطبيق Termux:API، ثم نفّذ `pkg install termux-api python`. امنح Termux إذن الموقع وفعّل خدمة الموقع. يحدّ أندرويد من عدد مرات الفحص، لذلك قد تتكرر النتائج. فحص البلوتوث غير متاح في Termux، فشغّل الجسر مع `--no-ble`.

### الأمان

- يستمع الجسر افتراضيًا على العنوان المحلي `127.0.0.1` فقط. لولا رمز الدخول، لأمكن لأي موقع تزوره أن يتصل بالمنفذ `ws://localhost:8765` ويقرأ بيانات الأجهزة القريبة منك. لذلك حافظ على سرية الرمز.
- تشغيل الجسر مع `--host 0.0.0.0` يجعله متاحًا لكل من على شبكتك، وسيعرض الجسر تحذيرًا عند ذلك. لا تفعل هذا إلا على شبكة موثوقة.
- الاتصال يتم عبر `ws://` وهو غير مشفّر. هذا مقبول على الجهاز نفسه، لكنه غير مناسب عبر الشبكة.
- قد يطلب متصفح Chrome الإذن بالوصول إلى أجهزة الشبكة المحلية، وقد يمنع Safari هذا الاتصال. إن حدث ذلك فاستخدم متصفحًا آخر.
- الفحص استماع سلبي فقط، ولا يحفظ الجسر أي بيانات. يُرجى الالتزام بالأنظمة المحلية المتعلقة برصد الإشارات اللاسلكية والخصوصية.

</div>
