import { describe, expect, it } from "vitest";
import { ApiError, FALLBACK_MESSAGE, messageFor, OFFLINE_MESSAGE, safeMessage } from "./errors";

describe("consumer error messages", () => {
  it.each([
    "You have $12.50 available. Try a smaller amount.",
    "Some of your Burrow money is busy right now — you can move $35.00 now.",
    "This was sent to +1 ••• ••• 0123. Verify that number to open it.",
    "Starbucks cards are unavailable right now. Pick another brand?",
    "You're near the daily limit. Try a smaller amount.",
    "Cancelled. Nothing was sent.",
  ])("preserves actionable payment copy: %s", (message) => {
    expect(messageFor(new ApiError("INSUFFICIENT_FUNDS", message))).toBe(message);
  });

  it.each([
    "Insufficient USDC for gas on Base.",
    "Send to 0x1111111111111111111111111111111111111111.",
    "Provider returned RPC_ERROR.",
    "Inspect https://example.com/record/123 for details.",
    "Balance on Solana is too low.",
    "Transfer reverted with nonce 42.",
    "The web3 provider is unavailable.",
    "Record: aabbccdd00112233aabbccdd00112233aabbccdd00112233aabbccdd00112233",
    "Record: 9xQeWvG816bUx9EPdZfDmPzFYBQNhXuNP8KiG5Yt3gRf",
  ])("keeps provider diagnostics internal: %s", (message) => {
    const shown = messageFor(new ApiError("INSUFFICIENT_FUNDS", message));
    expect(shown).toBe("There isn't enough money available. Check your balance or try a smaller amount.");
  });

  it("gives uncertain results a next step without claiming no money moved", () => {
    expect(messageFor(new ApiError("CONFIRMATION_FAILED", "Transaction confirmation failed"))).toBe(
      "We couldn't confirm the result. Check Activity before trying again.",
    );
  });

  it("also checks userMessage values and unknown error codes", () => {
    expect(messageFor({ userMessage: "Wallet address unavailable" })).toBe(FALLBACK_MESSAGE);
    expect(messageFor(new ApiError("UNKNOWN_PROVIDER_ERROR", "AAVE deposit reverted"))).toBe(FALLBACK_MESSAGE);
    expect(messageFor(new ApiError("toString", ""))).toBe(FALLBACK_MESSAGE);
    expect(messageFor(new Error("internal detail"))).toBe(FALLBACK_MESSAGE);
  });

  it("uses the known next step for missing or oversized messages", () => {
    expect(messageFor(new ApiError("NETWORK", ""))).toBe(OFFLINE_MESSAGE);
    expect(safeMessage(" ")).toBe(FALLBACK_MESSAGE);
    expect(safeMessage("x".repeat(601))).toBe(FALLBACK_MESSAGE);
  });
});
