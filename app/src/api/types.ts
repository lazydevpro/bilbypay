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
  phoneStatus?: PhoneStatus["status"];
};

export type OtpStartResponse = { ok: true; expiresInSeconds: number };
export type OtpVerifyResponse = { phoneToken: string; phone: string; phoneMasked: string };

export type RegisterRequest = {
  phoneToken: string;
  address: Hex;
  displayName: string;
  issuedAt: number;
  signature: Hex;
  registrationId: string;
  consentSignature: Hex;
};
export type RegisterResponse = { status: "registered" | "pending"; sessionToken: string; profile: Profile | null; availableAt?: string };
export type DirectoryOperation = "bind" | "requestRecovery" | "finalizeRecovery" | "revoke" | "cancelRecovery";
export type DirectoryConsent = {
  id: string;
  operation: DirectoryOperation;
  typedData: TypedDataJson;
  phoneKey: Hex;
  revision: string;
  validUntil?: string;
  availableAt?: string;
};
export type PhoneStatus = {
  status: "active" | "expired" | "revoked" | "pending" | "reassigned" | "unlinked";
  phone: string | null;
  phoneMasked: string | null;
  phoneKey: Hex | null;
  revision: string;
  validUntil: string | null;
  pending: { account: Hex; availableAt: string } | null;
};
export type DirectorySnapshot = {
  phoneKey: Hex;
  revision: string;
  ownershipEpoch: string;
  validUntil: string | null;
  pending: boolean;
};

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
  status: "registered" | "invite" | "invalid" | "unavailable";
  displayName?: string;
  address?: Hex;
  recentlyChanged?: boolean;
  directory?: DirectorySnapshot;
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
  expect: {
    payer: Hex; amount: string; payee?: Hex; directory?: DirectorySnapshot;
    terms?: { phoneKey: Hex; phoneEpoch: string; expiry: number; kind: 0 | 1; giftId: Hex; salt: Hex };
  };
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
  gift?: { brandId: string | null; brandName?: string; brandLogoUrl?: string; brandArtworkUrl?: string; design?: string; message?: string };
  status: "waiting" | "opened" | "returned";
  expiresAt: string;
  phoneMasked: string;
};
export type ClaimAcceptResponse = {
  status: "completed";
  amount: string;
  giftCardId?: string;
  receipt: Receipt;
  /** Gift whose card couldn't be bought: `GIFT_UNAVAILABLE`, and the money went to the balance instead. */
  error?: { code: string; message: string };
};

export type Brand = {
  id: string;
  name: string;
  logoUrl: string;
  /** Complete provider-supplied product/card image; display without cropping. */
  artworkUrl?: string;
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
  artworkUrl?: string;
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
  /** 6-decimal dollars to send, and the same in the origin's own units. */
  amountIn: string;
  amountInBaseUnits: string;
  amountOut: string;
  minAmountOut: string;
  expiresAt: string;
  etaSeconds?: number;
};
export type TopupStatus = {
  status: "waiting" | "processing" | "completed" | "failed" | "refunded";
  message: string;
  amountOut?: string;
  refundedAmount?: string;
};

/** Provider practice checkout. Completion never changes the Bilby balance. */
export type FundingOptions = {
  provider: "ramp";
  environment: "sandbox";
  available: boolean;
  paymentMethods?: ("card" | "apple_pay" | "google_pay")[];
  unavailableReason?: "not_configured" | "provider_unavailable" | "asset_unavailable";
  message?: string;
  country: "US";
  currency: "USD";
  /** Six-decimal dollar amounts, as elsewhere in the API. */
  minAmount: string;
  maxAmount: string;
};
export type FundingSession = {
  id: string;
  environment: "sandbox";
  status: "pending" | "processing" | "completed" | "failed" | "cancelled" | "expired";
  amount: string;
  currency: "USD";
  checkoutUrl?: string;
  createdAt: string;
  updatedAt: string;
  message: string;
  amountReceived?: string;
  fee?: string;
};
export type CreateFundingSession = {
  amount: string;
  returnUrl: string;
  idempotencyKey: string;
};

/** GET /v1/agora/metrics: Agora's public supply figures. Amounts are six-decimal dollar strings. */
export type AgoraNetworkSupply = { network: string; chainId: string; totalSupply: string; circulatingSupply: string };
export type AgoraMetrics = {
  source: "agora";
  /** True when Agora is missing a network; the worldwide totals are then omitted. */
  partial: boolean;
  totalSupply?: string;
  circulatingSupply?: string;
  /** The network BilbyPay balances live on, when Agora lists it. */
  home?: AgoraNetworkSupply;
  networks: AgoraNetworkSupply[];
  fetchedAt: string;
  stale?: boolean;
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
  | "INVALID_REQUEST"
  | "PHONE_REQUIRED"
  | "CONFIRMATION_FAILED"
  | "ALREADY_DONE"
  | "GIFT_PROCESSING"
  | "AMOUNT_TOO_LOW"
  | "NETWORK"
  | (string & {});

/** The one interface both the HTTP client and the in-app demo implement. */
export interface BilbyApi {
  otpStart(phone: string, region?: string): Promise<OtpStartResponse>;
  otpVerify(phone: string, code: string): Promise<OtpVerifyResponse>;
  prepareRegistration(req: { phoneToken: string; address: Hex }): Promise<DirectoryConsent>;
  register(req: RegisterRequest): Promise<RegisterResponse>;
  phoneStatus(): Promise<PhoneStatus>;
  preparePhoneAction(operation: "revoke" | "cancelRecovery"): Promise<DirectoryConsent>;
  submitPhoneAction(req: { id: string; signature: Hex }): Promise<PhoneStatus>;
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
  fundingOptions(): Promise<FundingOptions>;
  createFundingSession(request: CreateFundingSession): Promise<FundingSession>;
  fundingSession(id: string): Promise<FundingSession>;
  /** Public, no session needed. */
  agoraMetrics(): Promise<AgoraMetrics>;
}
