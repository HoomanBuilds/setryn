"use client";

import { useEffect, useState } from "react";
import { SectionLabel } from "@/components/terminal/primitives";
import { formatNumber, formatUsd, priceUnitSuffix } from "@/lib/terminal/format";
import type { PackageMarket } from "@/lib/terminal/types";
import type { RfqRequest } from "@/lib/internal-gateway/types";

export function RfqQuotePanel({
  market,
  rfqRequest,
  rfqError,
  onSelectRfqQuote,
  onExecuteRfqQuote,
  onCancelRfq,
}: {
  market: PackageMarket;
  rfqRequest: RfqRequest | null;
  rfqError: string | null;
  onSelectRfqQuote?: (quoteId: string) => void;
  onExecuteRfqQuote?: () => void;
  onCancelRfq?: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const unit = priceUnitSuffix(market.priceUnit);

  if (!rfqRequest) {
    return (
      <div className="overflow-hidden rounded-md border border-line-strong bg-raised">
        <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
          <SectionLabel>Firm quotes</SectionLabel>
          <span className="text-xs text-dim">Private</span>
        </div>
        <p className="px-3 py-2.5 text-xs leading-snug text-dim">
          No quotes available - no execution was created.
        </p>
        {rfqError ? (
          <p className="px-3 pb-2.5 text-xs leading-snug text-down">{rfqError}</p>
        ) : null}
      </div>
    );
  }

  const requestedLots = rfqRequest.authorization.intent.lots;
  const requestSecondsLeft = Math.max(
    0,
    Math.ceil((Date.parse(rfqRequest.expiresAt) - now) / 1000),
  );
  const requestExpired = Date.parse(rfqRequest.expiresAt) <= now;

  if (rfqRequest.state === "CANCELLED") {
    return (
      <div className="overflow-hidden rounded-md border border-line-strong bg-raised">
        <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
          <SectionLabel>Firm quotes</SectionLabel>
          <span className="tnum font-mono text-xs text-dim">{rfqRequest.id}</span>
        </div>
        <div className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs">
          <span className="text-dim">Private</span>
          <span className="tnum font-mono text-dim">0s</span>
        </div>
        <p className="border-t border-line px-3 py-2.5 text-xs leading-snug text-dim">
          Request cancelled - no execution was created.
        </p>
        {rfqError ? (
          <p className="px-3 pb-2.5 text-xs leading-snug text-down">{rfqError}</p>
        ) : null}
      </div>
    );
  }

  if (requestExpired) {
    return (
      <div className="overflow-hidden rounded-md border border-line-strong bg-raised">
        <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
          <SectionLabel>Firm quotes</SectionLabel>
          <span className="tnum font-mono text-xs text-dim">{rfqRequest.id}</span>
        </div>
        <div className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs">
          <span className="text-dim">Private</span>
          <span className="tnum font-mono text-dim">0s</span>
        </div>
        <ul className="divide-y divide-line border-t border-line">
          {rfqRequest.quotes.map((quote) => (
            <li key={quote.id} className="px-3 py-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs text-ink">
                  {quote.solverLabel}
                  {quote.provenance === "LOCAL_DEMO" ? (
                    <span className="ml-2 border border-line px-1 font-mono text-[10px] text-dim">
                      LOCAL_DEMO
                    </span>
                  ) : null}
                </span>
                <span className="tnum font-mono text-xs text-ink">
                  {`${formatNumber(quote.packagePrice, market.priceDecimals)} ${unit}`}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] leading-snug text-dim">
                <span className="tnum font-mono">{`${formatUsd(quote.feeCap, 2)} cap`}</span>
                <span className="tnum font-mono">{`${quote.capacityLots} lots`}</span>
                <span>{quote.settlementGuarantee}</span>
                <span className="tnum font-mono">Expired</span>
              </div>
            </li>
          ))}
        </ul>
        <p className="border-t border-line px-3 py-2.5 text-xs leading-snug text-dim">
          Request expired - no execution was created.
        </p>
        {rfqError ? (
          <p className="px-3 pb-2.5 text-xs leading-snug text-down">{rfqError}</p>
        ) : null}
        <div className="px-3 pb-3">
          <button
            type="button"
            onClick={() => onCancelRfq?.()}
            className="focus-ring h-11 w-full rounded-md border border-line text-sm text-dim transition-colors hover:border-line-strong hover:text-ink lg:h-9"
          >
            Cancel request
          </button>
        </div>
      </div>
    );
  }

  if (rfqRequest.state === "SELECTED") {
    const selected =
      rfqRequest.quotes.find((quote) => quote.id === rfqRequest.selectedQuoteId) ?? null;
    if (!selected) {
      return (
        <div className="overflow-hidden rounded-md border border-line-strong bg-raised">
          <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
            <SectionLabel>Firm quotes</SectionLabel>
            <span className="tnum font-mono text-xs text-dim">{rfqRequest.id}</span>
          </div>
          <p className="px-3 py-2.5 text-xs leading-snug text-dim">
            Selected quote unavailable - no execution was created.
          </p>
          {rfqError ? (
            <p className="px-3 pb-2.5 text-xs leading-snug text-down">{rfqError}</p>
          ) : null}
          <div className="px-3 pb-3">
            <button
              type="button"
              onClick={() => onCancelRfq?.()}
              className="focus-ring h-11 w-full rounded-md border border-line text-sm text-dim transition-colors hover:border-line-strong hover:text-ink lg:h-9"
            >
              Cancel request
            </button>
          </div>
        </div>
      );
    }
    const selectedExpired = Date.parse(selected.expiresAt) <= now;
    return (
      <div className="overflow-hidden rounded-md border border-line-strong bg-raised">
        <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
          <SectionLabel>Firm quotes</SectionLabel>
          <span className="tnum font-mono text-xs text-dim">{rfqRequest.id}</span>
        </div>
        <div className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs">
          <span className="text-dim">Private</span>
          <span className="tnum font-mono text-dim">{`${requestSecondsLeft}s`}</span>
        </div>
        <ul className="divide-y divide-line border-t border-line">
          {rfqRequest.quotes.map((quote) => {
            const isSelected = quote.id === selected.id;
            const secondsLeft = Math.max(
              0,
              Math.ceil((Date.parse(quote.expiresAt) - now) / 1000),
            );
            const expired = Date.parse(quote.expiresAt) <= now;
            return (
              <li
                key={quote.id}
                className={isSelected ? "bg-inset px-3 py-2" : "px-3 py-2"}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs text-ink">
                    {isSelected ? `Selected · ${quote.solverLabel}` : quote.solverLabel}
                    {quote.provenance === "LOCAL_DEMO" ? (
                      <span className="ml-2 border border-line px-1 font-mono text-[10px] text-dim">
                        LOCAL_DEMO
                      </span>
                    ) : null}
                  </span>
                  <span className="tnum font-mono text-xs text-ink">
                    {`${formatNumber(quote.packagePrice, market.priceDecimals)} ${unit}`}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] leading-snug text-dim">
                  <span className="tnum font-mono">{`${formatUsd(quote.feeCap, 2)} cap`}</span>
                  <span className="tnum font-mono">{`${quote.capacityLots} lots`}</span>
                  <span>{quote.settlementGuarantee}</span>
                  <span className="tnum font-mono">
                    {expired ? "Expired" : `${secondsLeft}s`}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
        {selectedExpired ? (
          <p className="border-t border-line px-3 py-2.5 text-xs leading-snug text-dim">
            Selected quote expired - no execution was created.
          </p>
        ) : null}
        {rfqError ? (
          <p className="border-t border-line px-3 py-2.5 text-xs leading-snug text-down">
            {rfqError}
          </p>
        ) : null}
        <div className="grid grid-cols-2 gap-2 px-3 py-3">
          <button
            type="button"
            onClick={() => onCancelRfq?.()}
            className="focus-ring h-11 rounded-md border border-line text-sm text-dim transition-colors hover:border-line-strong hover:text-ink lg:h-9"
          >
            Cancel request
          </button>
          <button
            type="button"
            disabled={selectedExpired}
            onClick={() => onExecuteRfqQuote?.()}
            className={`focus-ring h-11 rounded-md text-sm font-semibold transition-colors lg:h-9 ${
              selectedExpired
                ? "cursor-not-allowed bg-raised text-dim"
                : "bg-brand text-app hover:brightness-105"
            }`}
          >
            Authorize selected quote
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-line-strong bg-raised">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <SectionLabel>Firm quotes</SectionLabel>
        <span className="tnum font-mono text-xs text-dim">{rfqRequest.id}</span>
      </div>
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs">
        <span className="text-dim">Private</span>
        <span className="tnum font-mono text-dim">{`${requestSecondsLeft}s`}</span>
      </div>
      <ul className="divide-y divide-line border-t border-line">
        {rfqRequest.quotes.map((quote) => {
          const secondsLeft = Math.max(
            0,
            Math.ceil((Date.parse(quote.expiresAt) - now) / 1000),
          );
          const expired = Date.parse(quote.expiresAt) <= now;
          const fullSize = quote.capacityLots + 1e-9 >= requestedLots;
          const selectable = !expired && fullSize;
          return (
            <li key={quote.id} className="px-3 py-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs text-ink">
                  {quote.solverLabel}
                  {quote.provenance === "LOCAL_DEMO" ? (
                    <span className="ml-2 border border-line px-1 font-mono text-[10px] text-dim">
                      LOCAL_DEMO
                    </span>
                  ) : null}
                </span>
                <span className="tnum font-mono text-xs text-ink">
                  {`${formatNumber(quote.packagePrice, market.priceDecimals)} ${unit}`}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] leading-snug text-dim">
                <span className="tnum font-mono">{`${formatUsd(quote.feeCap, 2)} cap`}</span>
                <span className="tnum font-mono">{`${quote.capacityLots} lots`}</span>
                <span>{quote.settlementGuarantee}</span>
                <span className="tnum font-mono">
                  {expired ? "Expired" : `${secondsLeft}s`}
                </span>
              </div>
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <span className="text-[11px] leading-snug text-faint">
                  {expired
                    ? "Expired - no execution was created."
                    : fullSize
                      ? `${requestedLots} lots covered`
                      : `Covers ${quote.capacityLots} of ${requestedLots} lots`}
                </span>
                {selectable ? (
                  <button
                    type="button"
                    onClick={() => onSelectRfqQuote?.(quote.id)}
                    className="focus-ring h-8 shrink-0 rounded-md border border-line px-2.5 text-xs text-ink transition-colors hover:border-line-strong"
                  >
                    Select quote
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {rfqError ? (
        <p className="border-t border-line px-3 py-2.5 text-xs leading-snug text-down">
          {rfqError}
        </p>
      ) : null}
      <div className="px-3 py-3">
        <button
          type="button"
          onClick={() => onCancelRfq?.()}
          className="focus-ring h-11 w-full rounded-md border border-line text-sm text-dim transition-colors hover:border-line-strong hover:text-ink lg:h-9"
        >
          Cancel request
        </button>
      </div>
    </div>
  );
}
