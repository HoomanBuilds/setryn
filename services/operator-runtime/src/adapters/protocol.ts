import { contractBindings } from "@setryn/internal-contracts";
import { encodeAbiParameters, keccak256, stringToHex, type Address, type Hex } from "viem";

import { requireMarketBySeries, type OperatorDeployment } from "./deployment.ts";

/** Generated bindings are the ABI source of truth; the web app's hand-written fragments are not imported. */
export const abis = {
  collateralVault: contractBindings.CollateralVault.abi,
  portfolioRiskEngine: contractBindings.PortfolioRiskEngine.abi,
  riskAdmissionBindingRegistry: contractBindings.RiskAdmissionBindingRegistry.abi,
  orderState: contractBindings.OrderState.abi,
  publicOrderBook: contractBindings.PublicOrderBook.abi,
  privateRfqBook: contractBindings.PrivateRfqBook.abi,
  atomicClearingEngine: contractBindings.AtomicClearingEngine.abi,
  positionEngine: contractBindings.PositionEngine.abi,
  seriesRegistry: contractBindings.SeriesRegistry.abi,
  benchmarkRegistry: contractBindings.BenchmarkRegistry.abi,
  fixingEngine: contractBindings.FixingEngine.abi,
  cashSettlementCoordinator: contractBindings.CashSettlementCoordinator.abi,
} as const;

/** The devnet settlement token is not a protocol binding; only its faucet and allowance entry points are used. */
export const devnetSettlementTokenAbi = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "approved", type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "amount", type: "uint256" }],
  },
] as const;

export const zeroId = `0x${"0".repeat(64)}` as Hex;
export const accountSalt = keccak256(stringToHex("SETRYN_PRIMARY_ACCOUNT_V1"));
export const publicSeriesPolicy = keccak256(stringToHex("SETRYN_POLICY_PUBLIC_SERIES_V1"));
export const makerPublicPolicyContext = keccak256(stringToHex("SETRYN_DEVNET_MAKER_PUBLIC_SERIES_V1"));
export const makerRfqPolicyContext = keccak256(stringToHex("SETRYN_DEVNET_MAKER_PRIVATE_RFQ_V1"));

const bookIdTypeHash = keccak256(
  stringToHex(
    "SetrynDirectBookV1(uint256 chainId,address book,address orderState,uint8 targetKind,bytes32 targetId,uint32 targetVersion,bytes32 executionModeId,bytes32 settlementAssetId,uint32 settlementAssetVersion,bytes32 feeScheduleId,uint32 feeScheduleVersion,bytes32 packageLegsHash)",
  ),
);
const positionNamespace = keccak256(stringToHex("SETRYN_PROSPECTIVE_POSITION_V1"));
const economicsNamespace = keccak256(stringToHex("SETRYN_DEVNET_ORDER_ECONOMICS_V1"));
const markObservationKey = keccak256(stringToHex("SETRYN_DEVNET_BTC_USD_MARK_V1"));
const riskRequestTypeHash = keccak256(
  stringToHex(
    "SetrynRiskAdmissionRequestV1(bytes32 accountId,bytes32 riskDomainId,uint32 riskDomainVersion,uint128 openInterestIncreaseBaseUnits,uint128 terminalLiabilityIncreaseBaseUnits,uint64 deadline,uint256 nonce,bytes32 salt,uint256 chainId,address engine)",
  ),
);
const admissionIdTypeHash = keccak256(stringToHex("SetrynRiskAdmissionIdV1"));

export type OrderSide = 1 | 2;

export interface PublicOrder {
  readonly signer: Address;
  readonly accountId: Hex;
  readonly policyId: Hex;
  readonly policyContextHash: Hex;
  readonly actionId: Hex;
  readonly targetKind: number;
  readonly seriesId: Hex;
  readonly packageId: Hex;
  readonly targetVersion: number;
  readonly side: OrderSide;
  readonly lots: bigint;
  readonly priceTicks: bigint;
  readonly timeInForce: number;
  readonly deadline: bigint;
  readonly executionModeId: Hex;
  readonly feeScheduleId: Hex;
  readonly feeScheduleVersion: number;
  readonly maxFeeMinor: bigint;
  readonly recipient: Address;
  readonly permittedExecutor: Address;
  readonly nonce: bigint;
  readonly salt: Hex;
  readonly allowPartialFills: boolean;
  readonly minimumFillLots: bigint;
  readonly remainderPolicy: number;
  readonly postOnly: boolean;
  readonly reduceOnly: boolean;
}

