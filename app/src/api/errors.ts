import type { ApiErrorCode } from "./types";

/** Raw API diagnostics. Use messageFor() before presenting the message to a person. */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  /** Extra fields from the error body, e.g. `availableNow` for BURROW_BUSY. */
  readonly details: Record<string, unknown>;

  constructor(code: ApiErrorCode, message: string, status = 0, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export const OFFLINE_MESSAGE = "You're offline. Check your connection and try again.";
export const FALLBACK_MESSAGE = "Something went wrong on our side. Please try again in a moment.";

const CODE_MESSAGES: Record<string, string> = {
  OTP_INVALID: "That code didn't match. Check the text message and try again.",
  OTP_EXPIRED: "Your code expired. Request a new one to continue.",
  RATE_LIMITED: "Too many attempts. Wait a moment, then try again.",
  PHONE_INVALID: "That number doesn't look right. Check it and try again.",
  SESSION_EXPIRED: "Please unlock BilbyPay again to continue.",
  INSUFFICIENT_FUNDS: "There isn't enough money available. Check your balance or try a smaller amount.",
  BURROW_BUSY: "Some of your Burrow money isn't available right now. Try a smaller amount or come back later.",
  RECIPIENT_RECENTLY_CHANGED: "This number recently moved to a new account. Check with the person another way before continuing.",
  ACTION_EXPIRED: "That took a little too long. Please review the details and confirm again.",
  ALREADY_CLAIMED: "This was already opened. Check Activity for the details.",
  CLAIM_EXPIRED: "This went back to the sender. Ask them to send it again.",
  WRONG_PHONE: "Use the phone number this was sent to, then try again.",
  GIFT_UNAVAILABLE: "That gift card is unavailable right now. Choose another brand.",
  NOT_FOUND: "We couldn't find that. Go back and try again.",
  INVALID_REQUEST: "Some details don't look right. Check them and try again.",
  INVALID_AMOUNT: "Enter an amount above $0.",
  PHONE_CHANGE_PENDING: "This number change is still waiting. Check Your number for the date you can finish.",
  PHONE_ALREADY_LINKED: "Stop receiving on your old number before linking a different one.",
  PHONE_UNAVAILABLE: "This number cannot receive payments right now. Check Your number or contact the recipient.",
  RECIPIENT_CHANGED: "The recipient details changed. Choose them again before sending.",
  PHONE_REQUIRED: "Add your phone number to continue.",
  CONFIRMATION_FAILED: "We couldn't confirm the result. Check Activity before trying again.",
  ALREADY_DONE: "This was already completed. Check Activity for the details.",
  GIFT_PROCESSING: "Your gift card is being prepared. Check back in a moment.",
  AMOUNT_TOO_LOW: "That amount is too small. Check the minimum amount and try again.",
  FUNDING_UNAVAILABLE: "Bank and card payments are being set up. Please try again later.",
  FUNDING_REQUEST_CHANGED: "This payment was already started with different details. Go back to Add money and try again.",
  NETWORK: OFFLINE_MESSAGE,
};

// Transport/provider diagnostics must remain internal even when returned as a human-readable sentence.
const TECHNICAL_COPY = /\b(?:crypto(?:currency)?|blockchain|web3|wallets?|addresses?|transactions?|tx(?:hash)?|hash(?:es)?|gas|tokens?|stablecoins?|USDC|AUSD|USDT|ETH|BTC|Solana|Arbitrum|Monad|Ethereum|Polygon|Avalanche|Aurora|chains?|bridg(?:e|es|ed|ing)|swaps?|staking|staked|APY|yield|escrow|Aave|vaults?|slippage|nonce|RPC|EVM|reverted?|calldata|wei|gwei|mnemonic|seed phrase|private key|signatures?|signer|chainId|depositAddress|EIP[ -]?\d+|ERC[ -]?\d+)\b/i;
const TECHNICAL_NAMES = /\b(?:NEAR|Base|MON)\b/;
const TECHNICAL_IDENTIFIER = /0x[\da-f]{16,}|\b[\da-f]{64}\b|\b[1-9A-HJ-NP-Za-km-z]{32,88}\b|https?:\/\/|\b[A-Z][A-Z\d]*(?:_[A-Z\d]+)+\b/i;

/** Keep useful amounts and next steps, but never expose provider terminology or identifiers. */
export function safeMessage(message: string, fallback = FALLBACK_MESSAGE): string {
  const clean = message.trim();
  return clean && clean.length <= 600 && !TECHNICAL_COPY.test(clean) && !TECHNICAL_NAMES.test(clean) && !TECHNICAL_IDENTIFIER.test(clean) ? clean : fallback;
}

/** The sentence to show for any thrown value. Unsafe diagnostics get a code-specific next step. */
export function messageFor(error: unknown): string {
  if (isApiError(error)) {
    const fallback = Object.hasOwn(CODE_MESSAGES, error.code) ? CODE_MESSAGES[error.code] : FALLBACK_MESSAGE;
    return safeMessage(error.message, fallback);
  }
  if (error && typeof error === "object" && "userMessage" in error && typeof error.userMessage === "string") {
    return safeMessage(error.userMessage);
  }
  return FALLBACK_MESSAGE;
}
