"use client";

import { useMemo, useState } from "react";
import { MetaLine } from "@/components/terminal/primitives";
import { SCENARIO_CLOCK_ISO } from "@/lib/terminal/format";
import {
  HEDGE_ENV_LABEL,
  HEDGE_SOURCE_LABEL,
  handoffFor,
  horizonDays,
  rankCandidates,
  scenarioFor,
  stableExposureId,
  validateExposure,
} from "@/lib/hedges/engine";
import type {
  ExposureInput,
  HedgeDirection,
  RiskObjective,
} from "@/lib/hedges/types";
import { CandidateTable } from "./CandidateTable";
import { CashflowTimeline } from "./CashflowTimeline";
import { ExposureForm } from "./ExposureForm";
import { HandoffBar } from "./HandoffBar";
import { ImpactScenario } from "./ImpactScenario";

export function HedgeWorkspace() {
  const [direction, setDirection] = useState<HedgeDirection>("RECEIVABLE");
  const [referenceAssetId, setReferenceAssetId] = useState("EUR");
  const [settlementAssetId, setSettlementAssetId] = useState("USDC");
  const [amountInput, setAmountInput] = useState("250000");
  const [exposureDateIso, setExposureDateIso] = useState("2026-12-30");
  const [riskObjective, setRiskObjective] = useState<RiskObjective>("LOCK_RATE");
  const [selectedMarketId, setSelectedMarketId] = useState<string | null>(null);

  const exposure: ExposureInput = useMemo(
    () => ({
      direction,
      referenceAssetId,
      settlementAssetId,
      amount: Number(amountInput),
      exposureDateIso,
      riskObjective,
    }),
    [direction, referenceAssetId, settlementAssetId, amountInput, exposureDateIso, riskObjective],
  );

  const validation = useMemo(() => validateExposure(exposure), [exposure]);
  const candidates = useMemo(() => rankCandidates(exposure), [exposure]);
  const candidate =
    candidates.find((entry) => entry.market.id === selectedMarketId) ??
    candidates[0] ??
    null;
  const horizon = useMemo(() => horizonDays(exposure.exposureDateIso), [exposure.exposureDateIso]);
  const rows = useMemo(
    () => (candidate && validation.valid ? scenarioFor(candidate, exposure) : []),
    [candidate, exposure, validation.valid],
  );
  const handoff = useMemo(
    () => (candidate ? handoffFor(candidate, exposure, validation) : null),
    [candidate, exposure, validation],
  );
  const exposureId = useMemo(
    () => (validation.valid ? stableExposureId(exposure) : "—"),
    [exposure, validation.valid],
  );

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-app">
      <section className="shrink-0 border-b border-line bg-panel">
        <div className="flex min-h-12 flex-col px-3 py-2 lg:h-12 lg:flex-row lg:items-center lg:gap-4 lg:px-4 lg:py-0">
          <div className="flex min-w-0 items-center gap-3">
            <h1 className="shrink-0 text-sm font-semibold text-ink lg:text-base">Hedge builder</h1>
            <MetaLine
              className="hidden min-w-0 truncate xl:flex"
              items={[
                exposureId,
                HEDGE_SOURCE_LABEL,
                `snapshot ${candidate ? `${candidate.market.snapshotAgeSeconds}s` : "—"}`,
                HEDGE_ENV_LABEL,
              ]}
            />
          </div>
          <p className="mt-1 text-xs text-faint lg:ml-auto lg:mt-0">
            Goal-first package hedge. Scenario clock {SCENARIO_CLOCK_ISO.slice(0, 10)}.
          </p>
        </div>
      </section>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto xl:grid xl:grid-cols-[300px_minmax(0,1fr)_340px] xl:overflow-hidden">
        <aside className="shrink-0 border-b border-line bg-panel p-3 xl:min-h-0 xl:overflow-y-auto xl:border-r xl:border-b-0">
          <ExposureForm
            exposure={exposure}
            amountInput={amountInput}
            validation={validation}
            onDirection={setDirection}
            onReference={setReferenceAssetId}
            onSettlement={setSettlementAssetId}
            onAmount={setAmountInput}
            onDate={setExposureDateIso}
            onObjective={setRiskObjective}
          />
          <div className="mt-3 border border-line bg-app px-3 py-2.5">
            <span className="text-xs font-medium tracking-[0.08em] text-faint uppercase">
              Source and freshness
            </span>
            <dl className="mt-2 space-y-1.5 text-xs">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-faint">Market data</dt>
                <dd className="tnum text-right font-mono text-dim">{HEDGE_SOURCE_LABEL}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-faint">Snapshot age</dt>
                <dd className="tnum text-right font-mono text-dim">
                  {candidate ? `${candidate.market.snapshotAgeSeconds}s` : "—"}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-faint">Environment</dt>
                <dd className="text-right text-dim">{HEDGE_ENV_LABEL}</dd>
              </div>
            </dl>
          </div>
        </aside>

        <section className="min-w-0 space-y-3 border-b border-line bg-app p-3 xl:min-h-0 xl:overflow-y-auto xl:border-r xl:border-b-0">
          <CashflowTimeline exposure={exposure} candidate={candidate} horizonDays={horizon} />
          <CandidateTable
            candidates={candidates}
            selectedId={candidate?.market.id ?? null}
            onSelect={setSelectedMarketId}
          />
        </section>

        <aside className="space-y-3 bg-panel p-3 xl:min-h-0 xl:overflow-y-auto">
          <ImpactScenario candidate={validation.valid ? candidate : null} rows={rows} />
          <HandoffBar candidate={candidate} validation={validation} handoff={handoff} />
        </aside>
      </div>
    </main>
  );
}
