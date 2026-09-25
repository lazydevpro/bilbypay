import { describe, expect, it } from "vitest";
import { CODE128_PATTERNS, code128Symbols, code128Widths } from "./code128";

describe("code 128", () => {
  it("has a well-formed pattern table", () => {
    expect(CODE128_PATTERNS).toHaveLength(107);
    CODE128_PATTERNS.slice(0, 106).forEach((p) => expect([...p].reduce((s, d) => s + Number(d), 0)).toBe(11));
    expect(new Set(CODE128_PATTERNS).size).toBe(107);
    expect([...CODE128_PATTERNS[106]!].reduce((s, d) => s + Number(d), 0)).toBe(13);
  });

  it("encodes text with code set B and a mod-103 checksum", () => {
    // Start B (104) + "A"(33)*1 + "b"(66)*2 = 269; 269 % 103 = 63
    expect(code128Symbols("Ab")).toEqual([104, 33, 66, 63, 106]);
  });

  it("packs even-length digit strings with code set C", () => {
    // Start C (105) + 12*1 + 34*2 = 185; 185 % 103 = 82
    expect(code128Symbols("1234")).toEqual([105, 12, 34, 82, 106]);
  });

  it("produces the expected number of modules", () => {
    const widths = code128Widths("GIFT-1234");
    expect(widths.reduce((a, b) => a + b, 0)).toBe(11 * (9 + 2) + 13);
  });

  it("rejects unsupported input", () => {
    expect(() => code128Symbols("")).toThrow();
    expect(() => code128Symbols("é")).toThrow();
  });
});
