import { ticksToPrice } from "@/lib/auctions/feed";
import { modeledHash, rankingFor, roundsBetween, type AuctionBoard } from "@/lib/auctions/schedule";
import type { AuctionRecord, BidView, LiquidityProvenance } from "@/lib/auctions/types";
import type { RfqRequest } from "@/lib/internal-gateway/types";
import { executableAction } from "@/lib/terminal/economics";
import type { BookRow, LiquiditySource, PackageMarket, RouteQuote } from "@/lib/terminal/types";
import { OWN_SOLVER_ID, participant } from "./roster";
import type {
  BondLock,
  CapacityLedger,
  Eligibility,
  RecoveryCase,
  RejectReason,
  RoutePlan,
  RoutePlanExclusion,
  RoutePlanFill,
  SolverOpportunity,
  SolverPerformance,
} from "./types";

/**
 * Solver read model. Liquidity comes from the shared preview feed's books and
 * routes; auction opportunities, reservations and history come from the modeled
 * auction schedule; private requests come from the gateway snapshot.
 */

const BOOK_PROVENANCE: Record<LiquiditySource, LiquidityProvenance> = {
  DIRECT: "DIRECT",
  IMPLIED: "IMPLIED_IN",
  SOLVER_FIRM: "SOLVER_FIRM",
};

const INVALIDATION: Record<LiquiditySource, string> = {
  DIRECT: "Cancelled or filled resting package order",
  IMPLIED: "Either component book moves or its source reservation lapses",
  SOLVER_FIRM: "Quote TTL lapses or the solver withdraws capacity",
};

const ROUTE_ID: Record<LiquiditySource, string> = {
  DIRECT: "DIRECT_BOOK",
  IMPLIED: "IMPLIED_LEGS",
  SOLVER_FIRM: "SOLVER_RFQ",
};

function routeFor(market: PackageMarket, source: LiquiditySource): RouteQuote | null {
  return market.routes.find((route) => route.id === ROUTE_ID[source]) ?? null;
}

function isOwn(row: BookRow): boolean {
  return row.source === "SOLVER_FIRM" && (row.origin ?? "").includes(OWN_SOLVER_ID);
}

/**
 * The hybrid liquidity waterfall a solver would use to hedge `lots`: best price
 * first across direct, implied and other solvers' firm rows, never its own
 * quotes (self-match protection) and never indicative depth.
 */
export function planRoute(market: PackageMarket, hedgeAction: "BUY" | "SELL", lots: number): RoutePlan {
  const bookSide = hedgeAction === "BUY" ? "ASK" : "BID";
  const rows = market.book
    .filter((row) => row.side === bookSide)
    .sort((left, right) => (hedgeAction === "BUY" ? left.price - right.price : right.price - left.price));
  const exclusions: RoutePlanExclusion[] = [];
  const fills: RoutePlanFill[] = [];
  let remaining = lots;
  let notional = 0;
  let feesUsd = 0;
  let exposure = 0;
  let collateral = 0;
  for (const row of rows) {
    if (!row.executable || row.firmness === "INDICATIVE") {
      exclusions.push({ reason: "INDICATIVE", provenance: "INDICATIVE", price: row.price, lots: row.lots, origin: row.origin ?? null });
      continue;
    }
    if (isOwn(row)) {
      exclusions.push({ reason: "SELF_MATCH", provenance: BOOK_PROVENANCE[row.source], price: row.price, lots: row.lots, origin: row.origin ?? null });
      continue;
    }
    if (remaining <= 0) continue;
    const take = Math.min(remaining, row.lots);
    remaining -= take;
    const route = routeFor(market, row.source);
    const feeBps = (route?.protocolFeeBps ?? 2.5) + (route?.counterpartyFeeBps ?? 0);
    notional += row.price * take;
    feesUsd += (take * market.notionalPerLot * feeBps) / 10_000;
    exposure += take * market.notionalPerLot * (route?.intermediateExposureRate ?? 0);
    collateral += take * market.collateralPerLot * (route?.collateralMultiple ?? 1);
    fills.push({
      provenance: BOOK_PROVENANCE[row.source],
      price: row.price,
      lots: take,
      origin: row.origin ?? null,
      firm: row.firmness === "FIRM",
      reservation: row.source === "DIRECT" ? "NOT_REQUIRED" : "RESERVE_ON_COMMIT",
      invalidation: INVALIDATION[row.source],
    });
  }
  const fillableLots = lots - Math.max(0, remaining);
  const vwap = fillableLots > 0 ? notional / fillableLots : null;
  const worst = fills.length > 0 ? fills[fills.length - 1].price : null;
  const feePrice = fillableLots > 0 ? feesUsd / (fillableLots * market.contractMultiplier) : 0;
  const breakEven = vwap === null ? null : hedgeAction === "BUY" ? vwap + feePrice : vwap - feePrice;
  const classes = new Map<LiquidityProvenance, number>();
  for (const fill of fills) classes.set(fill.provenance, (classes.get(fill.provenance) ?? 0) + fill.lots);
  return {
    marketId: market.id,
    hedgeAction,
    requestedLots: lots,
    fillableLots,
    fills,
    exclusions,
    byClass: [...classes.entries()].map(([provenance, classLots]) => ({
      provenance,
      lots: classLots,
      share: fillableLots > 0 ? classLots / fillableLots : 0,
    })),
    touch: hedgeAction === "BUY" ? market.bestAsk : market.bestBid,
    vwap,
    worst,
    feesUsd,
    feePrice,
    breakEven,
    sequencedExposureUsd: exposure,
    collateralUsd: collateral,
  };
}

