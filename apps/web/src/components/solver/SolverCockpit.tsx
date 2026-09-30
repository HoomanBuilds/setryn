"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Route } from "lucide-react";
import { useGatewaySnapshot } from "@/components/gateway/InternalGatewayProvider";
import { usePreviewBoard } from "@/components/terminal/PreviewMarketProvider";
import { BUTTON_INK, BUTTON_QUIET, Chip, useNow, useWalletPrompt } from "@/components/activity/ledger-ui";
import { Chip as DeskChip, Meter, Metric, Panel, PanelHead, deskMotion } from "@/components/strategies/desk/Desk";
import { ProvenanceChip, clockText, countdownText, priceText, usd } from "@/components/auctions/board-kit";
import { auctionBoard } from "@/lib/auctions/schedule";
import {
  capacityLedger,
  recoveryCases,
  solverOpportunities,
  solverPerformance,
  solverWindow,
} from "@/lib/solver/model";
import { OWN_SOLVER_ID, participant } from "@/lib/solver/roster";
import type { Eligibility, OwnBidState, SolverOpportunity } from "@/lib/solver/types";
import { formatLots } from "@/lib/terminal/format";
import { packageLabel } from "@/lib/terminal/markets";
import type { PackageMarket } from "@/lib/terminal/types";
import { CapacityPanel, PerformancePanel, RecoveryPanel, RoutePlanPanel } from "./SolverPanels";

const WINDOW_SECONDS = 3_600;

const SOURCE_COPY: Record<SolverOpportunity["source"], string> = {
  SEALED_AUCTION: "Sealed",
  BATCH_ROUND: "Batch",
  PRIVATE_RFQ: "RFQ",
};

const OWN_STATE_COPY: Record<OwnBidState, { label: string; className: string }> = {
  NOT_COMMITTED: { label: "Not committed", className: "text-dim" },
  COMMITTED: { label: "Committed", className: "text-ink" },
  REVEAL_DUE: { label: "Reveal due", className: "text-brand" },
  REVEALED: { label: "Revealed", className: "text-ink" },
  SCHEDULED: { label: "Opens later", className: "text-faint" },
  QUOTE_IN_MAKER_DESK: { label: "Quote in maker desk", className: "text-dim" },
};

const ELIGIBILITY_COPY: Record<Eligibility, { label: string; tone: "up" | "neutral" | "muted" | "down" | "brand" }> = {
  ELIGIBLE: { label: "Eligible", tone: "neutral" },
  SIZE_CAPPED: { label: "Size capped", tone: "brand" },
  DEPTH_SHORT: { label: "Depth short", tone: "muted" },
  CAPACITY_LIMITED: { label: "Capacity limited", tone: "down" },
  BLOCKED: { label: "Blocked", tone: "down" },
};

const GRID =
  "grid grid-cols-[132px_minmax(200px,1.5fr)_84px_104px_60px_120px_92px_104px_84px_112px] items-center gap-3";

function secondsLeft(opportunity: SolverOpportunity, epoch: number, nowMs: number): number {
  return opportunity.clock === "PREVIEW" ? opportunity.deadline - epoch : opportunity.deadline - nowMs / 1000;
}

function solverSide(opportunity: SolverOpportunity): { label: string; className: string } {
  return opportunity.initiatorSide === "BUY"
    ? { label: `Sell ${formatLots(opportunity.lots)}`, className: "text-down" }
    : { label: `Buy ${formatLots(opportunity.lots)}`, className: "text-up" };
}

