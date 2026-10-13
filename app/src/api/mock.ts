import {
  authorizationTypedData,
  cancelTypedData,
  type Deployment,
  getNetwork,
  hydrateTypedData,
  newAuthorization,
  permitTypedData,
  serializeTypedData,
  setAutoSaveTypedData,
  type TokenInfo,
  escrowTermsNonce,
} from "@bilbypay/core";
import { keccak256, toHex, verifyMessage, verifyTypedData, zeroAddress } from "viem";
import { directoryTypedData } from "../signing/directory";
import type { BindingRead, DirectoryReader } from "../directory/verification";
import { firstName } from "../flows/drafts";
import { registerMessage, sessionMessage } from "../signing/messages";
import { ApiError } from "./errors";
import type {
  ActionRequest,
  ActionResult,
  ActivityItem,
  Balance,
  BilbyApi,
  Brand,
  Claim,
  GiftCard,
  GiftCardReveal,
  Hex,
  PreparedAction,
  Profile,
  ResolveResult,
  DirectoryConsent,
  DirectoryOperation,
  DirectorySnapshot,
  PhoneStatus,
} from "./types";

/**
 * In-app demo implementation of docs/api.md (EXPO_PUBLIC_API_URL=mock). Everything lives in memory,
 * with a small delay so the UI behaves like it does against the real server. Authorizations are really
 * produced by the account key and verified here, so the demo exercises the same code path as production.
 */

export type MockApiOptions = {
  getToken: () => string | null;
  onSessionExpired?: () => void;
  onPhoneRequired?: () => void;
  chainId?: number;
  delayMs?: number;
  /** Starting balance for new accounts, in base units. */
  startingBalance?: bigint;
  now?: () => number;
};

const USD = 1_000_000n;
const D = (dollars: number) => BigInt(Math.round(dollars * 100)) * 10_000n;

const FAKE_DEPLOYMENT = (chainId: number): Deployment => ({
  chainId,
  ausd: "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a",
  stata: "0x9e1AcC5BFbf34e2E579763cE14042d957719fE76",
  directory: "0x00000000000000000000000000000000000b11b1",
  escrow: "0x00000000000000000000000000000000000b11b2",
  router: "0x00000000000000000000000000000000000b11b3",
});
const TREASURY: Hex = "0x00000000000000000000000000000000000b11b4";

const SEEDED_PEOPLE: { phone: string; name: string; address: Hex; recentlyChanged?: boolean }[] = [
  { phone: "+15555550101", name: "Maya Chen", address: "0x1111111111111111111111111111111111111111" },
  { phone: "+15555550102", name: "Arjun Rao", address: "0x2222222222222222222222222222222222222222" },
  { phone: "+15555550103", name: "Sam Okafor", address: "0x3333333333333333333333333333333333333333", recentlyChanged: true },
];

// Demo-only merchant designs, unchanged from official sources. Production uses provider artworkUrl.
// Sources and display rules: docs/research/gift-card-brand-guidelines.md.
export const MOCK_BRANDS: Brand[] = [
  { id: "starbucks-us", name: "Starbucks", logoUrl: "", artworkUrl: "https://globalassets.starbucks.com/digitalassets/cards/fy25/CafeFY25.png", category: "Food & drink", country: "US", minAmount: String(5n * USD), maxAmount: String(100n * USD), feePercent: 2.5, available: true },
  { id: "uber-us", name: "Uber", logoUrl: "", artworkUrl: "https://tb-static.uber.com/prod/gifting/gift-card-artworks/hero_1.png", category: "Travel", country: "US", minAmount: String(15n * USD), maxAmount: String(200n * USD), denominations: [String(15n * USD), String(25n * USD), String(50n * USD), String(100n * USD)], feePercent: 3, available: true },
  { id: "doordash-us", name: "DoorDash", logoUrl: "", artworkUrl: "https://doordash-static.s3.amazonaws.com/media/photosV2/5289616c-80ae-4213-9139-fb8934df93d9-retina-large-variant-1.png", category: "Food & drink", country: "US", minAmount: String(10n * USD), maxAmount: String(200n * USD), feePercent: 3, available: true },
  { id: "target-us", name: "Target", logoUrl: "", artworkUrl: "https://tgt-files.target.com/images/4324_B2B_Bullseye_Icons.jpg", category: "Shopping", country: "US", minAmount: String(10n * USD), maxAmount: String(500n * USD), feePercent: 2, available: true },
  { id: "amazon-us", name: "Amazon.com", logoUrl: "", artworkUrl: "https://cdn.bitrefill.com/primg/w600h400/amazon_com-usa.png", category: "Shopping", country: "US", minAmount: String(5n * USD), maxAmount: String(500n * USD), feePercent: 2, available: true },
  { id: "airbnb-us", name: "Airbnb", logoUrl: "", artworkUrl: "https://cdn.bitrefill.com/primg/w600h400/airbnb-usa.png", category: "Travel", country: "US", minAmount: String(25n * USD), maxAmount: String(500n * USD), feePercent: 3, available: false },
];

// glossary-allow (demo list of places money can come from; shown only on the add-money screen)
const TOPUP_ORIGINS = [
  { id: "base:usdc", label: "USDC on Base", symbol: "USDC", networkLabel: "Base" }, // glossary-allow
  { id: "arb:usdc", label: "USDC on Arbitrum", symbol: "USDC", networkLabel: "Arbitrum" }, // glossary-allow
  { id: "sol:usdc", label: "USDC on Solana", symbol: "USDC", networkLabel: "Solana" }, // glossary-allow
];

type Account = {
  profile: Profile | null;
  balance: bigint;
  burrow: bigint;
  deposited: bigint;
  activity: ActivityItem[];
  cards: (GiftCard & { secret: GiftCardReveal })[];
};

type PendingAction = {
  prepared: PreparedAction;
  request: ActionRequest;
  owner: Hex;
  result?: ActionResult;
  meta: { payee?: Hex; e164?: string; name?: string; phoneMasked?: string; shortfall: bigint };
};

type ClaimRecord = Claim & { phone: string; sender: Hex; activityId: string; phoneEpoch: string };
type DirectoryRecord = {
  address: Hex; name: string; reboundAt?: number; revision: bigint; epoch: bigint; validUntil: number; revoked: boolean;
  pending?: { account: Hex; availableAt: number; expiresAt: number };
};

const rand = (n: number) => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < n; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
};
const reference = () => `BP-${rand(4)}-${rand(4)}`;
const fakeHash = (seed: string) => keccak256(toHex(seed));

