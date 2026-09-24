# Monad Metropolis Hackathon: track, bounty, and rules inventory (as of 2026-09-24)

**How this was sourced.** Items marked **[OFFICIAL]** come from pages I read directly on 2026-09-24:
- The public marketing page, https://www.monad.xyz/developers/hackathons/metropolis. I pulled the raw HTML with curl and extracted the text. Sponsor names come from the logo `alt` text.
- The logged-in hackathon platform at https://hackathon.monad.xyz: `/tracks`, `/tracks/<slug>` for each track and bounty, `/resources` and `/prizes`. I read these in the user's Chrome session, which was already signed in.

Everything in quotation marks is verbatim.

Items marked **[SECONDHAND]** come from participants' GitHub READMEs or search snippets. I could not verify them against the official text.

Note that `hackathon.monad.xyz` requires sign-in (GitHub, Google or Discord). WebFetch and curl only return the login page for it. The official "Rules & Guidelines" document is a modal in the platform's onboarding flow, and I did **not** read it directly.

---

## Q1. What does each of the four tracks say?

### Takeaway
There are four primary tracks, each with a $30,000 pool paid as $10,000 to each of 1st, 2nd and 3rd place. Each track page on the platform has five parts: an "About / What this track is for" essay, a core question, a "Belongs here if" rule, a weighted judging rubric, and a numbered list of "Suggested starting points". You choose one primary track. The same 20/20/15/25/20 rubric weights apply to every track, but each track words its criteria differently.

### Cited Findings

