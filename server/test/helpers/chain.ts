import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { bilbyRouterAbi, type Deployment } from "@bilbypay/core";
import { type Abi, type Address, createPublicClient, createTestClient, createWalletClient, getAddress, type Hex, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monad } from "viem/chains";

const CONTRACTS = resolve(import.meta.dirname, "../../../contracts");

// anvil's default dev accounts (public test mnemonic).
export const ANVIL_KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
] as const satisfies readonly Hex[];

async function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => ok(port));
    });
    srv.on("error", fail);
  });
}

export type Anvil = { rpcUrl: string; stop: () => void };

/** anvil pretending to be Monad (chain 143), on a random port. */
export async function startAnvil(): Promise<Anvil> {
  const port = await freePort();
  const proc: ChildProcess = spawn("anvil", ["--chain-id", "143", "--port", String(port), "--silent"], { stdio: "ignore" });
  const rpcUrl = `http://127.0.0.1:${port}`;
  const client = createPublicClient({ transport: http(rpcUrl) });
  for (let i = 0; i < 100; i++) {
    try {
      await client.getChainId();
      return { rpcUrl, stop: () => proc.kill() };
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  proc.kill();
  throw new Error("anvil did not start (is foundry on PATH?)");
}

type Artifact = { abi: Abi; bytecode: { object: Hex } };

/** Compiles the contracts if needed. Set SOLC=/path/to/solc when solc can't be downloaded. */
function artifact(file: string, name: string): Artifact {
  const path = resolve(CONTRACTS, "out", file, `${name}.json`);
  if (!existsSync(path)) {
    const args = ["build", ...(process.env.SOLC ? ["--use", process.env.SOLC] : [])];
    execFileSync("forge", args, { cwd: CONTRACTS, stdio: "inherit" });
  }
  return JSON.parse(readFileSync(path, "utf8")) as Artifact;
}

/** Deploys mocks + BilbyDirectory/Escrow/Router like script/DeployLocal.s.sol. */
export async function deployAll(rpcUrl: string, roles: { deployer: Hex; verifier: Address; treasury: Address; keeper: Address }): Promise<Deployment> {
  const account = privateKeyToAccount(roles.deployer);
  const chain = { ...monad, rpcUrls: { default: { http: [rpcUrl] } } };
  const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });
  const client = createPublicClient({ chain, transport: http(rpcUrl), pollingInterval: 20 });
  const deploy = async (file: string, name: string, args: unknown[] = []) => {
    const a = artifact(file, name);
    const hash = await wallet.deployContract({ abi: a.abi, bytecode: a.bytecode.object, args });
    const receipt = await client.waitForTransactionReceipt({ hash });
    return getAddress(receipt.contractAddress!);
  };
  const ausd = await deploy("MockAUSD.sol", "MockAUSD");
  const stata = await deploy("MockStata.sol", "MockStata", [ausd]);
  const directory = await deploy("BilbyDirectory.sol", "BilbyDirectory", [account.address, roles.verifier]);
  const escrow = await deploy("BilbyEscrow.sol", "BilbyEscrow", [ausd, account.address, roles.verifier, roles.treasury]);
  const router = await deploy("BilbyRouter.sol", "BilbyRouter", [ausd, stata, escrow, account.address]);
  const hash = await wallet.writeContract({ address: router, abi: bilbyRouterAbi, functionName: "setKeeper", args: [roles.keeper, true] });
  await client.waitForTransactionReceipt({ hash });
  return { chainId: 143, ausd, stata, directory, escrow, router };
}

/** Another 6-decimal EIP-3009 token (a MockAUSD instance), e.g. to stand in for USDC. */
export async function deployMockToken(rpcUrl: string, deployer: Hex): Promise<Address> {
  const chain = { ...monad, rpcUrls: { default: { http: [rpcUrl] } } };
  const wallet = createWalletClient({ account: privateKeyToAccount(deployer), chain, transport: http(rpcUrl) });
  const client = createPublicClient({ chain, transport: http(rpcUrl), pollingInterval: 20 });
  const a = artifact("MockAUSD.sol", "MockAUSD");
  const receipt = await client.waitForTransactionReceipt({ hash: await wallet.deployContract({ abi: a.abi, bytecode: a.bytecode.object }) });
  return getAddress(receipt.contractAddress!);
}

export function testClient(rpcUrl: string) {
  return createTestClient({ mode: "anvil", chain: { ...monad, rpcUrls: { default: { http: [rpcUrl] } } }, transport: http(rpcUrl) });
}
