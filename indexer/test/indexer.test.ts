// End-to-end handler tests with Envio's in-process test indexer: simulated logs, real handlers,
// real `where` filters (the simulate source applies the BilbyAccount address filter too).
import { createTestIndexer, indexer as runtime, type Address } from "envio";
import { describe, expect, it } from "vitest";
import { tokensFor } from "../src/lib/tokens.js";

const addr = (value: string) => value.toLowerCase() as Address;

const CHAIN = 143;
const T0 = 1_790_000_000;
const ZERO = addr("0x0000000000000000000000000000000000000000");
const ZERO32 = "0x" + "00".repeat(32);

const ALICE = addr("0x000000000000000000000000000000000000a11c");
const BOB = addr("0x0000000000000000000000000000000000000b0b");
const CAROL = addr("0x000000000000000000000000000000000000ca01");
const EXCHANGE = addr("0x00000000000000000000000000000000000e0c11"); // not a BilbyPay account
const ATOKEN = addr("0x000000000000000000000000000000000000a70c"); // Aave aAUSD paying out withdrawals
const OTHER_TOKEN = addr("0x0000000000000000000000000000000000070c3e");
const PHONE_A = "0x" + "aa".repeat(32);
const PHONE_B = "0x" + "bb".repeat(32);

const AUSD = addr(tokensFor(CHAIN).ausd);
const STATA = addr(tokensFor(CHAIN).stata);
const ESCROW = addr(runtime.chains[CHAIN].BilbyEscrow.addresses[0]!);
const ROUTER = addr(runtime.chains[CHAIN].BilbyRouter.addresses[0]!);

const usd = (dollars: number) => BigInt(Math.round(dollars * 1_000_000));
const tx = (n: number) => "0x" + n.toString(16).padStart(64, "0");
const at = (block: number, seconds = 0, txn = block) => ({
  block: { number: block, timestamp: T0 + seconds },
  transaction: { hash: tx(txn) },
});
type At = ReturnType<typeof at>;

// ---- simulate item builders
const bound = (b: At, phoneKey: string, account: Address, previous: Address = ZERO) =>
  ({ contract: "BilbyDirectory", event: "Bound", ...b, params: { phoneKey, account, previous } }) as const;
const unbound = (b: At, phoneKey: string, account: Address) =>
  ({ contract: "BilbyDirectory", event: "Unbound", ...b, params: { phoneKey, account } }) as const;
const transfer = (b: At, token: Address, from: Address, to: Address, value: bigint) =>
  ({ contract: "BilbyAccount", event: "Transfer", srcAddress: token, ...b, params: { from, to, value } }) as const;
const deposited = (b: At, depositId: string, sender: Address, phoneKey: string, amount: bigint, expiry: number, giftId = ZERO32) =>
  ({
    contract: "BilbyEscrow",
    event: "Deposited",
    ...b,
    params: {
      depositId,
      sender,
      phoneKey,
      amount,
      expiry: BigInt(T0 + expiry),
      kind: giftId === ZERO32 ? 0n : 1n,
      giftId,
    },
  }) as const;
const claimed = (b: At, depositId: string, recipient: Address, paidTo: Address, amount: bigint) =>
  ({ contract: "BilbyEscrow", event: "Claimed", ...b, params: { depositId, recipient, paidTo, amount } }) as const;
const refunded = (b: At, depositId: string, sender: Address, amount: bigint) =>
  ({ contract: "BilbyEscrow", event: "Refunded", ...b, params: { depositId, sender, amount } }) as const;
const cancelled = (b: At, depositId: string, sender: Address, amount: bigint) =>
  ({ contract: "BilbyEscrow", event: "Cancelled", ...b, params: { depositId, sender, amount } }) as const;

const D1 = "0x" + "d1".repeat(32);
const D2 = "0x" + "d2".repeat(32);
const D3 = "0x" + "d3".repeat(32);
const GIFT = "0x" + "9f".repeat(32);

