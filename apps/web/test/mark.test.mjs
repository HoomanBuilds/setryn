import assert from "node:assert/strict";
import test from "node:test";

import { cappedForwardMark, expectedClamp, MARK_METHODOLOGY_VERSION, MARK_PARAMETERS, markBasis } from "../src/lib/pricing/mark.ts";

const NOW = 1_790_000_000;
const DAY = 86_400;
const eth = (days) => ({ underlying: "ETH", floor: 1340, cap: 4020, expiryAt: NOW + days * DAY, tickSize: 0.1, priceDecimals: 1 });

test("the mark is versioned, modeled, and stays one tick inside the band", () => {
  const mark = cappedForwardMark(eth(90), 2760, NOW);
  assert.equal(mark.model.version, MARK_METHODOLOGY_VERSION);
  assert.equal(mark.model.provenance, "MODELED");
  assert.equal(mark.model.parameterSet, MARK_PARAMETERS.id);
  assert.ok(mark.price > 1340 && mark.price < 4020);
  // Far outside the band on either side the mark sits at the band's edge, never on it.
  assert.equal(cappedForwardMark(eth(0), 50_000, NOW).price, 4019.9);
  assert.equal(cappedForwardMark(eth(0), 10, NOW).price, 1340.1);
});

test("every expiry prices independently and converges to the clamped spot at expiry", () => {
  const near = cappedForwardMark(eth(30), 2760, NOW).price;
  const mid = cappedForwardMark(eth(180), 2760, NOW).price;
  const far = cappedForwardMark(eth(270), 2760, NOW).price;
  assert.notEqual(near, mid);
  assert.notEqual(mid, far);
  assert.equal(cappedForwardMark(eth(0), 2760, NOW).price, 2760);
  assert.equal(cappedForwardMark(eth(-5), 2760, NOW).model.yearsToExpiry, 0);
});

test("the clamp value is bounded by the band and reduces to the forward without volatility", () => {
  assert.equal(expectedClamp(2800, 1340, 4020, 0, 1), 2800);
  const value = expectedClamp(2800, 1340, 4020, 0.65, 1);
  assert.ok(value > 1340 && value < 2800, "the cap gives up more upside than the floor protects at this spot");
});

test("an underlying without model inputs has no mark rather than a guessed one", () => {
  assert.equal(cappedForwardMark({ ...eth(30), underlying: "DOGE" }, 0.1, NOW), null);
  assert.equal(cappedForwardMark(eth(30), Number.NaN, NOW), null);
});

test("fills nudge the mark by a capped, decaying, confidence-weighted basis", () => {
  const terms = eth(90);
  const model = cappedForwardMark(terms, 2760, NOW).model.modelValue;
  assert.equal(markBasis([], NOW), null);
  const buys = [{ time: NOW - 3_600, price: model + 20, notional: 25_000, modelValue: model }];
  const basis = markBasis(buys, NOW);
  assert.equal(basis.provenance, "OBSERVED_FILLS");
  assert.ok(basis.confidence > 0.45 && basis.confidence < 0.5, "half weight at the half-confidence notional, less after decay");
  const mark = cappedForwardMark(terms, 2760, NOW, MARK_PARAMETERS, basis);
  assert.ok(mark.price > cappedForwardMark(terms, 2760, NOW).price && mark.model.value < model + 20, "the mark moves toward the fills, not onto them");
  // An absurd print is clipped to the cap before it is averaged.
  const outlier = markBasis([{ time: NOW, price: model * 3, notional: 10_000_000, modelValue: model }], NOW);
  assert.ok(Math.abs(outlier.adjustment) <= MARK_PARAMETERS.basis.maxAdjustment * model + 1e-9);
  // A day-old fill weighs half as much as a fresh one of the same size.
  const old = markBasis([{ time: NOW - 86_400, price: model + 20, notional: 25_000, modelValue: model }], NOW);
  assert.ok(Math.abs(old.weight - 12_500) < 1e-6);
  // At expiry the payoff is known: no basis applies.
  assert.equal(cappedForwardMark(eth(0), 2760, NOW, MARK_PARAMETERS, basis).model.basis, null);
});