function OpportunityRow({
  opportunity,
  market,
  epoch,
  nowMs,
  selected,
  onSelect,
  index,
}: {
  opportunity: SolverOpportunity;
  market: PackageMarket | null;
  epoch: number;
  nowMs: number;
  selected: boolean;
  onSelect: () => void;
  index: number;
}) {
  const side = solverSide(opportunity);
  const own = OWN_STATE_COPY[opportunity.ownState];
  const eligibility = ELIGIBILITY_COPY[opportunity.eligibility];
  const left = secondsLeft(opportunity, epoch, nowMs);
  return (
    <li style={{ ["--i" as string]: index }} className={deskMotion.rise}>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={`focus-ring ${GRID} w-full border-b border-line px-3 py-2 text-left transition-colors duration-150 ${
          selected ? "bg-raised/70 shadow-[inset_2px_0_0_var(--color-brand)]" : "hover:bg-raised/40"
        }`}
      >
        <span className="flex items-center gap-1.5">
          <span className="w-11 text-xs text-ink">{SOURCE_COPY[opportunity.source]}</span>
          <ProvenanceChip value={opportunity.provenance} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-xs text-ink">{market ? packageLabel(market) : opportunity.marketId}</span>
          <span className="tnum block truncate font-mono text-[11px] text-faint">{opportunity.label}</span>
        </span>
        <span className={`tnum font-mono text-xs ${side.className}`}>{side.label}</span>
        <span className="min-w-0">
          <span className={`tnum block font-mono text-xs ${left <= 30 ? "text-down" : "text-ink"}`}>{countdownText(left)}</span>
          <span className="block truncate text-[10px] text-faint">{opportunity.deadlineLabel}</span>
        </span>
        <span className="tnum text-right font-mono text-xs text-dim">{opportunity.bidders}</span>
        <span className={`truncate text-xs ${own.className}`}>{own.label}</span>
        <span className="tnum text-right font-mono text-xs text-ink">
          {market && opportunity.plan.breakEven !== null ? priceText(opportunity.plan.breakEven, market) : "—"}
        </span>
        <span
          className={`tnum text-right font-mono text-xs ${
            opportunity.edgeUsd === null ? "text-faint" : opportunity.edgeUsd >= 0 ? "text-up" : "text-down"
          }`}
        >
          {opportunity.edgeUsd === null ? "depth short" : usd(opportunity.edgeUsd, true)}
        </span>
        <span className="tnum text-right font-mono text-xs text-dim">{usd(opportunity.capacityRequiredUsd)}</span>
        <span className="flex justify-end" title={opportunity.eligibilityNote}>
          <Chip tone={eligibility.tone}>{eligibility.label}</Chip>
        </span>
      </button>
    </li>
  );
}

function OpportunityCard({
  opportunity,
  market,
  epoch,
  nowMs,
  onSelect,
}: {
  opportunity: SolverOpportunity;
  market: PackageMarket | null;
  epoch: number;
  nowMs: number;
  onSelect: () => void;
}) {
  const side = solverSide(opportunity);
  const eligibility = ELIGIBILITY_COPY[opportunity.eligibility];
  return (
    <li className="border-b border-line last:border-b-0">
      <button type="button" onClick={onSelect} className="focus-ring flex w-full flex-col gap-1.5 px-3 py-3 text-left hover:bg-raised/40">
        <span className="flex items-center justify-between gap-2">
          <span className="min-w-0">
            <span className="block truncate text-[13px] text-ink">{market ? packageLabel(market) : opportunity.marketId}</span>
            <span className="block truncate text-[11px] text-faint">{`${SOURCE_COPY[opportunity.source]} · ${opportunity.label}`}</span>
          </span>
          <Chip tone={eligibility.tone}>{eligibility.label}</Chip>
        </span>
        <span className="tnum flex items-center justify-between gap-2 font-mono text-[11px]">
          <span className={side.className}>{side.label}</span>
          <span className="text-dim">{`${opportunity.deadlineLabel} ${countdownText(secondsLeft(opportunity, epoch, nowMs))}`}</span>
          <span className={opportunity.edgeUsd === null ? "text-faint" : opportunity.edgeUsd >= 0 ? "text-up" : "text-down"}>
            {opportunity.edgeUsd === null ? "depth short" : usd(opportunity.edgeUsd, true)}
          </span>
        </span>
      </button>
    </li>
  );
}

