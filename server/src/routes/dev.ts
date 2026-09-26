import { mockAusdAbi } from "@bilbypay/core";
import type { Hono } from "hono";
import { type Address, encodeFunctionData } from "viem";
import { z } from "zod";
import { rateLimit } from "../db";
import { errors } from "../errors";
import type { Services } from "../services";
import { type AppEnv, body, requireSession } from "./common";

const MAX_FAUCET = 500_000_000n; // $500
const DEFAULT_FAUCET = 100_000_000n; // $100

/** Demo/testnet helpers (DEV_FAUCET=1). The token must be MockAUSD, whose mint is open to anyone. */
export function devRoutes(app: Hono<AppEnv>, s: Services) {
  if (!s.config.devFaucet) return;

  app.post("/v1/dev/faucet", requireSession(s), async (c) => {
    const user = c.get("user") as Address;
    const { amount } = await body(c, z.object({ amount: z.string().regex(/^\d{1,30}$/).optional() }));
    const value = amount ? BigInt(amount) : DEFAULT_FAUCET;
    if (value <= 0n || value > MAX_FAUCET) throw errors.invalidRequest("Pick an amount up to $500.");
    if (!rateLimit(s.db, `faucet:${user}`, 10, 24 * 3600_000)) throw errors.rateLimited();
    const data = encodeFunctionData({ abi: mockAusdAbi, functionName: "mint", args: [user, value] });
    const { hash } = await s.relayer.send({ to: s.config.ausd.address, data, label: "dev.faucet" });
    s.activity.add({ address: user, kind: "received", status: "completed", amount: value, note: "Test money", txHash: hash });
    s.keeper.schedule(user);
    return c.json({ ok: true, amount: value.toString() });
  });
}
