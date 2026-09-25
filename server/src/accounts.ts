import { bilbyDirectoryAbi } from "@bilbypay/core";
import { type Address, encodeFunctionData, type Hex } from "viem";
import { registerMessage, signInMessage, type Tokens, verifySignedMessage } from "./auth";
import type { ChainService } from "./chain";
import type { Config } from "./config";
import { type Db, rateLimit, tx } from "./db";
import { errors, humanizeRevert } from "./errors";
import { maskPhone, normalizePhone, phoneKey, regionOf } from "./phone";
import type { TxSender } from "./relayer";
import type { Profile } from "./types";
import { KeyedMutex, maxBig, nowIso } from "./util";
import type { Verifier } from "./verifier";

export type AccountRow = {
  address: string;
  display_name: string | null;
  phone_e164: string | null;
  phone_key: string | null;
  autosave_enabled: number;
  autosave_threshold: string;
  burrow_net_deposited: string;
  created_at: string;
  updated_at: string;
};

type BindingRow = { phone_key: string; address: string; bound_at: string; rebound_at: string | null; previous_address: string | null };

export type Resolved = {
  phone: string;
  e164: string | null;
  status: "registered" | "invite" | "invalid";
  displayName?: string;
  address?: Address;
  recentlyChanged?: boolean;
};

const RESOLVE_DAILY_LIMIT = 500;
const BIND_TTL_SECONDS = 600n;

export class AccountService {
  private readonly phoneLocks = new KeyedMutex();

  constructor(
    private readonly db: Db,
    private readonly config: Config,
    private readonly chain: ChainService,
    private readonly verifier: Verifier,
    private readonly relayer: TxSender,
    readonly tokens: Tokens,
  ) {}

  get(address: Address): AccountRow | undefined {
    return this.db.prepare("SELECT * FROM accounts WHERE address = ?").get(address) as AccountRow | undefined;
  }

  /** The account, only if it has a verified number (every money route needs one). */
  requireRegistered(address: Address): AccountRow & { display_name: string; phone_e164: string; phone_key: string } {
    const row = this.get(address);
    if (!row?.phone_e164 || !row.phone_key || !row.display_name) throw errors.phoneRequired();
    return row as AccountRow & { display_name: string; phone_e164: string; phone_key: string };
  }

  profile(address: Address): Profile | null {
    const row = this.get(address);
    if (!row?.phone_e164 || !row.display_name) return null;
    return {
      address,
      displayName: row.display_name,
      phone: row.phone_e164,
      phoneMasked: maskPhone(row.phone_e164),
      autoSave: { enabled: row.autosave_enabled === 1, threshold: row.autosave_threshold },
      createdAt: row.created_at,
    };
  }

  phoneKeyOf(e164: string): Hex {
    return phoneKey(this.config.phonePepper, e164);
  }

  async register(input: { phoneToken: string; address: string; displayName: string; issuedAt: number; signature: Hex }) {
    const phone = await this.tokens.verifyPhoneToken(input.phoneToken);
    const address = await verifySignedMessage({
      address: input.address,
      issuedAt: input.issuedAt,
      signature: input.signature,
      build: (a) => registerMessage({ phone: phone.e164, address: a, issuedAt: input.issuedAt }),
    });
    const displayName = input.displayName.trim().replace(/\s+/g, " ");
    if (!displayName || displayName.length > 40) throw errors.invalidRequest("Pick a name between 1 and 40 characters.");

    await this.phoneLocks.run(phone.phoneKey, async () => {
      const current = await this.chain.resolve(phone.phoneKey);
      if (current.account !== address) await this.bindOnChain(phone.phoneKey, address);
      this.recordBinding(address, displayName, phone.e164, phone.phoneKey, current.account);
    });
    return { sessionToken: await this.tokens.sessionToken(address), profile: this.profile(address)! };
  }

  private async bindOnChain(key: Hex, account: Address) {
    const now = BigInt(await this.chain.now());
    // issuedAt must beat the last attestation for this number (the contract rejects replays).
    const issuedAt = maxBig(now, (await this.chain.lastIssuedAt(key)) + 1n);
    const deadline = now + BIND_TTL_SECONDS;
    const signature = await this.verifier.signBind({ phoneKey: key, account, issuedAt, deadline });
    const data = encodeFunctionData({
      abi: bilbyDirectoryAbi,
      functionName: "bind",
      args: [key, account, issuedAt, deadline, signature],
    });
    try {
      await this.relayer.send({ to: this.config.deployment.directory, data, label: "directory.bind" });
    } catch (err) {
      throw humanizeRevert(err);
    }
  }

