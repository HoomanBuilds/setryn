"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight, ChevronDown } from "lucide-react";
import { motion } from "@/components/markets/ui";
import { NUM, StateTag, TABLE, TD, TH } from "@/components/portfolio/panels";
import { tone } from "@/components/terminal/primitives";
import {
  formatCompactUsd,
  formatExpiry,
  formatPrice,
  formatSigned,
  formatSignedUsd,
  formatUsd,
  priceUnitSuffix,
} from "@/lib/terminal/format";
import type { Position, PositionGroup } from "@/lib/portfolio/types";
import { positionOrigin } from "@/lib/portfolio/runtime";
import { MarketMark, knownUnderlying } from "@/components/portfolio/MarketMark";

const COLUMNS = [
  { label: "Package", numeric: false, className: "w-[26%]" },
  { label: "Underlying", numeric: false, className: "w-[88px]", wide: true },
  { label: "Expiry", numeric: true, className: "w-[108px]" },
  { label: "Size", numeric: true, className: "w-[72px]" },
  { label: "Entry", numeric: true, className: "w-[76px]" },
  { label: "Mark", numeric: true, className: "w-[84px]" },
  { label: "PnL", numeric: true, className: "w-[104px]" },
  { label: "Collateral", numeric: true, className: "w-[96px]" },
  { label: "At risk", numeric: true, className: "w-[100px]" },
  { label: "State", numeric: false, className: "w-[112px]" },
  { label: "Next event", numeric: false, className: "", wide: true },
];

/* Underlying and the next event repeat what the group header and the detail pane
   already say, so they only take a track on the widest desk with the pane shut. */
const WIDE_ONLY = "hidden 2xl:table-cell";

function unitOf(position: Position): string {
  return priceUnitSuffix(position.market.priceUnit);
}

function price(position: Position, value: number): string {
  return formatPrice(value, position.market);
}

function markText(position: Position): string {
  return position.markPrice === null ? "—" : price(position, position.markPrice);
}

/** What the position can still lose before its adverse payoff bound; fully collateralized, so never more. */
function buffer(position: Position): { level: string; detail: string } {
  return {
    level: formatCompactUsd(position.atRisk),
    detail:
      position.boundLevel === null
        ? "bounded by collateral"
        : `to ${position.side === "LONG" ? "floor" : "cap"} ${price(position, position.boundLevel)}`,
  };
}

function Stack({ top, bottom, align = "end" }: { top: ReactNode; bottom: ReactNode; align?: "end" | "start" }) {
  return (
    <span className={`flex flex-col leading-4 ${align === "end" ? "items-end" : "items-start"}`}>
      <span>{top}</span>
      <span className="text-[11px] leading-[14px] text-off">{bottom}</span>
    </span>
  );
}

function GroupHeadFigures({ group }: { group: PositionGroup }) {
  return (
    <span className="flex shrink-0 items-baseline gap-4 whitespace-nowrap">
      <span className="tnum font-mono text-[11px] text-dim">{`${formatCompactUsd(group.gross)} gross`}</span>
      <span className="tnum hidden font-mono text-[11px] text-dim xl:inline">{`${formatCompactUsd(group.net)} net`}</span>
      <span className="tnum font-mono text-[11px] text-dim">{`${formatCompactUsd(group.collateral)} collateral`}</span>
      <span className={`tnum font-mono text-[11px] ${tone(group.pnl)}`}>{formatSignedUsd(group.pnl, 0)}</span>
    </span>
  );
}

/**
 * Desktop: one dense table, grouped into a tbody per group with its subtotal.
 * Nothing is selected until the package name is pressed, so the book opens as
 * the only surface on the route.
 */
