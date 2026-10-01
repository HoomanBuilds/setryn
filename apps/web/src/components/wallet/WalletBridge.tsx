"use client";

import { useEffect, useRef } from "react";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import type { EIP1193Provider } from "viem";
import { useAccount, useDisconnect, useSwitchChain } from "wagmi";
import { useInternalGateway } from "@/components/gateway/InternalGatewayProvider";

/**
 * Hands whichever wallet the user connected through wagmi to the trading gateway, so the gateway's signing client is
 * built over that connector's own EIP-1193 provider. Account, chain and connector changes re-attach; a disconnect
 * detaches. It also gives the gateway the connect prompt, network switch and disconnect behind `connectWallet()`.
 */
export function WalletBridge() {
  const gateway = useInternalGateway();
  const { status, address, chainId, connector } = useAccount();
  const { connectModalOpen, openConnectModal } = useConnectModal();
  const { switchChainAsync } = useSwitchChain();
  const { disconnect } = useDisconnect();

  const controls = useRef({ openConnectModal, switchChainAsync, disconnect });
  useEffect(() => {
    controls.current = { openConnectModal, switchChainAsync, disconnect };
  }, [openConnectModal, switchChainAsync, disconnect]);

  useEffect(() => {
    gateway.bindWalletControls({
      openConnect: () => {
        const open = controls.current.openConnectModal;
        if (!open) return false;
        open();
        return true;
      },
      switchChain: async (target) => {
        await controls.current.switchChainAsync({ chainId: target });
      },
      disconnect: () => controls.current.disconnect(),
    });
    return () => gateway.bindWalletControls(null);
  }, [gateway]);

  useEffect(() => {
    if (status === "disconnected") {
      gateway.detachWallet();
      return;
    }
    if (status !== "connected" || !connector || !address || chainId === undefined) return;
    let current = true;
    connector
      .getProvider()
      .then((provider) => {
        if (!current || !provider) return;
        // Failures surface through the connectWallet caller that is waiting, or leave the wallet disconnected.
        gateway.attachWallet({ provider: provider as EIP1193Provider, address, chainId }).catch(() => undefined);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [gateway, status, connector, address, chainId]);

  // The connect prompt closing with no wallet connected (dismissed, or a rejected request) ends a waiting connectWallet.
  const promptShown = useRef(false);
  useEffect(() => {
    if (connectModalOpen) {
      promptShown.current = true;
      return;
    }
    if (promptShown.current && status === "disconnected") {
      promptShown.current = false;
      gateway.cancelWalletConnection();
    }
  }, [gateway, connectModalOpen, status]);

  return null;
}
