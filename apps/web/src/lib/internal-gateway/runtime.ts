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
  /*
   * Schema 11 (network listings, docs/plans/network-runtime-real-data.md). Every field below is absent on a schema 9 or
   * 10 runtime, whose prices then convert with a zero offset.
   */
  /** Display underlying: "BTC", "ETH", "ARB", "EUR/USD", "XAU/USD". */
  underlying?: string;
  /** Benchmark feed key, for example "Crypto.BTC/USD". */
  feedKey?: string;
  strategyKind?: "DATED_YIELD_CARRY" | "FUNDING_CARRY" | "DATED_BASIS" | "DELIVERABLE_FORWARD";
  displayName?: string;
  /** Payoff floor and cap of the range forward, decimal strings in the quote currency. */
  floor?: string;
  cap?: string;
  /** Units of the underlying per lot, decimal string. */
  lotSize?: string;
  /** Price increment of one tick, decimal string. */
  tickPrice?: string;
  priceDecimals?: number;
  /** Price at zero ticks (the floor): price = priceOffset + ticks / priceScale. */
  priceOffset?: string;
  /** Chainlink aggregator on Arbitrum One that references the underlying. */
  referenceFeed?: Address;
  tradingStartsAt?: number;
  lastTradingAt?: number;
  expiryAt?: number;
  fixingWindowOpen?: number;
  fixingWindowClose?: number;
  exerciseOpensAt?: number;
  exerciseCutoffAt?: number;
  finalResolutionAt?: number;
  settlementDeadline?: number;
}

export type SetrynNetwork = "local" | "arbitrum-sepolia" | "arbitrum-one";

export interface SetrynRuntime {
  schemaVersion: number;
  chainId: number;
  day: number;
  rpcUrl: string;
  operator: Address;
  settlementToken: Address;
  settlementTokenMintable?: boolean;
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
  /** Firm-quote settlement router (V2 release); absent on deployments without it, which then offer no firm quotes. */
  quoteSettlementRouter?: Address;
  /** The stream capacity manager the router draws makers' quote capacity from. */
  streamCapacityManager?: Address;
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
  /* Schema 11 top-level fields; absent on older runtimes. */
  network?: SetrynNetwork;
  listedAt?: number;
  fixingAdapter?: Address;
  fixingAdapterKind?: "signed-observation" | "chainlink-historical";
  riskAdapter?: Address;
  oracleSigners?: Address[];
  oracleThreshold?: number;
  sessionDaysPath?: string;
  referenceChainId?: number;
  /**
   * First block of the deployment: the runtime's own field when it carries one, else the earliest deployment
   * transaction in the manifest next to it. Event scans start here instead of genesis; absent reads as block 0.
   */
  deploymentBlock?: number;
}

export async function loadSetrynRuntime(): Promise<SetrynRuntime> {
  const response = await fetch("/api/internal/runtime", { cache: "no-store" });
  if (!response.ok) throw new Error("RUNTIME_UNAVAILABLE");
  return (await response.json()) as SetrynRuntime;
}
