import { assertJsonValue, isJsonObject, type JsonObject } from "./json.ts";
import { parseAddress, parseBytes32, type Address, type Bytes32 } from "./ids.ts";
import {
  parseBlockIdentity,
  parseChainId,
  parseLogIdentity,
  parseNonNegativeInteger,
  type LogIdentity,
} from "./network.ts";

export const registryKinds = [
  "asset",
  "settlementAsset",
  "adapter",
  "calendar",
  "session",
  "benchmark",
  "feeSchedule",
  "riskDomain",
  "instrument",
  "market",
  "series",
  "package",
] as const;

export type RegistryKind = (typeof registryKinds)[number];
export type RegistryStatus = "unspecified" | "active" | "paused" | "deprecated";

export interface EventBase<Name extends string, Payload> {
  readonly name: Name;
  readonly log: LogIdentity;
  readonly contractName: string;
  readonly payload: Payload;
}

export interface RegistryVersionRegisteredPayload {
  readonly registry: RegistryKind;
  readonly entityId: Bytes32;
  readonly version: number;
  readonly versionHash: Bytes32 | null;
  readonly definitionHash: Bytes32;
  readonly initialStatus: RegistryStatus;
  readonly definition: JsonObject;
  readonly operator: Address;
}

export interface RegistryStatusChangedPayload {
  readonly registry: RegistryKind;
  readonly entityId: Bytes32;
  readonly version: number;
  readonly previousStatus: RegistryStatus;
  readonly newStatus: RegistryStatus;
  readonly operator: Address;
}

export interface RegistryActiveVersionChangedPayload {
  readonly registry: RegistryKind;
  readonly entityId: Bytes32;
  readonly previousVersion: number;
  readonly newVersion: number;
  readonly operator: Address;
}

export type RegistryEvent =
  | EventBase<"registry.version.registered", RegistryVersionRegisteredPayload>
  | EventBase<"registry.status.changed", RegistryStatusChangedPayload>
  | EventBase<"registry.active-version.changed", RegistryActiveVersionChangedPayload>;

export type CollateralEventName =
  | "collateral.account.created"
  | "collateral.account.control-proposed"
  | "collateral.account.control-proposal-cancelled"
  | "collateral.account.control-transferred"
  | "collateral.account.lock-operator-set"
  | "collateral.deposited"
  | "collateral.withdrawn"
  | "collateral.transferred"
  | "collateral.lock.created"
  | "collateral.lock.released"
  | "collateral.lock.consumed"
  | "collateral.lock.converted"
  | "collateral.terminal-reservation.created"
  | "collateral.terminal-reservation.resolved"
  | "collateral.terminal-reservations.replaced"
  | "collateral.terminal-claim.created"
  | "collateral.terminal-claim.fulfilled"
  | "collateral.excess-recovered";

export type CollateralEvent = EventBase<CollateralEventName, JsonObject>;

export const protocolEventDomains = [
  "orders",
  "books",
  "rfqs",
  "auctions",
  "streams",
  "routes",
  "fills",
  "positions",
  "fixing",
  "settlement",
  "fees",
  "risk",
  "lifecycle",
  "default",
  "privacy",
  "receipts",
  "asyncAdapters",
] as const;

export type ProtocolEventDomain = (typeof protocolEventDomains)[number];

export interface ProtocolTransitionPayload {
  readonly domain: ProtocolEventDomain;
  readonly eventName: string;
  readonly subjectId: Bytes32;
  readonly payload: JsonObject;
}

export type ProtocolTransitionEvent = EventBase<"protocol.transition", ProtocolTransitionPayload>;

export interface DeploymentIdentityPayload {
  readonly environment: string;
  readonly chainId: number;
  readonly contractName: string;
  readonly artifact: string;
  readonly address: Address;
  readonly runtimeCodeHash: Bytes32;
  readonly deploymentTransactionHash: Bytes32;
  readonly deploymentBlockNumber: number;
}

export type DeploymentIdentityEvent = EventBase<"deployment.identity.observed", DeploymentIdentityPayload>;

export type CanonicalEvent = RegistryEvent | CollateralEvent | DeploymentIdentityEvent | ProtocolTransitionEvent;

export interface CanonicalBlock {
  readonly chainId: number;
  readonly number: bigint;
  readonly hash: Bytes32;
  readonly parentHash: Bytes32;
  readonly timestamp: bigint;
  readonly events: readonly CanonicalEvent[];
}

const collateralEventNames = new Set<CollateralEventName>([
  "collateral.account.created",
  "collateral.account.control-proposed",
  "collateral.account.control-proposal-cancelled",
  "collateral.account.control-transferred",
  "collateral.account.lock-operator-set",
  "collateral.deposited",
  "collateral.withdrawn",
  "collateral.transferred",
  "collateral.lock.created",
  "collateral.lock.released",
  "collateral.lock.consumed",
  "collateral.lock.converted",
  "collateral.terminal-reservation.created",
  "collateral.terminal-reservation.resolved",
  "collateral.terminal-reservations.replaced",
  "collateral.terminal-claim.created",
  "collateral.terminal-claim.fulfilled",
  "collateral.excess-recovered",
]);

const registryStatuses = new Set<RegistryStatus>(["unspecified", "active", "paused", "deprecated"]);
const registryKindSet = new Set<RegistryKind>(registryKinds);
const protocolEventDomainSet = new Set<ProtocolEventDomain>(protocolEventDomains);

