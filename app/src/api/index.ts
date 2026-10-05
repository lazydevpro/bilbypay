import { API_URL, CHAIN_ID, IS_MOCK, RPC_URL } from "../config";
import { createHttpApi } from "./http";
import { createMockApi } from "./mock";
import type { BilbyApi } from "./types";
import { createPinnedDirectoryReader, type DirectoryReader } from "../directory/verification";
import { trustedDirectoryAddress } from "../signing/directory";

export * from "./errors";
export type * from "./types";

let sessionToken: string | null = null;
let onExpired: (() => void) | null = null;
let onPhoneRequired: (() => void) | null = null;

export function setSessionToken(token: string | null): void {
  sessionToken = token;
}
export function getSessionToken(): string | null {
  return sessionToken;
}
export function setSessionExpiredHandler(fn: (() => void) | null): void {
  onExpired = fn;
}

export function setPhoneRequiredHandler(fn: (() => void) | null): void {
  onPhoneRequired = fn;
}

const shared = {
  getToken: () => sessionToken,
  onSessionExpired: () => onExpired?.(),
  onPhoneRequired: () => onPhoneRequired?.(),
};

/** The app's single API instance: the real server, or the in-app demo when EXPO_PUBLIC_API_URL=mock. */
const mock = IS_MOCK ? createMockApi({ ...shared, chainId: CHAIN_ID }) : null;
export const api: BilbyApi = mock
  ? mock
  : createHttpApi({ ...shared, baseUrl: API_URL });
export const readDirectory: DirectoryReader = mock ? mock.readDirectory : phoneKey => createPinnedDirectoryReader({ chainId: CHAIN_ID, directory: trustedDirectoryAddress(), rpcUrl: RPC_URL })(phoneKey);
