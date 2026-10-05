# @bilbypay/giftcards

Gift card providers behind one interface (`GiftCardProvider`, spec §4a). The server picks one with
`createGiftCardProvider(process.env, { store })` and never talks to a provider directly.

| Provider | Use | Money |
|---|---|---|
| `MockGiftCardProvider` | dev, tests, demo without spending | none. Codes start with `DEMO-` |
| `LasoProvider` | hackathon demo, real cards | USDC on Base from the float wallet, paid per order via x402 |
| `BitrefillProvider` | production (needs Business account + KYB) | prepaid Bitrefill balance |

All amounts are USD in 6-decimal `bigint` base units (`5_000_000n` = $5), the same as `@bilbypay/core`.
`GiftQuote.price` is face value plus the provider fee, meaning what we actually pay.

## Switching providers

```sh
GIFT_PROVIDER=mock        # default
GIFT_PROVIDER=laso
GIFT_PROVIDER=bitrefill
```

| Env var | Provider | Notes |
|---|---|---|
| `MOCK_GIFT_FLOAT_USD` | mock | starting float, default 10000 |
| `LASO_PRIVATE_KEY` | laso | **required**. Base float wallet key (0x + 64 hex). Signs sign-in and USDC payments |
| `BASE_RPC_URL` | laso | strongly recommended. Needed for `floatAvailable()` and for checking whether a payment settled on-chain after a timeout. Without it an unclear purchase stays `pending` |
| `LASO_BASE_URL` | laso | default `https://laso.finance` |
| `LASO_PAY_TO` | laso | comma-separated payTo allowlist. Default `0x3291e96b3bff7ed56e3ca8364273c5b4654b2b37` (from Laso's openapi `x-x402`) |
| `LASO_MAX_FEE_PERCENT` | laso | refuse to pay more than face value + this %, default 6 (Laso documents ≤ 4.8%) |
| `BITREFILL_API_ID` + `BITREFILL_API_SECRET` | bitrefill | Business API (Basic auth). Required for resale |
| `BITREFILL_API_KEY` | bitrefill | Personal API (Bearer), for testing only. Resale on a personal account breaks Bitrefill's ToS |
| `BITREFILL_BASE_URL` | bitrefill | default `https://api.bitrefill.com/v2` (their OpenAPI says `api-bitrefill.com`; verify) |
| `BITREFILL_TEST_PRODUCTS=true` | bitrefill | include `test-gift-card-code` etc. in the catalog (Business only, free) |
| `BITREFILL_AUTO_PAY=true` | bitrefill | one-call `auto_pay` instead of create → persist → pay (see idempotency) |
| `BITREFILL_WEBHOOK_URL` | bitrefill | passed as `webhook_url` on invoices |
| `BITREFILL_BALANCE_CURRENCY` | bitrefill | sends `balance_currency` (e.g. `USD`). Unverified for REST, so off by default |
| `BITREFILL_FEE_PERCENT` | bitrefill | fee estimate used when a product lists no USD package price. Default 0 |

## What the server must provide

- **A durable `IdempotencyStore`** (`get`/`set` of JSON values). Pass it as `deps.store`. The
  in-memory default loses its state on restart, and after a restart Laso has no API that could tell
  us whether a card was already bought.
  - The stored values contain **redemption codes and signed payment authorizations**, so encrypt them at rest.
  - `set` must be durable before it returns.
- **Cross-process exclusion per giftId**, e.g. a DB unique constraint plus a row lock. The providers
  serialise calls for the same key only within one process.
- **Polling for `pending` results.** Call `getPurchase(providerOrderId)` until the result is `completed` or `failed`.
  - A `pending` Laso purchase has `providerOrderId = "pending:<giftId>"`. Polling it resends the
    same signed payment (never a new one) until the authorization expires, then checks the chain.
  - A result that stays `pending` needs a human, meaning the payment settled but no card came back.
- **Refunds on `failed`.** `failed` means we were not charged, or the provider refunded us.
  `failureReason` is short and user-safe, and never contains codes.
- **Secrecy.** Never log a `GiftPurchase.redemption`. This package never logs anything.

## Idempotency and "never pay twice"

**Laso.** Laso documents no idempotency key for `/order-gift-card` and no "get gift card" endpoint.
So we:

1. Fetch the free 402 challenge, check payTo, asset, network and the price cap, and sign **one**
   EIP-3009 authorization. We **persist it before sending**.
2. On any retry, resend that exact header. USDC's per-authorization nonce means it can settle at most
   once, so resending cannot double-charge.
3. After `validBefore`, check `authorizationState(from, nonce)` on Base:
   - unused: `failed`, which is safe to refund.
   - used but no card: `pending` for manual reconciliation with Laso support.

`getPurchase(card_id)` is answered from the store.

**Bitrefill.** `POST /invoices` has no idempotency key. By default we create the invoice **without**
`auto_pay`, persist its id, and then call `POST /invoices/{id}/pay`. On resume we `GET` the invoice
before paying, so `/pay` never repeats. A crash can leave at most an unpaid, orphaned invoice, never
a second paid one.

`BITREFILL_AUTO_PAY=true` saves one round trip. The cost is a window (created and paid, but the id
not yet saved) that we can only report as `pending`.

## Verified vs assumed

Nothing in this package has been run against the live Laso or Bitrefill APIs yet. The build
container could not reach laso.finance or docs.bitrefill.com. The table shows where each piece came from.

| Piece | Source | Confidence |
|---|---|---|
| x402 v2/v1 wire format (`PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`/`X-PAYMENT`, payload shape, validAfter = now−600) | coinbase/x402 repo specs + TS reference client | high |
| USDC on Base EIP-712 domain `"USD Coin"`, version `"2"`, chain 8453, `0x8335…2913` | x402 `mechanisms/evm/src/shared/defaultAssets.ts`. Our tests recover the signature with this domain | high. Can also be checked on-chain via `eip712Domain()` |
| SIWX sign-in (`GET /auth` → 402 challenge → `SIGN-IN-WITH-X`) | x402 `sign-in-with-x` spec/client + LasoFinance/docs `guides/authentication.mdx`, `auth.md` | medium. Message built with viem `createSiweMessage` instead of the `siwe` lib the reference uses |
| Laso endpoints, params, response fields, 404/400/403/402 semantics, payTo | LasoFinance/docs GitHub repo (`api-reference/openapi.json`, commit 58b14f2, 2026-09-25) | medium. Docs, not live |
| Laso has no gift-card lookup endpoint and no idempotency key on `/order-gift-card` | same docs (by absence) | medium |
| Laso webhook signing (Standard Webhooks, `whsec_`) | Laso `llms-full.txt` `/register-webhook` | medium. `verifyLasoWebhook` has no live delivery test |
| Bitrefill paths, auth tiers, invoice body, `redemption_info` fields | research notes (read from the live docs) + bitrefill/agents + bitrefill/bitrefill-mcp-server | medium |
| Gift-card artwork | Laso OpenAPI `GiftCardProduct.product_image_url`; [Bitrefill product image CDN](https://docs.bitrefill.com/reference/get_products), checked 2026-09-30 | high for URL mapping. Bitrefill public Starbucks, Uber, Target and Amazon images fetched and visually checked; merchant artwork may be a logo on a plain background |
| Bitrefill invoice/order **status strings**, `/accounts/balance` **response shape**, package **USD price field**, `balance_currency` on REST | inferred (MCP output, third-party clients) | **low**. Parsed defensively; verify with test products |
| Bitrefill webhook signing | not documented | none. Treat webhooks as "go GET the invoice" |

Before spending money:
1. `SMOKE_QUOTE_ONLY=yes` smoke run (below). It checks sign-in, catalog and the 402 challenge, and pays nothing.
2. Compare the live 402 `payTo` and `extra` with the defaults above.
3. For Bitrefill, run `test-gift-card-code` and `test-gift-card-code-fail` against the Business API.
   Confirm the status strings and the balance shape in `src/bitrefill.ts`.

## Manual smoke test: buy one real $5 card (Laso)

```sh
cd packages/giftcards
CONFIRM_SPEND=yes SMOKE_QUOTE_ONLY=yes LASO_PRIVATE_KEY=0x… BASE_RPC_URL=https://mainnet.base.org pnpm smoke:laso   # no spend
CONFIRM_SPEND=yes LASO_PRIVATE_KEY=0x… BASE_RPC_URL=https://mainnet.base.org pnpm smoke:laso                        # ~$5.24
```

- The script refuses to run without `CONFIRM_SPEND=yes`.
- It prints the float, the brand and the quote, then buys a $5 Starbucks US card. Change this with `SMOKE_QUERY`, `SMOKE_AMOUNT` and `SMOKE_COUNTRY`.
- The code is written to `.smoke/card-<key>.json` with mode 0600. It is gitignored and never printed.
- Re-running with the same `SMOKE_KEY` (default: one per UTC day) resumes the same payment instead of buying again.
- The float wallet needs USDC on Base. It needs no ETH, because the facilitator pays gas.

## Tests

`pnpm --filter @bilbypay/giftcards test` runs Laso and Bitrefill against in-process fakes that replay
the documented shapes. The Laso fake:
- rebuilds the SIWE text from the EIP-4361 template;
- recovers the x402 signature with a hand-written USDC-on-Base domain;
- simulates on-chain nonce use, dropped responses and settlement failures.
