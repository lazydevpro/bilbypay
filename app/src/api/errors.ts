import type { ApiErrorCode } from "./types";

/** An error with a message that is always safe to show to the user as-is. */
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

/** The sentence to show for any thrown value. Server messages win; everything else gets a next step. */
export function messageFor(error: unknown): string {
  if (isApiError(error)) return error.message || FALLBACK_MESSAGE;
  if (error && typeof error === "object" && "userMessage" in error && typeof error.userMessage === "string") {
    return error.userMessage;
  }
  return FALLBACK_MESSAGE;
}
