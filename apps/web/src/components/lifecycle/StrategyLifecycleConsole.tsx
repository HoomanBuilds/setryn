"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  CircleAlert,
  Clock3,
  FileClock,
  Gauge,
  GitCompareArrows,
  Layers3,
  ShieldCheck,
  ShieldAlert,
  TimerReset,
} from "lucide-react";
import { MetaLine, SectionLabel, Tabs } from "@/components/terminal/primitives";
import { useGatewaySnapshot } from "@/components/gateway/InternalGatewayProvider";
import { LIFECYCLE_STRATEGIES } from "@/lib/lifecycle/fixtures";
import { runtimeLifecycleStrategies } from "@/lib/lifecycle/runtime";
import type {
  LifecycleActionKind,
  LifecycleBoundary,
  LifecycleConstraint,
  LifecycleHealth,
  LifecycleLeg,
  LifecycleProposal,
  LifecycleStrategy,
} from "@/lib/lifecycle/types";
import {
  formatCompactUsd,
  formatDuration,
  formatLots,
  formatNumber,
  formatPriceWithUnit,
  formatShare,
  priceUnitSuffix,
} from "@/lib/terminal/format";
import { DEFAULT_TRADE_HREF, tradeHref } from "@/lib/terminal/markets";

type ConsoleTab = "PLAN" | "LEGS" | "BOUNDARIES";

const TABS: { id: ConsoleTab; label: string }[] = [
  { id: "PLAN", label: "Lifecycle plan" },
  { id: "LEGS", label: "Leg dependencies" },
  { id: "BOUNDARIES", label: "Boundaries" },
];

const ACTION_LABEL: Record<LifecycleActionKind, string> = {
  ROLL: "Roll",
  REBALANCE: "Rebalance",
  MIGRATE: "Migrate",
  DE_RISK: "De-risk",
  EXIT: "Exit",
};

function healthTone(health: LifecycleHealth): string {
  if (health === "HEALTHY") return "text-up";
  if (health === "WINDOW_OPEN") return "text-brand";
  return "text-down";
}

function healthDot(health: LifecycleHealth): string {
  if (health === "HEALTHY") return "bg-up";
  if (health === "WINDOW_OPEN") return "bg-brand";
  return "bg-down";
}

function provenanceTone(provenance: LifecycleStrategy["observation"]["provenance"]): string {
  if (provenance === "EXECUTABLE") return "text-up";
  if (provenance === "MODELED") return "text-brand";
  return "text-dim";
}

function guaranteeLabel(guarantee: LifecycleStrategy["guarantee"]): string {
  if (guarantee === "PACKAGE_ATOMIC") return "Package atomic";
  if (guarantee === "SOLVER_BONDED") return "Solver bounded";
  return "Leg sequenced";
}

function constraintTone(state: LifecycleConstraint["state"]): string {
  if (state === "SATISFIED") return "text-up";
  if (state === "REQUIRES_QUOTE") return "text-brand";
  return "text-down";
}

function constraintLabel(state: LifecycleConstraint["state"]): string {
  if (state === "SATISFIED") return "Ready";
  if (state === "REQUIRES_QUOTE") return "Quote needed";
  return "Blocked";
}

function actionHref(strategy: LifecycleStrategy, proposal: LifecycleProposal): string {
  const params = new URLSearchParams({
    lifecycle: strategy.id,
    intent: proposal.kind.toLowerCase(),
    lots: String(strategy.lots),
    maxCloseCost: String(proposal.maxCloseCost),
    guarantee: strategy.guarantee.toLowerCase(),
  });

  return proposal.route === "TRADE"
    ? `${tradeHref(strategy.market)}?${params.toString()}`
    : `/strategies?${params.toString()}`;
}

function legHref(strategy: LifecycleStrategy, leg: LifecycleLeg): string {
  const params = new URLSearchParams({
    lifecycle: strategy.id,
    intent: "single-leg",
    leg: leg.id,
    lots: String(strategy.lots),
    hedge: "break",
  });
  return `${tradeHref(strategy.market)}?${params.toString()}`;
}

