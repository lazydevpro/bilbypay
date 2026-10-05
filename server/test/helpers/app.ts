import { hydrateTypedData, type TypedDataJson } from "@bilbypay/core";
import type { Hono } from "hono";
import { type Address, getAddress, type Hex } from "viem";
import { generatePrivateKey, type PrivateKeyAccount, privateKeyToAccount } from "viem/accounts";
import { registerMessage, signInMessage } from "../../src/auth";
import type { ActionResult, PreparedAction } from "../../src/types";

export type Res<T = any> = { status: number; body: T };

/** Drives the API the way the mobile app does: HTTP only, account key held client-side. */
export class AppUser {
  readonly account: PrivateKeyAccount;
  session?: string;
  phoneToken?: string;
  e164?: string;

  constructor(
    private readonly app: Hono<any>,
    readonly phone: string,
    readonly name: string,
    key: Hex = generatePrivateKey(),
  ) {
    this.account = privateKeyToAccount(key);
  }

  get address(): Address {
    return this.account.address;
  }

  async call<T = any>(method: string, path: string, body?: unknown, auth = true): Promise<Res<T>> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (auth && this.session) headers.Authorization = `Bearer ${this.session}`;
    const res = await this.app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {}
    return { status: res.status, body: parsed as T };
  }

  async verifyPhone(): Promise<string> {
    const start = await this.call("POST", "/v1/otp/start", { phone: this.phone }, false);
    if (start.status !== 200) throw new Error(`otp/start ${JSON.stringify(start.body)}`);
    const verify = await this.call("POST", "/v1/otp/verify", { phone: this.phone, code: "000000" }, false);
    if (verify.status !== 200) throw new Error(`otp/verify ${JSON.stringify(verify.body)}`);
    this.phoneToken = verify.body.phoneToken;
    this.e164 = verify.body.phone;
    return this.phoneToken!;
  }

  async register(): Promise<Res> {
    const phoneToken = this.phoneToken ?? (await this.verifyPhone());
    const issuedAt = Math.floor(Date.now() / 1000);
    const e164 = this.e164!;
    const signature = await this.account.signMessage({ message: registerMessage({ phone: e164, address: this.address, issuedAt }) });
    const consent = await this.call("POST", "/v1/accounts/registration/prepare", { phoneToken, address: this.address }, false);
    if (consent.status !== 200) return consent;
    const consentSignature = await this.account.signTypedData(hydrateTypedData(consent.body.typedData) as never);
    const res = await this.call("POST", "/v1/accounts/register", { phoneToken, address: this.address, displayName: this.name, issuedAt, signature, registrationId: consent.body.id, consentSignature }, false);
    if (res.status === 200) this.session = res.body.sessionToken;
    return res;
  }

  async onboard(): Promise<this> {
    await this.verifyPhone();
    const res = await this.register();
    if (res.status !== 200) throw new Error(`register ${JSON.stringify(res.body)}`);
    return this;
  }

  async signIn(): Promise<Res> {
    const issuedAt = Math.floor(Date.now() / 1000);
    const signature = await this.account.signMessage({ message: signInMessage({ address: this.address, issuedAt }) });
    const res = await this.call("POST", "/v1/session", { address: this.address, issuedAt, signature }, false);
    if (res.status === 200) this.session = res.body.sessionToken;
    return res;
  }

  prepare(type: string, params: Record<string, unknown>): Promise<Res<PreparedAction>> {
    return this.call("POST", "/v1/actions", { type, params });
  }

  /** The app's required pre-signing checks (docs/api.md), then one signature per toSign entry. */
  async sign(prepared: PreparedAction): Promise<Record<string, Hex>> {
    const sigs: Record<string, Hex> = {};
    for (const { key, typedData } of prepared.toSign) {
      const m = typedData.message as Record<string, string>;
      for (const f of ["from", "owner", "user"]) {
        if (m[f] !== undefined && getAddress(m[f]) !== this.address) throw new Error(`${key}.${f} is not me`);
      }
      if (typedData.primaryType.endsWith("WithAuthorization")) {
        if (BigInt(m.value!) > BigInt(prepared.expect.amount)) throw new Error("value above expect.amount");
        if (prepared.type === "send" && prepared.expect.payee && getAddress(m.to!) !== getAddress(prepared.expect.payee)) {
          throw new Error("payee mismatch");
        }
      }
      sigs[key] = await this.account.signTypedData(hydrateTypedData(typedData as TypedDataJson) as never);
    }
    return sigs;
  }

  submit(id: string, signatures: Record<string, Hex>): Promise<Res<ActionResult>> {
    return this.call("POST", `/v1/actions/${id}/submit`, { signatures });
  }

  /** prepare → sign → submit. Throws if prepare fails. */
  async act(type: string, params: Record<string, unknown>): Promise<{ prepared: PreparedAction; result: ActionResult; status: number }> {
    const p = await this.prepare(type, params);
    if (p.status !== 200) throw new Error(`prepare ${type}: ${p.status} ${JSON.stringify(p.body)}`);
    const r = await this.submit(p.body.id, await this.sign(p.body));
    return { prepared: p.body, result: r.body, status: r.status };
  }

  async balance(): Promise<{ balance: string; burrow: { amount: string; earned: string; availableNow: string; ratePercent: number }; pendingOut: string }> {
    return (await this.call("GET", "/v1/balance")).body;
  }

  async activity(): Promise<any[]> {
    return (await this.call("GET", "/v1/activity")).body.items;
  }
}
