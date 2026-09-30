import { getAddress, isAddress, isHex, type Address, type Hex } from "viem";

export interface OnchainPublicOrder {
  signer: Address;
  accountId: Hex;
  policyId: Hex;
  policyContextHash: Hex;
  actionId: Hex;
  targetKind: 1;
  seriesId: Hex;
  packageId: Hex;
  targetVersion: number;
  side: 1 | 2;
  lots: bigint;
  priceTicks: bigint;
  timeInForce: 1 | 2 | 3 | 4;
  deadline: bigint;
  executionModeId: Hex;
  feeScheduleId: Hex;
  feeScheduleVersion: number;
  maxFeeMinor: bigint;
  recipient: Address;
  permittedExecutor: Address;
  nonce: bigint;
  salt: Hex;
  allowPartialFills: boolean;
  minimumFillLots: bigint;
  remainderPolicy: 1 | 2;
  postOnly: boolean;
  reduceOnly: boolean;
}

export type SerializedPublicOrder = Omit<
  OnchainPublicOrder,
  "lots" | "priceTicks" | "deadline" | "maxFeeMinor" | "nonce" | "minimumFillLots"
> & {
  lots: string;
  priceTicks: string;
  deadline: string;
  maxFeeMinor: string;
  nonce: string;
  minimumFillLots: string;
};

export const publicOrderComponents = [
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
] as const;

export const publicOrderTypedData = {
  PublicOrder: publicOrderComponents,
} as const;

export interface OnchainPrivateRfqRequest {
  taker: Address;
  takerAccountId: Hex;
  takerOrderHash: Hex;
  targetKind: 1 | 2;
  seriesId: Hex;
  packageId: Hex;
  targetVersion: number;
  hasPackageLegCommitment: boolean;
  packageLegsHash: Hex;
  sidePolicy: 1 | 2 | 3;
  lots: bigint;
  allowPartialFills: boolean;
  minimumFillLots: bigint;
  remainderPolicy: 1 | 2;
  feeScheduleId: Hex;
  feeScheduleVersion: number;
  maxFeeMinor: bigint;
  riskDomainId: Hex;
  riskDomainVersion: number;
  privacyModeId: Hex;
  executionModeId: Hex;
  disclosurePolicyHash: Hex;
  eligibleMakerSetHash: Hex;
  deadline: bigint;
  permittedExecutor: Address;
  nonce: bigint;
  salt: Hex;
}

export interface OnchainMakerQuote {
  rfqId: Hex;
  maker: Address;
  makerAccountId: Hex;
  takerAccountId: Hex;
  makerOrderHash: Hex;
  targetKind: 1 | 2;
  seriesId: Hex;
  packageId: Hex;
  targetVersion: number;
  hasPackageLegCommitment: boolean;
  packageLegsHash: Hex;
  sidePolicy: 1 | 2 | 3;
  lots: bigint;
  allowPartialFills: boolean;
  minimumFillLots: bigint;
  remainderPolicy: 1 | 2;
  bidPriceTicks: bigint;
  askPriceTicks: bigint;
  feeScheduleId: Hex;
  feeScheduleVersion: number;
  maxFeeMinor: bigint;
  riskDomainId: Hex;
  riskDomainVersion: number;
  collateralAssetId: Hex;
  collateralBindingVersion: number;
  maximumLiability: bigint;
  privacyModeId: Hex;
  executionModeId: Hex;
  disclosurePolicyHash: Hex;
  eligibleMakerSetHash: Hex;
  deadline: bigint;
  capacityExpiry: bigint;
  permittedExecutor: Address;
  nonce: bigint;
  salt: Hex;
}

export interface OnchainRfqSelection {
  rfqId: Hex;
  quoteId: Hex;
  taker: Address;
  executor: Address;
  nonce: bigint;
  deadline: bigint;
  salt: Hex;
}

export const privateRfqRequestComponents = [
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
] as const;

export const makerQuoteComponents = [
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
] as const;

export const rfqSelectionComponents = [
  { name: "rfqId", type: "bytes32" },
  { name: "quoteId", type: "bytes32" },
  { name: "taker", type: "address" },
  { name: "executor", type: "address" },
  { name: "nonce", type: "uint256" },
  { name: "deadline", type: "uint64" },
  { name: "salt", type: "bytes32" },
] as const;

export const capacityCancelComponents = [
  { name: "quoteId", type: "bytes32" },
  { name: "maker", type: "address" },
  { name: "nonce", type: "uint256" },
  { name: "deadline", type: "uint64" },
  { name: "salt", type: "bytes32" },
] as const;

export const privateRfqRequestTypedData = { PrivateRfqRequest: privateRfqRequestComponents } as const;
export const makerQuoteTypedData = { MakerQuote: makerQuoteComponents } as const;
export const rfqSelectionTypedData = { RfqSelectionAuthorization: rfqSelectionComponents } as const;
export const capacityCancelTypedData = { CapacityCancelAuthorization: capacityCancelComponents } as const;

export const privateRfqBookAbi = [
  { type: "event", name: "PrivateRfqCommitted", inputs: [{ name: "rfqId", type: "bytes32", indexed: true }, { name: "requestCommitment", type: "bytes32", indexed: true }, { name: "targetCommitment", type: "bytes32", indexed: true }, { name: "packageLegsHash", type: "bytes32", indexed: false }, { name: "privacyModeId", type: "bytes32", indexed: false }, { name: "executionModeId", type: "bytes32", indexed: false }, { name: "deadline", type: "uint64", indexed: false }] },
  { type: "event", name: "MakerQuoteCommitted", inputs: [{ name: "quoteId", type: "bytes32", indexed: true }, { name: "rfqId", type: "bytes32", indexed: true }, { name: "quoteCommitment", type: "bytes32", indexed: true }, { name: "deadline", type: "uint64", indexed: false }, { name: "capacityExpiry", type: "uint64", indexed: false }] },
  { type: "event", name: "RfqSettled", inputs: [{ name: "rfqId", type: "bytes32", indexed: true }, { name: "quoteId", type: "bytes32", indexed: true }, { name: "settlementReference", type: "bytes32", indexed: true }] },
  { type: "function", name: "hashRequest", stateMutability: "view", inputs: [{ name: "request", type: "tuple", components: privateRfqRequestComponents }], outputs: [{ name: "rfqId", type: "bytes32" }] },
  { type: "function", name: "hashQuote", stateMutability: "view", inputs: [{ name: "quote", type: "tuple", components: makerQuoteComponents }], outputs: [{ name: "quoteId", type: "bytes32" }] },
  { type: "function", name: "registerRequest", stateMutability: "nonpayable", inputs: [{ name: "request", type: "tuple", components: privateRfqRequestComponents }, { name: "packageLegs", type: "tuple[]", components: [{ name: "seriesId", type: "bytes32" }, { name: "seriesVersion", type: "uint32" }, { name: "ratio", type: "int32" }] }, { name: "signature", type: "bytes" }], outputs: [{ name: "rfqId", type: "bytes32" }] },
  { type: "function", name: "openCollection", stateMutability: "nonpayable", inputs: [{ name: "rfqId", type: "bytes32" }], outputs: [] },
  { type: "function", name: "submitQuote", stateMutability: "nonpayable", inputs: [{ name: "quote", type: "tuple", components: makerQuoteComponents }, { name: "eligibleMakerProof", type: "bytes32[]" }, { name: "signature", type: "bytes" }], outputs: [{ name: "quoteId", type: "bytes32" }] },
  { type: "function", name: "reserveQuoteCapacity", stateMutability: "nonpayable", inputs: [{ name: "quoteId", type: "bytes32" }], outputs: [{ name: "lockId", type: "bytes32" }] },
  { type: "function", name: "lockSelection", stateMutability: "nonpayable", inputs: [{ name: "selection", type: "tuple", components: rfqSelectionComponents }, { name: "signature", type: "bytes" }], outputs: [] },
  { type: "function", name: "confirmSelectedCapacity", stateMutability: "nonpayable", inputs: [{ name: "rfqId", type: "bytes32" }], outputs: [] },
  { type: "function", name: "authorizeSubmission", stateMutability: "nonpayable", inputs: [{ name: "rfqId", type: "bytes32" }], outputs: [] },
  { type: "function", name: "submitSelectedRfq", stateMutability: "nonpayable", inputs: [{ name: "rfqId", type: "bytes32" }, { name: "submissionReference", type: "bytes32" }], outputs: [] },
  { type: "function", name: "cancelRfq", stateMutability: "nonpayable", inputs: [{ name: "rfqId", type: "bytes32" }], outputs: [] },
  { type: "function", name: "expireRfq", stateMutability: "nonpayable", inputs: [{ name: "rfqId", type: "bytes32" }], outputs: [] },
  { type: "function", name: "cancelQuoteCapacity", stateMutability: "nonpayable", inputs: [{ name: "cancellation", type: "tuple", components: capacityCancelComponents }, { name: "signature", type: "bytes" }], outputs: [] },
  { type: "function", name: "getRfq", stateMutability: "view", inputs: [{ name: "rfqId", type: "bytes32" }], outputs: [{ name: "record", type: "tuple", components: [{ name: "request", type: "tuple", components: privateRfqRequestComponents }, { name: "selectedQuoteId", type: "bytes32" }, { name: "status", type: "uint8" }, { name: "cumulativeFilledLots", type: "uint128" }, { name: "registeredAt", type: "uint64" }] }] },
  { type: "function", name: "getQuote", stateMutability: "view", inputs: [{ name: "quoteId", type: "bytes32" }], outputs: [{ name: "record", type: "tuple", components: [{ name: "quote", type: "tuple", components: makerQuoteComponents }, { name: "status", type: "uint8" }, { name: "cumulativeFilledLots", type: "uint128" }, { name: "offeredAt", type: "uint64" }] }] },
  { type: "function", name: "getCapacity", stateMutability: "view", inputs: [{ name: "quoteId", type: "bytes32" }], outputs: [{ name: "record", type: "tuple", components: [{ name: "quoteId", type: "bytes32" }, { name: "maker", type: "address" }, { name: "makerAccountId", type: "bytes32" }, { name: "collateralId", type: "bytes32" }, { name: "lockId", type: "bytes32" }, { name: "riskDomainId", type: "bytes32" }, { name: "riskDomainVersion", type: "uint32" }, { name: "expiry", type: "uint64" }, { name: "status", type: "uint8" }, { name: "initialLiability", type: "uint128" }, { name: "remainingLiability", type: "uint128" }] }] },
  { type: "function", name: "selectedHandoffCommitment", stateMutability: "view", inputs: [{ name: "rfqId", type: "bytes32" }], outputs: [{ name: "commitment", type: "bytes32" }] },
] as const;

