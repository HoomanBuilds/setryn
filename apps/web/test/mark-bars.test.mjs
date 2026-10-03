import assert from "node:assert/strict";
import test from "node:test";

import { bucketPoints, buildMarkBars, withReading } from "../src/lib/market-data/mark-bars.ts";

const grid = { step: 60, anchor: 0 };
const markAt = (spot, time) => spot + time / 1e9;

test("bars carry the reading in force, bound each bar by its readings, and close on the last one", () => {
  const points = [
    { time: 30, price: 100, lots: 0 },
    { time: 70, price: 104, lots: 0 },
    { time: 80, price: 98, lots: 0 },
    { time: 100, price: 101, lots: 0 },
  ];
  const history = bucketPoints(points, grid, 60, 179);
  assert.deepEqual(history.carry, { price: 100, updatedAt: 30 });
  const { candles, spot } = buildMarkBars({ history, grid, firstBar: 60, until: 179, staleAfter: 1_000, markAt });
  assert.equal(candles.length, 2);
  const [first, second] = candles;
  assert.equal(Math.round(first.open), 100);
  assert.equal(Math.round(first.high), 104);
  assert.equal(Math.round(first.low), 98);
  assert.equal(Math.round(first.close), 101);
  // Nothing printed in the second bar: it holds the last reading, it does not invent a move.
  assert.equal(Math.round(second.open), 101);
  assert.equal(Math.round(second.close), 101);
  assert.deepEqual(spot.map((point) => point.value), [101, 101]);
});

test("a stale reading or a hole in the stored rounds is a gap, never a carried price", () => {
  const history = bucketPoints([{ time: 0, price: 100, lots: 0 }], grid, 0, 600);
  const stale = buildMarkBars({ history, grid, firstBar: 60, until: 300, staleAfter: 120, markAt });
  assert.deepEqual(stale.candles.map((candle) => Boolean(candle.gap)), [false, true, true, true, true]);
  assert.equal(stale.spot.length, 1);
  const holed = buildMarkBars({ history: { ...history, holes: [{ from: 130, to: 170 }] }, grid, firstBar: 60, until: 240, staleAfter: 10_000, markAt });
  assert.deepEqual(holed.candles.map((candle) => Boolean(candle.gap)), [false, true, false, false]);
});

test("a newer live reading closes the last bar", () => {
  const history = bucketPoints([{ time: 30, price: 100, lots: 0 }, { time: 70, price: 102, lots: 0 }], grid, 60, 200);
  const live = withReading(history, { price: 107, updatedAt: 125 }, grid, 60, 200);
  assert.equal(live.buckets.length, 2);
  assert.equal(live.buckets[1].close, 107);
  assert.equal(withReading(live, { price: 90, updatedAt: 110 }, grid, 60, 200), live, "an older reading changes nothing");
});

test("the first partial bar never evaluates the mark before market activation", () => {
  const history = bucketPoints([{ time: 80, price: 100, lots: 0 }], grid, 90, 119);
  const { candles } = buildMarkBars({ history, grid, firstBar: 60, activeFrom: 90, until: 119, staleAfter: 1_000, markAt: (_spot, time) => time });
  assert.equal(candles.length, 1);
  assert.equal(candles[0].time, 60);
  assert.equal(candles[0].open, 90);
  assert.equal(candles[0].close, 119);
});
