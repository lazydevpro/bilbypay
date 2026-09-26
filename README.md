# BilbyPay 🐰

**UPI-style payments for the world.** Send dollars or gift cards to any phone number — settled on Monad in ~0.6 seconds.
No seed phrases, no wallet addresses, no gas tokens.

> Monad Metropolis hackathon · Track 02: Consumer Products & Payments · work in progress

## How it works

- **Your phone number is your handle** — people find you by number, like UPI.
- **Your passkey is your key** — Face ID / fingerprint signs every payment (via [mera](https://www.monad.xyz/blog/introducing-mera)). SMS codes never move money.
- **Dollars only** — balances are USD stablecoin (AUSD); a relayer pays network fees.
- **Pay anyone** — if the recipient hasn't joined yet, funds wait in escrow and refund if unclaimed. Share a claim link over iMessage, WhatsApp, anything.
- **Gift cards** — send a brand gift card to a phone number; the recipient taps the link and opens it inside BilbyPay. No emails, no copy-pasting codes. The card is bought when the recipient claims it and shown natively (code, PIN, barcode). Demo provider: Laso Finance (USDC via x402); production: Bitrefill Business.
- **Burrow** — set a threshold once; money above it is tucked away and earns a variable rate (Aave v3 on Monad). Break it any time, and if you pay more than your balance, BilbyPay takes the difference from Burrow in the same payment — one Face ID.

## Why Monad

- 300ms blocks / 600ms finality → payments are final before the message is read.
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

## Deployments

- **Monad testnet (10143):** BilbyDirectory `0x246fa171ff0AE45a34Bb88E4E07E04f44CB75Ae7`, BilbyEscrow
  `0x623Fa426793aDf2E61BCc50D269E7CaFfBc16aba`, BilbyRouter `0xa0c141F6465eDaA2E7A2483a310Ac72830986cb0`
  (with mock dollars; details and test transactions in [docs/testnet.md](docs/testnet.md)).
- **Monad mainnet (143):** not yet.

## Status

Phases 0–5 are implemented and tested locally; see [docs/launch-checklist.md](docs/launch-checklist.md) for each
acceptance criterion's evidence and what still needs a real phone, mainnet funds or provider accounts.
Tasks: [TODO.md](TODO.md) · Spec: [docs/plans/2026-09-25-bilbypay-spec.md](docs/plans/2026-09-25-bilbypay-spec.md).

## AI disclosure

Built with assistance from Claude Code (Anthropic) for research, planning, and code.

## License

[MIT](LICENSE)
