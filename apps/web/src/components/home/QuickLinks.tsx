"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight, Briefcase, CandlestickChart, Layers, MessagesSquare, ShieldCheck, Waypoints } from "lucide-react";
import { deskMotion } from "@/components/strategies/desk/Desk";

export interface QuickLink {
  id: string;
  label: string;
  href: string;
  icon: "trade" | "protect" | "strategies" | "rfqs" | "portfolio" | "exposures";
  stat: ReactNode;
  note: string;
}

const ICONS = {
  trade: CandlestickChart,
  protect: ShieldCheck,
  strategies: Waypoints,
  rfqs: MessagesSquare,
  portfolio: Briefcase,
  exposures: Layers,
} as const;

export function QuickLinks({ links }: { links: QuickLink[] }) {
  return (
    <nav aria-label="Quick links" className="grid grid-cols-2 gap-1 md:grid-cols-3 2xl:grid-cols-6">
      {links.map((link, index) => {
        const Icon = ICONS[link.icon];
        return (
          <Link
            key={link.id}
            href={link.href}
            style={{ ["--rise-delay" as string]: `${30 + index * 25}ms` }}
            className={`${deskMotion.rise} focus-ring group flex min-h-[76px] min-w-0 flex-col justify-between gap-2 rounded-lg border border-line bg-panel px-3 py-2.5 transition-colors duration-150 hover:border-line-strong hover:bg-raised`}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-line bg-inset text-dim transition-colors group-hover:border-brand-edge group-hover:text-brand">
                  <Icon size={13} aria-hidden="true" />
                </span>
                <span className="truncate text-[13px] font-medium text-ink">{link.label}</span>
              </span>
              <ArrowUpRight size={13} aria-hidden="true" className="shrink-0 text-off transition-colors group-hover:text-dim" />
            </span>
            <span className="min-w-0">
              <span className="tnum block truncate font-mono text-xs text-dim">{link.stat}</span>
              <span className="block truncate text-[11px] text-faint">{link.note}</span>
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
