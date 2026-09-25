// Classifies an AUSD Transfer that touches a BilbyPay account. Pure: the handler looks up
// which sides are known accounts and passes the answers in.
//
// Only transfers that are payments in their own right become activity items. Movements into or
// out of BilbyPay contracts (escrow, router, stataAUSD) are already described by those contracts'
// own events (Deposited / Claimed / Swept / Broken / ...), so they only move balances here.

export type SystemAddresses = {
  escrow: string;
  router: string;
  stata: string;
};

export type TransferClass =
  /** BilbyPay account -> BilbyPay account: "sent" + "received" items, a contact edge. */
  | "direct"
  /** Non-BilbyPay address -> account (exchange withdrawal, a friend outside BilbyPay, a mint). */
  | "external_in"
  /** Account -> non-BilbyPay address (cash-out, paying someone outside BilbyPay, a burn). */
  | "external_out"
  /** Account -> escrow (a send to a phone number; see BilbyEscrow.Deposited). */
  | "escrow_in"
  /** Escrow -> account (claim payout, refund, cancel; see BilbyEscrow events). */
  | "escrow_out"
  /** Account -> router / stataAUSD (Add to Burrow, auto-save sweep, direct deposit). */
  | "burrow_in"
  /** Burrow withdrawal paid to the account (from the Aave aToken / router / stataAUSD). */
  | "burrow_out"
  /** Neither side could be attributed (see README "Known gaps"). */
  | "unattributed";

export type TransferInput = {
  from: string;
  to: string;
  system: SystemAddresses;
  fromIsAccount: boolean;
  toIsAccount: boolean;
  /**
   * The recipient burned stataAUSD shares earlier in this transaction, so AUSD arriving from a
   * non-BilbyPay address is the Burrow withdrawal payout (Aave pays it from the aToken).
   */
  toHasBurrowWithdrawalInTx: boolean;
};

export type Classification = {
  kind: TransferClass;
  /** `from` is a BilbyPay account (its AUSD out-flow is tracked). */
  fromUser: boolean;
  /** `to` is a BilbyPay account (its AUSD in-flow is tracked). */
  toUser: boolean;
};

const ZERO = "0x0000000000000000000000000000000000000000";

export function classifyTransfer(input: TransferInput): Classification {
  const from = input.from.toLowerCase();
  const to = input.to.toLowerCase();
  const { escrow, router, stata } = input.system;
  const isContract = (a: string) => a === escrow || a === router || (a === stata && a !== ZERO);
  const isSystem = (a: string) => a === ZERO || isContract(a);

  // A log only reaches this handler because `from` or `to` is a registered account. Contracts
  // are never registered, so when one side is a contract the other side is the account even if
  // its Account row is created later in the same transaction (e.g. Transfer before Deposited).
  const fromUser = !isSystem(from) && (input.fromIsAccount || isContract(to));
  const toUser = !isSystem(to) && (input.toIsAccount || isContract(from));

  let kind: TransferClass;
  if (fromUser && toUser) kind = "direct";
  else if (fromUser) {
    if (to === escrow) kind = "escrow_in";
    else if (to === router || (to === stata && isContract(to))) kind = "burrow_in";
    else kind = "external_out";
  } else if (toUser) {
    if (from === escrow) kind = "escrow_out";
    else if (from === router || (from === stata && isContract(from))) kind = "burrow_out";
    else if (input.toHasBurrowWithdrawalInTx) kind = "burrow_out";
    else kind = "external_in";
  } else kind = "unattributed";

  return { kind, fromUser, toUser };
}

/** Transfers that are payments (they count towards payments / volume and create feed items). */
export function isPayment(kind: TransferClass): boolean {
  return kind === "direct" || kind === "external_out";
}
