"use client";

import Link from "next/link";
import { ArrowUpRight, ChevronDown } from "lucide-react";
import { NUM, StateTag, TABLE, TD, TH } from "@/components/portfolio/panels";
import { tone } from "@/components/terminal/primitives";
import {
  daysToExpiry,
  formatCompactUsd,
  formatExpiry,
  formatPrice,
  formatShare,
  formatSigned,
  formatSignedUsd,
  formatUsd,
  priceUnitSuffix,
} from "@/lib/terminal/format";
import type { Position, PositionGroup } from "@/lib/portfolio/types";
import { positionOrigin } from "@/lib/portfolio/runtime";

const COLUMNS = [
  { label: "Package", numeric: false, width: "w-[230px]" },
  { label: "Underlying", numeric: false, width: "w-[76px]" },
  { label: "Expiry", numeric: true, width: "w-[102px]" },
  { label: "Lots", numeric: true, width: "w-[58px]" },
  { label: "Entry", numeric: true, width: "w-[66px]" },
  { label: "Mark", numeric: true, width: "w-[68px]" },
  { label: "Total PnL", numeric: true, width: "w-[100px]" },
  { label: "Collateral", numeric: true, width: "w-[100px]" },
  { label: "Liq / buffer", numeric: true, width: "w-[94px]" },
  { label: "State", numeric: false, width: "w-[104px]" },
  { label: "Next event", numeric: false, width: "" },
];

function unitOf(position: Position): string {
  return priceUnitSuffix(position.market.priceUnit);
}

function price(position: Position, value: number): string {
  return formatPrice(value, position.market);
}

function buffer(position: Position): { level: string; detail: string } {
  return {
    level:
      position.liquidationPrice === null
        ? "No quote level"
        : price(position, position.liquidationPrice),
    detail: `${formatShare(position.bufferShare, 0)} buffer`,
  };
}

