# No-lockup staking and yield on Monad mainnet (chain 143), for BilbyPay

Researched 2026-09-25. On-chain reads use `cast` against https://rpc.monad.xyz at block ~107,861,519.
Legend: **[C]** = confirmed on-chain or in official docs/code. **[U]** = uncertain (third-party source, docs don't say, or it changes often).
MON price used for USD figures: 1000 MON is about 25.66 USDC (KyberSwap quote, same day), so **1 MON is about $0.0257** [C, live quote].

---

## TL;DR
- **Native staking has no instant exit.** You `undelegate`, wait for the epoch boundary plus 1 epoch, then `withdraw`. An epoch is now about **4.2 h**, so the wait is about **4–13 h**. [C]
- **shMON (FastLane) is the only LST with a built-in instant redeem.** It is an ERC-4626-like vault; `redeem` / `withdraw` pay out MON in the same transaction. Right now the fee is **about 0.92%** (the maximum is 1.005%) and the pool holds only **about 509k MON (about $13k)**. [C]
- **Swapping the LST on a DEX is currently the cheapest instant exit for every LST.** For shMON, 1k–1M shMON sell at about 0.04–0.10% under fair value (Curve stable-ng, Balancer v3, Uniswap v4). sMON and gMON sell at about 0.10–0.14% under. aprMON is thin: about 3% under at 1M. [C, live aggregator quotes]
- **Stablecoins: Aave v3 (USDC/AUSD) is the simplest instant-withdraw option**, limited only by utilization. USDC supply APY is about 4.1% base, and about 5.9% with rewards. The pool has **$11.45M of free USDC** (91.7% utilized). There are ERC-4626 "stata" wrappers. [C]
- USDC, AUSD and mUSD all support **EIP-2612 permit and EIP-3009 transferWithAuthorization** on Monad, so gasless deposits through a relayer are possible. [C]

---

## 1. Native Monad staking (precompile `0x0000…1000`)

| Item | Value | Status / source |
|---|---|---|
| Address | `0x0000000000000000000000000000000000001000`. `codesize` = 0 (it is a precompile, so there is no bytecode) | [C] on-chain; https://docs.monad.xyz/developer-essentials/staking/staking-precompile |
| Calls | `delegate(uint64) payable`, `undelegate(uint64,uint256,uint8 withdrawId)`, `withdraw(uint64,uint8)`, `compound`, `claimRewards`, `getEpoch()`, `getDelegator`, `getWithdrawalRequest`, `getValidator` | [C] docs |
| CALL only | STATICCALL / DELEGATECALL revert. View functions are declared nonpayable. You can't test against a fork | [C] docs |
| Gas | delegate 260,850; undelegate 147,750; withdraw 68,675 | [C] docs |
| Minimum delegation | `msg.value` ≥ DUST_THRESHOLD = **1 gwei**, so in practice no minimum | [C] https://docs.monad.xyz/reference/staking/overview |
| WITHDRAWAL_DELAY | **1 epoch** after the undelegation takes effect | [C] docs |
| Epoch length | 50,000 blocks, plus a 5,000-round EPOCH_DELAY_ROUNDS. I measured 100k blocks = 30,207 s, which is **0.302 s/block, so an epoch is about 4.19 h**. Current `getEpoch()` = 2158, not in the delay period. Note: many guides still say "~5.5 h" (that was the 0.4 s block time) | [C] on-chain |
| Activation | A change takes effect at epoch n+1 if sent before the boundary block, or n+2 if sent during the delay window | [C] docs |
| Total exit time | About 1–3 epochs, so **about 4–13 h**. Ledger's integration says "max ~3 epochs" | [C] mechanics; [U] exact worst case — https://github.com/LedgerHQ/ledger-live/pull/17801 |
| Rewards | `claimRewards` is immediate. Only principal is delayed | [C] docs |
| Up to 255 in-flight withdrawals per (validator, delegator) pair | | [C] docs |

**Instant path: none in the protocol.** The only instant route is to hold an LST instead (see §2). Native staking also needs you to choose a validator and to hold stake in the user's own EOA or smart account.

---

## 2. Liquid staking tokens (LSTs)

### On-chain snapshot (my reads)
| LST | Token / proxy | Impl (EIP-1967) | Supply | Backing MON | MON per LST | Instant redeem in protocol? |
|---|---|---|---|---|---|---|
| **shMON** (FastLane) | `0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c` | `0x856a4019…a18e1b` (**matches** the implementation FastLane's `use-shmonad` skill requires) | 206.2M | 335.2M (`totalAssets`) | 1.6256 (`convertToAssets`) | **YES.** Atomic `redeem`/`withdraw` |
| **sMON** (Kintsu) | `0xA3227C5969757783154C60bF0bC1944180ed81B9` | `0x6a4593ba…af21f` | 79.66M | 88.40M (`totalPooled`) | 1.1098 | No. `requestUnlock` → batch → cooldown → `redeem` |
| **gMON** (Magma) | `0x8498312A6B3CbD158bf0c93AbdCF29E6e4F55081` | `0xa1f511e1…97afd2` | 38.24M | 42.04M | 1.0995 | No. `previewRedeem` reverts (async `requestRedeem`); `withdrawalFee()`=10 bps; `rewardsFee()`=500 bps |
| **aprMON** (aPriori, now "Capricorn" docs) | `0x0c65A0BC65a5D819235B71F554D210D3F80E0852` | `0x7d2f8dc5…d106f2` | 23.19M | 25.00M | 1.0916 | No. `maxWithdraw` = 0; `withdrawalFee()`=10 (0.1%); `withdrawalDelay()`=1; `epochLength()`=50000 |
| others | earnMON `0x8FA1…cA7D` (Upshift vault, 0.34M), mcMON `0x1D47…7b51` (0.14M), LVMON `0x91b8…6D56` (LeverUp, 72M) | | | | | not assessed. Small or not plain LSTs |
Addresses come from the Monad token list: https://raw.githubusercontent.com/monad-crypto/token-list/main/tokenlist-mainnet.json [C]

### shMON (FastLane): the only protocol-level instant exit
- Atomic path: `redeemWithSlippageProtection` / `withdrawWithSlippageProtection` (recommended), or plain `redeem` / `withdraw`. MON arrives in the same transaction. Quote with `previewRedeemDetailed(shares) -> (gross, fee, net)`. Size limit comes from `maxRedeem(owner)` / `maxWithdraw(owner)`, which are liquidity-aware. Note that `previewRedeem` ignores the pool limit. [C] https://github.com/FastLane-Labs/fastlane-contracts/tree/main/use-shmonad (holder-operations.md)
- **Live fee:** `previewRedeemDetailed(1e18)` returned gross 1.625606, fee 0.014963, net 1.610643 MON, so the **fee is 0.920%**. At 1000 shMON the fee is the same %. [C on-chain]
- Documented fee curve: 0.005% at 0% pool utilization, rising linearly to 1.005% at full utilization. The pool target is about 2% of equity. [C] https://docs.shmonad.xyz/parameters-and-fees/
- **Live pool:** `getCurrentLiquidity()` = **508,937 MON (about $13k)**. That is about 0.15% of TVL, well below the 2% target, and the pool is about 91% utilized. This is fine for consumer-size exits, but it's expensive right now. [C on-chain]
- Traditional path: `requestUnstake(shares)` then `completeUnstake()` once `getInternalEpoch() >= completionEpoch`. It is fee-free and takes shMonad epoch N+5 (about 28 h) or N+7 (about 39 h). It can't be cancelled. The docs site says "~22–27 h". [C] skill doc; https://docs.shmonad.xyz/unstaking/traditional/
- Fees: 5% of staking rewards and 25% of MEV/other revenue. [C] https://docs.shmonad.xyz/parameters-and-fees/
- APY: **about 11.7%** (DefiLlama). TVL about $9.4M (335M MON). [U, changes often] https://yields.llama.fi/pools
- Audits: Cantina v1.0 and v1.1, Guardian v1.0. PDFs are in https://github.com/FastLane-Labs/fastlane-contracts/tree/main/audits [C]
- Integration: native-MON ERC-4626-like vault (`asset()` = `0xEeee…EEeE`). You deposit with `deposit(assets, receiver)` payable. There is a full ABI and an agent skill in the repo above. Watch out: a plain MON transfer to the contract counts as a donation and mints nothing. [C]

### Kintsu sMON
- Redemption: `requestUnlock(shares)` → batch (`sendBatchUnlockRequests`) → COOLDOWN → `redeem(unlockIndex, receiver)`. There is no fast path. You can cancel only within the same batch interval. [C] https://docs.kintsu.xyz/the-kintsu-protocol/architecture-and-integration/monad-lst-architecture/3rd-party-integration-guide
- Mainnet batch and cooldown lengths are not documented. The testnet blog said "48 h batching + 14 d unbonding", which is almost certainly not the mainnet value. There is a reported 0.10% exit fee. [U] https://docs.kintsu.xyz/resources/faqs, https://kintsu.xyz/blog/kintsu-live-on-monad-testnet-open-access-for-all
- Kintsu's own docs point users to DEX swaps for instant exit. [C] FAQ
- APY about 4.7%, TVL about $2.3M. [U] DefiLlama. Audit: Cantina "Kintsu Monad Contracts Core" is in the Cantina portfolio. [U] https://cantina.xyz/portfolio

### Magma gMON
- Redemption goes through CoreVault (`0xB1d57De83D80a2AbAc91714744DFE97e71B73dC0`, code present). It unstakes from validators and pays out once the withdrawal matures. There is no instant path. On-chain `withdrawalFee` is 10 bps. [C] https://docs.hydrogenlabs.xyz/magma/liquid-staking-gmon and on-chain
- Exact wait is not documented. It is probably native unbonding plus buffer, about 0.5–1 day. [U]
- APY about 10.7%, TVL about $1.1M (DefiLlama shows only a small portion. On-chain there are 42M MON, about $1.08M). [U]. Audit: Cantina "Magma: Monad Liquid Staking Protocol" (Hydrogen Labs). [U] https://cantina.xyz/portfolio

### aPriori aprMON
- `requestRedeem` → wait out the withdrawal period (native unbonding plus buffer) → claim. The fee is 0.1% on redeem and 10% of rewards. The docs warn that MetaMask can set a 52M gas limit when a claim reverts, which can cost up to about 2.73 MON. [C] https://apriori-docs.gitbook.io/apriori-docs/faqs/faq (now redirects to capricorn-docs.gitbook.io) and on-chain `withdrawalFee()=10`

### Instant exit by DEX swap (KyberSwap aggregator, LST → native MON, 2026-09-25)
Discount = quote ÷ on-chain fair rate − 1:
| LST | 1k | 100k | 1M | 10M | Main venues |
|---|---|---|---|---|---|
| shMON | −0.04% | −0.04% | −0.10% | −17.6% | Curve stable-ng, Balancer v3, Uniswap v4 |
| sMON | −0.10% | −0.10% | −0.14% | −3.7% | Curve stable-ng |
| gMON | −0.10% | −0.11% | −0.14% | −3.6% | Balancer v3 stable, Curve |
| aprMON | −0.18% | −0.37% | −3.2% | −86% | Atlantis, Capricorn v3 |
Source: `https://aggregator-api.kyberswap.com/monad/api/v1/routes?tokenIn=<LST>&tokenOut=0xEeee…EEeE&amountIn=…` [C live, changes per block]. There is also a Curve WMON/shMON/sMON/gMON pool (about $0.6M) on DefiLlama.
**Takeaway:** at consumer sizes (under about $25k), selling shMON on a DEX currently costs about 0.04%, compared with 0.92% for the atomic redeem. BilbyPay should quote both and route to the better one.

---

## 3. Stablecoin yield with instant withdrawal

| Venue | Asset / address | Instant? | APY (DefiLlama, 9/25) | Liquidity / notes |
|---|---|---|---|---|
| **Aave v3** Pool `0x69a5F9AD4f96ebf0a0C792dD42a01cC5C0102fef` | USDC aToken `0x35a73BAcb179d3740395A3ceCc87FF2e581d6042`; **stataUSDC (ERC-4626)** `0xC554aFfE2f581F5E0811e0D42D484ECaC5c6B8e2` | Yes, up to available cash | 5.92% (4.11% base + 1.81% rewards). On-chain liquidityRate = 4.11% | Supply 137.97M USDC, **cash 11.45M, 91.7% utilized** [C on-chain] |
| Aave v3 | AUSD aToken `0xdeBFeDF35faEd5d1664E553545e144C02227A2Ec`; **stataAUSD** `0x9e1AcC5BFbf34e2E579763cE14042d957719fE76` | Yes | 6.04% (3.42% base + 2.62% rewards) | Supply 9.82M, **cash 2.17M, 77.9% utilized** [C] |
| Aave v3 | mUSD, USDT0, GHO | Yes | about 6.0% | [U] DefiLlama |
Addresses: https://github.com/bgd-labs/aave-address-book/blob/main/src/AaveV3Monad.sol [C]. Monad paid $15M in incentives around the Aave launch in July 2026 [U] https://cryptobriefing.com/monad-ausd-incentives-75k-weekly/ ; https://cryptobriefing.com/agora-ausd-stablecoin-monad-growth/

| Venue | Vault | Instant? | Net APY | TVL / instant liquidity (Morpho API) |
|---|---|---|---|---|
| Morpho V2 | Hyperithm USDC Apex `0x78999cc96d2Ba0341588C60CcB0E91c6C33CF371` | **Effectively no** (liquidity $0) | 7.17% | $39.0M / **$0** |
| Morpho V2 | August USDC V2 `0x80017bF0f793EBbE9679Cd61ff0e395B62CAbB59` | partial | 12.99% (includes RWA/credit) | $7.16M / $0.74M |
| Morpho V2 | SharpByte AUSD Tori `0x790e4f829fe865d432c4Ea83B8B15F8871415B6c` | partial | 7.09% | $5.61M / $0.33M |
| Morpho V2 | Clearstar Accountable AUSD `0xbe3E6d3F857812B4731677C88288D4F3afF8E9a1` | partial | 5.57% | $3.00M / $0.29M |
| Morpho V2 | Steakhouse High Yield USDC `0xbeEFf443C3CbA3E369DA795002243BeaC311aB83` | yes (small) | 5.55% | $0.37M / $0.09M |
Source: https://api.morpho.org/graphql (`vaultV2s`, chainId 143) [C API; U over time]. Morpho vaults are ERC-4626, but many Monad vaults allocate to illiquid RWA or credit markets, so **check `liquidityUsd` before treating one as instant**. MetaMask's mUSD vault is curated by Steakhouse on Veda and allocates to Morpho and Aave.

| Venue | Notes |
|---|---|
| **Euler v2** | K3 Capital Earn AUSD (about $18M, 6.5%), Clearstar Earn USDC (about $5.9M, 7.6%). EulerEarn vaults are ERC-4626 with instant withdrawal up to idle and underlying liquidity. [U] addresses not pulled; https://yields.llama.fi/pools |
| **Curvance** | Lending markets. USDC/AUSD supply is about 5–9%, but individual markets are small (under $3M). [U] |
| **Upshift earnAUSD** `0x103222f020e98Bba0AD9809A011FDF8e6F067496` (vault `0x36eDbF0C834591BFdfCaC0Ef9605528c75c406aA`) | **Queued withdrawal up to 72 h.** Instant redeem is possible for a fee, if reserves are available. Not plain ERC-4626 (`asset()` reverts). About 6.3%, $26M. [C] https://www.upshift.finance/help-center/en/articles/14471701-earning-stablecoin-yield-on-monad-with-earnausd |
| **MetaMask Money Account / mUSD** (`0xacA92E438df0B2401fF60dA7E4337B687a2435DA`) | Up to 4% base, about 6% boosted until **2026-09-30**. No lockups. Gas is sponsored. Mobile app only. **No third-party API/SDK is documented**, and the vault address isn't published. [C] https://metamask.io/news/introducing-metamask-money-account ; https://support.metamask.io/trade/money-account/ ; https://decrypt.co/372298/crypto-wallet-metamask-yield-paying-money-accounts-monad |
| **Agora AUSD** | AUSD itself pays **no yield to holders**. Reserve yield is shared with partners. Yield comes from venues (Aave, Euler, Curvance, Pendle, earnAUSD) plus Monad incentives (about $75k/week for AUSD in July 2026). [U] https://coinmarketcap.com/cmc-ai/agora-finance/what-is/ ; https://cryptobriefing.com/monad-ausd-incentives-75k-weekly/ |
| Accountable, Centrifuge, Pendle PTs | Higher APY (7–17%) but these are credit/RWA or fixed-term. **Not instant.** Skip them for idle balances. |

### Gasless deposits
- On-chain checks: **USDC `0x7547…b603`, AUSD `0x0000…012a`, mUSD `0xacA9…35DA` all expose `nonces()` + `DOMAIN_SEPARATOR()` (EIP-2612) and `TRANSFER_WITH_AUTHORIZATION_TYPEHASH` + `authorizationState()` (EIP-3009).** [C]
- Pattern: the user signs a permit or `receiveWithAuthorization`. A BilbyPay relayer or router contract pulls the funds and calls `stataToken.deposit(assets, user)` or `Pool.supply(asset, amt, onBehalfOf=user, 0)`. Aave also has `supplyWithPermit`. Withdrawals need the user's shares, so either (a) the user signs an EIP-2612 permit on the aToken/stataToken (Aave aTokens support permit) for the router, or (b) use a 4337 smart account with a paymaster (FastLane has paymaster starters: https://github.com/FastLane-Labs). [C mechanism; U for exact router design]

---

## 4. Programs / incentives
- **Monad Momentum**: the Foundation matches app-team incentives up to 1:1 in MON, with KPIs reviewed every two weeks. Wave 1 applications closed on 2025-09-28. I couldn't confirm whether a 2026 wave is open. [C/U] https://blog.monad.xyz/blog/monad-momentum ; https://momentum.monad.xyz/
- Venue-level incentives are live and already included in the "reward APY" figures above (Aave, Curvance about 1.8%, Euler about 1.25%). Other programs: Kintsu points, FastLane points (https://www.fastlane.xyz/blog/fastlane-points), Magma points (https://docs.hydrogenlabs.xyz/magma/points), and Accountable ACC points. [U]
- Incentives are temporary. APYs will fall when they end. [U] https://learn.backpack.exchange/articles/is-monad-crypto-a-good-investment-pros-cons-and-future-outlook

---

## 5. Recommendation (about 2-week build)

**(a) MON staking: shMON with a smart exit router.**
- Stake: `shMON.deposit{value: x}(x, user)`.
- Unstake instantly by quoting both paths at request time and taking the better one:
  1. `previewRedeemDetailed(shares)` and `maxRedeem(user)`, executed with `redeemWithSlippageProtection`;
  2. an aggregator quote (KyberSwap/Kuru) for shMON → MON.
  Today (2) wins, costing about 0.04% against 0.92%.
- Offer the free "slow" path (`requestUnstake`, about 28 h) as a secondary option.
- Before every call, verify the implementation address, as FastLane's skill requires.
- Don't use native delegation for a "no-lock" promise: it takes 4–13 h and has no instant path.

**(b) USD yield on idle balances and gift-card escrow: Aave v3 through the stata ERC-4626 wrappers.**
- Use stataUSDC `0xC554…B8e2` and stataAUSD `0x9e1A…fE76`. The standard `deposit`/`redeem` interface is simple, Aave is the most battle-tested option, withdrawals are instant up to available cash, and USDC has $11M+ free.
- Deposits can be gasless via permit/EIP-3009 plus a relayer.
- Before withdrawing, check `maxWithdraw`. If the pool is close to 100% utilized, fall back to paying out from an unstaked reserve.
- Keep a hot float, for example 10–20% of escrow, **unstaked** so gift-card claims never depend on Aave liquidity.
- Optional later: an EulerEarn or Morpho vault, but only after checking live liquidity. Skip earnAUSD, Accountable and PTs for escrow because they are queued or fixed-term.

**Caveats to show users**
- **Principal risk:** smart-contract, oracle, or bad-debt losses at Aave, shMonad or other venues. Yield is variable and not guaranteed. Incentive APY is temporary.
- **LST risk:** the DEX discount can widen sharply in stress (see the 10M column). The atomic pool is small (about $13k) and its fee can reach 1.005%. Validator or slashing and protocol-upgrade risk (the proxies are upgradeable).
- **Depeg risk:** AUSD, USDC and mUSD can depeg. AUSD liquidity on Monad is incentive-driven.
- **Escrow:** putting unclaimed gift-card funds into yield means BilbyPay is taking risk with other people's money. That needs disclosure, clarity on who keeps the yield, and possibly regulatory review. The US CLARITY Act debate over yield on payment stablecoins is why MetaMask separates reserves from yield. **Don't call it "interest" or "savings"** in the UI. For the hackathon, gate it behind an opt-in toggle and label it "variable yield, not insured".
- MON price is about $0.026, so MON staking returns are small in USD terms. Present them as a feature, not the core product.
