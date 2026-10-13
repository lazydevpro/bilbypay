import type { ConfigContext, ExpoConfig } from "expo/config";

// The passkey domain (rpId) must match the domain serving /.well-known/{apple-app-site-association,assetlinks.json}.
// app.json keeps bilbypay.com; builds can point at another domain (e.g. bilbypay.pages.dev) via EXPO_PUBLIC_RP_ID.
// Passkeys are bound to their domain: accounts created on one domain don't work on another.
const RP_ID = process.env.EXPO_PUBLIC_RP_ID || "bilbypay.com";
const LINK_DOMAIN = process.env.EXPO_PUBLIC_LINK_DOMAIN || RP_ID;
// Lets a dev build fetch the association file directly instead of via Apple's CDN (also enable
// Settings → Developer → Associated Domains Development on the iPhone).
const ASSOCIATED_MODE = process.env.APPLE_ASSOCIATED_DOMAINS_DEV === "1" ? "?mode=developer" : "";

export default ({ config }: ConfigContext): ExpoConfig => {
  const domains = [...new Set([RP_ID, LINK_DOMAIN])];
  return {
    ...(config as ExpoConfig),
    ios: {
      ...config.ios,
      associatedDomains: [
        `webcredentials:${RP_ID}${ASSOCIATED_MODE}`,
        `applinks:${LINK_DOMAIN}${ASSOCIATED_MODE}`,
      ],
    },
    android: {
      ...config.android,
      intentFilters: [
        {
          action: "VIEW",
          autoVerify: true,
          data: domains.map((host) => ({ scheme: "https", host, pathPrefix: "/c/" })),
          category: ["BROWSABLE", "DEFAULT"],
        },
      ],
    },
  };
};
