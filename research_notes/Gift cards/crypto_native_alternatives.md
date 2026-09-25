# Crypto-native alternatives to Tremendous for BilbyPay gift cards

Researched 2026-09-25. Companion to `tremendous_api.md`.
Labels: **[C]** = confirmed in the cited source. **[U]** = uncertain: inferred, taken from a third-party source, or not documented.
**[L]** = checked live on 2026-09-25 through the Bitrefill MCP catalog tools (read-only; nothing was bought).

**Top priority is a seamless claim.** The API should return the code, PIN, link, or barcode itself, with no email and no KYC for the recipient, so BilbyPay can render the card natively (in-app card or Apple Wallet pass).

## TL;DR

| Provider | Crypto funding | Code returned by API | Sandbox | Access | Fit |
|---|---|---|---|---|---|
| **Bitrefill Business API** | Prepaid balance in USD/EUR/BTC, funded with crypto. Or pay per invoice in USDC on Base, ETH, Polygon, Arbitrum, Solana, or BSC | **Yes.** `redemption_info` has code, pin, link, **barcode_value/format**, instructions, expiry. `send_email` defaults to false | Free test products (`test-gift-card-code`, `test-gift-card-link`, `*-fail`) on Business accounts | Apply to the partner program; KYB via SumSub | **Best for production.** Also the best demo if approved in time |
| **Laso Finance (x402)** | Pay per order in USDC on **Base** or Solana via x402. No prefunding | **Yes, in the same HTTP response**: `redemption_code`, `pin_code`, `redemption_url` | **None.** Orders are real, $5 minimum | Self-serve: wallet signature (SIWX), no signup | **Best for the hackathon demo** (real $5 cards, zero onboarding) |
| **Cryptorefills API / x402** | Pay per order in USDC/USDT on about 16 chains, including Base, Polygon, and Ethereum. No balance | Yes in the API response, **but it also emails the end user, and an email is required** | None. They suggest testing with sub-$1 products | Self-serve partner ID; revenue share; Cryptorefills is Merchant of Record and requires its logo | Backup. The email requirement and branding hurt the seamless claim |
| Reloadly | Fiat wallet. BTC only via manual proof of payment. No USDC documented | Yes: `GET /orders/transactions/{id}/cards` returns cardNumber, pinCode, redemptionUrl | Yes (sandbox host) | KYB | Not crypto-native |
| Giftbit | Fiat | **No raw code.** Returns links or an embeddable reward page | Free self-serve Testbed | Production approval | Poor for native rendering |
| Runa, Tillo, Prezzee | Fiat (Runa uses virtual IBANs) | Varies | Runa and Tillo have sandboxes | Enterprise onboarding (Tillo: 2–6 weeks) | Production-only options for later |
| GIFQ (CoinGate) | "Crypto cashout". USDC funding unclear | Unclear | Contradictory: "self-serve" on the marketing page, "contact sales" in the docs | Sales | Unclear |
| Coinsbee, Gyft/BitPay, Kado | No business API found. Gyft docs are stale (~2017). Kado is an on-ramp that Swapped.com acquired in 2025 | n/a | n/a | n/a | Skip |
| Rain | Stablecoin **card issuing** (Visa), not gift cards | n/a | Enterprise | Enterprise KYB | A future alternative: issue a virtual Visa instead of a brand card |

**Monad:** none of these providers accepts USDC on Monad directly **[C by absence in docs]**. Bridge with Circle **CCTP V2**, which is live on Monad (reportedly domain 15) **[C/U]**, to Base, then pay Bitrefill with `usdc_base` or Laso and Cryptorefills over x402 on Base. Alternatively, BilbyPay can keep a treasury float on Base or a Bitrefill balance and settle the user's AUSD/USDC on Monad into the BilbyPay treasury.

---

## 1. Bitrefill (Business / Resell API)

Docs index: https://docs.bitrefill.com/llms.txt. Add `.md` to any docs URL to get markdown.

