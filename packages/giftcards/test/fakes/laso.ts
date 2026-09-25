/**
 * In-process fake of the Laso endpoints we use, replaying the documented shapes
 * (LasoFinance/docs openapi.json + guides, 2026-09-25). It verifies what it receives
 * independently of the code under test: the SIWE text is rebuilt from the EIP-4361 template, and
 * the x402 signature is checked against a hand-written USDC-on-Base EIP-712 domain.
 */
import { type Address, getAddress, type Hex, recoverMessageAddress, recoverTypedDataAddress } from "viem";

export const USDC_BASE: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const LASO_PAY_TO: Address = getAddress("0x3291e96b3bff7ed56e3ca8364273c5b4654b2b37");

/** Written out by hand on purpose (not imported from src). Source: x402 defaultAssets.ts. */
export const USDC_BASE_DOMAIN = { name: "USD Coin", version: "2", chainId: 8453, verifyingContract: USDC_BASE } as const;
const TWA_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64");
const unb64 = (s: string) => JSON.parse(Buffer.from(s, "base64").toString("utf8"));
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

export type Product = { laso_server_id: string; name: string; currency: string; country: string | null; min: number; max: number; category?: string; denominations?: string[] | null };

export type FakeLasoOptions = {
  products?: Product[];
  /** Fee Laso adds, percent. Default 4.8. */
  feePercent?: number;
  /** "settlement": reject the payment (402 success:false) without settling. */
  failMode?: "settlement" | undefined;
  /** Drop (throw) the response to the next N paid requests AFTER settling them. */
  dropAfterSettle?: number;
  /** Throw on the next N paid requests BEFORE doing anything. */
  dropBeforeSettle?: number;
  x402Version?: 1 | 2;
  now?: () => number;
};

export class FakeLaso {
  readonly log: { method: string; path: string; headers: Record<string, string> }[] = [];
  /** EIP-3009 nonces settled "on chain", keyed `${from}:${nonce}`. */
  readonly usedAuthorizations = new Set<string>();
  readonly settlements: { from: Address; value: bigint; nonce: Hex }[] = [];
  readonly paymentHeadersSeen: string[] = [];
  readonly signers: Address[] = [];
  private readonly siwxNonces = new Set<string>();
  private idTokens = new Set<string>();
  private orders = 0;

  constructor(readonly opts: FakeLasoOptions = {}) {}

  get products(): Product[] {
    return (
      this.opts.products ?? [
        { laso_server_id: "starbucks", name: "Starbucks", currency: "USD", country: "US", min: 5, max: 500, category: "food" },
        { laso_server_id: "uber", name: "Uber", currency: "USD", country: "US", min: 15, max: 500, category: "travel" },
        { laso_server_id: "netflix", name: "Netflix", currency: "USD", country: null, min: 25, max: 100, denominations: ["25", "50", "100"] },
        { laso_server_id: "amazon", name: "Amazon SA", currency: "SAR", country: "SA", min: 50, max: 1000 },
      ]
    );
  }

  private now() {
    return Math.floor((this.opts.now ?? Date.now)() / 1000);
  }

  fetch = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    const method = init?.method ?? "GET";
    this.log.push({ method, path: url.pathname + url.search, headers });
    if (url.host !== "laso.test") throw new Error(`unexpected host ${url.host}`);

