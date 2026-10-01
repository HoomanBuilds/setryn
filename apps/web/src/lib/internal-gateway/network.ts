import { defineChain, type Chain } from "viem";
import { arbitrum, arbitrumSepolia } from "viem/chains";
import type { SetrynNetwork } from "./runtime";
import type { RuntimeEnvironment } from "./types";

/*
 * The networks a Setryn deployment runs on (docs/plans/network-runtime-real-data.md). Safe to import from the browser:
 * nothing here reads a server-only variable.
 */

export const SETRYN_NETWORKS: readonly SetrynNetwork[] = ["local", "arbitrum-sepolia", "arbitrum-one"];

export interface NetworkProfile {
  network: SetrynNetwork;
  chainId: number;
  /** What the product calls the network. The local chain mirrors Arbitrum One and presents as it. */
  label: string;
  environmentId: RuntimeEnvironment["id"];
  evidence: RuntimeEnvironment["evidence"];
  /** RPC used when none is configured: the loopback node locally, the public Arbitrum endpoint on a network. */
  defaultRpcUrl: string;
}

export const NETWORK_PROFILES: Record<SetrynNetwork, NetworkProfile> = {
  local: {
    network: "local",
    chainId: 31337,
    label: "Arbitrum One",
    environmentId: "LOCAL",
    evidence: "ONCHAIN",
    defaultRpcUrl: "http://127.0.0.1:8545",
  },
  "arbitrum-sepolia": {
    network: "arbitrum-sepolia",
    chainId: 421614,
    label: "Arbitrum Sepolia",
    environmentId: "ARBITRUM_SEPOLIA",
    evidence: "TESTNET",
    defaultRpcUrl: "https://sepolia-rollup.arbitrum.io/rpc",
  },
  "arbitrum-one": {
    network: "arbitrum-one",
    chainId: 42161,
    label: "Arbitrum One",
    environmentId: "ARBITRUM_ONE",
    evidence: "MAINNET",
    defaultRpcUrl: "https://arb1.arbitrum.io/rpc",
  },
};

export function isSetrynNetwork(value: unknown): value is SetrynNetwork {
  return typeof value === "string" && (SETRYN_NETWORKS as readonly string[]).includes(value);
}

/** A configured network name; unset means the local chain, anything unknown is refused. */
export function parseNetwork(value: string | undefined | null): SetrynNetwork {
  const trimmed = value?.trim();
  if (!trimmed) return "local";
  if (!isSetrynNetwork(trimmed)) throw new Error("INVALID_SETRYN_NETWORK");
  return trimmed;
}

export function networkForChainId(chainId: number): SetrynNetwork | null {
  return SETRYN_NETWORKS.find((network) => NETWORK_PROFILES[network].chainId === chainId) ?? null;
}

/**
 * The network the browser bundle was built for. next.config.ts fills NEXT_PUBLIC_SETRYN_NETWORK from SETRYN_NETWORK, so
 * one setting drives both sides; an unknown value falls back to the local chain rather than breaking the page.
 */
export function publicNetwork(): SetrynNetwork {
  const value = process.env.NEXT_PUBLIC_SETRYN_NETWORK?.trim();
  return isSetrynNetwork(value) ? value : "local";
}

/** The environment the platform reports for a network. */
export function networkEnvironment(network: SetrynNetwork): RuntimeEnvironment {
  const profile = NETWORK_PROFILES[network];
  return { id: profile.environmentId, network, label: profile.label, chainId: profile.chainId, evidence: profile.evidence };
}

/**
 * The chain viem signs and estimates for: Arbitrum One and Arbitrum Sepolia as viem defines them, and the local chain
 * on its own RPC. Wallets list the local chain under its own name; the product still presents it as Arbitrum One.
 */
export function networkChain(network: SetrynNetwork, rpcUrl: string): Chain {
  if (network === "arbitrum-one") return arbitrum;
  if (network === "arbitrum-sepolia") return arbitrumSepolia;
  return defineChain({
    id: NETWORK_PROFILES.local.chainId,
    name: "Setryn Local",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
    testnet: true,
  });
}
