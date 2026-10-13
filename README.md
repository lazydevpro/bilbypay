# BilbyPay 🐰

**Your number is your wallet.** A mobile wallet on Monad: send dollars or gift cards to any phone number, signed
with your fingerprint or Face ID. No seed phrases, no wallet addresses, no gas tokens.

> Monad Metropolis hackathon · Track 02: Consumer Products & Payments · **live on Monad testnet** · beta, not audited

## Try it

- **Android:** [bilbypay.pages.dev/download/android-passkey](https://bilbypay.pages.dev/download/android-passkey)
  (Mera passkeys) or [/download/android](https://bilbypay.pages.dev/download/android) (test mode, key on the phone)
- **Web, no install:** [bilbypay-app.lazydevpro.workers.dev](https://bilbypay-app.lazydevpro.workers.dev) (test mode)
- Sign up with any phone number; the code is **000000** (no SMS is sent). New accounts get **$100 test dollars**.
- Send to **+1 415 555 0198**, or to any number: people who haven't joined get a claim link.
- Landing page: [bilbypay.pages.dev](https://bilbypay.pages.dev) · API health:
  [bilbypay-api.lazydevpro.workers.dev/health](https://bilbypay-api.lazydevpro.workers.dev/health)
- Contracts (chain 10143), all source-verified on MonadVision: [docs/testnet-v2.md](docs/testnet-v2.md)

Test money only. Gift cards use mock codes and Burrow's savings asset is a stand-in on testnet.

## How it works

- **Your phone number is your handle** — people find you by number, like UPI.
- **Your passkey is your key** — Face ID / fingerprint signs every payment (via [mera](https://www.monad.xyz/blog/introducing-mera)). SMS codes never move money.
- **Dollars only** — balances are USD stablecoin (AUSD); a relayer pays network fees.
- **Pay anyone** — if the recipient hasn't joined yet, funds wait in escrow and refund if unclaimed. Share a claim link over iMessage, WhatsApp, anything.
- **Gift cards** — send a brand gift card to a phone number; the recipient taps the link and opens it inside BilbyPay. No emails, no copy-pasting codes. The card is bought when the recipient claims it and shown natively (code, PIN, barcode). Demo provider: Laso Finance (USDC via x402); production: Bitrefill Business.
- **Burrow** — set a threshold once; money above it is tucked away and earns a variable rate (Aave v3 on Monad). Break it any time, and if you pay more than your balance, BilbyPay takes the difference from Burrow in the same payment — one Face ID.

## Why Monad

- 300 ms blocks / ~600 ms finality → payments are final before the message is read.
- Sub-cent fees → gasless relaying is sustainable.
- EIP-3009 on AUSD/USDC + native P256 (passkey) precompile → no gas token, no seed phrase.

## Repo layout

```
contracts/          Foundry — BilbyDirectory (phone → account), BilbyEscrow (pay anyone), BilbyRouter (Burrow)
packages/core/      shared TS: chains, AUSD/stataAUSD, EIP-3009 + EIP-712 helpers, ABIs, passkey → key derivation
packages/giftcards/ gift card providers: mock, Laso (x402, USDC on Base), Bitrefill Business
packages/topup/     Aurora Intents (NEAR Intents 1Click) top-up from other networks
server/             Node/TS API (Hono + SQLite): OTP, verifier, relayer, actions, claims, gift cards, Burrow keeper
app/                Expo SDK 57 dev-build app: mera passkeys, Expo Router screens, demo mode
indexer/            Envio HyperIndex: activity feed, escrow lifecycle, Burrow positions, protocol stats
site/               landing page, passkey domain (.well-known) and claim-link proxy on Cloudflare Pages
video/              Remotion: the launch film, the 30 s ad and the framed demo walkthrough
docs/               spec & plan, API contract (docs/api.md), runbooks, status
reports/, research_notes/
```

## Develop

```bash
git submodule update --init --recursive
pnpm install
pnpm typecheck && pnpm test          # all TS packages (server tests start their own anvil)
pnpm test:contracts                  # forge test (fork test needs MONAD_RPC_URL)
pnpm --filter @bilbypay/server spike:relay:local   # EIP-3009 relay e2e on a local anvil "Monad"
```

- Run the whole stack locally: [server/README.md](server/README.md) (anvil + `DeployLocal` + `pnpm dev`), then the app
  with `EXPO_PUBLIC_API_URL=http://<your-ip>:8787` — or `EXPO_PUBLIC_API_URL=mock` for the in-app demo.
- Devices, passkey domain and mainnet: [docs/phase-0-runbook.md](docs/phase-0-runbook.md) and
  [docs/launch-checklist.md](docs/launch-checklist.md).

## Status

- **Hosted on Monad testnet** since 2026-10-12: API and keeper on Cloudflare Workers (SQLite Durable Object), web
  app, Android APKs, landing page and claim links. **23/23 live testnet checks** pass against it
  ([docs/testnet-v2.md](docs/testnet-v2.md)); 300+ automated tests across contracts, server and app.
- Recorded end to end on a real Android phone with passkeys: sign-up, a $10 send to a number not on BilbyPay,
  gift cards, Burrow, and a payment Burrow topped up ([docs/demo-walkthrough.md](docs/demo-walkthrough.md)).
- Not yet: mainnet, real gift-card codes, real Burrow yield, iOS (needs an Apple developer account), an audit.
- Acceptance criteria and evidence: [docs/launch-checklist.md](docs/launch-checklist.md). Tasks: [TODO.md](TODO.md) ·
  Spec: [docs/plans/2026-09-25-bilbypay-spec.md](docs/plans/2026-09-25-bilbypay-spec.md).

## AI disclosure

Built with assistance from Claude Code (Anthropic) for research, planning, and code.

## License

[MIT](LICENSE)
