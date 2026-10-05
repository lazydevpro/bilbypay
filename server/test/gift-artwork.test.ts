import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ClaimService } from "../src/claims";
import { openDb } from "../src/db";
import { MockGiftCardProvider } from "../src/giftcards/mock";
import { GiftCardService } from "../src/giftcards/service";

const owner = "0x0000000000000000000000000000000000000001" as const;
const giftId = `0x${"ab".repeat(32)}` as const;
const art = "https://cdn.bitrefill.com/primg/w600h400/starbucks-usa.png";
const activity = { add: () => ({ id: "x", reference: "r" }), update: () => {} } as never;
const service = (db: ReturnType<typeof openDb>) => new GiftCardService(db, new MockGiftCardProvider(), undefined as never, activity, Buffer.alloc(32, 3));

describe("gift artwork metadata", () => {
  it("passes artwork from the catalog into the persisted owned card", async () => {
    const db = openDb(":memory:");
    try {
      const gifts = service(db);
      expect((await gifts.catalogView("US")).find((b) => b.id === "starbucks-us")?.artworkUrl).toBe(art);
      const brand = (await gifts.findBrand("starbucks-us"))!;
      const order = await gifts.fulfil({ giftId, owner, source: "buy", brand, faceValue: 10_000_000n, paid: 10_000_000n, refundTo: owner });
      expect(gifts.getOrder(order.id)?.artwork_url).toBe(art);
      // A new service instance reads the stored snapshot without a catalog fetch.
      expect(service(db).list(owner)[0]).toMatchObject({ artworkUrl: art, logoUrl: brand.logoUrl });
    } finally {
      db.close();
    }
  });

  it("upgrades existing gift orders without changing their logo, value, or encrypted redemption", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bilby-artwork-"));
    const path = join(dir, "test.sqlite");
    let db = openDb(path);
    try {
      const gifts = service(db);
      const brand = (await gifts.findBrand("starbucks-us"))!;
      const order = await gifts.fulfil({ giftId, owner, source: "buy", brand, faceValue: 10_000_000n, paid: 10_000_000n, refundTo: owner });
      const before = gifts.getOrder(order.id)!;
      // Recreate schema v2, before artwork, directory v2, and Ramp funding.
      for (const column of ["revision", "phone_epoch", "valid_until", "changed_at", "revoked", "pending_account", "pending_available_at", "pending_expires_at", "observed_block"]) db.exec(`ALTER TABLE phone_bindings DROP COLUMN ${column}`);
      db.exec("DROP TABLE ramp_events; DROP TABLE ramp_sessions; DROP TABLE directory_requests; ALTER TABLE claims DROP COLUMN phone_epoch; ALTER TABLE gift_orders DROP COLUMN artwork_url; PRAGMA user_version = 2;");
      db.close();
      db = openDb(path);
      const restored = service(db);
      expect(restored.getOrder(order.id)).toMatchObject({
        logo_url: before.logo_url, face_value: before.face_value, redemption_enc: before.redemption_enc, artwork_url: null,
      });
      expect(JSON.parse(JSON.stringify(restored.list(owner)[0]))).not.toHaveProperty("artworkUrl");
      expect(restored.reveal(owner, order.id).code).toBeTruthy();
    } finally {
      try { db.close(); } catch {}
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exposes artwork in claims while keeping older claim JSON compatible", () => {
    const db = openDb(":memory:");
    const claims = new ClaimService(db, undefined as never, undefined as never, undefined as never,
      undefined as never, undefined as never, activity, service(db), undefined as never);
    try {
      for (const withArtwork of [true, false]) {
        const code = withArtwork ? "with-art" : "legacy";
        claims.create({
          code, depositId: `0x${(withArtwork ? "ab" : "cd").repeat(32)}`, kind: "gift", amount: 10_000_000n,
          sender: owner, senderName: "Alex", phoneKey: giftId, phoneEpoch: 0n, phoneMasked: "+1 •••• 0101",
          gift: { brandId: "starbucks-us", brandName: "Starbucks", brandLogoUrl: "https://images.test/logo.png",
            ...(withArtwork ? { brandArtworkUrl: art } : {}), faceValue: "10000000" },
          expiry: 2_000_000_000, senderActivityId: "activity",
        });
        const view = claims.view(code);
        expect(view.gift?.brandLogoUrl).toBe("https://images.test/logo.png");
        expect(view.gift?.brandArtworkUrl).toBe(withArtwork ? art : undefined);
      }
    } finally {
      db.close();
    }
  });
});