/** Room between the live touch and the break-even price, for the full size, in USDC. */
function roomUsd(plan: RoutePlan, market: PackageMarket, initiatorSide: "BUY" | "SELL"): number | null {
  if (plan.breakEven === null || plan.fillableLots < plan.requestedLots) return null;
  const perUnit = initiatorSide === "BUY" ? plan.touch - plan.breakEven : plan.breakEven - plan.touch;
  return perUnit * market.contractMultiplier * plan.requestedLots;
}

function ownBid(record: AuctionRecord): BidView | null {
  return record.bids.find((bid) => bid.bidderId === OWN_SOLVER_ID) ?? null;
}

function liveOf(markets: PackageMarket[], id: string): PackageMarket | null {
  return markets.find((market) => market.id === id) ?? null;
}

function eligibilityFor(
  market: PackageMarket,
  plan: RoutePlan,
  requiredUsd: number,
  availableUsd: number,
): { eligibility: Eligibility; note: string } {
  if (market.qualification === "SUSPENDED") {
    return { eligibility: "BLOCKED", note: "Market qualification is suspended." };
  }
  if (requiredUsd > availableUsd) {
    return { eligibility: "CAPACITY_LIMITED", note: "Collateral plus bond exceeds available solver capacity." };
  }
  if (plan.fillableLots < plan.requestedLots) {
    return {
      eligibility: "DEPTH_SHORT",
      note: `Executable depth covers ${plan.fillableLots} of ${plan.requestedLots} lots without own quotes.`,
    };
  }
  if (market.qualification === "CONDITIONAL") {
    return { eligibility: "SIZE_CAPPED", note: "Conditional qualification caps position size." };
  }
  return { eligibility: "ELIGIBLE", note: "Qualified market, capacity and depth available." };
}

