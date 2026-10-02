import assert from "node:assert/strict";
import test from "node:test";

import { levelHint, renewQuotes, ZERO_ID } from "../src/lib/internal-gateway/maker-quote-plan.ts";

const MAKER = "0x00000000000000000000000000000000000000aa";
const OTHER = "0x00000000000000000000000000000000000000bb";
const BID = 1;
const ASK = 2;
const LIFETIME = 290n;
const TOLERANCE = 2n;

const hex = (prefix, value) => `0x${prefix}${value.toString(16).padStart(62, "0")}`;
const before = (side, left, right) => (side === BID ? left > right : left < right);

/**
 * A model of PublicOrderBook's level chain: levels linked best to worst per side, opened only through _openLevel's exact
 * hint validation, closed when their last order leaves, with the post-only cross check and opposite-side dead-head
 * pruning that _restOrder does before resting. It implements the renewal's book port.
 */
class ModelBook {
  constructor(now) {
    this.now = now;
    this.levels = new Map();
    this.orders = new Map();
    this.best = { [BID]: ZERO_ID, [ASK]: ZERO_ID };
    this.worst = { [BID]: ZERO_ID, [ASK]: ZERO_ID };
    this.sequence = 0;
    this.log = [];
    this.placements = 0;
    this.beforePlace = null;
  }

  live(order) {
    return order.open && order.deadline > this.now;
  }

  /** Rests someone else's order, hinted from the chain as it stands. */
  rest(signer, side, priceTicks, deadline = this.now + LIFETIME) {
    const hash = this.register(signer, side, priceTicks, deadline);
    this.restOrder(hash, levelHint(this.chain(side), side, priceTicks));
    return hash;
  }

  register(signer, side, priceTicks, deadline) {
    this.sequence += 1;
    const hash = hex("0e", this.sequence);
    this.orders.set(hash, { hash, signer, side, priceTicks, deadline, open: true, resting: false, accountId: ZERO_ID });
    return hash;
  }

  restOrder(hash, hint) {
    const order = this.orders.get(hash);
    const opposite = order.side === BID ? ASK : BID;
    for (let i = 0; i < 4; i += 1) {
      const head = this.bestOrder(opposite);
      if (!head || this.live(head)) break;
      this.remove(head.hash);
    }
    const against = this.bestOrder(opposite);
    if (against && (order.side === BID ? order.priceTicks >= against.priceTicks : order.priceTicks <= against.priceTicks)) {
      throw new Error(`PostOnlyWouldCross(${hash}, ${against.hash})`);
    }
    const levelId = hex(`${order.side}`.padStart(2, "0"), order.priceTicks);
    if (!this.levels.get(levelId)?.active) this.openLevel(order.side, order.priceTicks, levelId, hint);
    this.levels.get(levelId).orders.push(hash);
    order.resting = true;
  }

  /** PublicOrderBook._openLevel, condition for condition. */
  openLevel(side, priceTicks, levelId, { previousLevelId: previous, nextLevelId: next }) {
    const p = this.levels.get(previous);
    const n = this.levels.get(next);
    if (
      (previous === ZERO_ID && this.best[side] !== next) || (next === ZERO_ID && this.worst[side] !== previous)
      || (previous !== ZERO_ID && (!p?.active || p.nextLevelId !== next))
      || (next !== ZERO_ID && (!n?.active || n.previousLevelId !== previous))
      || (previous !== ZERO_ID && (p.side !== side || !before(side, p.priceTicks, priceTicks)))
      || (next !== ZERO_ID && (n.side !== side || !before(side, priceTicks, n.priceTicks)))
    ) throw new Error(`InvalidLevelHint(${previous}, ${next})`);
    this.levels.set(levelId, { id: levelId, side, priceTicks, previousLevelId: previous, nextLevelId: next, orders: [], active: true });
    if (previous === ZERO_ID) this.best[side] = levelId;
    else p.nextLevelId = levelId;
    if (next === ZERO_ID) this.worst[side] = levelId;
    else n.previousLevelId = levelId;
  }

  remove(hash) {
    const order = this.orders.get(hash);
    order.resting = false;
    const level = this.levels.get(hex(`${order.side}`.padStart(2, "0"), order.priceTicks));
    level.orders = level.orders.filter((other) => other !== hash);
    if (level.orders.length > 0) return;
    level.active = false;
    const { previousLevelId: previous, nextLevelId: next, side } = level;
    if (previous === ZERO_ID) this.best[side] = next;
    else this.levels.get(previous).nextLevelId = next;
    if (next === ZERO_ID) this.worst[side] = previous;
    else this.levels.get(next).previousLevelId = previous;
  }

  bestOrder(side) {
    const level = this.levels.get(this.best[side]);
    return level ? this.orders.get(level.orders[0]) : null;
  }

  chain(side) {
    const levels = [];
    for (let id = this.best[side]; id !== ZERO_ID; id = this.levels.get(id).nextLevelId) {
      const { previousLevelId, nextLevelId, priceTicks } = this.levels.get(id);
      levels.push({ id, priceTicks, previousLevelId, nextLevelId });
    }
    return { levels, complete: true };
  }

