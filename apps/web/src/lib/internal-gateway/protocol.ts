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
