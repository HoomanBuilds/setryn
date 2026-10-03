import assert from "node:assert/strict";
import test from "node:test";

import {
  acceptableQuote,
  EXECUTION_MARGIN_SECONDS,
  firmQuoteRows,
  parseRiskAuthorization,
  quoteExecutable,
} from "../src/lib/quotes/firm-quote.ts";

const NOW_MS = 1_790_000_000_000;
const NOW = NOW_MS / 1000;

function quote(side, price, lots, secondsLeft) {
  return { id: `0x${side === "ASK" ? "a" : "b"}${"0".repeat(63)}`, marketId: "BTC", side, price, lots, expiresAt: NOW + secondsLeft };
}

function state(bid, ask, status = "FIRM", bids = bid ? [bid] : [], asks = ask ? [ask] : []) {
  return { marketId: "BTC", status, reason: null, bids, asks, bid, ask, reference: null };
}

test("a quote is executable only with the execution margin left, and never once expired", () => {
  assert.equal(quoteExecutable(quote("ASK", 100, 5, EXECUTION_MARGIN_SECONDS), NOW_MS), true);
  assert.equal(quoteExecutable(quote("ASK", 100, 5, EXECUTION_MARGIN_SECONDS - 1), NOW_MS), false);
  assert.equal(quoteExecutable(quote("ASK", 100, 5, -1), NOW_MS), false);
});

test("firm quote rows carry their own source, firmness and expiry; expired quotes are dropped", () => {
  const rows = firmQuoteRows(state(quote("BID", 99, 4, 3), quote("ASK", 101, 5, 15)), NOW_MS);
  assert.deepEqual(
    rows.map((row) => [row.side, row.source, row.firmness, row.executable, row.ttlSeconds]),
    [
      ["ASK", "STREAM_FIRM", "FIRM", true, 15],
      ["BID", "STREAM_FIRM", "FIRM", false, 3],
    ],
  );
  assert.deepEqual(firmQuoteRows(state(quote("BID", 99, 4, -2), null), NOW_MS), []);
  assert.deepEqual(firmQuoteRows(state(quote("BID", 99, 4, 15), null, "INDICATIVE"), NOW_MS), []);
});

test("a taker accepts only the opposite side, within its size and limit", () => {
  const book = state(quote("BID", 99, 4, 15), quote("ASK", 101, 5, 15));
  assert.equal(acceptableQuote(book, "BUY", 5, 101, NOW_MS)?.side, "ASK");
  assert.equal(acceptableQuote(book, "SELL", 4, 99, NOW_MS)?.side, "BID");
  assert.equal(acceptableQuote(book, "BUY", 6, 101, NOW_MS), null, "larger than the quote");
  assert.equal(acceptableQuote(book, "BUY", 1, 100.5, NOW_MS), null, "limit below the ask");
  assert.equal(acceptableQuote(book, "SELL", 1, 99.5, NOW_MS), null, "limit above the bid");
  assert.equal(acceptableQuote(state(quote("BID", 99, 4, 2), null), "SELL", 1, 99, NOW_MS), null, "inside the margin");
});

test("a taker selects the best executable ladder level that can fill its size", () => {
  const small = quote("ASK", 101, 2, 15);
  const deep = { ...quote("ASK", 102, 8, 15), id: `0x${"c".repeat(64)}` };
  const book = state(null, small, "FIRM", [], [small, deep]);
  assert.equal(acceptableQuote(book, "BUY", 2, 102, NOW_MS)?.price, 101);
  assert.equal(acceptableQuote(book, "BUY", 6, 102, NOW_MS)?.price, 102);
  assert.equal(acceptableQuote(book, "BUY", 6, 101, NOW_MS), null);
  assert.equal(firmQuoteRows(book, NOW_MS).length, 2);
});

test("a relayed risk authorization is parsed strictly", () => {
  const valid = {
    orderHash: `0x${"1".repeat(64)}`,
    accountId: `0x${"2".repeat(64)}`,
    riskDomainId: `0x${"3".repeat(64)}`,
    riskDomainVersion: 1,
    maxOpenInterestBaseUnits: "5",
    maxTerminalLiabilityBaseUnits: "9750000000",
    maxAdmissionDeadline: "1790000080",
    binder: `0x${"4".repeat(40)}`,
    binderTerms: `0x${"5".repeat(64)}`,
    nonce: "42",
    deadline: "1790000020",
  };
  const parsed = parseRiskAuthorization(valid);
  assert.equal(parsed.maxTerminalLiabilityBaseUnits, 9_750_000_000n);
  assert.equal(parsed.nonce, 42n);
  assert.throws(() => parseRiskAuthorization({ ...valid, nonce: "-1" }), /INVALID_RISK_AUTHORIZATION/);
  assert.throws(() => parseRiskAuthorization({ ...valid, binder: "0x1234" }), /INVALID_RISK_AUTHORIZATION/);
  assert.throws(() => parseRiskAuthorization({ ...valid, riskDomainVersion: 0 }), /INVALID_RISK_AUTHORIZATION/);
});
