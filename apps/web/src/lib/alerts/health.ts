import type { GatewaySnapshot } from "@/lib/internal-gateway/types";
import type { MarketDataSnapshot, MarketFeedStatus } from "@/lib/market-data/types";
import { platformNow } from "@/lib/terminal/clock";
import { formatNumber } from "@/lib/terminal/format";
import type { AlertProvenance } from "./types";

/** Body of `GET /api/internal/operator/status` when the network runtime answers. */
export interface OperatorProbe {
  environment: string;
  chainId: number;
  blockNumber: string;
  checkedAt: string;
  healthy: boolean;
  contracts: { label: string; address: string; healthy: boolean }[];
}

/** PENDING before the first probe returns; UNREACHABLE when the probe failed. */
export type OperatorReading =
  | { state: "PENDING" }
  | { state: "UNREACHABLE"; checkedAt: number }
  | { state: "OK"; probe: OperatorProbe };

/** The status probe route. */
export const OPERATOR_STATUS_PATH = "/api/internal/operator/status";

export type HealthTone = "HEALTHY" | "DEGRADED" | "UNAVAILABLE" | "CHECKING";

export interface HealthRow {
  id: "chain" | "wallet" | "oracle" | "sequencer" | "private-execution" | "indexer";
  label: string;
  state: HealthTone;
  value: string;
  detail: string;
  provenance: AlertProvenance;
  /** Age against threshold, when the source records one. */
  freshness: string | null;
  href: string | null;
}

/** The market-data feed as `useMarketBoard()` reports it. */
export interface FeedReading {
  status: MarketFeedStatus;
  snapshot: MarketDataSnapshot | null;
}

/** A Chainlink round older than this reads as degraded; aggregators heartbeat within a day. */
const REFERENCE_STALE_SECONDS = 26 * 3_600;

function ageLabel(seconds: number): string {
  if (seconds < 120) return `${Math.max(0, Math.round(seconds))}s`;
  if (seconds < 7_200) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3_600)}h`;
}

function oracleRow(feed: FeedReading | undefined, nowSeconds: number): HealthRow {
  const references = Object.values(feed?.snapshot?.references ?? {});
  if (!feed || feed.status === "LOADING") {
    return { id: "oracle", label: "Oracle", state: "CHECKING", value: "Reading", detail: "Reading Chainlink references through the market-data feed.", provenance: "OBSERVED", freshness: null, href: null };
  }
  if (references.length === 0) {
    return {
      id: "oracle",
      label: "Oracle",
      state: "UNAVAILABLE",
      value: "Not read",
      detail: "The market-data feed returned no Chainlink reference. Marks fall back to the book and fills.",
      provenance: "OBSERVED",
      freshness: null,
      href: null,
    };
  }
  const oldest = references.reduce((worst, quote) => (quote.updatedAt < worst.updatedAt ? quote : worst));
  const age = nowSeconds - oldest.updatedAt;
  return {
    id: "oracle",
    label: "Oracle",
    state: age > REFERENCE_STALE_SECONDS ? "DEGRADED" : "HEALTHY",
    value: `${references.length} Chainlink feed${references.length === 1 ? "" : "s"}`,
    detail: `Oldest round: ${oldest.underlying} at ${formatNumber(oldest.price, oldest.price < 10 ? 4 : 2)}, chain ${oldest.chainId}.`,
    provenance: "OBSERVED",
    freshness: `${ageLabel(age)} / ${ageLabel(REFERENCE_STALE_SECONDS)}`,
    href: null,
  };
}

function feedRow(feed: FeedReading | undefined, nowSeconds: number): HealthRow {
  if (!feed || feed.status === "LOADING") {
    return { id: "indexer", label: "Market data", state: "CHECKING", value: "Loading", detail: "Reading books, fills and references at one block.", provenance: "OBSERVED", freshness: null, href: null };
  }
  if (!feed.snapshot) {
    return {
      id: "indexer",
      label: "Market data",
      state: "UNAVAILABLE",
      value: "Unavailable",
      detail: "The market-data feed did not answer. Marks, books and charts wait for it.",
      provenance: "OBSERVED",
      freshness: null,
      href: null,
    };
  }
  const age = nowSeconds - feed.snapshot.asOf;
  return {
    id: "indexer",
    label: "Market data",
    state: feed.status === "LIVE" ? "HEALTHY" : "DEGRADED",
    value: `Block ${formatNumber(feed.snapshot.blockNumber, 0)}`,
    detail: `${feed.snapshot.markets.length} markets read at one block on chain ${feed.snapshot.chainId}${feed.status === "STALE" ? "; the last refresh failed" : ""}.`,
    provenance: "OBSERVED",
    freshness: `${ageLabel(age)} old`,
    href: null,
  };
}

/**
 * Dependency health for the home page and the system strip, every row observed live: the chain from the operator
 * status probe, the wallet from the gateway, and the oracle and market data from the market-data feed.
 */
export function systemHealth(
  snapshot: GatewaySnapshot,
  reading: OperatorReading,
  feed?: FeedReading,
  nowSeconds: number = Math.floor(platformNow() / 1000),
): HealthRow[] {
  const chain: HealthRow =
    reading.state === "OK"
      ? {
          id: "chain",
          label: "Chain",
          state: reading.probe.healthy ? "HEALTHY" : "DEGRADED",
          value: `Block ${formatNumber(Number(reading.probe.blockNumber), 0)}`,
          detail: `${snapshot.environment.label}, chain ${reading.probe.chainId}. ${reading.probe.contracts.filter((contract) => contract.healthy).length} of ${reading.probe.contracts.length} protocol contracts have code.`,
          provenance: "OBSERVED",
          freshness: `checked ${reading.probe.checkedAt.slice(11, 19)} UTC`,
          href: null,
        }
      : reading.state === "PENDING"
        ? {
            id: "chain",
            label: "Chain",
            state: "CHECKING",
            value: "Probing",
            detail: `Reading block height and contract code from the ${snapshot.environment.label} RPC.`,
            provenance: "OBSERVED",
            freshness: null,
            href: null,
          }
        : {
            id: "chain",
            label: "Chain",
            state: "UNAVAILABLE",
            value: "RPC unreachable",
            detail: `The ${snapshot.environment.label} RPC did not answer. Onchain actions wait for the chain.`,
            provenance: "OBSERVED",
            freshness: null,
            href: null,
          };

  const walletStatus = snapshot.wallet.status;
  const wallet: HealthRow = {
    id: "wallet",
    label: "Wallet",
    state: walletStatus === "CONNECTED" ? "HEALTHY" : walletStatus === "CONNECTING" ? "CHECKING" : walletStatus === "WRONG_NETWORK" ? "DEGRADED" : "UNAVAILABLE",
    value:
      walletStatus === "CONNECTED" && snapshot.wallet.address
        ? `${snapshot.wallet.address.slice(0, 6)}...${snapshot.wallet.address.slice(-4)}`
        : walletStatus === "WRONG_NETWORK"
          ? "Wrong network"
          : walletStatus === "CONNECTING"
            ? "Connecting"
            : "Not connected",
    detail:
      walletStatus === "CONNECTED"
        ? `Signing on chain ${snapshot.wallet.chainId ?? snapshot.environment.chainId}.`
        : "Connect a wallet to sign orders, RFQs, and collateral moves.",
    provenance: "OBSERVED",
    freshness: null,
    href: null,
  };

  return [chain, wallet, oracleRow(feed, nowSeconds), feedRow(feed, nowSeconds)];
}