export function solverOpportunities({
  board,
  markets,
  epoch,
  rfqRequests,
  nowMs,
  availableUsd,
}: {
  board: AuctionBoard;
  markets: PackageMarket[];
  epoch: number;
  rfqRequests: RfqRequest[];
  nowMs: number;
  availableUsd: number;
}): SolverOpportunity[] {
  const opportunities: SolverOpportunity[] = [];
  const auctions = [
    ...board.sealed.map((record) => ({ record, source: "SEALED_AUCTION" as const })),
    ...board.lanes.map((lane) => ({ record: lane.current, source: "BATCH_ROUND" as const })),
  ];
  for (const { record, source } of auctions) {
    const status = record.version.status;
    const own = ownBid(record);
    const open = status === "SCHEDULED" || status === "COMMIT_OPEN" || (status === "REVEAL_OPEN" && own !== null);
    if (!open) continue;
    const market = liveOf(markets, record.marketId);
    if (!market) continue;
    const definition = record.version.definition;
    const initiatorSide = definition.auctionSide === "BUY" ? "BUY" : "SELL";
    const plan = planRoute(market, initiatorSide === "BUY" ? "BUY" : "SELL", definition.totalLots);
    const bondUsd = definition.requiredBondAmount / 1_000_000;
    const capacityRequiredUsd = plan.collateralUsd + bondUsd;
    const { eligibility, note } = eligibilityFor(market, plan, capacityRequiredUsd, availableUsd);
    const ownState =
      status === "SCHEDULED"
        ? "SCHEDULED"
        : own === null
          ? "NOT_COMMITTED"
          : status === "REVEAL_OPEN"
            ? own.revealedAt === null
              ? "REVEAL_DUE"
              : "REVEALED"
            : "COMMITTED";
    const deadline =
      status === "SCHEDULED"
        ? definition.commitOpensAt
        : status === "COMMIT_OPEN"
          ? definition.commitClosesAt
          : definition.revealClosesAt;
    opportunities.push({
      id: record.id,
      source,
      provenance: "MODELED",
      label: record.label,
      marketId: record.marketId,
      auction: record,
      requestId: null,
      initiatorSide,
      lots: definition.totalLots,
      deadline,
      clock: "PREVIEW",
      deadlineLabel: status === "SCHEDULED" ? "Commit opens" : status === "COMMIT_OPEN" ? "Commit closes" : "Reveal closes",
      bidders: record.version.commitmentCount,
      ownState,
      eligibility,
      eligibilityNote: note,
      bondUsd,
      plan,
      edgeUsd: roomUsd(plan, market, initiatorSide),
      capacityRequiredUsd,
    });
  }

  for (const request of rfqRequests) {
    const expiresMs = Date.parse(request.expiresAt);
    if (request.state !== "OPEN" || !Number.isFinite(expiresMs) || expiresMs <= nowMs) continue;
    const intent = request.authorization.intent;
    const market = liveOf(markets, intent.marketId);
    if (!market) continue;
    const initiatorSide = executableAction(intent.side, intent.packageSide);
    const plan = planRoute(market, initiatorSide, intent.lots);
    const capacityRequiredUsd = plan.collateralUsd;
    const { eligibility, note } = eligibilityFor(market, plan, capacityRequiredUsd, availableUsd);
    opportunities.push({
      id: request.id,
      source: "PRIVATE_RFQ",
      provenance: "OBSERVED",
      label: `RFQ ${intent.packageCode}`,
      marketId: intent.marketId,
      auction: null,
      requestId: request.id,
      initiatorSide,
      lots: intent.lots,
      deadline: Math.floor(expiresMs / 1000),
      clock: "WALL",
      deadlineLabel: "Request closes",
      bidders: request.quotes.length,
      ownState: "QUOTE_IN_MAKER_DESK",
      eligibility,
      eligibilityNote: note,
      bondUsd: 0,
      plan,
      edgeUsd: roomUsd(plan, market, initiatorSide),
      capacityRequiredUsd,
    });
  }

  return opportunities.sort((left, right) => {
    const leftSeconds = left.clock === "PREVIEW" ? left.deadline - epoch : left.deadline - nowMs / 1000;
    const rightSeconds = right.clock === "PREVIEW" ? right.deadline - epoch : right.deadline - nowMs / 1000;
    return leftSeconds - rightSeconds;
  });
}

/* ------------------------------------------------------------------ */
/* Window of rounds the operated solver took part in                   */
/* ------------------------------------------------------------------ */