export function maskPhone(e164: string): string {
  const digits = e164.replace(/\D/g, "");
  const cc = e164.startsWith("+1") ? "1" : digits.slice(0, Math.max(1, digits.length - 10));
  return `+${cc} •••• ${digits.slice(-4)}`;
}

/** Very small E.164 normaliser for the demo (the real server uses libphonenumber-js). */
function normalise(phone: string, region?: string): string | null {
  const trimmed = phone.replace(/[^\d+]/g, "");
  if (trimmed.startsWith("+")) return /^\+\d{8,15}$/.test(trimmed) ? trimmed : null;
  const digits = trimmed.replace(/\D/g, "");
  if ((region ?? "US") === "US" && digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

export function createMockApi(opts: MockApiOptions): BilbyApi & { readDirectory: DirectoryReader } {
  const chainId = opts.chainId ?? 143;
  const delayMs = opts.delayMs ?? 300;
  const now = opts.now ?? (() => Date.now());
  const deployment = FAKE_DEPLOYMENT(chainId);
  const network = getNetwork(chainId === 143 || chainId === 10143 ? chainId : 143);
  const ausd: TokenInfo = { ...network.ausd, address: deployment.ausd };
  const stata: TokenInfo = network.stata ?? { address: deployment.stata, decimals: 6, domainName: "Wrapped Aave Monad AUSD", domainVersion: "1" }; // glossary-allow (EIP-712 domain name)

  const accounts = new Map<string, Account>();
  const sessions = new Map<string, Hex>();
  const phoneTokens = new Map<string, { phone: string; expires: number; verifiedAt: number }>();
  const directory = new Map<string, DirectoryRecord>();
  const consents = new Map<string, { prepared: DirectoryConsent; phone: string; owner: Hex; used: boolean }>();
  const latestPhone = new Map<string, string>();
  const actions = new Map<string, PendingAction>();
  const claims = new Map<string, ClaimRecord>();
  let autoSaveNonce = 0n;
  const topups = new Map<string, { owner: Hex; amountOut: bigint; created: number; credited: boolean }>();

  for (const p of SEEDED_PEOPLE) {
    directory.set(p.phone, { address: p.address, name: p.name, reboundAt: p.recentlyChanged ? now() : undefined, revision: 1n, epoch: 0n, validUntil: now() + 365 * 86400_000, revoked: false });
  }
  // A waiting gift for the demo number so the claim flow can be tried from a link: bilbypay://claim/DEMO
  claims.set("DEMO", {
    code: "DEMO",
    kind: "money",
    amount: String(20n * USD),
    senderName: "Arjun",
    note: "Dinner last night 🍜",
    status: "waiting",
    expiresAt: new Date(now() + 14 * 86400_000).toISOString(),
    phoneMasked: maskPhone("+15555550123"),
    phone: "+15555550123",
    sender: SEEDED_PEOPLE[1]!.address,
    activityId: "seed",
    phoneEpoch: "0",
  });

  const wait = <T>(value: () => T): Promise<T> =>
    new Promise((resolve, reject) =>
      setTimeout(() => {
        try {
          resolve(value());
        } catch (e) {
          reject(e);
        }
      }, delayMs),
    );
  const waitAsync = async <T>(fn: () => Promise<T>): Promise<T> => {
    await new Promise((r) => setTimeout(r, delayMs));
    return fn();
  };

  const account = (address: Hex): Account => {
    const key = address.toLowerCase();
    let a = accounts.get(key);
    if (!a) {
      a = { profile: null, balance: opts.startingBalance ?? D(250), burrow: 0n, deposited: 0n, activity: [], cards: [] };
      accounts.set(key, a);
    }
    return a;
  };

  const authed = (): { address: Hex; acct: Account } => {
    const token = opts.getToken();
    const address = token ? sessions.get(token) : undefined;
    if (!address) {
      opts.onSessionExpired?.();
      throw new ApiError("SESSION_EXPIRED", "Please unlock BilbyPay with Face ID to continue.", 401);
    }
    return { address, acct: account(address) };
  };

  const profileOf = (acct: Account): Profile => {
    if (!acct.profile) {
      opts.onPhoneRequired?.();
      throw new ApiError("PHONE_REQUIRED", "Add your phone number to continue.", 403);
    }
    acct.profile.phoneStatus = phoneStatusOf(acct.profile.address).status;
    return acct.profile;
  };
  /** Signed in and has a number (the server answers PHONE_REQUIRED otherwise). */
  const registered = () => {
    const a = authed();
    profileOf(a.acct);
    return a;
  };

  const newSession = (address: Hex) => {
    const token = `mock-${rand(16)}`;
    sessions.set(token, address);
    return token;
  };

  const livePending = (entry: DirectoryRecord | undefined) => entry?.pending && entry.pending.expiresAt >= now() ? entry.pending : undefined;
  const active = (entry: DirectoryRecord | undefined) => !!entry && !entry.revoked && entry.validUntil > now() && !livePending(entry);
  const snapshot = (phone: string): DirectorySnapshot => {
    const entry = directory.get(phone);
    return { phoneKey: fakeHash(phone), revision: String(entry?.revision ?? 0n), ownershipEpoch: String(entry?.epoch ?? 0n), validUntil: entry ? new Date(entry.validUntil).toISOString() : null, pending: !!livePending(entry) };
  };
  const unavailable = () => new ApiError("PHONE_UNAVAILABLE", "This number can't receive payments right now. Ask your friend to check their number.", 409);
  const phoneStatusOf = (address: Hex): PhoneStatus => {
    const acct = account(address);
    const pendingPhone = latestPhone.get(address.toLowerCase());
    const phone = pendingPhone && livePending(directory.get(pendingPhone))?.account.toLowerCase() === address.toLowerCase() ? pendingPhone : acct.profile?.phone ?? pendingPhone;
    const entry = phone ? directory.get(phone) : undefined;
    const pending = livePending(entry);
    const own = entry?.address.toLowerCase() === address.toLowerCase();
    const status: PhoneStatus["status"] = pending ? "pending" : !entry ? "unlinked" : !own ? "reassigned" : entry.revoked ? "revoked" : entry.validUntil <= now() ? "expired" : "active";
    return { status, phone: phone ?? null, phoneMasked: phone ? maskPhone(phone) : null, phoneKey: phone ? fakeHash(phone) : null, revision: String(entry?.revision ?? 0n), validUntil: entry ? new Date(entry.validUntil).toISOString() : null, pending: pending ? { account: pending.account, availableAt: new Date(pending.availableAt).toISOString() } : null };
  };
  const makeConsent = (phone: string, owner: Hex, operation: DirectoryOperation): DirectoryConsent => {
    const seconds = Math.floor(now() / 1000);
    const entry = directory.get(phone);
    const revision = String(entry?.revision ?? 0n);
    const validUntil = seconds + 365 * 86400;
    const message: Record<string, unknown> = { phoneKey: fakeHash(phone), expectedRevision: BigInt(revision), deadline: BigInt(seconds + 600) };
    if (operation !== "revoke" && operation !== "cancelRecovery") Object.assign(message, { account: owner, issuedAt: BigInt(seconds), validUntil: BigInt(validUntil) });
    const prepared: DirectoryConsent = { id: `dir_${rand(12)}`, operation, phoneKey: fakeHash(phone), revision, typedData: directoryTypedData(chainId, deployment.directory, operation, message), validUntil: new Date(validUntil * 1000).toISOString(), ...(operation === "requestRecovery" ? { availableAt: new Date(now() + 7 * 86400_000).toISOString() } : {}) };
    consents.set(prepared.id, { prepared, phone, owner, used: false });
    return JSON.parse(JSON.stringify(prepared));
  };
  const checkConsent = async (id: string, owner: Hex, signature: Hex) => {
    const record = consents.get(id);
    if (!record || record.used || record.owner.toLowerCase() !== owner.toLowerCase()) throw new ApiError("INVALID_REQUEST", "These details are no longer current. Please start again.", 409);
    const entry = directory.get(record.phone);
    const td = hydrateTypedData(record.prepared.typedData);
    if (String(entry?.revision ?? 0n) !== record.prepared.revision || BigInt(String(td.message.deadline)) <= BigInt(Math.floor(now() / 1000))) throw new ApiError("ACTION_EXPIRED", "These details changed. Please start again.", 409);
    if (!await verifyTypedData({ ...td, address: owner, signature })) throw new ApiError("INVALID_REQUEST", "We couldn't confirm it's you. Please try again.", 401);
    return record;
  };

  const earned = (acct: Account) => (acct.burrow > acct.deposited ? acct.burrow - acct.deposited : 0n);
  const availableNow = (acct: Account) => (acct.burrow < D(500) ? acct.burrow : D(500));

  const sweep = (acct: Account) => {
    const p = acct.profile;
    if (!p?.autoSave.enabled) return;
    const threshold = BigInt(p.autoSave.threshold);
    if (acct.balance > threshold) {
      const extra = acct.balance - threshold;
      acct.balance -= extra;
      acct.burrow += extra;
      acct.deposited += extra;
      acct.activity.unshift(item("burrow_in", "completed", extra, { note: "Auto-save" }));
    }
  };

  const item = (
    kind: ActivityItem["kind"],
    status: ActivityItem["status"],
    amount: bigint,
    extra: Partial<ActivityItem> = {},
  ): ActivityItem => {
    const at = new Date(now()).toISOString();
    return {
      id: `act_${rand(10)}`,
      kind,
      status,
      amount: amount.toString(),
      createdAt: at,
      receipt: {
        reference: reference(),
        amount: amount.toString(),
        counterparty: extra.counterparty,
        at,
        technical: { txHash: fakeHash(at + kind + Math.random()), explorerUrl: "https://monadvision.com" },
      },
      ...extra,
    };
  };

  const auth = (kind: "TransferWithAuthorization" | "ReceiveWithAuthorization", from: Hex, to: Hex, value: bigint, nonce?: Hex) =>
    serializeTypedData(authorizationTypedData(kind, ausd, chainId, { ...newAuthorization({ from, to, value, now: Math.floor(now() / 1000) }), ...(nonce ? { nonce } : {}) }));

  const termsFor = (phone: string, kind: 0 | 1): NonNullable<PreparedAction["expect"]["terms"]> => ({ phoneKey: fakeHash(phone), phoneEpoch: snapshot(phone).ownershipEpoch, expiry: Math.floor(now() / 1000) + 14 * 86400, kind, giftId: kind ? fakeHash(rand(12)) : `0x${"0".repeat(64)}`, salt: fakeHash(rand(12)) });
  const termsNonce = (terms: NonNullable<PreparedAction["expect"]["terms"]>) => escrowTermsNonce({ ...terms, phoneEpoch: BigInt(terms.phoneEpoch) });

  const burrowPermit = (owner: Hex, assets: bigint) =>
    serializeTypedData(
      permitTypedData(stata, chainId, {
        owner,
        spender: deployment.router,
        value: assets + assets / 1000n,
        nonce: 0n,
        deadline: BigInt(Math.floor(now() / 1000) + 600),
      }),
    );

  const summary = (title: string, total: bigint, fromBurrow: bigint, lines: { label: string; value: string }[] = [], warnings: PreparedAction["summary"]["warnings"] = []) => ({
    title,
    lines,
    total: total.toString(),
    fromBurrow: fromBurrow.toString(),
    warnings,
  });

  const fmt = (v: bigint) => {
    const cents = v / 10_000n;
    return `$${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
  };

  /** Checks the total is coverable and works out how much must come from Burrow. */
  const fund = (acct: Account, total: bigint): bigint => {
    if (total <= acct.balance) return 0n;
    const shortfall = total - acct.balance;
    if (shortfall > acct.burrow) {
      throw new ApiError("INSUFFICIENT_FUNDS", `You have ${fmt(acct.balance + acct.burrow)} in total. Try a smaller amount.`, 400);
    }
    if (shortfall > availableNow(acct)) {
      throw new ApiError(
        "BURROW_BUSY",
        `Some of your Burrow money is busy right now — you can pay up to ${fmt(acct.balance + availableNow(acct))} now.`,
        409,
        { availableNow: (acct.balance + availableNow(acct)).toString() },
      );
    }
    return shortfall;
  };

  const burrowLines = (acct: Account, fromBurrow: bigint) =>
    fromBurrow > 0n
      ? [
          { label: "From your balance", value: fmt(acct.balance) },
          { label: "From Burrow", value: fmt(fromBurrow) },
        ]
      : [];

  const prepare = (req: ActionRequest): PreparedAction & { meta: PendingAction["meta"] } => {
    const { address, acct } = registered();
    const id = `act_${rand(12)}`;
    const expiresAt = new Date(now() + 10 * 60_000).toISOString();
    const expect = (amount: bigint, payee?: Hex) => ({ payer: address, amount: amount.toString(), ...(payee ? { payee } : {}) });
    const base = { id, type: req.type, expiresAt };

    switch (req.type) {
      case "send": {
        const amount = BigInt(req.params.amount);
        if (amount <= 0n) throw new ApiError("INVALID_AMOUNT", "Enter an amount above $0.", 400);
        const e164 = normalise(req.params.phone);
        if (!e164) throw new ApiError("PHONE_INVALID", "That number doesn't look right. Check it and try again.", 400);
        const fromBurrow = fund(acct, amount);
        const entry = directory.get(e164);
        if (entry && !active(entry)) throw unavailable();
        const warnings = entry?.reboundAt
          ? [{ code: "RECIPIENT_RECENTLY_CHANGED", message: `This number moved to a new BilbyPay account recently. Only continue if you've checked with ${firstName(entry.name)} another way.` }]
          : [];
        const payee = entry?.address;
        const name = entry?.name ?? formatForTitle(e164);
        const terms = payee ? undefined : termsFor(e164, 0);
        const toSign: PreparedAction["toSign"] = [
          { key: "payment", typedData: payee ? auth("TransferWithAuthorization", address, payee, amount) : auth("ReceiveWithAuthorization", address, deployment.escrow, amount, termsNonce(terms!)) },
        ];
        if (fromBurrow > 0n) toSign.push({ key: "burrowPermit", typedData: burrowPermit(address, fromBurrow) });
        const lines = [...burrowLines(acct, fromBurrow), ...(req.params.note ? [{ label: "Note", value: req.params.note }] : [])];
        if (!payee) lines.push({ label: "How it works", value: "They get a link. If they don't open it in 14 days, it comes back to you." });
        return {
          ...base,
          summary: summary(`Send ${fmt(amount)} to ${firstName(name)}`, amount, fromBurrow, lines, warnings),
          toSign,
          expect: { ...expect(amount, payee), directory: snapshot(e164), terms },
          meta: { payee, e164, name, phoneMasked: maskPhone(e164), shortfall: fromBurrow },
        };
      }
      case "gift_send":
      case "gift_buy": {
        const amount = BigInt(req.params.amount);
        const brand = req.params.brandId ? MOCK_BRANDS.find((b) => b.id === req.params.brandId) : null;
        if (req.params.brandId && !brand) throw new ApiError("NOT_FOUND", "We couldn't find that gift card. Pick another one.", 404);
        if (brand && !brand.available) throw new ApiError("GIFT_UNAVAILABLE", `${brand.name} cards are unavailable right now. Pick another brand?`, 409);
        const fee = brand ? (amount * BigInt(Math.round(brand.feePercent * 100))) / 10_000n : (amount * 300n) / 10_000n;
        const price = amount + fee;
        const fromBurrow = fund(acct, price);
        const lines = [{ label: "Gift card", value: `${brand?.name ?? "Their choice"} · ${fmt(amount)}` }, { label: "Service fee", value: fmt(fee) }, ...burrowLines(acct, fromBurrow)];
        if (req.type === "gift_send") {
          const e164 = normalise(req.params.phone);
          if (!e164) throw new ApiError("PHONE_INVALID", "That number doesn't look right. Check it and try again.", 400);
          const entry = directory.get(e164);
          if (entry && !active(entry)) throw unavailable();
          const name = entry?.name ?? formatForTitle(e164);
          const terms = termsFor(e164, 1);
          const toSign: PreparedAction["toSign"] = [{ key: "payment", typedData: auth("ReceiveWithAuthorization", address, deployment.escrow, price, termsNonce(terms)) }];
          if (fromBurrow > 0n) toSign.push({ key: "burrowPermit", typedData: burrowPermit(address, fromBurrow) });
          return {
            ...base,
            summary: summary(`Send a ${fmt(amount)} ${brand?.name ?? ""} gift card to ${firstName(name)}`.replace("  ", " "), price, fromBurrow, lines),
            toSign,
            expect: { ...expect(price), directory: snapshot(e164), terms },
            meta: { e164, name, phoneMasked: maskPhone(e164), shortfall: fromBurrow },
          };
        }
        const toSign: PreparedAction["toSign"] = [{ key: "payment", typedData: auth("TransferWithAuthorization", address, TREASURY, price) }];
        if (fromBurrow > 0n) toSign.push({ key: "burrowPermit", typedData: burrowPermit(address, fromBurrow) });
        return {
          ...base,
          summary: summary(`Buy a ${fmt(amount)} ${brand!.name} gift card`, price, fromBurrow, lines),
          toSign,
          expect: expect(price),
          meta: { shortfall: fromBurrow },
        };
      }
      case "cancel": {
        const it = acct.activity.find((a) => a.id === req.params.activityId);
        if (!it || !it.canCancel) throw new ApiError("NOT_FOUND", "This payment can't be cancelled anymore.", 404);
        return {
          ...base,
          summary: summary(`Cancel and get ${fmt(BigInt(it.amount))} back`, 0n, 0n, [{ label: "Returns to", value: "Your balance" }]),
          toSign: [
            {
              key: "cancel",
              typedData: serializeTypedData(cancelTypedData(deployment, { depositId: fakeHash(it.id), deadline: BigInt(Math.floor(now() / 1000) + 600) })),
            },
          ],
          expect: expect(0n),
          meta: { shortfall: 0n },
        };
      }
      case "burrow_autosave": {
        const threshold = BigInt(req.params.threshold);
        const deadline = BigInt(Math.floor(now() / 1000) + 600);
        return {
          ...base,
          summary: summary(
            req.params.enabled ? `Keep ${fmt(threshold)} in your balance` : "Turn off auto-save",
            0n,
            0n,
            req.params.enabled ? [{ label: "Everything above", value: `${fmt(threshold)} goes into Burrow` }] : [],
          ),
          toSign: [
            { key: "autoSave", typedData: serializeTypedData(setAutoSaveTypedData(deployment, { user: address, enabled: req.params.enabled, threshold, nonce: autoSaveNonce, deadline })) },
            {
              key: "ausdPermit",
              typedData: serializeTypedData(
                permitTypedData(ausd, chainId, { owner: address, spender: deployment.router, value: req.params.enabled ? 2n ** 256n - 1n : 0n, nonce: 0n, deadline }),
              ),
            },
          ],
          expect: expect(0n),
          meta: { shortfall: 0n },
        };
      }
      case "burrow_add": {
        const amount = BigInt(req.params.amount);
        if (amount > acct.balance) throw new ApiError("INSUFFICIENT_FUNDS", `You have ${fmt(acct.balance)} in your balance. Try a smaller amount.`, 400);
        return {
          ...base,
          summary: summary(`Add ${fmt(amount)} to Burrow`, amount, 0n),
          toSign: [{ key: "payment", typedData: auth("ReceiveWithAuthorization", address, deployment.router, amount) }],
          expect: expect(amount),
          meta: { shortfall: 0n },
        };
      }
      case "burrow_withdraw": {
        const amount = BigInt(req.params.amount);
        if (amount > acct.burrow) throw new ApiError("INSUFFICIENT_FUNDS", `You have ${fmt(acct.burrow)} in Burrow.`, 400);
        if (amount > availableNow(acct)) {
          throw new ApiError("BURROW_BUSY", `Some of your Burrow money is busy right now — you can move ${fmt(availableNow(acct))} now.`, 409, {
            availableNow: availableNow(acct).toString(),
          });
        }
        return {
          ...base,
          summary: summary(`Move ${fmt(amount)} to your balance`, amount, amount),
          toSign: [{ key: "burrowPermit", typedData: burrowPermit(address, amount) }],
          expect: expect(amount),
          meta: { shortfall: amount },
        };
      }
    }
  };

  const execute = (p: PendingAction): ActionResult => {
    const acct = account(p.owner);
    const { request: req, prepared } = p;
    const total = BigInt(prepared.summary.total);
    const fromBurrow = BigInt(prepared.summary.fromBurrow);
    const counterparty = p.meta.name ? { name: p.meta.name, phoneMasked: p.meta.phoneMasked } : undefined;
    const pay = () => {
      if (fromBurrow > acct.burrow || total - fromBurrow > acct.balance) {
        throw new ApiError("INSUFFICIENT_FUNDS", "Your balance changed. Check it and try again.", 400);
      }
      acct.burrow -= fromBurrow;
      acct.deposited = acct.deposited > fromBurrow ? acct.deposited - fromBurrow : 0n;
      acct.balance -= total - fromBurrow;
    };

    switch (req.type) {
      case "send":
      case "gift_send": {
        pay();
        const isGift = req.type === "gift_send";
        if (req.type === "send" && p.meta.payee) {
          const it = item("sent", "completed", total, { counterparty, note: req.params.note });
          acct.activity.unshift(it);
          const recipient = accounts.get(p.meta.payee.toLowerCase());
          if (recipient) {
            recipient.balance += total;
            recipient.activity.unshift(item("received", "completed", total, { counterparty: { name: acct.profile?.displayName ?? "A friend" }, note: req.params.note }));
            sweep(recipient);
          }
          return { id: prepared.id, status: "completed", receipt: it.receipt };
        }
        const code = rand(8);
        const claimLink = `https://bilbypay.com/c/${code}`;
        const expiresAt = new Date(now() + 14 * 86400_000).toISOString();
        const it = item(isGift ? "gift_sent" : "sent", "waiting", total, {
          counterparty,
          note: req.type === "send" ? req.params.note : req.params.message,
          claimLink,
          canCancel: true,
          expiresAt,
        });
        acct.activity.unshift(it);
        const brand = req.type === "gift_send" && req.params.brandId ? MOCK_BRANDS.find((b) => b.id === req.params.brandId) : undefined;
        claims.set(code, {
          code,
          kind: isGift ? "gift" : "money",
          amount: req.type === "gift_send" ? req.params.amount : total.toString(),
          senderName: acct.profile?.displayName.split(" ")[0] ?? "A friend",
          note: req.type === "send" ? req.params.note : undefined,
          gift:
            req.type === "gift_send"
              ? { brandId: req.params.brandId, brandName: brand?.name, brandLogoUrl: brand?.logoUrl, brandArtworkUrl: brand?.artworkUrl, design: req.params.design, message: req.params.message }
              : undefined,
          status: "waiting",
          expiresAt,
          phoneMasked: p.meta.phoneMasked ?? "",
          phone: p.meta.e164 ?? "",
          sender: p.owner,
          activityId: it.id,
          phoneEpoch: p.prepared.expect.directory?.ownershipEpoch ?? "0",
        });
        return { id: prepared.id, status: "waiting", receipt: it.receipt, claimLink };
      }
      case "gift_buy": {
        const brand = MOCK_BRANDS.find((b) => b.id === req.params.brandId)!;
        pay();
        const card = makeCard(brand, BigInt(req.params.amount));
        acct.cards.unshift(card);
        const it = item("gift_bought", "completed", total, { counterparty: { name: brand.name }, giftCardId: card.id });
        acct.activity.unshift(it);
        return { id: prepared.id, status: "completed", receipt: it.receipt, giftCardId: card.id };
      }
      case "cancel": {
        const it = acct.activity.find((a) => a.id === req.params.activityId);
        if (!it || it.status !== "waiting") throw new ApiError("ALREADY_CLAIMED", "This was already opened, so it can't be cancelled.", 409);
        it.status = "cancelled";
        it.canCancel = false;
        it.claimLink = undefined;
        acct.balance += BigInt(it.amount);
        for (const c of claims.values()) if (c.activityId === it.id) c.status = "returned";
        const refund = item("refund", "completed", BigInt(it.amount), { counterparty: it.counterparty });
        acct.activity.unshift(refund);
        return { id: prepared.id, status: "completed", receipt: refund.receipt };
      }
      case "burrow_autosave": {
        autoSaveNonce += 1n;
        const profile = profileOf(acct);
        profile.autoSave = { enabled: req.params.enabled, threshold: req.params.threshold };
        sweep(acct);
        return { id: prepared.id, status: "completed" };
      }
      case "burrow_add": {
        pay();
        acct.burrow += total;
        acct.deposited += total;
        const it = item("burrow_in", "completed", total);
        acct.activity.unshift(it);
        return { id: prepared.id, status: "completed", receipt: it.receipt };
      }
      case "burrow_withdraw": {
        const amount = BigInt(req.params.amount);
        if (amount > availableNow(acct)) {
          throw new ApiError("BURROW_BUSY", "Some of your Burrow money is busy right now. Try a smaller amount.", 409, { availableNow: availableNow(acct).toString() });
        }
        acct.burrow -= amount;
        acct.deposited = acct.deposited > amount ? acct.deposited - amount : 0n;
        acct.balance += amount;
        const it = item("burrow_out", "completed", amount);
        acct.activity.unshift(it);
        return { id: prepared.id, status: "completed", receipt: it.receipt };
      }
    }
  };

  const makeCard = (brand: Brand, amount: bigint, from?: string): GiftCard & { secret: GiftCardReveal } => ({
    id: `gc_${rand(10)}`,
    brandId: brand.id,
    brandName: brand.name,
    logoUrl: brand.logoUrl,
    artworkUrl: brand.artworkUrl,
    amount: amount.toString(),
    status: "ready",
    createdAt: new Date(now()).toISOString(),
    from,
    secret: {
      code: `${rand(4)}-${rand(4)}-${rand(4)}-${rand(4)}`,
      pin: String(Math.floor(1000 + Math.random() * 9000)),
      url: `https://example.com/redeem/${brand.id}`,
      barcode: { format: brand.id.startsWith("starbucks") ? "QR" : "CODE128", value: `6${Math.floor(Math.random() * 1e15).toString().padStart(15, "0")}` },
      instructions: `Show the barcode at any ${brand.name} or use the code in the ${brand.name} app.`,
    },
  });

  return {
    otpStart: (phone, region) =>
      wait(() => {
        if (!normalise(phone, region)) throw new ApiError("PHONE_INVALID", "That number doesn't look right. Check it and try again.", 400);
        return { ok: true as const, expiresInSeconds: 600 };
      }),

    otpVerify: (phone, code) =>
      wait(() => {
        const e164 = normalise(phone);
        if (!e164) throw new ApiError("PHONE_INVALID", "That number doesn't look right. Check it and try again.", 400);
        if (code !== "000000") throw new ApiError("OTP_INVALID", "That code didn't match. Check the text message and try again.", 400);
        const phoneToken = `pt_${rand(16)}`;
        phoneTokens.set(phoneToken, { phone: e164, expires: now() + 15 * 60_000, verifiedAt: now() });
        return { phoneToken, phone: e164, phoneMasked: maskPhone(e164) };
      }),

    prepareRegistration: (req) => wait(() => {
      const pt = phoneTokens.get(req.phoneToken);
      if (!pt || pt.expires <= now()) throw new ApiError("OTP_EXPIRED", "Please verify your number again.", 400);
      for (const [phone, entry] of directory) if (phone !== pt.phone && entry.address.toLowerCase() === req.address.toLowerCase() && !entry.revoked) throw new ApiError("PHONE_ALREADY_LINKED", "Stop receiving on your old number before linking a different one.", 409);
      const entry = directory.get(pt.phone);
      const pending = livePending(entry);
      if (pending) {
        if (pending.account.toLowerCase() !== req.address.toLowerCase() || now() < pending.availableAt) throw new ApiError("PHONE_CHANGE_PENDING", "This number change is still waiting. Check Your number for the date you can finish.", 409, { availableAt: new Date(pending.availableAt).toISOString() });
        if (pt.verifiedAt < pending.availableAt) throw new ApiError("OTP_EXPIRED", "Please verify your number again now that the waiting period has ended.", 400);
        return makeConsent(pt.phone, req.address, "finalizeRecovery");
      }
      return makeConsent(pt.phone, req.address, !entry || entry.address.toLowerCase() === req.address.toLowerCase() ? "bind" : "requestRecovery");
    }),

    register: (req) => waitAsync(async () => {
      const pt = phoneTokens.get(req.phoneToken);
      if (!pt || pt.expires <= now()) throw new ApiError("OTP_EXPIRED", "Please verify your number again.", 400);
      if (Math.abs(Math.floor(now() / 1000) - req.issuedAt) > 300 || !await verifyMessage({ address: req.address, message: registerMessage(pt.phone, req.address, req.issuedAt), signature: req.signature })) throw new ApiError("INVALID_REQUEST", "We couldn't confirm it's you. Please try again.", 401);
      const record = await checkConsent(req.registrationId, req.address, req.consentSignature);
      if (record.phone !== pt.phone || ["revoke", "cancelRecovery"].includes(record.prepared.operation)) throw new ApiError("INVALID_REQUEST", "Check your number and try again.", 400);
      const acct = account(req.address);
      const previous = directory.get(pt.phone);
      const revision = (previous?.revision ?? 0n) + 1n;
      latestPhone.set(req.address.toLowerCase(), pt.phone);
      if (record.prepared.operation === "requestRecovery") {
        if (!previous || previous.address.toLowerCase() === req.address.toLowerCase() || livePending(previous)) throw new ApiError("ACTION_EXPIRED", "These details changed. Please start again.", 409);
        previous.revision = revision;
        previous.pending = { account: req.address, availableAt: now() + 7 * 86400_000, expiresAt: now() + 14 * 86400_000 };
        record.used = true;
        return { status: "pending" as const, sessionToken: newSession(req.address), profile: acct.profile, availableAt: new Date(previous.pending.availableAt).toISOString() };
      }
      if (record.prepared.operation === "finalizeRecovery") {
        const pending = livePending(previous);
        if (!pending || pending.account.toLowerCase() !== req.address.toLowerCase() || pending.availableAt > now()) throw new ApiError("PHONE_CHANGE_PENDING", "This number change is still waiting.", 409);
      }
      directory.set(pt.phone, { address: req.address, name: req.displayName, revision, epoch: (previous?.epoch ?? 0n) + (record.prepared.operation === "finalizeRecovery" ? 1n : 0n), revoked: false, validUntil: Date.parse(record.prepared.validUntil!), reboundAt: previous && previous.address.toLowerCase() !== req.address.toLowerCase() ? now() : previous?.reboundAt });
      acct.profile = { address: req.address, displayName: req.displayName, phone: pt.phone, phoneMasked: maskPhone(pt.phone), autoSave: acct.profile?.autoSave ?? { enabled: false, threshold: "0" }, createdAt: acct.profile?.createdAt ?? new Date(now()).toISOString(), phoneStatus: "active" };
      record.used = true;
      return { status: "registered" as const, sessionToken: newSession(req.address), profile: acct.profile };
    }),

    phoneStatus: () => wait(() => phoneStatusOf(authed().address)),
    preparePhoneAction: (operation) => wait(() => {
      const { address } = authed();
      const phone = phoneStatusOf(address).phone;
      const entry = phone ? directory.get(phone) : undefined;
      const controller = entry?.address.toLowerCase() === address.toLowerCase();
      const candidate = livePending(entry)?.account.toLowerCase() === address.toLowerCase();
      if (!phone || !entry || (operation === "revoke" ? !controller || entry.revoked : (!controller && !candidate) || !livePending(entry))) throw new ApiError("INVALID_REQUEST", "There is no number change to confirm. Refresh and try again.", 409);
      return makeConsent(phone, address, operation);
    }),
    submitPhoneAction: (req) => waitAsync(async () => {
      const { address } = authed();
      const record = await checkConsent(req.id, address, req.signature);
      const entry = directory.get(record.phone)!;
      const controller = entry.address.toLowerCase() === address.toLowerCase();
      const candidate = livePending(entry)?.account.toLowerCase() === address.toLowerCase();
      if (!["revoke", "cancelRecovery"].includes(record.prepared.operation) || (record.prepared.operation === "revoke" ? !controller : !controller && !candidate)) throw new ApiError("INVALID_REQUEST", "These details changed. Please start again.", 409);
      if (record.prepared.operation === "revoke") { entry.revoked = true; entry.epoch += 1n; }
      entry.pending = undefined;
      entry.revision += 1n;
      record.used = true;
      return phoneStatusOf(address);
    }),
    readDirectory: (phoneKey) => wait((): BindingRead => {
      const pair = [...directory].find(([phone]) => fakeHash(phone).toLowerCase() === phoneKey.toLowerCase());
      const entry = pair?.[1];
      return { account: entry?.address ?? zeroAddress, revision: String(entry?.revision ?? 0n), ownershipEpoch: String(entry?.epoch ?? 0n), validUntil: entry ? new Date(entry.validUntil).toISOString() : null, revoked: entry?.revoked ?? false, pending: !!livePending(entry), now: Math.floor(now() / 1000) };
    }),

    session: (req) =>
      waitAsync(async () => {
        const ok = await verifyMessage({ address: req.address, message: sessionMessage(req.address, req.issuedAt), signature: req.signature });
        if (!ok) throw new ApiError("INTERNAL", "We couldn't confirm it's you. Please try again.", 401);
        return { sessionToken: newSession(req.address), profile: account(req.address).profile ? profileOf(account(req.address)) : null };
      }),

    me: () => wait(() => profileOf(authed().acct)),

    balance: () =>
      wait((): Balance => {
        const { acct } = authed();
        const pendingOut = acct.activity
          .filter((a) => a.status === "waiting" && (a.kind === "sent" || a.kind === "gift_sent"))
          .reduce((s, a) => s + BigInt(a.amount), 0n);
        return {
          balance: acct.balance.toString(),
          burrow: { amount: acct.burrow.toString(), earned: earned(acct).toString(), availableNow: availableNow(acct).toString(), ratePercent: 4.2 },
          pendingOut: pendingOut.toString(),
        };
      }),

    resolve: (phones, region) =>
      wait(() => {
        registered();
        const results: ResolveResult[] = phones.map((phone) => {
          const e164 = normalise(phone, region);
          if (!e164) return { phone, e164: null, status: "invalid" };
          const entry = directory.get(e164);
          const state = snapshot(e164);
          if (!entry) return { phone, e164, status: "invite", directory: state };
          if (!active(entry)) return { phone, e164, status: "unavailable", directory: state };
          return { phone, e164, status: "registered", displayName: entry.name, address: entry.address, recentlyChanged: !!entry.reboundAt, directory: state };
        });
        return { results };
      }),

    prepareAction: (req) =>
      wait(() => {
        const { meta, ...prepared } = prepare(req);
        actions.set(prepared.id, { prepared, request: req, owner: prepared.expect.payer, meta });
        return prepared;
      }),

    submitAction: (id, signatures) =>
      waitAsync(async () => {
        const { address } = authed();
        const p = actions.get(id);
        if (!p || p.owner.toLowerCase() !== address.toLowerCase()) throw new ApiError("NOT_FOUND", "We couldn't find that payment. Please start again.", 404);
        if (p.result) return p.result; // idempotent
        if (Date.parse(p.prepared.expiresAt) < now()) throw new ApiError("ACTION_EXPIRED", "That took a little too long. Please review it and confirm again.", 410);
        for (const { key, typedData } of p.prepared.toSign) {
          const signature = signatures[key];
          const ok = signature && (await verifyTypedData({ ...hydrateTypedData(typedData), address, signature }));
          if (!ok) throw new ApiError("INTERNAL", "We couldn't confirm it's you. Please try again.", 400);
        }
        if (p.meta.e164 && p.prepared.expect.directory) {
          const current = snapshot(p.meta.e164);
          if (JSON.stringify(current) !== JSON.stringify(p.prepared.expect.directory) || (directory.has(p.meta.e164) && !active(directory.get(p.meta.e164)))) throw new ApiError("RECIPIENT_CHANGED", "The recipient details changed. Choose them again before sending.", 409);
        }
        p.result = execute(p);
        return p.result;
      }),

    activity: (cursor) =>
      wait(() => {
        const { acct } = authed();
        const start = cursor ? Number(cursor) : 0;
        const items = acct.activity.slice(start, start + 20);
        return { items, nextCursor: start + 20 < acct.activity.length ? String(start + 20) : undefined };
      }),

    claim: (code) =>
      wait(() => {
        const c = claims.get(code);
        if (!c) throw new ApiError("NOT_FOUND", "We couldn't find this link. Ask the sender to share it again.", 404);
        const { phone: _p, sender: _s, activityId: _a, ...pub } = c;
        return pub;
      }),

    acceptClaim: (code, body) =>
      wait(() => {
        const { address, acct } = authed();
        const c = claims.get(code);
        if (!c) throw new ApiError("NOT_FOUND", "We couldn't find this link. Ask the sender to share it again.", 404);
        if (c.status === "opened") throw new ApiError("ALREADY_CLAIMED", "This was already opened.", 409);
        if (c.status === "returned") throw new ApiError("CLAIM_EXPIRED", "This went back to the sender. Ask them to send it again.", 410);
        const pt = phoneTokens.get(body.phoneToken);
        if (!pt || pt.expires < now()) throw new ApiError("OTP_EXPIRED", "Your code expired. Verify your number again.", 400);
        if (pt.phone !== c.phone) throw new ApiError("WRONG_PHONE", `This was sent to ${c.phoneMasked}. Verify that number to open it.`, 403);
        const binding = directory.get(c.phone);
        if (!active(binding) || binding!.address.toLowerCase() !== address.toLowerCase() || String(binding!.epoch) !== c.phoneEpoch) throw new ApiError("PHONE_UNAVAILABLE", "This payment can no longer be opened with this number. Ask the sender to check it.", 409);
        c.status = "opened";
        const amount = BigInt(c.amount);
        const sender = accounts.get(c.sender.toLowerCase());
        const sent = sender?.activity.find((a) => a.id === c.activityId);
        if (sent) {
          sent.status = "completed";
          sent.canCancel = false;
          sent.claimLink = undefined;
        }
        if (c.kind === "money") {
          acct.balance += amount;
          const it = item("received", "completed", amount, { counterparty: { name: c.senderName }, note: c.note });
          acct.activity.unshift(it);
          sweep(acct);
          return { status: "completed" as const, amount: c.amount, receipt: it.receipt! };
        }
        const brandId = c.gift?.brandId ?? body.brandId;
        const brand = MOCK_BRANDS.find((b) => b.id === brandId);
        if (!brand) {
          c.status = "waiting";
          throw new ApiError("INVALID_REQUEST", "Pick a gift card brand to open your gift.", 400);
        }
        if (!brand.available) {
          // Server behaviour: the card couldn't be bought, so the money goes to the balance instead.
          acct.balance += amount;
          const it = item("received", "completed", amount, { counterparty: { name: c.senderName }, note: c.gift?.message });
          acct.activity.unshift(it);
          return {
            status: "completed" as const,
            amount: c.amount,
            receipt: it.receipt!,
            error: { code: "GIFT_UNAVAILABLE", message: `${brand.name} cards are unavailable right now, so ${fmt(amount)} went to your balance instead.` },
          };
        }
        const card = makeCard(brand, amount, c.senderName);
        acct.cards.unshift(card);
        const it = item("gift_received", "completed", amount, { counterparty: { name: c.senderName }, giftCardId: card.id, note: c.gift?.message });
        acct.activity.unshift(it);
        void address;
        return { status: "completed" as const, amount: c.amount, giftCardId: card.id, receipt: it.receipt! };
      }),

    catalog: (country = "US") => wait(() => ({ brands: MOCK_BRANDS.filter((b) => b.country === country) })),

    quote: (brandId, amount) =>
      wait(() => {
        const brand = MOCK_BRANDS.find((b) => b.id === brandId);
        if (!brand) throw new ApiError("NOT_FOUND", "We couldn't find that gift card. Pick another one.", 404);
        const a = BigInt(amount);
        const price = a + (a * BigInt(Math.round(brand.feePercent * 100))) / 10_000n;
        return { brandId, amount, price: price.toString(), available: brand.available };
      }),

    giftCards: () => wait(() => ({ cards: authed().acct.cards.map(({ secret: _s, ...card }) => card) })),

    revealGiftCard: (id) =>
      wait(() => {
        const card = authed().acct.cards.find((c) => c.id === id);
        if (!card) throw new ApiError("NOT_FOUND", "We couldn't find that gift card.", 404);
        return card.secret;
      }),

    // A local demo cannot claim a provider payment happened or open an unconfigured checkout.
    fundingOptions: () => wait(() => {
      registered();
      return {
        provider: "ramp" as const, environment: "sandbox" as const, available: false,
        unavailableReason: "not_configured" as const, country: "US" as const, currency: "USD" as const,
        minAmount: "0", maxAmount: "0",
        message: "Bank and card payments are being set up. You can still receive money from a friend.",
      };
    }),
    createFundingSession: () => wait(() => {
      registered();
      throw new ApiError("FUNDING_UNAVAILABLE", "Bank and card payments are being set up. Please try again later.", 503);
    }),
    fundingSession: () => wait(() => {
      registered();
      throw new ApiError("NOT_FOUND", "We couldn't find that payment. Go back to Add money.", 404);
    }),

    // Agora's public figures, as GET /v1/agora/metrics returned them on 14 Oct 2026 (six-decimal dollars).
    agoraMetrics: () => wait(() => ({
      source: "agora" as const, partial: false,
      totalSupply: "211631514798976", circulatingSupply: "187063472246883",
      home: { network: "monad", chainId: "eip155:143", totalSupply: "109206890954020", circulatingSupply: "104350204252830" },
      networks: [
        { network: "monad", chainId: "eip155:143", totalSupply: "109206890954020", circulatingSupply: "104350204252830" },
        { network: "ethereum", chainId: "eip155:1", totalSupply: "71919999240777", circulatingSupply: "64870315160326" },
      ],
      fetchedAt: "2026-10-14T00:00:00.000Z",
    })),

    topupOrigins: () =>
      wait(() => {
        registered();
        return { origins: TOPUP_ORIGINS };
      }),

    topupQuote: (originAsset, amount) =>
      wait(() => {
        const { address } = registered();
        const origin = TOPUP_ORIGINS.find((o) => o.id === originAsset);
        if (!origin) throw new ApiError("INVALID_REQUEST", "Pick where the money is coming from.", 400);
        const a = BigInt(amount);
        if (a < USD) throw new ApiError("AMOUNT_TOO_LOW", "That amount is too small to add. Try a larger amount.", 400, { minAmountBaseUnits: String(USD) });
        const fee = a / 1000n;
        const quoteId = `tq_${rand(10)}`;
        topups.set(quoteId, { owner: address, amountOut: a - fee, created: now(), credited: false });
        return {
          quoteId,
          depositAddress: `0x${rand(40).toLowerCase().replace(/[^0-9a-f]/g, "a")}`,
          originAsset,
          amountIn: a.toString(),
          amountInBaseUnits: a.toString(),
          amountOut: (a - fee).toString(),
          minAmountOut: (a - fee - fee).toString(),
          expiresAt: new Date(now() + 30 * 60_000).toISOString(),
          etaSeconds: 30,
        };
      }),

    topupStatus: (quoteId) =>
      wait(() => {
        const { address, acct } = registered();
        const t = topups.get(quoteId);
        if (!t || t.owner.toLowerCase() !== address.toLowerCase()) throw new ApiError("NOT_FOUND", "We couldn't find that. Start again.", 404);
        // Demo: pretends the deposit arrives after ~10s and completes after ~20s.
        const age = now() - t.created;
        if (age < 10_000) return { status: "waiting" as const, message: "Waiting for your deposit." };
        if (age < 20_000) return { status: "processing" as const, message: "Deposit received. Adding it to your balance…" };
        if (!t.credited) {
          t.credited = true;
          acct.balance += t.amountOut;
          acct.activity.unshift(item("received", "completed", t.amountOut, { counterparty: { name: "Added money" } }));
          sweep(acct);
        }
        return { status: "completed" as const, message: `${fmt(t.amountOut)} is in your balance.`, amountOut: t.amountOut.toString() };
      }),
  };
}

function formatForTitle(e164: string): string {
  return maskPhone(e164);
}
