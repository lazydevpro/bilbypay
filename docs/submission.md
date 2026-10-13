# Monad Metropolis submission — BilbyPay

Ready-to-paste answers for the submission form. Deadline: Oct 13, 11:59 PM ET = **Oct 14, 9:29 AM IST**
(check the time on the form itself). Links checked live on Oct 14, 12:40 AM IST.

## Checklist

| # | Item | File / link | Status |
|---|---|---|---|
| 1 | Logo (≤ 3 MB) | `app/assets/icon.png` (1024×1024) | ✅ |
| 2 | Repo, open source, accessible to metropolis@hackathon.monad.xyz | https://github.com/lazydevpro/bilbypay (MIT) | ✅ public since Oct 14 (all branches scanned for secrets first) |
| 3 | Demo video (≤ 3 min, the live product) | `video/out/bilbypay-demo.mp4` (2:49, 1080p, your voice) | ✅ upload to YouTube (unlisted) and paste the link |
| 4 | Pitch video (≤ 2 min: you, the problem, why you) | `video/out/bilbypay-launch.mp4` (1:27 product film) | ⚠️ the film has no founder on camera; see *Pitch video* below |
| 5 | Live product on Monad testnet, with access instructions and test credentials | see *Try it* | ✅ |
| 6 | Ad (≤ 30 s, optional) | `video/out/bilbypay-ad-30s.mp4` (0:28) | ✅ |
| | Thumbnails | `video/out/thumbnail-hook.png`, `thumbnail-brand.png` | ✅ |

## Name

BilbyPay

## One-liner

Your number is your wallet.

## Track

Track 02: Consumer Products & Payments

## Bounties

Enter only what we can show; bounty judging weighs sticking to each bounty's published requirements.

- **Mera (UX)**: yes. Mera passkeys are the account layer (one passkey created at sign-up, saved to the phone's
  password manager; fingerprint/Face ID signs). Shown on a real Android phone in the demo. Gap to state plainly:
  we ask for the fingerprint on every payment, by design, not prompt-free session signing.
- **Agora (cross-border)**: optional. We send AUSD-style dollars to any phone number on-chain, but have no Agora
  API integration. If you enter, say so.
- **Envio**, **Aurora Intents**: no. The indexer and the cross-chain top-up are built but not deployed live.

## Short description (~50 words)

BilbyPay is a mobile wallet on Monad where your phone number is your wallet. Send dollars or gift cards to anyone
in your contacts, even if they haven't joined yet. Your fingerprint or Face ID signs every payment. No seed
phrase, no 0x addresses, no gas token, and payments are final on Monad in under a second.

## Full description

**BilbyPay: your number is your wallet.**

Paying a friend in crypto still means asking for a 42-character address, buying a gas token, guarding a seed
phrase and hoping you didn't mistype anything. In India, UPI made paying someone as easy as knowing their phone
number. BilbyPay brings that to stablecoins on Monad.

**How it works**

- **Your phone number is your handle.** A verified number maps to your account in an on-chain directory. People
  find you the way they already do: by your number. Raw phone numbers never go on-chain.
- **Your passkey is your key.** A passkey on your phone (fingerprint or Face ID, via Mera) signs every payment.
  An SMS code can verify a number, but it can never move money.
- **Just dollars.** Balances are a USD stablecoin. A relayer pays network fees, so nobody needs a gas token.
- **Pay anyone, even if they aren't on BilbyPay yet.** Money for someone who hasn't joined waits in escrow and
  they get a claim link over iMessage or WhatsApp. If it isn't claimed, it comes back to you.
- **Gift cards to a phone number.** Pick a brand, an amount and a card design; the recipient opens it inside
  BilbyPay.
- **Burrow.** Money you aren't using can be tucked away to earn a variable rate. If a payment needs more than your
  balance, BilbyPay takes the difference from Burrow in the same payment, with one fingerprint.
- **Bilby,** an animated mascot, reacts as you send, receive, save and gift, so money feels friendly.

**Built for safety, not just convenience**

Before you sign, the app checks the recipient against the on-chain directory. Each payment is tied to the current
owner of that number, so if a number is recycled, older unclaimed payments refund to the sender instead of reaching
a stranger. Moving a number to a new account has a seven-day recovery window the original owner can cancel. A
phone number alone can never spend an existing balance.

