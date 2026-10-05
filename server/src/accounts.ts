import { type Address, type Hex } from "viem";
import { registerMessage, signInMessage, type Tokens, verifySignedMessage } from "./auth";
import { bindingActive, isZeroAddress, pendingActive, type ChainService, type DirectoryState } from "./chain";
import type { Config } from "./config";
import { type Db, rateLimit, tx } from "./db";
import { errors } from "./errors";
import { DirectoryRequests } from "./directory-requests";
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

export type BindingRow = { phone_key: string; address: string; bound_at: string; rebound_at: string | null; previous_address: string | null; revision: string; phone_epoch: string; valid_until: number; revoked: number; pending_account: string | null; pending_available_at: number | null; pending_expires_at: number | null; observed_block: string | null };

export type DirectoryProof = { phoneKey: Hex; revision: string; ownershipEpoch: string; validUntil: string | null; pending: boolean };

export type Resolved = {
  phone: string;
  e164: string | null;
  status: "registered" | "invite" | "invalid" | "unavailable";
  directory?: DirectoryProof;
  displayName?: string;
  address?: Address;
  recentlyChanged?: boolean;
};

const RESOLVE_DAILY_LIMIT = 500;

export class AccountService {
  private readonly phoneLocks = new KeyedMutex();
  readonly directory: DirectoryRequests;

  constructor(
    private readonly db: Db,
    private readonly config: Config,
    private readonly chain: ChainService,
    private readonly verifier: Verifier,
    private readonly relayer: TxSender,
    readonly tokens: Tokens,
  ) {
    this.directory = new DirectoryRequests(db, config, chain, verifier, relayer, tokens);
  }

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

  async register(input: { phoneToken: string; address: string; displayName: string; issuedAt: number; signature: Hex; registrationId: string; consentSignature: Hex; controllerSignature?: Hex }) {
    const phone = await this.tokens.verifyPhoneToken(input.phoneToken);
    const address = await verifySignedMessage({
      address: input.address, issuedAt: input.issuedAt, signature: input.signature,
      build: (a) => registerMessage({ phone: phone.e164, address: a, issuedAt: input.issuedAt }),
    });
    const displayName = input.displayName.trim().replace(/\s+/g, " ");
    if (!displayName || displayName.length > 40) throw errors.invalidRequest("Pick a name between 1 and 40 characters.");
    return this.phoneLocks.run(phone.phoneKey, async () => {
      const result = await this.directory.submitRegistration({ ...input, account: address });
      const now = nowIso();
      const current = await this.refreshBinding(phone.phoneKey);
      if (result.status === "registered") {
        if (!bindingActive(current) || current.binding.account.toLowerCase() !== address.toLowerCase()) throw errors.recipientChanged();
        // Keep the former holder's profile: losing a phone alias must not lock them out of their funds.
        this.db.prepare(`INSERT INTO accounts (address, display_name, phone_e164, phone_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(address) DO UPDATE SET display_name = excluded.display_name, phone_e164 = excluded.phone_e164,
          phone_key = excluded.phone_key, updated_at = excluded.updated_at`).run(address, displayName, phone.e164, phone.phoneKey, now, now);
      } else {
        if (!pendingActive(current) || current.pending.account.toLowerCase() !== address.toLowerCase()) throw errors.recipientChanged();
        this.db.prepare("INSERT INTO accounts (address, display_name, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(address) DO NOTHING").run(address, displayName, now, now);
      }
      return { status: result.status, sessionToken: await this.tokens.sessionToken(address), profile: await this.profileWithStatus(address), ...(result.availableAt ? { availableAt: result.availableAt } : {}) };
    });
  }

  /** Reconcile public routing state only. Historical profile data never grants a phone claim. */
  cacheBinding(key: Hex, state: DirectoryState) {
    const old = this.binding(key);
    if (old?.observed_block && BigInt(old.observed_block) > state.blockNumber) return;
    const b = state.binding;
    const changed = !isZeroAddress(b.account) && !!old && old.address.toLowerCase() !== b.account.toLowerCase();
    const rebound = b.phoneEpoch > 0n ? new Date(Number(b.boundAt) * 1000).toISOString() : null;
    this.db.prepare(`INSERT INTO phone_bindings (phone_key,address,bound_at,rebound_at,previous_address,revision,phone_epoch,valid_until,changed_at,revoked,pending_account,pending_available_at,pending_expires_at,observed_block)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(phone_key) DO UPDATE SET address=excluded.address,bound_at=excluded.bound_at,rebound_at=excluded.rebound_at,
      previous_address=excluded.previous_address,revision=excluded.revision,phone_epoch=excluded.phone_epoch,valid_until=excluded.valid_until,changed_at=excluded.changed_at,
      revoked=excluded.revoked,pending_account=excluded.pending_account,pending_available_at=excluded.pending_available_at,pending_expires_at=excluded.pending_expires_at,observed_block=excluded.observed_block`)
      .run(key, b.account, new Date(Number(b.boundAt) * 1000).toISOString(), rebound, changed ? old.address : old?.previous_address ?? null,
        b.revision.toString(), b.phoneEpoch.toString(), Number(b.validUntil), Number(b.boundAt), b.revoked ? 1 : 0,
        isZeroAddress(state.pending.account) ? null : state.pending.account, Number(state.pending.executableAt) || null, Number(state.pending.expiresAt) || null, state.blockNumber.toString());
  }

