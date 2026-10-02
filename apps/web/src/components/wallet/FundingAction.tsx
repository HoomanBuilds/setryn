"use client";

import { useState } from "react";
import { ExternalLink, Plus } from "lucide-react";
import { useGatewaySnapshot } from "@/components/gateway/InternalGatewayProvider";

/** Circle's public USDC test faucet; it serves Arbitrum Sepolia among other test networks. */
const CIRCLE_FAUCET_URL = "https://faucet.circle.com";
const ARBITRUM_SEPOLIA_FAUCET_URL = "https://ethglobal.com/faucet/arbitrum-sepolia-421614";

const ACTION =
  "focus-ring inline-flex h-7 items-center gap-1 rounded-md border border-line px-2 text-[11px] text-dim transition-colors hover:border-line-strong hover:text-ink disabled:opacity-60";

type FundingState = { kind: "IDLE" } | { kind: "SENDING" } | { kind: "DONE"; message: string } | { kind: "FAILED"; message: string };

/**
 * How a wallet gets settlement USDC on the configured network. Mintable deployments grant test USDC in the app,
 * Circle-backed Sepolia points to Circle's faucet, and Arbitrum One expects the wallet to bring real USDC.
 */
export function FundingAction({ className = "" }: { className?: string }) {
  const snapshot = useGatewaySnapshot();
  const [state, setState] = useState<FundingState>({ kind: "IDLE" });
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
    setState({ kind: "SENDING" });
    try {
      const response = await fetch("/api/internal/operator/fund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, asset: "USDC" }),
      });
      const body = (await response.json().catch(() => ({}))) as { usdc?: number; message?: string };
      if (!response.ok) throw new Error(body.message ?? "No test USDC was granted.");
      const amount = typeof body.usdc === "number" ? body.usdc.toLocaleString() : "Test";
      setState({ kind: "DONE", message: `${amount} USDC added to the wallet. Deposit it into your trading account to trade.` });
    } catch (caught) {
      setState({ kind: "FAILED", message: caught instanceof Error ? caught.message : "No test USDC was granted." });
    }
  };

  return (
    <div className={className}>
      <button type="button" className={ACTION} disabled={!address || state.kind === "SENDING"} onClick={() => void request()}>
        <Plus size={12} aria-hidden="true" />
        {state.kind === "SENDING" ? "Adding USDC..." : "Get test USDC"}
      </button>
      {network === "arbitrum-sepolia" ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-snug text-dim">
          <span>You also need Arbitrum Sepolia ETH for trading gas.</span>
          <a href={ARBITRUM_SEPOLIA_FAUCET_URL} target="_blank" rel="noopener noreferrer" className={ACTION}>
            <ExternalLink size={12} aria-hidden="true" />
            Get Sepolia ETH
          </a>
        </div>
      ) : null}
      {state.kind === "DONE" ? <p role="status" className="mt-1.5 text-[11px] leading-snug text-up">{state.message}</p> : null}
      {state.kind === "FAILED" ? <p role="alert" className="mt-1.5 text-[11px] leading-snug text-down">{state.message}</p> : null}
    </div>
  );
}
