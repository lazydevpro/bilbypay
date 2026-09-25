// Phone bindings. `Bound(phoneKey, account, previous)`: the number now resolves to `account`;
// `previous` (if non-zero) silently lost it. `Unbound(oldKey, account)` is emitted first when
// an account moves to a new number.
import { indexer } from "envio";
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
    const isRebind = previous !== ZERO_ADDRESS;

    const phone = (await context.Phone.get(phoneKey)) ?? newPhone(phoneKey);
    const phoneWasBound = phone.account_id !== undefined;
    context.Phone.set({
      ...phone,
      account_id: account,
      boundAt: ts,
      bindCount: phone.bindCount + 1,
      rebindCount: phone.rebindCount + (isRebind ? 1 : 0),
      lastReboundAt: isRebind ? ts : phone.lastReboundAt,
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
      // Any binding after the first one is a rebind of this account (new number or new device).
      reboundAt: a.bindingCount > 0 ? ts : a.reboundAt,
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
    context.Phone.set({ ...phone, account_id: undefined, boundAt: undefined });

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
