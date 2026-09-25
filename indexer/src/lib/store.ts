// Read-modify-write helpers over the handler context. Entities returned by `get` are read-only,
// so every update spreads into a new object and `set`s it.
import { indexer, type Account, type DailyStats, type EvmOnEventContext, type GlobalStats } from "envio";
import type { SystemAddresses } from "./classify.js";
import { GLOBAL_ID, newAccount, newDailyStats, newGlobalStats } from "./defaults.js";
import { dayDate, dayIndex } from "./stats.js";
import { tokensFor } from "./tokens.js";

export type Ctx = EvmOnEventContext;

/** Block/transaction fields every handler reads (`event.block.number` is always present). */
export const LOG_FIELDS = { block: ["timestamp"], transaction: ["hash"] } as const;

/** Stable id for anything created by one log. */
export const logId = (txHash: string, logIndex: number) => `${txHash}-${logIndex}`;

export const lower = (address: string) => address.toLowerCase();

/** BilbyPay contract + stataAUSD addresses for a chain, lowercase, from config.yaml / tokens.ts. */
export function systemAddresses(chainId: number): SystemAddresses {
  const chain = indexer.chains[chainId as keyof typeof indexer.chains] as unknown as {
    BilbyEscrow: { addresses: readonly string[] };
    BilbyRouter: { addresses: readonly string[] };
  };
  return {
    escrow: lower(chain.BilbyEscrow.addresses[0] ?? ""),
    router: lower(chain.BilbyRouter.addresses[0] ?? ""),
    stata: tokensFor(chainId).stata,
  };
}

export async function updateGlobal(context: Ctx, timestamp: number, patch: (g: GlobalStats) => Partial<GlobalStats>) {
  const current = (await context.GlobalStats.get(GLOBAL_ID)) ?? newGlobalStats();
  context.GlobalStats.set({ ...current, ...patch(current), updatedAt: Math.max(current.updatedAt, timestamp) });
}

export async function updateDaily(context: Ctx, timestamp: number, patch: (d: DailyStats) => Partial<DailyStats>) {
  const day = dayIndex(timestamp);
  const current = (await context.DailyStats.get(dayDate(day))) ?? newDailyStats(day);
  context.DailyStats.set({ ...current, ...patch(current) });
}

/**
 * Loads an account, creating it (and counting it in GlobalStats / DailyStats) the first time
 * it is seen. Also records the account as active today.
 */
export async function touchAccount(context: Ctx, address: string, timestamp: number): Promise<Account> {
  const id = lower(address);
  let account = await context.Account.get(id);
  if (!account) {
    account = newAccount(id, timestamp);
    await updateGlobal(context, timestamp, (g) => ({ accounts: g.accounts + 1 }));
    await updateDaily(context, timestamp, (d) => ({ newAccounts: d.newAccounts + 1 }));
  }
  const day = dayIndex(timestamp);
  const markerId = `${id}-${day}`;
  if (!(await context.AccountDay.get(markerId))) {
    context.AccountDay.set({ id: markerId, account_id: id, day });
    await updateDaily(context, timestamp, (d) => ({ activeAccounts: d.activeAccounts + 1 }));
  }
  account = { ...account, lastActiveAt: Math.max(account.lastActiveAt, timestamp) };
  context.Account.set(account);
  return account;
}

export async function updateAccount(context: Ctx, address: string, timestamp: number, patch: (a: Account) => Partial<Account>) {
  const account = await touchAccount(context, address, timestamp);
  const next = { ...account, ...patch(account) };
  context.Account.set(next);
  return next;
}

/** Adds one payment to the from->to contact edge. */
export async function bumpContact(context: Ctx, from: string, to: string, amount: bigint, timestamp: number) {
  const id = `${lower(from)}-${lower(to)}`;
  const edge = await context.ContactEdge.get(id);
  context.ContactEdge.set(
    edge
      ? { ...edge, count: edge.count + 1, volume: edge.volume + amount, lastAt: Math.max(edge.lastAt, timestamp) }
      : { id, from_id: lower(from), to_id: lower(to), count: 1, volume: amount, firstAt: timestamp, lastAt: timestamp },
  );
}
