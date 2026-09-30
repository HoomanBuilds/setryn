import type { CanonicalEvent, JsonObject as SchemaJsonObject, LogIdentity } from "@setryn/internal-schemas";

import { sha256Hex } from "./store.ts";
import { WEBHOOK_API_VERSION, type JsonObject, type JsonValue, type WebhookEvent, type WebhookEventType } from "./types.ts";

/** A chain log decoded against its contract binding and normalized by the indexer. */
export interface DecodedChainLog {
  readonly contractName: string;
  readonly eventName: string;
  readonly log: LogIdentity;
  /** The indexer's canonical event: enums named, integers as decimal strings, hashes lowercased. */
  readonly canonical: CanonicalEvent;
}

/**
 * Explicit coverage of every non-role event on each watched contract: either the webhook type it drives or the reason
 * it is not exposed. `missingWebhookSourceCoverage` checks this table against the generated bindings at start-up, so
 * a new contract event cannot silently shape (or silently miss) partner-visible state.
 */
export const WEBHOOK_SOURCE_COVERAGE: Readonly<Record<string, Readonly<Record<string, WebhookEventType | `internal:${string}`>>>> = {
  OrderState: {
    OrderRegistered: "order.registered",
    OrderFillConsumed: "order.filled",
    OrderCancelled: "order.cancelled",
    OrderExpired: "order.cancelled",
    OrderRejected: "order.cancelled",
    OrderNonceConsumed: "internal:nonce bookkeeping; the order transition is carried by OrderRegistered",
    OrderNonceCancelled: "internal:cancels an unregistered nonce; no registered order changes state",
  },
  AtomicClearingEngine: {
    FillCleared: "receipt.ready",
    FillPositionCreated: "internal:enriches position.opened with fill id and entry price",
    FillLedgerEntry: "internal:ledger legs are summarized in the receipt.ready fee block",
    OrderFundingReserved: "internal:collateral reservation for a working order",
    OrderFundingReleased: "internal:collateral reservation for a working order",
    OrderFeeFundingReserved: "internal:fee funding reservation for a working order",
    OrderFeeFundingReleased: "internal:fee funding reservation for a working order",
    ClearingChannelActivated: "internal:governance configuration",
  },
  PositionEngine: {
    PositionCreated: "position.opened",
    PositionStatusChanged: "position.closed",
    PositionQuantityChanged: "position.closed",
    PositionPayoffComputed: "internal:payoff evidence precedes settlement.finalized",
    PositionExactPayoffComputed: "internal:payoff evidence precedes settlement.finalized",
    PositionFundingLockCreated: "internal:collateral lock bookkeeping",
    PositionFundingLockReleased: "internal:collateral lock bookkeeping",
  },
  CashSettlementCoordinator: {
    CashSettlementFinalized: "settlement.finalized",
    SettlementClaimFulfilled: "settlement.finalized",
  },
  VerifiableReceiptLedger: {
    ReceiptSubjectFinalized: "receipt.ready",
    EvidenceReceiptAppended: "internal:intermediate receipt; receipt.ready fires when the subject is finalized",
    EvidenceJournalBatchAppended: "internal:journal batch commitment",
  },
  MarketRegistry: {
    MarketRegistered: "market.status",
    MarketStatusChanged: "market.status",
    MarketActiveVersionChanged: "market.status",
  },
  SeriesRegistry: {
    SeriesRegistered: "market.status",
    SeriesStatusChanged: "market.status",
    SeriesActiveVersionChanged: "market.status",
    SeriesQualificationPublished: "internal:qualification evidence has no indexer canonical form yet; the status change it gates is reported",
  },
};

/** Position statuses after which a position holds no open risk. */
const CLOSING_POSITION_STATUSES = new Set([
  "settled",
  "closedByUnwind",
  "replaced",
  "lapsed",
  "cancelledByDisruption",
  "abandoned",
]);

// Contract enums the indexer leaves numeric inside struct payloads. Named here explicitly; unknown values throw.
const SIDE = ["unspecified", "buy", "sell"] as const;
const TIME_IN_FORCE = ["unspecified", "gtc", "gtd", "ioc", "fok"] as const;
const TARGET_KIND = ["unspecified", "series", "package"] as const;
const REMAINDER_POLICY = ["unspecified", "keepOpen", "cancelRemainder"] as const;

