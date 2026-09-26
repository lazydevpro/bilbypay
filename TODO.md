# BilbyPay — TODO

Spec & plan: [docs/plans/2026-09-25-bilbypay-spec.md](docs/plans/2026-09-25-bilbypay-spec.md)
Deadline: **2026-10-13 11:59 PM ET** · Track 02 (Consumer & Payments) · Monad mainnet (chain 143)

Legend: `- [ ]` open · `- [~]` in progress · `- [x]` done · `#tags` = area

## Now
- [ ] Register domain (`bilbypay.com` was unregistered on 2026-09-25) #admin
- [ ] Claim sponsor perks: Tenderly Pro, Quicknode, Zerion #admin
- [ ] Read official rules modal + Agora/Mera bounty pages on hackathon.monad.xyz; resolve rubric/open-source conflicts #admin
- [ ] Email/DM Agora for API key + staging access (cross-border bounty) #admin
- [ ] Spike: Expo dev build + `@category-labs/mera` react-native client; create passkey on a real iPhone (iOS 18+) and Android; same address after reinstall #app #spike
- [ ] Spike: script that signs EIP-3009 `transferWithAuthorization` for AUSD from a 0-MON account and relays it on mainnet #contracts #spike
- [ ] Apply to Bitrefill Business / partner program (KYB via SumSub); ask: discounts/rev-share, KYB time, webhook signing, idempotency, P2P gifting from a crypto app #admin #giftcards
- [ ] Pre-fund the Base USDC float (~$50) for Laso demo purchases (users never touch Base) #admin #giftcards
- [ ] Spike: buy one real $5 card via Laso x402 (wallet sign-in → search → 402 quote → pay) and confirm code/PIN/URL in response #giftcards #spike
- [x] Spike: Burrow on Monad testnet — 20 unit tests + mainnet fork test (real AUSD/stataAUSD) + live testnet run: auto-save $140→$40 balance/$100 Burrow, then $100 payment = $60 break + pay in ONE tx; user held 0 MON, sent 0 txs (addresses + hashes in `contracts/README.md`) #burrow #spike
- [ ] Decide feature name (working name "Burrow"; avoid "FD") #burrow

## Next
### Contracts #contracts
- [x] Foundry project in `contracts/` (OZ 5.4, submodules)
- [ ] `BilbyDirectory`: EIP-712 verifier-signed bind, `resolve`, `boundAt`, `Bound` event
- [ ] `BilbyEscrow`: `depositWithAuthorization` (receiveWithAuthorization), `claim` with attestation, `refund` after expiry — **payer (`from`) must be the first argument** so BilbyRouter can allow-list it
- [ ] `BilbyEscrow` deposit `kind`: `TRANSFER` (→ recipient) vs `GIFT` (→ treasury on claim, emits `giftId`)
- [ ] Tests: happy paths, bad sigs, replay, expiry, double-claim, rebind, fork test against mainnet AUSD
- [ ] Deploy to testnet (AUSD testnet `0xa9012a…22dC`), then mainnet; verify on explorer
- [ ] Record contract addresses + tx hashes in README

### Backend #backend
- [ ] Node/TS service in `server/`
- [ ] OTP: Twilio Verify (intl route, no DLT) + Firebase test numbers for demo
- [ ] `phoneKey = HMAC(pepper, E.164)`; never store/emit raw numbers on-chain
- [ ] Verifier key: EIP-712 bind/claim attestations
- [ ] Relayer EOA (> 10 MON), tight gas limits (estimate + ~7.5%), nonce management
- [ ] Endpoints: `/otp/start`, `/otp/verify`, `/resolve`, `/send`, `/claim`, `/refund`, `/activity`
- [ ] Claim links + OG preview image ("Name sent you $20")
- [ ] Rebind cooldown: flag numbers re-bound within N days; sender warning / hold