#### Shared framing [OFFICIAL]
- Tracks & Bounties page header: "Choose one primary track, then add as many sponsor bounties as you'd like. Each bounty lists what it needs. You complete those fields when you submit." Also: "A project unlocks tracks and bounties, and the team holds it. A team of one is a team." Primary tracks: "One defines the project's main judging category." — [hackathon.monad.xyz/tracks](https://hackathon.monad.xyz/tracks)
- Prizes page: "Every main track pays a $30,000 pool, divided equally: $10,000 to 1st, 2nd and 3rd place." Also: "Choose one main track to qualify for any bounty. Main-track prizes are separate and stack with sponsor bounties." — [hackathon.monad.xyz/prizes](https://hackathon.monad.xyz/prizes)
- The Social track page states the rubric is shared: "Rubric weighted toward startup potential, applied consistently across all four tracks — track-specific look-fors below." — [hackathon.monad.xyz/tracks/social-culture](https://hackathon.monad.xyz/tracks/social-culture)

#### Track 01 — Onchain Finance & Trading [OFFICIAL]
- **Marketing page** ([monad.xyz](https://www.monad.xyz/developers/hackathons/metropolis)):
  - Tagline: "Fast settlement makes new financial instruments and fully onchain markets more practical."
  - Best fit for: "Teams who have shipped a trading, lending, or market-making product before."
  - Examples: "Fully onchain order books that do not need an offchain matching engine" / "Perpetuals with funding that updates every block" / "Undercollateralised lending priced on onchain credit history"
  - Prize pool: "$30,000 / evenly between 3 teams"
- **Platform card** (/tracks): "New asset primitives, market structures, and the trading experiences that make them usable — all made possible by fast, cheap settlement."
- **Prizes page card**: "New asset primitives, market structures, and trading experiences enabled by fast, cheap settlement."
- **Track page** ([/tracks/onchain-finance](https://hackathon.monad.xyz/tracks/onchain-finance)):
  - **About:** "Financial markets onchain have matured enough to ask what should exist here that couldn't exist anywhere else. This track is for builders working on the asset layer itself — new instruments, new underlyings, new market structures — as well as the trading infrastructure and trading experiences that make them accessible. At 400ms blocks and 800ms finality on Monad, fully onchain markets that compete with centralised venues on execution quality are within reach, and that same speed opens up trading interfaces and interaction patterns that weren't previously possible."
  - **About, compute:** "Compute is emerging as one of the most important commodities in the world, yet GPU capacity still trades on opaque, bilateral terms — no real spot markets, no hedging tools. Companies using compute as loan collateral pay a premium above 5% because lenders can't underwrite or hedge the risk. That's starting to change: CME and ICE have both announced compute futures, and compute contracts are seeing real volume on prediction markets. Monad's throughput and sub-second settlement make it a strong candidate for where compute markets get built onchain."
  - **About, tokenized equities:** "Tokenized equities are arriving onchain fast, and once an equity is a programmable asset rather than just a static holding, a lot becomes possible: divisible to a cent, transferable without a broker, and actionable by any contract that touches it. This track wants to see the equity actually doing something — locked, streamed, conditioned, or distributed by a contract — not just held as another balance."
  - **Core question:** "Where are the missing asset primitives — and what new trading experiences and financial products become possible when settlement is fast enough to stop being the bottleneck?"
  - **Belongs here if:** "the core output is a financial instrument, market, asset primitive, or trading experience — and the primary user is a trader, protocol, or financial product builder."
  - **Judging criteria:**
    - "Technical Execution (20%) — does the trading/market mechanism work end-to-end onchain? Real settlement and pricing/matching logic, not a UI mockup over static data."
    - "Design & Craft (20%) — is the trading experience trustworthy and legible? Clear pricing, clear risk disclosure, an interface a trader would actually trust with capital. Financial products live or die on whether users trust the UI."
    - "Originality & Track Insight (15%) — does this introduce a genuinely new asset primitive or market structure that couldn't exist without fast settlement, or is it a faster clone of an existing DeFi product?"
    - "Founder & Market Readiness (25%) — does the team understand who the trader, protocol, or counterparty is and why this market doesn't already exist? Can they name a specific first user beyond "crypto traders"?"
    - "Traction & Path Forward (20%) — any evidence of real usage or testing (even simulated volume or a handful of test trades), and a specific next step — a TVL/volume target, a liquidity partner plan, or a concrete fundraising/launch plan."
  - **Suggested starting points:**
    1. "Next-generation launchpads built around a specific emerging asset class (not another fair-launch meme bonding curve) — the moment a new asset class becomes liquid and tradeable onchain for the first time, it creates room for a launchpad purpose-built around it"
    2. "Options written on non-traditional underlyings: social attention, creator growth trajectories, real-world event outcomes verified by oracle"
    3. "Yield stripping: separate the yield from the principal of any interest-bearing asset and trade each leg independently"
    4. "Execution-aware trading interfaces that expose Monad's sub-second finality directly to the user — real-time fills, live order books, no "pending" states"
    5. "Mobile-first or simplified trading experiences built for a specific segment (new traders, a specific asset class, a specific region)"
    6. "Embedded trading experiences inside wallets, games, or other apps that aren't trading-native"
    7. "New order types or execution strategies (TWAP, grid, limit variants) surfaced through a genuinely better trading interface, not just backend logic"
    8. "Compute Spot Exchange — an onchain CLOB for standardized compute contracts (e.g. "1 H100-hour, region X, delivered week N")"
    9. "Compute Structured Products — vaults routing LP capital into compute-backed strategies: financing providers, market-making compute contracts, or basis trades on a compute index"
    10. "Tokenized Compute Yield — fractionalized GPU fleets or reserved cloud commitments turned into yield-bearing, transferable tokens with onchain revenue distribution"
    11. "SLA Insurance & Performance Bonds — markets underwriting compute delivery (uptime, latency, delivery guarantees) with onchain slashing and payouts"
    12. "Tokenized equities as a programmable asset — a contract that locks, streams, conditions, or distributes the equity itself, not just holds it. Must be genuinely impractical offchain (due to access or minimum size) and not already common onchain. No live tokenized equity required — build against a mock ERC-20 standing in for a tokenized stock."

#### Track 02 — Consumer Products & Payments [OFFICIAL]
- **Marketing page:**
  - Tagline: "Onchain rails can make financial products feel instant, programmable, and invisible to the end user."
  - Best fit for: "Product teams who care more about a user's first five minutes than the architecture underneath."
  - Examples: "A payments app that never mentions a blockchain to the person using it" / "Subscriptions that charge by the second instead of by the month" / "Shared wallets and group spending that settle up without an intermediary"
  - Prize pool: "$30,000 / evenly between 3 teams"
- **Platform card:** "Consumer-facing financial products that use onchain rails as a design advantage, for users who don't identify as crypto users."
- **Prizes page card:** "Consumer financial products that use onchain rails as a design advantage, for crypto-native users or anyone else." Note that this wording differs from the platform card.
- **Track page** ([/tracks/consumer-payments](https://hackathon.monad.xyz/tracks/consumer-payments)):
  - **About:** "The infrastructure for onchain consumer finance has quietly crossed a threshold — near-instant settlement, gasless accounts, programmable money that can respond to behaviour in real time. This track is for builders who want to close the gap between what those rails make possible and what people can actually use. The products that make crypto feel obvious to someone who never wanted to think about blockchains are still largely unbuilt."
  - **Core question:** "What does a financial product look like when onchain rails are leveraged as an advantage to design?"
  - **Belongs here if:** "the primary user is a consumer — someone who may not identify as a crypto user — and the core value is a financial experience, not a trading or market-making product."
  - **Judging criteria:**
    - "Technical Execution (20%) — do the payment/behavioral mechanics actually execute onchain with real conditional logic and settlement, not simulated?"
    - "Design & Craft (20%) — would a non-crypto user complete the core flow without confusion or help? This track's central bar is an invisible blockchain — judge harshly on any point of friction that reveals "this is crypto.""
    - "Originality & Track Insight (15%) — is this a genuinely new consumer financial experience enabled by onchain rails, or a wallet/payments app with new branding?"
    - "Founder & Market Readiness (25%) — is there a specific, named consumer segment this serves, and does the team show real understanding of that user's behavior or pain point — not just "everyone needs payments"?"
    - "Traction & Path Forward (20%) — evidence of user testing (even five friends trying it), and a concrete distribution plan — how would the next 100 users actually find this?"
  - **Suggested starting points:**
    1. "Payments embedded in social gestures — splitting a bill, sending a gift, tipping a creator — where the financial action feels like a message, not a transaction"
    2. "Commitment contracts that put real money behind behavioural goals — reduce screen time, hit a step count, quit a habit — verified automatically by device-native signals, with stakes redistributed to those who follow through"
    3. "Accountability pools where groups collectively commit to a shared goal: those who fail fund the rewards of those who succeed"
    4. "Income share agreements as a consumer product — fund a friend's course, career move, or creative project in exchange for a programmatic share of future earnings, settled automatically onstream"
    5. "Programmable gifts that unlock on conditions — "here's $500 when you graduate", "here's your share when the company exits" — financial commitments that execute automatically without anyone having to remember or chase"
    6. "Salary streaming at the individual level — get paid every second rather than bi-weekly, with idle balances earning yield in the background until you spend them"
    7. "Micro-insurance that turns on and off by the minute — cover your laptop for the next three hours, insure a specific journey, pay only for the moments of actual exposure"
    8. "Savings products where your yield rate is gated by behavioural goals you set and your social graph verifies"

#### Track 03 — Social, Attention & Culture [OFFICIAL]
- **Marketing page:**
  - Tagline: "Open social graphs, programmable incentives, and fast settlement can change how communities create and capture value."
  - Best fit for: "Teams who have grown a community, not only built one."
  - Examples: "A feed where curation is paid for by the people who benefit from it" / "Ticketing and access that follows a person rather than an email address" / "Markets on cultural outcomes rather than financial ones"
  - Prize pool: "$30,000 / evenly between 3 teams"
- **Platform card:** "Products where open social graphs, competitive feed algorithms, and community governance let cultural participation translate into real ownership."
- **Track page** ([/tracks/social-culture](https://hackathon.monad.xyz/tracks/social-culture)):
  - **About:** "Social platforms, cultural markets, and the economies of attention share a common tension: the people generating value and those capturing it are rarely the same. This track is for builders exploring what changes when social graphs are open, feed algorithms are competitive, and cultural communities can govern and build on what they've created. At 800ms finality and 10,000 TPS on Monad, the experience gap that has made onchain social feel clunky closes — what comes next is the product question."
  - **Core question:** "How do you build products where social participation, cultural engagement, and attention translate into real ownership and economic stake for the people generating them?"
  - **Belongs here if:** "the core user value is social connection, cultural participation, or community — even if financial mechanics are involved."
  - **Judging criteria:**
    - "Technical Execution (20%) — does the social/cultural/governance mechanism run onchain and produce correct, verifiable results?"
    - "Design & Craft (20%) — does it feel like a genuine social or cultural product — inviting, fun, native to how people actually socialize — rather than a token-gated feature bolted onto a generic interface?"
    - "Originality & Track Insight (15%) — does participation or attention translate into real, verifiable economic stake for the people generating it, or is the onchain layer decorative?"
    - "Founder & Market Readiness (25%) — does the team understand the specific community or creator base they're targeting, and why that community would migrate from existing platforms?"
    - "Traction & Path Forward (20%) — any real community engagement (even a small Discord or test group), and a specific plan for growth or creator acquisition."
  - **Suggested starting points:**
    1. "An algorithm marketplace where communities publish, sell, and compete on feed ranking strategies — creators migrate to the feeds that reward them"
    2. "Social clients where the recommendation engine is trained and governed by the community it serves, not the platform hosting it"
    3. "Attention futures: stake on content or creators you believe will break through before the crowd does, earn if you were right"
    4. "Early-supporter registries that cryptographically prove — and financially reward — fans who were there before the audience arrived"
    5. "Wallet-seeded social graphs that bootstrap new platforms by surfacing existing onchain relationships as a social layer"
    6. "A TCG marketplace with real-time onchain order books — transparent price discovery, instant settlement, and no platform taking a 10–15% cut on every trade"
    7. "TCGs where card scarcity, rule evolution, tournament structure, and prize pools are governed onchain by the player community — not a publisher"
    8. "Automated market makers designed specifically for the long-tail of collectible assets, where thinly traded cards currently have no reliable price or exit"
    9. "Rental and lending markets for high-value cards — letting competitive players access what they need without the capital outlay, and collectors earn yield on idle assets"
    10. "Cross-game asset interoperability: a shared cultural asset layer where items from one game or collection carry provable history and value into others"
    11. "Generative art that evolves — pieces whose visual properties, traits, or behaviour change based on onchain events, holder actions, community votes, or oracle-fed real-world data, moving the NFT from static collectible to living object"
    12. "Style as an ownable asset — capturing a visual aesthetic or artistic identity as an NFT that can be licensed and applied to existing collections, generating derivative works with onchain attribution and automated revenue splits back to the style's creator"

#### Track 04 — Trust, Identity & AI Infrastructure [OFFICIAL]
- **Marketing page:**
  - Tagline: "AI has made identity, provenance, data ownership, and agent trust urgent infrastructure problems."
  - Best fit for: "Teams comfortable with cryptography, protocol design, or agent frameworks."
  - Examples: "Passkey-native accounts using P256 and WebAuthn, with no seed phrase" / "Agent identity and reputation under ERC-8004" / "Provenance for generated media that survives re-encoding"
  - Prize pool: "$30,000 / evenly between 3 teams"
- **Platform card:** "Protocol-level primitives for trust, provenance, and user-owned data that make AI genuinely useful without any single platform capturing the value."
- **Track page** ([/tracks/trust-identity-ai](https://hackathon.monad.xyz/tracks/trust-identity-ai)):
  - **About:** "AI has shifted the default assumptions the internet runs on — about identity, provenance, and what's real. At the same time, the personal context that makes AI genuinely useful tends to accumulate in platforms people don't own. This track is for builders working on the trust and data ownership layer: the primitives that need to exist at the protocol level for the rest of it to work. Monad provides specific building blocks — a native P256 precompile for WebAuthn verification, ERC-8004 as a first-class trustless agent registry, and BTX encrypted mempools — that make this space more tractable than it's been elsewhere."
  - **Core question:** "What does the trust and data ownership layer look like for an AI-native internet — built in a way that is privacy-preserving, composable, and impossible for any single platform to capture?"
  - **Belongs here if:** "the primary output is a protocol, primitive, or infrastructure layer that other applications build on — not a standalone consumer product."
  - **Judging criteria:**
    - "Technical Execution (20%) — is the trust/identity/data primitive implemented correctly and securely — correct use of WebAuthn/P256, sound key derivation, no leaked secrets?"
    - "Design & Craft (20%) — is the primitive usable by the developers who'd build on it — clear docs, clean interface or API — even without an end-user-facing UI? Design here means developer experience, not just visuals."
    - "Originality & Track Insight (15%) — does this solve trust, provenance, or data ownership in a way that's privacy-preserving and not capturable by a single platform, or does it just centralize the problem differently?"
    - "Founder & Market Readiness (25%) — does the team know which specific applications or developers would adopt this primitive, and why they'd choose it over rolling their own?"
    - "Traction & Path Forward (20%) — any evidence of developer interest (even one other team integrating it during the hackathon), and a specific plan to get more integrations post-event."
  - **Suggested starting points:**
    1. "Mobile-native proof of personhood using WebAuthn/P256 — no invasive biometrics, no centralised issuer, verified in a single tap on existing hardware"
    2. "Content passports: every AI-generated asset carries a cryptographic certificate of origin and a tamper-evident audit trail that survives platform migration"
    3. "A personal data locker that earns revenue when AI companies query your interaction history — you set the price, they pay per call"
    4. "Cross-application AI memory: a user-owned context layer that persists across products so your AI assistant isn't amnesiac every time you switch apps"
    5. "A marketplace where domain experts license their decision-making patterns to train specialised models — compensated per training run, not per data upload"
    6. "Onchain credential attestations for real-world skills that any application can verify without a centralised middleman"
    7. "Decentralised data labelling networks for physical AI — contributors earn stablecoin rewards for annotating robotics and sensor data, with onchain micropayments making global participation practical at scale"

#### Resources page: "Idea-specific resources" mapped by track [OFFICIAL]
Source: [hackathon.monad.xyz/resources](https://hackathon.monad.xyz/resources). The section intro reads "Curated links for each project idea. Choose a track, then open an idea to read its resources." Below are the idea heading and one-line description, verbatim, in on-page order.

**ONCHAIN FINANCE & TRADING (16 ideas)**
- **SLA Insurance & Performance Bonds** — "Underwriting compute delivery with onchain slashing." Resources: Chainlink, "What Is Slashing?"; Aethir staking docs; Chainscore, "On-Chain SLAs".
- **Compute Spot Exchange** — "CLOB for standardized compute contracts. Not on Monad today — no true onchain compute CLOB exists yet; pair with Kuru/Clober infra from the trading track to build one."
- **Social & Copy-Trading Interfaces** — "Social or copy-trading interfaces. No dominant copy-trading protocol exists on Monad yet — an open lane."
- **Parametric Insurance with Instant Settlement** — "Triggers automatically on onchain-verifiable events. No claims process, no adjuster, instant settlement."
- **Compute Structured Products** — "Vaults routing LP capital into compute-backed strategies. Compute-fi lives off-Monad today; Strata is the Monad-native vault reference."
- **Tokenized Compute Yield** — "Fractionalized GPU fleets as yield-bearing tokens. Live examples are on BNB Chain, Plume, and Ethereum — not Monad."
- **Cashflow-Backed Credit** — "Tokenized recurring income streams (salary, staking yield, subscription revenue) as collateral for undercollateralized credit. Underwriting cashflow, not assets."
- **Execution-Aware Trading Interfaces** — "Trading interfaces with real-time fills, live order books, and no pending states."
- **Embedded Trading in Non-Trading Apps** — "Embedded trading inside wallets, games, and non-trading apps."
- **Next-gen Launchpads for New Asset Classes** — "A launchpad built around a newly liquid asset class or user behavior rather than another memecoin bonding curve. Launchpads aggregate communities of communities; share is won by unlocking what the incumbents aren't built for."
- **New Order Types via Better UI** — "New order types and execution strategies (TWAP, grid, limit variants) surfaced through better UI."
- **Yield Stripping** — "Separate the yield from the principal of any interest-bearing asset and trade each leg independently."
- **Prediction Markets for Unpriced Outcomes** — "Prediction markets for outcomes that have no existing venue: AI model performance, content virality thresholds, cultural tipping points, emerging market indicators."
- **Mobile-First Trading for a Specific Segment** — "Mobile-first, simplified trading experiences targeted at a specific user segment."
- **Continuous Liquidity for Illiquid Assets** — "Continuous secondary liquidity for historically illiquid assets: fractional real estate, private credit, long-tail RWAs that currently have no exit."
- **Options on Non-Traditional Underlyings** — "Options written on social attention, creator growth trajectories, and real-world event outcomes verified by oracle."

**CONSUMER PRODUCTS & PAYMENTS (8 ideas)**
- **Income Share Agreements as a Consumer Product** — "Fund a friend's course, career move, or creative project in exchange for a programmatic share of future earnings, settled automatically onstream." Resources: The Block on the $ALEX "Human IPO" ("$20K of personal tokens for 15% of income over 3 years, capped at $100K, quarterly DAI dividends…"); Superfluid Distributions; Sablier (stream-as-NFT).
- **Programmable Gifts That Unlock on Conditions** — ""Here's $500 when you graduate", "here's your share when the company exits": financial commitments that execute automatically without anyone having to remember or chase."
- **Accountability Pools (Failures Fund Successes)** — "Groups collectively commit to a shared goal: those who fail fund the rewards of those who succeed."
- **Micro-Insurance by the Minute** — "Cover your laptop for the next three hours, insure a specific journey, pay only for the moments of actual exposure."
- **Savings Yield Gated by Behavioral Goals** — "Your yield rate is gated by behavioural goals you set and your social graph verifies."
- **Commitment Contracts with Real Money Stakes** — "Real money behind behavioural goals (reduce screen time, hit a step count, quit a habit), verified automatically by device-native signals, with stakes redistributed to those who follow through."
- **Payments Embedded in Social Gestures** — "Splitting a bill, sending a gift, tipping a creator: payments where the financial action feels like a message, not a transaction."
- **Salary Streaming at the Individual Level** — "Get paid every second rather than bi-weekly, with idle balances earning yield in the background until you spend them."

**SOCIAL, ATTENTION & CULTURE (12 ideas)**
- **Algorithm Marketplace** — "Communities publish, sell, and compete on feed ranking strategies. Creators migrate to the feeds that reward them."
- **Community-Governed Recommendation Engines** — "Social clients where the recommendation engine is trained and governed by the community it serves, not the platform hosting it."
- **Card Rental & Lending Markets** — "Rental and lending markets for high-value cards: competitive players access what they need without the capital outlay, and collectors earn yield on idle assets."
- **Generative Art That Evolves** — "Pieces whose visual properties, traits, or behaviour change based on onchain events, holder actions, community votes, or oracle-fed real-world data: the NFT as a living object, not a static collectible."
- **Player-Governed TCGs** — "Card scarcity, rule evolution, tournament structure, and prize pools governed onchain by the player community, not a publisher."
- **Cross-Game Asset Interoperability** — "A shared cultural asset layer where items from one game or collection carry provable history and value into others."
- **TCG Marketplace with Onchain Order Books** — "Real-time onchain order books: transparent price discovery, instant settlement, and no platform taking a 10-15% cut on every trade."
- **Early-Supporter Registries** — "Cryptographically prove, and financially reward, fans who were there before the audience arrived."
- **Wallet-Seeded Social Graphs** — "Bootstrap new platforms by surfacing existing onchain relationships as a social layer."
- **Style as an Ownable Asset** — "Capture a visual aesthetic or artistic identity as an NFT that can be licensed and applied to existing collections, generating derivative works with onchain attribution and automated revenue splits back to the style's creator."
- **AMMs for Long-Tail Collectibles** — "Automated market makers designed specifically for the long-tail of collectible assets, where thinly traded cards currently have no reliable price or exit."
- **Attention Futures** — "Stake on content or creators you believe will break through before the crowd does, earn if you were right."

**TRUST, IDENTITY & AI INFRASTRUCTURE (7 ideas)**
- **Expertise Licensing Marketplace** — "Domain experts license their decision-making patterns to train specialised models, compensated per training run, not per data upload."
  - Resources: Bittensor Subnet 52 (Dojo); a Bittensor critical analysis (arXiv); "Reward-distribution skew" ("Token-incentive networks tend to pay capital, not contributors.").
- **Data Labelling Networks for Physical AI** — "Contributors earn stablecoin rewards for annotating robotics and sensor data, with onchain micropayments making global participation practical at scale."
  - Resources: Bittensor subnets ("Steal the validator-scoring design — quality control is the whole game in labeling.").
- **Content Passports** — "Every AI-generated asset carries a cryptographic certificate of origin and a tamper-evident audit trail that survives platform migration."
  - Resources: C2PA / Content Credentials spec ("anchoring manifests on Monad is spec-sanctioned"); C2PA history and limitations; World Privacy Forum's cautionary case ("Provenance ≠ truth"); DECORAIT.
- **Onchain Skill Credentials** — "Credential attestations for real-world skills that any application can verify without a centralised middleman."
  - Resources: "Decentralized Society: Finding Web3's Soul"; Ethereum Attestation Service ("More flexible than SBTs — the right kickstart"); an SBT adoption reality check ("issuer buy-in is" the bottleneck).
- **Personal Data Locker** — "Earns revenue when AI companies query your interaction history. You set the price, they pay per call."
  - Resources: Vana docs ("architecture reference, not deployment target"); Ocean Protocol compute-to-data.
- **Cross-Application AI Memory** — "A user-owned context layer that persists across products, so your AI assistant isn't amnesiac every time you switch apps."
  - Resources: Vana Personal Server; EAS for the permission layer.
- **Mobile-Native Proof of Personhood** — "WebAuthn/P256 proof of personhood: no invasive biometrics, no centralised issuer, verified in a single tap on existing hardware."
  - Resources: Vitalik on biometric proof of personhood; RIP-7212 (P256VERIFY precompile) with the page's own caution "Monad check: RIP-7212 is an L2 proposal, not part of Cancun — assume NOT available and verify"; the Solidity P-256 verifier fallback (getclave/Daimo); a passkeys + account abstraction guide (Openfort).
  - Conflict: the Track 04 page says Monad has "a native P256 precompile for WebAuthn verification". Both statements are official; verify against docs.monad.xyz precompiles.

Other resources-page items [OFFICIAL]:
- Sponsor perks, under "VOUCHER RULE: One voucher per team for each resource":
  - Quicknode Build Plan: 3 months, "New accounts only", approx. $147
  - Tenderly Pro tier: approx. $7,200
  - Zerion API Builder tier: 1 month, approx. $149
- Livestream recordings: Days 1–4, Sep 8–10.
- Docs: Monad docs, including x402, ERC-8004, MERA and EIP-7702.
- Starter templates: Farcaster miniapp, Next.js PWA with Privy/thirdweb/0x, React Native with Privy/Pimlico/thirdweb.
- Protocol SDKs: Aave, Morpho, Euler, Curvance, Perpl, Alchemy, Blend, Zerion.
- MCP servers and skills: Alchemy, Envio, Uniswap, Morpho, Zerion.
- Ecosystem guides, including Trust8004 (an ERC-8004 indexer covering Monad), Uniswap v4 hooks and Continuous Clearing Auctions, Crouton Digital free RPC, and "EIPs For Designers".

### Inferences
- Across the four tracks, the platform lists 16 + 8 + 12 + 7 = 43 idea headings. The resources-page list extends the "Suggested starting points" with extra ideas that are not in the Track 01 page list: Social & Copy-Trading, Parametric Insurance, Cashflow-Backed Credit, Prediction Markets for Unpriced Outcomes, and Continuous Liquidity for Illiquid Assets. Conversely, "Tokenized equities as a programmable asset" appears only on the Track 01 page, not on the resources page.
- The rubric gives the largest weight, 25%, to "Founder & Market Readiness", and all criteria together total 100%. Naming a specific first user or segment matters in every track.
- Track 04 explicitly wants infrastructure or primitives ("not a standalone consumer product"). Its "Design & Craft" criterion means developer experience.

### Gaps
- Most idea headings on the resources page have per-idea resource links. I captured link titles only for the SLA idea, the Consumer ISA idea, and all Trust-track ideas. Resource links for most other Finance, Consumer and Social ideas were not transcribed.

---

## Q2. What sponsor bounties exist, and what are their amounts and requirements?

### Takeaway
The platform lists 20 sponsor bounties, and each one is tagged either to a single track or to "All tracks". Separately, the marketing page lists "Sponsored prizes": in-kind services for winners from ack3, Chainstack, Crouton Digital, Mercuryo, Zerion, Envio and Spectrum Nodes. The Prizes page adds PingBusiness, a merchant rebate of up to $20k. Bounties stack on top of main-track prizes.

### Cited Findings

#### Sponsor bounties [OFFICIAL]
The platform says bounties are "Optional awards. Each one names its track, and the ones marked All tracks pair with any." ([/tracks](https://hackathon.monad.xyz/tracks)).

In the table below, the requirements column is verbatim from each bounty page at `hackathon.monad.xyz/tracks/<slug>`.

| # | Bounty (sponsor) | Track tag | Prize | Summary card | Detail-page requirements (verbatim excerpts) |
|---|---|---|---|---|---|
| 1 | Best Community Team Project (Monad Foundation) | All tracks | $5,000 | "Best project across all tracks built by a team from Metropolis community supporters." | "Team must indicate their campus group when completing their profile…"; "Community must be on the list of onboarded groups…"; "Standard Metropolis submission requirements apply (public repo, demo video, deployed on Monad)". Judged "on the same overall quality bar as the project's track submission". |
| 2 | Best Cross-Border Payments App on Monad (Agora Payments Bounty) (Agora / AUSD) | Consumer Products & Payments | $10,000 | "Build a mobile app letting users send AUSD across borders using Mera passkey onboarding and instant settlement." | "A team must build a mobile application that lets a user send AUSD to another person or across borders, using Mera passkey authentication for onboarding and instant settlement for the transfer itself. Teams should build against Agora's public API documentation and staging environment (internal codebase access is not provided)." Judging: "Implementation quality / Real-world usability / Business viability of the payments flow". Deliverable: "A working demo showing passkey onboarding, an AUSD balance, and a completed send/receive transaction settled instantly". |
| 3 | Best Mobile Trading App on Monad (Agora Onchain Trading Bounty) (Agora) | Onchain Finance & Trading | $10,000 | "Build a mobile app authenticating via Mera, holding an AUSD balance, and executing trades through Perpl." | "…authenticates users via Mera (Monad's passkey authentication), holds and displays a stablecoin balance in AUSD, and executes trades through Perpl." Judging: "Implementation quality / User experience / Creative use of the three integrations together — not just technical completeness". Deliverable: "A working demo showing a user logging in via passkey, funding or viewing an AUSD balance, and placing at least one trade on Perpl". |
| 4 | Best Use of Envio (Envio) | All tracks | $1,000 | "Meaningfully use Envio's HyperIndex, HyperSync, or HyperRPC to power real on-chain data driving a core feature in your app." | Judging: "Depth of use — multichain indexing, non-trivial schema design, derived/aggregated entities, or creative use of HyperSync for analytics scores higher than a single-event ERC-20 indexer"; "Working product"; "Originality"; "Craft". Deliverables: an indexer "deployed to Envio Cloud or self-hosted, with a public repo showing config.yaml, schema.graphql and event handlers (or HyperSync client code)"; a consuming frontend, bot or API; a short demo. |
| 5 | Bring Any-Chain Liquidity to Monad (Aurora Intents) | All tracks | $5,000 (1st $2,500 / 2nd $1,500 / 3rd $1,000) plus a support bundle | "Integrate Aurora Intents (powered by NEAR Intents) into a Monad app for any-chain deposits, swaps, or deposit-and-execute flows." | Must ship "a working integration of at least one Aurora Intents product (Intents Connect, Swap API, or Intents Deposits), demoed live — not mocked", plus "A live, working cross-chain flow showing funds arriving from another chain and being used within the Monad app". Bonus: "multi-chain source coverage, contract-level composability via Intents Connect, or a Confidential Intents use case". Support bundle: 2 weeks of office hours, a 1:1 roadmap session, livestream feature, a case study, distribution, and BD support. Deadline shown: "Oct 14, 2026 at 09:29 GMT+5:30". |
| 6 | Best Integration of Cleanverse Verified Identity & Assets (Cleanverse; "CVI/CVA" on the marketing page) | Trust, Identity & AI Infrastructure | $2,000 | "Build an app that gates CVA asset movement behind on-chain CVI identity verification." | "Verify wallet-bound CVI credentials before executing any CVA transfer or settlement"; "Demonstrate a working end-to-end flow on Monad"; "Show a real-world compliance use case such as Travel Rule-compliant payments, permissioned DeFi, or verified RWA settlement"; "CVI/CVA integration is mandatory". Priority goes to projects where "identity verification is structurally coupled to asset movement". The page publishes a shared App ID and API key; I did not copy those values. |
| 7 | Build the Next Consumer Trading App on Kuru (Kuru) | Onchain Finance & Trading | $5,000 | "Build a focused spot trading product routing trades through Kuru's onchain order book on Monad." | "Looking for founders to bring new traders and communities to Kuru." Judging: "Strength of working integration / Clarity of target user / Evidence of user demand / Credibility of acquisition/retention strategy / Plan to continue building after the hackathon". Asked at submission: "Target users / Evidence of demand / Retention plan". Ideas: specific trader segment or asset, region, mobile-first retail, social/creator-led, in-app trading, discovery/portfolio UX. |
| 8 | Bring New Assets and Markets to Kuru (Kuru) | Onchain Finance & Trading | $5,000 | "Build a new class of tradable markets on Kuru's spot order book, including the infrastructure to make them viable." | "Teams must solve more than the trading interface". Judged on "clarity of asset class/customer, evidence of demand, credibility of issuance/redemption mechanism, legal/operational viability, and liquidity strategy". Ideas: prediction/event contracts, tokenized RWAs, loyalty points, revenue/royalty/cash-flow assets, gaming/creator economies. |
| 9 | Best Use of Dynamic (Dynamic) | All tracks | $5,000 | "Integrate the Dynamic SDK for authentication, embedded/agent wallets, and/or signing into a deployed, demoable app." | "App must be deployed and usable/demoable by judges, and fit within one of Monad's four tracks." Bonuses: "combines multiple Dynamic primitives (e.g., embedded wallets + Fireblocks Flow, or agent wallets + delegated access)"; "depth over breadth". Asked at submission: "Explanation of Dynamic primitives integrated". |
| 10 | Best Projects using Alchemy (Alchemy) | All tracks | $1,000 in Alchemy credits | "Build a functional project deployed on Monad that meaningfully integrates at least one Alchemy service or tool." | Judging: "Quality of the integration / Technical execution / Usefulness/innovation of the project". |
| 11 | Best workflow with CRE (Chainlink) | All tracks | $3,000 | "Build, simulate, or deploy a Chainlink Runtime Environment (CRE) Workflow used as an orchestration layer within your project." | "Integrate at least one blockchain with an external API, system, data source, LLM, or AI agent"; "Demonstrate a successful simulation (via the CRE CLI) or a live deployment on the CRE network"; "CRE must be meaningfully used in the project". |
| 12 | Best use of Perpl's API (Perpl) | All tracks | $5,000 | "Build a production-ready trading bot or automation system on Perpl." | Judging: "Reliable execution / Good risk management / Ability to be profitable / Real on-chain activity". Ideas: MM bots, Telegram bots, funding-rate arb, grid, cross-venue stat-arb, copy-trading/leaderboards/PvP, covered calls and cash-secured puts. |
| 13 | Best Analytics / Risk Tool (Perpl) | Onchain Finance & Trading | $3,000 | "Build a real-time analytics, risk-monitoring, or portfolio intelligence dashboard focused on Perpl." | "Fast, modern, dark-mode UI"; "Seamless switch between high-level protocol view and deep wallet drill-down". Protocol-level needs: volume, OI, TVL, fees, users, flows, long/short skew, liquidations, funding. Wallet-level needs: search, positions, PnL, performance analytics, watch/compare. References: stats.nado.xyz, hyperscreener.asxn.xyz, lighterdash.lol. |
| 14 | Privy! (Privy) | All tracks | $5,000 | "Integrate Privy beyond authentication — login-only integrations will not qualify." | "Demo must clearly show the functionality powered by Privy"; "Bonus points for meaningfully integrating multiple Privy features". |
| 15 | Best use of Nansen (Nansen AI) | All tracks | "$5,000 USD total prize pool" | "Build a product experience powered by Nansen data/API/MCP/CLI that goes beyond exposing raw data." | "Meaningfully integrate at least one Nansen API endpoint, MCP tool, or the Nansen CLI"; "Use Nansen data as part of a core product feature, not just a superficial API call or basic token price display"; "Clearly explain how Nansen is integrated"; public repo or docs; video or live demo. |
| 16 | Build with Hunyuan: Multimodal & Interactive Experiences (Kepler Plan by Tencent) | Social, Attention & Culture | $2,000 in Tencent Cloud vouchers | "Build a multimodal or interactive experience genuinely powered by Tencent's Hunyuan model." | "Integration must be genuine and deep, not a token API call." Deliverables: a working product on Monad, plus "A published article/blog post detailing how Hunyuan was used…" |
| 17 | Best Builds Powered by KIMI (Kimi / Moonshot AI) | All tracks | $3,000 in credits | "Build a project genuinely powered by KIMI (Moonshot AI) — open scope, no category restrictions." | "KIMI is meaningfully driving a core feature, not bolted on as a chatbot widget". Requires a published article/blog post about how Kimi was used. |
| 18 | Best Builds with Qwen 3.8 Max (Alibaba Cloud) | Trust, Identity & AI Infrastructure | $5,000 in credits | "Push Qwen 3.8 Max into genuinely agentic territory on Monad." | "Real agentic use of Qwen 3.8 Max — planning, tool use, multi-step execution"; "Depth of integration over surface-level API calls". Requires a published article/blog post. |
| 19 | Best Mera-Powered UX on Monad (Monad Foundation) | All tracks | $2,500 | "Build an app on Monad where Mera is the entire account layer — no seed phrase, no extension, no custody backend." | "One-prompt onboarding — a single passkey ceremony"; "Prompt-free signing via Mera signing sessions"; must pass "the stateless test — judges clear local storage or open the app on a fresh device mid-demo, and identity/access must fully reconstruct from the passkey". Judged on "Time-to-first-transaction" and session design; bonus for stack composability. |
| 20 | Mera: One Passkey, Many Keys (Monad Foundation) | All tracks | $2,500 | "Most creative non-wallet use of Mera's PRF-derived key material." | "…for anything that is NOT signing blockchain transactions from a wallet account." Judged on "Novelty — the further from "passkey wallet," the better", correct use of the primitives, and "The cross-device test". Ideas: E2E messaging, passkey-encrypted AI agent memory, per-agent identities, SSH identities, secret vaults. |
| 21 | Best Agent Wallet Plugin (MetaMask) | Onchain Finance & Trading | $2,500 | "Build a plugin that gives the MetaMask Agent Wallet a new trading superpower via its plugin architecture." | "Must be a working, installable plugin that routes all transactions through the Agent Wallet with no bypass of signing, policy, or MFA"; "A skills/<name>/SKILL.md so an agent knows when and how to use it"; "README + a short demo (live or ≤5 min video)". Plugins need Agent Wallet v6.2.0 or later. Ideas: copy trading, Polymarket strategies, rebalancing, DCA/grid/TWAP, A2A commerce with x402 + ERC-8004, new venues. |

The table has 21 rows. Kuru and Perpl each have two bounties, and the Monad Foundation has three.

- The marketing page's sponsor-prize grid lists the same bounties with the same amounts, sponsors identified by logo alt text. It adds: "And more, listed in full on the platform." — [monad.xyz](https://www.monad.xyz/developers/hackathons/metropolis)

#### "Sponsored prizes" / "Prize Pool Contributions" (in-kind, for winners) [OFFICIAL]
Sources: [marketing page](https://www.monad.xyz/developers/hackathons/metropolis) and [/prizes](https://hackathon.monad.xyz/prizes). The Prizes page describes these as "Estimated services, plans, and rebates for winning teams. Values are tracker headline estimates and sponsor terms apply."
- ack3: up to $15,000. "A security scan for every winning team."
- Chainstack: up to $10,000. "Annual Pro plans for the Track 01 winners and the Grand Champion."
- Crouton Digital: up to $10,000. "Three months of unlimited-usage RPC API access for winning teams."
- Mercuryo: $10,000. "Product credits and integration support for winning teams." This appears on the marketing page only; I did not see it in the captured Prizes-page text.
- Zerion: up to $6,000. "Three months of the Zerion API Builder Plan for all winners."
- Envio: up to $5,000. "Two months of Cloud hosting free, then a third month at 50% off." The marketing page says "Free Envio Cloud hosting for winning teams".
- Spectrum Nodes: $3,000. "A Business month per track winner, Enterprise for the champion." This appears on the marketing page.
- PingBusiness: up to $20,000. "A merchant rebate based on qualifying cumulative transaction volume." This appears on the Prizes page only.

Free participant tooling listed on the marketing page:
- Quicknode Build Plan: 3 months
- Tenderly Pro
- Zerion API Builder: 1 month
- Dwellir Developer plan: 3 months
- Spectrum Business plan: 2 months

#### Secondhand bounty mentions
- A Monad X post, as summarized by search, listed MetaMask "Best agent wallet plugin", Alibaba Cloud "Best builds with Qwen 3.8", Kimi "Best builds powered by KIMI", AUSD "Best mobile trading app", Kuru "Best trading app on the Kuru orderbook", and Perpl. — [search summary referencing @monad on X](https://x.com/monad/status/2094826891161051581) [SECONDHAND]

### Inferences
- AUSD/Agora offers the largest single bounties, two at $10k each. Both require a **mobile app** plus **Mera passkey auth** plus **AUSD**; the trading one also requires Perpl.
- Some bounties stack naturally: the Agora trading bounty, Perpl API, Mera UX, and possibly Envio or Nansen. Mera and Dynamic/Privy are all account layers, so one participant README treats Dynamic as mutually exclusive with the Mera bounties. That is that participant's inference, not a rule.
- Hunyuan, Kimi and Qwen require a published blog post about how the model was used.

### Gaps
- I found no per-place prize splits for any bounty other than Aurora Intents. Their detail-page headers did not render in my capture. If splits exist, they would appear in the platform's PRIZE box.
- I did not see a Zerion cash bounty, so Zerion appears as a perk and prize contribution only. I found no bounty at all from Quicknode or Tenderly.

---

## Q3. What are the official judging criteria and submission requirements?

### Takeaway
The platform's track pages publish a weighted rubric that is the same across tracks: Technical Execution 20%, Design & Craft 20%, Originality & Track Insight 15%, Founder & Market Readiness 25%, Traction & Path Forward 20%. They also list six deliverables. A participant quotes a Rules modal (v3.0) with a different five-way 20% rubric, which **conflicts** with this. The official Rules text itself was not read directly.

### Cited Findings

#### Deliverables, identical on all four track pages [OFFICIAL]
Source: e.g. [/tracks/onchain-finance](https://hackathon.monad.xyz/tracks/onchain-finance).
- "Project Logo/Graphic: uploaded in JPG, JPEG, PNG, or WEBP format (maximum size 3MB)"
- "Public GitHub Repository: fully accessible by metropolis@hackathon.monad.xyz"
- "Technical Demo Video: maximum 3 minutes, via YouTube, Loom, or Vimeo — must show the live working product, not slides or a code walkthrough"
- "Pitch Video: maximum 2 minutes, introducing the team, the problem being solved, and why you're building it"
- "Live Product Link: deployed on Monad Mainnet or Testnet, accompanied by clear access instructions and any necessary test login credentials for judges"
- "Product Advertisement (Optional): maximum 30 seconds, via YouTube, Loom, or Vimeo — a short, punchy promotional clip of the product. Not factored into judging; used for post-event social promotion and marketing"

#### Rubric [OFFICIAL]
- The weights on every track page are Technical Execution 20%, Design & Craft 20%, Originality & Track Insight 15%, Founder & Market Readiness 25%, and Traction & Path Forward 20%. The track-specific wording is quoted under Q1.
- The Social page calls this a "Rubric weighted toward startup potential, applied consistently across all four tracks."

#### Marketing page FAQ [OFFICIAL]
Source: [monad.xyz](https://www.monad.xyz/developers/hackathons/metropolis).
- "What do I submit? A working product with a public project profile: a demo, a short write-up, and a link to the code."
- "Projects are judged per track after the 13 Oct deadline, from 14 to 27 Oct, with winners announced on 3 Nov."
- "Does my project need to be open source? Open sourcing is encouraged but not required. Judges need to be able to verify what you built during the six weeks."
- "Can I submit an existing project? Yes, if the work you submit is new … what you show on 13 Oct should have been built during the six weeks."
- "Are there country restrictions? … Any eligibility restrictions are listed in the official rules on the application platform."
- Solo builders are allowed. "You choose one [track] when you apply."
- "What happens after the hackathon? Your project profile stays live, and any team can carry it into DeltaV, where 800+ Monad startups already get credits, intros, and office hours."
- "Top teams get access to ecosystem support and get invited to a residency program alongside other top teams on Monad."
- Key dates: registration and build window open 1 Sep, submission deadline 13 Oct, judging 14–27 Oct, winners 3 Nov.
- Grand Champion prize is $25,000: "The best build of Metropolis … picked across all four tracks." The Prizes page says it is "awarded at the judges' discretion".
- The platform countdown shows "OCT 14 · 09:29 GMT+5:30", which is Oct 13, 11:59 PM ET. — [hackathon.monad.xyz](https://hackathon.monad.xyz/tracks)

#### Judges [OFFICIAL]
- The Prizes page splits judges into "Main track judges" and "Bounty judges".
- Main track judges: Maria Shen (Electric), Alex Svanevik (Nansen), Wyatt Khosrowshahi (Castle Island), Brett (Prelude), Yiping Lu (IOSG), Evan Feng (CoinFund), Frankie (Paradigm), Ajit Tripathi (Eigen Foundation), Tina Qi, Eunice Giarta and Keone Hon (all Monad Foundation), Elton Chang (Dragonfly), Joey Shin (Pantera), Max Tang (Auros), Will Nuelle (Galaxy), and Zeel Patel (Layer3/Ample).
- Bounty judges include Sahil Sen (Quicknode), Denham (Envio), Kim Luu (Dynamic), Uttam Singh (Alchemy), PBJ (Perpl), Matt (Fireblocks/Dynamic), Haythem Sellami (Category Labs), Sean (Tencent), Armand Didier (Aurora Intents), and others. The list was truncated in my capture.
- Source: [/prizes](https://hackathon.monad.xyz/prizes)

#### Rules modal [SECONDHAND]
This is quoted by a participant from the "Metropolis Hackathon Rules & Guidelines" modal, "v3.0, last updated 3 Sep 2026". Source: [precious-akpan/monad-metropolis-merchant-rails README](https://github.com/precious-akpan/monad-metropolis-merchant-rails).
- Guaranteed prize pool is "$145,000 (Rules §3.2)": the $25k overall winner plus 4 × $30k. The "$250,000+" headline includes sponsor bounties.
- The deadline is "October 13, 2026, 11:59 PM ET" (§4.2). Submissions are editable until the deadline.
- Team size is 1–5 (§2.4). One project per participant, one track per submission, and a project can win no more than one main-track prize (§2.5, §3.3).
- **Open source is mandatory** (§7.2): "All submissions must be open source under an OSI-approved license... Code must be publicly accessible on GitHub throughout and after the Hackathon." This **conflicts** with the official FAQ ("encouraged but not required").
- AI coding tools are allowed but "must be disclosed in the README" (§4.1.4).
- Commit history must cover the build window. Pre-existing code must be identified in the README.
- For Monad integration, submissions need contract addresses or tx hashes, on mainnet or testnet, and must document why Monad is used (§9.2).
- Eligibility: 18+, with OFAC/EU/UN sanctions exclusions. Employees of the Foundation, sponsors or judges, and their families, can participate but can't win.
- Prizes are paid in USDC within 30 days. KYC may be required.
- Review is non-confidential (§5.3).
- Rules §5.2 rubric, as quoted: the main tracks are weighted 20% each across "Product Quality & Completeness, Technical Excellence, Monad Integration, Track Fit & Problem Relevance, Innovation & Impact". Bounties are weighted "Adherence to the published bounty requirements — 40% / Technical Implementation — 30% / Monad Integration — 20% / Innovation — 10%". This **conflicts** with the platform track-page rubric (20/20/15/25/20) that I read directly.

### Inferences
- There are two published rubrics. The track-page rubric is live on the platform and weights founder/market readiness and traction at 45% combined. The rules-modal rubric, per the participant, weights Monad integration explicitly. The safest approach is to satisfy both: show clear Monad-specific use and tx hashes, a named first user, and traction evidence.
- Treat open source as mandatory, because the rules modal is described as binding and the repo must be accessible to metropolis@hackathon.monad.xyz anyway.

### Gaps
- I did not read the official Rules & Guidelines modal directly, because it sits in the onboarding flow. Every §-numbered item above is unverified.
- I could not render the platform `/support` page.
- I found no dedicated rules or eligibility pages at `/rules` or `/bounties`; both return 404.