function canonicalEnum(value: JsonValue | undefined, names: readonly string[], label: string): string {
  if (typeof value === "string" && names.includes(value)) return value;
  const numeric = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  const name = names[numeric];
  if (!name) throw new TypeError(`unsupported ${label} ${String(value)}`);
  return name;
}

function object(value: JsonValue | undefined, label: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value;
}

function str(value: JsonValue | undefined): string | null {
  if (value === undefined || value === null) return null;
  return typeof value === "string" ? value : String(value);
}

function protocolPayload(entry: DecodedChainLog): JsonObject {
  if (entry.canonical.name !== "protocol.transition") throw new TypeError(`${entry.contractName}.${entry.eventName} is not a protocol transition`);
  return entry.canonical.payload.payload as SchemaJsonObject as JsonObject;
}

export interface EventContext {
  readonly chainId: number;
  readonly environment: string;
}

export function webhookEventId(chainId: number, log: LogIdentity, type: WebhookEventType): string {
  return `evt_${sha256Hex(`${chainId}:${log.block.hash}:${log.transactionHash}:${log.logIndex}:${type}`).slice(0, 40)}`;
}

function build(context: EventContext, entry: DecodedChainLog, type: WebhookEventType, data: JsonObject): WebhookEvent {
  return {
    id: webhookEventId(context.chainId, entry.log, type),
    type,
    apiVersion: WEBHOOK_API_VERSION,
    createdAt: new Date(Number(entry.log.block.timestamp) * 1000).toISOString(),
    network: { chainId: context.chainId, environment: context.environment },
    livemode: false,
    test: false,
    data,
    source: {
      contractName: entry.contractName,
      contractAddress: entry.log.contractAddress,
      eventName: entry.eventName,
      blockNumber: entry.log.block.number.toString(),
      blockHash: entry.log.block.hash,
      transactionHash: entry.log.transactionHash,
      logIndex: entry.log.logIndex,
    },
  };
}

function orderSummary(order: JsonObject): JsonObject {
  return {
    accountId: str(order.accountId),
    targetKind: canonicalEnum(order.targetKind, TARGET_KIND, "order target kind"),
    seriesId: str(order.seriesId),
    packageId: str(order.packageId),
    targetVersion: str(order.targetVersion),
    side: canonicalEnum(order.side, SIDE, "order side"),
    lots: str(order.lots),
    priceTicks: str(order.priceTicks),
    timeInForce: canonicalEnum(order.timeInForce, TIME_IN_FORCE, "time in force"),
    deadline: str(order.deadline),
    maxFeeMinor: str(order.maxFeeMinor),
    allowPartialFills: order.allowPartialFills ?? null,
    minimumFillLots: str(order.minimumFillLots),
    remainderPolicy: canonicalEnum(order.remainderPolicy, REMAINDER_POLICY, "remainder policy"),
    postOnly: order.postOnly ?? null,
    reduceOnly: order.reduceOnly ?? null,
    executionModeId: str(order.executionModeId),
    feeScheduleId: str(order.feeScheduleId),
    recipient: str(order.recipient),
  };
}

/**
 * Maps one confirmed block range of decoded logs to webhook events. Logs must be in chain order; enrichment
 * (entry price on position.opened, de-duplicated closes) only looks within the same transaction.
 */
