import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config";
import { kvGet, openDb } from "../src/db";
import { WelcomeGrant } from "../src/welcome";

const ACCOUNT = "0x00000000000000000000000000000000000000a1";
const config = (usd: number) =>
  ({ testnetWelcomeUsd: usd, ausd: { decimals: 6 }, deployment: { ausd: "0x00000000000000000000000000000000000000d0" } }) as never;

function setup(usd: number, send = vi.fn(async () => ({ hash: "0xabc" as const, receipt: {} }))) {
  const db = openDb(":memory:");
  const activity = { add: vi.fn() };
  const grant = new WelcomeGrant(db, config(usd), { send } as never, activity as never);
  return { db, activity, grant, send };
}

describe("testnet welcome grant", () => {
  it("mints once per account and records it in activity", async () => {
    const { db, activity, grant, send } = setup(100);
    expect(grant.amount).toBe(100_000_000n);
    await grant.grant(ACCOUNT);
    await grant.grant(ACCOUNT.toUpperCase().replace("0X", "0x"));
    expect(send).toHaveBeenCalledTimes(1);
    expect(activity.add).toHaveBeenCalledWith(expect.objectContaining({ kind: "received", amount: 100_000_000n, note: "Welcome test dollars", txHash: "0xabc" }));
    expect(kvGet(db, `welcome-grant:${ACCOUNT}`)).toBe("0xabc");
  });

  it("does nothing when switched off", async () => {
    const { grant, send } = setup(0);
    await grant.grant(ACCOUNT);
    expect(send).not.toHaveBeenCalled();
  });

  it("a failed mint doesn't throw and can be retried", async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error("rpc down")).mockResolvedValue({ hash: "0xdef", receipt: {} });
    const { grant, activity } = setup(5, send);
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(grant.grant(ACCOUNT)).resolves.toBeUndefined();
    expect(activity.add).not.toHaveBeenCalled();
    await grant.grant(ACCOUNT);
    expect(send).toHaveBeenCalledTimes(2);
    expect(activity.add).toHaveBeenCalledTimes(1);
  });

  it("is refused on mainnet", () => {
    const key = `0x${"11".repeat(32)}`;
    const secret = `0x${"22".repeat(32)}`;
    const env = { CHAIN_ID: "143", AUSD_ADDRESS: ACCOUNT, STATA_ADDRESS: ACCOUNT, DIRECTORY_ADDRESS: ACCOUNT, ESCROW_ADDRESS: ACCOUNT, ROUTER_ADDRESS: ACCOUNT,
      RELAYER_PRIVATE_KEY: key, VERIFIER_PRIVATE_KEY: key, TREASURY_PRIVATE_KEY: key, PHONE_PEPPER: "p", TOKEN_SECRET: secret, GIFT_CODE_KEY: secret };
    expect(() => loadConfig({ ...env, TESTNET_WELCOME_USD: "100" })).toThrow(/testnet-only/);
    expect(loadConfig(env).testnetWelcomeUsd).toBe(0);
  });
});
