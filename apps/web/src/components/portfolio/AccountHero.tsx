"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Chip, Skeleton, motion } from "@/components/markets/ui";
import { SessionChart } from "@/components/portfolio/SessionChart";
import { sessionSeries } from "@/components/portfolio/session";
import type { PortfolioRead } from "@/components/portfolio/usePortfolio";
import { tone } from "@/components/terminal/primitives";
import {
  formatCompactUsd,
  formatMultiple,
  formatNumber,
  formatShare,
  formatSignedCompactUsd,
  formatSignedUsd,
} from "@/lib/terminal/format";
import { CollateralMark } from "@/components/portfolio/MarketMark";

type Series = "pnl" | "value";

const SERIES: { id: Series; label: string }[] = [
  { id: "pnl", label: "PnL" },
  { id: "value", label: "Account value" },
];

function Tile({
  label,
  value,
  note,
  valueTone = "text-ink",
  loading,
  children,
  title,
  mark = false,
}: {
  label: string;
  value: string;
  note?: ReactNode;
  valueTone?: string;
  loading: boolean;
  children?: ReactNode;
  title?: string;
  /** Leads the figure with the collateral mark, for balances held in the settlement asset. */
  mark?: boolean;
}) {
  return (
    <div title={title} className="flex min-w-0 flex-col gap-0.5 px-3 py-2.5 lg:px-4">
      <span className="truncate text-[11px] text-faint">{label}</span>
      {loading ? (
        <Skeleton className="my-0.5 h-4 w-24" />
      ) : (
        <span className={`tnum flex min-w-0 items-center gap-1.5 font-mono text-[15px] leading-5 ${valueTone}`}>
          {mark ? <CollateralMark size={15} /> : null}
          <span className="truncate">{value}</span>
        </span>
      )}
      {children}
      {note ? <span className="truncate text-[11px] text-off">{note}</span> : null}
    </div>
  );
}

/**
 * The account at a glance: the equity figure in the landing serif, the open
 * book's PnL through its fills and marks, and the balances behind it.
 */
