"use client";

import { UnderlyingIcon } from "@/components/icons/AssetIcon";
import { usePreviewMarket } from "@/components/terminal/PreviewMarketProvider";
import { changePercent, formatExpiry, formatPercent, formatPrice, formatSigned, priceUnitSuffix } from "@/lib/terminal/format";
import { packageLabel } from "@/lib/terminal/markets";
import { MiniChart } from "./MiniChart";
import { platformTradeHref } from "./embed-params";

/** One market: live package mark, 24h change, mini chart and best bid/offer, all from the shared index feed. */
export function MarketWidget({ marketId, partner }: { marketId: string; partner: string | null }) {
  const { baseMarket, liveMarket, previewEpochSeconds } = usePreviewMarket(marketId);
  const change = liveMarket.netPrice - liveMarket.priorNetPrice;
  const pct = changePercent(liveMarket.netPrice, liveMarket.priorNetPrice);
  const tone = change > 0 ? "text-up" : change < 0 ? "text-down" : "text-dim";
  const unit = priceUnitSuffix(liveMarket.priceUnit);
  const spread = liveMarket.bestAsk - liveMarket.bestBid;

  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex min-w-0 items-start justify-between gap-3 px-3 pt-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <UnderlyingIcon underlying={liveMarket.underlying} size={24} />
          <div className="min-w-0">
            <h1 className="truncate text-sm font-medium text-ink">{packageLabel(liveMarket)}</h1>
            <p className="truncate font-mono text-[11px] text-faint">
              {liveMarket.code} · expires {formatExpiry(liveMarket.expiryIso)}
            </p>
          </div>
        </div>
        <a
          href={platformTradeHref(liveMarket.id, partner, "market")}
          target="_blank"
          rel="noopener noreferrer"
          className="focus-ring shrink-0 rounded-md border border-line-strong px-2 py-1 text-xs font-medium text-ink hover:bg-raised"
        >
          Trade on Setryn<span className="sr-only"> (opens in a new tab)</span>
        </a>
      </div>
      <div className="flex min-w-0 items-baseline gap-2 px-3 pt-2" aria-live="polite" aria-atomic="true">
        <span className="tnum font-mono text-2xl text-ink">{formatPrice(liveMarket.netPrice, liveMarket)}</span>
        <span className="text-xs text-faint">{unit}</span>
        <span className={`tnum ml-auto font-mono text-xs ${tone}`}>
          {formatSigned(change, liveMarket.priceDecimals)} ({formatPercent(pct, 2)})
        </span>
      </div>
      <div className="px-3 pt-2 pb-1">
        <MiniChart baseMarket={baseMarket} liveMarket={liveMarket} previewEpochSeconds={previewEpochSeconds} />
      </div>
      <dl className="grid grid-cols-3 border-t border-line text-xs">
        <div className="min-w-0 px-3 py-2">
          <dt className="text-[11px] text-faint">Best bid</dt>
          <dd className="tnum truncate font-mono text-up">{formatPrice(liveMarket.bestBid, liveMarket)}</dd>
        </div>
        <div className="min-w-0 border-l border-line px-3 py-2">
          <dt className="text-[11px] text-faint">Best offer</dt>
          <dd className="tnum truncate font-mono text-down">{formatPrice(liveMarket.bestAsk, liveMarket)}</dd>
        </div>
        <div className="min-w-0 border-l border-line px-3 py-2">
          <dt className="text-[11px] text-faint">Spread</dt>
          <dd className="tnum truncate font-mono text-dim">
            {formatPrice(spread, liveMarket)} {unit}
          </dd>
        </div>
      </dl>
    </div>
  );
}
