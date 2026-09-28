import type { Address, Hex } from "viem";

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
  feeScheduleId: Hex;
  feeRecipientAccountId: Hex;
  payoffTerms: Hex;
  maxLongDebitMinorPerLot: number;
  maxShortDebitMinorPerLot: number;
  executionModeSetHash: Hex;
  executionModeId: Hex;
  enterActionId: Hex;
}

export async function loadSetrynRuntime(): Promise<SetrynRuntime> {
  const response = await fetch("/api/internal/runtime", { cache: "no-store" });
  if (!response.ok) throw new Error("RUNTIME_UNAVAILABLE");
  return (await response.json()) as SetrynRuntime;
}
