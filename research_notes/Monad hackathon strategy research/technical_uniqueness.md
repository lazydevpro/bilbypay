# Monad L1: Technical Uniqueness and Developer Implications (as of Sept 24, 2026)

## Q1: How the core architecture works (optimistic parallel execution, MonadBFT, async execution, MonadDb, RaptorCast, JIT)

### Takeaway
Monad is a bytecode-compatible EVM L1. It is fast because it splits the pipeline: consensus orders transactions without executing them (asynchronous execution), execution runs optimistically in parallel but commits in serial order (the same results as Ethereum), state lives in a custom trie-native database (MonadDb), hot contracts are compiled to native x86-64 code, and blocks are spread with erasure coding (RaptorCast) under a HotStuff-derived BFT with 2-slot finality (MonadBFT). For developers, most of this is invisible. The visible effects are gas-limit charging, the reserve balance, a roughly 3-block state lag for consensus checks, and short state retention.

### Cited Findings
- **Asynchronous execution:** "nodes come to consensus (i.e. agreement about the official ordering of transactions), without ever executing those transactions." Execution then gets the whole block time instead of the ~1% of block time it gets on Ethereum. — [Monad docs: Asynchronous Execution](https://docs.monad.xyz/monad-arch/consensus/asynchronous-execution.md)
- **Delayed Merkle root:** the state root is committed D blocks later, with D = 3 on testnet and mainnet. Light-client Merkle proofs are available only after D blocks. A node whose execution diverges at N-D drops out of consensus at N, rolls back and re-executes. — [Monad docs: Asynchronous Execution](https://docs.monad.xyz/monad-arch/consensus/asynchronous-execution.md)
- **Dev implication of async execution:** "Newly-funded accounts which previously had zero balance cannot send transactions until the transfer that credits them with tokens is D blocks old." — [Monad docs: Asynchronous Execution](https://docs.monad.xyz/monad-arch/consensus/asynchronous-execution.md)
- **Optimistic parallel execution:** transactions start before earlier ones finish. Results are merged in order, and any transaction that read state later changed by an earlier transaction is re-executed. Re-execution reuses cached work such as signature recovery and loaded state. The block stays "a linearly ordered set of transactions" with results "identical" to serial Ethereum execution. Developers do not need access lists; the docs do not require them. — [Monad docs: Parallel Execution](https://docs.monad.xyz/monad-arch/execution/parallel-execution.md)
- **JIT/native compilation:** "both a highly optimized interpreter and a bespoke native-code compiler" that "tracks the most frequently-used contracts and compiles them asynchronously", emitting native x86-64. — [Monad blog: How Monad Works (updated Jul 23, 2026)](https://monad.xyz/blog/how-monad-works)
- **MonadDb:** a custom DB that "stores merkle trie data natively" instead of embedding the trie in a commodity KV store (LevelDB/RocksDB). This cuts indirection and SSD page reads, and it supports async I/O and speculative execution. — [How Monad Works](https://monad.xyz/blog/how-monad-works); [Blockworks Research](https://app.blockworksresearch.com/unlocked/monad_a-supercharged-evm-layer-1)
- **MonadBFT:** pipelined HotStuff-family BFT. "Speculative finality in a single consensus round, and full finality in two rounds." It resists tail-forking (a leader reorging its predecessor's block) using Timeout Certificates and No-Endorsement Certificates. Message and authenticator complexity is linear on the happy path. Votes go directly to the next leader; BLS signatures are aggregated into QCs. — [Monad docs: MonadBFT](https://docs.monad.xyz/monad-arch/consensus/monad-bft.md)
- **RaptorCast:** erasure-coded (Raptor codes) block propagation through two-level broadcast trees, similar to Solana's Turbine. Validators do not need to be co-located. RaptorCast v1 wire format shipped in v0.16.2 (Sept 10, 2026). — [How Monad Works](https://monad.xyz/blog/how-monad-works); [Monad docs: Releases](https://docs.monad.xyz/developer-essentials/changelog/releases)
- **Transaction lifecycle / mempool:** "There is no global mempool. For efficiency, transactions are forwarded to the next few leaders." The default ordering is a Priority Gas Auction (descending total gas price). — [Monad docs: Differences](https://docs.monad.xyz/developer-essentials/differences); [Monad docs: Gas Pricing](https://docs.monad.xyz/developer-essentials/gas-pricing.md)
- **Block commit states exposed to apps:** RPC `latest` = Proposed (speculative), `safe` = Voted, `finalized` = Finalized. The WebSocket extensions `monadNewHeads` / `monadLogs` carry `blockId` and `commitState` (Proposed → Voted → Finalized → Verified). — [Monad docs: JSON-RPC overview](https://docs.monad.xyz/reference/json-rpc/overview.md)
- The clients are `monad-bft` (consensus) and `monad` (execution) from Category Labs, written in C++/Rust. — [Monad docs: Architecture](https://docs.monad.xyz/monad-arch/)

### Inferences
- UIs can show optimistic results at the Proposed stage (~300ms) and mark settlement at Finalized (~600ms). The commit-state WebSocket feeds are a Monad-specific UX tool that Ethereum does not have.
- Parallel execution is transparent for correctness, but throughput on hot storage slots (one AMM pool, one global counter) still serializes through re-execution. Designs that shard state (per-user mappings, per-market books) should parallelize better. This is inferred from how optimistic concurrency works; the docs do not quantify the contention penalty.

### Gaps
- The docs do not quantify the throughput loss from same-slot contention and give no guidance on it.
- I did not verify independent benchmarks of JIT speedups.

## Q2: Current performance numbers (claims vs observed)

### Takeaway
Since MIP-12 activated on **July 23, 2026**, mainnet runs **300ms blocks and 600ms finality**, down from 400ms/800ms. Many third-party explainers still quote 400/800. The block gas limit is now **150M** (was 200M), the per-tx limit is 30M, and throughput is held at **500 Mgas/s**. The contract size limit is 128 KB. "10,000 TPS" is design capacity, not observed load: early mainnet averaged tens of TPS, with spikes in the hundreds.

### Cited Findings
- As of 10:30am ET July 23, 2026, mainnet has 300ms block times and 600ms finality (previously 400/800). Monad claims 200+ validators across 30+ countries. — [Monad blog: 300ms block times](https://monad.xyz/blog/300ms-block-times)
- "Blocks are every 300 ms"; "finality of block N occurs at the proposal of block N+2, i.e. finality is 600 ms." The changelog notes "Block time 400ms→300ms", "Finality 800ms→600ms". — [How Monad Works](https://monad.xyz/blog/how-monad-works)
- MIP-12 changes: block time 400→300ms; block gas limit 200M→150M; tx cap per block 5,000→3,750; block reward 25→18 MON; gas throughput held at 500 Mgas/s. — [Monad docs: Releases](https://docs.monad.xyz/developer-essentials/changelog/releases). Note: the releases page shows v0.15.0 with a March 12, 2026 release date, but the official blog gives July 23, 2026 as the mainnet activation date. The binary probably shipped earlier and was activated later; this is unconfirmed.
- Gas pricing page: block gas limit 150M, **tx gas limit 30M**, **min base fee 100 MON-gwei**. The base fee controller "increases more slowly and decreases more quickly" than EIP-1559 (max_step_size 1/28, β = 0.96). A 200k-gas tx costs ~0.02 MON (~$0.0005). — [Monad docs: Gas Pricing](https://docs.monad.xyz/developer-essentials/gas-pricing.md). Inconsistency: the same page says the controller targets "80% block utilization (160M gas)", and 160M is 80% of the old 200M limit, so this part of the page may be stale.
- Contract size: **128 KB** max code (Ethereum: 24 KB); **256 KB** max initcode (Ethereum: 48 KB). — [Monad docs: Differences](https://docs.monad.xyz/developer-essentials/differences)
- MonadBFT docs also state speculative finality at 300ms (1 slot) and full finality at 600ms (2 slots). — [Monad docs: MonadBFT](https://docs.monad.xyz/monad-arch/consensus/monad-bft.md)
- **Observed usage vs claims:** mainnet launched Nov 24, 2025. It processed ~140M transactions in just over two months, with 3.7M on day one and early peaks of ~350 TPS during a memecoin frenzy. — [Monad Block (Feb 10, 2026)](https://monadblock.com/2026/02/10/monad-mainnet-performance-140m-transactions-10k-tps-and-220m-defi-tvl-breakdown/) (enthusiast site). Monad's own figures: 130M tx, $6.5B DEX volume, 2.3M active users, 125+ apps, zero downtime. — [Monad blog: Home of High-Frequency Finance (Mar 4, 2026)](https://monad.xyz/blog/monad-home-high-frequency-finance)
- Monad describes 10,000 TPS as "a designed network capacity rather than a stress-test peak." — [Monad blog: Contextualizing Blockchain Performance](https://monad.xyz/blog/contextualizing-blockchain-performance). Yellow.com (Aug 2026) says the 10k figure came from internal devnet stress tests and has not been independently verified under adversarial load. — [Yellow.com](https://yellow.com/research/monad-10000-tps-l1-performance-claims-2026) (this article is also internally inconsistent about launch timing, so it has low reliability)
- Testnet reached daily peaks of 10,000 TPS in April 2025, and had processed 2.44B total tx with a peak of 34M tx/day by October 2025. — search summary citing [Everstake](https://everstake.com/resources/blog/monads-road-to-mainnet)
- Category Labs, January 2026 data: median unused gas on Monad was 25.4% vs 54.7% on Ethereum. — [Category Labs: Setting your gas limit on Monad (Feb 23, 2026)](https://www.category.xyz/blogs/setting-your-gas-limit-on-monad)

### Inferences
- 140M tx over ~75 days works out to about 1.9M tx/day, or roughly 20–25 TPS average in the first months. That is well under 1% of the 10k design capacity. For a hackathon this is an advantage: block space is nearly empty and fees sit at the minimum base fee.
- 500 Mgas/s is about 20–25x Ethereum L1 execution throughput. At an average of ~40k gas/tx, it corresponds to roughly 12.5k simple tx/s. That is consistent with "10k TPS" for simple transfers, not for complex DeFi transactions.

### Gaps
- I could not get live Sept 2026 TPS, tx/day or active-address figures. Chainspect's Monad page returned no data, and I did not fetch MonadVision/Monadscan/gmonads.com stats directly. The report writer should present observed TPS as "tens to low hundreds sustained (early 2026 data)" and flag that it is dated.
- I did not verify Paradigm, Messari, Galaxy or Delphi independent analyses.

## Q3: Developer-facing differences from Ethereum (gotchas)

### Takeaway
The differences that break naive Ethereum assumptions:
1. You pay for **gas limit**, not gas used.
2. There is a **10 MON reserve balance**: txs that dip below it can be *included and then revert*, and EIP-7702-delegated EOAs can never go below 10 MON.
3. **Cold access is ~4x more expensive** (account access 10,100 gas), but storage is now warmed per **128-slot page**.
4. Crypto precompiles are 2–5x more expensive.
5. **P256VERIFY (EIP-7951) exists at 0x0100.**
6. EIP-7702 is supported, with restrictions.
7. There are no blob txs and no global mempool, pending txs are invisible, and there is no arbitrary historical state (~40k blocks, which at 300ms is only a few hours).

### Cited Findings
- **Gas charged on limit:** the total deducted is `value + gas_bid * gas_limit`. This prevents DoS under async execution, because execution has not happened when inclusion is decided. — [Monad docs: Differences](https://docs.monad.xyz/developer-essentials/differences); [Gas Pricing](https://docs.monad.xyz/developer-essentials/gas-pricing.md)
  - Recommended practice: `eth_estimateGas` plus a ~7.5% static buffer (≈1–2% failure rate, 7–9% unused gas), or dynamic per-function buffers. — [Category Labs](https://www.category.xyz/blogs/setting-your-gas-limit-on-monad)
  - `eth_maxPriorityFeePerGas` returns a hardcoded 2 gwei. — [JSON-RPC overview](https://docs.monad.xyz/reference/json-rpc/overview.md)
- **Reserve balance:** `user_reserve_balance` = **10 MON** per EOA. At consensus time (which uses state from block n-k, **k = 3**, ~0.9s at 300ms), validators check that inflight gas fees fit within the reserve. At execution time, a tx reverts if it pushes the balance below the reserve. Exception: an undelegated EOA may "empty" its account if it has sent no other tx and made no delegation within k blocks, so a small account can fully withdraw once every 3 blocks. **Consequence: "you may see transactions included in the chain whose execution reverts"**, and they still pay gas. A precompile at **0x1001** exposes `dippedIntoReserve()` for introspection (MIP-4). — [Monad docs: Reserve Balance](https://docs.monad.xyz/developer-essentials/reserve-balance.md)
- **Opcode repricing:** cold account access (BALANCE, EXTCODE*, CALL family, SELFDESTRUCT) costs **10,100 gas vs 2,600**. Cold storage costs 8,100 per **128-slot page** vs 2,100 per slot. SSTORE breaks down as base 100, page load 8,000, page write 2,800, and 17,000 for state growth per new high-water mark. — [Monad docs: Opcode Pricing](https://docs.monad.xyz/developer-essentials/opcode-pricing.md)
  - Page-based storage (MIP-8) activated with MONAD_TEN on **Sept 2, 2026**. Later reads in the same page cost 100 gas, which makes "storing data together 98% cheaper." — [Releases](https://docs.monad.xyz/developer-essentials/changelog/releases); [CryptoSlate](https://cryptoslate.com/monads-mainnet-upgrade-makes-storing-data-together-98-cheaper/)
  - Memory expansion is linear (`w/2`) instead of quadratic, capped at **8 MB per tx** (MIP-3, MONAD_NINE). — [Opcode Pricing](https://docs.monad.xyz/developer-essentials/opcode-pricing.md); [Differences](https://docs.monad.xyz/developer-essentials/differences)
  - Precompile repricing: ecRecover 6,000 (2x); ecAdd 300 (2x); ecMul 30,000 (5x); ecPairing 225,000 + 170,000/point (5x); blake2f 2x; KZG point eval 200,000 (4x). — [Opcode Pricing](https://docs.monad.xyz/developer-essentials/opcode-pricing.md)
- **Precompiles available:** the Ethereum set 0x01–0x0a, plus **BLS12-381 (EIP-2537) 0x0b–0x11**, plus **P256VERIFY at 0x0100 (EIP-7951)** "enabling on-chain verification of WebAuthn/passkey signatures", plus staking at **0x1000** and reserve balance at **0x1001**. — [Monad docs: Precompiles](https://docs.monad.xyz/developer-essentials/precompiles.md); [Differences](https://docs.monad.xyz/developer-essentials/differences)
- **Fusaka/Osaka EIPs** activated with MONAD_NINE (MIP-5): EIP-7823, EIP-7883, EIP-7939 (CLZ opcode). — [Releases](https://docs.monad.xyz/developer-essentials/changelog/releases); [search summary / Phemex](https://phemex.com/news/article/monad-mainnet-to-hard-fork-for-monadnine-upgrade-67446)
- **EIP-7702:** supported. Delegated EOAs **cannot drop below 10 MON** and **cannot execute CREATE/CREATE2**. — [Differences](https://docs.monad.xyz/developer-essentials/differences); [Reserve Balance](https://docs.monad.xyz/developer-essentials/reserve-balance.md)
- **Tx types:** type 3 (EIP-4844 blob) txs are not supported. — [Differences](https://docs.monad.xyz/developer-essentials/differences)
- **RPC differences:**
  - `eth_sendRawTransaction` may accept txs with nonce gaps or insufficient balance (validation is deferred).
  - `eth_getTransactionByHash` returns `null` for txs that are still pending.
  - `eth_feeHistory` returns the latest base fee twice.
  - The debug/trace methods require an explicit options object and default to `callTracer`.
  - `eth_getLogs` block range limits vary by provider (100–1,000 blocks); Alchemy also caps results at 10k logs.
  - `eth_call` gas caps are 200M–1B depending on provider.
  - — [JSON-RPC overview](https://docs.monad.xyz/reference/json-rpc/overview.md)
  - MONAD_NINE moved RPC state queries from finalized to proposed blocks to reduce latency. — [Releases](https://docs.monad.xyz/developer-essentials/changelog/releases)
  - `eth_simulateV1` was added in v0.15.0 (behind a flag). — [Releases](https://docs.monad.xyz/developer-essentials/changelog/releases)
- **eth_call state lag:** `latest` means Proposed (speculative) state, which "is likely more up-to-date". Calls against old block numbers "may fail, because full nodes do not provide access to arbitrary historic state." — [JSON-RPC overview](https://docs.monad.xyz/reference/json-rpc/overview.md); [Async Execution](https://docs.monad.xyz/monad-arch/consensus/asynchronous-execution.md)
- **Historical data:** full nodes keep all historical *transactional* data (blocks, txs, receipts, logs, traces), but state only for ~**40,000 blocks on a 2TB SSD** (this varies with state diffs). The docs note blocks are "18x larger" and "40x more frequent" than Ethereum's. A dedicated historical-state RPC is at `https://rpc-mainnet.monadinfra.com` (eth_call, getBalance, getStorageAt, debug_traceCall, etc.). The docs recommend events or an indexer instead. — [Monad docs: Historical Data](https://docs.monad.xyz/developer-essentials/historical-data.md)
- **Network info:** chain ID **143**, symbol MON, current version v0.15.2 / MONAD_NINE per the network page (possibly stale given the MONAD_TEN activation on Sept 2). Public RPC rate limits run from 15–25 rps (QuickNode 25 rps, Alchemy 15 rps with debug/trace disabled). The explorers are MonadVision, Monadscan and gmonads.com. — [Monad docs: Network Information](https://docs.monad.xyz/developer-essentials/network-information/index.md)

### Inferences
- **Hackathon checklist:**
  - (a) Always set tight gas limits. Do not hardcode 1M-gas limits in scripts or agents, because you pay for them.
  - (b) Fund demo wallets and session keys with more than 10 MON, especially 7702-delegated ones, or transfers will silently revert on-chain.
  - (c) After funding a new account, wait ~3 blocks (~1s) before it sends.
  - (d) Don't rely on the pending-tx lookup or mempool watching; use `monadNewHeads`/`monadLogs` instead.
  - (e) Index events off-chain; don't `eth_call` at old block heights.
  - (f) Pack related state into contiguous slots (structs/arrays) to use 128-slot page warming.
  - (g) Avoid designs that touch many distinct cold contracts per tx (10,100 gas each).
- P256 at 0x0100, combined with EIP-7702, makes passkey-signed smart accounts cheap and native. That is a strong consumer-UX angle, with the caveat that delegated EOAs need a 10 MON floor and cannot deploy contracts.
- The 128 KB contract limit lets you ship monolithic contracts, such as a full orderbook with its matching engine, without diamond/proxy splitting.

### Gaps
- I did not find the exact P256VERIFY gas cost on Monad (EIP-7951 specifies 6,900; Monad's repricing table did not list it).
- I found no explicit numeric "eth_call lag in blocks" beyond the fact that `latest` = Proposed. The reserve-balance and new-account lag is k = D = 3 blocks.

## Q4: App categories Monad's performance makes viable (with examples)

### Takeaway
Monad's official positioning is "high-frequency finance": fully onchain CLOBs and perps where market makers can post and cancel cheaply, plus FX/stablecoin payments and agent micropayments via x402. Live examples include Kuru (CLOB+AMM), Perpl (onchain CLOB perps), Monday Trade (perps), Clober and Hanji (CLOBs), Mento (FX), and an official x402 facilitator. I found little evidence of breakout fully-onchain games on mainnet.

### Cited Findings
- **Perpl** (perps DEX, launched Feb 24, 2026) handles "1,000 post-and-cancels per second" at ~$0.0001/tx. — [Monad blog: High-Frequency Finance](https://monad.xyz/blog/monad-home-high-frequency-finance). Monad calls it the first perps DEX combining fully onchain execution, a CLOB, and gas efficiency that makes market making viable. It raised $92.5M (Dragonfly, Brevan Howard). — search summary of the same blog, [Monad blog](https://blog.monad.xyz/blog/monad-home-high-frequency-finance)
- **Kuru:** a hybrid CLOB-AMM ("limit order precision with always-on AMM liquidity"), $13.6M raised. — [Monad blog](https://monad.xyz/blog/monad-home-high-frequency-finance). A July 2025 raise of $11.6M was led by Paradigm. — search summary ([Backpack Learn](https://learn.backpack.exchange/articles/monad-ecosystem))
- Other trading apps (secondary sources, some pre-mainnet):
  - Monday Trade: perps up to 33x, launched Dec 2025
  - Drake Exchange: fully onchain matching and risk engine
  - Hanji and Clober: CLOBs
  - Narwhal
  - — [Medium ecosystem overview (Apr 2026)](https://medium.com/@HUSTLEROO1/monad-ecosystem-9b6113902682); [0x: Order books on Monad](https://0x.org/post/0x-101-order-books-on-monad); [PANews](https://www.panewslab.com/en/articles/e8fdbff9-3288-48be-bf2e-ac8bfebb3972)
  - Drake and Narwhal lack confirmed 2026 mainnet launches.
- **FX / RWA / credit / payments:**
  - Mento (oracle FX, 15 currencies, $18.5B volume in 2025)
  - Etherfuse (tokenized sovereign bonds)
  - Valos (private credit, $100M initial allocations)
  - USDC native at launch; stablecoin supply above $410M
  - Integrations with Zerohash, Bidali, Fireblocks, Anchorage, Coinbase
  - — [Monad blog](https://monad.xyz/blog/monad-home-high-frequency-finance)
  - The 300ms blog also pitches sub-second deterministic finality to stablecoin card issuers. — [Monad blog: 300ms](https://monad.xyz/blog/300ms-block-times)
- **Agents / micropayments:**
  - The Monad Foundation joined the x402 Foundation (June 2026).
  - Monad runs an x402 facilitator (`https://x402-facilitator.molandak.org`, mainnet and testnet, "exact" scheme recommended for USDC), supports ERC-8004 agent identity, and ships x402 Permit2 proxies.
  - USDC on Monad: `0x754704Bc059F8C67012fEd69BC8A327a5aafb603`.
  - — [Monad docs: x402 guide](https://docs.monad.xyz/guides/x402); [Monad blog: x402 Foundation](https://blog.monad.xyz/blog/monad-foundation-joins-x402-foundation); [agent-pay-monad (GitHub)](https://github.com/filip-study/agent-pay-monad)
  - Monad itself admits agentic commerce volumes "are small" today. — [Monad blog: x402 Foundation](https://blog.monad.xyz/blog/monad-foundation-joins-x402-foundation)
- Featured apps on monad.xyz: Kuru, Perpl, USDC bridge, FastLane (staking), KyberSwap, LFJ, Levr Bet (prediction), with 143+ apps live. — [monad.xyz](https://monad.xyz/) (via search summary)
- A skeptical view (Apr 2026): capital is onchain, but organic fee revenue is not there yet. The Monad Momentum program funds teams that show retention. — [bex.co](https://bex.co/blog/2026/04/12/monad-mainnet-parallel-evm-tps-vs-distribution-thesis) (via search summary)

### Inferences
- Onchain CLOB market making is the flagship use case, and it works because of three things together: (1) ~$0.0001 per order/cancel, (2) 300ms blocks, and (3) 128 KB contracts that let the matching engine live in one contract. Ethereum L1 fails on cost. Typical L2s have the cost but trade off latency, a centralized sequencer, or MEV. MegaETH's 10ms blocks beat Monad on raw latency.
- For a hackathon, the least-contested categories with strong tech-fit arguments are:
  - agent-to-agent x402 micropayments with sub-second finality
  - passkey (P256) wallets combined with EIP-7702 for consumer payments
  - real-time onchain games or prediction markets that exploit 300ms blocks and commit-state WebSocket feeds

### Gaps
- I found no verified examples of fully onchain games with meaningful mainnet traction on Monad.
- I did not retrieve per-app volume metrics for Kuru or Perpl, or up-to-date Sept 2026 TVL figures (the latest I found: $355M TVL in mid-April 2026 per [BlockEden](https://blockeden.xyz/blog/2026/04/18/monad-vs-megaeth-high-performance-evm-mainnet-battle-2026/)).

## Q5: Comparison with MegaETH, Solana, Base, Sei, Hyperliquid

### Takeaway
Monad's niche is the **decentralized, general-purpose, bytecode-compatible EVM L1** with sub-second BFT finality: 200+ validators on consumer-grade hardware. Where competitors win:
- **MegaETH** wins on raw latency (10ms blocks, single sequencer, Ethereum security).
- **Solana** has the deepest high-performance ecosystem, but is non-EVM.
- **Sei** is the closest like-for-like parallel-EVM rival, with ~400ms blocks and an aspirational Giga upgrade.
- **Hyperliquid** dominates perps via vertical integration.
- **Base** wins on distribution and TVL.

### Cited Findings
- **Monad vs MegaETH:**
  - MegaETH is an L2 (mainnet Feb 9, 2026) with a single sequencer, 10ms blocks, EigenDA for data availability, a claimed 100k TPS ceiling, and ~35k TPS sustained in stress tests. Its sequencers need "100-core CPUs and 1–4 TB of RAM".
  - Mid-April 2026 TVL: Monad $355M vs MegaETH $110.8M.
  - — [BlockEden (Apr 18, 2026)](https://blockeden.xyz/blog/2026/04/18/monad-vs-megaeth-high-performance-evm-mainnet-battle-2026/)
  - More comparisons: [Messari compare](https://messari.io/compare/megaeth-vs-monad); [Bankless cheatsheet](https://www.bankless.com/read/your-megaeth-vs-monad-cheatsheet)
- **Solana:**
  - Theoretical 65k TPS; sustained mainnet throughput of roughly 1–4k TPS per Chainspect.
  - Firedancer is live, with a 1M TPS lab target.
  - Alpenglow targets 100–150ms finality (down from ~12.8s) with Q3 2026 mainnet activation; I could not confirm it has activated.
  - — search summary citing [BlockEden](https://blockeden.xyz/blog/2026/02/26/solana-firedancer-alpenglow-1m-tps/) and [Chainspect](https://chainspect.app/compare/hyperliquid-vs-solana)
- **Sei:**
  - ~400ms blocks on mainnet today; historical benchmarks of ~5k–12.5k TPS.
  - The Giga upgrade (Eidos/Ares client rolling out; v6.6 made Ares the default) targets 200k TPS and sub-400ms finality. The July 2026 whitepaper v2 targets sub-250ms. These are internal test figures.
  - Sei is moving to EVM-only.
  - — [bex.co](https://bex.co/blog/2026/03/17/sei-network-parallel-evm-deep-dive-200k-tps-financial-execution-layer); [Altcoin Buzz](https://www.altcoinbuzz.io/sei-giga-upgrade-eidos-200000-tps)
- **Hyperliquid:**
  - HyperBFT; claims up to 200k TPS (early-2025 figure).
  - An app-specific chain for perps, averaging ~$3.7M daily revenue (vs Solana ~$0.79M) per a comparison source.
  - — search summary via [Messari](https://messari.io/compare/hyperliquid-vs-solana) / [Gate Learn](https://www.gate.com/learn/articles/mega-eth-vs-monad-vs-hyperliquid-who-leads-in-instant-blockchain-transactions/5827)
- **Base:** holds ~46% of L2 DeFi TVL (the framing is "distribution vs TPS"). — [bex.co (Apr 12, 2026)](https://bex.co/blog/2026/04/12/monad-mainnet-parallel-evm-tps-vs-distribution-thesis) (via search result title)

### Inferences
- Positioning line for pitches: "Solana-class latency, Ethereum tooling, L1 decentralization." Against Hyperliquid, Monad offers general-purpose composability (an app can build on Perpl or Kuru liquidity). Against MegaETH, Monad offers no single-sequencer trust. Against Base, Monad offers ~600ms deterministic finality and parallel execution, but with far less user distribution.
- Every competitor's headline TPS is a lab or target number. Observed load is far lower everywhere, so comparisons should focus on latency, finality and cost per tx rather than TPS.

### Gaps
- I did not retrieve Base's current block time or finality figures (the ~200ms Flashblocks preconfirmation vs L1 finality question was not researched).
- I have no verified Sept 2026 live TPS for any of these chains.
- Independent analyst reports (Paradigm, Galaxy, Delphi) were not reviewed.
