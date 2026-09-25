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

## Repo layout (planned)

```
contracts/   Foundry — BilbyDirectory, BilbyEscrow
server/      Node/TS — OTP, verifier, relayer, claim links
app/         Expo (React Native) — mobile app
docs/plans/  spec & plan
reports/     research reports
research_notes/
```

## Status

See [TODO.md](TODO.md) and the [spec](docs/plans/2026-09-25-bilbypay-spec.md).

## AI disclosure

Built with assistance from Claude Code (Anthropic) for research, planning, and code.

## License

MIT (to be added).
