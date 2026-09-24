# Technical risk check: phone-number stablecoin payments on Monad mainnet (chain 143)

Checked 2026-09-24. **CONFIRMED** means I checked it against source code, official docs, or live mainnet RPC calls. **UNCERTAIN** means it is inferred or the source is secondary.
Source for the mera repo: `github.com/category-labs/mera` @ `a3102f4` (2026-08-31).

---

## TL;DR (things that can hurt the build)

| # | Risk | Severity | Status |
|---|------|----------|--------|
| 1 | mera supports React Native only through **`react-native-passkey` (f-23) 3.6.1**, not the Expo module `react-native-passkeys`. It needs an Expo **dev build/prebuild**, not Expo Go. It also needs a Hermes `crypto.getRandomValues` polyfill and an HTTPS rpId domain that serves AASA + assetlinks.json | Medium (setup time) | CONFIRMED |
| 2 | PRF needs iOS 18+ or Android 9+ with a PRF-capable provider (Google Password Manager or 1Password). Desktop Chrome's local profile, Bitwarden, and Dashlane return **no PRF** | Medium (demo devices) | CONFIRMED |
| 3 | Reserve balance: a user EOA with 0 MON is fine when a relayer sends EIP-3009/2612 txs, or when a 7702 account is sponsored. The **relayer** EOA should hold **>10 MON**, because the in-flight gas budget is min(10 MON, balance) and Monad charges the **gas limit**, not gas used | Low | CONFIRMED |
| 4 | Both AUSD and USDC on Monad support **EIP-2612 permit and EIP-3009 transfer/receiveWithAuthorization** (both v,r,s and `bytes` signature overloads). Their EIP-712 domains differ | Low (good news) | CONFIRMED on-chain |
| 5 | **Circle Paymaster is NOT on Monad.** Pimlico, Alchemy, ZeroDev, and Biconomy are | Low | CONFIRMED |
| 6 | Agora API uses API keys from the Agora dashboard (an onboarded org). There is no self-serve sandbox. The staging host exists in the OpenAPI spec but is gated | Medium (if the bounty needs the API) | Partly UNCERTAIN |
| 7 | India SMS: Twilio's **international route needs no DLT**. The domestic branded sender needs DLT (~10 business days). Twilio **WhatsApp Verify needs your own WhatsApp Business sender** (since 2024-03-01) | Low for demo | CONFIRMED |

**Recommended stack.** Use the mera secp256k1 key as a plain EOA that holds AUSD/USDC. Users sign EIP-3009 `transferWithAuthorization` (or `receiveWithAuthorization` with an escrow contract as the receiver) with `signTypedData`. Your backend relayer (an EOA with more than 10 MON) submits the tx. You don't need 4337 or 7702. Keep Pimlico or Alchemy 7702 as the fallback if you need batching.

---

## 1. mera: packages, license, platforms, PRF

- **Package:** `@category-labs/mera` v0.2.0. Published 2026-08-12, `engines.node >=24` (`npm view @category-labs/mera`). CONFIRMED.
  - Subpath exports: `.`, `./viem`, `./react-native-webauthn-client` (`library/package.json` `exports`).
  - Peer deps: `react-native-passkey: 3.6.1` (optional, pinned exact) and `viem ^2.28.0` (optional).
- **Repo:** https://github.com/category-labs/mera. Docs are at https://mera.category.xyz. The blog post is https://www.monad.xyz/blog/introducing-mera.
- **License:** MIT OR Apache-2.0 (`README.md` L45-47, `LICENSE-MIT`, `LICENSE-APACHE`). CONFIRMED.
- **Status:** preview. "the API may change before version 1.0". An internal security review was completed (`README.md` L37). CONFIRMED.
- **Supported platforms** (`README.md` L15-21). CONFIRMED:
  - Web browsers, Chrome extensions, and **"React Native on iOS 18 or later and Android 9 or later"**.
  - "Native applications can reuse passkeys created with mera by using the platform's WebAuthn APIs". There are **no Swift or Kotlin SDKs**. A pure-native app has to reimplement the key derivation (PRF salt → HKDF etc.) itself. A WebView is not needed.
- **React Native / Expo.** CONFIRMED:
  - `library/src/react-native-webauthn-client.ts` L7: `import { Passkey as platformApi } from "react-native-passkey";`, which is the **f-23/react-native-passkey** package, not `react-native-passkeys`.
  - The official mobile demo is an **Expo 57 / RN 0.86.2** app using `expo prebuild --clean` + `expo run:ios --device` (`demos/mobile/package.json`). So it's a dev build and **not Expo Go**.
  - Docs recipe `docs/src/content/docs/recipes/use-mera-with-react-native.md`:
    - L9: Hermes lacks `crypto.getRandomValues`, so you need a polyfill (`expo-crypto`).
    - L14: `npm install @category-labs/mera react-native-passkey`.
    - L54-99: you need an rpId HTTPS host serving `/.well-known/apple-app-site-association` (`webcredentials`) and `/.well-known/assetlinks.json` (`delegate_permission/common.get_login_creds`, including the debug keystore SHA-256). The files must be served with no redirect.
    - L103-128: pass `reactNativeWebAuthnClient` to `createPasskeyWithPrfOutput` / `getPasskeyPrfOutput`.
  - The demo stores the PRF output in `expo-secure-store` behind biometrics, so later launches don't prompt for the passkey (`demos/mobile/README.md` L100-119).
