# BilbyPay — Spec & Plan

> UPI-style payments for the world: send dollars **or a gift card** to any phone number, settled on
> Monad in ~0.6s — and idle dollars quietly earn while you hold them.

_Rev 2 (2026-09-26): added brand gift cards and opt-in yield on idle dollars (Aave v3)._
_Rev 3 (2026-09-26): gift cards via Laso Finance (demo) / Bitrefill Business (production); buy-at-claim flow; Tremendous dropped._
_Rev 5 (2026-09-26): Earn → **Burrow**: auto-save threshold, break any time, break-and-pay in one tx via BilbyRouter._
_Rev 4 (2026-09-26): §3a "It just works" UX rules + plain-language glossary; gift purchase is one tap regardless of which chain the provider settles on._

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
5. **One tap to claim.** Gifts open *inside* BilbyPay from a link — never "check your email", never copy/paste a code.
6. **Dollars you can always spend.** Burrow is opt-in and breakable any time; a payment that needs Burrow money breaks it inside the same payment.
7. **It just works — this is not a crypto app.** Chains, transactions, gas, swaps, bridges, tokens, addresses and
   confirmations are *never* visible. Every flow is: choose → confirm with Face ID → done. All plumbing lives in the backend.

## 3a. "It just works" UX rules

**Every money action is one confirmation.** Buy a gift card, send money, open a gift, add to or break Burrow: the user taps one
button and confirms with Face ID / fingerprint. No second step, no network choice, no "approve" + "confirm" pairs.

**Hidden plumbing (the user never sees or waits for any of this):**
| What happens | How it's hidden |
|---|---|
| Network fees | Paid by BilbyPay's relayer. Price shown = price paid. |
| Provider settles in USDC on Base (Laso) / Bitrefill balance | BilbyPay keeps a **pre-funded Base float / Bitrefill balance**. User pays from their BilbyPay balance on Monad; the card is bought instantly from the float. Treasury rebalancing happens later, in the background. |
| AUSD vs USDC, swaps, bridges | Never shown. Everything is "dollars". Internal conversions/bridging are treasury ops, not user steps. |
| Burrow vs spendable balance | Two simple numbers. If a payment needs Burrow money, the confirm sheet asks "Take $X from Burrow?" and it happens inside the same payment. |
| Escrow, attestations, claims | "Waiting for Maya to open it" / "Opened". |
| Finality / confirmations | Show success as soon as the payment is final (~0.6s). No spinners that mention blocks. |

**Glossary — words we use vs words we never use in the UI:**
| Say | Never say |
|---|---|
| Balance, dollars, $ | AUSD, USDC, stablecoin, token, MON |
| Account | Wallet, address, 0x… |
| Payment, sent, received | Transaction, tx, hash |
| Receipt / reference number | Transaction hash, explorer link (optional "technical details" hidden in receipt) |
| Confirm with Face ID | Sign, signature, approve |
| Gift card, open gift | Code redemption, voucher claim |
| Waiting to be opened | Escrow, pending claim |
| Burrow, earned $x, "about N% a year" | FD, fixed deposit, stake, yield, APY, Aave, vault, interest, savings, guaranteed |
| Free (no fees shown) or a single "service fee" line | Gas, network fee, slippage, bridge fee |

**Failure handling — nothing gets stuck, money is never lost:**
- If a gift card purchase fails after payment, the money is **returned to the balance automatically** within seconds with a
  plain message ("Starbucks cards are unavailable right now — your $25 is back in your balance. Pick another brand?").
- If the float is too low for a purchase, the brand shows "temporarily unavailable" *before* the user pays — never after.
- Prices are quoted in dollars and locked for the purchase; any provider fee is folded into one clear price.
- Errors are human sentences with a next step, never error codes or chain jargon.
- Every flow is retry-safe: tapping twice never charges twice.

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
- **Brand gift cards (Laso demo → Bitrefill production)** — see §4a.
- **Burrow: auto-save above a threshold, break any time, auto-break when paying (Aave v3)** — see §4b.

### 4a. Gift cards
**Providers** (behind a swappable `GiftCardProvider` interface — catalog, quote, purchase, getRedemption):
- **Demo: Laso Finance** — no signup (wallet sign-in), pay-per-order in USDC on **Base** via **x402**; one call returns
  `redemption_code`, `pin_code`, `redemption_url`. Fee up to ~4.8%, $5–$9,000 per card, signed webhooks. No sandbox →
  real money (~$5.24 per $5 card; budget $30–50).
