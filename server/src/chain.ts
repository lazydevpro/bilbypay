import {
  bilbyDirectoryAbi,
  bilbyEscrowAbi,
  bilbyRouterAbi,
  type Deployment,
  DepositStatus,
  erc20PermitAbi,
  erc4626Abi,
  getNetwork,
  type TokenInfo,
} from "@bilbypay/core";
import { type Address, type Chain, createPublicClient, domainSeparator, erc20Abi, type Hex, http, type PublicClient } from "viem";
import type { Config } from "./config";

export type DirectoryState = {
  binding: { account: Address; boundAt: bigint; validUntil: bigint; revision: bigint; phoneEpoch: bigint; revoked: boolean };
  pending: { account: Address; requestedAt: bigint; executableAt: bigint; expiresAt: bigint; expectedRevision: bigint };
  blockNumber: bigint;
  timestamp: bigint;
};

export const isZeroAddress = (account: string) => /^0x0{40}$/i.test(account);
export const pendingActive = (state: DirectoryState) => !isZeroAddress(state.pending.account) && state.pending.expiresAt >= state.timestamp;
export const bindingActive = (state: DirectoryState) => !isZeroAddress(state.binding.account) && !state.binding.revoked && state.binding.validUntil > state.timestamp && !pendingActive(state);

/** Read-side access to the chain and our contracts. Writes go through relayer.ts. */
export class ChainService {
  readonly client: PublicClient;
  readonly chain: Chain;
  readonly d: Deployment;

  constructor(readonly config: Config) {
    const base = getNetwork(config.chainId).chain;
    this.chain = { ...base, rpcUrls: { default: { http: [config.rpcUrl] } } };
    this.client = createPublicClient({ chain: this.chain, transport: http(config.rpcUrl), pollingInterval: config.pollingIntervalMs });
    this.d = config.deployment;
  }

  /**
   * Chain time (latest block timestamp). Everything the contracts compare against block.timestamp
   * (deadlines, escrow expiry, authorization windows) is derived from this, not the wall clock.
   */
  async now(): Promise<number> {
    const block = await this.client.getBlock({ blockTag: "latest" });
    return Number(block.timestamp);
  }

  ausdBalance(account: Address) {
    return this.client.readContract({ address: this.d.ausd, abi: erc20Abi, functionName: "balanceOf", args: [account] });
  }

  ausdNonce(account: Address) {
    return this.client.readContract({ address: this.d.ausd, abi: erc20PermitAbi, functionName: "nonces", args: [account] });
  }

  stataNonce(account: Address) {
    return this.client.readContract({ address: this.d.stata, abi: erc20PermitAbi, functionName: "nonces", args: [account] });
  }

  /** Burrow position: assets (convertToAssets of shares) and what can be withdrawn right now. */
  async burrow(account: Address): Promise<{ shares: bigint; assets: bigint; maxWithdraw: bigint }> {
    const shares = await this.client.readContract({ address: this.d.stata, abi: erc4626Abi, functionName: "balanceOf", args: [account] });
    const [assets, maxWithdraw] = await Promise.all([
      shares === 0n
        ? 0n
        : this.client.readContract({ address: this.d.stata, abi: erc4626Abi, functionName: "convertToAssets", args: [shares] }),
      this.client.readContract({ address: this.d.stata, abi: erc4626Abi, functionName: "maxWithdraw", args: [account] }),
    ]);
    return { shares, assets, maxWithdraw };
  }

  previewWithdraw(assets: bigint) {
    return this.client.readContract({ address: this.d.stata, abi: erc4626Abi, functionName: "previewWithdraw", args: [assets] });
  }

  async resolve(phoneKey: Hex): Promise<{ account: Address | null; boundAt: number }> {
    const [account, boundAt] = await this.client.readContract({
      address: this.d.directory,
      abi: bilbyDirectoryAbi,
      functionName: "resolve",
      args: [phoneKey],
    });
    return { account: /^0x0{40}$/i.test(account) ? null : account, boundAt: Number(boundAt) };
  }

  /** Read every field at one block so a concurrent reassignment cannot mix revisions. */
  async directoryState(phoneKey: Hex, blockNumber?: bigint): Promise<DirectoryState> {
    const block = await this.client.getBlock(blockNumber === undefined ? { blockTag: "latest" } : { blockNumber });
    const [binding, pending] = await Promise.all([
      this.client.readContract({ address: this.d.directory, abi: bilbyDirectoryAbi, functionName: "getBinding", args: [phoneKey], blockNumber: block.number }),
      this.client.readContract({ address: this.d.directory, abi: bilbyDirectoryAbi, functionName: "getPendingChange", args: [phoneKey], blockNumber: block.number }),
    ]);
    return { binding, pending, blockNumber: block.number, timestamp: block.timestamp };
  }

  lastIssuedAt(phoneKey: Hex) {
    return this.client.readContract({ address: this.d.directory, abi: bilbyDirectoryAbi, functionName: "lastIssuedAt", args: [phoneKey] });
  }

  async deposit(depositId: Hex) {
    const d = await this.client.readContract({ address: this.d.escrow, abi: bilbyEscrowAbi, functionName: "getDeposit", args: [depositId] });
    return { ...d, statusName: DepositStatus[d.status] ?? "None" };
  }

  async autoSave(user: Address): Promise<{ enabled: boolean; threshold: bigint }> {
    const [enabled, threshold] = await this.client.readContract({
      address: this.d.router,
      abi: bilbyRouterAbi,
      functionName: "autoSave",
      args: [user],
    });
    return { enabled, threshold };
  }

  routerNonce(user: Address) {
    return this.client.readContract({ address: this.d.router, abi: bilbyRouterAbi, functionName: "nonces", args: [user] });
  }

  /**
   * Refuses to start if a token's on-chain EIP-712 domain differs from the one we sign against —
   * every user signature would be useless.
   */
  async verifyDomains(): Promise<void> {
    const rpcChainId = await this.client.getChainId();
    if (rpcChainId !== this.config.chainId) throw new Error(`RPC is chain ${rpcChainId}, expected ${this.config.chainId}`);
    const directoryVersion = await this.client.readContract({ address: this.d.directory, abi: bilbyDirectoryAbi, functionName: "VERSION" });
    if (Number(directoryVersion) !== 2) throw new Error("Directory v2 deployment required; do not use the v1 deployment manifest with this server.");
    const escrowDirectory = await this.client.readContract({ address: this.d.escrow, abi: bilbyEscrowAbi, functionName: "directory" });
    if (escrowDirectory.toLowerCase() !== this.d.directory.toLowerCase()) throw new Error("Escrow is connected to a different directory.");
    const check = async (token: TokenInfo) => {
      const onChain = await this.client.readContract({ address: token.address, abi: erc20PermitAbi, functionName: "DOMAIN_SEPARATOR" });
      const ours = domainSeparator({
        domain: { name: token.domainName, version: token.domainVersion, chainId: this.config.chainId, verifyingContract: token.address },
      });
      if (onChain !== ours) throw new Error(`EIP-712 domain mismatch for ${token.address} ("${token.domainName}")`);
    };
    await Promise.all([check(this.config.ausd), check(this.config.stata)]);
  }

  explorerTxUrl(hash: Hex): string | undefined {
    return this.config.explorerUrl ? `${this.config.explorerUrl}/tx/${hash}` : undefined;
  }
}
