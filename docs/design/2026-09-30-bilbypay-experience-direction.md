# BilbyPay experience direction: Bilby’s nook

30 September 2026 · Research and proposed design direction · No product implementation implied

## Direction

**BilbyPay should feel like a capable payment app with a companion who makes money approachable.** “Bilby’s nook” gives that companion a recognizable home: a small, warm world that responds to useful moments in the customer's life. Send, Receive, balance and payment status remain immediately understandable. Bilby adds personality, guidance and celebration around them.

Combine four strengths: Duolingo's character performance and meaningful progress; CRED's tactile controls and collectible personalization; Wise's clarity about money, fees and timing; PayPal's people and shareable links. The result should be original BilbyPay art and interaction, rather than a collage of competitor interfaces.

This report combines an [observed app/source audit](../research/2026-09-30-current-app-audit.md), [Duolingo research](../research/2026-09-30-duolingo.md), and [CRED, Wise and PayPal research](../research/2026-09-30-fintech.md). Competitor evidence comes from primary public pages and official design publications, not authenticated app walkthroughs. Features and layouts can differ by country, platform and cohort. BilbyPay observations come from source and the existing mock-mode web screenshots.

## What the research supports

| Source | Useful principle | BilbyPay application |
|---|---|---|
| Duolingo | Characters react to task states; simple silhouettes remain readable at small sizes. Its recent design refresh also reduced purposeless artwork and inconsistent hierarchy. [Character system](https://blog.duolingo.com/building-character/), [2026 core tabs refresh](https://blog.duolingo.com/core-tabs-redesign/) | Give Bilby a useful state vocabulary and consistent geometry. Use expressive scenes selectively; make financial review and receipts calm. |
| Duolingo | The team revised incentives after observing people optimize points over meaningful learning. [Time Spent Learning Well](https://blog.duolingo.com/time-spent-learning-well/) | Measure successful, understood payments. Never turn transfer frequency, larger amounts or time inside the app into the objective. |
| CRED | Public payment features include scanner skins and collectible flairs; NeoPOP documents depth, pressed states and haptic callbacks. These do not establish the layout of every current CRED screen. [CRED Pay](https://cred.club/cred-pay), [NeoPOP](https://github.com/CRED-CLUB/neopop-flutter) | Give controls a precise physical response and offer optional cosmetic personalization. Premium feeling comes from craft and composition. |
| Wise | Its send flow covers recipient, amount/currency, payment method, fee, arrival estimate and review. Tracking distinguishes sending from arrival. [Sending](https://wise.com/help/articles/2977959/how-do-i-send-money), [Tracking](https://wise.com/help/articles/2452305/how-do-i-check-my-transfers-status) | Show the whole payment contract before confirmation. Make processing, waiting to be opened and delivered distinct outcomes. |
| PayPal | Sending uses familiar recipient identifiers. Payment links support review, acceptance, expiry and cancellation while unaccepted, subject to availability. [Sending](https://www.paypal.com/us/cshelp/article/how-do-i-send-money-help293), [Links](https://www.paypal.com/us/cshelp/article/how-do-i-create-and-use-paypal-links-to-send-and-request-money-help1249) | Strengthen BilbyPay's existing phone recipients and claim links. Keep BilbyPay's actual expiry/refund rules. |

These support the proposed synthesis; they do not establish that gamification will improve payment outcomes. Validate comprehension and trust alongside delight.

## Concrete design brief

- **Personality:** warm, observant, gently mischievous and dependable. Bilby is pleased to help and never emotionally dependent on the person's spending.
- **Home:** a living nook, available balance, unmistakable Send/Receive actions, recent people/activity, and at most one contextual suggestion. Hide optional progression without losing any money function.
- **Visual language:** warm ivory, deep ink, the mascot's blue and a controlled scarf-red accent; rounded silhouettes, crisp boundaries and restrained depth. Establish semantic success/warning/error colors separately.
- **Typography:** a distinctive friendly face for short headlines, a highly readable face for financial data and body text. Amounts and recipient identity receive stronger hierarchy than decorations.
- **Controls:** consistent pressed depth, short easing and light selection feedback. Protect labels, focus visibility, text scaling and touch targets. A payment action must remain obvious when motion is disabled.
- **Scenes:** large on welcome and optional Home; expressive for gifts and achieved milestones; compact on functional pages. Avoid repeated white mascot circles above identical cards.
- **Voice:** “Send $20 to Maya,” “Waiting for Maya to open it,” “Back in your balance.” State the next useful action. Claims about speed, fees or safety must match the actual service.

Two exploratory interactive concepts accompany this direction: **Bilby’s nook**, with a larger character scene, and **Everyday companion**, with a smaller scene and more immediate payment controls. They compare composition and emphasis. Both use illustrative fake data and existing static artwork; they do not implement bank funding, real payment processing or an animated character. A pictured Burrow goal is a proposed new model, not an existing capability.

## Character system

Use the **current scarfed 2D Bilby** as the canonical starting point. It is the character already visible in the app: blue, floppy ears, red scarf. The separate 3D assets have upright ears, different features and no scarf. Decide any intentional evolution before commissioning new poses; accidental mixing will weaken recognition. Existing 3D clips are useful research assets, not proof of integrated mobile animation. Evidence: `app/src/ui/Mascot.tsx:4`; `assets/mascot/3d/README.md:8`.

| State | Character behavior | Information priority |
|---|---|---|
| Welcome | One wave, then settles | What the app does and how to begin |
| At home | Quiet breathing/ear movement | Balance and primary actions |
| Choosing | Looks toward the selected person | Recipient name and number |
| Amount entry | Small attentive pose | Amount and available money; no bigger reaction for bigger spending |
| Review | Still, reassuring posture | Recipient, total, fee, source and expected arrival |
| Processing | Carries an envelope calmly | Truthful status; no invented percentage |
| Delivered | Brief hop or delivery gesture | Confirmed outcome and immediate receipt access |
| Waiting/problem | Helpful, composed gesture | What happened, money status and next action |
| Gift reveal | Unwraps an issued gift | Recipient message and usable redemption details |
| Personal milestone | Adds a decorative keepsake | Clear achievement; never celebrates assumed investment returns |

Trigger success only after the authoritative outcome is known. A pending invitation receives “waiting to be opened,” not a delivered animation. Users can continue immediately, replay optional celebrations, and choose reduced motion. No urgent shaking, angry faces or damaged scenery after inactivity or withdrawal.

Duolingo's animation work demonstrates reusable character state machines; it does not require us to choose its technology. Specify states and transitions first, then compare compact rendered assets, a 2D animation runtime and existing native options on the target Android phone. [Official animation article](https://blog.duolingo.com/world-character-visemes/)

## One understandable progression system

Call the optional cosmetic collection **Keepsakes**. A keepsake changes a scarf detail, small room object, card illustration or scene accent. It has no cash value, transferable asset, exchange rate or token representation. Show the exact unlock condition and item before participation; no random draw or paid acceleration.

Start with a finite welcome journey: protect the account, learn how to check a recipient, explore payment receipts, and choose a personal preference. Completion can unlock a small decoration. Later journeys may support useful organization or a genuinely implemented personal goal. People may dismiss them permanently.

Do not reward repeated transfers, spending volume, depositing more, keeping money in Burrow, daily payment streaks, referrals tied to spending, leaderboards or chance. No shame, countdown pressure or lost progress for missing days. No cosmetic access gate on essential payments. Preserve earned items after withdrawals and returns. CRED's public hourly promotion rewards additional transactions with more winning chances; that incentive does not fit this direction. [Promotion rules](https://cred.club/cred-pay/winners)

Keepsakes, journey completion and goals need durable state and clear event rules. Current BilbyPay has none of those models. Burrow is one earning balance with a threshold, not multiple goal pots. Add goals only after defining target, contributions, progress, withdrawal behavior and persistence.

## Complete route treatment map

| Current route(s) | Proposed treatment |
|---|---|
| `/welcome` | Bilby introduction, concise payment promise, one primary start action; no long feature carousel. |
| `/phone`, `/code` | Short, visible setup progress; familiar phone entry; compact guiding character; preserve retry/resend behavior and clear error recovery. |
| `/create`, `/unlock` | Character welcomes or wakes; straightforward biometric/account copy; no identity theater or address display. |
| `/(tabs)/index` | Nook home, balance and core actions, meaningful activity; character persists after the first payment. |
| `/(tabs)/activity`, `/activity/[id]` | Clear people/status feed; receipt with amount, time, reference, truthful timeline and help. Remove technical drilldown. |
| `/(tabs)/cards`, `/card/[id]` | Personal gift collection; real brand art where supplied; easy code/PIN/barcode access; quiet confirmation on copy. Audit external redemption pages. |
| `/(tabs)/settings`, `/settings/about` | Compact account page, support, accessibility/motion preferences and understandable disclosures. Separate developer access from consumer builds. |
| `/send`, `/send/amount` | People first; retain full recipient identity; restrained Bilby presence, large amount, optional note, clear fee/availability cues. |
| `/confirm` | Calm review: recipient, amount received, total charged, fee, source and timing as applicable; required account-change checks remain explicit. |
| `/done` | Outcome-specific character response; receipt immediately available; correct pending versus delivered copy; optional keepsake below the result. |
| `/receive` | Personal payment card with phone, QR and share action; clear expectation about who can use it. |
| `/claim/[code]` | Personal envelope/gift opening; sender, amount, expiry and identity requirements remain clear; include opened, returned and failed states. |
| `/gifts`, `/gifts/[brandId]` | Illustrated gift discovery and visible design previews; preserve price, country restrictions, availability and recipient choice. |
| `/burrow`, `/burrow/about` | Coherent burrow scene with amount/earnings and plain risk information. Do not present an earning product as an insured bank balance. |
| `/burrow/move`, `/burrow/autosave` | Direct amount/threshold controls; review what changes; retain consent and availability constraints; never punish withdrawal visually. |
| `/topup` | Replace consumer crypto deposit interaction only when actual mainstream funding is integrated. In a concept/demo, clearly identify simulated funding or show the supported limitation. |
| `/dev/spike` | Development-only tooling; absent from the consumer navigation/demo experience. |
| `/`, `/c/[code]`, layouts | Preserve redirects/guards and apply shared transitions; no independent decorative screens. |
| Hosted `/c` landing, share sheet, OG image | Same character, color and voice; sender/amount/status and safe next action; optional social milestone cards omit financial details by default. |

## Strict consumer contract: no crypto identity

The new rule overrides the earlier spec's receipt and top-up exceptions. No normal consumer screen, expansion, error, accessible label, notification, share preview or linked support experience should expose wallet addresses, transaction hashes, explorer links, networks, token tickers, gas, signing, approvals or other chain concepts.

Use Account, Balance, Payment, Receipt, Reference and plain outcome language. Preserve internal settlement identifiers for the backend and staff tools. A short BilbyPay reference connects customer support to technical records without showing those records to the customer.

Current work required:

- Replace Add money's network selector, ticker, deposit address, memo and address accessibility hint (`app/src/app/topup.tsx:85`).
- Remove activity receipt hashes/explorer links (`app/src/app/activity/[id].tsx:87`; `app/src/ui/TechnicalDetails.tsx:27`).
- Remove consumer glossary exemptions and test dynamic API copy, failure messages, accessible names, deep links and external destinations. Current server errors are generally humanized; keep that boundary.
- Keep developer tools inaccessible in production and absent in the consumer demo. The route already has a production guard; development screenshots currently expose it.
- Audit actual provider/biometric sheets, hosted pages and redemption links during integration. A clean first screen alone does not satisfy this requirement.

Plain language must preserve material facts. Burrow's current disclosures explain variable earnings, lack of insurance, possible loss and delayed access (`app/src/copy/burrow.ts:5`). Those facts stay understandable and visible; they should not disappear behind a reassuring character.

## Funding and trust dependencies

The original spec explicitly excludes fiat on/off-ramp, KYC, debit cards and multiple currencies (`docs/plans/2026-09-25-bilbypay-spec.md:175`). Current funding is Aurora/NEAR stablecoin deposit infrastructure, and “Move to balance” only transfers money inside BilbyPay. **Renaming those deposits as bank transfers would misrepresent functionality.**

A mainstream launch needs a chosen market/corridor and actual permitted bank/card funding and payout integrations, with provider onboarding, verification, fees, delivery estimates, failed/returned payment handling and reconciliation. Foreign currency payouts also need genuine FX quotes and recipient amounts. Prototype these honestly as proposed capabilities until implemented.

Fix two immediate trust gaps before visual rollout: an unknown recipient's number becomes “+1” in captured confirmation/completion because it is split as a first name (`app/src/flows/drafts.ts:77`), and payment errors mention support without an in-app support destination. Show reliable recipient identity throughout and attach useful help to every receipt. Also repair broken gift glyphs and replace blank demo logo data with representative assets.

## Phased backlog and acceptance

| Phase | Concrete deliverables | Dependencies / completion evidence |
|---|---|---|
| 1. Product contract | Updated spec/glossary, removed receipt exposure, recipient fix, support path, truthful funding scope | Audit every reachable consumer state and dynamic message; existing payment behavior remains correct. |
| 2. Art and foundation | Canonical Bilby sheet, ten states, palette/type/spacing, tactile buttons, motion/reduced-motion rules | Verify contrast, text scaling, focus and target sizes; benchmark character approach on the phone. |
| 3. First complete journey | Welcome → setup → Home → Send → review → pending/delivered → receipt/help | Test with new users; they can identify recipient, charge, receipt status and next action without coaching. |
| 4. Product breadth | Receive/claim, gifts, Burrow, settings, external claim pages, all error/empty/loading states | Route map complete; real versus demo provider availability and product risks are explicit. |
| 5. Optional Keepsakes | Finite journey, deterministic unlocks, collection/customization | Persisted reward events, idempotency, privacy, opt-out; no financial incentive or blocked payment access. |
| Parallel service work | Market-specific fiat funding, cash-out and any FX | Live partner/service acceptance; no simulated rails described as functioning product. |

Release acceptance: users describe a payment app; find Send without engaging with a game; understand recipient/amount/fee/timing; distinguish pending, completed, failed and returned; can recover from an error; see no crypto identity anywhere in the consumer journey; retain full functionality with reduced motion and large text; and experience responsive interaction on the intended Android device. Measure these alongside perceived warmth and trust. Cosmetic engagement alone is not success.
