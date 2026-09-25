import {
  parseCanonicalEvent,
  type CanonicalEvent,
  type JsonObject,
  type JsonValue,
  type LogIdentity,
  type RegistryKind,
  type ProtocolEventDomain,
} from "@setryn/internal-schemas";

export interface DecodedContractLog {
  readonly contractName: string;
  readonly eventName: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly log: LogIdentity;
}

interface RegistryDescriptor {
  readonly kind: RegistryKind;
  readonly registered: string;
  readonly status: string;
  readonly active?: string;
  readonly idField: string;
}

const registryDescriptors: readonly RegistryDescriptor[] = [
  { kind: "asset", registered: "AssetRegistered", status: "AssetStatusChanged", idField: "assetId" },
  {
    kind: "settlementAsset",
    registered: "SettlementAssetRegistered",
    status: "SettlementAssetStatusChanged",
    active: "SettlementAssetActiveVersionChanged",
    idField: "assetId",
  },
  {
    kind: "adapter",
    registered: "AdapterRegistered",
    status: "AdapterStatusChanged",
    active: "AdapterActiveVersionChanged",
    idField: "adapterId",
  },
  {
    kind: "calendar",
    registered: "CalendarRegistered",
    status: "CalendarStatusChanged",
    active: "CalendarActiveVersionChanged",
    idField: "calendarId",
  },
  {
    kind: "session",
    registered: "SessionRegistered",
    status: "SessionStatusChanged",
    active: "SessionActiveVersionChanged",
    idField: "sessionId",
  },
  {
    kind: "benchmark",
    registered: "BenchmarkRegistered",
    status: "BenchmarkStatusChanged",
    active: "BenchmarkActiveVersionChanged",
    idField: "benchmarkId",
  },
  {
    kind: "feeSchedule",
    registered: "FeeScheduleRegistered",
    status: "FeeScheduleStatusChanged",
    active: "FeeScheduleActiveVersionChanged",
    idField: "feeScheduleId",
  },
  {
    kind: "riskDomain",
    registered: "RiskDomainRegistered",
    status: "RiskDomainStatusChanged",
    active: "RiskDomainActiveVersionChanged",
    idField: "riskDomainId",
  },
  {
    kind: "instrument",
    registered: "InstrumentRegistered",
    status: "InstrumentStatusChanged",
    active: "InstrumentActiveVersionChanged",
    idField: "instrumentId",
  },
  {
    kind: "market",
    registered: "MarketRegistered",
    status: "MarketStatusChanged",
    active: "MarketActiveVersionChanged",
    idField: "marketId",
  },
  {
    kind: "series",
    registered: "SeriesRegistered",
    status: "SeriesStatusChanged",
    active: "SeriesActiveVersionChanged",
    idField: "seriesId",
  },
  {
    kind: "package",
    registered: "PackageRegistered",
    status: "PackageStatusChanged",
    active: "PackageActiveVersionChanged",
    idField: "packageId",
  },
];

interface ProtocolDescriptor {
  readonly domain: ProtocolEventDomain;
  readonly subjectFields: readonly string[];
}

const protocolDescriptors: Readonly<Record<string, ProtocolDescriptor>> = {
  OrderState: { domain: "orders", subjectFields: ["orderHash"] },
  PublicOrderBook: { domain: "books", subjectFields: ["bookId", "orderHash"] },
  PrivateRfqBook: { domain: "rfqs", subjectFields: ["rfqId", "quoteId"] },
  SealedAuctionHouse: { domain: "auctions", subjectFields: ["auctionId", "bidId"] },
  StreamingQuoteEngine: { domain: "streams", subjectFields: ["streamId"] },
  CollateralAwareRouteEngine: { domain: "routes", subjectFields: ["routeId", "planHash"] },
  BatchClearingEngine: { domain: "fills", subjectFields: ["batchExecutionId", "allocationId", "fillId"] },
  AtomicClearingEngine: { domain: "fills", subjectFields: ["fillId", "orderHash"] },
  PositionEngine: { domain: "positions", subjectFields: ["positionId"] },
  FixingEngine: { domain: "fixing", subjectFields: ["fixingKey", "proposalHash"] },
  CashSettlementCoordinator: { domain: "settlement", subjectFields: ["settlementId", "claimId"] },
  FundedFeeEngine: { domain: "fees", subjectFields: ["consumptionId", "feeScheduleId"] },
  PortfolioRiskEngine: { domain: "risk", subjectFields: ["admissionId", "positionId", "accountId"] },
  SignedLifecycleEngine: { domain: "lifecycle", subjectFields: ["actionId"] },
  CompressionCoordinator: { domain: "lifecycle", subjectFields: ["planId"] },
  PositionLifecycleExecutor: { domain: "lifecycle", subjectFields: ["actionId", "planId", "processId"] },
  DefaultProcessEngine: { domain: "default", subjectFields: ["processId", "bidId", "depositId"] },
  PrivacyCommitmentRegistry: { domain: "privacy", subjectFields: ["envelopeId", "grantId", "policyId"] },
  VerifiableReceiptLedger: { domain: "receipts", subjectFields: ["receiptId", "subjectId"] },
  OperationalAdapterExecutor: { domain: "asyncAdapters", subjectFields: ["actionId"] },
};