**Crypto funding**
- **[C]** Invoices can be paid with `balance` or directly with crypto. The invoice schema lists `usdc_base, usdc_erc20, usdc_polygon, usdc_arbitrum, usdc_solana, usdt_*, eth_base, bitcoin, lightning, ...`. https://docs.bitrefill.com/reference/post_invoices.md and https://docs.bitrefill.com/docs/crypto-payments.md
- **[L]** The live `amazon_com-usa` product also lists `usdc_bsc` and `usdt_bsc`. **Monad is not listed.**
- **[C]** Account balances come in USD, EUR, and BTC sub-accounts. `POST /accounts/deposit` accepts all crypto payment methods, **but only for Business API accounts**. https://docs.bitrefill.com/docs/account-deposits.md
- **[C]** `auto_pay: true` together with `payment_method: 'balance'` completes the purchase immediately. https://docs.bitrefill.com/docs/quickstart-2.md

**Code delivery (the seamless claim)**
- **[C]** Delivered orders include `redemption_info` with `code`, `link`, `pin`, **`barcode_format`, `barcode_value`**, `instructions`, and `expiration_date`. Not every product returns every field. https://docs.bitrefill.com/docs/core-concepts.md
  - The barcode fields map directly onto an Apple Wallet pass (`PKBarcodeFormat`).
- **[C]** The invoice response always embeds `orders[]`. Poll `GET /invoices/{id}` or `GET /orders/{id}`, or use `webhook_url`. https://docs.bitrefill.com/docs/integration-flow.md
- **[C]** The request's `email` field is optional, and `send_email` defaults to **false**. The `gift` object, which triggers a Bitrefill email, is opt-in. So there is no email to the recipient unless you ask for one. https://docs.bitrefill.com/reference/post_invoices.md
- **[C]** Webhooks fire on final invoice states (`complete`, `denied`, `payment_error`). A `complete` invoice can still contain failed orders, so check each order. Bitrefill retries deliveries, so the handler must be idempotent. **Webhook signing is not documented.** https://docs.bitrefill.com/docs/webhooks.md
- **[U]** There is **no idempotency key** on `POST /invoices`. Protect against duplicates on your side: persist the invoice ID before paying and pay explicitly with `POST /invoices/{id}/pay` instead of `auto_pay`.

**Sandbox**
- **[C]** Test products `test-gift-card-code`, `test-gift-card-link`, `test-phone-refill`, and their `*-fail` variants are **free, with no balance deducted**, and only work with `payment_method=balance`. List them with `include_test_products=true`. https://docs.bitrefill.com/docs/test-products.md
- **[C]** The access-tier table says test products are **Business-only**. The Personal API (self-serve key from Account > Developers) has "no test products" and "no deposits". https://docs.bitrefill.com/docs/api-overview.md
  - **[U]** The quickstart implies anyone can use test products, which conflicts with that table. Assume you need Business access.
- **[C]** On the MCP partner route, `*-syldavia` test products are "hidden until Bitrefill enables them for your account". https://docs.bitrefill.com/docs/mcp-partner-integration-guide.md

**Catalog [L]**
- Gift-card counts by country: US **597**, Philippines **420**, India **193**, Mexico **122**, Nigeria **88** (mostly global and gaming products).
- `starbucks-usa`, `uber-usa`, `uber-eats-usa`, and `amazon_com-usa` are all in stock.
- Product slugs differ from the docs: the doc example uses `amazon-us`, but the real slug is `amazon_com-usa`.
- **[C]** Bitrefill advertises 170+ countries. https://www.bitrefill.com/integrate

**Pricing**
- **[L]** At retail, Amazon US $50 costs **51.00 USDC**, a +2% premium, with the same premium across denominations from $5 to $1,000.
- **[U]** Business and reseller discounts or revenue share are negotiated individually and not published. https://www.bitrefill.com/integrate
- **[C]** The invoice object carries a `payment.commission` field.

**Terms**
- **[C]** The consumer ToS says products "may not be re-sold". Gifting to someone is allowed, and resellers must arrange a business account. https://www.bitrefill.com/terms/
  - So BilbyPay needs Business or partner access for production. A Personal API key is not compliant for resale.
- **[C]** The Business API is by application to the partner program: https://docs.bitrefill.com/docs/api-overview.md and https://www.bitrefill.com/integrate
- **[U]** The affiliate program requires KYB (corporate docs and UBOs, via SumSub). This comes from a search summary of Bitrefill's terms; I did not verify it directly. https://www.bitrefill.com/terms/
- **[U]** Time to production is not published.
- **[C]** Bitrefill sells in 170+ countries and enforces geoblocking. Circumventing it is a ToS violation. https://www.bitrefill.com/terms/
  - This matters for BilbyPay: the **recipient's** country should match the product's country.
