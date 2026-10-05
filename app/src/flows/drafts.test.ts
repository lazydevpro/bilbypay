import { describe, expect, it } from "vitest";
import { firstName } from "./drafts";

describe("recipient names in payment copy", () => {
  it.each([
    "+1 (555) 555-0123",
    "+91 98765 43210",
    "(020) 7946 0123",
    "+44 20 7946 0123 ext. 42",
    "+1 (555) •••-0123",
  ])("preserves the complete phone identity %s", (phone) => {
    expect(firstName(`  ${phone}  `)).toBe(phone);
  });

  it.each([
    ["Maya Chen", "Maya"],
    ["  Arjun   Rao  ", "Arjun"],
    ["李 明", "李"],
    ["", ""],
    ["   ", ""],
  ])("uses the given name from %s", (name, expected) => {
    expect(firstName(name)).toBe(expected);
  });
});
