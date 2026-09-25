import { type Address, parseAbi } from "viem";
import type { AccountService } from "./accounts";
import type { ChainService } from "./chain";
import type { ClaimService } from "./claims";
import type { Config } from "./config";
import { maxBig } from "./util";

const aavePoolAbi = parseAbi([
  "struct ReserveConfigurationMap { uint256 data; }",
  "struct ReserveDataLegacy { ReserveConfigurationMap configuration; uint128 liquidityIndex; uint128 currentLiquidityRate; uint128 variableBorrowIndex; uint128 currentVariableBorrowRate; uint128 currentStableBorrowRate; uint40 lastUpdateTimestamp; uint16 id; address aTokenAddress; address stableDebtTokenAddress; address variableDebtTokenAddress; address interestRateStrategyAddress; uint128 accruedToTreasury; uint128 unbacked; uint128 isolationModeTotalDebt; }",
  "function getReserveData(address asset) view returns (ReserveDataLegacy)",
]);

const RATE_TTL_MS = 5 * 60_000;
const SECONDS_PER_YEAR = 31_536_000;

export class BalanceService {
  private rate: { at: number; percent: number } | undefined;

  constructor(
    private readonly config: Config,
    private readonly chain: ChainService,
    private readonly accounts: AccountService,
    private readonly claims: ClaimService,
  ) {}

  /**
   * Burrow's variable rate, as a yearly percentage rounded to 0.1. From Aave's current supply rate
   * when AAVE_POOL_ADDRESS is set, else BURROW_RATE_PERCENT.
   */
  async ratePercent(): Promise<number> {
    if (!this.config.aavePool) return this.config.burrowRatePercent;
    if (this.rate && Date.now() - this.rate.at < RATE_TTL_MS) return this.rate.percent;
    try {
      const data = await this.chain.client.readContract({
        address: this.config.aavePool,
        abi: aavePoolAbi,
        functionName: "getReserveData",
        args: [this.config.ausd.address],
      });
      // currentLiquidityRate is an APR in ray (1e27); compound per second for the yearly figure.
      const apr = Number(data.currentLiquidityRate) / 1e27;
      const apy = (1 + apr / SECONDS_PER_YEAR) ** SECONDS_PER_YEAR - 1;
      const percent = Math.round(apy * 1000) / 10;
      this.rate = { at: Date.now(), percent };
      return percent;
    } catch {
      return this.rate?.percent ?? this.config.burrowRatePercent;
    }
  }

  async balance(user: Address) {
    const [balance, burrow, ratePercent] = await Promise.all([this.chain.ausdBalance(user), this.chain.burrow(user), this.ratePercent()]);
    const principal = BigInt(this.accounts.get(user)?.burrow_net_deposited ?? "0");
    return {
      balance: balance.toString(),
      burrow: {
        amount: burrow.assets.toString(),
        earned: maxBig(0n, burrow.assets - principal).toString(),
        availableNow: burrow.maxWithdraw.toString(),
        ratePercent,
      },
      pendingOut: this.claims.pendingOut(user).toString(),
    };
  }
}
