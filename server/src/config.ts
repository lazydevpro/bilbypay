import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Deployment, getNetwork, type TokenInfo } from "@bilbypay/core";
import { type Address, getAddress, type Hex, isHex } from "viem";

// Bundled (Cloudflare Worker) builds have no module file path; nothing there reads files relative to it.
export const SERVER_ROOT = (() => {
  try { return resolve(dirname(fileURLToPath(import.meta.url)), ".."); } catch { return "/"; }
})();
const REPO_ROOT = resolve(SERVER_ROOT, "..");

export type RampConfig = {
  mode: "disabled" | "sandbox";
  hostApiKey?: string;
  hostLogoUrl?: string;
  webhookBaseUrl?: string;
  returnOrigins: string[];
  sandboxAsset: string;
};

export type Config = {
  port: number;
  chainId: number;
  rpcUrl: string;
  /** How often viem polls for receipts/blocks. Monad blocks are ~400ms. */
  pollingIntervalMs: number;
  deployment: Deployment;
  ausd: TokenInfo;
  /** Top-ups land as USDC in the treasury; the server credits users the same amount in AUSD. */
  usdc?: Address;
  stata: TokenInfo;
  explorerUrl?: string;
  keys: { relayer: Hex; verifier: Hex; keeper: Hex; treasury: Hex };
  phonePepper: string;
  tokenSecret: Uint8Array;
  giftCodeKey: Buffer;
  otp: {
    provider: "test" | "twilio";
    /** Test provider: accept 000000 for every number, not just +1555… */
    testAll: boolean;
    twilio?: { accountSid: string; authToken: string; verifyServiceSid: string };
  };
  publicBaseUrl: string;
  appStoreUrl?: string;
  playStoreUrl?: string;
  /** Web build of the app (claim links offer it as "Open in your browser"). */
  webAppUrl?: string;
  databasePath: string;
  directoryStartBlock: bigint;
  rebindCooldownDays: number;
  escrowExpiryDays: number;
  actionTtlSeconds: number;
  giftProvider: string;
  burrowRatePercent: number;
  aavePool?: Address;
  trustProxy: boolean;
  keeper: { enabled: boolean; intervalMs: number; debounceMs: number; blockRange: number };
  ramp: RampConfig;
  /** Agora AUSD API. Metrics are public; routes/transactions need AGORA_API_KEY. */
  agora: { apiKey?: string; baseUrl?: string };
  /** Testnet only: test dollars minted to each new account (0 = off). */
  testnetWelcomeUsd: number;
  topup: TopUpConfig;
};

/**
 * Top-up provider settings. `env` is what @bilbypay/topup's createTopUpProviderFromEnv reads (passed explicitly
 * so the Worker doesn't depend on process.env). `delivery` is where the provider's USDC delivery to the treasury
 * is checked before anyone is credited.
 */
export type TopUpConfig = {
  env: Record<string, string | undefined>;
  provider: "aurora" | "oneclick" | "mock";
  delivery: { chainId: number; rpcUrl: string; usdc?: Address };
  /** Real deliveries credited as test dollars (testnet server, live provider): top-ups are capped. */
  crossNetwork: boolean;
};

type Env = Record<string, string | undefined>;

function required(env: Env, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`Missing env ${name} (see server/.env.example)`);
  return value;
}

function privateKey(env: Env, name: string, fallback?: string): Hex {
  const value = env[name] || fallback;
  if (!value || !isHex(value) || value.length !== 66) throw new Error(`${name} must be a 0x-prefixed 32-byte hex key`);
  return value;
}

/** A 32-byte secret given as hex (0x…) or base64. */
function secretBytes(env: Env, name: string): Buffer {
  const raw = required(env, name);
  const bytes = isHex(raw) ? Buffer.from(raw.slice(2), "hex") : Buffer.from(raw, "base64");
  if (bytes.length !== 32) throw new Error(`${name} must be 32 bytes (hex or base64)`);
  return bytes;
}

