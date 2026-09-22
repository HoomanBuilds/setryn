"use client";

import { useState } from "react";
import { ControlRow, DimensionSelect } from "@/components/portfolio/controls";
import {
  ExpiryLadderPanel,
  ExposurePanel,
  ScenarioMatrix,
} from "@/components/portfolio/RiskPanels";
import { PlaneNote } from "@/components/portfolio/panels";
import { Segmented } from "@/components/terminal/primitives";
import { formatCompactUsd, formatMultiple } from "@/lib/terminal/format";
import {
  BINDING_SCENARIO,
  EXPIRY_LADDER,
  EXPOSURE_BY_DOMAIN,
  EXPOSURE_BY_UNDERLYING,
  GROSS_EXPOSURE,
  NET_EXPOSURE,
  SCENARIO_RESULTS,
} from "@/lib/portfolio/model";

type Dimension = "UNDERLYING" | "DOMAIN";

const DIMENSIONS: { value: Dimension; label: string }[] = [
  { value: "UNDERLYING", label: "Underlying" },
  { value: "DOMAIN", label: "Risk domain" },
];

export function RiskView() {
  const [dimension, setDimension] = useState<Dimension>("UNDERLYING");

  const byDomain = dimension === "DOMAIN";
  const groups = byDomain ? EXPOSURE_BY_DOMAIN : EXPOSURE_BY_UNDERLYING;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <ControlRow note={`${EXPIRY_LADDER.length} expiries`}>
        <span className="hidden shrink-0 lg:block">
          <Segmented
            options={DIMENSIONS}
            value={dimension}
            onChange={setDimension}
            label="Concentration dimension"
          />
        </span>
        <span className="min-w-0 flex-1 lg:hidden">
          <DimensionSelect
            id="risk-dimension"
            label="Concentration"
            value={dimension}
            options={DIMENSIONS}
            onChange={setDimension}
          />
        </span>
      </ControlRow>

      <div className="scroll-thin flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
        <div className="grid shrink-0 grid-cols-1 lg:grid-cols-2 lg:divide-x lg:divide-line">
          <ExposurePanel
            groups={groups}
            gross={GROSS_EXPOSURE}
            net={NET_EXPOSURE}
            label={byDomain ? "Risk domain" : "Underlying"}
          />
          <div className="shrink-0 border-t border-line lg:border-t-0">
            <ScenarioMatrix results={SCENARIO_RESULTS} />
          </div>
        </div>

        <div className="shrink-0 border-t border-line">
          <ExpiryLadderPanel rungs={EXPIRY_LADDER} />
        </div>

        <PlaneNote>
          {`Binding scenario ${BINDING_SCENARIO.scenario.label}, ${formatCompactUsd(BINDING_SCENARIO.headroom)} headroom at ${formatMultiple(BINDING_SCENARIO.healthFactor)} modeled health. Shocks are modeled over the preview fixture, not observed prices.`}
        </PlaneNote>
      </div>
    </div>
  );
}
