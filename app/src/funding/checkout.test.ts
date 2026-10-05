import { describe, expect, it, vi } from "vitest";
import { amountProblem, fundingAttempt, fundingCopy, safeCheckoutUrl, shouldPollFunding } from "./checkout";

describe("funding checkout", () => {
  it("only opens the exact HTTPS practice provider", () => {
    expect(safeCheckoutUrl("https://app.demo.rampnetwork.com/?hostApiKey=preview")).toBe("https://app.demo.rampnetwork.com/?hostApiKey=preview");
    for (const url of [undefined, "javascript:alert(1)", "http://app.demo.rampnetwork.com", "https://app.rampnetwork.com", "https://app.demo.rampnetwork.com.evil.example", "https://app.demo.rampnetwork.com@evil.example", "https://user:password@app.demo.rampnetwork.com", "https://app.demo.rampnetwork.com:8443", "not a URL"]) {
      expect(safeCheckoutUrl(url)).toBeNull();
    }
  });

  it("checks the entered dollars against the server's limits without rounding", () => {
    expect(amountProblem("25", "25000000", "100000000")).toBeNull();
    expect(amountProblem("100", "25000000", "100000000")).toBeNull();
    expect(amountProblem("24.99", "25000000", "100000000")).toContain("$25.00");
    expect(amountProblem("100.01", "25000000", "100000000")).toContain("$100.00");
    expect(amountProblem("25.001", "25000000", "100000000")).not.toBeNull();
    expect(amountProblem("0", "0", "100000000")).not.toBeNull();
    expect(amountProblem("-25", "0", "100000000")).not.toBeNull();
    expect(amountProblem("25", "invalid", "100000000")).not.toBeNull();
  });

  it("reuses the same attempt after an ambiguous response and creates one only when details change", () => {
    const newId = vi.fn().mockReturnValueOnce("first").mockReturnValueOnce("second").mockReturnValueOnce("third");
    const first = fundingAttempt(null, "25000000", "http://localhost:8081/funding", newId);
    const retry = fundingAttempt(first, "25000000", "http://localhost:8081/funding", newId);
    expect(retry).toBe(first);
    expect(newId).toHaveBeenCalledTimes(1);
    const changed = fundingAttempt(first, "50000000", "http://localhost:8081/funding", newId);
    expect(changed.idempotencyKey).toBe("second");
    expect(fundingAttempt(changed, "50000000", "bilbypay://funding", newId).idempotencyKey).toBe("third");
  });

  it("stops polling after a final provider result or a bounded waiting window", () => {
    expect(shouldPollFunding("pending", 1)).toBe(true);
    expect(shouldPollFunding("processing", 23)).toBe(true);
    expect(shouldPollFunding("pending", 24)).toBe(false);
    for (const status of ["completed", "failed", "cancelled", "expired"] as const) expect(shouldPollFunding(status, 1)).toBe(false);
  });

  it("never describes sandbox completion as a funded Bilby balance", () => {
    expect(fundingCopy("pending").title).not.toContain("complete");
    expect(fundingCopy("completed").title).toBe("Practice payment complete");
    expect(fundingCopy("completed").body).toContain("balance was not credited");
  });
});
