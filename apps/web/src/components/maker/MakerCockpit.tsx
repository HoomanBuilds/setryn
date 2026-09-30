"use client";

import { useMemo, useState } from "react";
import { usePreviewBoard } from "@/components/terminal/PreviewMarketProvider";
import { Chip, Flash, LiveDot, Meter, Metric, deskMotion } from "@/components/strategies/desk/Desk";
import { makerCockpitSnapshot } from "@/lib/maker/fixtures";
import type { KillSwitchScope, MakerSeries, QuoteSessionState } from "@/lib/maker/types";
import { MARKETS } from "@/lib/terminal/markets";
import type { PackageMarket } from "@/lib/terminal/types";
import { signedUsd, usd } from "./format";
import {
  CapitalPlane,
  Inventory,
  KillSwitches,
  QuotePolicy,
  RiskLimits,
  SessionBadge,
  SessionHealth,
} from "./MakerPanels";
import { QuoteLadder } from "./QuoteLadder";
import { RfqBlotter } from "./RfqBlotter";

/** A scope covers a series when it is the all-series stop or names that series. */
function scopeCovers(scope: KillSwitchScope, series: MakerSeries): boolean {
  return scope.id === "all" || scope.label === series.displayName;
}

function SeriesTabs({
  selected,
  onSelect,
  live,
}: {
  selected: string;
  onSelect: (seriesId: string) => void;
  live: (seriesId: string) => PackageMarket | null;
}) {
  return (
    <div role="tablist" aria-label="Maker series" className="no-scrollbar flex overflow-x-auto border-t border-line">
      {makerCockpitSnapshot.series.map((item) => {
        const active = item.id === selected;
        const risk = makerCockpitSnapshot.marketRisk.find((entry) => entry.seriesId === item.id);
        const market = live(item.id);
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(item.id)}
            className={`focus-ring relative flex min-w-[232px] shrink-0 flex-col gap-1 border-r border-line px-3 py-2 text-left transition-colors duration-150 ${
              active ? "bg-raised/70" : "hover:bg-raised/40"
            }`}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5">
                <LiveDot tone={item.status === "QUALIFIED" ? "up" : item.status === "CONDITIONAL" ? "brand" : "down"} />
                <span className={`truncate text-[13px] font-medium ${active ? "text-ink" : "text-dim"}`}>{item.displayName}</span>
              </span>
              {market ? (
                <span className="tnum font-mono text-xs text-ink">
                  <Flash value={market.netPrice}>{market.netPrice.toFixed(market.priceDecimals)}</Flash>
                </span>
              ) : null}
            </span>
            <span className="flex items-center justify-between gap-2 text-[11px]">
              <span className="truncate text-faint">{item.template}</span>
              <span className="tnum shrink-0 font-mono text-faint">{item.expiry}</span>
            </span>
            {risk ? (
              <span className="flex items-center gap-2 text-[10px]">
                <span className="text-faint">Util.</span>
                <Meter
                  value={risk.utilization / 100}
                  tone={risk.state === "WITHIN_LIMIT" ? "up" : risk.state === "WATCH" ? "brand" : "down"}
                  label={`${item.displayName} quote utilization`}
                  height="h-[3px]"
                  className="flex-1"
                />
                <span className="tnum font-mono text-dim">{`${risk.utilization.toFixed(1)}%`}</span>
              </span>
            ) : null}
            <span
              aria-hidden="true"
              className={`absolute inset-x-3 bottom-0 h-0.5 origin-center rounded-full bg-brand transition-transform duration-200 ease-out ${
                active ? "scale-x-100" : "scale-x-0"
              }`}
            />
          </button>
        );
      })}
    </div>
  );
}

