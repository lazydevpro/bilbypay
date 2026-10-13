import { ApiError } from "../errors";
import {
  AgoraClient, type AgoraClientOptions, AgoraError, type AgoraInstruction, type AgoraMetrics, type AgoraRoute,
  MINT_DIRECTIONS, REDEEM_DIRECTIONS,
} from "./client";

export type AgoraConfig = { apiKey?: string; baseUrl?: string };

const METRICS_TTL_MS = 5 * 60_000;
/** If Agora is briefly down, keep serving the last good figures for this long (flagged `stale`). */
const METRICS_STALE_MS = 60 * 60_000;
/** BilbyPay runs on Monad (143 mainnet / 10143 testnet); Agora lists Monad mainnet supply as `monad`. */
const HOME_NETWORK = "monad";

/** GET /v1/agora/metrics. Amounts are 6-decimal base-unit strings, like every dollar amount in this API. */
export type AgoraMetricsView = {
  source: "agora";
  asset: "AUSD";
  partial: boolean;
  totalSupply?: string;
  circulatingSupply?: string;
  /** Monad mainnet AUSD (where BilbyPay balances live), if Agora lists it. */
  home?: NetworkSupply;
  networks: NetworkSupply[];
  fetchedAt: string;
  stale?: boolean;
};
type NetworkSupply = { network: string; chainId: string; totalSupply: string; circulatingSupply: string };

export type MintInstructionsView = {
  source: "agora";
  routes: { id: string; name: string | null; direction: string; to: AgoraRoute["to"]; instructions: AgoraInstruction[] }[];
  nextCursor: string | null;
};

export const agoraErrors = {
  notConfigured: () => new ApiError(503, "AGORA_NOT_CONFIGURED", "Bank transfers into your balance aren't set up yet. You can still receive money from a friend."),
  unavailable: () => new ApiError(503, "AGORA_UNAVAILABLE", "We couldn't reach our dollar partner just now. Please try again in a moment."),
};

export class AgoraService {
  readonly client: AgoraClient;
  private readonly now: () => number;
  private cached?: { view: AgoraMetricsView; at: number };
  private inflight?: Promise<AgoraMetricsView>;

  constructor(config: AgoraConfig, deps: Pick<AgoraClientOptions, "fetch" | "now"> = {}) {
    this.client = new AgoraClient({ apiKey: config.apiKey, baseUrl: config.baseUrl, ...deps });
    this.now = deps.now ?? Date.now;
  }

  get keyed(): boolean {
    return this.client.configured;
  }

  /** Public AUSD supply, cached ~5 min in memory; serves stale figures (≤1 h) if Agora errors. */
  async metrics(): Promise<AgoraMetricsView> {
    const t = this.now();
    if (this.cached && t - this.cached.at < METRICS_TTL_MS) return this.cached.view;
    this.inflight ??= this.client.metrics()
      .then((m) => {
        const view = toView(m, new Date(this.now()).toISOString());
        this.cached = { view, at: this.now() };
        return view;
      })
      .finally(() => { this.inflight = undefined; });
    try {
      return await this.inflight;
    } catch (e) {
      if (this.cached && t - this.cached.at < METRICS_STALE_MS) return { ...this.cached.view, stale: true };
      console.error("agora metrics failed:", e instanceof Error ? e.message : String(e));
      throw agoraErrors.unavailable();
    }
  }

  /** Mint routes (USD wire or stablecoin deposit → AUSD) landing on Monad, with their settlement instructions. */
  async mintInstructions(cursor?: string): Promise<MintInstructionsView> {
    return this.routes({ direction: MINT_DIRECTIONS, cursor });
  }

  /** Redeem routes (AUSD → USD wire / stablecoin), for completeness. */
  async redeemInstructions(cursor?: string): Promise<MintInstructionsView> {
    return this.routes({ direction: REDEEM_DIRECTIONS, cursor });
  }

  async route(id: string) {
    if (!this.keyed) throw agoraErrors.notConfigured();
    try {
      const r = await this.client.getRoute(id);
      return { source: "agora" as const, route: slim(r) };
    } catch (e) {
      throw mapKeyed(e);
    }
  }

  private async routes(q: { direction: typeof MINT_DIRECTIONS; cursor?: string }): Promise<MintInstructionsView> {
    if (!this.keyed) throw agoraErrors.notConfigured();
    try {
      const page = await this.client.listRoutes({ direction: q.direction, toChain: [HOME_NETWORK], cursor: q.cursor, limit: 50 });
      return { source: "agora", routes: page.data.map(slim), nextCursor: page.nextCursor };
    } catch (e) {
      throw mapKeyed(e);
    }
  }
}

function slim(r: AgoraRoute) {
  return { id: r.id, name: r.name ?? null, direction: r.direction, to: r.to, instructions: r.instructions };
}

function mapKeyed(e: unknown): ApiError {
  if (e instanceof AgoraError) {
    // Request-Id is what Agora support needs; the key itself never reaches a log line.
    console.error(`agora ${e.status} ${e.code}${e.reason ? `/${e.reason}` : ""}${e.requestId ? ` request-id=${e.requestId}` : ""}`);
    if (e.status === 404) return new ApiError(404, "NOT_FOUND", "We couldn't find those bank details.");
  } else console.error("agora request failed:", e instanceof Error ? e.message : String(e));
  return agoraErrors.unavailable();
}

function toView(m: AgoraMetrics, fetchedAt: string): AgoraMetricsView {
  const networks = m.chains
    .map((c) => ({ network: c.network, chainId: c.chainId, totalSupply: c.totalSupply.toString(), circulatingSupply: c.circulatingSupply.toString() }))
    .sort((a, b) => (BigInt(b.circulatingSupply) > BigInt(a.circulatingSupply) ? 1 : BigInt(b.circulatingSupply) < BigInt(a.circulatingSupply) ? -1 : 0));
  return {
    source: "agora", asset: "AUSD", partial: m.partial,
    ...(m.totalSupply !== undefined ? { totalSupply: m.totalSupply.toString() } : {}),
    ...(m.circulatingSupply !== undefined ? { circulatingSupply: m.circulatingSupply.toString() } : {}),
    home: networks.find((n) => n.network === HOME_NETWORK),
    networks, fetchedAt,
  };
}