### Gift cards #giftcards
- [ ] `GiftCardProvider` interface (catalog, quote, purchase, getRedemption) + `MockProvider` for dev/tests
- [ ] `LasoProvider`: wallet sign-in (`/auth`), `/search-gift-cards`, `/order-gift-card` with x402 USDC payment on Base; verify signed webhooks
- [ ] `BitrefillProvider` (build when access lands): `POST /v2/invoices` (balance, auto_pay, no email) → `GET /v2/orders/{id}` `redemption_info`; verify real product IDs + base URL
- [ ] Catalog endpoint: brands by recipient country, USD ranges, brand images; cache; hide Amazon in demo (resale-lock risk)
- [ ] Send-a-gift: AUSD → `BilbyEscrow` gift deposit (brand intent + USD amount + design/message), share claim link
- [ ] Claim-a-gift: OTP → passkey → optional brand pick → verifier attests → escrow releases to treasury → provider purchase → reveal code
- [ ] Buy-for-self: one tap + Face ID → pay from balance → buy instantly from pre-funded float → card in < 3s
- [ ] Auto-refund to balance if provider purchase fails after payment (plain-language message + "pick another brand")
- [ ] Pre-check float/provider availability before showing Buy; mark brand "temporarily unavailable" instead of failing after payment
- [ ] Lock the dollar price at checkout; fold provider fee into one price (or one "service fee" line)
- [ ] Idempotency: one purchase per `giftId` (DB unique constraint; store provider order id before reveal)
- [ ] Encrypt codes/PINs at rest; reveal only to authenticated owner; never log
- [ ] Quote = face value + provider fee + buffer; on price/stock change at claim, let recipient pick another brand
- [ ] Unclaimed gift expiry → escrow refund to sender (no card bought)
- [ ] Base USDC float + Bitrefill balance: balance check, low-balance alert, background rebalancing (manual for demo)
- [ ] README: gift card providers, buy-at-claim design, production path (Bitrefill)

### Burrow (auto-save, breakable any time) #burrow
- [x] `BilbyRouter.topUpAndCall`: stataAUSD permit → `withdraw(shortfall, user, user)` → allow-listed payment call (AUSD 3009 or escrow deposit) in one tx
- [x] `BilbyRouter.sweep(user)`: move balance above user's signed threshold into stataAUSD (receiver = user only)
- [x] `BilbyRouter.breakToBalance` + `addToBurrow` + enable/disable auto-save (AUSD permit allowance + EIP-712 threshold; disable = allowance 0)
- [x] Router tests: fork test vs mainnet stataAUSD/AUSD, break+pay atomicity, sweep never below threshold (fuzz), allowance-abuse guard, replay/expiry, liquidity cap, permit front-run
- [ ] Router: `lockCalls()` + escrow allow-list before mainnet deploy; mainnet deploy + verify
- [ ] Keeper: watch incoming AUSD transfers → debounce → relay `sweep`
- [ ] Backend: `maxWithdraw` check before offering "Take from Burrow"; partial-availability message
- [ ] Balance API: balance + Burrow (`convertToAssets`) + earned since deposit + current rate
- [ ] Escrow never swept into Burrow
- [ ] Disclosure copy (variable rate, can go down, smart-contract risk); never "FD/fixed deposit/interest/savings/guaranteed"

### App #app
- [ ] Onboarding: phone → OTP → passkey (mera) — no seed phrase, no address shown
- [ ] Home: USD balance, Send / Receive, activity
- [ ] Send: contacts picker + number input, amount in USD, confirm with passkey (signing session)
- [ ] Share sheet with claim link (iMessage / WhatsApp / any)
- [ ] Claim screen from deep link (works on a fresh device)
- [ ] Activity: sent / received / pending / refunded
- [ ] Rebind warning UI
- [ ] Gift cards: brand catalog, pick amount + design + message, send to contact or buy for self
- [ ] Gift cards tab: native card view (brand art, code, PIN, barcode), one-tap copy, "Open in brand app"
- [ ] Gift claim screen from link (sign in → optional brand pick → card appears; no email, no hosted page)
- [ ] Burrow: set/change auto-save threshold, Add to Burrow, Move to balance, "earned $x" + rate, disclosure sheet
- [ ] Confirm sheet: "You have $X available. Take $Y from Burrow?" → one Face ID (both signatures in one mera session)
- [ ] Copy pass against the spec §3a glossary: zero crypto words anywhere (chain, Base, gas, token, transaction, hash, swap, bridge, wallet, address, stake, APY, sign)
- [ ] Every money action = one button + Face ID; no multi-step approve/confirm
- [ ] Receipts: amount, who, when, reference number; chain details only behind a hidden "technical details" row
- [ ] Human error messages with a next step for every failure path; double-tap safe everywhere
- [ ] Success state as soon as payment is final (~0.6s); no block/confirmation language
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
- [ ] OSI license (MIT)
- [ ] Repo access for judges: make github.com/lazydevpro/bilbypay public (or grant metropolis@hackathon.monad.xyz) before Oct 13
- [ ] Demo video ≤ 3 min (real mainnet txs) + pitch video ≤ 2 min + optional 30s ad
- [ ] Logo (bilby 🐰) + live link
- [ ] Submit Track 02 + bounties (Agora cross-border, Mera UX; + Envio/Aurora if built)

## Later (stretch — only after all acceptance criteria pass)
- [ ] Envio HyperIndex for activity feed #stretch #bounty
- [ ] Aurora Intents cross-chain top-up #stretch #bounty
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
