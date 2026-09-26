import {
  type Address,
  createWalletClient,
  type Hex,
  http,
  type PrivateKeyAccount,
  type TransactionReceipt,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { ChainService } from "./chain";
import { innerReason } from "./errors";

export type Call = { to: Address; data: Hex; label: string };
export type Sent = { hash: Hex; receipt: TransactionReceipt };

/** A call that the chain refused (at estimate time, before spending gas, or after mining). */
export class RevertError extends Error {
  constructor(
    readonly label: string,
    readonly reason: string | undefined,
    override readonly cause: unknown,
    readonly hash?: Hex,
  ) {
    super(`${label} reverted: ${reason ?? "unknown reason"}${hash ? ` (${hash})` : ""}`);
  }
}

/**
 * Submits transactions from one server key, one at a time. Serializing makes local nonce
 * management trivial and means each gas estimate runs against the state the tx will actually see.
 * Monad charges the gas *limit*, so the limit is estimate + 7.5% rather than a generous default.
 */
export class TxSender {
  readonly account: PrivateKeyAccount;
  private readonly wallet: WalletClient;
  private tail: Promise<unknown> = Promise.resolve();
  private nonce: number | undefined;
  /** Count of txs this sender has broadcast (tests use it to prove "one transaction"). */
  sentCount = 0;

  constructor(
    privateKey: Hex,
    private readonly chain: ChainService,
  ) {
    this.account = privateKeyToAccount(privateKey);
    this.wallet = createWalletClient({ account: this.account, chain: chain.chain, transport: http(chain.config.rpcUrl) });
  }

  get address(): Address {
    return this.account.address;
  }

  send(call: Call, onSent?: (hash: Hex) => void): Promise<Sent> {
    const run = this.tail.catch(() => {}).then(() => this.sendNow(call, onSent));
    this.tail = run;
    return run;
  }

  private async sendNow(call: Call, onSent?: (hash: Hex) => void, retried = false): Promise<Sent> {
    const client = this.chain.client;
    let estimate: bigint;
    try {
      estimate = await client.estimateGas({ account: this.account.address, to: call.to, data: call.data });
    } catch (err) {
      throw new RevertError(call.label, innerReason(err), err);
    }
    const gas = (estimate * 1075n) / 1000n;
    this.nonce ??= await client.getTransactionCount({ address: this.account.address, blockTag: "pending" });
    let hash: Hex;
    try {
      hash = await this.wallet.sendTransaction({
        account: this.account,
        chain: this.chain.chain,
        to: call.to,
        data: call.data,
        gas,
        nonce: this.nonce,
      });
    } catch (err) {
      // Unknown whether the node accepted it: resync the nonce from the node next time.
      this.nonce = undefined;
      // "Nonce too low" means the node definitely rejected it (the key was used elsewhere, e.g. an operator
      // script or a restart). Safe to resync and try once more, so the user's action doesn't fail.
      if (!retried && isNonceTooLow(err)) return this.sendNow(call, onSent, true);
      throw err;
    }
    this.nonce++;
    this.sentCount++;
    onSent?.(hash);
    const receipt = await client.waitForTransactionReceipt({ hash, timeout: 60_000 });
    if (receipt.status !== "success") {
      // Replay at the mined block to learn why (state changed between estimate and inclusion).
      let reason: string | undefined;
      try {
        await client.call({ account: this.account.address, to: call.to, data: call.data, blockNumber: receipt.blockNumber });
      } catch (err) {
        reason = innerReason(err);
      }
      throw new RevertError(call.label, reason, undefined, hash);
    }
    return { hash, receipt };
  }
}

/** One TxSender per server key, so keys shared between roles (relayer = keeper) share a nonce queue. */
export class Senders {
  private byAddress = new Map<Address, TxSender>();

  constructor(private readonly chain: ChainService) {}

  forKey(privateKey: Hex): TxSender {
    const address = privateKeyToAccount(privateKey).address;
    let sender = this.byAddress.get(address);
    if (!sender) {
      sender = new TxSender(privateKey, this.chain);
      this.byAddress.set(address, sender);
    }
    return sender;
  }
}

/** The node rejected the tx because its nonce was already used (never ambiguous, unlike timeouts). */
export function isNonceTooLow(err: unknown): boolean {
  let e: any = err;
  for (let i = 0; e && i < 8; i++, e = e.cause) {
    if (e?.name === "NonceTooLowError") return true;
    const msg = `${e?.shortMessage ?? ""} ${e?.details ?? ""} ${e?.message ?? ""}`;
    if (/nonce too low|nonce provided for the transaction .* is lower than the current nonce/i.test(msg)) return true;
  }
  return false;
}