const enumSchemas: Partial<Record<ProtocolEventDomain, Readonly<Record<string, readonly string[]>>>> = {
  orders: {
    status: ["unspecified", "open", "partiallyFilled", "filled", "cancelled", "expired", "rejected"],
    previousStatus: ["unspecified", "open", "partiallyFilled", "filled", "cancelled", "expired", "rejected"],
    newStatus: ["unspecified", "open", "partiallyFilled", "filled", "cancelled", "expired", "rejected"],
    initialStatus: ["unspecified", "open", "partiallyFilled", "filled", "cancelled", "expired", "rejected"],
    targetKind: ["unspecified", "series", "package"],
    timeInForce: ["unspecified", "gtc", "gtd", "ioc", "fok"],
    remainderPolicy: ["unspecified", "keepOpen", "cancelRemainder"],
  },
  books: {
    side: ["unspecified", "buy", "sell"],
    status: ["unspecified", "resting", "removed"],
    removalReason: ["unspecified", "filled", "cancelled", "expired", "rejected", "ineligible"],
    liquidityKind: ["unspecified", "direct"],
    targetKind: ["unspecified", "series", "package"],
  },
  rfqs: {
    previousStatus: ["unspecified", "inviting", "collecting", "selectionLocked", "capacityReserved", "authorized", "submitted", "clearing", "settled", "cancelled", "expired", "rejected"],
    newStatus: ["unspecified", "inviting", "collecting", "selectionLocked", "capacityReserved", "authorized", "submitted", "clearing", "settled", "cancelled", "expired", "rejected"],
    quoteStatus: ["unspecified", "offered", "reserved", "selected", "consumed", "cancelled", "expired", "rejected"],
    capacityStatus: ["unspecified", "active", "released", "expired", "consumed"],
    targetKind: ["unspecified", "series", "package"],
    sidePolicy: ["unspecified", "buyOnly", "sellOnly", "twoWay"],
  },
  auctions: {
    previousStatus: ["unspecified", "scheduled", "commitOpen", "revealOpen", "readyToClear", "cleared", "settled", "cancelled", "failed"],
    newStatus: ["unspecified", "scheduled", "commitOpen", "revealOpen", "readyToClear", "cleared", "settled", "cancelled", "failed"],
    status: ["unspecified", "committed", "revealed", "winner", "loser", "unrevealed", "bondReleased", "bondSlashed"],
  },
  routes: { previousStatus: ["unspecified", "reserved", "handoffConsumed", "settled", "invalidated", "expired"], newStatus: ["unspecified", "reserved", "handoffConsumed", "settled", "invalidated", "expired"] },
  fills: { channelKind: ["unspecified", "direct", "privateRfq", "sealedAuction"], entryKind: ["unspecified", "consideration", "makerFee", "takerFee"] },
  positions: { previousStatus: ["unspecified", "live", "fixing", "settlementReady", "settled", "closedByUnwind", "replaced", "lapsed", "cancelledByDisruption", "defaulted", "terminalClaim"], newStatus: ["unspecified", "live", "fixing", "settlementReady", "settled", "closedByUnwind", "replaced", "lapsed", "cancelledByDisruption", "defaulted", "terminalClaim"] },
  fixing: { resolutionKind: ["unspecified", "primaryFinal", "fallbackFinal", "terminalDisruption"] },
  settlement: { mode: ["unspecified", "normal", "terminalDisruption", "lapsed"] },
  fees: { kind: ["unspecified", "chargeDebit", "chargeCredit", "budgetDebit", "rebateCredit"] },
  risk: { status: ["unspecified", "reserved", "consumed", "released"] },
  lifecycle: { previousStatus: ["unspecified", "authorized", "executing", "executed", "cancelled", "expired"], newStatus: ["unspecified", "authorized", "executing", "executed", "cancelled", "expired"] },
  default: { previousStatus: ["unspecified", "cureOpen", "cured", "commitOpen", "revealOpen", "readyToClear", "auctionCleared", "resolved", "terminalResolved", "recoveryRequired"], newStatus: ["unspecified", "cureOpen", "cured", "commitOpen", "revealOpen", "readyToClear", "auctionCleared", "resolved", "terminalResolved", "recoveryRequired"] },
  privacy: { previousStatus: ["unspecified", "active", "paused", "deprecated"], newStatus: ["unspecified", "active", "paused", "deprecated"], initialStatus: ["unspecified", "active", "paused", "deprecated"], envelopeStatus: ["unspecified", "active", "revealed", "expired"], grantStatus: ["unspecified", "active", "consumed", "revoked", "expired"] },
  asyncAdapters: { previousState: ["unspecified", "submitted", "included", "unknown", "reconciling", "complete", "recovering", "recovered", "noEffect"], newState: ["unspecified", "submitted", "included", "unknown", "reconciling", "complete", "recovering", "recovered", "noEffect"] },
};

