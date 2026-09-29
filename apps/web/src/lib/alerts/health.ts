import type { GatewaySnapshot } from "@/lib/internal-gateway/types";
import { OPERATIONS_FIXTURE } from "@/lib/operations/fixture";
import type { DependencyHealth, HealthState, OperationsSnapshot } from "@/lib/operations/types";
import { formatNumber } from "@/lib/terminal/format";
import type { AlertProvenance } from "./types";

/** Body of `GET /api/internal/devnet/status` when the local runtime answers. */
export interface DevnetProbe {
  environment: "LOCAL_DEVNET";
  chainId: number;
  blockNumber: string;
  checkedAt: string;
  healthy: boolean;
  contracts: { label: string; address: string; healthy: boolean }[];
}

/** PENDING before the first probe returns; UNREACHABLE when the probe failed. */
export type DevnetReading = { state: "PENDING" } | { state: "UNREACHABLE"; checkedAt: number } | { state: "OK"; probe: DevnetProbe };

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

function fromState(state: HealthState): HealthTone {
  return state;
}

function dependency(operations: OperationsSnapshot, id: string): DependencyHealth | undefined {
  return operations.dependencies.find((item) => item.id === id);
}

function recorded(
  id: HealthRow["id"],
  label: string,
  item: DependencyHealth | undefined,
  fallback: string,
): HealthRow {
  if (!item) {
    return { id, label, state: "UNAVAILABLE", value: "Not recorded", detail: fallback, provenance: "RECORDED_FIXTURE", freshness: null, href: "/operations" };
  }
  return {
    id,
    label,
    state: fromState(item.state),
    value: item.checkpoint,
    detail: `${item.label}: ${item.detail}`,
    provenance: "RECORDED_FIXTURE",
    freshness: `${item.freshness.ageLabel} / ${item.freshness.thresholdLabel}`,
    href: "/operations",
  };
}

/**
 * Dependency health for the home page and the system strip. Chain and wallet are observed live from the local
 * runtime probe and the gateway; oracle, sequencer, private execution, and indexer rows come from the operator
 * runtime evidence, which is a recorded fixture until the operator ports are wired.
 */
export function systemHealth(
  snapshot: GatewaySnapshot,
  devnet: DevnetReading,
  operations: OperationsSnapshot = OPERATIONS_FIXTURE,
): HealthRow[] {
  const chain: HealthRow =
    devnet.state === "OK"
      ? {
          id: "chain",
          label: "Chain",
          state: devnet.probe.healthy ? "HEALTHY" : "DEGRADED",
          value: `Block ${formatNumber(Number(devnet.probe.blockNumber), 0)}`,
          detail: `${snapshot.environment.label}, chain ${devnet.probe.chainId}. ${devnet.probe.contracts.filter((contract) => contract.healthy).length} of ${devnet.probe.contracts.length} protocol contracts have code.`,
          provenance: "OBSERVED",
          freshness: `checked ${devnet.probe.checkedAt.slice(11, 19)} UTC`,
          href: "/operations",
        }
      : devnet.state === "PENDING"
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
            detail: `The ${snapshot.environment.label} runtime did not answer. Market data keeps streaming from the preview feed; onchain actions wait for the chain.`,
            provenance: "OBSERVED",
            freshness: null,
            href: "/operations",
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

  const streams = operations.indexerStreams;
  const worst = [...streams].sort((a, b) => b.lagBlocks / b.allowedLagBlocks - a.lagBlocks / a.allowedLagBlocks)[0];
  const indexer: HealthRow = worst
    ? {
        id: "indexer",
        label: "Indexer",
        state: streams.some((stream) => stream.state === "UNAVAILABLE")
          ? "UNAVAILABLE"
          : streams.some((stream) => stream.state === "DEGRADED")
            ? "DEGRADED"
            : "HEALTHY",
        value: `${worst.lagBlocks} / ${worst.allowedLagBlocks} blk lag`,
        detail: `Worst stream: ${worst.label}, projected through block ${formatNumber(worst.projectedBlock, 0)}.`,
        provenance: "RECORDED_FIXTURE",
        freshness: `${worst.freshness.ageLabel} / ${worst.freshness.thresholdLabel}`,
        href: "/operations",
      }
    : { id: "indexer", label: "Indexer", state: "UNAVAILABLE", value: "Not recorded", detail: "No indexer stream is recorded.", provenance: "RECORDED_FIXTURE", freshness: null, href: "/operations" };

  return [
    chain,
    wallet,
    recorded("oracle", "Oracle", dependency(operations, "pyth-verifier"), "No oracle verification record."),
    recorded("sequencer", "Sequencer", dependency(operations, "chain-reader"), "No sequencer or chain reader record."),
    recorded("private-execution", "Private execution", dependency(operations, "solver-gateway"), "No firm quote gateway record."),
    indexer,
  ];
}
