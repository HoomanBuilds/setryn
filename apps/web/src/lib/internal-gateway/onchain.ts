import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  custom,
  encodeAbiParameters,
  formatUnits,
  getAddress,
  http,
  isAddress,
  hashTypedData,
  keccak256,
  maxUint256,
  parseUnits,
  parseEventLogs,
  parseAbi,
  stringToHex,
  type Address,
  type EIP1193Provider,
  type Hex,
  type Log,
} from "viem";
import { executableAction, limitCrosses } from "@/lib/terminal/economics";
import { platformNow, setChainClockOffset } from "@/lib/terminal/clock";
import { formatLotCount } from "@/lib/terminal/format";
import { parseRiskAuthorization, quoteExecutable, type FirmQuote } from "@/lib/quotes/firm-quote";
import {
  orderRiskAuthorizationTypes,
  quoteSettlementRouterAbi,
  setrynDomain,
  takerSettlementTermsHash,
  ZERO_ADDRESS,
  type OrderRiskAuthorization,
  type TakerSettlementTerms,
} from "@/lib/quotes/protocol";
import { serializeQuoteSettlement, type QuoteSettlementArgs } from "@/lib/quotes/settlement";
import {
  accountFeesPaidMinor,
  cashSettlementAbi,
  fixingEngineAbi,
  orderStateAbi,
  parsePublicOrder,
  payoffModuleAbi,
  positionTerminalAbi,
  seriesRegistryAbi,
  settlementErrorsAbi,
  terminalClaimAbi,
  atomicClearingAbi,
  fundedFeeLedgerAbi,
  privateRfqBookAbi,
  privateRfqRequestTypedData,
  publicOrderBookAbi,
  publicOrderTypedData,
  rfqSelectionTypedData,
  riskBindingAbi,
  riskEngineAbi,
  serializePublicOrder,
  type OnchainPublicOrder,
  type OnchainPrivateRfqRequest,
  type OnchainRfqSelection,
} from "./protocol";
import { loadSetrynRuntime, type SetrynNetwork, type SetrynRuntime, type SetrynRuntimeMarket } from "./runtime";
import { networkChain, networkEnvironment, networkForChainId, publicNetwork } from "./network";
import { marketTradingVersions, readActiveFeeSchedule, type ActiveFeeSchedule } from "./fee-schedule";
import {
  considerationPerPriceUnit,
  deriveSeriesBookId,
  marketEconomics,
  marketPriceDecimals,
  priceOffset,
  priceToTicks,
  runtimeMarketByKey,
  runtimeMarketBySeries,
  ticksToPrice,
} from "./runtime-markets";
import type { BookRow } from "@/lib/terminal/types";
import type {
  CollateralIntent,
  CollateralIntentResult,
  ExecutionReceipt,
  GatewaySnapshot,
  InternalTradingGateway,
  LifecycleActionKey,
  LifecycleActionResult,
  OnchainMarket,
  OnchainPositionLifecycle,
  OnchainSettlementRecord,
  PositionLifecyclePhase,
  LocalMakerQuoteInput,
  PackageExecutionResult,
  PackageOrderIntent,
  RestingPackageOrder,
  RfqRequest,
  SignedOrderAuthorization,
  SubmissionUpdate,
  TreasuryWithdrawal,
  TreasuryWithdrawalResult,
  WalletControls,
  WalletSession,
} from "./types";

const ACCOUNT_SALT = keccak256(stringToHex("SETRYN_PRIMARY_ACCOUNT_V1"));
const EMPTY_ID = `0x${"0".repeat(64)}` as Hex;
const CONSIDERATION_ENTRY = 1;
/** Settlement collateral on every network: Circle USDC, and the local chain's test token, which mirrors it. */
const COLLATERAL_ASSET = "USDC";
/** Every network admits risk through the fully collateralized adapter: margin is the bounded terminal liability. */
const RISK_DOMAIN_LABEL = "Fully collateralized";
/** How long the operator status (which roles can sign) is trusted before it is read again. */
const OPERATOR_STATUS_TTL_MS = 60_000;

/** What the platform's own roles can do on this deployment, from /api/internal/operator/status. */
interface OperatorStatus {
  /** A designated maker rests quotes, answers RFQs and consents to exits. */
  makerEnabled: boolean;
  makerAddress: Address | null;
}

interface LedgerFlow {
  args: { fillId?: Hex; kind?: number; payerAccountId?: Hex; receiverAccountId?: Hex; amount?: bigint };
}

/** Consideration the account received minus what it paid on one fill, in USD, read from the clearing ledger. */
function netConsiderationUsd(events: readonly LedgerFlow[], fillId: string, accountId: string): number {
  let net = BigInt(0);
  for (const { args } of events) {
    if (args.fillId?.toLowerCase() !== fillId.toLowerCase() || args.kind !== CONSIDERATION_ENTRY || args.amount == null) continue;
    if (args.receiverAccountId?.toLowerCase() === accountId.toLowerCase()) net += args.amount;
    if (args.payerAccountId?.toLowerCase() === accountId.toLowerCase()) net -= args.amount;
  }
  return Number(formatUnits(net, 6));
}
/** Seconds a maker order must remain live past the latest block so it cannot expire before the match lands. */
const MAKER_DEADLINE_MARGIN_SECONDS = BigInt(15);
const PUBLIC_SERIES_POLICY = keccak256(stringToHex("SETRYN_POLICY_PUBLIC_SERIES_V1"));

/** Formats a fill price on the market's own decimal grid. */
function formatTicksPrice(market: SetrynRuntimeMarket, price: number): string {
  return price.toFixed(marketPriceDecimals(market));
}

function runtimeNetwork(setryn: SetrynRuntime): SetrynNetwork {
  return setryn.network ?? networkForChainId(setryn.chainId) ?? "local";
}

/** Collateral a filled position locks: the series' terminal debit bound on the position's side. */
function positionCollateral(market: SetrynRuntimeMarket, side: "LONG" | "SHORT", lots: number): number {
  return (lots * (side === "LONG" ? market.maxLongDebitMinorPerLot : market.maxShortDebitMinorPerLot)) / 1_000_000;
}

const lifecycleInputStruct = "struct LifecycleInput { bytes32 positionId; bytes32 expectedImmutableHash; bytes32 expectedLifecycleHash; uint128 expectedPositionLots; uint128 actionLots; }";
const lifecycleSuccessorStruct = "struct LifecycleSuccessor { bytes32 successorKey; bytes32 seriesId; uint32 seriesVersion; bytes32 longAccountId; bytes32 shortAccountId; bytes32 riskDomainId; uint32 riskDomainVersion; bytes32 collateralId; uint128 lots; int128 entryPriceTicks; bytes32 economicsHash; bytes32 packageProvenanceHash; uint128 longTerminalLiabilityBaseUnits; uint128 shortTerminalLiabilityBaseUnits; }";
const lifecycleReplacementStruct = "struct LifecycleCollateralReplacement { bytes32 accountId; bytes32 collateralId; uint128 terminalLiabilityBaseUnits; }";
const lifecycleConsentStruct = "struct LifecycleConsent { bytes32 actionId; bytes32 accountId; address signer; uint256 nonce; uint64 deadline; uint128 maximumLiabilityIncreaseBaseUnits; uint128 maximumCollateralIncreaseBaseUnits; bool allowsPackageBreak; bytes32 salt; }";
const lifecycleActionStruct = "struct LifecycleAction { uint8 kind; address actor; bytes32 actorAccountId; bytes32 policyContextHash; bytes32 inputsHash; bytes32 successorsHash; bytes32 collateralReplacementsHash; bytes32 participantSetHash; bytes32 consentsHash; bytes32 riskDomainId; uint32 riskDomainVersion; bytes32 feeScheduleId; uint32 feeScheduleVersion; bytes32 economicTransitionHash; bytes32 compressionPlanId; bool breaksPackageProvenance; bytes32 packageBreakPermissionHash; uint128 actorMaximumLiabilityIncreaseBaseUnits; uint128 actorMaximumCollateralIncreaseBaseUnits; uint16 inputCount; uint16 successorCount; uint16 participantCount; uint64 deadline; uint256 nonce; address permittedExecutor; bytes32 salt; }";
const lifecycleSnapshotStruct = "struct LifecyclePositionSnapshot { bytes32 positionId; bytes32 immutableHash; bytes32 lifecycleHash; bytes32 seriesId; uint32 seriesVersion; bytes32 longAccountId; bytes32 shortAccountId; bytes32 riskDomainId; uint32 riskDomainVersion; bytes32 feeScheduleId; uint32 feeScheduleVersion; bytes32 collateralId; uint128 positionLots; uint128 remainingExerciseLots; int128 entryPriceTicks; bytes32 economicsHash; bytes32 packageProvenanceHash; bytes32 exercisePolicyId; uint8 exerciseState; uint128 automaticExerciseThresholdMinor; uint64 expiryAt; uint64 exerciseOpensAt; uint64 exerciseCutoffAt; uint64 lapseEligibleAt; uint128 longTerminalLiabilityBaseUnits; uint128 shortTerminalLiabilityBaseUnits; }";

const positionLifecycleAbi = parseAbi([
  lifecycleSnapshotStruct,
  "function getLifecyclePosition(bytes32 positionId) view returns (LifecyclePositionSnapshot snapshot)",
  "function positionStatus(bytes32 positionId) view returns (uint8)",
  "event PositionQuantityChanged(bytes32 indexed positionId, uint128 remainingLots, uint128 exercisedLots, uint128 closedLots, uint64 lifecycleNonce, bytes32 indexed transitionReference)",
]);
const lifecyclePolicyAbi = parseAbi([
  lifecycleActionStruct,
  lifecycleSnapshotStruct,
  lifecycleSuccessorStruct,
  "function derivePolicyContext(LifecycleAction action, LifecyclePositionSnapshot[] inputs, LifecycleSuccessor[] successors) view returns (bytes32 policyContextHash, bytes32 packageBreakPermissionHash)",
]);
const signedLifecycleAbi = parseAbi([
  lifecycleActionStruct,
  lifecycleInputStruct,
  lifecycleSuccessorStruct,
  lifecycleReplacementStruct,
  lifecycleConsentStruct,
  "function hashLifecycleInputs(LifecycleInput[] inputs) pure returns (bytes32)",
  "function hashLifecycleSuccessors(LifecycleSuccessor[] successors) pure returns (bytes32)",
  "function hashLifecycleCollateralReplacements(LifecycleCollateralReplacement[] replacements) pure returns (bytes32)",
  "function hashLifecycleParticipantSet(bytes32 actorAccountId, LifecycleConsent[] consents) pure returns (bytes32)",
  "function hashLifecycleConsentTerms(LifecycleConsent[] consents) pure returns (bytes32)",
  "function hashLifecycleAction(LifecycleAction action) view returns (bytes32 actionHash, bytes32 actionId, bytes32 digest)",
  "function authorizeAction(LifecycleAction action, LifecycleInput[] inputs, LifecycleSuccessor[] successors, LifecycleCollateralReplacement[] collateralReplacements, LifecycleConsent[] consents, bytes[] consentSignatures, bytes actorSignature) returns (bytes32 actionId)",
  "function executeAction(LifecycleAction action, LifecycleInput[] inputs, LifecycleSuccessor[] successors, LifecycleCollateralReplacement[] collateralReplacements, LifecycleConsent[] consents) returns (bytes32 outcomeHash)",
]);

const lifecycleActionTypes = {
  SetrynLifecycleActionV1: [
    { name: "kind", type: "uint8" },
    { name: "actor", type: "address" },
    { name: "actorAccountId", type: "bytes32" },
    { name: "policyContextHash", type: "bytes32" },
    { name: "inputsHash", type: "bytes32" },
    { name: "successorsHash", type: "bytes32" },
    { name: "collateralReplacementsHash", type: "bytes32" },
    { name: "participantSetHash", type: "bytes32" },
    { name: "consentsHash", type: "bytes32" },
    { name: "riskDomainId", type: "bytes32" },
    { name: "riskDomainVersion", type: "uint32" },
    { name: "feeScheduleId", type: "bytes32" },
    { name: "feeScheduleVersion", type: "uint32" },
    { name: "economicTransitionHash", type: "bytes32" },
    { name: "compressionPlanId", type: "bytes32" },
    { name: "breaksPackageProvenance", type: "bool" },
    { name: "packageBreakPermissionHash", type: "bytes32" },
    { name: "actorMaximumLiabilityIncreaseBaseUnits", type: "uint128" },
    { name: "actorMaximumCollateralIncreaseBaseUnits", type: "uint128" },
    { name: "inputCount", type: "uint16" },
    { name: "successorCount", type: "uint16" },
    { name: "participantCount", type: "uint16" },
    { name: "deadline", type: "uint64" },
    { name: "nonce", type: "uint256" },
    { name: "permittedExecutor", type: "address" },
    { name: "salt", type: "bytes32" },
    { name: "chainId", type: "uint256" },
    { name: "engine", type: "address" },
  ],
} as const;

/* Terminal lifecycle: position engine enums, exercise policies and the canonical payoff fixing encoding. */
const POSITION_STATUS_NAMES = [
  "Unspecified",
  "Live",
  "Fixing",
  "SettlementReady",
  "Settled",
  "ClosedByUnwind",
  "Replaced",
  "Lapsed",
  "CancelledByDisruption",
  "Defaulted",
  "TerminalClaim",
  "Abandoned",
] as const;
const EXERCISE_STATE_NAMES = [
  "Unspecified",
  "AwaitingFixing",
  "ElectionOpen",
  "PartiallyExercised",
  "FullyExercised",
  "Abandoned",
  "Lapsed",
] as const;
const STATUS = { live: 1, fixing: 2, settlementReady: 3, settled: 4, lapsed: 7, defaulted: 9, terminalClaim: 10 } as const;
/** Statuses that still carry open exposure and a live terminal reservation. */
const OPEN_POSITION_STATUSES: readonly number[] = [STATUS.live, STATUS.fixing, STATUS.settlementReady];
const FIXING_STATUS = { proposed: 1, disputed: 2, finalized: 3 } as const;
const EXERCISE_POLICIES: Record<string, OnchainPositionLifecycle["exercisePolicy"]> = {
  [keccak256(stringToHex("SetrynExercisePolicyV1:HolderElection"))]: "HOLDER_ELECTION",
  [keccak256(stringToHex("SetrynExercisePolicyV1:Automatic"))]: "AUTOMATIC",
  [keccak256(stringToHex("SetrynExercisePolicyV1:AutomaticUnlessAbandoned"))]: "AUTOMATIC_UNLESS_ABANDONED",
};
const EXERCISE_ACTION_KIND = 10;
const canonicalFixingsParameter = [
  {
    type: "tuple[]",
    components: [
      { name: "slot", type: "uint8" },
      { name: "benchmarkId", type: "bytes32" },
      { name: "benchmarkVersion", type: "uint32" },
      { name: "decimals", type: "uint8" },
      { name: "value", type: "int256" },
    ],
  },
] as const;
const settlementCallAbi = [...cashSettlementAbi, ...settlementErrorsAbi] as const;
const lifecycleCallAbi = [...signedLifecycleAbi, ...settlementErrorsAbi] as const;

interface FixingCandidateArg {
  benchmarkId: Hex;
  benchmarkVersion: number;
  requiredWindowKindId: Hex;
  selectionRuleId: Hex;
  targetAt: bigint;
  windowStartsAt: bigint;
  windowEndsAt: bigint;
  unavailableAfter: bigint;
  maxPublicationLagSeconds: number;
  minimumObservations: number;
  maximumObservations: number;
  selectionParametersHash: Hex;
}

interface FixingSlotArg {
  slot: number;
  candidates: readonly FixingCandidateArg[];
}

/** One series' terminal schedule and the fixing slots it was qualified with, which settlement calls must repeat. */
interface SeriesTerminal {
  lastTradingAt: bigint;
  fixingWindowOpen: bigint;
  fixingWindowClose: bigint;
  exerciseOpensAt: bigint;
  exerciseCutoffAt: bigint;
  correctionCutoffAt: bigint;
  finalResolutionAt: bigint;
  settlementDeadline: bigint;
  exercisePolicyId: Hex;
  slots: readonly FixingSlotArg[];
}

interface SeriesFixingRead {
  /** Overall status: pending until every slot has a proposal, finalized once every slot is final. */
  status: OnchainPositionLifecycle["fixing"]["status"];
  value: bigint | null;
  decimals: number;
  resolutionKind: number;
  observedAt: bigint | null;
  finalizedAt: bigint | null;
  /** abi.encode(CanonicalFixing[]) of the slot values, as the position engine hashes them; null until every slot has one. */
  encoded: Hex | null;
}

/** The terminal read of one account position, with the evidence the activity reconstruction needs for receipts. */
interface TerminalRead {
  view: OnchainPositionLifecycle;
  settlementTransactionHash: Hex | null;
  claimTransactionHash: Hex | null;
  exerciseTransactionHash: Hex | null;
  exerciseAt: bigint | null;
}

function utcLabel(seconds: bigint | number): string {
  const date = new Date(Number(seconds) * 1000);
  const day = date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
  return `${day} ${date.toISOString().slice(11, 16)} UTC`;
}

function isoAt(seconds: bigint): string {
  return new Date(Number(seconds) * 1000).toISOString();
}

