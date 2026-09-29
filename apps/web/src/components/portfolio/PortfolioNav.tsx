"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const VIEWS = [
  { href: "/portfolio", label: "Overview" },
  { href: "/portfolio/positions", label: "Positions" },
  { href: "/portfolio/risk", label: "Risk" },
  { href: "/portfolio/collateral", label: "Collateral" },
];

/**
 * Real links over local tabs: every view has its own URL, so refresh, back, and
 * a pasted address all land where they say they do. Overview matches exactly
 * because its path is a prefix of every other view.
 */
export function PortfolioNav({ counts = {} }: { counts?: Partial<Record<string, number>> }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Portfolio views" className="no-scrollbar flex min-w-0 overflow-x-auto">
      {VIEWS.map((view) => {
        const active = pathname === view.href;
        const count = counts[view.href];
        return (
          <Link
            key={view.href}
            href={view.href}
            aria-current={active ? "page" : undefined}
            className={`focus-ring relative flex h-11 min-w-0 flex-1 items-center justify-center gap-1.5 px-2 text-[13px] whitespace-nowrap transition-colors duration-150 lg:h-10 lg:flex-none lg:px-3 ${
              active ? "text-ink" : "text-faint hover:text-dim"
            }`}
          >
            {view.label}
            {count !== undefined ? (
              <span className={`tnum font-mono text-[10.5px] ${active ? "text-dim" : "text-off"}`}>
                {count}
              </span>
            ) : null}
            <span
              aria-hidden="true"
              className={`absolute inset-x-2 bottom-0 h-[2px] origin-center rounded-t-sm bg-brand transition-transform duration-200 ease-out ${
                active ? "scale-x-100" : "scale-x-0"
              }`}
            />
          </Link>
        );
      })}
    </nav>
  );
}
