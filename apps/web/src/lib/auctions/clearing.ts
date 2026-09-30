import { encodeAbiParameters, keccak256, stringToHex } from "viem";
import {
  ZERO_BYTES32,
  type AuctionClearingResult,
  type AuctionDefinition,
  type BidView,
  type Bytes32,
  type SealedBid,
  type Side,
  type SolverRoute,
} from "./types";

/**
 * A line-for-line port of AuctionRankingLib and SealedAuctionClearingLib._computeResult,
 * so a modeled round clears by exactly the rule the contract enforces and the
 * allocation and result commitments reproduce the contract's hashes.
 */

const ALLOCATION_TYPEHASH = keccak256(
  stringToHex("SetrynAuctionAllocationV1(bytes32 bidId,uint128 allocatedLots,int128 allocationPriceTicks)"),
);
const RESULT_TYPEHASH = keccak256(
  stringToHex(
    "SetrynAuctionResultV1(bytes32 auctionId,uint32 auctionVersion,bytes32 winningRouteBidId,int128 uniformPriceTicks,uint128 totalAllocatedLots,uint16 winnerCount,bytes32 allocationsHash)",
  ),
);

/** bytes32 compared as uint256, as `BidCommitmentId.unwrap(a) < BidCommitmentId.unwrap(b)` does. */
function lessThan(left: Bytes32, right: Bytes32): boolean {
  return BigInt(left) < BigInt(right);
}

export function isBetterBid(
  candidate: SealedBid,
  candidateId: Bytes32,
  incumbent: SealedBid,
  incumbentId: Bytes32,
  auctionSide: Side,
): boolean {
  if (candidate.priceTicks !== incumbent.priceTicks) {
    return auctionSide === "BUY" ? candidate.priceTicks < incumbent.priceTicks : candidate.priceTicks > incumbent.priceTicks;
  }
  if (candidate.maximumFeeMinor !== incumbent.maximumFeeMinor) {
    return candidate.maximumFeeMinor < incumbent.maximumFeeMinor;
  }
  return lessThan(candidateId, incumbentId);
}

export function isBetterRoute(
  candidate: SolverRoute,
  candidateBidId: Bytes32,
  incumbent: SolverRoute,
  incumbentBidId: Bytes32,
  auctionSide: Side,
): boolean {
  if (candidate.packageOutcomeTicks !== incumbent.packageOutcomeTicks) {
    return auctionSide === "BUY"
      ? candidate.packageOutcomeTicks < incumbent.packageOutcomeTicks
      : candidate.packageOutcomeTicks > incumbent.packageOutcomeTicks;
  }
  if (candidate.maximumFeeMinor !== incumbent.maximumFeeMinor) {
    return candidate.maximumFeeMinor < incumbent.maximumFeeMinor;
  }
  if (candidate.capacityAmount !== incumbent.capacityAmount) {
    return candidate.capacityAmount > incumbent.capacityAmount;
  }
  return lessThan(candidateBidId, incumbentBidId);
}

export interface Allocation {
  bidId: Bytes32;
  lots: number;
  priceTicks: number;
  /** One-based rank in the order the contract selected winners. */
  rank: number;
}

export interface ClearingOutcome {
  allocations: Allocation[];
  result: AuctionClearingResult;
  /** Revealed bids in contract ranking order, winners first. */
  ranking: Bytes32[];
  /** Bids the walk skipped because the remainder could not satisfy their size rule. */
  skipped: Bytes32[];
}

function chainAllocation(previous: Bytes32, bidId: Bytes32, lots: number, priceTicks: number): Bytes32 {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint128" }, { type: "int128" }],
      [previous, ALLOCATION_TYPEHASH, bidId, BigInt(lots), BigInt(priceTicks)],
    ),
  );
}

function hashResult(
  auctionId: Bytes32,
  version: number,
  winningRouteBidId: Bytes32,
  uniformPriceTicks: number,
  totalAllocatedLots: number,
  winnerCount: number,
  allocationsHash: Bytes32,
): Bytes32 {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint32" },
        { type: "bytes32" },
        { type: "int128" },
        { type: "uint128" },
        { type: "uint16" },
        { type: "bytes32" },
      ],
      [
        RESULT_TYPEHASH,
        auctionId,
        version,
        winningRouteBidId,
        BigInt(uniformPriceTicks),
        BigInt(totalAllocatedLots),
        winnerCount,
        allocationsHash,
      ],
    ),
  );
}

/** Revealed bids only: an unrevealed commitment carries a zeroed bid and never ranks. */
function revealed(bids: BidView[]): BidView[] {
  return bids.filter((entry) => entry.record.bid !== null);
}

