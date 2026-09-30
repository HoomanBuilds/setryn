import { SCENARIO_CLOCK_ISO } from "@/lib/terminal/format";
import { advancePreviewStream, initialPreviewStream, type PreviewStreamState } from "@/lib/terminal/preview-market";
import type { PackageMarket } from "@/lib/terminal/types";

/**
 * Historical reads of the one shared preview feed.
 *
 * The feed advances every market by `advancePreviewStream` once per tick from
 * the scenario clock, so its state at any past tick is a pure function of the
 * market and the tick. Replaying it here lets a round that closed thirty seconds
 * ago carry the mark the terminal showed thirty seconds ago, without a second
 * price stream. Before the first tick the feed is the fixture snapshot.
 */

export const PREVIEW_EPOCH_SECONDS = Math.floor(Date.parse(SCENARIO_CLOCK_ISO) / 1_000);

const offsets = new Map<string, number[]>();

function offsetAt(marketId: string, tick: number): number {
  if (tick <= 0) return 0;
  let series = offsets.get(marketId);
  if (!series) {
    series = [0];
    offsets.set(marketId, series);
  }
  if (series.length <= tick) {
    let state: PreviewStreamState = { ...initialPreviewStream(marketId), tick: series.length - 1, offsetTicks: series[series.length - 1] };
    while (series.length <= tick) {
      state = advancePreviewStream(marketId, state);
      series.push(state.offsetTicks);
    }
  }
  return series[tick];
}

export interface FeedReference {
  epochSeconds: number;
  mark: number;
  bid: number;
  ask: number;
}

function round(value: number, decimals: number): number {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

/** The mark, bid and ask the shared feed published for `base` at `epochSeconds`. */
export function feedReferenceAt(base: PackageMarket, epochSeconds: number): FeedReference {
  const shift = offsetAt(base.id, Math.floor(epochSeconds - PREVIEW_EPOCH_SECONDS)) * base.tickSize;
  return {
    epochSeconds,
    mark: round(base.netPrice + shift, base.priceDecimals),
    bid: round(base.bestBid + shift, base.priceDecimals),
    ask: round(base.bestAsk + shift, base.priceDecimals),
  };
}

/** One price tick in the auction model is 10^-priceDecimals of the package price unit. */
export function tickScale(market: Pick<PackageMarket, "priceDecimals">): number {
  return 10 ** market.priceDecimals;
}

export function priceToTicks(price: number, market: Pick<PackageMarket, "priceDecimals">): number {
  return Math.round(price * tickScale(market));
}

export function ticksToPrice(ticks: number, market: Pick<PackageMarket, "priceDecimals">): number {
  return ticks / tickScale(market);
}

/** Ticks per market tick size, so offsets stay on the market's quoting grid. */
export function gridTicks(market: Pick<PackageMarket, "priceDecimals" | "tickSize">): number {
  return Math.max(1, Math.round(market.tickSize * tickScale(market)));
}
