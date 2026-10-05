/** Monad testnet only. Run from server after `forge build --root ../contracts --offline`.
 * node --env-file=.env scripts/deploy-testnet-v2.mjs --broadcast
 * Signed transactions are journaled before submission so interrupted runs can resume.
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, encodeDeployData, encodeFunctionData, formatEther, getAddress, http, keccak256, stringToHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { monadTestnet } from 'viem/chains';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const contracts = resolve(root, '../contracts');
const journalPath = resolve(root, 'data/deploy-testnet-v2.json');
const manifestPath = resolve(contracts, 'deployments/10143-v2.json');
const envPath = resolve(root, '.env');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const json = (value) => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2) + '\n';
const atomic = (path, value, mode = 0o600) => {
  writeFileSync(`${path}.tmp`, value, { mode });
  renameSync(`${path}.tmp`, path);
};
const artifact = (name) => JSON.parse(readFileSync(resolve(contracts, 'out', `${name}.sol`, `${name}.json`), 'utf8'));
const artifacts = Object.fromEntries(['MockAUSD', 'MockStata', 'BilbyDirectory', 'BilbyEscrow', 'BilbyRouter'].map(name => [name, artifact(name)]));

async function main() {
  assert(process.argv.includes('--broadcast'), 'Pass --broadcast to deploy to Monad testnet');
  assert(process.env.CHAIN_ID === '10143', 'This script only supports Monad testnet (10143)');
  const signer = privateKeyToAccount(process.env.RELAYER_PRIVATE_KEY);
  const verifier = privateKeyToAccount(process.env.VERIFIER_PRIVATE_KEY).address;
  const treasury = privateKeyToAccount(process.env.TREASURY_PRIVATE_KEY).address;
  const keeper = privateKeyToAccount(process.env.KEEPER_PRIVATE_KEY ?? process.env.RELAYER_PRIVATE_KEY).address;
  const rpc = process.env.RPC_URL ?? 'https://testnet-rpc.monad.xyz';
  const client = createPublicClient({ chain: monadTestnet, transport: http(rpc), pollingInterval: 500 });
  const wallet = createWalletClient({ account: signer, chain: monadTestnet, transport: http(rpc) });
  assert(await client.getChainId() === 10143, 'RPC is not Monad testnet');
  const finalized = await client.getBlock({ blockTag: 'finalized' });
  assert(finalized.number !== null, 'RPC must provide finalized blocks');
  const balance = await client.getBalance({ address: signer.address });
  console.log(`Monad testnet signer ${signer.address}: ${formatEther(balance)} MON`);
  const plan = {
    chainId: 10143, owner: signer.address, verifier, treasury, keeper,
    artifacts: Object.fromEntries(Object.entries(artifacts).map(([name, a]) => [name, keccak256(a.bytecode.object)])),
  };
  const fingerprint = keccak256(stringToHex(json(plan)));
  mkdirSync(dirname(journalPath), { recursive: true, mode: 0o700 });
  assert(!existsSync(manifestPath) || existsSync(journalPath), 'Existing v2 manifest has no matching deployment journal; refusing to replace it');
  const journal = existsSync(journalPath) ? JSON.parse(readFileSync(journalPath, 'utf8')) : { fingerprint, plan, steps: {} };
  assert(journal.fingerprint === fingerprint, 'Deployment plan changed since the journal was created');
  const save = () => atomic(journalPath, json(journal));
  save();

  async function transact(label, request) {
    const requestHash = keccak256(stringToHex(json(request)));
    let entry = journal.steps[label];
    if (entry) assert(entry.requestHash === requestHash, `Changed transaction: ${label}`);
    if (!entry) {
      const estimate = await client.estimateGas({ account: signer.address, ...request });
      const gas = estimate * 110n / 100n;
      const prepared = await wallet.prepareTransactionRequest({ ...request, gas });
      const maximumCost = gas * (prepared.maxFeePerGas ?? prepared.gasPrice ?? 0n);
      assert(maximumCost < await client.getBalance({ address: signer.address }), `Insufficient test MON for ${label}`);
      const rawTransaction = await wallet.signTransaction(prepared);
      entry = journal.steps[label] = { requestHash, hash: keccak256(rawTransaction), rawTransaction };
      save();
    }
    let receipt;
    try { receipt = await client.getTransactionReceipt({ hash: entry.hash }); }
    catch (error) { if (error.name !== 'TransactionReceiptNotFoundError') throw error; }
    if (!receipt) {
      let pending = false;
      try { await client.getTransaction({ hash: entry.hash }); pending = true; }
      catch (error) { if (error.name !== 'TransactionNotFoundError') throw error; }
      if (!pending) await client.sendRawTransaction({ serializedTransaction: entry.rawTransaction });
      console.log(`${label}: submitted ${entry.hash}`);
      receipt = await client.waitForTransactionReceipt({ hash: entry.hash, confirmations: 2, timeout: 90_000 });
    }
    assert(receipt.status === 'success', `${label} reverted (${entry.hash})`);
    entry.blockNumber = receipt.blockNumber.toString();
    entry.address = receipt.contractAddress;
    save();
    console.log(`${label}: confirmed at ${receipt.blockNumber}`);
    return receipt;
  }
  async function deploy(label, name, args = []) {
    const a = artifacts[name];
    const receipt = await transact(label, { data: encodeDeployData({ abi: a.abi, bytecode: a.bytecode.object, args }) });
    assert(receipt.contractAddress, `${label} has no contract address`);
    return getAddress(receipt.contractAddress);
  }
  const ausd = await deploy('ausd', 'MockAUSD');
  const stata = await deploy('stata', 'MockStata', [ausd]);
  const directory = await deploy('directory', 'BilbyDirectory', [signer.address, verifier]);
  const escrow = await deploy('escrow', 'BilbyEscrow', [ausd, directory, signer.address, verifier, treasury]);
  const router = await deploy('router', 'BilbyRouter', [ausd, stata, escrow, signer.address]);
  const usdc = await deploy('usdc', 'MockAUSD');
  await transact('enableKeeper', { to: router, data: encodeFunctionData({ abi: artifacts.BilbyRouter.abi, functionName: 'setKeeper', args: [keeper, true] }) });
  await transact('fundTreasury', { to: ausd, data: encodeFunctionData({ abi: artifacts.MockAUSD.abi, functionName: 'mint', args: [treasury, 100_000_000_000n] }) });

  const read = (address, name, functionName, args = []) => client.readContract({ address, abi: artifacts[name].abi, functionName, args });
  const sameAddress = (actual, expected, label) => assert(actual.toLowerCase() === expected.toLowerCase(), `${label} mismatch`);
  assert(Number(await read(directory, 'BilbyDirectory', 'VERSION')) === 2, 'Directory version mismatch');
  for (const [address, name] of [[directory, 'BilbyDirectory'], [escrow, 'BilbyEscrow'], [router, 'BilbyRouter']]) {
    assert((await client.getCode({ address }))?.length > 2, `${name} has no bytecode`);
    sameAddress(await read(address, name, 'owner'), signer.address, `${name} owner`);
  }
  sameAddress(await read(directory, 'BilbyDirectory', 'verifier'), verifier, 'Directory verifier');
  sameAddress(await read(escrow, 'BilbyEscrow', 'verifier'), verifier, 'Escrow verifier');
  sameAddress(await read(escrow, 'BilbyEscrow', 'directory'), directory, 'Escrow directory');
  sameAddress(await read(escrow, 'BilbyEscrow', 'token'), ausd, 'Escrow token');
  sameAddress(await read(escrow, 'BilbyEscrow', 'treasury'), treasury, 'Escrow treasury');
  sameAddress(await read(router, 'BilbyRouter', 'ausd'), ausd, 'Router token');
  sameAddress(await read(router, 'BilbyRouter', 'stata'), stata, 'Router savings');
  sameAddress(await read(router, 'BilbyRouter', 'escrow'), escrow, 'Router escrow');
  assert(await read(router, 'BilbyRouter', 'isKeeper', [keeper]), 'Keeper not authorized');
  assert(await read(ausd, 'MockAUSD', 'balanceOf', [treasury]) >= 100_000_000_000n, 'Treasury test float missing');
  // Check historical reads required by the finalized directory reconciler.
  assert(Number(await client.readContract({ address: directory, abi: artifacts.BilbyDirectory.abi, functionName: 'VERSION', blockNumber: BigInt(journal.steps.directory.blockNumber) })) === 2, 'Historical directory read failed');
  const manifest = { chainId: 10143, startBlock: Number(journal.steps.directory.blockNumber), ausd, stata, directory, escrow, router, usdc, owner: signer.address, verifier, treasury, keeper, transactions: Object.fromEntries(Object.entries(journal.steps).map(([name, step]) => [name, step.hash])) };
  atomic(manifestPath, json(manifest), 0o644);
  let env = readFileSync(envPath, 'utf8');
  for (const [key, value] of Object.entries({ DIRECTORY_START_BLOCK: String(manifest.startBlock), USDC_ADDRESS: usdc })) {
    const expression = new RegExp(`^${key}=.*$`, 'm');
    env = expression.test(env) ? env.replace(expression, `${key}=${value}`) : `${env}${key}=${value}\n`;
  }
  atomic(envPath, env);
  journal.verifiedAt = new Date().toISOString();
  save();
  console.log(json({ manifest: manifestPath, ...manifest, remainingMON: formatEther(await client.getBalance({ address: signer.address })) }));
}

main().catch(error => { console.error('Deployment stopped:', error.shortMessage ?? error.message); process.exitCode = 1; });
