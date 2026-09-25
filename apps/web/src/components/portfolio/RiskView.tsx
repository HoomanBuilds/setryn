"use client";

import { useState } from "react";
import { useGatewaySnapshot } from "@/components/gateway/InternalGatewayProvider";
import { ControlRow, DimensionSelect } from "@/components/portfolio/controls";
import { ExpiryLadderPanel, ExposurePanel, ScenarioMatrix } from "@/components/portfolio/RiskPanels";
import { PlaneNote } from "@/components/portfolio/panels";
import { Segmented } from "@/components/terminal/primitives";
import { formatCompactUsd, formatMultiple, formatShare, formatUsd } from "@/lib/terminal/format";
import { portfolioRuntime } from "@/lib/portfolio/runtime";

type Dimension = "UNDERLYING" | "DOMAIN";

const DIMENSIONS: { value: Dimension; label: string }[] = [
  { value: "UNDERLYING", label: "Underlying" },
  { value: "DOMAIN", label: "Risk domain" },
];

export function RiskView() {
  const snapshot = useGatewaySnapshot();
  const portfolio = portfolioRuntime(snapshot);
  const [dimension, setDimension] = useState<Dimension>("UNDERLYING");
  const byDomain = dimension === "DOMAIN";
  const groups = byDomain ? portfolio.reference.exposuresByDomain : portfolio.reference.exposuresByUnderlying;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <ControlRow note={`${portfolio.runtimePositions.length} runtime packages`}>
        <span className="hidden shrink-0 lg:block"><Segmented options={DIMENSIONS} value={dimension} onChange={setDimension} label="Reference concentration dimension" /></span>
        <span className="min-w-0 flex-1 lg:hidden"><DimensionSelect id="risk-dimension" label="Reference concentration" value={dimension} options={DIMENSIONS} onChange={setDimension} /></span>
      </ControlRow>
      <div className="scroll-thin flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
        <section className="grid shrink-0 grid-cols-2 border-b border-line bg-panel lg:grid-cols-4">
          {[
            ["Runtime gross", formatCompactUsd(portfolio.runtimeGross)],
            ["Runtime net", formatCompactUsd(portfolio.runtimeNet)],
            ["Reserved USDC", formatUsd(portfolio.account.reserved, 0)],
            ["Reservation use", formatShare(portfolio.account.marginUsage)],
          ].map(([label, value], index) => (
            <div key={label} className={`min-w-0 px-3 py-3 ${index > 0 ? "border-l border-line-soft" : ""}`}>
              <p className="truncate text-xs text-faint">{label}</p>
              <p className="mt-1 truncate font-mono text-sm text-ink">{value}</p>
            </div>
          ))}
        </section>
        <div className="grid shrink-0 grid-cols-1 lg:grid-cols-2 lg:divide-x lg:divide-line">
          <ExposurePanel groups={groups} gross={portfolio.reference.gross} net={portfolio.reference.net} label={`${byDomain ? "Risk domain" : "Underlying"} reference`} />
          <div className="shrink-0 border-t border-line lg:border-t-0"><ScenarioMatrix results={portfolio.reference.scenarios} /></div>
        </div>
        <div className="shrink-0 border-t border-line"><ExpiryLadderPanel rungs={portfolio.reference.expiryLadder} /></div>
        <PlaneNote>
          {`Runtime reservation is observable in ${snapshot.environment.label}. ${portfolio.reference.binding.scenario.label} leaves ${formatCompactUsd(portfolio.reference.binding.headroom)} reference headroom at ${formatMultiple(portfolio.reference.binding.healthFactor)}. Concentration, scenarios, and expiry cash remain modeled reference observations, not live risk limits.`}
        </PlaneNote>
      </div>
    </div>
  );
}
