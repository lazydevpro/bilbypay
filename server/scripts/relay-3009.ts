/**
 * Phase 0 spike: move AUSD out of an account that holds 0 MON.
 *
 * The sender signs an EIP-3009 TransferWithAuthorization off-chain; the relayer submits it and
 * pays gas. Success = a tx hash where the sender's MON balance is 0 before and after.
 *
 * Two modes:
 *   - SENDER_PRIVATE_KEY set: the script signs as the sender (key-based spike).
 *   - SIGNED_AUTH_FILE set: relay a payment signed by the passkey in the app ("Sign & share for relay").
 *
 *   pnpm --filter @bilbypay/server spike:relay        (reads server/.env)
 */
import { readFileSync } from "node:fs";
import {
  type Authorization,
  authorizationTypedData,
  eip3009Abi,
  formatUsd,
  getNetwork,
  newAuthorization,
  parseUsd,
  type TokenInfo,
  toSignedAuthorization,
} from "@bilbypay/core";
import {
  type Address,
  createPublicClient,
  createWalletClient,
  domainSeparator,
  encodeFunctionData,
  formatEther,
  getAddress,
  type Hex,
  http,
  parseAbi,
  recoverTypedDataAddress,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

function env(name: string, fallback?: string): string {
  const value = process.env[name] || fallback;
  if (value === undefined) throw new Error(`Missing env ${name} (see server/.env.example)`);
  return value;
}

const chainId = Number(env("CHAIN_ID", "143"));
const network = getNetwork(chainId);
const rpcUrl = env("RPC_URL", network.chain.rpcUrls.default.http[0]);
const token: TokenInfo = process.env.TOKEN_ADDRESS
  ? { ...network.ausd, address: getAddress(process.env.TOKEN_ADDRESS) }
  : network.ausd;

/** Written by the app's spike screen (app/src/payment.ts). */
type SignedAuthorizationJson = {
  chainId: number;
  token: Address;
  from: Address;
  to: Address;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: Hex;
  signature: Hex;
};

const signedAuthFile = process.env.SIGNED_AUTH_FILE;
const senderKey = process.env.SENDER_PRIVATE_KEY as Hex | undefined;
if (!senderKey && !signedAuthFile) {
  const key = generatePrivateKey();
  console.log("No SENDER_PRIVATE_KEY set. Generated a fresh 0-MON account:");
  console.log(`  address: ${privateKeyToAccount(key).address}`);
  console.log(`  SENDER_PRIVATE_KEY=${key}`);
  console.log("Send it a little AUSD (no MON!), put the key in server/.env, and run again.");
  process.exit(0);
}

const presigned = signedAuthFile ? (JSON.parse(readFileSync(signedAuthFile, "utf8")) as SignedAuthorizationJson) : undefined;
if (presigned) {
  if (presigned.chainId !== chainId) throw new Error(`Signed for chain ${presigned.chainId}, but CHAIN_ID is ${chainId}`);
  if (getAddress(presigned.token) !== token.address) throw new Error(`Signed for token ${presigned.token}, not ${token.address}`);
}
const signer = senderKey && !presigned ? privateKeyToAccount(senderKey) : undefined;
const senderAddress = presigned ? getAddress(presigned.from) : signer!.address;
const relayer = privateKeyToAccount(env("RELAYER_PRIVATE_KEY") as Hex);
const recipient = presigned ? getAddress(presigned.to) : getAddress(env("RECIPIENT"));
const value = presigned ? BigInt(presigned.value) : parseUsd(env("AMOUNT_USD", "0.01"));

async function authorize(): Promise<{ auth: Authorization; signature: Hex }> {
  if (presigned) {
    const auth: Authorization = {
      from: senderAddress,
      to: recipient,
      value,
      validAfter: BigInt(presigned.validAfter),
      validBefore: BigInt(presigned.validBefore),
      nonce: presigned.nonce,
    };
    const recovered = await recoverTypedDataAddress({
      ...authorizationTypedData("TransferWithAuthorization", token, chainId, auth),
      signature: presigned.signature,
    });
    if (recovered !== senderAddress) throw new Error(`Signature is from ${recovered}, not ${senderAddress}`);
    return { auth, signature: presigned.signature };
  }
  const auth = newAuthorization({ from: senderAddress, to: recipient, value });
  const signature = await signer!.signTypedData(authorizationTypedData("TransferWithAuthorization", token, chainId, auth));
  return { auth, signature };
}

const publicClient = createPublicClient({ chain: network.chain, transport: http(rpcUrl) });
const walletClient = createWalletClient({ account: relayer, chain: network.chain, transport: http(rpcUrl) });

async function tokenBalance(account: Address) {
  return publicClient.readContract({ address: token.address, abi: eip3009Abi, functionName: "balanceOf", args: [account] });
}

async function main() {
  const rpcChainId = await publicClient.getChainId();
  if (rpcChainId !== chainId) throw new Error(`RPC is chain ${rpcChainId}, expected ${chainId}`);

  // 1. The domain we sign against must be the token's real domain, or the signature is useless.
  const onChainSeparator = await publicClient.readContract({
    address: token.address,
    abi: parseAbi(["function DOMAIN_SEPARATOR() view returns (bytes32)"]),
    functionName: "DOMAIN_SEPARATOR",
  });
  const expectedSeparator = domainSeparator({
    domain: { name: token.domainName, version: token.domainVersion, chainId, verifyingContract: token.address },
  });
  if (onChainSeparator !== expectedSeparator) {
    throw new Error(`EIP-712 domain mismatch for ${token.address}: on-chain ${onChainSeparator}, ours ${expectedSeparator}`);
  }
  console.log(`✓ domain "${token.domainName}" v${token.domainVersion} matches on-chain DOMAIN_SEPARATOR`);

  // 2. Preconditions: sender has no MON and enough dollars; relayer can pay gas.
  const [senderMon, senderUsd, relayerMon] = await Promise.all([
    publicClient.getBalance({ address: senderAddress }),
    tokenBalance(senderAddress),
    publicClient.getBalance({ address: relayer.address }),
  ]);
  console.log(`  sender  ${senderAddress}  MON ${formatEther(senderMon)}  AUSD ${formatUsd(senderUsd)}`);
  console.log(`  relayer ${relayer.address}  MON ${formatEther(relayerMon)}`);
  if (senderMon !== 0n) throw new Error("Sender holds MON; the point of the spike is a 0-MON sender");
  if (senderUsd < value) throw new Error(`Sender has ${formatUsd(senderUsd)}, needs ${formatUsd(value)}`);
  if (chainId === 143 && relayerMon < 10n * 10n ** 18n) {
    console.warn("! relayer holds < 10 MON: Monad caps its in-flight gas budget at its balance");
  }

  // 3. Sender signs off-chain (in the app this is the mera passkey session).
  const { auth, signature } = await authorize();
  const signed = toSignedAuthorization(auth, signature);
  const source = presigned ? "passkey-signed (from app)" : "signed";
  console.log(`✓ ${source} ${formatUsd(value)} → ${recipient} (nonce ${auth.nonce.slice(0, 10)}…)`);

  // 4. Relayer submits. Monad charges the gas *limit*, so keep it tight: estimate + 7.5%.
  const data = encodeFunctionData({
    abi: eip3009Abi,
    functionName: "transferWithAuthorization",
    args: [signed.from, signed.to, signed.value, signed.validAfter, signed.validBefore, signed.nonce, signed.v, signed.r, signed.s],
  });
  const estimate = await publicClient.estimateGas({ account: relayer, to: token.address, data });
  const gas = (estimate * 1075n) / 1000n;
  const startedAt = performance.now();
  const hash = await walletClient.sendTransaction({ to: token.address, data, gas });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, pollingInterval: 100 });
  const elapsedMs = Math.round(performance.now() - startedAt);
  if (receipt.status !== "success") throw new Error(`Transaction reverted: ${hash}`);

  // 5. Verify the outcome on-chain.
  const [used, senderMonAfter, senderUsdAfter] = await Promise.all([
    publicClient.readContract({ address: token.address, abi: eip3009Abi, functionName: "authorizationState", args: [senderAddress, auth.nonce] }),
    publicClient.getBalance({ address: senderAddress }),
    tokenBalance(senderAddress),
  ]);
  if (!used) throw new Error("authorizationState is false after the transfer");
  if (senderMonAfter !== 0n) throw new Error("Sender MON balance changed");
  if (senderUsd - senderUsdAfter !== value) throw new Error("Sender AUSD did not drop by the amount");

  const explorer = network.chain.blockExplorers?.default.url;
  console.log(`✓ relayed in ${elapsedMs} ms (send → receipt), block ${receipt.blockNumber}, gas ${receipt.gasUsed}/${gas}`);
  console.log(`✓ sender still holds 0 MON; AUSD ${formatUsd(senderUsd)} → ${formatUsd(senderUsdAfter)}`);
  console.log(`  tx ${hash}${explorer && rpcUrl === network.chain.rpcUrls.default.http[0] ? `\n  ${explorer}/tx/${hash}` : ""}`);
}

main().catch((error) => {
  console.error(`✗ ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
