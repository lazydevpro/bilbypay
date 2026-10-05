// Bound / Unbound retain historical counters; BindingUpdated is the v2 lifecycle projection.
// Resolution additionally checks expiry, revocation and pending recovery at query time.
import { indexer, type DirectoryChange } from "envio";
import { newPhone } from "../lib/defaults.js";
import { LOG_FIELDS, logId, lower, updateAccount, updateDaily, updateGlobal } from "../lib/store.js";
import { ZERO_ADDRESS } from "../lib/tokens.js";

indexer.contractRegister({ contract: "BilbyDirectory", event: "Bound" }, async ({ event, context }) => {
  context.chain.BilbyAccount.add(event.params.account);
});

indexer.onEvent(
  { contract: "BilbyDirectory", event: "Bound", fields: LOG_FIELDS },
  async ({ event, context }) => {
    const id = logId(event.transaction.hash, event.logIndex);
    if (await context.PhoneBinding.get(id)) return; // already applied

    const ts = event.block.timestamp;
    const phoneKey = event.params.phoneKey;
    const account = lower(event.params.account);
    const previous = lower(event.params.previous);
    const isRebind = previous !== ZERO_ADDRESS && previous !== account;

    const phone = (await context.Phone.get(phoneKey)) ?? newPhone(phoneKey);
    const phoneWasBound = phone.account_id !== undefined && !phone.revoked;
    context.Phone.set({
      ...phone,
      account_id: account,
      boundAt: ts,
      bindCount: phone.bindCount + 1,
      rebindCount: phone.rebindCount + (isRebind ? 1 : 0),
      lastReboundAt: isRebind ? ts : phone.lastReboundAt,
      pendingAccount: undefined,
      pendingExecutableAt: undefined,
      pendingExpiresAt: undefined,
      pendingRevision: undefined,
    });

    // The number moved away from `previous`: that account no longer has a number.
    if (isRebind) {
      const prev = await context.Account.get(previous);
      if (prev && prev.phoneKey === phoneKey) {
        context.Account.set({ ...prev, phoneKey: undefined, phone_id: undefined, isBound: false });
      }
    }

    await updateAccount(context, account, ts, (a) => ({
      phoneKey,
      phone_id: phoneKey,
      isBound: true,
      firstBoundAt: a.firstBoundAt ?? ts,
      boundAt: ts,
      // Renewing the same account/number is a fresh verification, not a recipient change.
      reboundAt: a.bindingCount > 0 && a.phoneKey !== phoneKey ? ts : a.reboundAt,
      bindingCount: a.bindingCount + 1,
    }));

    context.PhoneBinding.set({
      id,
      phone_id: phoneKey,
      account_id: account,
      action: "BOUND",
      previousAccount: isRebind ? previous : undefined,
      isRebind,
      timestamp: ts,
      blockNumber: event.block.number,
      txHash: event.transaction.hash,
    });

    await updateGlobal(context, ts, (g) => ({
      bindings: g.bindings + 1,
      rebinds: g.rebinds + (isRebind ? 1 : 0),
      boundPhones: g.boundPhones + (phoneWasBound ? 0 : 1),
    }));
    await updateDaily(context, ts, (d) => ({
      newBindings: d.newBindings + 1,
      rebinds: d.rebinds + (isRebind ? 1 : 0),
    }));
  },
);

indexer.onEvent(
  { contract: "BilbyDirectory", event: "Unbound", fields: LOG_FIELDS },
  async ({ event, context }) => {
    const id = logId(event.transaction.hash, event.logIndex);
    if (await context.PhoneBinding.get(id)) return;

    const ts = event.block.timestamp;
    const phoneKey = event.params.phoneKey;
    const account = lower(event.params.account);

    const phone = (await context.Phone.get(phoneKey)) ?? newPhone(phoneKey);
    const wasBound = phone.account_id !== undefined;
    context.Phone.set({ ...phone, account_id: undefined, boundAt: undefined, pendingAccount: undefined, pendingExecutableAt: undefined, pendingExpiresAt: undefined, pendingRevision: undefined });

    await updateAccount(context, account, ts, (a) =>
      a.phoneKey === phoneKey ? { phoneKey: undefined, phone_id: undefined, isBound: false } : {},
    );

    context.PhoneBinding.set({
      id,
      phone_id: phoneKey,
      account_id: account,
      action: "UNBOUND",
      previousAccount: undefined,
      isRebind: false,
      timestamp: ts,
      blockNumber: event.block.number,
      txHash: event.transaction.hash,
    });

    if (wasBound) await updateGlobal(context, ts, (g) => ({ boundPhones: g.boundPhones - 1 }));
  },
);

