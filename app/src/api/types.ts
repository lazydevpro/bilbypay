import type { TypedDataJson } from "@bilbypay/core";

/** Types mirror docs/api.md exactly. Money is always a string of base units (6 decimals). */

export type Hex = `0x${string}`;

export type Profile = {
  address: Hex;
  displayName: string;
  phone: string;
  phoneMasked: string;
  autoSave: { enabled: boolean; threshold: string };
  createdAt: string;
};

export type OtpStartResponse = { ok: true; expiresInSeconds: number };
export type OtpVerifyResponse = { phoneToken: string; phone: string; phoneMasked: string };

export type RegisterRequest = {
  phoneToken: string;
  address: Hex;
  displayName: string;
  issuedAt: number;
  signature: Hex;
};
export type RegisterResponse = { sessionToken: string; profile: Profile };

export type SessionRequest = { address: Hex; issuedAt: number; signature: Hex };
export type SessionResponse = { sessionToken: string; profile: Profile | null };

export type Balance = {
  balance: string;
  burrow: { amount: string; earned: string; availableNow: string; ratePercent: number };
  pendingOut: string;
};

export type ResolveResult = {
  phone: string;
  e164: string | null;
  status: "registered" | "invite" | "invalid";
  displayName?: string;
  address?: Hex;
  recentlyChanged?: boolean;
};

export type ActionParams = {
  send: { phone: string; amount: string; note?: string };
  gift_send: { phone: string; brandId: string | null; amount: string; message?: string; design?: string };
  gift_buy: { brandId: string; amount: string };
  cancel: { activityId: string };
  burrow_autosave: { enabled: boolean; threshold: string };
  burrow_add: { amount: string };
  burrow_withdraw: { amount: string };
};
export type ActionType = keyof ActionParams;

export type ActionRequest = { [T in ActionType]: { type: T; params: ActionParams[T] } }[ActionType];

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

export type Receipt = {
  reference: string;
  amount: string;
  counterparty?: { name: string; phoneMasked?: string };
  at: string;
  technical?: { txHash: Hex; explorerUrl: string };
};

export type ActionResult = {
  id: string;
  status: "completed" | "waiting" | "failed";
  receipt?: Receipt;
  claimLink?: string;
  giftCardId?: string;
  error?: { code: string; message: string };
};

export type ActivityKind =
  | "sent"
  | "received"
  | "gift_sent"
  | "gift_received"
  | "gift_bought"
  | "burrow_in"
  | "burrow_out"
  | "refund";

export type ActivityItem = {
  id: string;
  kind: ActivityKind;
  status: "completed" | "waiting" | "refunded" | "cancelled" | "failed";
  amount: string;
  counterparty?: { name: string; phoneMasked?: string };
  note?: string;
  giftCardId?: string;
  claimLink?: string;
  canCancel?: boolean;
  expiresAt?: string;
  receipt?: Receipt;
  createdAt: string;
};
export type ActivityPage = { items: ActivityItem[]; nextCursor?: string };

export type Claim = {
  code: string;
  kind: "money" | "gift";
  amount: string;
  senderName: string;
  note?: string;
  gift?: { brandId: string | null; brandName?: string; brandLogoUrl?: string; design?: string; message?: string };
  status: "waiting" | "opened" | "returned";
  expiresAt: string;
  phoneMasked: string;
};
export type ClaimAcceptResponse = { status: "completed"; amount: string; giftCardId?: string; receipt: Receipt };

export type Brand = {
  id: string;
  name: string;
  logoUrl: string;
  category?: string;
  country: string;
  minAmount: string;
  maxAmount: string;
  denominations?: string[];
  feePercent: number;
  available: boolean;
};
export type Quote = { brandId: string; amount: string; price: string; available: boolean };

export type GiftCard = {
  id: string;
  brandId: string;
  brandName: string;
  logoUrl: string;
  amount: string;
  status: "ready" | "processing" | "failed";
  createdAt: string;
  from?: string;
};
export type GiftCardReveal = {
  code?: string;
  pin?: string;
  url?: string;
  barcode?: { format: string; value: string };
  instructions?: string;
};

export type TopupOrigin = { id: string; label: string; symbol: string; networkLabel: string };
export type TopupQuote = {
  quoteId: string;
  depositAddress: string;
  depositMemo?: string;
  originAsset: string;
  amountIn: string;
  /** What to send, in the origin's own units (decimal string of base units). */
  amountInBaseUnits: string;
  amountOut: string;
  minAmountOut: string;
  expiresAt: string;
  etaSeconds?: number;
};
export type TopupStatus = {
  status: "waiting" | "processing" | "completed" | "failed" | "refunded";
  /** Plain-language line from the server. */
  message: string;
  amountOut?: string;
  refundedAmount?: string;
};

/** Error codes from docs/api.md, plus NETWORK for "couldn't reach the server". */
export type ApiErrorCode =
  | "OTP_INVALID"
  | "OTP_EXPIRED"
  | "RATE_LIMITED"
  | "PHONE_INVALID"
  | "SESSION_EXPIRED"
  | "INSUFFICIENT_FUNDS"
  | "BURROW_BUSY"
  | "RECIPIENT_RECENTLY_CHANGED"
  | "ACTION_EXPIRED"
  | "ALREADY_CLAIMED"
  | "CLAIM_EXPIRED"
  | "WRONG_PHONE"
  | "GIFT_UNAVAILABLE"
  | "NOT_FOUND"
  | "INTERNAL"
  | "NETWORK"
  | (string & {});

/** The one interface both the HTTP client and the in-app demo implement. */
export interface BilbyApi {
  otpStart(phone: string, region?: string): Promise<OtpStartResponse>;
  otpVerify(phone: string, code: string): Promise<OtpVerifyResponse>;
  register(req: RegisterRequest): Promise<RegisterResponse>;
  session(req: SessionRequest): Promise<SessionResponse>;
  me(): Promise<Profile>;
  balance(): Promise<Balance>;
  resolve(phones: string[], region?: string): Promise<{ results: ResolveResult[] }>;
  prepareAction(req: ActionRequest): Promise<PreparedAction>;
  submitAction(id: string, signatures: Record<string, Hex>): Promise<ActionResult>;
  activity(cursor?: string): Promise<ActivityPage>;
  claim(code: string): Promise<Claim>;
  acceptClaim(code: string, body: { phoneToken: string; brandId?: string }): Promise<ClaimAcceptResponse>;
  catalog(country?: string): Promise<{ brands: Brand[] }>;
  quote(brandId: string, amount: string): Promise<Quote>;
  giftCards(): Promise<{ cards: GiftCard[] }>;
  revealGiftCard(id: string): Promise<GiftCardReveal>;
  topupOrigins(): Promise<{ origins: TopupOrigin[] }>;
  topupQuote(originAsset: string, amount: string): Promise<TopupQuote>;
  topupStatus(quoteId: string): Promise<TopupStatus>;
}
