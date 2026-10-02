import type { Hex } from "viem";

/*
 * What the designated maker does on one book: the per-side plan decided from resting orders alone, the level hint for a
 * new quote, and the renewal that runs them through a book port. Kept free of chain access so the rules can be tested on
 * a model book (test/maker-quote-*.test.mjs); maker-liquidity.ts implements the port on chain.
 */

/** A live quote with less time than this left is replaced, so a refresh every ~20 s keeps both sides covered. */
export const RENEW_MARGIN_SECONDS = BigInt(60);

export type Side = 1 | 2;

export interface ScannedOrder {
  hash: Hex;
  signer: Hex;
  deadline: bigint;
  priceTicks: bigint;
  accountId: Hex;
  /** OrderState says open or partially filled. */
  open: boolean;
  /** The book still holds it as resting. */
  resting: boolean;
}

export interface SidePlan {
  /** The maker quote kept as is. */
  keep: ScannedOrder | null;
  /** Live maker quotes priced through the target: withdrawn before a replacement goes up. */
  through: ScannedOrder[];
  /** Live maker quotes near expiry, away from the target, or duplicates: withdrawn after the replacement is up. */
  replace: ScannedOrder[];
  /** Maker quotes past their deadline: synced off the book and their risk released. */
  expired: ScannedOrder[];
  /** Someone else's expired order at the head of the side, pruned so takers reach live liquidity. */
  expiredHead: ScannedOrder | null;
}

/** Someone else's order at the head of a side that is no longer live (expired or closed), or null. */
export function expiredHead(orders: ScannedOrder[], makerAddress: Hex, now: bigint): ScannedOrder | null {
  const head = orders[0];
  if (!head || head.signer.toLowerCase() === makerAddress.toLowerCase()) return null;
  return !head.open || head.deadline <= now ? head : null;
}

/** Decides what one side needs: reuse one good maker quote, and withdraw or clear everything else the maker has there. */
export function planSide(
  orders: ScannedOrder[],
  makerAddress: Hex,
  target: { side: Side; priceTicks: bigint },
  now: bigint,
  tolerance: bigint,
): SidePlan {
  const plan: SidePlan = { keep: null, through: [], replace: [], expired: [], expiredHead: null };
  plan.expiredHead = expiredHead(orders, makerAddress, now);
  for (const order of orders) {
    if (order.signer.toLowerCase() !== makerAddress.toLowerCase()) continue;
    if (!order.open || order.deadline <= now) {
      plan.expired.push(order);
      continue;
    }
    const through = target.side === 1 ? order.priceTicks > target.priceTicks : order.priceTicks < target.priceTicks;
    if (through) {
      plan.through.push(order);
      continue;
    }
    const distance = order.priceTicks > target.priceTicks ? order.priceTicks - target.priceTicks : target.priceTicks - order.priceTicks;
    const renew = order.deadline <= now + RENEW_MARGIN_SECONDS || distance > tolerance;
    if (renew || plan.keep) plan.replace.push(order);
    else plan.keep = order;
  }
  return plan;
}


/** The zero id: no level, no order. */
export const ZERO_ID = `0x${"0".repeat(64)}` as Hex;

/** One active price level on one side of a book, as PublicOrderBook links them (best to worst). */
export interface BookLevel {
  id: Hex;
  priceTicks: bigint;
  previousLevelId: Hex;
  nextLevelId: Hex;
}

/** One side's level chain, best to worst. */
export interface LevelChain {
  levels: BookLevel[];
  /** False when the walk stopped before the worst level, so a new level past the last one read cannot be hinted. */
  complete: boolean;
}

/** One side of a book: its level chain and its resting orders, best first. */
export interface SideScan extends LevelChain {
  orders: ScannedOrder[];
}

/** PublicOrderBook's insertion hint: the levels a new level goes between (zero at the head or the tail). */
export interface LevelHint {
  previousLevelId: Hex;
  nextLevelId: Hex;
}

/** PublicBookLib.isBefore: bids rank higher prices first, asks lower prices first. */
export function isBefore(side: Side, left: bigint, right: bigint): boolean {
  return side === 1 ? left > right : left < right;
}

/**
 * The hint PublicOrderBook._openLevel accepts for a new level at `priceTicks`: the last level that ranks before it and
 * the first that ranks after it. An active level at that price takes the order without opening a level, so its hint is
 * ignored and zero. A tail insertion needs the complete chain, because the book checks the previous level is the worst.
 */
export function levelHint(chain: LevelChain, side: Side, priceTicks: bigint): LevelHint {
  let previousLevelId = ZERO_ID;
  for (const level of chain.levels) {
    if (level.priceTicks === priceTicks) return { previousLevelId: ZERO_ID, nextLevelId: ZERO_ID };
    if (!isBefore(side, level.priceTicks, priceTicks)) return { previousLevelId, nextLevelId: level.id };
    previousLevelId = level.id;
  }
  if (!chain.complete) throw new Error("BOOK_SCAN_INCOMPLETE");
  return { previousLevelId, nextLevelId: ZERO_ID };
}

