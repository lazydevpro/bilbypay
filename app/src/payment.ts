import {
  authorizationTypedData,
  getNetwork,
  newAuthorization,
  parseUsd,
} from "@bilbypay/core";
import type { Address, Hex } from "viem";
import { type Account, withSigner } from "./account";

export const CHAIN_ID = Number(process.env.EXPO_PUBLIC_CHAIN_ID ?? "143");

/** The shape `server/scripts/relay-3009.ts` accepts via SIGNED_AUTH_FILE. */
export type SignedAuthorizationJson = {
  chainId: number;
  token: Address;
  from: Address;
  to: Address;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: Hex;
  signature: Hex;
};

export async function signTestPayment(account: Account, to: Address, amountUsd: string): Promise<SignedAuthorizationJson> {
  const { ausd } = getNetwork(CHAIN_ID);
  // Long TTL so there is time to copy it to a laptop and relay it during the spike.
  const auth = newAuthorization({ from: account.address, to, value: parseUsd(amountUsd), ttlSeconds: 60 * 60 });
  const signature = await withSigner(account, (signer) =>
    signer.signTypedData(authorizationTypedData("TransferWithAuthorization", ausd, CHAIN_ID, auth)),
  );
  return {
    chainId: CHAIN_ID,
    token: ausd.address,
    from: auth.from,
    to: auth.to,
    value: auth.value.toString(),
    validAfter: auth.validAfter.toString(),
    validBefore: auth.validBefore.toString(),
    nonce: auth.nonce,
    signature,
  };
}
