"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowUpRight, ChevronRight, Receipt } from "lucide-react";
import { BUTTON_QUIET, CopyButton, EnvironmentChip } from "@/components/activity/ledger-ui";
import { UnderlyingIcon } from "@/components/icons/AssetIcon";
import { Flash, Meter, Panel } from "@/components/strategies/desk/Desk";
import { ProvenanceChip } from "@/components/settlements/trust";
import { MARK_SOURCE_LABEL } from "@/lib/portfolio/forward";
import { SCHEDULE_SOURCE_LABEL, formatCountdownMs, formatUtcDate, formatUtcSession, formatUtcShort } from "@/lib/settlements/calendar";
import { receiptHref, type PositionDossier } from "@/lib/positions/dossier";
import type { PositionMetrics } from "@/lib/positions/economics";
import type { LifeProgress, LifecycleStep } from "@/lib/positions/timeline";
import { formatCompactUsd, formatLots, formatNumber, priceUnitSuffix } from "@/lib/terminal/format";
import { tradeHref } from "@/lib/terminal/markets";
import type { PackageMarket, Provenance } from "@/lib/terminal/types";
import { PhaseTag, SideTag, price, shortId, signedUsd, toneOf, usd, type PhaseTone } from "./parts";

function Tile({
  label,
  provenance,
  source,
  value,
  note,
  tone = "text-ink",
  children,
}: {
  label: string;
  provenance: Provenance;
  source?: string;
  value: ReactNode;
  note?: ReactNode;
  tone?: string;
  children?: ReactNode;
}) {
  return (
    <div className="min-w-0 bg-panel px-3 py-2.5 lg:px-4">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[11px] text-faint">{label}</span>
        <ProvenanceChip provenance={provenance} source={source} compact />
      </div>
      <div className={`tnum mt-1 truncate font-mono text-[15px] leading-5 ${tone}`}>{value}</div>
      {note ? <div className="mt-0.5 truncate text-[11px] text-off">{note}</div> : null}
      {children ? <div className="mt-1.5">{children}</div> : null}
    </div>
  );
}

export function phaseOf(dossier: PositionDossier, metrics: PositionMetrics, nowMs: number): { label: string; tone: PhaseTone } {
  if (dossier.phase === "CLOSED") return { label: "Closed", tone: "closed" };
  if (nowMs >= metrics.fixingMs) return { label: "Awaiting fixing record", tone: "attention" };
  if (nowMs >= metrics.windowOpensMs) return { label: "Fixing window", tone: "window" };
  if (nowMs >= metrics.schedule.lastTradingMs) return { label: "Trading closed", tone: "window" };
  return { label: "Active", tone: "live" };
}

/**
 * Time from opening (or now, when the opening is not recorded) to the fixing
 * print, with the scheduled boundaries in between marked where they fall.
 */
function LifeBar({
  steps,
  progress,
  metrics,
  nowMs,
}: {
  steps: LifecycleStep[];
  progress: LifeProgress;
  metrics: PositionMetrics;
  nowMs: number;
}) {
  const startMs = progress.startMs !== null ? Math.min(progress.startMs, nowMs) : nowMs;
  const endMs = metrics.fixingMs;
  const span = Math.max(1, endMs - startMs);
  const at = (ms: number) => `${Math.max(0, Math.min(1, (ms - startMs) / span)) * 100}%`;
  const remaining = endMs - nowMs;
  const marks = steps.filter(
    (step) => step.kind === "BOUNDARY" && step.atMs !== null && step.atMs > startMs && step.atMs < endMs,
  );
  return (
    <div className="border-t border-line px-3 py-2.5 lg:px-4">
      <div className="flex items-center justify-between gap-3 text-[11px]">
        <span className="truncate text-faint">
          {progress.startMs !== null
            ? `Opened ${formatUtcDate(new Date(progress.startMs).toISOString().slice(0, 10))}`
            : "Now · opening not recorded"}
        </span>
        <span className="tnum shrink-0 font-mono text-dim">
          {remaining > 0 ? `Fixing in ${formatCountdownMs(remaining)}` : "Fixing print passed"}
        </span>
        <span className="hidden truncate text-right text-faint sm:block">{`Fixing ${formatUtcSession(endMs)}`}</span>
      </div>
      <div className="relative mt-2.5 mb-1 h-[3px] rounded-full bg-line">
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 rounded-full bg-ink/50 transition-[width] duration-500 ease-out"
          style={{ width: at(nowMs) }}
        />
        {marks.map((step) => (
          <span
            key={step.id}
            title={`${step.label}, ${step.atLabel}`}
            className={`absolute top-1/2 h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[1px] border ${
              step.attention ? "border-brand bg-brand-soft" : "border-line-strong bg-panel"
            }`}
            style={{ left: at(step.atMs ?? startMs) }}
          >
            <span className="sr-only">{`${step.label}, ${step.atLabel}`}</span>
          </span>
        ))}
        <span
          title="Now, on the platform clock"
          className="absolute top-1/2 h-[9px] w-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-panel bg-brand"
          style={{ left: at(nowMs) }}
        />
        <span aria-hidden="true" className="absolute top-1/2 right-0 h-[11px] w-px -translate-y-1/2 bg-ink/70" />
      </div>
    </div>
  );
}