export function solverWindow(board: AuctionBoard, epoch: number, windowSeconds: number): AuctionRecord[] {
  const byId = new Map<string, AuctionRecord>();
  for (const record of roundsBetween(epoch - windowSeconds, epoch, epoch)) byId.set(record.id, record);
  for (const record of board.sealed) byId.set(record.id, record);
  for (const lane of board.lanes) byId.set(lane.current.id, lane.current);
  return [...byId.values()].filter((record) => ownBid(record) !== null);
}

function marketFor(markets: PackageMarket[], record: AuctionRecord): PackageMarket | null {
  return liveOf(markets, record.marketId);
}

/* ------------------------------------------------------------------ */
/* Capacity                                                            */
/* ------------------------------------------------------------------ */

const WITHDRAWAL_DELAYED_USD = 180_000;
const RECOVERY_RESERVE_USD = 250_000;

export function capacityLedger(records: AuctionRecord[], markets: PackageMarket[], epoch: number): CapacityLedger {
  const totalUsd = participant(OWN_SOLVER_ID)?.bondedCapacityUsd ?? 0;
  const bondLocks: BondLock[] = [];
  const reservations: CapacityLedger["reservations"] = [];
  for (const record of records) {
    const own = ownBid(record);
    if (!own) continue;
    const definition = record.version.definition;
    const status = own.record.status;
    const amountUsd = definition.requiredBondAmount / 1_000_000;
    if (status === "COMMITTED" || status === "REVEALED" || status === "WINNER" || status === "LOSER" || status === "UNREVEALED") {
      const releaseDue = (status === "LOSER" || status === "UNREVEALED") && epoch >= definition.bondExpiry;
      bondLocks.push({
        bidId: own.id,
        auction: record,
        amountUsd,
        state: releaseDue ? "RELEASE_DUE" : "LOCKED",
        releasesAt:
          status === "LOSER" || status === "UNREVEALED"
            ? definition.bondExpiry
            : status === "WINNER"
              ? definition.settlementDeadline
              : definition.revealClosesAt,
        detail:
          status === "WINNER"
            ? "Winning bond, released on settlement"
            : status === "LOSER"
              ? "Losing bond, held to bond expiry by policy"
              : status === "UNREVEALED"
                ? "Unrevealed bond awaiting policy outcome"
                : "Bid bond, locked through reveal",
      });
    }
    if (status === "WINNER" && record.version.status === "CLEARED") {
      const market = marketFor(markets, record);
      const lots = own.record.allocatedLots;
      const expired = epoch > definition.settlementDeadline;
      reservations.push({
        auction: record,
        collateralUsd: market ? lots * market.collateralPerLot : 0,
        reservation: {
          routeId: modeledHash(`route-reservation:${record.id}`),
          sourceId: own.record.routeId,
          reservationKey: modeledHash(`reservation-key:${record.id}`),
          clearingConsumer: "0x0000000000000000000000000000000000c1ea12",
          quantity: lots,
          expiry: definition.settlementDeadline,
          status: expired ? "EXPIRED" : "ACTIVE",
        },
      });
    }
  }
  const bonds = bondLocks.reduce((sum, lock) => sum + lock.amountUsd, 0);
  const reserved = reservations
    .filter((entry) => entry.reservation.status === "ACTIVE")
    .reduce((sum, entry) => sum + entry.collateralUsd, 0);
  const available = Math.max(0, totalUsd - bonds - reserved - WITHDRAWAL_DELAYED_USD - RECOVERY_RESERVE_USD);
  return {
    totalUsd,
    bondLocks: bondLocks.sort((left, right) => left.releasesAt - right.releasesAt),
    reservations,
    buckets: [
      { id: "AVAILABLE", label: "Available", amountUsd: available, description: "Free for new bids and route reservations" },
      { id: "BOND_LOCKS", label: "Bid bonds", amountUsd: bonds, description: `${bondLocks.length} auction bonds locked` },
      {
        id: "ROUTE_RESERVATIONS",
        label: "Route reservations",
        amountUsd: reserved,
        description: `${reservations.filter((entry) => entry.reservation.status === "ACTIVE").length} cleared routes awaiting settlement`,
      },
      {
        id: "WITHDRAWAL_DELAYED",
        label: "Withdrawal delayed",
        amountUsd: WITHDRAWAL_DELAYED_USD,
        description: "Queued withdrawal, fenced until the release window",
      },
      {
        id: "RECOVERY_RESERVE",
        label: "Recovery reserve",
        amountUsd: RECOVERY_RESERVE_USD,
        description: "Held against route recovery obligations",
      },
    ],
  };
}

