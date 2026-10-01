import {
  BaseError,
  ContractFunctionRevertedError,
  encodeFunctionData,
  getAddress,
  isAddress,
  isHex,
  keccak256,
  parseAbi,
  stringToHex,
  verifyTypedData,
  type Address,
  type Hex,
} from "viem";
import { PublicApiError } from "./errors";
import { EMPTY_ID, deriveAccountId, type ChainContext } from "./chain";
import { designatedMaker, lifecycleConsentTypes, lifecycleDomain, MakerConsentRefusal, signMakerConsent, type LifecycleConsent } from "./lifecycle-consent";
import { SignerUnavailableError } from "@/lib/internal-gateway/operator-signer";
import { assertSignerAllowed, type TransactionRequest } from "./orders";
import type { StoredApiKey } from "./store";

/**
 * Full lifecycle exit of a hedged pair of positions, prepared for the actor to execute. Mirrors the platform
 * terminal's exit (`completeFullExit` in lib/internal-gateway/onchain.ts):
 *
 *   1. POST /positions/exit/prepare reads both positions' lifecycle snapshots, checks they form one closable pair with
 *      the designated maker, builds the kind-4 LifecycleAction (hashes from SignedLifecycleEngine, policy context from the
 *      LifecyclePolicyValidator), and returns it with the maker's counterparty consent and the actor's typed data.
 *   2. The actor signs `SetrynLifecycleActionV1` locally.
 *   3. POST /positions/exit re-derives the action id, verifies both signatures, simulates authorization, and returns the
 *      authorizeAction and executeAction transactions for the actor to send.
 *
 * The API never sends a transaction for the actor; the contracts validate every hash, signature and state again.
 */

const EXIT_KIND = 4;
const EXIT_LIFETIME_SECONDS = BigInt(240);

const lifecycleInputStruct = "struct LifecycleInput { bytes32 positionId; bytes32 expectedImmutableHash; bytes32 expectedLifecycleHash; uint128 expectedPositionLots; uint128 actionLots; }";
const lifecycleSuccessorStruct = "struct LifecycleSuccessor { bytes32 successorKey; bytes32 seriesId; uint32 seriesVersion; bytes32 longAccountId; bytes32 shortAccountId; bytes32 riskDomainId; uint32 riskDomainVersion; bytes32 collateralId; uint128 lots; int128 entryPriceTicks; bytes32 economicsHash; bytes32 packageProvenanceHash; uint128 longTerminalLiabilityBaseUnits; uint128 shortTerminalLiabilityBaseUnits; }";
const lifecycleReplacementStruct = "struct LifecycleCollateralReplacement { bytes32 accountId; bytes32 collateralId; uint128 terminalLiabilityBaseUnits; }";
const lifecycleConsentStruct = "struct LifecycleConsent { bytes32 actionId; bytes32 accountId; address signer; uint256 nonce; uint64 deadline; uint128 maximumLiabilityIncreaseBaseUnits; uint128 maximumCollateralIncreaseBaseUnits; bool allowsPackageBreak; bytes32 salt; }";
const lifecycleActionStruct = "struct LifecycleAction { uint8 kind; address actor; bytes32 actorAccountId; bytes32 policyContextHash; bytes32 inputsHash; bytes32 successorsHash; bytes32 collateralReplacementsHash; bytes32 participantSetHash; bytes32 consentsHash; bytes32 riskDomainId; uint32 riskDomainVersion; bytes32 feeScheduleId; uint32 feeScheduleVersion; bytes32 economicTransitionHash; bytes32 compressionPlanId; bool breaksPackageProvenance; bytes32 packageBreakPermissionHash; uint128 actorMaximumLiabilityIncreaseBaseUnits; uint128 actorMaximumCollateralIncreaseBaseUnits; uint16 inputCount; uint16 successorCount; uint16 participantCount; uint64 deadline; uint256 nonce; address permittedExecutor; bytes32 salt; }";
const lifecycleSnapshotStruct = "struct LifecyclePositionSnapshot { bytes32 positionId; bytes32 immutableHash; bytes32 lifecycleHash; bytes32 seriesId; uint32 seriesVersion; bytes32 longAccountId; bytes32 shortAccountId; bytes32 riskDomainId; uint32 riskDomainVersion; bytes32 feeScheduleId; uint32 feeScheduleVersion; bytes32 collateralId; uint128 positionLots; uint128 remainingExerciseLots; int128 entryPriceTicks; bytes32 economicsHash; bytes32 packageProvenanceHash; bytes32 exercisePolicyId; uint8 exerciseState; uint128 automaticExerciseThresholdMinor; uint64 expiryAt; uint64 exerciseOpensAt; uint64 exerciseCutoffAt; uint64 lapseEligibleAt; uint128 longTerminalLiabilityBaseUnits; uint128 shortTerminalLiabilityBaseUnits; }";