- **[C] Brand risk:** Bitrefill's own Amazon listing warns that Amazon locks cards and accounts for reselling, VPN or non-US use, or a new account with no other payment method. It also says "Bitrefill is not affiliated or sponsored by Amazon" **[L]**. Amazon's gift-card terms restrict association with crypto (see `tremendous_api.md`).

**Integration effort**
- **[C]** REST v2 with a Bearer key (Personal) or Basic `API_ID:API_SECRET` (Business). https://docs.bitrefill.com/docs/api-overview.md
- **[U]** There is no official Node SDK. Plain `fetch` is enough, and it fits in about 2 days.
- **[C]** The MCP partner route is limited to 30 requests/min. https://docs.bitrefill.com/docs/mcp-partner-integration-guide.md
- **[U]** The OpenAPI server says `api-bitrefill.com/v2`, but the guides use `api.bitrefill.com/v2`. Use the latter and verify.

## 2. Laso Finance (x402 API)

Docs: https://laso.finance/llms.txt, https://laso.finance/openapi.json, https://laso.finance/skills/laso-finance/references/gift-cards.md

- **[C]** Payments are per request over **x402, in USDC on Base (`eip155:8453`) or Solana**. There is no signup or prefunding, and the paying wallet is identified in the handshake. https://laso.finance/openapi.json
- **[C]** Two endpoints:
  - `GET /search-gift-cards?q=&country=&currency=&category=` is free and needs a Bearer `id_token` from `GET /auth`, obtained by signing in with the wallet (SIWX).
  - `GET /order-gift-card?amount=&laso_server_id=&country=` returns 402. You pay and replay the request, and the response contains `gift_card.{redemption_code, pin_code, redemption_url, status}` synchronously. https://laso.finance/skills/laso-finance/references/gift-cards.md
  - **This is the most seamless-claim-friendly response of any provider.**
- **[C]** Fee: face value converted to USD, plus up to **4.8%**. Orders must be $5–$9,000. An unknown ID returns 404 before any payment is taken. Gift cards need no KYC. https://laso.finance/llms-full.txt
- **[C]** Signed webhooks are available via `POST /register-webhook`. https://laso.finance/llms.txt
- **[C]** Laso Finance LLC is based in Texas and registered with FinCEN as an MSB. https://laso.finance/llms.txt
- **[C]** The catalog has "2,000+ brands" per the search summary of https://laso.finance/. **[U]** The per-country breadth (India, Philippines, Nigeria, Mexico) is not verified. Query `facets` on `/search-gift-cards` to check.
- **[U]** **There is no sandbox or test mode.** Every order is real money. **The response has no barcode field.**
- **[U]** Resale and consumer-app terms are not checked; the user agreement is JS-rendered at https://laso.finance/user-agreement. **[U]** No idempotency key is documented.
  - x402 gives natural once-only payment per signed authorization, but a retry after a network error could double-buy. Store the payment tx hash and check `GET /auth` or history before retrying.
- **[C]** The bug bounty has been paused since 2026-09-21, and "automated and agentic security testing is not authorized". https://laso.finance/llms.txt
- **Integration:** a Node x402 client (for example `x402-fetch` / `@x402/*`) with a viem wallet on Base. About 1 day. **[U]** I did not check the package names against npm.

## 3. Cryptorefills

Docs: https://www.cryptorefills.com/en/api-docs and https://x402.cryptorefills.com/