export function PositionHeader({
  dossier,
  market,
  metrics,
  progress,
  steps,
  nowMs,
}: {
  dossier: PositionDossier;
  market: PackageMarket;
  metrics: PositionMetrics;
  progress: LifeProgress;
  steps: LifecycleStep[];
  nowMs: number;
}) {
  const phase = phaseOf(dossier, metrics, nowMs);
  const unit = priceUnitSuffix(market.priceUnit);
  const record = metrics.recordProvenance;
  const rangeShare =
    metrics.mark === null || metrics.terms.floor === null || metrics.terms.cap === null
      ? null
      : Math.max(0, Math.min(1, (metrics.mark - metrics.terms.floor) / (metrics.terms.cap - metrics.terms.floor)));
  const recordSource = dossier.sourceLabel;
  const opening = dossier.fills.find((fill) => fill.kind === "OPEN") ?? null;
  const closed = dossier.phase === "CLOSED";
  const signedLots = dossier.side === "LONG" ? dossier.lots : -dossier.lots;

  return (
    <Panel label="Position summary">
      <div className="flex flex-col gap-3 px-3 pt-3 pb-3 lg:flex-row lg:items-start lg:justify-between lg:px-4">
        <div className="min-w-0">
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium tracking-[0.08em] text-faint uppercase">
            <Link href="/portfolio" className="focus-ring rounded-sm transition-colors hover:text-ink">
              Portfolio
            </Link>
            <ChevronRight size={11} aria-hidden="true" className="shrink-0 text-off" />
            <Link href="/portfolio/positions" className="focus-ring rounded-sm transition-colors hover:text-ink">
              Positions
            </Link>
            <ChevronRight size={11} aria-hidden="true" className="shrink-0 text-off" />
            <span className="truncate font-mono tracking-normal normal-case">{shortId(dossier.id)}</span>
          </nav>
          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-2">
            <UnderlyingIcon underlying={market.underlying} size={26} />
            <h1 className="min-w-0 font-serif text-[26px] leading-[30px] font-normal tracking-[-0.01em] text-ink lg:text-[30px] lg:leading-[34px]">
              {`${market.name} ${market.tenorLabel}`}
            </h1>
            <span className="flex flex-wrap items-center gap-1.5">
              <SideTag side={dossier.side} />
              <PhaseTag label={phase.label} tone={phase.tone} />
            </span>
          </div>
          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-faint">
            <span className="font-mono text-dim">{market.code}</span>
            <span aria-hidden="true" className="text-off">/</span>
            <span className="inline-flex min-w-0 items-center">
              <span title={dossier.id} className="tnum truncate font-mono">
                {shortId(dossier.id)}
              </span>
              <CopyButton value={dossier.id} label="position ID" size={11} className="h-5 w-5" />
            </span>
            <span aria-hidden="true" className="text-off">/</span>
            <span>{market.strategyLabel}</span>
            <span aria-hidden="true" className="hidden text-off sm:inline">/</span>
            <span className="hidden sm:inline">{dossier.sourceLabel}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <EnvironmentChip />
          {opening ? (
            <Link href={receiptHref(opening.receipt.id)} className={BUTTON_QUIET}>
              <Receipt size={12} aria-hidden="true" />
              Opening receipt
            </Link>
          ) : null}
          <Link href={tradeHref(market)} className={BUTTON_QUIET}>
            Open market
            <ArrowUpRight size={12} aria-hidden="true" />
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px border-t border-line bg-line sm:grid-cols-4 xl:grid-cols-8">
        <Tile
          label={closed ? "Open lots" : "Size"}
          provenance={record}
          source={recordSource}
          value={closed ? "0 lots" : `${signedLots > 0 ? "+" : ""}${formatLots(signedLots)} lots`}
          tone={closed ? "text-dim" : dossier.side === "LONG" ? "text-up" : "text-down"}
          note={closed ? `${formatLots(dossier.openedLots)} lots at opening` : `${formatCompactUsd(metrics.notional)} notional`}
        />
        <Tile
          label="Entry"
          provenance={record}
          source={recordSource}
          value={price(dossier.entryPrice, market)}
          note={dossier.openedAt ? `opened ${formatUtcShort(Date.parse(dossier.openedAt))} UTC` : "opening not recorded"}
        />
        <Tile
          label="Mark"
          provenance={metrics.mark === null ? "MODELED" : metrics.markProvenance}
          source={MARK_SOURCE_LABEL[metrics.markSource]}
          value={metrics.mark === null ? "No quote yet" : <Flash value={metrics.mark}>{price(metrics.mark, market)}</Flash>}
          tone={metrics.mark === null ? "text-faint" : "text-ink"}
          note={
            closed
              ? "current series mark"
              : metrics.closeTouch === null
                ? `no resting ${dossier.side === "LONG" ? "bid" : "ask"}`
                : `close ${formatNumber(metrics.closeTouch, market.priceDecimals)} ${dossier.side === "LONG" ? "bid" : "ask"}`
          }
        />
        {closed ? (
          <Tile
            label="Realized PnL"
            provenance="OBSERVED"
            source="Exit receipts"
            value={dossier.realizedPnl !== null ? signedUsd(dossier.realizedPnl, 2) : "Not recorded"}
            tone={dossier.realizedPnl !== null ? toneOf(dossier.realizedPnl) : "text-faint"}
            note={`fees ${usd(dossier.fees, 2)}`}
          />
        ) : (
          <Tile
            label="Open PnL"
            provenance={metrics.mark === null ? "MODELED" : "ESTIMATED"}
            source="Entry against the mark, less fees"
            value={metrics.mark === null ? "—" : <Flash value={metrics.totalPnl}>{signedUsd(metrics.totalPnl)}</Flash>}
            tone={metrics.mark === null ? "text-faint" : toneOf(metrics.totalPnl)}
            note={
              metrics.touchPnl === null
                ? "no executable close"
                : `${signedUsd(metrics.touchPnl)} at the ${dossier.side === "LONG" ? "bid" : "ask"}`
            }
          />
        )}
        {closed ? (
          <Tile
            label="Collateral released"
            provenance="OBSERVED"
            source="Exit receipts"
            value={dossier.collateralReleased !== null ? usd(dossier.collateralReleased) : "Not recorded"}
            tone={dossier.collateralReleased !== null ? "text-ink" : "text-faint"}
            note="returned to available"
          />
        ) : (
          <Tile
            label="Collateral"
            provenance={record}
            source={recordSource}
            value={usd(dossier.collateral)}
            note={`${formatCompactUsd(metrics.atRisk)} at risk to the ${dossier.side === "LONG" ? "floor" : "cap"}`}
          />
        )}
        {closed ? (
          <Tile label="Fees paid" provenance="OBSERVED" source="Linked receipts" value={usd(dossier.fees, 2)} note={`${dossier.fills.length} linked fills`} />
        ) : (
          <Tile
            label="Range position"
            provenance={metrics.mark === null ? "MODELED" : "ESTIMATED"}
            source="Mark between the payoff floor and cap"
            value={rangeShare === null ? "—" : `${formatNumber(rangeShare * 100, 1)}% of range`}
            tone={rangeShare !== null && (rangeShare < 0.1 || rangeShare > 0.9) ? "text-brand" : "text-ink"}
            note={rangeShare === null ? (metrics.terms.floor === null ? "range not published" : "no mark yet") : "delta-one inside the range"}
          >
            <Meter
              value={rangeShare ?? 0}
              tone={rangeShare !== null && (rangeShare < 0.1 || rangeShare > 0.9) ? "brand" : "up"}
              label="Mark position inside the payoff range"
            />
          </Tile>
        )}
        {closed ? (
          <Tile
            label="Closed"
            provenance="OBSERVED"
            source={recordSource}
            value={dossier.closedAt ? formatUtcSession(Date.parse(dossier.closedAt)).slice(0, 11) : "Terminal"}
            note="before its fixing"
          />
        ) : (
          <Tile
            label="Payoff range"
            provenance="OBSERVED"
            source="Series listing"
            value={
              metrics.terms.floor === null || metrics.terms.cap === null
                ? "Not published"
                : `${price(metrics.terms.floor, market, false)} – ${price(metrics.terms.cap, market, false)}`
            }
            tone={metrics.terms.floor === null ? "text-faint" : "text-ink"}
            note={`${unit}, ${formatNumber(metrics.terms.lotSize, metrics.terms.lotSize < 1 ? 4 : 0)} ${market.underlying.split("/")[0]} per lot`}
          />
        )}
        <Tile
          label="Fixing"
          provenance={metrics.schedule.source === "POSITION" ? "OBSERVED" : "MODELED"}
          source={SCHEDULE_SOURCE_LABEL[metrics.schedule.source]}
          value={closed ? "Not applicable" : formatCountdownMs(metrics.msToFixing)}
          tone={closed ? "text-faint" : metrics.msToFixing < 7 * 86_400_000 ? "text-brand" : "text-ink"}
          note={formatUtcSession(metrics.fixingMs)}
        />
      </div>
      {closed ? null : <LifeBar steps={steps} progress={progress} metrics={metrics} nowMs={nowMs} />}
    </Panel>
  );
}