- **Production: Bitrefill Business API** — crypto-native (prepaid balance topped up with USDC on Base/ETH/Polygon/Arbitrum/
  Solana/BSC), `redemption_info` returns code, PIN, link **and barcode** (`barcode_format`/`barcode_value`), `send_email`
  off by default. Free test products (`test-gift-card-code`, `test-gift-card-link`, `*-fail`) **after** partner approval +
  SumSub KYB. Live catalog (2026-09-26): US 597, PH 420, IN 193, MX 122, NG 88 brands. If approved before Oct 13, switch
  the demo to Bitrefill test products.

**Flow — seamless claim (no email, no hosted page, no copy-paste):**
- **Send a gift to a phone number → buy at claim time.** Sender picks brand (or "recipient's choice"), USD amount, design +
  message; signs AUSD into `BilbyEscrow` as a *gift* deposit (same escrow as money transfers, expiry + refund).
  Recipient taps the BilbyPay link → OTP → passkey → (optionally picks brand) → verifier attests → escrow releases to
  treasury → backend buys the card → app renders it **natively**: brand art, code, PIN, barcode, "Add to Apple Wallet",
  "Open in brand app", one-tap copy. Why at claim time: codes are non-refundable bearer value, so buying late means
  unclaimed gifts refund cleanly and no codes are stranded.
- **Buy for yourself →** one tap + Face ID → paid from BilbyPay balance → card bought instantly from the pre-funded float → card appears in the Gift cards tab (target < 3s). If the provider fails, auto-refund to balance.
- Quote includes provider fee + a small buffer; if brand/price changed at claim, recipient picks another brand for the same USD.
- Idempotency is ours: one purchase per `giftId` (DB unique constraint + provider order id stored before revealing).
- Codes are secrets: encrypt at rest, reveal only to the authenticated owner, never log them.

**Money flow (invisible to the user):** no provider accepts Monad. The user just pays from their BilbyPay balance; under the
hood that's AUSD on Monad → BilbyPay treasury. The backend buys from a **pre-funded USDC float on Base** (Laso x402) or the
Bitrefill balance, so the purchase is instant. The float is rebalanced out-of-band (manually for the demo; CCTP V2
Monad→Base later). Users never see or wait for Base, USDC, bridges or swaps.

**Caveats:** Amazon locks cards it associates with resale — feature Starbucks/Uber/etc. in the demo. Bitrefill docs have
stale product IDs (`amazon-us` → real `amazon_com-usa`) and two base URLs (`api.bitrefill.com` vs `api-bitrefill.com`) —
verify against the live API. Laso has paused its bug bounty and forbids automated/agentic security testing — use the API
normally only. Tremendous was evaluated and dropped (business-only terms, crypto restricted, fiat-only, no raw codes).

### 4b. Burrow — auto-save with instant break (working name; user concept: "breakable FD")
**Behaviour**
- **Auto-save threshold (set once):** "Keep $200 in my balance, tuck the rest into Burrow." Anything above the threshold
  moves into Burrow automatically whenever money arrives. One Face ID to turn it on; one to turn it off.
- **Manual:** "Add to Burrow" / "Move to balance" — one tap + Face ID, any amount, any time. No lock-in, no penalty.
- **Pay more than your balance → break in the same payment:** if a payment/gift card costs more than the balance, the
  confirm sheet says *"You have $40 available. Take $60 from Burrow?"* → Face ID → **one on-chain transaction** pulls exactly
  the shortfall out of Burrow and completes the payment. Nothing else to do.
- Balance screen: **Balance $X · Burrow $Y (earned $Z)**. Variable rate, shown as "earning about N% a year, changes over time".
- Never call it FD / fixed deposit / savings / interest / guaranteed: it isn't fixed-term, rate is variable, principal is at
  smart-contract risk. (Regulatory + trust.)

**Where the money goes:** Aave v3 on Monad via the ERC-4626 wrapper **stataAUSD `0x9e1AcC5BFbf34e2E579763cE14042d957719fE76`**
("Wrapped Aave Monad AUSD", asset = AUSD). Verified on mainnet 2026-09-26: EIP-2612 `permit` + EIP-712 domain
("Wrapped Aave Monad AUSD", v1, chain 143), `deposit`/`withdraw`/`redeem`; totalAssets ≈ $1.12M; 1 share ≈ 1.0076 AUSD.
Pool AUSD free liquidity ≈ $2.17M (2026-09-25). Fallback: stataUSDC `0xC554aFfE2f581F5E0811e0D42D484ECaC5c6B8e2`.