- **PRF requirements** (`docs/src/content/docs/authenticator-support.md`). CONFIRMED:
  - L6: requires the WebAuthn **PRF extension, discoverable credentials, and user verification**.
  - L13-16: iCloud Keychain works on iOS 18+ / macOS 15+.
  - L18: Google Password Manager on Android works ("Known by 2026-06").
  - L32: "Native apps can use PRF on iOS 18 or later and Android 9 or later."
  - L20, L26-27: desktop Chrome's local profile, Bitwarden, and Dashlane are **Not supported**.
  - L36-38: on Chrome, a passkey saved to the local profile has no PRF, and `createPasskeyWithPrfOutput` fails.
  - `react-native-passkey` README L372-376: "As of version 3.3 the PRF extension will work for Android and iOS 18+". On Android, requests go through Credential Manager (`androidx.credentials:credentials:1.6.0`, `android/build.gradle` L144-145).
  - The RN client requests PRF via `extensions: { prf: { eval: { first: salt } } }` and throws `PRF_UNAVAILABLE` if there is no output (`library/src/react-native-webauthn-client-internal.ts` L118-142).
- **Does `react-native-passkeys` (Expo module, peterferguson) support PRF?** Yes, but mera doesn't use it. Its CHANGELOG 0.4.0 says PRF `evalByCredential` is "Implemented across iOS (iOS 18+), Android (API 34+), and Web". `ios/Shared.swift` L225-247 defines the PRF inputs. You could write a custom `WebAuthnClient` around it (the mera docs say "An app can use this client or provide its own `WebAuthnClient`", recipe L128). UNCERTAIN that it works end-to-end with mera, and Android API 34+ is stricter than Android 9+.
- **Gotcha (community, UNCERTAIN):** on a second device, *select* the existing passkey. Creating a new one with the same rpId and user handle overwrites the credential and gives a new PRF, which means a new account (monadguard repo README).

## 2. Signing sessions

CONFIRMED (`docs/src/content/docs/concepts/signing-sessions.mdx` L8-33, `library/src/session.ts` L28-54):
- A session copies a raw private key (derived from PRF output or decrypted from a vault) into memory. It signs until `end()` is called, and `end()` zeroes the key permanently (`activePrivateKey.fill(0)`, session.ts L43-46). After that, signing throws `SESSION_ENDED`.
- A session **does not contact the authenticator**. There's no biometric prompt per signature, so the only prompt is the ceremony that produces the key.
- The API is `createSecp256k1SigningSession` / `createEd25519SigningSession`. Sessions support `using` for scope-bound disposal.
- `toViemAccount(session)` (`library/src/viem.ts` L23-66) gives a viem `LocalAccount` with `signTransaction`, `signMessage`, `signTypedData` (EIP-712, so it works for EIP-3009/2612), and `signAuthorization` (EIP-7702).
- These are **not** on-chain session keys with scoped permissions. For scoped or limited sessions you'd still need a smart-account or 7702 delegate.

## 3. Monad reserve balance (https://docs.monad.xyz/developer-essentials/reserve-balance)

