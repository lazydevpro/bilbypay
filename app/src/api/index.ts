import { API_URL, CHAIN_ID, IS_MOCK } from "../config";
import { createHttpApi } from "./http";
import { createMockApi } from "./mock";
import type { BilbyApi } from "./types";

export * from "./errors";
export type * from "./types";

let sessionToken: string | null = null;
let onExpired: (() => void) | null = null;

export function setSessionToken(token: string | null): void {
  sessionToken = token;
}
export function getSessionToken(): string | null {
  return sessionToken;
}
export function setSessionExpiredHandler(fn: (() => void) | null): void {
  onExpired = fn;
}

const shared = { getToken: () => sessionToken, onSessionExpired: () => onExpired?.() };

/** The app's single API instance: the real server, or the in-app demo when EXPO_PUBLIC_API_URL=mock. */
export const api: BilbyApi = IS_MOCK
  ? createMockApi({ ...shared, chainId: CHAIN_ID })
  : createHttpApi({ ...shared, baseUrl: API_URL });
