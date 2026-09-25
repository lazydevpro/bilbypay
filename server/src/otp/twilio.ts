import { errors } from "../errors";
import type { OtpProvider } from "./index";

/**
 * Twilio Verify over its REST API (no SDK). Twilio owns code generation, expiry and delivery;
 * we only rate-limit in front of it. Not exercised by tests (needs real credentials).
 */
export class TwilioVerifyProvider implements OtpProvider {
  readonly name = "twilio";
  private readonly base: string;
  private readonly auth: string;

  constructor(creds: { accountSid: string; authToken: string; verifyServiceSid: string }) {
    this.base = `https://verify.twilio.com/v2/Services/${creds.verifyServiceSid}`;
    this.auth = `Basic ${Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString("base64")}`;
  }

  private async post(path: string, form: Record<string, string>): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await fetch(`${this.base}${path}`, {
      method: "POST",
      headers: { Authorization: this.auth, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: res.status, body };
  }

  async start(e164: string): Promise<void> {
    const { status, body } = await this.post("/Verifications", { To: e164, Channel: "sms" });
    if (status === 429) throw errors.rateLimited();
    // 400s are invalid / landline / unsupported-region numbers.
    if (status === 400) throw errors.phoneInvalid("We can't send a code to that number. Check it and try again.");
    if (status >= 300) throw new Error(`Twilio Verify start failed: ${status} ${String(body.code ?? "")}`);
  }

  async check(e164: string, code: string): Promise<boolean> {
    const { status, body } = await this.post("/VerificationCheck", { To: e164, Code: code });
    // 404: no pending verification (expired, or already approved).
    if (status === 404) throw errors.otpExpired();
    if (status === 429) throw errors.rateLimited();
    if (status >= 300) throw new Error(`Twilio Verify check failed: ${status} ${String(body.code ?? "")}`);
    return body.status === "approved";
  }
}