    if (url.pathname === "/auth" && method === "GET") return this.auth(url, headers);
    if (url.pathname === "/auth" && method === "POST") return json(401, { error: "Failed to refresh token." });
    if (url.pathname === "/search-gift-cards") {
      if (!this.idTokens.has((headers.authorization ?? "").replace(/^Bearer /, ""))) return json(401, { error: "Missing or invalid Authorization header" });
      const country = url.searchParams.get("country");
      const currency = url.searchParams.get("currency");
      const cards = this.products.filter((p) => (!country || p.country === country || p.country === null) && (!currency || p.currency === currency));
      return json(200, {
        gift_cards: cards.map((p) => ({ description: `${p.name} gift card`, increment: "0.01", denominations: null, product_image_url: `https://img.test/${p.laso_server_id}.png`, catalog_info: null, category: null, ...p })),
        count: cards.length,
        filters: { query: null, country, currency, category: null },
        facets: { categories: ["food"], currencies: ["USD", "SAR"], countries: ["US", "SA"] },
      });
    }
    if (url.pathname === "/order-gift-card") return this.order(url, headers);
    return json(404, { error: "not found" });
  };

  private async auth(url: URL, headers: Record<string, string>): Promise<Response> {
    const proof = headers["sign-in-with-x"];
    if (proof) {
      const p = unb64(proof);
      // Rebuild the EIP-4361 message by hand and recover the signer.
      const message = [
        `${p.domain} wants you to sign in with your Ethereum account:`,
        p.address,
        "",
        ...(p.statement ? [p.statement, ""] : []),
        `URI: ${p.uri}`,
        `Version: ${p.version}`,
        `Chain ID: ${String(p.chainId).split(":")[1]}`,
        `Nonce: ${p.nonce}`,
        `Issued At: ${p.issuedAt}`,
        ...(p.expirationTime ? [`Expiration Time: ${p.expirationTime}`] : []),
        ...(p.resources?.length ? ["Resources:", ...p.resources.map((r: string) => `- ${r}`)] : []),
      ].join("\n");
      const signer = await recoverMessageAddress({ message, signature: p.signature });
      const fresh = this.siwxNonces.delete(p.nonce);
      if (fresh && p.domain === "laso.finance" && signer === getAddress(p.address) && p.chainId === "eip155:8453") {
        this.signers.push(signer);
        const token = `idtok_${this.idTokens.size + 1}`;
        this.idTokens.add(token);
        return json(200, { auth: { id_token: token, refresh_token: "AMf-refresh", expires_in: "3600" }, user_id: signer.toLowerCase() });
      }
    }
    const nonce = `${Math.random().toString(16).slice(2).padEnd(16, "0")}${this.siwxNonces.size}`.slice(0, 32).padEnd(32, "a");
    this.siwxNonces.add(nonce);
    const issuedAt = new Date(this.now() * 1000).toISOString();
    return json(
      402,
      {},
      {
        "PAYMENT-REQUIRED": b64({
          x402Version: 2,
          error: "PAYMENT-SIGNATURE header is required",
          resource: { url: url.toString() },
          accepts: [],
          extensions: {
            "sign-in-with-x": {
              info: {
                domain: "laso.finance",
                uri: "https://laso.finance/auth",
                version: "1",
                nonce,
                issuedAt,
                expirationTime: new Date((this.now() + 300) * 1000).toISOString(),
                statement: "Sign in to Laso Finance",
                resources: ["https://laso.finance/auth"],
              },
              supportedChains: [
                { chainId: "eip155:8453", type: "eip191" },
                { chainId: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", type: "ed25519" },
              ],
            },
          },
        }),
      },
    );
  }

  priceFor(amount: number): bigint {
    const units = BigInt(Math.round(amount * 1e6));
    const bps = BigInt(Math.round((this.opts.feePercent ?? 4.8) * 100));
    return (units * (10_000n + bps) + 9_999n) / 10_000n;
  }

  private async order(url: URL, headers: Record<string, string>): Promise<Response> {
    const id = url.searchParams.get("laso_server_id");
    const amount = Number(url.searchParams.get("amount"));
    const product = this.products.find((p) => p.laso_server_id === id);
    if (!product) {
      return json(404, { error: `No gift card in the catalog has laso_server_id "${id}".`, code: "unknown_laso_server_id", terminal: true, laso_server_id: id });
    }
    if (!(amount >= product.min && amount <= product.max)) return json(400, { error: "amount out of range" });
    const price = this.priceFor(amount);
    const requirement = {
      scheme: "exact",
      network: "eip155:8453",
      amount: price.toString(),
      asset: USDC_BASE,
      payTo: LASO_PAY_TO,
      maxTimeoutSeconds: 300,
      extra: { name: "USD Coin", version: "2" },
    };
    const solana = { scheme: "exact", network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", amount: price.toString(), asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", payTo: "3MZVk97x9SeRxbYpc3jhzRfU2fyA3emYutnqfn9kNfYX", maxTimeoutSeconds: 300 };
    const v1 = this.opts.x402Version === 1;
    const header = v1 ? headers["x-payment"] : headers["payment-signature"];
    if (!header) {
      if (v1) {
        return json(402, {
          x402Version: 1,
          error: "X-PAYMENT header is required",
          accepts: [{ ...requirement, network: "base", maxAmountRequired: price.toString(), amount: undefined, resource: url.toString(), description: "", mimeType: "application/json" }],
        });
      }
      return json(402, {}, { "PAYMENT-REQUIRED": b64({ x402Version: 2, resource: { url: url.toString() }, accepts: [solana, requirement] }) });
    }

    if (this.opts.dropBeforeSettle) {
      this.opts.dropBeforeSettle--;
      throw new TypeError("fetch failed (dropped before settle)");
    }
    this.paymentHeadersSeen.push(header);
    const p = unb64(header);
    const auth = p.payload.authorization;
    const signer = await recoverTypedDataAddress({
      domain: USDC_BASE_DOMAIN,
      types: TWA_TYPES,
      primaryType: "TransferWithAuthorization",
      message: { from: auth.from, to: auth.to, value: BigInt(auth.value), validAfter: BigInt(auth.validAfter), validBefore: BigInt(auth.validBefore), nonce: auth.nonce },
      signature: p.payload.signature,
    });
    const k = `${auth.from.toLowerCase()}:${auth.nonce}`;
    const valid =
      signer === getAddress(auth.from) &&
      getAddress(auth.to) === LASO_PAY_TO &&
      BigInt(auth.value) === price &&
      Number(auth.validBefore) > this.now() &&
      Number(auth.validAfter) < this.now() &&
      (v1 ? p.network === "base" && p.scheme === "exact" : p.accepted?.network === "eip155:8453");
    if (!valid || this.usedAuthorizations.has(k) || this.opts.failMode === "settlement") {
      return json(402, { success: false, errorReason: this.usedAuthorizations.has(k) ? "nonce_already_used" : "insufficient_funds", errorMessage: "settlement failed" });
    }
    this.usedAuthorizations.add(k);
    this.settlements.push({ from: auth.from, value: BigInt(auth.value), nonce: auth.nonce });
    if (this.opts.dropAfterSettle) {
      this.opts.dropAfterSettle--;
      throw new TypeError("fetch failed (dropped after settle)");
    }
    this.orders++;
    return json(
      200,
      {
        auth: { id_token: "idtok_paid", refresh_token: "AMf-paid", expires_in: "3600" },
        user_id: auth.from.toLowerCase(),
        gift_card: {
          card_id: `gc_${this.orders}`,
          laso_server_id: id,
          amount,
          currency: product.currency,
          country: url.searchParams.get("country") ?? "US",
          redemption_url: id === "netflix" ? "https://netflix.test/redeem" : null,
          redemption_code: `CODE-${this.orders}-XXXX`,
          pin_code: id === "starbucks" ? "1234" : null,
          status: "completed",
          timestamp: this.now() * 1000,
        },
      },
      { "PAYMENT-RESPONSE": b64({ success: true, transaction: `0x${"ab".repeat(32)}`, network: "eip155:8453", payer: auth.from }) },
    );
  }

  /** Test double for a viem PublicClient's readContract on Base. */
  publicClient = {
    readContract: async (args: { functionName: string; args: readonly unknown[] }) => {
      if (args.functionName === "balanceOf") return 123_450_000n;
      if (args.functionName === "authorizationState") {
        const [from, nonce] = args.args as [string, string];
        return this.usedAuthorizations.has(`${from.toLowerCase()}:${nonce}`);
      }
      throw new Error(`unexpected ${args.functionName}`);
    },
  };
}
