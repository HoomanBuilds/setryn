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

export const privateRfqRequestTypedData = { PrivateRfqRequest: privateRfqRequestComponents } as const;
export const makerQuoteTypedData = { MakerQuote: makerQuoteComponents } as const;
export const rfqSelectionTypedData = { RfqSelectionAuthorization: rfqSelectionComponents } as const;

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
