import type { Address, Chain } from "viem";
import { monad, monadTestnet } from "viem/chains";

export { monad, monadTestnet };

/** EIP-712 domain fields of a token, as verified on-chain (see research_notes/UPI on Monad risk check). */
export type TokenInfo = {
  address: Address;
  decimals: number;
  /** EIP-712 domain name. For AUSD this differs from `name()` ("AUSD"). */
  domainName: string;
  domainVersion: string;
};

export type Network = {
  chain: Chain;
  /** The dollar token users hold. */
  ausd: TokenInfo;
  usdc?: TokenInfo;
};

export const NETWORKS = {
  [monad.id]: {
    chain: monad,
    ausd: {
      address: "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a",
      decimals: 6,
      domainName: "Agora Dollar",
      domainVersion: "1",
    },
    usdc: {
      address: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
      decimals: 6,
      domainName: "USDC",
      domainVersion: "2",
    },
  },
  [monadTestnet.id]: {
    chain: monadTestnet,
    // Domain assumed to match mainnet; the relay script checks eip712Domain() before signing.
    ausd: {
      address: "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC",
      decimals: 6,
      domainName: "Agora Dollar",
      domainVersion: "1",
    },
  },
} as const satisfies Record<number, Network>;

export type SupportedChainId = keyof typeof NETWORKS;

export function getNetwork(chainId: number): Network {
  const network = (NETWORKS as Record<number, Network>)[chainId];
  if (!network) throw new Error(`Unsupported chain ${chainId}`);
  return network;
}