export function AccountHero({ read }: { read: PortfolioRead }) {
  const { snapshot, portfolio, board } = read;
  const { account, runtimePnl, runtimePositions } = portfolio;
  const asset = snapshot.account.collateralAsset;
  const loading = snapshot.wallet.status === "CONNECTING";
  const [series, setSeries] = useState<Series>("pnl");
  const feed = board.snapshot;
  /* History is rebuilt per feed snapshot; between snapshots the clock only extends the last point. */
  const asOf = feed?.asOf ?? 0;

  const path = useMemo(
    () => sessionSeries(runtimePositions, snapshot.receipts, feed, Math.max(asOf, 0)),
    [runtimePositions, snapshot.receipts, feed, asOf],
  );
  const points = useMemo(
    () =>
      path.map((point) => ({
        t: point.t,
        v: series === "pnl" ? point.pnl : account.equity + point.pnl,
      })),
    [path, series, account.equity],
  );

  const marked = account.equity + runtimePnl.total;
  const pnlShare = account.equity === 0 ? 0 : runtimePnl.total / account.equity;
  const [whole, fraction] = formatNumber(account.equity, 2).split(".");
  const empty = runtimePositions.length === 0 || points.length < 2;
  const feedLabel =
    board.status === "LIVE" ? "Live marks" : board.status === "STALE" ? "Marks stale" : board.status === "ERROR" ? "Marks unavailable" : "Loading marks";
  const unmarked = portfolio.unmarked;
  const usage = Math.min(1, account.marginUsage);

  return (
    <div className="grid grid-cols-1 gap-1 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <section
        aria-label="Account equity"
        className={`${motion.enter} flex min-w-0 flex-col border-y border-line bg-panel lg:rounded-lg lg:border`}
      >
        <div className="flex flex-1 flex-col lg:flex-row">
          <div className="flex shrink-0 flex-col gap-3 px-3 pt-4 pb-3 lg:w-[272px] lg:border-r lg:border-line-soft lg:px-5 lg:py-5">
            <div className="flex items-center gap-2">
              <span className="text-xs text-dim">Account equity</span>
              <Chip tone="muted" title={`Read from the ${snapshot.environment.label} collateral vault.`}>
                Onchain
              </Chip>
            </div>
            {loading ? (
              <Skeleton className="h-11 w-44" />
            ) : (
              <p className="flex items-baseline gap-2 text-ink">
                <span className="tnum font-serif text-[46px] leading-[44px] font-normal tracking-[-0.02em]">
                  {whole}
                  <span className="text-dim">{`.${fraction}`}</span>
                </span>
                <span className="flex items-center gap-1 self-center font-mono text-xs text-faint">
                  <CollateralMark size={14} />
                  {asset}
                </span>
              </p>
            )}
            <div className="flex flex-col gap-1.5 border-t border-line-soft pt-3">
              <Line
                label="Unrealized PnL"
                value={
                  <span className={tone(runtimePnl.total)}>
                    {`${formatSignedUsd(runtimePnl.total, 2)}`}
                    <span className="ml-1.5 text-off">{`${runtimePnl.total >= 0 ? "+" : "-"}${formatShare(Math.abs(pnlShare), 2)}`}</span>
                  </span>
                }
                title={
                  unmarked > 0
                    ? `${unmarked} position${unmarked === 1 ? " has" : "s have"} no live mark yet and count at entry. Marks are not settlement values.`
                    : "Open positions marked at the book mid, last fill or Chainlink reference. Not settlement values."
                }
              />
              <Line label="Marked value" value={formatNumber(marked, 2)} />
              <Line label="Available" value={`${formatNumber(account.available, 2)} ${asset}`} />
            </div>
          </div>

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex h-10 items-stretch justify-between gap-2 border-y border-line-soft px-2 lg:border-t-0 lg:px-3">
              <div role="tablist" aria-label="Chart series" className="flex items-stretch">
                {SERIES.map((item) => {
                  const selected = item.id === series;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      onClick={() => setSeries(item.id)}
                      className={`focus-ring relative px-2.5 text-xs transition-colors duration-150 ${
                        selected ? "text-ink" : "text-faint hover:text-dim"
                      }`}
                    >
                      {item.label}
                      <span
                        aria-hidden="true"
                        className={`absolute inset-x-2 bottom-0 h-[2px] origin-center rounded-t-sm bg-brand transition-transform duration-200 ease-out ${
                          selected ? "scale-x-100" : "scale-x-0"
                        }`}
                      />
                    </button>
                  );
                })}
              </div>
              <span className="flex items-center gap-1.5">
                <Chip
                  tone="muted"
                  title="Each position from its opening fill, marked at every onchain fill of its market and then at the live mark. Fees are booked at the fill."
                >
                  Fills and marks
                </Chip>
                <Chip tone="neutral" title="Marks come from the onchain book, onchain fills and Chainlink references at one block.">
                  {feedLabel}
                </Chip>
              </span>
            </div>
            <div className="relative min-h-[180px] flex-1">
              <div className="absolute inset-0 px-2 pt-2 pb-1 lg:px-3">
              <SessionChart
                points={points}
                baseline={series === "pnl" ? 0 : account.equity}
                format={(value) =>
                  Math.abs(value) >= 10_000
                    ? `${formatNumber(value / 1000, 1)}k`
                    : formatNumber(value, Math.abs(value) >= 100 ? 0 : 2)
                }
                label={`${series === "pnl" ? "Open book profit and loss" : "Marked account value"} through its fills and marks.`}
                empty={
                  empty ? (
                    <span className="rounded-md bg-panel px-3 py-1 text-center text-xs text-faint">
                      {runtimePositions.length === 0 ? "No open positions." : "No marks since the opening fill yet."}
                      <span className="block text-off">
                        {runtimePositions.length === 0 ? "The curve starts with the first fill." : "The curve moves with the next fill or mark."}
                      </span>
                    </span>
                  ) : undefined
                }
              />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section
        aria-label="Balances and exposure"
        style={{ animationDelay: "60ms" }}
        className={`${motion.enter} grid min-w-0 grid-cols-2 gap-px overflow-hidden border-y border-line bg-line-soft lg:rounded-lg lg:border [&>*]:bg-panel`}
      >
        <Tile
          label="Eligible collateral"
          value={formatNumber(account.eligible, 2)}
          note={`${asset}, no haircut`}
          loading={loading}
          mark
        />
        <Tile
          label="Reserved"
          value={formatNumber(account.reserved, 2)}
          note={`${formatShare(account.marginUsage)} of eligible`}
          loading={loading}
          mark
        />
        <Tile label="Posted" value={formatNumber(account.postedValue, 2)} note={`onchain ${asset}`} loading={loading} mark />
        <Tile
          label="Reservation use"
          value={formatShare(account.marginUsage)}
          loading={loading}
          title="Reserved collateral as a share of eligible collateral."
        >
          <span aria-hidden="true" className="mt-0.5 block h-[3px] w-full overflow-hidden rounded-full bg-line-strong">
            <span
              className={`block h-full rounded-full transition-[width] duration-300 ease-out ${usage > 0.8 ? "bg-down" : usage > 0.6 ? "bg-brand" : "bg-up"}`}
              style={{ width: `${Math.max(usage > 0 ? 2 : 0, usage * 100)}%` }}
            />
          </span>
        </Tile>
        <Tile
          label="Gross exposure"
          value={formatCompactUsd(portfolio.runtimeGross)}
          note={`${runtimePositions.length} active package${runtimePositions.length === 1 ? "" : "s"}`}
          loading={loading}
        />
        <Tile
          label="Net exposure"
          value={formatSignedCompactUsd(portfolio.runtimeNet)}
          valueTone={tone(portfolio.runtimeNet)}
          note="signed package notional"
          loading={loading}
        />
        <Tile
          label="Collateral cover"
          value={account.maintenanceMargin === 0 ? "Nothing locked" : formatMultiple(account.healthFactor)}
          valueTone={account.maintenanceMargin === 0 ? "text-dim" : "text-ink"}
          note={account.maintenanceMargin === 0 ? "no bounded liability" : `${formatNumber(account.maintenanceMargin, 0)} locked, fully collateralized`}
          loading={loading}
          title="Marked collateral equity over the collateral positions and orders lock. Every position is fully collateralized, so nothing can be liquidated."
        />
        <Tile
          label="Account PnL"
          value={formatSignedUsd(runtimePnl.total, 0)}
          valueTone={tone(runtimePnl.total)}
          note={unmarked > 0 ? `${unmarked} unmarked` : "at live marks"}
          loading={loading}
        />
      </section>
    </div>
  );
}

function Line({ label, value, title }: { label: string; value: ReactNode; title?: string }) {
  return (
    <div title={title} className="flex items-baseline justify-between gap-3">
      <span className="text-[11px] text-faint">{label}</span>
      <span className="tnum truncate font-mono text-xs text-dim">{value}</span>
    </div>
  );
}
