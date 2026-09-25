# BilbyPay — TODO

Spec & plan: [docs/plans/2026-09-25-bilbypay-spec.md](docs/plans/2026-09-25-bilbypay-spec.md)
Deadline: **2026-10-13 11:59 PM ET** · Track 02 (Consumer & Payments) · Monad mainnet (chain 143)

Legend: `- [ ]` open · `- [~]` in progress · `- [x]` done · `#tags` = area

## Now
- [ ] Register domain (`bilbypay.com` was unregistered on 2026-09-25) #admin
- [ ] Claim sponsor perks: Tenderly Pro, Quicknode, Zerion #admin
- [ ] Read official rules modal + Agora/Mera bounty pages on hackathon.monad.xyz; resolve rubric/open-source conflicts #admin
- [ ] Email/DM Agora for API key + staging access (cross-border bounty) #admin
- [~] Spike: Expo dev build + `@category-labs/mera` react-native client; create passkey on a real iPhone (iOS 18+) and Android; same address after reinstall #app #spike
  - code done (`app/`, bundles for iOS + Android); remaining: host `.well-known` files on the rpId domain, build dev client, run on devices — [runbook](docs/phase-0-runbook.md) steps A–C
- [~] Spike: script that signs EIP-3009 `transferWithAuthorization` for AUSD from a 0-MON account and relays it on mainnet #contracts #spike
  - `server/scripts/relay-3009.ts` done + passing on local anvil (key-signed and app/passkey-signed); remaining: fund relayer (> 10 MON) and run on mainnet — [runbook](docs/phase-0-runbook.md) step D
- [ ] Apply to Bitrefill Business / partner program (KYB via SumSub); ask: discounts/rev-share, KYB time, webhook signing, idempotency, P2P gifting from a crypto app #admin #giftcards
- [ ] Pre-fund the Base USDC float (~$50) for Laso demo purchases (users never touch Base) #admin #giftcards
- [ ] Spike: buy one real $5 card via Laso x402 (wallet sign-in → search → 402 quote → pay) and confirm code/PIN/URL in response #giftcards #spike
- [ ] Spike: gasless AUSD → stataAUSD deposit, then permit + `withdraw` to the user and pay in one tx on mainnet (stataAUSD permit ✓ verified 2026-09-26) #burrow #spike
- [ ] Decide feature name (working name "Burrow"; avoid "FD") #burrow

## Next
### Contracts #contracts
- [x] Foundry project in `contracts/` (forge-std, `MockAUSD` with EIP-3009 + tests)
- [x] `BilbyDirectory`: EIP-712 verifier-signed bind, `resolve`, `boundAt`, `Bound` event
- [x] `BilbyEscrow`: `depositWithAuthorization` (receiveWithAuthorization), `claim` with attestation, `refund` after expiry
- [x] `BilbyEscrow` deposit `kind`: `TRANSFER` (→ recipient) vs `GIFT` (→ treasury on claim, emits `giftId`)
- [x] Tests: happy paths, bad sigs, replay, expiry, double-claim, rebind, fork test against mainnet AUSD
- [ ] Deploy to testnet (AUSD testnet `0xa9012a…22dC`), then mainnet; verify on explorer
- [ ] Record contract addresses + tx hashes in README

### Backend #backend
- [x] Node/TS service in `server/`
- [x] OTP: Twilio Verify (intl route, no DLT) + Firebase test numbers for demo
- [x] `phoneKey = HMAC(pepper, E.164)`; never store/emit raw numbers on-chain
- [x] Verifier key: EIP-712 bind/claim attestations
- [x] Relayer EOA (> 10 MON), tight gas limits (estimate + ~7.5%), nonce management
- [x] Endpoints: `/otp/start`, `/otp/verify`, `/resolve`, `/send`, `/claim`, `/refund`, `/activity`
- [x] Claim links + OG preview image ("Name sent you $20")
- [x] Rebind cooldown: flag numbers re-bound within N days; sender warning / hold