function loadDeployment(env: Env, chainId: number): Deployment {
  const file = env.DEPLOYMENT_FILE
    ? resolve(SERVER_ROOT, env.DEPLOYMENT_FILE)
    : env.AUSD_ADDRESS
      ? undefined
      : resolve(REPO_ROOT, "contracts/deployments", `${chainId}-v2.json`);
  // DEPLOYMENT_JSON: the manifest itself, for builds without a filesystem (the Worker bundles it).
  const raw: Record<string, string | number> = env.DEPLOYMENT_JSON
    ? JSON.parse(env.DEPLOYMENT_JSON)
    : file
    ? JSON.parse(readFileSync(file, "utf8"))
    : {
        chainId,
        ausd: required(env, "AUSD_ADDRESS"),
        stata: required(env, "STATA_ADDRESS"),
        directory: required(env, "DIRECTORY_ADDRESS"),
        escrow: required(env, "ESCROW_ADDRESS"),
        router: required(env, "ROUTER_ADDRESS"),
      };
  if (Number(raw.chainId) !== chainId) throw new Error(`Deployment is for chain ${raw.chainId}, CHAIN_ID is ${chainId}`);
  const addr = (k: string) => getAddress(String(raw[k]));
  return { chainId, ausd: addr("ausd"), stata: addr("stata"), directory: addr("directory"), escrow: addr("escrow"), router: addr("router") };
}

/** AGORA_API_KEY is optional (public metrics work without it); AGORA_API_BASE must be HTTPS (the key is sent there). */
export function loadAgoraConfig(env: Env): Config["agora"] {
  const baseUrl = env.AGORA_API_BASE || undefined;
  if (baseUrl && !/^https:\/\/[^/@\s]+\/?$/.test(baseUrl)) throw new Error("AGORA_API_BASE must be an HTTPS origin, e.g. https://api.agora.finance");
  return { apiKey: env.AGORA_API_KEY || undefined, baseUrl };
}

/** No production Ramp endpoint or mode can be enabled by environment configuration. */
export function loadRampConfig(env: Env): RampConfig {
  const mode = env.RAMP_MODE || "disabled";
  if (mode !== "disabled" && mode !== "sandbox") throw new Error("RAMP_MODE must be disabled or sandbox; live funding is not implemented");
  const externalHttps = (value: string | undefined, name: string, originOnly = false) => {
    if (!value) return undefined;
    let url: URL;
    try { url = new URL(value); } catch { throw new Error(`${name} must be an external HTTPS URL`); }
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      /^(localhost|127\.|0\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[.*\])/.test(url.hostname) ||
      url.hostname.endsWith(".localhost") || url.hostname.endsWith(".local") || !url.hostname.includes(".") ||
      (originOnly && url.pathname !== "/")) throw new Error(`${name} must be an external HTTPS ${originOnly ? "origin" : "URL"}`);
    return originOnly ? url.origin : url.href;
  };
  const returnOrigins = (env.RAMP_RETURN_ORIGINS || "").split(",").map((x) => x.trim()).filter(Boolean);
  for (const origin of returnOrigins) {
    if (origin === "bilbypay://") continue;
    let url: URL;
    try { url = new URL(origin); } catch { throw new Error("RAMP_RETURN_ORIGINS must contain exact HTTP(S) origins or bilbypay://"); }
    const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((!localHttp && url.protocol !== "https:") || url.origin !== origin || url.username || url.password || url.hostname.includes("*")) {
      throw new Error("RAMP_RETURN_ORIGINS requires exact HTTPS origins, HTTP loopback origins, or bilbypay://");
    }
  }
  const sandboxAsset = env.RAMP_SANDBOX_ASSET || "BASE_USDC";
  if (!/^[A-Z0-9]+_[A-Z0-9]+$/.test(sandboxAsset)) throw new Error("RAMP_SANDBOX_ASSET must be an exact provider asset identifier");
  return { mode, hostApiKey: env.RAMP_HOST_API_KEY || undefined, sandboxAsset, returnOrigins,
    hostLogoUrl: externalHttps(env.RAMP_HOST_LOGO_URL, "RAMP_HOST_LOGO_URL"),
    webhookBaseUrl: externalHttps(env.RAMP_WEBHOOK_BASE_URL, "RAMP_WEBHOOK_BASE_URL", true) };
}

