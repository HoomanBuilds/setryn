import type { Address, Hex } from "viem";

/** One catalog market registered onchain: its own market, series, tick grid, and payoff bounds. */
export interface SetrynRuntimeMarket {
  /** The terminal catalog id, for example "ETH-FC-25SEP26". */
  marketKey: string;
  marketId: Hex;
  instrumentId: Hex;
  seriesId: Hex;
  benchmarkId: Hex;
  payoffTerms: Hex;
  /** Settlement minor units per price tick per lot. */
  tickSizeMinor: number;
  /** Price ticks per unit of package price: onchain ticks are price x priceScale. */
  priceScale: number;
  maxLongDebitMinorPerLot: number;
  maxShortDebitMinorPerLot: number;
  maxOrderLots: number;
}

export interface SetrynRuntime {
  schemaVersion: number;
  chainId: number;
  day: number;
  rpcUrl: string;
  operator: Address;
  settlementToken: Address;
  marketAdapter: Address;
  collateralVault: Address;
  fundedFeeEngine: Address;
  portfolioRiskEngine: Address;
  riskAdmissionBindingRegistry: Address;
  executionPolicyRegistry: Address;
  tradingSessionPolicy: Address;
  orderState: Address;
  atomicClearingEngine: Address;
  privateRfqValidationGate: Address;
  privateRfqBook: Address;
  publicOrderBook: Address;
  positionEngine: Address;
  lifecyclePolicyValidator: Address;
  signedLifecycleEngine: Address;
  settlementAssetId: Hex;
  riskDomainId: Hex;
  marketId: Hex;
  seriesId: Hex;
  instrumentId: Hex;
  benchmarkId: Hex;
  feeScheduleId: Hex;
  feeRecipientAccountId: Hex;
  payoffTerms: Hex;
  maxLongDebitMinorPerLot: number;
  maxShortDebitMinorPerLot: number;
  /** Settlement minor units per price tick per lot: consideration is lots x price ticks x tick size. */
  tickSizeMinor: number;
  maxOrderLots: number;
  makerFeeRatePpm: number;
  takerFeeRatePpm: number;
  executionModeSetHash: Hex;
  executionModeId: Hex;
  privateRfqExecutionModeId: Hex;
  privateRfqPrivacyModeId: Hex;
  privateRfqDisclosurePolicyHash: Hex;
  privateRfqEligibleMakerSetHash: Hex;
  enterActionId: Hex;
  /** Every onchain market in catalog order. The single-series fields above name the first, primary one. */
  markets: SetrynRuntimeMarket[];
}

export async function loadSetrynRuntime(): Promise<SetrynRuntime> {
  const response = await fetch("/api/internal/runtime", { cache: "no-store" });
  if (!response.ok) throw new Error("RUNTIME_UNAVAILABLE");
  return (await response.json()) as SetrynRuntime;
}