### Gift cards #giftcards
- [x] `GiftCardProvider` interface (catalog, quote, purchase, getRedemption) + `MockProvider` for dev/tests
- [x] `LasoProvider`: wallet sign-in (`/auth`), `/search-gift-cards`, `/order-gift-card` with x402 USDC payment on Base; verify signed webhooks
- [x] `BitrefillProvider` (built; verify against the live API when access lands): `POST /v2/invoices` (balance, auto_pay, no email) → `GET /v2/orders/{id}` `redemption_info`; verify real product IDs + base URL
- [x] Catalog endpoint: brands by recipient country, USD ranges, brand images; cache; hide Amazon in demo (resale-lock risk)
- [x] Send-a-gift: AUSD → `BilbyEscrow` gift deposit (brand intent + USD amount + design/message), share claim link
- [x] Claim-a-gift: OTP → passkey → optional brand pick → verifier attests → escrow releases to treasury → provider purchase → reveal code
- [x] Buy-for-self: one tap + Face ID → pay from balance → buy instantly from pre-funded float → card in < 3s
- [x] Auto-refund to balance if provider purchase fails after payment (plain-language message + "pick another brand")
- [x] Pre-check float/provider availability before showing Buy; mark brand "temporarily unavailable" instead of failing after payment
- [x] Lock the dollar price at checkout; fold provider fee into one price (or one "service fee" line)
- [x] Idempotency: one purchase per `giftId` (DB unique constraint; store provider order id before reveal)
- [x] Encrypt codes/PINs at rest; reveal only to authenticated owner; never log
- [x] Quote = face value + provider fee + buffer; on price/stock change at claim, let recipient pick another brand
- [x] Unclaimed gift expiry → escrow refund to sender (no card bought)
- [~] Base USDC float + Bitrefill balance: balance check + "temporarily unavailable" done; low-balance alert and rebalancing still manual
- [x] README: gift card providers, buy-at-claim design, production path (Bitrefill)

### Burrow (auto-save, breakable any time) #burrow
- [x] `BilbyRouter.topUpAndCall`: stataAUSD permit → `withdraw(shortfall, user, user)` → allow-listed payment call (AUSD 3009 or escrow deposit) in one tx
- [x] `BilbyRouter.sweep(user)`: move balance above user's signed threshold into stataAUSD (receiver = user only)
- [x] `BilbyRouter.breakToBalance` + enable/disable auto-save (AUSD permit allowance + EIP-712 threshold; disable = allowance 0)
- [x] Router tests: fork test vs mainnet stataAUSD/AUSD, break+pay atomicity, sweep never below threshold, only-own-Burrow invariant, replay/expiry
- [x] Keeper: watch incoming AUSD transfers → debounce → relay `sweep`
- [x] Backend: `maxWithdraw` check before offering "Take from Burrow"; partial-availability message
- [x] Balance API: balance + Burrow (`convertToAssets`) + earned since deposit + current rate
- [x] Escrow never swept into Burrow
- [x] Disclosure copy (variable rate, can go down, smart-contract risk); never "FD/fixed deposit/interest/savings/guaranteed"

### App #app
- [x] Onboarding: phone → OTP → passkey (mera) — no seed phrase, no address shown
- [x] Home: USD balance, Send / Receive, activity
- [x] Send: contacts picker + number input, amount in USD, confirm with passkey (signing session)
- [x] Share sheet with claim link (iMessage / WhatsApp / any)
- [x] Claim screen from deep link (works on a fresh device)
- [x] Activity: sent / received / pending / refunded
- [x] Rebind warning UI
- [x] Gift cards: brand catalog, pick amount + design + message, send to contact or buy for self
- [x] Gift cards tab: native card view (brand art, code, PIN, barcode), one-tap copy, "Open in brand app"
- [x] Gift claim screen from link (sign in → optional brand pick → card appears; no email, no hosted page)
- [x] Burrow: set/change auto-save threshold, Add to Burrow, Move to balance, "earned $x" + rate, disclosure sheet
- [x] Confirm sheet: "You have $X available. Take $Y from Burrow?" → one Face ID (both signatures in one mera session)
- [x] Copy pass against the spec §3a glossary: zero crypto words anywhere (chain, Base, gas, token, transaction, hash, swap, bridge, wallet, address, stake, APY, sign)
- [x] Every money action = one button + Face ID; no multi-step approve/confirm
- [x] Receipts: amount, who, when, reference number; chain details only behind a hidden "technical details" row
- [x] Human error messages with a next step for every failure path; double-tap safe everywhere
- [x] Success state as soon as payment is final (~0.6s); no block/confirmation language
- [ ] HTTPS domain with AASA + assetlinks.json for passkeys

### Verification #qa
- [ ] Run every acceptance criterion in the spec on two physical phones
- [ ] Stateless test: clear storage mid-flow, recover via passkey
- [ ] Confirm user account holds 0 MON throughout
- [ ] Gift card e2e: send to a phone number → claim on another device → code shown natively; retry never buys twice; unclaimed gift refunds
- [ ] Burrow e2e: set threshold → incoming money above it auto-saves; pay more than balance → one-tx break+pay; Move to balance; disable revokes allowance
- [ ] "Grandma test": someone non-crypto buys a gift card and sends $5 with no help; note every word or step that confused them

