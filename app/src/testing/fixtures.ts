import { privateKeyToAccount } from "viem/accounts";
import { createMockApi } from "../api/mock";
import type { BilbyApi, Hex } from "../api/types";
import { registerMessage } from "../signing/messages";

/** A signed-in demo API for tests, with a real key doing the authorizing. */
export async function signedInMockApi(opts: { phone?: string; name?: string; key?: Hex; startingBalance?: bigint } = {}) {
  let token: string | null = null;
  const api: BilbyApi = createMockApi({ getToken: () => token, delayMs: 0, startingBalance: opts.startingBalance });
  const signer = privateKeyToAccount(opts.key ?? "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
  const phone = opts.phone ?? "+15555550123";
  await api.otpStart(phone, "US");
  const { phoneToken } = await api.otpVerify(phone, "000000");
  const issuedAt = Math.floor(Date.now() / 1000);
  const signature = await signer.signMessage({ message: registerMessage(phone, signer.address, issuedAt) });
  const reg = await api.register({ phoneToken, address: signer.address, displayName: opts.name ?? "Test Person", issuedAt, signature });
  token = reg.sessionToken;
  return {
    api,
    signer,
    address: signer.address as Hex,
    setToken: (t: string | null) => {
      token = t;
    },
    getToken: () => token,
  };
}
