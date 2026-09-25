// Token addresses per chain (lowercase, matching `address_format: lowercase` in config.yaml).
// Mirrors packages/core/src/chains.ts. They live here rather than in config.yaml because the
// token events are matched by account (wildcard + topic filter), not by token address.

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export type ChainTokens = {
  /** Agora AUSD, 6 decimals. */
  ausd: string;
  /** Aave static aToken for AUSD (ERC-4626), the Burrow. Zero when not deployed on the chain. */
  stata: string;
};

const lower = (value: string | undefined, fallback: string) => (value && value.length > 0 ? value : fallback).toLowerCase();

export const TOKENS: Record<number, ChainTokens> = {
  143: {
    ausd: lower(process.env.ENVIO_MONAD_AUSD_ADDRESS, "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a"),
    stata: lower(process.env.ENVIO_MONAD_STATA_ADDRESS, "0x9e1AcC5BFbf34e2E579763cE14042d957719fE76"),
  },
  10143: {
    ausd: lower(process.env.ENVIO_TESTNET_AUSD_ADDRESS, "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC"),
    // No stataAUSD on testnet yet; the Burrow is mocked there (contracts/test/mocks/MockStata.sol).
    stata: lower(process.env.ENVIO_TESTNET_STATA_ADDRESS, ZERO_ADDRESS),
  },
};

export function tokensFor(chainId: number): ChainTokens {
  const tokens = TOKENS[chainId];
  if (!tokens) throw new Error(`No token addresses configured for chain ${chainId}`);
  return tokens;
}

export const AUSD_DECIMALS = 6;
