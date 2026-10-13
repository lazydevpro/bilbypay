/**
 * Agora AUSD Stablecoin API client (https://api.agora.finance, OpenAPI 0.1.0, `/v0/openapi.json`).
 *
 * fetch-only (no Node APIs) so it runs unchanged on Node and in the Cloudflare Worker.
 * - Public: GET /v0/metrics (AUSD supply per network).
 * - Keyed: the access key is exchanged for a short-lived session JWT (POST /v0/auth/token, key sent as
 *   `Authorization: Bearer <accessKey>`); the JWT is cached until shortly before its `exp` and used for
 *   routes (mint/redeem settlement instructions) and transactions.
 * The access key is never logged, never put in an error message, and never sent anywhere but the token endpoint.
 */
import { parseUsd } from "@bilbypay/core";

export const AGORA_API = "https://api.agora.finance";

export type AgoraCurrency = "ausd" | "usdi" | "usd" | "usdc";
export type AgoraRouteChain = "arbitrum" | "avalanche" | "base" | "ethereum" | "immutable" | "monad" | "polygon-pos" | "solana";
export type AgoraDirection = "mint-fiat" | "mint-stablecoin" | "redeem-fiat" | "redeem-stablecoin";
export const MINT_DIRECTIONS: AgoraDirection[] = ["mint-fiat", "mint-stablecoin"];
export const REDEEM_DIRECTIONS: AgoraDirection[] = ["redeem-fiat", "redeem-stablecoin"];

/** Raw /v0/metrics body. Amounts are human-unit decimal strings ("400000000.000000"). */
export type AgoraMetricsResponse = {
  chains: { chainId: string; circulatingSupply: string; network: string; totalSupply: string }[];
  /** Omitted by Agora when `partial` is true (a chain is missing). */
  circulatingSupply?: string;
  totalSupply?: string;
  partial: boolean;
};

/** Metrics with amounts as 6-decimal base units (the repo-wide dollar convention). */
export type AgoraMetrics = {
  partial: boolean;
  totalSupply?: bigint;
  circulatingSupply?: bigint;
  chains: { network: string; chainId: string; totalSupply: bigint; circulatingSupply: bigint }[];
};

export type AgoraWireInstruction = {
  memo: string; beneficiaryName: string; beneficiaryAddress: string; accountNumber: string;
  bankName: string; bankAddress: string; swiftCode?: string; routingNumber: string; supportedCurrencies: AgoraCurrency[];
};
export type AgoraDepositInstruction = { chain: AgoraRouteChain; depositAddress: string; supportedCurrencies: AgoraCurrency[] };
export type AgoraInstruction = AgoraWireInstruction | AgoraDepositInstruction;

export type AgoraRoute = {
  id: string;
  name?: string | null;
  createdAt: string;
  direction: AgoraDirection;
  to: { currency: AgoraCurrency; accountId: string; chain?: AgoraRouteChain };
  instructions: AgoraInstruction[];
};
export type AgoraPage<T> = { data: T[]; nextCursor: string | null };

export type AgoraAmount = { amount: string; currency: string };
export type AgoraCounterparty =
  | { kind: "bank"; accountId: string | null; accountNumber: string | null; bankName?: string | null; name: string | null; amounts: AgoraAmount[] }
  | { kind: "wallet"; accountId: string | null; address: string | null; chain: string; name: string | null; amounts: AgoraAmount[] };
export type AgoraTransaction = {
  id: string;
  /** Open enum: mint | redeem | bridge | reward | return | tokenExchange | … */
  type: string;
  /** Always `settled` unless `type` is tokenExchange. Open enum. */
  status: string;
  initiatedAt: string;
  settledAt: string | null;
  isInstantSettlement: boolean;
  legCount: number;
  failureReason: string | null;
  refundFailureReason: string | null;
  source: AgoraCounterparty | null;
  recipient: AgoraCounterparty | null;
};

