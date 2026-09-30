import { MARKETS } from "@/lib/terminal/markets";
import {
  advancePreviewStream,
  derivePreviewMarket,
  initialPreviewStream,
  type PreviewStreamState,
} from "@/lib/terminal/preview-market";
import type { Position } from "@/lib/portfolio/types";

export interface SessionPoint {
  /** Preview epoch seconds of the sample. */
  t: number;
  /** Open-book profit and loss at that sample. */
  pnl: number;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The open book repriced along this session's index path. The stream is
 * deterministic from tick zero, so the path is replayed through the same
 * derivation the board uses: the last sample equals the live figure exactly.
 * Only the price term moves; fees and other components stay as booked.
 */
export function sessionSeries(
  positions: Position[],
  tick: number,
  epochAtTick: number,
  maxPoints = 180,
): SessionPoint[] {
  const epochAtZero = epochAtTick - tick;
  const count = Math.min(tick + 1, maxPoints);
  const sampled = new Set<number>();
  for (let i = 0; i < count; i += 1) {
    sampled.add(count === 1 ? tick : Math.round((i * tick) / (count - 1)));
  }

  const marketIds = [...new Set(positions.map((position) => position.market.id))];
  const prices = new Map<string, Map<number, number>>();
  marketIds.forEach((id) => {
    const base = MARKETS.find((market) => market.id === id);
    const path = new Map<number, number>();
    if (!base) {
      prices.set(id, path);
      return;
    }
    let stream: PreviewStreamState = initialPreviewStream(id);
    for (let t = 0; t <= tick; t += 1) {
      if (t > 0) stream = advancePreviewStream(id, stream);
      if (sampled.has(t)) path.set(t, derivePreviewMarket(base, stream).netPrice);
    }
    prices.set(id, path);
  });

  const booked = positions.map((position) => ({
    position,
    rest: position.pnl.total - position.pnl.price,
    perPoint:
      position.lots * position.market.contractMultiplier * (position.side === "LONG" ? 1 : -1),
  }));

  return [...sampled]
    .sort((a, b) => a - b)
    .map((t) => {
      const pnl = booked.reduce((total, { position, rest, perPoint }) => {
        const price = prices.get(position.market.id)?.get(t) ?? position.markPrice;
        return total + rest + round((price - position.entryPrice) * perPoint);
      }, 0);
      return { t: epochAtZero + t, pnl: round(pnl) };
    });
}
