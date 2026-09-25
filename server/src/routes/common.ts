import type { Context, MiddlewareHandler } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { Address } from "viem";
import type { z } from "zod";
import { errors } from "../errors";
import type { Services } from "../services";

export type AppEnv = { Variables: { user: Address } };

export async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  const raw = await c.req.json().catch(() => undefined);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw errors.invalidRequest();
  return parsed.data;
}

/** 🔒 routes: Authorization: Bearer <sessionToken>. */
export function requireSession(s: Services): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const m = /^Bearer (.+)$/i.exec(header);
    if (!m) throw errors.sessionExpired();
    c.set("user", await s.tokens.verifySessionToken(m[1]!));
    await next();
  };
}

export function clientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const fwd = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
    if (fwd) return fwd;
  }
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown"; // in-process requests (tests) have no socket
  }
}
