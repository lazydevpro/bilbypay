import type { TypedDataDefinition } from "viem";
import type { ActionRequest, ActionResult, BilbyApi, Hex, PreparedAction } from "../api/types";
import { checkPreparedAction } from "../signing/guard";

export type TypedDataSigner = { signTypedData: (td: TypedDataDefinition) => Promise<Hex> };

/** Runs `fn` with the account signer behind exactly one Face ID. */
export type Unlock = <T>(fn: (signer: TypedDataSigner) => Promise<T>) => Promise<T>;

export type AuthorizeInput = {
  api: Pick<BilbyApi, "submitAction">;
  request: ActionRequest;
  prepared: PreparedAction;
  account: Hex;
  chainId: number;
  resolvedPayee?: Hex;
  unlock: Unlock;
  /** Called once authorized, before submitting — keep these to retry a failed submit without Face ID. */
  onAuthorized?: (signatures: Record<string, Hex>) => void;
};

/**
 * Checks the prepared action (before any Face ID), authorizes every entry in one unlock, then submits.
 * Returns the signatures too so a failed submit (offline) can be retried without another Face ID;
 * submit is idempotent per action id.
 */
export async function authorizeAndSubmit(input: AuthorizeInput): Promise<{ result: ActionResult; signatures: Record<string, Hex> }> {
  const entries = checkPreparedAction(input);
  const signatures = await input.unlock(async (signer) => {
    const out: Record<string, Hex> = {};
    for (const { key, typedData } of entries) out[key] = await signer.signTypedData(typedData);
    return out;
  });
  input.onAuthorized?.(signatures);
  const result = await input.api.submitAction(input.prepared.id, signatures);
  return { result, signatures };
}