describe("phone bindings", () => {
  it("tracks binds, number changes and a number moving to another account", async () => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        [CHAIN]: {
          simulate: [
            bound(at(100), PHONE_A, ALICE),
            // Alice changes number: Unbound(old) then Bound(new) in one tx.
            unbound(at(101, 60), PHONE_A, ALICE),
            bound(at(101, 60), PHONE_B, ALICE),
            // Number B is reassigned to Carol (new SIM owner): Alice silently loses it.
            bound(at(102, 120), PHONE_B, CAROL, ALICE),
          ],
        },
      },
    });

    const alice = await indexer.Account.getOrThrow(ALICE);
    expect({
      isBound: alice.isBound,
      phoneKey: alice.phoneKey,
      bindingCount: alice.bindingCount,
      firstBoundAt: alice.firstBoundAt,
      reboundAt: alice.reboundAt,
    }).toEqual({ isBound: false, phoneKey: undefined, bindingCount: 2, firstBoundAt: T0, reboundAt: T0 + 60 });

    const phoneB = await indexer.Phone.getOrThrow(PHONE_B);
    expect({
      account: phoneB.account_id,
      bindCount: phoneB.bindCount,
      rebindCount: phoneB.rebindCount,
      lastReboundAt: phoneB.lastReboundAt,
    }).toEqual({ account: CAROL, bindCount: 2, rebindCount: 1, lastReboundAt: T0 + 120 });
    expect((await indexer.Phone.getOrThrow(PHONE_A)).account_id).toBeUndefined();

    const history = await indexer.PhoneBinding.getAll();
    expect(history.map((h) => [h.action, h.account_id, h.isRebind])).toEqual([
      ["BOUND", ALICE, false],
      ["UNBOUND", ALICE, false],
      ["BOUND", ALICE, false],
      ["BOUND", CAROL, true],
    ]);

    const g = await indexer.GlobalStats.getOrThrow("global");
    expect({ accounts: g.accounts, bindings: g.bindings, rebinds: g.rebinds, boundPhones: g.boundPhones }).toEqual({
      accounts: 2,
      bindings: 3,
      rebinds: 1,
      boundPhones: 1,
    });
  });
});

