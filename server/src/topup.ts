import { TopUpError, type TopUpOrigin, type TopUpProvider, type TopUpStatus } from "@bilbypay/topup";
import { type Address, erc20Abi, getAddress, type Hex, parseEventLogs } from "viem";
import type { ActivityRepo } from "./activity";
import type { ChainService } from "./chain";
import type { Config } from "./config";
import { type Db, tx } from "./db";
import { ApiError, errors } from "./errors";
import type { Treasury } from "./treasury";
import { KeyedMutex, nowIso, randomBytes32 } from "./util";

type Row = {
  quote_id: string;
  owner_address: string;
  origin: string;
  amount_in: string;
  expected_out: string;
  status: TopUpStatus | "crediting";
  credit_amount: string | null;
  credit_nonce: string | null;
  credit_tx: string | null;
  activity_id: string | null;
};

const MESSAGES = {
  processing: "Money received. Adding it to your balance now.",
  completed: "Added to your balance.",
} as const;

/**
 * Top-ups from other networks. The provider can only deliver USDC on Monad, but balances are AUSD,
 * so top-ups are delivered to the **treasury** and the server credits the user the same amount in
 * AUSD from the treasury's float:
 *
 *   user sends USDC on Base → provider delivers USDC on Monad to the treasury
 *   → we check the delivery on-chain → treasury pays the user AUSD (one EIP-3009 payment).
 *
 * Refunds (a top-up the provider can't complete) go back to the user's own address on the origin
 * network, never to the treasury. The USDC the treasury accumulates is converted back to AUSD out
 * of band (treasury ops), which is why the credit is 1:1 and the treasury carries the float.
 */
export class TopUpService {
  private readonly locks = new KeyedMutex();

  constructor(
    private readonly db: Db,
    private readonly config: Config,
    private readonly chain: ChainService,
    private readonly provider: TopUpProvider,
    private readonly treasury: Treasury,
    private readonly activity: ActivityRepo,
  ) {}

  /**
   * Only origins whose refund address can be the user's own account (EVM networks: the passkey
   * account has the same address everywhere). Other networks would need the user to type a refund
   * address, which we don't ask for.
   */
  origins(): TopUpOrigin[] {
    return this.provider.supportedOrigins().filter((o) => o.addressKind === "evm");
  }