export const publicOrderTypes = {
  PublicOrder: [
    { name: "signer", type: "address" },
    { name: "accountId", type: "bytes32" },
    { name: "policyId", type: "bytes32" },
    { name: "policyContextHash", type: "bytes32" },
    { name: "actionId", type: "bytes32" },
    { name: "targetKind", type: "uint8" },
    { name: "seriesId", type: "bytes32" },
    { name: "packageId", type: "bytes32" },
    { name: "targetVersion", type: "uint32" },
    { name: "side", type: "uint8" },
    { name: "lots", type: "uint128" },
    { name: "priceTicks", type: "int128" },
    { name: "timeInForce", type: "uint8" },
    { name: "deadline", type: "uint64" },
    { name: "executionModeId", type: "bytes32" },
    { name: "feeScheduleId", type: "bytes32" },
    { name: "feeScheduleVersion", type: "uint32" },
    { name: "maxFeeMinor", type: "uint128" },
    { name: "recipient", type: "address" },
    { name: "permittedExecutor", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "salt", type: "bytes32" },
    { name: "allowPartialFills", type: "bool" },
    { name: "minimumFillLots", type: "uint128" },
    { name: "remainderPolicy", type: "uint8" },
    { name: "postOnly", type: "bool" },
    { name: "reduceOnly", type: "bool" },
  ],
} as const;

export const makerQuoteTypes = {
  MakerQuote: [
    { name: "rfqId", type: "bytes32" },
    { name: "maker", type: "address" },
    { name: "makerAccountId", type: "bytes32" },
    { name: "takerAccountId", type: "bytes32" },
    { name: "makerOrderHash", type: "bytes32" },
    { name: "targetKind", type: "uint8" },
    { name: "seriesId", type: "bytes32" },
    { name: "packageId", type: "bytes32" },
    { name: "targetVersion", type: "uint32" },
    { name: "hasPackageLegCommitment", type: "bool" },
    { name: "packageLegsHash", type: "bytes32" },
    { name: "sidePolicy", type: "uint8" },
    { name: "lots", type: "uint128" },
    { name: "allowPartialFills", type: "bool" },
    { name: "minimumFillLots", type: "uint128" },
    { name: "remainderPolicy", type: "uint8" },
    { name: "bidPriceTicks", type: "int128" },
    { name: "askPriceTicks", type: "int128" },
    { name: "feeScheduleId", type: "bytes32" },
    { name: "feeScheduleVersion", type: "uint32" },
    { name: "maxFeeMinor", type: "uint128" },
    { name: "riskDomainId", type: "bytes32" },
    { name: "riskDomainVersion", type: "uint32" },
    { name: "collateralAssetId", type: "bytes32" },
    { name: "collateralBindingVersion", type: "uint32" },
    { name: "maximumLiability", type: "uint128" },
    { name: "privacyModeId", type: "bytes32" },
    { name: "executionModeId", type: "bytes32" },
    { name: "disclosurePolicyHash", type: "bytes32" },
    { name: "eligibleMakerSetHash", type: "bytes32" },
    { name: "deadline", type: "uint64" },
    { name: "capacityExpiry", type: "uint64" },
    { name: "permittedExecutor", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "salt", type: "bytes32" },
  ],
} as const;

export const privateRfqRequestTypes = {
  PrivateRfqRequest: [
    { name: "taker", type: "address" },
    { name: "takerAccountId", type: "bytes32" },
    { name: "takerOrderHash", type: "bytes32" },
    { name: "targetKind", type: "uint8" },
    { name: "seriesId", type: "bytes32" },
    { name: "packageId", type: "bytes32" },
    { name: "targetVersion", type: "uint32" },
    { name: "hasPackageLegCommitment", type: "bool" },
    { name: "packageLegsHash", type: "bytes32" },
    { name: "sidePolicy", type: "uint8" },
    { name: "lots", type: "uint128" },
    { name: "allowPartialFills", type: "bool" },
    { name: "minimumFillLots", type: "uint128" },
    { name: "remainderPolicy", type: "uint8" },
    { name: "feeScheduleId", type: "bytes32" },
    { name: "feeScheduleVersion", type: "uint32" },
    { name: "maxFeeMinor", type: "uint128" },
    { name: "riskDomainId", type: "bytes32" },
    { name: "riskDomainVersion", type: "uint32" },
    { name: "privacyModeId", type: "bytes32" },
    { name: "executionModeId", type: "bytes32" },
    { name: "disclosurePolicyHash", type: "bytes32" },
    { name: "eligibleMakerSetHash", type: "bytes32" },
    { name: "deadline", type: "uint64" },
    { name: "permittedExecutor", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "salt", type: "bytes32" },
  ],
} as const;