  /** Level prices best to worst, after checking the chain's links and strict ordering. */
  prices(side) {
    const { levels } = this.chain(side);
    levels.forEach((level, index) => {
      assert.equal(level.previousLevelId, levels[index - 1]?.id ?? ZERO_ID);
      assert.equal(level.nextLevelId, levels[index + 1]?.id ?? ZERO_ID);
      if (index > 0) assert.ok(before(side, levels[index - 1].priceTicks, level.priceTicks));
    });
    assert.equal(this.worst[side], levels.at(-1)?.id ?? ZERO_ID);
    return levels.map((level) => level.priceTicks);
  }

  /** The maker's live resting quotes on a side. */
  makerQuotes(side) {
    return [...this.orders.values()].filter((order) => order.signer === MAKER && order.side === side && order.resting && this.live(order));
  }

  get port() {
    return {
      scan: async (side) => {
        const chain = this.chain(side);
        const orders = chain.levels.flatMap((level) => this.levels.get(level.id).orders.map((hash) => ({ ...this.orders.get(hash) })));
        return { ...chain, orders };
      },
      levels: async (side) => this.chain(side),
      withdraw: async (order) => {
        const record = this.orders.get(order.hash);
        if (!record.resting || !this.live(record)) throw new Error("OrderNotCancellable");
        record.open = false;
        this.remove(order.hash);
        this.log.push(`withdraw ${order.priceTicks}`);
      },
      clearExpired: async (order) => {
        const record = this.orders.get(order.hash);
        if (record.resting && !this.live(record)) this.remove(order.hash);
        this.log.push(`clear ${order.priceTicks}`);
      },
      pruneHead: async (side, order) => {
        const head = this.bestOrder(side);
        if (head?.hash !== order.hash || this.live(head)) return false;
        this.remove(order.hash);
        this.log.push(`prune ${order.priceTicks}`);
        return true;
      },
      prepare: async (side, priceTicks) => this.register(MAKER, side, priceTicks, this.now + LIFETIME),
      place: async (orderHash, hint) => {
        this.placements += 1;
        const hook = this.beforePlace;
        this.beforePlace = null;
        hook?.();
        this.restOrder(orderHash, hint);
        this.log.push(`place ${this.orders.get(orderHash).priceTicks}`);
      },
    };
  }

  renew(bid, ask) {
    return renewQuotes(this.port, MAKER, [{ side: BID, priceTicks: bid }, { side: ASK, priceTicks: ask }], this.now, TOLERANCE);
  }
}

function assertOneMakerQuoteEachSide(book, bid, ask) {
  assert.deepEqual(book.makerQuotes(BID).map((order) => order.priceTicks), [bid]);
  assert.deepEqual(book.makerQuotes(ASK).map((order) => order.priceTicks), [ask]);
}

test("a better-priced replacement opens a level at the head and the old quote comes down only after it rests", async () => {
  const book = new ModelBook(1_000n);
  book.rest(MAKER, BID, 100n);
  book.rest(OTHER, BID, 98n);
  book.rest(MAKER, ASK, 110n);
  book.rest(OTHER, ASK, 112n);
  // The old fixed zero hint cannot open this level: the side is not empty and 103 is not an existing level.
  assert.throws(() => book.restOrder(book.register(MAKER, BID, 103n, book.now + LIFETIME), { previousLevelId: ZERO_ID, nextLevelId: ZERO_ID }), /InvalidLevelHint/);

  const outcome = await book.renew(103n, 107n);

  assert.equal(outcome.created.length, 2);
  assert.ok(book.log.indexOf("place 103") < book.log.indexOf("withdraw 100"));
  assert.ok(book.log.indexOf("place 107") < book.log.indexOf("withdraw 110"));
  assert.deepEqual(book.prices(BID), [103n, 98n]);
  assert.deepEqual(book.prices(ASK), [107n, 112n]);
  assertOneMakerQuoteEachSide(book, 103n, 107n);
});

test("a worse-priced replacement withdraws the quote priced through the target and inserts between someone else's levels", async () => {
  const book = new ModelBook(1_000n);
  book.rest(OTHER, BID, 101n);
  book.rest(MAKER, BID, 100n);
  book.rest(OTHER, BID, 95n);
  book.rest(OTHER, ASK, 104n);
  book.rest(MAKER, ASK, 105n);
  book.rest(OTHER, ASK, 109n);

  await book.renew(97n, 107n);

  assert.ok(book.log.indexOf("withdraw 100") < book.log.indexOf("place 97"));
  assert.deepEqual(book.prices(BID), [101n, 97n, 95n]);
  assert.deepEqual(book.prices(ASK), [104n, 107n, 109n]);
  assertOneMakerQuoteEachSide(book, 97n, 107n);
});

