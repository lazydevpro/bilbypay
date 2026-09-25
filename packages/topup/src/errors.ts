export type TopUpErrorCode =
  | "AMOUNT_TOO_LOW"
  | "UNSUPPORTED_ORIGIN"
  | "INVALID_ADDRESS"
  | "REFUND_ADDRESS_REQUIRED"
  | "NO_OFFER"
  | "NOT_FOUND"
  | "NOT_A_LIVE_QUOTE"
  | "AUTH"
  | "RATE_LIMITED"
  | "UNAVAILABLE"
  | "UNKNOWN";

/**
 * User-facing copy. BilbyPay's no-crypto UX rule: no "chain", "bridge", "swap", "token",
 * "gas", "wallet address" etc. Tests enforce this list (see test/errors.test.ts).
 */
export const USER_MESSAGES: Record<TopUpErrorCode, string> = {
  AMOUNT_TOO_LOW: "That amount is too small to add. Try a larger amount.",
  UNSUPPORTED_ORIGIN: "Adding money from there isn't available yet. Pick another option.",
  INVALID_ADDRESS: "Something's wrong with your account details. Please try again.",
  REFUND_ADDRESS_REQUIRED: "We need the account you're sending from, so we can return money if anything goes wrong.",
  NO_OFFER: "We couldn't get a price right now. Please try again in a minute.",
  NOT_FOUND: "We couldn't find that top-up.",
  NOT_A_LIVE_QUOTE: "That was only a preview. Start a new top-up to add money.",
  AUTH: "Adding money is temporarily unavailable. Please try again later.",
  RATE_LIMITED: "Too many requests. Please wait a moment and try again.",
  UNAVAILABLE: "Adding money is temporarily unavailable. Please try again later.",
  UNKNOWN: "Something went wrong. Please try again.",
};

export class TopUpError extends Error {
  readonly code: TopUpErrorCode;
  /** Safe to show to users. */
  readonly userMessage: string;
  /** HTTP status from the provider, if any. */
  readonly httpStatus?: number;
  /** Provider message / body for logs. Never show this to users. */
  readonly raw?: unknown;
  /** Extra structured data, e.g. { minAmountBaseUnits } for AMOUNT_TOO_LOW. */
  readonly details?: Record<string, unknown>;

  constructor(
    code: TopUpErrorCode,
    opts: { message?: string; httpStatus?: number; raw?: unknown; details?: Record<string, unknown>; userMessage?: string } = {},
  ) {
    super(opts.message ?? code);
    this.name = "TopUpError";
    this.code = code;
    this.userMessage = opts.userMessage ?? USER_MESSAGES[code];
    this.httpStatus = opts.httpStatus;
    this.raw = opts.raw;
    this.details = opts.details;
  }
}

/**
 * Map a provider HTTP error to a TopUpError.
 *
 * Message substrings are taken from the Aurora swap widget's own error handling
 * (@aurora-is-near/intents-swap-widget@7.24.1 src/hooks/useMakeQuote.ts and
 * src/hooks/useMakeQuoteTransfer.ts), which reads `response.data.message`
 * (1Click `BadRequestResponse = { message: string }`):
 *   - "Amount is too low ... <minAmount in origin base units>"
 *   - "recipient is not valid"
 *   - "Failed to get a deposit address"
 *   - "Application key not found"   (Aurora Intents API only)
 *   - "No quotes found"
 * HTTP codes from @defuse-protocol/one-click-sdk-typescript@0.1.26 OneClickService:
 *   400 bad input, 401 bad API key / JWT, 404 deposit address not found (status).
 */
export function mapProviderError(httpStatus: number, body: unknown, context: "quote" | "status" | "submit"): TopUpError {
  const message = extractMessage(body);
  const lower = message.toLowerCase();
  const base = { httpStatus, raw: body, message: `provider ${context} error ${httpStatus}: ${message || "(no message)"}` };

  if (lower.includes("amount is too low")) {
    const min = message.match(/\d+/)?.[0];
    return new TopUpError("AMOUNT_TOO_LOW", { ...base, details: min ? { minAmountBaseUnits: min } : undefined });
  }
  if (lower.includes("application key not found")) return new TopUpError("AUTH", base);
  // The widget maps "recipient is not valid" to TOKEN_IS_NOT_SUPPORTED; for us the
  // recipient is always a validated Monad address, so this most likely means the
  // destination/origin pairing is not routable.
  if (lower.includes("recipient is not valid")) return new TopUpError("UNSUPPORTED_ORIGIN", base);
  if (lower.includes("no quotes found") || lower.includes("failed to get a deposit address")) {
    return new TopUpError("NO_OFFER", base);
  }
  if (httpStatus === 401 || httpStatus === 403) return new TopUpError("AUTH", base);
  if (httpStatus === 404) return new TopUpError("NOT_FOUND", base);
  if (httpStatus === 429) return new TopUpError("RATE_LIMITED", base);
  if (httpStatus >= 500) return new TopUpError("UNAVAILABLE", base);
  if (context === "quote" && httpStatus === 400) return new TopUpError("NO_OFFER", base);
  return new TopUpError("UNKNOWN", base);
}

function extractMessage(body: unknown): string {
  if (typeof body === "string") return body;
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    for (const key of ["message", "error", "detail"]) {
      const v = b[key];
      if (typeof v === "string") return v;
      if (Array.isArray(v)) return v.filter((x) => typeof x === "string").join("; ");
    }
  }
  return "";
}
