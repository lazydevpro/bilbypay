import { privateKeyToAccount } from "viem/accounts";
import { recoverTypedDataAddress } from "viem";
import { describe, expect, it } from "vitest";
import { BASE_USDC, BASE_USDC_DOMAIN, createExactEvmPayment, eip3009TypedData, parsePaymentRequired, selectRequirement, toUnits, fromUnits } from "../src";

const account = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");

describe("x402 helpers", () => {
  it("decodes the v2 spec example header (specs/transports-v2/http.md)", () => {
    // Verbatim from the coinbase/x402 spec (Base Sepolia USDC, domain "USDC"/"2").
    const header =
      "eyJ4NDAyVmVyc2lvbiI6MiwiZXJyb3IiOiJQQVlNRU5ULVNJR05BVFVSRSBoZWFkZXIgaXMgcmVxdWlyZWQiLCJyZXNvdXJjZSI6eyJ1cmwiOiJodHRwczovL2FwaS5leGFtcGxlLmNvbS9wcmVtaXVtLWRhdGEiLCJkZXNjcmlwdGlvbiI6IkFjY2VzcyB0byBwcmVtaXVtIG1hcmtldCBkYXRhIiwibWltZVR5cGUiOiJhcHBsaWNhdGlvbi9qc29uIn0sImFjY2VwdHMiOlt7InNjaGVtZSI6ImV4YWN0IiwibmV0d29yayI6ImVpcDE1NTo4NDUzMiIsImFtb3VudCI6IjEwMDAwIiwiYXNzZXQiOiIweDAzNkNiRDUzODQyYzU0MjY2MzRlNzkyOTU0MWVDMjMxOGYzZENGN2UiLCJwYXlUbyI6IjB4MjA5NjkzQmM2YWZjMEM1MzI4YkEzNkZhRjAzQzUxNEVGMzEyMjg3QyIsIm1heFRpbWVvdXRTZWNvbmRzIjo2MCwiZXh0cmEiOnsibmFtZSI6IlVTREMiLCJ2ZXJzaW9uIjoiMiJ9fV19";
    const res = new Response("{}", { status: 402, headers: { "PAYMENT-REQUIRED": header } });
    const pr = parsePaymentRequired(res, {})!;
    expect(pr.x402Version).toBe(2);
    expect(pr.accepts[0]).toMatchObject({ scheme: "exact", network: "eip155:84532", amount: 10_000n, maxTimeoutSeconds: 60, extra: { name: "USDC", version: "2" } });
    expect(selectRequirement(pr, { network: "eip155:8453", asset: BASE_USDC })).toBeUndefined();
  });

  it("normalises a v1 body challenge and builds an X-PAYMENT header", async () => {
    const body = {
      x402Version: 1,
      accepts: [{ scheme: "exact", network: "base", maxAmountRequired: "5240000", asset: BASE_USDC, payTo: "0x3291e96b3bff7ed56e3ca8364273c5b4654b2b37", maxTimeoutSeconds: 60, extra: { ...BASE_USDC_DOMAIN } }],
    };
    const pr = parsePaymentRequired(new Response(null, { status: 402 }), body)!;
    const req = selectRequirement(pr, { network: "eip155:8453", asset: BASE_USDC })!;
    expect(req.amount).toBe(5_240_000n);
    const pay = await createExactEvmPayment({ account, requirement: req, x402Version: 1, now: 1_800_000_000 });
    expect(pay.headerName).toBe("X-PAYMENT");
    const decoded = JSON.parse(Buffer.from(pay.headerValue, "base64").toString());
    expect(decoded).toMatchObject({ x402Version: 1, scheme: "exact", network: "base" });
    expect(decoded.payload.authorization).toMatchObject({ validAfter: "1799999400", validBefore: "1800000060", value: "5240000" });
    const td = eip3009TypedData(req, pay.authorization);
    expect(td.domain).toEqual({ name: "USD Coin", version: "2", chainId: 8453, verifyingContract: BASE_USDC });
    expect(await recoverTypedDataAddress({ ...td, signature: pay.signature })).toBe(account.address);
  });

  it("converts provider decimals to 6-decimal USD units", () => {
    expect(toUnits(5)).toBe(5_000_000n);
    expect(toUnits(5.03)).toBe(5_030_000n);
    expect(toUnits("12.3456789")).toBe(12_345_678n);
    expect(fromUnits(5_250_000n)).toBe("5.25");
    expect(fromUnits(5_000_000n)).toBe("5");
  });
});