export const rfqSelectionTypes = {
  RfqSelectionAuthorization: [
    { name: "rfqId", type: "bytes32" },
    { name: "quoteId", type: "bytes32" },
    { name: "taker", type: "address" },
    { name: "executor", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint64" },
    { name: "salt", type: "bytes32" },
  ],
} as const;

export const capacityCancelTypes = {
  CapacityCancelAuthorization: [
    { name: "quoteId", type: "bytes32" },
    { name: "maker", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint64" },
    { name: "salt", type: "bytes32" },
  ],
} as const;

export const riskAdmissionCancellationTypes = {
  SetrynRiskAdmissionCancellationV1: [
    { name: "admissionId", type: "bytes32" },
    { name: "orderHash", type: "bytes32" },
    { name: "accountId", type: "bytes32" },
    { name: "signer", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint64" },
    { name: "cancellationReference", type: "bytes32" },
  ],
} as const;

export function setrynDomain(deployment: OperatorDeployment, verifyingContract: Address) {
  return { name: "Setryn", version: "1", chainId: deployment.chainId, verifyingContract } as const;
}

/** Contract enum values named explicitly so result payloads never depend on decoder-specific numbering. */
export const orderStatusNames = ["unspecified", "open", "partially-filled", "filled", "cancelled", "expired", "rejected"] as const;
export const rfqStatusNames = [
  "unspecified",
  "inviting",
  "collecting",
  "selection-locked",
  "capacity-reserved",
  "authorized",
  "submitted",
  "clearing",
  "settled",
  "cancelled",
  "expired",
  "rejected",
] as const;
export const makerQuoteStatusNames = ["unspecified", "offered", "reserved", "selected", "consumed", "cancelled", "expired", "rejected"] as const;
export const positionStatusNames = [
  "unspecified",
  "live",
  "fixing",
  "settlement-ready",
  "settled",
  "closed-by-unwind",
  "replaced",
  "lapsed",
  "cancelled-by-disruption",
  "defaulted",
  "terminal-claim",
  "abandoned",
] as const;
export const fixingStatusNames = ["unspecified", "proposed", "disputed", "finalized"] as const;
export const fixingResolutionNames = ["unspecified", "primary-final", "fallback-final", "terminal-disruption"] as const;
export const riskAdmissionStatusNames = ["unspecified", "reserved", "consumed", "released"] as const;

export const orderStatus = { open: 1, partiallyFilled: 2 } as const;
export const rfqStatus = { collecting: 2, submitted: 6, settled: 8 } as const;
export const positionStatus = { live: 1, fixing: 2, settlementReady: 3, settled: 4, lapsed: 7, terminalClaim: 10 } as const;
export const fixingStatus = { unspecified: 0, proposed: 1, disputed: 2, finalized: 3 } as const;

export function enumName(names: readonly string[], value: number | bigint): string {
  return names[Number(value)] ?? `unknown-${value.toString()}`;
}

/**
 * The direct book of one series version under the fee schedule version its market version names. A fee change
 * re-versions every series, so each (series version, fee version) pair rests in its own book.
 */
export function deriveSeriesBookId(
  deployment: OperatorDeployment,
  seriesId: Hex,
  versions: { readonly seriesVersion: number; readonly feeScheduleVersion: number },
): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { name: "typeHash", type: "bytes32" },
        { name: "chainId", type: "uint256" },
        { name: "book", type: "address" },
        { name: "orderState", type: "address" },
        { name: "targetKind", type: "uint8" },
        { name: "targetId", type: "bytes32" },
        { name: "targetVersion", type: "uint32" },
        { name: "executionModeId", type: "bytes32" },
        { name: "settlementAssetId", type: "bytes32" },
        { name: "settlementAssetVersion", type: "uint32" },
        { name: "feeScheduleId", type: "bytes32" },
        { name: "feeScheduleVersion", type: "uint32" },
        { name: "packageLegsHash", type: "bytes32" },
      ],
      [
        bookIdTypeHash,
        BigInt(deployment.chainId),
        deployment.addresses.publicOrderBook,
        deployment.addresses.orderState,
        1,
        seriesId,
        versions.seriesVersion,
        deployment.ids.executionModeId,
        deployment.ids.settlementAssetId,
        1,
        deployment.ids.feeScheduleId,
        versions.feeScheduleVersion,
        zeroId,
      ],
    ),
  );
}