export type RouteQuery = {
  direction?: AgoraDirection[];
  toChain?: AgoraRouteChain[];
  toCurrency?: AgoraCurrency;
  fromCurrency?: AgoraCurrency;
  toAccountId?: string;
  limit?: number;
  cursor?: string;
};
export type TransactionQuery = {
  type?: string[];
  recipientChain?: AgoraRouteChain[];
  sourceChain?: AgoraRouteChain[];
  "initiatedAt.gte"?: string;
  "initiatedAt.lt"?: string;
  limit?: number;
  cursor?: string;
};

/** Agora error body: `{ code, message, docs_url, context? }` plus the `Request-Id` response header. */
export class AgoraError extends Error {
  override readonly name = "AgoraError";
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
    readonly reason?: string,
  ) {
    super(`Agora ${status} ${code}: ${message}${requestId ? ` (Request-Id ${requestId})` : ""}`);
  }
}

/** "1234.5" (human units) → 1_234_500_000n. Digits beyond the 6th decimal are truncated, never rounded up. */
export function agoraAmount(value: string): bigint {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!m) throw new AgoraError(502, "invalid_amount", "Agora returned an amount that is not a decimal string");
  return parseUsd(m[2] ? `${m[1]}.${m[2].slice(0, 6)}` : m[1]!);
}

export type AgoraClientOptions = {
  apiKey?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
};

const TOKEN_SKEW_MS = 60_000;
const DEFAULT_TOKEN_TTL_MS = 5 * 60_000;

