import { describe, expect, it } from "vitest";
import type { AgoraMetrics } from "../api/types";
import { forbiddenIn } from "../copy/glossary";
import { agoraLine, compactDollars } from "./agora";

const metrics: AgoraMetrics = {
  source: "agora", partial: false, totalSupply: "211631514798976", circulatingSupply: "187063472246883",
  home: { network: "monad", chainId: "eip155:143", totalSupply: "109206890954020", circulatingSupply: "104350204252830" },
  networks: [], fetchedAt: "2026-10-14T00:00:00Z",
};

describe("Agora line on Add money", () => {
  it("formats compact dollar figures without rounding up", () => {
    expect(compactDollars("187063472246883")).toBe("$187 million");
    expect(compactDollars("187163472246883")).toBe("$187.1 million");
    expect(compactDollars("1999999999999999")).toBe("$1.9 billion");
    expect(compactDollars("608000000")).toBe("$608");
    expect(compactDollars("0")).toBeNull();
    expect(compactDollars("junk")).toBeNull();
  });

  it("uses the worldwide figure, falls back to the home network when Agora reports a partial total, else hides", () => {
    expect(agoraLine(metrics)).toBe("Your dollars are issued by Agora, with $187 million in use worldwide.");
    expect(agoraLine({ ...metrics, partial: true, circulatingSupply: undefined, totalSupply: undefined }))
      .toBe("Your dollars are issued by Agora, with $104.3 million in use on BilbyPay's network.");
    expect(agoraLine({ ...metrics, circulatingSupply: undefined, home: undefined })).toBeNull();
    expect(agoraLine(null)).toBeNull();
  });

  it("keeps to the copy rules", () => {
    expect(forbiddenIn(agoraLine(metrics)!)).toBeNull();
    expect(forbiddenIn(agoraLine({ ...metrics, circulatingSupply: undefined })!)).toBeNull();
  });
});
