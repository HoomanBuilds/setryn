"use client";

import { Suspense, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronDown, CornerDownRight } from "lucide-react";
import { useChainNow, useMarketBoard } from "@/components/market-data/MarketDataProvider";
import { Segmented } from "@/components/terminal/primitives";
import { Chip, Flash, LiveDot, deskMotion } from "@/components/strategies/desk/Desk";
import { LegsPanel } from "@/components/strategies/LegsPanel";
import { LibraryPanel } from "@/components/strategies/LibraryPanel";
import { PayoffPanel } from "@/components/strategies/PayoffPanel";
import { SummaryColumn } from "@/components/strategies/SummaryColumn";
import { payoffSummary } from "@/components/strategies/studio-model";
import {
  compilePackageDraft,
  draftFromMarket,
  instrumentCatalog,
  marketTemplates,
} from "@/lib/strategies/catalog";
import { parseStudioHandoff, type StudioHandoffContext } from "@/lib/strategies/handoff";
import { MARK_SOURCE_LABEL, impliedCarryPct } from "@/lib/strategies/range";
import { networkLabel } from "@/lib/operations/deployment";
import type { DraftLeg, PackageDraft, StrategyBuildMode } from "@/lib/strategies/types";
import {
  daysToExpiry,
  formatExpiry,
  formatLots,
  formatNumber,
  priceUnitSuffix,
} from "@/lib/terminal/format";
import { findMarket, MARKETS, packageLabel, tradeHref } from "@/lib/terminal/markets";
import type { PackageMarket } from "@/lib/terminal/types";
import { MarketMark } from "@/components/portfolio/MarketMark";

const MODES: { value: StrategyBuildMode; label: string }[] = [
  { value: "TEMPLATE", label: "Template" },
  { value: "GRAPH", label: "Graph" },
];

const INITIAL_MARKET = MARKETS[0];

function initialDraft(): PackageDraft {
  return {
    mode: "TEMPLATE",
    marketId: INITIAL_MARKET.id,
    direction: "LONG",
    lots: 10,
    legs: draftFromMarket(INITIAL_MARKET),
  };
}

function draftForHandoff(handoff: StudioHandoffContext): PackageDraft | null {
  if (!handoff.valid) return null;
  if (handoff.marketId === null || handoff.direction === null || handoff.lots === null) return null;
  const market = MARKETS.find((candidate) => candidate.id === handoff.marketId);
  if (!market) return null;
  return {
    mode: "TEMPLATE",
    marketId: market.id,
    direction: handoff.direction,
    lots: handoff.lots,
    legs: draftFromMarket(market),
  };
}

function nextLegId(legs: DraftLeg[]): string {
  return `draft-leg-${legs.length + 1}-${Date.now().toString(36)}`;
}

function packageHref(market: PackageMarket, draft: PackageDraft, canonicalId: string): string {
  const params = new URLSearchParams({
    studio: draft.mode.toLowerCase(),
    draft: canonicalId,
    direction: draft.direction.toLowerCase(),
    lots: String(draft.lots),
  });
  return `${tradeHref(market)}?${params.toString()}`;
}

function HandoffContextBar({ handoff }: { handoff: StudioHandoffContext }) {
  const summary = [
    handoff.marketId,
    handoff.direction ? handoff.direction.toLowerCase() : null,
    handoff.lots !== null ? `${String(handoff.lots)} lots` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" / ");
  const refs = [handoff.exposureId, handoff.lifecycleId, handoff.intent].filter(
    (part): part is string => part !== null,
  );
  return (
    <div
      className={`${deskMotion.slideDown} flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-brand-edge/40 bg-brand-soft/40 px-3 py-2 text-xs`}
    >
      <CornerDownRight size={13} aria-hidden="true" className="shrink-0 text-brand" />
      <Chip tone="brand">{handoff.sourceLabel ? `Handoff / ${handoff.sourceLabel}` : "Handoff"}</Chip>
      <span className="tnum font-mono text-ink">{summary}</span>
      {refs.length > 0 ? <span className="tnum truncate font-mono text-faint">{refs.join(" / ")}</span> : null}
      <span className="w-full text-[11px] leading-snug text-faint lg:ml-auto lg:w-auto">
        Read-only handoff context. No order is created here; the trade terminal prices and signs it.
      </span>
    </div>
  );
}