**Why Monad**

300 ms blocks and ~600 ms finality mean a payment is final before the recipient reads the message. Sub-cent fees
make gasless relaying sustainable. Passkey (P-256) signatures plus EIP-3009 transfer authorizations make it possible
to have no seed phrase and no gas token.

**What's built**

- Contracts (Foundry): phone directory, escrow and Burrow router, all six source-verified on MonadVision.
- API (Hono on Cloudflare Workers + a SQLite Durable Object): verification, relaying, claims, gift cards, the
  Burrow keeper.
- App (Expo, Android): Mera passkeys, recorded end to end on a real Android phone against Monad testnet.
- 23/23 live testnet checks (recovery, cancellation, refunds, renewal) on top of 300+ automated tests.

**Honest limits:** testnet only; gift cards use mock codes and Burrow's savings asset is a stand-in on testnet;
not audited.

## Try it (access instructions and test credentials)

- **Android app:** https://bilbypay.pages.dev/download/android-passkey (passkeys, as in the demo) or
  https://bilbypay.pages.dev/download/android (test mode, key stored on the phone). 157 MB APK; allow installs
  from your browser.
- **Web app (no install):** https://bilbypay-app.lazydevpro.workers.dev (test mode; the key lives in the browser).
- **Sign-up:** any phone number; the verification code is **000000** (test mode, no SMS is sent).
- New accounts get **$100 test dollars**, so you can send right away.
- A number to send to: **+1 415 555 0198** (Test Friend), or any number; unknown numbers get a claim link.
- Landing page: https://bilbypay.pages.dev · API health: https://bilbypay-api.lazydevpro.workers.dev/health
- Contracts (Monad testnet, chain 10143): see `docs/testnet-v2.md`. Directory
  `0x6CE6a93600D389247971Dd2B0F65ff07FEbE6219`, Escrow `0x65Cf95BA67831B6A75a58eeB91bd99289A25EaAa`, Router
  `0xec93D63127b20b2116d38e176448B515880AaBD9`.

## Pitch video

The form asks for you on camera: the team, the problem, why you. The product film is 1:27, so there's room for
a ~30 s selfie clip before it (2:00 limit). Say, for example: who you are; the problem as you've lived it (sending
money home / paying friends in crypto); why now and why Monad. Send me the clip and I'll join it to the film,
matching levels. If there's no time, submit the film as it is.

## Video titles (YouTube, unlisted)

- **BilbyPay — live demo on Monad testnet (2:49)**: "A real run on an Android phone: sign up with your number, a
  passkey instead of a seed phrase, send $10 to someone not on BilbyPay, gift cards, and Burrow paying the
  difference. Try it: https://bilbypay.pages.dev"
- **BilbyPay — your number is your wallet (1:27)**: "A mobile wallet on Monad where your phone number is your
  wallet. Try the beta: https://bilbypay.pages.dev"

## Keep it running through judging (Oct 14–27)

- Relayer had 4.15 test MON on Oct 14; each payment costs a little. Top it up from the Monad testnet faucet to
  `0x6E743B233A103F804255C31aEECbAE723D93dD4E`, and check https://bilbypay-api.lazydevpro.workers.dev/health.
- The APK links point at EAS build artifacts, which can expire; mirror the APKs to a GitHub release once the repo
  is public.

## AI disclosure

Built with assistance from Claude Code (Anthropic) for research, planning, code, and the launch film; the voiceover
for the launch film generated with Google AI Studio.

## Go-to-market and user acquisition

**Who first:** Indians abroad (students and workers in the US, UK and Gulf) sending money and gifts home. They already
pay by phone number with UPI at home, and their family is one WhatsApp message away. "Send to a phone number" needs
no explanation for them.

**The product is the acquisition loop.** Every payment or gift to someone who isn't on BilbyPay becomes a claim link
sent over WhatsApp or iMessage. To get the money, the recipient signs up with the same number. So senders bring
recipients, and recipients become senders. We track one number above all: the share of claim links that turn into a
new account.

**Gifts lower the barrier.** A $10 Starbucks or Target card for a birthday, Diwali or a thank-you is an easier first
send than "try this crypto app". Gifting seasons (Diwali, Christmas, graduation) are our launch moments.