type ChangeEvent = { transaction: { hash: string }; logIndex: number; block: { timestamp: number; number: number }; srcAddress: string };
function newChange(event: ChangeEvent, phoneKey: string, action: DirectoryChange["action"], revision: bigint): DirectoryChange {
  return {
    id: logId(event.transaction.hash, event.logIndex),
    phone_id: phoneKey,
    action,
    account: undefined,
    proposedAccount: undefined,
    revision,
    phoneEpoch: undefined,
    validUntil: undefined,
    revoked: undefined,
    executableAt: undefined,
    expiresAt: undefined,
    timestamp: event.block.timestamp,
    blockNumber: event.block.number,
    logIndex: event.logIndex,
    txHash: event.transaction.hash,
    directoryAddress: lower(event.srcAddress),
  };
}

indexer.onEvent(
  { contract: "BilbyDirectory", event: "BindingUpdated", fields: LOG_FIELDS },
  async ({ event, context }) => {
    const { phoneKey, revision, phoneEpoch, validUntil, revoked } = event.params;
    const change = newChange(event, phoneKey, "UPDATED", revision);
    if (await context.DirectoryChange.get(change.id)) return;
    const account = lower(event.params.account);
    const phone = (await context.Phone.get(phoneKey)) ?? newPhone(phoneKey);
    context.Phone.set({
      ...phone,
      account_id: account === ZERO_ADDRESS ? undefined : account,
      boundAt: Number(event.params.boundAt) || undefined,
      revision,
      phoneEpoch,
      validUntil: Number(validUntil),
      revoked,
      pendingAccount: undefined,
      pendingExecutableAt: undefined,
      pendingExpiresAt: undefined,
      pendingRevision: undefined,
      lastUpdatedBlock: event.block.number,
      lastUpdatedLog: event.logIndex,
    });
    context.DirectoryChange.set({ ...change, account: account === ZERO_ADDRESS ? undefined : account, phoneEpoch, validUntil: Number(validUntil), revoked });
  },
);

indexer.onEvent(
  { contract: "BilbyDirectory", event: "RecoveryRequested", fields: LOG_FIELDS },
  async ({ event, context }) => {
    const { phoneKey, expectedRevision, executableAt, expiresAt } = event.params;
    const change = newChange(event, phoneKey, "RECOVERY_REQUESTED", expectedRevision);
    if (await context.DirectoryChange.get(change.id)) return;
    const phone = (await context.Phone.get(phoneKey)) ?? newPhone(phoneKey);
    const proposedAccount = lower(event.params.proposedAccount);
    context.Phone.set({
      ...phone,
      revision: expectedRevision,
      pendingAccount: proposedAccount,
      pendingExecutableAt: Number(executableAt),
      pendingExpiresAt: Number(expiresAt),
      pendingRevision: expectedRevision,
      lastUpdatedBlock: event.block.number,
      lastUpdatedLog: event.logIndex,
    });
    const account = lower(event.params.currentAccount);
    context.DirectoryChange.set({ ...change, account: account === ZERO_ADDRESS ? undefined : account, proposedAccount, executableAt: Number(executableAt), expiresAt: Number(expiresAt) });
  },
);

for (const eventName of ["RecoveryCancelled", "RecoveryFinalized"] as const) {
  indexer.onEvent(
    { contract: "BilbyDirectory", event: eventName, fields: LOG_FIELDS },
    async ({ event, context }) => {
      const { phoneKey, revision } = event.params;
      const change = newChange(event, phoneKey, eventName === "RecoveryCancelled" ? "RECOVERY_CANCELLED" : "RECOVERY_FINALIZED", revision);
      if (await context.DirectoryChange.get(change.id)) return;
      const phone = (await context.Phone.get(phoneKey)) ?? newPhone(phoneKey);
      context.Phone.set({ ...phone, revision, pendingAccount: undefined, pendingExecutableAt: undefined, pendingExpiresAt: undefined, pendingRevision: undefined, lastUpdatedBlock: event.block.number, lastUpdatedLog: event.logIndex });
      context.DirectoryChange.set({ ...change, account: "account" in event.params ? lower(event.params.account) : phone.account_id });
    },
  );
}
