# Tremendous API: research for BilbyPay gift cards

Researched 2026-09-25. Labels: **[C]** = confirmed in the cited doc. **[U]** = uncertain, inferred, or not documented.
Docs index: https://developers.tremendous.com/llms.txt (you can add `.md` to any docs URL to get the markdown version).

## TL;DR: the big blocker

Tremendous is a good fit for **a hackathon demo in the sandbox**. It is probably **not usable in production for BilbyPay's consumer model**:

- **[C]** The Terms of Service say only business and government entities may hold accounts. The services must be used "for the purposes of carrying on a business activity and not for any personal, household or family purpose". The client also may not "distribute, sell, lease, rent, lend, transfer, assign, or sublicense" rights to third parties. https://www.tremendous.com/terms/
- **[C]** The permitted use is "monetary payouts, rewards and incentives to employees, customers, and other recipients". That is a business-sends-rewards model. Consumer A paying to buy a card for consumer B is effectively resale. https://www.tremendous.com/terms/
- **[C]** The production-access page lists **"crypto and gambling"** as restricted industries, and a KYB review is required. https://developers.tremendous.com/docs/production-api-access.md
- **[U]** I could not read the full "Prohibited Customers and Activities List". It is a Notion page linked from the ToS: https://www.notion.so/Prohibited-Customers-and-Services-25fc23b75b754ee485e262159cb80e7a. Confirm with clients@tremendous.com.
- Separately, brand terms often forbid associating gift cards with crypto or reselling them. For example, Amazon's gift card prohibited uses include cryptocurrency association: https://www.amazon.com/b?ie=UTF8&node=20801039011

**Recommendation:** use the Tremendous sandbox for the demo only if it is convenient. For a real product, look at a reseller-oriented aggregator (see Alternatives). **Bitrefill Business API** is the most natural fit because it is crypto-native, accepts USDC/USDT, and returns codes via the API.

## 1. Sandbox

- **[C]** Self-serve and free. Sign up at testflight.tremendous.com. Each account comes pre-funded with **$100,000 USD, which resets daily**. https://developers.tremendous.com/docs/sandbox-environment.md
- **[C]** Base URLs: sandbox `https://testflight.tremendous.com/api/v2/`, production `https://api.tremendous.com/api/v2/`. Key prefixes are `TEST_` and `PROD_`. Sandbox and production share no data. (same URL)
- **[C]** Auth header: `Authorization: Bearer <API_KEY>`. Keys can optionally be restricted by IP; a request from another IP gets a 401. https://developers.tremendous.com/reference/generate-reward-link
- **[C]** Rate limit is **10 requests/sec**. On a 429, wait 1 s and retry. Enterprise accounts can get custom limits. https://developers.tremendous.com/docs/rate-limiting
- **[C]** What's mocked or missing in the sandbox: redemption flows that redirect to partners, and partner-managed email delivery. Test cards: `4111111111111111` succeeds, `4012888888881881` fails. https://developers.tremendous.com/docs/sandbox-environment.md
- **[C]** Sandbox reward links look like `https://testflight.tremendous.com/rewards/payout/<token>`. https://developers.tremendous.com/reference/generate-reward-link
- **[U]** Not documented whether sandbox redemption shows realistic fake codes or PINs. Test it by hand.

## 2. Core objects and flow

