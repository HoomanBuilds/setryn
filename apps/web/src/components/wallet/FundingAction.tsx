"use client";

import { useState } from "react";
import { ExternalLink, Plus } from "lucide-react";
import { useGatewaySnapshot, useInternalGateway } from "@/components/gateway/InternalGatewayProvider";
import { ActionOutcome, type ActionOutcomeState } from "@/components/gateway/ActionStatus";
import { describeActionError } from "@/lib/internal-gateway/action-errors";

/** Circle's public USDC test faucet; it serves Arbitrum Sepolia among other test networks. */
const CIRCLE_FAUCET_URL = "https://faucet.circle.com";
const ARBITRUM_SEPOLIA_FAUCET_URL = "https://ethglobal.com/faucet/arbitrum-sepolia-421614";

const ACTION =
  "focus-ring inline-flex h-7 items-center gap-1 rounded-md border border-line px-2 text-[11px] text-dim transition-colors hover:border-line-strong hover:text-ink disabled:opacity-60";


/**
 * How a wallet gets settlement USDC on the configured network. Mintable deployments grant test USDC in the app,
 * Circle-backed Sepolia points to Circle's faucet, and Arbitrum One expects the wallet to bring real USDC.
 */
export function FundingAction({ className = "" }: { className?: string }) {
  const snapshot = useGatewaySnapshot();
  const gateway = useInternalGateway();
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<ActionOutcomeState | null>(null);
  const network = snapshot.environment.network;
  const address = snapshot.wallet.status === "CONNECTED" ? snapshot.wallet.address : null;

  if (network === "arbitrum-one") return null;

  if (network === "arbitrum-sepolia" && !snapshot.environment.settlementTokenMintable) {
    return (
      <div className={`text-[11px] leading-snug text-dim ${className}`}>
        <p>
          Trading settles in USDC on Arbitrum Sepolia. Get test USDC from Circle&apos;s faucet (choose Arbitrum Sepolia and
          paste your wallet address), keep a little Arbitrum Sepolia ETH for gas, then deposit the USDC into your trading
          account.
        </p>
        <a href={CIRCLE_FAUCET_URL} target="_blank" rel="noopener noreferrer" className={`${ACTION} mt-1.5`}>
          <ExternalLink size={12} aria-hidden="true" />
          Circle USDC faucet
        </a>
      </div>
    );
  }

  const request = async () => {
    if (!address) return;
    setSending(true);
    setOutcome(null);
    try {
      const granted = await gateway.claimTestUsdc();
      const amount = granted.usdc > 0 ? granted.usdc.toLocaleString("en-US") : "Test";
      setOutcome({ ok: true, text: `${amount} USDC added to the wallet. Deposit it into your trading account to trade.`, transactionHash: granted.transactionHash });
    } catch (caught) {
      // The dock carries the exact sentence; this line repeats it next to the button.
      const latest = gateway.getSnapshot().actions.find((action) => action.title === "Get test USDC");
      setOutcome({ ok: false, text: latest?.message ?? describeActionError(caught, { fallback: "No test USDC was granted." }) });
    } finally {
      setSending(false);
    }
  };

  const wallet = snapshot.account.walletBalance;

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button type="button" className={ACTION} disabled={!address || sending} onClick={() => void request()}>
          <Plus size={12} aria-hidden="true" />
          {sending ? "Minting test USDC..." : "Get test USDC"}
        </button>
        {address && wallet !== null ? (
          <span className="tnum font-mono text-[11px] text-faint">{`Wallet ${wallet.toLocaleString("en-US", { maximumFractionDigits: 2 })} USDC`}</span>
        ) : null}
        {!address ? <span className="text-[11px] text-faint">Connect a wallet to get test USDC.</span> : null}
      </div>
      {network === "arbitrum-sepolia" ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-snug text-dim">
          <span>You also need Arbitrum Sepolia ETH for trading gas.</span>
          <a href={ARBITRUM_SEPOLIA_FAUCET_URL} target="_blank" rel="noopener noreferrer" className={ACTION}>
            <ExternalLink size={12} aria-hidden="true" />
            Get Sepolia ETH
          </a>
        </div>
      ) : null}
      <ActionOutcome outcome={outcome} className="mt-1.5 text-[11px] leading-snug" />
    </div>
  );
}
