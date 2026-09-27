"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowUpRight, Check, Layers3, Plus, ShieldCheck, X } from "lucide-react";
import { PayoffChart } from "@/components/terminal/viz/PayoffChart";
import { MetaLine, Segmented, SourceMark } from "@/components/terminal/primitives";
import {
  compilePackageDraft,
  draftFromMarket,
  instrumentCatalog,
  marketTemplates,
} from "@/lib/strategies/catalog";
import { parseStudioHandoff, type StudioHandoffContext } from "@/lib/strategies/handoff";
import type { DraftLeg, InstrumentOption, PackageDirection, PackageDraft, StrategyBuildMode } from "@/lib/strategies/types";
import {
  formatCompactUsd,
  formatExpiry,
  formatLots,
  formatNumber,
  formatShare,
  priceUnitSuffix,
} from "@/lib/terminal/format";
import { findMarket, MARKETS, packageLabel, tradeHref } from "@/lib/terminal/markets";
import type { PackageMarket, Qualification } from "@/lib/terminal/types";

const MODES: { value: StrategyBuildMode; label: string }[] = [
  { value: "TEMPLATE", label: "Template" },
  { value: "GRAPH", label: "Graph" },
];

const DIRECTIONS: { value: PackageDirection; label: string }[] = [
  { value: "LONG", label: "Long package" },
  { value: "SHORT", label: "Short package" },
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
    <div className="shrink-0 border-b border-line bg-panel px-3 py-2 lg:px-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="font-medium tracking-[0.08em] text-faint uppercase">
          {handoff.sourceLabel ? `Handoff / ${handoff.sourceLabel}` : "Handoff"}
        </span>
        <span className="tnum font-mono text-dim">{summary}</span>
        {refs.length > 0 ? (
          <span className="tnum truncate font-mono text-off">{refs.join(" / ")}</span>
        ) : null}
      </div>
      <p className="mt-1 text-xs leading-snug text-faint">
        Read-only handoff context. No order is created here. Arbitrum Sepolia preview; mainnet
        writes remain disabled.
      </p>
    </div>
  );
}

function qualificationClass(qualification: Qualification): string {
  if (qualification === "QUALIFIED") return "text-up";
  if (qualification === "CONDITIONAL") return "text-brand";
  return "text-down";
}

function legLabel(option: InstrumentOption): string {
  return `${option.asset} / ${option.family.toLowerCase().replaceAll("_", " ")}`;
}

function nextLegId(legs: DraftLeg[]): string {
  return `draft-leg-${legs.length + 1}-${Date.now().toString(36)}`;
}

function priceDecimals(mark: number, unit: InstrumentOption["markUnit"]): number {
  if (unit === "USD" && mark < 10) return 4;
  return unit === "USD" ? 2 : 1;
}

