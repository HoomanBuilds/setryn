"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { useGatewaySnapshot } from "@/components/gateway/InternalGatewayProvider";
import { useChainNow, useMarketBoard } from "@/components/market-data/MarketDataProvider";
import { MarketMark } from "@/components/portfolio/MarketMark";
import { Chip, LiveDot, Panel, PanelHead, Row, deskMotion } from "@/components/strategies/desk/Desk";
import { hedgePrefillFromQuery, type HedgePrefill } from "@/lib/exposures/records";
import {
  handoffFor,
  horizonDays,
  portfolioExposures,
  rankCandidates,
  referenceAssetById,
  scenarioFor,
  stableExposureId,
  validateExposure,
} from "@/lib/hedges/engine";
import type { ExposureInput, HedgeDirection, PortfolioExposure, RiskObjective } from "@/lib/hedges/types";
import { networkLabel } from "@/lib/operations/deployment";
import { formatNumber } from "@/lib/terminal/format";
import { tradeHref } from "@/lib/terminal/markets";
import { CandidateTable } from "./CandidateTable";
import { CashflowTimeline } from "./CashflowTimeline";
import { ExposureForm } from "./ExposureForm";
import { HandoffBar } from "./HandoffBar";
import { HedgePayoff, hedgeCurves } from "./HedgePayoff";
import { HedgeSummary } from "./HedgeSummary";
import { ImpactScenario } from "./ImpactScenario";

/** Reads an exposure handed off from /exposures or /protect/new and remounts the builder with it. */
export function HedgeWorkspaceFromQuery() {
  const searchParams = useSearchParams();
  const prefill = useMemo(() => hedgePrefillFromQuery(searchParams), [searchParams]);
  return <HedgeWorkspace key={searchParams.toString()} prefill={prefill} />;
}