function GroupHeadFigures({ group }: { group: PositionGroup }) {
  return (
    <span className="flex shrink-0 items-baseline gap-4 whitespace-nowrap">
      <span className="tnum font-mono text-xs text-dim">
        {`${formatCompactUsd(group.gross)} gross`}
      </span>
      <span className="tnum hidden font-mono text-xs text-dim xl:inline">
        {`${formatCompactUsd(group.net)} net`}
      </span>
      <span className="tnum font-mono text-xs text-dim">
        {`${formatCompactUsd(group.collateral)} collateral`}
      </span>
      <span className={`tnum font-mono text-xs ${tone(group.pnl)}`}>
        {formatSignedUsd(group.pnl, 0)}
      </span>
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
}: {
  groups: PositionGroup[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  detailId: string;
}) {
  return (
    <div className="scroll-thin min-w-0 overflow-x-auto">
      <table className={`${TABLE} min-w-[1130px] table-fixed`}>
        <caption className="sr-only">
          Open package positions with entry, mark, profit and loss attribution total, posted
          collateral, risk buffer, and the next lifecycle event. Press a package name to open its
          detail.
        </caption>
        <thead className="bg-panel">
          <tr className="border-b border-line">
            {COLUMNS.map((column) => (
              <th
                key={column.label}
                scope="col"
                className={`${TH} ${column.width} ${column.numeric ? "text-right" : ""}`}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>

        {groups.map((group) => (
          <tbody key={group.id}>
            <tr>
              <th
                scope="colgroup"
                colSpan={COLUMNS.length}
                className="border-y border-line bg-inset px-3 py-1.5 text-left font-normal"
              >
                <span className="flex items-baseline justify-between gap-4">
                  <span className="flex min-w-0 items-baseline gap-2.5">
                    <span className="shrink-0 text-[13px] font-semibold text-ink">
                      {group.label}
                    </span>
                    <span className="truncate text-xs text-faint">
                      {`${group.positions.length} ${group.positions.length === 1 ? "position" : "positions"} / ${group.detail}`}
                    </span>
                  </span>
                  <GroupHeadFigures group={group} />
                </span>
              </th>
            </tr>

            {group.positions.map((position, positionIndex) => {
              const selected = position.id === selectedId;
              const { level, detail } = buffer(position);
              return (
                <tr
                  key={position.id}
                  className={`border-b border-line-soft transition-colors ${
                    selected
                      ? "bg-raised"
                      : `${positionIndex % 2 === 0 ? "bg-panel" : "bg-inset/35"} hover:bg-raised/60`
                  }`}
                >
                  <td className={`${TD} relative py-0`}>
                    {selected ? (
                      <span
                        aria-hidden="true"
                        className="absolute inset-y-0 left-0 w-[2px] bg-brand"
                      />
                    ) : null}
                    <span className="flex min-w-0 items-stretch gap-1">
                      <button
                        type="button"
                        aria-expanded={selected}
                        aria-controls={selected ? detailId : undefined}
                        title={selected ? "Close position detail" : "Show position detail"}
                        onClick={() => onSelect(position.id)}
                        className="focus-ring flex min-h-10 min-w-0 flex-1 flex-col justify-center py-1.5 text-left"
                      >
                        <span className="truncate text-[13px] text-ink">{position.label}</span>
                      <span className="tnum truncate font-mono text-xs text-faint">
                        {position.market.code}
                      </span>
                      <span className="truncate text-xs text-off">{positionOrigin(position)}</span>
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

                  <td className={`${TD} truncate text-dim`}>{position.market.underlying}</td>

                  <td className={NUM}>
                    <span className="flex flex-col items-end">
                      <span className="text-dim">{formatExpiry(position.market.expiryIso)}</span>
                      <span className="text-off">{`${position.daysToExpiry}d`}</span>
                    </span>
                  </td>

                  <td className={`${NUM} ${position.side === "LONG" ? "text-up" : "text-down"}`}>
                    <span className="flex flex-col items-end">
                      <span>{formatSigned(position.signedLots, 0)}</span>
                      <span className="text-off">
                        {position.side === "LONG" ? "long" : "short"}
                      </span>
                    </span>
                  </td>

                  <td className={`${NUM} text-dim`}>
                    {price(position, position.entryPrice)}
                  </td>

                  <td className={`${NUM} text-ink`}>
                    <span className="flex flex-col items-end">
                      <span>{price(position, position.markPrice)}</span>
                      <span className="text-off">{unitOf(position)}</span>
                    </span>
                  </td>

                  <td className={`${NUM} ${tone(position.pnl.total)}`}>
                    {formatSignedUsd(position.pnl.total, 0)}
                  </td>

                  <td className={`${NUM} text-ink`}>
                    {formatCompactUsd(position.collateral)}
                  </td>

                  <td className={`${NUM} text-dim`}>
                    <span className="flex flex-col items-end">
                      <span>{level}</span>
                      <span className="text-off">{detail}</span>
                    </span>
                  </td>

                  <td className={TD}>
                    <StateTag state={position.state} />
                  </td>

                  <td className={`${TD} py-1.5 text-faint`} title={position.nextEvent}>
                    <span className="line-clamp-2 leading-snug">{position.nextEvent}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>
    </div>
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
  renderDetail: (position: Position) => React.ReactNode;
}) {
  return (
    <div>
      {groups.map((group) => (
        <section key={group.id}>
          <h3 className="flex h-9 items-center justify-between gap-3 border-y border-line bg-inset px-3">
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="shrink-0 text-[13px] font-semibold text-ink">{group.label}</span>
              <span className="truncate text-xs text-faint">
                {`${group.positions.length} / ${formatCompactUsd(group.gross)} gross`}
              </span>
            </span>
            <span className={`tnum shrink-0 font-mono text-xs ${tone(group.pnl)}`}>
              {formatSignedUsd(group.pnl, 0)}
            </span>
          </h3>

          <ul>
            {group.positions.map((position, positionIndex) => {
              const open = position.id === selectedId;
              return (
                <li
                  key={position.id}
                  className={`border-b border-line ${
                    positionIndex % 2 === 0 ? "bg-panel" : "bg-inset/35"
                  }`}
                >
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={open ? `position-detail-${position.id}` : undefined}
                    onClick={() => onSelect(position.id)}
                    className={`focus-ring flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left transition-colors ${
                      open ? "bg-raised" : "hover:bg-raised/60"
                    }`}
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="truncate text-sm text-ink">{position.label}</span>
                        <span
                          className={`tnum shrink-0 font-mono text-xs ${tone(position.pnl.total)}`}
                        >
                          {formatSignedUsd(position.pnl.total, 0)}
                        </span>
                      </span>
                      <span className="truncate text-xs text-off">{positionOrigin(position)}</span>
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="tnum truncate font-mono text-xs text-faint">
                          {`${formatSigned(position.signedLots, 0)} lots / ${price(position, position.markPrice)} ${unitOf(position)}`}
                        </span>
                        <span className="tnum shrink-0 font-mono text-xs text-dim">
                          {`${formatShare(position.bufferShare, 0)} buffer`}
                        </span>
                      </span>
                      <span className="flex items-baseline justify-between gap-3">
                        <StateTag state={position.state} />
                        <span className="tnum shrink-0 font-mono text-xs text-off">
                          {`${formatExpiry(position.market.expiryIso)} / ${daysToExpiry(position.market.expiryIso)}d`}
                        </span>
                      </span>
                    </span>
                    <ChevronDown
                      size={15}
                      aria-hidden="true"
                      className={`shrink-0 text-faint transition-transform ${open ? "rotate-180" : ""}`}
                    />
                  </button>

                  {open ? (
                    <div
                      id={`position-detail-${position.id}`}
                      className="border-t border-line bg-inset"
                    >
                      {renderDetail(position)}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>

          <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-1.5">
            <span className="text-xs text-faint">Group collateral</span>
            <span className="tnum font-mono text-xs text-dim">
              {formatUsd(group.collateral, 0)}
            </span>
          </div>
        </section>
      ))}
    </div>
  );
}
