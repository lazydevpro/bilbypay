import type { Status } from "../state/session";

/** Only retain an opaque funding id, never an arbitrary redirect URL. */
export function fundingReturnId(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : undefined;
}

/** Explicit destinations avoid the two index routes that share the web URL '/'. */
export function sessionDestination(status: Status, pendingClaim: string | null = null, fundingId?: string) {
  switch (status) {
    case "loading":
    case "ready": return null;
    case "signedOut": return { pathname: "/welcome" as const };
    case "locked": return { pathname: "/unlock" as const, params: { funding: fundingReturnId(fundingId) ?? "" } };
    case "pendingPhone": return { pathname: "/settings/phone" as const };
    case "needsPhone": return { pathname: "/phone" as const, params: { purpose: pendingClaim ? "claim" : "onboard", code: pendingClaim ?? "" } };
  }
}
