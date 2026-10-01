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
  const groups = byDomain ? portfolio.risk.exposuresByDomain : portfolio.risk.exposuresByUnderlying;
  const binding = portfolio.risk.binding;
  const count = portfolio.runtimePositions.length;
  const asset = snapshot.account.collateralAsset;

  const figures: { label: string; value: string; tone?: string }[] = [
    { label: "Gross exposure", value: formatCompactUsd(portfolio.runtimeGross) },
    {
      label: "Net exposure",
      value: formatSignedCompactUsd(portfolio.runtimeNet),
      tone: tone(portfolio.runtimeNet),
    },
    { label: `Reserved ${asset}`, value: formatNumber(portfolio.account.reserved, 0) },
    { label: "Reservation use", value: formatShare(portfolio.account.marginUsage) },
    { label: "Binding scenario", value: binding.scenario.label },
    {
      label: "Stressed headroom",
      value: count === 0 ? "No positions" : `${formatCompactUsd(binding.headroom)} at ${formatMultiple(binding.healthFactor)}`,
    },
  ];

  return (
    <div className="flex min-w-0 flex-col">
      <ControlRow note={`${count} open position${count === 1 ? "" : "s"}`}>
        <span className="hidden shrink-0 lg:block">
          <Segmented
            options={DIMENSIONS}
            value={dimension}
            onChange={setDimension}
            label="Concentration dimension"
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
          gross={portfolio.runtimeGross}
          net={portfolio.runtimeNet}
          label={byDomain ? "Risk domain" : "Underlying"}
        />
        <div className="border-t border-line-soft lg:border-t-0">
          <ScenarioMatrix results={count === 0 ? [] : portfolio.risk.scenarios} />
        </div>
      </div>
      <div className="border-t border-line-soft">
        <ExpiryLadderPanel rungs={portfolio.risk.expiryLadder} />
      </div>
      <PlaneNote
        chips={
          <>
            <Chip tone="muted">Positions and collateral: onchain</Chip>
            <Chip tone="muted">Scenarios: modeled</Chip>
          </>
        }
      >
        {count === 0
          ? `No open positions on ${snapshot.environment.label}. Concentration, scenarios and the expiry ladder fill in with the first fill.`
          : `Positions and reservations are read onchain from ${snapshot.environment.label} and marked live. Every position is fully collateralized, so a loss never exceeds the collateral it locks. ${binding.scenario.label} leaves ${formatCompactUsd(binding.headroom)} headroom at ${formatMultiple(binding.healthFactor)} cover; scenarios are modeled shocks to the forward level, not limits.`}
      </PlaneNote>
    </div>
  );
}
