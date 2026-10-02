import { encodeAbiParameters, keccak256, stringToHex, type Address, type Hex } from "viem";
import { publicOrderComponents } from "@/lib/internal-gateway/protocol";

/*
 * The onchain vocabulary of firm-quote settlement (contracts/src/quote/QuoteSettlementRouter.sol and the signature path
 * of RiskAdmissionBindingRegistry): the router's ABI, the two EIP-712 messages a maker or taker signs besides the public
 * order itself, and the router-side terms hashes their risk authorizations commit to. Shared by the server quote engine,
 * the relayer and the browser, so every party hashes exactly what the contracts hash.
 */

export const ZERO_HASH = `0x${"0".repeat(64)}` as Hex;
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;

/** RiskAdmissionBindingRegistry's authorization: a signer's consent to bind one bounded admission to one order. */
export interface OrderRiskAuthorization {
  orderHash: Hex;
  accountId: Hex;
  riskDomainId: Hex;
  riskDomainVersion: number;
  maxOpenInterestBaseUnits: bigint;
  maxTerminalLiabilityBaseUnits: bigint;
  maxAdmissionDeadline: bigint;
  binder: Address;
  binderTerms: Hex;
  nonce: bigint;
  deadline: bigint;
}

export interface QuoteCapacityTerms {
  maker: Address;
  makerAccountId: Hex;
  seriesId: Hex;
  seriesVersion: number;
  maximumLiability: bigint;
  liabilityPerLot: bigint;
  maximumAbsoluteInventoryLots: bigint;
  expiry: bigint;
  nonce: bigint;
}

export interface TakerSettlementTerms {
  quoteOrderHash: Hex;
  relayer: Address;
  relayerAccountId: Hex;
  maxRelayerFeeMinor: bigint;
}

const riskAuthorizationComponents = [
  { name: "orderHash", type: "bytes32" },
  { name: "accountId", type: "bytes32" },
  { name: "riskDomainId", type: "bytes32" },
  { name: "riskDomainVersion", type: "uint32" },
  { name: "maxOpenInterestBaseUnits", type: "uint128" },
  { name: "maxTerminalLiabilityBaseUnits", type: "uint128" },
  { name: "maxAdmissionDeadline", type: "uint64" },
  { name: "binder", type: "address" },
  { name: "binderTerms", type: "bytes32" },
  { name: "nonce", type: "uint256" },
  { name: "deadline", type: "uint64" },
] as const;

const capacityTermsComponents = [
  { name: "maker", type: "address" },
  { name: "makerAccountId", type: "bytes32" },
  { name: "seriesId", type: "bytes32" },
  { name: "seriesVersion", type: "uint32" },
  { name: "maximumLiability", type: "uint128" },
  { name: "liabilityPerLot", type: "uint128" },
  { name: "maximumAbsoluteInventoryLots", type: "uint128" },
  { name: "expiry", type: "uint64" },
  { name: "nonce", type: "uint256" },
] as const;

/** EIP-712 types; the primary type names are the contracts' typestring names, so the type hashes agree. */
export const orderRiskAuthorizationTypes = { SetrynOrderRiskAuthorizationV1: riskAuthorizationComponents } as const;
export const quoteCapacityTypes = { SetrynQuoteCapacityV1: capacityTermsComponents } as const;

export function setrynDomain(chainId: number, verifyingContract: Address) {
  return { name: "Setryn", version: "1", chainId, verifyingContract } as const;
}

const MAKER_QUOTE_TERMS_TYPEHASH = keccak256(stringToHex("SetrynMakerQuoteTermsV1(bytes32 capacityId)"));
const TAKER_SETTLEMENT_TERMS_TYPEHASH = keccak256(
  stringToHex("SetrynTakerSettlementTermsV1(bytes32 quoteOrderHash,address relayer,bytes32 relayerAccountId,uint128 maxRelayerFeeMinor)"),
);

/** QuoteSettlementRouter.hashMakerQuoteTerms: the maker risk authorization's `binderTerms`. */
export function makerQuoteTermsHash(capacityId: Hex): Hex {
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [MAKER_QUOTE_TERMS_TYPEHASH, capacityId]));
}

/** QuoteSettlementRouter.hashTakerSettlementTerms: the taker risk authorization's `binderTerms`. */
export function takerSettlementTermsHash(terms: TakerSettlementTerms): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "address" }, { type: "bytes32" }, { type: "uint128" }],
      [TAKER_SETTLEMENT_TERMS_TYPEHASH, terms.quoteOrderHash, terms.relayer, terms.relayerAccountId, terms.maxRelayerFeeMinor],
    ),
  );
}

const makerTermsComponents = [{ name: "capacityId", type: "bytes32" }] as const;
const takerTermsComponents = [
  { name: "quoteOrderHash", type: "bytes32" },
  { name: "relayer", type: "address" },
  { name: "relayerAccountId", type: "bytes32" },
  { name: "maxRelayerFeeMinor", type: "uint128" },
] as const;

