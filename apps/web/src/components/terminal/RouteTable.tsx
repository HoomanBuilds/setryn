"use client";

import { SourceMark } from "@/components/terminal/primitives";
import { GUARANTEE_COPY, routePrice, type ExecutableAction } from "@/lib/terminal/economics";
import { formatLots, formatNumber, priceUnitSuffix } from "@/lib/terminal/format";
import type { PackageMarket, RouteQuote } from "@/lib/terminal/types";

export const ROUTE_HINT_ID = "ticket-route-hint";

function Radio({ on, blocked }: { on: boolean; blocked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`mt-[3px] flex h-[13px] w-[13px] shrink-0 items-center justify-center rounded-full border ${
        on ? "border-brand" : blocked ? "border-line" : "border-line-strong"
      }`}
    >
      {on ? <span className="h-[6px] w-[6px] rounded-full bg-brand" /> : null}
    </span>
  );
}

export function RouteTable({
  market,
  action,
  privateRfq,
  selectedId,
  onSelect,
  amendmentMode = false,
}: {
  market: PackageMarket;
  action: ExecutableAction;
  privateRfq: boolean;
  selectedId: string | null;
  onSelect: (routeId: string) => void;
  amendmentMode?: boolean;
}) {
  const usable = market.routes.filter((route) => !route.requiresPrivate || privateRfq);
  const best = usable.length
    ? usable.reduce((winner, route) => {
        const price = routePrice(route, action);
        const winning = routePrice(winner, action);
        if (action === "BUY") return price < winning ? route : winner;
        return price > winning ? route : winner;
      })
    : null;

  const feeBps = (route: RouteQuote) => route.protocolFeeBps + route.counterpartyFeeBps;
  const unit = priceUnitSuffix(market.priceUnit);

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 px-2 pb-1 text-xs text-faint">
        <span>Route</span>
        <span>{`All-in, ${unit}`}</span>
      </div>

      {selectedId ? null : (
        <p id={ROUTE_HINT_ID} className="px-2 pb-1.5 text-xs leading-snug text-faint">
          Pick a route to set price, fees, and guarantee.
        </p>
      )}

      <div
        role="radiogroup"
        aria-label="Execution route"
        className="divide-y divide-line border-y border-line"
      >
        {market.routes.map((route) => {
          const blocked = amendmentMode ? route.requiresPrivate : route.requiresPrivate && !privateRfq;
          const selected = route.id === selectedId;
          const price = routePrice(route, action);
          const guarantee = GUARANTEE_COPY[route.guarantee];

          return (
            <button
              key={route.id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={blocked}
              onClick={() => onSelect(route.id)}
              className={`focus-ring block w-full border-l-2 px-2 py-2 text-left transition-colors ${
                selected
                  ? "border-brand bg-raised"
                  : blocked
                    ? "cursor-not-allowed border-transparent opacity-55"
                    : "border-transparent hover:bg-raised/60"
              }`}
            >
              <span className="flex items-start gap-2">
                <Radio on={selected} blocked={blocked} />
                <span className="flex min-w-0 flex-1 items-baseline gap-2">
                  <span
                    className={`flex min-w-0 items-center gap-1.5 text-sm ${selected ? "text-ink" : "text-dim"}`}
                  >
                    <SourceMark source={route.source} />
                    <span className="truncate">{route.label}</span>
                  </span>
                  {best?.id === route.id && !blocked ? (
                    <span className="shrink-0 rounded-sm bg-inset px-1.5 text-xs text-dim">
                      best
                    </span>
                  ) : null}
                </span>
                <span className="tnum shrink-0 font-mono text-sm text-ink">
                  {formatNumber(price, market.priceDecimals)}
                </span>
              </span>

              <span className="mt-1 block pl-[21px] text-xs leading-snug text-faint">
                {blocked
                  ? amendmentMode && route.requiresPrivate
                    ? "Solver RFQ routes cannot rest as replacements."
                    : "Turn on private RFQ to request this route."
                  : `${formatNumber(feeBps(route), 1)} bp fees / ${guarantee.label} / ${formatLots(route.availableLots)} lots / ${route.etaLabel}`}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
