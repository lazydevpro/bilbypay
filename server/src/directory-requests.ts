import { bilbyDirectoryAbi, bindTypedData, cancelRecoveryTypedData, finalizeRecoveryTypedData, hydrateTypedData, requestRecoveryTypedData, revokePhoneTypedData, serializeTypedData, type TypedDataJson } from "@bilbypay/core";
import { encodeFunctionData, getAddress, parseEventLogs, type Address, type Hex, type TransactionReceipt, verifyTypedData } from "viem";
import type { Tokens } from "./auth";
import { isZeroAddress, pendingActive, type ChainService } from "./chain";
import type { Config } from "./config";
import type { Db } from "./db";
import { ApiError, errors, humanizeRevert } from "./errors";
import type { TxSender } from "./relayer";
import { fromJson, isoFromUnix, KeyedMutex, newId, nowIso, toJson } from "./util";
import type { Verifier } from "./verifier";

export type BindOperation = "bind" | "requestRecovery" | "finalizeRecovery";
type ManageOperation = "revoke" | "cancelRecovery";
type BindRequest = { phoneKey: Hex; account: Address; issuedAt: bigint; deadline: bigint; expectedRevision: bigint; validUntil: bigint };
type RequestRow = { id: string; account: Address; phone_key: Hex; phone_e164: string | null; operation: BindOperation | ManageOperation; payload: string; expires_at: number; result: string | null; tx_hash: Hex | null };
type SavedPayload = { typedData: TypedDataJson; message: BindRequest | { phoneKey: Hex; expectedRevision: bigint; deadline: bigint }; recoveryReadyAt?: bigint };
export type RegistrationResult = { status: "registered" | "pending"; phoneKey: Hex; phone: string; availableAt?: string };

/** Prepared consent is short-lived, bound to the exact revision, operation, account and chain. */
export class DirectoryRequests {
  private readonly locks = new KeyedMutex();
  constructor(private readonly db: Db, private readonly config: Config, private readonly chain: ChainService, private readonly verifier: Verifier, private readonly relayer: TxSender, private readonly tokens: Tokens) {}

  async prepareRegistration(input: { phoneToken: string; address: string; controllerConsent?: boolean }) {
    const phone = await this.tokens.verifyPhoneToken(input.phoneToken);
    let account: Address;
    try { account = getAddress(input.address); } catch { throw errors.invalidRequest(); }
    const state = await this.chain.directoryState(phone.phoneKey);
    const { binding, pending, timestamp } = state;
    let operation: BindOperation = "bind";
    if (pendingActive(state)) {
      if (pending.account.toLowerCase() !== account.toLowerCase() || timestamp < pending.executableAt) throw errors.phoneChangePending(isoFromUnix(Number(pending.executableAt)));
      operation = "finalizeRecovery";
      this.requirePostDelayPhoneCheck(phone.verifiedAt, pending.executableAt);
    } else if (!isZeroAddress(binding.account) && binding.account.toLowerCase() !== account.toLowerCase() && !input.controllerConsent) {
      operation = "requestRecovery";
    }
    const message: BindRequest = { phoneKey: phone.phoneKey, account, issuedAt: timestamp, deadline: timestamp + 600n, expectedRevision: binding.revision, validUntil: timestamp + 365n * 86_400n };
    const build = operation === "bind" ? bindTypedData : operation === "requestRecovery" ? requestRecoveryTypedData : finalizeRecoveryTypedData;
    const typedData = serializeTypedData(build(this.config.deployment, message));
    const id = this.save(account, phone.phoneKey, phone.e164, operation, {
      typedData, message, ...(operation === "finalizeRecovery" ? { recoveryReadyAt: pending.executableAt } : {}),
    });
    return { id, operation, typedData, phoneKey: phone.phoneKey, revision: binding.revision.toString(), validUntil: isoFromUnix(Number(message.validUntil)), ...(operation === "requestRecovery" ? { availableAt: isoFromUnix(Number(timestamp + 7n * 86_400n)) } : {}) };
  }

