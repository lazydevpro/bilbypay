# BilbyPay — Spec & Plan

> UPI-style payments for the world: send dollars to any phone number, settled on Monad in ~0.6s.

- **Hackathon:** Monad Metropolis — **Track 02: Consumer Products & Payments**
- **Deadline:** 2026-10-13 11:59 PM ET (judging Oct 14–27, winners Nov 3)
- **Team:** solo
- **Research:** `reports/` and `research_notes/` (tracks, bounties, Monad tech, SIM-swap/UPI risk check)

---

## 1. Problem

Sending money across borders to friends and family is still slow, expensive, and app-fragmented.
UPI proved that "pay a phone number" is the right UX — but it only works inside India, in rupees,
between Indian bank accounts. Crypto wallets can move dollars globally in seconds, but they make
people copy 42-character addresses, hold gas tokens, and back up seed phrases.

## 2. Users

- **Primary:** people sending small-to-medium USD amounts to friends/family in another country
  (diaspora remittance, splitting costs with friends abroad, gifts).
- **Recipient:** anyone with a phone number — may never have used crypto, may not have the app yet.
- Per Track 02: the user "may not identify as a crypto user". **No crypto words in the UI.**

## 3. Product principles

1. **Phone number = handle, passkey = key.** The number is only used to *find* someone (like UPI's
   NPCI mapper). Money moves only with a passkey signature (like UPI's device binding + PIN).
   SMS OTP **never** authorizes a payment or account recovery.
2. **Dollars only.** Users hold and see USD (AUSD). They never need MON; a relayer pays gas.
3. **Pay anyone.** Sending to a number that hasn't signed up works — funds wait in escrow and
   refund automatically if unclaimed.
4. **Feels like a message.** Share a claim link into iMessage / WhatsApp / anything with a rich preview.

## 4. Scope

### In (MVP, must ship)
- Phone OTP verification + passkey account (mera) on a mobile app.
- Send USD to a phone number:
  - registered → direct gasless AUSD transfer (EIP-3009) via relayer;
  - unregistered → escrow keyed to the number, with expiry + refund.
- Claim flow: open link → verify OTP → create passkey → funds land.
- Share sheet claim link with OG preview ("Arjun sent you $20").
- Activity feed (sent / received / pending / refunded).
- Rebind safety: if a number was re-bound to a new account recently, warn the sender / hold funds.
- Deployed on **Monad mainnet** with real transactions (testnet fallback).

### Stretch (only if MVP is done)
- Cross-chain top-up via Aurora Intents (bounty).
- Envio HyperIndex for the activity feed (bounty).
- WhatsApp bot / iMessage extension (mock in demo if not built).
- Request money / split bill.

### Out
- Fiat on/off-ramp, KYC, card, yield, multi-currency, fraud ML.

## 5. Acceptance criteria

- [ ] A fresh user can install the app, verify a phone number, and create a passkey account in < 60s, never seeing a seed phrase, address, or "gas".
- [ ] Sending $X to a registered number moves AUSD on Monad mainnet and the recipient's balance updates in < 2s end-to-end.
- [ ] Sending to an unregistered number escrows funds; recipient claims via link on a **different device** and receives funds; sender sees status change.
- [ ] Unclaimed escrow can be refunded to sender after expiry.
- [ ] User wallet holds **0 MON** throughout; all gas paid by relayer.
- [ ] Clearing app storage mid-demo and signing back in with the passkey recovers the same account (mera "stateless test").
- [ ] Re-binding a number to a new account triggers a visible warning / hold for senders within the cooldown window.
- [ ] Public GitHub repo, OSI license, README with "Why Monad", contract addresses, tx hashes, AI-tool disclosure.
- [ ] Demo video ≤ 3 min + pitch video ≤ 2 min + live link.

## 6. Architecture

```
┌─────────────── Mobile app (Expo dev build, React Native) ───────────────┐
│  mera passkey (PRF → EOA)  ·  viem  ·  OTP screens  ·  share links     │
└───────────────┬──────────────────────────────────────┬──────────────────┘
                │ signed EIP-3009 / EIP-712 payloads   │ OTP verify
                ▼                                      ▼
┌──────────── Backend (Node/TS) ────────────────────────────────────────┐
│  OTP (Twilio Verify / Firebase test numbers)                          │
│  phoneKey = HMAC(pepper, E.164)   ← raw numbers never on-chain        │
│  Verifier: signs EIP-712 attestations (phoneKey ↔ address)            │
│  Relayer EOA (> 10 MON): submits txs, tight gas limits               │
│  Claim-link service + OG image                                        │
└───────────────┬───────────────────────────────────────────────────────┘
                ▼
┌──────────── Monad mainnet (chain 143) ────────────────────────────────┐
│  BilbyDirectory: phoneKey → address, boundAt; rebind needs attestation│
│  BilbyEscrow: depositWithAuthorization → claim(attestation) / refund  │
│  AUSD 0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a (6 dp, EIP-3009 ✓)   │
└───────────────────────────────────────────────────────────────────────┘
```

### Contracts (Foundry)
- **BilbyDirectory**
  - `bind(phoneKey, account, issuedAt, sig)` — verifier-signed EIP-712 attestation; stores `account`, `boundAt`.
  - `resolve(phoneKey) → (account, boundAt)`; emits `Bound(phoneKey, account, previous)`.
- **BilbyEscrow**
  - `depositWithAuthorization(token, from, amount, validAfter, validBefore, nonce, sig, phoneKey, expiry)` —
    calls `receiveWithAuthorization` (payee = escrow, front-run safe).
  - `claim(depositId, recipient, attestation)` — verifier attests `phoneKey → recipient`.
  - `refund(depositId)` — after `expiry`, back to sender.
- Registered-recipient sends skip escrow: relayer submits `transferWithAuthorization` directly.

### Verified facts (2026-09-24/25, see `research_notes/UPI on Monad risk check/`)
- Monad: 300ms blocks / 600ms finality; gas charged on **gas limit**; 10 MON reserve rule applies to MON-debiting accounts only.
- AUSD + USDC on Monad support EIP-2612 permit and EIP-3009 (tested on mainnet).
- P256VERIFY precompile at `0x0100` works on mainnet (~6.9k gas).
- mera `@category-labs/mera` v0.2 (preview) supports React Native via `react-native-passkey`; needs Expo **dev build**, iOS 18+/Android 9+, HTTPS domain with AASA + assetlinks.json, `crypto.getRandomValues` polyfill.
- Agora API requires onboarding (no self-serve sandbox); AUSD testnet `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`.

## 7. Bounty targets (verify each on hackathon.monad.xyz before relying on it)

| Bounty | Prize | Fit |
|---|---|---|
| Agora — Best Cross-Border Payments App (T2) | $10,000 | Mobile + mera passkey + AUSD cross-border. Needs Agora API access → contact Agora early. |
| Monad Fdn — Best Mera-Powered UX | $2,500 | mera is the whole account layer; stateless test. |
| Aurora Intents — Any-Chain Liquidity | up to $2,500 | Stretch: cross-chain top-up. |
| Envio | $1,000 | Stretch: HyperIndex activity feed. |

Do **not** stack Privy/Dynamic (conflicts with mera as account layer).

## 8. Risks

| Risk | Mitigation |
|---|---|
| mera + Expo passkey/PRF doesn't work on device | Day-1 spike; fallback: mobile web PWA (confirm it counts as "mobile app" for Agora). |
| Agora API access not granted in time | Build on-chain AUSD flow regardless; Agora is bonus. |
| SMS OTP delivery during live demo | Firebase test numbers; pre-recorded demo. |
| SIM swap / recycled numbers | Number is handle only; rebind cooldown + sender warning; escrow expiry. |
| Regulatory framing | Pitch as global cross-border dollars, not India-domestic UPI competitor; don't use "UPI" in product name. |
| Scope creep | Stretch items only after all acceptance criteria pass. |

## 9. Plan (phases, each independently verifiable)

| Phase | Dates | Goal | Verify by |
|---|---|---|---|
| 0. Setup & spikes | Sep 25–27 | Repo, Expo dev build, mera passkey on a real phone; EIP-3009 relay script on mainnet | Passkey creates same address on 2 installs; a relayed AUSD transfer tx hash from a 0-MON account |
| 1. Contracts | Sep 27–Oct 1 | Directory + Escrow + tests, deploy testnet → mainnet | `forge test` green; verified contracts on explorer |
| 2. Backend | Sep 30–Oct 3 | OTP, HMAC phoneKey, verifier attestations, relayer, claim links | curl/e2e script: send → escrow → claim |
| 3. App | Oct 2–Oct 8 | Onboarding, home/balance, send, claim, activity, share | Full flow on two phones, no crypto words visible |
| 4. Polish & safety | Oct 8–10 | Rebind warning, refunds, errors, design pass | Acceptance criteria checklist |
| 5. Stretch | Oct 9–11 | Envio feed, Aurora top-up (if time) | Bounty checklists |
| 6. Submission | Oct 11–13 | README, videos, deploy, submit | Submitted before 11:59 PM ET Oct 13 |
