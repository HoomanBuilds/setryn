import type { Hex } from "viem";

/*
 * What the designated maker does on one side of one book, decided from that side's resting orders alone. Kept free of
 * chain access so the rule can be tested on its own (maker-quote-plan.test.ts); maker-liquidity.ts executes the plan.
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

/** Decides what one side needs: reuse one good maker quote, and withdraw or clear everything else the maker has there. */
export function planSide(
  orders: ScannedOrder[],
  makerAddress: Hex,
  target: { side: Side; priceTicks: bigint },
  now: bigint,
  tolerance: bigint,
): SidePlan {
  const plan: SidePlan = { keep: null, through: [], replace: [], expired: [], expiredHead: null };
  const head = orders[0];
  if (head && head.signer.toLowerCase() !== makerAddress.toLowerCase() && (!head.open || head.deadline <= now)) plan.expiredHead = head;
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

