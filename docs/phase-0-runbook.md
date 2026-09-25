# Phase 0 runbook — setup & spikes

Goal (spec §9): repo set up, **mera passkey on a real phone**, and an **EIP-3009 relay on mainnet**.

| Check | How | Status |
|---|---|---|
| Repo builds | `pnpm install && pnpm typecheck && pnpm test && pnpm test:contracts` | ✅ in CI-less container |
| EIP-3009 relay logic | `pnpm --filter @bilbypay/server spike:relay:local` (anvil as chain 143 + `MockAUSD`) | ✅ locally, both key-signed and app-style signed |
| App bundles | `cd app && npx expo export --platform ios --platform android` | ✅ |
| mera wiring | passkey → PRF → `deriveEvmPrivateKey` → session → `toViemAccount` signs EIP-712 that recovers to the account | ✅ with a stub authenticator |
| **Passkey on a real phone, same account after reinstall** | Steps A–C below | ⏳ needs a phone + domain |
| **Relayed AUSD transfer on mainnet from a 0-MON account** | Step D below | ⏳ needs funded relayer |

## Prerequisites

- Node ≥ 22 (mera declares ≥ 24; 22 works for building), pnpm 10, Foundry (`forge`, `anvil`, `cast`), `jq`.
- iPhone on iOS 18+ and/or Android 9+ with a screen lock and a signed-in Apple / Google account (passkeys sync through them).
- The passkey domain (`bilbypay.com` by default — **not registered yet**, see TODO). Any HTTPS domain you control works; set `EXPO_PUBLIC_RP_ID` and `ios.associatedDomains` in `app/app.json` to match.

## A. Host the passkey association files

mera binds passkeys to the domain (rpId). The OS only lets the app use them if the domain vouches for the app.

1. Fill in `server/public/.well-known/apple-app-site-association` (your Apple Team ID) and
   `server/public/.well-known/assetlinks.json` (SHA-256 of the debug keystore: `keytool -list -v -keystore ~/.android/debug.keystore -storepass android`, plus the EAS/release keystore when you have it).
2. Serve `server/public` at `https://<rpId>/` on any static host (Vercel, Cloudflare Pages, Netlify).
   Both files must return **200, `application/json`, no redirects**:
   `curl -sI https://<rpId>/.well-known/apple-app-site-association`, `curl -s https://<rpId>/.well-known/assetlinks.json`.

## B. Build the dev client (not Expo Go)

```bash
cd app
EXPO_PUBLIC_RP_ID=<rpId> EXPO_PUBLIC_CHAIN_ID=143 npx expo run:ios --device     # Mac + Xcode
EXPO_PUBLIC_RP_ID=<rpId> EXPO_PUBLIC_CHAIN_ID=143 npx expo run:android --device # Android Studio SDK
# or in the cloud: npx eas-cli@latest build --profile development --platform ios|android
```

## C. Passkey spike (verify: same account on two installs)

1. Open the app → type a name → **Create account (new passkey)** → Face ID / fingerprint. Note the account.
2. Delete the app, reinstall, open → **Sign in with existing passkey** → pick the passkey. The account must be identical.
3. Optional: the other platform (or a second phone on the same Apple/Google account) → **Sign in** → same account.
4. Record: device, OS version, number of biometric prompts on create (1, or 2 where the authenticator doesn't return PRF at creation), any `PRF_UNAVAILABLE` errors.

> ⚠️ On a second device, **pick the existing passkey**. Creating a new one gives a different account.

## D. Relay spike on mainnet (verify: tx hash from a 0-MON account)

1. `cp server/.env.example server/.env`; set `RELAYER_PRIVATE_KEY` to a key holding **> 10 MON** (Monad charges the gas limit and caps in-flight gas at min(10 MON, balance)).
2. Pick the sender:
   - **Key spike:** leave `SENDER_PRIVATE_KEY` empty and run `pnpm --filter @bilbypay/server spike:relay` once; it prints a fresh key. Send that address a few cents of AUSD (`0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a`) — **no MON** — and put the key in `.env`.
   - **Passkey spike (preferred, proves both halves):** send a few cents of AUSD to the account from step C; in the app enter a recipient and amount → **Sign & share for relay**; save the JSON to a file and set `SIGNED_AUTH_FILE=/path/to/file.json`. The signature is valid for 1 hour.
3. `pnpm --filter @bilbypay/server spike:relay`. It checks the token's EIP-712 domain against `DOMAIN_SEPARATOR()`, checks the sender holds 0 MON, relays with gas = estimate + 7.5%, and confirms `authorizationState`, balances and that the sender still holds 0 MON.
4. Paste the printed tx hash + Monadscan link into the table below and into the README.

## Results

| Date | Check | Device / network | Result |
|---|---|---|---|
| 2026-09-25 | Local relay e2e (anvil, chain 143, MockAUSD) | container | ✅ 2 relays, sender 0 MON before/after |
| | Passkey create + reinstall sign-in | iPhone … iOS … | |
| | Passkey sign-in on Android | … | |
| | Mainnet relay (key spike) | Monad 143 | tx: |
| | Mainnet relay (passkey-signed) | Monad 143 | tx: |

## Notes

- Key derivation (`packages/core/src/account.ts`): `HKDF-SHA256(prfOutput, salt "bilbypay", info "bilbypay/evm/secp256k1/v1")`. Pinned by a test. **Changing it changes every user's account.**
- The PRF output is held in memory only in this spike. Persisting it (mera's demo uses `expo-secure-store` behind biometrics) is a Phase 3 decision.
- The spike screen shows addresses and chain ids — it is a developer tool, not the product UI (spec §3a).
