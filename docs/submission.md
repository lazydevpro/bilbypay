# Monad Metropolis submission — BilbyPay

Ready-to-paste answers for the submission form. Deadline: Oct 13, 11:59 PM ET = **Oct 14, 9:29 AM IST**
(check the time on the form itself). Links checked live on Oct 14, 12:40 AM IST.

## Checklist

| # | Item | File / link | Status |
|---|---|---|---|
| 1 | Logo (≤ 3 MB) | `app/assets/icon.png` (1024×1024) | ✅ |
| 2 | Repo, open source, accessible to metropolis@hackathon.monad.xyz | https://github.com/lazydevpro/bilbypay (MIT) | ⚠️ **private**: make it public, or invite that address. History checked: no secrets committed |
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