  async quote(user: Address, originAsset: string, amount: bigint) {
    const origin = this.origins().find((o) => o.id === originAsset || o.assetId === originAsset);
    if (!origin) throw errors.invalidRequest("We can't add money from there yet. Please pick another option.");
    if (!this.config.usdc) throw errors.internal();
    const quote = await run(() =>
      this.provider.quote({ originAsset: origin.id, amount, recipient: this.treasury.address, refundTo: user }),
    );
    if (!quote.depositAddress) throw errors.internal();
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO topups (quote_id, owner_address, origin, amount_in, expected_out, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'waiting', ?, ?)`,
      )
      .run(quote.quoteId, user, origin.id, quote.amountIn.toString(), quote.amountOut.toString(), now, now);
    return quote;
  }

  /** Owner-only status; settles (credits AUSD) as soon as the provider reports the delivery. */
  async status(user: Address, quoteId: string) {
    const row = this.get(quoteId);
    if (!row || getAddress(row.owner_address) !== getAddress(user)) throw errors.notFound();
    const settled = await this.settle(quoteId);
    return settled;
  }

  /** Keeper: move every open top-up forward. */
  async settlePending() {
    const open = this.db
      .prepare("SELECT quote_id FROM topups WHERE status IN ('waiting', 'processing', 'crediting')")
      .all() as { quote_id: string }[];
    for (const { quote_id } of open) {
      await this.settle(quote_id).catch((e) => console.error(`top-up ${quote_id}:`, e instanceof Error ? e.message : e));
    }
  }

  private settle(quoteId: string): Promise<{ status: TopUpStatus; message: string; amountOut?: string; refundedAmount?: string }> {
    return this.locks.run(quoteId, async () => {
      const row = this.get(quoteId)!;
      if (row.status === "completed") return { status: "completed", message: MESSAGES.completed, amountOut: row.credit_amount! };
      if (row.status === "failed" || row.status === "refunded") return { status: row.status, message: failMessage(row.status) };

      if (row.status !== "crediting") {
        const st = await run(() => this.provider.status(quoteId));
        if (st.status === "failed" || st.status === "refunded") {
          this.setStatus(quoteId, st.status);
          return { status: st.status, message: st.message, refundedAmount: st.refundedAmount?.toString() };
        }
        if (st.status !== "completed") {
          if (st.status !== row.status) this.setStatus(quoteId, st.status);
          return { status: st.status, message: st.message };
        }
        // Delivered according to the provider: trust only what we can see arrive in the treasury.
        const delivered = await this.verifyDelivery(quoteId, st.destinationTxHashes as Hex[]);
        if (delivered === 0n) return { status: "processing", message: MESSAGES.processing };
        const credit = st.amountOut !== undefined && st.amountOut < delivered ? st.amountOut : delivered;
        this.db
          .prepare("UPDATE topups SET status = 'crediting', credit_amount = ?, credit_nonce = ?, updated_at = ? WHERE quote_id = ?")
          .run(credit.toString(), randomBytes32(), nowIso(), quoteId);
      }
      return this.credit(quoteId);
    });
  }

  /** Sums USDC transfers into the treasury in the provider's delivery transactions (each usable once). */
  private async verifyDelivery(quoteId: string, hashes: Hex[]): Promise<bigint> {
    let total = 0n;
    const usable: Hex[] = [];
    for (const hash of hashes) {
      const claimed = this.db.prepare("SELECT quote_id FROM topup_deliveries WHERE tx_hash = ?").get(hash) as { quote_id: string } | undefined;
      if (claimed && claimed.quote_id !== quoteId) continue;
      const receipt = await this.chain.client.getTransactionReceipt({ hash }).catch(() => undefined);
      if (!receipt || receipt.status !== "success") continue;
      const transfers = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: receipt.logs }).filter(
        (l) => getAddress(l.address) === getAddress(this.config.usdc!) && getAddress(l.args.to) === getAddress(this.treasury.address),
      );
      for (const t of transfers) total += t.args.value;
      if (transfers.length) usable.push(hash);
    }
    if (total > 0n) {
      tx(this.db, () => {
        for (const hash of usable) this.db.prepare("INSERT OR IGNORE INTO topup_deliveries (tx_hash, quote_id) VALUES (?, ?)").run(hash, quoteId);
      });
    }
    return total;
  }

  /** Treasury → user AUSD with the saved nonce, so a retry after a crash can never pay twice. */
  private async credit(quoteId: string): Promise<{ status: TopUpStatus; message: string; amountOut?: string }> {
    const row = this.get(quoteId)!;
    const user = getAddress(row.owner_address);
    const amount = BigInt(row.credit_amount!);
    const nonce = row.credit_nonce as Hex;
    let hash: Hex | undefined;
    if (!(await this.treasury.nonceUsed(nonce))) {
      if ((await this.treasury.balance()) < amount) {
        console.error(`top-up ${quoteId}: treasury float too low to credit ${amount}`);
        return { status: "processing", message: MESSAGES.processing };
      }
      hash = (await this.treasury.pay(user, amount, "topup.credit", nonce)).hash;
    }
    const act = this.activity.add({ address: user, kind: "received", status: "completed", amount, note: "Added money", txHash: hash });
    this.db
      .prepare("UPDATE topups SET status = 'completed', credit_tx = ?, activity_id = ?, updated_at = ? WHERE quote_id = ?")
      .run(hash ?? null, act.id, nowIso(), quoteId);
    return { status: "completed", message: MESSAGES.completed, amountOut: amount.toString() };
  }

  private get(quoteId: string): Row | undefined {
    return this.db.prepare("SELECT * FROM topups WHERE quote_id = ?").get(quoteId) as Row | undefined;
  }

  private setStatus(quoteId: string, status: Row["status"]) {
    this.db.prepare("UPDATE topups SET status = ?, updated_at = ? WHERE quote_id = ?").run(status, nowIso(), quoteId);
  }
}

function failMessage(status: "failed" | "refunded"): string {
  return status === "refunded"
    ? "This top-up couldn't be completed, so your money was returned."
    : "This top-up didn't go through. If money left your account, contact support.";
}

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof TopUpError) throw new ApiError(err.httpStatus && err.httpStatus < 500 ? 400 : 502, err.code, err.userMessage, err.details ?? {});
    throw err;
  }
}
