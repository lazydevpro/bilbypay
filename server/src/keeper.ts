import { bilbyEscrowAbi, bilbyRouterAbi } from "@bilbypay/core";
import { type Address, encodeFunctionData, getAddress, type Hex, parseAbiItem, parseEventLogs } from "viem";
import type { AccountService } from "./accounts";
import type { ActivityRepo } from "./activity";
import type { ChainService } from "./chain";
import type { ClaimService } from "./claims";
import type { Config } from "./config";
import { type Db, kvGet, kvSet } from "./db";
import type { GiftCardService } from "./giftcards/service";
import type { TxSender } from "./relayer";
import type { TopUpService } from "./topup";
import type { KeyedMutex } from "./util";

const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const CURSOR_KEY = "keeper:lastBlock";
/** How many getLogs windows one tick may scan, so a long outage catches up gradually. */
const MAX_WINDOWS_PER_TICK = 20;

/**
 * Background jobs, all retry-safe and driven by `tick()`:
 *  - Burrow auto-save: watch AUSD Transfers into auto-save users, debounce, then router.sweep.
 *  - Escrow expiry: refund deposits nobody opened (anyone may call escrow.refund).
 *  - Gift cards: settle orders left processing.
 *  - Top-ups: credit AUSD for USDC delivered to the treasury.
 */
export class Keeper {
  private due = new Map<Address, number>();
  private timer: NodeJS.Timeout | undefined;
  private ticking: Promise<void> | undefined;
  /** Set by the app wiring (actions depend on the keeper and vice versa). */
  hasOpenAction: (user: Address) => boolean = () => false;

  constructor(
    private readonly db: Db,
    private readonly config: Config,
    private readonly chain: ChainService,
    private readonly sender: TxSender,
    private readonly accounts: AccountService,
    private readonly activity: ActivityRepo,
    private readonly claims: ClaimService,
    private readonly gifts: GiftCardService,
    private readonly userLocks: KeyedMutex,
    private readonly topups?: TopUpService,
  ) {}

  start() {
    const loop = async () => {
      await this.tick().catch((e) => console.error("keeper tick failed", e instanceof Error ? e.message : e));
      this.timer = setTimeout(loop, this.config.keeper.intervalMs);
    };
    this.timer = setTimeout(loop, 0);
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
  }

  /** One pass of every job. Concurrent callers share the running pass. */
  tick(): Promise<void> {
    this.ticking ??= (async () => {
      try {
        await this.scanTransfers();
        await this.runDueSweeps();
        await this.refundExpired();
        await this.gifts.reconcile();
        await this.topups?.settlePending();
      } finally {
        this.ticking = undefined;
      }
    })();
    return this.ticking;
  }

  /** Marks a user for a sweep after the debounce window (restarts on every new transfer). */
  schedule(user: Address, delayMs = this.config.keeper.debounceMs) {
    this.due.set(user, Date.now() + delayMs);
  }

  async scanTransfers() {
    const head = await this.chain.client.getBlockNumber();
    const stored = kvGet(this.db, CURSOR_KEY);
    // First run: start at the head. Monad RPCs keep little log history, and a missed old transfer
    // only means that money waits for the next one to be swept.
    let from = stored ? BigInt(stored) + 1n : head;
    const users = new Set(this.accounts.autoSaveUsers());
    const stata = this.config.deployment.stata;
    for (let i = 0; i < MAX_WINDOWS_PER_TICK && from <= head; i++) {
      const to = from + BigInt(this.config.keeper.blockRange) - 1n < head ? from + BigInt(this.config.keeper.blockRange) - 1n : head;
      if (users.size) {
        const logs = await this.chain.client.getLogs({
          address: this.config.deployment.ausd,
          event: TRANSFER,
          args: { to: [...users] },
          fromBlock: from,
          toBlock: to,
        });
        for (const log of logs) {
          const recipient = getAddress(log.args.to!);
          // Money coming *out* of Burrow is the user moving it to their balance: don't sweep it back.
          if (getAddress(log.args.from!) === stata) continue;
          if (users.has(recipient)) this.schedule(recipient);
        }
      }
      kvSet(this.db, CURSOR_KEY, to.toString());
      from = to + 1n;
    }
  }

  async runDueSweeps() {
    const now = Date.now();
    for (const [user, at] of [...this.due]) {
      if (at > now) continue;
      this.due.delete(user);
      try {
        const done = await this.userLocks.run(user, async () => {
          // Never move money while the user is between prepare and submit: their confirm sheet
          // was computed from the current balance.
          if (this.hasOpenAction(user)) return false;
          await this.sweepLocked(user);
          return true;
        });
        if (!done) this.schedule(user);
      } catch (err) {
        console.error(`sweep ${user} failed`, err instanceof Error ? err.message : err);
      }
    }
  }

  /** Sweeps if auto-save is on and the balance is above the threshold. Caller holds the user lock. */
  async sweepLocked(user: Address): Promise<bigint> {
    const cfg = await this.chain.autoSave(user);
    if (!cfg.enabled) return 0n;
    const balance = await this.chain.ausdBalance(user);
    if (balance <= cfg.threshold) return 0n;
    const data = encodeFunctionData({ abi: bilbyRouterAbi, functionName: "sweep", args: [user] });
    const sent = await this.sender.send({ to: this.config.deployment.router, data, label: "router.sweep" });
    const [swept] = parseEventLogs({ abi: bilbyRouterAbi, eventName: "Swept", logs: sent.receipt.logs });
    const assets = swept?.args.assets ?? balance - cfg.threshold;
    this.accounts.adjustBurrowPrincipal(user, assets);
    this.activity.add({ address: user, kind: "burrow_in", status: "completed", amount: assets, note: "Auto-save", txHash: sent.hash });
    return assets;
  }

  async refundExpired() {
    const now = await this.chain.now();
    for (const claim of await this.claims.refundable(now)) {
      try {
        const deposit = await this.chain.deposit(claim.deposit_id as Hex);
        if (deposit.statusName === "Pending") {
          const data = encodeFunctionData({ abi: bilbyEscrowAbi, functionName: "refund", args: [claim.deposit_id as Hex] });
          const sent = await this.sender.send({ to: this.config.deployment.escrow, data, label: "escrow.refund" });
          this.claims.markReturned(claim.code, "refunded", sent.hash);
        } else if (deposit.statusName === "Refunded" || deposit.statusName === "Cancelled") {
          this.claims.markReturned(claim.code, deposit.statusName === "Refunded" ? "refunded" : "cancelled");
        }
      } catch (err) {
        console.error(`refund ${claim.code} failed`, err instanceof Error ? err.message : err);
      }
    }
  }
}