const collateralNames: Readonly<Record<string, string>> = {
  AccountCreated: "collateral.account.created",
  AccountControlProposed: "collateral.account.control-proposed",
  AccountControlProposalCancelled: "collateral.account.control-proposal-cancelled",
  AccountControlTransferred: "collateral.account.control-transferred",
  LockOperatorSet: "collateral.account.lock-operator-set",
  CollateralDeposited: "collateral.deposited",
  CollateralWithdrawn: "collateral.withdrawn",
  CollateralTransferred: "collateral.transferred",
  CollateralLockCreated: "collateral.lock.created",
  CollateralLockReleased: "collateral.lock.released",
  CollateralLockConsumed: "collateral.lock.consumed",
  CollateralLockConverted: "collateral.lock.converted",
  TerminalLiabilityReservationCreated: "collateral.terminal-reservation.created",
  TerminalLiabilityReservationResolved: "collateral.terminal-reservation.resolved",
  TerminalClaimCreated: "collateral.terminal-claim.created",
  TerminalClaimFulfilled: "collateral.terminal-claim.fulfilled",
  ExcessRecovered: "collateral.excess-recovered",
};

const lockStatuses = ["unspecified", "active", "released", "consumed", "expired"] as const;
const terminalReservationStatuses = [
  "unspecified",
  "active",
  "settled",
  "releasedAtTerminal",
  "convertedToClaim",
] as const;
const terminalOutcomes = ["unspecified", "payout", "noEffect", "flat", "claim"] as const;

export function normalizeDecodedLog(decoded: DecodedContractLog): CanonicalEvent | null {
  const registry = registryDescriptors.find(
    (candidate) =>
      candidate.registered === decoded.eventName ||
      candidate.status === decoded.eventName ||
      candidate.active === decoded.eventName,
  );
  if (registry) {
    return normalizeRegistryLog(decoded, registry);
  }
  const collateralName = collateralNames[decoded.eventName];
  if (collateralName) {
    return parseCanonicalEvent({
      name: collateralName,
      log: decoded.log,
      contractName: decoded.contractName,
      payload: normalizeCollateralPayload(decoded.eventName, decoded.args),
    });
  }
  const protocol = protocolDescriptors[decoded.contractName];
  if (!protocol) return null;
  const subjectId = protocol.subjectFields.map((field) => decoded.args[field]).find((value) => value !== undefined);
  if (typeof subjectId !== "string") {
    throw new TypeError(`${decoded.contractName}.${decoded.eventName} has no canonical subject ID`);
  }
  return parseCanonicalEvent({
    name: "protocol.transition",
    log: decoded.log,
    contractName: decoded.contractName,
    payload: {
      domain: protocol.domain,
      eventName: decoded.eventName,
      subjectId,
      payload: normalizeProtocolPayload(protocol.domain, decoded.args),
    },
  });
}

function normalizeProtocolPayload(
  domain: ProtocolEventDomain,
  args: Readonly<Record<string, unknown>>,
): JsonObject {
  return normalizeProtocolObject(domain, args);
}

