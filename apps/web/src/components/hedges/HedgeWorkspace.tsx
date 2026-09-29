"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { hedgePrefillFromQuery, type HedgePrefill } from "@/lib/exposures/records";
import { usePreviewBoard } from "@/components/terminal/PreviewMarketProvider";
import { Chip, LiveDot, Panel, PanelHead, Row, deskMotion } from "@/components/strategies/desk/Desk";
import { SCENARIO_CLOCK_ISO } from "@/lib/terminal/format";
import {
  HEDGE_ENV_LABEL,
  HEDGE_SOURCE_LABEL,
  handoffFor,
  horizonDays,
  rankCandidates,
  referenceAssetById,
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
import { HedgePayoff, hedgeCurves } from "./HedgePayoff";
import { HedgeSummary } from "./HedgeSummary";
import { ImpactScenario } from "./ImpactScenario";

/** Reads an exposure handed off from /exposures or /protect/new and remounts the builder with it. */
export function HedgeWorkspaceFromQuery() {
  const searchParams = useSearchParams();
  const prefill = useMemo(() => hedgePrefillFromQuery(searchParams), [searchParams]);
  return <HedgeWorkspace key={searchParams.toString()} prefill={prefill} />;
}

export function HedgeWorkspace({ prefill = null }: { prefill?: HedgePrefill | null }) {
  const initial = prefill?.input;
  const [direction, setDirection] = useState<HedgeDirection>(initial?.direction ?? "RECEIVABLE");
  const [referenceAssetId, setReferenceAssetId] = useState(initial?.referenceAssetId ?? "EUR");
  const [settlementAssetId, setSettlementAssetId] = useState(initial?.settlementAssetId ?? "USDC");
  const [amountInput, setAmountInput] = useState(initial ? String(initial.amount) : "250000");
  const [exposureDateIso, setExposureDateIso] = useState(initial?.exposureDateIso ?? "2026-12-30");
  const [riskObjective, setRiskObjective] = useState<RiskObjective>(initial?.riskObjective ?? "LOCK_RATE");
  const [selectedMarketId, setSelectedMarketId] = useState<string | null>(null);
  const [scenarioMove, setScenarioMove] = useState(-10);
  const board = usePreviewBoard();

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
  // Executable prices come from the shared preview board so they match the terminal book.
  const candidates = useMemo(() => rankCandidates(exposure, board.markets), [exposure, board.markets]);
  const candidate =
    candidates.find((entry) => entry.market.id === selectedMarketId) ??
    candidates[0] ??
    null;
  const horizon = useMemo(() => horizonDays(exposure.exposureDateIso), [exposure.exposureDateIso]);
  const rows = useMemo(
    () => (candidate && validation.valid ? scenarioFor(candidate, exposure) : []),
    [candidate, exposure, validation.valid],
  );
  const curves = useMemo(
    () => (candidate && validation.valid ? hedgeCurves(candidate, exposure) : null),
    [candidate, exposure, validation.valid],
  );
  const handoff = useMemo(
    () => (candidate ? handoffFor(candidate, exposure, validation) : null),
    [candidate, exposure, validation],
  );
  const exposureId = useMemo(
    () => (validation.valid ? stableExposureId(exposure) : "-"),
    [exposure, validation.valid],
  );
  const referenceLabel = referenceAssetById(referenceAssetId)?.label ?? referenceAssetId;
  const move = curves ? Math.min(curves.moveMax, Math.max(curves.moveMin, scenarioMove)) : scenarioMove;

  return (
    <main className="scroll-thin flex min-h-0 min-w-0 flex-1 flex-col gap-1 overflow-y-auto bg-app p-1 xl:overflow-hidden">
      <header className={`${deskMotion.rise} shrink-0 rounded-lg border border-line bg-panel`}>
        <div className="flex flex-col gap-2 px-3 py-2 lg:flex-row lg:items-center lg:gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <h1 className="shrink-0 font-serif text-[22px] leading-7 text-ink">Hedge builder</h1>
            <span className="tnum truncate font-mono text-xs text-dim">{exposureId}</span>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <Chip title={HEDGE_SOURCE_LABEL}>Preview fixture</Chip>
            <Chip tone="dim" title={HEDGE_ENV_LABEL}>
              Local simulation
            </Chip>
            <Chip tone="down" title="Mainnet writes are disabled in this environment">
              Mainnet writes off
            </Chip>
          </div>
          <div className="flex items-center gap-4 text-[11px] text-faint lg:ml-auto">
            <span className="flex items-center gap-1.5">
              <LiveDot tone="up" live />
              {`Snapshot ${candidate ? `${candidate.market.snapshotAgeSeconds}s` : "-"}`}
            </span>
            <span className="tnum font-mono">{`Scenario clock ${SCENARIO_CLOCK_ISO.slice(0, 10)}`}</span>
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
          <Panel label="Source and freshness" delay={60}>
            <PanelHead title="Source and freshness" />
            <div className="px-3 py-1.5">
              <div className="py-1.5">
                <div className="text-[11px] text-faint">Market data</div>
                <div className="mt-0.5 text-xs leading-snug text-dim">{HEDGE_SOURCE_LABEL}</div>
              </div>
              <Row
                label="Snapshot age"
                value={candidate ? `${candidate.market.snapshotAgeSeconds}s / live board` : "-"}
                tone="dim"
                className="border-t border-line-soft"
              />
              <div className="border-t border-line-soft py-2">
                <div className="text-[11px] text-faint">Environment</div>
                <div className="mt-0.5 text-xs leading-snug text-dim">{HEDGE_ENV_LABEL}</div>
              </div>
            </div>
          </Panel>
        </aside>

        <section className="scroll-thin flex min-w-0 flex-col gap-1 xl:min-h-0 xl:overflow-y-auto" aria-label="Hedge analysis">
          <HedgePayoff
            candidate={validation.valid ? candidate : null}
            exposure={exposure}
            curves={curves}
            move={move}
            onMove={setScenarioMove}
            referenceLabel={referenceLabel}
          />
          <CashflowTimeline exposure={exposure} candidate={candidate} horizonDays={horizon} />
          <CandidateTable
            candidates={candidates}
            selectedId={candidate?.market.id ?? null}
            onSelect={setSelectedMarketId}
          />
        </section>

        <aside className="scroll-thin flex min-w-0 flex-col gap-1 xl:min-h-0 xl:overflow-y-auto">
          <HedgeSummary candidate={validation.valid ? candidate : null} curves={curves} />
          <ImpactScenario
            candidate={validation.valid ? candidate : null}
            rows={rows}
            activeMove={move}
            onSelectMove={setScenarioMove}
          />
          <HandoffBar candidate={candidate} validation={validation} handoff={handoff} />
        </aside>
      </div>
    </main>
  );
}