test("an expired maker head and the dead order behind it are cleared before the final hint is read", async () => {
  const book = new ModelBook(1_000n);
  book.rest(MAKER, BID, 100n, 1_100n);
  book.rest(OTHER, BID, 99n, 1_100n);
  book.rest(OTHER, BID, 96n, 5_000n);
  book.rest(MAKER, ASK, 104n, 1_100n);
  book.now = 1_200n;

  const outcome = await book.renew(98n, 103n);

  assert.equal(outcome.cleared, 2);
  assert.ok(book.log.indexOf("clear 100") < book.log.indexOf("prune 99"));
  assert.ok(book.log.indexOf("prune 99") < book.log.indexOf("place 98"));
  assert.deepEqual(book.prices(BID), [98n, 96n]);
  assert.deepEqual(book.prices(ASK), [103n]);
  assertOneMakerQuoteEachSide(book, 98n, 103n);
});

for (const [position, bid, ask, bids, asks] of [
  ["head", 100n, 102n, [100n, 95n, 90n], [102n, 105n, 110n]],
  ["middle", 93n, 107n, [95n, 93n, 90n], [105n, 107n, 110n]],
  ["tail", 85n, 115n, [95n, 90n, 85n], [105n, 110n, 115n]],
]) {
  test(`a new quote at the ${position} of both sides rests between someone else's levels`, async () => {
    const book = new ModelBook(1_000n);
    for (const price of [95n, 90n]) book.rest(OTHER, BID, price);
    for (const price of [105n, 110n]) book.rest(OTHER, ASK, price);

    const outcome = await book.renew(bid, ask);

    assert.equal(outcome.created.length, 2);
    assert.equal(book.placements, 2);
    assert.deepEqual(book.prices(BID), bids);
    assert.deepEqual(book.prices(ASK), asks);
    assertOneMakerQuoteEachSide(book, bid, ask);
  });
}

test("a quote joining someone else's existing level needs no hint, and a tail past an incomplete chain is refused", () => {
  const levels = [{ id: hex("01", 95n), priceTicks: 95n, previousLevelId: ZERO_ID, nextLevelId: ZERO_ID }];
  assert.deepEqual(levelHint({ levels, complete: true }, BID, 95n), { previousLevelId: ZERO_ID, nextLevelId: ZERO_ID });
  assert.deepEqual(levelHint({ levels, complete: false }, BID, 96n), { previousLevelId: ZERO_ID, nextLevelId: levels[0].id });
  assert.throws(() => levelHint({ levels, complete: false }, BID, 94n), /BOOK_SCAN_INCOMPLETE/);
});

test("a level chain that moves between the read and the placement is read again and the placement retried", async () => {
  const book = new ModelBook(1_000n);
  book.rest(OTHER, BID, 95n);
  book.rest(OTHER, ASK, 105n);
  // Someone opens a level right where the maker's bid goes, after its hint was read.
  book.beforePlace = () => book.rest(OTHER, BID, 99n);

  await book.renew(98n, 102n);

  assert.equal(book.placements, 3);
  assert.deepEqual(book.prices(BID), [99n, 98n, 95n]);
  assertOneMakerQuoteEachSide(book, 98n, 102n);
});

test("a jump past the maker's own ask withdraws it before the bid rests, so the post-only bid does not cross it", async () => {
  const book = new ModelBook(1_000n);
  book.rest(MAKER, BID, 100n);
  book.rest(MAKER, ASK, 102n);

  await book.renew(105n, 107n);

  assertOneMakerQuoteEachSide(book, 105n, 107n);
});

test("repeated renewals keep exactly one live maker bid and ask, reusing quotes that are still good", async () => {
  const book = new ModelBook(1_000n);
  for (const price of [99n, 94n, 90n]) book.rest(OTHER, BID, price, 100_000n);
  for (const price of [106n, 111n, 115n]) book.rest(OTHER, ASK, price, 100_000n);
  const steps = [
    { bid: 97n, ask: 103n, advance: 0n },
    { bid: 98n, ask: 102n, advance: 20n, reused: true },
    { bid: 101n, ask: 108n, advance: 20n },
    { bid: 92n, ask: 113n, advance: 20n },
    { bid: 92n, ask: 113n, advance: 240n },
    { bid: 92n, ask: 113n, advance: 400n },
    { bid: 99n, ask: 106n, advance: 20n },
    { bid: 88n, ask: 117n, advance: 20n },
  ];
  for (const step of steps) {
    book.now += step.advance;
    const outcome = await book.renew(step.bid, step.ask);
    if (step.reused) {
      assert.equal(outcome.kept, 2);
      assert.deepEqual(outcome.created, []);
      assertOneMakerQuoteEachSide(book, 97n, 103n);
    } else {
      assertOneMakerQuoteEachSide(book, step.bid, step.ask);
    }
    book.prices(BID);
    book.prices(ASK);
  }
  const resting = [...book.orders.values()].filter((order) => order.signer === MAKER && order.resting);
  assert.equal(resting.length, 2);
});