**Contract: `BilbyRouter` (immutable, small, allow-listed targets)**
- `topUpAndCall(user, shortfall, stataPermit, target, data)` — uses the user's stataAUSD `permit` to
  `withdraw(shortfall, receiver = user, owner = user)`, then executes the pre-signed payment in the same tx:
  `AUSD.transferWithAuthorization` (registered recipient) or `BilbyEscrow.depositWithAuthorization` (unregistered / gift).
  Targets are allow-listed; the router never holds funds at rest. Both signatures come from one mera signing session → one Face ID.
- `sweep(user)` — keeper-callable. Moves `AUSD.balanceOf(user) − threshold` into stataAUSD with **receiver = user**
  (funds can only go into the user's own Burrow). Needs a standing AUSD allowance to the router (EIP-2612 permit, signed
  when enabling auto-save) + the user's EIP-712-signed threshold stored on-chain. Disabling = permit allowance 0 + clear threshold.
- `breakToBalance(user, assets, stataPermit)` — manual "Move to balance".
- All gas paid by the relayer. Keeper = backend watcher on incoming AUSD `Transfer` events (debounced).

**Edge cases**
- Before showing "Take from Burrow", check `maxWithdraw(user)` (Aave free liquidity). If short: "Some of your Burrow money is
  busy right now — you can pay $X now" (never fail after Face ID).
- Escrowed money (pending transfers/gifts) is never in Burrow.
- Threshold changes and sweeps are idempotent; a sweep never pushes the balance below the threshold.
- MON staking remains out of scope (dollars-only).

### Stretch (only if MVP is done)
- Cross-chain top-up via Aurora Intents (bounty).
- Envio HyperIndex for the activity feed (bounty).
- WhatsApp bot / iMessage extension (mock in demo if not built).
- Request money / split bill.
- "Dollar gift cards": USD gift with a designed card via our own escrow (no provider needed).
- Yield on escrowed balances (with buffer + disclosure).
- Bitrefill Business provider live (if partner approval lands) + Apple Wallet passes from `barcode_value`.
- CCTP V2 auto top-up of the Base USDC float from Monad treasury.

### Out
- Fiat on/off-ramp, KYC, debit card, MON staking, multi-currency, fraud ML.

## 5. Acceptance criteria

- [ ] A fresh user can install the app, verify a phone number, and create a passkey account in < 60s, never seeing a seed phrase, address, or "gas".
- [ ] Sending $X to a registered number moves AUSD on Monad mainnet and the recipient's balance updates in < 2s end-to-end.
- [ ] Sending to an unregistered number escrows funds; recipient claims via link on a **different device** and receives funds; sender sees status change.
- [ ] Unclaimed escrow can be refunded to sender after expiry.
- [ ] User wallet holds **0 MON** throughout; all gas paid by relayer.
- [ ] Clearing app storage mid-demo and signing back in with the passkey recovers the same account (mera "stateless test").
- [ ] Re-binding a number to a new account triggers a visible warning / hold for senders within the cooldown window.
- [ ] Sender buys a brand gift card for a phone number, pays in AUSD on-chain; recipient taps the link, verifies, and sees the redeemable card **inside BilbyPay** — no email opened, no code copied.
- [ ] A self-purchased gift card appears in the buyer's Gift cards tab with code/PIN rendered natively; retrying never buys twice (one purchase per `giftId`).
- [ ] An unclaimed gift refunds the sender's AUSD after expiry, with no card ever purchased.
- [ ] Setting a $X threshold with one Face ID makes money above $X move into Burrow automatically when it arrives (gasless), never dropping the balance below $X.
- [ ] Paying more than the balance shows "Take $Y from Burrow?"; one Face ID completes the payment in **one on-chain transaction** (break + pay).
- [ ] "Move to balance" breaks any amount instantly; turning auto-save off stops sweeps and revokes the router allowance.
- [ ] Buying a gift card is one tap + Face ID and the card appears in < 3s; the words chain, Base, gas, token, transaction, swap, bridge, wallet or address appear nowhere in the app.
- [ ] A failed gift card purchase automatically returns the money to the balance with a plain-language message.
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
│  Gift cards: GiftCardProvider → Laso (x402, USDC on Base) / Bitrefill │
│    buy-at-claim, codes encrypted at rest, one purchase per giftId     │
│  Burrow keeper: sweeps above threshold; relays topUpAndCall (break+pay)│
└───────────────┬───────────────────────────────────────────────────────┘
                ▼
