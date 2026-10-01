import { connectorsForWallets, type Wallet, type WalletList } from "@rainbow-me/rainbowkit";
import { coinbaseWallet, injectedWallet, safeWallet, walletConnectWallet } from "@rainbow-me/rainbowkit/wallets";
import { defineChain } from "viem";
import { cookieStorage, createConfig, createStorage, http } from "wagmi";
import { arbitrum, arbitrumSepolia } from "wagmi/chains";

export const APP_NAME = "Setryn";

/** The local devnet the runtime deploys to. Wallets list it as "Setryn Local", never as Arbitrum One. */
export const setrynLocal = defineChain({
  id: 31337,
  name: "Setryn Local",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [process.env.NEXT_PUBLIC_SETRYN_LOCAL_RPC_URL || "http://127.0.0.1:8545"] } },
  testnet: true,
});

/** Chains the wallet layer knows. The app signs only on the runtime's chain; the others exist for metadata and reads. */
export const walletChains = [setrynLocal, arbitrum, arbitrumSepolia] as const;

/** WalletConnect is offered only when a project id is configured; none is ever hardcoded. */
export const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim() || null;

/** Where an address is shown on a block explorer: Arbiscan on Arbitrum One and Sepolia, nowhere on the local chain. */
export function explorerAddressUrl(chainId: number | null | undefined, address: string): string | null {
  const chain = walletChains.find((candidate) => candidate.id === chainId);
  const explorer = chain && "blockExplorers" in chain ? chain.blockExplorers?.default : undefined;
  return explorer ? `${explorer.url}/address/${address}` : null;
}

/** The wallet's own name for a chain, for prompts that speak about the wallet rather than the app. */
export function walletChainName(chainId: number | null | undefined): string {
  return walletChains.find((candidate) => candidate.id === chainId)?.name ?? `chain ${chainId ?? "unknown"}`;
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
 * and the session lives in a cookie so a later server read can restore it.
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
      [setrynLocal.id]: http(),
      [arbitrum.id]: http(),
      [arbitrumSepolia.id]: http(),
    },
    ssr: true,
    storage: createStorage({ storage: cookieStorage }),
  });
}
