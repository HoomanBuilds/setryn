import { connectorsForWallets, type Wallet, type WalletList } from "@rainbow-me/rainbowkit";
import { coinbaseWallet, injectedWallet, safeWallet, walletConnectWallet } from "@rainbow-me/rainbowkit/wallets";
import type { Chain } from "viem";
import { cookieStorage, createConfig, createStorage, http } from "wagmi";
import { arbitrum, arbitrumSepolia } from "wagmi/chains";
import { networkChain, publicNetwork } from "@/lib/internal-gateway/network";

export const APP_NAME = "Setryn";

/** The network this build serves (NEXT_PUBLIC_SETRYN_NETWORK, filled from SETRYN_NETWORK by next.config.ts). */
export const walletNetwork = publicNetwork();

/** RPC the browser and the wallet use; empty means each chain's own public endpoint. */
const browserRpcUrl = process.env.NEXT_PUBLIC_SETRYN_RPC_URL?.trim() || null;

/**
 * The local chain the runtime deploys to. Wallets list it as "Setryn Local"; the platform itself presents it as
 * Arbitrum One, which it mirrors.
 */
export const setrynLocal = networkChain(
  "local",
  process.env.NEXT_PUBLIC_SETRYN_LOCAL_RPC_URL?.trim() || browserRpcUrl || "http://127.0.0.1:8545",
);

/** The one chain the app signs on: the configured network's. A wallet anywhere else is asked to switch to it. */
export const setrynChain: Chain =
  walletNetwork === "arbitrum-one" ? arbitrum : walletNetwork === "arbitrum-sepolia" ? arbitrumSepolia : setrynLocal;

/** Chains the wallet layer connects on: only the configured one, so wrong-network handling always targets it. */
export const walletChains = [setrynChain] as const;

/** Every chain the app can name, for labels and explorer links when a wallet sits elsewhere. */
const knownChains: readonly Chain[] = [setrynLocal, arbitrum, arbitrumSepolia];

/** WalletConnect is offered only when a project id is configured; none is ever hardcoded. */
export const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim() || null;

/** Where an address is shown on a block explorer: Arbiscan on Arbitrum One and Sepolia, nowhere on the local chain. */
export function explorerAddressUrl(chainId: number | null | undefined, address: string): string | null {
  const chain = knownChains.find((candidate) => candidate.id === chainId);
  const explorer = chain?.blockExplorers?.default;
  return explorer ? `${explorer.url}/address/${address}` : null;
}

/** Where a transaction is shown on a block explorer: Arbiscan on Arbitrum One and Sepolia, nowhere on the local chain. */
export function explorerTxUrl(chainId: number | null | undefined, hash: string): string | null {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) return null;
  const chain = knownChains.find((candidate) => candidate.id === chainId);
  const explorer = chain?.blockExplorers?.default;
  return explorer ? `${explorer.url}/tx/${hash}` : null;
}

/** The wallet's own name for a chain, for prompts that speak about the wallet rather than the app. */
export function walletChainName(chainId: number | null | undefined): string {
  return knownChains.find((candidate) => candidate.id === chainId)?.name ?? `chain ${chainId ?? "unknown"}`;
}

/** Any injected provider without an EIP-6963 announcement. Hidden when the browser has no injected wallet at all. */
function browserWallet(): Wallet {
  return { ...injectedWallet(), hidden: () => typeof window === "undefined" || !("ethereum" in window) };
}

function walletList(): WalletList {
  const wallets = [browserWallet, coinbaseWallet, safeWallet];
  // EIP-6963 wallets (MetaMask, Rabby, and others) are discovered by wagmi and listed above these as installed.
  return [{ groupName: "Wallets", wallets: walletConnectProjectId ? [...wallets, walletConnectWallet] : wallets }];
}

/**
 * One wagmi config per client. `ssr` defers reconnecting to after hydration so server and first client render agree,
 * and the session lives in a cookie so a later server read can restore it. Reads go through NEXT_PUBLIC_SETRYN_RPC_URL
 * when it is set, else the chain's own RPC.
 */
export function createWalletConfig() {
  return createConfig({
    chains: walletChains,
    connectors: connectorsForWallets(walletList(), {
      appName: APP_NAME,
      // Only walletConnectWallet reads it, and it is listed only when the id is set.
      projectId: walletConnectProjectId ?? "",
    }),
    transports: {
      [setrynChain.id]: http(browserRpcUrl ?? undefined),
    },
    ssr: true,
    storage: createStorage({ storage: cookieStorage }),
  });
}
