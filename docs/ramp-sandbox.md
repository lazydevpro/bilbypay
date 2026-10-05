# Ramp checkout sandbox

Verified against Ramp's public sandbox endpoints on 1 October 2026. This integration exercises the payment-provider checkout separately from the Monad testnet payment account. **A successful sandbox checkout must never credit the Bilby balance, mint tokens, release treasury funds, or create a completed Bilby top-up.**

## What the sandbox actually supports

The [public demo assets API](https://api.demo.rampnetwork.com/api/host-api/v3/assets?currencyCode=USD) returned 29 enabled assets without a partner key. It returned no Monad assets and no AUSD. Production support for AUSD on Monad does not establish sandbox support.

One usable checkout asset is:

| Field | Verified value |
| --- | --- |
| Hosted checkout identifier | `BASE_USDC` |
| API chain | `BASE` |
| API symbol | `USDC` |
| Token address in demo catalog | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Decimals | `6` |
| Enabled / hidden | `true` / `false` |

`SEPOLIA_ETH` is also present. `MONAD_AUSD` is not a valid selection from the observed demo catalog. The identifiers above describe provider checkout assets, not the contracts deployed for Bilby on chain 10143.

The observed USD minimum for `BASE_USDC` was $3.39 and maximum $22,589.17. These are a dated observation, not product constants. Refresh the catalog and use its current limits. Ramp's [testing page](https://docs.rampnetwork.com/testing-environment) still mentions a €0.05 minimum and older test networks, so the current API response is needed for configuration.

## Required configuration

Obtain an issued Ramp partner key through the process in [API Keys](https://docs.rampnetwork.com/api-keys). The asset-list endpoint permits requests without a key; that does not remove the documented key requirement for a branded checkout integration. No placeholder key or another partner's key is suitable.

Configure the backend with:

| Setting | Value or purpose |
| --- | --- |
| `RAMP_MODE` | `sandbox`; default is `disabled`. Production mode is unsupported by this implementation. |
| `RAMP_HOST_API_KEY` | The partner key issued for this integration. |
| `RAMP_SANDBOX_ASSET` | `BASE_USDC`, checked against the current sandbox catalog. |
| `RAMP_HOST_LOGO_URL` | Public HTTPS URL for the Bilby logo. |
| `RAMP_WEBHOOK_BASE_URL` | Public HTTPS URL at which the backend can receive provider callbacks. |
| `RAMP_RETURN_ORIGINS` | Comma-separated exact HTTP(S) origins and, if needed, `bilbypay://`. HTTP is allowed only for loopback development. |

Localhost cannot receive public webhooks directly. A publicly reachable HTTPS backend or an explicitly configured development tunnel is required for callback testing. A missing key or required configuration should produce an unavailable checkout state, rather than a fabricated successful session.

The provider origins are fixed:

- Checkout: `https://app.demo.rampnetwork.com`
- API: `https://api.demo.rampnetwork.com/api`

See [Ramp's testing environment](https://docs.rampnetwork.com/testing-environment).

## Checkout behavior

The funding API uses user-session authentication for app requests and provider-signature verification for webhooks:

| Endpoint | Purpose |
| --- | --- |
| `GET /v1/funding/options` | Returns availability, limits, country/currency and a setup/provider failure reason when unavailable. |
| `POST /v1/funding/sessions` | Accepts `{amount, returnUrl, idempotencyKey}`; `amount` is a string of six-decimal USD units. |
| `GET /v1/funding/sessions/:id` | Reads the signed-in user's session and provider status. |
| `POST /v1/funding/webhooks/ramp/:sessionId` | Receives signed provider callbacks. There is no client-side completion endpoint. |

The return URL must be the exact `/funding` route, without query, fragment, or credentials. Native forms `bilbypay://funding` and `bilbypay:///funding` are accepted when the scheme is allowlisted. The server appends `?id=<sessionId>`.

Use the server-created session URL. The frontend must not construct a production URL or decide that a payment succeeded based on the return URL. Hosted checkout uses `enabledFlows=ONRAMP`, `defaultFlow=ONRAMP`, `enabledCryptoAssets=BASE_USDC`, `inAsset=USD`, and `outAsset=BASE_USDC`.

Ramp's current `inAssetValue` is fiat minor units: `$25.00` becomes `2500`. This differs from Bilby's six-decimal dollar amount representation, where the same amount is `25000000`. Convert deliberately at the provider boundary. Avoid the deprecated `swapAsset`, `defaultAsset`, and `fiatValue` parameters in new integrations. [Configuration](https://docs.rampnetwork.com/configuration), [hosted checkout](https://docs.rampnetwork.com/web/quick-start-hosted).

Only a verified provider event bound to the correct sandbox session may update its provider status. Each sandbox session has a separate receiver derived with HMAC; the signed callback must match that receiver and the expected asset. It does not deliver to the app account or treasury. Returning from checkout is a navigation event, not payment evidence. Keep pending, processing, failed, cancelled, expired, and provider-completed states distinct.

## US bank-transfer limitation

The [demo payment-methods API](https://api.demo.rampnetwork.com/api/host-api/v3/payment-methods) returned USD/US support for `CARD_PAYMENT`, `APPLE_PAY`, and `GOOGLE_PAY`. Both `MANUAL_BANK_TRANSFER` and `AUTO_BANK_TRANSFER` were restricted to EUR/GBP and did not include the US.

Therefore this sandbox does not establish a US ACH **add-money** route. Ramp's current [US terms](https://rampnetwork.com/terms-of-service), updated 24 September 2026, do describe ACH Direct Debit for Top-Up and On-Ramp services; that is evidence of a production product, not proof that this partner's sandbox checkout exposes it. The separate [payout guide](https://support.rampnetwork.com/en/articles/8992-what-payout-methods-are-available) covers selling and receiving money at a bank. The [REST V3 reference](https://docs.rampnetwork.com/rest-api-v3-reference) likewise separates payment methods from payout methods.

Show only the methods supported by the actual checkout and user eligibility. Production ACH onboarding requires an enabled purchase route confirmed for this partner, country, currency, and settlement asset.

## Verification boundary

Read-only checks completed: demo asset discovery, exact `BASE_USDC` tuple, and payment-method availability. No account was created and no identity or payment details were submitted. Full keyless checkout interaction was not verified in this research environment. The supported integration path uses an issued partner key.

A full sandbox test should verify checkout creation, an allowlisted return, authenticated and owner-scoped session reads, duplicate-callback handling, correct provider signatures, and rejection of mismatched assets or destinations. Compare the Bilby balance before and after every provider status transition: it must remain unchanged.

Moving to production is separate work: approve the live partner configuration, verify the exact Monad settlement token, implement settlement verification and reconciliation, and test real payment methods within approved limits. Merely changing the widget hostname does not provide that settlement path.
