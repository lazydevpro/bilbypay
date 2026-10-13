import { mockAusdAbi } from "@bilbypay/core";
import { type Address, encodeFunctionData, getAddress } from "viem";
import type { ActivityRepo } from "./activity";
import type { Config } from "./config";
import { type Db, kvGet, kvSet } from "./db";
import type { TxSender } from "./relayer";

/**
 * Testnet only: every new account gets TESTNET_WELCOME_USD test dollars, minted by the relayer (the test dollar is
 * an open-mint mock token), so someone trying the app can send money right away. Once per address; a failed mint
 * never fails sign-up.
 */
export class WelcomeGrant {
  readonly amount: bigint;

  constructor(
    private readonly db: Db,
    private readonly config: Config,
    private readonly sender: TxSender,
    private readonly activity: ActivityRepo,
  ) {
    this.amount = BigInt(Math.round(config.testnetWelcomeUsd * 10 ** config.ausd.decimals));
  }

  async grant(account: string): Promise<void> {
    if (this.amount <= 0n) return;
    const address: Address = getAddress(account);
    const key = `welcome-grant:${address.toLowerCase()}`;
    if (kvGet(this.db, key)) return;
    kvSet(this.db, key, "pending"); // claimed before the await: a concurrent sign-up can't grant twice
    try {
      const { hash } = await this.sender.send({
        to: this.config.deployment.ausd,
        data: encodeFunctionData({ abi: mockAusdAbi, functionName: "mint", args: [address, this.amount] }),
        label: "testnet.welcome",
      });
      kvSet(this.db, key, hash);
      this.activity.add({ address, kind: "received", status: "completed", amount: this.amount, note: "Welcome test dollars", txHash: hash });
    } catch (e) {
      this.db.prepare("DELETE FROM kv WHERE key = ?").run(key);
      console.error("welcome grant failed", e instanceof Error ? e.message : e);
    }
  }
}
