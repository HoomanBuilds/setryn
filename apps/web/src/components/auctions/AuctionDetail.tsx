"use client";

import { useMemo } from "react";
import { Info } from "lucide-react";
import { middleTruncate } from "@/components/activity/ledger-ui";
import { StepTimeline, type TimelineStep } from "@/components/activity/StepTimeline";
import { MarketMark } from "@/components/portfolio/MarketMark";
import { computeClearingResult } from "@/lib/auctions/clearing";
import type { AuctionRecord } from "@/lib/auctions/types";
import { formatLots, formatNumber } from "@/lib/terminal/format";
import { packageLabel } from "@/lib/terminal/markets";
import type { PackageMarket } from "@/lib/terminal/types";
import {
  AuctionStatusChip,
  BID_STATUS_COPY,
  ProvenanceChip,
  SubHead,
  Term,
  clockText,
  countdownText,
  kindCopy,
  ruleCopy,
  sideCopy,
  ticksText,
} from "./board-kit";

function bondText(outcome: string): string {
  if (outcome === "SLASH") return "slash";
  if (outcome === "RELEASE") return "release";
  if (outcome === "EXPIRE") return "hold to expiry";
  return "unspecified";
}

function timeline(record: AuctionRecord, now: number): TimelineStep[] {
  const definition = record.version.definition;
  const status = record.version.status;
  const inWindow = (from: number, to: number) => now >= from && now < to;
  const cleared = status === "CLEARED" || status === "SETTLED" || (status === "FAILED" && record.result !== null);
  return [
    {
      id: "scheduled",
      label: "Scheduled",
      state: "done",
      meta: `block ${record.scheduledBlock.toLocaleString("en-US")}`,
      detail: "Definition validated against exact package, fee schedule and risk domain versions.",
    },
    {
      id: "commit",
      label: "Commit window",
      state: now >= definition.commitClosesAt ? "done" : inWindow(definition.commitOpensAt, definition.commitClosesAt) ? "active" : "pending",
      meta: `${clockText(definition.commitOpensAt)} to ${clockText(definition.commitClosesAt)}`,
      detail: `${record.version.commitmentCount} sealed commitments, each bonded.`,
    },
    {
      id: "reveal",
      label: "Reveal window",
      state: now >= definition.revealClosesAt ? "done" : inWindow(definition.commitClosesAt, definition.revealClosesAt) ? "active" : "pending",
      meta: `to ${clockText(definition.revealClosesAt)}`,
      detail: `${record.version.revealCount} of ${record.version.commitmentCount} revealed. Unrevealed bonds ${bondText(definition.unrevealedBondOutcome)}.`,
    },
    {
      id: "clear",
      label: "Clear",
      state: cleared ? "done" : status === "CANCELLED" ? "failed" : now >= definition.revealClosesAt ? "active" : "pending",
      meta: `deadline ${clockText(definition.clearDeadline)}`,
      detail: cleared ? `Result ${middleTruncate(record.version.clearingResultHash, 10, 6)}.` : "Anyone may call clearAuction after reveal closes.",
    },
    {
      id: "settle",
      label: "Settle",
      state: status === "SETTLED" ? "done" : status === "FAILED" ? "failed" : cleared ? "active" : "pending",
      meta: `deadline ${clockText(definition.settlementDeadline)}`,
      detail: status === "FAILED" ? `Settlement failed; bonds ${bondText(definition.settlementFailureBondOutcome)}.` : "The clearing handoff settles through the clearing engine.",
    },
  ];
}

