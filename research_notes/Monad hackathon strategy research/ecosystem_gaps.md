# Monad Ecosystem Gaps: What the Monad Foundation and Ecosystem Leaders Say They Want Built

Research date: 2026-09-24. Metropolis submissions are due 13 Oct 2026. Every claim below has a citation. Where the only source is a participant repo or an aggregator, the note says so.

## Q1. What RFPs, idea lists or wishlists has the Monad Foundation published?

### Takeaway
I found no formal "Request for Startups" document. The clearest published wishlists are (a) the Metropolis track example lists, (b) the Monad AI Blueprint use-case list (Nov 2025), (c) the Moltiverse agent-hackathon idea list (Feb 2026), and (d) scattered Foundation blog calls, such as the one for self-resolving prediction markets. Nitro, Momentum, Residency and Mach are sector-agnostic or only loosely themed programs.

### Cited Findings
- **Monad AI Blueprint (announced 18 Nov 2025).** Wanted areas, quoted verbatim: "agentic commerce where AI agents pay each other on crypto rails"; "agent reputation layers that register, verify, and evaluate reputation"; "multi-agent systems where swarms of specialized agents coordinate on-chain"; "generative AI applications that put creation, provenance, and monetization fully on-chain"; "verifiable memory systems that make AI reasoning auditable and tamper-proof"; "decentralized inference networks that horizontal-scale models on consumer hardware"; "privacy-preserving compute that lets sensitive data fuel AI without exposure"; "smart devices that continuously collect user behavior to build truly individual AI". Applications are rolling. Infrastructure partners include Google Cloud, Aethir, IO.NET, Phala, EigenCloud, Filecoin, Nillion and Yotta Labs. — [Monad announcement](https://www.monad.xyz/announcements/introducing-monad-ai-blueprint)
- **Moltiverse hackathon (Feb 2026, $200k, co-hosted around OpenClaw).** The tracks were Agent x Token ($140k, launch the agent's token on nad.fun) and Agent-only ($60k). The @monad post listed these ideas: "World creation for other agents to join and interact"; "Agents that wager, play games, or facilitate in-game transactions"; "Agent-to-Agent Transactions, enabling economic coordination between agents"; "Robotics"… (the text was cut off in the search snippet, and the full post returned HTTP 402 when fetched). — [@monad on X (search snippet)](https://x.com/monad/status/2018710997716894162); [KuCoin, 11 winners](https://www.kucoin.com/news/flash/monad-ai-hackathon-concludes-with-11-winning-projects-and-major-llm-partnerships)
- **"Monad: The Home For Builders" blog (11 Mar 2026).** It highlights "autonomous agents capable of executing transactions on Monad" and "consumer-facing agent applications" alongside DeFi and financial infrastructure. Programs described: Nitro, Blitz, vertical hackathons (742 projects deployed and $292K in prizes in 2026), Foundry residency (NYC) and Monad Madness. — [Monad blog](https://www.monad.xyz/blog/home-for-builders)
- **Nitro accelerator (2026).** $500K per team on day one, up to 15 teams, 3 months. Applicants must publish four public weekly ship logs before an interview. The first cohort targets "infrastructure, developer tools, and user-facing applications". Applications closed 14 Mar 2026. Backers: Paradigm, Electric Capital, Dragonfly, Castle Island. — [crypto.news](https://crypto.news/nitro-backs-execution-first-monad-startups-with-up-to-500k-each/); [Monad blog](https://www.monad.xyz/blog/home-for-builders)
- **Monad Momentum (Wave 1 applications ran 18–28 Sep 2025; first apps announced 7 Nov 2025).** The Foundation matches a team's own user incentives up to 1:1 in MON, with KPIs reviewed biweekly. Applicants needed a live testnet product and an audit. There is no published category list. Wave 1 projects spanned DeFi, prediction, gaming, creator economy, trading, AI tools and social, with Kuru (a CLOB) as an example. The site now says applications are closed and points to DeltaV. — [Monad blog](https://blog.monad.xyz/blog/monad-momentum); [momentum.monad.xyz](https://momentum.monad.xyz/); [Bitget News](https://www.bitget.com/news/detail/12560605057309)
- **Mach accelerator.** Mach 2 (28–30 Jan 2025) was a 3-day NFT-only cohort ("created strictly for builders of NFT collections that are launching on Monad"). The base Mach program is described as sector-agnostic. — [mach.monad.xyz](https://mach.monad.xyz/); [Everstake](https://everstake.one/resources/blog/monad-ignites-the-builder-economy-hackathons-ai-and-a-3-month-accelerator)
- **Founder Residency (2025).** Themes were growth, fundraising and narrative, not product categories. Criteria: "Your product has seen user activity already visible, even if just a little!", and 10 projects per cohort. — [residency.monad.xyz](https://residency.monad.xyz/)
- **Foundation blog call for self-resolving prediction markets (11 Nov 2025, @michael_lwy).** These are markets on subjective or unverifiable outcomes where the final consensus resolves the market. The post says: "We'd love to see teams prototype it on crypto-native rails!" — [Monad blog](https://www.monad.xyz/blog/self-resolving-prediction-markets)
- **Monad Foundation joined the x402 Foundation (June 2026).** The docs include an x402 payment guide and an ERC-8004 (Trustless Agents) registration tutorial. — [Monad blog](https://blog.monad.xyz/blog/monad-foundation-joins-x402-foundation)
- **Recent Foundation AI posts** cover AI security tooling: "Ultrafuzz: end-to-end agentic fuzzing for Solidity" (June 2026) and "Monad Bugfinder" (May 2026). — [Monad blog AI tag](https://monad.xyz/blog/tags/ai)
- **Blitz one-day hackathons.** No official idea list turned up. Some events set themes (Pune, Dec 2025: consumer apps). — [Luma, Blitz Pune](https://luma.com/blitz-pune-dec-2025); [blitz.devnads.com](https://blitz.devnads.com/)

### Inferences
- Across 2025–26 the Foundation keeps returning to the same few themes: agent-to-agent payments (x402), agent identity and reputation (ERC-8004), provenance and verifiability, consumer finance, and fully onchain markets. A project that combines these and names the standards explicitly should look well aligned to Metropolis judges.
- The self-resolving prediction market post is one of the few explicit "please build this" statements from Foundation staff. Metropolis Track 3 also lists "Markets on cultural outcomes rather than financial ones", so the same idea appears in two places.

### Gaps
- I could not fetch the full Moltiverse idea list (the X post returned 402). I found no official @monad_dev or Blitz ideas list, and no evidence of an "AI Blueprint" cohort list of accepted teams.

## Q2. What have Keone Hon, devrel and ecosystem leads said they want built?

### Takeaway
Keone's consistent line is that high-performance EVM should rebuild core financial infrastructure fully onchain (CLOBs, low-cost execution) and support mass-market consumer apps. The 2026 signals point to payments and consumer finance (MetaMask Money Account), stablecoins and RWAs, and AI agents. I found no 2026 statement where Keone lists specific apps he wants built.

### Cited Findings
- Keone (Dec 2024): "A fully on-chain order book can do what traditional finance does, but with a fraction of the cost and greater transparency." He also contrasted TradFi's single-digit-basis-point execution costs with DeFi users paying "30 basis points or 50 basis points or 1%". — [CoinDesk Most Influential 2024](https://www.coindesk.com/business/2024/12/10/keone-hon-bridging-de-fi-and-trad-fi)
- Keone's recurring consumer vision is apps as complex as RuneScape (items, leveling, achievements) with millions of users, which needs a much faster chain. This comes from long-running interviews, and the aggregator gives no exact date. — [CoinMarketCap interview](https://coinmarketcap.com/academy/article/one-of-a-kind-monads-keone-hon-brings-hft-to-ethereum-in-2025-interview)
- In the Seed Club interview (~Nov 2025) Keone describes Monad as "anti-kingmaking" in its ecosystem. — [11AM w/ Seed Club on X](https://x.com/11AMdotclub/status/1990494386824884478)
- Podcasts from the mainnet period: Bankless "Monad's Mainnet Moment" (24 Nov 2025) and Castle Island EP.683 (5 Nov 2025), which covers reimagining financial systems and auto-deleveraging. The summaries I found list no build requests. — [Bankless](https://www.bankless.com/read/monads-mainnet-moment); [Castle Island](https://castleisland.vc/keone-hon-monad-foundation-on-blockchains-built-to-scale-ep-683/)
- A Keone LinkedIn post (2026, via aggregator) calls stablecoin and tokenized RWA issuance a "zeroith" step toward onchain finance. It also highlights the Valos institutional credit vault on Monad (17 Feb 2026). — [LinkedIn profile via search](https://www.linkedin.com/in/keone-hon) (secondhand; not verified directly)
- MetaMask Money Account (30 Jun 2026) is a self-custodial USD account with mUSD yield (via Morpho, with Aave to follow) and card spending, and it runs only on Monad. Reports say MetaMask chose Monad because ~800ms finality is fast enough for card authorization, and MetaMask pays all gas. — [Monad blog](https://blog.monad.xyz/blog/metamask-money-account-launches-on-monad); [Decrypt](https://decrypt.co/372298/crypto-wallet-metamask-yield-paying-money-accounts-monad); [Tech Times](https://www.techtimes.com/articles/319399/20260630/metamask-money-account-earn-4-yield-spend-via-mastercard-own-your-keys.htm)
- An EigenCloud exec described the AI Blueprint this way: "As AI agents scale, trust in compute becomes the key primitive". — [JT Rose on X](https://x.com/jt_rose/status/1991176699812393429)

### Inferences
- MetaMask is also a Metropolis bounty sponsor ("best agent wallet plugin"), and the Money Account launched on Monad. Consumer payment apps that build on mUSD or MetaMask rails fit the Foundation's current flagship story.

### Gaps
- I found no verified 2026 tweets from @keoneHD or @monad_dev listing wanted categories. X content is mostly not fetchable (402), and these notes rely on search snippets. I also found no Messari, 4Pillars or Delphi gap analysis specific to Monad in 2026.

## Q3. Which categories are already crowded on Monad, and which are underbuilt?

### Takeaway
Memecoin launchpads, perp DEXs, spot DEXs and aggregators, lending markets and liquid staking are all crowded with several funded incumbents. Prediction markets are moderately crowded. Under-built or explicitly requested areas include invisible consumer payments, onchain credit and undercollateralized lending, agent identity and trust (ERC-8004), provenance, passkey accounts and social/attention markets. The "underbuilt" list is my inference from the Foundation asking for these things, not a measured count.

### Cited Findings
- **Memecoin launchpads (very crowded).** A Day-1 guide lists Nad.Fun, Bonad, Printr, Token Mill, Clanker and Doppler. Flap, Alloca and aiCraft.fun (an AI-agent launchpad) also exist, and nad.fun bundler/volume-bot tooling is on GitHub. — [Atomic Wallet guide](https://atomicwallet.io/academy/articles/monad-day-1-guide); [CryptoRank](https://cryptorank.io/ecosystems/monad)
- **Perp DEXs (crowded).** Bean Exchange, LeverUp, Pingu, Perpl, Monday.Trade. **Spot CLOBs and aggregators:** Kuru, Crystal, Clober, Monorail. **Lending:** Curvance, Neverland, Folks Finance, FWX, Euler, Aave V3 and Morpho. — [CryptoRank](https://cryptorank.io/ecosystems/monad); [X/solanageek](https://x.com/solanageek/status/1995439955947266415); [Kintsu ecosystem](https://kintsu.xyz/ecosystem); [Decrypt](https://decrypt.co/372298/crypto-wallet-metamask-yield-paying-money-accounts-monad)
- **Liquid staking (saturated).** FastLane shMonad (~$8.1M TVL), Kintsu sMON (~$2.0M), Magma gMON (~$1.0M), aPriori aprMON (~$0.57M), plus xMON and Moonmace. The TVL snapshot date is unclear. — [DefiLlama shMonad](https://defillama.com/protocol/shmonad); [P2P.org](https://p2p.org/economy/the-liquid-staking-landscape-on-monad/)
- **Prediction markets (moderately crowded).** Kizzy (KOL/social metrics), LEVR Bet (leveraged sports), Opinion Labs, Buzzing, RareBetSports, Narrative, Hyperthesis. — [Gate Learn](https://www.gate.com/learn/articles/monad-ecosystem-guide-consumer-d-app-native-prediction-market/6036); [Followin](https://followin.io/en/feed/17007259)
- **Activity decline.** Daily transactions peaked at more than 4.7M (25 Nov 2025, TGE) and were ~1.5M/day by Mar 2026. DEX volume fell from a ~$300M peak to ~$36.6M/day. — [MEXC blog](https://blog.mexc.com/news/monad-ecosystem-update-activity-after-the-tge/)
- **Metropolis sponsor bounties show where incumbents want integrations.** Kuru ("best trading app on the Kuru orderbook"), AUSD ("best mobile trading app"), MetaMask ("best agent wallet plugin"), Alibaba Cloud (Qwen), Kimi/Moonshot. Agora, Nansen, Chainlink and Privy are also sponsors. — search summary citing [hackathon.monad.xyz](https://hackathon.monad.xyz/); [Rise In](https://www.risein.com/monad/monad-metropolis-hackathon)

### Inferences
- A new launchpad, LST, generic lending market or generic perp DEX would face many incumbents and weak "Innovation & Impact" scores. Building on top of an incumbent (for example, a consumer or mobile front end on the Kuru CLOB, or an app using sMON/shMON) can both avoid the crowding and qualify for sponsor bounties.
- Underbuilt, per Foundation asks: per-second streaming subscriptions, group or shared wallets, payments that never mention a blockchain, credit-history-based undercollateralized lending, per-block-funding perps, paid-curation feeds, portable ticketing, cultural-outcome markets, passkey (P256/WebAuthn) accounts, ERC-8004 agent identity, and media provenance. The next section lists where each comes from.

### Gaps
- There is no authoritative project count per category. Monad's ecosystem directory now redirects to app.monad.xyz and I did not scrape it. I found no analyst report that explicitly calls Monad categories "saturated"; the crowding assessment is based on counting projects.

## Q4. What do the Metropolis tracks, prizes, dates and judging criteria look like?

### Takeaway
Metropolis is an online hackathon running 1 Sep–13 Oct 2026, with four tracks at $30k each (split across 3 teams), a $25k grand champion, and sponsor bounties (~$66k+). The headline pool is "$250k+". Judging uses five criteria weighted equally at 20% each, and a public 3-minute demo on Monad plus an open-source repo are required.

### Cited Findings
- **Dates.** Registration and build 1 Sep–13 Oct. Submission deadline 13 Oct 2026, 11:59 PM ET (rolling submissions, no late entries). Judging 14–27 Oct. Winners announced 3 Nov 2026. — [monad.xyz Metropolis page](https://monad.xyz/developers/hackathons/metropolis); [participant repo quoting Rules §4.2](https://github.com/precious-akpan/monad-metropolis-merchant-rails)
- **Format.** Online, with one-day "Metropolis Lounge" hacker houses in 7 cities. Top teams get ecosystem support and an invitation to a residency program. — [Rise In](https://www.risein.com/monad/monad-metropolis-hackathon); [@monad on X](https://x.com/monad/status/2094826891161051581)
- **Track 01, Onchain Finance & Trading ($30k).** Pitch: "Fast settlement makes new financial instruments and fully onchain markets more practical." Examples: "Fully onchain order books that do not need an offchain matching engine"; "Perpetuals with funding that updates every block"; "Undercollateralised lending priced on onchain credit history". — [monad.xyz Metropolis](https://monad.xyz/developers/hackathons/metropolis)
- **Track 02, Consumer Products & Payments ($30k).** Pitch: "Onchain rails can make financial products feel instant, programmable, and invisible to the end user." Examples: "A payments app that never mentions a blockchain"; subscriptions charged by the second; "Shared wallets and group spending that settle up without an intermediary". Rules §3.3 definition: "products whose primary user is a consumer who may not identify as a crypto user, and whose core value is a financial experience rather than a trading or market making product." — [monad.xyz Metropolis](https://monad.xyz/developers/hackathons/metropolis); [participant repo](https://github.com/precious-akpan/monad-metropolis-merchant-rails)
- **Track 03, Social, Attention & Culture ($30k).** Pitch: "Open social graphs, programmable incentives, and fast settlement can change how communities create and capture value." Examples: feeds "where curation is paid for by the people who benefit"; ticketing that follows the person; "Markets on cultural outcomes rather than financial ones". — [monad.xyz Metropolis](https://monad.xyz/developers/hackathons/metropolis)
- **Track 04, Trust, Identity & AI Infrastructure ($30k).** Pitch: "AI has made identity, provenance, data ownership, and agent trust urgent infrastructure problems." Examples: "Passkey-native accounts using P256 and WebAuthn, with no seed phrase"; agent identity under ERC-8004; provenance for generated media. — [monad.xyz Metropolis](https://monad.xyz/developers/hackathons/metropolis)
- **Prizes.** $30k per track (3 teams each), $25k grand champion, sponsor bounties $66k+. — [monad.xyz Metropolis](https://monad.xyz/developers/hackathons/metropolis). **Conflict:** a participant repo quoting Rules §3.2 gives "$145,000 total: $25,000 Overall Winner + $120,000 across 4 tracks". The marketing total of "$250k+" likely includes bounties and perks. Some trackers cite a $30k grand prize instead of $25k. — [participant repo](https://github.com/precious-akpan/monad-metropolis-merchant-rails)
- **Judging (Rules §5.2, quoted in a participant repo, not verified on the official platform).** Five criteria at 20% each: "Product Quality & Completeness", "Technical Excellence", "Monad Integration", "Track Fit & Problem Relevance", "Innovation & Impact". — [participant repo](https://github.com/precious-akpan/monad-metropolis-merchant-rails)
- **Rules (as quoted by participants).**
  - Teams of 1–5 people.
  - One project per participant, and each project enters exactly one track.
  - OSI open-source license, with the code public on GitHub during and after the event.
  - Demo video of 3 minutes or less showing the product actually running with Monad transactions ("not mockups or slides").
  - Contract addresses or tx hashes, on mainnet or testnet, plus an explanation of why the project uses Monad's capabilities (§9.2).
  - AI tool use must be disclosed in the README.
  - "the substantial majority of the work" must be done during the hackathon.
  - Submissions are reviewed non-confidentially, and judges include investors.
  — [participant repo](https://github.com/precious-akpan/monad-metropolis-merchant-rails); [search summary of repos](https://github.com/IpastorSan/sente-monad-hackathon)
- **Eligibility.** "Anyone building a product on Monad… You do not need prior onchain experience and you do not need to have raised." Country restrictions apply. — [monad.xyz Metropolis](https://monad.xyz/developers/hackathons/metropolis)
- **Examples of competing Metropolis submissions visible on GitHub.**
  - Merchant Rails (invoice settlement, Track 2)
  - Settle (Nigerian family wallets and remittance, Track 2)
  - ÆGIS (ERC-8004 agent trust layer, Track 4)
  - AgentWitness (a trust rail for concurrent agents)
  - yotrade (community trading tournaments)
  — [GitHub](https://github.com/dotunv/settle); [GitHub](https://github.com/Cubiczan/aegis-on-monad); [GitHub issue](https://github.com/woahwhattheheck/commons/issues/14176); [GitHub](https://github.com/yotrade/yotrade)

### Inferences
- "Monad Integration" (20%) plus the §9.2 requirement means a pitch should show a clear reason the product needs Monad: per-block funding, per-second streaming, a CLOB without an offchain matcher, or sub-second card settlement. Generic EVM apps will score poorly.
- Track 4 (ERC-8004 agent trust) already has several visible competitors. Track 2 also draws many payment and remittance entries. Track 3 (paid curation, portable tickets, cultural-outcome or self-resolving markets) had the fewest public competitor repos in these searches. That is weak evidence, based on search visibility only.

### Gaps
- I could not see the official hackathon.monad.xyz rules or the bounty list; the page renders a login wall. Exact sponsor bounty amounts, and whether the grand prize is $25k or $30k, need checking on the platform. The per-team split within each track's $30k is not published in the sources I found.