  async refreshBinding(key: Hex) {
    const state = await this.chain.directoryState(key);
    this.cacheBinding(key, state);
    return state;
  }

  proof(key: Hex, state: DirectoryState): DirectoryProof {
    return { phoneKey: key, revision: state.binding.revision.toString(), ownershipEpoch: state.binding.phoneEpoch.toString(),
      validUntil: state.binding.validUntil ? new Date(Number(state.binding.validUntil) * 1000).toISOString() : null, pending: pendingActive(state) };
  }

  async phoneStatus(address: Address) {
    const row = this.get(address);
    const latest = this.directory.latestPhone(address);
    // A pending request to a new number is visible even when the account already has an old alias.
    const candidate = latest ? await this.refreshBinding(latest.phone_key) : null;
    const useLatest = candidate && pendingActive(candidate) && candidate.pending.account.toLowerCase() === address.toLowerCase();
    const key = (useLatest ? latest?.phone_key : row?.phone_key ?? latest?.phone_key) as Hex | undefined;
    const phone = (useLatest ? latest?.phone_e164 : row?.phone_e164 ?? latest?.phone_e164) ?? null;
    if (!key || !phone) return { status: "unlinked" as const, phone: null, phoneMasked: null, phoneKey: null, validUntil: null, revision: "0", pending: null };
    const state = useLatest ? candidate! : await this.refreshBinding(key);
    const b = state.binding;
    const pending = pendingActive(state) ? { account: state.pending.account, availableAt: new Date(Number(state.pending.executableAt) * 1000).toISOString() } : null;
    const mine = b.account.toLowerCase() === address.toLowerCase();
    const status = pending && (mine || pending.account.toLowerCase() === address.toLowerCase()) ? "pending" : !mine ? (isZeroAddress(b.account) ? "unlinked" : "reassigned") : b.revoked ? "revoked" : b.validUntil <= state.timestamp ? "expired" : "active";
    return { status, phone, phoneMasked: maskPhone(phone), phoneKey: key, validUntil: b.validUntil ? new Date(Number(b.validUntil) * 1000).toISOString() : null, revision: b.revision.toString(), pending };
  }

  async profileWithStatus(address: Address): Promise<Profile | null> {
    const profile = this.profile(address);
    return profile ? { ...profile, phoneStatus: (await this.phoneStatus(address)).status as Profile["phoneStatus"] } : null;
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
    return { sessionToken: await this.tokens.sessionToken(address), profile: await this.profileWithStatus(address) };
  }

  binding(key: Hex): BindingRow | undefined {
    return this.db.prepare("SELECT * FROM phone_bindings WHERE phone_key = ?").get(key) as BindingRow | undefined;
  }

  /** The number moved to a new account within REBIND_COOLDOWN_DAYS → senders get a warning. */
  recentlyChanged(b: BindingRow | undefined): boolean {
    if (!b?.rebound_at) return false;
    return Date.now() - Date.parse(b.rebound_at) < this.config.rebindCooldownDays * 86_400_000;
  }

  async resolve(requester: Address, phones: string[], region?: string): Promise<Resolved[]> {
    if (!rateLimit(this.db, `resolve:${requester}`, RESOLVE_DAILY_LIMIT, 86_400_000, phones.length)) {
      throw errors.rateLimited("You've looked up a lot of contacts today. Please try again tomorrow.");
    }
    const hint = region ?? regionOf(this.get(requester)?.phone_e164 ?? "");
    // Bounded batches avoid a 200-contact request flooding the RPC. Cache is reconciled as we read.
    const results: Resolved[] = [];
    for (let offset = 0; offset < phones.length; offset += 8) {
      results.push(...await Promise.all(phones.slice(offset, offset + 8).map(async (phone): Promise<Resolved> => {
        const parsed = normalizePhone(phone, hint);
        if (!parsed) return { phone, e164: null, status: "invalid" };
        const key = this.phoneKeyOf(parsed.e164);
        const state = await this.refreshBinding(key);
        const directory = this.proof(key, state);
        if (!bindingActive(state)) return { phone, e164: parsed.e164, status: state.binding.revision === 0n && !pendingActive(state) ? "invite" : "unavailable", directory };
        const account = this.get(state.binding.account);
        return { phone, e164: parsed.e164, status: "registered", displayName: account?.display_name ?? undefined,
          address: state.binding.account, directory, recentlyChanged: this.recentlyChanged(this.binding(key)) || undefined };
      })));
    }
    return results;
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
