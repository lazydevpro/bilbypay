import { hydrateTypedData } from "@bilbypay/core";
import type { TypedDataDefinition } from "viem";
import type { ActionRequest, ActionType, Hex, PreparedAction } from "../api/types";

/**
 * Defence against a compromised or buggy server: before the account key touches anything the server
 * asked us to authorize, check it does exactly what the user just confirmed (docs/api.md "App-side check").
 */

/** Longest validity we accept on anything we authorize. Server actions expire in ~10 min. */
export const MAX_VALIDITY_SECONDS = 24 * 60 * 60;

const PAYMENT_TYPES = ["TransferWithAuthorization", "ReceiveWithAuthorization"] as const;

/** Allowed toSign keys per action type → allowed primary types for that key, and whether it is required. */
const ALLOWED: Record<ActionType, Record<string, { types: readonly string[]; required: boolean }>> = {
  send: {
    payment: { types: PAYMENT_TYPES, required: true },
    burrowPermit: { types: ["Permit"], required: false },
  },
  gift_send: {
    payment: { types: ["ReceiveWithAuthorization"], required: true },
    burrowPermit: { types: ["Permit"], required: false },
  },
  gift_buy: {
    payment: { types: ["TransferWithAuthorization"], required: true },
    burrowPermit: { types: ["Permit"], required: false },
  },
  cancel: { cancel: { types: ["Cancel"], required: true } },
  burrow_autosave: {
    autoSave: { types: ["SetAutoSave"], required: true },
    ausdPermit: { types: ["Permit"], required: true },
  },
  burrow_add: { payment: { types: ["ReceiveWithAuthorization"], required: true } },
  burrow_withdraw: { burrowPermit: { types: ["Permit"], required: true } },
};

/** Gift card prices fold a provider fee in; anything above this over face value is refused. */
const MAX_GIFT_FEE_BPS = 1500n;

export class SigningGuardError extends Error {
  readonly userMessage = "Something about this payment didn't look right, so we stopped it. Nothing was sent.";
  constructor(readonly reason: string) {
    super(`Refused to authorize: ${reason}`);
    this.name = "SigningGuardError";
  }
}

export type GuardInput = {
  request: ActionRequest;
  prepared: PreparedAction;
  /** The signed-in account. */
  account: Hex;
  chainId: number;
  /** For `send` to a registered contact: the address `/v1/resolve` returned for that number. */
  resolvedPayee?: Hex;
  /** Unix seconds; defaults to now. */
  now?: number;
};

export type CheckedEntry = { key: string; typedData: TypedDataDefinition };

const same = (a: unknown, b: unknown) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();

function big(v: unknown, what: string): bigint {
  try {
    if (typeof v === "bigint") return v;
    if (typeof v === "string" || typeof v === "number") return BigInt(v);
  } catch {
    // fall through
  }
  throw new SigningGuardError(`${what} is not a number`);
}

function paramsAmount(request: ActionRequest): bigint | null {
  const p = request.params as { amount?: string };
  return p.amount === undefined ? null : big(p.amount, "params.amount");
}

