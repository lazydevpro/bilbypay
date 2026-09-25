import type { ActionRequest, ActionResult, ActivityItem, Hex } from "../api/types";

/** A person picked in Send (after /v1/resolve). `address` is used only for the check before authorizing. */
export type Recipient = {
  name: string;
  phone: string;
  e164: string;
  status: "registered" | "invite";
  address?: Hex;
  recentlyChanged?: boolean;
};

/** Route id for "Let them choose" (recipient picks the brand when opening). */
export const CHOICE_ID = "choice";

export type GiftDetails = {
  brandId: string | null;
  brandName: string;
  amount: string;
  design?: string;
  message?: string;
};

/** Everything the confirm screen needs for one money action. */
export type Draft = {
  request: ActionRequest;
  recipient?: Recipient;
  gift?: GiftDetails;
};

export type Outcome = { draft: Draft; result: ActionResult; title: string };

// Screens pass small ids in params; the objects stay here in memory for the session.
const drafts = new Map<string, Draft>();
const outcomes = new Map<string, Outcome>();
const recipients = new Map<string, Recipient>();
const gifts = new Map<string, GiftDetails>();
const activity = new Map<string, ActivityItem>();

let n = 0;
const nextId = (p: string) => `${p}${Date.now().toString(36)}${(n++).toString(36)}`;

export const putDraft = (d: Draft) => {
  const id = nextId("d");
  drafts.set(id, d);
  return id;
};
export const getDraft = (id: string | undefined) => (id ? drafts.get(id) : undefined);
export const updateDraft = (id: string, d: Draft) => void drafts.set(id, d);

export const putOutcome = (o: Outcome) => {
  const id = nextId("o");
  outcomes.set(id, o);
  return id;
};
export const getOutcome = (id: string | undefined) => (id ? outcomes.get(id) : undefined);

export const putRecipient = (r: Recipient) => {
  const id = nextId("r");
  recipients.set(id, r);
  return id;
};
export const getRecipient = (id: string | undefined) => (id ? recipients.get(id) : undefined);

export const putGift = (g: GiftDetails) => {
  const id = nextId("g");
  gifts.set(id, g);
  return id;
};
export const getGift = (id: string | undefined) => (id ? gifts.get(id) : undefined);

export function rememberActivity(items: ActivityItem[]): void {
  for (const it of items) activity.set(it.id, it);
}
export const activityById = (id: string | undefined) => (id ? activity.get(id) : undefined);

export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/** Share sheet text for a waiting payment or gift. */
export function shareMessage(args: { kind: "money" | "gift"; amount: string; link: string }): string {
  return args.kind === "gift"
    ? `I sent you a ${args.amount} gift card on BilbyPay: ${args.link}`
    : `I sent you ${args.amount} on BilbyPay: ${args.link}`;
}
