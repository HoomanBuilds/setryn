import { fallback, http, type HttpTransportConfig, type Transport } from "viem";

const ARBITRUM_SEPOLIA_CHAIN_ID = 421614;

const ARBITRUM_SEPOLIA_PUBLIC_RPCS = [
  "https://sepolia-rollup.arbitrum.io/rpc",
  "https://arbitrum-sepolia-rpc.publicnode.com",
  "https://arbitrum-sepolia.drpc.org",
] as const;

function validatedHttpsUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("INVALID_NETWORK_RPC_URL");
  return url.toString().replace(/\/$/, "");
}

export function serverRpcUrls(primaryRpcUrl: string, chainId: number): string[] {
  const primary = validatedHttpsUrl(primaryRpcUrl);
  if (chainId !== ARBITRUM_SEPOLIA_CHAIN_ID) return [primary];
  const configured = process.env.SETRYN_RPC_FALLBACK_URLS?.split(",").map((value) => value.trim()).filter(Boolean);
  const fallbacks = configured?.length ? configured : ARBITRUM_SEPOLIA_PUBLIC_RPCS;
  return [...new Set([primary, ...fallbacks.map(validatedHttpsUrl)])].slice(0, 4);
}

export function serverReadTransport(primaryRpcUrl: string, chainId: number, config: HttpTransportConfig = {}): Transport {
  const transports = serverRpcUrls(primaryRpcUrl, chainId).map((url) => http(url, { ...config, retryCount: 0 }));
  if (transports.length === 1) return transports[0];
  return fallback(transports, { rank: false, retryCount: 0 });
}
