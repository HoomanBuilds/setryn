"use client";

import { useState } from "react";
import { Chip, motion } from "@/components/markets/ui";
import { ControlRow, DimensionSelect } from "@/components/portfolio/controls";
import { ExpiryLadderPanel, ExposurePanel, ScenarioMatrix } from "@/components/portfolio/RiskPanels";
import { PlaneNote } from "@/components/portfolio/panels";
import { usePortfolio } from "@/components/portfolio/usePortfolio";
import { Segmented, tone } from "@/components/terminal/primitives";
import {
  formatCompactUsd,
  formatMultiple,
  formatNumber,
  formatShare,
  formatSignedCompactUsd,
} from "@/lib/terminal/format";

type Dimension = "UNDERLYING" | "DOMAIN";

const DIMENSIONS: { value: Dimension; label: string }[] = [
  { value: "UNDERLYING", label: "Underlying" },
  { value: "DOMAIN", label: "Risk domain" },
];

export function RiskView() {
  const { snapshot, portfolio } = usePortfolio();
  const [dimension, setDimension] = useState<Dimension>("UNDERLYING");
  const byDomain = dimension === "DOMAIN";
  const groups = byDomain
    ? portfolio.reference.exposuresByDomain
    : portfolio.reference.exposuresByUnderlying;
  const binding = portfolio.reference.binding;
  const asset = snapshot.account.collateralAsset;

  const figures: { label: string; value: string; tone?: string }[] = [
    { label: "Runtime gross", value: formatCompactUsd(portfolio.runtimeGross) },
    {
      label: "Runtime net",
      value: formatSignedCompactUsd(portfolio.runtimeNet),
      tone: tone(portfolio.runtimeNet),
    },
    { label: `Reserved ${asset}`, value: formatNumber(portfolio.account.reserved, 0) },
    { label: "Reservation use", value: formatShare(portfolio.account.marginUsage) },
    { label: "Binding scenario", value: binding.scenario.label },
    { label: "Reference headroom", value: `${formatCompactUsd(binding.headroom)} at ${formatMultiple(binding.healthFactor)}` },
  ];

  return (
    <div className="flex min-w-0 flex-col">
      <ControlRow note={`${portfolio.runtimePositions.length} runtime packages`}>
        <span className="hidden shrink-0 lg:block">
          <Segmented
            options={DIMENSIONS}
            value={dimension}
            onChange={setDimension}
            label="Reference concentration dimension"
            size="sm"
          />
        </span>
        <span className="min-w-0 flex-1 lg:hidden">
          <DimensionSelect
            id="risk-dimension"
            label="Concentration by"
            value={dimension}
            options={DIMENSIONS}
            onChange={setDimension}
          />
        </span>
      </ControlRow>

      <dl
        className={`${motion.enter} grid grid-cols-2 gap-px border-b border-line-soft bg-line-soft md:grid-cols-3 xl:grid-cols-6`}
      >
        {figures.map((figure) => (
          <div key={figure.label} className="flex min-w-0 flex-col gap-1 bg-panel px-3 py-2.5 lg:px-4">
            <dt className="truncate text-[11px] text-faint">{figure.label}</dt>
            <dd className={`tnum truncate font-mono text-[13px] ${figure.tone ?? "text-ink"}`}>{figure.value}</dd>
          </div>
        ))}
      </dl>

      <div className="grid grid-cols-1 lg:grid-cols-2 lg:divide-x lg:divide-line-soft">
        <ExposurePanel
          groups={groups}
          gross={portfolio.reference.gross}
          net={portfolio.reference.net}
          label={`${byDomain ? "Risk domain" : "Underlying"} reference`}
        />
        <div className="border-t border-line-soft lg:border-t-0">
          <ScenarioMatrix results={portfolio.reference.scenarios} />
        </div>
      </div>
      <div className="border-t border-line-soft">
        <ExpiryLadderPanel rungs={portfolio.reference.expiryLadder} />
      </div>
      <PlaneNote
        chips={
          <>
            <Chip tone="muted">Runtime: observable</Chip>
            <Chip tone="muted">Concentration and scenarios: modeled</Chip>
          </>
        }
      >
        {`Runtime reservation is observable in ${snapshot.environment.label}. ${binding.scenario.label} leaves ${formatCompactUsd(binding.headroom)} reference headroom at ${formatMultiple(binding.healthFactor)}. Concentration, scenarios, and expiry cash remain modeled reference observations, not live risk limits.`}
      </PlaneNote>
    </div>
  );
}
