"use client";

import { useGatewaySnapshot } from "@/components/gateway/InternalGatewayProvider";
import { PlaneNote } from "@/components/portfolio/panels";
import { CollateralPanel } from "@/components/portfolio/RiskPanels";
import { SummaryStrip, type SummaryMetric } from "@/components/portfolio/SummaryStrip";
import { formatShare, formatUsd } from "@/lib/terminal/format";
import { portfolioRuntime } from "@/lib/portfolio/runtime";

export function CollateralView() {
  const snapshot = useGatewaySnapshot();
  const portfolio = portfolioRuntime(snapshot);
  const { account } = portfolio;
  const metrics: SummaryMetric[] = [
    { label: "Posted", value: formatUsd(account.postedValue, 0), note: "runtime USDC" },
    { label: "Eligible", value: formatUsd(account.eligible, 0), note: "no haircut in local runtime" },
    { label: "Reserved", value: formatUsd(account.reserved, 0), note: `${formatShare(account.marginUsage)} of eligible` },
    { label: "Available", value: formatUsd(account.available, 0), note: "free for package intents" },
  ];
  return (
    <div className="scroll-thin flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
      <SummaryStrip metrics={metrics} />
      <CollateralPanel className="shrink-0" lines={portfolio.collateralLines} eligible={account.eligible} reserved={account.reserved} available={account.available} />
      <PlaneNote>
        {`This is ${snapshot.environment.label} simulation state. Deposit and withdrawal intents are available from the account control, but no real wallet, token transfer, or mainnet write occurs.`}
      </PlaneNote>
    </div>
  );
}
