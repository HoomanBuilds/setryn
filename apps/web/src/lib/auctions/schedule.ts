import { MARKETS } from "@/lib/terminal/markets";
import type { PackageMarket } from "@/lib/terminal/types";
import { AUCTION_BIDDERS, OWN_SOLVER_ID, type Participant } from "@/lib/solver/roster";
import { computeClearingResult, type ClearingOutcome } from "./clearing";
import { PREVIEW_EPOCH_SECONDS, feedReferenceAt, gridTicks, priceToTicks } from "./feed";
import {
  ZERO_BYTES32,
  type AuctionDefinition,
  type AuctionKind,
  type AuctionPriceRule,
  type AuctionRecord,
  type AuctionStatus,
  type BidRecord,
  type BidStatus,
  type BidView,
  type BondOutcome,
  type Bytes32,
  type KeeperSchedule,
  type SealedBid,
  type Side,
  type SolverRouteRecord,
} from "./types";

/**
 * Deterministic auction schedules built from the market fixtures.
 *
 * The web gateway does not read SealedAuctionHouse or BatchClearingEngine yet,
 * and the local runtime publishes no auction addresses, so this module models
 * the auction venue instead of reading it. Each family runs rounds on a fixed
 * cadence against the shared preview clock. Bids price off the shared preview
 * feed at the moment they commit, and every round clears through the port of
 * the contract's clearing rule. Everything produced here is MODELED.
 *
 * Status follows the contract's state machine and assumes keepers call
 * `advanceAuction`, `clearAuction` and settlement promptly at each deadline.
 */

/* ------------------------------------------------------------------ */
/* Deterministic primitives                                            */
/* ------------------------------------------------------------------ */

/**
 * Stable, uniformly spread bytes32 for a modeled identifier. It is a cheap
 * deterministic mix, not keccak, and is never presented as a chain commitment.
 */
export function modeledHash(label: string): Bytes32 {
  let state = fnv(`setryn:modeled:${label}`);
  let out = "";
  for (let word = 0; word < 8; word += 1) {
    state = (state + 0x9e3779b9 + word) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 16), 0x85ebca6b) >>> 0;
    mixed = Math.imul(mixed ^ (mixed >>> 13), 0xc2b2ae35) >>> 0;
    mixed = (mixed ^ (mixed >>> 16)) >>> 0;
    out += mixed.toString(16).padStart(8, "0");
    state = (state ^ mixed) >>> 0;
  }
  return `0x${out}`;
}