const signedMakerQuoteComponents = [
  { name: "order", type: "tuple", components: publicOrderComponents },
  { name: "orderSignature", type: "bytes" },
  { name: "risk", type: "tuple", components: riskAuthorizationComponents },
  { name: "riskSignature", type: "bytes" },
  { name: "terms", type: "tuple", components: makerTermsComponents },
] as const;

const signedTakerOrderComponents = [
  { name: "order", type: "tuple", components: publicOrderComponents },
  { name: "orderSignature", type: "bytes" },
  { name: "risk", type: "tuple", components: riskAuthorizationComponents },
  { name: "riskSignature", type: "bytes" },
  { name: "terms", type: "tuple", components: takerTermsComponents },
] as const;

const settlementComponents = [
  { name: "quote", type: "tuple", components: signedMakerQuoteComponents },
  { name: "taker", type: "tuple", components: signedTakerOrderComponents },
  { name: "fillLots", type: "uint128" },
  { name: "relayerFeeMinor", type: "uint128" },
  { name: "payoffTerms", type: "bytes" },
] as const;

const capacityRecordComponents = [
  { name: "maker", type: "address" },
  { name: "makerAccountId", type: "bytes32" },
  { name: "seriesId", type: "bytes32" },
  { name: "seriesVersion", type: "uint32" },
  { name: "liabilityPerLot", type: "uint128" },
  { name: "expiry", type: "uint64" },
] as const;

const receiptComponents = [
  { name: "fillId", type: "bytes32" },
  { name: "quoteOrderHash", type: "bytes32" },
  { name: "takerOrderHash", type: "bytes32" },
  { name: "maker", type: "address" },
  { name: "taker", type: "address" },
  { name: "makerAccountId", type: "bytes32" },
  { name: "takerAccountId", type: "bytes32" },
  { name: "seriesId", type: "bytes32" },
  { name: "seriesVersion", type: "uint32" },
  { name: "makerSide", type: "uint8" },
  { name: "fillLots", type: "uint128" },
  { name: "executionPriceTicks", type: "int128" },
  { name: "capacityId", type: "bytes32" },
  { name: "capacitySequence", type: "uint64" },
  { name: "capacityLiabilityConsumed", type: "uint128" },
  { name: "makerAdmissionId", type: "bytes32" },
  { name: "takerAdmissionId", type: "bytes32" },
  { name: "submitter", type: "address" },
  { name: "relayerAccountId", type: "bytes32" },
  { name: "relayerFeeMinor", type: "uint128" },
] as const;

const errors = [
  ["ZeroDependency", [{ name: "dependency", type: "address" }]],
  ["DependencyGraphMismatch", [{ name: "expected", type: "address" }, { name: "actual", type: "address" }]],
  ["InvalidCapacityTerms", []],
  ["InvalidCapacitySignature", []],
  ["CapacityNonceUsed", [{ name: "maker", type: "address" }, { name: "nonce", type: "uint256" }]],
  ["UnknownQuoteCapacity", [{ name: "capacityId", type: "bytes32" }]],
  ["UnauthorizedCapacityClose", [{ name: "maker", type: "address" }, { name: "caller", type: "address" }]],
  ["QuoteCapacityMismatch", [{ name: "capacityId", type: "bytes32" }]],
  ["InvalidQuoteSettlement", []],
  ["QuoteAlreadyConsumed", [{ name: "quoteOrderHash", type: "bytes32" }]],
  ["QuoteNotAccepted", [{ name: "expected", type: "bytes32" }, { name: "actual", type: "bytes32" }]],
  ["SelfTrade", [{ name: "accountId", type: "bytes32" }]],
  ["PriceNotCrossed", [{ name: "takerLimit", type: "int128" }, { name: "quotePrice", type: "int128" }]],
  ["RelayerNotAuthorized", [{ name: "expected", type: "address" }, { name: "actual", type: "address" }]],
  ["RelayerFeeAboveMaximum", [{ name: "maximum", type: "uint128" }, { name: "charged", type: "uint128" }]],
  ["RelayerAccountMismatch", [{ name: "relayerAccountId", type: "bytes32" }]],
  ["SettlementFillMismatch", [{ name: "expected", type: "bytes32" }, { name: "actual", type: "bytes32" }]],
  // Raised beneath the router by the binding registry, the capacity manager and the order state.
  ["InvalidRiskAuthorization", []],
  ["RiskAuthorizationNonceUsed", [{ name: "signer", type: "address" }, { name: "nonce", type: "uint256" }]],
  ["DuplicateRiskBinding", []],
  ["CapacityExceeded", [{ name: "remaining", type: "uint128" }, { name: "requested", type: "uint128" }]],
  ["InventoryExceeded", [{ name: "inventoryAfter", type: "int128" }, { name: "maximum", type: "uint128" }]],
  ["OrderAlreadyRegistered", [{ name: "orderHash", type: "bytes32" }]],
  ["InvalidOrderSignature", [{ name: "signer", type: "address" }, { name: "orderHash", type: "bytes32" }]],
  ["InvalidOrderDeadline", [{ name: "deadline", type: "uint64" }, { name: "currentTimestamp", type: "uint256" }]],
  ["InsufficientMargin", [{ name: "available", type: "uint128" }, { name: "required", type: "uint128" }]],
] as const;

