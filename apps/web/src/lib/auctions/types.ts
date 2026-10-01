/**
 * Typed read model for SealedAuctionHouse and BatchClearingEngine.
 *
 * Every struct mirrors contracts/src/types/AuctionTypes.sol, BatchTypes.sol and
 * RoutingTypes.sol field for field. Enums are canonicalized explicitly from
 * their Solidity ordinal through a fixed table, and an ordinal outside the table
 * throws instead of silently shaping a projection.
 *
 * Integers are decoded to JavaScript numbers. Lots, price ticks, timestamps and
 * minor-unit amounts in this model stay far inside Number.MAX_SAFE_INTEGER, and
 * `safeInteger` rejects anything that does not, so a decoder cannot round.
 */

export type Bytes32 = `0x${string}`;
export type Address = `0x${string}`;

export const ZERO_BYTES32: Bytes32 = `0x${"0".repeat(64)}`;

/* ------------------------------------------------------------------ */
/* Enum canonicalization                                               */
/* ------------------------------------------------------------------ */

function decodeEnum<const T extends readonly string[]>(table: T, ordinal: number, name: string): T[number] {
  if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal >= table.length) {
    throw new Error(`UNKNOWN_${name}_ORDINAL_${String(ordinal)}`);
  }
  return table[ordinal];
}

function encodeEnum<const T extends readonly string[]>(table: T, value: T[number], name: string): number {
  const ordinal = table.indexOf(value);
  if (ordinal < 0) throw new Error(`UNKNOWN_${name}_VALUE_${value}`);
  return ordinal;
}

/** enum Side { Unspecified, Buy, Sell } in Enums.sol */
export const SIDE = ["UNSPECIFIED", "BUY", "SELL"] as const;
export type Side = (typeof SIDE)[number];
export const decodeSide = (ordinal: number): Side => decodeEnum(SIDE, ordinal, "SIDE");

export const AUCTION_KIND = ["UNSPECIFIED", "BATCH_ORDER", "SOLVER_ROUTE"] as const;
export type AuctionKind = (typeof AUCTION_KIND)[number];
export const decodeAuctionKind = (ordinal: number): AuctionKind => decodeEnum(AUCTION_KIND, ordinal, "AUCTION_KIND");

export const AUCTION_TARGET_KIND = ["UNSPECIFIED", "SERIES", "PACKAGE"] as const;
export type AuctionTargetKind = (typeof AUCTION_TARGET_KIND)[number];
export const decodeAuctionTargetKind = (ordinal: number): AuctionTargetKind =>
  decodeEnum(AUCTION_TARGET_KIND, ordinal, "AUCTION_TARGET_KIND");

export const AUCTION_PRICE_RULE = ["UNSPECIFIED", "UNIFORM_PRICE", "PAY_AS_BID", "BEST_PACKAGE"] as const;
export type AuctionPriceRule = (typeof AUCTION_PRICE_RULE)[number];
export const decodeAuctionPriceRule = (ordinal: number): AuctionPriceRule =>
  decodeEnum(AUCTION_PRICE_RULE, ordinal, "AUCTION_PRICE_RULE");

export const AUCTION_TIE_BREAK_RULE = ["UNSPECIFIED", "COMMITMENT_HASH_ASCENDING"] as const;
export type AuctionTieBreakRule = (typeof AUCTION_TIE_BREAK_RULE)[number];
export const decodeAuctionTieBreakRule = (ordinal: number): AuctionTieBreakRule =>
  decodeEnum(AUCTION_TIE_BREAK_RULE, ordinal, "AUCTION_TIE_BREAK_RULE");

export const NO_BID_TREATMENT = ["UNSPECIFIED", "CANCEL", "FAIL"] as const;
export type NoBidTreatment = (typeof NO_BID_TREATMENT)[number];
export const decodeNoBidTreatment = (ordinal: number): NoBidTreatment =>
  decodeEnum(NO_BID_TREATMENT, ordinal, "NO_BID_TREATMENT");

