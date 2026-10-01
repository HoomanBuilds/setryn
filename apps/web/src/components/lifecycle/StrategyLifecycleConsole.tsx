"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, CircleAlert, Clock3, FileClock, Gauge, GitCompareArrows, Layers3, RefreshCw, ShieldCheck } from "lucide-react";
import { BUTTON_INK } from "@/components/activity/ledger-ui";
import { useGatewaySnapshot, useInternalGateway } from "@/components/gateway/InternalGatewayProvider";
import { useChainNow, useMarketBoard } from "@/components/market-data/MarketDataProvider";
import { MarketMark } from "@/components/portfolio/MarketMark";
import { MetaLine, SectionLabel, Tabs } from "@/components/terminal/primitives";
import { lifecycleStrategies, proposalHref } from "@/lib/lifecycle/runtime";
import type {
  LifecycleActionKind,
  LifecycleBoundary,
  LifecycleConstraint,
  LifecycleHealth,
  LifecycleProposal,
  LifecycleStrategy,
} from "@/lib/lifecycle/types";
import { networkLabel } from "@/lib/operations/deployment";
import { useDeploymentRuntime } from "@/lib/operations/hooks";
import { MARK_SOURCE_LABEL } from "@/lib/strategies/range";
import { formatLots, formatNumber } from "@/lib/terminal/format";
import { DEFAULT_TRADE_HREF, tradeHref } from "@/lib/terminal/markets";
import type { PackageMarket } from "@/lib/terminal/types";
import { PHASE_COPY } from "./election";
import { TerminalLifecycle } from "./TerminalLifecycle";

type ConsoleTab = "PLAN" | "LEGS" | "BOUNDARIES";

const TABS: { id: ConsoleTab; label: string }[] = [
  { id: "PLAN", label: "Lifecycle plan" },
  { id: "LEGS", label: "Legs" },
  { id: "BOUNDARIES", label: "Boundaries" },
];

const ACTION_LABEL: Record<LifecycleActionKind, string> = {
  EXIT: "Exit",
  OFFSET: "Offset",
  ROLL: "Roll",
};

function healthTone(health: LifecycleHealth): string {
  if (health === "HEALTHY") return "text-up";
  if (health === "WINDOW_OPEN") return "text-brand";
  if (health === "CLOSED") return "text-dim";
  return "text-down";
}

function healthDot(health: LifecycleHealth): string {
  if (health === "HEALTHY") return "bg-up";
  if (health === "WINDOW_OPEN") return "bg-brand";
  if (health === "CLOSED") return "bg-dim";
  return "bg-down";
}

function healthLabel(health: LifecycleHealth): string {
  return health === "WINDOW_OPEN" ? "window open" : health.toLowerCase();
}

function constraintTone(state: LifecycleConstraint["state"]): string {
  if (state === "SATISFIED") return "text-up";
  if (state === "REQUIRES_QUOTE") return "text-brand";
  return "text-down";
}

function constraintLabel(state: LifecycleConstraint["state"]): string {
  if (state === "SATISFIED") return "Ready";
  if (state === "REQUIRES_QUOTE") return "Needs liquidity";
  return "Blocked";
}

function usdc(value: number | null, signed = false): string {
  if (value === null || !Number.isFinite(value)) return "-";
  const sign = signed ? (value > 0 ? "+" : value < 0 ? "-" : "") : value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const body = abs >= 1_000_000 ? `${formatNumber(abs / 1_000_000, 2)}M` : abs >= 10_000 ? `${formatNumber(abs / 1_000, 1)}k` : formatNumber(abs, 2);
  return `${sign}${body} USDC`;
}

function tone(value: number | null): string {
  if (value === null || value === 0) return "text-dim";
  return value > 0 ? "text-up" : "text-down";
}

function utc(seconds: number): string {
  return `${new Date(seconds * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function countdown(value: number): string {
  const s = Math.max(0, Math.round(value));
  if (s < 3_600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3_600)}h ${Math.floor((s % 3_600) / 60)}m`;
  return `${Math.floor(s / 86_400)}d ${Math.floor((s % 86_400) / 3_600)}h`;
}

