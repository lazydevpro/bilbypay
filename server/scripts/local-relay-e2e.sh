#!/usr/bin/env bash
# Runs the relay spike end to end against a local anvil node that pretends to be Monad (chain 143),
# with MockAUSD standing in for AUSD. Needs foundry (forge, anvil, cast) on PATH.
# Set SOLC=/path/to/solc to use a specific compiler binary.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(cd .. && pwd)
PORT=${PORT:-8546}
RPC=http://127.0.0.1:$PORT
ANVIL_CONFIG=$(mktemp)

anvil --chain-id 143 --port "$PORT" --silent --config-out "$ANVIL_CONFIG" &
ANVIL=$!
trap 'kill $ANVIL 2>/dev/null; rm -f "$ANVIL_CONFIG"' EXIT
for _ in $(seq 50); do cast chain-id --rpc-url "$RPC" >/dev/null 2>&1 && [ -s "$ANVIL_CONFIG" ] && break; sleep 0.1; done
# anvil's first funded dev account is the relayer
RELAYER_KEY=$(jq -r '.private_keys[0]' "$ANVIL_CONFIG")

(cd "$ROOT/contracts" && forge build ${SOLC:+--use "$SOLC"} >/dev/null)
BYTECODE=$(jq -r .bytecode.object "$ROOT/contracts/out/MockAUSD.sol/MockAUSD.json")
TOKEN=$(cast send --rpc-url "$RPC" --private-key "$RELAYER_KEY" --create "$BYTECODE" --json | jq -r .contractAddress)

SENDER_KEY=$(cast wallet new --json | jq -r '.[0].private_key')
SENDER=$(cast wallet address "$SENDER_KEY")
cast send --rpc-url "$RPC" --private-key "$RELAYER_KEY" "$TOKEN" "mint(address,uint256)" "$SENDER" 5000000 >/dev/null
echo "MockAUSD $TOKEN; sender $SENDER funded with \$5 AUSD and 0 MON"

CHAIN_ID=143 RPC_URL=$RPC TOKEN_ADDRESS=$TOKEN RELAYER_PRIVATE_KEY=$RELAYER_KEY SENDER_PRIVATE_KEY=$SENDER_KEY \
  RECIPIENT=0x000000000000000000000000000000000000dEaD AMOUNT_USD=1.25 \
  npx tsx scripts/relay-3009.ts

echo
echo "--- passkey path: relay a payment signed the way the app signs it ---"
PRF=0x$(openssl rand -hex 32)
APP_FILE=$(mktemp --suffix .json)
trap 'kill $ANVIL 2>/dev/null; rm -f "$ANVIL_CONFIG" "$APP_FILE"' EXIT
npx tsx scripts/sign-like-app.mts "$PRF" "$TOKEN" 0x000000000000000000000000000000000000bEEF 0.50 143 > "$APP_FILE"
APP_SENDER=$(jq -r .from "$APP_FILE")
cast send --rpc-url "$RPC" --private-key "$RELAYER_KEY" "$TOKEN" "mint(address,uint256)" "$APP_SENDER" 1000000 >/dev/null
CHAIN_ID=143 RPC_URL=$RPC TOKEN_ADDRESS=$TOKEN RELAYER_PRIVATE_KEY=$RELAYER_KEY SIGNED_AUTH_FILE=$APP_FILE \
  npx tsx scripts/relay-3009.ts
