"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { useGatewaySnapshot } from "@/components/gateway/InternalGatewayProvider";
import { ControlRow, DimensionSelect } from "@/components/portfolio/controls";
import { PositionDetail } from "@/components/portfolio/PositionDetail";
import { PositionsList, PositionsTable } from "@/components/portfolio/PositionsTable";
import { Aggregate, PlaneFooter } from "@/components/portfolio/panels";
import { SectionLabel, Segmented, tone } from "@/components/terminal/primitives";
import { formatCompactUsd, formatSignedCompactUsd, formatSignedUsd } from "@/lib/terminal/format";
import { GROUP_OPTIONS } from "@/lib/portfolio/model";
import { groupPortfolioPositions, portfolioRuntime } from "@/lib/portfolio/runtime";
import type { GroupBy } from "@/lib/portfolio/types";

const DETAIL_ID = "portfolio-position-detail";

export function PositionsView() {
  const snapshot = useGatewaySnapshot();
  const portfolio = portfolioRuntime(snapshot);
  const [groupBy, setGroupBy] = useState<GroupBy>("UNDERLYING");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const groups = useMemo(() => groupPortfolioPositions(portfolio.positions, groupBy), [portfolio.positions, groupBy]);
  const selected = selectedId === null ? null : portfolio.positions.find((position) => position.id === selectedId) ?? null;
  const toggle = (id: string) => setSelectedId((current) => (current === id ? null : id));

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <ControlRow note={`${portfolio.runtimePositions.length} runtime / ${portfolio.referencePositions.length} reference`}>
        <span className="hidden shrink-0 lg:block"><Segmented options={GROUP_OPTIONS} value={groupBy} onChange={setGroupBy} label="Group positions by" /></span>
        <span className="min-w-0 flex-1 lg:hidden"><DimensionSelect id="portfolio-group" label="Group" value={groupBy} options={GROUP_OPTIONS} onChange={setGroupBy} /></span>
      </ControlRow>
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <div className="scroll-thin flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
          <div className="hidden min-w-0 shrink-0 lg:block"><PositionsTable groups={groups} selectedId={selectedId} onSelect={toggle} detailId={DETAIL_ID} /></div>
          <div className="shrink-0 lg:hidden">
            <PositionsList groups={groups} selectedId={selectedId} onSelect={toggle} renderDetail={(position) => <PositionDetail position={position} portfolioPnl={position.source === "RUNTIME_SIMULATION" ? portfolio.runtimePnl : portfolio.referencePnl} binding={portfolio.reference.binding} variant="inline" />} />
          </div>
          <PlaneFooter>
            <Aggregate label="Runtime packages" value={String(portfolio.runtimePositions.length)} />
            <Aggregate label="Runtime gross" value={formatCompactUsd(portfolio.runtimeGross)} />
            <Aggregate label="Runtime net" value={formatSignedCompactUsd(portfolio.runtimeNet)} valueTone={tone(portfolio.runtimeNet)} />
            <Aggregate label="Reference PnL" value={formatSignedUsd(portfolio.referencePnl.total, 0)} valueTone={tone(portfolio.referencePnl.total)} />
          </PlaneFooter>
        </div>
        {selected ? (
          <aside id={DETAIL_ID} aria-label={`Detail for ${selected.label}`} className="scroll-thin hidden min-h-0 w-[330px] shrink-0 overflow-y-auto border-l border-line bg-panel lg:block xl:w-[360px]">
            <div className="sticky top-0 z-10 flex h-9 items-center justify-between gap-2 border-b border-line bg-panel pr-2 pl-4">
              <SectionLabel>Position detail</SectionLabel>
              <button type="button" onClick={() => setSelectedId(null)} aria-label="Close position detail" className="focus-ring grid h-7 w-7 shrink-0 place-items-center rounded-sm text-faint hover:text-ink"><X size={14} aria-hidden="true" /></button>
            </div>
            <PositionDetail position={selected} portfolioPnl={selected.source === "RUNTIME_SIMULATION" ? portfolio.runtimePnl : portfolio.referencePnl} binding={portfolio.reference.binding} />
          </aside>
        ) : null}
      </div>
    </div>
  );
}
