"use client";

import type { CSSProperties, ReactNode } from "react";
import { Chip as DeskChip } from "@/components/strategies/desk/Desk";
import { Chip, formatCountdown, type ChipTone } from "@/components/activity/ledger-ui";
import { ticksToPrice } from "@/lib/auctions/feed";
import type { AuctionRecord, AuctionStatus, BidStatus } from "@/lib/auctions/types";
import { formatNumber, priceUnitSuffix } from "@/lib/terminal/format";
import type { PackageMarket, Provenance } from "@/lib/terminal/types";

/* ------------------------------------------------------------------ */
/* Provenance                                                          */
/* ------------------------------------------------------------------ */

const PROVENANCE_COPY: Record<Provenance, { label: string; tone: "neutral" | "dim" | "brand" | "up"; title: string }> = {
  OBSERVED: {
    label: "Observed",
    tone: "dim",
    title: "Read from an identified chain event, venue, or signed record.",
  },
  EXECUTABLE: {
    label: "Executable",
    tone: "up",
    title: "Backed by an active order, quote, auction rule, or reserved commitment.",
  },
  ESTIMATED: {
    label: "Estimated",
    tone: "neutral",
    title: "Calculated from current executable inputs, not itself guaranteed.",
  },
  MODELED: {
    label: "Modeled",
    tone: "brand",
    title: "Produced by a deterministic schedule or model. Never execution evidence.",
  },
};

/** Persistent data-trust label. The word carries the class, so it never relies on colour. */
export function ProvenanceChip({
  value,
  title,
  className = "",
}: {
  value: Provenance;
  title?: string;
  className?: string;
}) {
  const copy = PROVENANCE_COPY[value];
  return (
    <DeskChip tone={copy.tone} title={title ?? copy.title} className={className}>
      {copy.label}
    </DeskChip>
  );
}

/* ------------------------------------------------------------------ */
/* Auction and bid status                                              */
/* ------------------------------------------------------------------ */

export const AUCTION_STATUS_COPY: Record<AuctionStatus, { label: string; tone: ChipTone; live?: boolean }> = {
  UNSPECIFIED: { label: "Unknown", tone: "muted" },
  SCHEDULED: { label: "Scheduled", tone: "neutral" },
  COMMIT_OPEN: { label: "Commit open", tone: "brand", live: true },
  REVEAL_OPEN: { label: "Reveal open", tone: "ink", live: true },
  READY_TO_CLEAR: { label: "Ready to clear", tone: "ink" },
  CLEARED: { label: "Cleared", tone: "neutral" },
  SETTLED: { label: "Settled", tone: "up" },
  CANCELLED: { label: "Cancelled", tone: "muted" },
  FAILED: { label: "Failed", tone: "down" },
};

export function AuctionStatusChip({ status }: { status: AuctionStatus }) {
  const copy = AUCTION_STATUS_COPY[status];
  return (
    <Chip tone={copy.tone} dot live={copy.live}>
      {copy.label}
    </Chip>
  );
}

export const BID_STATUS_COPY: Record<BidStatus, { label: string; className: string }> = {
  UNSPECIFIED: { label: "Unknown", className: "text-faint" },
  COMMITTED: { label: "Sealed", className: "text-dim" },
  REVEALED: { label: "Revealed", className: "text-ink" },
  WINNER: { label: "Winner", className: "text-up" },
  LOSER: { label: "Not allocated", className: "text-faint" },
  UNREVEALED: { label: "Unrevealed", className: "text-down" },
  BOND_RELEASED: { label: "Bond released", className: "text-faint" },
  BOND_SLASHED: { label: "Bond slashed", className: "text-down" },
};

/* ------------------------------------------------------------------ */
/* Numbers and time                                                    */
/* ------------------------------------------------------------------ */

export function ticksText(ticks: number, market: PackageMarket, withUnit = false): string {
  const text = formatNumber(ticksToPrice(ticks, market), market.priceDecimals);
  return withUnit ? `${text} ${priceUnitSuffix(market.priceUnit)}` : text;
}

export function priceText(price: number, market: PackageMarket, withUnit = false): string {
  const text = formatNumber(price, market.priceDecimals);
  return withUnit ? `${text} ${priceUnitSuffix(market.priceUnit)}` : text;
}

export function signedPrice(value: number, market: PackageMarket): string {
  const rounded = Number(value.toFixed(market.priceDecimals));
  const sign = rounded > 0 ? "+" : rounded < 0 ? "-" : "±";
  return `${sign}${formatNumber(Math.abs(rounded), market.priceDecimals)}`;
}