describe("escrow", () => {
  it("send to a phone number -> claim: lifecycle, feed items, time to claim", async () => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        [CHAIN]: {
          simulate: [
            bound(at(100), PHONE_A, ALICE),
            // depositWithAuthorization: AUSD Alice -> escrow, then Deposited.
            transfer(at(101, 100), AUSD, ALICE, ESCROW, usd(5)),
            deposited(at(101, 100), D1, ALICE, PHONE_B, usd(5), 86_400),
            // Bob joins with number B and claims 10 minutes later.
            bound(at(102, 700, 102), PHONE_B, BOB),
            transfer(at(103, 700), AUSD, ESCROW, BOB, usd(5)),
            claimed(at(103, 700), D1, BOB, BOB, usd(5)),
          ],
        },
      },
    });

    const deposit = await indexer.EscrowDeposit.getOrThrow(D1);
    expect({
      status: deposit.status,
      kind: deposit.kind,
      claimedBy: deposit.claimedBy_id,
      timeToClaim: deposit.timeToClaim,
      resolvedAt: deposit.resolvedAt,
    }).toEqual({ status: "Claimed", kind: "TRANSFER", claimedBy: BOB, timeToClaim: 600, resolvedAt: T0 + 700 });

    const aliceItem = await indexer.ActivityItem.getOrThrow(`dep-${D1}`);
    expect([aliceItem.kind, aliceItem.status, aliceItem.counterpartyAccount_id, aliceItem.expiresAt]).toEqual([
      "sent",
      "completed",
      BOB,
      undefined,
    ]);
    const bobItem = await indexer.ActivityItem.getOrThrow(`claim-${D1}`);
    expect([bobItem.account_id, bobItem.kind, bobItem.amount, bobItem.counterpartyAccount_id]).toEqual([
      BOB,
      "received",
      usd(5),
      ALICE,
    ]);
    // The AUSD legs into and out of the escrow are not separate feed rows.
    expect((await indexer.ActivityItem.getAll()).length).toBe(2);
    const classes = (await indexer.TokenTransfer.getAll()).map((t) => t.class);
    expect(classes).toEqual(["escrow_in", "escrow_out"]);

    const alice = await indexer.Account.getOrThrow(ALICE);
    const bob = await indexer.Account.getOrThrow(BOB);
    expect([alice.sentCount, alice.sentVolume, alice.pendingOutgoing, alice.ausdNetFlow]).toEqual([1, usd(5), 0n, -usd(5)]);
    expect([bob.receivedCount, bob.receivedVolume, bob.ausdIn]).toEqual([1, usd(5), usd(5)]);
    expect((await indexer.ContactEdge.getOrThrow(`${ALICE}-${BOB}`)).count).toBe(1);

    const g = await indexer.GlobalStats.getOrThrow("global");
    expect({
      escrowPendingCount: g.escrowPendingCount,
      escrowPendingValue: g.escrowPendingValue,
      claimRate: g.claimRate,
      avgTimeToClaim: g.avgTimeToClaim,
      medianTimeToClaim: g.medianTimeToClaim,
      paymentsCount: g.paymentsCount,
    }).toEqual({
      escrowPendingCount: 0,
      escrowPendingValue: 0n,
      claimRate: 1,
      avgTimeToClaim: 600,
      medianTimeToClaim: 600,
      paymentsCount: 1,
    });
  });

  it("gift refunded after expiry and a send cancelled by the sender", async () => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        [CHAIN]: {
          simulate: [
            bound(at(100), PHONE_A, ALICE),
            deposited(at(101, 10), D2, ALICE, PHONE_B, usd(25), 3_600, GIFT),
            deposited(at(102, 20), D3, ALICE, PHONE_B, usd(3), 3_600),
            cancelled(at(103, 30), D3, ALICE, usd(3)),
            refunded(at(104, 3_700), D2, ALICE, usd(25)),
          ],
        },
      },
    });

    const gift = await indexer.EscrowDeposit.getOrThrow(D2);
    expect([gift.kind, gift.giftId, gift.status]).toEqual(["GIFT", GIFT, "Refunded"]);
    expect((await indexer.ActivityItem.getOrThrow(`dep-${D2}`)).status).toBe("refunded");
    expect((await indexer.ActivityItem.getOrThrow(`dep-${D3}`)).status).toBe("cancelled");
    const refund = await indexer.ActivityItem.getOrThrow(`refund-${D2}`);
    expect([refund.kind, refund.amount, refund.createdAt]).toEqual(["refund", usd(25), T0 + 3_700]);

    const alice = await indexer.Account.getOrThrow(ALICE);
    expect([alice.giftsSentCount, alice.giftsSentVolume, alice.sentCount, alice.pendingOutgoing]).toEqual([
      1,
      usd(25),
      1,
      0n,
    ]);
    const phone = await indexer.Phone.getOrThrow(PHONE_B);
    expect([phone.escrowReceivedCount, phone.escrowReceivedVolume, phone.account_id]).toEqual([2, usd(28), undefined]);

    const g = await indexer.GlobalStats.getOrThrow("global");
    expect({
      escrowPendingCount: g.escrowPendingCount,
      escrowRefundCount: g.escrowRefundCount,
      escrowCancelCount: g.escrowCancelCount,
      claimRate: g.claimRate,
      giftCount: g.giftCount,
      giftVolume: g.giftVolume,
    }).toEqual({
      escrowPendingCount: 0,
      escrowRefundCount: 1,
      escrowCancelCount: 1,
      claimRate: 0,
      giftCount: 1,
      giftVolume: usd(25),
    });
  });
});

