/** Build-time settings (EXPO_PUBLIC_* are inlined by Metro). */

const isDev = typeof __DEV__ !== "undefined" && __DEV__;

/**
 * `mock` runs the app against the in-app demo implementation of the API. Unset: demo in development
 * builds, the real server in release builds (so a release can never ship in demo mode by accident).
 */
export const API_URL: string = process.env.EXPO_PUBLIC_API_URL || (isDev ? "mock" : "https://api.bilbypay.com");
export const IS_MOCK = API_URL === "mock";

export const CHAIN_ID = Number(process.env.EXPO_PUBLIC_CHAIN_ID ?? "143");

/** Domain for claim links and universal links. */
export const LINK_DOMAIN: string = process.env.EXPO_PUBLIC_LINK_DOMAIN ?? "bilbypay.com";

/** Monad testnet: test dollars only, nothing of value. */
export const TESTNET_CHAIN_ID = 10143;
export const IS_TESTNET = CHAIN_ID === TESTNET_CHAIN_ID;

/**
 * Demo/testing only: keep a device-local key instead of a passkey, so the app runs on a simulator or a phone
 * before the passkey domain exists. Honoured only with the mock API or on Monad testnet — never on mainnet.
 */
export const DEMO_KEY = (IS_MOCK || IS_TESTNET) && process.env.EXPO_PUBLIC_DEMO_KEY === "1";