function normalizeProtocolObject(
  domain: ProtocolEventDomain,
  value: Readonly<Record<string, unknown>>,
): JsonObject {
  const schema = enumSchemas[domain] ?? {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => {
        const enumValues = schema[key];
        if (enumValues) return [key, enumValue(item, enumValues, `${domain}.${key}`)];
        if (Array.isArray(item)) {
          return [key, item.map((entry) => typeof entry === "object" && entry !== null ? normalizeProtocolObject(domain, entry as Record<string, unknown>) : toJsonValue(entry))];
        }
        if (typeof item === "object" && item !== null) {
          return [key, normalizeProtocolObject(domain, item as Record<string, unknown>)];
        }
        return [key, toJsonValue(item)];
      }),
  );
}

function normalizeCollateralPayload(
  eventName: string,
  args: Readonly<Record<string, unknown>>,
): JsonObject {
  const payload = toJsonObject(args);
  if (
    eventName === "CollateralLockReleased" ||
    eventName === "CollateralLockConsumed" ||
    eventName === "CollateralLockConverted"
  ) {
    return { ...payload, newStatus: enumValue(args.newStatus, lockStatuses, "lock status") };
  }
  if (eventName === "TerminalLiabilityReservationResolved") {
    return {
      ...payload,
      terminalOutcome: enumValue(args.terminalOutcome, terminalOutcomes, "terminal outcome"),
      newStatus: enumValue(args.newStatus, terminalReservationStatuses, "terminal reservation status"),
    };
  }
  return payload;
}

function enumValue(value: unknown, values: readonly string[], label: string): string {
  const numeric = toSafeNumber(value, label);
  const canonical = values[numeric];
  if (!canonical) {
    throw new TypeError(`Unsupported ${label} ${numeric}`);
  }
  return canonical;
}

function normalizeRegistryLog(decoded: DecodedContractLog, registry: RegistryDescriptor): CanonicalEvent {
  const args = decoded.args;
  if (decoded.eventName === registry.registered) {
    const definition =
      args.definition && typeof args.definition === "object"
        ? toJsonObject(args.definition as Record<string, unknown>)
        : toJsonObject(
            Object.fromEntries(
              Object.entries(args).filter(([key]) =>
                ![registry.idField, "version", "versionHash", "definitionHash", "initialStatus", "operator", "registrar"].includes(key),
              ),
            ),
          );
    return parseCanonicalEvent({
      name: "registry.version.registered",
      log: decoded.log,
      contractName: decoded.contractName,
      payload: {
        registry: registry.kind,
        entityId: args[registry.idField],
        version: toSafeNumber(args.version ?? 1, "version"),
        versionHash: args.versionHash ?? null,
        definitionHash: args.definitionHash,
        initialStatus: args.initialStatus === undefined ? "active" : registryStatus(args.initialStatus),
        definition,
        operator: args.operator ?? args.registrar,
      },
    });
  }
  if (decoded.eventName === registry.status) {
    return parseCanonicalEvent({
      name: "registry.status.changed",
      log: decoded.log,
      contractName: decoded.contractName,
      payload: {
        registry: registry.kind,
        entityId: args[registry.idField],
        version: toSafeNumber(args.version ?? 1, "version"),
        previousStatus: registryStatus(args.previousStatus),
        newStatus: registryStatus(args.newStatus),
        operator: args.operator,
      },
    });
  }
  return parseCanonicalEvent({
    name: "registry.active-version.changed",
    log: decoded.log,
    contractName: decoded.contractName,
    payload: {
      registry: registry.kind,
      entityId: args[registry.idField],
      previousVersion: toSafeNumber(args.previousVersion, "previousVersion"),
      newVersion: toSafeNumber(args.newVersion, "newVersion"),
      operator: args.operator,
    },
  });
}

function registryStatus(value: unknown): string {
  const numeric = toSafeNumber(value, "registry status");
  const statuses = ["unspecified", "active", "paused", "deprecated"];
  const status = statuses[numeric];
  if (!status) {
    throw new TypeError(`Unsupported registry status ${numeric}`);
  }
  return status;
}

function toSafeNumber(value: unknown, label: string): number {
  const numberValue = typeof value === "bigint" ? Number(value) : value;
  if (!Number.isSafeInteger(numberValue) || (numberValue as number) < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
  return numberValue as number;
}

function toJsonObject(value: Readonly<Record<string, unknown>>): JsonObject {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, toJsonValue(item)]),
  );
}

function toJsonValue(value: unknown): JsonValue {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Decoded number must be finite");
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(toJsonValue);
  }
  if (typeof value === "object") {
    return toJsonObject(value as Record<string, unknown>);
  }
  throw new TypeError(`Decoded value of type ${typeof value} is not projectable`);
}