**Channels, in order:**
1. **Communities we can reach directly:** university Indian student associations and diaspora WhatsApp/Telegram
   groups. One ambassador per campus, plus a small credit for both sides of a first send.
2. **The Monad ecosystem:** testnet users, the Monad community and hackathon networks for the first beta users, with
   AUSD/Agora and Mera as natural partners for co-marketing.
3. **Short-form content** with Bilby the mascot: 15-second "sent $20 home in two seconds, no address" clips.
4. **Gift-card brands and creators:** branded cards and creator gift drops that pull their audiences in by phone
   number.

**Why it's cheap to grow:** no gas token to buy and no seed phrase to explain, so onboarding is a phone number and
a fingerprint. Fees are sub-cent on Monad, so free payments are sustainable. Revenue comes from small fees on gift
cards and cash-out, and from a share of Burrow yield, not from charging people to send.

**Next 90 days:** onboard 50–100 testnet users from two campuses, measure the claim-to-signup rate and time to the
first send, fix what confuses people, then move to mainnet with one corridor (US → India) before adding more.

## Bounty answers

### Mera — "Describe how your project meaningfully integrates Mera as the entire account layer"

Mera is the only account BilbyPay has. There is no seed phrase, no password, no email and no server-held key.

- **Sign-up is one passkey ceremony.** After verifying a phone number, the app calls Mera's
  `createPasskeyWithPrfOutput` (React Native WebAuthn client, relying party `bilbypay.pages.dev`). The passkey is saved
  to the phone's password manager and unlocked with a fingerprint or Face ID. Its PRF output deterministically
  derives the account's secp256k1 key, and the account address comes from Mera's `getEvmAddress`. The phone number
  is then bound to that address in our on-chain directory.
- **Every payment is signed through Mera.** Sends, claim-link payments, gift cards, adding to Burrow and the
  "pay more than you have" Burrow top-up all sign EIP-3009 / EIP-712 authorizations with a Mera
  `createSecp256k1SigningSession`, exposed to viem via `toViemAccount`. One fingerprint opens the session for one
  action; everything that action needs (for example breaking Burrow and paying in one transaction) is signed inside
  it without further prompts, then the session ends and the key is wiped from memory. A relayer submits the
  transaction and pays gas, so the user never holds MON.
- **Stateless by design.** The app stores nothing it can't lose. On a new phone or after a reinstall, "I already
  have an account" calls Mera's `getPasskeyPrfOutput`; the OS offers the synced passkey and the same PRF output gives
  back the same account and balance. A fingerprint-gated copy of the secret on the device only saves a step; if it's
  missing or biometrics change, the app falls back to the passkey automatically.
- **Safety around the passkey.** If someone picks a passkey that belongs to a different BilbyPay account, the app
  refuses to sign. Mera errors are turned into plain words ("Cancelled. Nothing was sent.", "This phone's passkeys
  can't be used with BilbyPay yet"). An SMS code can verify a number but can never move money: only the passkey can.
- **The UX is the point.** Users never see "wallet", "key", "gas" or an address. The confirm button says "Confirm
  with your fingerprint", and the whole flow, from sign-up to a payment to someone not yet on BilbyPay, is shown on a
  real Android phone against Monad testnet in our demo video.

Honest notes: we ask for a fingerprint per payment on purpose (it's money), rather than a long-lived session; signing
within that one action is prompt-free. Android is tested on a real phone; iOS needs an Apple developer account for
the associated domain. Code: `app/src/account.ts`, `app/src/auth/unlock.ts`.

### Agora (cross-border)

BilbyPay sends dollars to a phone number in any country. The sender signs once with a passkey, the payment is final on
Monad in under a second, and a recipient who hasn't joined gets a claim link and signs up with the same number. Our
first corridor is US → India. Balances are AUSD, the dollar Agora issues; on testnet a stand-in with the same
EIP-3009 interface.

**Built against Agora's API** (`server/src/agora/`, typed from Agora's published OpenAPI spec):
- **Live now, no key needed:** `GET /v1/agora/metrics` serves Agora's public `/v0/metrics`: AUSD supply in total and
  per network, with Monad highlighted (on Oct 14: $104.35M circulating on Monad, the largest network Agora lists). It
  is cached for 5 minutes and served stale for up to an hour if Agora is down. The Add money screen shows it: "Your
  dollars are issued by Agora, with $187 million in use worldwide."
- **Coded and tested, needs an Agora API key:** API-key → session-token exchange with caching and retry; mint routes
  into AUSD on Monad (settlement instructions for fiat or stablecoin in), redeem routes, and transactions. Exposed as
  `GET /v1/agora/mint-instructions` and `/v1/agora/routes/:id` for signed-in users. Without a key they return
  "not configured" and never call Agora. Staging can be targeted with `AGORA_API_BASE`.
- **Where Agora fits:** money in (fiat or stablecoins → AUSD on Monad via mint routes) and money out (redeem), with
  BilbyPay handling everything between: phone-number sends, claim links, gift cards and Burrow.

Honest limits: we have no Agora API key yet, so the authenticated calls have only run against a mocked Agora (11 tests).
Code: `server/src/agora/client.ts`, `server/src/agora/service.ts`, `server/src/routes/agora.ts`, `server/test/agora.test.ts`.

### Aurora Intents (any-chain liquidity)

Users top up their BilbyPay balance with USDC from another network, through NEAR Intents' 1Click swap API (the
protocol behind Aurora Intents).

