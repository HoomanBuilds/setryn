"use client";

import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { ChainIcon } from "@/components/icons/AssetIcon";
import { ProvenanceChip, StateDot, type StateTone } from "@/components/home/kit";
import { Panel, PanelHead } from "@/components/strategies/desk/Desk";
import type { HealthRow, HealthTone } from "@/lib/alerts";

const TONE: Record<HealthTone, StateTone> = {
  HEALTHY: "up",
  DEGRADED: "brand",
  UNAVAILABLE: "down",
  CHECKING: "dim",
};

const LABEL: Record<HealthTone, string> = {
  HEALTHY: "Healthy",
  DEGRADED: "Degraded",
  UNAVAILABLE: "Unavailable",
  CHECKING: "Checking",
};

const TEXT: Record<HealthTone, string> = {
  HEALTHY: "text-up",
  DEGRADED: "text-brand",
  UNAVAILABLE: "text-down",
  CHECKING: "text-faint",
};

export function SystemHealthPanel({ rows, onRecheck, checking }: { rows: HealthRow[]; onRecheck: () => void; checking: boolean }) {
  const degraded = rows.filter((row) => row.state === "DEGRADED" || row.state === "UNAVAILABLE").length;
  return (
    <Panel label="System health" delay={120}>
      <PanelHead
        title="System health"
        tools={
          <span className="flex items-center gap-2">
            <span className={`text-[11px] ${degraded > 0 ? "text-brand" : "text-faint"}`}>
              {degraded > 0 ? `${degraded} need attention` : "All nominal"}
            </span>
            <button
              type="button"
              onClick={onRecheck}
              disabled={checking}
              aria-label="Recheck chain"
              title="Probe the chain again"
              className="focus-ring grid h-11 w-11 place-items-center rounded-md text-faint transition-colors hover:bg-raised hover:text-ink disabled:opacity-50 lg:h-7 lg:w-7"
            >
              <RefreshCw size={13} aria-hidden="true" className={checking ? "animate-spin" : ""} />
            </button>
          </span>
        }
      />
      <ul>
        {rows.map((row) => {
          const body = (
            <>
              <span className="flex min-w-0 items-center gap-2">
                <StateDot tone={TONE[row.state]} live={row.state === "HEALTHY"} />
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5">
                    {row.id === "chain" || row.id === "sequencer" ? <ChainIcon size={13} /> : null}
                    <span className="text-xs text-ink">{row.label}</span>
                    <span className={`text-[11px] ${TEXT[row.state]}`}>{LABEL[row.state]}</span>
                  </span>
                  <span className="tnum block truncate font-mono text-[11px] text-faint" title={row.detail}>
                    {row.value}
                  </span>
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                <ProvenanceChip kind={row.provenance} />
                {row.freshness ? <span className="tnum font-mono text-[10.5px] text-off">{row.freshness}</span> : null}
              </span>
            </>
          );
          const className = "flex min-h-[48px] items-center justify-between gap-3 border-b border-line-soft px-3 py-2 last:border-b-0";
          return (
            <li key={row.id} title={row.detail}>
              {row.href ? (
                <Link href={row.href} className={`focus-ring ${className} transition-colors duration-150 hover:bg-raised/60`}>
                  {body}
                </Link>
              ) : (
                <div className={className}>{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
