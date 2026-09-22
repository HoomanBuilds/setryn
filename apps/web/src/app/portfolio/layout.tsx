import type { ReactNode } from "react";
import { PortfolioNav } from "@/components/portfolio/PortfolioNav";
import { MetaLine } from "@/components/terminal/primitives";
import { POSITIONS } from "@/lib/portfolio/model";
import { PROVENANCE } from "@/lib/portfolio/provenance";

/** One title row and one view row for every portfolio route, and nothing else. */
export default function PortfolioLayout({ children }: { children: ReactNode }) {
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-app">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-panel px-3 lg:px-4">
        <h1 className="shrink-0 text-sm font-semibold text-ink lg:text-base">Portfolio</h1>
        <span className="hidden min-w-0 overflow-hidden xl:block">
          <MetaLine items={PROVENANCE} />
        </span>
        <span className="min-w-0 truncate text-xs text-faint xl:hidden">
          {`${POSITIONS.length} positions, preview fixture`}
        </span>
      </div>

      <PortfolioNav />

      {children}
    </section>
  );
}
