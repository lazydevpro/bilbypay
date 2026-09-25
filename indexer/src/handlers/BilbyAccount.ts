// Token events of BilbyPay accounts. `BilbyAccount` addresses are registered dynamically; the
// events are wildcard events filtered on their indexed from/to/owner topic, so HyperSync returns
// only logs that touch a BilbyPay account, from any token. The handlers keep AUSD and stataAUSD.
import { indexer, type ActivityItem, type BurrowPosition } from "envio";
import { classifyTransfer, isPayment, type TransferClass } from "../lib/classify.js";
import { newBurrowPosition, GLOBAL_ID } from "../lib/defaults.js";
import { holderDelta, positionValue, sharePriceWad, sharesToAssets, WAD } from "../lib/stats.js";
import {
  bumpContact,
  LOG_FIELDS,
  logId,
  lower,
  systemAddresses,
  updateAccount,
  updateDaily,
  updateGlobal,
  type Ctx,
} from "../lib/store.js";
import { tokensFor, ZERO_ADDRESS } from "../lib/tokens.js";

type LogMeta = { id: string; ts: number; blockNumber: number; logIndex: number; txHash: string };

const meta = (event: {
  block: { timestamp: number; number: number };
  logIndex: number;
  transaction: { hash: string };
}): LogMeta => ({
  id: logId(event.transaction.hash, event.logIndex),
  ts: event.block.timestamp,
  blockNumber: event.block.number,
  logIndex: event.logIndex,
  txHash: event.transaction.hash,
});

// ------------------------------------------------------------------ Transfer

indexer.onEvent(
  {
    contract: "BilbyAccount",
    event: "Transfer",
    wildcard: true,
    where: ({ chain }) => ({
      params: [{ from: chain.BilbyAccount.addresses }, { to: chain.BilbyAccount.addresses }],
    }),
    fields: LOG_FIELDS,
  },
  async ({ event, context }) => {
    const tokens = tokensFor(event.chainId);
    const src = lower(event.srcAddress);
    const m = meta(event);
    const from = lower(event.params.from);
    const to = lower(event.params.to);
    if (src === tokens.ausd) await onAusdTransfer(context, event.chainId, m, from, to, event.params.value);
    else if (src === tokens.stata && tokens.stata !== ZERO_ADDRESS)
      await onShareTransfer(context, m, from, to, event.params.value);
    // Other tokens sent to BilbyPay accounts are out of scope.
  },
);

function feedItem(
  m: LogMeta,
  suffix: string,
  account: string,
  kind: ActivityItem["kind"],
  amount: bigint,
  counterparty: string,
  counterpartyIsAccount: boolean,
): ActivityItem {
  return {
    id: `${m.id}-${suffix}`,
    account_id: account,
    kind,
    status: "completed",
    amount,
    counterparty,
    counterpartyAccount_id: counterpartyIsAccount ? counterparty : undefined,
    counterpartyPhoneKey: undefined,
    deposit_id: undefined,
    giftId: undefined,
    expiresAt: undefined,
    createdAt: m.ts,
    updatedAt: m.ts,
    blockNumber: m.blockNumber,
    logIndex: m.logIndex,
    txHash: m.txHash,
  };
}

