import { describe, expect, it } from "vitest";
import type { ActionRequest, Hex, PreparedAction } from "../api/types";
import { signedInMockApi } from "../testing/fixtures";
import { checkPreparedAction, SigningGuardError } from "./guard";

const MAYA = "+15555550101";
const OTHER: Hex = "0x9999999999999999999999999999999999999999";
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const msg = (p: PreparedAction, key = "payment") => p.toSign.find((e) => e.key === key)!.typedData.message as Record<string, unknown>;

async function prepared(request: ActionRequest, startingBalance?: bigint) {
  const ctx = await signedInMockApi({ startingBalance });
  let resolvedPayee: Hex | undefined;
  if (request.type === "send") {
    const { results } = await ctx.api.resolve([request.params.phone]);
    resolvedPayee = results[0]!.address;
  }
  const p = await ctx.api.prepareAction(request);
  return { ...ctx, p, request, resolvedPayee };
}

describe("check before authorizing", () => {
  const send: ActionRequest = { type: "send", params: { phone: MAYA, amount: "20000000" } };

  it("accepts an honest send to a registered contact", async () => {
    const { p, address, resolvedPayee, request } = await prepared(send);
    const entries = checkPreparedAction({ request, prepared: p, account: address, chainId: 143, resolvedPayee });
    expect(entries.map((e) => e.key)).toEqual(["payment"]);
    expect(typeof (entries[0]!.typedData.message as { value: unknown }).value).toBe("bigint");
  });

  const tamper: Array<[string, (p: PreparedAction) => void]> = [
    ["payment to someone else", (p) => void (msg(p).to = OTHER)],
    ["more than the amount", (p) => void (msg(p).value = "20000001")],
    ["from another account", (p) => void (msg(p).from = OTHER)],
    ["another chain", (p) => void (p.toSign[0]!.typedData.domain.chainId = 1)],
    ["valid for a year", (p) => void (msg(p).validBefore = String(Math.floor(Date.now() / 1000) + 365 * 86400))],
    ["an extra entry", (p) => void p.toSign.push({ key: "extra", typedData: clone(p.toSign[0]!.typedData) })],
    ["a missing payment", (p) => void (p.toSign = [])],
    ["a different payer", (p) => void (p.expect.payer = OTHER)],
    ["a bigger expected amount", (p) => void (p.expect.amount = "999000000")],
    ["a different payee in expect", (p) => void (p.expect.payee = OTHER)],
    ["a swapped primary type", (p) => void (p.toSign[0]!.typedData.primaryType = "Permit")],
    ["a changed action type", (p) => void (p.type = "burrow_add")],
    ["a total that differs from what's paid", (p) => void (p.summary.total = "1")],
  ];

  for (const [name, mutate] of tamper) {
    it(`refuses ${name}`, async () => {
      const { p, address, resolvedPayee, request } = await prepared(send);
      const bad = clone(p);
      mutate(bad);
      expect(() => checkPreparedAction({ request, prepared: bad, account: address, chainId: 143, resolvedPayee })).toThrow(SigningGuardError);
    });
  }

  it("refuses an invite send that pays an account directly", async () => {
    const { api, address } = await signedInMockApi();
    const request: ActionRequest = { type: "send", params: { phone: "+15555550199", amount: "5000000" } };
    const p = await api.prepareAction(request);
    expect(() => checkPreparedAction({ request, prepared: p, account: address, chainId: 143 })).not.toThrow();
    const bad = clone(p);
    bad.toSign[0]!.typedData.primaryType = "TransferWithAuthorization";
    bad.toSign[0]!.typedData.types.TransferWithAuthorization = bad.toSign[0]!.typedData.types.ReceiveWithAuthorization!;
    expect(() => checkPreparedAction({ request, prepared: bad, account: address, chainId: 143 })).toThrow(SigningGuardError);
  });

  it("accepts a send that takes from Burrow, but not an oversized Burrow permit", async () => {
    const ctx = await signedInMockApi({ startingBalance: 100_000_000n });
    const add: ActionRequest = { type: "burrow_add", params: { amount: "80000000" } };
    const addPrepared = await ctx.api.prepareAction(add);
    const { authorizeAndSubmit } = await import("../flows/authorize");
    await authorizeAndSubmit({ api: ctx.api, request: add, prepared: addPrepared, account: ctx.address, chainId: 143, unlock: (fn) => fn(ctx.signer) });

    const request: ActionRequest = { type: "send", params: { phone: MAYA, amount: "50000000" } };
    const { results } = await ctx.api.resolve([MAYA]);
    const p = await ctx.api.prepareAction(request);
    expect(p.summary.fromBurrow).toBe("30000000");
    const args = { request, account: ctx.address, chainId: 143, resolvedPayee: results[0]!.address };
    expect(checkPreparedAction({ ...args, prepared: p }).map((e) => e.key)).toEqual(["payment", "burrowPermit"]);

    const bad = clone(p);
    msg(bad, "burrowPermit").value = "90000000";
    expect(() => checkPreparedAction({ ...args, prepared: bad })).toThrow(SigningGuardError);

    const sneaky = clone(p);
    sneaky.summary.fromBurrow = "0";
    expect(() => checkPreparedAction({ ...args, prepared: sneaky })).toThrow(SigningGuardError);
  });

  it("checks auto-save settings match what the user chose", async () => {
    const { p, address, request } = await prepared({ type: "burrow_autosave", params: { enabled: true, threshold: "200000000" } });
    expect(() => checkPreparedAction({ request, prepared: p, account: address, chainId: 143 })).not.toThrow();
    const bad = clone(p);
    msg(bad, "autoSave").threshold = "0";
    expect(() => checkPreparedAction({ request, prepared: bad, account: address, chainId: 143 })).toThrow(SigningGuardError);
  });

  it("requires turning auto-save off to remove the allowance", async () => {
    const { p, address, request } = await prepared({ type: "burrow_autosave", params: { enabled: false, threshold: "0" } });
    expect(() => checkPreparedAction({ request, prepared: p, account: address, chainId: 143 })).not.toThrow();
    const bad = clone(p);
    msg(bad, "ausdPermit").value = "1000";
    expect(() => checkPreparedAction({ request, prepared: bad, account: address, chainId: 143 })).toThrow(SigningGuardError);
  });

  it("caps the gift card service fee", async () => {
    const { p, address, request } = await prepared({ type: "gift_buy", params: { brandId: "starbucks-us", amount: "25000000" } });
    expect(() => checkPreparedAction({ request, prepared: p, account: address, chainId: 143 })).not.toThrow();
    const bad = clone(p);
    bad.expect.amount = bad.summary.total = "40000000";
    expect(() => checkPreparedAction({ request, prepared: bad, account: address, chainId: 143 })).toThrow(SigningGuardError);
  });
});
