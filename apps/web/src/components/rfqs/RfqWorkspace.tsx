"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useGatewaySnapshot } from "@/components/gateway/InternalGatewayProvider";
import { SectionLabel, StatusDot } from "@/components/terminal/primitives";
import { formatLots, formatNumber, formatUsd, priceUnitSuffix } from "@/lib/terminal/format";
import { DEFAULT_TRADE_HREF, findMarket, tradeHref } from "@/lib/terminal/markets";
import type { RfqRequest, RfqRequestState } from "@/lib/internal-gateway/types";

function timestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function secondsLeft(value: string, now: number): number {
  return Math.max(0, Math.ceil((Date.parse(value) - now) / 1000));
}

function stateLabel(state: RfqRequestState, expired: boolean): string {
  if (expired && (state === "OPEN" || state === "SELECTED")) return "Expired";
  if (state === "OPEN") return "Open";
  if (state === "SELECTED") return "Quote selected";
  if (state === "EXECUTED") return "Executed";
  return "Cancelled";
}

function stateClass(state: RfqRequestState, expired: boolean): string {
  if (expired && (state === "OPEN" || state === "SELECTED")) return "text-faint";
  if (state === "OPEN") return "text-brand";
  if (state === "SELECTED") return "text-up";
  if (state === "EXECUTED") return "text-dim";
  return "text-faint";
}

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-faint">{label}</dt>
      <dd className="tnum mt-0.5 truncate font-mono text-xs text-ink">{value}</dd>
    </div>
  );
}