/** Whole-dollar USDC with a compact suffix above ten thousand. */
export function usd(value: number, signed = false): string {
  const sign = signed ? (value > 0 ? "+" : value < 0 ? "-" : "") : value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${sign}${formatNumber(abs / 1_000_000, 2)}M`;
  if (abs >= 10_000) return `${sign}${formatNumber(abs / 1_000, 1)}k`;
  return `${sign}${formatNumber(abs, 0)}`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** hh:mm:ss UTC for an epoch in seconds. */
export function clockText(epochSeconds: number): string {
  const date = new Date(epochSeconds * 1000);
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

export function countdownText(seconds: number): string {
  return formatCountdown(Math.max(0, Math.ceil(seconds)));
}

export function sideCopy(side: "BUY" | "SELL" | "UNSPECIFIED"): { label: string; bidders: string; className: string } {
  if (side === "BUY") return { label: "Initiator buys", bidders: "Offers compete, lowest first", className: "text-up" };
  if (side === "SELL") return { label: "Initiator sells", bidders: "Bids compete, highest first", className: "text-down" };
  return { label: "Unspecified", bidders: "", className: "text-faint" };
}

export function kindCopy(record: AuctionRecord): string {
  const definition = record.version.definition;
  if (definition.kind === "SOLVER_ROUTE") return "Solver route";
  return definition.priceRule === "UNIFORM_PRICE" ? "Batch, uniform price" : "Block, pay as bid";
}

export function ruleCopy(record: AuctionRecord): string {
  const rule = record.version.definition.priceRule;
  if (rule === "UNIFORM_PRICE") return "Uniform price";
  if (rule === "PAY_AS_BID") return "Pay as bid";
  if (rule === "BEST_PACKAGE") return "Best package";
  return "Unspecified";
}

/* ------------------------------------------------------------------ */
/* Phase clock                                                         */
/* ------------------------------------------------------------------ */

interface Segment {
  id: string;
  label: string;
  start: number;
  end: number;
}

export function phaseSegments(record: AuctionRecord): Segment[] {
  const definition = record.version.definition;
  const settleEnd = record.settlementFails ? Math.max(record.keeper.failAt, definition.settlementDeadline) : record.keeper.settleAt;
  return [
    { id: "commit", label: "Commit", start: definition.commitOpensAt, end: definition.commitClosesAt },
    { id: "reveal", label: "Reveal", start: definition.commitClosesAt, end: definition.revealClosesAt },
    { id: "clear", label: "Clear", start: definition.revealClosesAt, end: record.keeper.clearAt },
    { id: "settle", label: "Settle", start: record.keeper.clearAt, end: settleEnd },
  ];
}

/**
 * The round as one horizontal clock: commit, reveal, clear and settle in
 * proportion, elapsed time filled, and a marker at the market clock.
 */
export function PhaseClock({
  record,
  epoch,
  compact = false,
  className = "",
}: {
  record: AuctionRecord;
  epoch: number;
  compact?: boolean;
  className?: string;
}) {
  const segments = phaseSegments(record);
  const start = segments[0].start;
  const end = segments[segments.length - 1].end;
  const total = Math.max(1, end - start);
  const progress = Math.max(0, Math.min(1, (epoch - start) / total));
  const failed = record.version.status === "FAILED" || record.version.status === "CANCELLED";
  const markerStyle: CSSProperties = { left: `${progress * 100}%` };
  return (
    <div className={`min-w-0 ${className}`}>
      <div className="relative flex h-2 items-stretch gap-[2px]" role="img" aria-label={`Round ${Math.round(progress * 100)} percent elapsed`}>
        {segments.map((segment) => {
          const width = ((segment.end - segment.start) / total) * 100;
          const filled = Math.max(0, Math.min(1, (epoch - segment.start) / Math.max(1, segment.end - segment.start)));
          const active = epoch >= segment.start && epoch < segment.end;
          return (
            <span
              key={segment.id}
              className={`relative overflow-hidden rounded-[2px] ${active ? "bg-line-strong" : "bg-line"}`}
              style={{ width: `${width}%`, minWidth: 3 }}
            >
              <span
                aria-hidden="true"
                className={`absolute inset-0 origin-left transition-transform duration-1000 ease-linear ${
                  failed ? "bg-down/60" : segment.id === "commit" ? "bg-brand/80" : segment.id === "reveal" ? "bg-ink/70" : "bg-dim/60"
                }`}
                style={{ transform: `scaleX(${filled})` }}
              />
            </span>
          );
        })}
        {progress > 0 && progress < 1 ? (
          <span
            aria-hidden="true"
            className="absolute -top-[3px] -bottom-[3px] w-px bg-ink transition-[left] duration-1000 ease-linear"
            style={markerStyle}
          />
        ) : null}
      </div>
      {compact ? null : (
        <div className="mt-1 flex gap-[2px] text-[10px] text-faint">
          {segments.map((segment) => (
            <span
              key={segment.id}
              className={`truncate ${epoch >= segment.start && epoch < segment.end ? "text-ink" : ""}`}
              style={{ width: `${((segment.end - segment.start) / total) * 100}%`, minWidth: 3 }}
            >
              {segment.end - segment.start >= total * 0.12 ? segment.label : ""}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Label over value, mono tabular, for dense detail grids. */
export function Term({ label, value, title, tone = "text-ink" }: { label: ReactNode; value: ReactNode; title?: string; tone?: string }) {
  return (
    <div className="min-w-0 py-1.5" title={title}>
      <dt className="truncate text-[11px] text-faint">{label}</dt>
      <dd className={`tnum mt-0.5 truncate font-mono text-xs ${tone}`}>{value}</dd>
    </div>
  );
}

/** Small heading row used inside panels. */
export function SubHead({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-1.5">
      <h3 className="text-[11px] font-medium tracking-[0.06em] text-faint uppercase">{children}</h3>
      {right ? <div className="flex shrink-0 items-center gap-1.5">{right}</div> : null}
    </div>
  );
}
