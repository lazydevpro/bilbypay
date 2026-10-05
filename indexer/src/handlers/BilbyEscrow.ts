// Escrow lifecycle: Deposited -> Claimed | Refunded | Cancelled.
// The sender's feed item (`dep-<depositId>`) is created "waiting" and moves with the deposit;
// the recipient gets a `claim-<depositId>` item; an expiry refund adds a `refund-<depositId>` item.
import { indexer, type EscrowDeposit } from "envio";
import { newPhone } from "../lib/defaults.js";
import {
  addToHistogram,
  average,
  claimRate,
  histogramQuantile,
} from "../lib/stats.js";
import { bumpContact, LOG_FIELDS, lower, updateAccount, updateDaily, updateGlobal, type Ctx } from "../lib/store.js";

const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000";

const senderItemId = (depositId: string) => `dep-${depositId}`;

// Every escrow participant is a BilbyPay account: start following its AUSD / stataAUSD.
indexer.contractRegister({ contract: "BilbyEscrow", event: "Deposited" }, async ({ event, context }) => {
  context.chain.BilbyAccount.add(event.params.sender);
});
indexer.contractRegister({ contract: "BilbyEscrow", event: "Claimed" }, async ({ event, context }) => {
  context.chain.BilbyAccount.add(event.params.recipient);
});

indexer.onEvent(
  { contract: "BilbyEscrow", event: "Deposited", fields: LOG_FIELDS },
  async ({ event, context }) => {
    const { depositId, phoneKey, amount } = event.params;
    if (await context.EscrowDeposit.get(depositId)) return; // already applied

    const ts = event.block.timestamp;
    const sender = lower(event.params.sender);
    const isGift = event.params.kind === 1n;
    const giftId = isGift && event.params.giftId !== ZERO_BYTES32 ? event.params.giftId : undefined;
    const expiry = Number(event.params.expiry);

    const phone = (await context.Phone.get(phoneKey)) ?? newPhone(phoneKey);
    context.Phone.set({
      ...phone,
      escrowReceivedCount: phone.escrowReceivedCount + 1,
      escrowReceivedVolume: phone.escrowReceivedVolume + amount,
    });

    await updateAccount(context, sender, ts, (a) => ({
      sentCount: a.sentCount + (isGift ? 0 : 1),
      sentVolume: a.sentVolume + (isGift ? 0n : amount),
      giftsSentCount: a.giftsSentCount + (isGift ? 1 : 0),
      giftsSentVolume: a.giftsSentVolume + (isGift ? amount : 0n),
      pendingOutgoing: a.pendingOutgoing + amount,
    }));

    const itemId = senderItemId(depositId);
    context.ActivityItem.set({
      id: itemId,
      account_id: sender,
      kind: isGift ? "gift_sent" : "sent",
      status: "waiting",
      amount,
      counterparty: undefined,
      counterpartyAccount_id: undefined,
      counterpartyPhoneKey: phoneKey,
      deposit_id: depositId,
      giftId,
      expiresAt: expiry,
      createdAt: ts,
      updatedAt: ts,
      blockNumber: event.block.number,
      logIndex: event.logIndex,
      txHash: event.transaction.hash,
    });

    context.EscrowDeposit.set({
      id: depositId,
      sender_id: sender,
      phone_id: phoneKey,
      phoneEpoch: event.params.phoneEpoch,
      amount,
      kind: isGift ? "GIFT" : "TRANSFER",
      giftId,
      expiry,
      status: "Pending",
      createdAt: ts,
      createdBlock: event.block.number,
      createdTx: event.transaction.hash,
      claimedBy_id: undefined,
      paidTo: undefined,
      resolvedAt: undefined,
      resolvedTx: undefined,
      timeToClaim: undefined,
      senderItem_id: itemId,
    });

    await updateGlobal(context, ts, (g) => ({
      paymentsCount: g.paymentsCount + 1,
      paymentsVolume: g.paymentsVolume + amount,
      escrowDepositCount: g.escrowDepositCount + 1,
      escrowDepositVolume: g.escrowDepositVolume + amount,
      escrowPendingCount: g.escrowPendingCount + 1,
      escrowPendingValue: g.escrowPendingValue + amount,
      giftCount: g.giftCount + (isGift ? 1 : 0),
      giftVolume: g.giftVolume + (isGift ? amount : 0n),
    }));
    await updateDaily(context, ts, (d) => ({
      paymentsCount: d.paymentsCount + 1,
      paymentsVolume: d.paymentsVolume + amount,
      escrowDepositCount: d.escrowDepositCount + 1,
      escrowDepositVolume: d.escrowDepositVolume + amount,
      giftCount: d.giftCount + (isGift ? 1 : 0),
      giftVolume: d.giftVolume + (isGift ? amount : 0n),
    }));
  },
);

