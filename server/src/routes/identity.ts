import type { Hono } from "hono";
import { isHex } from "viem";
import { z } from "zod";
import { rateLimit } from "../db";
import { errors } from "../errors";
import { maskPhone, normalizePhone } from "../phone";
import type { Services } from "../services";
import { type AppEnv, body, clientIp, requireSession } from "./common";

const OTP_TTL_SECONDS = 600;
const HOUR = 3_600_000;
const hex = z.string().refine((v) => isHex(v), "hex");

/** OTP, registration, sign-in, profile. */
export function identityRoutes(app: Hono<AppEnv>, s: Services) {
  app.post("/v1/otp/start", async (c) => {
    const { phone, region } = await body(c, z.object({ phone: z.string().max(40), region: z.string().length(2).optional() }));
    const parsed = normalizePhone(phone, region);
    if (!parsed) throw errors.phoneInvalid();
    const ip = clientIp(c, s.config.trustProxy);
    if (!rateLimit(s.db, `otp_start:ip:${ip}`, 20, HOUR)) throw errors.rateLimited();
    if (!rateLimit(s.db, `otp_start:phone:${parsed.e164}`, 5, HOUR)) throw errors.rateLimited("We've sent a lot of codes to this number. Please wait an hour and try again.");
    await s.otp.start(parsed.e164);
    const now = Date.now();
    s.db
      .prepare(
        "INSERT INTO otp_sessions (phone_e164, started_at, expires_at) VALUES (?, ?, ?) ON CONFLICT(phone_e164) DO UPDATE SET started_at = excluded.started_at, expires_at = excluded.expires_at",
      )
      .run(parsed.e164, now, now + OTP_TTL_SECONDS * 1000);
    return c.json({ ok: true, expiresInSeconds: OTP_TTL_SECONDS });
  });

  app.post("/v1/otp/verify", async (c) => {
    const { phone, code, region } = await body(
      c,
      z.object({ phone: z.string().max(40), code: z.string().max(12), region: z.string().length(2).optional() }),
    );
    const parsed = normalizePhone(phone, region);
    if (!parsed) throw errors.phoneInvalid();
    // Brute-force guard: 6 digits is only 10^6 guesses.
    if (!rateLimit(s.db, `otp_verify:${parsed.e164}`, 10, 10 * 60_000)) throw errors.rateLimited();
    const session = s.db.prepare("SELECT expires_at FROM otp_sessions WHERE phone_e164 = ?").get(parsed.e164) as { expires_at: number } | undefined;
    if (!session || session.expires_at < Date.now()) throw errors.otpExpired();
    if (!(await s.otp.check(parsed.e164, code.trim()))) throw errors.otpInvalid();
    s.db.prepare("DELETE FROM otp_sessions WHERE phone_e164 = ?").run(parsed.e164);
    const phoneToken = await s.tokens.phoneToken({ phoneKey: s.accounts.phoneKeyOf(parsed.e164), e164: parsed.e164 });
    return c.json({ phoneToken, phone: parsed.e164, phoneMasked: maskPhone(parsed.e164) });
  });

  app.post("/v1/accounts/register", async (c) => {
    const input = await body(
      c,
      z.object({ phoneToken: z.string(), address: z.string(), displayName: z.string().max(80), issuedAt: z.number().int(), signature: hex }),
    );
    return c.json(await s.accounts.register({ ...input, signature: input.signature as `0x${string}` }));
  });

  app.post("/v1/session", async (c) => {
    const input = await body(c, z.object({ address: z.string(), issuedAt: z.number().int(), signature: hex }));
    return c.json(await s.accounts.signIn({ ...input, signature: input.signature as `0x${string}` }));
  });

  app.get("/v1/me", requireSession(s), (c) => {
    const profile = s.accounts.profile(c.get("user"));
    if (!profile) throw errors.phoneRequired();
    return c.json(profile);
  });
}