/** The strategy view of a forward level against the live reference, by the market's display kind. */
function strategyView(market: PackageMarket, nowSeconds: number): { label: string; value: string } | null {
  const forward = market.netPrice;
  const spot = market.referencePrice;
  if (!Number.isFinite(forward) || !Number.isFinite(spot) || spot <= 0) return null;
  if (market.strategyKind === "DELIVERABLE_FORWARD") {
    return { label: "Forward points", value: formatNumber((forward - spot) * 10_000, 1) };
  }
  if (market.strategyKind === "DATED_BASIS") {
    return { label: "Basis to spot", value: formatNumber(forward - spot, Math.max(2, market.priceDecimals)) };
  }
  const days = Number.isFinite(market.expiryAt) ? (market.expiryAt - nowSeconds) / 86_400 : null;
  const carry = impliedCarryPct(forward, spot, days);
  return carry === null ? null : { label: market.strategyKind === "FUNDING_CARRY" ? "Implied funding" : "Implied carry", value: `${formatNumber(carry, 2)}% ann.` };
}

function HeaderStat({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`flex shrink-0 flex-col justify-center ${className}`}>
      <span className="text-[11px] leading-4 text-faint">{label}</span>
      <span className="tnum font-mono text-[13px] leading-5 text-ink">{children}</span>
    </div>
  );
}

export function StrategyStudio() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center bg-app text-xs text-faint">
          Loading strategy studio
        </div>
      }
    >
      <StudioContent />
    </Suspense>
  );
}