┌──────────── Monad mainnet (chain 143) ────────────────────────────────┐
│  BilbyDirectory: phoneKey → address, boundAt; rebind needs attestation│
│  BilbyEscrow: depositWithAuthorization → claim(attestation) / refund  │
│  AUSD 0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a (6 dp, EIP-3009 ✓)   │
│  Aave v3 stataAUSD 0x9e1AcC5BFbf34e2E579763cE14042d957719fE76 (4626)  │
│  Gifts: AUSD → BilbyEscrow (gift deposit) → treasury on claim         │
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
  - Deposits carry a `kind`: `TRANSFER` (claim → recipient) or `GIFT` (claim → BilbyPay treasury, then the backend buys the card; `giftId` in the event).
- **BilbyRouter** — Burrow: `topUpAndCall` (break Burrow + pay in one tx), `sweep` (auto-save above threshold), `breakToBalance`. See §4b.
- Registered-recipient sends skip escrow: relayer submits `transferWithAuthorization` directly.

### Verified facts (2026-09-24/25, see `research_notes/UPI on Monad risk check/`)
- Monad: 300ms blocks / 600ms finality; gas charged on **gas limit**; 10 MON reserve rule applies to MON-debiting accounts only.
- AUSD + USDC on Monad support EIP-2612 permit and EIP-3009 (tested on mainnet).
- P256VERIFY precompile at `0x0100` works on mainnet (~6.9k gas).
- mera `@category-labs/mera` v0.2 (preview) supports React Native via `react-native-passkey`; needs Expo **dev build**, iOS 18+/Android 9+, HTTPS domain with AASA + assetlinks.json, `crypto.getRandomValues` polyfill.
- Agora API requires onboarding (no self-serve sandbox); AUSD testnet `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`.
- Gift cards: Laso (x402, USDC on Base, code in response, no sandbox) and Bitrefill Business (codes + barcodes, test products after KYB); no provider accepts Monad directly (`research_notes/Gift cards/crypto_native_alternatives.md`).
- Aave v3 on Monad: stataAUSD/stataUSDC ERC-4626 wrappers; `supplyWithPermit`; instant withdraw limited by pool free cash (`research_notes/Staking and yield options/`).

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
| Laso has no sandbox (real money per test) | Budget $30–50; test with $5 cards; build against a mock provider first. |
| Bitrefill partner approval/KYB may not land before Oct 13 | Apply now; demo on Laso regardless; interface makes the switch a config change. |
| Gift codes are bearer value (theft/leak) | Buy at claim time; encrypt at rest; reveal only to authenticated owner; never log. |
| Price/stock changes between send and claim | Quote with buffer; recipient can pick another brand for the same USD. |
| Brand terms (e.g. Amazon) restrict crypto association | Demo with recipient-choice catalog; don't feature restricted brands in marketing. |
| Aave liquidity crunch / smart-contract / depeg risk on Burrow | Opt-in, check `maxWithdraw` before asking, keep escrow un-deployed, clear disclosure, no "FD/interest/savings" wording. |
| Standing AUSD allowance to BilbyRouter (for auto-save) | Router is immutable + minimal; sweep can only deposit into the user's own Burrow; allowance revoked when auto-save is off; fork tests + invariant tests. |
| Scope creep | Stretch items only after all acceptance criteria pass. |

## 9. Plan (phases, each independently verifiable)

| Phase | Dates | Goal | Verify by |
|---|---|---|---|
| 0. Setup & spikes | Sep 25–27 | Repo, Expo dev build, mera passkey on a real phone; EIP-3009 relay script on mainnet | Passkey creates same address on 2 installs; a relayed AUSD transfer tx hash from a 0-MON account |
| 1. Contracts | Sep 27–Oct 1 | Directory + Escrow + tests, deploy testnet → mainnet | `forge test` green; verified contracts on explorer |
| 2. Backend | Sep 30–Oct 3 | OTP, HMAC phoneKey, verifier attestations, relayer, claim links | curl/e2e script: send → escrow → claim |
| 2b. Gift cards + Burrow | Oct 2–Oct 5 | GiftCardProvider (mock + Laso), buy-at-claim, encrypted code store; BilbyRouter (topUpAndCall, sweep, breakToBalance) + keeper | Real $5 Laso card rendered from API response; one-tx break+pay tx hash on mainnet |
| 3. App | Oct 2–Oct 8 | Onboarding, home/balance, send, claim, gift cards tab + buy flow, Burrow, activity, share | Full flow on two phones, no crypto words visible |
| 4. Polish & safety | Oct 8–10 | Rebind warning, refunds, errors, design pass | Acceptance criteria checklist |
| 5. Stretch | Oct 9–11 | Envio feed, Aurora top-up (if time) | Bounty checklists |
| 6. Submission | Oct 11–13 | README, videos, deploy, submit | Submitted before 11:59 PM ET Oct 13 |