export const BOND_OUTCOME = ["UNSPECIFIED", "RELEASE", "SLASH", "EXPIRE"] as const;
export type BondOutcome = (typeof BOND_OUTCOME)[number];
export const decodeBondOutcome = (ordinal: number): BondOutcome => decodeEnum(BOND_OUTCOME, ordinal, "BOND_OUTCOME");

export const AUCTION_STATUS = [
  "UNSPECIFIED",
  "SCHEDULED",
  "COMMIT_OPEN",
  "REVEAL_OPEN",
  "READY_TO_CLEAR",
  "CLEARED",
  "SETTLED",
  "CANCELLED",
  "FAILED",
] as const;
export type AuctionStatus = (typeof AUCTION_STATUS)[number];
export const decodeAuctionStatus = (ordinal: number): AuctionStatus =>
  decodeEnum(AUCTION_STATUS, ordinal, "AUCTION_STATUS");
export const encodeAuctionStatus = (value: AuctionStatus): number => encodeEnum(AUCTION_STATUS, value, "AUCTION_STATUS");

export const BID_STATUS = [
  "UNSPECIFIED",
  "COMMITTED",
  "REVEALED",
  "WINNER",
  "LOSER",
  "UNREVEALED",
  "BOND_RELEASED",
  "BOND_SLASHED",
] as const;
export type BidStatus = (typeof BID_STATUS)[number];
export const decodeBidStatus = (ordinal: number): BidStatus => decodeEnum(BID_STATUS, ordinal, "BID_STATUS");

/** enum OrderTargetKind in OrderTypes.sol, used by BatchExecutionHeader. */
export const ORDER_TARGET_KIND = ["UNSPECIFIED", "SERIES", "PACKAGE"] as const;
export type OrderTargetKind = (typeof ORDER_TARGET_KIND)[number];
export const decodeOrderTargetKind = (ordinal: number): OrderTargetKind =>
  decodeEnum(ORDER_TARGET_KIND, ordinal, "ORDER_TARGET_KIND");

export const BATCH_REMAINDER_DISPOSITION = [
  "UNSPECIFIED",
  "KEEP_RESERVED",
  "RELEASE_AFTER_FILL",
  "RELEASE_AT_EXPIRY",
] as const;
export type BatchRemainderDisposition = (typeof BATCH_REMAINDER_DISPOSITION)[number];
export const decodeBatchRemainderDisposition = (ordinal: number): BatchRemainderDisposition =>
  decodeEnum(BATCH_REMAINDER_DISPOSITION, ordinal, "BATCH_REMAINDER_DISPOSITION");

/** enum LiquidityProvenance in RoutingTypes.sol. */
export const LIQUIDITY_PROVENANCE = [
  "UNSPECIFIED",
  "DIRECT",
  "IMPLIED_IN",
  "IMPLIED_OUT",
  "SOLVER_FIRM",
  "RFQ_FIRM",
  "STREAM_FIRM",
  "INDICATIVE",
] as const;
export type LiquidityProvenance = (typeof LIQUIDITY_PROVENANCE)[number];
export const decodeLiquidityProvenance = (ordinal: number): LiquidityProvenance =>
  decodeEnum(LIQUIDITY_PROVENANCE, ordinal, "LIQUIDITY_PROVENANCE");

export const LIQUIDITY_FIRMNESS = ["UNSPECIFIED", "INDICATIVE", "FIRM"] as const;
export type LiquidityFirmness = (typeof LIQUIDITY_FIRMNESS)[number];
export const decodeLiquidityFirmness = (ordinal: number): LiquidityFirmness =>
  decodeEnum(LIQUIDITY_FIRMNESS, ordinal, "LIQUIDITY_FIRMNESS");

export const ROUTE_SOURCE_KIND = [
  "UNSPECIFIED",
  "DIRECT_PACKAGE_ORDER",
  "SERIES_BOOK_HEAD",
  "RFQ_QUOTE",
  "STREAM_QUOTE",
  "SOLVER_ROUTE",
] as const;
export type RouteSourceKind = (typeof ROUTE_SOURCE_KIND)[number];
export const decodeRouteSourceKind = (ordinal: number): RouteSourceKind =>
  decodeEnum(ROUTE_SOURCE_KIND, ordinal, "ROUTE_SOURCE_KIND");