/**
 * Moves a Pending deposit to its final status and updates the sender's side. Returns the
 * resolved deposit, or undefined when the deposit is unknown or already resolved (replay).
 */
async function resolveDeposit(
  context: Ctx,
  depositId: string,
  status: "Claimed" | "Refunded" | "Cancelled",
  ts: number,
  txHash: string,
  extra: Partial<EscrowDeposit> = {},
): Promise<EscrowDeposit | undefined> {
  const deposit = await context.EscrowDeposit.get(depositId);
  if (!deposit) {
    context.log.warn("escrow event for an unknown deposit (start_block after the deposit?)", { depositId, status });
    return undefined;
  }
  if (deposit.status !== "Pending") return undefined;

  const resolved: EscrowDeposit = { ...deposit, ...extra, status, resolvedAt: ts, resolvedTx: txHash };
  context.EscrowDeposit.set(resolved);

  const item = await context.ActivityItem.get(deposit.senderItem_id);
  if (item) {
    const itemStatus = status === "Claimed" ? "completed" : status === "Refunded" ? "refunded" : "cancelled";
    context.ActivityItem.set({
      ...item,
      status: itemStatus,
      expiresAt: undefined,
      counterparty: resolved.claimedBy_id ?? item.counterparty,
      counterpartyAccount_id: resolved.claimedBy_id ?? item.counterpartyAccount_id,
      updatedAt: ts,
    });
  }

  await updateAccount(context, deposit.sender_id, ts, (a) => ({ pendingOutgoing: a.pendingOutgoing - deposit.amount }));
  return resolved;
}

indexer.onEvent(
  { contract: "BilbyEscrow", event: "Claimed", fields: LOG_FIELDS },
  async ({ event, context }) => {
    const ts = event.block.timestamp;
    const recipient = lower(event.params.recipient);
    const pending = await context.EscrowDeposit.get(event.params.depositId);
    const timeToClaim = pending ? Math.max(0, ts - pending.createdAt) : 0;

    const deposit = await resolveDeposit(context, event.params.depositId, "Claimed", ts, event.transaction.hash, {
      claimedBy_id: recipient,
      paidTo: lower(event.params.paidTo),
      timeToClaim,
    });
    if (!deposit) return;

    const isGift = deposit.kind === "GIFT";
    const amount = deposit.amount;

    await updateAccount(context, recipient, ts, (a) => ({
      receivedCount: a.receivedCount + (isGift ? 0 : 1),
      receivedVolume: a.receivedVolume + (isGift ? 0n : amount),
      giftsReceivedCount: a.giftsReceivedCount + (isGift ? 1 : 0),
    }));

    context.ActivityItem.set({
      id: `claim-${deposit.id}`,
      account_id: recipient,
      kind: isGift ? "gift_received" : "received",
      status: "completed",
      amount,
      counterparty: deposit.sender_id,
      counterpartyAccount_id: deposit.sender_id,
      counterpartyPhoneKey: undefined,
      deposit_id: deposit.id,
      giftId: deposit.giftId,
      expiresAt: undefined,
      createdAt: ts,
      updatedAt: ts,
      blockNumber: event.block.number,
      logIndex: event.logIndex,
      txHash: event.transaction.hash,
    });

    if (deposit.sender_id !== recipient) await bumpContact(context, deposit.sender_id, recipient, amount, ts);

    await updateGlobal(context, ts, (g) => {
      const histogram = addToHistogram(g.timeToClaimHistogram, timeToClaim);
      const sum = g.timeToClaimSum + BigInt(timeToClaim);
      const count = g.timeToClaimCount + 1;
      const claims = g.escrowClaimCount + 1;
      return {
        escrowPendingCount: g.escrowPendingCount - 1,
        escrowPendingValue: g.escrowPendingValue - amount,
        escrowClaimCount: claims,
        escrowClaimVolume: g.escrowClaimVolume + amount,
        claimRate: claimRate(claims, g.escrowRefundCount, g.escrowCancelCount),
        timeToClaimSum: sum,
        timeToClaimCount: count,
        avgTimeToClaim: average(sum, count),
        timeToClaimHistogram: histogram,
        medianTimeToClaim: histogramQuantile(histogram, 0.5),
        p90TimeToClaim: histogramQuantile(histogram, 0.9),
      };
    });
    await updateDaily(context, ts, (d) => ({
      escrowClaimCount: d.escrowClaimCount + 1,
      escrowClaimVolume: d.escrowClaimVolume + amount,
      timeToClaimSum: d.timeToClaimSum + BigInt(timeToClaim),
      timeToClaimCount: d.timeToClaimCount + 1,
    }));
  },
);

