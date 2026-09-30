"use client";

import { Info } from "lucide-react";
import { middleTruncate, motion } from "@/components/activity/ledger-ui";
import { StepTimeline, type TimelineStep } from "@/components/activity/StepTimeline";
import { Flash } from "@/components/strategies/desk/Desk";
import { ticksToPrice } from "@/lib/auctions/feed";
import { BOND_SWEEP_DELAY, marketOf, rankingFor } from "@/lib/auctions/schedule";
import type { AuctionRecord, BidView } from "@/lib/auctions/types";
import { OWN_SOLVER_ID } from "@/lib/solver/roster";
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
  priceText,
  ruleCopy,
  sideCopy,
  signedPrice,
  ticksText,
} from "./board-kit";

function bondText(outcome: string): string {
  if (outcome === "SLASH") return "slash";
  if (outcome === "RELEASE") return "release";
  if (outcome === "EXPIRE") return "hold to expiry";
  return "unspecified";
}

function timeline(record: AuctionRecord, epoch: number): TimelineStep[] {
  const definition = record.version.definition;
  const status = record.version.status;
  const noClear = status === "CANCELLED" || (status === "FAILED" && !record.result);
  const settlementFailed = status === "FAILED" && record.result !== null;
  const bondsDone = epoch >= definition.bondExpiry + BOND_SWEEP_DELAY;
  const inWindow = (from: number, to: number) => epoch >= from && epoch < to;
  return [
    {
      id: "scheduled",
      label: "Scheduled",
      state: "done",
      meta: `opens ${clockText(definition.commitOpensAt)}`,
      detail: "Definition validated against exact package, fee schedule and risk domain versions.",
    },
    {
      id: "commit",
      label: "Commit window",
      state: epoch >= definition.commitClosesAt ? "done" : inWindow(definition.commitOpensAt, definition.commitClosesAt) ? "active" : "pending",
      meta: `${clockText(definition.commitOpensAt)} to ${clockText(definition.commitClosesAt)}`,
      detail:
        epoch < definition.commitOpensAt
          ? `Opens in ${countdownText(definition.commitOpensAt - epoch)}.`
          : `${record.version.commitmentCount} sealed commitment${record.version.commitmentCount === 1 ? "" : "s"}, each backed by a ${usdText(definition.requiredBondAmount / 1_000_000)} USDC bond.`,
    },
    {
      id: "reveal",
      label: "Reveal window",
      state: epoch >= definition.revealClosesAt ? "done" : inWindow(definition.commitClosesAt, definition.revealClosesAt) ? "active" : "pending",
      meta: `to ${clockText(definition.revealClosesAt)}`,
      detail:
        epoch < definition.commitClosesAt
          ? "Bid contents stay sealed until commit closes."
          : `${record.version.revealCount} of ${record.version.commitmentCount} revealed. Unrevealed bonds ${bondText(definition.unrevealedBondOutcome)}.`,
    },
    {
      id: "clear",
      label: noClear ? (status === "CANCELLED" ? "Cancelled, no eligible bids" : "Failed, no eligible bids") : "Cleared",
      state: noClear ? "failed" : record.result ? "done" : status === "READY_TO_CLEAR" ? "active" : "pending",
      meta: `deadline ${clockText(definition.clearDeadline)}`,
      detail: record.result
        ? `${formatLots(record.result.totalAllocatedLots)} of ${formatLots(definition.totalLots)} lots to ${record.result.winnerCount} winner${record.result.winnerCount === 1 ? "" : "s"}.`
        : "Anyone can call clearAuction once reveal closes and before the clear deadline.",
    },
    {
      id: "settle",
      label: settlementFailed ? "Settlement failed" : "Settled",
      state: settlementFailed ? "failed" : status === "SETTLED" ? "done" : status === "CLEARED" ? "active" : "pending",
      meta: `deadline ${clockText(definition.settlementDeadline)}`,
      detail: settlementFailed
        ? "The handoff did not settle by the deadline. failExpiredSettlement expired the route reservation and applied the winning-bond outcome."
        : status === "CLEARED" && epoch > definition.settlementDeadline
          ? "Deadline passed. Anyone can call failExpiredSettlement."
          : "Winners settle through the clearing engine handoff before the settlement deadline.",
    },
    {
      id: "bonds",
      label: "Bonds resolved",
      state: bondsDone ? "done" : epoch >= definition.bondExpiry ? "active" : "pending",
      meta: `expiry ${clockText(definition.bondExpiry)}`,
      detail: `Losing bonds ${bondText(definition.losingBondOutcome)}. After expiry anyone can call releaseExpiredBond.`,
    },
  ];
}

function usdText(value: number): string {
  return formatNumber(value, 0);
}

function priceOf(bid: BidView): number | null {
  if (!bid.record.bid) return null;
  return bid.route ? bid.route.route.packageOutcomeTicks : bid.record.bid.priceTicks;
}