- **[C]** Payment is per order in stablecoins. Supported networks include Solana, Base, Polygon, Ethereum, Arbitrum, Optimism, BSC, Tron, and others, about 16 in total. **No prepaid balance.** https://www.cryptorefills.com/en/api-docs
- **[C]** The documented flow: `/v3/payment_vias` → `/v2/brands` + `/v5/products/country` → `/v4/products/price` → `/v5/orders/validations` → `/v5/orders`, then stream or poll. https://www.cryptorefills.com/en/api-docs
- **[C]** "Codes are delivered instantly in the API response", and **an email with the code is also sent to the end user**. "Valid end-user email is required." https://www.cryptorefills.com/en/api-docs
- **[C]** Cryptorefills is **Merchant of Record**. Partners earn revenue share, with payout at €200 accrued. There is no wholesale or discount resale model. The **Cryptorefills logo / "Powered by Cryptorefills" is required** in the flow. https://www.cryptorefills.com/en/api-docs
- **[C]** There is **no sandbox**: "test with low-value real products" such as Free Fire under $1. https://www.cryptorefills.com/en/api-docs
- **[C]** The x402 variant (`POST https://x402.cryptorefills.com/v1/orders`, USDC on Base) also requires `email`. **[U]** It appears to deliver by email. https://x402.cryptorefills.com/
- **[C]** Claims 6,600+ brands in 180+ countries, with no KYC for users.
- **Verdict:** crypto-native and broad, but the required email and branding work against a native, email-free claim. It is a good fallback or second source for coverage in India, the Philippines, Nigeria, and Mexico.

## 4. Others (brief)

- **Reloadly**
  - **[C]** Funding is by wire, ACH, card, or mobile money. Crypto means Bitcoin with emailed proof of payment. The minimum top-up is $100. **No USDC is documented.** https://support.reloadly.com/payment-options
  - **[C]** There is a sandbox at `giftcards-sandbox.reloadly.com`, with OAuth client credentials. The Redeem Codes endpoint returns `cardNumber`, `pinCode`, and `redemptionUrl`. https://docs.reloadly.com/gift-cards/Orders
  - **[U]** The exact path is `GET /orders/transactions/{transactionId}/cards`.
  - Good API shape but not crypto-native.
- **Giftbit**
  - **[C]** Testbed is a free, self-serve sandbox. Delivery is by link, email, or in-app. Orders are asynchronous. **The raw code is not returned**; you get an embeddable reward page URL instead. https://intercom.help/giftbit/en/articles/727031-api-getting-started and https://www.giftbit.com/developers/
- **Runa**
  - **[C]** Has a sandbox and Payout Links. Funding is through a fiat virtual IBAN in 18 currencies. **[U]** No crypto funding. https://runa.io/gift-card-api and https://runa.io/products/network
- **Tillo**
  - **[C]** Explicitly serves crypto companies (Bitrefill is a Tillo customer) through ChoiceLink and StoreFront. Brands must pre-approve the crypto use case. https://www.tillo.com/crypto-gift-cards-and-refills
  - **[U]** Onboarding takes 2–6 weeks and has minimum volumes, per a third-party review. https://foxreload.com/en/library/suppliers/tillo-gift-card-api-review-2026
  - A candidate for later direct sourcing.
- **Prezzee**
  - **[C]** The API delivers by email or links. Covers the US, UK, AU, NZ, IE, and CA. https://prezzee.com/business/m/en-us/api-overview
  - **[U]** No crypto funding.
