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
}: {
  label: string;
  value: string;
  note?: ReactNode;
  valueTone?: string;
  loading: boolean;
  children?: ReactNode;
  title?: string;
}) {
  return (
    <div title={title} className="flex min-w-0 flex-col gap-0.5 px-3 py-2.5 lg:px-4">
      <span className="truncate text-[11px] text-faint">{label}</span>
      {loading ? (
        <Skeleton className="my-0.5 h-4 w-24" />
      ) : (
        <span className={`tnum truncate font-mono text-[15px] leading-5 ${valueTone}`}>{value}</span>
      )}
      {children}
      {note ? <span className="truncate text-[11px] text-off">{note}</span> : null}
    </div>
  );
}

/**
 * The account at a glance: the equity figure in the landing serif, the open
 * book repriced along this session's preview path, and the balances behind it.
 */
export function AccountHero({ read }: { read: PortfolioRead }) {
  const { snapshot, portfolio, tick, previewEpochSeconds } = read;
  const { account, runtimePnl, runtimePositions } = portfolio;
  const asset = snapshot.account.collateralAsset;
  const loading = snapshot.wallet.status === "CONNECTING";
  const [series, setSeries] = useState<Series>("pnl");

  const path = useMemo(
    () => sessionSeries(runtimePositions, tick, previewEpochSeconds),
    [runtimePositions, tick, previewEpochSeconds],
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
  const empty = runtimePositions.length === 0;
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
                <span className="font-mono text-xs text-faint">{asset}</span>
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
                title="Open packages marked against the coherent preview feed. Not oracle settlement values."
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
                  title="The open book repriced along this session's preview path. Only the price term moves; fees stay as booked."
                >
                  Session
                </Chip>
                <Chip tone="neutral" title="Marks come from the coherent local preview feed.">
                  Preview marks
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
                label={`${series === "pnl" ? "Open book profit and loss" : "Marked account value"} over this session, repriced on the preview feed.`}
                empty={
                  empty ? (
                    <span className="rounded-md bg-panel px-3 py-1 text-center text-xs text-faint">
                      No open packages.
                      <span className="block text-off">The curve starts with the first fill.</span>
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
          note={`${asset}, no haircut in runtime`}
          loading={loading}
        />
        <Tile
          label="Reserved"
          value={formatNumber(account.reserved, 2)}
          note={`${formatShare(account.marginUsage)} of eligible`}
          loading={loading}
        />
        <Tile label="Posted" value={formatNumber(account.postedValue, 2)} note={`onchain ${asset}`} loading={loading} />
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
          label="Maintenance health"
          value={account.maintenanceMargin === 0 ? "No requirement" : formatMultiple(account.healthFactor)}
          valueTone={account.maintenanceMargin === 0 ? "text-dim" : "text-ink"}
          note={account.maintenanceMargin === 0 ? "no active margin" : `${formatNumber(account.maintenanceMargin, 0)} maintenance`}
          loading={loading}
        />
        <Tile
          label="Account PnL"
          value={formatSignedUsd(runtimePnl.total, 0)}
          valueTone={tone(runtimePnl.total)}
          note="development feed marks"
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
