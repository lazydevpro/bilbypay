import { bilbyDirectoryAbi } from "@bilbypay/core";
import { decodeEventLog, type Address, type Hex, type PublicClient } from "viem";
import { type Db, kvGet, kvSet, tx } from "./db";

export type DirectoryBlock = { number: bigint; hash: Hex; timestamp: bigint };
export type DirectorySnapshot<T> = {
  phoneKey: Hex;
  binding: T;
  blockNumber: bigint;
  blockHash: Hex;
  timestamp: bigint;
};

export interface DirectorySource<T> {
  /** Must return a finalized block. Never substitute latest if the provider cannot serve it. */
  finalizedBlock(): Promise<DirectoryBlock>;
  block(number: bigint): Promise<DirectoryBlock>;
  changedPhoneKeys(from: bigint, to: bigint): Promise<Hex[]>;
  bindingAt(phoneKey: Hex, blockNumber: bigint): Promise<T>;
}

export type DirectoryCacheOptions<T> = {
  chainId: number;
  directory: Address;
  /** Deployment block of this directory version, not a moving latest-block default. */
  startBlock: bigint;
  /** Inclusive window size; Monad providers commonly cap eth_getLogs at 100 blocks. */
  blockRange?: number;
  /** Bounds each run so a long backfill cannot monopolize the process. */
  maxWindows?: number;
  /** Synchronous DB writes only. Called within the same transaction as the durable cursor. */
  applySnapshot(snapshot: DirectorySnapshot<T>): void;
  /** Clear only this deployment's directory mirror, retaining profiles and all money records. */
  resetMirror(): void;
};

type Cursor = { nextBlock: string; checkpoint?: { number: string; hash: Hex } };
export type DirectorySyncResult = { windows: number; snapshots: number; reset: boolean; caughtUp: boolean; nextBlock: bigint };

/**
 * Finalized chain state is canonical; this service repairs the discovery mirror after missed
 * writes, restarts and reorgs. It never authorizes a payment. Selected recipients must still be
 * read directly before signing. Only one reconciler per namespace may write a given database.
 */
export class DirectoryCache<T> {
  private readonly key: string;
  private readonly range: bigint;
  private readonly maxWindows: number;
  private running?: Promise<DirectorySyncResult>;

  constructor(private readonly db: Db, private readonly source: DirectorySource<T>, private readonly options: DirectoryCacheOptions<T>) {
    const range = options.blockRange ?? 100;
    const maxWindows = options.maxWindows ?? 10;
    if (options.startBlock < 0n || !Number.isSafeInteger(options.chainId) || options.chainId <= 0) throw new Error("Invalid directory cache chain or start block");
    if (!Number.isInteger(range) || range < 1 || range > 100) throw new Error("Directory cache blockRange must be between 1 and 100");
    if (!Number.isInteger(maxWindows) || maxWindows < 1 || maxWindows > 100) throw new Error("Directory cache maxWindows must be between 1 and 100");
    this.range = BigInt(range);
    this.maxWindows = maxWindows;
    this.key = `directory-cache:v2:${options.chainId}:${options.directory.toLowerCase()}:${options.startBlock}`;
  }

  /** Concurrent timer/manual invocations share one run and cannot commit out-of-order cursors. */
  runOnce(): Promise<DirectorySyncResult> {
    if (this.running) return this.running;
    this.running = this.sync().finally(() => { this.running = undefined; });
    return this.running;
  }

  private cursor(): Cursor {
    const raw = kvGet(this.db, this.key);
    if (!raw) return { nextBlock: this.options.startBlock.toString() };
    const cursor = JSON.parse(raw) as Cursor;
    if (!/^\d+$/.test(cursor.nextBlock) || BigInt(cursor.nextBlock) < this.options.startBlock ||
      (!cursor.checkpoint && BigInt(cursor.nextBlock) !== this.options.startBlock) ||
      (cursor.checkpoint && (!/^\d+$/.test(cursor.checkpoint.number) || !/^0x[0-9a-fA-F]{64}$/.test(cursor.checkpoint.hash) ||
        BigInt(cursor.checkpoint.number) + 1n !== BigInt(cursor.nextBlock)))) {
      throw new Error("Invalid directory cache cursor; explicit repair is required");
    }
    return cursor;
  }