function Figure({
  label,
  value,
  tone = "text-ink",
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="min-w-0 px-3 py-2.5">
      <div className="truncate text-xs text-faint">{label}</div>
      <div className={`tnum mt-1 truncate font-mono text-sm ${tone}`}>{value}</div>
    </div>
  );
}

function StrategyRow({
  strategy,
  selected,
  onSelect,
}: {
  strategy: LifecycleStrategy;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const originLabel = strategy.origin === "RUNTIME" ? "Runtime" : "Static preview";
  return (
    <button
      key={strategy.id}
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(strategy.id)}
      className={`focus-ring w-full border-b border-line px-3 py-3 text-left transition-colors ${
        selected ? "bg-raised" : "hover:bg-raised/60"
      }`}
    >
      <span className="flex items-start gap-2">
        <span aria-hidden="true" className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${healthDot(strategy.health)}`} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate text-sm text-ink">{strategy.label}</span>
            <span className="tnum shrink-0 font-mono text-xs text-dim">{formatLots(strategy.lots)}</span>
          </span>
          <span className="mt-0.5 block truncate font-mono text-xs text-faint">{strategy.market.code}</span>
          <span className="mt-1.5 flex items-center gap-1.5">
            <span
              className={`rounded-sm border px-1.5 py-0.5 text-[10px] uppercase ${
                strategy.origin === "RUNTIME" ? "border-brand/40 text-brand" : "border-line text-faint"
              }`}
            >
              {originLabel}
            </span>
            <span className="truncate font-mono text-[10px] text-faint">
              {strategy.origin === "RUNTIME"
                ? `${strategy.environmentLabel} / ${strategy.evidenceLabel}`
                : strategy.environmentLabel}
            </span>
          </span>
          <span className="mt-1.5 flex items-center justify-between gap-2 text-xs">
            <span className="truncate text-faint">{strategy.boundaries[0]?.dueLabel}</span>
            <span className={`shrink-0 uppercase ${healthTone(strategy.health)}`}>
              {strategy.health.replaceAll("_", " ").toLowerCase()}
            </span>
          </span>
        </span>
      </span>
    </button>
  );
}

function StrategyList({
  strategies,
  runtimeCount,
  previewCount,
  selectedId,
  onSelect,
}: {
  strategies: LifecycleStrategy[];
  runtimeCount: number;
  previewCount: number;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const runtime = strategies.filter((strategy) => strategy.origin === "RUNTIME");
  const preview = strategies.filter((strategy) => strategy.origin !== "RUNTIME");
  return (
    <aside className="flex min-h-0 flex-col border-b border-line bg-panel xl:border-r xl:border-b-0">
      <div className="flex h-11 items-center justify-between border-b border-line px-3">
        <SectionLabel>Active packages</SectionLabel>
        <span className="tnum font-mono text-xs text-off">{strategies.length}</span>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className="flex h-8 items-center justify-between border-b border-line px-3">
          <span className="text-[11px] uppercase text-faint">Runtime positions</span>
          <span className="tnum font-mono text-[11px] text-off">{runtimeCount}</span>
        </div>
        {runtime.length === 0 ? (
          <div className="border-b border-line px-3 py-3">
            <p className="text-xs leading-snug text-faint">
              No runtime positions in this browser session yet. Create one from the trade terminal.
            </p>
            <Link
              href={DEFAULT_TRADE_HREF}
              className="focus-ring mt-2 inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-xs text-dim transition-colors hover:border-line-strong hover:text-ink"
            >
              Open trade terminal
              <ArrowUpRight size={12} aria-hidden="true" />
            </Link>
          </div>
        ) : (
          runtime.map((strategy) => (
            <StrategyRow
              key={strategy.id}
              strategy={strategy}
              selected={strategy.id === selectedId}
              onSelect={onSelect}
            />
          ))
        )}
        <div className="flex h-8 items-center justify-between border-b border-line px-3">
          <span className="text-[11px] uppercase text-faint">Static preview examples</span>
          <span className="tnum font-mono text-[11px] text-off">{previewCount}</span>
        </div>
        {preview.map((strategy) => (
          <StrategyRow
            key={strategy.id}
            strategy={strategy}
            selected={strategy.id === selectedId}
            onSelect={onSelect}
          />
        ))}
      </div>
      <div className="border-t border-line px-3 py-2.5 text-xs text-faint">
        {runtimeCount} runtime / {previewCount} preview / bounds set at handoff
      </div>
    </aside>
  );
}

function PackageHeader({ strategy }: { strategy: LifecycleStrategy }) {
  const unit = priceUnitSuffix(strategy.market.priceUnit);
  const move = strategy.markPrice - strategy.entryPrice;
  const signedMove = strategy.side === "LONG" ? move : -move;

  return (
    <section className="border-b border-line bg-panel px-3 py-3 lg:px-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Layers3 size={15} aria-hidden="true" className="text-brand" />
            <SectionLabel>Strategy account</SectionLabel>
            <span
              className={`rounded-sm border px-1.5 py-0.5 text-[10px] uppercase ${
                strategy.origin === "RUNTIME" ? "border-brand/40 text-brand" : "border-line text-faint"
              }`}
            >
              {strategy.origin === "RUNTIME" ? "Runtime" : "Static preview"}
            </span>
          </div>
          <h1 className="mt-1 truncate text-lg font-medium text-ink">{strategy.label}</h1>
          <MetaLine
            className="mt-1"
            items={[
              strategy.market.code,
              `${strategy.side.toLowerCase()} ${formatLots(strategy.lots)} lots`,
              `${strategy.market.legs.length} legs`,
              strategy.settlementClass,
            ]}
          />
          <p className="mt-1 truncate font-mono text-[11px] text-faint">
            {strategy.origin === "RUNTIME"
              ? `${strategy.environmentLabel} / ${strategy.evidenceLabel} evidence${strategy.receiptId ? ` / ${strategy.receiptId}` : ""}`
              : `${strategy.environmentLabel} / ${strategy.evidenceLabel} example`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className={`rounded-sm border border-line px-2 py-1 text-xs uppercase ${healthTone(strategy.health)}`}>
            {strategy.health.replaceAll("_", " ").toLowerCase()}
          </span>
          <Link
            href={tradeHref(strategy.market)}
            className="focus-ring flex h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-xs text-dim transition-colors hover:border-line-strong hover:text-ink"
          >
            Open market
            <ArrowUpRight size={13} aria-hidden="true" />
          </Link>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 divide-x divide-y divide-line border border-line sm:grid-cols-3 xl:grid-cols-6">
        <Figure label="Package mark" value={formatPriceWithUnit(strategy.markPrice, strategy.market)} />
        <Figure
          label="Entry move"
          value={`${signedMove >= 0 ? "+" : ""}${formatNumber(signedMove, strategy.market.priceDecimals)} ${unit}`}
          tone={signedMove > 0 ? "text-up" : signedMove < 0 ? "text-down" : "text-dim"}
        />
        <Figure label="Close cost" value={formatCompactUsd(strategy.closeCost)} />
        <Figure label="Time to unwind" value={formatDuration(strategy.timeToUnwindSeconds)} />
        <Figure label="Collateral" value={formatCompactUsd(strategy.collateral)} />
        <Figure label="Liquidation distance" value={formatShare(strategy.liquidationDistance / 100, 1)} />
      </div>
    </section>
  );
}

function ProposalList({
  strategy,
  selectedProposalId,
  onSelect,
}: {
  strategy: LifecycleStrategy;
  selectedProposalId: string;
  onSelect: (proposalId: string) => void;
}) {
  return (
    <div className="border-b border-line">
      <div className="flex h-10 items-center justify-between px-3">
        <SectionLabel>Coordinated actions</SectionLabel>
        <span className="text-xs text-off">No execution from this view</span>
      </div>
      <div className="border-t border-line">
        {strategy.proposals.map((proposal) => {
          const selected = proposal.id === selectedProposalId;
          return (
            <button
              key={proposal.id}
              type="button"
              aria-pressed={selected}
              onClick={() => onSelect(proposal.id)}
              className={`focus-ring flex w-full items-center gap-3 border-b border-line px-3 py-2.5 text-left transition-colors last:border-b-0 ${
                selected ? "bg-raised" : "hover:bg-raised/60"
              }`}
            >
              <span className="w-16 shrink-0 text-xs text-faint">{ACTION_LABEL[proposal.kind]}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-ink">{proposal.label}</span>
                <span className="mt-0.5 block truncate text-xs text-faint">{proposal.quoteRequirement}</span>
              </span>
              <span className="tnum shrink-0 font-mono text-xs text-dim">{formatCompactUsd(proposal.maxCloseCost)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ProposalDetail({ strategy, proposal }: { strategy: LifecycleStrategy; proposal: LifecycleProposal }) {
  return (
    <section className="min-w-0">
      <div className="border-b border-line px-3 py-3 lg:px-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <GitCompareArrows size={15} aria-hidden="true" className="text-brand" />
              <SectionLabel>Proposed {ACTION_LABEL[proposal.kind].toLowerCase()}</SectionLabel>
            </div>
            <h2 className="mt-1 text-base text-ink">{proposal.label}</h2>
            <p className="mt-1 text-xs leading-relaxed text-dim">{proposal.summary}</p>
          </div>
          <Link
            href={actionHref(strategy, proposal)}
            className="focus-ring flex h-9 shrink-0 items-center gap-2 rounded-md bg-brand px-3 text-xs font-semibold text-app"
          >
            {proposal.actionLabel}
            <ArrowUpRight size={14} aria-hidden="true" />
          </Link>
        </div>
        <div className="mt-2 flex items-start gap-2 text-xs leading-snug text-faint">
          <CircleAlert size={13} aria-hidden="true" className="mt-0.5 shrink-0 text-brand" />
          <span>Handoff carries package ID, intent, size, close-cost bound, and settlement class. A fresh route and final authorization are still required.</span>
        </div>
      </div>

      <div className="grid border-b border-line lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="border-b border-line lg:border-r lg:border-b-0">
          <div className="flex h-10 items-center justify-between border-b border-line px-3">
            <SectionLabel>Before and after</SectionLabel>
            <span className="text-xs text-off">modeled impact</span>
          </div>
          <div className="grid grid-cols-2 divide-x divide-y divide-line sm:grid-cols-4">
            {proposal.impacts.map((impact) => (
              <div key={impact.label} className="min-w-0 px-3 py-2.5">
                <div className="truncate text-xs text-faint">{impact.label}</div>
                <div className="tnum mt-1 truncate font-mono text-xs text-dim">{impact.before}</div>
                <div
                  className={`tnum mt-0.5 truncate font-mono text-sm ${
                    impact.tone === "up"
                      ? "text-up"
                      : impact.tone === "down"
                        ? "text-down"
                        : impact.tone === "brand"
                          ? "text-brand"
                          : "text-ink"
                  }`}
                >
                  {impact.after}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="flex h-10 items-center justify-between border-b border-line px-3">
            <SectionLabel>Route bound</SectionLabel>
            <TimerReset size={14} aria-hidden="true" className="text-faint" />
          </div>
          <div className="divide-y divide-line px-3">
            <CompactRow label="Max close cost" value={formatCompactUsd(proposal.maxCloseCost)} />
            <CompactRow label="Expected unwind" value={formatDuration(proposal.estimatedTimeToUnwindSeconds)} />
            <CompactRow label="Quote policy" value={proposal.quoteRequirement} mono={false} />
          </div>
        </div>
      </div>

      <div className="border-b border-line">
        <div className="flex h-10 items-center justify-between border-b border-line px-3">
          <SectionLabel>Preflight constraints</SectionLabel>
          <span className="text-xs text-off">checked again at handoff</span>
        </div>
        <div className="divide-y divide-line">
          {proposal.constraints.map((constraint) => (
            <div key={constraint.label} className="grid gap-1 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_108px] sm:gap-3">
              <div className="min-w-0">
                <span className="text-xs text-ink">{constraint.label}</span>
                <span className="mt-0.5 block text-xs leading-snug text-faint">{constraint.detail}</span>
              </div>
              <span className={`self-start text-xs uppercase sm:text-right ${constraintTone(constraint.state)}`}>
                {constraintLabel(constraint.state)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CompactRow({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2.5">
      <span className="min-w-0 text-xs text-faint">{label}</span>
      <span className={`${mono ? "tnum font-mono" : "max-w-[178px] text-right leading-snug"} text-xs text-dim`}>{value}</span>
    </div>
  );
}

function LegsPanel({ strategy }: { strategy: LifecycleStrategy }) {
  return (
    <section>
      <div className="flex h-11 items-center justify-between border-b border-line px-3 lg:px-4">
        <div className="flex items-center gap-2">
          <GitCompareArrows size={15} aria-hidden="true" className="text-brand" />
          <SectionLabel>Package leg dependencies</SectionLabel>
        </div>
        <span className="text-xs text-off">{strategy.legs.length} coordinated legs</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[780px] border-collapse text-left">
          <thead className="border-b border-line bg-panel">
            <tr>
              <th className="px-3 py-2 text-xs font-normal text-faint">Leg</th>
              <th className="px-3 py-2 text-xs font-normal text-faint">Lifecycle role</th>
              <th className="px-3 py-2 text-xs font-normal text-faint">Dependency</th>
              <th className="px-3 py-2 text-xs font-normal text-faint">Observation</th>
              <th className="px-3 py-2 text-right text-xs font-normal text-faint">Direct action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {strategy.legs.map((leg) => (
              <tr key={leg.id}>
                <td className="px-3 py-3 align-top">
                  <span className="block text-sm text-ink">{leg.instrument}</span>
                  <span className={`mt-0.5 block text-xs ${leg.side === "BUY" ? "text-up" : "text-down"}`}>
                    {`${leg.side.toLowerCase()} ${formatNumber(leg.ratio, 2)}x / ${leg.venueClass === "NATIVE_BOOK" ? "native" : "component"}`}
                  </span>
                </td>
                <td className="px-3 py-3 align-top text-xs text-dim">{leg.lifecycleRole}</td>
                <td className="max-w-[270px] px-3 py-3 align-top text-xs leading-snug text-faint">{leg.dependency}</td>
                <td className="px-3 py-3 align-top">
                  <span className="block text-xs text-dim">{leg.observation.source}</span>
                  <span className={`tnum mt-0.5 block font-mono text-xs ${provenanceTone(leg.observation.provenance)}`}>
                    {`${leg.observation.provenance.toLowerCase()} / ${leg.observation.ageSeconds}s`}
                  </span>
                </td>
                <td className="px-3 py-3 text-right align-top">
                  <Link
                    href={legHref(strategy, leg)}
                    className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md border border-down/40 px-2 text-xs text-down transition-colors hover:bg-down-soft"
                  >
                    Break hedge
                    <ArrowUpRight size={12} aria-hidden="true" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-start gap-2 border-t border-down/30 bg-down-soft px-3 py-2.5 text-xs leading-snug text-dim">
        <ShieldAlert size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-down" />
        <span>Direct leg action intentionally breaks the package hedge. It opens a bounded trade handoff only, and does not execute from this console or inherit package completion guarantees.</span>
      </div>
    </section>
  );
}

function BoundaryState({ boundary }: { boundary: LifecycleBoundary }) {
  const tone = boundary.state === "WINDOW_OPEN" ? "text-brand" : boundary.state === "LOCKED" ? "text-down" : "text-up";
  return (
    <div className="grid gap-2 border-b border-line px-3 py-3 last:border-b-0 sm:grid-cols-[110px_minmax(0,1fr)_116px] sm:items-start">
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className={`h-1.5 w-1.5 rounded-full ${
            boundary.state === "WINDOW_OPEN" ? "bg-brand" : boundary.state === "LOCKED" ? "bg-down" : "bg-up"
          }`}
        />
        <span className="text-xs text-faint">{boundary.kind.toLowerCase()}</span>
      </div>
      <div className="min-w-0">
        <span className="block text-sm text-ink">{boundary.label}</span>
        <span className="mt-0.5 block text-xs text-faint">{`${boundary.timing} / ${boundary.source}`}</span>
      </div>
      <span className={`tnum self-start font-mono text-xs sm:text-right ${tone}`}>{boundary.dueLabel}</span>
    </div>
  );
}

function BoundariesPanel({ strategy }: { strategy: LifecycleStrategy }) {
  return (
    <section>
      <div className="flex h-11 items-center justify-between border-b border-line px-3 lg:px-4">
        <div className="flex items-center gap-2">
          <FileClock size={15} aria-hidden="true" className="text-brand" />
          <SectionLabel>Funding, fixing, and expiry boundaries</SectionLabel>
        </div>
        <span className="text-xs text-off">policy time in UTC</span>
      </div>
      <div>{strategy.boundaries.map((boundary) => <BoundaryState key={boundary.id} boundary={boundary} />)}</div>
      <div className="border-t border-line px-3 py-2.5 text-xs text-faint">
        Boundaries are observed state. A policy action requires a new trade or strategy authorization.
      </div>
    </section>
  );
}

function OperationsRail({ strategy }: { strategy: LifecycleStrategy }) {
  const nextBoundary = strategy.boundaries[0];
  return (
    <aside className="border-t border-line bg-panel xl:min-h-0 xl:overflow-y-auto xl:border-t-0">
      <section className="border-b border-line">
        <div className="flex h-10 items-center gap-2 border-b border-line px-3">
          <Gauge size={15} aria-hidden="true" className="text-brand" />
          <SectionLabel>Package health</SectionLabel>
        </div>
        <div className="p-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm text-ink">{strategy.health.replaceAll("_", " ").toLowerCase()}</span>
            <span className={`text-xs uppercase ${healthTone(strategy.health)}`}>monitored</span>
          </div>
          <p className="mt-1 text-xs leading-snug text-faint">{strategy.healthDetail}</p>
          <div className="mt-3 divide-y divide-line border-y border-line">
            <CompactRow label="Package close cost" value={formatCompactUsd(strategy.closeCost)} />
            <CompactRow label="Time to unwind" value={formatDuration(strategy.timeToUnwindSeconds)} />
            <CompactRow label="Terminal residual cap" value={formatCompactUsd(strategy.maxResidual)} />
          </div>
        </div>
      </section>

      <section className="border-b border-line">
        <div className="flex h-10 items-center gap-2 border-b border-line px-3">
          <ShieldCheck size={15} aria-hidden="true" className="text-brand" />
          <SectionLabel>Settlement and recovery</SectionLabel>
        </div>
        <div className="divide-y divide-line px-3">
          <CompactRow label="Settlement class" value={strategy.settlementClass} mono={false} />
          <CompactRow label="Completion" value={guaranteeLabel(strategy.guarantee)} mono={false} />
          <CompactRow label="Recovery class" value={strategy.recoveryClass} mono={false} />
        </div>
        <div className="border-t border-line px-3 py-2.5 text-xs leading-snug text-faint">
          {strategy.guarantee === "PACKAGE_ATOMIC"
            ? "All package legs are completed or rejected by the same settlement domain."
            : strategy.guarantee === "SOLVER_BONDED"
              ? "The selected solver owns the committed bounded-recovery obligation after authorization."
              : "Component legs can settle in sequence. The final request must state the residual and recovery bounds."}
        </div>
      </section>

      <section className="border-b border-line">
        <div className="flex h-10 items-center gap-2 border-b border-line px-3">
          <Clock3 size={15} aria-hidden="true" className="text-brand" />
          <SectionLabel>Observation</SectionLabel>
        </div>
        <div className="divide-y divide-line px-3">
          <CompactRow label="Source" value={strategy.observation.source} mono={false} />
          <CompactRow
            label="Freshness"
            value={`${strategy.observation.ageSeconds}s / ${strategy.observation.asOfLabel}`}
          />
          <CompactRow label="Class" value={strategy.observation.provenance.toLowerCase()} />
          <CompactRow label="Environment" value={strategy.environmentLabel} mono={false} />
          <CompactRow label="Evidence" value={strategy.evidenceLabel} />
          {strategy.receiptId ? <CompactRow label="Receipt" value={strategy.receiptId} /> : null}
          {nextBoundary ? <CompactRow label="Next boundary" value={nextBoundary.dueLabel} /> : null}
        </div>
      </section>

      <section className="px-3 py-3">
        <div className="flex items-start gap-2 text-xs leading-snug text-faint">
          <CircleAlert size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-brand" />
          {strategy.origin === "RUNTIME" ? (
            <span>
              {strategy.environmentLabel} / {strategy.evidenceLabel} evidence / current browser session. Marks
              come from the canonical catalog; no further outcome is claimed from this view.
            </span>
          ) : (
            <span>Arbitrum Sepolia preview. All values are typed fixtures and observed simulation data. Mainnet writes remain disabled.</span>
          )}
        </div>
      </section>
    </aside>
  );
}

export function StrategyLifecycleConsole() {
  const snapshot = useGatewaySnapshot();
  const runtimeStrategies = useMemo(() => runtimeLifecycleStrategies(snapshot), [snapshot]);
  const strategies = useMemo(
    () => [...runtimeStrategies, ...LIFECYCLE_STRATEGIES],
    [runtimeStrategies],
  );
  const runtimeCount = runtimeStrategies.length;
  const previewCount = LIFECYCLE_STRATEGIES.length;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<ConsoleTab>("PLAN");
  const strategy = useMemo(
    () =>
      (selectedId ? strategies.find((candidate) => candidate.id === selectedId) : undefined) ??
      strategies[0],
    [selectedId, strategies],
  );
  const [proposalSelection, setProposalSelection] = useState<Record<string, string>>({});
  const selectedProposal =
    strategy.proposals.find((proposal) => proposal.id === proposalSelection[strategy.id]) ?? strategy.proposals[0];

  const selectStrategy = (id: string) => {
    setSelectedId(id);
    setTab("PLAN");
  };

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-app">
      <section className="shrink-0 border-b border-line bg-panel">
        <div className="flex min-h-12 flex-col lg:h-12 lg:flex-row lg:items-center lg:gap-4 lg:px-4">
          <div className="flex h-12 min-w-0 items-center gap-3 px-3 lg:h-auto lg:px-0">
            <h1 className="shrink-0 text-sm font-semibold text-ink lg:text-base">Strategy Lifecycle</h1>
            <MetaLine className="hidden min-w-0 truncate xl:flex" items={[`${runtimeCount} runtime / ${previewCount} preview`, snapshot.environment.label, `${snapshot.environment.evidence} evidence`]} />
          </div>
          <div className="no-scrollbar overflow-x-auto border-t border-line px-2 lg:ml-auto lg:border-t-0 lg:px-0">
            <Tabs items={TABS} value={tab} onChange={(value) => setTab(value as ConsoleTab)} idBase="lifecycle" />
          </div>
        </div>
      </section>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto xl:grid xl:grid-cols-[272px_minmax(0,1fr)_328px] xl:overflow-hidden">
        <StrategyList
          strategies={strategies}
          runtimeCount={runtimeCount}
          previewCount={previewCount}
          selectedId={strategy.id}
          onSelect={selectStrategy}
        />

        <section className="min-w-0 border-b border-line bg-app xl:min-h-0 xl:overflow-y-auto xl:border-r xl:border-b-0">
          <PackageHeader strategy={strategy} />
          <div id="lifecycle-panel-PLAN" role="tabpanel" aria-labelledby="lifecycle-tab-PLAN" hidden={tab !== "PLAN"}>
            <ProposalList
              strategy={strategy}
              selectedProposalId={selectedProposal.id}
              onSelect={(proposalId) => setProposalSelection((current) => ({ ...current, [strategy.id]: proposalId }))}
            />
            <ProposalDetail strategy={strategy} proposal={selectedProposal} />
          </div>
          <div id="lifecycle-panel-LEGS" role="tabpanel" aria-labelledby="lifecycle-tab-LEGS" hidden={tab !== "LEGS"}>
            <LegsPanel strategy={strategy} />
          </div>
          <div id="lifecycle-panel-BOUNDARIES" role="tabpanel" aria-labelledby="lifecycle-tab-BOUNDARIES" hidden={tab !== "BOUNDARIES"}>
            <BoundariesPanel strategy={strategy} />
          </div>
        </section>

        <OperationsRail strategy={strategy} />
      </div>
    </main>
  );
}