function welcomeUsd(env: Env, chainId: number): number {
  const usd = Number(env.TESTNET_WELCOME_USD ?? "0");
  if (!Number.isFinite(usd) || usd < 0 || usd > 10_000) throw new Error("TESTNET_WELCOME_USD must be between 0 and 10000");
  if (usd > 0 && chainId === 143) throw new Error("TESTNET_WELCOME_USD is testnet-only (it mints test dollars)");
  return usd;
}

export function loadConfig(rawEnv: Env = process.env): Config {
  // Blank lines copied from .env.example mean "use the default".
  const env: Env = Object.fromEntries(Object.entries(rawEnv).filter(([, v]) => v !== undefined && v !== ""));
  const chainId = Number(env.CHAIN_ID ?? "143");
  const network = getNetwork(chainId);
  const deployment = loadDeployment(env, chainId);
  // Token domains come from @bilbypay/core; addresses from the deployment (local mocks use the same domains).
  const ausd: TokenInfo = { ...network.ausd, address: deployment.ausd };
  const stata: TokenInfo = {
    ...(network.stata ?? { decimals: 6, domainName: env.STATA_DOMAIN_NAME ?? "Wrapped Aave Monad AUSD", domainVersion: "1" }),
    address: deployment.stata,
  };
  const relayer = privateKey(env, "RELAYER_PRIVATE_KEY");
  const otpProvider = (env.OTP_PROVIDER ?? "test") as Config["otp"]["provider"];
  if (otpProvider !== "test" && otpProvider !== "twilio") throw new Error("OTP_PROVIDER must be test or twilio");

  return {
    port: Number(env.PORT ?? "8787"),
    chainId,
    rpcUrl: env.RPC_URL || network.chain.rpcUrls.default.http[0]!,
    pollingIntervalMs: Number(env.POLLING_INTERVAL_MS ?? "250"),
    deployment,
    ausd,
    stata,
    usdc: (env.USDC_ADDRESS ?? network.usdc?.address) as Address | undefined,
    explorerUrl: env.EXPLORER_URL ?? network.chain.blockExplorers?.default.url,
    keys: {
      relayer,
      verifier: privateKey(env, "VERIFIER_PRIVATE_KEY"),
      keeper: privateKey(env, "KEEPER_PRIVATE_KEY", relayer),
      treasury: privateKey(env, "TREASURY_PRIVATE_KEY"),
    },
    phonePepper: required(env, "PHONE_PEPPER"),
    tokenSecret: secretBytes(env, "TOKEN_SECRET"),
    giftCodeKey: secretBytes(env, "GIFT_CODE_KEY"),
    otp: {
      provider: otpProvider,
      testAll: env.OTP_TEST_ALL === "1",
      twilio:
        otpProvider === "twilio"
          ? {
              accountSid: required(env, "TWILIO_ACCOUNT_SID"),
              authToken: required(env, "TWILIO_AUTH_TOKEN"),
              verifyServiceSid: required(env, "TWILIO_VERIFY_SERVICE_SID"),
            }
          : undefined,
    },
    publicBaseUrl: (env.PUBLIC_BASE_URL ?? "http://localhost:8787").replace(/\/$/, ""),
    appStoreUrl: env.APP_STORE_URL || undefined,
    playStoreUrl: env.PLAY_STORE_URL || undefined,
    webAppUrl: env.WEB_APP_URL ? env.WEB_APP_URL.replace(/\/$/, "") : undefined,
    databasePath: env.DATABASE_PATH === ":memory:" ? ":memory:" : resolve(SERVER_ROOT, env.DATABASE_PATH ?? "data/bilbypay.db"),
    directoryStartBlock: BigInt(env.DIRECTORY_START_BLOCK ?? "0"),
    rebindCooldownDays: Number(env.REBIND_COOLDOWN_DAYS ?? "7"),
    escrowExpiryDays: Number(env.ESCROW_EXPIRY_DAYS ?? "14"),
    actionTtlSeconds: Number(env.ACTION_TTL_SECONDS ?? "600"),
    giftProvider: env.GIFT_PROVIDER ?? "mock",
    burrowRatePercent: Number(env.BURROW_RATE_PERCENT ?? "4.2"),
    aavePool: env.AAVE_POOL_ADDRESS ? getAddress(env.AAVE_POOL_ADDRESS) : undefined,
    trustProxy: env.TRUST_PROXY === "1",
    keeper: {
      enabled: env.KEEPER_ENABLED !== "0",
      intervalMs: Number(env.KEEPER_INTERVAL_MS ?? "2000"),
      debounceMs: Number(env.KEEPER_DEBOUNCE_MS ?? "3000"),
      // Monad RPCs serve limited log history and cap getLogs ranges; keep windows small.
      blockRange: Number(env.KEEPER_BLOCK_RANGE ?? "100"),
    },
    ramp: loadRampConfig(env),
    agora: loadAgoraConfig(env),
    testnetWelcomeUsd: welcomeUsd(env, chainId),
    topup: loadTopUpConfig(env, chainId, env.RPC_URL || network.chain.rpcUrls.default.http[0]!, (env.USDC_ADDRESS ?? network.usdc?.address) as Address | undefined),
  };
}

