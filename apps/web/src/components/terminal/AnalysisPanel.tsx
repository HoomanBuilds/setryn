"use client";

import { Tabs } from "@/components/terminal/primitives";
import { DepthChart } from "@/components/terminal/viz/DepthChart";
import { LegGraph } from "@/components/terminal/viz/LegGraph";
import { PackagePriceChart } from "@/components/terminal/viz/PackagePriceChart";
import { PayoffChart } from "@/components/terminal/viz/PayoffChart";
import type { PackageMarket } from "@/lib/terminal/types";

export type VizTab = "price" | "depth" | "payoff" | "legs";

const VIZ_TABS = [
  { id: "price", label: "Price" },
  { id: "depth", label: "Depth" },
  { id: "payoff", label: "Payoff" },
  { id: "legs", label: "Legs" },
];

export function AnalysisPanel({
  market,
  tab,
  onTab,
  lots,
  snapshotAge,
}: {
  market: PackageMarket;
  tab: VizTab;
  onTab: (tab: VizTab) => void;
  lots: number;
  snapshotAge: number;
}) {
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-panel">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line pr-3 lg:pr-4">
        <Tabs
          items={VIZ_TABS}
          value={tab}
          onChange={(id) => onTab(id as VizTab)}
          idBase="viz"
          className="no-scrollbar min-w-0 overflow-x-auto"
        />
        <span
          className="tnum hidden shrink-0 font-mono text-xs text-off min-[380px]:inline"
          title="Preview snapshots age visibly and then roll over. Nothing here streams from a chain."
        >
          {`snapshot ${snapshotAge}s`}
        </span>
      </div>

      <div
        id={`viz-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`viz-tab-${tab}`}
        className={`flex min-h-0 min-w-0 flex-1 flex-col ${
          tab === "price" ? "p-0" : "px-3 py-3 lg:px-4"
        }`}
      >
        {tab === "price" ? <PackagePriceChart market={market} /> : null}
        {tab === "depth" ? <DepthChart market={market} /> : null}
        {tab === "payoff" ? <PayoffChart market={market} lots={lots} /> : null}
        {tab === "legs" ? <LegGraph market={market} /> : null}
      </div>
    </section>
  );
}
