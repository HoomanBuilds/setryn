"use client";

import type { ReactNode } from "react";
import { useGatewaySnapshot } from "@/components/gateway/InternalGatewayProvider";
import { PortfolioNav } from "@/components/portfolio/PortfolioNav";
import { MetaLine } from "@/components/terminal/primitives";
import { portfolioRuntime, runtimeObservationLabel } from "@/lib/portfolio/runtime";

export default function PortfolioLayout({ children }: { children: ReactNode }) {
  const snapshot = useGatewaySnapshot();
  const portfolio = portfolioRuntime(snapshot);

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-app">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-panel px-3 lg:px-4">
        <h1 className="shrink-0 text-sm font-semibold text-ink lg:text-base">Portfolio</h1>
        <span className="hidden min-w-0 overflow-hidden xl:block">
          <MetaLine
            items={[
              snapshot.account.label,
              `${portfolio.runtimePositions.length} runtime package${portfolio.runtimePositions.length === 1 ? "" : "s"}`,
              "reference observations",
              runtimeObservationLabel(snapshot),
            ]}
          />
        </span>
        <span className="min-w-0 truncate text-xs text-faint xl:hidden">
          {`${snapshot.environment.label} / ${portfolio.runtimePositions.length} runtime packages`}
        </span>
      </div>

      <PortfolioNav />

      {children}
    </section>
  );
}