const positionSnapshotAbi = parseAbi([
  lifecycleSnapshotStruct,
  "function getLifecyclePosition(bytes32 positionId) view returns (LifecyclePositionSnapshot snapshot)",
]);
const lifecyclePolicyBaseAbi = parseAbi([
  lifecycleActionStruct,
  lifecycleSnapshotStruct,
  lifecycleSuccessorStruct,
  "function derivePolicyContext(LifecycleAction action, LifecyclePositionSnapshot[] inputs, LifecycleSuccessor[] successors) view returns (bytes32 policyContextHash, bytes32 packageBreakPermissionHash)",
]);
/** Revert reasons of the lifecycle engine and its libraries, so refusals are reported by name. */
const lifecycleErrorsAbi = parseAbi([
  "error CollateralReplacementMismatch(bytes32 accountId)",
  "error InvalidActorSignature(address actor)",
  "error InvalidCollateralReplacement()",
  "error InvalidConsentSignature(bytes32 accountId, address signer)",
  "error InvalidLifecycleAction()",
  "error InvalidLifecycleInput()",
  "error InvalidLifecyclePayload()",
  "error InvalidLifecycleShape()",
  "error InvalidLifecycleState(bytes32 actionId)",
  "error InvalidLifecycleSuccessor()",
  "error LiabilityToleranceExceeded(bytes32 accountId, uint256 beforeAmount, uint256 afterAmount, uint256 tolerance)",
  "error LifecycleDeadlinePassed(uint64 deadline, uint256 currentTimestamp)",
  "error MissingConsent(bytes32 accountId)",
  "error NonceAlreadyUsed(bytes32 accountId, uint256 nonce)",
  "error PackageBreakNotAuthorized(bytes32 accountId)",
  "error PositionActionIneligible(bytes32 positionId, uint8 actionKind)",
  "error PositionSnapshotMismatch(bytes32 positionId)",
  "error QuantityNotConserved()",
  "error RiskDomainUnavailable(bytes32 riskDomainId, uint32 version)",
  "error UnauthorizedExecutor(address required, address caller)",
  "error UnknownLifecycleAction(bytes32 actionId)",
  "error InputPositionMismatch(bytes32 positionId)",
  "error ReplacementCollateralMismatch(bytes32 accountId)",
  "error UnsupportedLifecycleAction(uint8 kind)",
]);