async function onAusdTransfer(context: Ctx, chainId: number, m: LogMeta, from: string, to: string, value: bigint) {
  if (await context.TokenTransfer.get(m.id)) return; // already applied

  const [fromAccount, toAccount, toPosition] = await Promise.all([
    context.Account.get(from),
    context.Account.get(to),
    context.BurrowPosition.get(to),
  ]);
  const { kind, fromUser, toUser } = classifyTransfer({
    from,
    to,
    system: systemAddresses(chainId),
    fromIsAccount: fromAccount !== undefined,
    toIsAccount: toAccount !== undefined,
    toHasBurrowWithdrawalInTx: toPosition?.lastBurnTx === m.txHash,
  });

  context.TokenTransfer.set({
    id: m.id,
    token: "AUSD",
    from,
    to,
    value,
    class: kind,
    timestamp: m.ts,
    blockNumber: m.blockNumber,
    txHash: m.txHash,
  });
  if (kind === "unattributed") {
    context.log.debug("AUSD transfer with no known BilbyPay side", { from, to, tx: m.txHash });
    return;
  }

  const payment = isPayment(kind);
  if (fromUser) {
    await updateAccount(context, from, m.ts, (a) => ({
      ausdOut: a.ausdOut + value,
      ausdNetFlow: a.ausdNetFlow - value,
      sentCount: a.sentCount + (payment ? 1 : 0),
      sentVolume: a.sentVolume + (payment ? value : 0n),
    }));
  }
  if (toUser) {
    const received = kind === "direct" || kind === "external_in";
    await updateAccount(context, to, m.ts, (a) => ({
      ausdIn: a.ausdIn + value,
      ausdNetFlow: a.ausdNetFlow + value,
      receivedCount: a.receivedCount + (received ? 1 : 0),
      receivedVolume: a.receivedVolume + (received ? value : 0n),
    }));
  }

  switch (kind) {
    case "direct":
      context.ActivityItem.set(feedItem(m, "out", from, "sent", value, to, true));
      context.ActivityItem.set(feedItem(m, "in", to, "received", value, from, true));
      await bumpContact(context, from, to, value, m.ts);
      await updateGlobal(context, m.ts, (g) => ({
        paymentsCount: g.paymentsCount + 1,
        paymentsVolume: g.paymentsVolume + value,
        directTransferCount: g.directTransferCount + 1,
        directTransferVolume: g.directTransferVolume + value,
      }));
      await updateDaily(context, m.ts, (d) => ({
        paymentsCount: d.paymentsCount + 1,
        paymentsVolume: d.paymentsVolume + value,
        directTransferCount: d.directTransferCount + 1,
        directTransferVolume: d.directTransferVolume + value,
      }));
      break;
    case "external_out":
      context.ActivityItem.set(feedItem(m, "out", from, "sent", value, to, false));
      await updateGlobal(context, m.ts, (g) => ({
        paymentsCount: g.paymentsCount + 1,
        paymentsVolume: g.paymentsVolume + value,
        externalOutVolume: g.externalOutVolume + value,
      }));
      await updateDaily(context, m.ts, (d) => ({
        paymentsCount: d.paymentsCount + 1,
        paymentsVolume: d.paymentsVolume + value,
        externalOutVolume: d.externalOutVolume + value,
      }));
      break;
    case "external_in":
      context.ActivityItem.set(feedItem(m, "in", to, "received", value, from, false));
      await updateGlobal(context, m.ts, (g) => ({ externalInVolume: g.externalInVolume + value }));
      await updateDaily(context, m.ts, (d) => ({ externalInVolume: d.externalInVolume + value }));
      break;
    default:
      // escrow_* and burrow_*: described by the BilbyEscrow / BilbyRouter / vault events.
      break;
  }
}

// ------------------------------------------------------- stataAUSD shares

function shareClass(fromUser: boolean, toUser: boolean, from: string, to: string): TransferClass {
  if (from === ZERO_ADDRESS) return "burrow_in";
  if (to === ZERO_ADDRESS) return "burrow_out";
  if (fromUser && toUser) return "direct";
  return fromUser ? "external_out" : "external_in";
}

async function currentPrice(context: Ctx): Promise<bigint> {
  return (await context.GlobalStats.get(GLOBAL_ID))?.sharePriceWad ?? WAD;
}

function revalue(position: BurrowPosition, priceWad: bigint): BurrowPosition {
  const { value, earned } = positionValue(position.shares, position.netDeposited, priceWad);
  return { ...position, valueEstimate: value, earnedEstimate: earned };
}

async function onShareTransfer(context: Ctx, m: LogMeta, from: string, to: string, shares: bigint) {
  if (await context.TokenTransfer.get(m.id)) return;

  const [fromAccount, toAccount] = await Promise.all([context.Account.get(from), context.Account.get(to)]);
  // A mint's recipient / a burn's owner is the registered account even if its Account row is
  // created by a router event later in the tx.
  const fromUser = from !== ZERO_ADDRESS && (fromAccount !== undefined || to === ZERO_ADDRESS);
  const toUser = to !== ZERO_ADDRESS && (toAccount !== undefined || from === ZERO_ADDRESS);

  context.TokenTransfer.set({
    id: m.id,
    token: "STATA_AUSD",
    from,
    to,
    value: shares,
    class: shareClass(fromUser, toUser, from, to),
    timestamp: m.ts,
    blockNumber: m.blockNumber,
    txHash: m.txHash,
  });

  const price = await currentPrice(context);
  let sharesDelta = 0n;
  let holders = 0;

  const move = async (account: string, delta: bigint, burned: boolean) => {
    await updateAccount(context, account, m.ts, () => ({}));
    const position = (await context.BurrowPosition.get(account)) ?? newBurrowPosition(account, m.ts);
    const next = revalue(
      {
        ...position,
        shares: position.shares + delta,
        lastBurnTx: burned ? m.txHash : position.lastBurnTx,
        updatedAt: m.ts,
      },
      price,
    );
    context.BurrowPosition.set(next);
    sharesDelta += delta;
    holders += holderDelta(position.shares, next.shares);
  };

  if (fromUser) await move(from, -shares, to === ZERO_ADDRESS);
  if (toUser) await move(to, shares, false);

  if (sharesDelta !== 0n || holders !== 0) {
    await updateGlobal(context, m.ts, (g) => {
      const burrowShares = g.burrowShares + sharesDelta;
      return {
        burrowShares,
        burrowAccounts: g.burrowAccounts + holders,
        burrowTvlEstimate: sharesToAssets(burrowShares, g.sharePriceWad),
      };
    });
  }
}