- **[C]** Products: `GET /products?country=US&currency=USD&subcategory=food_and_drink`. `id=ALL_FEE_FREE` is also supported. Each product has `id`, `name`, `category` (merchant_card, visa_card, paypal, ...), `currency_codes`, `countries`, `skus` (min/max per currency), `images`, `disclosure`, and `usage_instructions`. https://developers.tremendous.com/reference/list-products.md
- **[C]** Funding sources: `GET /funding_sources`. For API orders use the `BALANCE` source; `INVOICE` is Enterprise only. https://developers.tremendous.com/reference/create-order
- **[C]** Campaigns hold the template (design, copy, product set). You pass either `campaign_id` or `products`. https://developers.tremendous.com/docs/creating-multi-product-rewards-wip.md
- **[C]** Create an order with `POST /orders` (one reward per order; multi-reward orders are deprecated: https://developers.tremendous.com/changelog/deprecating-multi-reward-orders):

```json
{
  "external_id": "bilby-gift-<uuid>",
  "payment": { "funding_source_id": "<BALANCE_FS_ID>" },
  "reward": {
    "products": ["<AMAZON_PRODUCT_ID>"],
    "value": { "denomination": 25, "currency_code": "USD" },
    "recipient": { "name": "B" },
    "delivery": { "method": "LINK" }
  }
}
```

- **[C]** The response contains `order.id`, `order.status` (e.g. `EXECUTED`, or `PENDING APPROVAL`), `rewards[0].id`, `rewards[0].delivery.{method,status,link}`, and `payment.{subtotal,fees,total}`.
- **[C]** `external_id` makes the call idempotent: a replay returns 201 with the original order, and conflicting parameters return 409. Insufficient balance returns 402. https://developers.tremendous.com/reference/create-order
- **[C]** Other status codes: 202 for async, 422 for missing params, 502 means retry. Errors come as an `errors.{message,payload}` object. https://developers.tremendous.com/docs/error-handling.md

## 3. Delivery methods and in-app display

- **[C]** `EMAIL`: Tremendous sends the email. `PHONE`: Tremendous sends an SMS, and needs `recipient.phone` in E.164 format such as `+12125550199`. `LINK`: Tremendous sends nothing, and the link is returned in `delivery.link`. https://developers.tremendous.com/docs/link-delivery.md, https://developers.tremendous.com/docs/sms-rewards-wip.md
- **[C]** Regenerate a link with `POST /rewards/{id}/generate_link`, which returns `{reward:{id,link}}`. It only works for LINK rewards (403 otherwise). **Old links are not invalidated.** https://developers.tremendous.com/reference/generate-reward-link, https://developers.tremendous.com/docs/link-delivery.md
- **[C]** Links work like passwords. Tremendous advises not storing them, or encrypting them if you must. Given that, BilbyPay can store only the reward id and call `generate_link` on demand when B opens the gift. https://developers.tremendous.com/docs/link-delivery.md
- **[C]** `GET /rewards/{id}` does **not** return the code or PIN. No documented endpoint returns raw gift card credentials, so redemption happens on Tremendous's hosted page. https://developers.tremendous.com/reference/get-reward.md
- **[U] Embedding:**
  - `testflight.tremendous.com` sends `X-Frame-Options: SAMEORIGIN` (checked with curl on 2026-09-25), so iframes are blocked. That doesn't matter for React Native: a full-screen `react-native-webview` or `expo-web-browser` (SFSafariViewController / Custom Tabs) loads the page top-level.
  - Recommended: open the link in `expo-web-browser` inside the app.
  - No documented white-label or embedded redemption SDK exists for the standard API.
  - "Tremendous Connect" is a different product: an embedded *payouts platform* with OAuth/KYB, built for platforms paying out on behalf of business customers. It is not recipient redemption. https://developers.tremendous.com/docs/tremendous-connect.md
- **[C]** Campaigns and reward copy let you customize branding: https://developers.tremendous.com/docs/personalize-and-style-your-rewards.md

## 4. Recipient choice

- **[C]** Yes. Pass multiple IDs in `products` (or a campaign with several products), and the recipient picks on the redemption page. Tremendous filters the options by the recipient's country and the denomination. https://developers.tremendous.com/docs/creating-multi-product-rewards-wip.md

## 5. Funding, fees, and compliance

- **[C]** Funding the balance: ACH, SEPA, CHAPS, FPS, wire, or credit card (3% fee). Bank accounts and cards cannot pay API orders directly; they top up the balance. **Crypto/USDC is not mentioned.** https://developers.tremendous.com/docs/paying-for-orders.md, https://www.tremendous.com/terms/
- **[C]** Fees: gift cards, prepaid Visa, and charity are **free**. Monetary payouts (PayPal, Venmo, bank) cost 4-6%. Bank-transfer funding is free. Tremendous earns from brand partnerships. https://www.tremendous.com/pricing/
- **[U]** Minimum top-up and per-product denomination limits: see each product's `skus` and https://help.tremendous.com/hc/en-us/articles/41472382734867-Limitations-on-reward-denominations
- **[C]** Currencies and countries: filter products by `country` and `currency`. The "2000+ payout methods" are global. https://developers.tremendous.com/docs/introduction.md, https://developers.tremendous.com/docs/handling-currencies.md
- **[C]** Recipients may be blocked by region, and disposable email domains are prohibited. https://help.tremendous.com/en/articles/prohibited-recipients
- **Possible reconciliation flow** (design, not from the docs):
  1. User pays AUSD to the treasury on-chain.
  2. The backend waits for confirmation, then creates the order with `external_id = <onchain tx hash or internal gift id>`.
  3. Store `order.id`, `reward.id`, and `payment.total`.
  4. Off-chain ops periodically convert USD stablecoin to fiat and top up the balance by ACH or wire.
  5. Reconcile against `GET /balance_transactions` (listed in the docs index) and `FUNDING_SOURCES.FUNDED` webhooks.
- **[C]** Production requires a "Request production API access" form and KYB documents (articles of incorporation, W-9, or bank letter). Review takes 1-2 business days, up to about a week. Crypto is a restricted industry. https://developers.tremendous.com/docs/production-api-access.md

## 6. Webhooks

- **[C]**
  - Only **one** webhook endpoint per organization; create it with `POST /webhooks`.
  - Payload: `{event, uuid, created_utc, payload:{resource:{id,type}, meta}}`.
  - Header `Tremendous-Webhook-Signature: sha256=<hex>` is an HMAC-SHA256 of the raw body, keyed with the webhook's private key.
  - Failed deliveries are retried up to 17 times with exponential backoff. Deduplicate on `uuid`.
  
  https://developers.tremendous.com/docs/webhooks-1.md
- **[C]** Events: `REWARDS.DELIVERY.SUCCEEDED`, `REWARDS.DELIVERY.FAILED`, `REWARDS.CANCELED`, `ORDERS.CREATED|APPROVED|CANCELED|FAILED`, `FUNDING_SOURCES.FUNDED`, `PRODUCTS.ADDED|REMOVED`, and others. https://developers.tremendous.com/reference/list-webhook-events.md
- **[C]** `REWARDS.DELIVERY.FAILED` meta includes `failure_reason` and `retryable`. https://developers.tremendous.com/docs/delivery-failure-payload.md
- **[U]** No documented "reward redeemed" event appears in the event list. Fraud-review events are mentioned in the overview (webhooks-1), but their exact names are unconfirmed.

## 7. Fraud and approvals

- **[C]** Fraud reviews run **at redemption**. Triggers include disallowed IP or country, VPN use, a device linked to multiple emails, amount or frequency limits, and blacklists. Statuses are flagged, blocked, and released. A reward left flagged for more than 30 days is auto-blocked. Reviews can be read with `GET /fraud_reviews`. https://developers.tremendous.com/reference/list-fraud-reviews.md
- **[C]** Orders can require approval (status `PENDING APPROVAL`), which is configured per organization. https://developers.tremendous.com/reference/create-order
- **[U]** Documented sandbox vs production differences in fraud rules: none found.

## 8. SDK

- **[C]** The official Node SDK is `tremendous` on npm, **v4.16.0** (last modified 2026-08-04, requires Node >= 20). It is OpenAPI-generated TypeScript on axios. Repo: https://github.com/tremendous-rewards/tremendous-node (version from `npm view tremendous`).

```ts
import { Configuration, Environments, OrdersApi } from "tremendous";
const cfg = new Configuration({ basePath: Environments.testflight, accessToken: process.env.TREMENDOUS_API_KEY });
```

## Alternatives (for consumer resale and crypto funding)

| Provider | Why consider | Source |
|---|---|---|
| **Bitrefill Business API** | Crypto-native: pay with BTC, Lightning, ETH, USDC, or USDT. Returns redemption codes via the API. Has test products. Supports resale (BRGC batches). Base URL `https://api.bitrefill.com/v2`. | https://docs.bitrefill.com/docs/api-overview, https://docs.bitrefill.com/docs/brgc-batches |
| **Reloadly** | Explicitly a reseller API with per-product discounts (margin). A `Redeem Codes` endpoint returns the code and PIN, so you can render the card natively in the app. Public sandbox at `giftcards-sandbox.reloadly.com`. | https://www.reloadly.com/blog/gift-card-reseller-api/, https://docs.reloadly.com/features/giftcards/giftcard-redeem-codes |
| **Runa** | B2B payouts with Payout Links (recipient choice), a sandbox, and webhooks. The reseller position is **[U]**. | https://developer.runa.io/introduction |
| **Giftbit** | Business-only, with a free Testbed. Brand terms take precedence, and no public reseller terms were found. **[U]** | https://www.giftbit.com/terms, https://www.giftbit.com/gift-card-api |

Whatever the provider, brand-level terms (Amazon, Walmart, Apple) can still restrict resale or crypto association. Confirm in writing with the provider before production.
