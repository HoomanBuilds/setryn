"use client";

import { useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Check, ChevronDown, Copy, ExternalLink, LogOut, Wallet } from "lucide-react";
import { useAccount, useDisconnect, useSwitchChain } from "wagmi";
import { useGatewaySnapshot } from "@/components/gateway/InternalGatewayProvider";
import { ChainIcon, chainLabelOf } from "@/components/icons/AssetIcon";
import { StatusDot } from "@/components/terminal/primitives";
import { explorerAddressUrl, walletChainName } from "@/lib/wallet/config";

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/** True when the wallet, or the connect prompt, reported an EIP-1193 user rejection. */
export function isWalletRejection(error: unknown): boolean {
  for (let cause = error, depth = 0; cause && typeof cause === "object" && depth < 8; depth += 1) {
    if ((cause as { code?: unknown }).code === 4001) return true;
    cause = (cause as { cause?: unknown }).cause;
  }
  return error instanceof Error && /user (rejected|denied)/i.test(error.message);
}

const TRIGGER =
  "focus-ring flex h-11 items-center gap-1.5 rounded-md border border-line bg-raised px-2 text-sm text-dim transition-colors hover:border-line-strong hover:text-ink lg:h-9 lg:gap-2 lg:px-2.5";

/**
 * The header's wallet control. Disconnected it opens the wallet prompt; with a wallet attached it shows the address on
 * the network mark (or a warning dot on another network) and toggles the account panel.
 */
export function WalletTrigger({
  expanded,
  accountLabel,
  onConnect,
  onToggle,
}: {
  expanded: boolean;
  accountLabel: string;
  onConnect: () => void;
  onToggle: () => void;
}) {
  const snapshot = useGatewaySnapshot();
  const { status, address } = snapshot.wallet;
  return (
    <ConnectButton.Custom>
      {({ mounted }) => {
        const attached = mounted && (status === "CONNECTED" || status === "WRONG_NETWORK") && address;
        if (!attached) {
          return (
            <button type="button" onClick={onConnect} aria-label="Connect wallet" className={TRIGGER}>
              <Wallet size={15} aria-hidden="true" className="shrink-0" />
              <span className="hidden min-[360px]:inline">{status === "CONNECTING" ? "Connecting..." : "Connect"}</span>
            </button>
          );
        }
        const wrongNetwork = status === "WRONG_NETWORK";
        return (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-label={`Account, ${accountLabel}${wrongNetwork ? ", wallet on another network" : ""}`}
            title={wrongNetwork ? "The wallet is on another network. Switch to trade." : undefined}
            className={TRIGGER}
          >
            {wrongNetwork ? <StatusDot ok={false} /> : <ChainIcon size={15} />}
            <span className="hidden font-mono text-xs text-ink min-[360px]:inline">{shortAddress(address)}</span>
            <ChevronDown
              size={14}
              aria-hidden="true"
              className={`shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
            />
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
}

const ACTION =
  "focus-ring inline-flex h-7 items-center gap-1 rounded-md border border-line px-2 text-[11px] text-dim transition-colors hover:border-line-strong hover:text-ink disabled:opacity-60";

/**
 * The account panel's wallet block: address with copy and explorer link, the connector and gas balance, Disconnect,
 * and Switch network when the wallet sits on a chain the app does not sign on.
 */
export function WalletDetails({ onConnect, onDisconnect }: { onConnect: () => void; onDisconnect: () => void }) {
  const snapshot = useGatewaySnapshot();
  const { connector, chainId: walletChainId } = useAccount();
  const { disconnect } = useDisconnect();
  const { switchChainAsync, isPending: switching } = useSwitchChain();
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const { status, address } = snapshot.wallet;
  const runtimeChainId = snapshot.environment.chainId;

  if ((status !== "CONNECTED" && status !== "WRONG_NETWORK") || !address) {
    return (
      <button
        type="button"
        disabled={status === "CONNECTING"}
        onClick={onConnect}
        className="focus-ring mt-3 h-9 w-full rounded-md bg-brand text-xs font-semibold text-app disabled:opacity-60"
      >
        {status === "CONNECTING" ? "Connecting..." : "Connect wallet"}
      </button>
    );
  }

  const explorer = explorerAddressUrl(snapshot.wallet.chainId, address);
  const copy = () => {
    void navigator.clipboard
      ?.writeText(address)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1_500);
      })
      .catch(() => undefined);
  };
  const switchNetwork = async () => {
    setMessage(null);
    try {
      await switchChainAsync({ chainId: runtimeChainId });
    } catch (error) {
      setMessage(
        isWalletRejection(error)
          ? "The network switch was rejected in your wallet. Nothing was submitted."
          : "The wallet did not switch networks. Try again from your wallet.",
      );
    }
  };

  return (
    <ConnectButton.Custom>
      {({ account }) => (
        <div className="mt-2">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-mono text-dim" title={address}>
              {shortAddress(address)}
            </span>
            {status === "CONNECTED" ? (
              <span className="flex items-center gap-1.5 text-faint">
                <ChainIcon size={13} />
                {chainLabelOf(snapshot.wallet.chainId ?? runtimeChainId)}
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-down">
                <StatusDot ok={false} />
                {walletChainName(walletChainId ?? snapshot.wallet.chainId)}
              </span>
            )}
          </div>
          <p className="mt-1 text-[11px] text-faint">
            {[connector?.name, account?.displayBalance ? `Gas ${account.displayBalance}` : null].filter(Boolean).join(" / ")}
          </p>

          {status === "WRONG_NETWORK" ? (
            <div className="mt-2">
              <p className="text-xs leading-snug text-dim">
                {`The wallet is on another network. Switch to ${chainLabelOf(runtimeChainId)} to sign and trade.`}
              </p>
              <button
                type="button"
                disabled={switching}
                onClick={() => void switchNetwork()}
                className="focus-ring mt-2 h-9 w-full rounded-md bg-brand text-xs font-semibold text-app disabled:opacity-60"
              >
                {switching ? "Switching..." : "Switch network"}
              </button>
            </div>
          ) : null}

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <button type="button" onClick={copy} className={ACTION} aria-label="Copy wallet address">
              {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
              {copied ? "Copied" : "Copy address"}
            </button>
            {explorer ? (
              <a href={explorer} target="_blank" rel="noopener noreferrer" className={ACTION}>
                <ExternalLink size={12} aria-hidden="true" />
                Arbiscan
              </a>
            ) : null}
            <button
              type="button"
              onClick={() => {
                disconnect();
                onDisconnect();
              }}
              className={`${ACTION} ml-auto`}
            >
              <LogOut size={12} aria-hidden="true" />
              Disconnect
            </button>
          </div>
          {message ? <p className="mt-2 text-xs leading-snug text-dim">{message}</p> : null}
        </div>
      )}
    </ConnectButton.Custom>
  );
}
