// Burrow moves made by BilbyRouter. The share balance, deposited/withdrawn totals and the
// BurrowEvent row come from the stataAUSD Deposit/Withdraw log earlier in the same tx
// (BilbyAccount.ts); these handlers add the feed item, the per-source counters, the source
// label on that BurrowEvent, and the auto-save settings.
import { indexer } from "envio";
import { newBurrowPosition } from "../lib/defaults.js";
import { LOG_FIELDS, logId, lower, updateAccount, updateDaily, updateGlobal, type Ctx } from "../lib/store.js";

for (const event of ["AutoSaveSet", "Swept", "Added", "Broken"] as const) {
  indexer.contractRegister({ contract: "BilbyRouter", event }, async ({ event, context }) => {
    context.chain.BilbyAccount.add(event.params.user);
  });
}

indexer.onEvent({ contract: "BilbyRouter", event: "AutoSaveSet", fields: LOG_FIELDS }, async ({ event, context }) => {
  const ts = event.block.timestamp;
  const { enabled, threshold } = event.params;
  let wasEnabled = false;
  await updateAccount(context, event.params.user, ts, (a) => {
    wasEnabled = a.autoSaveEnabled;
    return { autoSaveEnabled: enabled, autoSaveThreshold: threshold };
  });
  // Transition-based, so replaying the same setting never double counts.
  if (wasEnabled !== enabled) {
    await updateGlobal(context, ts, (g) => ({ autoSaveEnabledCount: g.autoSaveEnabledCount + (enabled ? 1 : -1) }));
  }
});

type RouterMove = {
  source: "AUTO_SAVE" | "ADD" | "BREAK";
  user: string;
  assets: bigint;
  ts: number;
  blockNumber: number;
  logIndex: number;
  txHash: string;
};

async function recordRouterMove(context: Ctx, move: RouterMove) {
  const itemId = `burrow-${logId(move.txHash, move.logIndex)}`;
  if (await context.ActivityItem.get(itemId)) return; // already applied
  const user = lower(move.user);

  context.ActivityItem.set({
    id: itemId,
    account_id: user,
    kind: move.source === "BREAK" ? "burrow_out" : "burrow_in",
    status: "completed",
    amount: move.assets,
    counterparty: undefined,
    counterpartyAccount_id: undefined,
    counterpartyPhoneKey: undefined,
    deposit_id: undefined,
    giftId: undefined,
    expiresAt: undefined,
    createdAt: move.ts,
    updatedAt: move.ts,
    blockNumber: move.blockNumber,
    logIndex: move.logIndex,
    txHash: move.txHash,
  });

  await updateAccount(context, user, move.ts, () => ({}));
  const position = (await context.BurrowPosition.get(user)) ?? newBurrowPosition(user, move.ts);
  context.BurrowPosition.set({
    ...position,
    sweepCount: position.sweepCount + (move.source === "AUTO_SAVE" ? 1 : 0),
    sweptAssets: position.sweptAssets + (move.source === "AUTO_SAVE" ? move.assets : 0n),
    addCount: position.addCount + (move.source === "ADD" ? 1 : 0),
    addedAssets: position.addedAssets + (move.source === "ADD" ? move.assets : 0n),
    breakCount: position.breakCount + (move.source === "BREAK" ? 1 : 0),
    brokenAssets: position.brokenAssets + (move.source === "BREAK" ? move.assets : 0n),
    updatedAt: move.ts,
  });

  // Label the vault movement this router call caused (same tx, earlier log).
  if (position.lastVaultEvent_id) {
    const vaultEvent = await context.BurrowEvent.get(position.lastVaultEvent_id);
    if (vaultEvent && vaultEvent.txHash === move.txHash && vaultEvent.source !== move.source) {
      context.BurrowEvent.set({ ...vaultEvent, source: move.source });
    }
  }

  if (move.source === "AUTO_SAVE") {
    await updateDaily(context, move.ts, (d) => ({ autoSaveSweeps: d.autoSaveSweeps + 1 }));
  }
}

const moveFrom = (
  source: RouterMove["source"],
  event: {
    params: { user: string; assets: bigint };
    block: { timestamp: number; number: number };
    logIndex: number;
    transaction: { hash: string };
  },
): RouterMove => ({
  source,
  user: event.params.user,
  assets: event.params.assets,
  ts: event.block.timestamp,
  blockNumber: event.block.number,
  logIndex: event.logIndex,
  txHash: event.transaction.hash,
});

indexer.onEvent(
  { contract: "BilbyRouter", event: "Swept", fields: LOG_FIELDS },
  async ({ event, context }) => recordRouterMove(context, moveFrom("AUTO_SAVE", event)),
);

indexer.onEvent(
  { contract: "BilbyRouter", event: "Added", fields: LOG_FIELDS },
  async ({ event, context }) => recordRouterMove(context, moveFrom("ADD", event)),
);

indexer.onEvent(
  { contract: "BilbyRouter", event: "Broken", fields: LOG_FIELDS },
  async ({ event, context }) => recordRouterMove(context, moveFrom("BREAK", event)),
);