export function MakerCockpit() {
  const [selectedSeriesId, setSelectedSeriesId] = useState(makerCockpitSnapshot.series[0].id);
  const [skew, setSkew] = useState(1.5);
  const [expiry, setExpiry] = useState(20);
  const [sessionPaused, setSessionPaused] = useState(false);
  // Scopes whose simulated state has been flipped away from the fixture.
  const [toggledScopes, setToggledScopes] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState("No policy changes staged.");
  const board = usePreviewBoard();

  const selectedSeries = useMemo(
    () => makerCockpitSnapshot.series.find((series) => series.id === selectedSeriesId) ?? makerCockpitSnapshot.series[0],
    [selectedSeriesId],
  );
  const selectedRisk = makerCockpitSnapshot.marketRisk.find((risk) => risk.seriesId === selectedSeries.id);
  const sessionState: QuoteSessionState = sessionPaused ? "PAUSED" : makerCockpitSnapshot.session.state;
  const levels = makerCockpitSnapshot.quoteLevels[selectedSeries.id];

  const liveMarket = (seriesId: string): PackageMarket | null =>
    board.markets.find((market) => market.id === seriesId) ?? null;
  const baseMarket = MARKETS.find((market) => market.id === selectedSeries.id) ?? null;
  const selectedLive = liveMarket(selectedSeries.id);
  const drift = baseMarket && selectedLive ? selectedLive.netPrice - baseMarket.netPrice : 0;

  const isPaused = (scope: KillSwitchScope) => (toggledScopes.has(scope.id) ? !scope.active : scope.active);
  const coveringStop = makerCockpitSnapshot.killSwitches.find(
    (scope) => isPaused(scope) && scopeCovers(scope, selectedSeries),
  );

  const toggleSession = () => {
    const nextPaused = !sessionPaused;
    setSessionPaused(nextPaused);
    setNotice(
      nextPaused
        ? "Simulated quote policy paused. No external route was called."
        : "Simulated quote policy resumed. No external route was called.",
    );
  };

  const toggleScope = (scope: KillSwitchScope) => {
    const willPause = !isPaused(scope);
    setToggledScopes((current) => {
      const next = new Set(current);
      if (next.has(scope.id)) next.delete(scope.id);
      else next.add(scope.id);
      return next;
    });
    setNotice(
      willPause
        ? `${scope.label} simulated pause staged. No external route was called.`
        : `${scope.label} simulated pause cleared. No external route was called.`,
    );
  };

  const firmCapacity = levels.reduce((sum, level) => sum + level.firmCapacityUsd, 0);
  const firstLevel = levels[0];

  return (
    <main className="scroll-thin flex min-h-0 min-w-0 flex-1 flex-col gap-1 overflow-y-auto bg-app p-1" aria-label="Setryn maker cockpit">
      <header className={`${deskMotion.rise} shrink-0 rounded-lg border border-line bg-panel`}>
        <div className="flex flex-col gap-2 px-3 py-2 lg:flex-row lg:items-center lg:gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <h1 className="shrink-0 font-serif text-[22px] leading-7 text-ink">Maker desk</h1>
            <span className="hidden truncate text-xs text-faint sm:inline">Quote operations / Arbitrum Sepolia</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip tone="brand">Testnet simulation</Chip>
            <Chip title={makerCockpitSnapshot.snapshot.source}>Simulated</Chip>
            {coveringStop ? <Chip tone="down" dot>{`${coveringStop.label} stopped`}</Chip> : null}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs lg:ml-auto">
            <span className="flex items-center gap-2">
              <span className="text-[11px] text-faint">Session</span>
              <SessionBadge state={sessionState} />
            </span>
            <span className="tnum font-mono text-[11px] text-dim">
              <span className="font-sans text-faint">Snapshot </span>
              {`${(makerCockpitSnapshot.snapshot.ageMs / 1000).toFixed(1)}s`}
            </span>
            <span className="tnum font-mono text-[11px] text-off">{makerCockpitSnapshot.session.id}</span>
          </div>
        </div>
        <SeriesTabs selected={selectedSeriesId} onSelect={setSelectedSeriesId} live={liveMarket} />
      </header>

      <section
        aria-label="Session metrics"
        className={`${deskMotion.rise} grid shrink-0 grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-4 xl:grid-cols-7`}
        style={{ ["--rise-delay" as string]: "30ms" }}
      >
        <Metric className="bg-panel" label="Firm quote capacity" value={usd(firmCapacity)} note="Simulated reservation budget" />
        <Metric className="bg-panel" label="Available capital" value={usd(makerCockpitSnapshot.capital[0].amountUsd)} tone="up" note="Before policy buffers" />
        <Metric
          className="bg-panel"
          label="Quote utilization"
          value={selectedRisk ? `${selectedRisk.utilization.toFixed(1)}%` : "-"}
          note={selectedRisk?.state.replace("_", " ").toLowerCase()}
        >
          {selectedRisk ? (
            <Meter
              value={selectedRisk.utilization / 100}
              tone={selectedRisk.state === "WITHIN_LIMIT" ? "up" : selectedRisk.state === "WATCH" ? "brand" : "down"}
              label="Selected series quote utilization"
            />
          ) : null}
        </Metric>
        <Metric className="bg-panel" label="Expected PnL" value={signedUsd(makerCockpitSnapshot.session.expectedPnlUsd)} tone="up" note="Current simulated session" />
        <Metric
          className="bg-panel"
          label="Realized PnL"
          value={signedUsd(makerCockpitSnapshot.session.realizedPnlUsd)}
          tone={makerCockpitSnapshot.session.realizedPnlUsd >= 0 ? "up" : "down"}
          note="Session to date, simulated"
        />
        <Metric
          className="bg-panel"
          label="Hit rate"
          value={`${makerCockpitSnapshot.session.hitRate.toFixed(1)}%`}
          note={`${makerCockpitSnapshot.session.quoteCount} quotes this session`}
        />
        <Metric
          className="bg-panel"
          label="Fill / toxicity"
          value={
            firstLevel ? (
              <>
                {`${firstLevel.fillProbability}%`}
                <span className="text-faint"> / </span>
                {firstLevel.toxicityScore}
              </>
            ) : (
              "-"
            )
          }
          note="First size level, modeled"
        />
      </section>

      <div className="grid min-w-0 gap-1 xl:grid-cols-[minmax(0,1fr)_344px]">
        <div className="flex min-w-0 flex-col gap-1">
          <QuoteLadder
            series={selectedSeries}
            levels={levels}
            drift={drift}
            previewMark={selectedLive ? selectedLive.netPrice : null}
            skew={skew}
          />
          <RfqBlotter
            selectedSeries={selectedSeries.id}
            sessionPaused={sessionPaused}
            riskPaused={selectedRisk?.state === "PAUSED"}
            scopeStopReason={coveringStop ? `${coveringStop.label} stopped` : null}
            defaultTtl={expiry}
            onNotice={setNotice}
          />
          <div className="grid min-w-0 gap-1 2xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
            <Inventory selected={selectedSeries.id} />
            <CapitalPlane />
          </div>
          <SessionHealth />
        </div>

        <aside className="flex min-w-0 flex-col gap-1">
          <QuotePolicy
            skew={skew}
            expiry={expiry}
            sessionState={sessionState}
            onSkew={setSkew}
            onExpiry={setExpiry}
            onToggle={toggleSession}
          />
          <RiskLimits selected={selectedSeries.id} onSelect={setSelectedSeriesId} />
          <KillSwitches isPaused={isPaused} onToggle={toggleScope} />
        </aside>
      </div>

      <div className="sticky bottom-0 z-10 flex min-h-9 shrink-0 items-center justify-between gap-3 rounded-lg border border-line bg-inset/95 px-3 py-2 backdrop-blur">
        <p aria-live="polite" className="flex min-w-0 items-center gap-2 text-xs text-dim">
          <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
          <span key={notice} className={`${deskMotion.fade} truncate`}>
            {notice}
          </span>
        </p>
        <span className="hidden shrink-0 font-mono text-[10px] text-off sm:inline">
          {`${makerCockpitSnapshot.session.id} / ${makerCockpitSnapshot.snapshot.source}`}
        </span>
      </div>
    </main>
  );
}
