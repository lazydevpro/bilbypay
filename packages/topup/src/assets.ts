import { getAddress, hexToBytes, type Address } from "viem";
import { NETWORKS, monad } from "@bilbypay/core";
import type { TopUpOrigin } from "./types";

/*
 * Asset ids
 * =========
 * NEAR Intents / 1Click identify assets as `nep141:<near-account>` or
 * `nep245:<mt-contract>:<token-id>`.
 *
 * Sources (all read, none guessed unless marked):
 *  [S1] A snapshot of `GET https://1click.chaindefuser.com/v0/tokens` committed at
 *       github.com/fastnear/explorer-frontend res/1click_prices.json (priceUpdatedAt 2026-02-17).
 *       141 entries. Contains Monad USDC + USDT0 + MON. Contains NO AUSD on any network.
 *  [S2] aurora-is-near/intents-swap-widget apps/intents-connect-demo/src/aave/constants.ts:
 *       "Native USDC from the 1Click catalogue ... Monad uses HOT's nep245 identifiers"
 *       DEST_ASSET = 'nep245:v2_1.omni.hot.tg:143_2dmLwYWkCQKyTjeUPAsGJuiVLbFx'.
 *  [S3] @defuse-protocol/intents-sdk@0.88.0 dist/src/bridges/hot-bridge/hot-bridge-utils.js:
 *       Monad (eip155:143) is a HOT-bridge chain, native MON = `nep245:v2_1.omni.hot.tg:143_11111111111111111111`.
 *  [S4] The HOT token-id suffix is base58(20-byte EVM address) (all-zero address → twenty "1"s).
 *       Verified here: hotOmniAssetId() reproduces the USDC and USDT0 ids from [S1] exactly
 *       (see test/assets.test.ts).
 */

export const HOT_OMNI_CONTRACT = "v2_1.omni.hot.tg";

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = "";
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out;
}

/** HOT omni-bridge asset id for an ERC-20 on an EVM chain, per [S4]. */
export function hotOmniAssetId(chainId: number, token: Address): string {
  return `nep245:${HOT_OMNI_CONTRACT}:${chainId}_${base58(hexToBytes(getAddress(token)))}`;
}

const monadNet = NETWORKS[monad.id];

/**
 * Destination assets on Monad.
 *
 * - USDC: verified listed [S1][S2]. This is what 1Click can deliver today.
 * - AUSD: DERIVED ONLY via [S4]. AUSD did not appear in the [S1] catalogue, so a quote to it will
 *   most likely be rejected until HOT/1Click list it. Kept so it can be switched on via config
 *   (`TOPUP_DESTINATION=ausd`) the day it is listed; `scripts/quote-smoke.ts` checks the live list.
 */
export const MONAD_DESTINATIONS = {
  usdc: {
    symbol: "USDC",
    decimals: 6,
    token: monadNet.usdc.address,
    assetId: "nep245:v2_1.omni.hot.tg:143_2dmLwYWkCQKyTjeUPAsGJuiVLbFx",
    verified: true,
  },
  ausd: {
    symbol: "AUSD",
    decimals: 6,
    token: monadNet.ausd.address,
    assetId: hotOmniAssetId(monad.id, monadNet.ausd.address), // = nep245:v2_1.omni.hot.tg:143_1111Wd6DUHQcTT8PJELEThdiwB
    verified: false,
  },
} as const;

export type DestinationKey = keyof typeof MONAD_DESTINATIONS;

/**
 * Where users can top up from. Dollar stablecoins only, so the "amount" the user types is dollars
 * on both ends. Every asset id / decimals below is copied from [S1] (a real /v0/tokens response).
 * Order = order shown in the app.
 */
export const ORIGINS: readonly TopUpOrigin[] = [
  o("base:usdc", "USDC", "Base", "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", 6, "evm"),
  o("arb:usdc", "USDC", "Arbitrum", "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near", 6, "evm"),
  o("eth:usdc", "USDC", "Ethereum", "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near", 6, "evm"),
  o("sol:usdc", "USDC", "Solana", "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", 6, "sol"),
  o("op:usdc", "USDC", "Optimism", "nep245:v2_1.omni.hot.tg:10_A2ewyUyDp6qsue1jqZsGypkCxRJ", 6, "evm"),
  o("pol:usdc", "USDC", "Polygon", "nep245:v2_1.omni.hot.tg:137_qiStmoQJDQPTebaPjgx5VBxZv6L", 6, "evm"),
  o("avax:usdc", "USDC", "Avalanche", "nep245:v2_1.omni.hot.tg:43114_3atVJH3r5c4GqiSYmg9fECvjc47o", 6, "evm"),
  o("bsc:usdc", "USDC", "BNB", "nep245:v2_1.omni.hot.tg:56_2w93GqMcEmQFDru84j3HZZWt557r", 18, "evm"),
  o("near:usdc", "USDC", "NEAR", "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", 6, "near"),
  o("eth:usdt", "USDT", "Ethereum", "nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near", 6, "evm"),
  o("arb:usdt", "USDT", "Arbitrum", "nep141:arb-0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9.omft.near", 6, "evm"),
  o("sol:usdt", "USDT", "Solana", "nep141:sol-c800a4bd850783ccb82c2b2c7e84175443606352.omft.near", 6, "sol"),
  o("tron:usdt", "USDT", "Tron", "nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near", 6, "tron"),
  o("bsc:usdt", "USDT", "BNB", "nep245:v2_1.omni.hot.tg:56_2CMMyVTGZkeyNZTSvS5sarzfir6g", 18, "evm"),
];

function o(
  id: string,
  symbol: string,
  networkLabel: string,
  assetId: string,
  decimals: number,
  addressKind: TopUpOrigin["addressKind"],
): TopUpOrigin {
  return { id, symbol, networkLabel, label: `${symbol} on ${networkLabel}`, assetId, decimals, addressKind };
}

export function findOrigin(idOrAssetId: string, origins: readonly TopUpOrigin[] = ORIGINS): TopUpOrigin | undefined {
  const key = idOrAssetId.trim();
  return origins.find((x) => x.id === key.toLowerCase() || x.assetId === key);
}

/** Scale a 6-decimal USD amount to `decimals` base units (stablecoins treated as $1). */
export function usdToUnits(usd: bigint, decimals: number): bigint {
  return decimals >= 6 ? usd * 10n ** BigInt(decimals - 6) : usd / 10n ** BigInt(6 - decimals);
}

/** Scale base units with `decimals` to 6-decimal USD (rounds down). */
export function unitsToUsd(units: bigint, decimals: number): bigint {
  return decimals >= 6 ? units / 10n ** BigInt(decimals - 6) : units * 10n ** BigInt(6 - decimals);
}