/**
 * A live provider (aurora/oneclick) can only deliver real USDC on Monad mainnet. On mainnet that's the chain we
 * run on. On a testnet server it means "real money in, test dollars out": the delivery is verified on mainnet
 * (TOPUP_DELIVERY_RPC_URL, default the public Monad RPCs; TOPUP_DELIVERY_USDC, default native USDC) and the user
 * is credited 1:1 in test dollars from the treasury on this testnet. That cross-network mode is refused on mainnet.
 */
function loadTopUpConfig(env: Env, chainId: number, rpcUrl: string, usdc: Address | undefined): TopUpConfig {
  const topupEnv = Object.fromEntries(Object.entries(env).filter(([k]) => k.startsWith("TOPUP_") || k.startsWith("INTENTS_")));
  const provider = (env.TOPUP_PROVIDER || (env.INTENTS_API_KEY ? "aurora" : "mock")).toLowerCase() as TopUpConfig["provider"];
  if (!["aurora", "oneclick", "mock"].includes(provider)) throw new Error(`TOPUP_PROVIDER must be aurora, oneclick or mock (got ${provider})`);
  const crossNetwork = env.TOPUP_DELIVERY_RPC_URL || env.TOPUP_DELIVERY_USDC;
  if (chainId === 143) {
    if (crossNetwork) throw new Error("TOPUP_DELIVERY_RPC_URL/TOPUP_DELIVERY_USDC are testnet-only (mainnet verifies deliveries on its own chain)");
    return { env: topupEnv, provider, delivery: { chainId, rpcUrl, usdc }, crossNetwork: false };
  }
  if (provider === "mock") {
    if (crossNetwork) throw new Error("TOPUP_DELIVERY_* needs a live TOPUP_PROVIDER (aurora or oneclick)");
    return { env: topupEnv, provider, delivery: { chainId, rpcUrl, usdc }, crossNetwork: false };
  }
  const mainnet = getNetwork(143);
  return {
    env: topupEnv,
    provider,
    delivery: {
      chainId: 143,
      rpcUrl: env.TOPUP_DELIVERY_RPC_URL || mainnet.chain.rpcUrls.default.http.join(","),
      usdc: getAddress(env.TOPUP_DELIVERY_USDC || mainnet.usdc!.address),
    },
    crossNetwork: true,
  };
}
