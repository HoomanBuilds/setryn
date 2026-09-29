"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Empty, ProvenanceChip } from "@/components/home/kit";
import { DeskTabs, Panel, TabBody } from "@/components/strategies/desk/Desk";
import { GROUP_LABEL, type PendingGroup, type PendingItem } from "./pending";

type View = "ALL" | PendingGroup;

const GROUPS: PendingGroup[] = ["SIGN", "ORDERS", "RFQS", "FIXINGS"];

const EMPTY_COPY: Record<PendingGroup, string> = {
  SIGN: "No quote or approval is waiting for your signature.",
  ORDERS: "No working orders on the public book.",
  RFQS: "No private RFQ is collecting quotes.",
  FIXINGS: "No fixing is scheduled for a held package.",
};

function Row({ item }: { item: PendingItem }) {
  return (
    <li>
      <Link
        href={item.href}
        className="focus-ring group grid min-h-[52px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-line-soft px-3 py-2 transition-colors duration-150 hover:bg-raised/60 lg:grid-cols-[minmax(0,1fr)_auto_auto]"
      >
        <span className="min-w-0">
          <span className="flex min-w-0 items-center gap-2">
            {item.urgent ? <span aria-hidden="true" className="h-[6px] w-[6px] shrink-0 rounded-full bg-brand" /> : null}
            <span className="truncate text-xs text-ink">{item.title}</span>
          </span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5">
            <span className="tnum truncate font-mono text-[11px] text-faint">{item.detail}</span>
          </span>
        </span>
        <span className="flex flex-col items-end gap-1">
          <span className={`tnum font-mono text-xs whitespace-nowrap ${item.urgent ? "text-brand" : "text-dim"}`}>{item.meta}</span>
          <span className="lg:hidden">
            <ProvenanceChip kind={item.provenance} />
          </span>
        </span>
        <span className="hidden items-center gap-2 lg:flex">
          <ProvenanceChip kind={item.provenance} />
          <span className="inline-flex h-7 min-w-[76px] items-center justify-center gap-0.5 rounded-md border border-line px-2 text-[11px] text-dim transition-colors group-hover:border-line-strong group-hover:text-ink">
            {item.action}
            <ChevronRight size={12} aria-hidden="true" />
          </span>
        </span>
      </Link>
    </li>
  );
}

export function PendingActions({ items, listedFixings }: { items: PendingItem[]; listedFixings: boolean }) {
  const [view, setView] = useState<View>("ALL");
  const count = (group: PendingGroup) => items.filter((item) => item.group === group && !(group === "FIXINGS" && listedFixings)).length;
  const actionable = items.filter((item) => !(item.group === "FIXINGS" && listedFixings)).length;
  const tabs = [
    { id: "ALL", label: "All", badge: actionable },
    ...GROUPS.map((group) => ({
      id: group,
      label: GROUP_LABEL[group],
      badge: count(group),
      badgeTone: group === "SIGN" && count(group) > 0 ? ("brand" as const) : undefined,
    })),
  ];
  const visible = view === "ALL" ? items : items.filter((item) => item.group === view);

  return (
    <Panel label="Pending actions" delay={60}>
      <div className="flex h-10 shrink-0 items-stretch border-b border-line">
        <DeskTabs idBase="home-pending" items={tabs} value={view} onChange={(id) => setView(id as View)} />
      </div>
      <TabBody key={view} idBase="home-pending" className="min-h-[220px]">
        {view === "ALL" ? (
          <div>
            {GROUPS.map((group) => {
              const rows = items.filter((item) => item.group === group);
              return (
                <section key={group} aria-label={GROUP_LABEL[group]}>
                  <h3 className="flex h-7 items-center justify-between border-b border-line-soft bg-inset/60 px-3 text-[11px] font-normal text-faint">
                    <span>{group === "FIXINGS" && listedFixings ? "Next listed fixings" : GROUP_LABEL[group]}</span>
                    <span className="tnum font-mono">{rows.length}</span>
                  </h3>
                  {rows.length === 0 ? (
                    <p className="border-b border-line-soft px-3 py-2.5 text-[11px] text-off">{EMPTY_COPY[group]}</p>
                  ) : (
                    <ul>
                      {rows.map((item) => (
                        <Row key={item.id} item={item} />
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        ) : visible.length === 0 ? (
          <Empty title={EMPTY_COPY[view]} />
        ) : (
          <ul>
            {visible.map((item) => (
              <Row key={item.id} item={item} />
            ))}
          </ul>
        )}
        {listedFixings && (view === "ALL" || view === "FIXINGS") ? (
          <p className="px-3 py-2 text-[11px] leading-snug text-faint">
            No held package yet, so the nearest listed fixings are shown. Fixing times run on the preview clock.
          </p>
        ) : null}
      </TabBody>
    </Panel>
  );
}