export function parseCanonicalBlock(value: unknown): CanonicalBlock {
  if (!isJsonObject(value)) {
    throw new TypeError("canonical block must be an object");
  }
  const identity = parseBlockIdentity(value);
  if (!Array.isArray(value.events)) {
    throw new TypeError("canonical block events must be an array");
  }
  const events = value.events.map(parseCanonicalEvent);
  for (const event of events) {
    if (
      event.log.block.chainId !== identity.chainId ||
      event.log.block.number !== identity.number ||
      event.log.block.hash !== identity.hash ||
      event.log.block.parentHash !== identity.parentHash
    ) {
      throw new TypeError("event block identity does not match its containing block");
    }
  }
  return { ...identity, events };
}

export function parseCanonicalEvent(value: unknown): CanonicalEvent {
  if (!isJsonObject(value)) {
    throw new TypeError("canonical event must be an object");
  }
  const name = requireString(value.name, "event.name");
  const log = parseLogIdentity(value.log);
  const contractName = requireString(value.contractName, "event.contractName");
  if (!isJsonObject(value.payload)) {
    throw new TypeError("event.payload must be an object");
  }
  assertJsonValue(value.payload, "event.payload");
  if (name === "registry.version.registered") {
    return { name, log, contractName, payload: parseRegisteredPayload(value.payload) };
  }
  if (name === "registry.status.changed") {
    return { name, log, contractName, payload: parseStatusPayload(value.payload) };
  }
  if (name === "registry.active-version.changed") {
    return { name, log, contractName, payload: parseActiveVersionPayload(value.payload) };
  }
  if (name === "deployment.identity.observed") {
    return { name, log, contractName, payload: parseDeploymentPayload(value.payload) };
  }
  if (name === "protocol.transition") {
    return { name, log, contractName, payload: parseProtocolTransitionPayload(value.payload) };
  }
  if (collateralEventNames.has(name as CollateralEventName)) {
    return { name: name as CollateralEventName, log, contractName, payload: value.payload };
  }
  throw new TypeError(`unsupported canonical event ${name}`);
}

function parseProtocolTransitionPayload(value: JsonObject): ProtocolTransitionPayload {
  const domain = value.domain;
  if (typeof domain !== "string" || !protocolEventDomainSet.has(domain as ProtocolEventDomain)) {
    throw new TypeError("protocol event domain is unsupported");
  }
  if (!isJsonObject(value.payload)) {
    throw new TypeError("protocol event payload must be an object");
  }
  return {
    domain: domain as ProtocolEventDomain,
    eventName: requireString(value.eventName, "protocol event name"),
    subjectId: parseBytes32(value.subjectId, "protocol subject ID"),
    payload: value.payload,
  };
}

function parseRegisteredPayload(value: JsonObject): RegistryVersionRegisteredPayload {
  const registry = parseRegistry(value.registry);
  const initialStatus = parseRegistryStatus(value.initialStatus, "initialStatus");
  if (!isJsonObject(value.definition)) {
    throw new TypeError("definition must be an object");
  }
  return {
    registry,
    entityId: parseBytes32(value.entityId, "entityId"),
    version: parseNonNegativeInteger(value.version, "version"),
    versionHash: value.versionHash === null ? null : parseBytes32(value.versionHash, "versionHash"),
    definitionHash: parseBytes32(value.definitionHash, "definitionHash"),
    initialStatus,
    definition: value.definition,
    operator: parseAddress(value.operator, "operator"),
  };
}

function parseStatusPayload(value: JsonObject): RegistryStatusChangedPayload {
  return {
    registry: parseRegistry(value.registry),
    entityId: parseBytes32(value.entityId, "entityId"),
    version: parseNonNegativeInteger(value.version, "version"),
    previousStatus: parseRegistryStatus(value.previousStatus, "previousStatus"),
    newStatus: parseRegistryStatus(value.newStatus, "newStatus"),
    operator: parseAddress(value.operator, "operator"),
  };
}

function parseActiveVersionPayload(value: JsonObject): RegistryActiveVersionChangedPayload {
  return {
    registry: parseRegistry(value.registry),
    entityId: parseBytes32(value.entityId, "entityId"),
    previousVersion: parseNonNegativeInteger(value.previousVersion, "previousVersion"),
    newVersion: parseNonNegativeInteger(value.newVersion, "newVersion"),
    operator: parseAddress(value.operator, "operator"),
  };
}

function parseDeploymentPayload(value: JsonObject): DeploymentIdentityPayload {
  return {
    environment: requireString(value.environment, "environment"),
    chainId: parseChainId(value.chainId),
    contractName: requireString(value.contractName, "contractName"),
    artifact: requireString(value.artifact, "artifact"),
    address: parseAddress(value.address, "address"),
    runtimeCodeHash: parseBytes32(value.runtimeCodeHash, "runtimeCodeHash"),
    deploymentTransactionHash: parseBytes32(value.deploymentTransactionHash, "deploymentTransactionHash"),
    deploymentBlockNumber: parseNonNegativeInteger(value.deploymentBlockNumber, "deploymentBlockNumber"),
  };
}

function parseRegistry(value: unknown): RegistryKind {
  if (typeof value !== "string" || !registryKindSet.has(value as RegistryKind)) {
    throw new TypeError("registry is unsupported");
  }
  return value as RegistryKind;
}

function parseRegistryStatus(value: unknown, label: string): RegistryStatus {
  if (typeof value !== "string" || !registryStatuses.has(value as RegistryStatus)) {
    throw new TypeError(`${label} is unsupported`);
  }
  return value as RegistryStatus;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}
