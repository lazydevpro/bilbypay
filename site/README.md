# site/ — passkey & claim-link domain (Cloudflare Pages)

Serves `bilbypay.pages.dev`, a free domain until `bilbypay.com` is bought:

- `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json`: let the iOS/Android app use passkeys
  for this domain (rpId) and open `/c/*` claim links in the app. Generated from `server/public/.well-known`.
- `/c/:code`, `/og/:file`: forwarded to the API (`API_ORIGIN`) for the share page and preview image; without an API,
  `/c/:code` shows a minimal "Open BilbyPay" page.
- `/`: a one-screen landing page.

## Deploy

```bash
cd site
npx wrangler login                     # once; opens Cloudflare in the browser
node build.mjs                         # reads signing.json
npx wrangler pages deploy --branch main
```

Signing values live in `signing.json` (public by design; they are served in the files). `APPLE_TEAM_ID` /
`ANDROID_CERT_SHA256` env vars override them for a one-off build.

- `appleTeamId`: developer.apple.com → Membership details. Empty for now (no Apple developer account yet).
- `androidCertSha256`: signing-cert SHA-256 of every build that should use passkeys. Currently the EAS keystore
  (created 2026-10-05). Read it from an APK with `apksigner verify --print-certs`, or `npx eas-cli credentials -p android`.
  **Play Store:** add the Play App Signing key's SHA-256 too (Play Console → Setup → App signing), because Play re-signs.
  Local `expo run:android` uses the shared Expo debug keystore (`FA:C6:17:…:3B:9C`). That key is public, so never list
  it on a domain with real accounts: any app signed with it could request this domain's passkeys.

Verify Android linking with Google's checker (should return `"linked": true`):

```bash
curl -s "https://digitalassetlinks.googleapis.com/v1/assetlinks:check?source.web.site=https://bilbypay.pages.dev&relation=delegate_permission/common.get_login_creds&target.android_app.package_name=com.bilbypay.app&target.android_app.certificate.sha256_fingerprint=<SHA256>"
```
- Once the API is hosted, set `API_ORIGIN` (Pages → Settings → Variables) and the server's `PUBLIC_BASE_URL` to
  `https://bilbypay.pages.dev`.

Check after deploying:

```bash
curl -si https://bilbypay.pages.dev/.well-known/apple-app-site-association | head -5
curl -s https://bilbypay.pages.dev/.well-known/assetlinks.json
```

## App build

The app's domain comes from `EXPO_PUBLIC_RP_ID` (`app/app.config.ts`, default `bilbypay.com`). The EAS profile
`testnet-passkey` sets it to `bilbypay.pages.dev` with real passkeys (no demo key). Changing the domain needs a
rebuild, and passkeys made for one domain don't work on another.