### Submission #submission
- [ ] README: problem, demo, "Why Monad" (300ms/600ms, EIP-3009 gasless, P256), architecture, addresses, tx hashes, AI-tool disclosure
- [x] OSI license (MIT)
- [ ] Repo access for judges: make github.com/lazydevpro/bilbypay public (or grant metropolis@hackathon.monad.xyz) before Oct 13
- [ ] Demo video ≤ 3 min (real mainnet txs) + pitch video ≤ 2 min + optional 30s ad
- [ ] Logo (bilby 🐰) + live link
- [ ] Submit Track 02 + bounties (Agora cross-border, Mera UX; + Envio/Aurora if built)

## Later (stretch — only after all acceptance criteria pass)
- [~] Envio HyperIndex for activity feed #stretch #bounty — `indexer/` built + tested offline; needs contract addresses and Envio Cloud deploy
- [~] Aurora Intents cross-chain top-up #stretch #bounty — `packages/topup` + server routes + app screen; needs Studio key and one live $5 top-up; USDC lands in the treasury and the server credits AUSD 1:1 (keep the treasury AUSD float funded)
- [ ] WhatsApp bot (or mocked in demo) #stretch
- [ ] iMessage extension #stretch
- [ ] Request money / split bill #stretch
- [ ] Dollar gift cards (USD gift with designed card via our escrow, no provider) #stretch #giftcards
- [ ] Switch demo to Bitrefill test products if partner access lands #stretch #giftcards
- [ ] Apple Wallet pass from Bitrefill `barcode_value` #stretch #giftcards
- [ ] CCTP V2 auto top-up of Base USDC float from Monad treasury #stretch #giftcards
- [ ] Burrow on escrowed balances with 10-20% buffer + disclosure #stretch #burrow
- [ ] Burrow goals ("Trip to Goa" pots) #stretch #burrow

## Done
- [x] Phase 1 contracts: Directory, Escrow (front-run-safe terms nonce), Router (break+pay, sweep); 42 Foundry tests + fork test #contracts
- [x] Phase 2 server: OTP, accounts, verifier, relayer, actions, claims, share links + OG image, Burrow keeper, refunds #backend
- [x] Phase 2b gift cards (mock/Laso/Bitrefill, encrypted, idempotent, buy-at-claim) + Burrow router/keeper #giftcards #burrow
- [x] Phase 3 app: Expo Router screens, one-Face-ID unlock, pre-authorization guard, demo mode, glossary test #app
- [x] App↔server contract test on anvil (app's own client + guard) #qa
- [x] Acceptance-criteria map: docs/launch-checklist.md #qa
- [x] Phase 0 scaffold: pnpm workspace, `packages/core` (chains, EIP-3009, PRF → key derivation, dollars), MIT license #admin
- [x] Relay spike script + local anvil e2e (`pnpm --filter @bilbypay/server spike:relay:local`) #contracts #spike
- [x] Expo SDK 57 dev-build app with mera passkey create / sign-in / sign test payment; `.well-known` templates #app #spike
- [x] Research: Monad hackathons, ecosystem gaps, tech, pitch (`reports/`) #research
- [x] Research: Metropolis tracks, bounties, fast-chain winners (`reports/`) #research
- [x] Risk check: SIM swap/UPI model, mera mobile, gas sponsorship, AUSD EIP-3009, P256 on mainnet #research
- [x] Name: BilbyPay (bilbypay.com unregistered, no payments conflicts found) #admin
- [x] Spec + plan #docs
- [x] Research: Tremendous API (sandbox OK; production blocked by business-only/crypto-restricted terms) #research #giftcards
- [x] Research: no-lock staking/yield on Monad (Aave v3 stata wrappers for USD; shMON only instant LST; native exit ~4-13h) #research #earn
- [x] Spec rev 2: gift cards + Earn #docs
- [x] Research: crypto-native gift card APIs → Laso (demo) + Bitrefill Business (production); Tremendous dropped #research #giftcards
- [x] Spec rev 3: Laso/Bitrefill, buy-at-claim #docs
- [x] Spec rev 4: "It just works" UX rules + glossary #docs
- [x] Verified stataAUSD permit + ERC-4626 on mainnet; spec rev 5: Burrow (threshold auto-save, break-and-pay in one tx) #burrow #docs
- [x] Decision: Burrow auto-save is fully automatic (standing router allowance, revoked when off) #burrow