export const quoteSettlementRouterAbi = [
  {
    type: "function",
    name: "settle",
    stateMutability: "nonpayable",
    inputs: [{ name: "settlement", type: "tuple", components: settlementComponents }],
    outputs: [{ name: "fillId", type: "bytes32" }],
  },
  {
    type: "function",
    name: "openQuoteCapacity",
    stateMutability: "nonpayable",
    inputs: [
      { name: "terms", type: "tuple", components: capacityTermsComponents },
      { name: "signature", type: "bytes" },
    ],
    outputs: [{ name: "capacityId", type: "bytes32" }],
  },
  {
    type: "function",
    name: "closeQuoteCapacity",
    stateMutability: "nonpayable",
    inputs: [{ name: "capacityId", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "quoteCapacity",
    stateMutability: "view",
    inputs: [{ name: "capacityId", type: "bytes32" }],
    outputs: [{ name: "record", type: "tuple", components: capacityRecordComponents }],
  },
  {
    type: "function",
    name: "deriveCapacityId",
    stateMutability: "view",
    inputs: [{ name: "terms", type: "tuple", components: capacityTermsComponents }],
    outputs: [{ name: "capacityId", type: "bytes32" }],
  },
  {
    type: "event",
    name: "QuoteCapacityOpened",
    inputs: [
      { name: "capacityId", type: "bytes32", indexed: true },
      { name: "maker", type: "address", indexed: true },
      { name: "makerAccountId", type: "bytes32", indexed: true },
      { name: "seriesId", type: "bytes32", indexed: false },
      { name: "seriesVersion", type: "uint32", indexed: false },
      { name: "maximumLiability", type: "uint128", indexed: false },
      { name: "liabilityPerLot", type: "uint128", indexed: false },
      { name: "maximumAbsoluteInventoryLots", type: "uint128", indexed: false },
      { name: "expiry", type: "uint64", indexed: false },
      { name: "nonce", type: "uint256", indexed: false },
      { name: "submitter", type: "address", indexed: false },
    ],
  },
  {
    type: "event",
    name: "QuoteCapacityClosed",
    inputs: [
      { name: "capacityId", type: "bytes32", indexed: true },
      { name: "maker", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "QuoteSettled",
    inputs: [
      { name: "fillId", type: "bytes32", indexed: true },
      { name: "quoteOrderHash", type: "bytes32", indexed: true },
      { name: "takerOrderHash", type: "bytes32", indexed: true },
      { name: "receipt", type: "tuple", indexed: false, components: receiptComponents },
    ],
  },
  ...errors.map(([name, inputs]) => ({ type: "error" as const, name, inputs })),
] as const;

const managedCapacityComponents = [
  { name: "owner", type: "address" },
  { name: "accountId", type: "bytes32" },
  { name: "collateralAssetId", type: "bytes32" },
  { name: "collateralId", type: "bytes32" },
  { name: "riskDomainId", type: "bytes32" },
  { name: "lockId", type: "bytes32" },
  { name: "lockReference", type: "bytes32" },
  { name: "collateralBindingVersion", type: "uint32" },
  { name: "riskDomainVersion", type: "uint32" },
  { name: "expiry", type: "uint64" },
  { name: "status", type: "uint8" },
  { name: "initialLiability", type: "uint128" },
  { name: "remainingLiability", type: "uint128" },
] as const;

export const streamCapacityManagerAbi = [
  {
    type: "function",
    name: "getStreamCapacity",
    stateMutability: "view",
    inputs: [{ name: "streamId", type: "bytes32" }],
    outputs: [
      {
        name: "state",
        type: "tuple",
        components: [
          { name: "capacity", type: "tuple", components: managedCapacityComponents },
          { name: "streamId", type: "bytes32" },
          { name: "consumedSequence", type: "uint64" },
          { name: "inventoryLots", type: "int128" },
        ],
      },
    ],
  },
] as const;

/** ManagedCapacityStatus.Active: the only status a quote may draw on. */
export const CAPACITY_ACTIVE = 1;

export const riskBindingAuthorizationAbi = [
  {
    type: "function",
    name: "authorizationNonceUsed",
    stateMutability: "view",
    inputs: [
      { name: "signer", type: "address" },
      { name: "nonce", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "invalidateAuthorizationNonce",
    stateMutability: "nonpayable",
    inputs: [{ name: "nonce", type: "uint256" }],
    outputs: [],
  },
] as const;
