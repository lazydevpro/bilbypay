# Launch checklist: acceptance criteria and remaining steps

Status as of 2026-09-25. Everything is verified **locally** in the dev container:
- Contracts: 42 Foundry tests; the mainnet fork test needs `MONAD_RPC_URL`.
- TypeScript: 222 tests across 6 packages.
- App: iOS and Android bundles build.

What is still missing is anything that needs a real phone, Monad mainnet, SMS, or live provider accounts.

## Spec §5 acceptance criteria

| # | Criterion | Local evidence | Still needed |
|---|---|---|---|
| 1 | Onboard in < 60s with no seed phrase, address or "gas" | `app` onboarding screens; glossary test scans all copy; `app-contract` onboard | Time it on a phone (passkey + SMS) |
| 2 | Send to a registered number on mainnet, recipient updated in < 2s | `integration` + `app-contract` "send to a registered contact" (one relayed tx) | Mainnet deploy + timing on devices |
| 3 | Unregistered: escrow → claim on a different device → sender sees status | `BilbyEscrow.t.sol`; `integration` + `app-contract` invite/claim | Two phones |
| 4 | Unclaimed escrow refunds after expiry | `test_refundOnlyAfterExpiry`; keeper refund job (`integration`) | — |
| 5 | User holds 0 MON throughout | `integration` "no user ever held MON"; relay spike | Check the account on mainnet |
| 6 | Clear storage, sign back in with the passkey, same account | Deterministic derivation pinned in `packages/core`; mera sign-in path | Phone: delete app → reinstall → sign in (runbook C) |
| 7 | Rebind shows a warning or hold to senders | `BilbyDirectory.t.sol` rebind tests; `integration` "rebind safety"; app confirm screen requires an "I've checked" tick | — |
| 8 | Gift to a phone, opened inside BilbyPay, no email | `integration` gift_send → claim → reveal; app card view | Live provider (Laso $5 smoke) |
| 9 | Self-purchased card appears; retries never buy twice | Unique constraint per giftId + provider idempotency (Laso stored-auth, Bitrefill two-step); tests in `server` and `packages/giftcards` | Live provider |
| 10 | Unclaimed gift refunds with no card bought | Buy-at-claim design; escrow refund tests | — |
| 11 | Auto-save threshold with one Face ID, gasless, never below threshold | `testFuzz_sweepNeverBelowThreshold`; `integration` auto-save + keeper | Phone: confirm one biometric prompt |
| 12 | Pay more than balance: "Take $Y from Burrow?", one tx | `test_breakAndPayInOneTx`; `integration` asserts a single tx; `app-contract` break+pay through the app guard | Mainnet fork test against real stataAUSD (`MONAD_RPC_URL=… forge test --mc ForkTest`) |
| 13 | Move to balance any time; auto-save off revokes allowance | `test_disableRevokesAllowanceAndStopsSweeps`; `integration` | — |
| 14 | Gift card = one tap + Face ID, < 3s, no crypto words | Glossary test (app), banned-word checks (server, topup) | Timing on device with a live provider |
| 15 | Failed purchase refunds automatically with a plain message | `integration` "refunds automatically when the purchase fails" | — |
| 16 | Public repo, OSI license, README with Why Monad, addresses, tx hashes, AI disclosure | MIT `LICENSE`, README | Make the repo public; add addresses + tx hashes after deploy |
| 17 | Demo video ≤ 3 min, pitch ≤ 2 min, live link | — | Record |

## Steps before submission

1. **Domain.** Register `bilbypay.com`, or pick another domain and update `EXPO_PUBLIC_RP_ID` and `app.json`. Host `server/public/.well-known/*` there (see runbook A).
2. **Keys.** Create the deployer, relayer (fund it with > 10 MON), verifier, keeper and treasury keys. Keep the verifier and treasury keys in a secret store.
3. **Deploy.** Run `cd contracts && VERIFIER=… TREASURY=… KEEPER=… forge script script/Deploy.s.sol --rpc-url monad --broadcast`. This writes `deployments/143.json`. Verify the contracts on Monadscan.
4. **Fork test.** Run `MONAD_RPC_URL=https://rpc.monad.xyz forge test --mc ForkTest` to check break+pay against the real stataAUSD.
5. **Server.** Deploy with `server/.env` covering:
   - the addresses and keys from steps 2 and 3;
   - Twilio Verify, or Firebase test numbers for the stage demo;
   - `GIFT_PROVIDER=laso` with a funded Base USDC float;
   - `INTENTS_API_KEY` (Aurora Studio).
6. **Indexer.** Fill in the contract addresses and start block in `indexer/.env`, then deploy to Envio Cloud.
7. **App.** Build with `eas build --profile development` for both platforms and run runbook steps B and C on two phones.
8. **Gift cards.** Run `SMOKE_QUOTE_ONLY=yes` and then the real $5 Laso smoke (`packages/giftcards/README.md`). Apply for Bitrefill Business.
9. **Top-up.** Run `pnpm --filter @bilbypay/topup smoke:quote` with a Studio key, then do one live $5 USDC top-up from Base (Aurora bounty).
   - Today the top-up delivers USDC, not AUSD. Pick one before demoing:
     - AUSD becomes listed by the provider;
     - the server converts the USDC to AUSD after arrival;
     - USDC counts as dollars in the balance.
10. **Demo run.** Walk every row above on two phones and record the demo.

## Known limitations

- **One server instance only.** Nonce queue, locks and the keeper run in memory.
- **Restart during submit.** An action being submitted when the server restarts stays `submitting` and needs manual reconciliation. No money is at risk, because the authorizations can only be used once.
- **Burrow rate.** It falls back to `BURROW_RATE_PERCENT` unless `AAVE_POOL_ADDRESS` is set; that lookup is untested.
- **Indexer gaps.** Transfers made before an account binds aren't counted. Failed actions and gift purchases need backend context.
- **Android prompts.** Creating an account on Android probably asks for the biometric twice: once for the passkey, once for secure storage.