  private async sync(): Promise<DirectorySyncResult> {
    const head = await this.source.finalizedBlock();
    let cursor = this.cursor();
    const result: DirectorySyncResult = { windows: 0, snapshots: 0, reset: false, caughtUp: false, nextBlock: BigInt(cursor.nextBlock) };
    if (cursor.checkpoint) {
      const previous = BigInt(cursor.checkpoint.number);
      const diverged = head.number < previous || (await this.source.block(previous)).hash.toLowerCase() !== cursor.checkpoint.hash.toLowerCase();
      if (diverged) {
        cursor = { nextBlock: this.options.startBlock.toString() };
        tx(this.db, () => {
          this.options.resetMirror();
          kvSet(this.db, this.key, JSON.stringify(cursor));
        });
        result.reset = true;
      }
    }
    let from = BigInt(cursor.nextBlock);
    while (from <= head.number && result.windows < this.maxWindows) {
      const to = from + this.range - 1n < head.number ? from + this.range - 1n : head.number;
      const anchor = await this.source.block(to);
      const phoneKeys = [...new Set((await this.source.changedPhoneKeys(from, to)).map((key) => key.toLowerCase() as Hex))];
      const snapshots: DirectorySnapshot<T>[] = [];
      // Bound concurrency even for unusually busy blocks. Reads are pinned to one block.
      for (let offset = 0; offset < phoneKeys.length; offset += 10) {
        snapshots.push(...await Promise.all(phoneKeys.slice(offset, offset + 10).map(async (phoneKey) => ({
          phoneKey,
          binding: await this.source.bindingAt(phoneKey, to),
          blockNumber: to,
          blockHash: anchor.hash,
          timestamp: anchor.timestamp,
        }))));
      }
      if ((await this.source.block(to)).hash.toLowerCase() !== anchor.hash.toLowerCase()) {
        throw new Error("Directory chain changed during reconciliation; window was not committed");
      }
      const next: Cursor = { nextBlock: (to + 1n).toString(), checkpoint: { number: to.toString(), hash: anchor.hash } };
      tx(this.db, () => {
        for (const snapshot of snapshots) this.options.applySnapshot(snapshot);
        kvSet(this.db, this.key, JSON.stringify(next));
      });
      from = to + 1n;
      result.windows++;
      result.snapshots += snapshots.length;
    }
    result.nextBlock = from;
    result.caughtUp = from > head.number;
    return result;
  }
}

/** RPC adapter; provider errors and unsupported finalized/archive reads fail closed. */
export function createDirectoryRpcSource(client: PublicClient, directory: Address) {
  const block = async (parameters: { blockTag: "finalized" } | { blockNumber: bigint }): Promise<DirectoryBlock> => {
    const value = await client.getBlock(parameters);
    if (value.number === null || value.hash === null) throw new Error("Directory reconciliation requires a mined block");
    if ("blockNumber" in parameters && value.number !== parameters.blockNumber) throw new Error("Directory provider returned the wrong block");
    return { number: value.number, hash: value.hash, timestamp: value.timestamp };
  };
  return {
    finalizedBlock: () => block({ blockTag: "finalized" }),
    block: (number: bigint) => block({ blockNumber: number }),
    async changedPhoneKeys(fromBlock: bigint, toBlock: bigint): Promise<Hex[]> {
      const logs = await client.getLogs({ address: directory, fromBlock, toBlock });
      const keys: Hex[] = [];
      for (const log of logs) {
        if (log.removed) throw new Error("Directory reconciliation received a removed log");
        let decoded;
        try { decoded = decodeEventLog({ abi: bilbyDirectoryAbi, data: log.data, topics: log.topics }); }
        catch { throw new Error("Directory emitted an event outside the configured ABI; update the reconciler before continuing"); }
        if ("phoneKey" in decoded.args) keys.push(decoded.args.phoneKey);
      }
      return keys;
    },
    async bindingAt(phoneKey: Hex, blockNumber: bigint) {
      const [binding, pending] = await Promise.all([
        client.readContract({ address: directory, abi: bilbyDirectoryAbi, functionName: "getBinding", args: [phoneKey], blockNumber }),
        client.readContract({ address: directory, abi: bilbyDirectoryAbi, functionName: "getPendingChange", args: [phoneKey], blockNumber }),
      ]);
      return { binding, pending };
    },
  };
}

export type DirectoryRpcState = Awaited<ReturnType<ReturnType<typeof createDirectoryRpcSource>["bindingAt"]>>;