  async submitRegistration(input: { registrationId: string; phoneToken: string; account: Address; consentSignature: Hex; controllerSignature?: Hex }): Promise<RegistrationResult> {
    const phone = await this.tokens.verifyPhoneToken(input.phoneToken);
    return this.locks.run(phone.phoneKey, async () => {
      const row = this.row(input.registrationId, input.account);
      if (row.phone_key !== phone.phoneKey || row.phone_e164 !== phone.e164 || !["bind", "requestRecovery", "finalizeRecovery"].includes(row.operation)) throw errors.badSignature();
      const saved = fromJson<SavedPayload>(row.payload);
      await this.verifyConsent(input.account, saved.typedData, input.consentSignature);
      if (row.operation === "finalizeRecovery") this.requirePostDelayPhoneCheck(phone.verifiedAt, saved.recoveryReadyAt);
      if (row.result) return JSON.parse(row.result) as RegistrationResult;
      // A previous attempt may already have succeeded. Never re-submit or reject its old revision
      // before reconciling the exact broadcast transaction, even after its signing deadline.
      if (row.tx_hash) return this.completeRegistration(row, saved, await this.recoverReceipt(row.tx_hash));
      const message = saved.message as BindRequest;
      const state = await this.chain.directoryState(phone.phoneKey);
      if (state.timestamp > message.deadline) throw errors.actionExpired();
      if (state.binding.revision !== message.expectedRevision) throw errors.recipientChanged();
      const operation = row.operation as BindOperation;
      const verifierSignature = await this.verifier.signDirectory(operation, message);
      const data = operation === "bind"
        ? encodeFunctionData({ abi: bilbyDirectoryAbi, functionName: "bind", args: [message, verifierSignature, input.consentSignature, input.controllerSignature ?? "0x"] })
        : encodeFunctionData({ abi: bilbyDirectoryAbi, functionName: operation, args: [message, verifierSignature, input.consentSignature] });
      const receipt = await this.send(row, data);
      return this.completeRegistration(this.row(row.id, row.account), saved, receipt);
    });
  }

  async prepareManagement(account: Address, phoneKey: Hex, operation: ManageOperation) {
    const state = await this.chain.directoryState(phoneKey);
    const controller = state.binding.account.toLowerCase() === account.toLowerCase();
    const candidate = pendingActive(state) && state.pending.account.toLowerCase() === account.toLowerCase();
    if (!controller && !(operation === "cancelRecovery" && candidate)) throw errors.phoneRequired();
    if (operation === "cancelRecovery" && !pendingActive(state)) throw errors.invalidRequest("There is no number change to cancel.");
    const message = { phoneKey, expectedRevision: state.binding.revision, deadline: state.timestamp + 600n };
    const typedData = serializeTypedData((operation === "revoke" ? revokePhoneTypedData : cancelRecoveryTypedData)(this.config.deployment, message));
    return { id: this.save(account, phoneKey, null, operation, { message, typedData }), operation, typedData, phoneKey, revision: message.expectedRevision.toString() };
  }

  async submitManagement(account: Address, id: string, signature: Hex): Promise<{ ok: true }> {
    const initial = this.row(id, account);
    return this.locks.run(initial.phone_key, async () => {
      const row = this.row(id, account);
      if (row.operation !== "revoke" && row.operation !== "cancelRecovery") throw errors.invalidRequest();
      const saved = fromJson<SavedPayload>(row.payload);
      await this.verifyConsent(account, saved.typedData, signature);
      if (row.result) return { ok: true };
      if (row.tx_hash) return this.completeManagement(row, saved, await this.recoverReceipt(row.tx_hash));
      const { phoneKey, expectedRevision, deadline } = saved.message;
      if (await this.chain.now() > Number(deadline)) throw errors.actionExpired();
      const data = encodeFunctionData({ abi: bilbyDirectoryAbi, functionName: row.operation, args: [phoneKey, expectedRevision, deadline, signature] });
      const receipt = await this.send(row, data);
      return this.completeManagement(this.row(row.id, row.account), saved, receipt);
    });
  }

  latestPhone(account: Address): { phone_key: Hex; phone_e164: string } | undefined {
    return this.db.prepare("SELECT phone_key, phone_e164 FROM directory_requests WHERE account = ? AND phone_e164 IS NOT NULL AND result IS NOT NULL ORDER BY rowid DESC LIMIT 1").get(account) as { phone_key: Hex; phone_e164: string } | undefined;
  }

  private requirePostDelayPhoneCheck(verifiedAt: number | undefined, readyAt: bigint | undefined) {
    if (readyAt === undefined || verifiedAt === undefined || !Number.isSafeInteger(verifiedAt) || verifiedAt < 0 || BigInt(verifiedAt) < readyAt) {
      throw errors.phoneCheckExpired();
    }
  }

  private processing() {
    return new ApiError(503, "PHONE_UPDATE_PROCESSING", "Your number update is still being checked. Please try again shortly.");
  }

  private async send(row: RequestRow, data: Hex): Promise<TransactionReceipt> {
    let broadcastHash: Hex | undefined;
    const record = (hash: Hex) => {
      broadcastHash = hash;
      this.db.prepare("UPDATE directory_requests SET tx_hash = ? WHERE id = ?").run(hash, row.id);
    };
    try {
      const sent = await this.relayer.send({ to: this.config.deployment.directory, data, label: `directory.${row.operation}` }, record);
      // TxSender normally calls record immediately after broadcast. Keep adapters equally durable.
      if (!broadcastHash) record(sent.hash);
      return sent.receipt;
    } catch (error) {
      if (broadcastHash) {
        // Retry a transient write failure in the callback; retain the hash before returning an
        // ambiguous timeout. The next submission reconciles it instead of creating a new change.
        record(broadcastHash);
        throw this.processing();
      }
      throw humanizeRevert(error);
    }
  }

