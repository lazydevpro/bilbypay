import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  platform: "web",
  api: "http://127.0.0.1:8787",
  chainId: 10143,
  directory: "0x1111111111111111111111111111111111111111",
  native: new Map<string, string>(),
}));

vi.mock("react-native", () => ({ Platform: { get OS() { return runtime.platform; } } }));
vi.mock("../config", () => ({
  get API_URL() { return runtime.api; },
  get CHAIN_ID() { return runtime.chainId; },
  get DIRECTORY_ADDRESS() { return runtime.directory; },
}));
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async (key: string) => runtime.native.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => { runtime.native.set(key, value); }),
  deleteItemAsync: vi.fn(async (key: string) => { runtime.native.delete(key); }),
}));

function storage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: key => data.get(key) ?? null,
    key: index => Array.from(data.keys())[index] ?? null,
    removeItem: key => { data.delete(key); },
    setItem: (key, value) => { data.set(key, value); },
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  runtime.platform = "web";
  runtime.api = "http://127.0.0.1:8787";
  runtime.chainId = 10143;
  runtime.directory = "0x1111111111111111111111111111111111111111";
  runtime.native.clear();
  vi.stubGlobal("sessionStorage", storage());
  vi.stubGlobal("localStorage", storage());
});
afterEach(() => vi.unstubAllGlobals());

describe("browser account storage", () => {
  it("restores the account and session after a page reload without SecureStore", async () => {
    const first = await import("./keyStore");
    await first.saveAccountId("0x1234");
    await first.saveSessionToken("test-session");
    await first.savePendingClaim("test-claim");
    vi.resetModules();
    const reloaded = await import("./keyStore");
    expect(await reloaded.loadAccountId()).toBe("0x1234");
    expect(await reloaded.loadSessionToken()).toBe("test-session");
    expect(await reloaded.loadPendingClaim()).toBe("test-claim");
    expect((await import("expo-secure-store")).getItemAsync).not.toHaveBeenCalled();
  });

  it.each(["api", "chainId", "directory"] as const)("does not restore another %s environment's state or test key", async field => {
    const store = await import("./keyStore");
    await store.saveAccountId("0x1234");
    await store.saveSessionToken("test-session");
    const original = await store.demoSecret();
    if (field === "api") runtime.api = "mock";
    if (field === "chainId") runtime.chainId = 143;
    if (field === "directory") runtime.directory = "0x2222222222222222222222222222222222222222";
    expect(await store.loadAccountId()).toBeNull();
    expect(await store.loadSessionToken()).toBeNull();
    expect(await store.demoSecret()).not.toEqual(original);
  });

  it("logout removes the session while preserving the test key for the same account's next login", async () => {
    const store = await import("./keyStore");
    const original = await store.demoSecret();
    await store.saveAccountId("0x1234");
    await store.saveSessionToken("test-session");
    await store.savePendingClaim("test-claim");
    await store.clearAll();
    expect(await store.loadAccountId()).toBeNull();
    expect(await store.loadSessionToken()).toBeNull();
    expect(await store.loadPendingClaim()).toBeNull();
    expect(await store.demoSecret()).toEqual(original);
  });

  it("does not crash account boot when browser session storage is unavailable", async () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
    });
    const store = await import("./keyStore");
    expect(await store.loadSessionToken()).toBeNull();
    expect(await store.loadAccountId()).toBeNull();
    await expect(store.saveSessionToken("test-session")).resolves.toBeUndefined();
  });

  it("keeps using native secure storage on phones", async () => {
    runtime.platform = "android";
    const store = await import("./keyStore");
    await store.saveAccountId("0x1234");
    await store.saveSessionToken("test-session");
    expect(await store.loadAccountId()).toBe("0x1234");
    expect(await store.loadSessionToken()).toBe("test-session");
    expect(globalThis.sessionStorage.length).toBe(0);
    await store.clearAll();
    expect(await store.loadAccountId()).toBeNull();
    expect(await store.loadSessionToken()).toBeNull();
  });
});