CONFIRMED (quotes from the page):
- "user_reserve_balance is currently set to 10 MON for each EOA."
- Execution check: "For a non-sender account, the ending balance must not be lower than min(balance at transaction start, user_reserve_balance). For the sender, the ending balance may be lower by at most the transaction's gas spend".
- Consensus check: "For each account, consensus has a budget for the gas spend for all inflight transactions; this budget is user_reserve_balance (or the account's balance from the lagged execution state, whichever is lower)."
- **Relayer submits EIP-3009/2612 for a 0-MON user EOA:** the user is not the sender and their MON balance doesn't change (only ERC-20 balances move), so it's **no problem**. The rule only checks MON balances.
- **7702 delegated + sponsored:** "many sponsored gas workflows have users set up EIP-7702-delegated EOAs that don't interact with MON at all ... This workflow works fine in Monad; it's fine for the EOA in question to have a zero or very small balance." It's blocked only if the delegated EOA's MON balance "decrements and drops below" 10 MON. Delegated EOAs cannot use the emptying exception.
  - Also: code running as a 7702-delegated EOA cannot `CREATE/CREATE2` (https://docs.monad.xyz/developer-essentials/eip-7702, "Delegated contract code cannot call CREATE/CREATE2").
- **Relayer EOA:** it's the sender, so its in-flight gas budget is min(10 MON, balance). Monad charges the **gas limit, not gas used** (https://docs.monad.xyz/developer-essentials/gas-pricing: "Gas charged ... is the gas limit"). The minimum base fee is 100 MON-gwei, so a 200k-gas tx costs about 0.02 MON.
  - Recommendation: fund the relayer with **well over 10 MON** and set tight gas limits.
  - If the relayer ever drops below 10 MON, its in-flight capacity shrinks. The emptying exception doesn't help an active relayer, because it only applies to the first tx in k=3 blocks.
  - Use several relayer EOAs for parallel throughput. INFERENCE, UNCERTAIN.

## 4. Gas sponsorship on Monad mainnet

Official Monad list: https://docs.monad.xyz/tooling-and-infra/wallet-infra/account-abstraction.md (Mainnet tab, L33-95). It marks Alchemy, Biconomy, Pimlico, Sequence, thirdweb, and ZeroDev ✅, and FastLane ❓.

| Provider | Mainnet 143 | Evidence |
|---|---|---|
| Pimlico bundler + paymaster | ✅ CONFIRMED | https://docs.pimlico.io/guides/supported-chains: "Monad, Chain ID: 143 ... EIP-7702 support: ✅". EntryPoint v0.6/v0.7/v0.8 bundler+paymaster ✅, v0.9 bundler only |
| Alchemy bundler / gas sponsorship / ERC-20 gas | ✅ CONFIRMED | https://www.alchemy.com/docs/wallets/supported-chains: "Monad Mainnet ✅✅✅✅" (Bundler, Gas Sponsorship, ERC20 Gas Payments, BSOs) |
| ZeroDev | ✅ CONFIRMED | https://docs.zerodev.app/sdk/faqs/chains: "Monad Mainnet 143" |
| Biconomy (Nexus/MEE) | ✅ CONFIRMED | https://docs.biconomy.io/contracts-and-audits/supported-chains: "Monad Mainnet 2.2.2, 2.2.1, 2.1.0" |
| Circle Paymaster (pay gas in USDC) | ❌ NOT on Monad | https://developers.circle.com/paymaster, Supported chains: v0.7 Arbitrum, Base. v0.8 Arbitrum, Avalanche, Base, Ethereum, Optimism, Polygon, Unichain |
| Circle Gas Station (Circle Wallets only) | ✅ | https://developers.circle.com/wallets/gas-station: "Monad Mainnet ✅✅". Only works for **Circle-managed wallets**, not mera keys |
| EIP-7702 protocol | ✅ CONFIRMED | https://docs.monad.xyz/developer-essentials/eip-7702: "supported on Monad with the same workflow as in Ethereum" |

On-chain check (`cast code` on rpc.monad.xyz): EntryPoint v0.7 `0x0000000071727De22E5E9d8BAf0edAc6f37da032` and v0.8 `0x4337084d9e255ff0702461cf8895ce9e3b5ff108` both have bytecode. CONFIRMED.

## 5. Stablecoin contracts on Monad mainnet

| Token | Address | Source |
|---|---|---|
| AUSD (Agora) | `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a` | https://docs.agora.finance/developer/contract-deployments (Monad row). Also the Monad tokens page |
| USDC (Circle native) | `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` | https://developers.circle.com/stablecoins/usdc-contract-addresses ("Monad"). Testnet is `0x534b2f3A21130d7a60830c2Df862319e593943A3` |

Both have 6 decimals.

**On-chain verification** (2026-09-24, `https://rpc.monad.xyz`, eth_chainId = 0x8f = 143). CONFIRMED:
- AUSD is an EIP-1967 proxy with impl `0xc1e3c7d486d6a92fbe920232e439eec2ceb112da`. USDC is a zos-slot proxy (FiatToken) with impl `0xbd520ea8cbb4f81b62aff3c3ffe7affd69800b6d`.
- Both implementations' bytecode contains PUSH4 selectors for:
  - `permit` v,r,s `0xd505accf` and bytes `0x9fd5a6cf`
  - `transferWithAuthorization` v,r,s `0xe3ee160e` and bytes `0xcf092995`
  - `receiveWithAuthorization` `0xef55bec6` / `0x88b7ab63`
  - `cancelAuthorization` `0x5a049a70` / `0xb7b72899`
  - `authorizationState` `0xe94a0102`
  - `nonces` `0x7ecebe00`
- Live `eth_call`s to `nonces(addr)` and `authorizationState(addr,bytes32)` return successfully on both.
- **EIP-712 domains** (I recomputed each and it matches on-chain `DOMAIN_SEPARATOR()`):
  - AUSD: name **"Agora Dollar"** (≠ `name()`/symbol "AUSD"), version **"1"**, chainId 143, verifyingContract = proxy. Also exposed via `eip712Domain()`.
  - USDC: name **"USDC"**, version **"2"**, chainId 143, verifyingContract = proxy. It has no `eip712Domain()` (reverts).
- Agora docs also claim ERC-2612, ERC-3009, and ERC-1271 support: https://docs.agora.finance/developer/advanced-erc-features.
- Caveat: both tokens have freeze/blacklist + pause roles (Agora RBAC https://docs.agora.finance/developer/rbac, Circle blacklist).

## 6. Agora API / staging / testnet

- **Public API** (https://docs.agora.finance/api.md L5-24). CONFIRMED:
  - Metrics (public, no auth).
  - Accounts (bank accounts + wallets).
  - **Routes** ("reusable mint and redeem routes (fiat ↔ AUSD, stablecoin ↔ AUSD) and the settlement instructions").
  - Transactions.
  - Base URL `https://api.agora.finance`. `curl https://api.agora.finance/v0/metrics` works unauthenticated (tested).
- **Auth:** an API key created by an Owner/Admin in the **Agora dashboard (app.agora.finance)** is exchanged for a session JWT via `POST /v0/auth/token` (https://docs.agora.finance/api/authentication.md L5-73). So you need an onboarded Agora org. There is **no documented self-serve signup/sandbox**. UNCERTAIN whether hackathon teams get keys; ask Agora DevRel.
- **Staging:** the live OpenAPI spec `https://api.agora.finance/v0/openapi.json` lists `servers: [Production https://api.agora.finance, Staging https://api.agorafi.co]`. CONFIRMED that it's listed. `https://api.agorafi.co/v0/metrics` returned a Cloudflare **302** in my test, so it's gated. UNCERTAIN how to get access.
- **The API does not offer:** consumer on/off-ramp, KYC, or retail payouts. Routes are institutional mint/redeem with settlement instructions. Instant Settlement is a fixed-price swap "for verified users" (https://docs.agora.finance/instant-settlement.md). CONFIRMED from the docs index.
- **Ignore `docs.agoraai.tech` / `core-dev.agoraai.tech`.** That's a different company (AGORA-AI-Software), and so is agora.io.
- **AUSD on Monad testnet (10143):** `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`, with faucet `0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C` (contract-deployments "Testnet Deployments" row "Monad Testnet"). Bytecode exists on `testnet-rpc.monad.xyz` (verified). CONFIRMED.
  - The faucet guide is written for Sepolia (`requestFunds(address)`). Whether the Monad-testnet faucet has the same ABI is UNCERTAIN.
- **Bounty text:** "Build a mobile app letting users send AUSD across borders using Mera passkey onboarding and instant settlement". This is from a participant's repo, not the official page. UNCERTAIN. Check hackathon.monad.xyz.

## 7. Phone OTP for India

- **Twilio SMS to India** (https://www.twilio.com/en-us/guidelines/in/sms). CONFIRMED:
  - "International: No DLT registration is required. Messages are transmitted via ... ILDO connections ... random ILDO-approved short codes ... bypass India's Do-Not-Disturb (DND) database".
  - "Domestic: Completion of company and Sender ID registration within the mobile operators' DLT portal is necessary". Domestic alphanumeric provisioning takes about 10 business days.
  - "Any Alphanumeric Sender ID sent to Indian mobile subscribers will be overwritten with a random short number" (on the international route).
  - Verify defaults to Twilio's generic senders, so a demo **will not be blocked by DLT**. Deliverability on the international route is lower (vendor claim of 85-90%, UNCERTAIN).
  - Trial accounts can only send to verified numbers. That's general Twilio behavior, UNCERTAIN / not re-checked.
- **Twilio WhatsApp OTP** (https://www.twilio.com/docs/verify/whatsapp). CONFIRMED:
  - "Effective March 1, 2024, you must bring your own brand and phone number (Sender)". You need a WhatsApp Business Account sender approved via Meta, so it isn't instant for a hackathon.
  - Once set up, it's a one-word channel switch (`channel: 'whatsapp'`).
- **Firebase Phone Auth** (https://firebase.google.com/docs/auth/web/phone-auth). CONFIRMED:
  - "Test with fictional phone numbers": you can test "without sending an actual SMS message" and without using quota. That's the best option for a stage demo.
  - India delivery of real SMS has community-reported issues (firebase-talk thread). UNCERTAIN / anecdotal.
  - On RN/Expo, `@react-native-firebase/auth` also needs a dev build.
- **Demo recommendation:** use Twilio Verify SMS (international route, no DLT) or Firebase test numbers for the live demo. Don't depend on WhatsApp OTP unless a WABA sender is already approved.
