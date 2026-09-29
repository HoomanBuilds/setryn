import type { ExposureInput, PackageDirection } from "@/lib/hedges/types";

/** What value is at risk, in the spec's Protect vocabulary. Each maps onto the hedge engine's two directions. */
export type ExposureType =
  | "RECEIVABLE"
  | "PAYABLE"
  | "INVENTORY"
  | "DEBT"
  | "TREASURY"
  | "TOKEN_UNLOCK"
  | "INVESTMENT";

/** Forecast cash flows are expected; confirmed ones are contracted or invoiced. */
export type ExposureCertainty = "FORECAST" | "CONFIRMED";

/** MANUAL rows were entered here; IMPORTED rows arrived through the CSV importer. */
export type ExposureSource = "MANUAL" | "IMPORTED";

/**
 * One dated exposure in the viewer's book. It is a hedge-engine `ExposureInput` plus the treasury facts around it,
 * so every row can be ranked, validated, and handed to the hedge builder without translation.
 */
export interface ExposureRecord extends ExposureInput {
  /** `stableExposureId` of the input at creation, which is the id the hedge builder and terminal hand-offs carry. */
  id: string;
  type: ExposureType;
  label: string;
  certainty: ExposureCertainty;
  source: ExposureSource;
  /** Import batch name for imported rows. */
  batch: string | null;
  /** Wall-clock ISO timestamp the row entered the book. */
  createdAt: string;
}

export type ProtectionState = "UNHEDGED" | "PARTIAL" | "PROTECTED" | "NETTED";

/** A connected-account position allocated against an exposure. */
export interface HedgeLink {
  positionId: string;
  marketId: string;
  label: string;
  side: PackageDirection;
  /** USDC notional of the position allocated to this exposure. */
  allocated: number;
  expiryIso: string;
  /** Days between the exposure date and the package expiry. */
  tenorGapDays: number;
  href: string;
}

export interface ExposureView {
  record: ExposureRecord;
  /** +1 when the holder loses on a fall in the asset (long), -1 when it loses on a rise (short). */
  sign: 1 | -1;
  horizonDays: number | null;
  /** Amount offset by opposite exposures in the same asset inside the netting window. */
  netted: number;
  nettedWith: string[];
  /** Amount covered by connected-account positions after netting. */
  protectedAmount: number;
  links: HedgeLink[];
  /** Amount neither netted nor protected. */
  residual: number;
  /** (netted + protected) / amount, capped at one. */
  coverage: number;
  state: ProtectionState;
}

export interface AssetNetting {
  asset: string;
  count: number;
  /** Gross of exposures that lose on a fall (receivables, holdings). */
  long: number;
  /** Gross of exposures that lose on a rise (payables, debt). */
  short: number;
  /** long - short. */
  net: number;
  /** Matched volume inside the netting window (each unit offsets one long and one short). */
  matched: number;
  /** Protective position notional on this asset. */
  hedgeNotional: number;
  /** Protective position notional allocated to residual exposures. */
  hedgeAllocated: number;
  /** Protective notional with no residual exposure to cover: an over-hedge. */
  excessHedge: number;
  residual: number;
}

export interface ExposureBook {
  views: ExposureView[];
  assets: AssetNetting[];
  gross: number;
  netted: number;
  protectedAmount: number;
  residual: number;
  coverage: number;
  /** Earliest dated exposure that still has a residual. */
  nextUnprotected: ExposureView | null;
}