function RfqFooter({ observed }: { observed: number }) {
  const wallet = useWalletPrompt();
  if (!wallet.connected) {
    return (
      <div className="flex flex-col gap-2 border-t border-line px-3 py-2.5 text-[11px] text-faint sm:flex-row sm:items-center sm:justify-between">
        <span>Private requests from the local chain appear here once a wallet is connected.</span>
        <span className="flex items-center gap-2">
          {wallet.error ? <span className="text-down">{wallet.error}</span> : null}
          <button type="button" onClick={wallet.connect} disabled={wallet.connecting} className={`${BUTTON_INK} h-7`}>
            {wallet.connecting ? "Connecting..." : "Connect wallet"}
          </button>
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-2 text-[11px] text-faint">
      <span>
        {observed > 0
          ? `${observed} open private request${observed === 1 ? "" : "s"} observed on the local chain.`
          : "No open private requests on the local chain."}
      </span>
      <Link href="/maker" className="inline-flex items-center gap-1 text-dim hover:text-ink">
        Maker desk
        <ArrowUpRight size={11} aria-hidden="true" />
      </Link>
    </div>
  );
}

export function SolverCockpit() {
  const { markets, previewEpochSeconds: epoch } = usePreviewBoard();
  const snapshot = useGatewaySnapshot();
  const nowMs = useNow();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const board = useMemo(() => auctionBoard(epoch, 900), [epoch]);
  const records = useMemo(() => solverWindow(board, epoch, WINDOW_SECONDS), [board, epoch]);
  const ledger = useMemo(() => capacityLedger(records, markets, epoch), [records, markets, epoch]);
  const available = ledger.buckets.find((bucket) => bucket.id === "AVAILABLE")?.amountUsd ?? 0;
  const opportunities = useMemo(
    () =>
      solverOpportunities({
        board,
        markets,
        epoch,
        rfqRequests: snapshot.rfqRequests,
        nowMs,
        availableUsd: available,
      }),
    [available, board, epoch, markets, nowMs, snapshot.rfqRequests],
  );
  const performance = useMemo(() => solverPerformance(records, markets, WINDOW_SECONDS), [records, markets]);
  const cases = useMemo(() => recoveryCases(records, epoch), [records, epoch]);

  const selected = opportunities.find((entry) => entry.id === selectedId) ?? opportunities[0] ?? null;
  const selectedMarket = selected ? (markets.find((market) => market.id === selected.marketId) ?? null) : null;
  const self = participant(OWN_SOLVER_ID);
  const committed = opportunities.filter((entry) => entry.ownState === "COMMITTED" || entry.ownState === "REVEALED").length;
  const revealDue = opportunities.filter((entry) => entry.ownState === "REVEAL_DUE").length;
  const reserved = ledger.buckets
    .filter((bucket) => bucket.id === "BOND_LOCKS" || bucket.id === "ROUTE_RESERVATIONS")
    .reduce((sum, bucket) => sum + bucket.amountUsd, 0);
  const openCases = cases.filter((entry) => entry.state !== "RESOLVED");
  const actionable = cases.filter((entry) => entry.state === "ACTIONABLE").length;
  const observedRfqs = opportunities.filter((entry) => entry.source === "PRIVATE_RFQ").length;

  return (
    <main className="scroll-thin flex min-h-0 min-w-0 flex-1 flex-col gap-1 overflow-y-auto bg-app p-1" aria-label="Setryn solver desk">
      <header className={`${deskMotion.rise} shrink-0 rounded-lg border border-line bg-panel`}>
        <div className="flex flex-col gap-2 px-3 py-2.5 lg:flex-row lg:items-center lg:gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <Route size={16} aria-hidden="true" className="shrink-0 text-faint" />
            <h1 className="shrink-0 font-serif text-[22px] leading-7 text-ink">Solver desk</h1>
            <span className="hidden truncate text-xs text-faint sm:inline">
              {`${OWN_SOLVER_ID} / ${self?.note ?? "bonded solver"}`}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <ProvenanceChip
              value="MODELED"
              title="Auction opportunities, reservations and performance come from the modeled auction schedule. Routes use the shared preview feed. Private requests are read from the local chain."
            />
            <DeskChip title="Solver actions are read-only in this build">Read only</DeskChip>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs lg:ml-auto">
            <span className="tnum font-mono text-[11px] text-dim">
              <span className="font-sans text-faint">Preview clock </span>
              {`${clockText(epoch)} UTC`}
            </span>
            <Link href="/auctions" className={`${BUTTON_QUIET} h-7`}>
              Auction board
              <ArrowUpRight size={12} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </header>

      <section
        aria-label="Solver metrics"
        className={`${deskMotion.rise} grid shrink-0 grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-4 xl:grid-cols-8`}
        style={{ ["--rise-delay" as string]: "30ms" }}
      >
        <Metric className="bg-panel" label="Open opportunities" value={opportunities.length} note={`${observedRfqs} private RFQ observed`} />
        <Metric
          className="bg-panel"
          label="Committed now"
          value={committed}
          tone={revealDue > 0 ? "brand" : "neutral"}
          note={revealDue > 0 ? `${revealDue} reveal due` : "no reveals due"}
        />
        <Metric className="bg-panel" label="Available capacity" value={`$${usd(available)}`} tone="up" note={`of $${usd(ledger.totalUsd)} bonded`}>
          <Meter value={available / Math.max(1, ledger.totalUsd)} tone="up" label="Available share of bonded capital" />
        </Metric>
        <Metric className="bg-panel" label="Reserved" value={`$${usd(reserved)}`} note="Bonds and route reservations" />
        <Metric className="bg-panel" label="Win rate" value={`${Math.round(performance.winRate * 100)}%`} note={`${performance.wins} of ${performance.revealed} revealed`} />
        <Metric className="bg-panel" label="Fill rate" value={`${Math.round(performance.fillRate * 100)}%`} note="Allocated over bid lots" />
        <Metric
          className="bg-panel"
          label="Edge captured"
          value={`${usd(performance.edgeUsd, true)}`}
          tone={performance.edgeUsd >= 0 ? "up" : "down"}
          note="USDC vs mark at open, 60 min"
        />
        <Metric
          className="bg-panel"
          label="Recovery"
          value={openCases.length}
          tone={actionable > 0 ? "brand" : "neutral"}
          note={actionable > 0 ? `${actionable} callable now` : "nothing callable"}
        />
      </section>

      <div className="grid min-w-0 gap-1 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-1">
          <Panel label="Opportunities" delay={20}>
            <PanelHead
              title="Opportunities"
              tools={<span className="hidden text-[11px] text-faint sm:inline">Open auctions, batch rounds and private requests, soonest first</span>}
            />
            <div className="scroll-thin hidden overflow-x-auto lg:block">
              <div className="min-w-[1080px]">
                <div className={`${GRID} border-b border-line px-3 py-1.5 text-[11px] text-faint`}>
                  <span>Source</span>
                  <span>Opportunity</span>
                  <span>You</span>
                  <span>Closes</span>
                  <span className="text-right">Bidders</span>
                  <span>Your bid</span>
                  <span className="text-right">Break-even</span>
                  <span className="text-right" title="Touch minus break-even for the full size, USDC">Room vs screen</span>
                  <span className="text-right">Capacity</span>
                  <span className="text-right">Eligibility</span>
                </div>
                <ul>
                  {opportunities.map((opportunity, index) => (
                    <OpportunityRow
                      key={opportunity.id}
                      opportunity={opportunity}
                      market={markets.find((market) => market.id === opportunity.marketId) ?? null}
                      epoch={epoch}
                      nowMs={nowMs}
                      selected={selected?.id === opportunity.id}
                      onSelect={() => setSelectedId(opportunity.id)}
                      index={index}
                    />
                  ))}
                </ul>
              </div>
            </div>
            <ul className="lg:hidden">
              {opportunities.map((opportunity) => (
                <OpportunityCard
                  key={opportunity.id}
                  opportunity={opportunity}
                  market={markets.find((market) => market.id === opportunity.marketId) ?? null}
                  epoch={epoch}
                  nowMs={nowMs}
                  onSelect={() => setSelectedId(opportunity.id)}
                />
              ))}
            </ul>
            {opportunities.length === 0 ? (
              <p className="px-3 py-8 text-center text-xs text-faint">No open auctions or requests right now.</p>
            ) : null}
            <RfqFooter observed={observedRfqs} />
          </Panel>

          <RoutePlanPanel opportunity={selected} liveMarket={selectedMarket} />
          <PerformancePanel performance={performance} />
        </div>

        <aside className="flex min-w-0 flex-col gap-1">
          <CapacityPanel ledger={ledger} epoch={epoch} />
          <RecoveryPanel cases={cases} epoch={epoch} />
        </aside>
      </div>
    </main>
  );
}