export function PositionsTable({
  groups,
  selectedId,
  onSelect,
  detailId,
  stickyHead,
  compact,
}: {
  groups: PositionGroup[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  detailId: string;
  /** Only when no ancestor between the table and the page scroller clips overflow. */
  stickyHead: boolean;
  /** Drops the wide-only columns while the detail pane shares the row. */
  compact: boolean;
}) {
  const wide = compact ? "hidden" : WIDE_ONLY;
  const head = stickyHead
    ? "bg-panel shadow-[inset_0_-1px_0_var(--color-line)] xl:sticky xl:top-[var(--sticky-top,0px)] xl:z-10"
    : "border-b border-line";
  const order = new Map(groups.flatMap((group) => group.positions).map((position, index) => [position.id, index]));
  return (
    <table className={`${TABLE} min-w-[900px] table-fixed`}>
      <caption className="sr-only">
        Open positions with entry, mark, profit and loss, locked collateral, the amount still at
        risk to the adverse payoff bound, and the next lifecycle event. Press a market name to open
        its detail.
      </caption>
      <thead>
        <tr>
          {COLUMNS.map((column) => (
            <th
              key={column.label}
              scope="col"
              className={`${TH} ${head} ${column.className} ${column.wide ? wide : ""} ${column.numeric ? "text-right" : ""}`}
            >
              {column.label}
            </th>
          ))}
        </tr>
      </thead>

      {groups.map((group) => (
        <tbody key={group.id}>
          {/* The group row is cut into the same tracks as the body, so a column
              hidden at this width never leaves a phantom track behind. */}
          <tr className="border-b border-line-soft bg-inset/70">
            <th scope="colgroup" className="h-8 px-3 text-left font-normal lg:pl-4">
              <span className="flex min-w-0 items-center gap-2.5">
                <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-ink">
                  <MarketMark underlying={knownUnderlying(group.label)} size={14} />
                  {group.label}
                </span>
                <span className="truncate text-[11px] text-faint">
                  {`${group.positions.length} ${group.positions.length === 1 ? "position" : "positions"} / ${group.detail}`}
                </span>
              </span>
            </th>
            <td className={wide} />
            <td colSpan={COLUMNS.length - 3} className="px-2.5 text-right">
              <span className="flex justify-end">
                <GroupHeadFigures group={group} />
              </span>
            </td>
            <td className={wide} />
          </tr>

          {group.positions.map((position) => {
            const selected = position.id === selectedId;
            const { level, detail } = buffer(position);
            const delay = Math.min(order.get(position.id) ?? 0, 16) * 16;
            return (
              <tr
                key={position.id}
                style={{ animationDelay: `${delay}ms` }}
                className={`${motion.enter} border-b border-line-soft transition-colors duration-150 ${
                  selected ? "bg-raised" : "hover:bg-raised/60"
                }`}
              >
                <td className={`${TD} relative py-0`}>
                  <span
                    aria-hidden="true"
                    className={`absolute inset-y-0 left-0 w-[2px] origin-top bg-brand transition-transform duration-200 ${
                      selected ? "scale-y-100" : "scale-y-0"
                    }`}
                  />
                  <span className="flex min-w-0 items-stretch gap-1">
                    <button
                      type="button"
                      aria-expanded={selected}
                      aria-controls={selected ? detailId : undefined}
                      title={selected ? "Close position detail" : "Show position detail"}
                      onClick={() => onSelect(position.id)}
                      className="focus-ring flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-sm py-1 text-left"
                    >
                      <MarketMark underlying={position.market.underlying} size={16} />
                      <span className="flex min-w-0 flex-col justify-center">
                        <span className="truncate text-[13px] leading-4 text-ink">{position.label}</span>
                        <span className="tnum truncate font-mono text-[11px] leading-[14px] text-faint">
                          {`${position.market.code} / ${positionOrigin(position)}`}
                        </span>
                      </span>
                    </button>
                    <Link
                      href={position.href}
                      aria-label={`Open the ${position.label} terminal`}
                      title="Open market"
                      className="focus-ring grid w-7 shrink-0 place-items-center rounded-sm text-off transition-colors hover:text-ink"
                    >
                      <ArrowUpRight size={14} aria-hidden="true" />
                    </Link>
                  </span>
                </td>

                <td className={`${TD} ${wide} text-dim`}>
                  <span className="flex min-w-0 items-center gap-1.5">
                    <MarketMark underlying={position.market.underlying} size={14} />
                    <span className="truncate">{position.market.underlying}</span>
                  </span>
                </td>

                <td className={NUM}>
                  <Stack
                    top={<span className="text-dim">{formatExpiry(position.market.expiryIso.slice(0, 10))}</span>}
                    bottom={`${position.daysToExpiry}d`}
                  />
                </td>

                <td className={`${NUM} ${position.side === "LONG" ? "text-up" : "text-down"}`}>
                  <Stack top={formatSigned(position.signedLots, 0)} bottom={position.side === "LONG" ? "long" : "short"} />
                </td>

                <td className={`${NUM} text-dim`}>{price(position, position.entryPrice)}</td>

                <td className={`${NUM} text-ink`}>
                  <Stack top={markText(position)} bottom={position.markPrice === null ? "no quote" : unitOf(position)} />
                </td>

                <td className={`${NUM} ${tone(position.pnl.total)}`}>{formatSignedUsd(position.pnl.total, 0)}</td>

                <td className={`${NUM} text-ink`}>{formatCompactUsd(position.collateral)}</td>

                <td className={`${NUM} text-dim`}>
                  <Stack top={level} bottom={detail} />
                </td>

                <td className={TD}>
                  <StateTag state={position.state} />
                </td>

                <td className={`${TD} ${wide} py-1.5 text-faint`} title={position.nextEvent}>
                  <span className="line-clamp-2 leading-snug">{position.nextEvent}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      ))}
    </table>
  );
}

/**
 * Narrow widths: the same rows as a task list. One row is expanded at a time
 * and pressing it again collapses it, so the book stays the primary surface.
 */
export function PositionsList({
  groups,
  selectedId,
  onSelect,
  renderDetail,
}: {
  groups: PositionGroup[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  renderDetail: (position: Position) => ReactNode;
}) {
  return (
    <div>
      {groups.map((group) => (
        <section key={group.id}>
          <h3 className="sticky top-[var(--sticky-top,0px)] z-10 flex h-9 items-center justify-between gap-3 border-b border-line-soft bg-inset px-3">
            <span className="flex min-w-0 items-center gap-2">
              <span className="flex shrink-0 items-center gap-1.5 text-[13px] font-medium text-ink">
                <MarketMark underlying={knownUnderlying(group.label)} size={14} />
                {group.label}
              </span>
              <span className="truncate text-[11px] text-faint">
                {`${group.positions.length} / ${formatCompactUsd(group.gross)} gross`}
              </span>
            </span>
            <span className={`tnum shrink-0 font-mono text-xs ${tone(group.pnl)}`}>
              {formatSignedUsd(group.pnl, 0)}
            </span>
          </h3>

          <ul>
            {group.positions.map((position) => {
              const open = position.id === selectedId;
              return (
                <li key={position.id} className="border-b border-line-soft">
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={open ? `position-detail-${position.id}` : undefined}
                    onClick={() => onSelect(position.id)}
                    className={`focus-ring flex min-h-11 w-full items-center gap-2 px-3 py-2.5 text-left transition-colors ${
                      open ? "bg-raised" : "hover:bg-raised/60"
                    }`}
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="flex min-w-0 items-center gap-2 self-center">
                          <MarketMark underlying={position.market.underlying} size={16} />
                          <span className="truncate text-sm text-ink">{position.label}</span>
                        </span>
                        <span className={`tnum shrink-0 font-mono text-[13px] ${tone(position.pnl.total)}`}>
                          {formatSignedUsd(position.pnl.total, 0)}
                        </span>
                      </span>
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="tnum truncate font-mono text-[11px] text-faint">
                          <span className={position.side === "LONG" ? "text-up" : "text-down"}>
                            {`${formatSigned(position.signedLots, 0)} lots`}
                          </span>
                          {` / ${markText(position)} ${unitOf(position)}`}
                        </span>
                        <span className="tnum shrink-0 font-mono text-[11px] text-dim">
                          {`${formatCompactUsd(position.atRisk)} at risk`}
                        </span>
                      </span>
                      <span className="flex items-baseline justify-between gap-3">
                        <StateTag state={position.state} />
                        <span className="tnum shrink-0 font-mono text-[11px] text-off">
                          {`${formatExpiry(position.market.expiryIso.slice(0, 10))} / ${position.daysToExpiry}d`}
                        </span>
                      </span>
                      <span className="truncate text-[11px] text-off">{positionOrigin(position)}</span>
                    </span>
                    <ChevronDown
                      size={15}
                      aria-hidden="true"
                      className={`shrink-0 text-faint transition-transform duration-200 ${open ? "rotate-180" : ""}`}
                    />
                  </button>

                  {open ? (
                    <div id={`position-detail-${position.id}`} className={`${motion.fade} border-t border-line bg-inset`}>
                      {renderDetail(position)}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>

          <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-1.5">
            <span className="text-[11px] text-faint">Group collateral</span>
            <span className="tnum font-mono text-[11px] text-dim">{formatUsd(group.collateral, 0)}</span>
          </div>
        </section>
      ))}
    </div>
  );
}
