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
export function PortfolioNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Portfolio views" className="shrink-0 border-b border-line bg-panel">
      <div className="flex px-1 lg:px-3">
        {VIEWS.map((view) => {
          const active = pathname === view.href;
          return (
            <Link
              key={view.href}
              href={view.href}
              aria-current={active ? "page" : undefined}
              className={`focus-ring relative flex h-11 min-w-0 flex-1 items-center justify-center px-1 text-sm whitespace-nowrap transition-colors lg:h-9 lg:flex-none lg:px-3 ${
                active ? "text-ink" : "text-faint hover:text-dim"
              }`}
            >
              {view.label}
              <span
                aria-hidden="true"
                className={`absolute inset-x-1 bottom-0 h-[2px] rounded-t-sm lg:inset-x-2 ${
                  active ? "bg-brand" : "bg-transparent"
                }`}
              />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