  private async recoverReceipt(hash: Hex): Promise<TransactionReceipt> {
    try {
      return await this.chain.client.waitForTransactionReceipt({ hash, timeout: 60_000 });
    } catch {
      throw this.processing();
    }
  }

  private receiptLogs(row: RequestRow, receipt: TransactionReceipt) {
    if (!row.tx_hash || receipt.transactionHash.toLowerCase() !== row.tx_hash.toLowerCase() || receipt.to?.toLowerCase() !== this.config.deployment.directory.toLowerCase()) {
      throw new ApiError(503, "PHONE_UPDATE_UNCONFIRMED", "We couldn't confirm this number update. Check your number's status before trying again.");
    }
    if (receipt.status !== "success") throw errors.invalidRequest("This number update wasn't completed. Check your number's status and try again.");
    return receipt.logs.filter((log) => log.address.toLowerCase() === this.config.deployment.directory.toLowerCase());
  }

  private completeRegistration(row: RequestRow, saved: SavedPayload, receipt: TransactionReceipt): RegistrationResult {
    const logs = this.receiptLogs(row, receipt);
    const request = saved.message as BindRequest;
    const revision = request.expectedRevision + 1n;
    const same = (key: Hex, account: Address) => key === row.phone_key && account.toLowerCase() === row.account.toLowerCase();
    const binding = parseEventLogs({ abi: bilbyDirectoryAbi, eventName: "BindingUpdated", logs })
      .find(({ args }) => args.phoneKey === row.phone_key && args.revision === revision);
    if (!binding) throw this.processing();
    let availableAt: string | undefined;
    if (row.operation === "requestRecovery") {
      const requested = parseEventLogs({ abi: bilbyDirectoryAbi, eventName: "RecoveryRequested", logs })
        .find(({ args }) => same(args.phoneKey, args.proposedAccount) && args.expectedRevision === revision);
      if (!requested) throw this.processing();
      availableAt = isoFromUnix(Number(requested.args.executableAt));
    } else {
      if (!same(binding.args.phoneKey, binding.args.account) || binding.args.revoked || binding.args.validUntil !== request.validUntil) throw this.processing();
      const applied = row.operation === "bind"
        ? parseEventLogs({ abi: bilbyDirectoryAbi, eventName: "Bound", logs }).some(({ args }) => same(args.phoneKey, args.account))
        : parseEventLogs({ abi: bilbyDirectoryAbi, eventName: "RecoveryFinalized", logs }).some(({ args }) => same(args.phoneKey, args.account) && args.revision === revision);
      if (!applied) throw this.processing();
    }
    const result: RegistrationResult = {
      status: row.operation === "requestRecovery" ? "pending" : "registered", phoneKey: row.phone_key, phone: row.phone_e164!,
      ...(availableAt ? { availableAt } : {}),
    };
    this.db.prepare("UPDATE directory_requests SET result = ? WHERE id = ?").run(JSON.stringify(result), row.id);
    return result;
  }

  private completeManagement(row: RequestRow, saved: SavedPayload, receipt: TransactionReceipt): { ok: true } {
    const logs = this.receiptLogs(row, receipt);
    const revision = saved.message.expectedRevision + 1n;
    const binding = parseEventLogs({ abi: bilbyDirectoryAbi, eventName: "BindingUpdated", logs })
      .find(({ args }) => args.phoneKey === row.phone_key && args.revision === revision);
    if (!binding) throw this.processing();
    if (row.operation === "revoke") {
      const unbound = parseEventLogs({ abi: bilbyDirectoryAbi, eventName: "Unbound", logs })
        .some(({ args }) => args.phoneKey === row.phone_key && args.account.toLowerCase() === row.account.toLowerCase());
      if (!binding.args.revoked || !unbound) throw this.processing();
    } else {
      const cancelled = parseEventLogs({ abi: bilbyDirectoryAbi, eventName: "RecoveryCancelled", logs })
        .some(({ args }) => args.phoneKey === row.phone_key && args.revision === revision);
      if (!cancelled) throw this.processing();
    }
    this.db.prepare("UPDATE directory_requests SET result = ? WHERE id = ?").run(JSON.stringify({ ok: true }), row.id);
    return { ok: true };
  }

  private save(account: Address, key: Hex, e164: string | null, operation: RequestRow["operation"], payload: SavedPayload) {
    const id = newId("dr");
    this.db.prepare("INSERT INTO directory_requests (id, account, phone_key, phone_e164, operation, payload, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(id, account, key, e164, operation, toJson(payload), Number(payload.message.deadline), nowIso());
    return id;
  }
  private row(id: string, account: Address): RequestRow {
    const row = this.db.prepare("SELECT * FROM directory_requests WHERE id = ? AND account = ?").get(id, account) as RequestRow | undefined;
    if (!row) throw errors.notFound();
    return row;
  }
  private async verifyConsent(account: Address, typedData: TypedDataJson, signature: Hex) {
    try { if (await verifyTypedData({ ...hydrateTypedData(typedData), address: account, signature } as never)) return; } catch {}
    throw errors.badSignature();
  }
}