export const orderStateAbi = [
  {
    type: "event",
    name: "OrderRegistered",
    inputs: [
      { name: "orderHash", type: "bytes32", indexed: true },
      { name: "signer", type: "address", indexed: true },
      { name: "nonce", type: "uint256", indexed: true },
      { name: "order", type: "tuple", indexed: false, components: publicOrderComponents },
      { name: "registeredAt", type: "uint64", indexed: false },
      { name: "initialStatus", type: "uint8", indexed: false },
    ],
  },
  {
    type: "function",
    name: "hashOrder",
    stateMutability: "view",
    inputs: [{ name: "order", type: "tuple", components: publicOrderComponents }],
    outputs: [{ name: "orderHash", type: "bytes32" }],
  },
  {
    type: "function",
    name: "registerSignedOrder",
    stateMutability: "nonpayable",
    inputs: [
      { name: "order", type: "tuple", components: publicOrderComponents },
      { name: "signature", type: "bytes" },
    ],
    outputs: [{ name: "orderHash", type: "bytes32" }],
  },
  {
    type: "function",
    name: "cancelOrder",
    stateMutability: "nonpayable",
    inputs: [{ name: "orderHash", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "getOrder",
    stateMutability: "view",
    inputs: [{ name: "orderHash", type: "bytes32" }],
    outputs: [
      {
        name: "record",
        type: "tuple",
        components: [
          { name: "order", type: "tuple", components: publicOrderComponents },
          { name: "filledLots", type: "uint128" },
          { name: "status", type: "uint8" },
          { name: "registeredAt", type: "uint64" },
        ],
      },
    ],
  },
] as const;

export const riskBindingAbi = [
  {
    type: "function",
    name: "bindOrderRisk",
    stateMutability: "nonpayable",
    inputs: [
      { name: "order", type: "tuple", components: publicOrderComponents },
      { name: "admissionId", type: "bytes32" },
    ],
    outputs: [{ name: "orderHash", type: "bytes32" }],
  },
  {
    type: "function",
    name: "cancelBoundAdmission",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "cancellation",
        type: "tuple",
        components: [
          { name: "admissionId", type: "bytes32" },
          { name: "orderHash", type: "bytes32" },
          { name: "accountId", type: "bytes32" },
          { name: "signer", type: "address" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint64" },
          { name: "cancellationReference", type: "bytes32" },
        ],
      },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "admissionForOrder",
    stateMutability: "view",
    inputs: [{ name: "orderHash", type: "bytes32" }],
    outputs: [{ name: "admissionId", type: "bytes32" }],
  },
] as const;

export const riskEngineAbi = [
  {
    type: "function",
    name: "getAdmission",
    stateMutability: "view",
    inputs: [{ name: "admissionId", type: "bytes32" }],
    outputs: [
      {
        name: "admission",
        type: "tuple",
        components: [
          { name: "requestHash", type: "bytes32" },
          { name: "resultHash", type: "bytes32" },
          { name: "reservedResultCommitment", type: "bytes32" },
          { name: "accountId", type: "bytes32" },
          { name: "riskDomainId", type: "bytes32" },
          { name: "riskDomainVersion", type: "uint32" },
          { name: "openInterestBaseUnits", type: "uint128" },
          { name: "terminalLiabilityBaseUnits", type: "uint128" },
          { name: "remainingOpenInterestBaseUnits", type: "uint128" },
          { name: "remainingTerminalLiabilityBaseUnits", type: "uint128" },
          { name: "deadline", type: "uint64" },
          { name: "status", type: "uint8" },
        ],
      },
    ],
  },
] as const;

export const publicOrderBookAbi = [
  {
    type: "error",
    name: "PostOnlyWouldCross",
    inputs: [
      { name: "orderHash", type: "bytes32" },
      { name: "oppositeOrderHash", type: "bytes32" },
    ],
  },
  {
    type: "error",
    name: "RestingOrderWouldCross",
    inputs: [
      { name: "orderHash", type: "bytes32" },
      { name: "oppositeOrderHash", type: "bytes32" },
    ],
  },
  {
    type: "event",
    name: "DirectOrderRested",
    inputs: [
      { name: "bookId", type: "bytes32", indexed: true },
      { name: "orderHash", type: "bytes32", indexed: true },
      { name: "levelId", type: "bytes32", indexed: true },
      { name: "side", type: "uint8", indexed: false },
      { name: "priceTicks", type: "int128", indexed: false },
      { name: "remainingLots", type: "uint128", indexed: false },
      { name: "sequence", type: "uint64", indexed: false },
      { name: "previousOrderHash", type: "bytes32", indexed: false },
      { name: "liquidityKind", type: "uint8", indexed: false },
    ],
  },
  {
    type: "event",
    name: "DirectMatchExecuted",
    inputs: [
      { name: "bookId", type: "bytes32", indexed: true },
      { name: "fillId", type: "bytes32", indexed: true },
      { name: "makerOrderHash", type: "bytes32", indexed: true },
      { name: "takerOrderHash", type: "bytes32", indexed: false },
      { name: "fillLots", type: "uint128", indexed: false },
      { name: "executionPriceTicks", type: "int128", indexed: false },
      { name: "makerSequence", type: "uint64", indexed: false },
      { name: "liquidityKind", type: "uint8", indexed: false },
    ],
  },
  {
    type: "function",
    name: "placeSeriesOrder",
    stateMutability: "nonpayable",
    inputs: [
      { name: "orderHash", type: "bytes32" },
      {
        name: "hint",
        type: "tuple",
        components: [
          { name: "previousLevelId", type: "bytes32" },
          { name: "nextLevelId", type: "bytes32" },
        ],
      },
    ],
    outputs: [{ name: "bookId", type: "bytes32" }],
  },
  {
    type: "function",
    name: "syncOrder",
    stateMutability: "nonpayable",
    inputs: [{ name: "orderHash", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "pruneBest",
    stateMutability: "nonpayable",
    inputs: [
      { name: "bookId", type: "bytes32" },
      { name: "side", type: "uint8" },
      { name: "candidates", type: "bytes32[]" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "bestLevel",
    stateMutability: "view",
    inputs: [
      { name: "bookId", type: "bytes32" },
      { name: "side", type: "uint8" },
    ],
    outputs: [{ name: "levelId", type: "bytes32" }],
  },
  {
    type: "function",
    name: "getPriceLevel",
    stateMutability: "view",
    inputs: [{ name: "levelId", type: "bytes32" }],
    outputs: [
      {
        name: "level",
        type: "tuple",
        components: [
          { name: "bookId", type: "bytes32" },
          { name: "levelId", type: "bytes32" },
          { name: "previousLevelId", type: "bytes32" },
          { name: "nextLevelId", type: "bytes32" },
          { name: "headOrderHash", type: "bytes32" },
          { name: "tailOrderHash", type: "bytes32" },
          { name: "priceTicks", type: "int128" },
          { name: "totalLots", type: "uint256" },
          { name: "orderCount", type: "uint64" },
          { name: "side", type: "uint8" },
          { name: "active", type: "bool" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getBookOrder",
    stateMutability: "view",
    inputs: [{ name: "orderHash", type: "bytes32" }],
    outputs: [
      {
        name: "order",
        type: "tuple",
        components: [
          { name: "bookId", type: "bytes32" },
          { name: "orderHash", type: "bytes32" },
          { name: "levelId", type: "bytes32" },
          { name: "previousOrderHash", type: "bytes32" },
          { name: "nextOrderHash", type: "bytes32" },
          { name: "sequence", type: "uint64" },
          { name: "remainingLots", type: "uint128" },
          { name: "priceTicks", type: "int128" },
          { name: "side", type: "uint8" },
          { name: "status", type: "uint8" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "matchSeries",
    stateMutability: "nonpayable",
    inputs: [
      { name: "bookId", type: "bytes32" },
      {
        name: "proposals",
        type: "tuple[]",
        components: [
          {
            name: "matchData",
            type: "tuple",
            components: [
              { name: "takerOrderHash", type: "bytes32" },
              { name: "makerOrderHash", type: "bytes32" },
              { name: "fillLots", type: "uint128" },
              { name: "executionPriceTicks", type: "int128" },
              { name: "longAdmissionId", type: "bytes32" },
              { name: "longAdmissionResultHash", type: "bytes32" },
              { name: "shortAdmissionId", type: "bytes32" },
              { name: "shortAdmissionResultHash", type: "bytes32" },
              {
                name: "takerFunding",
                type: "tuple",
                components: [
                  { name: "terminalLiabilityLockId", type: "bytes32" },
                  { name: "considerationLockId", type: "bytes32" },
                ],
              },
              {
                name: "makerFunding",
                type: "tuple",
                components: [
                  { name: "terminalLiabilityLockId", type: "bytes32" },
                  { name: "considerationLockId", type: "bytes32" },
                ],
              },
              {
                name: "takerFeeFunding",
                type: "tuple",
                components: [
                  { name: "consumptionId", type: "bytes32" },
                  { name: "chargeLockId", type: "bytes32" },
                  { name: "budgetLockId", type: "bytes32" },
                ],
              },
              {
                name: "makerFeeFunding",
                type: "tuple",
                components: [
                  { name: "consumptionId", type: "bytes32" },
                  { name: "chargeLockId", type: "bytes32" },
                  { name: "budgetLockId", type: "bytes32" },
                ],
              },
            ],
          },
          { name: "payoffTerms", type: "bytes" },
          { name: "channelKind", type: "uint8" },
        ],
      },
    ],
    outputs: [{ name: "fillIds", type: "bytes32[]" }],
  },
] as const;

export const atomicClearingAbi = [
  {
    type: "event",
    name: "FillLedgerEntry",
    inputs: [
      { name: "fillId", type: "bytes32", indexed: true },
      { name: "kind", type: "uint8", indexed: true },
      { name: "payerAccountId", type: "bytes32", indexed: true },
      { name: "receiverAccountId", type: "bytes32", indexed: false },
      { name: "amount", type: "uint128", indexed: false },
      { name: "fundingReference", type: "bytes32", indexed: false },
    ],
  },
  {
    type: "event",
    name: "FillPositionCreated",
    inputs: [
      { name: "fillId", type: "bytes32", indexed: true },
      { name: "positionId", type: "bytes32", indexed: true },
      { name: "seriesId", type: "bytes32", indexed: true },
      { name: "seriesVersion", type: "uint32", indexed: false },
      { name: "ordinal", type: "uint16", indexed: false },
      { name: "packageRatio", type: "int32", indexed: false },
      { name: "lots", type: "uint128", indexed: false },
      { name: "entryPriceTicks", type: "int128", indexed: false },
      { name: "longReservationId", type: "bytes32", indexed: false },
      { name: "shortReservationId", type: "bytes32", indexed: false },
    ],
  },
  {
    type: "function",
    name: "getFill",
    stateMutability: "view",
    inputs: [{ name: "fillId", type: "bytes32" }],
    outputs: [{
      name: "record",
      type: "tuple",
      components: [
        { name: "fillId", type: "bytes32" },
        { name: "takerOrderHash", type: "bytes32" },
        { name: "makerOrderHash", type: "bytes32" },
        { name: "targetId", type: "bytes32" },
        { name: "witnessHash", type: "bytes32" },
        { name: "executionModeId", type: "bytes32" },
        { name: "channelConsumptionId", type: "bytes32" },
        { name: "routeCommitment", type: "bytes32" },
        { name: "channelSource", type: "address" },
        { name: "channelKind", type: "uint8" },
        { name: "settlementAssetId", type: "bytes32" },
        { name: "buyerAccountId", type: "bytes32" },
        { name: "sellerAccountId", type: "bytes32" },
        { name: "makerFeeResultHash", type: "bytes32" },
        { name: "takerFeeResultHash", type: "bytes32" },
        { name: "targetVersion", type: "uint32" },
        { name: "settlementAssetVersion", type: "uint32" },
        { name: "clearedAt", type: "uint64" },
        { name: "fillLots", type: "uint128" },
        { name: "takerCumulativeLots", type: "uint128" },
        { name: "makerCumulativeLots", type: "uint128" },
        { name: "executionPriceTicks", type: "int128" },
        { name: "considerationMinor", type: "int256" },
        { name: "makerFeeChargeMinor", type: "uint128" },
        { name: "makerFeeRebateMinor", type: "uint128" },
        { name: "takerFeeChargeMinor", type: "uint128" },
        { name: "takerFeeRebateMinor", type: "uint128" },
        { name: "positionCount", type: "uint16" },
        { name: "isPackage", type: "bool" },
      ],
    }],
  },
  {
    type: "function",
    name: "previewSeriesFillId",
    stateMutability: "view",
    inputs: [
      { name: "takerOrderHash", type: "bytes32" },
      { name: "makerOrderHash", type: "bytes32" },
      { name: "fillLots", type: "uint128" },
      { name: "executionPriceTicks", type: "int128" },
      { name: "payoffTerms", type: "bytes" },
    ],
    outputs: [{ name: "fillId", type: "bytes32" }],
  },
  {
    type: "function",
    name: "clearSeriesWithHandoff",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "request",
        type: "tuple",
        components: [
          {
            name: "matchData",
            type: "tuple",
            components: [
              { name: "takerOrderHash", type: "bytes32" },
              { name: "makerOrderHash", type: "bytes32" },
              { name: "fillLots", type: "uint128" },
              { name: "executionPriceTicks", type: "int128" },
              { name: "longAdmissionId", type: "bytes32" },
              { name: "longAdmissionResultHash", type: "bytes32" },
              { name: "shortAdmissionId", type: "bytes32" },
              { name: "shortAdmissionResultHash", type: "bytes32" },
              { name: "takerFunding", type: "tuple", components: [{ name: "terminalLiabilityLockId", type: "bytes32" }, { name: "considerationLockId", type: "bytes32" }] },
              { name: "makerFunding", type: "tuple", components: [{ name: "terminalLiabilityLockId", type: "bytes32" }, { name: "considerationLockId", type: "bytes32" }] },
              { name: "takerFeeFunding", type: "tuple", components: [{ name: "consumptionId", type: "bytes32" }, { name: "chargeLockId", type: "bytes32" }, { name: "budgetLockId", type: "bytes32" }] },
              { name: "makerFeeFunding", type: "tuple", components: [{ name: "consumptionId", type: "bytes32" }, { name: "chargeLockId", type: "bytes32" }, { name: "budgetLockId", type: "bytes32" }] },
            ],
          },
          { name: "payoffTerms", type: "bytes" },
          { name: "channelKind", type: "uint8" },
        ],
      },
      {
        name: "claim",
        type: "tuple",
        components: [
          { name: "kind", type: "uint8" },
          { name: "consumptionId", type: "bytes32" },
          { name: "sourceId", type: "bytes32" },
          { name: "sourceVersion", type: "uint32" },
          { name: "sourceCommitment", type: "bytes32" },
          { name: "takerOrderHash", type: "bytes32" },
          { name: "makerOrderHash", type: "bytes32" },
          { name: "takerAccountId", type: "bytes32" },
          { name: "makerAccountId", type: "bytes32" },
          { name: "takerSide", type: "uint8" },
          { name: "targetKind", type: "uint8" },
          { name: "seriesId", type: "bytes32" },
          { name: "packageId", type: "bytes32" },
          { name: "targetVersion", type: "uint32" },
          { name: "selectedQuoteOrRouteId", type: "bytes32" },
          { name: "packageWitnessHash", type: "bytes32" },
          { name: "packageLegs", type: "tuple[]", components: [{ name: "seriesId", type: "bytes32" }, { name: "seriesVersion", type: "uint32" }, { name: "ratio", type: "int32" }] },
          { name: "fillLots", type: "uint128" },
          { name: "executionPriceTicks", type: "int128" },
          { name: "feeScheduleId", type: "bytes32" },
          { name: "feeScheduleVersion", type: "uint32" },
          { name: "takerMaximumFeeMinor", type: "uint128" },
          { name: "makerMaximumFeeMinor", type: "uint128" },
          { name: "makerFeeFunding", type: "tuple", components: [{ name: "consumptionId", type: "bytes32" }, { name: "chargeLockId", type: "bytes32" }, { name: "budgetLockId", type: "bytes32" }] },
          { name: "takerFeeFunding", type: "tuple", components: [{ name: "consumptionId", type: "bytes32" }, { name: "chargeLockId", type: "bytes32" }, { name: "budgetLockId", type: "bytes32" }] },
          { name: "riskDomainId", type: "bytes32" },
          { name: "riskDomainVersion", type: "uint32" },
          { name: "executionModeId", type: "bytes32" },
          { name: "longAdmissionId", type: "bytes32" },
          { name: "longAdmissionResultHash", type: "bytes32" },
          { name: "shortAdmissionId", type: "bytes32" },
          { name: "shortAdmissionResultHash", type: "bytes32" },
          { name: "deadline", type: "uint64" },
          {
            name: "capacityDispositions",
            type: "tuple[]",
            components: [
              { name: "positionOrdinal", type: "uint32" },
              { name: "side", type: "uint8" },
              { name: "accountId", type: "bytes32" },
              { name: "funding", type: "tuple", components: [{ name: "lockId", type: "bytes32" }, { name: "lockReference", type: "bytes32" }, { name: "expectedRemainingAmount", type: "uint128" }, { name: "expectedExpiry", type: "uint64" }] },
              { name: "reservationAmount", type: "uint128" },
              { name: "capacityDisposition", type: "uint8" },
              { name: "reservationId", type: "bytes32" },
              { name: "unusedCapacityPolicy", type: "uint8" },
            ],
          },
        ],
      },
    ],
    outputs: [{ name: "fillId", type: "bytes32" }],
  },
] as const;

export function serializePublicOrder(order: OnchainPublicOrder): SerializedPublicOrder {
  return {
    ...order,
    lots: order.lots.toString(),
    priceTicks: order.priceTicks.toString(),
    deadline: order.deadline.toString(),
    maxFeeMinor: order.maxFeeMinor.toString(),
    nonce: order.nonce.toString(),
    minimumFillLots: order.minimumFillLots.toString(),
  };
}

export function parsePublicOrder(candidate: unknown): OnchainPublicOrder {
  if (!candidate || typeof candidate !== "object") throw new Error("INVALID_ORDER");
  const order = candidate as Record<string, unknown>;
  const address = (field: string): Address => {
    const value = order[field];
    if (typeof value !== "string" || !isAddress(value)) throw new Error("INVALID_ORDER");
    return getAddress(value);
  };
  const hash = (field: string): Hex => {
    const value = order[field];
    if (typeof value !== "string" || !isHex(value, { strict: true }) || value.length !== 66) {
      throw new Error("INVALID_ORDER");
    }
    return value;
  };
  const integer = (field: string): bigint => {
    const value = order[field];
    if (typeof value !== "string" || !/^-?\d+$/.test(value)) throw new Error("INVALID_ORDER");
    return BigInt(value);
  };
  const number = (field: string): number => {
    const value = order[field];
    if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error("INVALID_ORDER");
    return value;
  };
  const boolean = (field: string): boolean => {
    const value = order[field];
    if (typeof value !== "boolean") throw new Error("INVALID_ORDER");
    return value;
  };
  const targetKind = number("targetKind");
  const side = number("side");
  const timeInForce = number("timeInForce");
  const remainderPolicy = number("remainderPolicy");
  if (targetKind !== 1 || (side !== 1 && side !== 2)) throw new Error("INVALID_ORDER");
  if (![1, 2, 3, 4].includes(timeInForce) || (remainderPolicy !== 1 && remainderPolicy !== 2)) {
    throw new Error("INVALID_ORDER");
  }
  const lots = integer("lots");
  const priceTicks = integer("priceTicks");
  const deadline = integer("deadline");
  const maxFeeMinor = integer("maxFeeMinor");
  const nonce = integer("nonce");
  const minimumFillLots = integer("minimumFillLots");
  const uint128Max = (BigInt(1) << BigInt(128)) - BigInt(1);
  const int128Min = -(BigInt(1) << BigInt(127));
  const int128Max = (BigInt(1) << BigInt(127)) - BigInt(1);
  if (
    lots <= BigInt(0) ||
    lots > uint128Max ||
    priceTicks < int128Min ||
    priceTicks > int128Max ||
    deadline <= BigInt(0) ||
    deadline > (BigInt(1) << BigInt(64)) - BigInt(1) ||
    maxFeeMinor <= BigInt(0) ||
    maxFeeMinor > uint128Max ||
    nonce < BigInt(0) ||
    minimumFillLots <= BigInt(0) ||
    minimumFillLots > lots
  ) {
    throw new Error("INVALID_ORDER");
  }
  return {
    signer: address("signer"),
    accountId: hash("accountId"),
    policyId: hash("policyId"),
    policyContextHash: hash("policyContextHash"),
    actionId: hash("actionId"),
    targetKind: 1,
    seriesId: hash("seriesId"),
    packageId: hash("packageId"),
    targetVersion: number("targetVersion"),
    side: side as 1 | 2,
    lots,
    priceTicks,
    timeInForce: timeInForce as 1 | 2 | 3 | 4,
    deadline,
    executionModeId: hash("executionModeId"),
    feeScheduleId: hash("feeScheduleId"),
    feeScheduleVersion: number("feeScheduleVersion"),
    maxFeeMinor,
    recipient: address("recipient"),
    permittedExecutor: address("permittedExecutor"),
    nonce,
    salt: hash("salt"),
    allowPartialFills: boolean("allowPartialFills"),
    minimumFillLots,
    remainderPolicy: remainderPolicy as 1 | 2,
    postOnly: boolean("postOnly"),
    reduceOnly: boolean("reduceOnly"),
  };
}

export const fundedFeeLedgerAbi = [
  {
    type: "event",
    name: "FeeLedgerEntryRecorded",
    inputs: [
      { name: "consumptionId", type: "bytes32", indexed: true },
      { name: "kind", type: "uint8", indexed: true },
      { name: "actionId", type: "bytes32", indexed: true },
      { name: "accountId", type: "bytes32", indexed: false },
      { name: "amountMinor", type: "int256", indexed: false },
    ],
    anonymous: false,
  },
] as const;

const FEE_CHARGE_DEBIT = 1;
const FEE_REBATE_CREDIT = 4;

/**
 * Net fee an account paid in minor units, from the funded fee engine's ledger: charge debits are recorded negative and
 * rebates positive, so the fee paid is the negated sum of both for the account.
 */
export function accountFeesPaidMinor(
  events: readonly { args: { kind?: number; accountId?: Hex; amountMinor?: bigint } }[],
  accountId: string,
): bigint {
  let paid = BigInt(0);
  for (const { args } of events) {
    if (args.accountId?.toLowerCase() !== accountId.toLowerCase() || args.amountMinor == null) continue;
    if (args.kind === FEE_CHARGE_DEBIT || args.kind === FEE_REBATE_CREDIT) paid -= args.amountMinor;
  }
  return paid;
}

/*
 * Settlement, fixing and holder-election surfaces, trimmed from the compiled contract ABIs (internal types dropped).
 * The error list lets a simulated revert decode to its contract error name for a precise disabled reason.
 */
export const seriesRegistryAbi = [
  {"type":"function","name":"getSeries","inputs":[{"name":"seriesId","type":"bytes32"},{"name":"version","type":"uint32"}],"outputs":[{"name":"","type":"tuple","components":[{"name":"definition","type":"tuple","components":[{"name":"namespaceId","type":"bytes32"},{"name":"seriesKey","type":"bytes32"},{"name":"marketId","type":"bytes32"},{"name":"marketVersion","type":"uint32"},{"name":"instrumentId","type":"bytes32"},{"name":"instrumentVersion","type":"uint32"},{"name":"tradingStartsAt","type":"uint64"},{"name":"lastTradingAt","type":"uint64"},{"name":"expiryAt","type":"uint64"},{"name":"exerciseOpensAt","type":"uint64"},{"name":"exerciseCutoffAt","type":"uint64"},{"name":"fixingWindowOpen","type":"uint64"},{"name":"fixingWindowClose","type":"uint64"},{"name":"primaryEvidenceDeadline","type":"uint64"},{"name":"correctionCutoffAt","type":"uint64"},{"name":"finalResolutionAt","type":"uint64"},{"name":"settlementDeadline","type":"uint64"},{"name":"exercisePolicyId","type":"bytes32"},{"name":"automaticExerciseThresholdMinor","type":"uint128"},{"name":"disruptionOutcomeId","type":"bytes32"},{"name":"terminalDisruptionTransferMinorPerLot","type":"int256"},{"name":"payoffTermsHash","type":"bytes32"},{"name":"fixingSlotsHash","type":"bytes32"},{"name":"dateAdjustmentEvidenceHash","type":"bytes32"},{"name":"maxLongDebitMinorPerLot","type":"uint128"},{"name":"maxShortDebitMinorPerLot","type":"uint128"},{"name":"qualificationEvidenceHash","type":"bytes32"}]},{"name":"definitionHash","type":"bytes32"},{"name":"versionHash","type":"bytes32"},{"name":"version","type":"uint32"},{"name":"status","type":"uint8"}]}],"stateMutability":"view"},
  {"type":"event","name":"SeriesQualificationPublished","inputs":[{"name":"seriesId","type":"bytes32","indexed":true},{"name":"version","type":"uint32","indexed":true},{"name":"qualification","type":"tuple","indexed":false,"components":[{"name":"payoffTerms","type":"bytes"},{"name":"fixingSlots","type":"tuple[]","components":[{"name":"slot","type":"uint8"},{"name":"candidates","type":"tuple[]","components":[{"name":"benchmarkId","type":"bytes32"},{"name":"benchmarkVersion","type":"uint32"},{"name":"requiredWindowKindId","type":"bytes32"},{"name":"selectionRuleId","type":"bytes32"},{"name":"targetAt","type":"uint64"},{"name":"windowStartsAt","type":"uint64"},{"name":"windowEndsAt","type":"uint64"},{"name":"unavailableAfter","type":"uint64"},{"name":"maxPublicationLagSeconds","type":"uint32"},{"name":"minimumObservations","type":"uint16"},{"name":"maximumObservations","type":"uint16"},{"name":"selectionParametersHash","type":"bytes32"}]}]},{"name":"dateProofs","type":"tuple[]","components":[{"name":"kind","type":"uint8"},{"name":"conventionId","type":"bytes32"},{"name":"scheduledDay","type":"uint32"},{"name":"calendarDays","type":"tuple[]","components":[{"name":"calendarDay","type":"tuple","components":[{"name":"day","type":"uint32"},{"name":"isBusinessDay","type":"bool"},{"name":"evidenceHash","type":"bytes32"}]},{"name":"merkleProof","type":"bytes32[]"}]}]}]}],"anonymous":false},
] as const;

export const fixingEngineAbi = [
  {"type":"function","name":"fixingStatus","inputs":[{"name":"seriesId","type":"bytes32"},{"name":"seriesVersion","type":"uint32"},{"name":"slot","type":"uint8"}],"outputs":[{"name":"","type":"uint8"}],"stateMutability":"view"},
  {"type":"function","name":"getFinalizedFixing","inputs":[{"name":"seriesId","type":"bytes32"},{"name":"seriesVersion","type":"uint32"},{"name":"slot","type":"uint8"}],"outputs":[{"name":"result","type":"tuple","components":[{"name":"resultHash","type":"bytes32"},{"name":"proposalHash","type":"bytes32"},{"name":"resolutionKind","type":"uint8"},{"name":"effectiveAt","type":"uint64"},{"name":"finalizedAt","type":"uint64"},{"name":"finalizedBlock","type":"uint64"},{"name":"candidateIndex","type":"uint8"},{"name":"decimals","type":"uint8"},{"name":"value","type":"int256"},{"name":"terminalDisruptionTransferMinorPerLot","type":"int256"}]}],"stateMutability":"view"},
  {"type":"function","name":"getProposal","inputs":[{"name":"seriesId","type":"bytes32"},{"name":"seriesVersion","type":"uint32"},{"name":"slot","type":"uint8"}],"outputs":[{"name":"proposal","type":"tuple","components":[{"name":"proposalHash","type":"bytes32"},{"name":"observationsHash","type":"bytes32"},{"name":"evidenceHash","type":"bytes32"},{"name":"completenessHash","type":"bytes32"},{"name":"evidenceOriginId","type":"bytes32"},{"name":"adapterId","type":"bytes32"},{"name":"adapterVersion","type":"uint32"},{"name":"batchSequence","type":"uint64"},{"name":"candidateDeadline","type":"uint64"},{"name":"firstObservedAt","type":"uint64"},{"name":"lastObservedAt","type":"uint64"},{"name":"latestPublishedAt","type":"uint64"},{"name":"observationCount","type":"uint16"},{"name":"candidateIndex","type":"uint8"},{"name":"decimals","type":"uint8"},{"name":"value","type":"int256"}]}],"stateMutability":"view"},
] as const;

export const cashSettlementAbi = [
  {"type":"function","name":"finalizeLapsedPosition","inputs":[{"name":"positionId","type":"bytes32"},{"name":"feeActions","type":"tuple[]","components":[{"name":"parentActionId","type":"bytes32"},{"name":"consumptionId","type":"bytes32"},{"name":"feeScheduleId","type":"bytes32"},{"name":"feeScheduleVersion","type":"uint32"},{"name":"actionId","type":"bytes32"},{"name":"chargePayerAccountId","type":"bytes32"},{"name":"rebateRecipientAccountId","type":"bytes32"},{"name":"notionalMinor","type":"uint128"},{"name":"qualifyingVolumeMinor","type":"uint128"},{"name":"maxFeeMinor","type":"uint128"},{"name":"chargeLockId","type":"bytes32"},{"name":"budgetLockId","type":"bytes32"},{"name":"actionOrdinal","type":"uint32"}]}],"outputs":[{"name":"settlementId","type":"bytes32"}],"stateMutability":"nonpayable"},
  {"type":"function","name":"finalizeNormalSettlement","inputs":[{"name":"positionId","type":"bytes32"},{"name":"fixingSlots","type":"tuple[]","components":[{"name":"slot","type":"uint8"},{"name":"candidates","type":"tuple[]","components":[{"name":"benchmarkId","type":"bytes32"},{"name":"benchmarkVersion","type":"uint32"},{"name":"requiredWindowKindId","type":"bytes32"},{"name":"selectionRuleId","type":"bytes32"},{"name":"targetAt","type":"uint64"},{"name":"windowStartsAt","type":"uint64"},{"name":"windowEndsAt","type":"uint64"},{"name":"unavailableAfter","type":"uint64"},{"name":"maxPublicationLagSeconds","type":"uint32"},{"name":"minimumObservations","type":"uint16"},{"name":"maximumObservations","type":"uint16"},{"name":"selectionParametersHash","type":"bytes32"}]}]},{"name":"feeActions","type":"tuple[]","components":[{"name":"parentActionId","type":"bytes32"},{"name":"consumptionId","type":"bytes32"},{"name":"feeScheduleId","type":"bytes32"},{"name":"feeScheduleVersion","type":"uint32"},{"name":"actionId","type":"bytes32"},{"name":"chargePayerAccountId","type":"bytes32"},{"name":"rebateRecipientAccountId","type":"bytes32"},{"name":"notionalMinor","type":"uint128"},{"name":"qualifyingVolumeMinor","type":"uint128"},{"name":"maxFeeMinor","type":"uint128"},{"name":"chargeLockId","type":"bytes32"},{"name":"budgetLockId","type":"bytes32"},{"name":"actionOrdinal","type":"uint32"}]}],"outputs":[{"name":"settlementId","type":"bytes32"}],"stateMutability":"nonpayable"},
  {"type":"function","name":"finalizeTerminalDisruption","inputs":[{"name":"positionId","type":"bytes32"},{"name":"fixingSlots","type":"tuple[]","components":[{"name":"slot","type":"uint8"},{"name":"candidates","type":"tuple[]","components":[{"name":"benchmarkId","type":"bytes32"},{"name":"benchmarkVersion","type":"uint32"},{"name":"requiredWindowKindId","type":"bytes32"},{"name":"selectionRuleId","type":"bytes32"},{"name":"targetAt","type":"uint64"},{"name":"windowStartsAt","type":"uint64"},{"name":"windowEndsAt","type":"uint64"},{"name":"unavailableAfter","type":"uint64"},{"name":"maxPublicationLagSeconds","type":"uint32"},{"name":"minimumObservations","type":"uint16"},{"name":"maximumObservations","type":"uint16"},{"name":"selectionParametersHash","type":"bytes32"}]}]},{"name":"feeActions","type":"tuple[]","components":[{"name":"parentActionId","type":"bytes32"},{"name":"consumptionId","type":"bytes32"},{"name":"feeScheduleId","type":"bytes32"},{"name":"feeScheduleVersion","type":"uint32"},{"name":"actionId","type":"bytes32"},{"name":"chargePayerAccountId","type":"bytes32"},{"name":"rebateRecipientAccountId","type":"bytes32"},{"name":"notionalMinor","type":"uint128"},{"name":"qualifyingVolumeMinor","type":"uint128"},{"name":"maxFeeMinor","type":"uint128"},{"name":"chargeLockId","type":"bytes32"},{"name":"budgetLockId","type":"bytes32"},{"name":"actionOrdinal","type":"uint32"}]}],"outputs":[{"name":"settlementId","type":"bytes32"}],"stateMutability":"nonpayable"},
  {"type":"function","name":"fulfillClaim","inputs":[{"name":"claimId","type":"bytes32"}],"outputs":[],"stateMutability":"nonpayable"},
  {"type":"function","name":"getSettlement","inputs":[{"name":"settlementId","type":"bytes32"}],"outputs":[{"name":"record","type":"tuple","components":[{"name":"settlementId","type":"bytes32"},{"name":"positionId","type":"bytes32"},{"name":"mode","type":"uint8"},{"name":"seriesVersionHash","type":"bytes32"},{"name":"payoffTermsHash","type":"bytes32"},{"name":"fixingSlotsHash","type":"bytes32"},{"name":"fixingsHash","type":"bytes32"},{"name":"positionOutcomeReference","type":"bytes32"},{"name":"outcomeHash","type":"bytes32"},{"name":"payerAccountId","type":"bytes32"},{"name":"receiverAccountId","type":"bytes32"},{"name":"terminalTransferMinor","type":"int256"},{"name":"terminalAmount","type":"uint128"},{"name":"finalizedAt","type":"uint64"},{"name":"longCollateral","type":"tuple","components":[{"name":"reservationId","type":"bytes32"},{"name":"claimId","type":"bytes32"},{"name":"status","type":"uint8"},{"name":"payerAccountId","type":"bytes32"},{"name":"receiverAccountId","type":"bytes32"},{"name":"reservedBefore","type":"uint128"},{"name":"claimAmount","type":"uint128"},{"name":"releasedAmount","type":"uint128"}]},{"name":"shortCollateral","type":"tuple","components":[{"name":"reservationId","type":"bytes32"},{"name":"claimId","type":"bytes32"},{"name":"status","type":"uint8"},{"name":"payerAccountId","type":"bytes32"},{"name":"receiverAccountId","type":"bytes32"},{"name":"reservedBefore","type":"uint128"},{"name":"claimAmount","type":"uint128"},{"name":"releasedAmount","type":"uint128"}]},{"name":"feeReceipts","type":"tuple[]","components":[{"name":"actionId","type":"bytes32"},{"name":"consumptionId","type":"bytes32"},{"name":"resultHash","type":"bytes32"},{"name":"chargeMinor","type":"uint128"},{"name":"rebateMinor","type":"uint128"}]}]}],"stateMutability":"view"},
  {"type":"function","name":"settlementOf","inputs":[{"name":"positionId","type":"bytes32"}],"outputs":[{"name":"settlementId","type":"bytes32"}],"stateMutability":"view"},
  {"type":"event","name":"CashSettlementFinalized","inputs":[{"name":"settlementId","type":"bytes32","indexed":true},{"name":"positionId","type":"bytes32","indexed":true},{"name":"mode","type":"uint8","indexed":true},{"name":"outcomeHash","type":"bytes32","indexed":false},{"name":"fixingsHash","type":"bytes32","indexed":false},{"name":"positionOutcomeReference","type":"bytes32","indexed":false},{"name":"terminalTransferMinor","type":"int256","indexed":false},{"name":"terminalAmount","type":"uint128","indexed":false},{"name":"caller","type":"address","indexed":false}],"anonymous":false},
  {"type":"event","name":"SettlementClaimFulfilled","inputs":[{"name":"claimId","type":"bytes32","indexed":true},{"name":"positionId","type":"bytes32","indexed":true},{"name":"settlementId","type":"bytes32","indexed":true},{"name":"caller","type":"address","indexed":false}],"anonymous":false},
] as const;

export const positionTerminalAbi = [
  {"type":"function","name":"getPosition","inputs":[{"name":"positionId","type":"bytes32"}],"outputs":[{"name":"economics","type":"tuple","components":[{"name":"positionId","type":"bytes32"},{"name":"fillIdentity","type":"bytes32"},{"name":"seriesId","type":"bytes32"},{"name":"seriesVersionHash","type":"bytes32"},{"name":"marketId","type":"bytes32"},{"name":"instrumentId","type":"bytes32"},{"name":"longAccountId","type":"bytes32"},{"name":"shortAccountId","type":"bytes32"},{"name":"payoffModuleId","type":"bytes32"},{"name":"payoffModule","type":"address"},{"name":"payoffModuleCodeHash","type":"bytes32"},{"name":"settlementAssetId","type":"bytes32"},{"name":"riskDomainId","type":"bytes32"},{"name":"feeScheduleId","type":"bytes32"},{"name":"payoffTermsHash","type":"bytes32"},{"name":"fixingSlotsHash","type":"bytes32"},{"name":"seriesVersion","type":"uint32"},{"name":"marketVersion","type":"uint32"},{"name":"instrumentVersion","type":"uint32"},{"name":"payoffModuleVersion","type":"uint32"},{"name":"settlementAssetVersion","type":"uint32"},{"name":"riskDomainVersion","type":"uint32"},{"name":"feeScheduleVersion","type":"uint32"},{"name":"ordinal","type":"uint32"},{"name":"fixingWindowOpen","type":"uint64"},{"name":"finalResolutionAt","type":"uint64"},{"name":"settlementDeadline","type":"uint64"},{"name":"maxEvaluationGas","type":"uint64"},{"name":"exerciseOpensAt","type":"uint64"},{"name":"exerciseCutoffAt","type":"uint64"},{"name":"exercisePolicyId","type":"bytes32"},{"name":"automaticExerciseThresholdMinor","type":"uint128"},{"name":"lots","type":"uint128"},{"name":"originalLots","type":"uint128"},{"name":"entryPriceTicks","type":"int128"},{"name":"maxLongDebitMinorPerLot","type":"uint128"},{"name":"maxShortDebitMinorPerLot","type":"uint128"},{"name":"maxLongDebitMinor","type":"uint128"},{"name":"maxShortDebitMinor","type":"uint128"},{"name":"terminalDisruptionTransferMinorPerLot","type":"int256"},{"name":"longLiabilityKey","type":"bytes32"},{"name":"shortLiabilityKey","type":"bytes32"},{"name":"longReservationId","type":"bytes32"},{"name":"shortReservationId","type":"bytes32"},{"name":"packageId","type":"bytes32"},{"name":"packageVersion","type":"uint32"},{"name":"packageOrdinal","type":"uint32"},{"name":"packageProvenanceHash","type":"bytes32"}]},{"name":"lifecycle","type":"tuple","components":[{"name":"status","type":"uint8"},{"name":"exerciseState","type":"uint8"},{"name":"finalFixingReference","type":"bytes32"},{"name":"finalFixingsHash","type":"bytes32"},{"name":"terminalOutcomeReference","type":"bytes32"},{"name":"terminalTransferMinor","type":"int256"},{"name":"remainingLots","type":"uint128"},{"name":"exercisedLots","type":"uint128"},{"name":"closedLots","type":"uint128"},{"name":"lifecycleOwnerAccountId","type":"bytes32"},{"name":"ownerNonce","type":"uint64"},{"name":"lifecycleNonce","type":"uint64"}]}],"stateMutability":"view"},
  {"type":"function","name":"payoffTerms","inputs":[{"name":"positionId","type":"bytes32"}],"outputs":[{"name":"","type":"bytes"}],"stateMutability":"view"},
  {"type":"event","name":"PositionExactPayoffComputed","inputs":[{"name":"positionId","type":"bytes32","indexed":true},{"name":"fixingReference","type":"bytes32","indexed":true},{"name":"finalFixingsHash","type":"bytes32","indexed":false},{"name":"evaluatedLots","type":"uint128","indexed":false},{"name":"terminalTransferMinor","type":"int256","indexed":false}],"anonymous":false},
  {"type":"event","name":"PositionStatusChanged","inputs":[{"name":"positionId","type":"bytes32","indexed":true},{"name":"previousStatus","type":"uint8","indexed":false},{"name":"newStatus","type":"uint8","indexed":false},{"name":"transitionReference","type":"bytes32","indexed":true},{"name":"caller","type":"address","indexed":false}],"anonymous":false},
] as const;

export const terminalClaimAbi = [
  {"type":"function","name":"terminalClaimStatusOf","inputs":[{"name":"claimId","type":"bytes32"}],"outputs":[{"name":"","type":"uint8"}],"stateMutability":"view"},
] as const;

export const exerciseWitnessAbi = [
  {"type":"function","name":"stageExerciseWitness","inputs":[{"name":"executionId","type":"bytes32"},{"name":"fixingReference","type":"bytes32"},{"name":"finalFixings","type":"bytes"}],"outputs":[],"stateMutability":"nonpayable"},
] as const;

export const payoffModuleAbi = [
  {"type":"function","name":"evaluatePositionLots","inputs":[{"name":"payoffTerms","type":"bytes"},{"name":"finalFixings","type":"bytes"},{"name":"lots","type":"uint128"}],"outputs":[{"name":"transferMinor","type":"int256"}],"stateMutability":"view"},
] as const;

export const settlementErrorsAbi = [
  {"type":"error","name":"ClaimSettlementMismatch","inputs":[{"name":"claimId","type":"bytes32"}]},
  {"type":"error","name":"DependencyGraphMismatch","inputs":[{"name":"expected","type":"address"},{"name":"actual","type":"address"}]},
  {"type":"error","name":"DependencyHasNoCode","inputs":[{"name":"dependency","type":"address"}]},
  {"type":"error","name":"EmptyFixingSlots","inputs":[]},
  {"type":"error","name":"ExistingPositionOutcomeMismatch","inputs":[]},
  {"type":"error","name":"FeeRequestLimitExceeded","inputs":[{"name":"actual","type":"uint256"},{"name":"maximum","type":"uint256"}]},
  {"type":"error","name":"FeeRequestOrderMismatch","inputs":[{"name":"index","type":"uint256"},{"name":"actionOrdinal","type":"uint32"}]},
  {"type":"error","name":"FeeRequestParentMismatch","inputs":[{"name":"index","type":"uint256"},{"name":"expected","type":"bytes32"},{"name":"actual","type":"bytes32"}]},
  {"type":"error","name":"FeeRequestScheduleMismatch","inputs":[{"name":"index","type":"uint256"}]},
  {"type":"error","name":"FixingNotFinalized","inputs":[{"name":"slot","type":"uint8"}]},
  {"type":"error","name":"FixingSlotOrderMismatch","inputs":[{"name":"index","type":"uint256"},{"name":"supplied","type":"uint8"}]},
  {"type":"error","name":"FixingSlotsMismatch","inputs":[{"name":"expected","type":"bytes32"},{"name":"actual","type":"bytes32"}]},
  {"type":"error","name":"InstrumentRecordMismatch","inputs":[]},
  {"type":"error","name":"InvalidDisruptionFixing","inputs":[{"name":"slot","type":"uint8"}]},
  {"type":"error","name":"InvalidKeeperReward","inputs":[{"name":"index","type":"uint256"}]},
  {"type":"error","name":"InvalidNormalFixingResolution","inputs":[{"name":"slot","type":"uint8"},{"name":"resolutionKind","type":"uint8"}]},
  {"type":"error","name":"InvalidPositionStatus","inputs":[{"name":"status","type":"uint8"}]},
  {"type":"error","name":"MarketRecordMismatch","inputs":[]},
  {"type":"error","name":"NormalSettlementClosed","inputs":[{"name":"finalResolutionAt","type":"uint64"},{"name":"currentTimestamp","type":"uint256"}]},
  {"type":"error","name":"HolderElectionPending","inputs":[{"name":"positionId","type":"bytes32"},{"name":"exerciseCutoffAt","type":"uint64"}]},
  {"type":"error","name":"PayoffTermsMismatch","inputs":[{"name":"expected","type":"bytes32"},{"name":"actual","type":"bytes32"}]},
  {"type":"error","name":"PositionAmountOverflow","inputs":[{"name":"perLot","type":"uint256"},{"name":"lots","type":"uint256"}]},
  {"type":"error","name":"PositionRecordMismatch","inputs":[{"name":"positionId","type":"bytes32"}]},
  {"type":"error","name":"ReentrancyGuardReentrantCall","inputs":[]},
  {"type":"error","name":"ReservationRecordMismatch","inputs":[]},
  {"type":"error","name":"SeriesRecordMismatch","inputs":[]},
  {"type":"error","name":"SettlementAlreadyRecorded","inputs":[{"name":"positionId","type":"bytes32"},{"name":"settlementId","type":"bytes32"}]},
  {"type":"error","name":"SettlementFeePayerMismatch","inputs":[{"name":"index","type":"uint256"}]},
  {"type":"error","name":"SettlementOutcomeMismatch","inputs":[]},
  {"type":"error","name":"TerminalAmountOutsideBounds","inputs":[{"name":"amount","type":"uint128"},{"name":"maximum","type":"uint128"}]},
  {"type":"error","name":"TerminalFallbackNotOpen","inputs":[{"name":"finalResolutionAt","type":"uint64"},{"name":"currentTimestamp","type":"uint256"}]},
  {"type":"error","name":"TerminalStateMismatch","inputs":[{"name":"liabilityKey","type":"bytes32"}]},
  {"type":"error","name":"TooManyFixingSlots","inputs":[{"name":"actual","type":"uint256"},{"name":"maximum","type":"uint256"}]},
  {"type":"error","name":"UnknownClaim","inputs":[{"name":"claimId","type":"bytes32"}]},
  {"type":"error","name":"UnknownPosition","inputs":[{"name":"positionId","type":"bytes32"}]},
  {"type":"error","name":"UnknownSettlement","inputs":[{"name":"settlementId","type":"bytes32"}]},
  {"type":"error","name":"UnsupportedSettlementFeeAction","inputs":[{"name":"index","type":"uint256"},{"name":"actionId","type":"bytes32"}]},
  {"type":"error","name":"ZeroDefinitionHash","inputs":[]},
  {"type":"error","name":"ZeroDependency","inputs":[{"name":"dependency","type":"address"}]},
  {"type":"error","name":"AccessControlBadConfirmation","inputs":[]},
  {"type":"error","name":"AccessControlEnforcedDefaultAdminDelay","inputs":[{"name":"schedule","type":"uint48"}]},
  {"type":"error","name":"AccessControlEnforcedDefaultAdminRules","inputs":[]},
  {"type":"error","name":"AccessControlInvalidDefaultAdmin","inputs":[{"name":"defaultAdmin","type":"address"}]},
  {"type":"error","name":"AccessControlUnauthorizedAccount","inputs":[{"name":"account","type":"address"},{"name":"neededRole","type":"bytes32"}]},
  {"type":"error","name":"ExactLotsCapabilityMismatch","inputs":[{"name":"implementation","type":"address"},{"name":"actualCapability","type":"bytes32"}]},
  {"type":"error","name":"FinalResolutionNotReached","inputs":[{"name":"positionId","type":"bytes32"},{"name":"finalResolutionAt","type":"uint64"},{"name":"nowTs","type":"uint64"}]},
  {"type":"error","name":"FinalResolutionReached","inputs":[{"name":"positionId","type":"bytes32"},{"name":"finalResolutionAt","type":"uint64"},{"name":"nowTs","type":"uint64"}]},
  {"type":"error","name":"FixingWindowNotOpen","inputs":[{"name":"positionId","type":"bytes32"},{"name":"opensAt","type":"uint64"},{"name":"nowTs","type":"uint64"}]},
  {"type":"error","name":"IdenticalPositionAccounts","inputs":[]},
  {"type":"error","name":"InvalidPayoffModuleReturn","inputs":[{"name":"selector","type":"bytes4"},{"name":"length","type":"uint256"}]},
  {"type":"error","name":"InvalidPositionQuantity","inputs":[{"name":"positionId","type":"bytes32"},{"name":"remaining","type":"uint128"},{"name":"requested","type":"uint128"}]},
  {"type":"error","name":"InvalidPositionTransition","inputs":[{"name":"positionId","type":"bytes32"},{"name":"current","type":"uint8"},{"name":"requested","type":"uint8"}]},
  {"type":"error","name":"LifecycleNonceMismatch","inputs":[{"name":"positionId","type":"bytes32"},{"name":"expected","type":"uint64"},{"name":"actual","type":"uint64"}]},
  {"type":"error","name":"LifecycleOwnerMismatch","inputs":[{"name":"positionId","type":"bytes32"},{"name":"expected","type":"bytes32"},{"name":"actual","type":"bytes32"}]},
  {"type":"error","name":"PayoffModuleCallFailed","inputs":[{"name":"selector","type":"bytes4"}]},
  {"type":"error","name":"PayoffModuleRuntimeMismatch","inputs":[{"name":"implementation","type":"address"},{"name":"expected","type":"bytes32"},{"name":"actual","type":"bytes32"}]},
  {"type":"error","name":"PayoffOutsideDebitBounds","inputs":[{"name":"transferMinorPerLot","type":"int256"},{"name":"maxLongDebit","type":"uint128"},{"name":"maxShortDebit","type":"uint128"}]},
  {"type":"error","name":"PayoffTermsHashMismatch","inputs":[{"name":"expected","type":"bytes32"},{"name":"actual","type":"bytes32"}]},
  {"type":"error","name":"PositionAlreadyExists","inputs":[{"name":"positionId","type":"bytes32"}]},
  {"type":"error","name":"PositionFundingMismatch","inputs":[{"name":"liabilityKey","type":"bytes32"},{"name":"lockId","type":"bytes32"}]},
  {"type":"error","name":"PositionRiskAccountMismatch","inputs":[{"name":"positionId","type":"bytes32"},{"name":"accountId","type":"bytes32"}]},
  {"type":"error","name":"PositionRiskLotsOverflow","inputs":[{"name":"positionId","type":"bytes32"},{"name":"lots","type":"uint128"}]},
  {"type":"error","name":"ReservationMismatch","inputs":[{"name":"liabilityKey","type":"bytes32"},{"name":"expectedReservationId","type":"bytes32"},{"name":"actualReservationId","type":"bytes32"}]},
  {"type":"error","name":"ReservationRecordMismatch","inputs":[{"name":"reservationId","type":"bytes32"}]},
  {"type":"error","name":"SafeCastOverflowedUintDowncast","inputs":[{"name":"bits","type":"uint8"},{"name":"value","type":"uint256"}]},
  {"type":"error","name":"SeriesClosedForNewRisk","inputs":[{"name":"seriesId","type":"bytes32"},{"name":"version","type":"uint32"}]},
  {"type":"error","name":"TerminalAmountOverflow","inputs":[{"name":"amount","type":"uint256"}]},
  {"type":"error","name":"UnauthorizedPositionFundingRequester","inputs":[{"name":"lockId","type":"bytes32"},{"name":"expected","type":"address"},{"name":"actual","type":"address"}]},
  {"type":"error","name":"UnexpectedPositionFunding","inputs":[{"name":"liabilityKey","type":"bytes32"},{"name":"lockId","type":"bytes32"}]},
  {"type":"error","name":"UnsupportedTerminalAlternative","inputs":[{"name":"status","type":"uint8"}]},
  {"type":"error","name":"ZeroAccount","inputs":[]},
  {"type":"error","name":"ZeroFillIdentity","inputs":[]},
  {"type":"error","name":"ZeroInitialAdmin","inputs":[]},
  {"type":"error","name":"ZeroLots","inputs":[]},
  {"type":"error","name":"ZeroReference","inputs":[]},
  {"type":"error","name":"CollateralReplacementMismatch","inputs":[{"name":"accountId","type":"bytes32"}]},
  {"type":"error","name":"ExerciseQuantityExceeded","inputs":[{"name":"positionId","type":"bytes32"},{"name":"remaining","type":"uint128"},{"name":"requested","type":"uint128"}]},
  {"type":"error","name":"ExerciseWindowClosed","inputs":[{"name":"positionId","type":"bytes32"},{"name":"opensAt","type":"uint64"},{"name":"closesAt","type":"uint64"},{"name":"currentTimestamp","type":"uint256"}]},
  {"type":"error","name":"InvalidActorSignature","inputs":[{"name":"actor","type":"address"}]},
  {"type":"error","name":"InvalidCollateralReplacement","inputs":[]},
  {"type":"error","name":"InvalidConsentSignature","inputs":[{"name":"accountId","type":"bytes32"},{"name":"signer","type":"address"}]},
  {"type":"error","name":"InvalidLifecycleAction","inputs":[]},
  {"type":"error","name":"InvalidLifecycleInput","inputs":[]},
  {"type":"error","name":"InvalidLifecyclePayload","inputs":[]},
  {"type":"error","name":"InvalidLifecycleShape","inputs":[]},
  {"type":"error","name":"InvalidLifecycleState","inputs":[{"name":"actionId","type":"bytes32"}]},
  {"type":"error","name":"InvalidLifecycleSuccessor","inputs":[]},
  {"type":"error","name":"LapseNotAvailable","inputs":[{"name":"positionId","type":"bytes32"},{"name":"lapseEligibleAt","type":"uint64"},{"name":"currentTimestamp","type":"uint256"}]},
  {"type":"error","name":"LiabilityToleranceExceeded","inputs":[{"name":"accountId","type":"bytes32"},{"name":"beforeAmount","type":"uint256"},{"name":"afterAmount","type":"uint256"},{"name":"tolerance","type":"uint256"}]},
  {"type":"error","name":"LifecycleDeadlinePassed","inputs":[{"name":"deadline","type":"uint64"},{"name":"currentTimestamp","type":"uint256"}]},
  {"type":"error","name":"MissingConsent","inputs":[{"name":"accountId","type":"bytes32"}]},
  {"type":"error","name":"NonceAlreadyUsed","inputs":[{"name":"accountId","type":"bytes32"},{"name":"nonce","type":"uint256"}]},
  {"type":"error","name":"PackageBreakNotAuthorized","inputs":[{"name":"accountId","type":"bytes32"}]},
  {"type":"error","name":"PositionActionIneligible","inputs":[{"name":"positionId","type":"bytes32"},{"name":"actionKind","type":"uint8"}]},
  {"type":"error","name":"PositionSnapshotMismatch","inputs":[{"name":"positionId","type":"bytes32"}]},
  {"type":"error","name":"QuantityNotConserved","inputs":[]},
  {"type":"error","name":"RiskDomainUnavailable","inputs":[{"name":"riskDomainId","type":"bytes32"},{"name":"version","type":"uint32"}]},
  {"type":"error","name":"UnauthorizedExecutor","inputs":[{"name":"required","type":"address"},{"name":"caller","type":"address"}]},
  {"type":"error","name":"UnknownLifecycleAction","inputs":[{"name":"actionId","type":"bytes32"}]},
  {"type":"error","name":"ZeroVerifyingContract","inputs":[]},
  {"type":"error","name":"AdapterCallFailed","inputs":[{"name":"selector","type":"bytes4"}]},
  {"type":"error","name":"AdapterCapabilityMismatch","inputs":[{"name":"expected","type":"bytes32"},{"name":"actual","type":"bytes32"}]},
  {"type":"error","name":"AdapterFeedKeyMismatch","inputs":[{"name":"expected","type":"bytes32"},{"name":"actual","type":"bytes32"}]},
  {"type":"error","name":"AdapterObservationHashMismatch","inputs":[{"name":"expected","type":"bytes32"},{"name":"actual","type":"bytes32"}]},
  {"type":"error","name":"AdapterRecordMismatch","inputs":[]},
  {"type":"error","name":"AdapterRuntimeMismatch","inputs":[]},
  {"type":"error","name":"BatchSequenceNotNewer","inputs":[{"name":"previous","type":"uint64"},{"name":"supplied","type":"uint64"}]},
  {"type":"error","name":"BenchmarkRecordMismatch","inputs":[{"name":"benchmarkId","type":"bytes32"},{"name":"version","type":"uint32"}]},
  {"type":"error","name":"BenchmarkRegistryHasNoCode","inputs":[{"name":"dependency","type":"address"}]},
  {"type":"error","name":"CandidateCannotReplaceProposal","inputs":[{"name":"currentCandidate","type":"uint8"},{"name":"suppliedCandidate","type":"uint8"}]},
  {"type":"error","name":"CandidateNotYetAvailable","inputs":[{"name":"candidateIndex","type":"uint8"},{"name":"availableAt","type":"uint64"},{"name":"currentTimestamp","type":"uint256"}]},
  {"type":"error","name":"CandidateObservationLimitUnsupported","inputs":[{"name":"requested","type":"uint16"},{"name":"maximum","type":"uint16"}]},
  {"type":"error","name":"CandidateSubmissionClosed","inputs":[{"name":"deadline","type":"uint64"},{"name":"currentTimestamp","type":"uint256"}]},
  {"type":"error","name":"CorrectionWindowClosed","inputs":[{"name":"correctionCutoffAt","type":"uint64"},{"name":"currentTimestamp","type":"uint256"}]},
  {"type":"error","name":"DuplicateFixingCandidate","inputs":[{"name":"slot","type":"uint8"},{"name":"first","type":"uint256"},{"name":"second","type":"uint256"}]},
  {"type":"error","name":"EmptyObservationBatch","inputs":[]},
  {"type":"error","name":"EvidenceNotOutageIndependent","inputs":[]},
  {"type":"error","name":"EvidenceTooLarge","inputs":[{"name":"actual","type":"uint256"},{"name":"maximum","type":"uint256"}]},
  {"type":"error","name":"FinalResolutionReached","inputs":[{"name":"finalResolutionAt","type":"uint64"},{"name":"currentTimestamp","type":"uint256"}]},
  {"type":"error","name":"FixingAlreadyFinalized","inputs":[{"name":"fixingKey","type":"bytes32"}]},
  {"type":"error","name":"FixingDisputedState","inputs":[{"name":"fixingKey","type":"bytes32"}]},
  {"type":"error","name":"FixingNotProposed","inputs":[{"name":"fixingKey","type":"bytes32"}]},
  {"type":"error","name":"FixingSlotsCommitmentMismatch","inputs":[{"name":"expected","type":"bytes32"},{"name":"actual","type":"bytes32"}]},
  {"type":"error","name":"FutureObservationPublication","inputs":[{"name":"index","type":"uint256"},{"name":"publishedAt","type":"uint64"},{"name":"currentTimestamp","type":"uint256"}]},
  {"type":"error","name":"IncompleteFixingVector","inputs":[{"name":"expected","type":"uint256"},{"name":"actual","type":"uint256"}]},
  {"type":"error","name":"IncompleteObservationSelection","inputs":[]},
  {"type":"error","name":"InvalidAdapterReturn","inputs":[{"name":"selector","type":"bytes4"},{"name":"length","type":"uint256"}]},
  {"type":"error","name":"InvalidFixingCandidate","inputs":[{"name":"slot","type":"uint8"},{"name":"candidate","type":"uint256"}]},
  {"type":"error","name":"InvalidFixingCandidateCount","inputs":[{"name":"slot","type":"uint8"},{"name":"count","type":"uint256"},{"name":"maximum","type":"uint256"}]},
  {"type":"error","name":"InvalidFixingSlotCount","inputs":[{"name":"count","type":"uint256"},{"name":"maximum","type":"uint256"}]},
  {"type":"error","name":"InvalidFixingSlotIndex","inputs":[{"name":"index","type":"uint256"},{"name":"actual","type":"uint8"}]},
  {"type":"error","name":"InvalidL2StateDuringSequencerOutage","inputs":[{"name":"index","type":"uint256"}]},
  {"type":"error","name":"InvalidObservationEvidence","inputs":[{"name":"index","type":"uint256"}]},
  {"type":"error","name":"InvalidSingleObservationRule","inputs":[{"name":"count","type":"uint256"}]},
  {"type":"error","name":"NonIncreasingObservationTime","inputs":[{"name":"index","type":"uint256"},{"name":"previous","type":"uint64"},{"name":"current","type":"uint64"}]},
  {"type":"error","name":"NormalFinalizationNotOpen","inputs":[{"name":"opensAt","type":"uint64"},{"name":"closesAt","type":"uint64"},{"name":"currentTimestamp","type":"uint256"}]},
  {"type":"error","name":"ObservationAfterTarget","inputs":[{"name":"observedAt","type":"uint64"},{"name":"targetAt","type":"uint64"}]},
  {"type":"error","name":"ObservationBeforeTarget","inputs":[{"name":"observedAt","type":"uint64"},{"name":"targetAt","type":"uint64"}]},
  {"type":"error","name":"ObservationConfidenceExceeded","inputs":[{"name":"index","type":"uint256"},{"name":"actual","type":"uint16"},{"name":"maximum","type":"uint16"}]},
  {"type":"error","name":"ObservationCountOutsideCandidate","inputs":[{"name":"actual","type":"uint256"},{"name":"minimum","type":"uint16"},{"name":"maximum","type":"uint16"}]},
  {"type":"error","name":"ObservationDecimalsMismatch","inputs":[{"name":"index","type":"uint256"},{"name":"expected","type":"uint8"},{"name":"actual","type":"uint8"}]},
  {"type":"error","name":"ObservationOutsideWindow","inputs":[{"name":"index","type":"uint256"},{"name":"observedAt","type":"uint64"},{"name":"startsAt","type":"uint64"},{"name":"endsAt","type":"uint64"}]},
  {"type":"error","name":"ObservationPublishedBeforeObserved","inputs":[{"name":"index","type":"uint256"},{"name":"observedAt","type":"uint64"},{"name":"publishedAt","type":"uint64"}]},
  {"type":"error","name":"ObservationTimesNotIncreasing","inputs":[{"name":"index","type":"uint256"},{"name":"previous","type":"uint64"},{"name":"current","type":"uint64"}]},
  {"type":"error","name":"ObservationWeightOverflow","inputs":[]},
  {"type":"error","name":"PublicationLagExceeded","inputs":[{"name":"index","type":"uint256"},{"name":"lag","type":"uint64"},{"name":"maximum","type":"uint32"}]},
  {"type":"error","name":"ReplayedProviderSequence","inputs":[{"name":"index","type":"uint256"},{"name":"previous","type":"uint64"},{"name":"current","type":"uint64"}]},
  {"type":"error","name":"SequencerRecoveryGraceActive","inputs":[{"name":"index","type":"uint256"},{"name":"graceEndsAt","type":"uint64"},{"name":"currentTimestamp","type":"uint256"}]},
  {"type":"error","name":"SeriesRecordMismatch","inputs":[{"name":"seriesId","type":"bytes32"},{"name":"version","type":"uint32"}]},
  {"type":"error","name":"SeriesRegistryHasNoCode","inputs":[{"name":"dependency","type":"address"}]},
  {"type":"error","name":"TimeWeightedMeanMustStartAtWindow","inputs":[{"name":"observedAt","type":"uint64"},{"name":"windowStartsAt","type":"uint64"}]},
  {"type":"error","name":"UnknownAdapterVersion","inputs":[]},
  {"type":"error","name":"UnknownBenchmarkVersion","inputs":[{"name":"benchmarkId","type":"bytes32"},{"name":"version","type":"uint32"}]},
  {"type":"error","name":"UnknownFixingCandidate","inputs":[{"name":"slot","type":"uint8"},{"name":"candidateIndex","type":"uint8"}]},
  {"type":"error","name":"UnknownFixingSlot","inputs":[{"name":"slot","type":"uint8"}]},
  {"type":"error","name":"UnknownSeriesVersion","inputs":[{"name":"seriesId","type":"bytes32"},{"name":"version","type":"uint32"}]},
  {"type":"error","name":"UnsupportedAdapterInterface","inputs":[{"name":"requiredInterfaceHash","type":"bytes32"}]},
  {"type":"error","name":"UnsupportedEvidenceOrigin","inputs":[{"name":"originId","type":"bytes32"}]},
  {"type":"error","name":"UnsupportedFixingAggregation","inputs":[{"name":"selectionRuleId","type":"bytes32"}]},
  {"type":"error","name":"UnsupportedFixingSelectionRule","inputs":[{"name":"slot","type":"uint8"},{"name":"candidate","type":"uint256"},{"name":"selectionRuleId","type":"bytes32"}]},
  {"type":"error","name":"UnsupportedFixingWindowKind","inputs":[{"name":"slot","type":"uint8"},{"name":"candidate","type":"uint256"}]},
  {"type":"error","name":"ZeroAdapterEvidenceCommitment","inputs":[]},
  {"type":"error","name":"ZeroBenchmarkRegistry","inputs":[]},
  {"type":"error","name":"ZeroObservationWeight","inputs":[{"name":"index","type":"uint256"}]},
  {"type":"error","name":"ZeroSeriesRegistry","inputs":[]},
  {"type":"error","name":"DefaultPositionMismatch","inputs":[{"name":"positionId","type":"bytes32"},{"name":"accountId","type":"bytes32"}]},
  {"type":"error","name":"DefaultResidualNotZero","inputs":[{"name":"residualMinor","type":"uint128"}]},
  {"type":"error","name":"ExecutionAlreadyConsumed","inputs":[{"name":"executionId","type":"bytes32"}]},
  {"type":"error","name":"ExerciseWitnessMismatch","inputs":[{"name":"executionId","type":"bytes32"}]},
  {"type":"error","name":"InputPositionMismatch","inputs":[{"name":"positionId","type":"bytes32"}]},
  {"type":"error","name":"InvalidCompressionInput","inputs":[]},
  {"type":"error","name":"InvalidCompressionSuccessor","inputs":[]},
  {"type":"error","name":"MissingSuccessorWitness","inputs":[{"name":"successorKey","type":"bytes32"}]},
  {"type":"error","name":"ReplacementCollateralMismatch","inputs":[{"name":"accountId","type":"bytes32"}]},
  {"type":"error","name":"SuccessorMismatch","inputs":[{"name":"successorKey","type":"bytes32"}]},
  {"type":"error","name":"UnauthorizedCaller","inputs":[{"name":"role","type":"bytes32"},{"name":"actual","type":"address"}]},
  {"type":"error","name":"UnsupportedLifecycleAction","inputs":[{"name":"kind","type":"uint8"}]},
  {"type":"error","name":"WitnessAlreadyStaged","inputs":[{"name":"witnessKey","type":"bytes32"}]},
  {"type":"error","name":"DependencyHasNoCode","inputs":[]},
  {"type":"error","name":"InvalidDependency","inputs":[]},
  {"type":"error","name":"InvalidExerciseConvention","inputs":[]},
  {"type":"error","name":"InvalidPackageBreak","inputs":[{"name":"expected","type":"bytes32"},{"name":"actual","type":"bytes32"}]},
  {"type":"error","name":"InvalidPolicyContext","inputs":[{"name":"expected","type":"bytes32"},{"name":"actual","type":"bytes32"}]},
  {"type":"error","name":"PositionBoundExceeded","inputs":[]},
  {"type":"error","name":"ZeroDependency","inputs":[]},
  {"type":"error","name":"AccountAlreadyExists","inputs":[{"name":"accountId","type":"bytes32"}]},
  {"type":"error","name":"AccountTerminalLiabilityCapExceeded","inputs":[{"name":"riskDomainId","type":"bytes32"},{"name":"version","type":"uint32"},{"name":"accountId","type":"bytes32"},{"name":"cap","type":"uint256"},{"name":"requested","type":"uint256"}]},
  {"type":"error","name":"AggregateTerminalLiabilityCapExceeded","inputs":[{"name":"riskDomainId","type":"bytes32"},{"name":"version","type":"uint32"},{"name":"cap","type":"uint256"},{"name":"requested","type":"uint256"}]},
  {"type":"error","name":"AmountAboveLockRemaining","inputs":[{"name":"lockId","type":"bytes32"},{"name":"remaining","type":"uint128"},{"name":"requested","type":"uint128"}]},
  {"type":"error","name":"AmountAboveTerminalLiabilityReservation","inputs":[{"name":"reservationId","type":"bytes32"},{"name":"remaining","type":"uint128"},{"name":"requested","type":"uint128"}]},
  {"type":"error","name":"BalanceOverflow","inputs":[{"name":"accountId","type":"bytes32"},{"name":"collateralId","type":"bytes32"},{"name":"current","type":"uint128"},{"name":"amount","type":"uint128"}]},
  {"type":"error","name":"BindingClosedForNewRisk","inputs":[{"name":"assetId","type":"bytes32"},{"name":"bindingVersion","type":"uint32"}]},
  {"type":"error","name":"ControllerUnchanged","inputs":[{"name":"accountId","type":"bytes32"},{"name":"controller","type":"address"}]},
  {"type":"error","name":"InexactDepositReceipt","inputs":[{"name":"token","type":"address"},{"name":"amount","type":"uint128"},{"name":"balanceBefore","type":"uint256"},{"name":"balanceAfter","type":"uint256"}]},
  {"type":"error","name":"InexactTransferSettlement","inputs":[{"name":"token","type":"address"},{"name":"recipient","type":"address"},{"name":"amount","type":"uint128"}]},
  {"type":"error","name":"InsufficientAvailable","inputs":[{"name":"accountId","type":"bytes32"},{"name":"collateralId","type":"bytes32"},{"name":"available","type":"uint128"},{"name":"requested","type":"uint128"}]},
  {"type":"error","name":"InsufficientExcess","inputs":[{"name":"token","type":"address"},{"name":"tokenBalance","type":"uint256"},{"name":"tokenLiability","type":"uint256"},{"name":"requested","type":"uint128"}]},
  {"type":"error","name":"InvalidLockExpiry","inputs":[{"name":"expiry","type":"uint64"},{"name":"nowTs","type":"uint64"},{"name":"maxExpiry","type":"uint256"}]},
  {"type":"error","name":"InvalidPositionDeadlines","inputs":[{"name":"settlementDeadline","type":"uint64"},{"name":"finalResolutionAt","type":"uint64"},{"name":"nowTs","type":"uint64"}]},
  {"type":"error","name":"InvalidTerminalLiabilityReplacement","inputs":[]},
  {"type":"error","name":"InvalidTerminalState","inputs":[{"name":"outcome","type":"uint8"},{"name":"receiverAccountId","type":"bytes32"},{"name":"amount","type":"uint128"}]},
  {"type":"error","name":"LockAlreadyExists","inputs":[{"name":"lockId","type":"bytes32"}]},
  {"type":"error","name":"LockExpired","inputs":[{"name":"lockId","type":"bytes32"},{"name":"expiry","type":"uint64"}]},
  {"type":"error","name":"LockNotActive","inputs":[{"name":"lockId","type":"bytes32"},{"name":"status","type":"uint8"}]},
  {"type":"error","name":"LockNotExpired","inputs":[{"name":"lockId","type":"bytes32"},{"name":"expiry","type":"uint64"}]},
  {"type":"error","name":"LockOperatorEpochExhausted","inputs":[{"name":"accountId","type":"bytes32"}]},
  {"type":"error","name":"LockOperatorNotApproved","inputs":[{"name":"accountId","type":"bytes32"},{"name":"operator","type":"address"}]},
  {"type":"error","name":"LockOperatorNotAuthorized","inputs":[{"name":"lockId","type":"bytes32"},{"name":"operator","type":"address"}]},
  {"type":"error","name":"NoPendingController","inputs":[{"name":"accountId","type":"bytes32"}]},
  {"type":"error","name":"NotAccountController","inputs":[{"name":"accountId","type":"bytes32"},{"name":"caller","type":"address"}]},
  {"type":"error","name":"NotLockOperator","inputs":[{"name":"lockId","type":"bytes32"},{"name":"caller","type":"address"}]},
  {"type":"error","name":"NotLockSettlementOperator","inputs":[{"name":"lockId","type":"bytes32"},{"name":"pinnedSettlementOperator","type":"address"},{"name":"caller","type":"address"}]},
  {"type":"error","name":"NotPendingController","inputs":[{"name":"accountId","type":"bytes32"},{"name":"caller","type":"address"}]},
  {"type":"error","name":"PositionAlreadyTerminal","inputs":[{"name":"positionId","type":"bytes32"},{"name":"outcome","type":"uint8"}]},
  {"type":"error","name":"PositionDeadlinesChanged","inputs":[{"name":"requiredSettlementDeadline","type":"uint64"},{"name":"actualSettlementDeadline","type":"uint64"},{"name":"requiredFinalResolutionAt","type":"uint64"},{"name":"actualFinalResolutionAt","type":"uint64"}]},
  {"type":"error","name":"PositionEngineCodeChanged","inputs":[{"name":"positionEngine","type":"address"},{"name":"required","type":"bytes32"},{"name":"actual","type":"bytes32"}]},
  {"type":"error","name":"PositionEngineHasNoCode","inputs":[{"name":"positionEngine","type":"address"}]},
  {"type":"error","name":"PositionEngineIdentityChanged","inputs":[{"name":"positionEngine","type":"address"},{"name":"required","type":"bytes32"},{"name":"actual","type":"bytes32"}]},
  {"type":"error","name":"PositionEngineInterfaceVersionMismatch","inputs":[{"name":"positionEngine","type":"address"},{"name":"required","type":"uint32"},{"name":"actual","type":"uint32"}]},
  {"type":"error","name":"PositionEngineNotAuthorized","inputs":[{"name":"positionEngine","type":"address"}]},
  {"type":"error","name":"PositionNotTerminal","inputs":[{"name":"positionId","type":"bytes32"}]},
  {"type":"error","name":"PositionStateMismatch","inputs":[{"name":"requiredPositionId","type":"bytes32"},{"name":"actualPositionId","type":"bytes32"}]},
  {"type":"error","name":"RiskDomainCollateralMismatch","inputs":[{"name":"riskDomainId","type":"bytes32"},{"name":"version","type":"uint32"},{"name":"expectedAssetId","type":"bytes32"},{"name":"expectedBindingVersion","type":"uint32"},{"name":"actualAssetId","type":"bytes32"},{"name":"actualBindingVersion","type":"uint32"}]},
  {"type":"error","name":"RiskDomainNotOpenForNewRisk","inputs":[{"name":"riskDomainId","type":"bytes32"},{"name":"version","type":"uint32"}]},
  {"type":"error","name":"RiskDomainRegistryHasNoCode","inputs":[{"name":"riskDomainRegistry","type":"address"}]},
  {"type":"error","name":"RiskDomainSettlementRegistryMismatch","inputs":[{"name":"expected","type":"address"},{"name":"actual","type":"address"}]},
  {"type":"error","name":"SafeERC20FailedOperation","inputs":[{"name":"token","type":"address"}]},
  {"type":"error","name":"SelfConsumption","inputs":[{"name":"accountId","type":"bytes32"}]},
  {"type":"error","name":"SelfTransfer","inputs":[{"name":"accountId","type":"bytes32"}]},
  {"type":"error","name":"SettlementAssetRegistryHasNoCode","inputs":[{"name":"settlementAssetRegistry","type":"address"}]},
  {"type":"error","name":"SettlementOperatorNotAuthorized","inputs":[{"name":"settlementOperator","type":"address"}]},
  {"type":"error","name":"TerminalClaimAlreadyExists","inputs":[{"name":"claimId","type":"bytes32"}]},
  {"type":"error","name":"TerminalClaimFallbackNotReached","inputs":[{"name":"finalResolutionAt","type":"uint64"},{"name":"nowTs","type":"uint64"}]},
  {"type":"error","name":"TerminalClaimNotActive","inputs":[{"name":"claimId","type":"bytes32"},{"name":"status","type":"uint8"}]},
  {"type":"error","name":"TerminalLiabilityReservationAlreadyExists","inputs":[{"name":"reservationId","type":"bytes32"}]},
  {"type":"error","name":"TerminalLiabilityReservationNotActive","inputs":[{"name":"reservationId","type":"bytes32"},{"name":"status","type":"uint8"}]},
  {"type":"error","name":"TerminalReservationsDisabled","inputs":[{"name":"riskDomainId","type":"bytes32"},{"name":"version","type":"uint32"}]},
  {"type":"error","name":"UnknownAccount","inputs":[{"name":"accountId","type":"bytes32"}]},
  {"type":"error","name":"UnknownBindingVersion","inputs":[{"name":"assetId","type":"bytes32"},{"name":"bindingVersion","type":"uint32"}]},
  {"type":"error","name":"UnknownLock","inputs":[{"name":"lockId","type":"bytes32"}]},
  {"type":"error","name":"UnknownTerminalClaim","inputs":[{"name":"claimId","type":"bytes32"}]},
  {"type":"error","name":"UnknownTerminalLiabilityReservation","inputs":[{"name":"reservationId","type":"bytes32"}]},
  {"type":"error","name":"VaultRecipient","inputs":[]},
  {"type":"error","name":"ZeroAmount","inputs":[]},
  {"type":"error","name":"ZeroController","inputs":[]},
  {"type":"error","name":"ZeroLockOperator","inputs":[]},
  {"type":"error","name":"ZeroLockReference","inputs":[]},
  {"type":"error","name":"ZeroMaxLockDuration","inputs":[]},
  {"type":"error","name":"ZeroPositionEngineId","inputs":[{"name":"positionEngine","type":"address"}]},
  {"type":"error","name":"ZeroPositionId","inputs":[]},
  {"type":"error","name":"ZeroRecipient","inputs":[]},
  {"type":"error","name":"ZeroRiskDomainId","inputs":[]},
  {"type":"error","name":"ZeroRiskDomainRegistry","inputs":[]},
  {"type":"error","name":"ZeroRiskDomainVersion","inputs":[]},
  {"type":"error","name":"ZeroSettlementAssetRegistry","inputs":[]},
  {"type":"error","name":"ZeroSettlementOperator","inputs":[]},
] as const;