/** Reads `exp` from a JWT without verifying it (Agora verifies; we only need to know when to refresh). */
export function jwtExpiryMs(jwt: string): number | undefined {
  try {
    const payload = jwt.split(".")[1];
    if (!payload) return undefined;
    const b64 = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=");
    const exp = (JSON.parse(atob(b64)) as { exp?: unknown }).exp;
    return typeof exp === "number" && Number.isFinite(exp) ? exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}

export class AgoraClient {
  private readonly apiKey?: string;
  private readonly base: string;
  private readonly doFetch: typeof fetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private session?: { jwt: string; refreshAt: number };
  private pendingSession?: Promise<string>;

  constructor(opts: AgoraClientOptions = {}) {
    this.apiKey = opts.apiKey || undefined;
    this.base = (opts.baseUrl || AGORA_API).replace(/\/+$/, "");
    this.doFetch = opts.fetch ?? ((input, init) => fetch(input, init));
    this.now = opts.now ?? Date.now;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
  }

  /** True when an access key is configured (keyed endpoints can be called). */
  get configured(): boolean {
    return this.apiKey !== undefined;
  }

  // ------------------------------------------------------------------ public

  async metricsRaw(): Promise<AgoraMetricsResponse> {
    return this.request<AgoraMetricsResponse>("GET", "/v0/metrics");
  }

  async metrics(): Promise<AgoraMetrics> {
    const raw = await this.metricsRaw();
    if (!raw || !Array.isArray(raw.chains)) throw new AgoraError(502, "invalid_response", "Agora metrics response has no chains");
    return {
      partial: raw.partial === true,
      totalSupply: raw.totalSupply !== undefined ? agoraAmount(raw.totalSupply) : undefined,
      circulatingSupply: raw.circulatingSupply !== undefined ? agoraAmount(raw.circulatingSupply) : undefined,
      chains: raw.chains.map((c) => ({
        network: c.network, chainId: c.chainId,
        totalSupply: agoraAmount(c.totalSupply), circulatingSupply: agoraAmount(c.circulatingSupply),
      })),
    };
  }

  // ------------------------------------------------------------------ keyed

  /** POST /v0/auth/token: access key → session JWT, cached until a minute before it expires. */
  async sessionJwt(): Promise<string> {
    if (!this.apiKey) throw new AgoraError(401, "not_configured", "AGORA_API_KEY is not set");
    if (this.session && this.now() < this.session.refreshAt) return this.session.jwt;
    // One exchange at a time; concurrent callers share it.
    this.pendingSession ??= (async () => {
      try {
        const body = await this.request<{ sessionJwt?: unknown }>("POST", "/v0/auth/token", undefined, this.apiKey);
        if (typeof body?.sessionJwt !== "string" || !body.sessionJwt) throw new AgoraError(502, "invalid_response", "Agora token response has no sessionJwt");
        const exp = jwtExpiryMs(body.sessionJwt) ?? this.now() + DEFAULT_TOKEN_TTL_MS;
        this.session = { jwt: body.sessionJwt, refreshAt: Math.max(this.now(), exp - TOKEN_SKEW_MS) };
        return body.sessionJwt;
      } finally {
        this.pendingSession = undefined;
      }
    })();
    return this.pendingSession;
  }

  /** GET /v0/routes. Use `direction: MINT_DIRECTIONS, toChain: ["monad"]` for "how do dollars become AUSD on Monad". */
  listRoutes(query: RouteQuery = {}): Promise<AgoraPage<AgoraRoute>> {
    return this.authed("GET", `/v0/routes${qs(query)}`);
  }

  /** GET /v0/routes/{routeId}: the settlement instructions (wire memo + beneficiary, or deposit addresses). */
  getRoute(routeId: string): Promise<AgoraRoute> {
    return this.authed("GET", `/v0/routes/${encodeURIComponent(routeId)}`);
  }

  /**
   * POST /v0/routes. Idempotent on Agora's side: the same inputs derive the same route id (200 = already existed,
   * 201 = created). `to.accountId` is an account registered with POST /v0/accounts.
   */
  createRoute(input: { name?: string; from: { currency: AgoraCurrency }; to: { currency: AgoraCurrency; accountId: string; chain?: AgoraRouteChain } }): Promise<AgoraRoute> {
    return this.authed("POST", "/v0/routes", input);
  }

  /** GET /v0/transactions: settled mints/redeems/etc. for this organization. */
  listTransactions(query: TransactionQuery = {}): Promise<AgoraPage<AgoraTransaction>> {
    return this.authed("GET", `/v0/transactions${qs(query)}`);
  }

  getTransaction(txnId: string): Promise<AgoraTransaction & Record<string, unknown>> {
    return this.authed("GET", `/v0/transactions/${encodeURIComponent(txnId)}`);
  }

  // ------------------------------------------------------------------ plumbing

  private async authed<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const jwt = await this.sessionJwt();
    try {
      return await this.request<T>(method, path, body, jwt);
    } catch (e) {
      // A JWT revoked/expired early: drop it and retry once with a fresh exchange.
      if (e instanceof AgoraError && e.status === 401 && e.reason !== "key_not_provisioned") {
        this.session = undefined;
        return this.request<T>(method, path, body, await this.sessionJwt());
      }
      throw e;
    }
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown, bearer?: string): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (bearer) headers.Authorization = `Bearer ${bearer}`;
    let res: Response;
    try {
      res = await this.doFetch(`${this.base}${path}`, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      throw new AgoraError(503, "network_error", e instanceof Error && e.name === "TimeoutError" ? "Agora did not respond in time" : "Could not reach Agora");
    }
    const requestId = res.headers.get("request-id") ?? undefined;
    const text = await res.text();
    let json: unknown;
    try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
    if (!res.ok) {
      const err = (json ?? {}) as { code?: unknown; message?: unknown; context?: { reason?: unknown } };
      throw new AgoraError(
        res.status,
        typeof err.code === "string" ? err.code : `http_${res.status}`,
        typeof err.message === "string" ? err.message.slice(0, 300) : res.statusText || "Request failed",
        requestId,
        typeof err.context?.reason === "string" ? err.context.reason : undefined,
      );
    }
    if (json === undefined) throw new AgoraError(502, "invalid_response", "Agora returned a non-JSON body", requestId);
    return json as T;
  }
}

/** Query string per the spec: arrays are `style: form, explode: false` (comma-separated). */
function qs(query: Record<string, string | number | string[] | undefined>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) { if (v.length) params.set(k, v.join(",")); }
    else params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}
