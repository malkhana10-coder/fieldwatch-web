# Deploy instructions for an agent (Hermes or any other)

This is **Fieldwatch Web**, a static web app (Vite + React). There is no backend, no database and no secrets. You need Node.js 20 or newer.

## 1. Build and test

```bash
npm ci
npm test          # 12 unit tests, all must pass
npm run build     # output goes to dist/
```

## 2. Pick ONE way to publish to the owner's account

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

## 3. Check the deployed site
- The page loads and the disclaimer dialog appears. The Arabic/English toggle works.
- Live → Start shows radios after a few seconds (the field simulator).
- The theme button switches between light, dark and night.

## Rules
- Keep `LICENSE` and `NOTICE`. The original app is MIT-licensed by Off Grid Pete LLC.
- Keep the "Unofficial web port" labels. Do not present this as an official Off Grid Pete LLC build.
- Never commit tokens.