// ------------------------------------------- stataAUSD Deposit / Withdraw

async function onVaultMove(
  context: Ctx,
  chainId: number,
  m: LogMeta,
  direction: "in" | "out",
  caller: string,
  owner: string,
  assets: bigint,
  shares: bigint,
) {
  if (await context.BurrowEvent.get(m.id)) return; // already applied
  const viaRouter = caller === systemAddresses(chainId).router;
  const price = sharePriceWad(assets, shares, await currentPrice(context));

  context.BurrowEvent.set({
    id: m.id,
    account_id: owner,
    // Router moves are relabelled AUTO_SAVE / ADD / BREAK by the router event later in the tx.
    source: viaRouter ? (direction === "in" ? "ADD" : "BREAK") : "DIRECT",
    assets,
    shares,
    sharePriceWad: price,
    timestamp: m.ts,
    blockNumber: m.blockNumber,
    txHash: m.txHash,
  });

  await updateAccount(context, owner, m.ts, () => ({}));
  const position = (await context.BurrowPosition.get(owner)) ?? newBurrowPosition(owner, m.ts);
  const signed = direction === "in" ? assets : -assets;
  context.BurrowPosition.set(
    revalue(
      {
        ...position,
        depositedAssets: position.depositedAssets + (direction === "in" ? assets : 0n),
        withdrawnAssets: position.withdrawnAssets + (direction === "out" ? assets : 0n),
        netDeposited: position.netDeposited + signed,
        lastVaultEvent_id: m.id,
        updatedAt: m.ts,
      },
      price,
    ),
  );

  // Moves that bypass BilbyRouter still belong in the feed.
  if (!viaRouter) {
    context.ActivityItem.set({
      id: `vault-${m.id}`,
      account_id: owner,
      kind: direction === "in" ? "burrow_in" : "burrow_out",
      status: "completed",
      amount: assets,
      counterparty: undefined,
      counterpartyAccount_id: undefined,
      counterpartyPhoneKey: undefined,
      deposit_id: undefined,
      giftId: undefined,
      expiresAt: undefined,
      createdAt: m.ts,
      updatedAt: m.ts,
      blockNumber: m.blockNumber,
      logIndex: m.logIndex,
      txHash: m.txHash,
    });
  }

  await updateGlobal(context, m.ts, (g) => ({
    sharePriceWad: price,
    burrowNetDeposited: g.burrowNetDeposited + signed,
    burrowTvlEstimate: sharesToAssets(g.burrowShares, price),
  }));
  await updateDaily(context, m.ts, (d) =>
    direction === "in"
      ? { burrowInVolume: d.burrowInVolume + assets }
      : { burrowOutVolume: d.burrowOutVolume + assets },
  );
}

indexer.onEvent(
  {
    contract: "BilbyAccount",
    event: "Deposit",
    wildcard: true,
    where: ({ chain }) => ({ params: { owner: chain.BilbyAccount.addresses } }),
    fields: LOG_FIELDS,
  },
  async ({ event, context }) => {
    const { stata } = tokensFor(event.chainId);
    if (stata === ZERO_ADDRESS || lower(event.srcAddress) !== stata) return;
    const { sender, owner, assets, shares } = event.params;
    await onVaultMove(context, event.chainId, meta(event), "in", lower(sender), lower(owner), assets, shares);
  },
);

indexer.onEvent(
  {
    contract: "BilbyAccount",
    event: "Withdraw",
    wildcard: true,
    where: ({ chain }) => ({ params: { owner: chain.BilbyAccount.addresses } }),
    fields: LOG_FIELDS,
  },
  async ({ event, context }) => {
    const { stata } = tokensFor(event.chainId);
    if (stata === ZERO_ADDRESS || lower(event.srcAddress) !== stata) return;
    const { sender, owner, assets, shares } = event.params;
    await onVaultMove(context, event.chainId, meta(event), "out", lower(sender), lower(owner), assets, shares);
  },
);