function RfqCard({ request, now }: { request: RfqRequest; now: number }) {
  const intent = request.authorization.intent;
  const market = findMarket(intent.marketId);
  const knownMarket = market.id === intent.marketId ? market : null;
  const selectedQuote = request.selectedQuoteId
    ? (request.quotes.find((quote) => quote.id === request.selectedQuoteId) ?? null)
    : null;
  const requestLeft = secondsLeft(request.expiresAt, now);
  const requestExpired = Date.parse(request.expiresAt) <= now;
  const requestActive =
    (request.state === "OPEN" || request.state === "SELECTED") && !requestExpired;

  return (
    <article
      aria-label={`RFQ request ${request.id}`}
      className="border border-line bg-panel"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-3 py-2.5">
        <div className="min-w-0">
          <h3 className="truncate text-sm text-ink">{intent.packageCode}</h3>
          <p className="tnum mt-0.5 truncate font-mono text-xs text-faint">{request.id}</p>
        </div>
        <span className={`shrink-0 text-xs ${stateClass(request.state, requestExpired)}`}>
          {stateLabel(request.state, requestExpired)}
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-3 py-3 sm:grid-cols-3">
        <Meta
          label="Side and size"
          value={`${intent.side === "ENTER" ? "Enter" : "Exit"} · ${formatLots(intent.lots)} lots`}
        />
        <Meta
          label="Limit"
          value={
            knownMarket
              ? `${formatNumber(intent.limitPrice, knownMarket.priceDecimals)} ${priceUnitSuffix(knownMarket.priceUnit)}`
              : `${formatNumber(intent.limitPrice, 2)}`
          }
        />
        <Meta label="Route" value={intent.routeLabel} />
        <Meta label="Created" value={timestamp(request.createdAt)} />
        <Meta
          label="Expires"
          value={requestExpired ? `${timestamp(request.expiresAt)} · expired` : `${timestamp(request.expiresAt)} · ${requestLeft}s left`}
        />
        <Meta
          label="Selected quote"
          value={
            selectedQuote
              ? `Selected · ${selectedQuote.solverLabel}`
              : request.state === "SELECTED"
                ? "Selected quote unavailable"
                : "Awaiting selection"
          }
        />
        {intent.side === "EXIT" ? (
          <Meta label="Close position" value={intent.closePositionId ?? "none"} />
        ) : null}
      </dl>

      {knownMarket ? null : (
        <p className="border-t border-line px-3 py-2 text-xs leading-snug text-faint">
          Market definition unavailable in this session, so this request cannot resume in a terminal.
        </p>
      )}

      <div className="border-t border-line px-3 py-2">
        <SectionLabel>
          {`Firm quotes · ${request.quotes.length}`}
        </SectionLabel>
        {request.quotes.length === 0 ? (
          <p className="mt-1.5 text-xs leading-snug text-faint">No firm quotes recorded.</p>
        ) : (
          <ul className="mt-1.5 divide-y divide-line">
            {request.quotes.map((quote) => {
              const isSelected = quote.id === request.selectedQuoteId;
              const left = secondsLeft(quote.expiresAt, now);
              const expired = Date.parse(quote.expiresAt) <= now;
              return (
                <li key={quote.id} className="py-2 first:pt-1 last:pb-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs text-ink">
                      {isSelected ? `Selected · ${quote.solverLabel}` : quote.solverLabel}
                    </span>
                    <span className="tnum font-mono text-xs text-ink">
                      {knownMarket
                        ? `${formatNumber(quote.packagePrice, knownMarket.priceDecimals)} ${priceUnitSuffix(knownMarket.priceUnit)}`
                        : formatNumber(quote.packagePrice, 2)}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] leading-snug text-dim">
                    <span className="tnum font-mono">{`${formatUsd(quote.feeCap, 2)} cap`}</span>
                    <span className="tnum font-mono">{`${quote.capacityLots} lots`}</span>
                    <span>{quote.settlementGuarantee}</span>
                    <span className="tnum font-mono">{expired ? "Expired" : `${left}s`}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {requestExpired && (request.state === "OPEN" || request.state === "SELECTED") ? (
        <p className="border-t border-line px-3 py-2 text-xs leading-snug text-faint">
          Request expired before execution, so no execution was created.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2 border-t border-line px-3 py-2.5">
        {requestActive && knownMarket ? (
          <Link
            href={`${tradeHref(knownMarket)}?rfq=${encodeURIComponent(request.id)}`}
            className="focus-ring inline-flex h-9 items-center rounded-md border border-line px-3 text-xs text-dim transition-colors hover:border-line-strong hover:text-ink"
          >
            Continue in terminal
          </Link>
        ) : null}
        {request.state === "EXECUTED" && request.receiptId ? (
          <Link
            href={`/activity/receipts/${request.receiptId}`}
            className="focus-ring inline-flex h-9 items-center rounded-md border border-line px-3 text-xs text-dim transition-colors hover:border-line-strong hover:text-ink"
          >
            Open execution receipt
          </Link>
        ) : null}
      </div>
    </article>
  );
}

export function RfqWorkspace() {
  const snapshot = useGatewaySnapshot();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const requests = useMemo(
    () =>
      [...snapshot.rfqRequests].sort(
        (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
      ),
    [snapshot.rfqRequests],
  );
  const active = requests.filter(
    (request) =>
      (request.state === "OPEN" || request.state === "SELECTED") &&
      Date.parse(request.expiresAt) > now,
  );
  const history = requests.filter(
    (request) =>
      request.state === "EXECUTED" ||
      request.state === "CANCELLED" ||
      ((request.state === "OPEN" || request.state === "SELECTED") &&
        Date.parse(request.expiresAt) <= now),
  );

  return (
    <main className="scroll-thin min-h-0 flex-1 overflow-y-auto bg-app p-3 sm:p-5 lg:p-6">
      <div className="mx-auto max-w-[1200px]">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-4">
          <div>
            <SectionLabel>RFQ ledger</SectionLabel>
            <h1 className="mt-2 text-xl font-medium text-ink">Private RFQ requests</h1>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-dim">
              Private solver requests from this browser demo, with every firm quote comparison.
              Active requests resume in their market terminal. Receipts exist only for executed
              requests.
            </p>
          </div>
          <div className="flex items-center gap-2 border border-line bg-panel px-3 py-2">
            <StatusDot ok />
            <div>
              <p className="text-xs text-ink">{snapshot.environment.label}</p>
              <p className="text-xs text-faint">{snapshot.environment.evidence.toLowerCase()} evidence</p>
            </div>
          </div>
        </div>

        <p className="mt-4 border border-line bg-panel px-3 py-2.5 text-xs leading-relaxed text-faint">
          Local demo only. Requests, quotes, and receipts live in this browser session and are never
          broadcast to Arbitrum. This page never creates a request and offers no maker controls.
        </p>

        <section aria-label="Active requests" className="mt-6">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-medium text-ink">Active requests</h2>
            <span className="tnum font-mono text-xs text-faint">{active.length}</span>
          </div>
          {active.length === 0 ? (
            <div className="mt-3 border border-line bg-panel px-4 py-6 text-center">
              <p className="text-sm text-ink">No active private RFQ requests.</p>
              <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-faint">
                A private solver request created in a market terminal appears here until it is
                selected, executed, or cancelled.
              </p>
              <Link
                href={DEFAULT_TRADE_HREF}
                className="focus-ring mt-4 inline-flex h-9 items-center rounded-md border border-line px-3 text-xs text-dim transition-colors hover:border-line-strong hover:text-ink"
              >
                Open package market
              </Link>
            </div>
          ) : (
            <div className="mt-3 grid gap-3 xl:grid-cols-2">
              {active.map((request) => (
                <RfqCard key={request.id} request={request} now={now} />
              ))}
            </div>
          )}
        </section>

        <section aria-label="Request history" className="mt-8">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-medium text-ink">History</h2>
            <span className="tnum font-mono text-xs text-faint">{history.length}</span>
          </div>
          {history.length === 0 ? (
            <div className="mt-3 border border-line bg-panel px-4 py-6 text-center">
              <p className="text-sm text-ink">No executed or cancelled requests yet.</p>
              <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-faint">
                Executed requests keep their receipt link here. Cancelled requests remain visible
                without one.
              </p>
            </div>
          ) : (
            <div className="mt-3 grid gap-3 xl:grid-cols-2">
              {history.map((request) => (
                <RfqCard key={request.id} request={request} now={now} />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
