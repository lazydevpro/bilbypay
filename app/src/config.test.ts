import { afterEach, describe, expect, it, vi } from "vitest";

const ENV_KEYS = ["EXPO_PUBLIC_API_URL", "EXPO_PUBLIC_CHAIN_ID", "EXPO_PUBLIC_DEMO_KEY"] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

async function load(env: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, env);
  vi.resetModules();
  return import("./config");
}

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("device-key mode (no passkey)", () => {
  it("is allowed on Monad testnet against the real server", async () => {
    const c = await load({ EXPO_PUBLIC_API_URL: "http://192.168.1.5:8787", EXPO_PUBLIC_CHAIN_ID: "10143", EXPO_PUBLIC_DEMO_KEY: "1" });
    expect(c.IS_TESTNET).toBe(true);
    expect(c.DEMO_KEY).toBe(true);
  });

  it("is allowed with the in-app mock API", async () => {
    const c = await load({ EXPO_PUBLIC_API_URL: "mock", EXPO_PUBLIC_DEMO_KEY: "1" });
    expect(c.DEMO_KEY).toBe(true);
  });

  it("is never allowed on mainnet, even if the flag is set", async () => {
    const c = await load({ EXPO_PUBLIC_API_URL: "https://api.bilbypay.com", EXPO_PUBLIC_CHAIN_ID: "143", EXPO_PUBLIC_DEMO_KEY: "1" });
    expect(c.IS_TESTNET).toBe(false);
    expect(c.DEMO_KEY).toBe(false);
  });

  it("is off unless asked for", async () => {
    const c = await load({ EXPO_PUBLIC_API_URL: "http://192.168.1.5:8787", EXPO_PUBLIC_CHAIN_ID: "10143" });
    expect(c.DEMO_KEY).toBe(false);
  });
});
