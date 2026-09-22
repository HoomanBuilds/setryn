"use client";

import { PlaneNote } from "@/components/portfolio/panels";
import { CollateralPanel } from "@/components/portfolio/RiskPanels";
import { SummaryStrip, type SummaryMetric } from "@/components/portfolio/SummaryStrip";
import { formatShare, formatUsd } from "@/lib/terminal/format";
import { ACCOUNT_SUMMARY, COLLATERAL_LINES } from "@/lib/portfolio/model";

const METRICS: SummaryMetric[] = [
  {
    label: "Posted",
    value: formatUsd(ACCOUNT_SUMMARY.postedValue, 0),
    note: `${COLLATERAL_LINES.length} assets`,
  },
  {
    label: "Eligible",
    value: formatUsd(ACCOUNT_SUMMARY.eligible, 0),
    note: `${formatShare(1 - ACCOUNT_SUMMARY.eligible / ACCOUNT_SUMMARY.postedValue)} haircut`,
  },
  {
    label: "Reserved",
    value: formatUsd(ACCOUNT_SUMMARY.reserved, 0),
    note: "pledged against positions",
  },
  {
    label: "Available",
    value: formatUsd(ACCOUNT_SUMMARY.available, 0),
    note: "free for new packages",
  },
];

export function CollateralView() {
  return (
    <div className="scroll-thin flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
      <SummaryStrip metrics={METRICS} />

      <CollateralPanel
        className="shrink-0"
        lines={COLLATERAL_LINES}
        eligible={ACCOUNT_SUMMARY.eligible}
        reserved={ACCOUNT_SUMMARY.reserved}
        available={ACCOUNT_SUMMARY.available}
      />

      <PlaneNote>
        Preview fixture. No wallet is connected, so nothing listed here can be deposited, pledged,
        or withdrawn.
      </PlaneNote>
    </div>
  );
}
