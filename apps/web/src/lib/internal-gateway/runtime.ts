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
  /**
   * The market and series versions the runtime was written with. A fee change re-versions both, so live code reads the
   * active versions from chain (fee-schedule.ts `marketTradingVersions`) and uses these only as a fallback.
   */
  marketVersion?: number;
  seriesVersion?: number;
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
  /**
   * Fallback rates for when the chain cannot be read. Live rates come from the active FeeScheduleRegistry version through
   * `readActiveFeeSchedule` in fee-schedule.ts; nothing prices an order from these fields while the chain answers.
   */
  makerFeeRatePpm: number;
  takerFeeRatePpm: number;
  /** The FeeScheduleRegistry holding every version of `feeScheduleId`. */
  feeScheduleRegistry?: Address;
  /** The version active when the runtime was written; a fallback only, the registry's active pointer wins. */
  feeScheduleVersion?: number;
  /** The address that controls the fee recipient account; read from CollateralVault when absent. */
  treasuryController?: Address;
  executionModeSetHash: Hex;
  executionModeId: Hex;
  privateRfqExecutionModeId: Hex;
  privateRfqPrivacyModeId: Hex;
  privateRfqDisclosurePolicyHash: Hex;
  privateRfqEligibleMakerSetHash: Hex;
  enterActionId: Hex;
  seriesRegistry?: Address;
  marketRegistry?: Address;
  /**
   * Terminal lifecycle contracts the runtime file does not carry, merged from the local deployment manifest. Absent when
   * the manifest is unavailable, in which case settlement actions report the missing contract instead of guessing.
   */
  fixingEngine?: Address;
  cashSettlementCoordinator?: Address;
  positionLifecycleExecutor?: Address;
  /** Every onchain market in catalog order. The single-series fields above name the first, primary one. */
  markets: SetrynRuntimeMarket[];
}

export async function loadSetrynRuntime(): Promise<SetrynRuntime> {
  const response = await fetch("/api/internal/runtime", { cache: "no-store" });
  if (!response.ok) throw new Error("RUNTIME_UNAVAILABLE");
  return (await response.json()) as SetrynRuntime;
}
