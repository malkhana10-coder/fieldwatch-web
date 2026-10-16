# Deploy instructions for an agent (Hermes or any other)

This is **Fieldwatch Web** 1.3.1, a static web app (Vite + React) that also ships as an Android APK (Capacitor). There is no backend and no database. The web build needs no secrets. You need Node.js 20 or newer (CI uses 22). A local Android build also needs JDK 21 and the Android SDK, but GitHub Actions normally builds the APK for you.

## 1. Build and test

```bash
npm ci
npm test                                    # vitest unit tests: all must pass
python3 -m unittest bridge/test_bridge.py   # bridge parser tests (Python 3.9+, no pip install needed)
npm run build                               # output goes to dist/
```

## 2. Publish the web app: pick ONE way

### A. Netlify from a GitHub repository (recommended, auto-deploys on push)
1. Create an empty repository in the owner's GitHub account, e.g. `fieldwatch-web`.
2. Push this folder to it:
   ```bash
   git init -b main && git add -A && git commit -m "Fieldwatch Web"
   git remote add origin https://github.com/<OWNER>/fieldwatch-web.git
   git push -u origin main
   ```
3. On https://app.netlify.com choose **Add new site → Import an existing project → GitHub**, then select the repository. Leave the settings alone: `netlify.toml` already sets `npm ci && npm run build` and `publish = "dist"`.

### B. Netlify CLI (needs the owner's Netlify personal access token)
```bash
export NETLIFY_AUTH_TOKEN=<owner token>   # keep this out of chat logs and commits
npx netlify-cli@17 deploy --dir=dist --create-site fieldwatch-web          # draft URL
npx netlify-cli@17 deploy --dir=dist --prod --site <site-id-from-above>    # go live
```

### C. No tools at all
Drag the `dist/` folder, or the separate `fieldwatch-web-dist.zip`, onto https://app.netlify.com/drop.

## 3. Publish the Android APK (GitHub Actions)

The workflow `.github/workflows/android.yml` ("Android APK") does everything. It needs no setup beyond a GitHub repository with Actions enabled.

1. **Trigger it.** Push to `main` or `fix/v1.2-review`, or open **Actions → Android APK → Run workflow**.
2. **What it runs.** `npm ci`, `npm test`, `npm run build`, `npx cap sync android`, then a Gradle **release** build. A failing test stops the build.
3. **Where the result goes.** A new **pre-release** appears under **Releases**, named `Fieldwatch <version> (Android build <N>)` (tag `android-build-<N>`), with the `.apk` attached. The APK is also kept as the workflow artifact `fieldwatch-apk`. `<N>` is the workflow run number and doubles as the Android version code, so newer builds install over older ones.
4. **If the publish step fails with 403.** The workflow asks for `contents: write`. Check **Settings → Actions → General → Workflow permissions** and any organization policy that limits it.

**Signing.** By default the APK is signed with a fixed sideload keystore that is committed in the repository. That is why updates install over each other and keep the user's data. The trade-off is that anyone who can read the repository can sign an update. This is acceptable for the owner's own phone, but not for public distribution. To distribute:

1. Generate a private keystore and keep it out of the repository.
2. Add it as the `KEYSTORE_*` secrets under **Settings → Secrets and variables → Actions**. The exact names are in the workflow file.
3. Keep keystore passwords out of chat logs and commits.

Phones that have the sideload-signed build must uninstall it once before installing a build signed with the new key. Tell the owner to use **Settings → Export all data** first.

**Version bump.** Change `version` in `package.json`, which drives the app's About screen, exports and the release name. Keep `versionName` in `android/app/build.gradle` the same.

**Local build (optional).**
```bash
npm run build && npx cap sync android
cd android && ./gradlew assembleRelease     # APK in android/app/build/outputs/apk/release/
```

## 4. Check what you published

**Web:**
- The page loads and the disclaimer dialog appears. The Arabic/English toggle works.
- Live → Start shows radios after a few seconds (the field simulator).
- The theme button switches between light, dark and night.

**Android:**
- Install the APK from the Releases page on a phone. The owner-facing steps are in `docs/ANDROID.md` (English) and `docs/ANDROID.ar.md` (Arabic).
- Run the same three web checks in the app.
- An export (for example Settings → Export settings) opens the Android share sheet.
- Installing the next build over it keeps the data.

## Rules
- Keep `LICENSE` and `NOTICE` in the repository and in every distributed copy. The original app is MIT-licensed by Off Grid Pete LLC.
- Keep the "Unofficial web port" labels. Do not present this as an official Off Grid Pete LLC build, on the web or on Android.
- Never commit tokens, API keys or a private release keystore. The committed sideload keystore is for personal sideloading only.