- In the app: **Add money → Add from another account**. Pick where the money is (for example USDC on Arbitrum or
  Base), enter an amount, and the app shows a one-time deposit address with live status: waiting → on its way → added.
- The intent swaps to **real USDC on Monad mainnet**, delivered to the BilbyPay treasury
  (`0xC9f2F2533A8698377CF4aA3bf0Bd515B03a57a51`). The server checks the delivery on chain and credits the user's
  balance 1:1. On testnet it credits test dollars, capped at $25 per top-up. Credits are idempotent (one per delivery
  transaction) and use the smaller of the reported and the actually received amount. Refunds go back to the sender
  on the origin network.
- **Live, not mocked:** the hosted API uses the 1Click backend with no key (`TOPUP_PROVIDER=oneclick`). Real quotes
  on Oct 14: $5 USDC on Arbitrum → 4.988 USDC on Monad, ETA 27 s; from Base, ETA about an hour. The provider also
  supports Aurora's hosted Intents API (`intents-api.aurora.dev`) once a Widget Studio key is set.
- Settlement runs in the Cloudflare Durable Object's alarm, so top-ups complete even if the app is closed.

Honest limits: proven with live quotes and deposit addresses. A completed real deposit is the last step.
Code: `packages/topup/`, `server/src/topup.ts`, `app/src/app/topup-other.tsx`.

### Envio (HyperIndex)

`indexer/` is an Envio HyperIndex indexer for BilbyPay on Monad: phone bindings and recovery, phone-number escrow (sends,
gifts, claims, refunds, cancellations), Burrow savings moves, and every dollar movement of BilbyPay accounts, rolled
up into an activity feed, per-account stats, a contact graph and daily/global protocol stats.

- **Pointed at the live v2 testnet contracts** (chain 10143, from block 67216804). Accounts are registered at runtime
  from directory and escrow events, so token events are matched as wildcards on BilbyPay users only, not the whole
  token.
- **Checked against real chain data:** the indexer's ABIs decoded 75 real v2 transactions (Bound, BindingUpdated,
  Recovery*, Deposited, Claimed, Refunded, Cancelled, Swept, Broken, Added, token transfers and vault deposits/
  withdrawals). A local `envio start` run over the first 1,500 blocks produced 25 activity items covering sends,
  gifts, refunds and Burrow moves.
- **Used in a core screen:** the app's Activity tab reads the indexer's GraphQL feed when `EXPO_PUBLIC_INDEXER_URL`
  is set, merges it with the API's rows (keeping names, notes and cancel actions) and falls back to the API on any
  error.
- 30 indexer tests (handler simulations), 9 app tests including one that keeps the app's query identical to
  `indexer/queries/activity.graphql`.

Hosted endpoint: see `indexer/README.md` (Envio Cloud, root `indexer/`, branch `main`).
Code: `indexer/config.yaml`, `indexer/src/`, `app/src/api/indexer.ts`, `app/src/app/(tabs)/activity.tsx`.