function isoDate(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

function PortfolioPanel({
  exposures,
  connected,
  onUse,
}: {
  exposures: PortfolioExposure[];
  connected: boolean;
  onUse: (exposure: PortfolioExposure) => void;
}) {
  return (
    <Panel label="Your positions' exposure" delay={60}>
      <PanelHead title="Positions exposure" tools={<Chip tone="up">Live</Chip>} />
      {!connected ? (
        <p className="px-3 py-5 text-xs leading-snug text-faint">Connect a wallet to size hedges from the positions it holds.</p>
      ) : exposures.length === 0 ? (
        <p className="px-3 py-5 text-xs leading-snug text-faint">No open positions, so there is no position delta to offset.</p>
      ) : (
        <ul className="divide-y divide-line-soft">
          {exposures.map((exposure) => {
            const unit = exposure.underlying.split("/")[0];
            return (
              <li key={exposure.underlying} className={`${deskMotion.fade} px-3 py-2.5`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <MarketMark underlying={exposure.underlying} size={15} />
                    <span className="text-xs text-ink">{exposure.underlying}</span>
                    <span className="text-[11px] text-faint">{`${exposure.positions} positions`}</span>
                  </span>
                  <span className={`tnum font-mono text-xs ${exposure.delta > 0 ? "text-up" : exposure.delta < 0 ? "text-down" : "text-dim"}`}>
                    {`${exposure.delta > 0 ? "+" : ""}${formatNumber(exposure.delta, Math.abs(exposure.delta) < 10 ? 3 : 1)} ${unit}`}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2 text-[11px]">
                  <span className="text-faint">
                    {exposure.deltaUsd !== null ? `${formatNumber(Math.abs(exposure.deltaUsd), 0)} USDC at the reference` : "No reference read"}
                    {exposure.outsideRange > 0 ? ` / ${exposure.outsideRange} outside range` : ""}
                  </span>
                  {exposure.offset ? (
                    <span className="tnum font-mono text-dim">{`${exposure.offset.direction === "SHORT" ? "Sell" : "Buy"} ${exposure.offset.lots} ${exposure.offset.market.id}`}</span>
                  ) : null}
                </div>
                {exposure.offset && exposure.referenceAssetId ? (
                  <div className="mt-2 flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onUse(exposure)}
                      className="focus-ring inline-flex h-7 items-center rounded-md border border-line px-2 text-[11px] text-dim transition-colors hover:border-line-strong hover:text-ink"
                    >
                      Size a hedge
                    </button>
                    <Link
                      href={`${tradeHref(exposure.offset.market)}?${new URLSearchParams({
                        source: "hedges",
                        direction: exposure.offset.direction.toLowerCase(),
                        lots: String(exposure.offset.lots),
                      }).toString()}`}
                      className="focus-ring inline-flex h-7 items-center gap-1 rounded-md border border-line px-2 text-[11px] text-dim transition-colors hover:border-line-strong hover:text-ink"
                    >
                      Offset in trade
                      <ArrowUpRight size={11} aria-hidden="true" />
                    </Link>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <p className="border-t border-line px-3 py-2 text-[11px] leading-snug text-faint">
        Delta is lots x lot size for each position whose range contains the live reference; outside its range a position
        has none.
      </p>
    </Panel>
  );
}

export function HedgeWorkspace({ prefill = null }: { prefill?: HedgePrefill | null }) {
  const nowSeconds = useChainNow();
  const nowMs = nowSeconds * 1000;
  const initial = prefill?.input;
  const [direction, setDirection] = useState<HedgeDirection>(initial?.direction ?? "RECEIVABLE");
  const [referenceAssetId, setReferenceAssetId] = useState(initial?.referenceAssetId ?? "EUR");
  const [settlementAssetId, setSettlementAssetId] = useState(initial?.settlementAssetId ?? "USDC");
  const [amountInput, setAmountInput] = useState(initial ? String(initial.amount) : "250000");
  const [exposureDateIso, setExposureDateIso] = useState(initial?.exposureDateIso ?? isoDate(nowSeconds + 90 * 86_400));
  const [riskObjective, setRiskObjective] = useState<RiskObjective>(initial?.riskObjective ?? "LOCK_RATE");
  const [selectedMarketId, setSelectedMarketId] = useState<string | null>(null);
  const [scenarioMove, setScenarioMove] = useState(-10);
  const board = useMarketBoard();
  const snapshot = useGatewaySnapshot();
  const connected = snapshot.wallet.status === "CONNECTED";

  const exposure: ExposureInput = useMemo(
    () => ({ direction, referenceAssetId, settlementAssetId, amount: Number(amountInput), exposureDateIso, riskObjective }),
    [direction, referenceAssetId, settlementAssetId, amountInput, exposureDateIso, riskObjective],
  );

  const validation = useMemo(() => validateExposure(exposure, nowMs), [exposure, nowMs]);
  // Prices and references come from the market-data feed so they match the terminal book.
  const candidates = useMemo(() => rankCandidates(exposure, board.markets, 3, nowMs), [exposure, board.markets, nowMs]);
  const candidate = candidates.find((entry) => entry.market.id === selectedMarketId) ?? candidates[0] ?? null;
  const horizon = useMemo(() => horizonDays(exposure.exposureDateIso, nowMs), [exposure.exposureDateIso, nowMs]);
  const rows = useMemo(() => (candidate && validation.valid ? scenarioFor(candidate, exposure) : []), [candidate, exposure, validation.valid]);
  const curves = useMemo(() => (candidate && validation.valid ? hedgeCurves(candidate, exposure) : null), [candidate, exposure, validation.valid]);
  const handoff = useMemo(() => (candidate ? handoffFor(candidate, exposure, validation) : null), [candidate, exposure, validation]);
  const exposureId = useMemo(() => (validation.valid ? stableExposureId(exposure) : "-"), [exposure, validation.valid]);
  const portfolio = useMemo(() => portfolioExposures(snapshot.positions, board.markets, nowMs), [board.markets, nowMs, snapshot.positions]);
  const referenceLabel = referenceAssetById(referenceAssetId)?.label ?? referenceAssetId;
  const move = curves ? Math.min(curves.moveMax, Math.max(curves.moveMin, scenarioMove)) : scenarioMove;
  const network = networkLabel(board.snapshot?.chainId ?? null, board.snapshot?.network ?? null);
  const feedAge = board.asOf > 0 ? Math.max(0, nowSeconds - board.asOf) : null;

  const applyExposure = (entry: PortfolioExposure) => {
    if (!entry.referenceAssetId || entry.deltaUsd === null || entry.delta === 0) return;
    // Holding the asset (long delta) hedges like a receivable; a short delta like a payable.
    setDirection(entry.delta > 0 ? "RECEIVABLE" : "PAYABLE");
    setReferenceAssetId(entry.referenceAssetId);
    setAmountInput(String(Math.round(Math.abs(entry.deltaUsd))));
    if (entry.nearestExpiryAt !== null) setExposureDateIso(isoDate(entry.nearestExpiryAt));
    if (entry.offset) setSelectedMarketId(entry.offset.market.id);
  };

  return (
    <main className="scroll-thin flex min-h-0 min-w-0 flex-1 flex-col gap-1 overflow-y-auto bg-app p-1 xl:overflow-hidden">
      <header className={`${deskMotion.rise} shrink-0 rounded-lg border border-line bg-panel`}>
        <div className="flex flex-col gap-2 px-3 py-2 lg:flex-row lg:items-center lg:gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <h1 className="shrink-0 font-serif text-[22px] leading-7 text-ink">Hedge builder</h1>
            <span className="tnum truncate font-mono text-xs text-dim">{exposureId}</span>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <Chip tone="dim">{network}</Chip>
            <Chip title="Sizing uses the live Chainlink reference; prices use the resting book">Listed range forwards</Chip>
          </div>
          <div className="flex items-center gap-4 text-[11px] text-faint lg:ml-auto">
            <span className="flex items-center gap-1.5">
              <LiveDot tone={board.status === "LIVE" ? "up" : board.status === "LOADING" ? "dim" : "down"} live={board.status === "LIVE"} />
              {feedAge !== null ? `Feed ${feedAge}s` : "Feed loading"}
            </span>
            <span className="tnum font-mono">{`Today ${isoDate(nowSeconds)}`}</span>
          </div>
        </div>
      </header>

      <div className="flex min-w-0 flex-col gap-1 xl:grid xl:min-h-0 xl:flex-1 xl:grid-cols-[296px_minmax(0,1fr)_340px]">
        <aside className="scroll-thin flex min-w-0 flex-col gap-1 xl:min-h-0 xl:overflow-y-auto">
          <ExposureForm
            exposure={exposure}
            amountInput={amountInput}
            validation={validation}
            horizonDays={horizon}
            onDirection={setDirection}
            onReference={setReferenceAssetId}
            onSettlement={setSettlementAssetId}
            onAmount={setAmountInput}
            onDate={setExposureDateIso}
            onObjective={setRiskObjective}
          />
          <PortfolioPanel exposures={portfolio} connected={connected} onUse={applyExposure} />
          <Panel label="Sources" delay={80}>
            <PanelHead title="Sources" />
            <div className="px-3 py-1.5">
              <Row label="Reference" value={candidate?.reference != null ? formatNumber(candidate.reference, candidate.reference < 10 ? 5 : 2) : "-"} tone="dim" />
              <Row label="Reference feed" value={candidate ? candidate.market.referencePair : "-"} tone="dim" className="border-t border-line-soft" />
              <Row label="Hedge price" value={candidate ? (candidate.forwardSource === "TOUCH" ? "Resting book" : candidate.forwardSource === "MARK" ? "Mark, no resting order" : "No price") : "-"} tone="dim" className="border-t border-line-soft" />
              <Row label="Feed block" value={board.snapshot ? board.snapshot.blockNumber.toLocaleString("en-US") : "-"} tone="dim" className="border-t border-line-soft" />
            </div>
          </Panel>
        </aside>

        <section className="scroll-thin flex min-w-0 flex-col gap-1 xl:min-h-0 xl:overflow-y-auto" aria-label="Hedge analysis">
          <HedgePayoff candidate={validation.valid ? candidate : null} exposure={exposure} curves={curves} move={move} onMove={setScenarioMove} referenceLabel={referenceLabel} />
          <CashflowTimeline exposure={exposure} candidate={candidate} horizonDays={horizon} nowSeconds={nowSeconds} />
          <CandidateTable candidates={candidates} selectedId={candidate?.market.id ?? null} onSelect={setSelectedMarketId} />
        </section>

        <aside className="scroll-thin flex min-w-0 flex-col gap-1 xl:min-h-0 xl:overflow-y-auto">
          <HedgeSummary candidate={validation.valid ? candidate : null} curves={curves} />
          <ImpactScenario candidate={validation.valid ? candidate : null} rows={rows} activeMove={move} onSelectMove={setScenarioMove} />
          <HandoffBar candidate={candidate} validation={validation} handoff={handoff} />
        </aside>
      </div>
    </main>
  );
}
