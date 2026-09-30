import { PREVIEW_EPOCH_SECONDS, feedReferenceAt } from "@/lib/auctions/feed";
import type { OnchainPublicOrder } from "@/lib/internal-gateway/protocol";
import type { FirmRfqQuote, RfqRequest } from "@/lib/internal-gateway/types";
import { participant } from "@/lib/solver/roster";
import { buildPreview, protectedPrice, routePrice, type TicketState } from "@/lib/terminal/economics";
import { DEFAULT_MARKET_ID, MARKETS } from "@/lib/terminal/markets";

/**
 * A modeled walkthrough of a multi-maker competition. It implements the
 * production RfqRequest type so the competition page renders it through the
 * same code as a real request, but nothing here is signed or committed: the
 * authorization carries zeroed evidence fields and the page disables every
 * action. Quotes price off the shared index feed at the moment each maker
 * answers, and the walkthrough restarts every request window.
 */

export const SAMPLE_REQUEST_ID = "sample";

const WINDOW_SECONDS = 240;
/** Seconds into the window at the first preview tick, so quotes are already in when the page opens. */
const OFFSET_AT_START = 75;
const ZERO_HASH = `0x${"0".repeat(64)}` as const;
const ZERO_ADDRESS = `0x${"0".repeat(40)}` as const;

interface SampleQuoteSpec {
  makerId: string;
  respondAfter: number;
  ttl: number;
  ticks: number;
  capacity: number;
  feeBps: number;
  guarantee: string;
}

const STANDARD = "Firm capacity, atomic onchain settlement";
const SEQUENCED = "Solver bonded, leg-sequenced hedge";

const QUOTES: SampleQuoteSpec[] = [
  { makerId: "MKR-14", respondAfter: 6, ttl: 150, ticks: 0, capacity: 12, feeBps: 0.9, guarantee: STANDARD },
  { makerId: "SLV-03", respondAfter: 9, ttl: 120, ticks: -2, capacity: 10, feeBps: 0.9, guarantee: SEQUENCED },
  { makerId: "MKR-21", respondAfter: 11, ttl: 180, ticks: 1, capacity: 20, feeBps: 0.8, guarantee: STANDARD },
  { makerId: "SLV-02", respondAfter: 22, ttl: 90, ticks: -1, capacity: 6, feeBps: 0.9, guarantee: STANDARD },
  { makerId: "MKR-33", respondAfter: 27, ttl: 150, ticks: 0, capacity: 8, feeBps: 0.8, guarantee: STANDARD },
];

const LOTS = 8;

function iso(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString();
}

/**
 * The walkthrough request as it stands at `epoch` on the market clock. `feeScheduleVersion` is the version the
 * platform has active (from the gateway's fee schedule reading), so the modeled order names the same version a real
 * order would sign; nothing here is signed, so it only labels the walkthrough.
 */
export function sampleRequest(epoch: number, feeScheduleVersion = 1): RfqRequest {
  const market = MARKETS.find((candidate) => candidate.id === DEFAULT_MARKET_ID) ?? MARKETS[0];
  const route = market.routes.find((candidate) => candidate.id === "SOLVER_RFQ") ?? market.routes[0];
  const elapsed = (((epoch - PREVIEW_EPOCH_SECONDS + OFFSET_AT_START) % WINDOW_SECONDS) + WINDOW_SECONDS) % WINDOW_SECONDS;
  const start = epoch - elapsed;
  const shiftAt = (at: number) => feedReferenceAt(market, at).mark - market.netPrice;
  const solverAskAt = (at: number) => Number((routePrice(route, "BUY") + shiftAt(at)).toFixed(market.priceDecimals));
  const limit = protectedPrice(solverAskAt(start), "BUY", 50, market);
  const ticket: TicketState = {
    intent: "ENTER",
    side: "LONG",
    orderType: "MARKETABLE_LIMIT",
    lotsInput: String(LOTS),
    limitInput: limit.toFixed(market.priceDecimals),
    tif: "FOK",
    expiresAt: null,
    privateRfq: true,
    routeId: route.id,
    closePositionId: null,
  };
  const preview = buildPreview(market, ticket, route, null);
  const onchainOrder: OnchainPublicOrder = {
    signer: ZERO_ADDRESS,
    accountId: ZERO_HASH,
    policyId: ZERO_HASH,
    policyContextHash: ZERO_HASH,
    actionId: ZERO_HASH,
    targetKind: 1,
    seriesId: ZERO_HASH,
    packageId: ZERO_HASH,
    targetVersion: 1,
    side: 1,
    lots: BigInt(LOTS),
    priceTicks: BigInt(Math.round(limit * 10)),
    timeInForce: 4,
    deadline: BigInt(start + WINDOW_SECONDS),
    executionModeId: ZERO_HASH,
    feeScheduleId: ZERO_HASH,
    feeScheduleVersion,
    maxFeeMinor: BigInt(Math.round(preview.totalFees * 1_000_000)),
    recipient: ZERO_ADDRESS,
    permittedExecutor: ZERO_ADDRESS,
    nonce: BigInt(0),
    salt: ZERO_HASH,
    allowPartialFills: false,
    minimumFillLots: BigInt(LOTS),
    remainderPolicy: 2,
    postOnly: false,
    reduceOnly: false,
  };
  const quotes: FirmRfqQuote[] = QUOTES.filter((spec) => start + spec.respondAfter <= epoch).map((spec) => {
    const at = start + spec.respondAfter;
    const maker = participant(spec.makerId);
    return {
      id: `sample-${spec.makerId}`,
      solverLabel: maker?.label ?? spec.makerId,
      packagePrice: Number((solverAskAt(at) + spec.ticks * market.tickSize).toFixed(market.priceDecimals)),
      feeCap: Number(((LOTS * market.notionalPerLot * spec.feeBps) / 10_000).toFixed(2)),
      capacityLots: spec.capacity,
      expiresAt: iso(at + spec.ttl),
      settlementGuarantee: spec.guarantee,
      provenance: "SEEDED_SOLVER",
    };
  });
  return {
    id: SAMPLE_REQUEST_ID,
    createdAt: iso(start),
    expiresAt: iso(start + WINDOW_SECONDS),
    state: "OPEN",
    selectedQuoteId: null,
    receiptId: null,
    quotes,
    authorization: {
      orderHash: ZERO_HASH,
      signature: "0x",
      signer: ZERO_ADDRESS,
      nonce: "0",
      deadline: iso(start + WINDOW_SECONDS),
      riskAdmissionId: ZERO_HASH,
      onchainOrder,
      intent: {
        accountId: ZERO_HASH,
        marketId: market.id,
        packageCode: market.code,
        routeId: route.id,
        routeLabel: route.label,
        side: "ENTER",
        packageSide: "LONG",
        lots: LOTS,
        fillLots: LOTS,
        limitPrice: limit,
        executionPrice: preview.effectivePrice,
        contractMultiplier: market.contractMultiplier,
        orderType: "MARKET",
        timeInForce: "FOK",
        expiresAt: null,
        feeCap: preview.totalFees,
        collateralRequired: preview.totalCollateral,
        closePositionId: null,
        replacesOrderId: null,
        recipient: ZERO_ADDRESS,
        disclosure: "PRIVATE_RFQ",
        settlementGuarantee: preview.settlementGuarantee,
      },
    },
  };
}