function BidRow({
  bid,
  market,
  rank,
  skipped,
  index,
}: {
  bid: BidView;
  market: PackageMarket;
  rank: number | null;
  skipped: boolean;
  index: number;
}) {
  const sealed = bid.record.bid === null;
  const price = priceOf(bid);
  const status = BID_STATUS_COPY[bid.record.status];
  const own = bid.bidderId === OWN_SOLVER_ID;
  const winner = bid.record.allocatedLots > 0;
  return (
    <li
      style={{ ["--i" as string]: index }}
      className={`${motion.stagger} grid grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-x-2 border-b border-line px-3 py-2 last:border-b-0 ${
        winner ? "bg-up-soft/30" : ""
      }`}
    >
      <span
        className={`tnum flex h-5 w-5 items-center justify-center rounded-sm font-mono text-[10px] ${
          winner ? "bg-up/20 text-up" : rank !== null ? "bg-raised text-dim" : "border border-dashed border-line-strong text-faint"
        }`}
        aria-label={rank !== null ? `Contract rank ${rank}` : "Not ranked"}
      >
        {rank ?? "·"}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-xs text-ink">{bid.bidderLabel}</span>
          {own ? <span className="rounded-[3px] bg-brand-soft px-1 font-mono text-[9px] text-brand">YOU</span> : null}
        </span>
        <span className="tnum block truncate font-mono text-[10px] text-faint">
          {`committed ${clockText(bid.committedAt)}${bid.revealedAt ? ` · revealed ${clockText(bid.revealedAt)}` : ""}`}
        </span>
      </span>
      <span className="flex flex-col items-end">
        <span className="tnum font-mono text-xs text-ink">
          {sealed ? (
            <span className="text-faint" title="Sealed: only the commitment hash is public until reveal.">
              sealed
            </span>
          ) : price !== null ? (
            ticksText(price, market)
          ) : (
            "—"
          )}
        </span>
        <span className={`text-[10px] ${skipped ? "text-down" : status.className}`}>
          {winner
            ? `${formatLots(bid.record.allocatedLots)} lots @ ${ticksText(bid.record.allocationPriceTicks, market)}`
            : skipped
              ? "Skipped, size rule"
              : bid.record.bid
                ? `${formatLots(bid.record.bid.lots)} lots${bid.record.bid.allowPartialAllocation ? `, min ${formatLots(bid.record.bid.minimumFillLots)}` : ", all or none"} · ${status.label}`
                : status.label}
        </span>
      </span>
    </li>
  );
}