describe("AUSD transfers", () => {
  it("only receives token logs whose from/to is a registered BilbyPay account", async () => {
    const indexer = createTestIndexer();
    // Bob has not joined, so the topic filter (from|to in BilbyAccount addresses) drops the log
    // before any handler runs; the test indexer reports such items as unrouted.
    await expect(
      indexer.process({ chains: { [CHAIN]: { simulate: [transfer(at(99), AUSD, EXCHANGE, BOB, usd(1))] } } }),
    ).rejects.toThrow(/never reached a handler/);
    expect(await indexer.TokenTransfer.getAll()).toEqual([]);
  });

  it("classifies direct, external in/out, and ignores other tokens", async () => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        [CHAIN]: {
          simulate: [
            bound(at(100), PHONE_A, ALICE),
            bound(at(100), PHONE_B, BOB),
            transfer(at(101, 10), AUSD, EXCHANGE, ALICE, usd(50)), // top-up
            transfer(at(102, 20), AUSD, ALICE, BOB, usd(12.5)), // pay a friend
            transfer(at(103, 30), AUSD, ALICE, EXCHANGE, usd(7)), // cash-out
            transfer(at(104, 40), OTHER_TOKEN, EXCHANGE, ALICE, usd(99)), // not AUSD
          ],
        },
      },
    });

    const transfers = await indexer.TokenTransfer.getAll();
    expect(transfers.map((t) => [t.from, t.to, t.class])).toEqual([
      [EXCHANGE, ALICE, "external_in"],
      [ALICE, BOB, "direct"],
      [ALICE, EXCHANGE, "external_out"],
    ]);

    const items = (await indexer.ActivityItem.getAll()).map((i) => [i.account_id, i.kind, i.amount, i.counterparty]);
    expect(items).toEqual([
      [ALICE, "received", usd(50), EXCHANGE],
      [ALICE, "sent", usd(12.5), BOB],
      [BOB, "received", usd(12.5), ALICE],
      [ALICE, "sent", usd(7), EXCHANGE],
    ]);

    const alice = await indexer.Account.getOrThrow(ALICE);
    expect([alice.ausdIn, alice.ausdOut, alice.ausdNetFlow, alice.sentCount, alice.receivedCount]).toEqual([
      usd(50),
      usd(19.5),
      usd(30.5),
      2,
      1,
    ]);
    expect((await indexer.Account.getOrThrow(BOB)).ausdNetFlow).toBe(usd(12.5));

    const g = await indexer.GlobalStats.getOrThrow("global");
    expect([g.paymentsCount, g.directTransferCount, g.directTransferVolume, g.externalInVolume, g.externalOutVolume]).toEqual([
      2,
      1,
      usd(12.5),
      usd(50),
      usd(7),
    ]);
    const day = (await indexer.DailyStats.getAll())[0]!;
    expect([day.date, day.activeAccounts, day.newAccounts, day.paymentsVolume]).toEqual([
      new Date(T0 * 1000).toISOString().slice(0, 10),
      2,
      2,
      usd(19.5),
    ]);
  });
});

