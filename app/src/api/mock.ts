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
} from "@bilbypay/core";
import { keccak256, toHex, verifyMessage, verifyTypedData } from "viem";
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
} from "./types";

/**
 * In-app demo implementation of docs/api.md (EXPO_PUBLIC_API_URL=mock). Everything lives in memory,
 * with a small delay so the UI behaves like it does against the real server. Authorizations are really
 * produced by the account key and verified here, so the demo exercises the same code path as production.
 */

export type MockApiOptions = {
  getToken: () => string | null;
  onSessionExpired?: () => void;
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

const SEEDED_PEOPLE: Array<{ phone: string; name: string; address: Hex; recentlyChanged?: boolean }> = [
  { phone: "+15555550101", name: "Maya Chen", address: "0x1111111111111111111111111111111111111111" },
  { phone: "+15555550102", name: "Arjun Rao", address: "0x2222222222222222222222222222222222222222" },
  { phone: "+15555550103", name: "Sam Okafor", address: "0x3333333333333333333333333333333333333333", recentlyChanged: true },
];

export const MOCK_BRANDS: Brand[] = [
  { id: "starbucks-us", name: "Starbucks", logoUrl: "", category: "Food & drink", country: "US", minAmount: String(5n * USD), maxAmount: String(100n * USD), feePercent: 2.5, available: true },
  { id: "uber-us", name: "Uber", logoUrl: "", category: "Travel", country: "US", minAmount: String(15n * USD), maxAmount: String(200n * USD), denominations: [String(15n * USD), String(25n * USD), String(50n * USD), String(100n * USD)], feePercent: 3, available: true },
  { id: "doordash-us", name: "DoorDash", logoUrl: "", category: "Food & drink", country: "US", minAmount: String(10n * USD), maxAmount: String(200n * USD), feePercent: 3, available: true },
  { id: "target-us", name: "Target", logoUrl: "", category: "Shopping", country: "US", minAmount: String(10n * USD), maxAmount: String(500n * USD), feePercent: 2, available: true },
  { id: "spotify-us", name: "Spotify", logoUrl: "", category: "Entertainment", country: "US", minAmount: String(10n * USD), maxAmount: String(60n * USD), denominations: [String(10n * USD), String(30n * USD), String(60n * USD)], feePercent: 4, available: true },
  { id: "airbnb-us", name: "Airbnb", logoUrl: "", category: "Travel", country: "US", minAmount: String(25n * USD), maxAmount: String(500n * USD), feePercent: 3, available: false },
];

type Account = {
  profile: Profile | null;
  balance: bigint;
  burrow: bigint;
  deposited: bigint;
  activity: ActivityItem[];
  cards: Array<GiftCard & { secret: GiftCardReveal }>;
};

type PendingAction = {
  prepared: PreparedAction;
  request: ActionRequest;
  owner: Hex;
  result?: ActionResult;
  meta: { payee?: Hex; e164?: string; name?: string; phoneMasked?: string; shortfall: bigint };
};

type ClaimRecord = Claim & { phone: string; sender: Hex; activityId: string };

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

export function createMockApi(opts: MockApiOptions): BilbyApi {
  const chainId = opts.chainId ?? 143;
  const delayMs = opts.delayMs ?? 300;
  const now = opts.now ?? (() => Date.now());
  const deployment = FAKE_DEPLOYMENT(chainId);
  const network = getNetwork(chainId === 143 || chainId === 10143 ? chainId : 143);
  const ausd: TokenInfo = { ...network.ausd, address: deployment.ausd };
  const stata: TokenInfo = network.stata ?? { address: deployment.stata, decimals: 6, domainName: "Wrapped Aave Monad AUSD", domainVersion: "1" }; // glossary-allow (EIP-712 domain name)

  const accounts = new Map<string, Account>();
  const sessions = new Map<string, Hex>();
  const phoneTokens = new Map<string, { phone: string; expires: number }>();
  const directory = new Map<string, { address: Hex; name: string; reboundAt?: number }>();
  const actions = new Map<string, PendingAction>();
  const claims = new Map<string, ClaimRecord>();
  let autoSaveNonce = 0n;

  for (const p of SEEDED_PEOPLE) {
    directory.set(p.phone, { address: p.address, name: p.name, reboundAt: p.recentlyChanged ? now() : undefined });
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
    if (!acct.profile) throw new ApiError("NOT_FOUND", "Add your phone number to finish setting up.", 404);
    return acct.profile;
  };

  const newSession = (address: Hex) => {
    const token = `mock-${rand(16)}`;
    sessions.set(token, address);
    return token;
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

  const auth = (kind: "TransferWithAuthorization" | "ReceiveWithAuthorization", from: Hex, to: Hex, value: bigint) =>
    serializeTypedData(authorizationTypedData(kind, ausd, chainId, newAuthorization({ from, to, value, now: Math.floor(now() / 1000) })));

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

  const summary = (title: string, total: bigint, fromBurrow: bigint, lines: Array<{ label: string; value: string }> = [], warnings: PreparedAction["summary"]["warnings"] = []) => ({
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
        { availableNow: availableNow(acct).toString() },
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
    const { address, acct } = authed();
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
        const warnings = entry?.reboundAt
          ? [{ code: "RECIPIENT_RECENTLY_CHANGED", message: `This number moved to a new BilbyPay account recently. Only continue if you've checked with ${entry.name.split(" ")[0]} another way.` }]
          : [];
        const payee = entry?.address;
        const name = entry?.name ?? formatForTitle(e164);
        const toSign: PreparedAction["toSign"] = [
          { key: "payment", typedData: payee ? auth("TransferWithAuthorization", address, payee, amount) : auth("ReceiveWithAuthorization", address, deployment.escrow, amount) },
        ];
        if (fromBurrow > 0n) toSign.push({ key: "burrowPermit", typedData: burrowPermit(address, fromBurrow) });
        const lines = [...burrowLines(acct, fromBurrow), ...(req.params.note ? [{ label: "Note", value: req.params.note }] : [])];
        if (!payee) lines.push({ label: "How it works", value: "They get a link. If they don't open it in 14 days, it comes back to you." });
        return {
          ...base,
          summary: summary(`Send ${fmt(amount)} to ${name.split(" ")[0]}`, amount, fromBurrow, lines, warnings),
          toSign,
          expect: expect(amount, payee),
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
          const name = entry?.name ?? formatForTitle(e164);
          const toSign: PreparedAction["toSign"] = [{ key: "payment", typedData: auth("ReceiveWithAuthorization", address, deployment.escrow, price) }];
          if (fromBurrow > 0n) toSign.push({ key: "burrowPermit", typedData: burrowPermit(address, fromBurrow) });
          return {
            ...base,
            summary: summary(`Send a ${fmt(amount)} ${brand?.name ?? ""} gift card to ${name.split(" ")[0]}`.replace("  ", " "), price, fromBurrow, lines),
            toSign,
            expect: expect(price),
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
          summary: summary(`Move ${fmt(amount)} to your balance`, amount, 0n),
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
              ? { brandId: req.params.brandId, brandName: brand?.name, brandLogoUrl: brand?.logoUrl, design: req.params.design, message: req.params.message }
              : undefined,
          status: "waiting",
          expiresAt,
          phoneMasked: p.meta.phoneMasked ?? "",
          phone: p.meta.e164 ?? "",
          sender: p.owner,
          activityId: it.id,
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
        phoneTokens.set(phoneToken, { phone: e164, expires: now() + 15 * 60_000 });
        return { phoneToken, phone: e164, phoneMasked: maskPhone(e164) };
      }),

    register: (req) =>
      waitAsync(async () => {
        const pt = phoneTokens.get(req.phoneToken);
        if (!pt || pt.expires < now()) throw new ApiError("OTP_EXPIRED", "Your code expired. We'll send you a new one.", 400);
        if (Math.abs(Math.floor(now() / 1000) - req.issuedAt) > 300) throw new ApiError("INTERNAL", "Your phone's clock looks off. Check the time and try again.", 400);
        const ok = await verifyMessage({ address: req.address, message: registerMessage(pt.phone, req.address, req.issuedAt), signature: req.signature });
        if (!ok) throw new ApiError("INTERNAL", "We couldn't confirm it's you. Please try again.", 401);
        const acct = account(req.address);
        const previous = directory.get(pt.phone);
        if (acct.profile && acct.profile.phone !== pt.phone) directory.delete(acct.profile.phone);
        directory.set(pt.phone, {
          address: req.address,
          name: req.displayName,
          reboundAt: previous && previous.address.toLowerCase() !== req.address.toLowerCase() ? now() : undefined,
        });
        acct.profile = {
          address: req.address,
          displayName: req.displayName,
          phone: pt.phone,
          phoneMasked: maskPhone(pt.phone),
          autoSave: acct.profile?.autoSave ?? { enabled: false, threshold: "0" },
          createdAt: acct.profile?.createdAt ?? new Date(now()).toISOString(),
        };
        return { sessionToken: newSession(req.address), profile: acct.profile };
      }),

    session: (req) =>
      waitAsync(async () => {
        const ok = await verifyMessage({ address: req.address, message: sessionMessage(req.address, req.issuedAt), signature: req.signature });
        if (!ok) throw new ApiError("INTERNAL", "We couldn't confirm it's you. Please try again.", 401);
        return { sessionToken: newSession(req.address), profile: account(req.address).profile };
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
        authed();
        const results: ResolveResult[] = phones.map((phone) => {
          const e164 = normalise(phone, region);
          if (!e164) return { phone, e164: null, status: "invalid" };
          const entry = directory.get(e164);
          if (!entry) return { phone, e164, status: "invite" };
          return { phone, e164, status: "registered", displayName: entry.name, address: entry.address, recentlyChanged: !!entry.reboundAt };
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
          throw new ApiError("GIFT_UNAVAILABLE", "Pick a gift card brand to open your gift.", 400);
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

    topupQuote: () => wait(() => { throw new ApiError("NOT_FOUND", "Adding money from elsewhere isn't available in the demo.", 404); }),
    topupStatus: () => wait(() => { throw new ApiError("NOT_FOUND", "Adding money from elsewhere isn't available in the demo.", 404); }),
  };
}

function formatForTitle(e164: string): string {
  return maskPhone(e164);
}