/* ------------------------------------------------------------------ */
/* Performance                                                         */
/* ------------------------------------------------------------------ */

function edgeFor(record: AuctionRecord, own: BidView, market: PackageMarket | null): number | null {
  if (!market || own.record.allocatedLots === 0) return null;
  const side = record.version.definition.auctionSide;
  const ticks =
    side === "BUY"
      ? own.record.allocationPriceTicks - record.referenceTicks
      : record.referenceTicks - own.record.allocationPriceTicks;
  return ticksToPrice(ticks, market) * market.contractMultiplier * own.record.allocatedLots;
}

function rejectFor(record: AuctionRecord, own: BidView): RejectReason | "WON" | "PENDING" {
  const status = record.version.status;
  if (own.record.allocatedLots > 0) return "WON";
  if (own.record.bid === null) return own.record.status === "COMMITTED" ? "PENDING" : "UNREVEALED";
  if (!record.result) return status === "CANCELLED" || status === "FAILED" ? "NO_CLEAR" : "PENDING";
  const { skipped } = rankingFor(record);
  if (skipped.includes(own.id)) return "SIZE_RULE";
  const definition = record.version.definition;
  const winningPrices = record.bids
    .filter((entry) => entry.record.allocatedLots > 0)
    .map((entry) => entry.record.allocationPriceTicks);
  /* The marginal winner: the uniform price, or the worst accepted pay-as-bid price for this side. */
  const marginal =
    definition.priceRule === "PAY_AS_BID" && winningPrices.length > 0
      ? definition.auctionSide === "BUY"
        ? Math.max(...winningPrices)
        : Math.min(...winningPrices)
      : record.result.uniformPriceTicks;
  const price = own.route ? own.route.route.packageOutcomeTicks : own.record.bid.priceTicks;
  return price === marginal ? "LOST_ON_TIE_BREAK" : "LOST_ON_PRICE";
}

export function solverPerformance(records: AuctionRecord[], markets: PackageMarket[], windowSeconds: number): SolverPerformance {
  const rejects: Record<RejectReason, number> = {
    LOST_ON_PRICE: 0,
    LOST_ON_TIE_BREAK: 0,
    SIZE_RULE: 0,
    UNREVEALED: 0,
    NO_CLEAR: 0,
  };
  const byMarket = new Map<string, SolverPerformance["byMarket"][number]>();
  const recent: SolverPerformance["recent"] = [];
  let bids = 0;
  let revealed = 0;
  let wins = 0;
  let allocated = 0;
  let bidLots = 0;
  let edge = 0;
  let response = 0;
  for (const record of records) {
    const own = ownBid(record);
    if (!own) continue;
    const market = marketFor(markets, record);
    const outcome = rejectFor(record, own);
    const edgeUsd = outcome === "WON" ? edgeFor(record, own, market) : null;
    recent.push({ auction: record, outcome, edgeUsd });
    if (outcome === "PENDING") continue;
    bids += 1;
    response += own.committedAt - record.version.definition.commitOpensAt;
    const row = byMarket.get(record.marketId) ?? {
      marketId: record.marketId,
      bids: 0,
      wins: 0,
      allocatedLots: 0,
      bidLots: 0,
      edgeUsd: 0,
    };
    row.bids += 1;
    if (own.record.bid) {
      revealed += 1;
      bidLots += own.record.bid.lots;
      row.bidLots += own.record.bid.lots;
    }
    if (outcome === "WON") {
      wins += 1;
      allocated += own.record.allocatedLots;
      edge += edgeUsd ?? 0;
      row.wins += 1;
      row.allocatedLots += own.record.allocatedLots;
      row.edgeUsd += edgeUsd ?? 0;
    } else {
      rejects[outcome] += 1;
    }
    byMarket.set(record.marketId, row);
  }
  return {
    windowSeconds,
    bids,
    revealed,
    wins,
    winRate: revealed > 0 ? wins / revealed : 0,
    fillRate: bidLots > 0 ? allocated / bidLots : 0,
    edgeUsd: edge,
    edgePerWinUsd: wins > 0 ? edge / wins : 0,
    responseSeconds: bids > 0 ? response / bids : 0,
    rejects,
    byMarket: [...byMarket.values()].sort((left, right) => right.bids - left.bids),
    recent: recent.sort((left, right) => right.auction.version.definition.commitOpensAt - left.auction.version.definition.commitOpensAt),
  };
}

