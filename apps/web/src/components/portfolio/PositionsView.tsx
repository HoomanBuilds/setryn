"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { motion } from "@/components/markets/ui";
import { ControlRow, DimensionSelect } from "@/components/portfolio/controls";
import { PositionDetail } from "@/components/portfolio/PositionDetail";
import { PositionsList, PositionsTable } from "@/components/portfolio/PositionsTable";
import { Aggregate, EmptyBook, PlaneFooter } from "@/components/portfolio/panels";
import { usePortfolio } from "@/components/portfolio/usePortfolio";
import { Segmented, tone } from "@/components/terminal/primitives";
import { formatCompactUsd, formatSignedCompactUsd } from "@/lib/terminal/format";
import { GROUP_OPTIONS } from "@/lib/portfolio/model";
import { groupPortfolioPositions } from "@/lib/portfolio/runtime";
import type { GroupBy } from "@/lib/portfolio/types";

const DETAIL_ID = "portfolio-position-detail";

export function PositionsView() {
  const { portfolio } = usePortfolio();
  const [groupBy, setGroupBy] = useState<GroupBy>("UNDERLYING");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const groups = useMemo(
    () => groupPortfolioPositions(portfolio.positions, groupBy),
    [portfolio.positions, groupBy],
  );
  const selected =
    selectedId === null ? null : (portfolio.positions.find((position) => position.id === selectedId) ?? null);
  const toggle = (id: string) => setSelectedId((current) => (current === id ? null : id));
  const count = portfolio.runtimePositions.length;

  /* Escape closes the detail pane, the way a drawer should. */
  useEffect(() => {
    if (!selected) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedId(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected]);

  return (
    <div className="flex min-w-0 flex-col">
      <ControlRow note={`${count} open position${count === 1 ? "" : "s"}`}>
        <span className="hidden shrink-0 lg:block">
          <Segmented
            options={GROUP_OPTIONS}
            value={groupBy}
            onChange={setGroupBy}
            label="Group positions by"
            size="sm"
          />
        </span>
        <span className="min-w-0 flex-1 lg:hidden">
          <DimensionSelect
            id="portfolio-group"
            label="Group"
            value={groupBy}
            options={GROUP_OPTIONS}
            onChange={setGroupBy}
          />
        </span>
      </ControlRow>

      {portfolio.positions.length === 0 ? (
        <EmptyBook title="No positions yet">
          <Link
            href="/markets"
            className="focus-ring flex h-11 items-center rounded-md border border-line-strong bg-raised px-3 text-[13px] text-ink transition-colors hover:border-brand-edge lg:h-8 lg:text-xs"
          >
            Browse markets
          </Link>
        </EmptyBook>
      ) : (
        <div className="flex min-w-0 items-start">
          <div className="min-w-0 flex-1">
            {/* With the detail pane open the book may need a horizontal track; closed,
                it fits from xl and keeps its sticky header. */}
            <div
              className={`scroll-thin hidden min-w-0 overflow-x-auto lg:block ${selected ? "" : "xl:overflow-visible"}`}
            >
              <PositionsTable
                groups={groups}
                selectedId={selectedId}
                onSelect={toggle}
                detailId={DETAIL_ID}
                stickyHead={selected === null}
                compact={selected !== null}
              />
            </div>
            <div className="lg:hidden">
              <PositionsList
                groups={groups}
                selectedId={selectedId}
                onSelect={toggle}
                renderDetail={(position) => (
                  <PositionDetail
                    position={position}
                    portfolioPnl={portfolio.runtimePnl}
                    binding={portfolio.risk.binding}
                    variant="inline"
                  />
                )}
              />
            </div>
          </div>

          {selected ? (
            <aside
              id={DETAIL_ID}
              aria-label={`Detail for ${selected.label}`}
              className={`${motion.enter} scroll-thin sticky top-[var(--sticky-top,0px)] hidden max-h-[calc(100dvh-140px)] w-[340px] shrink-0 self-start overflow-y-auto border-l border-line bg-panel lg:block xl:w-[372px]`}
            >
              <div className="sticky top-0 z-10 flex h-9 items-center justify-between gap-2 border-b border-line bg-panel pr-2 pl-4">
                <span className="text-xs font-medium text-dim">Position detail</span>
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  aria-label="Close position detail"
                  title="Close (Esc)"
                  className="focus-ring grid h-7 w-7 shrink-0 place-items-center rounded-sm text-faint transition-colors hover:bg-raised hover:text-ink"
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </div>
              <PositionDetail
                position={selected}
                portfolioPnl={portfolio.runtimePnl}
                binding={portfolio.risk.binding}
              />
            </aside>
          ) : null}
        </div>
      )}

      <PlaneFooter>
        <Aggregate label="Active packages" value={String(count)} />
        <Aggregate label="Gross exposure" value={formatCompactUsd(portfolio.runtimeGross)} />
        <Aggregate
          label="Net exposure"
          value={formatSignedCompactUsd(portfolio.runtimeNet)}
          valueTone={tone(portfolio.runtimeNet)}
        />
      </PlaneFooter>
    </div>
  );
}