describe("Burrow", () => {
  it("auto-save sweep, then a break paid out by Aave, then a direct vault deposit", async () => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        [CHAIN]: {
          simulate: [
            {
              contract: "BilbyRouter",
              event: "AutoSaveSet",
              ...at(100),
              params: { user: ALICE, enabled: true, threshold: usd(10) },
            },
            // Keeper sweep: AUSD Alice -> router, router deposits for Alice (shares minted to her).
            transfer(at(101, 60), AUSD, ALICE, ROUTER, usd(20)),
            transfer(at(101, 60), STATA, ZERO, ALICE, usd(19)),
            {
              contract: "BilbyAccount",
              event: "Deposit",
              srcAddress: STATA,
              ...at(101, 60),
              params: { sender: ROUTER, owner: ALICE, assets: usd(20), shares: usd(19) },
            },
            { contract: "BilbyRouter", event: "Swept", ...at(101, 60), params: { user: ALICE, assets: usd(20), shares: usd(19) } },
            // "Move to balance": shares burned, Aave pays AUSD from the aToken, then Withdraw + Broken.
            transfer(at(102, 3_600), STATA, ALICE, ZERO, usd(10)),
            transfer(at(102, 3_600), AUSD, ATOKEN, ALICE, usd(10.6)),
            {
              contract: "BilbyAccount",
              event: "Withdraw",
              srcAddress: STATA,
              ...at(102, 3_600),
              params: { sender: ROUTER, receiver: ALICE, owner: ALICE, assets: usd(10.6), shares: usd(10) },
            },
            { contract: "BilbyRouter", event: "Broken", ...at(102, 3_600), params: { user: ALICE, assets: usd(10.6), shares: usd(10) } },
            // Alice deposits into stataAUSD herself (not through BilbyRouter).
            transfer(at(103, 7_200), AUSD, ALICE, STATA, usd(1.06)),
            transfer(at(103, 7_200), STATA, ZERO, ALICE, usd(1)),
            {
              contract: "BilbyAccount",
              event: "Deposit",
              srcAddress: STATA,
              ...at(103, 7_200),
              params: { sender: ALICE, owner: ALICE, assets: usd(1.06), shares: usd(1) },
            },
          ],
        },
      },
    });

    const position = await indexer.BurrowPosition.getOrThrow(ALICE);
    expect({
      shares: position.shares,
      depositedAssets: position.depositedAssets,
      withdrawnAssets: position.withdrawnAssets,
      netDeposited: position.netDeposited,
      valueEstimate: position.valueEstimate,
      earnedEstimate: position.earnedEstimate,
      sweepCount: position.sweepCount,
      breakCount: position.breakCount,
    }).toEqual({
      shares: usd(10),
      depositedAssets: usd(21.06),
      withdrawnAssets: usd(10.6),
      netDeposited: usd(10.46),
      valueEstimate: usd(10.6), // 10 shares at 1.06
      earnedEstimate: usd(0.14),
      sweepCount: 1,
      breakCount: 1,
    });

    const events = await indexer.BurrowEvent.getAll();
    expect(events.map((e) => [e.source, e.assets])).toEqual([
      ["AUTO_SAVE", usd(20)],
      ["BREAK", usd(10.6)],
      ["DIRECT", usd(1.06)],
    ]);

    // Feed: sweep in, break out, direct deposit. The Aave payout is not an external "received".
    const items = (await indexer.ActivityItem.getAll()).map((i) => [i.kind, i.amount]);
    expect(items).toEqual([
      ["burrow_in", usd(20)],
      ["burrow_out", usd(10.6)],
      ["burrow_in", usd(1.06)],
    ]);
    const ausd = (await indexer.TokenTransfer.getAll()).filter((t) => t.token === "AUSD").map((t) => t.class);
    expect(ausd).toEqual(["burrow_in", "burrow_out", "burrow_in"]);

    const alice = await indexer.Account.getOrThrow(ALICE);
    expect([alice.autoSaveEnabled, alice.autoSaveThreshold, alice.receivedCount, alice.ausdNetFlow]).toEqual([
      true,
      usd(10),
      0,
      -usd(20) + usd(10.6) - usd(1.06),
    ]);

    const g = await indexer.GlobalStats.getOrThrow("global");
    expect({
      autoSaveEnabledCount: g.autoSaveEnabledCount,
      burrowAccounts: g.burrowAccounts,
      burrowShares: g.burrowShares,
      burrowNetDeposited: g.burrowNetDeposited,
      burrowTvlEstimate: g.burrowTvlEstimate,
      sharePriceWad: g.sharePriceWad,
    }).toEqual({
      autoSaveEnabledCount: 1,
      burrowAccounts: 1,
      burrowShares: usd(10),
      burrowNetDeposited: usd(10.46),
      burrowTvlEstimate: usd(10.6),
      sharePriceWad: 1_060_000_000_000_000_000n,
    });
    const day = (await indexer.DailyStats.getAll())[0]!;
    expect([day.burrowInVolume, day.burrowOutVolume, day.autoSaveSweeps]).toEqual([usd(21.06), usd(10.6), 1]);
  });
});