/** Throws SigningGuardError unless every entry is safe; returns the entries ready to sign. */
export function checkPreparedAction(input: GuardInput): CheckedEntry[] {
  const { request, prepared, account, chainId } = input;
  const now = BigInt(input.now ?? Math.floor(Date.now() / 1000));
  const latest = now + BigInt(MAX_VALIDITY_SECONDS);
  const fail = (reason: string): never => {
    throw new SigningGuardError(reason);
  };

  if (prepared.type !== request.type) fail(`type ${prepared.type} != requested ${request.type}`);
  if (!same(prepared.expect?.payer, account)) fail("expect.payer is not this account");

  const expectAmount = big(prepared.expect.amount, "expect.amount");
  const asked = paramsAmount(request);
  const fromBurrow = big(prepared.summary.fromBurrow ?? "0", "summary.fromBurrow");

  // What the user saw must be what they pay.
  switch (request.type) {
    case "send":
    case "burrow_add":
    case "burrow_withdraw":
      if (asked === null || expectAmount !== asked) fail("expect.amount differs from the amount the user entered");
      break;
    case "gift_send":
    case "gift_buy":
      if (asked === null || expectAmount < asked || expectAmount > asked + (asked * MAX_GIFT_FEE_BPS) / 10_000n) {
        fail("gift price is outside the allowed fee range");
      }
      break;
    default:
      break;
  }
  if (["send", "gift_send", "gift_buy", "burrow_add"].includes(request.type)) {
    if (big(prepared.summary.total, "summary.total") !== expectAmount) fail("summary.total differs from expect.amount");
    if (fromBurrow < 0n || fromBurrow > expectAmount) fail("fromBurrow is larger than the payment");
  }
  if (request.type === "send" && input.resolvedPayee && prepared.expect.payee && !same(prepared.expect.payee, input.resolvedPayee)) {
    fail("expect.payee differs from the resolved contact");
  }

  const rules = ALLOWED[request.type];
  const seen = new Set<string>();
  const out: CheckedEntry[] = [];

  for (const entry of prepared.toSign ?? []) {
    const rule = rules[entry.key];
    if (!rule) fail(`unexpected entry ${entry.key}`);
    if (seen.has(entry.key)) fail(`duplicate entry ${entry.key}`);
    seen.add(entry.key);

    let td: TypedDataDefinition;
    try {
      td = hydrateTypedData(entry.typedData);
    } catch {
      return fail(`${entry.key} is malformed`);
    }
    const primaryType = td.primaryType as string;
    if (!rule!.types.includes(primaryType)) fail(`${entry.key} has unexpected type ${primaryType}`);
    if (!td.types || !(td.types as Record<string, unknown>)[primaryType]) fail(`${entry.key} lacks its type definition`);
    const domain = (td.domain ?? {}) as { chainId?: number };
    if (domain.chainId !== chainId) fail(`${entry.key} is for network ${domain.chainId}`);

    const m = (td.message ?? {}) as Record<string, unknown>;
    const owners = (["from", "owner", "user"] as const).filter((f) => m[f] !== undefined);
    for (const f of owners) if (!same(m[f], account)) fail(`${entry.key}.${f} is not this account`);
    if (owners.length === 0 && primaryType !== "Cancel") fail(`${entry.key} does not name the payer`);

    if ((PAYMENT_TYPES as readonly string[]).includes(primaryType)) {
      const value = big(m.value, "message.value");
      if (value > expectAmount) fail(`${entry.key}.value exceeds expect.amount`);
      if (big(m.validBefore, "validBefore") > latest) fail(`${entry.key} is valid for too long`);
      if (request.type === "send") {
        if (input.resolvedPayee) {
          if (primaryType !== "TransferWithAuthorization") fail("registered send must pay the contact directly");
          if (!same(m.to, input.resolvedPayee)) fail("payment.to is not the resolved contact");
        } else if (primaryType !== "ReceiveWithAuthorization") {
          fail("invite send must be a receive authorization");
        }
      }
    } else {
      if (m.deadline !== undefined && big(m.deadline, "deadline") > latest) fail(`${entry.key} is valid for too long`);
    }

    if (entry.key === "burrowPermit") {
      // Shares for `x` dollars are ≤ x (share price ≥ 1) plus the documented 0.1% headroom; allow 1%.
      const bound = request.type === "burrow_withdraw" ? expectAmount : fromBurrow;
      if (bound === 0n) fail("Burrow permit without anything to take from Burrow");
      const value = big(m.value, "permit value");
      if (value > bound + bound / 100n + 1n) fail("Burrow permit is larger than needed");
    }
    if (request.type === "burrow_autosave") {
      const p = request.params;
      if (entry.key === "autoSave") {
        if (m.enabled !== p.enabled) fail("auto-save on/off differs from what the user chose");
        if (big(m.threshold, "threshold") !== big(p.threshold, "params.threshold")) fail("auto-save threshold differs");
      }
      if (entry.key === "ausdPermit" && !p.enabled && big(m.value, "permit value") !== 0n) {
        fail("turning auto-save off must remove the allowance");
      }
    }
    out.push({ key: entry.key, typedData: td });
  }

  for (const [key, rule] of Object.entries(rules)) {
    if (rule.required && !seen.has(key)) fail(`missing ${key}`);
  }
  if (seen.has("burrowPermit") !== (fromBurrow > 0n) && request.type !== "burrow_withdraw") {
    fail("Burrow permit does not match fromBurrow");
  }
  return out;
}
