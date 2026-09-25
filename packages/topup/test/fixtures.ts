/**
 * Response fixtures shaped exactly like the 1Click types in
 * @defuse-protocol/one-click-sdk-typescript@0.1.26 dist/index.d.ts
 * (QuoteResponse, Quote, GetExecutionStatusResponse, SwapDetails, BadRequestResponse).
 * Values are illustrative, not captured from a live call.
 */
import type { FetchLike } from "../src";

export const USER = "0x1111111111111111111111111111111111111111";
export const DEPOSIT = "0xDeAdBeefdeadbeefDEADbeefdeadbeefdeadBEEF";
export const BASE_USDC = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";
export const MONAD_USDC = "nep245:v2_1.omni.hot.tg:143_2dmLwYWkCQKyTjeUPAsGJuiVLbFx";

export function quoteResponse(request: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  const dry = request.dry === true;
  return {
    correlationId: "c0rr-1",
    timestamp: "2026-09-25T10:00:00.000Z",
    signature: "ed25519:SIG",
    quoteRequest: request,
    quote: {
      ...(dry ? {} : { depositAddress: DEPOSIT, deadline: "2026-09-25T11:00:00.000Z", timeWhenInactive: "2026-09-25T11:00:00.000Z" }),
      amountIn: "5000000",
      amountInFormatted: "5.0",
      amountInUsd: "4.9998",
      minAmountIn: "5000000",
      amountOut: "4990000",
      amountOutFormatted: "4.99",
      amountOutUsd: "4.9898",
      minAmountOut: "4965050",
      timeEstimate: 20,
      ...overrides,
    },
  };
}

export function statusResponse(status: string, swapDetails: Record<string, unknown> = {}) {
  return {
    correlationId: "c0rr-2",
    quoteResponse: quoteResponse({ originAsset: BASE_USDC, destinationAsset: MONAD_USDC, dry: false }),
    status,
    updatedAt: "2026-09-25T10:05:00.000Z",
    swapDetails: {
      intentHashes: [],
      nearTxHashes: [],
      originChainTxHashes: [],
      destinationChainTxHashes: [],
      ...swapDetails,
    },
  };
}

export type Recorded = { url: string; method: string; headers: Record<string, string>; body?: unknown };

/** Fake fetch: routes by "METHOD pathname" to a handler; records every request. */
export function fakeFetch(routes: Record<string, (req: Recorded) => { status?: number; body: unknown }>) {
  const calls: Recorded[] = [];
  const fn: FetchLike = async (input, init) => {
    const url = new URL(input);
    const req: Recorded = {
      url: input,
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(req);
    const handler = routes[`${req.method} ${url.pathname}`];
    if (!handler) return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
    const { status = 200, body } = handler(req);
    return new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { fetch: fn, calls };
}
