"use client";

import Link from "next/link";
import { ArrowUpRight, FileCheck2, Lock, TriangleAlert } from "lucide-react";
import { formatLots, formatUsd } from "@/lib/terminal/format";
import { tradeHref } from "@/lib/terminal/markets";
import {
  BUTTON_PRIMARY,
  BUTTON_QUIET,
  Chip,
  CopyButton,
  TtlBar,
  formatCountdown,
  formatUtcFull,
  formatUtcTime,
  middleTruncate,
  motion,
} from "@/components/activity/ledger-ui";
import { StatusChip } from "./RfqBlotter";
import { priceText, signedPriceText, unitText, type RankedQuote, type RfqView } from "./rfq-view";

function Term({ label, value, title }: { label: string; value: React.ReactNode; title?: string }) {
  return (
    <div className="min-w-0 py-2" title={title}>
      <dt className="truncate text-[11px] text-faint">{label}</dt>
      <dd className="tnum mt-0.5 truncate font-mono text-xs text-ink">{value}</dd>
    </div>
  );
}

function QuoteRow({ entry, view, now, index }: { entry: RankedQuote; view: RfqView; now: number; index: number }) {
  const { quote } = entry;
  const improvementTone =
    entry.improvement > 0 ? "text-up" : entry.improvement < 0 ? "text-down" : "text-faint";
  const edge = entry.isSelected
    ? "border-up/40 bg-up-soft/40"
    : entry.isBest
      ? "border-brand-edge bg-brand-soft/40"
      : "border-line";
  return (
    <li
      style={{ ["--i" as string]: index }}
      className={`${motion.stagger} rounded-md border ${edge} px-3 py-2.5 transition-colors duration-150`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`tnum flex h-5 w-5 shrink-0 items-center justify-center rounded-sm font-mono text-[11px] ${
            entry.isBest ? "bg-brand text-app" : "bg-raised text-faint"
          }`}
          aria-label={`Rank ${entry.rank}`}
        >
          {entry.rank}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-ink">{quote.solverLabel}</span>
        {entry.isSelected ? <Chip tone="up">Selected</Chip> : null}
        {entry.isBest && !entry.isSelected ? <Chip tone="brand">Best</Chip> : null}
        {quote.provenance === "DEVNET_MAKER" ? (
          <Chip tone="muted" title="Quote from the local devnet market maker">
            Devnet
          </Chip>
        ) : null}
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-3">
        <span className="tnum font-mono text-base text-ink">
          {priceText(quote.packagePrice, view.market, false)}
          <span className="ml-1 text-[11px] text-faint">{unitText(view.market)}</span>
        </span>
        <span className={`tnum font-mono text-xs ${improvementTone}`}>
          {`${signedPriceText(entry.improvement, view.market)} vs limit`}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5">
        <span className="relative h-[3px] overflow-hidden rounded-full bg-line-strong" aria-hidden="true">
          <span
            className={`absolute inset-y-0 left-0 rounded-full ${entry.isBest ? "bg-brand" : "bg-dim"}`}
            style={{ width: `${Math.round(entry.coverage * 100)}%` }}
          />
        </span>
        <span className="tnum font-mono text-[11px] text-dim">{`${formatLots(quote.capacityLots)} lots capacity`}</span>
        {view.active ? (
          <TtlBar startMs={view.createdMs} endMs={entry.expiresMs} now={now} />
        ) : (
          <span className="text-[11px] text-faint">{entry.expired ? "Quote expired" : "Quote closed"}</span>
        )}
        <span className="tnum text-right font-mono text-[11px] text-dim">{`${formatUsd(quote.feeCap, 2)} cap`}</span>
      </div>
      <p className="mt-1.5 truncate text-[11px] text-faint" title={quote.settlementGuarantee}>
        {quote.settlementGuarantee}
      </p>
    </li>
  );
}

