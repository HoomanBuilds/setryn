import type {
  Guarantee,
  LegFamily,
  PackageLeg,
  PackageMarket,
  Qualification,
  SettlementClass,
} from "@/lib/terminal/types";

export type StrategyBuildMode = "TEMPLATE" | "GRAPH";
export type PackageDirection = "LONG" | "SHORT";

export interface InstrumentOption {
  id: string;
  instrument: string;
  asset: string;
  family: LegFamily;
  venueClass: PackageLeg["venueClass"];
  mark: number;
  markUnit: PackageLeg["markUnit"];
  deltaPerLot: number;
  qualification: Qualification;
  settlementClass: SettlementClass;
  sourceMarketId: string;
}

export interface DraftLeg {
  id: string;
  instrumentId: string;
  side: PackageLeg["side"];
  ratio: number;
}

export interface PackageDraft {
  mode: StrategyBuildMode;
  marketId: string;
  direction: PackageDirection;
  lots: number;
  legs: DraftLeg[];
}

export interface CompiledDraftLeg extends DraftLeg {
  instrument: InstrumentOption;
  canonicalIndex: number;
}

export interface CompiledPackageDraft {
  canonicalPayload: string;
  canonicalId: string;
  legs: CompiledDraftLeg[];
  market: PackageMarket;
  qualification: Qualification;
  settlementClass: SettlementClass;
  guarantee: Guarantee;
  executable: boolean;
  executableMarketId: string | null;
  graphScale: number;
  netDelta: number;
  collateral: number;
  maxResidual: number;
  allInPrice: number;
  allInPriceLabel: "EXECUTABLE" | "MODELED";
  firmDepthLots: number;
  validation: string[];
}