export const signedLifecycleAbi = parseAbi([
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
const lifecycleEngineAbi = [...signedLifecycleAbi, ...lifecycleErrorsAbi] as const;
const lifecyclePolicyAbi = [...lifecyclePolicyBaseAbi, ...lifecycleErrorsAbi] as const;

/** EIP-712 type the actor signs: the LifecycleAction fields followed by chainId and engine. */
export const lifecycleActionTypes = {
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

// ---------------------------------------------------------------------------------------------------------------
// Onchain shapes and their JSON forms (64-bit and wider integers as decimal strings)

export interface LifecycleAction {
  kind: number;
  actor: Address;
  actorAccountId: Hex;
  policyContextHash: Hex;
  inputsHash: Hex;
  successorsHash: Hex;
  collateralReplacementsHash: Hex;
  participantSetHash: Hex;
  consentsHash: Hex;
  riskDomainId: Hex;
  riskDomainVersion: number;
  feeScheduleId: Hex;
  feeScheduleVersion: number;
  economicTransitionHash: Hex;
  compressionPlanId: Hex;
  breaksPackageProvenance: boolean;
  packageBreakPermissionHash: Hex;
  actorMaximumLiabilityIncreaseBaseUnits: bigint;
  actorMaximumCollateralIncreaseBaseUnits: bigint;
  inputCount: number;
  successorCount: number;
  participantCount: number;
  deadline: bigint;
  nonce: bigint;
  permittedExecutor: Address;
  salt: Hex;
}

export interface LifecycleInput {
  positionId: Hex;
  expectedImmutableHash: Hex;
  expectedLifecycleHash: Hex;
  expectedPositionLots: bigint;
  actionLots: bigint;
}

export interface LifecycleCollateralReplacement {
  accountId: Hex;
  collateralId: Hex;
  terminalLiabilityBaseUnits: bigint;
}

type Serialized<T> = { [K in keyof T]: T[K] extends bigint ? string : T[K] };
export type SerializedLifecycleAction = Serialized<LifecycleAction>;
export type SerializedLifecycleInput = Serialized<LifecycleInput>;
export type SerializedCollateralReplacement = Serialized<LifecycleCollateralReplacement>;
export type SerializedLifecycleConsent = Serialized<LifecycleConsent>;

function serialize<T extends object>(value: T): Serialized<T> {
  return Object.fromEntries(
    Object.entries(value).map(([name, field]) => [name, typeof field === "bigint" ? field.toString() : field]),
  ) as Serialized<T>;
}

const ACTION_BIGINTS = ["actorMaximumLiabilityIncreaseBaseUnits", "actorMaximumCollateralIncreaseBaseUnits", "deadline", "nonce"] as const;
const ACTION_NUMBERS = ["kind", "riskDomainVersion", "feeScheduleVersion", "inputCount", "successorCount", "participantCount"] as const;
const ACTION_HASHES = [
  "actorAccountId",
  "policyContextHash",
  "inputsHash",
  "successorsHash",
  "collateralReplacementsHash",
  "participantSetHash",
  "consentsHash",
  "riskDomainId",
  "feeScheduleId",
  "economicTransitionHash",
  "compressionPlanId",
  "packageBreakPermissionHash",
  "salt",
] as const;

const invalid = (message: string) => new PublicApiError(400, "INVALID_REQUEST", message);
const notEligible = (message: string) => new PublicApiError(409, "EXIT_NOT_ELIGIBLE", message);

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid(`${name} must be an object.`);
  return value as Record<string, unknown>;
}

function bytes32(value: unknown, name: string): Hex {
  if (typeof value !== "string" || !isHex(value, { strict: true }) || value.length !== 66) {
    throw invalid(`${name} must be a 0x-prefixed 32-byte hex value.`);
  }
  return value.toLowerCase() as Hex;
}

function address(value: unknown, name: string): Address {
  if (typeof value !== "string" || !isAddress(value)) throw invalid(`${name} must be an EVM address.`);
  return getAddress(value);
}

function uint(value: unknown, name: string): bigint {
  if (typeof value !== "string" || !/^\d{1,78}$/.test(value)) throw invalid(`${name} must be an unsigned decimal string.`);
  return BigInt(value);
}

function smallInt(value: unknown, name: string): number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 0xffffffff) throw invalid(`${name} must be a non-negative integer.`);
  return value as number;
}

function bool(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw invalid(`${name} must be a boolean.`);
  return value;
}

function signature(value: unknown, name: string): Hex {
  if (typeof value !== "string" || !isHex(value, { strict: true }) || value.length < 132) throw invalid(`${name} must be a hex signature.`);
  return value as Hex;
}

function parseAction(value: unknown): LifecycleAction {
  const raw = record(value, "action");
  const action: Record<string, unknown> = {
    actor: address(raw.actor, "action.actor"),
    permittedExecutor: address(raw.permittedExecutor, "action.permittedExecutor"),
    breaksPackageProvenance: bool(raw.breaksPackageProvenance, "action.breaksPackageProvenance"),
  };
  for (const name of ACTION_HASHES) action[name] = bytes32(raw[name], `action.${name}`);
  for (const name of ACTION_NUMBERS) action[name] = smallInt(raw[name], `action.${name}`);
  for (const name of ACTION_BIGINTS) action[name] = uint(raw[name], `action.${name}`);
  return action as unknown as LifecycleAction;
}