export function RfqDetail({ view, now }: { view: RfqView; now: number }) {
  const { request, market } = view;
  const intent = request.authorization.intent;
  const secondsLeft = Math.max(0, Math.ceil((view.expiresMs - now) / 1000));
  const bestTone =
    view.best && view.best.improvement > 0
      ? "text-up"
      : view.best && view.best.improvement < 0
        ? "text-down"
        : "text-faint";

  return (
    <div key={request.id} className={`flex min-h-0 flex-1 flex-col ${motion.fade}`}>
      <div role="region" tabIndex={0} aria-label="RFQ detail" className="focus-ring scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className="border-b border-line px-4 pt-3.5 pb-3">
          <div className="flex items-center gap-2">
            <StatusChip view={view} />
            <Chip tone="neutral" className="gap-1">
              <Lock size={10} aria-hidden="true" />
              Private
            </Chip>
            <span className="ml-auto flex min-w-0 items-center">
              <span title={request.id} className="tnum truncate font-mono text-[11px] text-faint">
                {middleTruncate(request.id, 8, 6)}
              </span>
              <CopyButton value={request.id} label="RFQ request ID" />
            </span>
          </div>
          <h2 className="mt-2 truncate text-sm font-medium text-ink">{intent.packageCode}</h2>
          <p className={`mt-0.5 text-xs ${view.action === "BUY" ? "text-up" : "text-down"}`}>
            {`${view.intentLabel} ${view.sideLabel} · ${view.actionLabel} ${formatLots(intent.lots)} lots`}
          </p>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="min-w-0">
              <div className="text-[11px] text-faint">
                {view.selected ? "Selected quote" : "Best firm quote"}
              </div>
              <div className="mt-0.5 flex items-baseline gap-1.5">
                <span className="tnum font-serif text-[28px] leading-8 text-ink">
                  {view.selected
                    ? priceText(view.selected.packagePrice, market, false)
                    : view.best
                      ? priceText(view.best.quote.packagePrice, market, false)
                      : "—"}
                </span>
                <span className="text-xs text-faint">{unitText(market)}</span>
              </div>
              <div className={`tnum mt-0.5 font-mono text-[11px] ${bestTone}`}>
                {view.best ? `${signedPriceText(view.best.improvement, market)} vs limit` : "No firm quotes recorded."}
              </div>
            </div>
            <div className="min-w-0 text-right">
              <div className="text-[11px] text-faint">Request window</div>
              <div
                className={`tnum mt-0.5 font-serif text-[28px] leading-8 ${
                  !view.active ? "text-faint" : secondsLeft <= 10 ? "text-down" : "text-ink"
                }`}
              >
                {view.status === "EXECUTED" ? "Filled" : view.status === "CANCELLED" ? "Closed" : view.expired ? "0s" : formatCountdown(secondsLeft)}
              </div>
              <div className="mt-0.5 text-[11px] text-faint">
                {view.expired ? `expired ${formatUtcTime(request.expiresAt)}` : `until ${formatUtcTime(request.expiresAt)}`}
              </div>
            </div>
          </div>
          {view.status === "OPEN" || view.status === "SELECTED" ? (
            <TtlBar startMs={view.createdMs} endMs={view.expiresMs} now={now} showLabel={false} className="mt-3" />
          ) : null}
        </div>

        <dl className="grid grid-cols-2 gap-x-4 border-b border-line px-4 py-1.5 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
          <Term label="Size" value={`${formatLots(intent.lots)} lots`} />
          <Term label="Limit" value={priceText(intent.limitPrice, market)} />
          <Term label="Time in force" value={intent.timeInForce} />
          <Term label="Route" value={intent.routeLabel} title={intent.routeLabel} />
          <Term label="Fee cap" value={formatUsd(intent.feeCap, 2)} />
          <Term
            label="Collateral bound"
            value={intent.collateralRequired > 0 ? formatUsd(intent.collateralRequired, 2) : "Not bound"}
          />
          <Term label="Created" value={formatUtcTime(request.createdAt)} title={formatUtcFull(request.createdAt)} />
          <Term label="Expires" value={formatUtcTime(request.expiresAt)} title={formatUtcFull(request.expiresAt)} />
          {intent.side === "EXIT" ? <Term label="Close position" value={intent.closePositionId ?? "none"} /> : null}
          <Term
            label="Selected quote"
            value={
              view.selected
                ? view.selected.solverLabel
                : request.state === "SELECTED"
                  ? "Unavailable"
                  : "Awaiting selection"
            }
          />
        </dl>

        {market ? null : (
          <p className="flex items-start gap-2 border-b border-line px-4 py-2.5 text-xs leading-snug text-faint">
            <TriangleAlert size={13} aria-hidden="true" className="mt-0.5 shrink-0 text-dim" />
            Market definition unavailable in this session, so this request cannot resume in a terminal.
          </p>
        )}

        {view.status === "EXPIRED" ? (
          <p className="flex items-start gap-2 border-b border-line px-4 py-2.5 text-xs leading-snug text-faint">
            <TriangleAlert size={13} aria-hidden="true" className="mt-0.5 shrink-0 text-dim" />
            Request expired before execution, so no execution was created.
          </p>
        ) : null}

        <section aria-label="Quote competition" className="px-4 py-3">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-xs font-medium text-ink">Quote competition</h3>
            <span className="tnum font-mono text-[11px] text-faint">
              {`${view.quotes.length} firm · ${view.makers} maker${view.makers === 1 ? "" : "s"}`}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-faint">
            {view.action === "BUY" ? "Ranked lowest ask first." : "Ranked highest bid first."} Capacity is shown
            against the requested size.
          </p>
          {view.quotes.length === 0 ? (
            <p className="mt-3 rounded-md border border-dashed border-line-strong px-3 py-4 text-center text-xs text-faint">
              No firm quotes recorded.
            </p>
          ) : (
            <ol className="mt-2.5 space-y-1.5">
              {view.quotes.map((entry, index) => (
                <QuoteRow key={entry.quote.id} entry={entry} view={view} now={now} index={index} />
              ))}
            </ol>
          )}
        </section>
      </div>

      <div className="shrink-0 space-y-2 border-t border-line bg-panel px-4 py-3">
        <Link href={`/rfqs/${encodeURIComponent(request.id)}`} className={`${BUTTON_QUIET} h-9 w-full`}>
          Open quote competition
          <ArrowUpRight size={13} aria-hidden="true" />
        </Link>
        {view.active || (request.state === "EXECUTED" && request.receiptId) ? (
          <div className="flex gap-2">
            {view.active && market ? (
              <Link
                href={`${tradeHref(market)}?rfq=${encodeURIComponent(request.id)}`}
                className={`${BUTTON_PRIMARY} h-9 flex-1`}
              >
                Continue in terminal
                <ArrowUpRight size={13} aria-hidden="true" />
              </Link>
            ) : null}
            {request.state === "EXECUTED" && request.receiptId ? (
              <Link href={`/activity/receipts/${request.receiptId}`} className={`${BUTTON_QUIET} h-9 flex-1`}>
                <FileCheck2 size={13} aria-hidden="true" />
                Open execution receipt
              </Link>
            ) : null}
          </div>
        ) : null}
        <p className="text-[11px] leading-snug text-faint">
          Committed to the local production-parity chain. Nothing here submits to Arbitrum Sepolia or mainnet.
        </p>
      </div>
    </div>
  );
}