export function deriveWebhookEvents(context: EventContext, logs: readonly DecodedChainLog[]): WebhookEvent[] {
  const events: WebhookEvent[] = [];
  const byTransaction = new Map<string, DecodedChainLog[]>();
  for (const entry of logs) {
    const list = byTransaction.get(entry.log.transactionHash) ?? [];
    list.push(entry);
    byTransaction.set(entry.log.transactionHash, list);
  }

  for (const entry of logs) {
    const key = `${entry.contractName}.${entry.eventName}`;
    const siblings = byTransaction.get(entry.log.transactionHash) ?? [];
    switch (key) {
      case "OrderState.OrderRegistered": {
        const p = protocolPayload(entry);
        const order = object(p.order, "order");
        events.push(build(context, entry, "order.registered", {
          orderHash: str(p.orderHash),
          signer: str(p.signer),
          nonce: str(p.nonce),
          status: str(p.initialStatus),
          registeredAt: str(p.registeredAt),
          order: orderSummary(order),
        }));
        break;
      }
      case "OrderState.OrderFillConsumed": {
        const p = protocolPayload(entry);
        events.push(build(context, entry, "order.filled", {
          orderHash: str(p.orderHash),
          fillId: str(p.executionReference),
          consumer: str(p.consumer),
          fillLots: str(p.fillLots),
          cumulativeFillLots: str(p.cumulativeFillLots),
          remainingLots: str(p.remainingLots),
          previousStatus: str(p.previousStatus),
          status: str(p.newStatus),
        }));
        break;
      }
      case "OrderState.OrderCancelled":
      case "OrderState.OrderExpired":
      case "OrderState.OrderRejected": {
        const p = protocolPayload(entry);
        const reason = entry.eventName === "OrderCancelled" ? "cancelled" : entry.eventName === "OrderExpired" ? "expired" : "rejected";
        events.push(build(context, entry, "order.cancelled", {
          orderHash: str(p.orderHash),
          reason,
          status: reason,
          previousStatus: str(p.previousStatus),
          filledLots: str(p.filledLots),
          cancelledLots: str(p.cancelledLots ?? p.expiredLots ?? p.rejectedLots),
          actor: str(p.signer ?? p.operator ?? p.consumer),
          rejectionReason: reason === "rejected" ? str(p.reason) : null,
        }));
        break;
      }
      case "AtomicClearingEngine.FillCleared": {
        const p = protocolPayload(entry);
        const record = object(p.record, "fill record");
        events.push(build(context, entry, "receipt.ready", {
          receiptKind: "fill",
          fillId: str(p.fillId),
          takerOrderHash: str(record.takerOrderHash),
          makerOrderHash: str(record.makerOrderHash),
          buyerAccountId: str(record.buyerAccountId),
          sellerAccountId: str(record.sellerAccountId),
          channelKind: str(record.channelKind),
          targetId: str(record.targetId),
          fillLots: str(record.fillLots),
          executionPriceTicks: str(record.executionPriceTicks),
          considerationMinor: str(record.considerationMinor),
          fees: {
            makerChargeMinor: str(record.makerFeeChargeMinor),
            makerRebateMinor: str(record.makerFeeRebateMinor),
            takerChargeMinor: str(record.takerFeeChargeMinor),
            takerRebateMinor: str(record.takerFeeRebateMinor),
          },
          clearedAt: str(record.clearedAt),
          positionCount: str(record.positionCount),
          verification: {
            transactionHash: entry.log.transactionHash,
            blockHash: entry.log.block.hash,
            blockNumber: entry.log.block.number.toString(),
          },
        }));
        break;
      }
      case "PositionEngine.PositionCreated": {
        const p = protocolPayload(entry);
        const positionId = str(p.positionId);
        const fill = siblings.find(
          (sibling) => sibling.eventName === "FillPositionCreated" && str(protocolPayload(sibling).positionId) === positionId,
        );
        const fillPayload = fill ? protocolPayload(fill) : null;
        events.push(build(context, entry, "position.opened", {
          positionId,
          fillId: str(p.fillIdentity),
          seriesId: str(p.seriesId),
          seriesVersion: str(p.seriesVersion),
          longAccountId: str(p.longAccountId),
          shortAccountId: str(p.shortAccountId),
          lots: str(p.lots),
          entryPriceTicks: fillPayload ? str(fillPayload.entryPriceTicks) : null,
          clearingEngine: str(p.clearingEngine),
        }));
        break;
      }
      case "PositionEngine.PositionStatusChanged": {
        const p = protocolPayload(entry);
        const status = str(p.newStatus);
        if (!status || !CLOSING_POSITION_STATUSES.has(status)) break;
        events.push(build(context, entry, "position.closed", {
          positionId: str(p.positionId),
          reason: status,
          previousStatus: str(p.previousStatus),
          status,
          transitionReference: str(p.transitionReference),
          remainingLots: null,
        }));
        break;
      }
      case "PositionEngine.PositionQuantityChanged": {
        const p = protocolPayload(entry);
        if (str(p.remainingLots) !== "0") break;
        const positionId = str(p.positionId);
        // A terminal status change for the same position in the same transaction already reports the close.
        const closedByStatus = siblings.some((sibling) => {
          if (sibling.eventName !== "PositionStatusChanged") return false;
          const sp = protocolPayload(sibling);
          return str(sp.positionId) === positionId && CLOSING_POSITION_STATUSES.has(str(sp.newStatus) ?? "");
        });
        if (closedByStatus) break;
        events.push(build(context, entry, "position.closed", {
          positionId,
          reason: "quantityExhausted",
          previousStatus: null,
          status: null,
          transitionReference: str(p.transitionReference),
          remainingLots: "0",
          closedLots: str(p.closedLots),
          exercisedLots: str(p.exercisedLots),
        }));
        break;
      }
      case "CashSettlementCoordinator.CashSettlementFinalized": {
        const p = protocolPayload(entry);
        events.push(build(context, entry, "settlement.finalized", {
          stage: "finalized",
          settlementId: str(p.settlementId),
          positionId: str(p.positionId),
          mode: str(p.mode),
          outcomeHash: str(p.outcomeHash),
          fixingsHash: str(p.fixingsHash),
          terminalTransferMinor: str(p.terminalTransferMinor),
          terminalAmount: str(p.terminalAmount),
          claimId: null,
        }));
        break;
      }
      case "CashSettlementCoordinator.SettlementClaimFulfilled": {
        const p = protocolPayload(entry);
        events.push(build(context, entry, "settlement.finalized", {
          stage: "claimFulfilled",
          settlementId: str(p.settlementId),
          positionId: str(p.positionId),
          claimId: str(p.claimId),
        }));
        break;
      }
      case "VerifiableReceiptLedger.ReceiptSubjectFinalized": {
        const p = protocolPayload(entry);
        events.push(build(context, entry, "receipt.ready", {
          receiptKind: "evidence",
          subjectKindId: str(p.subjectKindId),
          subjectId: str(p.subjectId),
          finalReceiptId: str(p.finalReceiptId),
          stateHash: str(p.stateHash),
          outcomeHash: str(p.outcomeHash),
        }));
        break;
      }
      default: {
        const canonical = entry.canonical;
        if (entry.contractName !== "MarketRegistry" && entry.contractName !== "SeriesRegistry") break;
        if (canonical.name === "registry.version.registered") {
          events.push(build(context, entry, "market.status", {
            registry: canonical.payload.registry,
            entityId: canonical.payload.entityId,
            change: "registered",
            version: canonical.payload.version,
            status: canonical.payload.initialStatus,
            previousStatus: null,
            definitionHash: canonical.payload.definitionHash,
          }));
        } else if (canonical.name === "registry.status.changed") {
          events.push(build(context, entry, "market.status", {
            registry: canonical.payload.registry,
            entityId: canonical.payload.entityId,
            change: "statusChanged",
            version: canonical.payload.version,
            status: canonical.payload.newStatus,
            previousStatus: canonical.payload.previousStatus,
          }));
        } else if (canonical.name === "registry.active-version.changed") {
          events.push(build(context, entry, "market.status", {
            registry: canonical.payload.registry,
            entityId: canonical.payload.entityId,
            change: "activeVersionChanged",
            version: canonical.payload.newVersion,
            previousVersion: canonical.payload.previousVersion,
          }));
        }
      }
    }
  }
  return events;
}

/** Sample payloads for `POST /webhooks/{id}/test`, marked `test: true` and carrying no chain source. */
export function testEvent(type: WebhookEventType, context: EventContext, nonce: string): WebhookEvent {
  return {
    id: `evt_test_${sha256Hex(`${type}:${nonce}`).slice(0, 32)}`,
    type,
    apiVersion: WEBHOOK_API_VERSION,
    createdAt: new Date().toISOString(),
    network: { chainId: context.chainId, environment: context.environment },
    livemode: false,
    test: true,
    data: { message: `Test ${type} delivery from Setryn`, nonce },
    source: null,
  };
}