/* ------------------------------------------------------------------ */
/* Recovery                                                            */
/* ------------------------------------------------------------------ */

export function recoveryCases(records: AuctionRecord[], epoch: number): RecoveryCase[] {
  const cases: RecoveryCase[] = [];
  for (const record of records) {
    const own = ownBid(record);
    if (!own) continue;
    const definition = record.version.definition;
    const bondUsd = definition.requiredBondAmount / 1_000_000;
    const status = record.version.status;
    if (own.record.status === "WINNER" && status === "CLEARED") {
      const expired = epoch > definition.settlementDeadline;
      cases.push({
        id: `${record.id}:settlement`,
        kind: expired ? "SETTLEMENT_EXPIRED" : "SETTLEMENT_WATCH",
        state: expired ? "ACTIONABLE" : "WATCH",
        auction: record,
        amountUsd: bondUsd,
        title: expired ? "Settlement deadline passed" : "Cleared, awaiting settlement",
        detail: expired
          ? "The winning route did not settle in time. Anyone can fail the auction; the route reservation expires and the winning bond follows the settlement-failure outcome."
          : "The route reservation holds capacity until the clearing engine consumes the handoff.",
        call: expired ? "failExpiredSettlement(auctionId, version)" : null,
        callableAt: definition.settlementDeadline + 1,
      });
    }
    if (status === "FAILED" && own.record.status === "BOND_SLASHED" && own.record.bid !== null) {
      cases.push({
        id: `${record.id}:failed`,
        kind: "SETTLEMENT_EXPIRED",
        state: "RESOLVED",
        auction: record,
        amountUsd: bondUsd,
        title: "Settlement failed, bond slashed",
        detail: "failExpiredSettlement ran after the deadline. The reservation expired and the winning bond was consumed to the slash recipient.",
        call: null,
        callableAt: null,
      });
    }
    if (own.record.bid === null && own.record.status === "BOND_SLASHED") {
      cases.push({
        id: `${record.id}:unrevealed`,
        kind: "BOND_SLASHED",
        state: "RESOLVED",
        auction: record,
        amountUsd: bondUsd,
        title: "Bid not revealed, bond slashed",
        detail: "The commitment was not revealed before reveal close, so advanceAuction applied the unrevealed-bond outcome.",
        call: null,
        callableAt: null,
      });
    }
    if ((own.record.status === "LOSER" || own.record.status === "UNREVEALED") && epoch >= definition.bondExpiry) {
      cases.push({
        id: `${record.id}:bond`,
        kind: "BOND_RELEASE_DUE",
        state: "ACTIONABLE",
        auction: record,
        amountUsd: bondUsd,
        title: "Bond past expiry",
        detail: "The bond outlived its expiry. Anyone can release it back to the bidder account.",
        call: "releaseExpiredBond(bidId)",
        callableAt: definition.bondExpiry,
      });
    }
  }
  const order = { ACTIONABLE: 0, WATCH: 1, RESOLVED: 2 } as const;
  return cases.sort(
    (left, right) =>
      order[left.state] - order[right.state] ||
      right.auction.version.definition.commitOpensAt - left.auction.version.definition.commitOpensAt,
  );
}
