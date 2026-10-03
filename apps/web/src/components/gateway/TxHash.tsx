"use client";

import { ExternalLink } from "lucide-react";
import { CopyButton, middleTruncate } from "@/components/activity/ledger-ui";
import { useGatewaySnapshot } from "@/components/gateway/InternalGatewayProvider";
import { explorerTxUrl } from "@/lib/wallet/config";

/** An icon link to the transaction on the connected chain's explorer; nothing on a chain without one (the devnet). */
export function ExplorerLink({ hash, className = "" }: { hash: string; className?: string }) {
  const snapshot = useGatewaySnapshot();
  const url = explorerTxUrl(snapshot.wallet.chainId ?? snapshot.environment.chainId, hash);
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title="View on the block explorer"
      className={`focus-ring inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-faint transition-colors hover:text-ink ${className}`}
    >
      <ExternalLink size={11} aria-hidden="true" />
      <span className="sr-only">View transaction on the block explorer (opens in a new tab)</span>
    </a>
  );
}

/** A transaction hash as every action shows it: shortened, copyable, and linked to the explorer where there is one. */
export function TxHash({ hash, label = "Transaction", className = "" }: { hash: string; label?: string; className?: string }) {
  return (
    <span className={`inline-flex min-w-0 items-center ${className}`}>
      <span title={`${label}: ${hash}`} className="tnum truncate font-mono text-[11px] text-dim">
        {middleTruncate(hash, 10, 6)}
      </span>
      <CopyButton value={hash} label={label.toLowerCase()} size={11} className="h-5 w-5" />
      <ExplorerLink hash={hash} />
    </span>
  );
}