function valueAtMove(market: PackageMarket, move: number): number {
  let closest = market.payoff[0];
  for (const point of market.payoff) {
    if (Math.abs(point.move - move) < Math.abs(closest.move - move)) closest = point;
  }
  return closest.value;
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

function MarketSelector({
  label,
  marketId,
  onChange,
}: {
  label: string;
  marketId: string;
  onChange: (marketId: string) => void;
}) {
  const templates = useMemo(() => marketTemplates(), []);
  return (
    <label className="block">
      <span className="text-xs text-faint">{label}</span>
      <select
        value={marketId}
        onChange={(event) => onChange(event.target.value)}
        className="focus-ring mt-1 h-9 w-full rounded-md border border-line bg-inset px-2.5 text-sm text-ink"
      >
        {templates.map((market) => (
          <option key={market.id} value={market.id}>
            {`${market.code} - ${market.strategyLabel}`}
          </option>
        ))}
      </select>
    </label>
  );
}

function TemplateList({ marketId, onSelect }: { marketId: string; onSelect: (market: PackageMarket) => void }) {
  const templates = useMemo(() => marketTemplates(), []);
  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto border-t border-line">
      {templates.map((market) => {
        const selected = market.id === marketId;
        return (
          <button
            key={market.id}
            type="button"
            onClick={() => onSelect(market)}
            className={`focus-ring flex w-full items-start gap-2 border-b border-line px-3 py-2.5 text-left transition-colors ${
              selected ? "bg-raised" : "hover:bg-raised/60"
            }`}
          >
            <span
              aria-hidden="true"
              className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                market.qualification === "QUALIFIED"
                  ? "bg-up"
                  : market.qualification === "CONDITIONAL"
                    ? "bg-brand"
                    : "bg-down"
              }`}
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate font-mono text-xs text-ink">{market.code}</span>
                <span className="shrink-0 text-xs text-faint">{market.tenorLabel}</span>
              </span>
              <span className="mt-0.5 block truncate text-xs text-dim">{market.name}</span>
              <span className="mt-1 flex items-center justify-between gap-2 text-xs text-faint">
                <span>{`${market.legs.length} legs / ${market.settlementAsset}`}</span>
                <span className={`uppercase ${qualificationClass(market.qualification)}`}>
                  {market.qualification.toLowerCase()}
                </span>
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function GraphLegRows({
  legs,
  catalog,
  locked,
  onChange,
  onRemove,
}: {
  legs: DraftLeg[];
  catalog: Map<string, InstrumentOption>;
  locked: boolean;
  onChange: (id: string, patch: Partial<Pick<DraftLeg, "side" | "ratio">>) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="divide-y divide-line border-y border-line">
      {legs.map((leg, index) => {
        const instrument = catalog.get(leg.instrumentId);
        if (!instrument) return null;
        return (
          <div key={leg.id} className="grid grid-cols-[minmax(0,1fr)_64px_54px_30px] items-center gap-2 px-3 py-2.5">
            <span className="min-w-0">
              <span className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={`h-5 w-[2px] shrink-0 ${leg.side === "BUY" ? "bg-up" : "bg-down"}`}
                />
                <span className="truncate text-sm text-ink">{instrument.instrument}</span>
              </span>
              <span className="mt-0.5 ml-4 block truncate text-xs text-faint">
                {`${legLabel(instrument)} / ${instrument.venueClass === "NATIVE_BOOK" ? "native" : "component"}`}
              </span>
            </span>
            <select
              value={leg.side}
              disabled={locked}
              onChange={(event) => onChange(leg.id, { side: event.target.value as DraftLeg["side"] })}
              aria-label={`Side for leg ${index + 1}`}
              className={`focus-ring h-8 rounded-sm border border-line bg-inset px-1.5 text-xs disabled:cursor-default disabled:opacity-80 ${
                leg.side === "BUY" ? "text-up" : "text-down"
              }`}
            >
              <option value="BUY">Buy</option>
              <option value="SELL">Sell</option>
            </select>
            <label className="min-w-0">
              <span className="sr-only">Ratio for leg {index + 1}</span>
              <input
                type="number"
                inputMode="decimal"
                min="0.25"
                max="10"
                step="0.25"
                disabled={locked}
                value={leg.ratio}
                onChange={(event) => onChange(leg.id, { ratio: Number(event.target.value) })}
                className="focus-ring tnum h-8 w-full rounded-sm border border-line bg-inset px-1.5 text-right font-mono text-xs text-ink disabled:cursor-default disabled:opacity-80"
              />
            </label>
            {locked ? (
              <span className="text-center font-mono text-xs text-off">{index + 1}</span>
            ) : (
              <button
                type="button"
                onClick={() => onRemove(leg.id)}
                aria-label={`Remove ${instrument.instrument}`}
                className="focus-ring grid h-8 w-8 place-items-center rounded-sm text-faint transition-colors hover:bg-raised hover:text-ink"
              >
                <X size={14} aria-hidden="true" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ScenarioPanel({
  market,
  lots,
  scale,
  direction,
}: {
  market: PackageMarket;
  lots: number;
  scale: number;
  direction: PackageDirection;
}) {
  const scenarioMarket = useMemo(
    () => ({
      ...market,
      payoff: market.payoff.map((point) => ({
        ...point,
        value: point.value * scale * (direction === "LONG" ? 1 : -1),
      })),
    }),
    [direction, market, scale],
  );
  const shifts = [-20, -10, 0, 10, 20];

  return (
    <section className="flex min-h-[320px] flex-col border border-line bg-panel">
      <div className="flex items-center justify-between border-b border-line px-3 py-2.5">
        <span className="text-xs font-medium tracking-[0.08em] text-faint uppercase">Scenario payoff</span>
        <span className="text-xs text-off">modeled at expiry</span>
      </div>
      <div className="min-h-[194px] flex-1 px-3">
        <PayoffChart market={scenarioMarket} lots={lots} />
      </div>
      <div className="grid grid-cols-5 border-t border-line">
        {shifts.map((shift) => {
          const value = valueAtMove(scenarioMarket, shift) * lots;
          return (
            <div key={shift} className="min-w-0 border-r border-line px-2 py-2 last:border-r-0">
              <div className="tnum font-mono text-xs text-faint">{`${shift > 0 ? "+" : ""}${shift}%`}</div>
              <div className={`tnum mt-1 truncate font-mono text-xs ${value > 0 ? "text-up" : value < 0 ? "text-down" : "text-dim"}`}>
                {`${value > 0 ? "+" : ""}${formatNumber(value, 0)}`}
              </div>
            </div>
          );
        })}
      </div>
      <div className="border-t border-line px-3 py-2 text-xs text-faint">
        Baseline is zero package exposure. Values are model outputs, not executable quotes.
      </div>
    </section>
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
  const catalog = useMemo(() => instrumentCatalog(), []);
  const catalogById = useMemo(() => new Map(catalog.map((instrument) => [instrument.id, instrument])), [catalog]);
  const [selectedInstrument, setSelectedInstrument] = useState("");
  const compiled = useMemo(() => compilePackageDraft(draft), [draft]);
  const availableInstruments = useMemo(
    () =>
      catalog.filter(
        (instrument) =>
          instrument.settlementClass === compiled.market.settlementClass &&
          !draft.legs.some((leg) => leg.instrumentId === instrument.id),
      ),
    [catalog, compiled.market.settlementClass, draft.legs],
  );

  useEffect(() => {
    if (availableInstruments.some((instrument) => instrument.id === selectedInstrument)) return;
    setSelectedInstrument(availableInstruments[0]?.id ?? "");
  }, [availableInstruments, selectedInstrument]);

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
  const primaryMarket = compiled.executableMarketId
    ? findMarket(compiled.executableMarketId)
    : selectedMarket;
  const canOpen = compiled.validation.length === 0;
  const primaryHref = packageHref(primaryMarket, draft, compiled.canonicalId);
  const route = compiled.executable
    ? (primaryMarket.routes.find((candidate) => candidate.guarantee === compiled.guarantee) ??
      primaryMarket.routes[0])
    : undefined;

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-app">
      <section className="shrink-0 border-b border-line bg-panel">
        <div className="flex min-h-12 flex-col lg:h-12 lg:flex-row lg:items-center lg:gap-4 lg:px-4">
          <div className="flex h-12 min-w-0 items-center gap-3 px-3 lg:h-auto lg:px-0">
            <h1 className="shrink-0 text-sm font-semibold text-ink lg:text-base">Strategy Studio</h1>
            <MetaLine
              className="hidden min-w-0 truncate xl:flex"
              items={[
                "construct package",
                `${compiled.legs.length} typed legs`,
                "Arbitrum Sepolia preview",
              ]}
            />
          </div>
          <div className="no-scrollbar overflow-x-auto border-t border-line px-3 lg:ml-auto lg:border-t-0 lg:px-0">
            <Segmented
              options={MODES}
              value={draft.mode}
              onChange={chooseMode}
              label="Construction mode"
              size="sm"
            />
          </div>
        </div>
      </section>
      {handoff.valid ? <HandoffContextBar handoff={handoff} /> : null}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto xl:grid xl:grid-cols-[272px_minmax(0,1fr)_344px] xl:overflow-hidden">
        <aside className="flex min-h-0 flex-col border-b border-line bg-panel xl:border-r xl:border-b-0">
          <div className="space-y-3 border-b border-line p-3">
            <MarketSelector
              label={draft.mode === "TEMPLATE" ? "Listed series" : "Reference series"}
              marketId={draft.marketId}
              onChange={chooseMarket}
            />
            <Segmented
              options={DIRECTIONS}
              value={draft.direction}
              onChange={(direction) => setDraft((current) => ({ ...current, direction }))}
              label="Package direction"
              size="sm"
              tone="direction"
            />
            <label className="block">
              <span className="flex items-baseline justify-between text-xs text-faint">
                Package lots
                <span className="font-mono text-off">max by listed depth</span>
              </span>
              <input
                type="number"
                inputMode="decimal"
                min="1"
                max="10000"
                step="1"
                value={draft.lots}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    lots: Math.min(10_000, Math.max(1, Number(event.target.value) || 1)),
                  }))
                }
                className="focus-ring tnum mt-1 h-9 w-full rounded-md border border-line bg-inset px-2.5 font-mono text-sm text-ink"
              />
            </label>
          </div>

          {draft.mode === "GRAPH" ? (
            <div className="border-b border-line p-3">
              <span className="text-xs font-medium tracking-[0.08em] text-faint uppercase">Add typed leg</span>
              <div className="mt-2 flex gap-2">
                <select
                  value={selectedInstrument}
                  onChange={(event) => setSelectedInstrument(event.target.value)}
                  disabled={availableInstruments.length === 0 || draft.legs.length >= 6}
                  className="focus-ring h-9 min-w-0 flex-1 rounded-md border border-line bg-inset px-2 text-xs text-ink disabled:opacity-50"
                >
                  {availableInstruments.map((instrument) => (
                    <option key={instrument.id} value={instrument.id}>
                      {`${instrument.asset} / ${instrument.family.toLowerCase().replaceAll("_", " ")}`}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={addLeg}
                  disabled={!selectedInstrument || draft.legs.length >= 6}
                  className="focus-ring grid h-9 w-9 shrink-0 place-items-center rounded-md border border-line bg-raised text-dim transition-colors hover:border-brand-edge hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="Add typed leg"
                >
                  <Plus size={16} aria-hidden="true" />
                </button>
              </div>
              <p className="mt-2 text-xs leading-snug text-faint">Same settlement class, maximum six legs, one canonical side per instrument.</p>
            </div>
          ) : (
            <div className="border-b border-line p-3">
              <span className="text-xs font-medium tracking-[0.08em] text-faint uppercase">Listed package</span>
              <p className="mt-1 text-xs leading-snug text-dim">Choose a qualified strategy series. Its canonical legs and settlement terms are fixed by the listed market.</p>
              <button
                type="button"
                onClick={() => chooseMode("GRAPH")}
                className="focus-ring mt-3 h-8 w-full rounded-md border border-line bg-raised px-2 text-xs text-dim transition-colors hover:border-line-strong hover:text-ink"
              >
                Copy into graph builder
              </button>
            </div>
          )}

          <div className="flex min-h-[240px] flex-1 flex-col xl:min-h-0">
            <div className="flex h-10 items-center justify-between px-3">
              <span className="text-xs font-medium tracking-[0.08em] text-faint uppercase">Package library</span>
              <span className="tnum font-mono text-xs text-off">{MARKETS.length}</span>
            </div>
            <TemplateList marketId={draft.marketId} onSelect={(market) => chooseMarket(market.id)} />
          </div>
        </aside>

        <section className="min-w-0 border-b border-line bg-app xl:min-h-0 xl:overflow-y-auto xl:border-r xl:border-b-0">
          <div className="border-b border-line bg-panel px-3 py-3 lg:px-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Layers3 size={15} aria-hidden="true" className="text-brand" />
                  <span className="text-xs font-medium tracking-[0.08em] text-faint uppercase">Canonical package</span>
                </div>
                <h2 className="mt-1 truncate text-lg font-medium text-ink">{packageLabel(selectedMarket)}</h2>
                <MetaLine
                  className="mt-1"
                  items={[
                    compiled.canonicalId,
                    `${compiled.legs.length} legs`,
                    `${compiled.settlementClass === "CASH_USDC_NDF" ? "NDF cash" : "cash"} settlement`,
                  ]}
                />
              </div>
              <span
                className={`shrink-0 rounded-sm border px-2 py-1 text-xs uppercase ${
                  compiled.executable
                    ? "border-up/30 bg-up-soft text-up"
                    : "border-line-strong bg-raised text-dim"
                }`}
              >
                {compiled.executable ? "Listed and executable" : "Modeled graph"}
              </span>
            </div>
          </div>

          <div className="p-3 lg:p-4">
            <div className="mb-2 grid grid-cols-[minmax(0,1fr)_64px_54px_30px] gap-2 px-3 text-xs text-off">
              <span>Instrument</span>
              <span>Side</span>
              <span className="text-right">Ratio</span>
              <span className="text-center">#</span>
            </div>
            <GraphLegRows
              legs={draft.legs}
              catalog={catalogById}
              locked={draft.mode === "TEMPLATE"}
              onChange={updateLeg}
              onRemove={removeLeg}
            />
          </div>

          <div className="grid border-y border-line bg-panel sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Net package delta" value={formatNumber(compiled.netDelta, 2)} />
            <Stat label="Settlement" value={compiled.settlementClass === "CASH_USDC_NDF" ? "NDF cash" : "Cash USDC"} />
            <Stat label="Fixing" value={selectedMarket.fixingSource.includes(" ") ? selectedMarket.fixingSource.split(" ").slice(0, 3).join(" ") : selectedMarket.fixingSource} />
            <Stat label="Expiry" value={formatExpiry(selectedMarket.expiryIso)} />
          </div>

          <div className="p-3 lg:p-4">
            <ScenarioPanel
              market={selectedMarket}
              lots={draft.lots}
              scale={compiled.graphScale}
              direction={draft.direction}
            />
          </div>
        </section>

        <aside className="bg-panel xl:min-h-0 xl:overflow-y-auto">
          <section className="border-b border-line p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium tracking-[0.08em] text-faint uppercase">Pre-trade economics</span>
              <span className={`text-xs uppercase ${compiled.allInPriceLabel === "EXECUTABLE" ? "text-up" : "text-brand"}`}>
                {compiled.allInPriceLabel.toLowerCase()}
              </span>
            </div>
            <div className="mt-3 border-b border-line pb-3">
              <div className="text-xs text-faint">All-in net price</div>
              <div className="tnum mt-1 font-mono text-2xl text-ink">
                {`${formatNumber(compiled.allInPrice, selectedMarket.priceDecimals)} ${priceUnitSuffix(selectedMarket.priceUnit)}`}
              </div>
              <div className="mt-1 text-xs text-faint">
                {compiled.executable
                  ? `${formatLots(compiled.firmDepthLots)} lots currently qualified at available sources`
                  : "Reference-series model. Request an executable quote before signing."}
              </div>
            </div>
            <KeyValue label="Initial collateral" value={formatCompactUsd(compiled.collateral)} />
            <KeyValue label="Max terminal residual" value={formatCompactUsd(compiled.maxResidual)} />
            <KeyValue label="Package notional" value={formatCompactUsd(selectedMarket.notionalPerLot * draft.lots * compiled.graphScale)} />
            <KeyValue label="Modelled ratio scale" value={formatShare(compiled.graphScale)} />
          </section>

          <section className="border-b border-line p-3">
            <div className="flex items-center gap-2">
              <ShieldCheck size={15} aria-hidden="true" className="text-brand" />
              <span className="text-xs font-medium tracking-[0.08em] text-faint uppercase">Qualification and settlement</span>
            </div>
            <div className="mt-3 space-y-2">
              <PolicyRow label="Leg qualification" value={compiled.qualification.toLowerCase()} tone={qualificationClass(compiled.qualification)} />
              <PolicyRow label="Settlement class" value={compiled.settlementClass === "CASH_USDC_NDF" ? "cash NDF" : "cash USDC"} />
              <PolicyRow
                label="Completion"
                value={
                  compiled.guarantee === "PACKAGE_ATOMIC"
                    ? "package atomic"
                    : compiled.guarantee === "SOLVER_BONDED"
                      ? "solver bonded"
                      : "leg sequenced"
                }
              />
              <PolicyRow label="Liquidity state" value={compiled.executable ? "firm route available" : "quote required"} tone={compiled.executable ? "text-up" : "text-brand"} />
            </div>
          </section>

          <section className="border-b border-line p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium tracking-[0.08em] text-faint uppercase">Compiled route context</span>
              {route ? <SourceMark source={route.source} /> : null}
            </div>
            {route ? (
              <div className="mt-2">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm text-ink">{route.label}</span>
                  <span className="tnum font-mono text-xs text-dim">{route.etaLabel}</span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-line pt-2 text-xs">
                  <span className="text-faint">Protocol fee</span>
                  <span className="tnum text-right font-mono text-dim">{formatNumber(route.protocolFeeBps, 1)} bp</span>
                  <span className="text-faint">Counterparty</span>
                  <span className="tnum text-right font-mono text-dim">{formatNumber(route.counterpartyFeeBps, 1)} bp</span>
                  <span className="text-faint">Intermediate risk</span>
                  <span className="tnum text-right font-mono text-dim">{formatShare(route.intermediateExposureRate)}</span>
                </div>
              </div>
            ) : (
              <p className="mt-2 text-xs text-faint">No route can be represented until the graph matches a listed strategy series.</p>
            )}
          </section>

          <section className="p-3">
            {compiled.validation.length > 0 ? (
              <div className="mb-3 rounded-md border border-down/30 bg-down-soft p-2.5">
                <div className="flex items-center gap-1.5 text-xs font-medium text-down">
                  <X size={13} aria-hidden="true" />
                  Cannot form execution request
                </div>
                <ul className="mt-1.5 space-y-1 text-xs leading-snug text-dim">
                  {compiled.validation.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {canOpen ? (
              <Link
                href={primaryHref}
                className="focus-ring flex h-10 w-full items-center justify-center gap-2 rounded-md bg-brand px-3 text-sm font-semibold text-app"
              >
                {compiled.executable ? "Open executable package" : "Open reference market"}
                <ArrowUpRight size={15} aria-hidden="true" />
              </Link>
            ) : (
              <button
                type="button"
                disabled
                className="flex h-10 w-full items-center justify-center rounded-md bg-raised px-3 text-sm font-semibold text-off"
              >
                Resolve package constraints
              </button>
            )}
            <div className="mt-2 flex items-start gap-1.5 text-xs leading-snug text-faint">
              <Check size={13} aria-hidden="true" className="mt-0.5 shrink-0 text-up" />
              {compiled.executable
                ? "The trade handoff carries the canonical draft, direction, and lot size. The terminal still requires its own final route selection."
                : "The trade handoff carries this modeled draft only. It cannot create an order until a listed market or firm quote is selected."}
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 border-b border-line px-3 py-2.5 last:border-b-0 sm:border-r sm:last:border-r-0 lg:border-b-0">
      <div className="truncate text-xs text-faint">{label}</div>
      <div className="tnum mt-1 truncate font-mono text-xs text-ink">{value}</div>
    </div>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-2 last:border-b-0">
      <span className="text-xs text-faint">{label}</span>
      <span className="tnum shrink-0 font-mono text-xs text-ink">{value}</span>
    </div>
  );
}

function PolicyRow({ label, value, tone = "text-dim" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-faint">{label}</span>
      <span className={`tnum text-right font-mono text-xs ${tone}`}>{value}</span>
    </div>
  );
}