function parseInputs(value: unknown): LifecycleInput[] {
  if (!Array.isArray(value) || value.length !== 2) throw invalid("inputs must be the two lifecycle inputs returned by prepare.");
  return value.map((item, index) => {
    const raw = record(item, `inputs[${index}]`);
    return {
      positionId: bytes32(raw.positionId, `inputs[${index}].positionId`),
      expectedImmutableHash: bytes32(raw.expectedImmutableHash, `inputs[${index}].expectedImmutableHash`),
      expectedLifecycleHash: bytes32(raw.expectedLifecycleHash, `inputs[${index}].expectedLifecycleHash`),
      expectedPositionLots: uint(raw.expectedPositionLots, `inputs[${index}].expectedPositionLots`),
      actionLots: uint(raw.actionLots, `inputs[${index}].actionLots`),
    };
  });
}

function parseReplacements(value: unknown): LifecycleCollateralReplacement[] {
  if (!Array.isArray(value) || value.length !== 2) throw invalid("replacements must be the two collateral replacements returned by prepare.");
  return value.map((item, index) => {
    const raw = record(item, `replacements[${index}]`);
    return {
      accountId: bytes32(raw.accountId, `replacements[${index}].accountId`),
      collateralId: bytes32(raw.collateralId, `replacements[${index}].collateralId`),
      terminalLiabilityBaseUnits: uint(raw.terminalLiabilityBaseUnits, `replacements[${index}].terminalLiabilityBaseUnits`),
    };
  });
}

function parseConsent(value: unknown): LifecycleConsent {
  const raw = record(value, "consent");
  return {
    actionId: bytes32(raw.actionId, "consent.actionId"),
    accountId: bytes32(raw.accountId, "consent.accountId"),
    signer: address(raw.signer, "consent.signer"),
    nonce: uint(raw.nonce, "consent.nonce"),
    deadline: uint(raw.deadline, "consent.deadline"),
    maximumLiabilityIncreaseBaseUnits: uint(raw.maximumLiabilityIncreaseBaseUnits, "consent.maximumLiabilityIncreaseBaseUnits"),
    maximumCollateralIncreaseBaseUnits: uint(raw.maximumCollateralIncreaseBaseUnits, "consent.maximumCollateralIncreaseBaseUnits"),
    allowsPackageBreak: bool(raw.allowsPackageBreak, "consent.allowsPackageBreak"),
    salt: bytes32(raw.salt, "consent.salt"),
  };
}

/**
 * Matched by name, not instanceof: the public client is cached across module reloads (see chain.ts), so its errors may
 * come from another instance of viem's classes.
 */
function contractRevert(error: unknown): ContractFunctionRevertedError | null {
  if (!(error instanceof Error) || typeof (error as BaseError).walk !== "function") return null;
  const reverted = (error as BaseError).walk((cause) => (cause as Error | undefined)?.name === "ContractFunctionRevertedError");
  return reverted ? (reverted as ContractFunctionRevertedError) : null;
}

function revertReason(reverted: ContractFunctionRevertedError): string {
  if (reverted.data) {
    const args = (reverted.data.args ?? []).map((value) => String(value)).join(", ");
    return `${reverted.data.errorName}(${args})`;
  }
  return reverted.reason ?? (reverted.signature ? `custom error ${reverted.signature}` : "reverted");
}

/** A contract refusal becomes EXIT_NOT_ELIGIBLE with its revert reason; anything else (RPC failure) propagates. */
function refusal(context: string) {
  return (error: unknown): never => {
    const reverted = contractRevert(error);
    if (reverted) throw notEligible(`${context} (${revertReason(reverted)}).`);
    throw error;
  };
}

function actorTypedData(context: ChainContext, action: LifecycleAction) {
  const { setryn } = context;
  return {
    domain: lifecycleDomain(setryn),
    types: lifecycleActionTypes,
    primaryType: "SetrynLifecycleActionV1" as const,
    message: { ...action, chainId: BigInt(setryn.chainId), engine: setryn.signedLifecycleEngine },
  };
}

