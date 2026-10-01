"use client";

import { useState } from "react";
import { AssetAmount, UnderlyingIcon } from "@/components/icons/AssetIcon";
import { useLiveMarket } from "@/components/market-data/MarketDataProvider";
import { availableRoutes, buildPreview, executableAction, routePrice, type PackageSide } from "@/lib/terminal/economics";
import { formatLotCount, formatNumber, formatPrice, priceUnitSuffix } from "@/lib/terminal/format";
import { packageLabel } from "@/lib/terminal/markets";
import { platformTradeHref } from "./embed-params";

/**
 * Read-only quote. It runs the terminal's own ticket economics against the public book route of the market-data feed,
 * so the price and fees match what the order ticket would show. With no resting liquidity on the side it says so.
 * Nothing is signed here: the only action is a link to the platform with the side and size handed off.
 */
export function TradeWidget({
  marketId,
  partner,
  initialSide,
  initialLots,
}: {
  marketId: string;
  partner: string | null;
  initialSide: PackageSide;
  initialLots: number;
}) {
  const { market: liveMarket } = useLiveMarket(marketId);
  const [side, setSide] = useState<PackageSide>(initialSide);
  const [lots, setLots] = useState(String(initialLots));
  const action = executableAction("ENTER", side);
  const routes = availableRoutes(liveMarket, false);
  // The best priced public route; a route without a price on this side never wins over one with a price.
  const route =
    routes.length === 0
      ? null
      : routes.reduce((best, candidate) => {
          const price = routePrice(candidate, action);
          const winning = routePrice(best, action);
          if (!Number.isFinite(price)) return best;
          if (!Number.isFinite(winning)) return candidate;
          return action === "BUY" ? (price < winning ? candidate : best) : price > winning ? candidate : best;
        });
  const touch = route ? routePrice(route, action) : action === "BUY" ? liveMarket.bestAsk : liveMarket.bestBid;
  const quoted = Number.isFinite(touch);
  const reference = quoted ? touch : liveMarket.netPrice;
  const preview = buildPreview(
    liveMarket,
    {
      intent: "ENTER",
      side,
      orderType: "MARKETABLE_LIMIT",
      lotsInput: lots,
      limitInput: String(reference),
      tif: "IOC",
      expiresAt: null,
      privateRfq: false,
      routeId: route?.id ?? null,
      closePositionId: null,
    },
    route,
  );
  const lotCount = Math.max(0, Math.floor(Number(lots) || 0));
  const unit = priceUnitSuffix(liveMarket.priceUnit);
  const lotsId = `trade-lots-${marketId}`;

  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex min-w-0 items-center gap-2.5 px-3 pt-3">
        <UnderlyingIcon underlying={liveMarket.underlying} size={22} />
        <div className="min-w-0">
          <h1 className="truncate text-sm font-medium text-ink">{packageLabel(liveMarket)}</h1>
          <p className="truncate text-[11px] text-faint">Quote from the onchain book. Execution happens on Setryn.</p>
        </div>
      </div>
      <div className="grid grid-cols-[1fr_auto] items-end gap-2 px-3 pt-3">
        <fieldset className="min-w-0">
          <legend className="mb-1 text-[11px] text-faint">Direction</legend>
          <div className="grid grid-cols-2 overflow-hidden rounded-md border border-line-strong">
            {(["LONG", "SHORT"] as const).map((option) => (
              <label
                key={option}
                className={`focus-within:outline-brand flex cursor-pointer items-center justify-center py-1.5 text-xs font-medium focus-within:outline focus-within:outline-1 focus-within:-outline-offset-1 ${
                  side === option ? (option === "LONG" ? "bg-up-soft text-up" : "bg-down-soft text-down") : "text-dim hover:bg-raised"
                }`}
              >
                <input
                  type="radio"
                  name={`side-${marketId}`}
                  value={option}
                  checked={side === option}
                  onChange={() => setSide(option)}
                  className="sr-only"
                />
                {option === "LONG" ? "Long" : "Short"}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="w-24">
          <label htmlFor={lotsId} className="mb-1 block text-[11px] text-faint">
            Lots
          </label>
          <input
            id={lotsId}
            inputMode="numeric"
            value={lots}
            onChange={(event) => setLots(event.target.value.replace(/[^0-9]/g, "").slice(0, 4))}
            className="tnum focus-ring w-full rounded-md border border-line-strong bg-inset px-2 py-1 text-right font-mono text-sm text-ink"
          />
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-line px-3 py-2 text-xs" aria-live="polite">
        <dt className="text-faint">{action === "BUY" ? "Best offer" : "Best bid"}</dt>
        <dd className="tnum text-right font-mono text-ink">
          {quoted ? `${formatPrice(touch, liveMarket)} ${unit}` : "No resting orders"}
        </dd>
        <dt className="text-faint">Consideration</dt>
        <dd className="tnum text-right font-mono text-dim">
          {quoted ? <AssetAmount value={formatNumber(preview.notional, 2)} symbol="USDC" /> : "—"}
        </dd>
        <dt className="text-faint">Est. fees</dt>
        <dd className="tnum text-right font-mono text-dim">
          {quoted && Number.isFinite(preview.totalFees) ? <AssetAmount value={formatNumber(preview.totalFees, 2)} symbol="USDC" /> : "—"}
        </dd>
        <dt className="text-faint">Collateral</dt>
        <dd className="tnum text-right font-mono text-dim"><AssetAmount value={formatNumber(preview.totalCollateral, 0)} symbol="USDC" /></dd>
        <dt className="text-faint">Guarantee</dt>
        <dd className="truncate text-right text-dim">{preview.settlementGuarantee}</dd>
      </dl>
      {preview.blockers.length > 0 ? (
        <p role="status" className="px-3 pb-2 text-[11px] text-dim">
          {preview.blockers[0]}
        </p>
      ) : null}
      <div className="px-3 pb-3">
        <a
          href={platformTradeHref(liveMarket.id, partner, "trade", { side, lots: lotCount > 0 ? lotCount : undefined })}
          target="_blank"
          rel="noopener noreferrer"
          className="focus-ring flex w-full items-center justify-center rounded-md bg-brand px-3 py-2 text-sm font-medium text-app hover:opacity-90"
        >
          Trade {lotCount > 0 ? formatLotCount(lotCount) : ""} on Setryn<span className="sr-only"> (opens in a new tab)</span>
        </a>
      </div>
    </div>
  );
}