export function AuctionDetail({ record, now, market }: { record: AuctionRecord; now: number; market: PackageMarket | null }) {
  const definition = record.version.definition;
  const side = sideCopy(definition.auctionSide);
  const recomputed = useMemo(() => {
    if (!record.result || record.bids.some((bid) => bid.record.bid === null && bid.record.status === "REVEALED")) return null;
    try {
      return computeClearingResult(record.id, record.version.version, definition, record.bids);
    } catch {
      return null;
    }
  }, [definition, record]);
  const matches = recomputed && record.result ? recomputed.result.resultHash.toLowerCase() === record.result.resultHash.toLowerCase() : null;

  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
      <div className="border-b border-line px-3 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <span className="flex items-center gap-2">
              {market ? <MarketMark underlying={market.underlying} size={16} /> : null}
              <span className="truncate text-sm text-ink">{market ? packageLabel(market) : "Package auction"}</span>
            </span>
            <span className="tnum mt-0.5 block font-mono text-[11px] text-faint">{`${middleTruncate(record.id, 10, 6)} v${record.version.version}`}</span>
          </div>
          <AuctionStatusChip status={record.version.status} />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <ProvenanceChip value="OBSERVED" title="Read from the SealedAuctionHouse." />
          <span className={`text-[11px] ${side.className}`}>{side.label}</span>
          <span className="text-[11px] text-faint">{side.bidders}</span>
        </div>
      </div>

      <SubHead>Terms</SubHead>
      <dl className="grid grid-cols-2 gap-x-3 px-3 pb-2">
        <Term label="Kind" value={kindCopy(record)} />
        <Term label="Price rule" value={ruleCopy(record)} />
        <Term label="Size" value={`${formatLots(definition.totalLots)} lots`} />
        <Term label="Lot step" value={formatLots(definition.lotStep)} />
        <Term label="Max bids" value={definition.maximumBids} />
        <Term label="Bond" value={`${formatNumber(definition.requiredBondAmount / 1_000_000, 2)} USDC`} />
        <Term label="Losing bonds" value={bondText(definition.losingBondOutcome)} />
        <Term label="Keeper reward cap" value={`${formatNumber(definition.maximumKeeperRewardMinor / 1_000_000, 2)} USDC`} />
        <Term label="Commit closes" value={now < definition.commitClosesAt ? `in ${countdownText(definition.commitClosesAt - now)}` : `${clockText(definition.commitClosesAt)} UTC`} />
        <Term label="Reveal closes" value={now < definition.revealClosesAt ? `in ${countdownText(definition.revealClosesAt - now)}` : `${clockText(definition.revealClosesAt)} UTC`} />
      </dl>

      <SubHead right={<span className="text-[11px] text-faint">{`${record.bids.length} committed`}</span>}>Bids</SubHead>
      {record.bids.length === 0 ? (
        <p className="px-3 pb-3 text-xs text-faint">No bids committed.</p>
      ) : (
        <ul className="divide-y divide-line-soft border-y border-line-soft">
          {record.bids.map((bid) => {
            const copy = BID_STATUS_COPY[bid.record.status];
            const sealed = bid.record.bid;
            return (
              <li key={bid.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-2">
                <span className="min-w-0">
                  <span className="tnum block truncate font-mono text-[11px] text-dim">{middleTruncate(bid.record.authorization.bidder, 8, 6)}</span>
                  <span className={`text-[11px] ${copy.className}`}>{copy.label}</span>
                </span>
                <span className="tnum text-right font-mono text-xs">
                  {sealed ? (
                    <>
                      <span className="text-ink">{market ? ticksText(sealed.priceTicks, market) : sealed.priceTicks}</span>
                      <span className="block text-[10px] text-faint">{`${formatLots(sealed.lots)} lots${bid.record.allocatedLots > 0 ? ` / ${formatLots(bid.record.allocatedLots)} allocated` : ""}`}</span>
                    </>
                  ) : (
                    <span className="text-faint">Sealed</span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {record.result ? (
        <>
          <SubHead>Clearing</SubHead>
          <dl className="grid grid-cols-2 gap-x-3 px-3 pb-2">
            <Term label="Allocated" value={`${formatLots(record.result.totalAllocatedLots)} / ${formatLots(definition.totalLots)}`} />
            <Term label="Winners" value={record.result.winnerCount} />
            <Term label="Uniform price" value={market && definition.priceRule === "UNIFORM_PRICE" ? ticksText(record.result.uniformPriceTicks, market) : "-"} />
            <Term label="Result" value={middleTruncate(record.result.resultHash, 8, 6)} title={record.result.resultHash} />
            <Term
              label="Recomputed"
              value={matches === null ? "Needs every reveal" : matches ? "Matches the ranking rule" : "Differs from the ranking rule"}
              tone={matches === null ? "text-faint" : matches ? "text-up" : "text-down"}
            />
          </dl>
        </>
      ) : null}

      <SubHead>Lifecycle</SubHead>
      <div className="px-3 pb-3">
        <StepTimeline steps={timeline(record, now)} />
      </div>

      <p className="flex items-start gap-1.5 border-t border-line px-3 py-2.5 text-[11px] leading-snug text-faint">
        <Info size={12} aria-hidden="true" className="mt-0.5 shrink-0" />
        Bid contents stay hidden until each bidder reveals. Clearing and settlement are permissionless after their windows.
      </p>
    </div>
  );
}