export const SOURCE_RESERVATION_STATUS = ["UNSPECIFIED", "ACTIVE", "CONSUMED", "RELEASED", "EXPIRED"] as const;
export type SourceReservationStatus = (typeof SOURCE_RESERVATION_STATUS)[number];
export const decodeSourceReservationStatus = (ordinal: number): SourceReservationStatus =>
  decodeEnum(SOURCE_RESERVATION_STATUS, ordinal, "SOURCE_RESERVATION_STATUS");

/* ------------------------------------------------------------------ */
/* Integer guard                                                       */
/* ------------------------------------------------------------------ */

/** Decodes a uint/int word into a JavaScript number, refusing anything a number cannot hold exactly. */
export function safeInteger(value: bigint | number, field: string): number {
  const asNumber = typeof value === "bigint" ? Number(value) : value;
  if (!Number.isSafeInteger(asNumber) || (typeof value === "bigint" && BigInt(asNumber) !== value)) {
    throw new Error(`UNSAFE_INTEGER_${field}`);
  }
  return asNumber;
}

/* ------------------------------------------------------------------ */
/* Structs: AuctionTypes.sol                                           */
/* ------------------------------------------------------------------ */

export interface AuctionDefinition {
  namespaceId: Bytes32;
  auctionKey: Bytes32;
  initiatorOrderHash: Bytes32;
  initiatorAccountId: Bytes32;
  initiatorMaximumFeeMinor: number;
  executionModeId: Bytes32;
  kind: AuctionKind;
  targetKind: AuctionTargetKind;
  seriesId: Bytes32;
  packageId: Bytes32;
  targetVersion: number;
  hasPackageLegCommitment: boolean;
  packageLegsHash: Bytes32;
  /** The initiator's side. Every sealed bid repeats it; a Buy auction ranks the lowest price first. */
  auctionSide: Side;
  settlementAssetId: Bytes32;
  settlementAssetVersion: number;
  riskDomainId: Bytes32;
  riskDomainVersion: number;
  feeScheduleId: Bytes32;
  feeScheduleVersion: number;
  eligibilityPolicyHash: Bytes32;
  capacityPolicyHash: Bytes32;
  bondPolicyHash: Bytes32;
  allocationPolicyHash: Bytes32;
  guaranteeClassId: Bytes32;
  priceRule: AuctionPriceRule;
  tieBreakRule: AuctionTieBreakRule;
  noBidTreatment: NoBidTreatment;
  unrevealedBondOutcome: BondOutcome;
  losingBondOutcome: BondOutcome;
  settlementFailureBondOutcome: BondOutcome;
  totalLots: number;
  lotStep: number;
  maximumBids: number;
  /** Unix seconds. */
  commitOpensAt: number;
  commitClosesAt: number;
  revealClosesAt: number;
  clearDeadline: number;
  settlementDeadline: number;
  bondExpiry: number;
  bondAssetId: Bytes32;
  bondBindingVersion: number;
  /** Bond asset minor units (six decimals for USDC). */
  requiredBondAmount: number;
  slashRecipientAccountId: Bytes32;
  maximumKeeperRewardMinor: number;
  qualificationEvidenceHash: Bytes32;
}

export interface AuctionVersion {
  definition: AuctionDefinition;
  definitionHash: Bytes32;
  versionHash: Bytes32;
  version: number;
  status: AuctionStatus;
  commitmentCount: number;
  revealCount: number;
  clearingResultHash: Bytes32;
}

export interface BidCommitAuthorization {
  auctionId: Bytes32;
  auctionVersion: number;
  bidder: Address;
  bidderAccountId: Bytes32;
  nonce: string;
  sealedBidHash: Bytes32;
  eligibilityProofHash: Bytes32;
  deadline: number;
  salt: Bytes32;
}

