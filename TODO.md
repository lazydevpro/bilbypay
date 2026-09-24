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

## Next
### Contracts #contracts
- [ ] Foundry project in `contracts/`
- [ ] `BilbyDirectory`: EIP-712 verifier-signed bind, `resolve`, `boundAt`, `Bound` event
- [ ] `BilbyEscrow`: `depositWithAuthorization` (receiveWithAuthorization), `claim` with attestation, `refund` after expiry
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

### App #app
- [ ] Onboarding: phone → OTP → passkey (mera) — no seed phrase, no address shown
- [ ] Home: USD balance, Send / Receive, activity
- [ ] Send: contacts picker + number input, amount in USD, confirm with passkey (signing session)
- [ ] Share sheet with claim link (iMessage / WhatsApp / any)
- [ ] Claim screen from deep link (works on a fresh device)
- [ ] Activity: sent / received / pending / refunded
- [ ] Rebind warning UI
- [ ] Copy pass: zero crypto words ("dollars", not "AUSD/tokens/gas")
- [ ] HTTPS domain with AASA + assetlinks.json for passkeys

### Verification #qa
- [ ] Run every acceptance criterion in the spec on two physical phones
- [ ] Stateless test: clear storage mid-flow, recover via passkey
- [ ] Confirm user account holds 0 MON throughout

### Submission #submission
- [ ] README: problem, demo, "Why Monad" (300ms/600ms, EIP-3009 gasless, P256), architecture, addresses, tx hashes, AI-tool disclosure
- [ ] OSI license (MIT)
- [ ] Demo video ≤ 3 min (real mainnet txs) + pitch video ≤ 2 min + optional 30s ad
- [ ] Logo (bilby 🐰) + live link
- [ ] Submit Track 02 + bounties (Agora cross-border, Mera UX; + Envio/Aurora if built)

## Later (stretch — only after all acceptance criteria pass)
- [ ] Envio HyperIndex for activity feed #stretch #bounty
- [ ] Aurora Intents cross-chain top-up #stretch #bounty
- [ ] WhatsApp bot (or mocked in demo) #stretch
- [ ] iMessage extension #stretch
- [ ] Request money / split bill #stretch

## Done
- [x] Research: Monad hackathons, ecosystem gaps, tech, pitch (`reports/`) #research
- [x] Research: Metropolis tracks, bounties, fast-chain winners (`reports/`) #research
- [x] Risk check: SIM swap/UPI model, mera mobile, gas sponsorship, AUSD EIP-3009, P256 on mainnet #research
- [x] Name: BilbyPay (bilbypay.com unregistered, no payments conflicts found) #admin
- [x] Spec + plan #docs