/** The designated maker, whose consent is the only counterparty consent the API can obtain; null without one. */
async function maker(context: ChainContext): Promise<{ address: Address; accountId: Hex } | null> {
  try {
    return await designatedMaker(context.setryn);
  } catch (error) {
    if (error instanceof SignerUnavailableError) return null;
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Prepare

export interface PrepareExitInput {
  signer?: unknown;
  positionIds?: unknown;
}

export async function prepareExit(context: ChainContext, key: StoredApiKey, input: PrepareExitInput) {
  const { client, setryn } = context;
  const signer = address(input.signer, "signer");
  assertSignerAllowed(key, signer);
  if (!Array.isArray(input.positionIds) || input.positionIds.length !== 2) {
    throw invalid("positionIds must list exactly two positions: the open position and the opposite position that closes it.");
  }
  const [sourcePositionId, closePositionId] = input.positionIds.map((value, index) => bytes32(value, `positionIds[${index}]`));
  if (sourcePositionId === closePositionId) throw notEligible("positionIds must name two different positions.");
  const [actorAccountId, houseMaker] = await Promise.all([
    deriveAccountId(context, signer).then((id) => id.toLowerCase() as Hex),
    maker(context),
  ]);
  if (!houseMaker) {
    throw notEligible("This deployment runs no designated maker, so the API cannot obtain counterparty consent for an exit.");
  }
  const snapshots = await Promise.all(
    [sourcePositionId, closePositionId].map((positionId) =>
      client
        .readContract({ address: setryn.positionEngine, abi: positionSnapshotAbi, functionName: "getLifecyclePosition", args: [positionId] })
        .catch(() => {
          throw new PublicApiError(404, "NOT_FOUND", `No position has id ${positionId}.`);
        }),
    ),
  );
  snapshots.sort((left, right) => left.positionId.toLowerCase().localeCompare(right.positionId.toLowerCase()));
  for (const snapshot of snapshots) {
    if (snapshot.positionLots === BigInt(0)) throw notEligible(`Position ${snapshot.positionId} has no open lots.`);
    if (snapshot.packageProvenanceHash !== EMPTY_ID) {
      throw notEligible(`Position ${snapshot.positionId} belongs to a package and must be exited through package compression.`);
    }
  }
  const [first, second] = snapshots;
  if (first.positionLots !== second.positionLots) {
    throw notEligible(`The positions have different sizes (${first.positionLots} and ${second.positionLots} lots); a full exit needs equal lots.`);
  }
  if (first.seriesId.toLowerCase() !== second.seriesId.toLowerCase() || first.collateralId.toLowerCase() !== second.collateralId.toLowerCase()) {
    throw notEligible("The positions are on different series or collateral and cannot offset each other.");
  }
  const participantAccounts = [
    ...new Set(snapshots.flatMap((snapshot) => [snapshot.longAccountId.toLowerCase(), snapshot.shortAccountId.toLowerCase()])),
  ] as Hex[];
  if (!participantAccounts.includes(actorAccountId)) {
    throw notEligible("The signer's account is not a party to these positions.");
  }
  if (participantAccounts.length !== 2) {
    throw notEligible("The two positions must be between the signer's account and one and the same counterparty account.");
  }
  const actorIsLong = snapshots.map((snapshot) => snapshot.longAccountId.toLowerCase() === actorAccountId);
  if (actorIsLong[0] === actorIsLong[1]) {
    throw notEligible("The signer holds the same side on both positions; pair a position with the opposite position that closes it.");
  }
  const counterpartyAccountId = participantAccounts.find((accountId) => accountId !== actorAccountId) as Hex;
  if (counterpartyAccountId !== houseMaker.accountId) {
    throw notEligible("The counterparty is not the designated maker, whose consent is the only counterparty consent the API can obtain.");
  }

  const inputs: LifecycleInput[] = snapshots.map((snapshot) => ({
    positionId: snapshot.positionId,
    expectedImmutableHash: snapshot.immutableHash,
    expectedLifecycleHash: snapshot.lifecycleHash,
    expectedPositionLots: snapshot.positionLots,
    actionLots: snapshot.positionLots,
  }));
  const replacements: LifecycleCollateralReplacement[] = [...participantAccounts]
    .sort((left, right) => left.localeCompare(right))
    .map((accountId) => ({ accountId, collateralId: first.collateralId, terminalLiabilityBaseUnits: BigInt(0) }));

  const makerAddress = houseMaker.address;
  const deadline = context.chainTime + EXIT_LIFETIME_SECONDS;
  const nonce = BigInt(Date.now()) * BigInt(1_000_000) + BigInt(crypto.getRandomValues(new Uint32Array(1))[0]);
  const consentNonce = nonce + BigInt(1);
  const salt = keccak256(stringToHex(`${signer}:${sourcePositionId}:${closePositionId}:${nonce}`));
  const consentSalt = keccak256(stringToHex(`${makerAddress}:${sourcePositionId}:${closePositionId}:${consentNonce}`));
  const consentBase: LifecycleConsent = {
    actionId: EMPTY_ID,
    accountId: counterpartyAccountId,
    signer: makerAddress,
    nonce: consentNonce,
    deadline,
    maximumLiabilityIncreaseBaseUnits: BigInt(0),
    maximumCollateralIncreaseBaseUnits: BigInt(0),
    allowsPackageBreak: false,
    salt: consentSalt,
  };
  const engine = { address: setryn.signedLifecycleEngine, abi: lifecycleEngineAbi } as const;
  const [inputsHash, successorsHash, collateralReplacementsHash, participantSetHash, consentsHash] = await Promise.all([
    client.readContract({ ...engine, functionName: "hashLifecycleInputs", args: [inputs] }),
    client.readContract({ ...engine, functionName: "hashLifecycleSuccessors", args: [[]] }),
    client.readContract({ ...engine, functionName: "hashLifecycleCollateralReplacements", args: [replacements] }),
    client.readContract({ ...engine, functionName: "hashLifecycleParticipantSet", args: [actorAccountId, [consentBase]] }),
    client.readContract({ ...engine, functionName: "hashLifecycleConsentTerms", args: [[consentBase]] }),
  ]).catch(refusal("The lifecycle engine refused the exit terms"));
  let action: LifecycleAction = {
    kind: EXIT_KIND,
    actor: signer,
    actorAccountId,
    policyContextHash: EMPTY_ID,
    inputsHash,
    successorsHash,
    collateralReplacementsHash,
    participantSetHash,
    consentsHash,
    riskDomainId: first.riskDomainId,
    riskDomainVersion: first.riskDomainVersion,
    feeScheduleId: first.feeScheduleId,
    feeScheduleVersion: first.feeScheduleVersion,
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
    permittedExecutor: signer,
    salt,
  };
  const [policyContextHash] = await client.readContract({
    address: setryn.lifecyclePolicyValidator,
    abi: lifecyclePolicyAbi,
    functionName: "derivePolicyContext",
    args: [action, snapshots, []],
  }).catch(refusal("The lifecycle policy refused the exit"));
  action = { ...action, policyContextHash };
  const [, actionId] = await client
    .readContract({ ...engine, functionName: "hashLifecycleAction", args: [action] })
    .catch(refusal("The lifecycle engine refused the exit action"));
  const consent: LifecycleConsent = { ...consentBase, actionId };
  const consentSignature = await signMakerConsent(setryn, consent, [sourcePositionId, closePositionId]).catch((error: unknown) => {
    if (error instanceof MakerConsentRefusal) throw notEligible(error.detail);
    throw error;
  });
  const typedData = actorTypedData(context, action);

  return {
    actionId,
    accountId: actorAccountId,
    counterpartyAccountId,
    positions: snapshots.map((snapshot, index) => ({
      positionId: snapshot.positionId,
      side: actorIsLong[index] ? ("LONG" as const) : ("SHORT" as const),
      lots: Number(snapshot.positionLots),
    })),
    action: serialize(action),
    inputs: inputs.map(serialize),
    replacements: replacements.map(serialize),
    consent: serialize(consent),
    consentSignature,
    typedData: { ...typedData, message: serialize(typedData.message) },
    chainTime: new Date(Number(context.chainTime) * 1000).toISOString(),
    deadline: new Date(Number(deadline) * 1000).toISOString(),
    submitWithinSeconds: Number(deadline - context.chainTime),
    next: "Sign typedData with the signer's wallet (eth_signTypedData_v4 / viem signTypedData), then POST /api/v1/positions/exit with { action, inputs, replacements, consent, consentSignature, actorSignature } before the deadline.",
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Submit

export interface SubmitExitInput {
  action?: unknown;
  inputs?: unknown;
  replacements?: unknown;
  consent?: unknown;
  consentSignature?: unknown;
  actorSignature?: unknown;
}


export async function submitExit(context: ChainContext, key: StoredApiKey, input: SubmitExitInput) {
  const { client, setryn } = context;
  const action = parseAction(input.action);
  const inputs = parseInputs(input.inputs);
  const replacements = parseReplacements(input.replacements);
  const consent = parseConsent(input.consent);
  const consentSignature = signature(input.consentSignature, "consentSignature");
  const actorSignature = signature(input.actorSignature, "actorSignature");
  const signer = action.actor;
  assertSignerAllowed(key, signer);

  if (action.kind !== EXIT_KIND || action.successorCount !== 0 || action.inputCount !== inputs.length || action.participantCount !== 2) {
    throw notEligible("action is not a full lifecycle exit of two positions. Prepare it with POST /api/v1/positions/exit/prepare.");
  }
  if (action.permittedExecutor !== signer) throw notEligible("action.permittedExecutor must be the actor, who sends both transactions.");
  if (action.deadline <= context.chainTime || consent.deadline <= context.chainTime) {
    throw notEligible("The exit deadline has passed on the chain clock. Prepare a fresh exit.");
  }
  const houseMaker = await maker(context);
  if (!houseMaker || getAddress(consent.signer) !== getAddress(houseMaker.address)) throw notEligible("consent was not issued by the designated maker.");

  const engine = { address: setryn.signedLifecycleEngine, abi: lifecycleEngineAbi } as const;
  const [[, actionId], inputsHash, replacementsHash] = await Promise.all([
    client.readContract({ ...engine, functionName: "hashLifecycleAction", args: [action] }),
    client.readContract({ ...engine, functionName: "hashLifecycleInputs", args: [inputs] }),
    client.readContract({ ...engine, functionName: "hashLifecycleCollateralReplacements", args: [replacements] }),
  ]).catch(refusal("The lifecycle engine refused the submitted action, inputs or replacements. Submit the prepared payload unchanged"));
  if (actionId.toLowerCase() !== consent.actionId.toLowerCase()) {
    throw notEligible("The action does not match the counterparty consent (action id differs). Submit the prepared payload unchanged.");
  }
  if (inputsHash.toLowerCase() !== action.inputsHash || replacementsHash.toLowerCase() !== action.collateralReplacementsHash) {
    throw notEligible("inputs or replacements do not match the hashes committed in the action. Submit the prepared payload unchanged.");
  }
  const [consentValid, actorValid] = await Promise.all([
    verifyTypedData({
      address: consent.signer,
      domain: lifecycleDomain(setryn),
      types: lifecycleConsentTypes,
      primaryType: "SetrynLifecycleConsentV1",
      message: consent,
      signature: consentSignature,
    }).catch(() => false),
    verifyTypedData({ address: signer, ...actorTypedData(context, action), signature: actorSignature }).catch(() => false),
  ]);
  if (!consentValid) throw new PublicApiError(401, "INVALID_SIGNATURE", "consentSignature does not recover to the counterparty consent signer.");
  if (!actorValid) throw new PublicApiError(401, "INVALID_SIGNATURE", "actorSignature does not recover to action.actor over SetrynLifecycleActionV1.");

  const authorizeArgs = [action, inputs, [], replacements, [consent], [consentSignature], actorSignature] as const;
  await client
    .simulateContract({ ...engine, account: signer, functionName: "authorizeAction", args: authorizeArgs })
    .catch(refusal("The lifecycle engine refused authorization in simulation. Prepare a fresh exit"));

  const tx = (step: TransactionRequest["step"], description: string, data: Hex): TransactionRequest => ({
    step,
    description,
    chainId: setryn.chainId,
    from: signer,
    to: setryn.signedLifecycleEngine,
    data,
    value: "0",
  });
  return {
    actionId,
    accountId: action.actorAccountId,
    signer,
    positionIds: inputs.map((item) => item.positionId),
    validUntil: new Date(Number(action.deadline) * 1000).toISOString(),
    transactions: [
      tx(
        "AUTHORIZE_LIFECYCLE",
        "Authorize the signed lifecycle exit with the counterparty consent.",
        encodeFunctionData({ abi: signedLifecycleAbi, functionName: "authorizeAction", args: authorizeArgs }),
      ),
      tx(
        "EXECUTE_LIFECYCLE",
        "Execute the authorized exit: both positions close and their collateral locks are released.",
        encodeFunctionData({ abi: signedLifecycleAbi, functionName: "executeAction", args: [action, inputs, [], replacements, [consent]] }),
      ),
    ],
    next: "Send both transactions from the signer in order, waiting for each receipt, before validUntil. Then GET /api/v1/accounts/{accountId}/positions: both positions are gone and their collateral is released.",
  };
}