/**
 * The risk admission witness the devnet risk adapter admits for a single-series order, ported from the web app's
 * reservation route so both producers commit to identical witnesses. Liability uses the order's own market caps.
 */
export function orderRiskWitness(deployment: OperatorDeployment, order: PublicOrder, orderHash: Hex, observedAt: bigint) {
  const { economics } = requireMarketBySeries(deployment, order.seriesId);
  const liabilityPerLot = order.side === 1 ? economics.maxLongDebitMinorPerLot : economics.maxShortDebitMinorPerLot;
  const terminalLiability = order.lots * liabilityPerLot;
  const positionId = keccak256(
    encodeAbiParameters(
      [
        { name: "namespace", type: "bytes32" },
        { name: "orderHash", type: "bytes32" },
      ],
      [positionNamespace, orderHash],
    ),
  );
  const economicsHash = keccak256(
    encodeAbiParameters(
      [
        { name: "namespace", type: "bytes32" },
        { name: "seriesId", type: "bytes32" },
        { name: "side", type: "uint8" },
        { name: "lots", type: "uint128" },
        { name: "priceTicks", type: "int128" },
        { name: "liability", type: "uint128" },
      ],
      [economicsNamespace, order.seriesId, order.side, order.lots, order.priceTicks, terminalLiability],
    ),
  );
  const valueHash = keccak256(
    encodeAbiParameters(
      [
        { name: "seriesId", type: "bytes32" },
        { name: "priceTicks", type: "int128" },
        { name: "observedAt", type: "uint64" },
      ],
      [order.seriesId, order.priceTicks, observedAt],
    ),
  );
  const riskSalt = keccak256(
    encodeAbiParameters(
      [
        { name: "orderHash", type: "bytes32" },
        { name: "orderSalt", type: "bytes32" },
      ],
      [orderHash, order.salt],
    ),
  );
  const request = {
    accountId: order.accountId,
    riskDomainId: deployment.ids.riskDomainId,
    riskDomainVersion: 1,
    openInterestIncreaseBaseUnits: order.lots,
    terminalLiabilityIncreaseBaseUnits: terminalLiability,
    deadline: order.deadline,
    nonce: order.nonce,
    salt: riskSalt,
  } as const;
  const positions = [
    {
      positionId,
      seriesId: order.seriesId,
      seriesVersion: order.targetVersion,
      signedLots: order.side === 1 ? order.lots : -order.lots,
      entryPriceTicks: order.priceTicks,
      maximumTerminalLiabilityBaseUnits: terminalLiability,
      economicsHash,
    },
  ] as const;
  const observations = [{ observationKey: markObservationKey, valueHash, observedAt }] as const;
  const requestHash = keccak256(
    encodeAbiParameters(
      [
        { name: "typeHash", type: "bytes32" },
        {
          name: "request",
          type: "tuple",
          components: [
            { name: "accountId", type: "bytes32" },
            { name: "riskDomainId", type: "bytes32" },
            { name: "riskDomainVersion", type: "uint32" },
            { name: "openInterestIncreaseBaseUnits", type: "uint128" },
            { name: "terminalLiabilityIncreaseBaseUnits", type: "uint128" },
            { name: "deadline", type: "uint64" },
            { name: "nonce", type: "uint256" },
            { name: "salt", type: "bytes32" },
          ],
        },
        { name: "chainId", type: "uint256" },
        { name: "engine", type: "address" },
      ],
      [riskRequestTypeHash, request, BigInt(deployment.chainId), deployment.addresses.portfolioRiskEngine],
    ),
  );
  const admissionId = keccak256(
    encodeAbiParameters(
      [
        { name: "typeHash", type: "bytes32" },
        { name: "requestHash", type: "bytes32" },
      ],
      [admissionIdTypeHash, requestHash],
    ),
  );
  return { request, positions, observations, admissionId, terminalLiability };
}

/** Deterministic 256-bit value for a stable label, used to pin nonces and salts to an idempotency key. */
export function deterministicWord(label: string): bigint {
  return BigInt(keccak256(stringToHex(label)));
}

export function deterministicSalt(label: string): Hex {
  return keccak256(stringToHex(label));
}