function computeRouteResult(
  auctionId: Bytes32,
  version: number,
  definition: AuctionDefinition,
  bids: BidView[],
): ClearingOutcome {
  let best: BidView | null = null;
  const candidates = revealed(bids).filter((entry) => entry.route !== null);
  for (const entry of candidates) {
    if (
      best === null ||
      isBetterRoute(entry.route!.route, entry.id, best.route!.route, best.id, definition.auctionSide)
    ) {
      best = entry;
    }
  }
  const ranking = [...candidates]
    .sort((left, right) =>
      isBetterRoute(left.route!.route, left.id, right.route!.route, right.id, definition.auctionSide) ? -1 : 1,
    )
    .map((entry) => entry.id);
  if (best === null) {
    const allocationsHash = ZERO_BYTES32;
    return {
      allocations: [],
      ranking,
      skipped: [],
      result: {
        auctionId,
        auctionVersion: version,
        winningRouteBidId: ZERO_BYTES32,
        uniformPriceTicks: 0,
        totalAllocatedLots: 0,
        winnerCount: 0,
        allocationsHash,
        resultHash: hashResult(auctionId, version, ZERO_BYTES32, 0, 0, 0, allocationsHash),
      },
    };
  }
  const lots = best.record.bid!.lots;
  const price = best.route!.route.packageOutcomeTicks;
  const allocationsHash = chainAllocation(ZERO_BYTES32, best.id, lots, price);
  return {
    allocations: [{ bidId: best.id, lots, priceTicks: price, rank: 1 }],
    ranking,
    skipped: [],
    result: {
      auctionId,
      auctionVersion: version,
      winningRouteBidId: best.id,
      uniformPriceTicks: price,
      totalAllocatedLots: lots,
      winnerCount: 1,
      allocationsHash,
      resultHash: hashResult(auctionId, version, best.id, price, lots, 1, allocationsHash),
    },
  };
}

/** `_computeResult`: rank, walk the remainder, then restamp winners at the uniform price when the rule asks. */
export function computeClearingResult(
  auctionId: Bytes32,
  version: number,
  definition: AuctionDefinition,
  bids: BidView[],
): ClearingOutcome {
  if (definition.kind === "SOLVER_ROUTE") return computeRouteResult(auctionId, version, definition, bids);

  const pool = revealed(bids);
  const selected = new Set<Bytes32>();
  const ranking: Bytes32[] = [];
  const skipped: Bytes32[] = [];
  const allocations: Allocation[] = [];
  let remaining = definition.totalLots;
  let uniformPrice = 0;
  let allocationsHash: Bytes32 = ZERO_BYTES32;

  for (let rank = 0; rank < pool.length && remaining !== 0; rank += 1) {
    let best: BidView | null = null;
    for (const entry of pool) {
      if (selected.has(entry.id)) continue;
      if (best === null || isBetterBid(entry.record.bid!, entry.id, best.record.bid!, best.id, definition.auctionSide)) {
        best = entry;
      }
    }
    if (best === null) break;
    selected.add(best.id);
    ranking.push(best.id);
    const bid = best.record.bid!;
    let allocated: number;
    if (bid.lots <= remaining) {
      allocated = bid.lots;
    } else if (bid.allowPartialAllocation && remaining >= bid.minimumFillLots) {
      allocated = remaining;
    } else {
      skipped.push(best.id);
      continue;
    }
    remaining -= allocated;
    allocations.push({ bidId: best.id, lots: allocated, priceTicks: bid.priceTicks, rank: allocations.length + 1 });
    uniformPrice = bid.priceTicks;
    allocationsHash = chainAllocation(allocationsHash, best.id, allocated, bid.priceTicks);
  }
  /* Bids the loop never reached still rank behind the walk for display. */
  for (const entry of pool) if (!selected.has(entry.id)) ranking.push(entry.id);

  if (definition.priceRule === "UNIFORM_PRICE") {
    allocationsHash = ZERO_BYTES32;
    for (const allocation of allocations) {
      allocation.priceTicks = uniformPrice;
      allocationsHash = chainAllocation(allocationsHash, allocation.bidId, allocation.lots, uniformPrice);
    }
  }
  const allocatedTotal = definition.totalLots - remaining;
  return {
    allocations,
    ranking,
    skipped,
    result: {
      auctionId,
      auctionVersion: version,
      winningRouteBidId: ZERO_BYTES32,
      uniformPriceTicks: uniformPrice,
      totalAllocatedLots: allocatedTotal,
      winnerCount: allocations.length,
      allocationsHash,
      resultHash: hashResult(auctionId, version, ZERO_BYTES32, uniformPrice, allocatedTotal, allocations.length, allocationsHash),
    },
  };
}