export interface SealedBid {
  auctionId: Bytes32;
  auctionVersion: number;
  bidder: Address;
  bidderAccountId: Bytes32;
  bidderOrderHash: Bytes32;
  nonce: string;
  side: Side;
  lots: number;
  allowPartialAllocation: boolean;
  minimumFillLots: number;
  /** int128 price ticks; one tick is 10^-priceDecimals of the package price unit. */
  priceTicks: number;
  maximumFeeMinor: number;
  solverRouteId: Bytes32;
  capacityEvidenceHash: Bytes32;
  revealSalt: Bytes32;
}

export interface SolverRoute {
  auctionId: Bytes32;
  auctionVersion: number;
  solver: Address;
  solverAccountId: Bytes32;
  routeId: Bytes32;
  packageLegsHash: Bytes32;
  actionGraphHash: Bytes32;
  legCount: number;
  actionCount: number;
  packageOutcomeTicks: number;
  maximumFeeMinor: number;
  capacityLockId: Bytes32;
  capacityCollateralId: Bytes32;
  capacityAmount: number;
  capacityEvidenceHash: Bytes32;
  expiry: number;
  guaranteeClassId: Bytes32;
  salt: Bytes32;
}

export interface BidRecord {
  authorization: BidCommitAuthorization;
  /**
   * The contract stores a zeroed SealedBid until reveal. The read model decodes
   * that zeroed struct as null so sealed contents can never be mistaken for a price.
   */
  bid: SealedBid | null;
  routeId: Bytes32;
  bondLockId: Bytes32;
  status: BidStatus;
  allocatedLots: number;
  allocationPriceTicks: number;
}

export interface SolverRouteRecord {
  route: SolverRoute;
  routeHash: Bytes32;
  revealed: boolean;
}

export interface AuctionClearingResult {
  auctionId: Bytes32;
  auctionVersion: number;
  winningRouteBidId: Bytes32;
  uniformPriceTicks: number;
  totalAllocatedLots: number;
  winnerCount: number;
  allocationsHash: Bytes32;
  resultHash: Bytes32;
}

/* ------------------------------------------------------------------ */
/* Structs: BatchTypes.sol and RoutingTypes.sol                        */
/* ------------------------------------------------------------------ */

export interface BatchExecutionHeader {
  auctionId: Bytes32;
  auctionVersion: number;
  auctionResultHash: Bytes32;
  targetKind: OrderTargetKind;
  seriesId: Bytes32;
  packageId: Bytes32;
  targetVersion: number;
  packageWitnessHash: Bytes32;
  feeScheduleId: Bytes32;
  feeScheduleVersion: number;
  riskDomainId: Bytes32;
  riskDomainVersion: number;
  priceRule: AuctionPriceRule;
  totalAllocatedLots: number;
  winnerCount: number;
  allocationsHash: Bytes32;
  settlementDeadline: number;
}

export interface SourceRouteReservation {
  routeId: Bytes32;
  sourceId: Bytes32;
  reservationKey: Bytes32;
  clearingConsumer: Address;
  quantity: number;
  expiry: number;
  status: SourceReservationStatus;
}

/* ------------------------------------------------------------------ */
/* Board projection                                                    */
/* ------------------------------------------------------------------ */

/** One committed bid as the auction house stores it. */
export interface BidView {
  id: Bytes32;
  record: BidRecord;
  /** The revealed solver route, for solver-route auctions. */
  route: SolverRouteRecord | null;
  /** Block of the BidCommitted event. */
  committedBlock: number;
  transactionHash: string;
}

/** One auction version read from the SealedAuctionHouse, with its bids and clearing result. */
export interface AuctionRecord {
  id: Bytes32;
  version: AuctionVersion;
  /** Catalog market the auction's series trades as, or null for a package or an unlisted series. */
  marketId: string | null;
  bids: BidView[];
  result: AuctionClearingResult | null;
  scheduledBlock: number;
  transactionHash: string;
}
