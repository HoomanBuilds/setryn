"use client";

import "@rainbow-me/rainbowkit/styles.css";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, darkTheme, type Theme } from "@rainbow-me/rainbowkit";
import { WagmiProvider } from "wagmi";
import { useInternalGateway } from "@/components/gateway/InternalGatewayProvider";
import { APP_NAME, createWalletConfig } from "@/lib/wallet/config";
import { WalletBridge } from "./WalletBridge";

const base = darkTheme({
  accentColor: "#c1ff12",
  accentColorForeground: "#0e0e10",
  borderRadius: "small",
  fontStack: "system",
  overlayBlur: "small",
});

/** RainbowKit's dark theme on the platform tokens from app/(platform)/globals.css. */
const walletTheme: Theme = {
  ...base,
  colors: {
    ...base.colors,
    accentColor: "var(--color-brand)",
    accentColorForeground: "var(--color-app)",
    actionButtonBorder: "var(--color-line)",
    actionButtonBorderMobile: "var(--color-line)",
    actionButtonSecondaryBackground: "var(--color-raised)",
    closeButton: "var(--color-dim)",
    closeButtonBackground: "var(--color-raised)",
    connectButtonBackground: "var(--color-raised)",
    connectButtonInnerBackground: "var(--color-panel)",
    connectButtonText: "var(--color-ink)",
    connectionIndicator: "var(--color-up)",
    downloadBottomCardBackground: "var(--color-panel)",
    downloadTopCardBackground: "var(--color-raised)",
    error: "var(--color-down)",
    generalBorder: "var(--color-line)",
    generalBorderDim: "var(--color-line-soft)",
    menuItemBackground: "var(--color-raised)",
    modalBackdrop: "rgba(0, 0, 0, 0.6)",
    modalBackground: "var(--color-panel)",
    modalBorder: "var(--color-line-strong)",
    modalText: "var(--color-ink)",
    modalTextDim: "var(--color-off)",
    modalTextSecondary: "var(--color-dim)",
    profileAction: "var(--color-raised)",
    profileActionHover: "var(--color-inset)",
    profileForeground: "var(--color-panel)",
    selectedOptionBorder: "var(--color-brand-edge)",
    standby: "var(--color-brand)",
  },
  fonts: { body: "var(--font-sans)" },
  radii: {
    actionButton: "var(--radius-md)",
    connectButton: "var(--radius-md)",
    menuButton: "var(--radius-md)",
    modal: "var(--radius-lg)",
    modalMobile: "var(--radius-lg)",
  },
  shadows: {
    ...base.shadows,
    dialog: "0 24px 48px rgba(0, 0, 0, 0.55)",
  },
};

/**
 * The wallet layer for the platform: wagmi for connections, React Query for its reads, and RainbowKit for the connect
 * prompt. It sits inside the gateway provider so the bridge can hand the connected wallet to the gateway.
 */
export function WalletProvider({ children }: { children: ReactNode }) {
  const gateway = useInternalGateway();
  const [config] = useState(createWalletConfig);
  const [queryClient] = useState(() => new QueryClient());
  // Connecting asks the wallet for the runtime's chain first, so a fresh wallet lands on the chain the app signs on.
  const runtimeChainId = useSyncExternalStore(
    gateway.subscribe,
    () => gateway.getSnapshot().environment.chainId,
    () => gateway.getServerSnapshot().environment.chainId,
  );

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={walletTheme}
          modalSize="compact"
          initialChain={runtimeChainId}
          appInfo={{ appName: APP_NAME }}
        >
          <WalletBridge />
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
