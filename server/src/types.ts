import type { TypedDataJson } from "@bilbypay/core";
import type { Hex } from "viem";

// Response shapes from docs/api.md. Money is always a base-unit string.

export type Profile = {
  address: Hex;
  displayName: string;
  phone: string;
  phoneMasked: string;
  autoSave: { enabled: boolean; threshold: string };
  createdAt: string;
};

export type Counterparty = { name: string; phoneMasked?: string };

export type Receipt = {
  reference: string;
  amount: string;
  counterparty?: Counterparty;
  at: string;
  technical?: { txHash: Hex; explorerUrl: string };
};

export type ActionType = "send" | "gift_send" | "gift_buy" | "cancel" | "burrow_autosave" | "burrow_add" | "burrow_withdraw";

export type PreparedAction = {
  id: string;
  type: ActionType;
  expiresAt: string;
  summary: {
    title: string;
    lines: Array<{ label: string; value: string }>;
    total: string;
    fromBurrow: string;
    warnings: Array<{ code: string; message: string }>;
  };
  toSign: Array<{ key: string; typedData: TypedDataJson }>;
  expect: { payer: Hex; amount: string; payee?: Hex };
};

export type ActionResult = {
  id: string;
  status: "completed" | "waiting" | "failed";
  receipt?: Receipt;
  claimLink?: string;
  giftCardId?: string;
  error?: { code: string; message: string };
};

export type ActivityKind = "sent" | "received" | "gift_sent" | "gift_received" | "gift_bought" | "burrow_in" | "burrow_out" | "refund";
export type ActivityStatus = "completed" | "waiting" | "refunded" | "cancelled" | "failed";

export type ActivityItem = {
  id: string;
  kind: ActivityKind;
  status: ActivityStatus;
  amount: string;
  counterparty?: Counterparty;
  note?: string;
  giftCardId?: string;
  claimLink?: string;
  canCancel?: boolean;
  expiresAt?: string;
  receipt?: Receipt;
  createdAt: string;
};
