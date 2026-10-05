import { bilbyDirectoryAbi, hydrateTypedData, type Deployment, type TypedDataJson } from "@bilbypay/core";
import { encodeAbiParameters, encodeEventTopics, type Address, type Hex, type TransactionReceipt } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Tokens } from "../src/auth";
import type { ChainService, DirectoryState } from "../src/chain";
import type { Config } from "../src/config";
import { openDb, type Db } from "../src/db";
import { DirectoryRequests } from "../src/directory-requests";
import type { TxSender } from "../src/relayer";
import type { Verifier } from "../src/verifier";

const key = `0x${"42".repeat(32)}` as Hex;
const hash = `0x${"77".repeat(32)}` as Hex;
const directory = `0x${"33".repeat(20)}` as Address;
const zero = `0x${"00".repeat(20)}` as Address;
const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
const previous = privateKeyToAccount(`0x${"22".repeat(32)}`).address;
const now = 1_800_000_000n;
const databases: Db[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

function state(): DirectoryState {
  return {
    binding: { account: zero, boundAt: 0n, validUntil: 0n, revision: 0n, phoneEpoch: 0n, revoked: false },
    pending: { account: zero, requestedAt: 0n, executableAt: 0n, expiresAt: 0n, expectedRevision: 0n },
    blockNumber: 7n, timestamp: now,
  };
}

function fixture(initial = state()) {
  const db = openDb(":memory:"); databases.push(db);
  const directoryState = vi.fn(async () => initial);
  const chainNow = vi.fn(async () => Number(initial.timestamp));
  const waitForTransactionReceipt = vi.fn<() => Promise<TransactionReceipt>>();
  const verifyPhoneToken = vi.fn(async (token: string) => ({
    phoneKey: key, e164: "+15555550123",
    ...(token === "missing" ? {} : { verifiedAt: Number(token === "old" ? now - 1n : now) }),
  }));
  const send = vi.fn(async (_call: unknown, onSent?: (h: Hex) => void) => {
    onSent?.(hash);
    return { hash, receipt: await waitForTransactionReceipt() };
  });
  const config = { deployment: { chainId: 143, directory } as Deployment } as Config;
  const chain = { directoryState, now: chainNow, client: { waitForTransactionReceipt } } as unknown as ChainService;
  const verifier = { signDirectory: vi.fn(async () => "0x1234" as Hex) } as unknown as Verifier;
  const create = () => new DirectoryRequests(db, config, chain, verifier, { send } as unknown as TxSender, { verifyPhoneToken } as unknown as Tokens);
  const service = create();
  const prepare = (phoneToken = "fresh") => service.prepareRegistration({ phoneToken, address: account.address });
  const submission = async (p: { id: string; typedData: TypedDataJson }, phoneToken = "fresh") => ({
    registrationId: p.id, phoneToken, account: account.address,
    consentSignature: await account.signTypedData(hydrateTypedData(p.typedData) as never),
  });
  const row = () => db.prepare("SELECT tx_hash,result FROM directory_requests").get();
  return { db, create, service, prepare, submission, row, directoryState, chainNow, waitForTransactionReceipt, send };
}

type ReceiptLog = TransactionReceipt["logs"][number];
function event(topics: ReturnType<typeof encodeEventTopics>, data: Hex = "0x", address = directory): ReceiptLog {
  if (topics.some((topic) => typeof topic !== "string")) throw new Error("Fixture event has an unset indexed argument");
  return { address, topics: [...topics] as [Hex, ...Hex[]], data, transactionHash: hash, blockHash: hash, blockNumber: 8n, logIndex: 0, transactionIndex: 0, removed: false };
}

function bindingEvent(revision: bigint, validUntil: bigint, holder = account.address, revoked = false) {
  return event(encodeEventTopics({ abi: bilbyDirectoryAbi, eventName: "BindingUpdated", args: { phoneKey: key, account: holder } }),
    encodeAbiParameters([{ type: "uint64" }, { type: "uint64" }, { type: "uint64" }, { type: "uint64" }, { type: "bool" }],
      [revision, 0n, now, validUntil, revoked]));
}

function receipt(logs: ReceiptLog[], changes: Partial<TransactionReceipt> = {}): TransactionReceipt {
  return { transactionHash: hash, to: directory, status: "success", logs, ...changes } as TransactionReceipt;
}

function registrationReceipt(p: { operation: string; typedData: TypedDataJson }) {
  const m = p.typedData.message;
  const revision = BigInt(String(m.expectedRevision)) + 1n;
  const validUntil = BigInt(String(m.validUntil));
  if (p.operation === "requestRecovery") return receipt([
    bindingEvent(revision, validUntil, previous),
    event(encodeEventTopics({ abi: bilbyDirectoryAbi, eventName: "RecoveryRequested", args: { phoneKey: key, currentAccount: previous, proposedAccount: account.address } }),
      encodeAbiParameters([{ type: "uint64" }, { type: "uint64" }, { type: "uint64" }], [revision, now + 7n * 86_400n, now + 14n * 86_400n])),
  ]);
  const applied = p.operation === "bind"
    ? event(encodeEventTopics({ abi: bilbyDirectoryAbi, eventName: "Bound", args: { phoneKey: key, account: account.address, previous: zero } }))
    : event(encodeEventTopics({ abi: bilbyDirectoryAbi, eventName: "RecoveryFinalized", args: { phoneKey: key, previous, account: account.address } }), encodeAbiParameters([{ type: "uint64" }], [revision]));
  return receipt([applied, bindingEvent(revision, validUntil)]);
}

function readyRecovery() {
  const s = state();
  s.binding = { ...s.binding, account: previous, revision: 2n, validUntil: now + 100_000n };
  s.pending = { account: account.address, requestedAt: now - 7n * 86_400n, executableAt: now, expiresAt: now + 7n * 86_400n, expectedRevision: 2n };
  return s;
}

describe("durable directory submissions", () => {
  it("recovers a broadcast timeout after restart without rechecking its old deadline or revision", async () => {
    const f = fixture();
    const p = await f.prepare();
    const input = await f.submission(p);
    f.send.mockImplementationOnce(async (_call, onSent) => { onSent?.(hash); throw new Error("receipt timeout after broadcast"); });
    await expect(f.service.submitRegistration(input)).rejects.toMatchObject({ code: "PHONE_UPDATE_PROCESSING" });
    expect(f.row()).toMatchObject({ tx_hash: hash, result: null });
    f.directoryState.mockRejectedValue(new Error("a retry must not read current revision first"));
    f.chainNow.mockResolvedValue(Number(now + 700n));
    f.waitForTransactionReceipt.mockResolvedValue(registrationReceipt(p));
    const recovered = await f.create().submitRegistration(input);
    expect(recovered).toMatchObject({ status: "registered", phoneKey: key });
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.row()?.result).toBe(JSON.stringify(recovered));
  });

  it("recovers a successful transaction after the result write fails", async () => {
    const f = fixture();
    const p = await f.prepare();
    const input = await f.submission(p);
    f.waitForTransactionReceipt.mockResolvedValue(registrationReceipt(p));
    f.db.exec("CREATE TRIGGER fail_result BEFORE UPDATE OF result ON directory_requests BEGIN SELECT RAISE(FAIL, 'simulated result write failure'); END");
    await expect(f.service.submitRegistration(input)).rejects.toThrow("simulated result write failure");
    expect(f.row()).toMatchObject({ tx_hash: hash, result: null });
    f.db.exec("DROP TRIGGER fail_result");
    f.directoryState.mockRejectedValue(new Error("state already changed"));
    expect((await f.create().submitRegistration(input)).status).toBe("registered");
    expect(f.send).toHaveBeenCalledTimes(1);
  });

  it("derives recovery timing from the mined event, without reading later mutable state", async () => {
    const initial = state();
    initial.binding = { ...initial.binding, account: previous, revision: 1n, validUntil: now + 100_000n };
    const f = fixture(initial);
    const p = await f.prepare();
    expect(p.operation).toBe("requestRecovery");
    f.waitForTransactionReceipt.mockResolvedValue(registrationReceipt(p));
    const result = await f.service.submitRegistration(await f.submission(p));
    expect(result).toMatchObject({ status: "pending", availableAt: new Date(Number(now + 7n * 86_400n) * 1000).toISOString() });
    expect(f.directoryState).toHaveBeenCalledTimes(2); // Prepare and pre-submit; never post-submit.
  });

  it.each(["wrong transaction", "wrong destination", "foreign event", "wrong revision", "wrong account", "reverted"])("does not cache success for a %s receipt", async (kind) => {
    const f = fixture();
    const p = await f.prepare();
    const valid = registrationReceipt(p);
    let invalid = valid;
    if (kind === "wrong transaction") invalid = { ...valid, transactionHash: `0x${"88".repeat(32)}` };
    if (kind === "wrong destination") invalid = { ...valid, to: previous };
    if (kind === "foreign event") invalid = { ...valid, logs: valid.logs.map((log) => ({ ...log, address: previous })) };
    if (kind === "wrong revision") invalid = { ...valid, logs: [valid.logs[0]!, bindingEvent(9n, BigInt(String(p.typedData.message.validUntil)))] };
    if (kind === "wrong account") invalid = { ...valid, logs: [valid.logs[0]!, bindingEvent(1n, BigInt(String(p.typedData.message.validUntil)), previous)] };
    if (kind === "reverted") invalid = { ...valid, status: "reverted" };
    f.waitForTransactionReceipt.mockResolvedValue(invalid);
    await expect(f.service.submitRegistration(await f.submission(p))).rejects.toThrow();
    expect(f.row()?.result).toBeNull();
  });

  it("recovers management after its deadline and verifies the revocation event", async () => {
    const initial = state();
    initial.binding = { ...initial.binding, account: account.address, revision: 1n, validUntil: now + 100_000n };
    const f = fixture(initial);
    const p = await f.service.prepareManagement(account.address, key, "revoke");
    const signature = await account.signTypedData(hydrateTypedData(p.typedData) as never);
    f.send.mockImplementationOnce(async (_call, onSent) => { onSent?.(hash); throw new Error("timeout"); });
    await expect(f.service.submitManagement(account.address, p.id, signature)).rejects.toMatchObject({ code: "PHONE_UPDATE_PROCESSING" });
    f.chainNow.mockRejectedValue(new Error("expired requests still reconcile"));
    f.waitForTransactionReceipt.mockResolvedValue(receipt([
      event(encodeEventTopics({ abi: bilbyDirectoryAbi, eventName: "Unbound", args: { phoneKey: key, account: account.address } })),
      bindingEvent(2n, now + 100_000n, account.address, true),
    ]));
    expect(await f.create().submitManagement(account.address, p.id, signature)).toEqual({ ok: true });
    expect(f.send).toHaveBeenCalledTimes(1);
  });

  it("accepts a candidate's cancellation receipt even though the controller retains the binding", async () => {
    const f = fixture(readyRecovery());
    const p = await f.service.prepareManagement(account.address, key, "cancelRecovery");
    const signature = await account.signTypedData(hydrateTypedData(p.typedData) as never);
    f.waitForTransactionReceipt.mockResolvedValue(receipt([
      event(encodeEventTopics({ abi: bilbyDirectoryAbi, eventName: "RecoveryCancelled", args: { phoneKey: key } }), encodeAbiParameters([{ type: "uint64" }], [3n])),
      bindingEvent(3n, now + 100_000n, previous),
    ]));
    expect(await f.service.submitManagement(account.address, p.id, signature)).toEqual({ ok: true });
  });

  it.each(["missing", "old"])("rejects %s post-delay phone proof during preparation", async (phoneToken) => {
    const f = fixture(readyRecovery());
    await expect(f.prepare(phoneToken)).rejects.toMatchObject({ code: "OTP_EXPIRED" });
    expect(f.send).not.toHaveBeenCalled();
  });

  it("rejects substituting an older phone proof after preparing with a fresh one", async () => {
    const f = fixture(readyRecovery());
    const p = await f.prepare();
    expect(p.operation).toBe("finalizeRecovery");
    await expect(f.service.submitRegistration(await f.submission(p, "old"))).rejects.toMatchObject({ code: "OTP_EXPIRED" });
    expect(f.send).not.toHaveBeenCalled();
  });

  it("recovers finalized recovery using its saved OTP cutoff after pending state disappears", async () => {
    const f = fixture(readyRecovery());
    const p = await f.prepare();
    const input = await f.submission(p);
    f.send.mockImplementationOnce(async (_call, onSent) => { onSent?.(hash); throw new Error("timeout"); });
    await expect(f.service.submitRegistration(input)).rejects.toMatchObject({ code: "PHONE_UPDATE_PROCESSING" });
    f.directoryState.mockRejectedValue(new Error("pending state already disappeared"));
    f.waitForTransactionReceipt.mockResolvedValue(registrationReceipt(p));
    expect((await f.create().submitRegistration(input)).status).toBe("registered");
    expect(f.send).toHaveBeenCalledTimes(1);
  });
});
