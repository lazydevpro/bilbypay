import { describe, expect, it } from "vitest";
import { fundingReturnId, sessionDestination } from "./route";

describe("session routing", () => {
  it("waits for restored sessions without redirecting back to the same index", () => {
    expect(sessionDestination("loading")).toBeNull();
    expect(sessionDestination("ready")).toBeNull();
    expect(sessionDestination("signedOut")?.pathname).toBe("/welcome");
    expect(sessionDestination("locked")?.pathname).toBe("/unlock");
    expect(sessionDestination("pendingPhone")?.pathname).toBe("/settings/phone");
    expect(sessionDestination("needsPhone", "CLAIM")).toEqual({ pathname: "/phone", params: { purpose: "claim", code: "CLAIM" } });
  });
  it("retains a funding return through unlock without permitting redirects", () => {
    expect(sessionDestination("locked", null, "fund_abc-123")).toEqual({ pathname: "/unlock", params: { funding: "fund_abc-123" } });
    for (const value of ["https://evil.example", "//evil.example", "id?success=true", ["id"], "x".repeat(129)]) {
      expect(fundingReturnId(value)).toBeUndefined();
    }
  });
});