function Figure({ label, value, tone: color = "text-ink" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0 px-3 py-2.5">
      <div className="truncate text-xs text-faint">{label}</div>
      <div className={`tnum mt-1 truncate font-mono text-sm ${color}`}>{value}</div>
    </div>
  );
}

function StrategyRow({ strategy, selected, onSelect, now }: { strategy: LifecycleStrategy; selected: boolean; onSelect: (id: string) => void; now: number }) {
  const next = strategy.boundaries.find((boundary) => boundary.at > now);
  const phase = strategy.lifecycle ? PHASE_COPY[strategy.lifecycle.phase].label : null;
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(strategy.id)}
      className={`focus-ring w-full border-b border-line px-3 py-3 text-left transition-colors ${selected ? "bg-raised" : "hover:bg-raised/60"}`}
    >
      <span className="flex items-start gap-2">
        <span aria-hidden="true" className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${healthDot(strategy.health)}`} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate text-sm text-ink">{strategy.market.id}</span>
            <span className={`tnum shrink-0 font-mono text-xs ${strategy.side === "LONG" ? "text-up" : "text-down"}`}>
              {`${strategy.side === "LONG" ? "+" : "-"}${formatLots(strategy.lots)}`}
            </span>
          </span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 font-mono text-xs text-faint">
            <MarketMark underlying={strategy.market.underlying} size={13} />
            <span className="truncate">{`${strategy.id.slice(0, 8)}…${strategy.id.slice(-4)}`}</span>
          </span>
          <span className="mt-1.5 flex items-center justify-between gap-2 text-xs">
            <span className="truncate text-faint">{next ? `${next.label} in ${countdown(next.at - now)}` : (phase ?? "No boundary ahead")}</span>
            <span className={`shrink-0 uppercase ${healthTone(strategy.health)}`}>{healthLabel(strategy.health)}</span>
          </span>
        </span>
      </span>
    </button>
  );
}

function StrategyList({
  strategies,
  selectedId,
  onSelect,
  now,
  walletConnected,
  onConnect,
}: {
  strategies: LifecycleStrategy[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  now: number;
  walletConnected: boolean;
  onConnect: () => void;
}) {
  const open = strategies.filter((strategy) => strategy.health !== "CLOSED");
  const closed = strategies.filter((strategy) => strategy.health === "CLOSED");
  return (
    <aside className="flex min-h-0 flex-col border-b border-line bg-panel xl:border-r xl:border-b-0">
      <div className="flex h-11 items-center justify-between border-b border-line px-3">
        <SectionLabel>Your positions</SectionLabel>
        <span className="tnum font-mono text-xs text-off">{open.length}</span>
      </div>
      <div role="region" tabIndex={0} aria-label="Positions" className="focus-ring scroll-thin min-h-0 flex-1 overflow-y-auto">
        {open.length === 0 ? (
          <div className="border-b border-line px-3 py-3">
            <p className="text-xs leading-snug text-faint">
              {walletConnected ? "No open positions on this account. Positions you open in the trade terminal appear here." : "Connect a wallet to read its positions and their onchain lifecycle."}
            </p>
            {walletConnected ? (
              <Link
                href={DEFAULT_TRADE_HREF}
                className="focus-ring mt-2 inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-xs text-dim transition-colors hover:border-line-strong hover:text-ink"
              >
                Open trade terminal
                <ArrowUpRight size={12} aria-hidden="true" />
              </Link>
            ) : (
              <button type="button" onClick={onConnect} className={`${BUTTON_INK} mt-2 h-8`}>
                Connect wallet
              </button>
            )}
          </div>
        ) : (
          open.map((strategy) => <StrategyRow key={strategy.id} strategy={strategy} selected={strategy.id === selectedId} onSelect={onSelect} now={now} />)
        )}
        {closed.length > 0 ? (
          <>
            <div className="flex h-8 items-center justify-between border-b border-line px-3">
              <span className="text-[11px] uppercase text-faint">Completed</span>
              <span className="tnum font-mono text-[11px] text-off">{closed.length}</span>
            </div>
            {closed.map((strategy) => (
              <StrategyRow key={strategy.id} strategy={strategy} selected={strategy.id === selectedId} onSelect={onSelect} now={now} />
            ))}
          </>
        ) : null}
      </div>
      <div className="border-t border-line px-3 py-2.5 text-xs text-faint">Read from the position engine and settlement coordinator</div>
    </aside>
  );
}

function PackageHeader({ strategy }: { strategy: LifecycleStrategy }) {
  const decimals = strategy.market.priceDecimals;
  const underlying = strategy.market.underlying.split("/")[0];
  return (
    <section className="border-b border-line bg-panel px-3 py-3 lg:px-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Layers3 size={15} aria-hidden="true" className="text-brand" />
            <SectionLabel>Position</SectionLabel>
            <span className="rounded-sm border border-brand/40 px-1.5 py-0.5 text-[10px] text-brand uppercase">Onchain</span>
          </div>
          <h1 className="mt-1 truncate text-lg font-medium text-ink">{strategy.label}</h1>
          <MetaLine
            className="mt-1"
            items={[
              strategy.market.id,
              `${strategy.side.toLowerCase()} ${formatLots(strategy.lots)} lots at ${formatNumber(strategy.entryPrice, decimals)}`,
              strategy.terms ? `range ${formatNumber(strategy.terms.floor, decimals)}–${formatNumber(strategy.terms.cap, decimals)}` : "range not published",
              strategy.market.fixingSource,
            ]}
          />
          <p className="mt-1 truncate font-mono text-[11px] text-faint">{`${strategy.id}${strategy.receiptId ? ` / ${strategy.receiptId}` : ""}`}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className={`rounded-sm border border-line px-2 py-1 text-xs uppercase ${healthTone(strategy.health)}`}>{healthLabel(strategy.health)}</span>
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
        <Figure label={`Mark / ${MARK_SOURCE_LABEL[strategy.markSource].toLowerCase()}`} value={strategy.mark !== null ? formatNumber(strategy.mark, decimals) : "No mark"} />
        <Figure label="Mark P&L" value={usdc(strategy.markPnl, true)} tone={tone(strategy.markPnl)} />
        <Figure label="At today's reference" value={usdc(strategy.pnlAtReference, true)} tone={tone(strategy.pnlAtReference)} />
        <Figure label="Best / worst at fixing" value={strategy.pnlAtCap !== null && strategy.pnlAtFloor !== null ? `${usdc(Math.max(strategy.pnlAtCap, strategy.pnlAtFloor), true)} / ${usdc(Math.min(strategy.pnlAtCap, strategy.pnlAtFloor), true)}` : "-"} />
        <Figure label="Collateral reserved" value={usdc(strategy.collateral)} />
        <Figure label="Delta" value={strategy.delta !== null ? `${strategy.delta > 0 ? "+" : ""}${formatNumber(strategy.delta, Math.abs(strategy.delta) < 10 ? 3 : 0)} ${underlying}` : "-"} />
      </div>
    </section>
  );
}

function ProposalList({ strategy, selectedId, onSelect }: { strategy: LifecycleStrategy; selectedId: string | null; onSelect: (id: string) => void }) {
  return (
    <div className="border-b border-line">
      <div className="flex h-10 items-center justify-between px-3">
        <SectionLabel>Actions before the fixing</SectionLabel>
        <span className="text-xs text-off">Each opens the trade terminal to sign</span>
      </div>
      <div className="border-t border-line">
        {strategy.proposals.length === 0 ? (
          <p className="px-3 py-4 text-xs text-faint">This position has completed; no trading action applies.</p>
        ) : (
          strategy.proposals.map((proposal) => {
            const selected = proposal.id === selectedId;
            const blocked = proposal.constraints.some((constraint) => constraint.state === "BLOCKED");
            return (
              <button
                key={proposal.id}
                type="button"
                aria-pressed={selected}
                onClick={() => onSelect(proposal.id)}
                className={`focus-ring flex w-full items-center gap-3 border-b border-line px-3 py-2.5 text-left transition-colors last:border-b-0 ${selected ? "bg-raised" : "hover:bg-raised/60"}`}
              >
                <span className="w-16 shrink-0 text-xs text-faint">{ACTION_LABEL[proposal.kind]}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-ink">{proposal.label}</span>
                  <span className="mt-0.5 block truncate text-xs text-faint">{proposal.quoteRequirement}</span>
                </span>
                <span className={`shrink-0 text-xs uppercase ${blocked ? "text-down" : "text-dim"}`}>{blocked ? "blocked" : `${proposal.requestedLots} lots`}</span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

function ProposalDetail({ strategy, proposal, markets }: { strategy: LifecycleStrategy; proposal: LifecycleProposal; markets: readonly PackageMarket[] }) {
  const blocked = proposal.constraints.some((constraint) => constraint.state === "BLOCKED");
  return (
    <section className="min-w-0">
      <div className="border-b border-line px-3 py-3 lg:px-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <GitCompareArrows size={15} aria-hidden="true" className="text-brand" />
              <SectionLabel>{ACTION_LABEL[proposal.kind]}</SectionLabel>
            </div>
            <h2 className="mt-1 text-base text-ink">{proposal.label}</h2>
            <p className="mt-1 text-xs leading-relaxed text-dim">{proposal.summary}</p>
          </div>
          {blocked ? (
            <span className="flex h-9 shrink-0 items-center rounded-md border border-line px-3 text-xs text-faint">Unavailable</span>
          ) : (
            <Link href={proposalHref(strategy, proposal, markets)} className="focus-ring flex h-9 shrink-0 items-center gap-2 rounded-md bg-brand px-3 text-xs font-semibold text-app">
              {proposal.actionLabel}
              <ArrowUpRight size={14} aria-hidden="true" />
            </Link>
          )}
        </div>
        <div className="mt-2 flex items-start gap-2 text-xs leading-snug text-faint">
          <CircleAlert size={13} aria-hidden="true" className="mt-0.5 shrink-0 text-brand" />
          <span>The handoff carries the market, direction and lots only. The terminal prices it again and your wallet signs the order.</span>
        </div>
      </div>

      <div className="border-b border-line">
        <div className="flex h-10 items-center justify-between border-b border-line px-3">
          <SectionLabel>Before and after</SectionLabel>
          <span className="text-xs text-off">at the current book, before fees</span>
        </div>
        <div className="grid grid-cols-2 divide-x divide-y divide-line sm:grid-cols-4">
          {proposal.impacts.map((impact) => (
            <div key={impact.label} className="min-w-0 px-3 py-2.5">
              <div className="truncate text-xs text-faint">{impact.label}</div>
              <div className="tnum mt-1 truncate font-mono text-xs text-dim">{impact.before}</div>
              <div
                className={`tnum mt-0.5 truncate font-mono text-sm ${
                  impact.tone === "up" ? "text-up" : impact.tone === "down" ? "text-down" : impact.tone === "brand" ? "text-brand" : "text-ink"
                }`}
              >
                {impact.after}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="border-b border-line">
        <div className="flex h-10 items-center justify-between border-b border-line px-3">
          <SectionLabel>Preflight</SectionLabel>
          <span className="text-xs text-off">checked again when you sign</span>
        </div>
        <div className="divide-y divide-line">
          {proposal.constraints.map((constraint) => (
            <div key={constraint.label} className="grid gap-1 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_120px] sm:gap-3">
              <div className="min-w-0">
                <span className="text-xs text-ink">{constraint.label}</span>
                <span className="mt-0.5 block text-xs leading-snug text-faint">{constraint.detail}</span>
              </div>
              <span className={`self-start text-xs uppercase sm:text-right ${constraintTone(constraint.state)}`}>{constraintLabel(constraint.state)}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function LegsPanel({ strategy }: { strategy: LifecycleStrategy }) {
  return (
    <section>
      <div className="flex h-11 items-center justify-between border-b border-line px-3 lg:px-4">
        <div className="flex items-center gap-2">
          <GitCompareArrows size={15} aria-hidden="true" className="text-brand" />
          <SectionLabel>Contract and reference</SectionLabel>
        </div>
        <span className="text-xs text-off">{`${strategy.legs.length} legs`}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-left">
          <thead className="border-b border-line bg-panel">
            <tr>
              <th className="px-3 py-2 text-xs font-normal text-faint">Leg</th>
              <th className="px-3 py-2 text-xs font-normal text-faint">Role</th>
              <th className="px-3 py-2 text-xs font-normal text-faint">Settlement</th>
              <th className="px-3 py-2 text-right text-xs font-normal text-faint">Reading</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {strategy.legs.map((leg) => (
              <tr key={leg.id}>
                <td className="px-3 py-3 align-top">
                  <span className="block text-sm text-ink">{leg.instrument}</span>
                  <span className={`mt-0.5 block text-xs ${leg.side === "BUY" ? "text-up" : "text-down"}`}>{`${leg.side.toLowerCase()} ${formatNumber(leg.ratio, 2)}x`}</span>
                </td>
                <td className="px-3 py-3 align-top text-xs text-dim">{leg.role}</td>
                <td className="max-w-[300px] px-3 py-3 align-top text-xs leading-snug text-faint">{leg.dependency}</td>
                <td className="px-3 py-3 text-right align-top">
                  <span className="tnum block font-mono text-sm text-ink">{leg.markLabel}</span>
                  <span className="mt-0.5 block text-xs text-faint">{`${leg.source} / ${leg.provenance.toLowerCase()}`}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function BoundaryRow({ boundary, now }: { boundary: LifecycleBoundary; now: number }) {
  const color = boundary.state === "WINDOW_OPEN" ? "text-brand" : boundary.state === "PASSED" ? "text-dim" : "text-up";
  const dot = boundary.state === "WINDOW_OPEN" ? "bg-brand" : boundary.state === "PASSED" ? "bg-dim" : "bg-up";
  return (
    <div className="grid gap-2 border-b border-line px-3 py-3 last:border-b-0 sm:grid-cols-[110px_minmax(0,1fr)_140px] sm:items-start">
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        <span className="text-xs text-faint">{boundary.kind.toLowerCase()}</span>
      </div>
      <div className="min-w-0">
        <span className="block text-sm text-ink">{boundary.label}</span>
        <span className="mt-0.5 block text-xs text-faint">{`${utc(boundary.at)} / ${boundary.source}`}</span>
      </div>
      <span className={`tnum self-start font-mono text-xs sm:text-right ${color}`}>
        {boundary.state === "PASSED" ? "passed" : boundary.state === "WINDOW_OPEN" ? "open now" : `in ${countdown(boundary.at - now)}`}
      </span>
    </div>
  );
}

function BoundariesPanel({ strategy, now }: { strategy: LifecycleStrategy; now: number }) {
  return (
    <section>
      <div className="flex h-11 items-center justify-between border-b border-line px-3 lg:px-4">
        <div className="flex items-center gap-2">
          <FileClock size={15} aria-hidden="true" className="text-brand" />
          <SectionLabel>Trading, fixing and settlement boundaries</SectionLabel>
        </div>
        <span className="text-xs text-off">UTC</span>
      </div>
      {strategy.boundaries.length === 0 ? (
        <p className="px-3 py-4 text-xs text-faint">The series schedule is not published for this market.</p>
      ) : (
        <div>{strategy.boundaries.map((boundary) => <BoundaryRow key={boundary.id} boundary={boundary} now={now} />)}</div>
      )}
      <div className="border-t border-line px-3 py-2.5 text-xs text-faint">
        Every call after a deadline is permissionless, so a position always reaches its terminal outcome.
      </div>
    </section>
  );
}

function OperationsRail({ strategy, feedAsOf, now }: { strategy: LifecycleStrategy; feedAsOf: number; now: number }) {
  return (
    <aside tabIndex={0} aria-label="Lifecycle" className="focus-ring border-t border-line bg-panel xl:min-h-0 xl:overflow-y-auto xl:border-t-0">
      <section className="border-b border-line">
        <div className="flex h-10 items-center gap-2 border-b border-line px-3">
          <Gauge size={15} aria-hidden="true" className="text-brand" />
          <SectionLabel>Terminal lifecycle</SectionLabel>
        </div>
        <div className="p-3">
          {strategy.lifecycle ? (
            <TerminalLifecycle view={strategy.lifecycle} compact />
          ) : (
            <p className="text-xs leading-snug text-faint">
              The onchain lifecycle for this position has not been read yet. Refresh to read the position engine, the fixing engine
              and the settlement coordinator.
            </p>
          )}
        </div>
      </section>

      <section className="border-b border-line">
        <div className="flex h-10 items-center gap-2 border-b border-line px-3">
          <ShieldCheck size={15} aria-hidden="true" className="text-brand" />
          <SectionLabel>Health</SectionLabel>
        </div>
        <div className="p-3">
          <span className={`text-sm uppercase ${healthTone(strategy.health)}`}>{healthLabel(strategy.health)}</span>
          <p className="mt-1 text-xs leading-snug text-faint">{strategy.healthDetail}</p>
        </div>
      </section>

      <section className="px-3 py-3">
        <div className="flex items-center gap-2">
          <Clock3 size={14} aria-hidden="true" className="text-brand" />
          <SectionLabel>Readings</SectionLabel>
        </div>
        <dl className="mt-2 divide-y divide-line text-xs">
          {[
            ["Mark", strategy.mark !== null ? `${formatNumber(strategy.mark, strategy.market.priceDecimals)} / ${MARK_SOURCE_LABEL[strategy.markSource].toLowerCase()}` : "No mark"],
            ["Reference", strategy.reference !== null ? formatNumber(strategy.reference, Math.max(2, strategy.market.priceDecimals)) : "Not read"],
            ["Series", strategy.seriesStatus === "UNKNOWN" ? "Not read" : strategy.seriesStatus.toLowerCase()],
            ["Feed age", feedAsOf > 0 ? `${Math.max(0, now - feedAsOf)}s` : "Not read"],
            ["Lifecycle read", strategy.lifecycle ? `${Math.max(0, now - strategy.lifecycle.observedAtSeconds)}s ago` : "Not read"],
          ].map(([label, value]) => (
            <div key={label} className="flex items-start justify-between gap-3 py-2">
              <dt className="text-faint">{label}</dt>
              <dd className="tnum text-right font-mono text-dim">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </aside>
  );
}

export function StrategyLifecycleConsole() {
  const snapshot = useGatewaySnapshot();
  const gateway = useInternalGateway();
  const board = useMarketBoard();
  const runtime = useDeploymentRuntime();
  const now = useChainNow();
  const [refreshing, setRefreshing] = useState(false);
  const connected = snapshot.wallet.status === "CONNECTED";
  const positionKey = snapshot.positions.map((position) => position.id).join(",");

  useEffect(() => {
    if (!connected) return;
    let active = true;
    // The lifecycle views are re-read whenever the held positions change.
    void Promise.resolve()
      .then(() => active && setRefreshing(true))
      .then(() => gateway.refreshLifecycles())
      .catch(() => undefined)
      .finally(() => {
        if (active) setRefreshing(false);
      });
    return () => {
      active = false;
    };
  }, [connected, gateway, positionKey]);

  const strategies = useMemo(
    () => lifecycleStrategies({ snapshot, markets: board.markets, feed: board.snapshot, runtime: runtime.data, now }),
    [board.markets, board.snapshot, now, runtime.data, snapshot],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<ConsoleTab>("PLAN");
  const [proposalSelection, setProposalSelection] = useState<Record<string, string>>({});
  const strategy = strategies.find((candidate) => candidate.id === selectedId) ?? strategies[0] ?? null;
  const selectedProposal = strategy ? (strategy.proposals.find((proposal) => proposal.id === proposalSelection[strategy.id]) ?? strategy.proposals[0] ?? null) : null;
  const open = strategies.filter((entry) => entry.health !== "CLOSED").length;

  const refresh = () => {
    setRefreshing(true);
    gateway
      .refreshLifecycles()
      .catch(() => undefined)
      .finally(() => setRefreshing(false));
  };

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-app">
      <section className="shrink-0 border-b border-line bg-panel">
        <div className="flex min-h-12 flex-col lg:h-12 lg:flex-row lg:items-center lg:gap-4 lg:px-4">
          <div className="flex h-12 min-w-0 items-center gap-3 px-3 lg:h-auto lg:px-0">
            <h1 className="shrink-0 text-sm font-semibold text-ink lg:text-base">Lifecycle</h1>
            <MetaLine
              className="hidden min-w-0 truncate xl:flex"
              items={[`${open} open / ${strategies.length - open} completed`, networkLabel(board.snapshot?.chainId ?? snapshot.environment.chainId, board.snapshot?.network ?? snapshot.environment.network)]}
            />
            {connected ? (
              <button
                type="button"
                onClick={refresh}
                disabled={refreshing}
                className="focus-ring ml-auto inline-flex h-7 items-center gap-1.5 rounded-md border border-line px-2 text-[11px] text-dim transition-colors hover:text-ink disabled:opacity-50 lg:ml-0"
              >
                <RefreshCw size={12} aria-hidden="true" className={refreshing ? "animate-spin" : ""} />
                {refreshing ? "Reading" : "Refresh"}
              </button>
            ) : null}
          </div>
          <div className="no-scrollbar overflow-x-auto border-t border-line px-2 lg:ml-auto lg:border-t-0 lg:px-0">
            <Tabs items={TABS} value={tab} onChange={(value) => setTab(value as ConsoleTab)} idBase="lifecycle" />
          </div>
        </div>
      </section>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto xl:grid xl:grid-cols-[272px_minmax(0,1fr)_340px] xl:overflow-hidden">
        <StrategyList
          strategies={strategies}
          selectedId={strategy?.id ?? null}
          onSelect={(id) => {
            setSelectedId(id);
            setTab("PLAN");
          }}
          now={now}
          walletConnected={connected}
          onConnect={() => void gateway.connectWallet().catch(() => undefined)}
        />

        {strategy ? (
          <>
            <section className="min-w-0 border-b border-line bg-app xl:min-h-0 xl:overflow-y-auto xl:border-r xl:border-b-0">
              <PackageHeader strategy={strategy} />
              <div id="lifecycle-panel-PLAN" role="tabpanel" aria-labelledby="lifecycle-tab-PLAN" hidden={tab !== "PLAN"}>
                <ProposalList
                  strategy={strategy}
                  selectedId={selectedProposal?.id ?? null}
                  onSelect={(proposalId) => setProposalSelection((current) => ({ ...current, [strategy.id]: proposalId }))}
                />
                {selectedProposal ? <ProposalDetail strategy={strategy} proposal={selectedProposal} markets={board.markets} /> : null}
              </div>
              <div id="lifecycle-panel-LEGS" role="tabpanel" aria-labelledby="lifecycle-tab-LEGS" hidden={tab !== "LEGS"}>
                <LegsPanel strategy={strategy} />
              </div>
              <div id="lifecycle-panel-BOUNDARIES" role="tabpanel" aria-labelledby="lifecycle-tab-BOUNDARIES" hidden={tab !== "BOUNDARIES"}>
                <BoundariesPanel strategy={strategy} now={now} />
              </div>
            </section>
            <OperationsRail strategy={strategy} feedAsOf={board.asOf} now={now} />
          </>
        ) : (
          <section className="flex min-h-[320px] items-center justify-center bg-app px-6 text-center xl:col-span-2">
            <div className="max-w-sm">
              <Layers3 size={20} aria-hidden="true" className="mx-auto text-faint" />
              <p className="mt-3 text-sm text-ink">No positions to manage</p>
              <p className="mt-1 text-xs leading-relaxed text-faint">
                {connected
                  ? "Each position you hold appears here with its fixing, election and settlement schedule read from chain, and the actions open to it."
                  : "Connect a wallet to read its positions and their onchain lifecycle."}
              </p>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
