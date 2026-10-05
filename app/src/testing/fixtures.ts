import { hydrateTypedData } from "@bilbypay/core";
import { type PrivateKeyAccount } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createMockApi } from "../api/mock";
import type { BilbyApi, Hex } from "../api/types";
import type { Recipient } from "../flows/drafts";
import { registerMessage } from "../signing/messages";

export const MOCK_ESCROW: Hex = "0x00000000000000000000000000000000000b11b2";
export async function registerMockNumber(api: BilbyApi, signer: PrivateKeyAccount, phone: string, name = "Test Person") {
  const { phoneToken } = await api.otpVerify(phone, "000000");
  const prepared = await api.prepareRegistration({ phoneToken, address: signer.address });
  const issuedAt = Math.floor(Date.now() / 1000);
  const signature = await signer.signMessage({ message: registerMessage(phone, signer.address, issuedAt) });
  const consentSignature = await signer.signTypedData(hydrateTypedData(prepared.typedData));
  return api.register({ phoneToken, address: signer.address, displayName: name, issuedAt, signature, registrationId: prepared.id, consentSignature });
}

export async function selectedRecipient(api: BilbyApi, phone: string): Promise<Recipient> {
  const { results } = await api.resolve([phone]);
  const found = results[0]!;
  if (!found.e164 || (found.status !== "invite" && found.status !== "registered")) throw new Error("test recipient unavailable");
  return { name: found.displayName ?? phone, phone, e164: found.e164, status: found.status, address: found.address, directory: found.directory };
}

/** A signed-in demo API for tests, with a real key doing the authorizing. */
export async function signedInMockApi(opts: { phone?: string; name?: string; key?: Hex; startingBalance?: bigint } = {}) {
  let token: string | null = null;
  const api = createMockApi({ getToken: () => token, delayMs: 0, startingBalance: opts.startingBalance });
  const signer = privateKeyToAccount(opts.key ?? "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
  const reg = await registerMockNumber(api, signer, opts.phone ?? "+15555550123", opts.name);
  token = reg.sessionToken;
  return { api, signer, address: signer.address as Hex, setToken: (t: string | null) => { token = t; }, getToken: () => token };
}
