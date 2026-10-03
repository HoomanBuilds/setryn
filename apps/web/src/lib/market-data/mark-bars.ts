import type { PricePoint } from "./intervals";
import type { MarketCandle } from "./types";

/*
 * Mark bars from a spot history. The history is the underlying's Chainlink readings bucketed per bar (the database
 * groups them in SQL; an in-memory history is grouped here the same way), plus the reading in force when the first bar
 * opens. Each bar is the mark evaluated at its open (the reading then in force), at the bucket's highest and lowest
 * readings at their own times, and at its close (the last reading, at the bar's end). The mark rises with spot at any
 * one time, so those points bound the bar. A bar whose reading is stale (older than the feed's heartbeat allows) or
 * that overlaps a hole in the stored rounds is a gap: it has no OHLC and is drawn as empty space, never carried over.
 */

/** A bar grid (intervals.ts barGrid): bar length in seconds and the epoch offset bars align to. */
export interface BarGrid {
  step: number;
  anchor: number;
}

function barOpen(time: number, grid: BarGrid): number {
  return Math.floor((time - grid.anchor) / grid.step) * grid.step + grid.anchor;
}

export interface SpotBucket {
  time: number;
  open: number;
  openAt: number;
  high: number;
  highAt: number;
  low: number;
  lowAt: number;
  close: number;
  closeAt: number;
  rounds: number;
}

export interface SpotHistory {
  /** The reading in force when the first bar opens, with its time. */
  carry: { price: number; updatedAt: number } | null;
  /** Buckets with at least one reading, oldest first. */
  buckets: SpotBucket[];
  /** Spans whose readings were never stored. */
  holes: { from: number; to: number }[];
}

/** Groups time-ordered readings into the same buckets the database query returns. */
export function bucketPoints(points: readonly PricePoint[], grid: BarGrid, since: number, until: number): SpotHistory {
  let carry: SpotHistory["carry"] = null;
  const buckets: SpotBucket[] = [];
  for (const point of points) {
    if (point.time <= since) {
      carry = { price: point.price, updatedAt: point.time };
      continue;
    }
    if (point.time > until) break;
    const time = barOpen(point.time, grid);
    const current = buckets[buckets.length - 1];
    if (!current || current.time !== time) {
      buckets.push({
        time,
        open: point.price,
        openAt: point.time,
        high: point.price,
        highAt: point.time,
        low: point.price,
        lowAt: point.time,
        close: point.price,
        closeAt: point.time,
        rounds: 1,
      });
      continue;
    }
    if (point.price > current.high) {
      current.high = point.price;
      current.highAt = point.time;
    }
    if (point.price < current.low) {
      current.low = point.price;
      current.lowAt = point.time;
    }
    current.close = point.price;
    current.closeAt = point.time;
    current.rounds += 1;
  }
  return { carry, buckets, holes: [] };
}

/** The history with one more reading (the live one), when it is newer than every reading the history holds. */
export function withReading(
  history: SpotHistory,
  reading: { price: number; updatedAt: number },
  grid: BarGrid,
  since: number,
  until: number,
): SpotHistory {
  if (reading.updatedAt > until) return history;
  const last = history.buckets[history.buckets.length - 1];
  if (reading.updatedAt <= since) {
    if (last || (history.carry && history.carry.updatedAt >= reading.updatedAt)) return history;
    return { ...history, carry: { ...reading } };
  }
  if (last && last.closeAt >= reading.updatedAt) return history;
  if (!last && history.carry && history.carry.updatedAt >= reading.updatedAt) return history;
  const time = barOpen(reading.updatedAt, grid);
  const buckets = history.buckets.slice();
  if (last && last.time === time) {
    buckets[buckets.length - 1] = {
      ...last,
      close: reading.price,
      closeAt: reading.updatedAt,
      ...(reading.price > last.high ? { high: reading.price, highAt: reading.updatedAt } : {}),
      ...(reading.price < last.low ? { low: reading.price, lowAt: reading.updatedAt } : {}),
      rounds: last.rounds + 1,
    };
  } else {
    buckets.push({
      time,
      open: reading.price,
      openAt: reading.updatedAt,
      high: reading.price,
      highAt: reading.updatedAt,
      low: reading.price,
      lowAt: reading.updatedAt,
      close: reading.price,
      closeAt: reading.updatedAt,
      rounds: 1,
    });
  }
  return { ...history, buckets };
}

export interface MarkBars {
  /** One bar per interval from the first to `until`; a gap bar has `gap: true` and no meaningful prices. */
  candles: MarketCandle[];
  /** The spot in force at each bar's close; absent for gap bars. */
  spot: { time: number; value: number }[];
}

/**
 * Mark bars from `firstBar` to `until`. `markAt(spot, time)` is the full mark (model and basis) of one reading at one
 * time, null when it cannot be computed. `staleAfter` is the longest a reading may hold before the bar is a gap.
 */
export function buildMarkBars(input: {
  history: SpotHistory;
  grid: BarGrid;
  firstBar: number;
  until: number;
  staleAfter: number;
  markAt: (spot: number, time: number) => number | null;
}): MarkBars {
  const { history, grid, firstBar, until, staleAfter, markAt } = input;
  const step = grid.step;
  const candles: MarketCandle[] = [];
  const spot: MarkBars["spot"] = [];
  let carry = history.carry;
  let index = 0;
  // Buckets before the first bar only move the reading in force.
  while (index < history.buckets.length && history.buckets[index].time < firstBar) {
    const bucket = history.buckets[index];
    carry = { price: bucket.close, updatedAt: bucket.closeAt };
    index += 1;
  }
  const fresh = (reading: SpotHistory["carry"], at: number) => reading !== null && at - reading.updatedAt <= staleAfter;
  for (let time = firstBar; time <= until; time += step) {
    const end = Math.min(time + step, until);
    const bucket = history.buckets[index]?.time === time ? history.buckets[index++] : undefined;
    const points: number[] = [];
    let open: number | null = null;
    if (fresh(carry, time)) open = markAt((carry as NonNullable<typeof carry>).price, time);
    if (bucket) {
      const first = markAt(bucket.open, bucket.openAt);
      open ??= first;
      if (first !== null) points.push(first);
      const high = markAt(bucket.high, bucket.highAt);
      const low = markAt(bucket.low, bucket.lowAt);
      if (high !== null) points.push(high);
      if (low !== null) points.push(low);
      carry = { price: bucket.close, updatedAt: bucket.closeAt };
    }
    const close = fresh(carry, end) ? markAt((carry as NonNullable<typeof carry>).price, end) : null;
    const inHole = history.holes.some((hole) => hole.from < end && hole.to > time);
    if (open === null || close === null || inHole) {
      candles.push({ time, open: 0, high: 0, low: 0, close: 0, volume: 0, gap: true });
      continue;
    }
    points.push(open, close);
    candles.push({ time, open, high: Math.max(...points), low: Math.min(...points), close, volume: 0 });
    spot.push({ time, value: (carry as NonNullable<typeof carry>).price });
  }
  return { candles, spot };
}
