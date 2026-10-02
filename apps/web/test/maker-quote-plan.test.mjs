// Focused test of the designated maker's per-side quote plan (src/lib/internal-gateway/maker-quote-plan.ts).
//   node --experimental-strip-types --test apps/web/test/maker-quote-plan.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { planSide, RENEW_MARGIN_SECONDS } from "../src/lib/internal-gateway/maker-quote-plan.ts";

const MAKER = "0x00000000000000000000000000000000000000aa";
const OTHER = "0x00000000000000000000000000000000000000bb";
const NOW = 1_000_000n;
const TOLERANCE = 5n;

let next = 0;
function order(overrides) {
  next += 1;
  return {
    hash: `0x${next.toString(16).padStart(64, "0")}`,
    signer: MAKER,
    deadline: NOW + 200n,
    priceTicks: 1_000n,
    accountId: `0x${"1".repeat(64)}`,
    open: true,
    resting: true,
    ...overrides,
  };
}

const bid = { side: 1, priceTicks: 1_000n };
const ask = { side: 2, priceTicks: 1_010n };

test("an empty side places a fresh quote", () => {
  const plan = planSide([], MAKER, bid, NOW, TOLERANCE);
  assert.equal(plan.keep, null);
  assert.deepEqual([plan.through, plan.replace, plan.expired], [[], [], []]);
});

test("a live quote on target is reused, not duplicated", () => {
  const live = order({});
  const plan = planSide([live], MAKER, bid, NOW, TOLERANCE);
  assert.equal(plan.keep, live);
  assert.equal(plan.replace.length, 0);
});

test("a second live maker quote on the same side is withdrawn as a duplicate", () => {
  const first = order({});
  const second = order({});
  const plan = planSide([first, second], MAKER, bid, NOW, TOLERANCE);
  assert.equal(plan.keep, first);
  assert.deepEqual(plan.replace, [second]);
});

test("a quote inside its renewal margin is replaced", () => {
  const ending = order({ deadline: NOW + RENEW_MARGIN_SECONDS - 1n });
  const plan = planSide([ending], MAKER, bid, NOW, TOLERANCE);
  assert.equal(plan.keep, null);
  assert.deepEqual(plan.replace, [ending]);
});

test("an expired quote is cleared and replaced", () => {
  const expired = order({ deadline: NOW });
  const plan = planSide([expired], MAKER, bid, NOW, TOLERANCE);
  assert.equal(plan.keep, null);
  assert.deepEqual(plan.expired, [expired]);
});

test("a quote priced through the target is withdrawn first", () => {
  const rich = order({ priceTicks: 1_001n });
  const plan = planSide([rich], MAKER, bid, NOW, TOLERANCE);
  assert.deepEqual(plan.through, [rich]);
  const cheap = order({ priceTicks: 1_009n });
  assert.deepEqual(planSide([cheap], MAKER, ask, NOW, TOLERANCE).through, [cheap]);
});

test("a quote the reference moved away from is re-priced beyond the tolerance only", () => {
  assert.notEqual(planSide([order({ priceTicks: 996n })], MAKER, bid, NOW, TOLERANCE).keep, null);
  assert.equal(planSide([order({ priceTicks: 990n })], MAKER, bid, NOW, TOLERANCE).keep, null);
});

test("another account's orders are left alone, and only its expired head is pruned", () => {
  const theirs = order({ signer: OTHER, priceTicks: 1_005n });
  const mine = order({});
  const plan = planSide([theirs, mine], MAKER, bid, NOW, TOLERANCE);
  assert.equal(plan.keep, mine);
  assert.equal(plan.expiredHead, null);
  const stale = order({ signer: OTHER, deadline: NOW - 1n });
  assert.equal(planSide([stale], MAKER, bid, NOW, TOLERANCE).expiredHead, stale);
});
