import { bilbyDirectoryAbi, bilbyEscrowAbi, bilbyRouterAbi, mockAusdAbi, mockStataAbi } from "@bilbypay/core";
import { type Abi, BaseError, decodeErrorResult, type Hex } from "viem";

/**
 * An error the app can show as-is. `message` follows the spec §3a glossary: plain sentences with
 * a next step, never "transaction", "gas", "token", "wallet", "address" or other plumbing words.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }

  toBody() {
    return { error: { code: this.code, message: this.message, ...this.extra } };
  }
}

export const errors = {
  invalidRequest: (message = "Something in that request didn't look right. Please try again.") =>
    new ApiError(400, "INVALID_REQUEST", message),
  notFound: (message = "We couldn't find that. It may have been removed.") => new ApiError(404, "NOT_FOUND", message),
  sessionExpired: () => new ApiError(401, "SESSION_EXPIRED", "You've been signed out. Please sign in again."),
  phoneRequired: () => new ApiError(403, "PHONE_REQUIRED", "Add your phone number to continue."),
  phoneInvalid: (message = "That doesn't look like a phone number. Check it and try again.") =>
    new ApiError(400, "PHONE_INVALID", message),
  otpInvalid: () => new ApiError(400, "OTP_INVALID", "That code isn't right. Check the text we sent and try again."),
  otpExpired: () => new ApiError(400, "OTP_EXPIRED", "That code has expired. Ask for a new one and try again."),
  phoneCheckExpired: () =>
    new ApiError(401, "OTP_EXPIRED", "Your number check timed out. Verify your number again to continue."),
  rateLimited: (message = "Too many tries. Please wait a little while and try again.") =>
    new ApiError(429, "RATE_LIMITED", message),
  badSignature: () =>
    new ApiError(400, "CONFIRMATION_FAILED", "We couldn't confirm that with Face ID. Please try again."),
  insufficientFunds: () =>
    new ApiError(400, "INSUFFICIENT_FUNDS", "You don't have enough money for this. Add money or try a smaller amount."),
  burrowBusy: (availableNow: bigint, message: string) =>
    new ApiError(409, "BURROW_BUSY", message, { availableNow: availableNow.toString() }),
  actionExpired: () => new ApiError(410, "ACTION_EXPIRED", "This took too long, so nothing was sent. Please try again."),
  alreadyClaimed: () => new ApiError(409, "ALREADY_CLAIMED", "This has already been opened."),
  claimExpired: () =>
    new ApiError(410, "CLAIM_EXPIRED", "This has expired, and the money went back to the sender. Ask them to send it again."),
  wrongPhone: (masked: string) =>
    new ApiError(403, "WRONG_PHONE", `This was sent to ${masked}. Verify that number to open it.`),
  giftUnavailable: (message = "That gift card is temporarily unavailable. Please pick another brand.") =>
    new ApiError(409, "GIFT_UNAVAILABLE", message),
  giftProcessing: () =>
    new ApiError(409, "GIFT_PROCESSING", "Your gift card is on its way. Try again in a moment."),
  internal: () => new ApiError(500, "INTERNAL", "Something went wrong on our side. Nothing was charged. Please try again."),
};

// Every error our contracts (and the local mocks) can raise, in one ABI.
const REVERT_ABI = [...bilbyDirectoryAbi, ...bilbyEscrowAbi, ...bilbyRouterAbi, ...mockStataAbi, ...mockAusdAbi].filter(
  (x) => x.type === "error",
) as Abi;

/** Finds the revert payload inside a viem error chain. */
export function revertData(err: unknown): Hex | undefined {
  if (!(err instanceof BaseError)) return undefined;
  let found: Hex | undefined;
  err.walk((e) => {
    const data = (e as { data?: unknown }).data;
    if (typeof data === "string" && data.startsWith("0x") && data.length >= 10) found = data as Hex;
    else if (data && typeof data === "object" && typeof (data as { data?: unknown }).data === "string") {
      found = (data as { data: Hex }).data;
    }
    return false;
  });
  return found;
}

/**
 * Revert data → custom error name, Error(string) reason, or "Panic(code)". Unwraps
 * BilbyRouter.CallFailed(bytes) so the inner payment's reason shows through.
 */
export function decodeRevert(data: Hex): string | undefined {
  try {
    const d = decodeErrorResult({ abi: REVERT_ABI, data });
    if (d.errorName === "Error") return String(d.args?.[0]);
    if (d.errorName === "Panic") return `Panic(${d.args?.[0]})`;
    if (d.errorName === "CallFailed") return decodeRevert(d.args?.[0] as Hex) ?? "CallFailed";
    return d.errorName;
  } catch {
    return undefined;
  }
}

export function innerReason(err: unknown): string | undefined {
  const data = revertData(err);
  const decoded = data && decodeRevert(data);
  if (decoded) return decoded;
  if (err instanceof BaseError) {
    const m = /reverted with reason string '([^']+)'|reason: (.+)$/m.exec(err.message);
    if (m) return m[1] ?? m[2];
  }
  return undefined;
}

/** Maps an on-chain revert to a human error. Unknown reverts become INTERNAL. */
export function humanizeRevert(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  // relayer.RevertError carries the decoded reason already.
  const carried = (err as { reason?: unknown } | null)?.reason;
  const reason = (typeof carried === "string" ? carried : innerReason(err)) ?? "";
  if (/authorization is used|AuthorizationUsed|DepositExists/i.test(reason)) {
    return new ApiError(409, "ALREADY_DONE", "This was already sent. Check your activity before trying again.");
  }
  if (/expired|SignatureExpired|AttestationExpired|not yet valid/i.test(reason)) return errors.actionExpired();
  if (/ERC4626ExceededMaxWithdraw/.test(reason)) {
    return errors.burrowBusy(0n, "Some of your Burrow money is busy right now. Please try a smaller amount.");
  }
  if (/NotPending/.test(reason)) return errors.alreadyClaimed();
  if (/Panic\(17\)|ERC20InsufficientBalance|ERC20InsufficientAllowance|transfer amount exceeds/i.test(reason)) {
    return errors.insufficientFunds();
  }
  return errors.internal();
}
