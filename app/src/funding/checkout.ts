import type { FundingSession } from "../api/types";
import { typedToBase, usd } from "../money/amount";

/** Only the provider's practice checkout may be opened by this preview. */
export function safeCheckoutUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.origin === "https://app.demo.rampnetwork.com" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function amountProblem(typed: string, min: string, max: string): string | null {
  if (!/^\d{1,7}(?:\.\d{0,2})?$/.test(typed)) return "Enter an amount in dollars and cents.";
  const amount = BigInt(typedToBase(typed));
  try {
    if (amount <= 0n) return "Enter an amount above $0.";
    if (amount < BigInt(min)) return `Start with at least ${usd(min)}.`;
    if (amount > BigInt(max)) return `Choose ${usd(max)} or less.`;
    return null;
  } catch { return "We couldn't check the amount limits. Please try again."; }
}

export type FundingAttempt = { amount: string; returnUrl: string; idempotencyKey: string };
export const isAttemptId = (value: unknown): value is string => typeof value === "string" && /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(value);

/** Keep the same request identity after a timeout; only changed details start a new attempt. */
export function fundingAttempt(previous: FundingAttempt | null, amount: string, returnUrl: string, newId: () => string): FundingAttempt {
  return previous?.amount === amount && previous.returnUrl === returnUrl
    ? previous
    : { amount, returnUrl, idempotencyKey: newId() };
}

export const FUNDING_POLL_MS = 5_000;
export const FUNDING_POLL_LIMIT = 24;
export function shouldPollFunding(status: FundingSession["status"] | undefined, attempts: number): boolean {
  return attempts < FUNDING_POLL_LIMIT && (status === undefined || status === "pending" || status === "processing");
}

/** Status comes only from the server. Returning from checkout never implies completion. */
export function fundingCopy(status: FundingSession["status"]): { title: string; body: string; mood: "thinking" | "success" | "reassuring" } {
  switch (status) {
    case "completed": return { title: "Practice payment complete", body: "No real money moved and your BilbyPay balance was not credited.", mood: "success" };
    case "processing": return { title: "Ramp is checking it", body: "Your practice payment is still being processed. You can leave this page and check again later.", mood: "thinking" };
    case "failed": return { title: "This practice payment didn't finish", body: "You can start again with a new practice payment. Your BilbyPay balance is unchanged.", mood: "reassuring" };
    case "cancelled": return { title: "Practice payment cancelled", body: "You can try the preview again whenever you're ready. Your BilbyPay balance is unchanged.", mood: "reassuring" };
    case "expired": return { title: "This checkout has expired", body: "Start a new practice payment to continue. Your BilbyPay balance is unchanged.", mood: "reassuring" };
    default: return { title: "Your practice payment", body: "Continue in Ramp to review payment methods and fees. We'll check the result here after checkout.", mood: "thinking" };
  }
}
