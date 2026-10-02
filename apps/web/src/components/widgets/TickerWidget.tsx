"use client";

import { UnderlyingIcon } from "@/components/icons/AssetIcon";
import { useMarketBoard } from "@/components/market-data/MarketDataProvider";
import { changePercent, formatPercent, formatPrice, priceUnitSuffix } from "@/lib/terminal/format";
import { platformTradeHref } from "./embed-params";

/** Scrolling strip of marks and 24h change from the market-data feed. */
export function TickerWidget({ marketIds, partner }: { marketIds: string[]; partner: string | null }) {
  const { markets } = useMarketBoard();
  const shown = marketIds.map((id) => markets.find((market) => market.id === id)).filter((market) => market !== undefined);

  return (
    <div
      role="region"
      aria-label="Setryn market ticker"
      tabIndex={0}
      className="focus-ring scroll-thin flex min-w-0 items-stretch overflow-x-auto"
    >
      <ul className="flex min-w-max items-stretch">
        {shown.map((market) => {
          const change = changePercent(market.netPrice, market.priorNetPrice);
          const moved = Number.isFinite(change);
          const tone = change > 0 ? "text-up" : change < 0 ? "text-down" : "text-dim";
          return (
            <li key={market.id} className="border-r border-line last:border-r-0">
              <a
                href={platformTradeHref(market.id, partner, "ticker")}
                target="_blank"
                rel="noopener noreferrer"
                className="focus-ring flex h-full flex-col gap-0.5 px-3 py-2 hover:bg-raised"
              >
                <span className="flex items-center gap-1.5 font-mono text-[11px] whitespace-nowrap text-faint">
                  <UnderlyingIcon underlying={market.underlying} size={13} />
                  {market.code}
                </span>
                <span className="flex items-baseline gap-2 whitespace-nowrap">
                  <span className="tnum font-mono text-sm text-ink">
                    {formatPrice(market.netPrice, market)}
                    <span className="ml-0.5 text-[11px] text-faint">{priceUnitSuffix(market.priceUnit)}</span>
                  </span>
                  <span className={`tnum font-mono text-[11px] ${moved ? tone : "text-faint"}`}>
                    {moved ? formatPercent(change, 2) : "—"}
                  </span>
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