export function AuctionDetail({
  record,
  epoch,
  liveMarket,
}: {
  record: AuctionRecord;
  epoch: number;
  liveMarket: PackageMarket | null;
}) {
  const market = marketOf(record);
  const definition = record.version.definition;
  const side = sideCopy(definition.auctionSide);
  const { ranking, skipped } = rankingFor(record);
  const rankOf = (id: string) => {
    const index = ranking.indexOf(id as (typeof ranking)[number]);
    return index >= 0 ? index + 1 : null;
  };
  const bids = [...record.bids].sort((left, right) => {
    const leftRank = rankOf(left.id);
    const rightRank = rankOf(right.id);
    if (leftRank !== null && rightRank !== null) return leftRank - rightRank;
    if (leftRank !== null) return -1;
    if (rightRank !== null) return 1;
    return left.committedAt - right.committedAt;
  });
  const reference = ticksToPrice(record.referenceTicks, market);
  const clearing = record.result ? ticksToPrice(record.result.uniformPriceTicks, market) : null;
  const residual = record.result ? definition.totalLots - record.result.totalAllocatedLots : null;
  const routeAuction = definition.kind === "SOLVER_ROUTE";

  return (
    <div key={record.id} className={`flex min-h-0 flex-1 flex-col ${motion.fade}`}>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className="border-b border-line px-3 pt-3 pb-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <AuctionStatusChip status={record.version.status} />
            <ProvenanceChip value="MODELED" />
            <span
              className="tnum ml-auto truncate font-mono text-[10px] text-faint"
              title={`Modeled auction id ${record.id}. Not a chain commitment.`}
            >
              {middleTruncate(record.id, 8, 6)}
            </span>
          </div>
          <h2 className="mt-2 truncate text-sm font-medium text-ink">{record.label}</h2>
          <p className="mt-0.5 truncate text-xs text-dim">{`${packageLabel(market)} · ${kindCopy(record)}`}</p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="min-w-0">
              <div className="text-[11px] text-faint">{record.result ? (routeAuction ? "Winning outcome" : definition.priceRule === "UNIFORM_PRICE" ? "Uniform price" : "Marginal price") : "Reference at open"}</div>
              <div className="mt-0.5 flex items-baseline gap-1.5">
                <span className="tnum font-serif text-[26px] leading-8 text-ink">
                  {clearing !== null ? priceText(clearing, market) : priceText(reference, market)}
                </span>
                <span className="text-xs text-faint">{market.priceUnit === "BP" ? "bp" : market.priceUnit === "PTS" ? "pts" : "USD"}</span>
              </div>
              <div className="tnum mt-0.5 font-mono text-[11px] text-faint">
                {clearing !== null ? `${signedPrice(clearing - reference, market)} vs mark at open` : "Feed mark when commit opened"}
              </div>
            </div>
            <div className="min-w-0 text-right">
              <div className="text-[11px] text-faint">Live mark</div>
              <div className="tnum mt-0.5 font-serif text-[26px] leading-8 text-ink">
                {liveMarket ? <Flash value={liveMarket.netPrice}>{priceText(liveMarket.netPrice, market)}</Flash> : "—"}
              </div>
              <div className="mt-0.5 text-[11px] text-faint">Shared preview feed</div>
            </div>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 border-b border-line px-3 py-1.5 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
          <Term label="Side" value={side.label} tone={side.className} />
          <Term label="Size" value={`${formatLots(definition.totalLots)} lots`} title={`Lot step ${definition.lotStep}`} />
          <Term label="Price rule" value={ruleCopy(record)} />
          <Term
            label="Bidders"
            value={`${record.version.commitmentCount} / ${definition.maximumBids}`}
            title="Commitments against the maximum the definition allows"
          />
          <Term label="Bond" value={`${usdText(definition.requiredBondAmount / 1_000_000)} USDC`} />
          <Term label="Tie-break" value="Fee, then hash" title="Lower maximum fee wins a price tie, then the lower commitment hash." />
          {record.result ? (
            <>
              <Term label="Matched" value={`${formatLots(record.result.totalAllocatedLots)} lots`} tone="text-ink" />
              <Term label="Residual" value={`${formatLots(residual ?? 0)} lots`} tone={residual ? "text-dim" : "text-faint"} />
              <Term label="Winners" value={record.result.winnerCount} />
            </>
          ) : null}
        </dl>

        <SubHead right={<span className="tnum font-mono text-[10px] text-faint">{`${record.bids.length} committed`}</span>}>
          Bids
        </SubHead>
        {bids.length === 0 ? (
          <p className="mx-3 mb-3 rounded-md border border-dashed border-line-strong px-3 py-4 text-center text-xs text-faint">
            {epoch < definition.commitOpensAt ? `Commit opens in ${countdownText(definition.commitOpensAt - epoch)}.` : "No commitments yet."}
          </p>
        ) : (
          <ol className="mx-3 mb-2 overflow-hidden rounded-md border border-line">
            {bids.map((bid, index) => (
              <BidRow
                key={bid.id}
                bid={bid}
                market={market}
                rank={rankOf(bid.id)}
                skipped={skipped.includes(bid.id)}
                index={index}
              />
            ))}
          </ol>
        )}
        <p className="mx-3 mb-3 flex items-start gap-1.5 text-[11px] leading-snug text-faint">
          <Info size={12} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>
            {routeAuction
              ? `${side.bidders}. One solver route wins the full size; ties break on lower fee, larger capacity, then lower commitment hash.`
              : definition.priceRule === "UNIFORM_PRICE"
                ? `${side.bidders}. Winners fill until the size is exhausted and every winner trades at the marginal winning price. A bid that cannot meet its minimum fill from the remainder is skipped.`
                : `${side.bidders}. Winners fill until the size is exhausted and each trades at its own price.`}
          </span>
        </p>

        <SubHead>Round timeline</SubHead>
        <StepTimeline steps={timeline(record, epoch)} dense className="px-3 pb-3" />

        <SubHead>Definition</SubHead>
        <dl className="grid grid-cols-2 gap-x-4 px-3 pb-2">
          <Term label="Target" value={`Package ${market.code}`} title={definition.packageId} />
          <Term label="Legs committed" value={definition.hasPackageLegCommitment ? `${market.legs.length} legs` : "No"} />
          <Term label="No-bid rule" value={definition.noBidTreatment === "CANCEL" ? "Cancel" : "Fail"} />
          <Term label="Unrevealed bond" value={bondText(definition.unrevealedBondOutcome)} />
          <Term label="Losing bond" value={bondText(definition.losingBondOutcome)} />
          <Term label="Failure bond" value={bondText(definition.settlementFailureBondOutcome)} />
          <Term label="Initiator fee cap" value={`${usdText(definition.initiatorMaximumFeeMinor / 1_000_000)} USDC`} />
          <Term label="Keeper reward cap" value={`${usdText(definition.maximumKeeperRewardMinor / 1_000_000)} USDC`} />
          <Term label="Initiator" value="Private" title="Only the initiator account commitment is public." />
        </dl>
        {record.result ? (
          <div className="mx-3 mb-3 rounded-md border border-line bg-inset px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-faint">Allocation commitment</span>
              <ProvenanceChip value="MODELED" title="Recomputed with the contract's allocation and result hash formulas over the modeled bids." />
            </div>
            <p className="tnum mt-1 truncate font-mono text-[11px] text-dim" title={record.result.allocationsHash}>
              {middleTruncate(record.result.allocationsHash, 14, 8)}
            </p>
            <p className="mt-1 text-[11px] leading-snug text-faint">
              Recomputed with the contract&apos;s allocation hash, so the same bids always reproduce the same result.
            </p>
          </div>
        ) : null}
      </div>
      <div className="shrink-0 border-t border-line bg-panel px-3 py-2.5 text-[11px] leading-snug text-faint">
        Read-only board. Committing and revealing bids needs the auction gateway, which this build does not include.
      </div>
    </div>
  );
}