- **GIFQ (CoinGate)**
  - **[C]** Covers 5,000+ brands in 100+ countries and has a "crypto cashout" option. The marketing page says "self-serve sandbox" (https://www.gifq.com/blog/crypto-payout-api), but the docs say "contact our sales team" (https://docs.gifq.com/docs/getting-started). **[U]** USDC funding and code-in-response are both unclear.
- **Coinsbee**
  - **[U]** No public business API found. Codes are delivered by email. https://www.coinsbee.com/en/
- **Gyft / BitPay**
  - **[C]** The Gyft API docs are about 2017 vintage and US-only. https://business.gyft.com/developers/docs/
  - **[C]** BitPay gift cards are consumer-only and need a BitPay ID. https://support.bitpay.com/hc/en-us/articles/360024780212-How-to-Purchase-a-Gift-Card
  - Skip both.
- **Kado**
  - **[C]** An on/off-ramp, not a gift-card seller. Swapped.com acquired it in April 2025. https://www.kado.money/blog/kado-acquired-by-swapped-com
- **Rain**
  - **[C]** A stablecoin-funded Visa card-issuing API. Cards can be virtual and pushed to Apple Pay or Google Wallet, and settlement happens on Base, Polygon, Solana, and other chains. https://www.rain.xyz/cards
  - An alternative product shape ("send a virtual prepaid Visa by link"), but it needs enterprise KYB and cardholder KYC.
- **Onchain or Monad-native gift card protocols**
  - **[U]** None found.
  - Monad's infra directory lists Onramp Money, whose features include gift-card spending, but it is not an API supplier. https://monad.xyz/infra
  - **[C]** The Monad Foundation joined the x402 Foundation on 2026-06-29, per a search summary. So x402 on Monad may arrive, but Laso and Cryptorefills are Base/Solana-only today.

## 5. Monad settlement path

- **[C]** Native USDC and CCTP V2 are live on Monad. https://www.circle.com/blog/now-available-usdc-cctp-wallets-and-contracts-on-monad
- **[U]** Monad's CCTP domain is 15. Verify at https://developers.circle.com/cctp/concepts/supported-chains-and-domains
- **[U]** Transfers from Monad to Base reportedly land in under a minute. https://github.com/nkrishang/payday/pull/41
- **Suggested design:** the user pays AUSD/USDC on Monad to the BilbyPay treasury. The backend buys the card from a USDC float on Base (x402) or from a Bitrefill balance, and CCTP rebalances the float periodically. There is **no per-order bridge in the claim path**, which keeps the UX instant.

## 6. Recommendation

**(a) Hackathon demo: Laso Finance x402 on Base**, with Bitrefill Business test products if approval lands in time.
- No signup, no KYB, and USDC on an EVM chain.
- One GET returns the code, PIN, or URL synchronously, so the claim screen renders natively.
- The cost is about $5.24 per real $5 card; budget $30–50 for demo runs.
- Build the backend behind a `GiftCardProvider` interface so you can swap in Bitrefill.
- Apply to Bitrefill's partner program **today** (https://www.bitrefill.com/integrate). If approved, switch the demo to the free `test-gift-card-code`.

**(b) Production: Bitrefill Business API.**
- Crypto-native, with a prefunded balance in USD, EUR, or BTC topped up in USDC on Base and other chains.
- Codes, PINs, links, and **barcodes** come back via the API, and the email is off by default.
- Largest verified catalog in the target countries.
- The resale path is explicit (Business or partner account).
- **Open questions for Bitrefill:**
  - Discount or revenue-share terms.
  - KYB timeline.
  - Webhook signing.
  - Idempotency.
  - Whether per-brand terms (for example Amazon) allow P2P gifting from a crypto app.
- **Keep Cryptorefills as a second source.**

### Concrete calls

**Laso (demo)**
```http
GET https://laso.finance/auth                     # SIGN-IN-WITH-X header → { id_token }
GET https://laso.finance/search-gift-cards?q=starbucks&country=US
    Authorization: Bearer <id_token>              # → gift_cards[].laso_server_id, min/max, currency
GET https://laso.finance/order-gift-card?amount=10&laso_server_id=<id>&country=US
    → 402 PAYMENT-REQUIRED (price in USDC, payTo on eip155:8453)
GET (same URL) + x402 payment header (EIP-3009 signed USDC transfer on Base)
    → 200 { gift_card: { card_id, redemption_code, pin_code, redemption_url, status:"completed" } }
```

**Bitrefill Business (production)**
```http
GET  https://api.bitrefill.com/v2/products/search?q=starbucks        # or /products?include_test_products=true
     Authorization: Basic base64(API_ID:API_SECRET)
POST https://api.bitrefill.com/v2/invoices
     { "products":[{"product_id":"starbucks-usa","value":25,"quantity":1}],
       "payment_method":"balance", "auto_pay":true,
       "webhook_url":"https://api.bilbypay.app/hooks/bitrefill" }      # no email / send_email=false
     → { data: { id, status, orders:[{ id, status }] } }
GET  https://api.bitrefill.com/v2/invoices/{invoiceId}    # poll until status=complete (or wait for webhook)
GET  https://api.bitrefill.com/v2/orders/{orderId}
     → { redemption_info: { code, pin, link, barcode_format, barcode_value, instructions, expiration_date } }
POST https://api.bitrefill.com/v2/accounts/deposit  { currency:"USD", payment_method:"usdc_base" }  # top-up float
```

**Claim-flow mapping**
- Store `redemption_info` encrypted, keyed to the claim token in the phone-number link.
- On claim, render a card with a "copy code" button, an "open in brand app" button (`link`), and a barcode.
- Generate a `.pkpass` from `barcode_value` / `barcode_format`.
