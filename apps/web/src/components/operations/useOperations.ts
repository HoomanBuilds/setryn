"use client";

import { useEffect, useMemo, useState } from "react";
import { useChainNow, useMarketBoard } from "@/components/market-data/MarketDataProvider";
import { useDeploymentEvidence, useDeploymentRuntime, useOperatorStatus } from "@/lib/operations/hooks";
import { buildOperationsSnapshot, dependencies, deriveAlerts, seriesRows, type OperationsInput } from "@/lib/operations/model";
import type { OperationsJournalEntry, OperationsSnapshot } from "@/lib/operations/types";

interface TreasuryEvents {
  feeSchedule?: {
    events?: { kind?: string; version?: number; detail?: string; operator?: string | null; time?: string | null; transactionHash?: string }[];
  };
}

/** Fee schedule changes read from the FeeScheduleRegistry events (the treasury projection), newest first. */
export function useOperationsJournal(intervalMs = 60_000): { entries: OperationsJournalEntry[]; error: string | null } {
  const [state, setState] = useState<{ entries: OperationsJournalEntry[]; error: string | null }>({ entries: [], error: null });
  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    const load = async () => {
      try {
        const response = await fetch("/api/internal/treasury", { cache: "no-store" });
        if (!response.ok) throw new Error(`TREASURY_${response.status}`);
        const body = (await response.json()) as TreasuryEvents;
        const entries = (body.feeSchedule?.events ?? [])
          .filter((event) => typeof event.transactionHash === "string")
          .map((event, index): OperationsJournalEntry => ({
            id: `${event.transactionHash}-${index}`,
            at: event.time ? `${event.time.slice(0, 10)} ${event.time.slice(11, 19)} UTC` : "time unknown",
            actor: event.operator ? `${event.operator.slice(0, 6)}…${event.operator.slice(-4)}` : "registry",
            subject: `Fee schedule v${event.version ?? "?"}`,
            action: event.kind === "REGISTERED" ? "Registered" : event.kind === "ACTIVE_VERSION_CHANGED" ? "Activated" : "Status changed",
            detail: event.detail ?? "",
            evidence: "OBSERVED",
            transactionHash: event.transactionHash,
          }));
        if (active) setState({ entries, error: null });
      } catch (error) {
        if (active) setState((current) => ({ ...current, error: error instanceof Error ? error.message : "UNAVAILABLE" }));
      } finally {
        if (active) timer = window.setTimeout(load, intervalMs);
      }
    };
    void load();
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [intervalMs]);
  return state;
}

/** Everything the operations console reads, assembled from live sources. */
export function useOperationsInput(): OperationsInput {
  const board = useMarketBoard();
  const now = useChainNow();
  const runtime = useDeploymentRuntime();
  const status = useOperatorStatus();
  const evidence = useDeploymentEvidence();
  return useMemo(
    () => ({ now, runtime, status, evidence, feedStatus: board.status, feed: board.snapshot, markets: board.markets }),
    [board.markets, board.snapshot, board.status, evidence, now, runtime, status],
  );
}

export function useOperationsView() {
  const input = useOperationsInput();
  const journal = useOperationsJournal();
  const rows = useMemo(() => seriesRows(input.markets, input.runtime.data, input.feed, input.now), [input]);
  const alerts = useMemo(() => deriveAlerts(input, rows), [input, rows]);
  const deps = useMemo(() => dependencies(input), [input]);
  return { input, rows, alerts, dependencies: deps, journal };
}

/** The live health summary other surfaces (status strip, alerts) can read in place of a recorded snapshot. */
export function useOperationsSnapshot(): OperationsSnapshot {
  const input = useOperationsInput();
  return useMemo(() => buildOperationsSnapshot(input), [input]);
}
