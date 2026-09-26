import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Deployment, getNetwork, type TokenInfo } from "@bilbypay/core";
import { type Address, getAddress, type Hex, isHex } from "viem";

export const SERVER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = resolve(SERVER_ROOT, "..");

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
  databasePath: string;
  rebindCooldownDays: number;
  escrowExpiryDays: number;
  actionTtlSeconds: number;
  giftProvider: string;
  burrowRatePercent: number;
  aavePool?: Address;
  trustProxy: boolean;
  /** Demo/testnet only: POST /v1/dev/faucet mints mock AUSD to the caller. */
  devFaucet: boolean;
  keeper: { enabled: boolean; intervalMs: number; debounceMs: number; blockRange: number };
};

type Env = Record<string, string | undefined>;

function devFaucet(env: Env, chainId: number): boolean {
  if (env.DEV_FAUCET !== "1") return false;
  // Mainnet AUSD can't be minted anyway; refuse the flag there unless it's a local anvil posing as 143.
  const local = /^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(env.RPC_URL ?? "");
  if (chainId === 143 && !local) throw new Error("DEV_FAUCET is for testnet and local chains only");
  return true;
}

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
      : resolve(REPO_ROOT, "contracts/deployments", `${chainId}.json`);
  const raw: Record<string, string | number> = file
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
    databasePath: env.DATABASE_PATH === ":memory:" ? ":memory:" : resolve(SERVER_ROOT, env.DATABASE_PATH ?? "data/bilbypay.db"),
    rebindCooldownDays: Number(env.REBIND_COOLDOWN_DAYS ?? "7"),
    escrowExpiryDays: Number(env.ESCROW_EXPIRY_DAYS ?? "14"),
    actionTtlSeconds: Number(env.ACTION_TTL_SECONDS ?? "600"),
    giftProvider: env.GIFT_PROVIDER ?? "mock",
    burrowRatePercent: Number(env.BURROW_RATE_PERCENT ?? "4.2"),
    aavePool: env.AAVE_POOL_ADDRESS ? getAddress(env.AAVE_POOL_ADDRESS) : undefined,
    trustProxy: env.TRUST_PROXY === "1",
    devFaucet: devFaucet(env, chainId),
    keeper: {
      enabled: env.KEEPER_ENABLED !== "0",
      intervalMs: Number(env.KEEPER_INTERVAL_MS ?? "2000"),
      debounceMs: Number(env.KEEPER_DEBOUNCE_MS ?? "3000"),
      // Monad RPCs serve limited log history and cap getLogs ranges; keep windows small.
      blockRange: Number(env.KEEPER_BLOCK_RANGE ?? "100"),
    },
  };
}