/** True for PublicOrderBook's InvalidLevelHint(bytes32,bytes32) revert, decoded by name or by selector. */
export function isLevelHintError(error: unknown): boolean {
  const text = error instanceof Error ? `${error.message} ${(error as { shortMessage?: string }).shortMessage ?? ""}` : String(error);
  return /InvalidLevelHint|0xadd4533f/i.test(text);
}

/** The book operations a renewal needs; maker-liquidity.ts implements them on chain, the tests on a model book. */
export interface MakerBookPort {
  /** One side's level chain and resting orders, read now. */
  scan(side: Side): Promise<SideScan>;
  /** One side's level chain alone, read now. */
  levels(side: Side): Promise<LevelChain>;
  /** Cancels a live maker quote and takes it off the book. */
  withdraw(order: ScannedOrder): Promise<void>;
  /** Takes an expired maker quote off the book and releases its risk. */
  clearExpired(order: ScannedOrder): Promise<void>;
  /** Prunes someone else's dead order at the head of a side; false when the book still holds it eligible. */
  pruneHead(side: Side, order: ScannedOrder): Promise<boolean>;
  /** Signs, risk-binds and registers a new maker quote; returns its order hash. */
  prepare(side: Side, priceTicks: bigint): Promise<Hex>;
  /** Rests a registered quote on the book with the given level hint. */
  place(orderHash: Hex, hint: LevelHint): Promise<void>;
}

export interface QuoteRenewal {
  created: Hex[];
  kept: number;
  withdrawn: number;
  cleared: number;
}

/** Placements retried when the level chain moved between the read and the placement. */
const HINT_ATTEMPTS = 3;
/** Someone else's dead head orders pruned per side and renewal. */
const MAX_HEAD_PRUNES = 4;

/**
 * Renews the designated maker's quotes on one market so exactly one live maker bid and ask rest there afterwards. Runs
 * under the maker lock. Order of work:
 *   1. maker quotes priced through a target come down on both sides first: they could be picked off, and a post-only
 *      replacement on one side reverts if it would cross the maker's own stale quote on the other;
 *   2. per side, expired maker quotes are synced off the book and dead heads pruned, so the final hint is computed
 *      against the chain as it will stand;
 *   3. when no good maker quote remains, a new one is registered, the level chain is read again immediately before
 *      placement, and the quote rests with the exact hint (read again and retried if the chain moved meanwhile);
 *   4. only then do the replaced maker quotes (near expiry, away from the target, or duplicates) come down, so a valid
 *      old quote is never removed before its replacement is on the book.
 */
export async function renewQuotes(
  port: MakerBookPort,
  makerAddress: Hex,
  targets: { side: Side; priceTicks: bigint }[],
  now: bigint,
  tolerance: bigint,
): Promise<QuoteRenewal> {
  const outcome: QuoteRenewal = { created: [], kept: 0, withdrawn: 0, cleared: 0 };
  const plans: SidePlan[] = [];
  for (const target of targets) plans.push(planSide((await port.scan(target.side)).orders, makerAddress, target, now, tolerance));
  for (const plan of plans) {
    for (const order of plan.through) {
      await port.withdraw(order);
      outcome.withdrawn += 1;
    }
  }
  for (const [index, target] of targets.entries()) {
    const plan = plans[index];
    for (const order of plan.expired) {
      await port.clearExpired(order);
      outcome.cleared += 1;
    }
    // Clearing the maker's own expired head can expose someone else's dead order behind it.
    let head = plan.expired.length > 0 ? expiredHead((await port.scan(target.side)).orders, makerAddress, now) : plan.expiredHead;
    for (let prunes = 0; head && prunes < MAX_HEAD_PRUNES; prunes += 1) {
      if (!(await port.pruneHead(target.side, head))) break;
      head = expiredHead((await port.scan(target.side)).orders, makerAddress, now);
    }
    if (plan.keep) {
      outcome.kept += 1;
    } else {
      const orderHash = await port.prepare(target.side, target.priceTicks);
      for (let attempt = 1; ; attempt += 1) {
        const hint = levelHint(await port.levels(target.side), target.side, target.priceTicks);
        try {
          await port.place(orderHash, hint);
          break;
        } catch (error) {
          if (!isLevelHintError(error) || attempt >= HINT_ATTEMPTS) throw error;
        }
      }
      outcome.created.push(orderHash);
    }
    for (const order of plan.replace) {
      // Best effort: a quote filled or cancelled meanwhile cannot be withdrawn, and one left up is a duplicate the
      // next refresh replaces.
      try {
        await port.withdraw(order);
        outcome.withdrawn += 1;
      } catch {
        // left for the next refresh
      }
    }
  }
  return outcome;
}
