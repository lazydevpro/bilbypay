import type { Config } from "../config";
import { MockGiftCardProvider } from "./mock";
import type { GiftCardProvider } from "./types";

/**
 * Registration point for gift card providers, chosen by GIFT_PROVIDER. Laso and Bitrefill live in
 * packages/giftcards; wire them here once that package lands, e.g.
 *   laso: (config) => new LasoProvider({ ... }),
 *   bitrefill: (config) => new BitrefillProvider({ apiKey: process.env.BITREFILL_API_KEY! }),
 */
const FACTORIES: Record<string, (config: Config) => GiftCardProvider> = {
  mock: () => new MockGiftCardProvider(),
};

export function registerGiftProvider(name: string, factory: (config: Config) => GiftCardProvider) {
  FACTORIES[name] = factory;
}

export function createGiftProvider(config: Config): GiftCardProvider {
  const factory = FACTORIES[config.giftProvider];
  if (!factory) throw new Error(`Unknown GIFT_PROVIDER "${config.giftProvider}" (have: ${Object.keys(FACTORIES).join(", ")})`);
  return factory(config);
}