indexer.onEvent(
  { contract: "BilbyEscrow", event: "Refunded", fields: LOG_FIELDS },
  async ({ event, context }) => {
    const ts = event.block.timestamp;
    const deposit = await resolveDeposit(context, event.params.depositId, "Refunded", ts, event.transaction.hash);
    if (!deposit) return;

    // Money coming back after expiry is its own feed row ("Returned to you").
    context.ActivityItem.set({
      id: `refund-${deposit.id}`,
      account_id: deposit.sender_id,
      kind: "refund",
      status: "completed",
      amount: deposit.amount,
      counterparty: undefined,
      counterpartyAccount_id: undefined,
      counterpartyPhoneKey: deposit.phone_id,
      deposit_id: deposit.id,
      giftId: deposit.giftId,
      expiresAt: undefined,
      createdAt: ts,
      updatedAt: ts,
      blockNumber: event.block.number,
      logIndex: event.logIndex,
      txHash: event.transaction.hash,
    });

    await updateGlobal(context, ts, (g) => ({
      escrowPendingCount: g.escrowPendingCount - 1,
      escrowPendingValue: g.escrowPendingValue - deposit.amount,
      escrowRefundCount: g.escrowRefundCount + 1,
      claimRate: claimRate(g.escrowClaimCount, g.escrowRefundCount + 1, g.escrowCancelCount),
    }));
    await updateDaily(context, ts, (d) => ({
      escrowRefundCount: d.escrowRefundCount + 1,
      escrowRefundVolume: d.escrowRefundVolume + deposit.amount,
    }));
  },
);

indexer.onEvent(
  { contract: "BilbyEscrow", event: "Cancelled", fields: LOG_FIELDS },
  async ({ event, context }) => {
    const ts = event.block.timestamp;
    // The sender cancelled it themself, so the original item just shows "cancelled".
    const deposit = await resolveDeposit(context, event.params.depositId, "Cancelled", ts, event.transaction.hash);
    if (!deposit) return;

    await updateGlobal(context, ts, (g) => ({
      escrowPendingCount: g.escrowPendingCount - 1,
      escrowPendingValue: g.escrowPendingValue - deposit.amount,
      escrowCancelCount: g.escrowCancelCount + 1,
      claimRate: claimRate(g.escrowClaimCount, g.escrowRefundCount, g.escrowCancelCount + 1),
    }));
    await updateDaily(context, ts, (d) => ({
      escrowCancelCount: d.escrowCancelCount + 1,
      escrowCancelVolume: d.escrowCancelVolume + deposit.amount,
    }));
  },
);
