/**
 * Test helper for local-relay-e2e.sh: writes the same JSON the app's "Sign & share for relay"
 * produces, using the app's key derivation (PRF output → deriveEvmPrivateKey).
 * Usage: tsx scripts/sign-like-app.mts <prfHex> <token> <to> <amountUsd> <chainId>  → prints JSON
 */
import { authorizationTypedData, deriveEvmPrivateKey, getNetwork, newAuthorization, parseUsd } from "@bilbypay/core";
import { bytesToHex, getAddress, type Hex, hexToBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const [prfHex, tokenArg, toArg, amountUsd, chainIdArg] = process.argv.slice(2);
if (!prfHex || !tokenArg || !toArg || !amountUsd || !chainIdArg) throw new Error("usage: <prfHex> <token> <to> <amountUsd> <chainId>");
const chainId = Number(chainIdArg);
const token = { ...getNetwork(chainId).ausd, address: getAddress(tokenArg) };
const account = privateKeyToAccount(bytesToHex(deriveEvmPrivateKey(hexToBytes(prfHex as Hex))));
const auth = newAuthorization({ from: account.address, to: getAddress(toArg), value: parseUsd(amountUsd), ttlSeconds: 3600 });
const signature = await account.signTypedData(authorizationTypedData("TransferWithAuthorization", token, chainId, auth));
console.log(
  JSON.stringify({
    chainId,
    token: token.address,
    from: auth.from,
    to: auth.to,
    value: auth.value.toString(),
    validAfter: auth.validAfter.toString(),
    validBefore: auth.validBefore.toString(),
    nonce: auth.nonce,
    signature,
  }),
);
