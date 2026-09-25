import { createGiftCardProvider, type IdempotencyStore } from "@bilbypay/giftcards";
import type { Config } from "../config";
import { type Db, kvGet, kvSet } from "../db";
import { decryptSecret, encryptSecret } from "../secrets";
import { MockGiftCardProvider } from "./mock";
import type { GiftCardProvider } from "./types";

/**
 * Durable store for the providers' own idempotency records. They hold redemption codes and signed
 * payment authorizations, so values are AES-GCM encrypted with GIFT_CODE_KEY and bound to their key.
 */
export class EncryptedKvStore implements IdempotencyStore {
  constructor(
    private readonly db: Db,
    private readonly key: Buffer,
    private readonly prefix = "giftprovider:",
  ) {}

  async get(key: string): Promise<unknown | undefined> {
    const stored = kvGet(this.db, this.prefix + key);
    return stored === undefined ? undefined : JSON.parse(decryptSecret(this.key, stored, this.prefix + key));
  }

  async set(key: string, value: unknown): Promise<void> {
    kvSet(this.db, this.prefix + key, encryptSecret(this.key, JSON.stringify(value), this.prefix + key));
  }
}

type Factory = (config: Config, db: Db) => GiftCardProvider;

/** Chosen by GIFT_PROVIDER. laso / bitrefill read their own env vars (see packages/giftcards/README.md). */
const FACTORIES: Record<string, Factory> = {
  mock: () => new MockGiftCardProvider(),
  laso: (config, db) => createGiftCardProvider({ ...process.env, GIFT_PROVIDER: "laso" }, { store: new EncryptedKvStore(db, config.giftCodeKey) }),
  bitrefill: (config, db) =>
    createGiftCardProvider({ ...process.env, GIFT_PROVIDER: "bitrefill" }, { store: new EncryptedKvStore(db, config.giftCodeKey) }),
};

export function registerGiftProvider(name: string, factory: Factory) {
  FACTORIES[name] = factory;
}

export function createGiftProvider(config: Config, db: Db): GiftCardProvider {
  const factory = FACTORIES[config.giftProvider];
  if (!factory) throw new Error(`Unknown GIFT_PROVIDER "${config.giftProvider}" (have: ${Object.keys(FACTORIES).join(", ")})`);
  return factory(config, db);
}