  private recordBinding(address: Address, displayName: string, e164: string, key: Hex, previousOnChain: Address | null) {
    const now = nowIso();
    tx(this.db, () => {
      const existing = this.db.prepare("SELECT * FROM phone_bindings WHERE phone_key = ?").get(key) as BindingRow | undefined;
      const previous = previousOnChain ?? (existing?.address as Address | undefined) ?? null;
      const rebound = previous !== null && previous !== address;
      if (rebound) {
        // The number left its old account.
        this.db.prepare("UPDATE accounts SET phone_e164 = NULL, phone_key = NULL, updated_at = ? WHERE address = ?").run(now, previous);
      }
      // The account's old number (if it changed numbers) no longer points at it.
      this.db.prepare("DELETE FROM phone_bindings WHERE address = ? AND phone_key != ?").run(address, key);
      if (!existing || existing.address !== address) {
        this.db
          .prepare(
            `INSERT INTO phone_bindings (phone_key, address, bound_at, rebound_at, previous_address) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(phone_key) DO UPDATE SET address = excluded.address, bound_at = excluded.bound_at,
               rebound_at = excluded.rebound_at, previous_address = excluded.previous_address`,
          )
          .run(key, address, now, rebound ? now : null, rebound ? previous : null);
      }
      this.db
        .prepare(
          `INSERT INTO accounts (address, display_name, phone_e164, phone_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(address) DO UPDATE SET display_name = excluded.display_name, phone_e164 = excluded.phone_e164,
             phone_key = excluded.phone_key, updated_at = excluded.updated_at`,
        )
        .run(address, displayName, e164, key, now, now);
    });
  }

  async signIn(input: { address: string; issuedAt: number; signature: Hex }) {
    const address = await verifySignedMessage({
      address: input.address,
      issuedAt: input.issuedAt,
      signature: input.signature,
      build: (a) => signInMessage({ address: a, issuedAt: input.issuedAt }),
    });
    const now = nowIso();
    this.db.prepare("INSERT INTO accounts (address, created_at, updated_at) VALUES (?, ?, ?) ON CONFLICT(address) DO NOTHING").run(address, now, now);
    return { sessionToken: await this.tokens.sessionToken(address), profile: this.profile(address) };
  }

  binding(key: Hex): BindingRow | undefined {
    return this.db.prepare("SELECT * FROM phone_bindings WHERE phone_key = ?").get(key) as BindingRow | undefined;
  }

  /** The number moved to a new account within REBIND_COOLDOWN_DAYS → senders get a warning. */
  recentlyChanged(b: BindingRow | undefined): boolean {
    if (!b?.rebound_at) return false;
    return Date.now() - Date.parse(b.rebound_at) < this.config.rebindCooldownDays * 86_400_000;
  }

  resolve(requester: Address, phones: string[], region?: string): Resolved[] {
    if (!rateLimit(this.db, `resolve:${requester}`, RESOLVE_DAILY_LIMIT, 86_400_000, phones.length)) {
      throw errors.rateLimited("You've looked up a lot of contacts today. Please try again tomorrow.");
    }
    const hint = region ?? regionOf(this.get(requester)?.phone_e164 ?? "");
    return phones.map((phone) => {
      const parsed = normalizePhone(phone, hint);
      if (!parsed) return { phone, e164: null, status: "invalid" as const };
      const b = this.binding(this.phoneKeyOf(parsed.e164));
      if (!b) return { phone, e164: parsed.e164, status: "invite" as const };
      const account = this.get(b.address as Address);
      return {
        phone,
        e164: parsed.e164,
        status: "registered" as const,
        displayName: account?.display_name ?? undefined,
        address: b.address as Address,
        recentlyChanged: this.recentlyChanged(b) || undefined,
      };
    });
  }

  setAutoSave(address: Address, enabled: boolean, threshold: bigint) {
    this.db
      .prepare("UPDATE accounts SET autosave_enabled = ?, autosave_threshold = ?, updated_at = ? WHERE address = ?")
      .run(enabled ? 1 : 0, threshold.toString(), nowIso(), address);
  }

  autoSaveUsers(): Address[] {
    return (this.db.prepare("SELECT address FROM accounts WHERE autosave_enabled = 1").all() as { address: Address }[]).map((r) => r.address);
  }

  /** Tracks principal moved into (+) or out of (−) Burrow, so "earned" = assets − principal. */
  adjustBurrowPrincipal(address: Address, delta: bigint) {
    tx(this.db, () => {
      const row = this.get(address);
      if (!row) return;
      const next = maxBig(0n, BigInt(row.burrow_net_deposited) + delta);
      this.db.prepare("UPDATE accounts SET burrow_net_deposited = ? WHERE address = ?").run(next.toString(), address);
    });
  }
}
