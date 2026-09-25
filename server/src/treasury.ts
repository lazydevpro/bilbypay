import { authorizationTypedData, eip3009Abi, newAuthorization, toSignedAuthorization } from "@bilbypay/core";
import { type Address, encodeFunctionData, type Hex, type PrivateKeyAccount } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { ChainService } from "./chain";
import type { Sent, TxSender } from "./relayer";

/**
 * The treasury receives gift payments and pays the provider float. It is an EOA the server
 * controls; like users it holds no MON: it signs EIP-3009 authorizations and the relayer submits.
 */
export class Treasury {
  private readonly account: PrivateKeyAccount;

  constructor(
    privateKey: Hex,
    private readonly chain: ChainService,
    private readonly relayer: TxSender,
  ) {
    this.account = privateKeyToAccount(privateKey);
  }

  get address(): Address {
    return this.account.address;
  }

  balance() {
    return this.chain.ausdBalance(this.account.address);
  }

  /** Pays `amount` dollars from the treasury to `to` (refunds, gift change). */
  async pay(to: Address, amount: bigint, label: string): Promise<Sent> {
    const cfg = this.chain.config;
    const auth = newAuthorization({ from: this.account.address, to, value: amount, now: await this.chain.now() });
    const signature = await this.account.signTypedData(authorizationTypedData("TransferWithAuthorization", cfg.ausd, cfg.chainId, auth));
    const s = toSignedAuthorization(auth, signature);
    const data = encodeFunctionData({
      abi: eip3009Abi,
      functionName: "transferWithAuthorization",
      args: [s.from, s.to, s.value, s.validAfter, s.validBefore, s.nonce, s.v, s.r, s.s],
    });
    return this.relayer.send({ to: cfg.ausd.address, data, label });
  }
}
