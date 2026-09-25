/**
 * Laso webhook verification.
 *
 * Source: LasoFinance/docs llms-full.txt, `POST /register-webhook` (read 2026-09-25): deliveries use
 * Standard Webhooks (https://www.standardwebhooks.com/) — headers `webhook-id`, `webhook-timestamp`
 * (unix seconds), `webhook-signature: v1,<base64 HMAC-SHA256 of "{id}.{timestamp}.{raw body}">`, keyed
 * with the base64-decoded secret after the `whsec_` prefix. Body:
 * `{ type: "notification.<category>", timestamp, data: { user_id, title, text, category } }`,
 * category "giftCard" for gift cards. Deliveries are NOT retried, so treat them as hints only.
 *
 * Verified here only against our own reading of the Standard Webhooks spec, not a live delivery.
 * Bitrefill: webhook signing is not documented (research notes) — there is no verifier for it;
 * treat a Bitrefill webhook as "go and GET the invoice", never as data.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export type WebhookHeaders = Record<string, string | string[] | undefined> | Headers;

function header(headers: WebhookHeaders, name: string): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  const v = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}

export type LasoWebhookEvent = {
  type: string;
  timestamp: string;
  data: { user_id?: string; title?: string; text?: string; category?: string };
};

/**
 * Returns the parsed event if the signature is valid and fresh, otherwise throws.
 * Pass the raw request body exactly as received (before any JSON parsing).
 */
export function verifyLasoWebhook(args: {
  secret: string;
  headers: WebhookHeaders;
  rawBody: string | Uint8Array;
  /** Max clock skew, seconds. Standard Webhooks recommends 5 minutes. */
  toleranceSeconds?: number;
  now?: number;
}): LasoWebhookEvent {
  const id = header(args.headers, "webhook-id");
  const ts = header(args.headers, "webhook-timestamp");
  const sigHeader = header(args.headers, "webhook-signature");
  if (!id || !ts || !sigHeader) throw new Error("Missing webhook signature headers");
  const timestamp = Number(ts);
  const now = args.now ?? Math.floor(Date.now() / 1000);
  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > (args.toleranceSeconds ?? 300)) {
    throw new Error("Webhook timestamp outside tolerance");
  }
  const body = typeof args.rawBody === "string" ? args.rawBody : Buffer.from(args.rawBody).toString("utf8");
  const key = Buffer.from(args.secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest();
  // The header may carry several space-separated signatures (key rotation).
  const ok = sigHeader.split(" ").some((part) => {
    const [version, sig] = part.split(",", 2);
    if (version !== "v1" || !sig) return false;
    const given = Buffer.from(sig, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  if (!ok) throw new Error("Invalid webhook signature");
  return JSON.parse(body) as LasoWebhookEvent;
}

/** Test/helper: produce a Standard Webhooks signature header value. */
export function signStandardWebhook(secret: string, id: string, timestamp: number, body: string): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  return `v1,${createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64")}`;
}