function StudioContent() {
  const searchParams = useSearchParams();
  const handoff = useMemo(() => parseStudioHandoff(searchParams), [searchParams]);
  const [draft, setDraft] = useState<PackageDraft>(() => draftForHandoff(handoff) ?? initialDraft());
  const [appliedHandoffKey, setAppliedHandoffKey] = useState(handoff.key);
  if (appliedHandoffKey !== handoff.key) {
    setAppliedHandoffKey(handoff.key);
    setDraft(draftForHandoff(handoff) ?? initialDraft());
  }
  const board = useMarketBoard();
  const nowSeconds = useChainNow();
  const catalog = useMemo(() => instrumentCatalog(), []);
  const catalogById = useMemo(() => new Map(catalog.map((instrument) => [instrument.id, instrument])), [catalog]);
  const [instrumentChoice, setSelectedInstrument] = useState("");
  const [scenarioMove, setScenarioMove] = useState(0);
  // Economics compile against the market-data feed so prices match the terminal.
  const compiled = useMemo(() => compilePackageDraft(draft, board.markets), [draft, board.markets]);
  const liveTemplates = useMemo(() => marketTemplates(board.markets), [board.markets]);
  const availableInstruments = useMemo(
    () =>
      catalog.filter(
        (instrument) =>
          instrument.settlementClass === compiled.market.settlementClass &&
          !draft.legs.some((leg) => leg.instrumentId === instrument.id),
      ),
    [catalog, compiled.market.settlementClass, draft.legs],
  );

  // The choice falls back to the first instrument that still fits the draft, derived rather than synced.
  const selectedInstrument = availableInstruments.some((instrument) => instrument.id === instrumentChoice)
    ? instrumentChoice
    : (availableInstruments[0]?.id ?? "");

  const chooseMarket = (marketId: string) => {
    const market = findMarket(marketId);
    setDraft((current) =>
      current.mode === "TEMPLATE"
        ? { ...current, marketId: market.id, legs: draftFromMarket(market) }
        : { ...current, marketId: market.id },
    );
  };

  const chooseMode = (mode: StrategyBuildMode) => {
    setDraft((current) => ({ ...current, mode }));
  };

  const updateLeg = (id: string, patch: Partial<Pick<DraftLeg, "side" | "ratio">>) => {
    setDraft((current) => ({
      ...current,
      legs: current.legs.map((leg) => (leg.id === id ? { ...leg, ...patch } : leg)),
    }));
  };

  const removeLeg = (id: string) => {
    setDraft((current) => ({ ...current, legs: current.legs.filter((leg) => leg.id !== id) }));
  };

  const addLeg = () => {
    if (!selectedInstrument || draft.legs.length >= 6) return;
    setDraft((current) => ({
      ...current,
      legs: [...current.legs, { id: nextLegId(current.legs), instrumentId: selectedInstrument, side: "BUY", ratio: 1 }],
    }));
  };

  const selectedMarket = compiled.market;
  const liveById = (id: string) => board.markets.find((market) => market.id === id) ?? findMarket(id);
  const liveSelected = liveById(selectedMarket.id);
  const primaryMarket = compiled.executableMarketId ? liveById(compiled.executableMarketId) : liveSelected;
  const allInPrice =
    (draft.direction === "LONG" ? primaryMarket.bestAsk : primaryMarket.bestBid) * compiled.graphScale;
  const canOpen = compiled.validation.length === 0;
  const primaryHref = packageHref(primaryMarket, draft, compiled.canonicalId);
  const route = compiled.executable
    ? (primaryMarket.routes.find((candidate) => candidate.guarantee === compiled.guarantee) ??
      primaryMarket.routes[0])
    : undefined;

  const summary = useMemo(
    () => payoffSummary(selectedMarket, draft.lots, compiled.graphScale, draft.direction),
    [selectedMarket, draft.lots, compiled.graphScale, draft.direction],
  );
  const move = Math.min(summary.moveMax, Math.max(summary.moveMin, scenarioMove));
  const unit = priceUnitSuffix(liveSelected.priceUnit);
  const spread = liveSelected.bestAsk - liveSelected.bestBid;
  const view = strategyView(liveSelected, nowSeconds);
  const network = networkLabel(board.snapshot?.chainId ?? null, board.snapshot?.network ?? null);

  return (
    <main className="scroll-thin flex min-h-0 min-w-0 flex-1 flex-col gap-1 overflow-y-auto bg-app p-1 xl:overflow-hidden">
      <header className={`${deskMotion.rise} shrink-0 rounded-lg border border-line bg-panel`}>
        <div className="flex flex-col gap-2 px-3 py-2 lg:flex-row lg:items-center lg:gap-5">
          <div className="flex min-w-0 items-center gap-3 lg:shrink-0">
            <h1 className="shrink-0 font-serif text-[22px] leading-7 text-ink">Strategy Studio</h1>
            <label className="relative min-w-0 flex-1 lg:flex-none">
              <span className="sr-only">{draft.mode === "TEMPLATE" ? "Listed series" : "Reference series"}</span>
              <select
                value={draft.marketId}
                onChange={(event) => chooseMarket(event.target.value)}
                className="focus-ring h-8 w-full min-w-0 appearance-none truncate rounded-md border border-line bg-raised py-0 pr-7 pl-8 font-mono text-xs text-ink transition-colors hover:border-line-strong lg:w-[260px]"
              >
                {liveTemplates.map((market) => (
                  <option key={market.id} value={market.id}>
                    {`${market.code} - ${market.strategyLabel}`}
                  </option>
                ))}
              </select>
              <MarketMark underlying={selectedMarket.underlying} size={16} className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2" />
              <ChevronDown size={12} aria-hidden="true" className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-faint" />
            </label>
          </div>

          <div
            role="region"
            tabIndex={0}
            aria-label="Strategy summary"
            className="focus-ring no-scrollbar flex min-w-0 items-stretch gap-5 overflow-x-auto lg:flex-1"
          >
            <HeaderStat label={`Mark / ${MARK_SOURCE_LABEL[liveSelected.markSource].toLowerCase()}`}>
              <span className="flex items-center gap-1.5">
                {Number.isFinite(liveSelected.netPrice) ? (
                  <Flash value={liveSelected.netPrice}>{formatNumber(liveSelected.netPrice, liveSelected.priceDecimals)}</Flash>
                ) : (
                  <span className="text-faint">No mark</span>
                )}
                <span className="text-[11px] text-faint">{unit}</span>
              </span>
            </HeaderStat>
            <HeaderStat label={view?.label ?? "Strategy view"}>
              <span className={view ? "text-ink" : "text-faint"}>{view?.value ?? "Needs a reference"}</span>
            </HeaderStat>
            <HeaderStat label="Best bid">
              <span className="text-up">{formatNumber(liveSelected.bestBid, liveSelected.priceDecimals)}</span>
            </HeaderStat>
            <HeaderStat label="Best offer">
              <span className="text-down">{formatNumber(liveSelected.bestAsk, liveSelected.priceDecimals)}</span>
            </HeaderStat>
            <HeaderStat label="Spread" className="lg:hidden 2xl:flex">{`${formatNumber(spread, liveSelected.priceDecimals)} ${unit}`}</HeaderStat>
            <HeaderStat label="Firm depth">{`${formatLots(liveSelected.firmDepthLots)} lots`}</HeaderStat>
            <HeaderStat label="Expiry">
              {formatExpiry(liveSelected.expiryIso)}
              <span className="ml-1.5 text-faint">{`${daysToExpiry(liveSelected.expiryIso)}d`}</span>
            </HeaderStat>
            <HeaderStat label="Settlement" className="lg:hidden 2xl:flex">
              {liveSelected.settlementClass === "CASH_USDC_NDF" ? "NDF cash" : "Cash USDC"}
            </HeaderStat>
          </div>

          <div className="flex shrink-0 items-center gap-2 lg:ml-auto">
            <span className="flex items-center gap-1.5 text-[11px] whitespace-nowrap text-faint" title="Market-data feed: onchain book, fills and Chainlink references">
              <LiveDot tone={board.status === "LIVE" ? "up" : board.status === "LOADING" ? "dim" : "down"} live={board.status === "LIVE"} />
              <span className="lg:hidden 2xl:inline">{network}</span>
              <span className="hidden lg:inline 2xl:hidden">{board.status === "LIVE" ? "Live" : board.status === "LOADING" ? "Loading" : "Stale"}</span>
            </span>
            <div className="ml-auto w-[168px] lg:ml-2">
              <Segmented options={MODES} value={draft.mode} onChange={chooseMode} label="Construction mode" size="sm" />
            </div>
          </div>
        </div>
      </header>

      {handoff.valid ? <HandoffContextBar handoff={handoff} /> : null}

      <div className="flex min-w-0 flex-col gap-1 xl:grid xl:min-h-0 xl:flex-1 xl:grid-cols-[264px_minmax(0,1fr)_336px]">
        <LibraryPanel
          templates={liveTemplates}
          marketId={draft.marketId}
          onSelect={chooseMarket}
          className="order-3 h-[420px] xl:order-none xl:h-auto"
        />

        <div className="scroll-thin order-1 flex min-w-0 flex-col gap-1 xl:order-none xl:min-h-0 xl:overflow-y-auto">
          <div className={`${deskMotion.rise} flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line bg-panel px-3 py-2`}>
            <span className="flex min-w-0 items-center gap-2 text-[15px] font-medium text-ink">
              <MarketMark underlying={selectedMarket.underlying} size={18} />
              <span className="truncate">{packageLabel(selectedMarket)}</span>
            </span>
            <span className="tnum font-mono text-[11px] text-faint">{compiled.canonicalId}</span>
            <span className="ml-auto flex items-center gap-1.5">
              <Chip tone={compiled.executable ? "up" : "dim"} dot>
                {compiled.executable ? (Number.isFinite(compiled.allInPrice) ? "Listed and executable" : "Listed, no resting liquidity") : "Modeled graph"}
              </Chip>
            </span>
          </div>
          <LegsPanel
            draft={draft}
            compiled={compiled}
            catalog={catalogById}
            availableInstruments={availableInstruments}
            selectedInstrument={selectedInstrument}
            onSelectInstrument={setSelectedInstrument}
            onDirection={(direction) => setDraft((current) => ({ ...current, direction }))}
            onLots={(lots) =>
              setDraft((current) => ({ ...current, lots: Math.min(10_000, Math.max(1, Math.round(lots) || 1)) }))
            }
            onUpdateLeg={updateLeg}
            onRemoveLeg={removeLeg}
            onAddLeg={addLeg}
            onCopyToGraph={() => chooseMode("GRAPH")}
          />
          <PayoffPanel
            summary={summary}
            move={move}
            onMove={setScenarioMove}
            lots={draft.lots}
            collateral={compiled.collateral}
            moveUnit={selectedMarket.payoffMoveUnit}
            className="xl:min-h-[440px] xl:flex-1"
          />
        </div>

        <aside className="scroll-thin order-2 flex min-w-0 flex-col gap-1 xl:order-none xl:min-h-0 xl:overflow-y-auto">
          <SummaryColumn
            draft={draft}
            compiled={compiled}
            market={liveSelected}
            allInPrice={allInPrice}
            summary={summary}
            route={route}
            canOpen={canOpen}
            primaryHref={primaryHref}
          />
        </aside>
      </div>
    </main>
  );
}