function minorToUsd(value: bigint): number {
  return Number(formatUnits(value, 6));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** The contract error a simulated or mined call reverted with, decoded against the settlement error set. */
function revertOf(error: unknown): { name: string; args: readonly unknown[] } | null {
  if (!(error instanceof BaseError)) return null;
  const reverted = error.walk((cause) => cause instanceof ContractFunctionRevertedError);
  if (!(reverted instanceof ContractFunctionRevertedError)) return null;
  const name = reverted.data?.errorName ?? reverted.reason ?? null;
  return name ? { name, args: (reverted.data?.args ?? []) as readonly unknown[] } : null;
}

/** A contract revert on a terminal lifecycle call, stated so the viewer knows what has to happen first. */
function describeLifecycleRevert(name: string, args: readonly unknown[]): string {
  const at = (value: unknown) => (typeof value === "bigint" || typeof value === "number" ? utcLabel(value) : "the scheduled time");
  switch (name) {
    case "InvalidPositionStatus": {
      const status = POSITION_STATUS_NAMES[Number(args[0])] ?? String(args[0]);
      return `The position is ${status}, which this settlement path does not accept.`;
    }
    case "HolderElectionPending":
      return `The final fixing is on the position and it awaits the holder's election until ${at(args[1])}. Settle after the holder exercises, or Finalize the lapse after the cutoff.`;
    case "NormalSettlementClosed":
      return `Normal settlement closed at final resolution (${at(args[0])}). Use Finalize to complete the position.`;
    case "TerminalFallbackNotOpen":
      return `Finalize opens at final resolution, ${at(args[0])}.`;
    case "FixingNotFinalized":
      return `Fixing slot ${String(args[0])} has no proposed or final fixing yet.`;
    case "CorrectionWindowOpen":
    case "CorrectionWindowNotClosed":
      return "The fixing is still inside its correction window; settlement opens once corrections close.";
    case "ExerciseWindowClosed":
      return `Election is open ${at(args[1])} to ${at(args[2])}; chain time is ${at(args[3])}.`;
    case "InvalidExerciseConvention":
      return "The series election window is closed or no lots remain to elect.";
    case "ExerciseWitnessMismatch":
      return "The exercise witness does not match the final fixing on the position.";
    case "LifecycleOwnerMismatch":
      return "Only the position's lifecycle owner, the long holder, can elect.";
    case "MissingConsent":
      return "Only the long holder can elect on this position.";
    case "FinalResolutionReached":
      return `Final resolution has passed (${at(args[1])}); use Finalize.`;
    case "FinalResolutionNotReached":
      return `Final resolution is at ${at(args[1])}.`;
    case "FixingWindowNotOpen":
      return `The window opens at ${at(args[1])}.`;
    case "InvalidPositionTransition": {
      const status = POSITION_STATUS_NAMES[Number(args[1])] ?? String(args[1]);
      return `The position is ${status}; that transition is not available.`;
    }
    case "UnknownClaim":
      return "No terminal claim is recorded for this settlement.";
    case "SettlementOutcomeMismatch":
      return "The position's terminal state does not match the settlement outcome the coordinator derives.";
    case "LifecycleDeadlinePassed":
      return "The signed action expired before it was included. Try again.";
    default:
      return `The contract rejected the call: ${name}.`;
  }
}

const vaultAbi = [
  {
    type: "function",
    name: "getAccount",
    stateMutability: "view",
    inputs: [{ name: "accountId", type: "bytes32" }],
    outputs: [
      { name: "controller", type: "address" },
      { name: "pendingController", type: "address" },
    ],
  },
  { type: "error", name: "NotAccountController", inputs: [{ name: "accountId", type: "bytes32" }, { name: "caller", type: "address" }] },
  { type: "error", name: "UnknownAccount", inputs: [{ name: "accountId", type: "bytes32" }] },
  { type: "error", name: "ZeroAmount", inputs: [] },
  { type: "error", name: "ZeroRecipient", inputs: [] },
  { type: "error", name: "VaultRecipient", inputs: [] },
  {
    type: "error",
    name: "InsufficientAvailable",
    inputs: [
      { name: "accountId", type: "bytes32" },
      { name: "collateralId", type: "bytes32" },
      { name: "available", type: "uint128" },
      { name: "requested", type: "uint128" },
    ],
  },
  {
    type: "function",
    name: "deriveAccountId",
    stateMutability: "view",
    inputs: [
      { name: "creator", type: "address" },
      { name: "salt", type: "bytes32" },
    ],
    outputs: [{ name: "accountId", type: "bytes32" }],
  },
  {
    type: "function",
    name: "deriveCollateralId",
    stateMutability: "view",
    inputs: [
      { name: "assetId", type: "bytes32" },
      { name: "bindingVersion", type: "uint32" },
    ],
    outputs: [{ name: "collateralId", type: "bytes32" }],
  },
  {
    type: "function",
    name: "accountExists",
    stateMutability: "view",
    inputs: [{ name: "accountId", type: "bytes32" }],
    outputs: [{ name: "exists", type: "bool" }],
  },
  {
    type: "function",
    name: "createAccount",
    stateMutability: "nonpayable",
    inputs: [{ name: "salt", type: "bytes32" }],
    outputs: [{ name: "accountId", type: "bytes32" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [
      { name: "accountId", type: "bytes32" },
      { name: "collateralId", type: "bytes32" },
    ],
    outputs: [
      { name: "total", type: "uint128" },
      { name: "locked", type: "uint128" },
      { name: "available", type: "uint128" },
    ],
  },
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assetId", type: "bytes32" },
      { name: "bindingVersion", type: "uint32" },
      { name: "accountId", type: "bytes32" },
      { name: "amount", type: "uint128" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assetId", type: "bytes32" },
      { name: "bindingVersion", type: "uint32" },
      { name: "accountId", type: "bytes32" },
      { name: "amount", type: "uint128" },
      { name: "recipient", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "isLockOperator",
    stateMutability: "view",
    inputs: [
      { name: "accountId", type: "bytes32" },
      { name: "operator", type: "address" },
    ],
    outputs: [{ name: "approved", type: "bool" }],
  },
  {
    type: "function",
    name: "setLockOperator",
    stateMutability: "nonpayable",
    inputs: [
      { name: "accountId", type: "bytes32" },
      { name: "operator", type: "address" },
      { name: "approved", type: "bool" },
    ],
    outputs: [],
  },
] as const;

const tokenAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "remaining", type: "uint256" }],
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
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
] as const;

function initialSnapshot(): GatewaySnapshot {
  return {
    // The build's network until the runtime answers; server and first client render agree on it.
    environment: networkEnvironment(publicNetwork()),
    wallet: { status: "DISCONNECTED", address: null, chainId: null },
    account: {
      id: EMPTY_ID,
      label: "Primary account",
      riskDomain: RISK_DOMAIN_LABEL,
      collateralAsset: COLLATERAL_ASSET,
      posted: 0,
      eligible: 0,
      reserved: 0,
      available: 0,
      equity: 0,
    },
    positions: [],
    receipts: [],
    executions: [],
    restingOrders: [],
    publicBookMarketId: null,
    publicBookEconomics: null,
    onchainMarkets: {},
    feeSchedule: null,
    chainClockOffsetMs: 0,
    publicBookOrders: [],
    publicBooks: {},
    rfqRequests: [],
    lifecycles: {},
  };
}

/** The account-scoped part of a snapshot, as it reads before any wallet connects. */
function withoutAccount(snapshot: GatewaySnapshot): GatewaySnapshot {
  const empty = initialSnapshot();
  return {
    ...snapshot,
    account: empty.account,
    positions: empty.positions,
    receipts: empty.receipts,
    executions: empty.executions,
    restingOrders: empty.restingOrders,
    rfqRequests: empty.rfqRequests,
    lifecycles: empty.lifecycles,
  };
}

/** A connection the user did not complete. Code 4001 is the EIP-1193 user rejection, so callers report nothing sent. */
function connectionRejected(): Error {
  return Object.assign(new Error("WALLET_CONNECTION_REJECTED"), { code: 4001 });
}

interface PendingConnection {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
}

/** The connected wallet the gateway is attaching or has attached; `ready` settles once its account is loaded. */
interface AttachedSession {
  provider: EIP1193Provider;
  address: Address;
  chainId: number;
  ready: Promise<void>;
}

/** Where a position stands in its terminal lifecycle, from its onchain status, settlement record and chain time. */
function lifecyclePhase(
  view: OnchainPositionLifecycle,
  status: number,
  now: bigint,
  series: Pick<SeriesTerminal, "fixingWindowOpen">,
): PositionLifecyclePhase {
  const settlement = view.settlement;
  if (settlement) {
    if (settlement.claim?.status === "ACTIVE" && settlement.claim.receivable) return "CLAIM_AVAILABLE";
    if (settlement.mode === "LAPSED" || (settlement.transferUsd === 0 && view.exercisedLots === 0)) return "LAPSED";
    return "SETTLED";
  }
  if (status === STATUS.live) {
    if (view.fixing.acceptedOnPosition) return "FIXED_AWAITING_ELECTION";
    return now < series.fixingWindowOpen ? "LIVE" : "AWAITING_FIXING";
  }
  if (status === STATUS.fixing || status === STATUS.defaulted) return "AWAITING_FIXING";
  if (status === STATUS.settlementReady) return "EXERCISED";
  if (status === STATUS.settled) return view.exercisedLots > 0 ? "EXERCISED" : "LAPSED";
  if (status === STATUS.lapsed) return "LAPSED";
  if (status === STATUS.terminalClaim) return "SETTLED";
  return "CLOSED";
}

/** Collateral a completed settlement returned to the account: its released reservation plus any transfer it received. */
export function settlementReleasable(view: OnchainPositionLifecycle): number {
  if (!view.settlement) return 0;
  return round2(view.settlement.releasedUsd + Math.max(0, view.settlement.transferUsd));
}

export class OnchainTradingGateway implements InternalTradingGateway {
  private snapshot = initialSnapshot();
  /** What the server renders; hydration uses it too, so live data arrives in the render after hydration. */
  private readonly serverSnapshot = this.snapshot;
  private readonly listeners = new Set<() => void>();
  private runtimePromise: Promise<SetrynRuntime> | null = null;
  private setryn: SetrynRuntime | null = null;
  private publicClient: ReturnType<typeof createPublicClient> | null = null;
  private walletClient: ReturnType<typeof createWalletClient> | null = null;
  private walletAddress: Address | null = null;
  /** The wallet layer's prompts, bound by the wallet bridge. */
  private walletControls: WalletControls | null = null;
  /** The wallet session being attached or attached; a newer session bumps `walletEpoch` so older work stops. */
  private session: AttachedSession | null = null;
  private walletEpoch = 0;
  /** A connectWallet call waiting for the user to pick a wallet, switch network, or dismiss the prompt. */
  private pendingConnection: PendingConnection | null = null;
  /** Local-chain accounts already given gas this page session. */
  private readonly fundedAccounts = new Set<Address>();
  /** Which platform roles can sign, read once per minute; a failed read is retried on the next use. */
  private operatorStatusRead: { at: number; status: Promise<OperatorStatus> } | null = null;
  private readonly authorizations = new Map<string, SignedOrderAuthorization>();
  /** Fills reconstructed per order hash, and the position an exit order's fill closed. */
  private orderFills = new Map<string, { fillIds: string[]; receiptIds: string[]; closedPositionId: string | null }>();
  private pollingTimer: number | null = null;
  private polling = false;
  /** Book orders already seen filled, cancelled, or expired. None of them can rest again, so they are not re-read. */
  private readonly retiredBookOrders = new Set<string>();
  /** Series terminal schedules and fixing slots; both are fixed at qualification, so each is read once. */
  private readonly seriesTerminals = new Map<string, Promise<SeriesTerminal>>();

  getSnapshot = (): GatewaySnapshot => this.snapshot;

  getServerSnapshot = (): GatewaySnapshot => this.serverSnapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    this.startPublicReads();
    return () => this.listeners.delete(listener);
  };

  private publicReadsStarted = false;

  /**
   * Reads the deployment, series economics, and public book before any wallet connects, as an exchange shows its book
   * to logged-out visitors. Maker liquidity streams as signed firm quotes (lib/quotes), so browsing writes nothing
   * onchain; the browser never signs or holds an operator or maker key.
   */
  private startPublicReads(): void {
    if (this.publicReadsStarted || typeof window === "undefined") return;
    this.publicReadsStarted = true;
    const read = () => {
      if (this.snapshot.wallet.status === "CONNECTED") return;
      void this.runtime()
        .then(() => this.refreshPublicBook())
        .catch(() => undefined);
    };
    read();
    window.setInterval(read, 5_000);
  }

  /**
   * Asks the wallet layer for a wallet and resolves once one is attached on the runtime chain with its account loaded.
   * A wallet already connected on another chain is asked to switch instead.
   */
  async connectWallet(): Promise<void> {
    const status = this.snapshot.wallet.status;
    if (status === "CONNECTED") return;
    const controls = this.walletControls;
    if (!controls) throw new Error("WALLET_UNAVAILABLE");
    const pending = this.awaitConnection();
    if (this.session) {
      // A wallet is already connected: one on another chain is asked to switch, one being prepared settles the wait.
      if (status === "WRONG_NETWORK") this.requestRuntimeChain();
    } else {
      // Opening again is harmless while the prompt is up, and recovers a prompt that closed without reporting back.
      if (status !== "CONNECTING") {
        this.publish({ ...this.snapshot, wallet: { status: "CONNECTING", address: null, chainId: null } });
      }
      if (!controls.openConnect()) {
        this.publish({ ...this.snapshot, wallet: { status: "DISCONNECTED", address: null, chainId: null } });
        this.settleConnection(new Error("WALLET_UNAVAILABLE"));
      }
    }
    return pending;
  }

  bindWalletControls(controls: WalletControls | null): void {
    this.walletControls = controls;
  }

  attachWallet(session: WalletSession): Promise<void> {
    const address = getAddress(session.address);
    const current = this.session;
    if (current && current.provider === session.provider && current.address === address && current.chainId === session.chainId) {
      return current.ready;
    }
    const epoch = ++this.walletEpoch;
    const ready = this.attach(epoch, session.provider, address, session.chainId);
    this.session = { provider: session.provider, address, chainId: session.chainId, ready };
    return ready;
  }

  detachWallet(): void {
    if (!this.session) return;
    this.walletEpoch += 1;
    this.session = null;
    this.walletAddress = null;
    this.walletClient = null;
    this.publish({ ...withoutAccount(this.snapshot), wallet: { status: "DISCONNECTED", address: null, chainId: null } });
    // A caller still waiting on this wallet (it disconnected while being prepared) learns the connection ended.
    this.settleConnection(connectionRejected());
  }

  cancelWalletConnection(): void {
    if (!this.pendingConnection || this.session) return;
    if (this.snapshot.wallet.status === "CONNECTING") {
      this.publish({ ...this.snapshot, wallet: { status: "DISCONNECTED", address: null, chainId: null } });
    }
    this.settleConnection(connectionRejected());
  }

  private awaitConnection(): Promise<void> {
    if (!this.pendingConnection) {
      let resolve!: () => void;
      let reject!: (error: unknown) => void;
      const promise = new Promise<void>((onResolve, onReject) => {
        resolve = onResolve;
        reject = onReject;
      });
      this.pendingConnection = { promise, resolve, reject };
    }
    return this.pendingConnection.promise;
  }

  /** Resolves a waiting connectWallet, or rejects it with the error that ended the attempt. */
  private settleConnection(error?: unknown): void {
    const pending = this.pendingConnection;
    if (!pending) return;
    this.pendingConnection = null;
    if (error === undefined) pending.resolve();
    else pending.reject(error);
  }

  /** Asks the wallet to move to the runtime chain; a refusal ends the waiting connectWallet with the wallet's error. */
  private requestRuntimeChain(): void {
    const controls = this.walletControls;
    if (!controls) {
      this.settleConnection(new Error("WALLET_UNAVAILABLE"));
      return;
    }
    void this.runtime()
      .then((setryn) => controls.switchChain(setryn.chainId))
      .catch((error: unknown) => this.settleConnection(error));
  }

  /**
   * Prepares a connected wallet for signing: on the runtime chain it builds the signing client over the connector's own
   * provider (topping up gas first on the local chain only) and loads the account. On another chain it stays visible but
   * cannot sign.
   */
  private async attach(epoch: number, provider: EIP1193Provider, address: Address, chainId: number): Promise<void> {
    const current = () => epoch === this.walletEpoch;
    // A previous account or chain stops signing at once; the new one signs only after it is ready.
    const sameAccount = this.walletAddress === address;
    this.walletClient = null;
    // Read at publish time so snapshot changes made while awaiting are kept; another account's data is cleared.
    const base = () => (sameAccount ? this.snapshot : withoutAccount(this.snapshot));
    let setryn: SetrynRuntime;
    try {
      setryn = await this.runtime();
      if (!current()) return;
      if (chainId !== setryn.chainId) {
        this.walletAddress = address;
        this.publish({ ...base(), wallet: { status: "WRONG_NETWORK", address, chainId } });
        if (this.pendingConnection) this.requestRuntimeChain();
        return;
      }
      this.publish({ ...base(), wallet: { status: "CONNECTING", address: null, chainId: null } });
      if (runtimeNetwork(setryn) === "local" && !this.fundedAccounts.has(address)) {
        await this.fundNativeGas(address);
        this.fundedAccounts.add(address);
      }
      if (!current()) return;
    } catch (error) {
      if (!current()) return;
      // A wallet the gateway cannot prepare is handed back, so the wallet controls and the gateway agree it is not connected.
      this.session = null;
      this.walletAddress = null;
      this.publish({ ...withoutAccount(this.snapshot), wallet: { status: "DISCONNECTED", address: null, chainId: null } });
      this.settleConnection(error);
      this.walletControls?.disconnect();
      return;
    }

    this.walletAddress = address;
    this.walletClient = createWalletClient({ account: address, chain: this.chain(setryn), transport: custom(provider) });
    this.startPolling();
    this.publish({ ...this.snapshot, wallet: { status: "CONNECTED", address, chainId } });
    try {
      await this.refreshAccount();
      await Promise.all([this.refreshOrders(), this.refreshPublicBook(), this.refreshActivity(), this.refreshRfqs()]);
      if (current()) this.settleConnection();
    } catch (error) {
      // The wallet stays connected and polling retries the reads; a waiting caller learns the chain did not answer.
      if (current()) this.settleConnection(error);
    }
  }

  async submitCollateralIntent(intent: CollateralIntent): Promise<CollateralIntentResult> {
    const { setryn, address, walletClient, publicClient } = await this.connected();
    if (!Number.isFinite(intent.amount) || intent.amount <= 0) throw new Error("INVALID_COLLATERAL_AMOUNT");
    // The settlement token is the only collateral; older callers still name the local token by its own symbol.
    if (intent.asset !== "USDC" && intent.asset !== "sUSD") throw new Error("UNSUPPORTED_COLLATERAL_ASSET");
    const accountId = await this.accountId(address);
    if (intent.accountId.toLowerCase() !== accountId.toLowerCase()) throw new Error("ACCOUNT_MISMATCH");
    const amount = parseUnits(intent.amount.toFixed(6), 6);
    const local = runtimeNetwork(setryn) === "local";
    if (local) await this.fundNativeGas(address);

    const exists = await publicClient.readContract({
      address: setryn.collateralVault,
      abi: vaultAbi,
      functionName: "accountExists",
      args: [accountId],
    });
    if (!exists) {
      const createHash = await walletClient.writeContract({
        account: address,
        chain: this.chain(setryn),
        address: setryn.collateralVault,
        abi: vaultAbi,
        functionName: "createAccount",
        args: [ACCOUNT_SALT],
      });
      await publicClient.waitForTransactionReceipt({ hash: createHash });
    }

    let transactionHash: Hex;
    if (intent.kind === "DEPOSIT") {
      const tokenBalance = await publicClient.readContract({
        address: setryn.settlementToken,
        abi: tokenAbi,
        functionName: "balanceOf",
        args: [address],
      });
      // The local test token mints the shortfall to its caller; on a network the wallet deposits USDC it already holds.
      if (tokenBalance < amount && !local) throw new Error("INSUFFICIENT_WALLET_BALANCE");
      if (tokenBalance < amount) {
        const mintHash = await walletClient.writeContract({
          account: address,
          chain: this.chain(setryn),
          address: setryn.settlementToken,
          abi: tokenAbi,
          functionName: "mint",
          args: [amount - tokenBalance],
        });
        await publicClient.waitForTransactionReceipt({ hash: mintHash });
      }
      const allowance = await publicClient.readContract({
        address: setryn.settlementToken,
        abi: tokenAbi,
        functionName: "allowance",
        args: [address, setryn.collateralVault],
      });
      if (allowance < amount) {
        const approvalHash = await walletClient.writeContract({
          account: address,
          chain: this.chain(setryn),
          address: setryn.settlementToken,
          abi: tokenAbi,
          functionName: "approve",
          // A real-USDC wallet approves exactly the deposit; the local test token keeps a standing approval.
          args: [setryn.collateralVault, local ? maxUint256 : amount],
        });
        await publicClient.waitForTransactionReceipt({ hash: approvalHash });
      }
      transactionHash = await walletClient.writeContract({
        account: address,
        chain: this.chain(setryn),
        address: setryn.collateralVault,
        abi: vaultAbi,
        functionName: "deposit",
        args: [setryn.settlementAssetId, 1, accountId, amount],
      });
    } else {
      const recipient = getAddress(intent.recipient);
      const available = parseUnits(this.snapshot.account.available.toString(), 6);
      if (amount > available) throw new Error("INSUFFICIENT_AVAILABLE_COLLATERAL");
      transactionHash = await walletClient.writeContract({
        account: address,
        chain: this.chain(setryn),
        address: setryn.collateralVault,
        abi: vaultAbi,
        functionName: "withdraw",
        args: [setryn.settlementAssetId, 1, accountId, amount, recipient],
      });
    }

    await publicClient.waitForTransactionReceipt({ hash: transactionHash });
    await this.refreshAccount();
    return { intentId: transactionHash, kind: intent.kind, amount: intent.amount, status: "COMPLETED" };
  }

  async withdrawTreasuryFees(request: TreasuryWithdrawal, mode: "SIMULATE" | "SEND"): Promise<TreasuryWithdrawalResult> {
    const { setryn, address, walletClient, publicClient } = await this.connected();
    if (!Number.isFinite(request.amount) || request.amount <= 0) throw new Error("INVALID_COLLATERAL_AMOUNT");
    if (request.accountId.toLowerCase() !== setryn.feeRecipientAccountId.toLowerCase()) throw new Error("TREASURY_ACCOUNT_MISMATCH");
    if (!isAddress(request.recipient)) throw new Error("INVALID_RECIPIENT");
    const recipient = getAddress(request.recipient);
    const accountId = setryn.feeRecipientAccountId;
    const amount = parseUnits(request.amount.toFixed(6), 6);
    const [controller] = await publicClient.readContract({
      address: setryn.collateralVault,
      abi: vaultAbi,
      functionName: "getAccount",
      args: [accountId],
    });
    if (controller.toLowerCase() !== address.toLowerCase()) throw new Error("TREASURY_CONTROLLER_REQUIRED");
    const call = {
      account: address,
      address: setryn.collateralVault,
      abi: vaultAbi,
      functionName: "withdraw",
      args: [setryn.settlementAssetId, 1, accountId, amount, recipient],
    } as const;
    // The withdrawal is simulated against the chain first, in both modes, so a revert never costs a signature.
    try {
      await publicClient.simulateContract(call);
    } catch (error) {
      const reverted = error instanceof BaseError ? error.walk((cause) => cause instanceof ContractFunctionRevertedError) : null;
      const errorName = reverted instanceof ContractFunctionRevertedError ? reverted.data?.errorName : undefined;
      if (errorName === "InsufficientAvailable") throw new Error("INSUFFICIENT_AVAILABLE_COLLATERAL");
      if (errorName === "NotAccountController") throw new Error("TREASURY_CONTROLLER_REQUIRED");
      throw new Error("TREASURY_WITHDRAWAL_REVERTED");
    }
    if (mode === "SIMULATE") return { mode, amount: request.amount, recipient, transactionHash: null };
    if (runtimeNetwork(setryn) === "local") await this.fundNativeGas(address);
    const transactionHash = await walletClient.writeContract({ ...call, chain: this.chain(setryn) });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: transactionHash });
    if (receipt.status !== "success") throw new Error("TREASURY_WITHDRAWAL_FAILED");
    return { mode, amount: request.amount, recipient, transactionHash };
  }

  async authorizeOrder(intent: PackageOrderIntent): Promise<SignedOrderAuthorization> {
    if (intent.side === "EXIT") throw new Error("EXIT_REQUIRES_FIRM_QUOTE");
    const { setryn, address, walletClient, publicClient } = await this.connected();
    const market = runtimeMarketByKey(setryn, intent.marketId);
    if (!market) throw new Error("MARKET_NOT_ONCHAIN_ENABLED");
    if (intent.recipient.toLowerCase() !== address.toLowerCase()) throw new Error("RECIPIENT_MISMATCH");
    if (intent.packageCode !== intent.marketId) throw new Error("UNSUPPORTED_ONCHAIN_MARKET");
    if (!Number.isInteger(intent.lots) || intent.lots < 1 || intent.lots > market.maxOrderLots) {
      throw new Error("INVALID_LOTS");
    }
    if (!Number.isFinite(intent.limitPrice)) throw new Error("INVALID_LIMIT_PRICE");
    if (!["GTC", "GTD", "IOC", "FOK"].includes(intent.timeInForce)) throw new Error("INVALID_TIME_IN_FORCE");
    const action = executableAction(intent.side, intent.packageSide);
    const marketable = limitCrosses(intent.limitPrice, intent.executionPrice, action);
    if (intent.orderType === "MARKET" && !marketable) throw new Error("ORDER_NOT_MARKETABLE");

    const accountId = await this.accountId(address);
    if (intent.accountId.toLowerCase() !== accountId.toLowerCase()) throw new Error("ACCOUNT_MISMATCH");
    await this.ensureClearingOperators(accountId);
    const block = await publicClient.getBlock({ blockTag: "pending" });
    let lifetime = BigInt(240);
    if (intent.timeInForce === "GTD") {
      const requestedExpiry = intent.expiresAt ? Date.parse(intent.expiresAt) : Number.NaN;
      const nowMs = Number(block.timestamp) * 1000;
      if (!Number.isFinite(requestedExpiry) || requestedExpiry <= nowMs) throw new Error("INVALID_GTD_EXPIRY");
      const requestedLifetime = BigInt(Math.max(1, Math.floor((requestedExpiry - nowMs) / 1000)));
      lifetime = requestedLifetime < lifetime ? requestedLifetime : lifetime;
    }
    const deadline = block.timestamp + lifetime;
    const nonce = BigInt(Date.now()) * BigInt(1_000_000) + BigInt(crypto.getRandomValues(new Uint32Array(1))[0]);
    const salt = keccak256(stringToHex(`${address}:${nonce}:${intent.marketId}:${crypto.randomUUID()}`));
    const policyContextHash = keccak256(
      stringToHex(
        `${intent.marketId}:${intent.routeId}:${intent.packageSide}:${intent.timeInForce}:${intent.settlementGuarantee}`,
      ),
    );
    const priceTicks = priceToTicks(market, intent.limitPrice);
    const int128Min = -(BigInt(1) << BigInt(127));
    const int128Max = (BigInt(1) << BigInt(127)) - BigInt(1);
    if (priceTicks < int128Min || priceTicks > int128Max) throw new Error("INVALID_LIMIT_PRICE");
    // Orders sign the version the registry has active right now. The ticket priced its fee cap from the schedule the
    // snapshot held; if a fresh read charges more than that, the cap could be short, so the viewer re-reviews instead.
    const priced = this.snapshot.onchainMarkets[intent.marketId] ?? null;
    const fees = await this.refreshFeeSchedule(0);
    if (!fees.active && fees.source === "CHAIN") throw new Error("FEE_SCHEDULE_INACTIVE");
    // The order signs its series' active version and the fee schedule version that series' market version names.
    const versions = marketTradingVersions(fees, market.seriesId);
    if (!versions.tradable && fees.source === "CHAIN") throw new Error("MARKET_FEE_SCHEDULE_PENDING");
    if (
      priced &&
      (fees.takerFeeBps > priced.takerFeeBps ||
        fees.makerFeeBps > priced.makerFeeBps ||
        fees.taker.flatChargeMinor / 1_000_000 > priced.takerFlatFeeUsd ||
        fees.maker.flatChargeMinor / 1_000_000 > priced.makerFlatFeeUsd)
    ) {
      throw new Error("FEE_SCHEDULE_CHANGED");
    }
    const feeMinor = this.toMinorUnits(intent.feeCap);
    // All-or-none is fill-or-kill on the public book. A private RFQ request instead requires an all-or-none order to keep
    // its (empty) remainder open, so the same intent signs as GTD until the RFQ deadline with the full size as minimum.
    const allOrNone = intent.timeInForce === "FOK";
    const rfqAllOrNone = allOrNone && intent.disclosure === "PRIVATE_RFQ";
    const timeInForce = rfqAllOrNone
      ? 2
      : intent.timeInForce === "GTC" ? 1 : intent.timeInForce === "GTD" ? 2 : intent.timeInForce === "IOC" ? 3 : 4;
    const order: OnchainPublicOrder = {
      signer: address,
      accountId,
      policyId: PUBLIC_SERIES_POLICY,
      policyContextHash,
      actionId: setryn.enterActionId,
      targetKind: 1,
      seriesId: market.seriesId,
      packageId: EMPTY_ID,
      targetVersion: versions.seriesVersion,
      side: action === "BUY" ? 1 : 2,
      lots: BigInt(intent.lots),
      priceTicks,
      timeInForce,
      deadline,
      executionModeId:
        intent.disclosure === "PRIVATE_RFQ" ? setryn.privateRfqExecutionModeId : setryn.executionModeId,
      feeScheduleId: setryn.feeScheduleId,
      feeScheduleVersion: versions.feeScheduleVersion,
      maxFeeMinor: feeMinor > BigInt(0) ? feeMinor : BigInt(1),
      recipient: address,
      permittedExecutor: setryn.atomicClearingEngine,
      nonce,
      salt,
      allowPartialFills: !allOrNone,
      minimumFillLots: allOrNone ? BigInt(intent.lots) : BigInt(1),
      remainderPolicy: rfqAllOrNone ? 1 : intent.timeInForce === "IOC" || intent.timeInForce === "FOK" ? 2 : 1,
      postOnly: intent.postOnly === true,
      reduceOnly: false,
    };
    const signature = await walletClient.signTypedData({
      account: address,
      domain: {
        name: "Setryn",
        version: "1",
        chainId: setryn.chainId,
        verifyingContract: setryn.orderState,
      },
      types: publicOrderTypedData,
      primaryType: "PublicOrder",
      message: order,
    });
    const orderHash = await publicClient.readContract({
      address: setryn.orderState,
      abi: orderStateAbi,
      functionName: "hashOrder",
      args: [order],
    });
    const reservation = await fetch("/api/internal/orders/reserve-risk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order: serializePublicOrder(order), signature, orderHash }),
    });
    const reservationResult = (await reservation.json()) as { admissionId?: unknown };
    if (
      !reservation.ok ||
      typeof reservationResult.admissionId !== "string" ||
      !/^0x[0-9a-fA-F]{64}$/.test(reservationResult.admissionId)
    ) {
      throw new Error("RISK_RESERVATION_FAILED");
    }
    const riskAdmissionId = reservationResult.admissionId as Hex;
    const bindingHash = await walletClient.writeContract({
      account: address,
      chain: this.chain(setryn),
      address: setryn.riskAdmissionBindingRegistry,
      abi: riskBindingAbi,
      functionName: "bindOrderRisk",
      args: [order, riskAdmissionId],
    });
    const bindingReceipt = await publicClient.waitForTransactionReceipt({ hash: bindingHash });
    if (bindingReceipt.status !== "success") throw new Error("RISK_BINDING_FAILED");

    const authorization: SignedOrderAuthorization = {
      orderHash,
      signature,
      signer: address,
      nonce: nonce.toString(),
      deadline: new Date(Number(deadline) * 1000).toISOString(),
      intent,
      onchainOrder: order,
      riskAdmissionId,
    };
    this.authorizations.set(orderHash.toLowerCase(), authorization);
    return authorization;
  }

  async submitAuthorizedOrder(
    authorization: SignedOrderAuthorization,
    onUpdate: (update: SubmissionUpdate) => void,
  ): Promise<PackageExecutionResult> {
    if (authorization.intent.side === "EXIT") throw new Error("EXIT_REQUIRES_FIRM_QUOTE");
    const { setryn, address, walletClient, publicClient } = await this.connected();
    const order = authorization.onchainOrder;
    if (!order || !authorization.riskAdmissionId) throw new Error("INVALID_ONCHAIN_AUTHORIZATION");
    if (authorization.signer.toLowerCase() !== address.toLowerCase()) throw new Error("SIGNER_MISMATCH");

    const market = this.orderMarket(setryn, order);
    onUpdate({ step: "AUTHORIZED", label: "Order authorized", detail: "Signature and risk admission are bound." });
    const registrationHash = await walletClient.writeContract({
      account: address,
      chain: this.chain(setryn),
      address: setryn.orderState,
      abi: orderStateAbi,
      functionName: "registerSignedOrder",
      args: [order, authorization.signature as Hex],
    });
    const registrationReceipt = await publicClient.waitForTransactionReceipt({ hash: registrationHash });
    if (registrationReceipt.status !== "success") throw new Error("ORDER_REGISTRATION_FAILED");
    onUpdate({
      step: "SUBMITTED",
      label: "Order registered",
      detail: "The signed order is registered onchain and ready for matching.",
      transactionHash: registrationHash,
    });

    const bookId = deriveSeriesBookId(setryn, market.seriesId, { seriesVersion: order.targetVersion, feeScheduleVersion: order.feeScheduleVersion });
    const makerSide = order.side === 1 ? 2 : 1;
    // The book prunes an expired maker order during matching instead of filling it, so the head order must still be
    // live on the chain clock. Where a designated maker runs, an empty or expired head asks it to quote once.
    const readHead = async () => {
      // A book exists only once its first order rests; until then bestLevel reverts, which reads as an empty side.
      const levelId = await publicClient
        .readContract({
          address: setryn.publicOrderBook,
          abi: publicOrderBookAbi,
          functionName: "bestLevel",
          args: [bookId, makerSide],
        })
        .catch(() => EMPTY_ID);
      if (levelId === EMPTY_ID) return null;
      const level = await publicClient.readContract({
        address: setryn.publicOrderBook,
        abi: publicOrderBookAbi,
        functionName: "getPriceLevel",
        args: [levelId],
      });
      const [bookOrder, orderRecord, latest] = await Promise.all([
        publicClient.readContract({
          address: setryn.publicOrderBook,
          abi: publicOrderBookAbi,
          functionName: "getBookOrder",
          args: [level.headOrderHash],
        }),
        publicClient.readContract({
          address: setryn.orderState,
          abi: orderStateAbi,
          functionName: "getOrder",
          args: [level.headOrderHash],
        }),
        publicClient.getBlock({ blockTag: "pending" }),
      ]);
      const live =
        (orderRecord.status === 1 || orderRecord.status === 2) &&
        orderRecord.order.deadline > latest.timestamp + MAKER_DEADLINE_MARGIN_SECONDS;
      return { hash: level.headOrderHash, bookOrder, orderRecord, live };
    };
    // The book holds only orders people chose to rest; the designated maker streams firm quotes instead of resting
    // orders here, and the ticket routes to them when they are better.
    const head = await readHead();
    if (!head) {
      await this.cancelUnmatchedOrder(authorization);
      throw new Error("NO_ONCHAIN_LIQUIDITY");
    }
    if (!head.live) {
      await this.cancelUnmatchedOrder(authorization);
      throw new Error("MAKER_ORDER_EXPIRED");
    }
    const makerOrderHash = head.hash;
    const makerBookOrder = head.bookOrder;
    const makerOrderRecord = head.orderRecord;
    if (authorization.intent.side === "EXIT") {
      // A full exit unwinds both positions with the counterparty's consent, which only the designated maker gives.
      const { makerAddress } = await this.operatorStatus();
      if (!makerAddress || makerOrderRecord.order.signer.toLowerCase() !== makerAddress.toLowerCase()) {
        await this.cancelUnmatchedOrder(authorization);
        throw new Error("EXIT_REQUIRES_COUNTERPARTY_MAKER");
      }
    }
    const crosses = order.side === 1 ? order.priceTicks >= makerBookOrder.priceTicks : order.priceTicks <= makerBookOrder.priceTicks;
    if (!crosses) {
      await this.cancelUnmatchedOrder(authorization);
      throw new Error("ORDER_NOT_MARKETABLE");
    }
    const fillLots = order.lots < makerBookOrder.remainingLots ? order.lots : makerBookOrder.remainingLots;
    if (order.timeInForce === 4 && fillLots !== order.lots) {
      await this.cancelUnmatchedOrder(authorization);
      throw new Error("FOK_NOT_FILLED");
    }

    const makerAdmissionId = await publicClient.readContract({
      address: setryn.riskAdmissionBindingRegistry,
      abi: riskBindingAbi,
      functionName: "admissionForOrder",
      args: [makerOrderHash],
    });
    if (makerAdmissionId === EMPTY_ID) {
      await this.cancelUnmatchedOrder(authorization);
      throw new Error("MAKER_RISK_ADMISSION_MISSING");
    }
    const [takerAdmission, makerAdmission] = await Promise.all([
      publicClient.readContract({
        address: setryn.portfolioRiskEngine,
        abi: riskEngineAbi,
        functionName: "getAdmission",
        args: [authorization.riskAdmissionId as Hex],
      }),
      publicClient.readContract({
        address: setryn.portfolioRiskEngine,
        abi: riskEngineAbi,
        functionName: "getAdmission",
        args: [makerAdmissionId],
      }),
    ]);
    const takerIsLong = order.side === 1;
    const zeroOrderFunding = { terminalLiabilityLockId: EMPTY_ID, considerationLockId: EMPTY_ID } as const;
    const zeroFeeFunding = { consumptionId: EMPTY_ID, chargeLockId: EMPTY_ID, budgetLockId: EMPTY_ID } as const;
    const proposal = {
      matchData: {
        takerOrderHash: authorization.orderHash as Hex,
        makerOrderHash,
        fillLots,
        executionPriceTicks: makerBookOrder.priceTicks,
        longAdmissionId: takerIsLong ? (authorization.riskAdmissionId as Hex) : makerAdmissionId,
        longAdmissionResultHash: takerIsLong ? takerAdmission.resultHash : makerAdmission.resultHash,
        shortAdmissionId: takerIsLong ? makerAdmissionId : (authorization.riskAdmissionId as Hex),
        shortAdmissionResultHash: takerIsLong ? makerAdmission.resultHash : takerAdmission.resultHash,
        takerFunding: zeroOrderFunding,
        makerFunding: zeroOrderFunding,
        takerFeeFunding: zeroFeeFunding,
        makerFeeFunding: zeroFeeFunding,
      },
      payoffTerms: market.payoffTerms,
      channelKind: 1,
    } as const;
    const matchHash = await walletClient.writeContract({
      account: address,
      chain: this.chain(setryn),
      address: setryn.publicOrderBook,
      abi: publicOrderBookAbi,
      functionName: "matchSeries",
      args: [bookId, [proposal]],
    });
    const matchReceipt = await publicClient.waitForTransactionReceipt({ hash: matchHash });
    if (matchReceipt.status !== "success") {
      // Nothing filled, so the registered taker order and its risk reservation must not be left behind.
      await this.cancelUnmatchedOrder(authorization);
      throw new Error("MATCH_FAILED");
    }
    onUpdate({
      step: "INCLUDED",
      label: "Match included",
      detail: "The public book cleared the best resting order atomically.",
      transactionHash: matchHash,
    });

    const matchEvents = parseEventLogs({
      abi: publicOrderBookAbi,
      eventName: "DirectMatchExecuted",
      logs: matchReceipt.logs,
      strict: true,
    });
    const positionEvents = parseEventLogs({
      abi: atomicClearingAbi,
      eventName: "FillPositionCreated",
      logs: matchReceipt.logs,
      strict: true,
    });
    const fillId = matchEvents[0]?.args.fillId;
    const positionId = positionEvents[0]?.args.positionId;
    if (!fillId || !positionId) {
      await this.cancelUnmatchedOrder(authorization);
      throw new Error("CLEARING_EVIDENCE_MISSING");
    }
    const filledLots = Number(fillLots);
    const requestedLots = Number(order.lots);
    const remainingLots = requestedLots - filledLots;
    if (remainingLots > 0 && (order.timeInForce === 1 || order.timeInForce === 2)) {
      const hint = await this.levelHint(bookId, order.side, order.priceTicks);
      const placementHash = await walletClient.writeContract({
        account: address,
        chain: this.chain(setryn),
        address: setryn.publicOrderBook,
        abi: publicOrderBookAbi,
        functionName: "placeSeriesOrder",
        args: [authorization.orderHash as Hex, hint],
      });
      const placementReceipt = await publicClient.waitForTransactionReceipt({ hash: placementHash });
      if (placementReceipt.status !== "success") throw new Error("REMAINDER_PLACEMENT_FAILED");
    } else if (remainingLots > 0 && order.timeInForce === 3) {
      await this.releaseRiskReservation(authorization);
    }
    return this.recordFill({
      authorization,
      order,
      market,
      fillId,
      positionId,
      executionPriceTicks: makerBookOrder.priceTicks,
      filledLots,
      requestedLots,
      transactionHash: matchHash,
      logs: matchReceipt.logs,
      routeLabel: "Direct package book",
      leadingUpdates: [
        { step: "AUTHORIZED", label: "Order authorized", detail: "Signature and risk admission are bound." },
        { step: "SUBMITTED", label: "Order registered", detail: "Signed order registered onchain.", transactionHash: registrationHash },
        { step: "INCLUDED", label: "Match included", detail: "Best public liquidity cleared atomically.", transactionHash: matchHash },
      ],
      onUpdate,
    });
  }

  /**
   * Settles a firm streaming quote: the taker signs an opposite fill-or-kill order at the quote's price and its risk
   * authorization (typed data only, no transaction), and the signed settlement goes to QuoteSettlementRouter in one
   * atomic transaction: through Setryn's relayer when it is available, which costs the taker no gas, else straight from
   * the wallet. Entries and exits take the same path. The router re-verifies everything; a quote that expired or was
   * taken meanwhile reverts the whole transaction and nothing is left behind.
   */
  async settleFirmQuote(
    intent: PackageOrderIntent,
    quote: FirmQuote,
    onUpdate: (update: SubmissionUpdate) => void,
  ): Promise<PackageExecutionResult> {
    const { setryn, address, walletClient, publicClient } = await this.connected();
    const router = setryn.quoteSettlementRouter;
    if (!router) throw new Error("FIRM_QUOTES_UNAVAILABLE");
    const market = runtimeMarketByKey(setryn, intent.marketId);
    if (!market) throw new Error("MARKET_NOT_ONCHAIN_ENABLED");
    if (quote.marketId !== intent.marketId) throw new Error("QUOTE_MARKET_MISMATCH");
    if (intent.recipient.toLowerCase() !== address.toLowerCase()) throw new Error("RECIPIENT_MISMATCH");
    const action = executableAction(intent.side, intent.packageSide);
    if ((action === "BUY") !== (quote.side === "ASK")) throw new Error("QUOTE_SIDE_MISMATCH");
    if (!Number.isInteger(intent.lots) || intent.lots < 1 || intent.lots > quote.lots) throw new Error("QUOTE_SIZE_EXCEEDED");
    if (Number.isFinite(intent.limitPrice) && (action === "BUY" ? quote.price > intent.limitPrice : quote.price < intent.limitPrice)) {
      throw new Error("ORDER_NOT_MARKETABLE");
    }
    if (!quoteExecutable(quote, platformNow())) throw new Error("QUOTE_EXPIRED");

    const accountId = await this.accountId(address);
    if (intent.accountId.toLowerCase() !== accountId.toLowerCase()) throw new Error("ACCOUNT_MISMATCH");
    const exit = intent.side === "EXIT";
    // An exit names the position in the signed terms; the router closes it with the fill's mirror in the same
    // transaction, so the fill must mirror it exactly: same series, the whole size, this account against the quote's
    // maker on the opposite side. Checked here first, so a quote that cannot close it is never signed against.
    const closePositionId = exit ? ((intent.closePositionId ?? "") as Hex) : EMPTY_ID;
    if (exit) {
      if (!/^0x[0-9a-fA-F]{64}$/.test(closePositionId)) throw new Error("CLOSE_POSITION_REQUIRED");
      if (!quote.allowsOffsetUnwind) throw new Error("QUOTE_EXIT_NOT_ALLOWED");
      const closing = await publicClient.readContract({
        address: setryn.positionEngine,
        abi: positionLifecycleAbi,
        functionName: "getLifecyclePosition",
        args: [closePositionId],
      });
      const holdsLong = closing.longAccountId.toLowerCase() === accountId.toLowerCase();
      const holdsShort = closing.shortAccountId.toLowerCase() === accountId.toLowerCase();
      const counterparty = holdsLong ? closing.shortAccountId : closing.longAccountId;
      if (closing.positionLots === BigInt(0)) throw new Error("CLOSE_POSITION_NOT_FOUND");
      if (closing.seriesId.toLowerCase() !== market.seriesId.toLowerCase() || (!holdsLong && !holdsShort)) {
        throw new Error("CLOSE_POSITION_MISMATCH");
      }
      if ((holdsLong ? "LONG" : "SHORT") !== intent.packageSide) throw new Error("CLOSE_POSITION_MISMATCH");
      if (counterparty.toLowerCase() !== quote.makerAccountId.toLowerCase()) throw new Error("EXIT_COUNTERPARTY_NOT_MAKER");
      if (closing.positionLots !== BigInt(intent.lots)) throw new Error("FULL_POSITION_EXIT_REQUIRED");
      // The closing fill is margined like any fill before both positions close, so its side's liability must be free.
      const exitLiability = Number(formatUnits(
        BigInt(intent.lots) * BigInt(action === "BUY" ? market.maxLongDebitMinorPerLot : market.maxShortDebitMinorPerLot),
        6,
      ));
      if (this.snapshot.account.available + 1e-9 < exitLiability) throw new Error(`EXIT_COLLATERAL_REQUIRED:${exitLiability}`);
    }
    await this.ensureClearingOperators(accountId);
    const fees = await this.refreshFeeSchedule(0);
    if (!fees.active && fees.source === "CHAIN") throw new Error("FEE_SCHEDULE_INACTIVE");
    const versions = marketTradingVersions(fees, market.seriesId);
    if (versions.seriesVersion !== Number(quote.order.targetVersion)) throw new Error("QUOTE_VERSION_STALE");

    const lots = BigInt(intent.lots);
    const priceTicks = BigInt(quote.priceTicks);
    const deadline = BigInt(quote.expiresAt);
    const nonce = BigInt(Date.now()) * BigInt(1_000_000) + BigInt(crypto.getRandomValues(new Uint32Array(1))[0]);
    const feeMinor = this.toMinorUnits(intent.feeCap);
    const order: OnchainPublicOrder = {
      signer: address,
      accountId,
      policyId: PUBLIC_SERIES_POLICY,
      policyContextHash: keccak256(stringToHex(`${intent.marketId}:FIRM_QUOTE:${intent.packageSide}:FOK:${intent.settlementGuarantee}`)),
      actionId: setryn.enterActionId,
      targetKind: 1,
      seriesId: market.seriesId,
      packageId: EMPTY_ID,
      targetVersion: versions.seriesVersion,
      side: action === "BUY" ? 1 : 2,
      lots,
      priceTicks,
      timeInForce: 4,
      deadline,
      executionModeId: setryn.executionModeId,
      feeScheduleId: setryn.feeScheduleId,
      feeScheduleVersion: versions.feeScheduleVersion,
      maxFeeMinor: feeMinor > BigInt(0) ? feeMinor : BigInt(1),
      recipient: address,
      permittedExecutor: setryn.atomicClearingEngine,
      nonce,
      salt: keccak256(stringToHex(`${address}:${nonce}:${intent.marketId}:${crypto.randomUUID()}`)),
      allowPartialFills: false,
      minimumFillLots: lots,
      remainderPolicy: 2,
      postOnly: false,
      reduceOnly: false,
    };
    const orderDomain = setrynDomain(setryn.chainId, setryn.orderState);
    const orderHash = hashTypedData({ domain: orderDomain, types: publicOrderTypedData, primaryType: "PublicOrder", message: order });
    const orderSignature = await walletClient.signTypedData({
      account: address,
      domain: orderDomain,
      types: publicOrderTypedData,
      primaryType: "PublicOrder",
      message: order,
    });
    // No relayer is named and no fee is offered, so the same signatures settle through Setryn's relayer, any other
    // relayer, or the wallet itself.
    const terms: TakerSettlementTerms = {
      quoteOrderHash: quote.id,
      relayer: ZERO_ADDRESS,
      relayerAccountId: EMPTY_ID,
      maxRelayerFeeMinor: BigInt(0),
      closePositionId,
    };
    const perLot = BigInt(action === "BUY" ? market.maxLongDebitMinorPerLot : market.maxShortDebitMinorPerLot);
    const risk: OrderRiskAuthorization = {
      orderHash,
      accountId,
      riskDomainId: setryn.riskDomainId,
      riskDomainVersion: 1,
      maxOpenInterestBaseUnits: lots,
      maxTerminalLiabilityBaseUnits: lots * perLot,
      maxAdmissionDeadline: deadline + BigInt(60),
      binder: router,
      binderTerms: takerSettlementTermsHash(terms),
      nonce,
      deadline,
    };
    const riskSignature = await walletClient.signTypedData({
      account: address,
      domain: setrynDomain(setryn.chainId, setryn.riskAdmissionBindingRegistry),
      types: orderRiskAuthorizationTypes,
      primaryType: "SetrynOrderRiskAuthorizationV1",
      message: risk,
    });
    const authorized: SubmissionUpdate = {
      step: "AUTHORIZED",
      label: "Order signed",
      detail: "Your fill-or-kill order and its risk authorization are signed as typed data. No transaction yet.",
    };
    onUpdate(authorized);

    const settlement: QuoteSettlementArgs = {
      quote: {
        order: parsePublicOrder(quote.order),
        orderSignature: quote.orderSignature,
        risk: parseRiskAuthorization(quote.risk),
        riskSignature: quote.riskSignature,
        terms: { capacityId: quote.capacityId, allowsOffsetUnwind: quote.allowsOffsetUnwind },
      },
      taker: { order, orderSignature, risk, riskSignature, terms },
      fillLots: lots,
      relayerFeeMinor: BigInt(0),
      payoffTerms: market.payoffTerms,
    };
    let transactionHash: Hex | null = null;
    try {
      const response = await fetch("/api/quotes/settle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(serializeQuoteSettlement(settlement)),
      });
      const body = (await response.json().catch(() => null)) as { transactionHash?: unknown; reason?: unknown } | null;
      if (response.ok && typeof body?.transactionHash === "string" && /^0x[0-9a-fA-F]{64}$/.test(body.transactionHash)) {
        transactionHash = body.transactionHash as Hex;
      } else if (response.status === 422) {
        // The router itself refused it in simulation; the wallet would only pay to see the same revert.
        throw new Error(`SETTLEMENT_REJECTED:${typeof body?.reason === "string" ? body.reason : "REVERTED"}`);
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("SETTLEMENT_REJECTED")) throw error;
    }
    const relayed = transactionHash !== null;
    if (!transactionHash) {
      transactionHash = await walletClient.writeContract({
        account: address,
        chain: this.chain(setryn),
        address: router,
        abi: quoteSettlementRouterAbi,
        functionName: "settle",
        args: [settlement],
      });
    }
    const submitted: SubmissionUpdate = {
      step: "SUBMITTED",
      label: relayed ? "Settlement relayed" : "Settlement submitted",
      detail: relayed
        ? "Setryn's relayer submitted your signed settlement; it pays the gas."
        : "Submitted from your wallet: one transaction settles both sides.",
      transactionHash,
    };
    onUpdate(submitted);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: transactionHash });
    if (receipt.status !== "success") throw new Error("SETTLEMENT_REVERTED");
    const settled = parseEventLogs({ abi: quoteSettlementRouterAbi, eventName: "QuoteSettled", logs: receipt.logs, strict: true });
    const positionEvents = parseEventLogs({ abi: atomicClearingAbi, eventName: "FillPositionCreated", logs: receipt.logs, strict: true });
    const fillId = settled[0]?.args.fillId;
    const positionId = positionEvents[0]?.args.positionId;
    if (!fillId || !positionId) throw new Error("CLEARING_EVIDENCE_MISSING");
    const included: SubmissionUpdate = {
      step: "INCLUDED",
      label: "Settlement included",
      detail: exit
        ? "The closing fill and the close of both positions settled atomically in one transaction."
        : "Both signed orders, both risk admissions and the maker's capacity settled atomically in one transaction.",
      transactionHash,
    };
    onUpdate(included);
    const authorization: SignedOrderAuthorization = {
      orderHash,
      signature: orderSignature,
      signer: address,
      nonce: nonce.toString(),
      deadline: new Date(Number(deadline) * 1000).toISOString(),
      intent,
      onchainOrder: order,
      riskAdmissionId: settled[0].args.receipt.takerAdmissionId,
    };
    this.authorizations.set(orderHash.toLowerCase(), authorization);
    return this.recordFill({
      authorization,
      order,
      market,
      fillId,
      positionId,
      executionPriceTicks: priceTicks,
      filledLots: intent.lots,
      requestedLots: intent.lots,
      transactionHash,
      logs: receipt.logs,
      routeLabel: "Firm maker quote",
      leadingUpdates: [authorized, submitted, included],
      closedInTransaction: exit,
      onUpdate,
    });
  }

  /**
   * A fill locks the taker's collateral twice: the clearing engine reserves consideration and the position engine
   * reserves terminal liability. Both must be approved lock operators on the account (once per account, as for the
   * maker); a missing approval is given here, which is the only transaction an order may need before it is signed.
   */
  private async ensureClearingOperators(accountId: Hex): Promise<void> {
    const { setryn, address, walletClient, publicClient } = await this.connected();
    for (const operator of [setryn.atomicClearingEngine, setryn.positionEngine]) {
      const approved = await publicClient.readContract({
        address: setryn.collateralVault,
        abi: vaultAbi,
        functionName: "isLockOperator",
        args: [accountId, operator],
      });
      if (approved) continue;
      const approvalHash = await walletClient.writeContract({
        account: address,
        chain: this.chain(setryn),
        address: setryn.collateralVault,
        abi: vaultAbi,
        functionName: "setLockOperator",
        args: [accountId, operator, true],
      });
      const approvalReceipt = await publicClient.waitForTransactionReceipt({ hash: approvalHash });
      if (approvalReceipt.status !== "success") throw new Error("CLEARING_APPROVAL_FAILED");
    }
  }

  /**
   * Records a cleared fill the same way for every route (the public book and firm quotes): an exit first unwinds both
   * positions with the maker's consent; then the position, the fees paid, the receipt and the execution steps are
   * published to the snapshot and the account reads refresh.
   */
  private async recordFill(fill: {
    authorization: SignedOrderAuthorization;
    order: OnchainPublicOrder;
    market: SetrynRuntimeMarket;
    fillId: Hex;
    positionId: Hex;
    executionPriceTicks: bigint;
    filledLots: number;
    requestedLots: number;
    transactionHash: Hex;
    logs: Log[];
    routeLabel: string;
    leadingUpdates: SubmissionUpdate[];
    /** An exit the router already closed in the fill's own transaction: no follow-up lifecycle step. */
    closedInTransaction?: boolean;
    onUpdate: (update: SubmissionUpdate) => void;
  }): Promise<PackageExecutionResult> {
    const {
      authorization,
      order,
      market,
      fillId,
      positionId,
      executionPriceTicks,
      filledLots,
      requestedLots,
      transactionHash,
      logs,
      routeLabel,
      leadingUpdates,
      closedInTransaction = false,
      onUpdate,
    } = fill;
    const executionPrice = ticksToPrice(market, executionPriceTicks);
    const packageSide = authorization.intent.packageSide;
    const createdPositionSide: "LONG" | "SHORT" = order.side === 1 ? "LONG" : "SHORT";
    let lifecycleHash: Hex | null = null;
    if (authorization.intent.side === "EXIT" && !closedInTransaction) {
      if (!authorization.intent.closePositionId) throw new Error("CLOSE_POSITION_REQUIRED");
      onUpdate({
        step: "POSITION_UPDATED",
        label: "Close hedge filled",
        detail: "The opposite-side fill is complete. Releasing both position liabilities.",
        transactionHash,
      });
      lifecycleHash = await this.completeFullExit(
        authorization.intent.closePositionId as Hex,
        positionId,
      );
    }
    const position = {
      id: positionId,
      marketId: authorization.intent.marketId,
      side: createdPositionSide,
      lots: filledLots,
      entryPrice: executionPrice,
      collateral: positionCollateral(market, createdPositionSide, filledLots),
      state: "ACTIVE" as const,
      createdAt: new Date().toISOString(),
    };
    const ledgerEvents = parseEventLogs({ abi: atomicClearingAbi, eventName: "FillLedgerEntry", logs, strict: true });
    const feeEvents = parseEventLogs({
      abi: fundedFeeLedgerAbi,
      eventName: "FeeLedgerEntryRecorded",
      logs: logs,
      strict: true,
    });
    const takerFeeMinor = (ledgerEvents.find(
      (event) => event.args.fillId === fillId && event.args.kind === 3,
    )?.args.amount ?? BigInt(0)) + accountFeesPaidMinor(feeEvents, order.accountId);
    const closedPosition = authorization.intent.side === "EXIT"
      ? this.snapshot.positions.find((candidate) => candidate.id === authorization.intent.closePositionId) ?? null
      : null;
    const realizedPnlUsd = closedPosition
      ? await this.exitRealizedPnlUsd(closedPosition.id, fillId, ledgerEvents)
      : undefined;
    const receipt: ExecutionReceipt = {
      id: fillId,
      orderHash: authorization.orderHash,
      fillId,
      transactionHash,
      marketId: authorization.intent.marketId,
      packageCode: authorization.intent.packageCode,
      packageSide,
      routeLabel,
      lots: filledLots,
      requestedLots,
      filledLots,
      cancelledLots: order.timeInForce === 3 || order.timeInForce === 4 ? requestedLots - filledLots : 0,
      price: executionPrice,
      fees: Number(formatUnits(takerFeeMinor, 6)),
      realizedPnlUsd,
      collateralReleasedUsd: closedPosition ? closedPosition.collateral + position.collateral : undefined,
      guarantee: "Atomic onchain settlement",
      evidence: this.snapshot.environment.evidence,
      createdAt: new Date().toISOString(),
    };
    const result: PackageExecutionResult = {
      fillId,
      outcome: authorization.intent.side === "EXIT" ? "CLOSED" : "OPENED",
      requestedLots,
      filledLots,
      cancelledLots: receipt.cancelledLots,
      position: authorization.intent.side === "EXIT" ? null : position,
      closedPositionId: authorization.intent.side === "EXIT" ? authorization.intent.closePositionId : null,
      closedLots: authorization.intent.side === "EXIT" ? filledLots : 0,
      receipt,
    };
    const updates: SubmissionUpdate[] = [
      ...leadingUpdates,
      { step: "FILLED", label: "Package filled", detail: `${formatLotCount(filledLots)} filled at ${formatTicksPrice(market, executionPrice)}.`, transactionHash },
      authorization.intent.side === "EXIT"
        ? {
            step: "POSITION_CLOSED",
            label: "Position closed",
            detail: closedInTransaction
              ? "Your position and the closing fill's mirror were closed in the same transaction; both liabilities are released."
              : "Original and close-fill positions were fully unwound onchain.",
            transactionHash: lifecycleHash ?? transactionHash,
          }
        : { step: "POSITION_CREATED", label: "Position created", detail: `Position ${positionId} is active.`, transactionHash },
      { step: "RECEIPT_READY", label: "Receipt ready", detail: `Fill ${fillId} is verifiable onchain.`, transactionHash },
    ];
    const execution = { id: fillId, orderHash: authorization.orderHash, updates, result, createdAt: receipt.createdAt };
    this.publish({
      ...this.snapshot,
      positions: authorization.intent.side === "EXIT"
        ? this.snapshot.positions.filter((candidate) => candidate.id !== authorization.intent.closePositionId)
        : [...this.snapshot.positions, position],
      receipts: [...this.snapshot.receipts, receipt],
      executions: [...this.snapshot.executions, execution],
    });
    await Promise.all([this.refreshAccount(), this.refreshOrders(), this.refreshPublicBook(), this.refreshActivity()]);
    return result;
  }

  async placeRestingOrder(authorization: SignedOrderAuthorization): Promise<RestingPackageOrder> {
    if (authorization.intent.side === "EXIT") throw new Error("EXIT_REQUIRES_FIRM_QUOTE");
    const { setryn, address, walletClient, publicClient } = await this.connected();
    const order = authorization.onchainOrder;
    if (!order || !authorization.riskAdmissionId) throw new Error("INVALID_ONCHAIN_AUTHORIZATION");
    if (authorization.signer.toLowerCase() !== address.toLowerCase()) throw new Error("SIGNER_MISMATCH");
    if (order.timeInForce !== 1 && order.timeInForce !== 2) throw new Error("RESTING_TIME_IN_FORCE_REQUIRED");

    const registrationHash = await walletClient.writeContract({
      account: address,
      chain: this.chain(setryn),
      address: setryn.orderState,
      abi: orderStateAbi,
      functionName: "registerSignedOrder",
      args: [order, authorization.signature as Hex],
    });
    const registrationReceipt = await publicClient.waitForTransactionReceipt({ hash: registrationHash });
    if (registrationReceipt.status !== "success") throw new Error("ORDER_REGISTRATION_FAILED");

    const bookId = deriveSeriesBookId(setryn, this.orderMarket(setryn, order).seriesId, {
      seriesVersion: order.targetVersion,
      feeScheduleVersion: order.feeScheduleVersion,
    });
    const hint = await this.levelHint(bookId, order.side, order.priceTicks);
    // The book may have moved since the ticket was priced. A resting order that would now cross is rejected, so the
    // registered order is cancelled rather than left open without a place on the book.
    try {
      await publicClient.simulateContract({
        account: address,
        address: setryn.publicOrderBook,
        abi: publicOrderBookAbi,
        functionName: "placeSeriesOrder",
        args: [authorization.orderHash as Hex, hint],
      });
    } catch (error) {
      const reverted = error instanceof BaseError
        ? error.walk((cause) => cause instanceof ContractFunctionRevertedError)
        : null;
      const errorName = reverted instanceof ContractFunctionRevertedError ? reverted.data?.errorName : undefined;
      if (errorName === "PostOnlyWouldCross" || errorName === "RestingOrderWouldCross") {
        await this.cancelUnmatchedOrder(authorization);
        throw new Error(errorName === "PostOnlyWouldCross" ? "POST_ONLY_WOULD_CROSS" : "RESTING_ORDER_WOULD_CROSS");
      }
      throw error;
    }
    const placementHash = await walletClient.writeContract({
      account: address,
      chain: this.chain(setryn),
      address: setryn.publicOrderBook,
      abi: publicOrderBookAbi,
      functionName: "placeSeriesOrder",
      args: [authorization.orderHash as Hex, hint],
    });
    const placementReceipt = await publicClient.waitForTransactionReceipt({ hash: placementHash });
    if (placementReceipt.status !== "success") throw new Error("ORDER_PLACEMENT_FAILED");

    const now = new Date().toISOString();
    const restingOrder: RestingPackageOrder = {
      id: authorization.orderHash,
      orderHash: authorization.orderHash,
      accountId: authorization.intent.accountId,
      marketId: authorization.intent.marketId,
      packageCode: authorization.intent.packageCode,
      routeId: authorization.intent.routeId,
      routeLabel: authorization.intent.routeLabel,
      side: authorization.intent.side,
      packageSide: authorization.intent.packageSide,
      postOnly: authorization.intent.postOnly === true,
      lots: authorization.intent.lots,
      filledLots: 0,
      remainingLots: authorization.intent.lots,
      limitPrice: authorization.intent.limitPrice,
      timeInForce: authorization.intent.timeInForce,
      expiresAt: authorization.deadline,
      collateralReservation: authorization.intent.collateralRequired,
      remainingCollateralReservation: authorization.intent.collateralRequired,
      feeCap: authorization.intent.feeCap,
      remainingFeeCap: authorization.intent.feeCap,
      fillIds: [],
      receiptIds: [],
      closePositionId: authorization.intent.closePositionId,
      replacesOrderId: authorization.intent.replacesOrderId,
      createdAt: now,
      state: "WORKING",
      orderType: authorization.intent.orderType,
      contractMultiplier: authorization.intent.contractMultiplier,
      settlementGuarantee: authorization.intent.settlementGuarantee,
      disclosure: authorization.intent.disclosure,
      recipient: authorization.intent.recipient,
      collateralRequired: authorization.intent.collateralRequired,
    };
    this.publish({ ...this.snapshot, restingOrders: [...this.snapshot.restingOrders, restingOrder] });
    await Promise.all([this.refreshAccount(), this.refreshPublicBook()]);
    return restingOrder;
  }

  async replaceRestingOrder(
    oldOrderId: string,
    authorization: SignedOrderAuthorization,
  ): Promise<RestingPackageOrder> {
    if (authorization.intent.side === "EXIT") throw new Error("EXIT_REQUIRES_FIRM_QUOTE");
    const cancelled = await this.cancelRestingOrder(oldOrderId);
    const replacement = await this.placeRestingOrder(authorization);
    const replacedAt = new Date().toISOString();
    const replaced = { ...cancelled, state: "REPLACED" as const, replacedByOrderId: replacement.id, replacedAt };
    this.publish({
      ...this.snapshot,
      restingOrders: this.snapshot.restingOrders.map((order) => (order.id === oldOrderId ? replaced : order)),
    });
    return replacement;
  }

  async cancelRestingOrder(orderId: string): Promise<RestingPackageOrder> {
    const { setryn, address, walletClient, publicClient } = await this.connected();
    const current = this.snapshot.restingOrders.find((order) => order.id === orderId);
    if (!current) throw new Error("RESTING_ORDER_NOT_FOUND");
    if (current.state !== "WORKING" && current.state !== "PARTIALLY_FILLED") {
      throw new Error("RESTING_ORDER_NOT_WORKING");
    }
    const authorization = this.authorizations.get(current.orderHash.toLowerCase());
    if (!authorization?.onchainOrder || !authorization.riskAdmissionId) {
      throw new Error("ORDER_AUTHORIZATION_UNAVAILABLE");
    }
    const orderHash = current.orderHash as Hex;
    const cancelHash = await walletClient.writeContract({
      account: address,
      chain: this.chain(setryn),
      address: setryn.orderState,
      abi: orderStateAbi,
      functionName: "cancelOrder",
      args: [orderHash],
    });
    const cancelReceipt = await publicClient.waitForTransactionReceipt({ hash: cancelHash });
    if (cancelReceipt.status !== "success") throw new Error("ORDER_CANCELLATION_FAILED");
    const syncHash = await walletClient.writeContract({
      account: address,
      chain: this.chain(setryn),
      address: setryn.publicOrderBook,
      abi: publicOrderBookAbi,
      functionName: "syncOrder",
      args: [orderHash],
    });
    const syncReceipt = await publicClient.waitForTransactionReceipt({ hash: syncHash });
    if (syncReceipt.status !== "success") throw new Error("ORDER_BOOK_SYNC_FAILED");
    await this.releaseRiskReservation(authorization);

    const cancelled: RestingPackageOrder = {
      ...current,
      state: "CANCELLED",
      remainingCollateralReservation: 0,
      remainingFeeCap: 0,
      cancelledAt: new Date().toISOString(),
    };
    this.publish({
      ...this.snapshot,
      restingOrders: this.snapshot.restingOrders.map((order) => (order.id === orderId ? cancelled : order)),
    });
    await Promise.all([this.refreshAccount(), this.refreshPublicBook()]);
    return cancelled;
  }

  reconcileRestingOrders(): RestingPackageOrder[] {
    return this.snapshot.restingOrders;
  }

  async requestRfq(authorization: SignedOrderAuthorization): Promise<RfqRequest> {
    if (authorization.intent.side === "EXIT") throw new Error("EXIT_REQUIRES_FIRM_QUOTE");
    const { setryn, address, walletClient, publicClient } = await this.connected();
    if (authorization.intent.disclosure !== "PRIVATE_RFQ") throw new Error("PRIVATE_RFQ_AUTHORIZATION_REQUIRED");
    if (authorization.signer.toLowerCase() !== address.toLowerCase()) throw new Error("SIGNER_MISMATCH");
    const order = authorization.onchainOrder;
    const registrationHash = await walletClient.writeContract({
      account: address,
      chain: this.chain(setryn),
      address: setryn.orderState,
      abi: orderStateAbi,
      functionName: "registerSignedOrder",
      args: [order, authorization.signature as Hex],
    });
    const registrationReceipt = await publicClient.waitForTransactionReceipt({ hash: registrationHash });
    if (registrationReceipt.status !== "success") throw new Error("ORDER_REGISTRATION_FAILED");

    const nonce = BigInt(Date.now()) * BigInt(1_000_000) + BigInt(crypto.getRandomValues(new Uint32Array(1))[0]);
    const request: OnchainPrivateRfqRequest = {
      taker: address,
      takerAccountId: order.accountId,
      takerOrderHash: authorization.orderHash as Hex,
      targetKind: 1,
      seriesId: this.orderMarket(setryn, order).seriesId,
      packageId: EMPTY_ID,
      targetVersion: order.targetVersion,
      hasPackageLegCommitment: false,
      packageLegsHash: EMPTY_ID,
      sidePolicy: order.side === 1 ? 1 : 2,
      lots: order.lots,
      allowPartialFills: order.allowPartialFills,
      minimumFillLots: order.minimumFillLots,
      remainderPolicy: order.remainderPolicy,
      feeScheduleId: order.feeScheduleId,
      feeScheduleVersion: order.feeScheduleVersion,
      maxFeeMinor: order.maxFeeMinor,
      riskDomainId: setryn.riskDomainId,
      riskDomainVersion: 1,
      privacyModeId: setryn.privateRfqPrivacyModeId,
      executionModeId: setryn.privateRfqExecutionModeId,
      disclosurePolicyHash: setryn.privateRfqDisclosurePolicyHash,
      eligibleMakerSetHash: setryn.privateRfqEligibleMakerSetHash,
      deadline: order.deadline,
      permittedExecutor: setryn.atomicClearingEngine,
      nonce,
      salt: keccak256(stringToHex(`${authorization.orderHash}:${nonce}:rfq`)),
    };
    const signature = await walletClient.signTypedData({
      account: address,
      domain: { name: "Setryn", version: "1", chainId: setryn.chainId, verifyingContract: setryn.privateRfqBook },
      types: privateRfqRequestTypedData,
      primaryType: "PrivateRfqRequest",
      message: request,
    });
    const rfqId = await publicClient.readContract({
      address: setryn.privateRfqBook,
      abi: privateRfqBookAbi,
      functionName: "hashRequest",
      args: [request],
    });
    const registerHash = await walletClient.writeContract({
      account: address,
      chain: this.chain(setryn),
      address: setryn.privateRfqBook,
      abi: privateRfqBookAbi,
      functionName: "registerRequest",
      args: [request, [], signature],
    });
    await publicClient.waitForTransactionReceipt({ hash: registerHash });
    const openHash = await walletClient.writeContract({
      account: address,
      chain: this.chain(setryn),
      address: setryn.privateRfqBook,
      abi: privateRfqBookAbi,
      functionName: "openCollection",
      args: [rfqId],
    });
    await publicClient.waitForTransactionReceipt({ hash: openHash });
    // The designated maker, where one runs, answers at once from the live reference. Without it (or when it declines,
    // for example on a stale reference) the request stays open onchain for other makers and can be cancelled.
    const quotes: RfqRequest["quotes"] = [];
    if ((await this.operatorStatus()).makerEnabled) {
      const quoteResponse = await fetch("/api/internal/operator/rfq-quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rfqId }),
      }).catch(() => null);
      const quoteBody = ((await quoteResponse?.json().catch(() => null)) ?? {}) as {
        quoteId?: string;
        packagePrice?: number;
        feeCap?: number;
        capacityLots?: number;
        expiresAt?: string;
      };
      if (quoteResponse?.ok && quoteBody.quoteId && quoteBody.expiresAt) {
        quotes.push({
          id: quoteBody.quoteId,
          solverLabel: "Setryn MM",
          packagePrice: quoteBody.packagePrice ?? authorization.intent.executionPrice,
          feeCap: quoteBody.feeCap ?? authorization.intent.feeCap,
          capacityLots: quoteBody.capacityLots ?? authorization.intent.lots,
          expiresAt: quoteBody.expiresAt,
          settlementGuarantee: "Firm capacity, atomic onchain settlement",
          provenance: "SEEDED_SOLVER",
        });
      }
    }
    const created: RfqRequest = {
      id: rfqId,
      authorization,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Number(request.deadline) * 1000).toISOString(),
      state: "OPEN",
      selectedQuoteId: null,
      receiptId: null,
      quotes,
    };
    this.publish({ ...this.snapshot, rfqRequests: [...this.snapshot.rfqRequests, created] });
    return created;
  }

  async selectRfqQuote(requestId: string, quoteId: string): Promise<RfqRequest> {
    const { setryn, address, walletClient, publicClient } = await this.connected();
    const current = this.snapshot.rfqRequests.find((request) => request.id === requestId);
    if (!current || current.state !== "OPEN") throw new Error("RFQ_NOT_OPEN");
    if (current.authorization.intent.side === "EXIT") throw new Error("EXIT_REQUIRES_FIRM_QUOTE");
    const selectedQuote = current.quotes.find((quote) => quote.id === quoteId);
    if (!selectedQuote) throw new Error("RFQ_QUOTE_NOT_FOUND");
    const block = await publicClient.getBlock({ blockTag: "pending" });
    // The selection may not outlive the request or the quote it selects, so its deadline is the earliest of the three.
    const deadline = [
      block.timestamp + BigInt(90),
      BigInt(Math.floor(Date.parse(current.expiresAt) / 1000)),
      BigInt(Math.floor(Date.parse(selectedQuote.expiresAt) / 1000)),
    ].reduce((earliest, candidate) => (candidate < earliest ? candidate : earliest));
    if (deadline <= block.timestamp) throw new Error("RFQ_QUOTE_EXPIRED");
    const nonce = BigInt(Date.now()) * BigInt(1_000_000) + BigInt(crypto.getRandomValues(new Uint32Array(1))[0]);
    const selection: OnchainRfqSelection = {
      rfqId: requestId as Hex,
      quoteId: quoteId as Hex,
      taker: address,
      executor: setryn.atomicClearingEngine,
      nonce,
      deadline,
      salt: keccak256(stringToHex(`${requestId}:${quoteId}:${nonce}`)),
    };
    const signature = await walletClient.signTypedData({
      account: address,
      domain: { name: "Setryn", version: "1", chainId: setryn.chainId, verifyingContract: setryn.privateRfqBook },
      types: rfqSelectionTypedData,
      primaryType: "RfqSelectionAuthorization",
      message: selection,
    });
    const selectionHash = await walletClient.writeContract({
      account: address,
      chain: this.chain(setryn),
      address: setryn.privateRfqBook,
      abi: privateRfqBookAbi,
      functionName: "lockSelection",
      args: [selection, signature],
    });
    await publicClient.waitForTransactionReceipt({ hash: selectionHash });
    const capacityHash = await walletClient.writeContract({
      account: address,
      chain: this.chain(setryn),
      address: setryn.privateRfqBook,
      abi: privateRfqBookAbi,
      functionName: "confirmSelectedCapacity",
      args: [requestId as Hex],
    });
    await publicClient.waitForTransactionReceipt({ hash: capacityHash });
    const authorizationHash = await walletClient.writeContract({
      account: address,
      chain: this.chain(setryn),
      address: setryn.privateRfqBook,
      abi: privateRfqBookAbi,
      functionName: "authorizeSubmission",
      args: [requestId as Hex],
    });
    await publicClient.waitForTransactionReceipt({ hash: authorizationHash });
    const submissionHash = await walletClient.writeContract({
      account: address,
      chain: this.chain(setryn),
      address: setryn.privateRfqBook,
      abi: privateRfqBookAbi,
      functionName: "submitSelectedRfq",
      args: [requestId as Hex, keccak256(stringToHex(`${requestId}:submitted`))],
    });
    const submissionReceipt = await publicClient.waitForTransactionReceipt({ hash: submissionHash });
    if (submissionReceipt.status !== "success") throw new Error("RFQ_SELECTION_FAILED");
    const selected = { ...current, state: "SELECTED" as const, selectedQuoteId: quoteId };
    this.publish({
      ...this.snapshot,
      rfqRequests: this.snapshot.rfqRequests.map((request) => request.id === requestId ? selected : request),
    });
    return selected;
  }

  async executeSelectedRfq(
    requestId: string,
    onUpdate: (update: SubmissionUpdate) => void,
  ): Promise<PackageExecutionResult> {
    const current = this.snapshot.rfqRequests.find((request) => request.id === requestId);
    if (!current || current.state !== "SELECTED" || !current.selectedQuoteId) throw new Error("RFQ_NOT_SELECTED");
    if (current.authorization.intent.side === "EXIT") throw new Error("EXIT_REQUIRES_FIRM_QUOTE");
    const quote = current.quotes.find((candidate) => candidate.id === current.selectedQuoteId);
    if (!quote) throw new Error("RFQ_QUOTE_NOT_FOUND");
    onUpdate({
      step: "AUTHORIZED",
      label: "RFQ authorized",
      detail: "The selected firm quote and capacity reservation are locked onchain.",
    });
    onUpdate({
      step: "SUBMITTED",
      label: "Private handoff submitted",
      detail: "The selected RFQ is being cleared through the private execution channel.",
    });
    const response = await fetch("/api/internal/operator/rfq-execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rfqId: requestId }),
    });
    const body = (await response.json()) as {
      fillId?: string;
      positionId?: string;
      transactionHash?: string;
      executionPriceTicks?: string;
      fillLots?: string;
      takerFeeMinor?: string;
      error?: string;
    };
    if (
      !response.ok ||
      !body.fillId ||
      !body.positionId ||
      !body.transactionHash ||
      body.executionPriceTicks === undefined ||
      body.fillLots === undefined ||
      body.takerFeeMinor === undefined
    ) {
      throw new Error(body.error ?? "RFQ_EXECUTION_FAILED");
    }
    const authorization = current.authorization;
    const setryn = await this.runtime();
    const packageSide = authorization.intent.packageSide;
    const createdPositionSide: "LONG" | "SHORT" = authorization.onchainOrder.side === 1 ? "LONG" : "SHORT";
    const market = this.orderMarket(setryn, authorization.onchainOrder);
    const filledLots = Number(body.fillLots);
    const executionPrice = ticksToPrice(market, BigInt(body.executionPriceTicks));
    let lifecycleHash: Hex | null = null;
    if (authorization.intent.side === "EXIT") {
      if (!authorization.intent.closePositionId) throw new Error("CLOSE_POSITION_REQUIRED");
      onUpdate({
        step: "POSITION_UPDATED",
        label: "Close hedge filled",
        detail: "The private close fill is complete. Releasing both position liabilities.",
        transactionHash: body.transactionHash,
      });
      lifecycleHash = await this.completeFullExit(
        authorization.intent.closePositionId as Hex,
        body.positionId as Hex,
      );
    }
    const position = {
      id: body.positionId,
      marketId: authorization.intent.marketId,
      side: createdPositionSide,
      lots: filledLots,
      entryPrice: executionPrice,
      collateral: positionCollateral(market, createdPositionSide, filledLots),
      state: "ACTIVE" as const,
      createdAt: new Date().toISOString(),
    };
    const closedPosition = authorization.intent.side === "EXIT"
      ? this.snapshot.positions.find((candidate) => candidate.id === authorization.intent.closePositionId) ?? null
      : null;
    let realizedPnlUsd: number | undefined;
    if (closedPosition && this.publicClient) {
      const exitReceipt = await this.publicClient.getTransactionReceipt({ hash: body.transactionHash as Hex });
      const exitLedgerEvents = parseEventLogs({
        abi: atomicClearingAbi,
        eventName: "FillLedgerEntry",
        logs: exitReceipt.logs,
        strict: true,
      });
      realizedPnlUsd = await this.exitRealizedPnlUsd(closedPosition.id, body.fillId as Hex, exitLedgerEvents);
    }
    const receipt: ExecutionReceipt = {
      id: body.fillId,
      orderHash: authorization.orderHash,
      fillId: body.fillId,
      transactionHash: body.transactionHash,
      marketId: authorization.intent.marketId,
      packageCode: authorization.intent.packageCode,
      packageSide,
      routeLabel: "Private firm RFQ",
      lots: filledLots,
      requestedLots: authorization.intent.lots,
      filledLots,
      cancelledLots: authorization.intent.lots - filledLots,
      price: executionPrice,
      fees: Number(formatUnits(BigInt(body.takerFeeMinor), 6)),
      realizedPnlUsd,
      collateralReleasedUsd: closedPosition ? closedPosition.collateral + position.collateral : undefined,
      guarantee: "Firm capacity, atomic onchain settlement",
      evidence: this.snapshot.environment.evidence,
      createdAt: new Date().toISOString(),
    };
    const result: PackageExecutionResult = {
      fillId: body.fillId,
      outcome: authorization.intent.side === "EXIT" ? "CLOSED" : "OPENED",
      requestedLots: authorization.intent.lots,
      filledLots,
      cancelledLots: receipt.cancelledLots,
      position: authorization.intent.side === "EXIT" ? null : position,
      closedPositionId: authorization.intent.side === "EXIT" ? authorization.intent.closePositionId : null,
      closedLots: authorization.intent.side === "EXIT" ? filledLots : 0,
      receipt,
    };
    const updates: SubmissionUpdate[] = [
      { step: "AUTHORIZED", label: "RFQ authorized", detail: "Selected quote and capacity were locked onchain." },
      { step: "SUBMITTED", label: "Private handoff submitted", detail: "The RFQ entered private channel clearing." },
      { step: "INCLUDED", label: "Handoff included", detail: "The RFQ handoff cleared atomically.", transactionHash: body.transactionHash },
      { step: "FILLED", label: "Package filled", detail: `${formatLotCount(filledLots)} filled at ${formatTicksPrice(market, executionPrice)}.`, transactionHash: body.transactionHash },
      authorization.intent.side === "EXIT"
        ? { step: "POSITION_CLOSED", label: "Position closed", detail: "Original and close-fill positions were fully unwound onchain.", transactionHash: lifecycleHash ?? body.transactionHash }
        : { step: "POSITION_CREATED", label: "Position created", detail: `Position ${body.positionId} is active.`, transactionHash: body.transactionHash },
      { step: "RECEIPT_READY", label: "Receipt ready", detail: `Fill ${body.fillId} is verifiable onchain.`, transactionHash: body.transactionHash },
    ];
    for (const update of updates.slice(2)) onUpdate(update);
    const executed = { ...current, state: "EXECUTED" as const, receiptId: receipt.id };
    const execution = {
      id: body.fillId,
      orderHash: authorization.orderHash,
      updates,
      result,
      createdAt: receipt.createdAt,
    };
    this.publish({
      ...this.snapshot,
      positions: authorization.intent.side === "EXIT"
        ? this.snapshot.positions.filter((candidate) => candidate.id !== authorization.intent.closePositionId)
        : [...this.snapshot.positions, position],
      receipts: [...this.snapshot.receipts, receipt],
      executions: [...this.snapshot.executions, execution],
      rfqRequests: this.snapshot.rfqRequests.map((request) => request.id === requestId ? executed : request),
    });
    await Promise.all([this.refreshAccount(), this.refreshOrders(), this.refreshActivity()]);
    return result;
  }

  async cancelRfq(requestId: string): Promise<RfqRequest> {
    const { setryn, address, walletClient, publicClient } = await this.connected();
    const current = this.snapshot.rfqRequests.find((request) => request.id === requestId);
    if (!current || (current.state !== "OPEN" && current.state !== "SELECTED")) throw new Error("RFQ_NOT_OPEN");
    const expired = Date.parse(current.expiresAt) <= platformNow();
    if (current.state === "SELECTED" && !expired) throw new Error("RFQ_SELECTION_LOCKED");
    const hash = await walletClient.writeContract({
      account: address,
      chain: this.chain(setryn),
      address: setryn.privateRfqBook,
      abi: privateRfqBookAbi,
      functionName: expired ? "expireRfq" : "cancelRfq",
      args: [requestId as Hex],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    await this.releaseRiskReservation(current.authorization);
    const cancelled = { ...current, state: "CANCELLED" as const };
    this.publish({
      ...this.snapshot,
      rfqRequests: this.snapshot.rfqRequests.map((request) => request.id === requestId ? cancelled : request),
    });
    return cancelled;
  }

  async submitLocalMakerQuote(_requestId: string, _input: LocalMakerQuoteInput): Promise<RfqRequest> {
    const current = this.snapshot.rfqRequests.find((request) => request.id === _requestId);
    if (!current) throw new Error("RFQ_NOT_FOUND");
    if (current.state !== "OPEN") throw new Error("RFQ_NOT_OPEN");
    if (!(await this.operatorStatus()).makerEnabled) throw new Error("MAKER_SIGNER_UNCONFIGURED");
    const response = await fetch("/api/internal/operator/rfq-quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rfqId: _requestId, ..._input }),
    });
    const body = (await response.json()) as {
      quoteId?: string;
      packagePrice?: number;
      feeCap?: number;
      capacityLots?: number;
      expiresAt?: string;
      error?: string;
    };
    if (!response.ok || !body.quoteId || body.packagePrice === undefined || body.feeCap === undefined || body.capacityLots === undefined || !body.expiresAt) {
      throw new Error(body.error ?? "RFQ_QUOTE_FAILED");
    }
    const quote = {
      id: body.quoteId,
      solverLabel: "Setryn MM",
      packagePrice: body.packagePrice,
      feeCap: body.feeCap,
      capacityLots: body.capacityLots,
      expiresAt: body.expiresAt,
      settlementGuarantee: "Firm capacity, atomic onchain settlement",
      provenance: "DESIGNATED_MAKER" as const,
    };
    const updated = { ...current, quotes: [...current.quotes, quote] };
    this.publish({
      ...this.snapshot,
      rfqRequests: this.snapshot.rfqRequests.map((request) => request.id === _requestId ? updated : request),
    });
    return updated;
  }

  async withdrawLocalMakerQuote(_requestId: string): Promise<RfqRequest> {
    const current = this.snapshot.rfqRequests.find((request) => request.id === _requestId);
    if (!current) throw new Error("RFQ_NOT_FOUND");
    if (current.state !== "OPEN") throw new Error("RFQ_NOT_OPEN");
    const quote = [...current.quotes].reverse().find((candidate) => candidate.provenance === "DESIGNATED_MAKER");
    if (!quote) throw new Error("RFQ_QUOTE_NOT_FOUND");
    const response = await fetch("/api/internal/operator/rfq-withdraw", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quoteId: quote.id }),
    });
    const body = (await response.json()) as { error?: string };
    if (!response.ok) throw new Error(body.error ?? "QUOTE_WITHDRAWAL_FAILED");
    const updated = { ...current, quotes: current.quotes.filter((candidate) => candidate.id !== quote.id) };
    this.publish({
      ...this.snapshot,
      rfqRequests: this.snapshot.rfqRequests.map((request) => request.id === _requestId ? updated : request),
    });
    return updated;
  }

  getReceipt(receiptId: string): ExecutionReceipt | null {
    return this.snapshot.receipts.find((receipt) => receipt.id === receiptId) ?? null;
  }

  private async initialize(): Promise<SetrynRuntime> {
    const setryn = await loadSetrynRuntime();
    this.setryn = setryn;
    this.publicClient = createPublicClient({ chain: this.chain(setryn), transport: http(setryn.rpcUrl) });
    const [head, fees] = await Promise.all([
      this.publicClient.getBlock({ blockTag: "pending" }),
      readActiveFeeSchedule(setryn, { client: this.publicClient }),
    ]);
    this.observeChainClock(head.timestamp);
    this.publish({
      ...this.snapshot,
      environment: {
        ...networkEnvironment(runtimeNetwork(setryn)),
        chainId: setryn.chainId,
        settlementTokenMintable: setryn.settlementTokenMintable === true || runtimeNetwork(setryn) === "local",
      },
      ...this.feeScheduleProjection(setryn, fees),
    });
    return setryn;
  }

  /** Every market's economics and book under one fee schedule reading. */
  private feeScheduleProjection(setryn: SetrynRuntime, fees: ActiveFeeSchedule): Pick<GatewaySnapshot, "publicBookMarketId" | "publicBookEconomics" | "onchainMarkets" | "feeSchedule"> {
    return {
      publicBookMarketId: setryn.markets[0].marketKey,
      publicBookEconomics: marketEconomics(setryn.markets[0], fees),
      feeSchedule: fees,
      onchainMarkets: Object.fromEntries(
        setryn.markets.map((market): [string, OnchainMarket] => [
          market.marketKey,
          {
            ...marketEconomics(market, fees),
            marketKey: market.marketKey,
            seriesId: market.seriesId,
            bookId: deriveSeriesBookId(setryn, market.seriesId, marketTradingVersions(fees, market.seriesId)),
            priceScale: market.priceScale,
            priceOffset: priceOffset(market),
            priceDecimals: marketPriceDecimals(market),
          },
        ]),
      ),
    };
  }

  /**
   * Re-reads the active fee schedule (cached for 15 s unless `maxAgeMs` asks for fresher) and republishes every market's
   * economics when the version or a rate moved, so estimates, fee caps and books follow a schedule change.
   */
  private async refreshFeeSchedule(maxAgeMs?: number): Promise<ActiveFeeSchedule> {
    const setryn = await this.runtime();
    const fees = await readActiveFeeSchedule(setryn, { client: this.publicClient ?? undefined, maxAgeMs });
    const current = this.snapshot.feeSchedule;
    const changed =
      !current ||
      current.version !== fees.version ||
      current.active !== fees.active ||
      current.source !== fees.source ||
      current.makerFeeRatePpm !== fees.makerFeeRatePpm ||
      current.takerFeeRatePpm !== fees.takerFeeRatePpm ||
      current.maker.flatChargeMinor !== fees.maker.flatChargeMinor ||
      current.taker.flatChargeMinor !== fees.taker.flatChargeMinor ||
      JSON.stringify(current.markets) !== JSON.stringify(fees.markets);
    if (changed) this.publish({ ...this.snapshot, ...this.feeScheduleProjection(setryn, fees) });
    return fees;
  }

  /** The pending block carries the chain's current time, so one reading fixes the chain-to-browser offset. */
  private observeChainClock(timestampSeconds: bigint): void {
    const offsetMs = Number(timestampSeconds) * 1000 - Date.now();
    setChainClockOffset(offsetMs);
    // Head timestamps have one-second resolution, so only a real shift is republished.
    if (Math.abs(offsetMs - this.snapshot.chainClockOffsetMs) > 2_000) {
      this.publish({ ...this.snapshot, chainClockOffsetMs: offsetMs });
    }
  }

  private runtime(): Promise<SetrynRuntime> {
    // A failed load (for example an RPC outage) is retried on the next call instead of being cached.
    this.runtimePromise ??= this.initialize().catch((error: unknown) => {
      this.runtimePromise = null;
      throw error;
    });
    return this.runtimePromise;
  }

  /** The onchain market an order trades, from the series it names. */
  private orderMarket(setryn: SetrynRuntime, order: Pick<OnchainPublicOrder, "seriesId">): SetrynRuntimeMarket {
    const market = runtimeMarketBySeries(setryn, order.seriesId);
    if (!market) throw new Error("UNSUPPORTED_ONCHAIN_MARKET");
    return market;
  }

  /**
   * Which platform roles can sign here. Read from /api/internal/operator/status, whose role section is present even
   * when the chain check fails; locally the maker is always the runtime operator.
   */
  private operatorStatus(): Promise<OperatorStatus> {
    const cached = this.operatorStatusRead;
    if (cached && Date.now() - cached.at < OPERATOR_STATUS_TTL_MS) return cached.status;
    const status = (async (): Promise<OperatorStatus> => {
      const setryn = await this.runtime();
      const local = runtimeNetwork(setryn) === "local";
      const fallback: OperatorStatus = local
        ? { makerEnabled: true, makerAddress: getAddress(setryn.operator) }
        : { makerEnabled: false, makerAddress: null };
      const response = await fetch("/api/internal/operator/status", { cache: "no-store" }).catch(() => null);
      const body = (await response?.json().catch(() => null)) as { maker?: { enabled?: unknown; address?: unknown } } | null;
      const maker = body?.maker;
      if (!maker || typeof maker.enabled !== "boolean") throw Object.assign(new Error("OPERATOR_STATUS_UNAVAILABLE"), { fallback });
      const address = typeof maker.address === "string" && isAddress(maker.address) ? getAddress(maker.address) : null;
      return { makerEnabled: maker.enabled && address !== null, makerAddress: address };
    })().catch((error: unknown) => {
      // An unreadable status is not cached, so the next use asks again.
      this.operatorStatusRead = null;
      const fallback = (error as { fallback?: OperatorStatus } | null)?.fallback;
      return fallback ?? { makerEnabled: false, makerAddress: null };
    });
    this.operatorStatusRead = { at: Date.now(), status };
    return status;
  }

  private chain(setryn: SetrynRuntime) {
    return networkChain(runtimeNetwork(setryn), setryn.rpcUrl);
  }

  /** Event scans start at the deployment's first block rather than genesis. */
  private fromBlock(): bigint {
    return BigInt(this.setryn?.deploymentBlock ?? 0);
  }

  private async connected() {
    const setryn = await this.runtime();
    // A wallet on another chain has no signing client, so the wrong network is reported before a missing wallet.
    if (this.snapshot.wallet.status === "WRONG_NETWORK") throw new Error("WRONG_NETWORK");
    if (!this.walletAddress || !this.walletClient || !this.publicClient || this.snapshot.wallet.status !== "CONNECTED") {
      throw new Error("CONNECT_WALLET");
    }
    return {
      setryn,
      address: this.walletAddress,
      walletClient: this.walletClient,
      publicClient: this.publicClient,
    };
  }

  private async accountId(address: Address): Promise<Hex> {
    if (!this.setryn || !this.publicClient) throw new Error("RUNTIME_UNAVAILABLE");
    return this.publicClient.readContract({
      address: this.setryn.collateralVault,
      abi: vaultAbi,
      functionName: "deriveAccountId",
      args: [address, ACCOUNT_SALT],
    });
  }

  private async refreshAccount(): Promise<void> {
    if (!this.setryn || !this.publicClient || !this.walletAddress) return;
    const accountId = await this.accountId(this.walletAddress);
    const collateralId = await this.publicClient.readContract({
      address: this.setryn.collateralVault,
      abi: vaultAbi,
      functionName: "deriveCollateralId",
      args: [this.setryn.settlementAssetId, 1],
    });
    const exists = await this.publicClient.readContract({
      address: this.setryn.collateralVault,
      abi: vaultAbi,
      functionName: "accountExists",
      args: [accountId],
    });
    const [total, locked, available] = exists
      ? await this.publicClient.readContract({
          address: this.setryn.collateralVault,
          abi: vaultAbi,
          functionName: "balanceOf",
          args: [accountId, collateralId],
        })
      : ([BigInt(0), BigInt(0), BigInt(0)] as const);
    const posted = Number(formatUnits(total, 6));
    const reserved = Number(formatUnits(locked, 6));
    const free = Number(formatUnits(available, 6));
    this.publish({
      ...this.snapshot,
      account: {
        id: accountId,
        label: "Primary account",
        riskDomain: RISK_DOMAIN_LABEL,
        collateralAsset: COLLATERAL_ASSET,
        posted,
        eligible: posted,
        reserved,
        available: free,
        equity: posted,
      },
    });
  }

  private async refreshOrders(): Promise<void> {
    if (!this.setryn || !this.publicClient || !this.walletAddress) return;
    const logs = await this.publicClient.getContractEvents({
      address: this.setryn.orderState,
      abi: orderStateAbi,
      eventName: "OrderRegistered",
      args: { signer: this.walletAddress },
      fromBlock: this.fromBlock(),
      toBlock: "latest",
    });
    const orders: RestingPackageOrder[] = [];
    for (const log of logs) {
      const orderHash = log.args.orderHash;
      if (!orderHash) continue;
      const record = await this.publicClient.readContract({
        address: this.setryn.orderState,
        abi: orderStateAbi,
        functionName: "getOrder",
        args: [orderHash],
      });
      const market = runtimeMarketBySeries(this.setryn, record.order.seriesId);
      if (!market) continue;
      const admissionId = await this.publicClient.readContract({
        address: this.setryn.riskAdmissionBindingRegistry,
        abi: riskBindingAbi,
        functionName: "admissionForOrder",
        args: [orderHash],
      });
      const admission = admissionId === EMPTY_ID
        ? null
        : await this.publicClient.readContract({
            address: this.setryn.portfolioRiskEngine,
            abi: riskEngineAbi,
            functionName: "getAdmission",
            args: [admissionId],
          });
      const now = BigInt(Math.floor(platformNow() / 1000));
      const state = this.restingState(record.status, record.order.deadline <= now);
      const packageSide = record.order.side === 1 ? "LONG" : "SHORT";
      // An all-or-none RFQ order signs as GTD with no partial fills; it reads back as the FOK the user chose.
      const timeInForce = record.order.timeInForce === 2
        ? record.order.allowPartialFills === false && record.order.executionModeId === this.setryn?.privateRfqExecutionModeId ? "FOK" : "GTD"
        : record.order.timeInForce === 3
          ? "IOC"
          : record.order.timeInForce === 4
            ? "FOK"
            : "GTC";
      const lots = Number(record.order.lots);
      const filledLots = Number(record.filledLots);
      const limitPrice = ticksToPrice(market, record.order.priceTicks);
      const collateralRequired = admission
        ? Number(formatUnits(admission.terminalLiabilityBaseUnits, 6))
        : 0;
      const feeCap = Number(formatUnits(record.order.maxFeeMinor, 6));
      const intent: PackageOrderIntent = {
        accountId: record.order.accountId,
        marketId: market.marketKey,
        packageCode: market.marketKey,
        routeId: "DIRECT_BOOK",
        routeLabel: "Direct package book",
        side: "ENTER",
        packageSide,
        lots,
        fillLots: lots,
        limitPrice,
        executionPrice: limitPrice,
        contractMultiplier: considerationPerPriceUnit(market),
        orderType: "LIMIT",
        timeInForce,
        expiresAt: new Date(Number(record.order.deadline) * 1000).toISOString(),
        feeCap,
        collateralRequired,
        closePositionId: null,
        replacesOrderId: null,
        recipient: record.order.recipient,
        disclosure: "PUBLIC",
        settlementGuarantee: "Package atomic",
      };
      const authorization: SignedOrderAuthorization = {
        orderHash,
        signature: "0x",
        signer: record.order.signer,
        nonce: record.order.nonce.toString(),
        deadline: new Date(Number(record.order.deadline) * 1000).toISOString(),
        intent,
        onchainOrder: record.order as OnchainPublicOrder,
        riskAdmissionId: admissionId,
      };
      this.authorizations.set(orderHash.toLowerCase(), authorization);
      orders.push({
        id: orderHash,
        orderHash,
        accountId: record.order.accountId,
        marketId: market.marketKey,
        packageCode: market.marketKey,
        routeId: intent.routeId,
        routeLabel: intent.routeLabel,
        side: "ENTER",
        packageSide,
        lots,
        filledLots,
        remainingLots: lots - filledLots,
        limitPrice,
        timeInForce,
        expiresAt: intent.expiresAt,
        collateralReservation: collateralRequired,
        remainingCollateralReservation: state === "WORKING" || state === "PARTIALLY_FILLED" ? collateralRequired : 0,
        feeCap,
        remainingFeeCap: state === "WORKING" || state === "PARTIALLY_FILLED" ? feeCap : 0,
        fillIds: [],
        receiptIds: [],
        closePositionId: null,
        replacesOrderId: null,
        createdAt: new Date(Number(record.registeredAt) * 1000).toISOString(),
        state,
        orderType: "LIMIT",
        postOnly: record.order.postOnly,
        contractMultiplier: intent.contractMultiplier,
        settlementGuarantee: intent.settlementGuarantee,
        disclosure: "PUBLIC",
        recipient: record.order.recipient,
        collateralRequired,
      });
    }
    orders.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    this.publish({ ...this.snapshot, restingOrders: this.linkOrderFills(orders) });
  }

  /** Attaches reconstructed fills and receipts to orders, and marks an order whose fill closed a position as an exit. */
  private linkOrderFills(orders: RestingPackageOrder[]): RestingPackageOrder[] {
    return orders.map((order) => {
      const fills = this.orderFills.get(order.orderHash.toLowerCase());
      if (!fills) return order;
      const exit = fills.closedPositionId
        ? {
            side: "EXIT" as const,
            // The ticket names an exit by the side of the position it closes, not the side of the offsetting order.
            packageSide: order.packageSide === "LONG" ? ("SHORT" as const) : ("LONG" as const),
            closePositionId: fills.closedPositionId,
          }
        : {};
      return {
        ...order,
        ...exit,
        fillIds: fills.fillIds,
        receiptIds: fills.receiptIds,
        receiptId: fills.receiptIds[fills.receiptIds.length - 1],
      };
    });
  }

  /** Reads every onchain market's resting public book in one pass over the book's rest events. */
  private async refreshPublicBook(): Promise<void> {
    const setryn = this.setryn;
    const publicClient = this.publicClient;
    if (!setryn || !publicClient) return;
    // Books are keyed by series and fee schedule version; only the active versions' book can still clear.
    const fees = await this.refreshFeeSchedule();
    const marketsByBook = new Map(
      setryn.markets.map((market) => [
        deriveSeriesBookId(setryn, market.seriesId, marketTradingVersions(fees, market.seriesId)).toLowerCase(),
        market,
      ]),
    );
    const [events, block] = await Promise.all([
      publicClient.getContractEvents({
        address: setryn.publicOrderBook,
        abi: publicOrderBookAbi,
        eventName: "DirectOrderRested",
        fromBlock: this.fromBlock(),
        toBlock: "latest",
      }),
      publicClient.getBlock({ blockTag: "pending" }),
    ]);
    this.observeChainClock(block.timestamp);
    const candidates = new Map<string, SetrynRuntimeMarket>();
    for (const event of events) {
      const orderHash = event.args.orderHash;
      const market = event.args.bookId ? marketsByBook.get(event.args.bookId.toLowerCase()) : undefined;
      if (!orderHash || !market || this.retiredBookOrders.has(orderHash.toLowerCase())) continue;
      candidates.set(orderHash, market);
    }
    const books: Record<string, BookRow[]> = Object.fromEntries(setryn.markets.map((market) => [market.marketKey, []]));
    await Promise.all(
      [...candidates].map(async ([orderHash, market]) => {
        const [bookOrder, orderRecord] = await Promise.all([
          publicClient.readContract({
            address: setryn.publicOrderBook,
            abi: publicOrderBookAbi,
            functionName: "getBookOrder",
            args: [orderHash as Hex],
          }),
          publicClient.readContract({
            address: setryn.orderState,
            abi: orderStateAbi,
            functionName: "getOrder",
            args: [orderHash as Hex],
          }),
        ]);
        if (
          bookOrder.status !== 1 ||
          (orderRecord.status !== 1 && orderRecord.status !== 2) ||
          orderRecord.order.deadline <= block.timestamp
        ) {
          this.retiredBookOrders.add(orderHash.toLowerCase());
          return;
        }
        books[market.marketKey].push({
          id: `onchain-${orderHash}`,
          side: bookOrder.side === 1 ? "BID" : "ASK",
          source: "DIRECT",
          price: ticksToPrice(market, bookOrder.priceTicks),
          lots: Number(bookOrder.remainingLots),
          firmness: "FIRM",
          executable: true,
          origin: "Setryn public book",
        });
      }),
    );
    for (const rows of Object.values(books)) {
      rows.sort((left, right) => left.side === right.side
        ? left.side === "BID" ? right.price - left.price : left.price - right.price
        : left.side === "ASK" ? -1 : 1);
    }
    const primary = setryn.markets[0].marketKey;
    this.publish({
      ...this.snapshot,
      publicBookMarketId: primary,
      publicBookOrders: books[primary] ?? [],
      publicBooks: books,
    });
  }

  /** Realized PnL of a full exit: the account's net consideration over the fill that opened the position and the close fill. */
  private async exitRealizedPnlUsd(
    closePositionId: string,
    exitFillId: Hex,
    exitLedgerEvents: readonly LedgerFlow[],
  ): Promise<number | undefined> {
    if (!this.setryn || !this.publicClient || !this.walletAddress) return undefined;
    const entryExecution = this.snapshot.executions.find(
      (execution) => execution.result?.position?.id === closePositionId,
    );
    const entryFillId = entryExecution?.result?.fillId as Hex | undefined;
    const entryTransactionHash = entryExecution?.result?.receipt.transactionHash as Hex | undefined;
    if (!entryFillId || !entryTransactionHash) return undefined;
    const accountId = await this.accountId(this.walletAddress);
    const entryReceipt = await this.publicClient.getTransactionReceipt({ hash: entryTransactionHash });
    const entryLedgerEvents = parseEventLogs({
      abi: atomicClearingAbi,
      eventName: "FillLedgerEntry",
      logs: entryReceipt.logs,
      strict: true,
    });
    return netConsiderationUsd(entryLedgerEvents, entryFillId, accountId)
      + netConsiderationUsd(exitLedgerEvents, exitFillId, accountId);
  }

  private async refreshActivity(): Promise<void> {
    if (!this.setryn || !this.publicClient || !this.walletAddress) return;
    const accountId = await this.accountId(this.walletAddress);
    const router = this.setryn.quoteSettlementRouter;
    const [positionEvents, ledgerEvents, quantityEvents, feeEvents, quoteEvents] = await Promise.all([
      this.publicClient.getContractEvents({
        address: this.setryn.atomicClearingEngine,
        abi: atomicClearingAbi,
        eventName: "FillPositionCreated",
        fromBlock: this.fromBlock(),
        toBlock: "latest",
      }),
      this.publicClient.getContractEvents({
        address: this.setryn.atomicClearingEngine,
        abi: atomicClearingAbi,
        eventName: "FillLedgerEntry",
        fromBlock: this.fromBlock(),
        toBlock: "latest",
      }),
      this.publicClient.getContractEvents({
        address: this.setryn.positionEngine,
        abi: positionLifecycleAbi,
        eventName: "PositionQuantityChanged",
        fromBlock: this.fromBlock(),
        toBlock: "latest",
      }),
      this.publicClient.getContractEvents({
        address: this.setryn.fundedFeeEngine,
        abi: fundedFeeLedgerAbi,
        eventName: "FeeLedgerEntryRecorded",
        fromBlock: this.fromBlock(),
        toBlock: "latest",
      }),
      router
        ? this.publicClient.getContractEvents({
            address: router,
            abi: quoteSettlementRouterAbi,
            eventName: "QuoteSettled",
            fromBlock: this.fromBlock(),
            toBlock: "latest",
          })
        : Promise.resolve([]),
    ]);
    // Fills the quote settlement router cleared keep their own route and timeline when rebuilt from the chain.
    const firmQuoteFills = new Set(
      quoteEvents.flatMap((event) => (event.args.fillId ? [event.args.fillId.toLowerCase()] : [])),
    );
    // A full exit closes the original position and the close-fill position in one lifecycle action, so both carry the
    // same transition reference on the event that takes them to zero remaining lots.
    const closings = new Map<string, { reference: Hex; transactionHash: Hex }>();
    const closedByReference = new Map<string, string[]>();
    for (const event of quantityEvents) {
      const { positionId, remainingLots, transitionReference } = event.args;
      if (!positionId || !transitionReference || remainingLots !== BigInt(0)) continue;
      const key = positionId.toLowerCase();
      closings.set(key, { reference: transitionReference, transactionHash: event.transactionHash });
      closedByReference.set(transitionReference, [...(closedByReference.get(transitionReference) ?? []), key]);
    }
    const fills = [];
    for (const positionEvent of positionEvents) {
      const fillId = positionEvent.args.fillId;
      const positionId = positionEvent.args.positionId;
      if (!fillId || !positionId) continue;
      const fill = await this.publicClient.readContract({
        address: this.setryn.atomicClearingEngine,
        abi: atomicClearingAbi,
        functionName: "getFill",
        args: [fillId],
      });
      const positionStatus = await this.publicClient.readContract({
        address: this.setryn.positionEngine,
        abi: positionLifecycleAbi,
        functionName: "positionStatus",
        args: [positionId],
      });
      // Fixing and settlement-ready positions still hold their exposure and terminal reservation, so they stay open.
      const positionLive = OPEN_POSITION_STATUSES.includes(positionStatus);
      const [makerRecord, takerRecord] = await Promise.all([
        this.publicClient.readContract({
          address: this.setryn.orderState,
          abi: orderStateAbi,
          functionName: "getOrder",
          args: [fill.makerOrderHash],
        }),
        this.publicClient.readContract({
          address: this.setryn.orderState,
          abi: orderStateAbi,
          functionName: "getOrder",
          args: [fill.takerOrderHash],
        }),
      ]);
      const isTaker = takerRecord.order.accountId.toLowerCase() === accountId.toLowerCase();
      const isMaker = makerRecord.order.accountId.toLowerCase() === accountId.toLowerCase();
      if (!isTaker && !isMaker) continue;
      const ownRecord = isTaker ? takerRecord : makerRecord;
      const ownOrderHash = isTaker ? fill.takerOrderHash : fill.makerOrderHash;
      const filledLots = Number(fill.fillLots);
      const requestedLots = isTaker ? Number(ownRecord.order.lots) : filledLots;
      const packageSide: "LONG" | "SHORT" = ownRecord.order.side === 1 ? "LONG" : "SHORT";
      const market = runtimeMarketBySeries(this.setryn, positionEvent.args.seriesId ?? fill.targetId);
      if (!market) continue;
      const price = ticksToPrice(market, fill.executionPriceTicks);
      const ownFeeKind = isTaker ? 3 : 2;
      // Fees are charged by the funded fee engine in the fill's transaction, or on the clearing ledger when funded
      // from a direct fee lock.
      const feeMinor = (ledgerEvents.find(
        (event) =>
          event.args.fillId === fillId &&
          event.args.kind === ownFeeKind &&
          event.args.payerAccountId?.toLowerCase() === accountId.toLowerCase(),
      )?.args.amount ?? BigInt(0)) + accountFeesPaidMinor(
        feeEvents.filter((event) => event.transactionHash === positionEvent.transactionHash),
        accountId,
      );
      const createdAt = new Date(Number(fill.clearedAt) * 1000).toISOString();
      const position = {
        id: positionId,
        marketId: market.marketKey,
        side: packageSide,
        lots: filledLots,
        entryPrice: price,
        collateral: positionCollateral(market, packageSide, filledLots),
        state: "ACTIVE" as const,
        createdAt,
      };
      const cancelledLots = isTaker && (ownRecord.order.timeInForce === 3 || ownRecord.order.timeInForce === 4)
        ? requestedLots - Number(ownRecord.filledLots)
        : 0;
      fills.push({
        fillId,
        positionId,
        positionLive,
        positionStatus,
        market,
        ownOrderHash,
        requestedLots,
        filledLots,
        cancelledLots,
        packageSide,
        price,
        feeMinor,
        createdAt,
        position,
        channelKind: fill.channelKind,
        firmQuote: firmQuoteFills.has(fillId.toLowerCase()),
        transactionHash: positionEvent.transactionHash,
      });
    }
    // Pair each exit fill with the position it closed: the earlier fill opened it, the later one hedged it out.
    const fillByPosition = new Map(fills.map((record, index) => [record.positionId.toLowerCase(), { record, index }]));
    const closedBy = new Map<string, { exit: (typeof fills)[number]; transactionHash: Hex }>();
    const closes = new Map<string, { entry: (typeof fills)[number]; transactionHash: Hex }>();
    for (const [positionKey, closing] of closings) {
      const own = fillByPosition.get(positionKey);
      if (!own || closedBy.has(positionKey) || closes.has(positionKey)) continue;
      const peerKey = closedByReference.get(closing.reference)?.find((candidate) => candidate !== positionKey);
      const peer = peerKey ? fillByPosition.get(peerKey) : undefined;
      if (!peer || peer.record.packageSide === own.record.packageSide) continue;
      const [entry, exit] = own.index < peer.index ? [own.record, peer.record] : [peer.record, own.record];
      closedBy.set(entry.positionId.toLowerCase(), { exit, transactionHash: closing.transactionHash });
      closes.set(exit.positionId.toLowerCase(), { entry, transactionHash: closing.transactionHash });
    }
    // Positions that were not unwound by an exit reach their end through the terminal lifecycle: fixing, holder
    // election, settlement, lapse or a terminal claim. Their onchain state is read once per refresh.
    const terminal = await this.readLifecycles(
      accountId,
      fills.filter((record) => !closedBy.has(record.positionId.toLowerCase()) && !closes.has(record.positionId.toLowerCase())),
      ledgerEvents,
    ).catch(() => new Map<string, TerminalRead>());
    const positions = [] as GatewaySnapshot["positions"];
    const receipts = [] as GatewaySnapshot["receipts"];
    const executions = [] as GatewaySnapshot["executions"];
    const orderFills = new Map<string, { fillIds: string[]; receiptIds: string[]; closedPositionId: string | null }>();
    for (const record of fills) {
      const { fillId, positionId, positionLive, market, filledLots, price, position, transactionHash } = record;
      const closedEntry = closes.get(positionId.toLowerCase());
      const terminalRead = terminal.get(positionId.toLowerCase());
      const terminalOutcome = terminalRead && (terminalRead.view.settlement || terminalRead.exerciseTransactionHash)
        ? terminalRead
        : null;
      const openedAndClosed = closedBy.has(positionId.toLowerCase()) || terminalOutcome !== null;
      const entry = closedEntry?.entry;
      const receipt: ExecutionReceipt = {
        id: fillId,
        orderHash: record.ownOrderHash,
        fillId,
        transactionHash,
        marketId: market.marketKey,
        packageCode: market.marketKey,
        packageSide: record.packageSide,
        routeLabel: record.firmQuote ? "Firm maker quote" : record.channelKind === 2 ? "Private firm RFQ" : "Direct package book",
        lots: filledLots,
        requestedLots: record.requestedLots,
        filledLots,
        cancelledLots: record.cancelledLots,
        price,
        fees: Number(formatUnits(record.feeMinor, 6)),
        realizedPnlUsd: entry
          ? netConsiderationUsd(ledgerEvents, entry.fillId, accountId) + netConsiderationUsd(ledgerEvents, fillId, accountId)
          : undefined,
        collateralReleasedUsd: entry ? entry.position.collateral + position.collateral : undefined,
        guarantee: "Atomic onchain settlement",
        evidence: this.snapshot.environment.evidence,
        createdAt: record.createdAt,
      };
      const positionUpdate: SubmissionUpdate = closedEntry
        ? {
            step: "POSITION_CLOSED",
            label: "Position closed",
            detail: closedEntry.transactionHash.toLowerCase() === transactionHash.toLowerCase()
              ? "Your position and the closing fill's mirror were closed in the same transaction; both liabilities are released."
              : "Original and close-fill positions were fully unwound onchain.",
            transactionHash: closedEntry.transactionHash,
          }
        : positionLive || openedAndClosed
          ? { step: "POSITION_CREATED", label: "Position created", detail: `Position ${positionId} ${positionLive ? "is active" : "was opened"}.`, transactionHash }
          : { step: "POSITION_CLOSED", label: "Position closed", detail: `Position ${positionId} reached a terminal lifecycle state.`, transactionHash };
      const updates: SubmissionUpdate[] = [
        ...(record.firmQuote
          ? [
              { step: "AUTHORIZED", label: "Order signed", detail: "The fill-or-kill order and its risk authorization were signed as typed data." },
              { step: "SUBMITTED", label: "Settlement submitted", detail: "One router transaction settled both sides.", transactionHash },
              {
                step: "INCLUDED",
                label: "Settlement included",
                detail: "Both signed orders, both risk admissions and the maker's capacity settled atomically in one transaction.",
                transactionHash,
              },
            ] satisfies SubmissionUpdate[]
          : ([
              { step: "AUTHORIZED", label: "Order authorized", detail: "Signature and risk admission were bound." },
              { step: "SUBMITTED", label: "Order registered", detail: "Signed order registered onchain." },
              { step: "INCLUDED", label: "Match included", detail: `${receipt.routeLabel} cleared atomically.`, transactionHash },
            ] satisfies SubmissionUpdate[])),
        { step: "FILLED", label: "Package filled", detail: `${formatLotCount(filledLots)} filled at ${formatTicksPrice(market, price)}.`, transactionHash },
        positionUpdate,
        { step: "RECEIPT_READY", label: "Receipt ready", detail: `Fill ${fillId} is verifiable onchain.`, transactionHash },
      ];
      if (positionLive) positions.push(position);
      receipts.push(receipt);
      const opened = !closedEntry && (positionLive || openedAndClosed);
      const links = orderFills.get(record.ownOrderHash.toLowerCase()) ?? { fillIds: [], receiptIds: [], closedPositionId: null };
      links.fillIds.push(fillId);
      links.receiptIds.push(receipt.id);
      if (entry) links.closedPositionId = entry.positionId;
      orderFills.set(record.ownOrderHash.toLowerCase(), links);
      executions.push({
        id: fillId,
        orderHash: record.ownOrderHash,
        updates,
        result: {
          fillId,
          outcome: opened ? "OPENED" : "CLOSED",
          requestedLots: record.requestedLots,
          filledLots,
          cancelledLots: record.cancelledLots,
          position: opened ? position : null,
          closedPositionId: opened ? null : entry?.positionId ?? positionId,
          closedLots: opened ? 0 : filledLots,
          receipt,
        },
        createdAt: record.createdAt,
      });
      if (terminalOutcome) {
        const outcome = this.terminalExecution(terminalOutcome, record, market, netConsiderationUsd(ledgerEvents, fillId, accountId));
        receipts.push(outcome.result.receipt);
        executions.push(outcome);
      }
    }
    this.orderFills = orderFills;
    this.publish({
      ...this.snapshot,
      positions,
      receipts,
      executions,
      lifecycles: Object.fromEntries([...terminal].map(([key, read]) => [key, read.view])),
      restingOrders: this.linkOrderFills(this.snapshot.restingOrders),
    });
  }

  /**
   * The receipt and execution of a position's terminal outcome: holder exercise, normal settlement, the terminal
   * fallback, or a lapse. Realized PnL is the consideration the opening fill exchanged plus the terminal transfer.
   */
  private terminalExecution(
    read: TerminalRead,
    opening: { fillId: Hex; ownOrderHash: Hex; packageSide: "LONG" | "SHORT"; price: number },
    market: SetrynRuntimeMarket,
    entryConsiderationUsd: number,
  ): GatewaySnapshot["executions"][number] {
    const { view } = read;
    const settlement = view.settlement;
    const lots = view.lots;
    const transferUsd = view.terminalTransferUsd;
    const realizedPnlUsd = round2(entryConsiderationUsd + transferUsd);
    const exercised = view.exercisedLots > 0;
    const perPoint = lots * considerationPerPriceUnit(market);
    // The settlement price the terminal transfer implies, on the market's own grid. The long of a range forward receives
    // lotSize x clamp(S - floor, 0, cap - floor), so the price is floor + transfer / (lots x lotSize): the clamped fixing.
    const longTransferUsd = opening.packageSide === "LONG" ? transferUsd : -transferUsd;
    const impliedPrice = perPoint > 0
      ? Number((priceOffset(market) + longTransferUsd / perPoint).toFixed(marketPriceDecimals(market)))
      : opening.price;
    const paidUsd = Math.max(0, -transferUsd);
    const collateralReleasedUsd = settlement
      ? round2(settlement.releasedUsd)
      : round2(Math.max(0, positionCollateral(market, opening.packageSide, lots) - paidUsd));
    const routeLabel = settlement
      ? settlement.mode === "NORMAL"
        ? exercised ? "Holder exercise, normal settlement" : "Normal settlement"
        : settlement.mode === "LAPSED" || transferUsd === 0
          ? "Lapsed at final resolution"
          : "Terminal fallback settlement"
      : "Holder exercise";
    const id = settlement?.id ?? read.exerciseTransactionHash ?? view.positionId;
    const transactionHash = read.settlementTransactionHash ?? read.exerciseTransactionHash ?? "";
    const createdAt = settlement ? settlement.finalizedAt : read.exerciseAt !== null ? isoAt(read.exerciseAt) : new Date().toISOString();
    const receipt: ExecutionReceipt = {
      id,
      orderHash: opening.ownOrderHash,
      fillId: id,
      transactionHash,
      marketId: market.marketKey,
      packageCode: market.marketKey,
      packageSide: opening.packageSide,
      routeLabel,
      lots,
      requestedLots: lots,
      filledLots: lots,
      cancelledLots: 0,
      price: impliedPrice,
      fees: 0,
      realizedPnlUsd,
      collateralReleasedUsd,
      guarantee: "Onchain cash settlement",
      evidence: this.snapshot.environment.evidence,
      createdAt,
    };
    const updates: SubmissionUpdate[] = [];
    if (read.exerciseTransactionHash) {
      updates.push({
        step: "SUBMITTED",
        label: "Holder exercised",
        detail: `${formatLotCount(view.exercisedLots)} elected against the final fixing through the signed lifecycle engine.`,
        transactionHash: read.exerciseTransactionHash,
      });
    }
    if (settlement && read.settlementTransactionHash) {
      updates.push({
        step: "INCLUDED",
        label: settlement.mode === "NORMAL" ? "Settlement recorded" : settlement.mode === "LAPSED" ? "Lapse recorded" : "Terminal fallback recorded",
        detail: `Settlement ${settlement.id} written by the cash settlement coordinator.`,
        transactionHash: read.settlementTransactionHash,
      });
    }
    if (settlement?.claim && read.claimTransactionHash) {
      updates.push({
        step: "POSITION_UPDATED",
        label: "Terminal claim fulfilled",
        detail: `Claim ${settlement.claim.id} paid ${settlement.claim.amountUsd.toFixed(2)} USD.`,
        transactionHash: read.claimTransactionHash,
      });
    }
    updates.push({
      step: "POSITION_CLOSED",
      label: view.phase === "LAPSED" ? "Position lapsed" : "Position settled",
      detail: `Realized ${realizedPnlUsd >= 0 ? "+" : "-"}${Math.abs(realizedPnlUsd).toFixed(2)} USD; ${collateralReleasedUsd.toFixed(2)} USD of collateral released.`,
      transactionHash: transactionHash || undefined,
    });
    updates.push({ step: "RECEIPT_READY", label: "Receipt ready", detail: `${routeLabel} is verifiable onchain.`, transactionHash: transactionHash || undefined });
    return {
      id,
      orderHash: opening.ownOrderHash,
      updates,
      result: {
        fillId: id,
        outcome: "CLOSED",
        requestedLots: lots,
        filledLots: lots,
        cancelledLots: 0,
        position: null,
        closedPositionId: view.positionId,
        closedLots: lots,
        receipt,
      },
      createdAt,
    };
  }

  /** Public entry: re-reads positions, receipts and the terminal lifecycle together so they never disagree. */
  async refreshLifecycles(): Promise<void> {
    await this.runtime();
    await Promise.all([this.refreshActivity(), this.refreshAccount()]);
  }

  /**
   * Series schedule and qualified fixing slots, reconstructed once per series version from its qualification event. A
   * fee change re-versions every series, and each position keeps the exact version it was opened on, so every read
   * names that version: its schedule, its fixing slots and its fixings (FixingEngine keys fixings by series version).
   */
  private seriesTerminal(seriesId: Hex, version: number): Promise<SeriesTerminal> {
    const key = `${seriesId.toLowerCase()}:${version}`;
    const cached = this.seriesTerminals.get(key);
    if (cached) return cached;
    const load = (async () => {
      const setryn = this.setryn;
      const publicClient = this.publicClient;
      if (!setryn || !publicClient) throw new Error("RUNTIME_UNAVAILABLE");
      const registry = setryn.seriesRegistry;
      if (!registry || !isAddress(registry)) throw new Error("SERIES_REGISTRY_UNAVAILABLE");
      const [series, events] = await Promise.all([
        publicClient.readContract({ address: registry, abi: seriesRegistryAbi, functionName: "getSeries", args: [seriesId, version] }),
        publicClient.getContractEvents({
          address: registry,
          abi: seriesRegistryAbi,
          eventName: "SeriesQualificationPublished",
          args: { seriesId, version },
          fromBlock: this.fromBlock(),
          toBlock: "latest",
        }),
      ]);
      const qualification = events[events.length - 1]?.args.qualification;
      if (!qualification) throw new Error("SERIES_QUALIFICATION_UNAVAILABLE");
      const definition = series.definition;
      return {
        lastTradingAt: definition.lastTradingAt,
        fixingWindowOpen: definition.fixingWindowOpen,
        fixingWindowClose: definition.fixingWindowClose,
        exerciseOpensAt: definition.exerciseOpensAt,
        exerciseCutoffAt: definition.exerciseCutoffAt,
        correctionCutoffAt: definition.correctionCutoffAt,
        finalResolutionAt: definition.finalResolutionAt,
        settlementDeadline: definition.settlementDeadline,
        exercisePolicyId: definition.exercisePolicyId,
        slots: qualification.fixingSlots.map((slot) => ({ slot: slot.slot, candidates: slot.candidates.map((candidate) => ({ ...candidate })) })),
      };
    })();
    this.seriesTerminals.set(key, load);
    load.catch(() => this.seriesTerminals.delete(key));
    return load;
  }

  /** The series fixing, slot by slot: the final result where one exists, otherwise the open proposal. */
  private async seriesFixing(seriesId: Hex, version: number, series: SeriesTerminal): Promise<SeriesFixingRead> {
    const setryn = this.setryn;
    const publicClient = this.publicClient;
    const fixingEngine = setryn?.fixingEngine;
    const empty: SeriesFixingRead = { status: "PENDING", value: null, decimals: 0, resolutionKind: 0, observedAt: null, finalizedAt: null, encoded: null };
    if (!publicClient || !fixingEngine) return empty;
    const slots = await Promise.all(series.slots.map(async (slot) => {
      const status = await publicClient.readContract({ address: fixingEngine, abi: fixingEngineAbi, functionName: "fixingStatus", args: [seriesId, version, slot.slot] });
      if (status === FIXING_STATUS.finalized) {
        const result = await publicClient.readContract({ address: fixingEngine, abi: fixingEngineAbi, functionName: "getFinalizedFixing", args: [seriesId, version, slot.slot] });
        return { status, candidateIndex: result.candidateIndex, decimals: result.decimals, value: result.value, resolutionKind: result.resolutionKind, observedAt: null as bigint | null, finalizedAt: result.finalizedAt };
      }
      if (status === FIXING_STATUS.proposed || status === FIXING_STATUS.disputed) {
        const proposal = await publicClient.readContract({ address: fixingEngine, abi: fixingEngineAbi, functionName: "getProposal", args: [seriesId, version, slot.slot] });
        return { status, candidateIndex: proposal.candidateIndex, decimals: proposal.decimals, value: proposal.value, resolutionKind: 0, observedAt: proposal.lastObservedAt as bigint | null, finalizedAt: null as bigint | null };
      }
      return null;
    }));
    const present = slots.filter((slot): slot is NonNullable<typeof slot> => slot !== null);
    if (present.length === 0) return empty;
    const status: SeriesFixingRead["status"] = present.length < slots.length
      ? "PENDING"
      : present.every((slot) => slot.status === FIXING_STATUS.finalized)
        ? "FINALIZED"
        : present.some((slot) => slot.status === FIXING_STATUS.disputed)
          ? "DISPUTED"
          : "PROPOSED";
    // A terminal-disruption result names no candidate and carries no observed value, so there is nothing to encode.
    const TERMINAL_DISRUPTION = 3;
    const observed = present.length === slots.length && present.every((slot, index) =>
      slot.resolutionKind !== TERMINAL_DISRUPTION && series.slots[index].candidates[slot.candidateIndex] !== undefined);
    const encoded = observed
      ? encodeAbiParameters(canonicalFixingsParameter, [present.map((slot, index) => {
        const candidate = series.slots[index].candidates[slot.candidateIndex];
        return {
          slot: series.slots[index].slot,
          benchmarkId: candidate.benchmarkId,
          benchmarkVersion: candidate.benchmarkVersion,
          decimals: slot.decimals,
          value: slot.value,
        };
      })])
      : null;
    const first = present[0];
    return {
      status,
      value: first.resolutionKind === TERMINAL_DISRUPTION ? null : first.value,
      decimals: first.decimals,
      resolutionKind: first.resolutionKind,
      observedAt: first.observedAt,
      finalizedAt: first.finalizedAt,
      encoded,
    };
  }

  /** Reads the terminal lifecycle of each account position that no exit unwound. */
  private async readLifecycles(
    accountId: Hex,
    fills: readonly {
      fillId: Hex;
      positionId: Hex;
      positionStatus: number;
      market: SetrynRuntimeMarket;
      packageSide: "LONG" | "SHORT";
      filledLots: number;
      price: number;
    }[],
    ledgerEvents: readonly LedgerFlow[],
  ): Promise<Map<string, TerminalRead>> {
    const setryn = this.setryn;
    const publicClient = this.publicClient;
    const reads = new Map<string, TerminalRead>();
    if (!setryn || !publicClient || fills.length === 0) return reads;
    const coordinator = setryn.cashSettlementCoordinator;
    const [block, settledEvents, claimEvents, exerciseEvents] = await Promise.all([
      publicClient.getBlock({ blockTag: "pending" }),
      coordinator
        ? publicClient.getContractEvents({ address: coordinator, abi: cashSettlementAbi, eventName: "CashSettlementFinalized", fromBlock: this.fromBlock(), toBlock: "latest" })
        : Promise.resolve([]),
      coordinator
        ? publicClient.getContractEvents({ address: coordinator, abi: cashSettlementAbi, eventName: "SettlementClaimFulfilled", fromBlock: this.fromBlock(), toBlock: "latest" })
        : Promise.resolve([]),
      publicClient.getContractEvents({ address: setryn.positionEngine, abi: positionTerminalAbi, eventName: "PositionExactPayoffComputed", fromBlock: this.fromBlock(), toBlock: "latest" }),
    ]);
    const now = block.timestamp;
    const fixingBySeries = new Map<string, Promise<SeriesFixingRead>>();
    // One position's unreadable state must not hide the others, so each is read on its own.
    await Promise.all(fills.map((fill) => this.readLifecycle(fill, accountId, ledgerEvents, {
      now, coordinator, settledEvents, claimEvents, exerciseEvents, fixingBySeries, reads,
    }).catch(() => undefined)));
    return reads;
  }

  private async readLifecycle(
    fill: {
      fillId: Hex;
      positionId: Hex;
      market: SetrynRuntimeMarket;
      packageSide: "LONG" | "SHORT";
      price: number;
    },
    accountId: Hex,
    ledgerEvents: readonly LedgerFlow[],
    shared: {
      now: bigint;
      coordinator: Address | undefined;
      settledEvents: readonly { args: { settlementId?: Hex }; transactionHash: Hex }[];
      claimEvents: readonly { args: { claimId?: Hex }; transactionHash: Hex }[];
      exerciseEvents: readonly { args: { positionId?: Hex }; transactionHash: Hex; blockNumber: bigint | null }[];
      fixingBySeries: Map<string, Promise<SeriesFixingRead>>;
      reads: Map<string, TerminalRead>;
    },
  ): Promise<void> {
    const setryn = this.setryn;
    const publicClient = this.publicClient;
    if (!setryn || !publicClient) return;
    const { now, coordinator, settledEvents, claimEvents, exerciseEvents, fixingBySeries, reads } = shared;
    const [economics, lifecycle] = await publicClient.readContract({
      address: setryn.positionEngine,
      abi: positionTerminalAbi,
      functionName: "getPosition",
      args: [fill.positionId],
    });
    const series = await this.seriesTerminal(economics.seriesId, economics.seriesVersion);
    const seriesKey = `${economics.seriesId.toLowerCase()}:${economics.seriesVersion}`;
    if (!fixingBySeries.has(seriesKey)) fixingBySeries.set(seriesKey, this.seriesFixing(economics.seriesId, economics.seriesVersion, series));
    const fixing = await fixingBySeries.get(seriesKey)!;
    const long = fill.packageSide === "LONG";
    const own = (value: bigint) => minorToUsd(long ? value : -value);
    const status = POSITION_STATUS_NAMES[lifecycle.status] ?? "Unspecified";
    const open = OPEN_POSITION_STATUSES.includes(lifecycle.status);

    let settlement: OnchainSettlementRecord | null = null;
    let settlementTransactionHash: Hex | null = null;
    let claimTransactionHash: Hex | null = null;
    if (coordinator) {
      const settlementId = await publicClient.readContract({ address: coordinator, abi: cashSettlementAbi, functionName: "settlementOf", args: [fill.positionId] });
      if (settlementId !== EMPTY_ID) {
        const record = await publicClient.readContract({ address: coordinator, abi: cashSettlementAbi, functionName: "getSettlement", args: [settlementId] });
        const ownDelta = long ? record.longCollateral : record.shortCollateral;
        let claim: OnchainSettlementRecord["claim"] = null;
        for (const delta of [record.longCollateral, record.shortCollateral]) {
          if (delta.claimId === EMPTY_ID) continue;
          const claimStatus = await publicClient.readContract({ address: setryn.collateralVault, abi: terminalClaimAbi, functionName: "terminalClaimStatusOf", args: [delta.claimId] });
          const fulfilled = claimEvents.find((event) => event.args.claimId?.toLowerCase() === delta.claimId.toLowerCase());
          claimTransactionHash = fulfilled?.transactionHash ?? claimTransactionHash;
          claim = {
            id: delta.claimId,
            status: claimStatus === 2 ? "FULFILLED" : "ACTIVE",
            amountUsd: minorToUsd(delta.claimAmount),
            receivable: delta.receiverAccountId.toLowerCase() === accountId.toLowerCase(),
            transactionHash: fulfilled?.transactionHash ?? null,
          };
        }
        settlementTransactionHash = settledEvents.find((event) => event.args.settlementId?.toLowerCase() === settlementId.toLowerCase())?.transactionHash ?? null;
        settlement = {
          id: settlementId,
          mode: record.mode === 1 ? "NORMAL" : record.mode === 3 ? "LAPSED" : "TERMINAL_DISRUPTION",
          transferUsd: own(record.terminalTransferMinor),
          finalizedAt: isoAt(record.finalizedAt),
          transactionHash: settlementTransactionHash,
          releasedUsd: minorToUsd(ownDelta.releasedAmount),
          claim,
        };
      }
    }

    const exerciseEvent = [...exerciseEvents].reverse().find((event) => event.args.positionId?.toLowerCase() === fill.positionId.toLowerCase());
    const exerciseTransactionHash = lifecycle.exercisedLots > BigInt(0) ? exerciseEvent?.transactionHash ?? null : null;
    const exerciseAt = exerciseTransactionHash && exerciseEvent?.blockNumber != null
      ? (await publicClient.getBlock({ blockNumber: exerciseEvent.blockNumber })).timestamp
      : null;

    let projectedTransfer: bigint | null = null;
    if (open && fixing.encoded && lifecycle.remainingLots > BigInt(0)) {
      try {
        const terms = await publicClient.readContract({ address: setryn.positionEngine, abi: positionTerminalAbi, functionName: "payoffTerms", args: [fill.positionId] });
        projectedTransfer = lifecycle.terminalTransferMinor + await publicClient.readContract({
          address: economics.payoffModule,
          abi: payoffModuleAbi,
          functionName: "evaluatePositionLots",
          args: [terms, fixing.encoded, lifecycle.remainingLots],
        });
      } catch {
        projectedTransfer = null;
      }
    } else if (!open) {
      projectedTransfer = lifecycle.terminalTransferMinor;
    }
    const entryConsiderationUsd = netConsiderationUsd(ledgerEvents, fill.fillId, accountId);
    const projectedPayoffUsd = projectedTransfer === null ? null : round2(own(projectedTransfer));
    const acceptedOnPosition = lifecycle.finalFixingReference !== EMPTY_ID;
    const view: OnchainPositionLifecycle = {
      positionId: fill.positionId,
      marketId: fill.market.marketKey,
      side: fill.packageSide,
      status,
      exerciseState: EXERCISE_STATE_NAMES[lifecycle.exerciseState] ?? "Unspecified",
      exercisePolicy: EXERCISE_POLICIES[economics.exercisePolicyId.toLowerCase()] ?? "UNKNOWN",
      phase: "LIVE",
      lots: Number(economics.originalLots),
      remainingLots: Number(lifecycle.remainingLots),
      exercisedLots: Number(lifecycle.exercisedLots),
      closedLots: Number(lifecycle.closedLots),
      entryPrice: fill.price,
      holdsElection: lifecycle.lifecycleOwnerAccountId.toLowerCase() === accountId.toLowerCase(),
      schedule: {
        lastTradingAt: isoAt(series.lastTradingAt),
        fixingWindowOpen: isoAt(series.fixingWindowOpen),
        fixingWindowClose: isoAt(series.fixingWindowClose),
        exerciseOpensAt: isoAt(economics.exerciseOpensAt),
        exerciseCutoffAt: isoAt(economics.exerciseCutoffAt),
        correctionCutoffAt: isoAt(series.correctionCutoffAt),
        finalResolutionAt: isoAt(economics.finalResolutionAt),
        settlementDeadline: isoAt(economics.settlementDeadline),
      },
      fixing: {
        status: fixing.status,
        value: fixing.value === null ? null : Number(fixing.value) / 10 ** fixing.decimals,
        resolution: fixing.resolutionKind === 1 ? "PRIMARY_FINAL" : fixing.resolutionKind === 2 ? "FALLBACK_FINAL" : fixing.resolutionKind === 3 ? "TERMINAL_DISRUPTION" : null,
        acceptedOnPosition,
        observedAt: fixing.observedAt !== null ? isoAt(fixing.observedAt) : null,
        finalizedAt: fixing.finalizedAt !== null ? isoAt(fixing.finalizedAt) : null,
      },
      projectedPayoffUsd,
      projectedPnlUsd: projectedPayoffUsd === null ? null : round2(projectedPayoffUsd + entryConsiderationUsd),
      terminalTransferUsd: round2(own(lifecycle.terminalTransferMinor)),
      settlement,
      collateralReservedUsd: open ? positionCollateral(fill.market, fill.packageSide, Number(lifecycle.remainingLots)) : 0,
      exerciseTransactionHash,
      observedAtSeconds: Number(now),
    };
    view.phase = lifecyclePhase(view, lifecycle.status, now, series);
    reads.set(fill.positionId.toLowerCase(), {
      view,
      settlementTransactionHash,
      claimTransactionHash,
      exerciseTransactionHash,
      exerciseAt,
    });
  }

  /** Runs one terminal lifecycle action, simulating first so a contract rejection surfaces as a precise reason. */
  async runLifecycleAction(positionId: string, action: LifecycleActionKey): Promise<LifecycleActionResult> {
    await this.connected();
    const key = positionId.toLowerCase();
    await this.refreshActivity();
    const view = this.snapshot.lifecycles[key];
    if (!view) throw new Error("LIFECYCLE_POSITION_NOT_FOUND");
    let result: LifecycleActionResult;
    try {
      if (action === "EXERCISE") result = await this.exercisePosition(view);
      else if (action === "CLAIM") result = await this.claimPosition(view);
      else {
        const { series } = await this.positionSeries(positionId as Hex);
        if (action === "SETTLE") {
          const hash = await this.writeSettlement({ kind: "NORMAL", positionId: positionId as Hex, slots: series.slots });
          result = { action, positionId, transactionHash: hash, detail: "Normal settlement recorded by the cash settlement coordinator." };
        } else if (
          view.status === "Lapsed" ||
          (view.exercisePolicy === "HOLDER_ELECTION" &&
            (view.status === "Live" || view.status === "Fixing") &&
            Date.parse(view.schedule.exerciseCutoffAt) < platformNow() &&
            platformNow() < Date.parse(view.schedule.finalResolutionAt))
        ) {
          // An unelected holder-election position lapses permissionlessly between the cutoff and final resolution.
          const hash = await this.writeSettlement({ kind: "LAPSED", positionId: positionId as Hex });
          result = { action, positionId, transactionHash: hash, detail: "Lapsed position finalized; both reservations released." };
        } else {
          const hash = await this.writeSettlement({ kind: "TERMINAL", positionId: positionId as Hex, slots: series.slots });
          result = { action, positionId, transactionHash: hash, detail: "Terminal resolution completed through the permissionless fallback." };
        }
      }
    } catch (error) {
      const reverted = revertOf(error);
      if (reverted) throw new Error(describeLifecycleRevert(reverted.name, reverted.args));
      throw error;
    }
    await Promise.all([this.refreshActivity(), this.refreshAccount()]);
    return result;
  }

  private async positionSeries(positionId: Hex) {
    const setryn = this.setryn;
    const publicClient = this.publicClient;
    if (!setryn || !publicClient) throw new Error("RUNTIME_UNAVAILABLE");
    const [economics, lifecycle] = await publicClient.readContract({
      address: setryn.positionEngine,
      abi: positionTerminalAbi,
      functionName: "getPosition",
      args: [positionId],
    });
    return { economics, lifecycle, series: await this.seriesTerminal(economics.seriesId, economics.seriesVersion) };
  }

  /** Simulates, then sends, one settlement coordinator completion; every path is permissionless. */
  private async writeSettlement(
    call:
      | { kind: "NORMAL" | "TERMINAL"; positionId: Hex; slots: readonly FixingSlotArg[] }
      | { kind: "LAPSED"; positionId: Hex },
  ): Promise<Hex> {
    const { setryn, address, walletClient, publicClient } = await this.connected();
    const coordinator = setryn.cashSettlementCoordinator;
    if (!coordinator) throw new Error("SETTLEMENT_COORDINATOR_UNAVAILABLE");
    const base = { account: address, address: coordinator, abi: settlementCallAbi } as const;
    let hash: Hex;
    if (call.kind === "LAPSED") {
      const args = [call.positionId, []] as const;
      await publicClient.simulateContract({ ...base, functionName: "finalizeLapsedPosition", args });
      hash = await walletClient.writeContract({ ...base, chain: this.chain(setryn), functionName: "finalizeLapsedPosition", args });
    } else {
      const functionName = call.kind === "NORMAL" ? "finalizeNormalSettlement" : "finalizeTerminalDisruption";
      const args = [call.positionId, call.slots, []] as const;
      await publicClient.simulateContract({ ...base, functionName, args });
      hash = await walletClient.writeContract({ ...base, chain: this.chain(setryn), functionName, args });
    }
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error("SETTLEMENT_TRANSACTION_FAILED");
    return hash;
  }

  /** Pays out an open terminal claim, or withdraws the collateral a completed settlement released to the account. */
  private async claimPosition(view: OnchainPositionLifecycle): Promise<LifecycleActionResult> {
    const { setryn, address, walletClient, publicClient } = await this.connected();
    const settlement = view.settlement;
    if (!settlement) throw new Error("No settlement is recorded yet; Settle or Finalize the position first.");
    const claim = settlement.claim;
    if (claim && claim.status === "ACTIVE" && claim.receivable) {
      const coordinator = setryn.cashSettlementCoordinator;
      if (!coordinator) throw new Error("SETTLEMENT_COORDINATOR_UNAVAILABLE");
      await publicClient.simulateContract({ account: address, address: coordinator, abi: settlementCallAbi, functionName: "fulfillClaim", args: [claim.id as Hex] });
      const hash = await walletClient.writeContract({
        account: address,
        chain: this.chain(setryn),
        address: coordinator,
        abi: settlementCallAbi,
        functionName: "fulfillClaim",
        args: [claim.id as Hex],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("CLAIM_TRANSACTION_FAILED");
      return { action: "CLAIM", positionId: view.positionId, transactionHash: hash, detail: `Claim paid ${claim.amountUsd.toFixed(2)} USD into the account.` };
    }
    await this.refreshAccount();
    const releasable = settlementReleasable(view);
    const amount = Math.floor(Math.min(this.snapshot.account.available, releasable) * 100) / 100;
    if (!(amount > 0)) throw new Error("Nothing released by this settlement is still available to withdraw.");
    const withdrawal = await this.submitCollateralIntent({
      kind: "WITHDRAW",
      accountId: this.snapshot.account.id,
      asset: this.snapshot.account.collateralAsset,
      amount,
      recipient: address,
    });
    return {
      action: "CLAIM",
      positionId: view.positionId,
      transactionHash: withdrawal.intentId,
      detail: `Withdrew ${amount.toFixed(2)} ${this.snapshot.account.collateralAsset} of released collateral to the wallet.`,
    };
  }

  /**
   * Holder election through the signed lifecycle engine: an Exercise action over the position's remaining lots, signed
   * by the long holder, with the final-fixing witness the position committed to staged for the lifecycle executor.
   */
  private async exercisePosition(view: OnchainPositionLifecycle): Promise<LifecycleActionResult> {
    const { setryn, address, walletClient, publicClient } = await this.connected();
    const positionId = view.positionId as Hex;
    const actorAccountId = await this.accountId(address);
    let { lifecycle, series, economics } = await this.positionSeries(positionId);
    if (lifecycle.lifecycleOwnerAccountId.toLowerCase() !== actorAccountId.toLowerCase()) {
      throw new Error("Only the position's lifecycle owner, the long holder, can elect.");
    }
    if (lifecycle.finalFixingReference === EMPTY_ID) {
      // The settlement coordinator is the only account that accepts a final fixing onto a position. Its permissionless
      // normal-settlement entry does that and, for a holder-election series, leaves the position Live for election.
      // A coordinator that cannot persist the acceptance reverts here with its own reason.
      await this.writeSettlement({ kind: "NORMAL", positionId, slots: series.slots });
      ({ lifecycle, series, economics } = await this.positionSeries(positionId));
      if (lifecycle.finalFixingReference === EMPTY_ID) throw new Error("The coordinator did not accept the final fixing onto the position.");
    }
    const fixing = await this.seriesFixing(economics.seriesId, economics.seriesVersion, series);
    const finalFixings = fixing.encoded;
    if (!finalFixings || keccak256(finalFixings).toLowerCase() !== lifecycle.finalFixingsHash.toLowerCase()) {
      throw new Error("The published fixing does not match the final fixing committed on the position.");
    }
    const snapshot = await publicClient.readContract({
      address: setryn.positionEngine,
      abi: positionLifecycleAbi,
      functionName: "getLifecyclePosition",
      args: [positionId],
    });
    const inputs = [{
      positionId,
      expectedImmutableHash: snapshot.immutableHash,
      expectedLifecycleHash: snapshot.lifecycleHash,
      expectedPositionLots: snapshot.positionLots,
      actionLots: snapshot.remainingExerciseLots,
    }];
    // A full exercise leaves no successor, so the holder's replacement terminal liability is zero. The lifecycle engine
    // commits to a non-empty replacement set, and the holder is the only account an exercise binds.
    const replacements = [{ accountId: actorAccountId, collateralId: snapshot.collateralId, terminalLiabilityBaseUnits: BigInt(0) }];
    const [inputsHash, successorsHash, collateralReplacementsHash, participantSetHash, consentsHash] = await Promise.all([
      publicClient.readContract({ address: setryn.signedLifecycleEngine, abi: signedLifecycleAbi, functionName: "hashLifecycleInputs", args: [inputs] }),
      publicClient.readContract({ address: setryn.signedLifecycleEngine, abi: signedLifecycleAbi, functionName: "hashLifecycleSuccessors", args: [[]] }),
      publicClient.readContract({ address: setryn.signedLifecycleEngine, abi: signedLifecycleAbi, functionName: "hashLifecycleCollateralReplacements", args: [replacements] }),
      publicClient.readContract({ address: setryn.signedLifecycleEngine, abi: signedLifecycleAbi, functionName: "hashLifecycleParticipantSet", args: [actorAccountId, []] }),
      publicClient.readContract({ address: setryn.signedLifecycleEngine, abi: signedLifecycleAbi, functionName: "hashLifecycleConsentTerms", args: [[]] }),
    ]);
    const block = await publicClient.getBlock({ blockTag: "pending" });
    const nonce = BigInt(Date.now()) * BigInt(1_000_000) + BigInt(crypto.getRandomValues(new Uint32Array(1))[0]);
    const economicTransitionHash = keccak256(
      encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [lifecycle.finalFixingReference, keccak256(finalFixings)]),
    );
    let action = {
      kind: EXERCISE_ACTION_KIND,
      actor: address,
      actorAccountId,
      policyContextHash: EMPTY_ID,
      inputsHash,
      successorsHash,
      collateralReplacementsHash,
      participantSetHash,
      consentsHash,
      riskDomainId: snapshot.riskDomainId,
      riskDomainVersion: snapshot.riskDomainVersion,
      feeScheduleId: snapshot.feeScheduleId,
      feeScheduleVersion: snapshot.feeScheduleVersion,
      economicTransitionHash,
      compressionPlanId: EMPTY_ID,
      breaksPackageProvenance: false,
      packageBreakPermissionHash: EMPTY_ID,
      actorMaximumLiabilityIncreaseBaseUnits: BigInt(0),
      actorMaximumCollateralIncreaseBaseUnits: BigInt(0),
      inputCount: 1,
      successorCount: 0,
      participantCount: 1,
      deadline: block.timestamp + BigInt(240),
      nonce,
      permittedExecutor: address,
      salt: keccak256(stringToHex(`${address}:${positionId}:exercise:${nonce}`)),
    } as const;
    const [policyContextHash] = await publicClient.readContract({
      address: setryn.lifecyclePolicyValidator,
      abi: lifecyclePolicyAbi,
      functionName: "derivePolicyContext",
      args: [action, [snapshot], []],
    });
    action = { ...action, policyContextHash };
    const [, actionId] = await publicClient.readContract({
      address: setryn.signedLifecycleEngine,
      abi: signedLifecycleAbi,
      functionName: "hashLifecycleAction",
      args: [action],
    });
    const witnessResponse = await fetch("/api/internal/operator/exercise-witness", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionId, positionId, finalFixings }),
    });
    const witness = (await witnessResponse.json()) as { transactionHash?: string; error?: string };
    if (!witnessResponse.ok || !witness.transactionHash) throw new Error(witness.error ?? "EXERCISE_WITNESS_FAILED");
    const actorSignature = await walletClient.signTypedData({
      account: address,
      domain: { name: "Setryn", version: "1", chainId: setryn.chainId, verifyingContract: setryn.signedLifecycleEngine },
      types: lifecycleActionTypes,
      primaryType: "SetrynLifecycleActionV1",
      message: { ...action, chainId: BigInt(setryn.chainId), engine: setryn.signedLifecycleEngine },
    });
    const authorizeArgs = [action, inputs, [], replacements, [], [], actorSignature] as const;
    await publicClient.simulateContract({ account: address, address: setryn.signedLifecycleEngine, abi: lifecycleCallAbi, functionName: "authorizeAction", args: authorizeArgs });
    const authorizationHash = await walletClient.writeContract({
      account: address,
      chain: this.chain(setryn),
      address: setryn.signedLifecycleEngine,
      abi: lifecycleCallAbi,
      functionName: "authorizeAction",
      args: authorizeArgs,
    });
    const authorization = await publicClient.waitForTransactionReceipt({ hash: authorizationHash });
    if (authorization.status !== "success") throw new Error("EXERCISE_AUTHORIZATION_FAILED");
    const executeArgs = [action, inputs, [], replacements, []] as const;
    await publicClient.simulateContract({ account: address, address: setryn.signedLifecycleEngine, abi: lifecycleCallAbi, functionName: "executeAction", args: executeArgs });
    const executionHash = await walletClient.writeContract({
      account: address,
      chain: this.chain(setryn),
      address: setryn.signedLifecycleEngine,
      abi: lifecycleCallAbi,
      functionName: "executeAction",
      args: executeArgs,
    });
    const execution = await publicClient.waitForTransactionReceipt({ hash: executionHash });
    if (execution.status !== "success") throw new Error("EXERCISE_EXECUTION_FAILED");
    return {
      action: "EXERCISE",
      positionId: view.positionId,
      transactionHash: executionHash,
      detail: `Exercised ${formatLotCount(Number(snapshot.remainingExerciseLots))} against the final fixing.`,
    };
  }

  private async refreshRfqs(): Promise<void> {
    if (!this.setryn || !this.publicClient || !this.walletAddress) return;
    const { makerAddress: designatedMaker } = await this.operatorStatus();
    const committed = await this.publicClient.getContractEvents({
      address: this.setryn.privateRfqBook,
      abi: privateRfqBookAbi,
      eventName: "PrivateRfqCommitted",
      fromBlock: this.fromBlock(),
      toBlock: "latest",
    });
    const requests: RfqRequest[] = [];
    for (const event of committed) {
      const rfqId = event.args.rfqId;
      if (!rfqId) continue;
      const rfq = await this.publicClient.readContract({
        address: this.setryn.privateRfqBook,
        abi: privateRfqBookAbi,
        functionName: "getRfq",
        args: [rfqId],
      });
      if (rfq.request.taker.toLowerCase() !== this.walletAddress.toLowerCase()) continue;
      const market = runtimeMarketBySeries(this.setryn, rfq.request.seriesId);
      if (!market) continue;
      const orderRecord = await this.publicClient.readContract({
        address: this.setryn.orderState,
        abi: orderStateAbi,
        functionName: "getOrder",
        args: [rfq.request.takerOrderHash],
      });
      const admissionId = await this.publicClient.readContract({
        address: this.setryn.riskAdmissionBindingRegistry,
        abi: riskBindingAbi,
        functionName: "admissionForOrder",
        args: [rfq.request.takerOrderHash],
      });
      const admission = admissionId === EMPTY_ID
        ? null
        : await this.publicClient.readContract({
            address: this.setryn.portfolioRiskEngine,
            abi: riskEngineAbi,
            functionName: "getAdmission",
            args: [admissionId],
          });
      const quoteEvents = await this.publicClient.getContractEvents({
        address: this.setryn.privateRfqBook,
        abi: privateRfqBookAbi,
        eventName: "MakerQuoteCommitted",
        args: { rfqId },
        fromBlock: this.fromBlock(),
        toBlock: "latest",
      });
      const quotes = [] as RfqRequest["quotes"];
      for (const quoteEvent of quoteEvents) {
        const quoteId = quoteEvent.args.quoteId;
        if (!quoteId) continue;
        const quoteRecord = await this.publicClient.readContract({
          address: this.setryn.privateRfqBook,
          abi: privateRfqBookAbi,
          functionName: "getQuote",
          args: [quoteId],
        });
        if (quoteRecord.status >= 5) continue;
        const priceTicks = rfq.request.sidePolicy === 1
          ? quoteRecord.quote.askPriceTicks
          : quoteRecord.quote.bidPriceTicks;
        const houseQuote = designatedMaker !== null && quoteRecord.quote.maker.toLowerCase() === designatedMaker.toLowerCase();
        quotes.push({
          id: quoteId,
          solverLabel: houseQuote ? "Setryn MM" : `${quoteRecord.quote.maker.slice(0, 6)}…${quoteRecord.quote.maker.slice(-4)}`,
          packagePrice: ticksToPrice(market, priceTicks),
          feeCap: Number(formatUnits(quoteRecord.quote.maxFeeMinor, 6)),
          capacityLots: Number(quoteRecord.quote.lots - quoteRecord.cumulativeFilledLots),
          expiresAt: new Date(Number(quoteRecord.quote.deadline) * 1000).toISOString(),
          settlementGuarantee: "Firm capacity, atomic onchain settlement",
          provenance: houseQuote ? "DESIGNATED_MAKER" : "SEEDED_SOLVER",
        });
      }
      const settled = rfq.status === 8
        ? await this.publicClient.getContractEvents({
            address: this.setryn.privateRfqBook,
            abi: privateRfqBookAbi,
            eventName: "RfqSettled",
            args: { rfqId },
            fromBlock: this.fromBlock(),
            toBlock: "latest",
          })
        : [];
      const packageSide = orderRecord.order.side === 1 ? "LONG" : "SHORT";
      // An all-or-none RFQ order signs as GTD without partial fills; it reads back as the all-or-none the user chose.
      const timeInForce = orderRecord.order.timeInForce === 2
        ? orderRecord.order.allowPartialFills === false ? "FOK" : "GTD"
        : orderRecord.order.timeInForce === 3
          ? "IOC"
          : orderRecord.order.timeInForce === 4
            ? "FOK"
            : "GTC";
      const lots = Number(orderRecord.order.lots);
      const limitPrice = ticksToPrice(market, orderRecord.order.priceTicks);
      const intent: PackageOrderIntent = {
        accountId: orderRecord.order.accountId,
        marketId: market.marketKey,
        packageCode: market.marketKey,
        routeId: "private-rfq",
        routeLabel: "Private firm RFQ",
        side: "ENTER",
        packageSide,
        lots,
        fillLots: lots,
        limitPrice,
        executionPrice: limitPrice,
        contractMultiplier: considerationPerPriceUnit(market),
        orderType: "LIMIT",
        timeInForce,
        expiresAt: new Date(Number(orderRecord.order.deadline) * 1000).toISOString(),
        feeCap: Number(formatUnits(orderRecord.order.maxFeeMinor, 6)),
        collateralRequired: admission ? Number(formatUnits(admission.terminalLiabilityBaseUnits, 6)) : 0,
        closePositionId: null,
        replacesOrderId: null,
        recipient: orderRecord.order.recipient,
        disclosure: "PRIVATE_RFQ",
        settlementGuarantee: "Firm capacity, atomic onchain settlement",
      };
      const authorization: SignedOrderAuthorization = {
        orderHash: rfq.request.takerOrderHash,
        signature: "0x",
        signer: orderRecord.order.signer,
        nonce: orderRecord.order.nonce.toString(),
        deadline: new Date(Number(orderRecord.order.deadline) * 1000).toISOString(),
        intent,
        onchainOrder: orderRecord.order as OnchainPublicOrder,
        riskAdmissionId: admissionId,
      };
      const state: RfqRequest["state"] = rfq.status === 8
        ? "EXECUTED"
        : rfq.status >= 9
          ? "CANCELLED"
          : rfq.status >= 3
            ? "SELECTED"
            : "OPEN";
      requests.push({
        id: rfqId,
        authorization,
        createdAt: new Date(Number(rfq.registeredAt) * 1000).toISOString(),
        expiresAt: new Date(Number(rfq.request.deadline) * 1000).toISOString(),
        state,
        selectedQuoteId: rfq.selectedQuoteId === EMPTY_ID ? null : rfq.selectedQuoteId,
        receiptId: settled[settled.length - 1]?.args.settlementReference ?? null,
        quotes,
      });
    }
    requests.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    this.publish({ ...this.snapshot, rfqRequests: requests });
  }

  private restingState(status: number, expired: boolean): RestingPackageOrder["state"] {
    if ((status === 1 || status === 2) && expired) return "EXPIRED";
    if (status === 1) return "WORKING";
    if (status === 2) return "PARTIALLY_FILLED";
    if (status === 3) return "FILLED";
    if (status === 4) return "CANCELLED";
    if (status === 5) return "EXPIRED";
    return "CANCELLED";
  }

  private toMinorUnits(value: number): bigint {
    if (!Number.isFinite(value) || value < 0) throw new Error("INVALID_MINOR_UNIT_AMOUNT");
    return parseUnits(value.toFixed(6), 6);
  }

  private async levelHint(bookId: Hex, side: 1 | 2, priceTicks: bigint) {
    if (!this.setryn || !this.publicClient) throw new Error("RUNTIME_UNAVAILABLE");
    let current: Hex;
    try {
      current = await this.publicClient.readContract({
        address: this.setryn.publicOrderBook,
        abi: publicOrderBookAbi,
        functionName: "bestLevel",
        args: [bookId, side],
      });
    } catch {
      return { previousLevelId: EMPTY_ID, nextLevelId: EMPTY_ID };
    }
    if (current === EMPTY_ID) return { previousLevelId: EMPTY_ID, nextLevelId: EMPTY_ID };

    let previous = EMPTY_ID;
    for (let depth = 0; depth < 256 && current !== EMPTY_ID; depth += 1) {
      const level = await this.publicClient.readContract({
        address: this.setryn.publicOrderBook,
        abi: publicOrderBookAbi,
        functionName: "getPriceLevel",
        args: [current],
      });
      if (level.priceTicks === priceTicks) {
        return { previousLevelId: EMPTY_ID, nextLevelId: EMPTY_ID };
      }
      const currentBeforeIncoming = side === 1 ? level.priceTicks > priceTicks : level.priceTicks < priceTicks;
      if (!currentBeforeIncoming) return { previousLevelId: previous, nextLevelId: current };
      previous = current;
      current = level.nextLevelId;
    }
    if (current !== EMPTY_ID) throw new Error("ORDER_BOOK_DEPTH_LIMIT");
    return { previousLevelId: previous, nextLevelId: EMPTY_ID };
  }

  private async releaseRiskReservation(authorization: SignedOrderAuthorization): Promise<void> {
    const { setryn, address, walletClient, publicClient } = await this.connected();
    if (!authorization.onchainOrder || !authorization.riskAdmissionId) {
      throw new Error("ORDER_AUTHORIZATION_UNAVAILABLE");
    }
    const block = await publicClient.getBlock({ blockTag: "pending" });
    const nonce = BigInt(Date.now()) * BigInt(1_000_000) + BigInt(crypto.getRandomValues(new Uint32Array(1))[0]);
    const cancellationReference = keccak256(
      encodeAbiParameters(
        [
          { name: "orderHash", type: "bytes32" },
          { name: "nonce", type: "uint256" },
        ],
        [authorization.orderHash as Hex, nonce],
      ),
    );
    const cancellation = {
      admissionId: authorization.riskAdmissionId as Hex,
      orderHash: authorization.orderHash as Hex,
      accountId: authorization.onchainOrder.accountId,
      signer: address,
      nonce,
      deadline: block.timestamp + BigInt(240),
      cancellationReference,
    } as const;
    const signature = await walletClient.signTypedData({
      account: address,
      domain: {
        name: "Setryn",
        version: "1",
        chainId: setryn.chainId,
        verifyingContract: setryn.riskAdmissionBindingRegistry,
      },
      types: {
        SetrynRiskAdmissionCancellationV1: [
          { name: "admissionId", type: "bytes32" },
          { name: "orderHash", type: "bytes32" },
          { name: "accountId", type: "bytes32" },
          { name: "signer", type: "address" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint64" },
          { name: "cancellationReference", type: "bytes32" },
        ],
      },
      primaryType: "SetrynRiskAdmissionCancellationV1",
      message: cancellation,
    });
    const releaseHash = await walletClient.writeContract({
      account: address,
      chain: this.chain(setryn),
      address: setryn.riskAdmissionBindingRegistry,
      abi: riskBindingAbi,
      functionName: "cancelBoundAdmission",
      args: [cancellation, signature],
    });
    const releaseReceipt = await publicClient.waitForTransactionReceipt({ hash: releaseHash });
    if (releaseReceipt.status !== "success") throw new Error("RISK_RELEASE_FAILED");
  }

  private async completeFullExit(sourcePositionId: Hex, closePositionId: Hex): Promise<Hex> {
    const { setryn, address, walletClient, publicClient } = await this.connected();
    const actorAccountId = await this.accountId(address);
    if (sourcePositionId.toLowerCase() === closePositionId.toLowerCase()) throw new Error("DUPLICATE_EXIT_POSITION");
    const snapshots = await Promise.all(
      [sourcePositionId, closePositionId].map((positionId) =>
        publicClient.readContract({
          address: setryn.positionEngine,
          abi: positionLifecycleAbi,
          functionName: "getLifecyclePosition",
          args: [positionId],
        }),
      ),
    );
    snapshots.sort((left, right) => left.positionId.toLowerCase().localeCompare(right.positionId.toLowerCase()));
    if (snapshots.some((snapshot) => snapshot.positionLots === BigInt(0))) throw new Error("EMPTY_EXIT_POSITION");
    if (snapshots[0].positionLots !== snapshots[1].positionLots) throw new Error("EXIT_QUANTITY_MISMATCH");
    if (snapshots.some((snapshot) => snapshot.packageProvenanceHash !== EMPTY_ID)) {
      throw new Error("PACKAGE_COMPRESSION_EXIT_REQUIRED");
    }
    const participantAccounts = [...new Set(
      snapshots.flatMap((snapshot) => [snapshot.longAccountId.toLowerCase(), snapshot.shortAccountId.toLowerCase()]),
    )];
    if (participantAccounts.length !== 2 || !participantAccounts.includes(actorAccountId.toLowerCase())) {
      throw new Error("EXIT_PARTICIPANT_MISMATCH");
    }
    const makerAccountId = participantAccounts.find((accountId) => accountId !== actorAccountId.toLowerCase()) as Hex;
    // The counterparty's consent comes from the designated maker, which gives it only for positions it is party to.
    const { makerAddress } = await this.operatorStatus();
    if (!makerAddress) throw new Error("COUNTERPARTY_CONSENT_REQUIRED");
    const inputs = snapshots.map((snapshot) => ({
      positionId: snapshot.positionId,
      expectedImmutableHash: snapshot.immutableHash,
      expectedLifecycleHash: snapshot.lifecycleHash,
      expectedPositionLots: snapshot.positionLots,
      actionLots: snapshot.positionLots,
    }));
    const replacements = participantAccounts
      .sort((left, right) => left.localeCompare(right))
      .map((accountId) => ({
        accountId: accountId as Hex,
        collateralId: snapshots[0].collateralId,
        terminalLiabilityBaseUnits: BigInt(0),
      }));
    const block = await publicClient.getBlock({ blockTag: "pending" });
    const deadline = block.timestamp + BigInt(240);
    const nonce = BigInt(Date.now()) * BigInt(1_000_000) + BigInt(crypto.getRandomValues(new Uint32Array(1))[0]);
    const consentNonce = nonce + BigInt(1);
    const salt = keccak256(stringToHex(`${address}:${sourcePositionId}:${closePositionId}:${nonce}`));
    const consentSalt = keccak256(stringToHex(`${makerAddress}:${sourcePositionId}:${closePositionId}:${consentNonce}`));
    const consentBase = {
      actionId: EMPTY_ID,
      accountId: makerAccountId,
      signer: makerAddress,
      nonce: consentNonce,
      deadline,
      maximumLiabilityIncreaseBaseUnits: BigInt(0),
      maximumCollateralIncreaseBaseUnits: BigInt(0),
      allowsPackageBreak: false,
      salt: consentSalt,
    } as const;
    const [inputsHash, successorsHash, collateralReplacementsHash, participantSetHash, consentsHash] =
      await Promise.all([
        publicClient.readContract({ address: setryn.signedLifecycleEngine, abi: signedLifecycleAbi, functionName: "hashLifecycleInputs", args: [inputs] }),
        publicClient.readContract({ address: setryn.signedLifecycleEngine, abi: signedLifecycleAbi, functionName: "hashLifecycleSuccessors", args: [[]] }),
        publicClient.readContract({ address: setryn.signedLifecycleEngine, abi: signedLifecycleAbi, functionName: "hashLifecycleCollateralReplacements", args: [replacements] }),
        publicClient.readContract({ address: setryn.signedLifecycleEngine, abi: signedLifecycleAbi, functionName: "hashLifecycleParticipantSet", args: [actorAccountId, [consentBase]] }),
        publicClient.readContract({ address: setryn.signedLifecycleEngine, abi: signedLifecycleAbi, functionName: "hashLifecycleConsentTerms", args: [[consentBase]] }),
      ]);
    let action = {
      kind: 4,
      actor: address,
      actorAccountId,
      policyContextHash: EMPTY_ID,
      inputsHash,
      successorsHash,
      collateralReplacementsHash,
      participantSetHash,
      consentsHash,
      riskDomainId: snapshots[0].riskDomainId,
      riskDomainVersion: snapshots[0].riskDomainVersion,
      feeScheduleId: snapshots[0].feeScheduleId,
      feeScheduleVersion: snapshots[0].feeScheduleVersion,
      economicTransitionHash: EMPTY_ID,
      compressionPlanId: EMPTY_ID,
      breaksPackageProvenance: false,
      packageBreakPermissionHash: EMPTY_ID,
      actorMaximumLiabilityIncreaseBaseUnits: BigInt(0),
      actorMaximumCollateralIncreaseBaseUnits: BigInt(0),
      inputCount: inputs.length,
      successorCount: 0,
      participantCount: 2,
      deadline,
      nonce,
      permittedExecutor: address,
      salt,
    } as const;
    const [policyContextHash] = await publicClient.readContract({
      address: setryn.lifecyclePolicyValidator,
      abi: lifecyclePolicyAbi,
      functionName: "derivePolicyContext",
      args: [action, snapshots, []],
    });
    action = { ...action, policyContextHash };
    const [, actionId] = await publicClient.readContract({
      address: setryn.signedLifecycleEngine,
      abi: signedLifecycleAbi,
      functionName: "hashLifecycleAction",
      args: [action],
    });
    const consent = { ...consentBase, actionId };
    const consentResponse = await fetch("/api/internal/operator/lifecycle-consent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actionId,
        accountId: makerAccountId,
        nonce: consentNonce.toString(),
        deadline: deadline.toString(),
        salt: consentSalt,
        allowsPackageBreak: false,
        positionIds: [sourcePositionId, closePositionId],
      }),
    });
    const consentResult = (await consentResponse.json()) as { signature?: Hex; error?: string };
    if (!consentResponse.ok || !consentResult.signature) {
      throw new Error(consentResult.error ?? "MAKER_LIFECYCLE_CONSENT_FAILED");
    }
    const actorSignature = await walletClient.signTypedData({
      account: address,
      domain: { name: "Setryn", version: "1", chainId: setryn.chainId, verifyingContract: setryn.signedLifecycleEngine },
      types: lifecycleActionTypes,
      primaryType: "SetrynLifecycleActionV1",
      message: { ...action, chainId: BigInt(setryn.chainId), engine: setryn.signedLifecycleEngine },
    });
    const authorizationHash = await walletClient.writeContract({
      account: address,
      chain: this.chain(setryn),
      address: setryn.signedLifecycleEngine,
      abi: signedLifecycleAbi,
      functionName: "authorizeAction",
      args: [action, inputs, [], replacements, [consent], [consentResult.signature], actorSignature],
    });
    const authorizationReceipt = await publicClient.waitForTransactionReceipt({ hash: authorizationHash });
    if (authorizationReceipt.status !== "success") throw new Error("EXIT_AUTHORIZATION_FAILED");
    const executionHash = await walletClient.writeContract({
      account: address,
      chain: this.chain(setryn),
      address: setryn.signedLifecycleEngine,
      abi: signedLifecycleAbi,
      functionName: "executeAction",
      args: [action, inputs, [], replacements, [consent]],
    });
    const executionReceipt = await publicClient.waitForTransactionReceipt({ hash: executionHash });
    if (executionReceipt.status !== "success") throw new Error("EXIT_EXECUTION_FAILED");
    return executionHash;
  }

  private async cancelUnmatchedOrder(authorization: SignedOrderAuthorization): Promise<void> {
    const { setryn, address, walletClient, publicClient } = await this.connected();
    const cancelHash = await walletClient.writeContract({
      account: address,
      chain: this.chain(setryn),
      address: setryn.orderState,
      abi: orderStateAbi,
      functionName: "cancelOrder",
      args: [authorization.orderHash as Hex],
    });
    const cancelReceipt = await publicClient.waitForTransactionReceipt({ hash: cancelHash });
    if (cancelReceipt.status !== "success") throw new Error("ORDER_CANCELLATION_FAILED");
    await this.releaseRiskReservation(authorization);
  }

  /** Local chain only: tops the wallet up with gas through the operator's fund route. */
  private async fundNativeGas(address: Address): Promise<void> {
    const response = await fetch("/api/internal/operator/fund", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
    });
    if (!response.ok) throw new Error("GAS_FUNDING_FAILED");
  }

  private startPolling(): void {
    if (this.pollingTimer !== null) return;
    this.pollingTimer = window.setInterval(() => {
      if (this.polling || this.snapshot.wallet.status !== "CONNECTED") return;
      this.polling = true;
      void Promise.all([
        this.refreshAccount(),
        this.refreshOrders(),
        this.refreshPublicBook(),
        this.refreshActivity(),
        this.refreshRfqs(),
      ])
        .catch(() => undefined)
        .finally(() => {
          this.polling = false;
        });
    }, 20_000);
  }

  private publish(snapshot: GatewaySnapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }
}