function fnv(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function seeded(label: string): () => number {
  let state = fnv(label) || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function between(random: () => number, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

/* ------------------------------------------------------------------ */
/* Families                                                            */
/* ------------------------------------------------------------------ */

export type FamilyKind = "BATCH_ROUND" | "SEALED";

export interface AuctionFamily {
  key: string;
  family: FamilyKind;
  kind: AuctionKind;
  priceRule: AuctionPriceRule;
  marketId: string;
  /** Seconds between consecutive commit openings. */
  cycle: number;
  commit: number;
  reveal: number;
  /** Seconds after reveal closes that the model assumes `clearAuction` runs. */
  clearDelay: number;
  /** Seconds after clearing that the model assumes settlement completes. */
  settleDelay: number;
  /** clearDeadline - revealClosesAt. */
  clearWindow: number;
  /** settlementDeadline - clearDeadline. */
  settlementWindow: number;
  /** bondExpiry - settlementDeadline. */
  bondWindow: number;
  /** Seconds into the cycle at the first tick of the preview clock. */
  positionAtStart: number;
  lotStep: number;
  lotRange: [number, number];
  side: Side | "ALTERNATE";
  bidderRange: [number, number];
  maximumBids: number;
  bondUsd: number;
  /** Settlement fails for rounds whose hash lands on this modulus; zero never fails. */
  failureModulus: number;
  roundBase: number;
}

const BATCH_TIMING = {
  clearDelay: 3,
  settleDelay: 6,
  clearWindow: 12,
  settlementWindow: 30,
  bondWindow: 90,
  maximumBids: 32,
  bondUsd: 250,
  failureModulus: 0,
} as const;

const SEALED_TIMING = {
  clearDelay: 20,
  settleDelay: 150,
  clearWindow: 300,
  settlementWindow: 600,
  bondWindow: 900,
  maximumBids: 16,
} as const;

const FAMILY_SPECS: AuctionFamily[] = [
  {
    key: "batch-btc-yc-dec26",
    family: "BATCH_ROUND",
    kind: "BATCH_ORDER",
    priceRule: "UNIFORM_PRICE",
    marketId: "BTC-YC-24DEC26",
    cycle: 120,
    commit: 70,
    reveal: 30,
    positionAtStart: 38,
    lotStep: 1,
    lotRange: [24, 80],
    side: "ALTERNATE",
    bidderRange: [4, 8],
    roundBase: 4_120,
    ...BATCH_TIMING,
  },
  {
    key: "batch-eth-fc-dec26",
    family: "BATCH_ROUND",
    kind: "BATCH_ORDER",
    priceRule: "UNIFORM_PRICE",
    marketId: "ETH-FC-24DEC26",
    cycle: 180,
    commit: 110,
    reveal: 45,
    positionAtStart: 131,
    lotStep: 2,
    lotRange: [30, 120],
    side: "ALTERNATE",
    bidderRange: [3, 7],
    roundBase: 2_860,
    ...BATCH_TIMING,
  },
  {
    key: "batch-eurusd-dec26",
    family: "BATCH_ROUND",
    kind: "BATCH_ORDER",
    priceRule: "UNIFORM_PRICE",
    marketId: "EURUSD-FW-30DEC26",
    cycle: 120,
    commit: 70,
    reveal: 30,
    positionAtStart: 96,
    lotStep: 1,
    lotRange: [20, 60],
    side: "ALTERNATE",
    bidderRange: [3, 7],
    roundBase: 5_310,
    ...BATCH_TIMING,
  },
  {
    key: "batch-xauusd-dec26",
    family: "BATCH_ROUND",
    kind: "BATCH_ORDER",
    priceRule: "UNIFORM_PRICE",
    marketId: "XAUUSD-FW-30DEC26",
    cycle: 240,
    commit: 150,
    reveal: 60,
    positionAtStart: 12,
    lotStep: 2,
    lotRange: [16, 64],
    side: "ALTERNATE",
    bidderRange: [3, 6],
    roundBase: 1_402,
    ...BATCH_TIMING,
  },
  {
    key: "sealed-btc-yc-mar27",
    family: "SEALED",
    kind: "SOLVER_ROUTE",
    priceRule: "BEST_PACKAGE",
    marketId: "BTC-YC-26MAR27",
    cycle: 2_400,
    commit: 1_500,
    reveal: 300,
    positionAtStart: 900,
    lotStep: 5,
    lotRange: [120, 180],
    side: "BUY",
    bidderRange: [4, 6],
    bondUsd: 5_000,
    failureModulus: 7,
    roundBase: 212,
    ...SEALED_TIMING,
  },
  {
    key: "sealed-eth-fc-dec26",
    family: "SEALED",
    kind: "BATCH_ORDER",
    priceRule: "PAY_AS_BID",
    marketId: "ETH-FC-24DEC26",
    cycle: 1_800,
    commit: 1_200,
    reveal: 240,
    positionAtStart: 1_322,
    lotStep: 10,
    lotRange: [200, 280],
    side: "SELL",
    bidderRange: [4, 7],
    bondUsd: 2_500,
    failureModulus: 0,
    roundBase: 318,
    ...SEALED_TIMING,
  },
  {
    key: "sealed-eurusd-mar27",
    family: "SEALED",
    kind: "SOLVER_ROUTE",
    priceRule: "BEST_PACKAGE",
    marketId: "EURUSD-FW-31MAR27",
    cycle: 2_400,
    commit: 1_200,
    reveal: 300,
    positionAtStart: 2_040,
    lotStep: 5,
    lotRange: [60, 110],
    side: "BUY",
    bidderRange: [3, 5],
    bondUsd: 5_000,
    failureModulus: 5,
    roundBase: 147,
    ...SEALED_TIMING,
  },
  {
    key: "sealed-xauusd-jun27",
    family: "SEALED",
    kind: "BATCH_ORDER",
    priceRule: "PAY_AS_BID",
    marketId: "XAUUSD-FW-29JUN27",
    cycle: 1_200,
    commit: 600,
    reveal: 180,
    positionAtStart: 14,
    lotStep: 2,
    lotRange: [40, 80],
    side: "BUY",
    bidderRange: [3, 6],
    bondUsd: 1_500,
    failureModulus: 0,
    roundBase: 96,
    ...SEALED_TIMING,
  },
  {
    key: "sealed-arb-bs-mar27",
    family: "SEALED",
    kind: "SOLVER_ROUTE",
    priceRule: "BEST_PACKAGE",
    marketId: "ARB-BS-26MAR27",
    cycle: 2_700,
    commit: 1_800,
    reveal: 300,
    positionAtStart: 2_108,
    lotStep: 5,
    lotRange: [60, 100],
    side: "SELL",
    bidderRange: [3, 5],
    bondUsd: 3_000,
    failureModulus: 3,
    roundBase: 58,
    ...SEALED_TIMING,
  },
  {
    key: "sealed-btc-yc-jun27",
    family: "SEALED",
    kind: "SOLVER_ROUTE",
    priceRule: "BEST_PACKAGE",
    marketId: "BTC-YC-25JUN27",
    cycle: 3_600,
    commit: 2_400,
    reveal: 600,
    positionAtStart: 3_100,
    lotStep: 5,
    lotRange: [30, 50],
    side: "BUY",
    bidderRange: [3, 5],
    bondUsd: 5_000,
    failureModulus: 4,
    roundBase: 31,
    ...SEALED_TIMING,
  },
];

export const AUCTION_FAMILIES: AuctionFamily[] = FAMILY_SPECS.filter((family) =>
  MARKETS.some((market) => market.id === family.marketId),
);

export function familyByKey(key: string): AuctionFamily | null {
  return AUCTION_FAMILIES.find((family) => family.key === key) ?? null;
}

function marketFor(family: AuctionFamily): PackageMarket {
  const market = MARKETS.find((candidate) => candidate.id === family.marketId);
  if (!market) throw new Error(`UNKNOWN_AUCTION_MARKET_${family.marketId}`);
  return market;
}

/** Commit opening of round `round`; round zero is the one in progress at the first preview tick. */
export function roundOpensAt(family: AuctionFamily, round: number): number {
  return PREVIEW_EPOCH_SECONDS - family.positionAtStart + round * family.cycle;
}

/** The round whose commit window most recently opened at or before `epoch`. */
export function roundAt(family: AuctionFamily, epoch: number): number {
  return Math.floor((epoch - roundOpensAt(family, 0)) / family.cycle);
}

/* ------------------------------------------------------------------ */
/* Static round construction                                           */
/* ------------------------------------------------------------------ */

interface StaticBid {
  id: Bytes32;
  bidder: Participant;
  committedAt: number;
  revealedAt: number | null;
  bid: SealedBid;
  route: SolverRouteRecord | null;
  bondLockId: Bytes32;
}

interface StaticRound {
  family: AuctionFamily;
  round: number;
  id: Bytes32;
  definition: AuctionDefinition;
  bids: StaticBid[];
  keeper: KeeperSchedule;
  referenceTicks: number;
  settlementFails: boolean;
  outcome: ClearingOutcome | null;
}

const rounds = new Map<string, StaticRound>();

function kindPolicy(kind: AuctionKind): {
  unrevealed: BondOutcome;
  losing: BondOutcome;
  failure: BondOutcome;
  noBid: "CANCEL" | "FAIL";
} {
  return kind === "SOLVER_ROUTE"
    ? { unrevealed: "SLASH", losing: "EXPIRE", failure: "SLASH", noBid: "FAIL" }
    : { unrevealed: "SLASH", losing: "RELEASE", failure: "SLASH", noBid: "CANCEL" };
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

const FEE_BPS = [0.8, 0.9, 0.9, 1, 1.2];

function buildRound(family: AuctionFamily, round: number): StaticRound {
  const market = marketFor(family);
  const random = seeded(`${family.key}:${round}`);
  const id = modeledHash(`auction:${family.key}:${round}`);
  const opens = roundOpensAt(family, round);
  const commitClosesAt = opens + family.commit;
  const revealClosesAt = commitClosesAt + family.reveal;
  const clearDeadline = revealClosesAt + family.clearWindow;
  const settlementDeadline = clearDeadline + family.settlementWindow;
  const bondExpiry = settlementDeadline + family.bondWindow;
  const side: Side =
    family.side === "ALTERNATE" ? (fnv(`${family.key}:${round}:side`) & 1 ? "BUY" : "SELL") : family.side;
  const steps = between(random, Math.ceil(family.lotRange[0] / family.lotStep), Math.floor(family.lotRange[1] / family.lotStep));
  const totalLots = steps * family.lotStep;
  const policy = kindPolicy(family.kind);
  const settlementFails =
    family.failureModulus > 0 && fnv(`${family.key}:${round}:settlement`) % family.failureModulus === 0;
  const clearAt = revealClosesAt + family.clearDelay;

  const definition: AuctionDefinition = {
    namespaceId: modeledHash("namespace:setryn-auctions-v1"),
    auctionKey: modeledHash(`auction-key:${family.key}:${round}`),
    initiatorOrderHash: modeledHash(`initiator-order:${family.key}:${round}`),
    initiatorAccountId: modeledHash(`initiator-account:${family.key}:${round % 5}`),
    initiatorMaximumFeeMinor: Math.round(totalLots * market.notionalPerLot * 0.00012 * 1_000_000),
    executionModeId: modeledHash(`execution-mode:${family.kind}`),
    kind: family.kind,
    targetKind: "PACKAGE",
    seriesId: ZERO_BYTES32,
    packageId: modeledHash(`package:${market.id}`),
    targetVersion: 1,
    hasPackageLegCommitment: true,
    packageLegsHash: modeledHash(`package-legs:${market.id}`),
    auctionSide: side,
    settlementAssetId: modeledHash("asset:USDC"),
    settlementAssetVersion: 1,
    riskDomainId: modeledHash(`risk-domain:${market.underlying}`),
    riskDomainVersion: 1,
    feeScheduleId: modeledHash("fee-schedule:auction-v1"),
    feeScheduleVersion: 1,
    eligibilityPolicyHash: modeledHash(`eligibility:${family.family}`),
    capacityPolicyHash: modeledHash(`capacity:${family.kind}`),
    bondPolicyHash: modeledHash(`bond:${family.kind}`),
    allocationPolicyHash: modeledHash(`allocation:${family.priceRule}`),
    guaranteeClassId: modeledHash(family.kind === "SOLVER_ROUTE" ? "guarantee:solver-bonded" : "guarantee:package-atomic"),
    priceRule: family.priceRule,
    tieBreakRule: "COMMITMENT_HASH_ASCENDING",
    noBidTreatment: policy.noBid,
    unrevealedBondOutcome: policy.unrevealed,
    losingBondOutcome: policy.losing,
    settlementFailureBondOutcome: policy.failure,
    totalLots,
    lotStep: family.lotStep,
    maximumBids: family.maximumBids,
    commitOpensAt: opens,
    commitClosesAt,
    revealClosesAt,
    clearDeadline,
    settlementDeadline,
    bondExpiry,
    bondAssetId: modeledHash("asset:USDC"),
    bondBindingVersion: 1,
    requiredBondAmount: family.bondUsd * 1_000_000,
    slashRecipientAccountId: modeledHash("account:insurance-fund"),
    maximumKeeperRewardMinor: 5 * 1_000_000,
    qualificationEvidenceHash: modeledHash(`qualification:${market.id}`),
  };

  /* Bidders: a shuffled slice of the roster; the operated solver joins most rounds. */
  const count = between(random, family.bidderRange[0], family.bidderRange[1]);
  const pool = shuffle(AUCTION_BIDDERS, random);
  const own = pool.find((entry) => entry.id === OWN_SOLVER_ID);
  const others = pool.filter((entry) => entry.id !== OWN_SOLVER_ID);
  const ownJoins = own !== undefined && fnv(`${family.key}:${round}:own`) % 4 !== 0;
  const bidders = [...(ownJoins && own ? [own] : []), ...others].slice(0, count);
  const grid = gridTicks(market);

  const bids: StaticBid[] = bidders.map((bidder) => {
    const bidRandom = seeded(`${family.key}:${round}:${bidder.id}`);
    const earliest = Math.min(family.commit - 2, bidder.responseSeconds);
    const committedAt = opens + earliest + Math.floor(bidRandom() * (family.commit - earliest - 1));
    const neverReveals = bidRandom() < (bidder.id === OWN_SOLVER_ID ? 0.02 : 0.04);
    const revealedAt = neverReveals ? null : commitClosesAt + 1 + Math.floor(bidRandom() * (family.reveal * 0.85));
    const reference = feedReferenceAt(market, committedAt);
    /* A Buy auction collects offers, so better means lower; a Sell auction collects bids. */
    const improvement = between(bidRandom, -2, 5);
    const priceTicks =
      side === "BUY"
        ? priceToTicks(reference.ask, market) + improvement * grid
        : priceToTicks(reference.bid, market) - improvement * grid;
    const solverRoute = family.kind === "SOLVER_ROUTE";
    let lots: number;
    let allowPartialAllocation: boolean;
    let minimumFillLots: number;
    if (solverRoute) {
      lots = totalLots;
      allowPartialAllocation = false;
      minimumFillLots = totalLots;
    } else {
      const maxSteps = Math.max(1, Math.ceil(steps * 0.7));
      lots = between(bidRandom, 1, maxSteps) * family.lotStep;
      allowPartialAllocation = bidRandom() < 0.7;
      minimumFillLots = allowPartialAllocation
        ? Math.max(1, Math.floor((lots / family.lotStep) * 0.4)) * family.lotStep
        : lots;
    }
    const feeBps = FEE_BPS[Math.floor(bidRandom() * FEE_BPS.length)];
    const maximumFeeMinor = Math.round(lots * market.notionalPerLot * (feeBps / 10_000) * 1_000_000);
    const bidId = modeledHash(`bid:${family.key}:${round}:${bidder.id}`);
    const routeId = solverRoute ? modeledHash(`route:${family.key}:${round}:${bidder.id}`) : ZERO_BYTES32;
    const bidderAccountId = modeledHash(`account:${bidder.id}`);
    const sealed: SealedBid = {
      auctionId: id,
      auctionVersion: 1,
      bidder: bidder.address,
      bidderAccountId,
      bidderOrderHash: modeledHash(`bid-order:${family.key}:${round}:${bidder.id}`),
      nonce: String(round * 1_000 + fnv(bidder.id) % 997),
      side,
      lots,
      allowPartialAllocation,
      minimumFillLots,
      priceTicks,
      maximumFeeMinor,
      solverRouteId: routeId,
      capacityEvidenceHash: modeledHash(`capacity-evidence:${bidder.id}`),
      revealSalt: modeledHash(`reveal-salt:${family.key}:${round}:${bidder.id}`),
    };
    const route: SolverRouteRecord | null = solverRoute
      ? {
          route: {
            auctionId: id,
            auctionVersion: 1,
            solver: bidder.address,
            solverAccountId: bidderAccountId,
            routeId,
            packageLegsHash: definition.packageLegsHash,
            actionGraphHash: modeledHash(`action-graph:${family.key}:${round}:${bidder.id}`),
            legCount: market.legs.length,
            actionCount: market.legs.length + between(bidRandom, 0, 2),
            packageOutcomeTicks: priceTicks,
            maximumFeeMinor,
            capacityLockId: modeledHash(`capacity-lock:${family.key}:${round}:${bidder.id}`),
            capacityCollateralId: modeledHash("collateral:USDC"),
            capacityAmount: Math.round(lots * market.collateralPerLot * (0.95 + bidRandom() * 0.45)) * 1_000_000,
            capacityEvidenceHash: sealed.capacityEvidenceHash,
            expiry: settlementDeadline,
            guaranteeClassId: definition.guaranteeClassId,
            salt: modeledHash(`route-salt:${family.key}:${round}:${bidder.id}`),
          },
          routeHash: modeledHash(`route-hash:${family.key}:${round}:${bidder.id}`),
          revealed: revealedAt !== null,
        }
      : null;
    return {
      id: bidId,
      bidder,
      committedAt,
      revealedAt,
      bid: sealed,
      route,
      bondLockId: modeledHash(`bond-lock:${family.key}:${round}:${bidder.id}`),
    };
  });

  const referenceTicks = priceToTicks(feedReferenceAt(market, opens).mark, market);
  return {
    family,
    round,
    id,
    definition,
    bids,
    keeper: {
      clearAt,
      settleAt: clearAt + family.settleDelay,
      failAt: settlementDeadline + (family.family === "SEALED" ? 20 : 5),
    },
    referenceTicks,
    settlementFails,
    outcome: null,
  };
}

function staticRound(family: AuctionFamily, round: number): StaticRound {
  const key = `${family.key}:${round}`;
  let value = rounds.get(key);
  if (!value) {
    value = buildRound(family, round);
    rounds.set(key, value);
  }
  return value;
}

/** Clearing depends only on revealed bids, so it is computed once per round. */
function outcomeFor(round: StaticRound): ClearingOutcome {
  if (!round.outcome) {
    const revealed: BidView[] = round.bids.map((entry) => ({
      id: entry.id,
      bidderLabel: entry.bidder.label,
      bidderId: entry.bidder.id,
      committedAt: entry.committedAt,
      revealedAt: entry.revealedAt,
      route: entry.route,
      record: {
        authorization: authorizationFor(round, entry),
        bid: entry.revealedAt === null ? null : entry.bid,
        routeId: entry.route?.route.routeId ?? ZERO_BYTES32,
        bondLockId: entry.bondLockId,
        status: entry.revealedAt === null ? "UNREVEALED" : "REVEALED",
        allocatedLots: 0,
        allocationPriceTicks: 0,
      },
    }));
    round.outcome = computeClearingResult(round.id, 1, round.definition, revealed);
  }
  return round.outcome;
}

function authorizationFor(round: StaticRound, entry: StaticBid): BidRecord["authorization"] {
  return {
    auctionId: round.id,
    auctionVersion: 1,
    bidder: entry.bidder.address,
    bidderAccountId: entry.bid.bidderAccountId,
    nonce: entry.bid.nonce,
    sealedBidHash: modeledHash(`sealed-bid:${round.family.key}:${round.round}:${entry.bidder.id}`),
    eligibilityProofHash: modeledHash(`eligibility-proof:${entry.bidder.id}`),
    deadline: round.definition.commitClosesAt,
    salt: modeledHash(`commit-salt:${round.family.key}:${round.round}:${entry.bidder.id}`),
  };
}

/* ------------------------------------------------------------------ */
/* Projection at a point on the preview clock                          */
/* ------------------------------------------------------------------ */

function statusAt(round: StaticRound, epoch: number): AuctionStatus {
  const definition = round.definition;
  if (epoch < definition.commitOpensAt) return "SCHEDULED";
  if (epoch < definition.commitClosesAt) return "COMMIT_OPEN";
  if (epoch < definition.revealClosesAt) return "REVEAL_OPEN";
  if (epoch < round.keeper.clearAt) return "READY_TO_CLEAR";
  const outcome = outcomeFor(round);
  if (outcome.result.winnerCount === 0) return definition.noBidTreatment === "CANCEL" ? "CANCELLED" : "FAILED";
  if (round.settlementFails) return epoch < round.keeper.failAt ? "CLEARED" : "FAILED";
  return epoch < round.keeper.settleAt ? "CLEARED" : "SETTLED";
}

function bondAfter(outcome: BondOutcome, fallback: BidStatus): BidStatus {
  if (outcome === "SLASH") return "BOND_SLASHED";
  if (outcome === "RELEASE") return "BOND_RELEASED";
  return fallback;
}

function bidStatusAt(
  round: StaticRound,
  entry: StaticBid,
  status: AuctionStatus,
  epoch: number,
  winners: Map<Bytes32, { lots: number; priceTicks: number }>,
): BidStatus {
  const definition = round.definition;
  /* releaseExpiredBond is permissionless; the model assumes a keeper sweeps expired bonds ten minutes late. */
  const releasedAfterExpiry = epoch >= definition.bondExpiry + BOND_SWEEP_DELAY;
  if (entry.revealedAt === null) {
    if (epoch < definition.revealClosesAt) return "COMMITTED";
    const resolved = bondAfter(definition.unrevealedBondOutcome, "UNREVEALED");
    return resolved === "UNREVEALED" && releasedAfterExpiry ? "BOND_RELEASED" : resolved;
  }
  if (epoch < entry.revealedAt) return "COMMITTED";
  if (epoch < round.keeper.clearAt || status === "READY_TO_CLEAR") return "REVEALED";
  if (status === "CANCELLED" || (status === "FAILED" && winners.size === 0)) {
    return releasedAfterExpiry ? "BOND_RELEASED" : "REVEALED";
  }
  if (winners.has(entry.id)) {
    if (status === "SETTLED") return "BOND_RELEASED";
    if (status === "FAILED") return bondAfter(definition.settlementFailureBondOutcome, "WINNER");
    return "WINNER";
  }
  const losing = bondAfter(definition.losingBondOutcome, "LOSER");
  return losing === "LOSER" && releasedAfterExpiry ? "BOND_RELEASED" : losing;
}

/** The auction exactly as the contract would report it at `epoch`, with sealed contents withheld. */
export function auctionAt(family: AuctionFamily, round: number, epoch: number): AuctionRecord {
  const base = staticRound(family, round);
  const status = statusAt(base, epoch);
  const cleared = status === "CLEARED" || status === "SETTLED" || (status === "FAILED" && epoch >= base.keeper.clearAt);
  const outcome = cleared ? outcomeFor(base) : null;
  const winners = new Map<Bytes32, { lots: number; priceTicks: number }>();
  if (outcome) for (const allocation of outcome.allocations) winners.set(allocation.bidId, allocation);

  const committed = base.bids.filter((entry) => epoch >= entry.committedAt);
  const bids: BidView[] = committed.map((entry) => {
    const revealedNow = entry.revealedAt !== null && epoch >= entry.revealedAt;
    const allocation = winners.get(entry.id);
    return {
      id: entry.id,
      bidderLabel: entry.bidder.label,
      bidderId: entry.bidder.id,
      committedAt: entry.committedAt,
      revealedAt: revealedNow ? entry.revealedAt : null,
      route: entry.route && revealedNow ? entry.route : null,
      record: {
        authorization: authorizationFor(base, entry),
        bid: revealedNow ? entry.bid : null,
        routeId: revealedNow ? (entry.route?.route.routeId ?? ZERO_BYTES32) : ZERO_BYTES32,
        bondLockId: entry.bondLockId,
        status: bidStatusAt(base, entry, status, epoch, winners),
        allocatedLots: allocation?.lots ?? 0,
        allocationPriceTicks: allocation?.priceTicks ?? 0,
      },
    };
  });

  const market = marketFor(family);
  const result = outcome && outcome.result.winnerCount > 0 ? outcome.result : null;
  const code = market.code;
  const label =
    family.family === "BATCH_ROUND"
      ? `Batch ${code} R${family.roundBase + round}`
      : `${family.kind === "SOLVER_ROUTE" ? "Route" : "Block"} ${code} #${family.roundBase + round}`;
  return {
    id: base.id,
    label,
    family: family.key,
    round,
    marketId: market.id,
    source: "MODELED",
    version: {
      definition: base.definition,
      definitionHash: modeledHash(`definition:${family.key}:${round}`),
      versionHash: modeledHash(`version:${family.key}:${round}`),
      version: 1,
      status,
      commitmentCount: committed.length,
      revealCount: base.bids.filter((entry) => entry.revealedAt !== null && epoch >= entry.revealedAt).length,
      clearingResultHash: result ? result.resultHash : ZERO_BYTES32,
    },
    bids,
    result,
    batchHeader:
      result && family.kind === "BATCH_ORDER" && status === "SETTLED"
        ? {
            auctionId: base.id,
            auctionVersion: 1,
            auctionResultHash: result.resultHash,
            targetKind: "PACKAGE",
            seriesId: ZERO_BYTES32,
            packageId: base.definition.packageId,
            targetVersion: 1,
            packageWitnessHash: modeledHash(`package-witness:${market.id}`),
            feeScheduleId: base.definition.feeScheduleId,
            feeScheduleVersion: 1,
            riskDomainId: base.definition.riskDomainId,
            riskDomainVersion: 1,
            priceRule: base.definition.priceRule,
            totalAllocatedLots: result.totalAllocatedLots,
            winnerCount: result.winnerCount,
            allocationsHash: result.allocationsHash,
            settlementDeadline: base.definition.settlementDeadline,
          }
        : null,
    keeper: base.keeper,
    referenceTicks: base.referenceTicks,
    settlementFails: base.settlementFails,
  };
}

/** Contract ranking of revealed bids, winners first; empty until clearing. */
export function rankingFor(record: AuctionRecord): { ranking: Bytes32[]; skipped: Bytes32[] } {
  if (!record.result && record.version.status !== "FAILED" && record.version.status !== "CANCELLED") {
    return { ranking: [], skipped: [] };
  }
  const family = familyByKey(record.family);
  if (!family) return { ranking: [], skipped: [] };
  const outcome = outcomeFor(staticRound(family, record.round));
  return { ranking: outcome.ranking, skipped: outcome.skipped };
}

/* ------------------------------------------------------------------ */
/* Board                                                               */
/* ------------------------------------------------------------------ */

export const TERMINAL_STATUSES: AuctionStatus[] = ["SETTLED", "CANCELLED", "FAILED"];

export function isTerminal(status: AuctionStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** Seconds after bond expiry before the modeled keeper calls releaseExpiredBond. */
export const BOND_SWEEP_DELAY = 600;

/** Seconds a settled sealed round stays on the live board before its successor is listed. */
const SEALED_HOLD_SECONDS = 90;

export interface BatchLane {
  family: AuctionFamily;
  current: AuctionRecord;
  /** The most recent round that has cleared, settled, cancelled or failed. */
  previous: AuctionRecord | null;
}

export interface AuctionBoard {
  epoch: number;
  sealed: AuctionRecord[];
  lanes: BatchLane[];
  history: AuctionRecord[];
}

function currentSealedRound(family: AuctionFamily, epoch: number): number {
  const round = roundAt(family, epoch);
  const record = staticRound(family, round);
  const done = Math.max(record.keeper.settleAt, record.settlementFails ? record.keeper.failAt : 0);
  return epoch >= done + SEALED_HOLD_SECONDS ? round + 1 : round;
}

function previousTerminal(family: AuctionFamily, from: number, epoch: number): AuctionRecord | null {
  for (let round = from; round > from - 4; round -= 1) {
    const record = auctionAt(family, round, epoch);
    if (record.result || isTerminal(record.version.status)) return record;
  }
  return null;
}

/** Every round of every family whose commit opened inside [from, to], projected at `epoch`. */
export function roundsBetween(from: number, to: number, epoch: number, families = AUCTION_FAMILIES): AuctionRecord[] {
  const records: AuctionRecord[] = [];
  for (const family of families) {
    const first = Math.ceil((from - roundOpensAt(family, 0)) / family.cycle);
    const last = roundAt(family, to);
    for (let round = first; round <= last; round += 1) records.push(auctionAt(family, round, epoch));
  }
  return records;
}

export function auctionBoard(epoch: number, historyWindowSeconds = 3_600): AuctionBoard {
  const sealed = AUCTION_FAMILIES.filter((family) => family.family === "SEALED")
    .map((family) => auctionAt(family, currentSealedRound(family, epoch), epoch))
    .sort((left, right) => nextDeadline(left, epoch) - nextDeadline(right, epoch));

  /* A batch lane shows the round that is collecting; once a round clears it becomes the lane's last result. */
  const lanes = AUCTION_FAMILIES.filter((family) => family.family === "BATCH_ROUND").map((family) => {
    const round = roundAt(family, epoch);
    const latest = auctionAt(family, round, epoch);
    const cleared = latest.result !== null || isTerminal(latest.version.status);
    return {
      family,
      current: cleared ? auctionAt(family, round + 1, epoch) : latest,
      previous: cleared ? latest : previousTerminal(family, round - 1, epoch),
    };
  });

  const liveIds = new Set([...sealed.map((record) => record.id), ...lanes.map((lane) => lane.current.id)]);
  const history = roundsBetween(epoch - historyWindowSeconds, epoch, epoch)
    .filter((record) => !liveIds.has(record.id) && (isTerminal(record.version.status) || record.version.status === "CLEARED"))
    .sort((left, right) => right.keeper.clearAt - left.keeper.clearAt);

  return { epoch, sealed, lanes, history };
}

/** The next deadline that changes this auction's status, or its last one once terminal. */
export function nextDeadline(record: AuctionRecord, epoch: number): number {
  const definition = record.version.definition;
  const candidates = [
    definition.commitOpensAt,
    definition.commitClosesAt,
    definition.revealClosesAt,
    record.keeper.clearAt,
    record.settlementFails ? record.keeper.failAt : record.keeper.settleAt,
  ];
  return candidates.find((value) => value > epoch) ?? candidates[candidates.length - 1];
}

export function findAuction(board: AuctionBoard, id: string): AuctionRecord | null {
  return (
    board.sealed.find((record) => record.id === id) ??
    board.lanes.map((lane) => lane.current).find((record) => record.id === id) ??
    board.lanes.map((lane) => lane.previous).find((record) => record?.id === id) ??
    board.history.find((record) => record.id === id) ??
    null
  );
}

export function marketOf(record: AuctionRecord): PackageMarket {
  return MARKETS.find((market) => market.id === record.marketId) ?? MARKETS[0];
}
