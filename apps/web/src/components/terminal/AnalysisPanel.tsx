"use client";

import { Tabs } from "@/components/terminal/primitives";
import { DepthChart } from "@/components/terminal/viz/DepthChart";
import { LegGraph } from "@/components/terminal/viz/LegGraph";
import {
  PackagePriceChart,
  type PositionPriceOverlay,
  type WorkingOrderPriceOverlay,
} from "@/components/terminal/viz/PackagePriceChart";
import { PayoffChart } from "@/components/terminal/viz/PayoffChart";
import { formatUtcClock } from "@/lib/terminal/format";
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
  baseMarket,
  tab,
  onTab,
  lots,
  previewEpochSeconds,
  positionOverlays = [],
  orderOverlays = [],
  onAmendOrderPrice,
}: {
  market: PackageMarket;
  baseMarket: PackageMarket;
  tab: VizTab;
  onTab: (tab: VizTab) => void;
  lots: number;
  previewEpochSeconds: number;
  positionOverlays?: PositionPriceOverlay[];
  orderOverlays?: WorkingOrderPriceOverlay[];
  onAmendOrderPrice?: (orderId: string, price: number) => void;
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
          className="hidden shrink-0 items-center gap-1.5 text-xs text-off sm:flex"
          title="Setryn index feed."
        >
          <span aria-hidden="true" className="live-dot h-1.5 w-1.5 rounded-full bg-up text-up" />
          <span>Index feed</span>
          <span className="tnum font-mono text-faint">
            {`${formatUtcClock(previewEpochSeconds)} UTC`}
          </span>
        </span>
      </div>

      <div
        key={tab}
        id={`viz-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`viz-tab-${tab}`}
        className={`panel-in flex min-h-0 min-w-0 flex-1 flex-col ${
          tab === "price" ? "p-0" : "px-3 py-3 lg:px-4"
        }`}
      >
        {tab === "price" ? (
          <PackagePriceChart
            market={market}
            baseMarket={baseMarket}
            previewEpochSeconds={previewEpochSeconds}
            positionOverlays={positionOverlays}
            orderOverlays={orderOverlays}
            onAmendOrderPrice={onAmendOrderPrice}
          />
        ) : null}
        {tab === "depth" ? <DepthChart market={market} /> : null}
        {tab === "payoff" ? <PayoffChart market={market} lots={lots} /> : null}
        {tab === "legs" ? <LegGraph market={market} /> : null}
      </div>
    </section>
  );
}
