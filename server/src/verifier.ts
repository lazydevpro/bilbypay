import { bindTypedData, claimTypedData, finalizeRecoveryTypedData, requestRecoveryTypedData, type Deployment } from "@bilbypay/core";
import type { Address, Hex, PrivateKeyAccount } from "viem";
import { privateKeyToAccount } from "viem/accounts";

/**
 * The verifier key attests "this number was proven by OTP and this account signed for it".
 * It only signs after those checks; it never holds funds and never submits anything.
 */
export class Verifier {
  private readonly account: PrivateKeyAccount;

  constructor(
    privateKey: Hex,
    private readonly d: Deployment,
  ) {
    this.account = privateKeyToAccount(privateKey);
  }

  get address(): Address {
    return this.account.address;
  }

  signDirectory(operation: "bind" | "requestRecovery" | "finalizeRecovery", m: { phoneKey: Hex; account: Address; issuedAt: bigint; deadline: bigint; expectedRevision: bigint; validUntil: bigint }): Promise<Hex> {
    if (operation === "bind") return this.account.signTypedData(bindTypedData(this.d, m));
    if (operation === "requestRecovery") return this.account.signTypedData(requestRecoveryTypedData(this.d, m));
    return this.account.signTypedData(finalizeRecoveryTypedData(this.d, m));
  }

  signClaim(m: { depositId: Hex; phoneKey: Hex; recipient: Address; deadline: bigint }): Promise<Hex> {
    return this.account.signTypedData(claimTypedData(this.d, m));
  }
}
