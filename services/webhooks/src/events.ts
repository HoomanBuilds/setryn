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

type CoverageEntry = WebhookEventType | readonly WebhookEventType[] | `internal:${string}` | `enrichment:${string}`;

/**
 * Explicit coverage of every non-role event on each watched contract: the webhook type(s) it drives, `enrichment:`
 * when it only adds fields to a sibling event in the same transaction, or `internal:` with the reason it is not
 * exposed. `missingWebhookSourceCoverage` checks this table against the generated bindings at start-up, so a new
 * contract event cannot silently shape (or silently miss) partner-visible state.
 */
export const WEBHOOK_SOURCE_COVERAGE: Readonly<Record<string, Readonly<Record<string, CoverageEntry>>>> = {
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
    FillPositionCreated: "enrichment:adds the fill id and entry price to position.opened",
    FillLedgerEntry: "internal:ledger legs are summarized in the receipt.ready fee block",
    OrderFundingReserved: "internal:collateral reservation for a working order",
    OrderFundingReleased: "internal:collateral reservation for a working order",
    OrderFeeFundingReserved: "internal:fee funding reservation for a working order",
    OrderFeeFundingReleased: "internal:fee funding reservation for a working order",
    ClearingChannelActivated: "internal:governance configuration",
  },
  PositionEngine: {
    PositionCreated: "position.opened",
    PositionStatusChanged: ["position.status", "position.lapsed", "position.closed"],
    PositionQuantityChanged: "position.closed",
    PositionExactPayoffComputed: "position.exercised",
    PositionPayoffComputed: "internal:non-exact payoff evidence; the settlement it enables is reported by settlement.finalized",
    PositionFundingLockCreated: "internal:collateral lock bookkeeping",
    PositionFundingLockReleased: "internal:collateral lock bookkeeping",
  },
  FixingEngine: {
    FixingEvidenceProposed: "fixing.proposed",
    FixingDisputed: "fixing.disputed",
    FixingFinalized: "fixing.finalized",
  },
  CashSettlementCoordinator: {
    CashSettlementFinalized: "settlement.finalized",
    SettlementClaimFulfilled: "enrichment:adds the settlement id to settlement.claim_fulfilled from CollateralVault.TerminalClaimFulfilled",
  },
  CollateralVault: {
    TerminalClaimCreated: "settlement.claim_created",
    TerminalClaimFulfilled: "settlement.claim_fulfilled",
    TerminalLiabilityReservationCreated: "internal:terminal backing of a position; position.opened reports the position",
    TerminalLiabilityReservationResolved: "internal:terminal backing release; settlement.finalized and the claim events report the outcome",
    TerminalLiabilityReservationsReplaced: "internal:backing moved between reservations by a lifecycle action",
    AccountCreated: "internal:account administration is not a market event",
    AccountControlProposed: "internal:account administration is not a market event",
    AccountControlProposalCancelled: "internal:account administration is not a market event",
    AccountControlTransferred: "internal:account administration is not a market event",
    LockOperatorSet: "internal:account administration is not a market event",
    CollateralDeposited: "internal:account funding is not a market event",
    CollateralWithdrawn: "internal:account funding is not a market event",
    CollateralTransferred: "internal:ledger movement; fills, settlements and claims report the economic event",
    CollateralLockCreated: "internal:collateral lock bookkeeping",
    CollateralLockReleased: "internal:collateral lock bookkeeping",
    CollateralLockConsumed: "internal:collateral lock bookkeeping",
    CollateralLockConverted: "internal:collateral lock bookkeeping",
    ExcessRecovered: "internal:custody housekeeping above liabilities",
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

/** Whether a covered event reaches the mapper: webhook-driving events and same-transaction enrichment sources. */
export function isMappedSourceEvent(contractName: string, eventName: string): boolean {
  const coverage = WEBHOOK_SOURCE_COVERAGE[contractName]?.[eventName];
  return coverage !== undefined && !(typeof coverage === "string" && coverage.startsWith("internal:"));
}

// Contract enums, named here explicitly in declaration order. The indexer names top-level enum fields, but every value
// is re-canonicalized against these tables so a decoder change cannot silently rename (or renumber) partner payloads.
const SIDE = ["unspecified", "buy", "sell"] as const;
const TIME_IN_FORCE = ["unspecified", "gtc", "gtd", "ioc", "fok"] as const;
const TARGET_KIND = ["unspecified", "series", "package"] as const;
const REMAINDER_POLICY = ["unspecified", "keepOpen", "cancelRemainder"] as const;
const ORDER_STATUS = ["unspecified", "open", "partiallyFilled", "filled", "cancelled", "expired", "rejected"] as const;
const POSITION_STATUS = [
  "unspecified",
  "live",
  "fixing",
  "settlementReady",
  "settled",
  "closedByUnwind",
  "replaced",
  "lapsed",
  "cancelledByDisruption",
  "defaulted",
  "terminalClaim",
  "abandoned",
] as const;
const CHANNEL_KIND = ["unspecified", "direct", "privateRfq", "sealedAuction"] as const;
const SETTLEMENT_MODE = ["unspecified", "normal", "terminalDisruption", "lapsed"] as const;
const FIXING_RESOLUTION = ["unspecified", "primaryFinal", "fallbackFinal", "terminalDisruption"] as const;
const REGISTRY_STATUS = ["unspecified", "active", "paused", "deprecated"] as const;

/** Position statuses after which a position holds no open risk. */
const CLOSING_POSITION_STATUSES = new Set<string>([
  "settled",
  "closedByUnwind",
  "replaced",
  "lapsed",
  "cancelledByDisruption",
  "abandoned",
]);

function canonicalEnum(value: JsonValue | undefined, names: readonly string[], label: string): string {
  if (typeof value === "string" && names.includes(value)) return value;
  const numeric = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  const name = names[numeric];
  if (!name) throw new TypeError(`unsupported ${label} ${String(value)}`);
  return name;
}

function optionalEnum(value: JsonValue | undefined, names: readonly string[], label: string): string | null {
  return value === undefined || value === null ? null : canonicalEnum(value, names, label);
}

function object(value: JsonValue | undefined, label: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value;
}

function str(value: JsonValue | undefined): string | null {
  if (value === undefined || value === null) return null;
  return typeof value === "string" ? value : String(value);
}

function lower(value: JsonValue | undefined): string | null {
  const text = str(value);
  return text === null ? null : text.toLowerCase();
}

/** Canonical payload of a protocol transition or a collateral event, as the indexer normalized it. */
function payloadOf(entry: DecodedChainLog): JsonObject {
  if (entry.canonical.name === "protocol.transition") return entry.canonical.payload.payload as SchemaJsonObject as JsonObject;
  if (entry.canonical.name.startsWith("collateral.")) return entry.canonical.payload as unknown as JsonObject;
  throw new TypeError(`${entry.contractName}.${entry.eventName} has no protocol payload`);
}

/** A catalog market as the deployment registered it: one onchain market and series per catalog id. */
export interface MarketReference {
  /** Catalog market id, for example BTC-YC-24DEC26. */
  readonly marketKey: string;
  /** Onchain MarketRegistry id. */
  readonly marketId: string;
  readonly seriesId: string;
  readonly instrumentId: string | null;
  readonly benchmarkId: string;
  /** Price ticks per unit of package price. */
  readonly priceScale: number;
  readonly tickSizeMinor: string;
}

export interface OrderReference {
  readonly targetKind: string;
  readonly seriesId: string;
  readonly packageId: string;
  readonly side: string;
  readonly priceTicks: string;
  readonly lots: string;
}

/**
 * Immutable facts the mapper needs but a single log does not carry: the market table, and order, position and claim
 * identities read from chain state (or earlier logs in the same batch). Absent references leave `market` null.
 */
export interface EventReferences {
  readonly markets: readonly MarketReference[];
  readonly orders: ReadonlyMap<string, OrderReference>;
  /** positionId -> seriesId */
  readonly positions: ReadonlyMap<string, string>;
  /** claimId -> positionId */
  readonly claims: ReadonlyMap<string, string>;
}

export interface EventContext {
  readonly chainId: number;
  readonly environment: string;
  readonly references?: EventReferences;
}

/** Identities a batch of logs refers to without carrying them; the chain reader resolves these before mapping. */
export interface ReferenceRequests {
  readonly orderHashes: readonly string[];
  readonly positionIds: readonly string[];
  readonly claimIds: readonly string[];
}

export function referenceRequests(logs: readonly DecodedChainLog[]): ReferenceRequests {
  const orders = new Set<string>();
  const positions = new Set<string>();
  const claims = new Set<string>();
  const knownOrders = new Set<string>();
  const knownPositions = new Set<string>();
  for (const entry of logs) {
    const key = `${entry.contractName}.${entry.eventName}`;
    if (!isMappedSourceEvent(entry.contractName, entry.eventName)) continue;
    if (entry.canonical.name !== "protocol.transition" && !entry.canonical.name.startsWith("collateral.")) continue;
    const p = payloadOf(entry);
    switch (key) {
      case "OrderState.OrderRegistered":
        knownOrders.add(lower(p.orderHash) ?? "");
        break;
      case "OrderState.OrderFillConsumed":
      case "OrderState.OrderCancelled":
      case "OrderState.OrderExpired":
      case "OrderState.OrderRejected":
        orders.add(lower(p.orderHash) ?? "");
        break;
      case "PositionEngine.PositionCreated":
        knownPositions.add(lower(p.positionId) ?? "");
        break;
      case "PositionEngine.PositionStatusChanged":
      case "PositionEngine.PositionQuantityChanged":
      case "PositionEngine.PositionExactPayoffComputed":
      case "CashSettlementCoordinator.CashSettlementFinalized":
      case "CollateralVault.TerminalClaimCreated":
        positions.add(lower(p.positionId) ?? "");
        break;
      case "CollateralVault.TerminalClaimFulfilled":
        claims.add(lower(p.claimId) ?? "");
        break;
    }
  }
  return {
    orderHashes: [...orders].filter((id) => id && !knownOrders.has(id)),
    positionIds: [...positions].filter((id) => id && !knownPositions.has(id)),
    claimIds: [...claims].filter(Boolean),
  };
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

/** Exact decimal rendering of a scaled integer: ticks at a power-of-ten price scale, or a fixing at its decimals. */
export function formatScaled(value: string | null, decimals: number): string | null {
  if (value === null || !/^-?\d+$/.test(value)) return null;
  const negative = value.startsWith("-");
  const digits = (negative ? value.slice(1) : value).padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals).replace(/^0+(?=\d)/, "");
  const fraction = decimals > 0 ? `.${digits.slice(digits.length - decimals)}` : "";
  return `${negative ? "-" : ""}${whole}${fraction}`;
}

function priceDecimals(market: MarketReference): number {
  const decimals = Math.round(Math.log10(market.priceScale));
  if (10 ** decimals !== market.priceScale) throw new TypeError(`${market.marketKey} price scale ${market.priceScale} is not a power of ten`);
  return decimals;
}

class MarketDirectory {
  readonly #bySeries = new Map<string, MarketReference>();
  readonly #byMarket = new Map<string, MarketReference>();
  readonly #references: EventReferences | undefined;
  readonly #orders = new Map<string, OrderReference>();
  readonly #positions = new Map<string, string>();

  constructor(references: EventReferences | undefined) {
    this.#references = references;
    for (const market of references?.markets ?? []) {
      this.#bySeries.set(market.seriesId.toLowerCase(), market);
      this.#byMarket.set(market.marketId.toLowerCase(), market);
    }
  }

  learnOrder(orderHash: string | null, order: OrderReference): void {
    if (orderHash) this.#orders.set(orderHash, order);
  }

  learnPosition(positionId: string | null, seriesId: string | null): void {
    if (positionId && seriesId) this.#positions.set(positionId, seriesId);
  }

  order(orderHash: string | null): OrderReference | null {
    if (!orderHash) return null;
    return this.#orders.get(orderHash) ?? this.#references?.orders.get(orderHash) ?? null;
  }

  positionSeries(positionId: string | null): string | null {
    if (!positionId) return null;
    return this.#positions.get(positionId) ?? this.#references?.positions.get(positionId) ?? null;
  }

  claimPosition(claimId: string | null): string | null {
    return claimId ? this.#references?.claims.get(claimId) ?? null : null;
  }

  bySeries(seriesId: string | null): MarketReference | null {
    return seriesId ? this.#bySeries.get(seriesId.toLowerCase()) ?? null : null;
  }

  byMarketId(marketId: string | null): MarketReference | null {
    return marketId ? this.#byMarket.get(marketId.toLowerCase()) ?? null : null;
  }
}

/** The `market` block every market-scoped payload carries: catalog id, onchain ids, and the price grid. */
function marketBlock(market: MarketReference | null): JsonObject | null {
  if (!market) return null;
  return {
    marketKey: market.marketKey,
    marketId: market.marketId,
    seriesId: market.seriesId,
    instrumentId: market.instrumentId,
    benchmarkId: market.benchmarkId,
    priceScale: market.priceScale,
    tickSizeMinor: market.tickSizeMinor,
  };
}

function price(market: MarketReference | null, ticks: string | null): string | null {
  return market ? formatScaled(ticks, priceDecimals(market)) : null;
}

function orderSummary(order: JsonObject, market: MarketReference | null): JsonObject {
  const priceTicks = str(order.priceTicks);
  return {
    accountId: str(order.accountId),
    targetKind: canonicalEnum(order.targetKind, TARGET_KIND, "order target kind"),
    seriesId: str(order.seriesId),
    packageId: str(order.packageId),
    targetVersion: str(order.targetVersion),
    side: canonicalEnum(order.side, SIDE, "order side"),
    lots: str(order.lots),
    priceTicks,
    price: price(market, priceTicks),
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

function orderReference(order: JsonObject): OrderReference {
  return {
    targetKind: canonicalEnum(order.targetKind, TARGET_KIND, "order target kind"),
    seriesId: lower(order.seriesId) ?? "",
    packageId: lower(order.packageId) ?? "",
    side: canonicalEnum(order.side, SIDE, "order side"),
    priceTicks: str(order.priceTicks) ?? "0",
    lots: str(order.lots) ?? "0",
  };
}

function orderMarket(directory: MarketDirectory, order: OrderReference | null): MarketReference | null {
  return order && order.targetKind === "series" ? directory.bySeries(order.seriesId) : null;
}

/**
 * Maps one confirmed block range of decoded logs to webhook events. Logs must be in chain order; enrichment
 * (fill price on order.filled, entry price on position.opened, settlement id on claims, de-duplicated closes) only
 * looks within the same transaction. Every market-scoped payload carries a `market` block that maps the series to its
 * catalog market, and every price is rendered on that market's own price scale.
 */
export function deriveWebhookEvents(context: EventContext, logs: readonly DecodedChainLog[]): WebhookEvent[] {
  const events: WebhookEvent[] = [];
  const directory = new MarketDirectory(context.references);
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
        const p = payloadOf(entry);
        const order = object(p.order, "order");
        const orderHash = lower(p.orderHash);
        const reference = orderReference(order);
        directory.learnOrder(orderHash, reference);
        const market = orderMarket(directory, reference);
        events.push(build(context, entry, "order.registered", {
          orderHash,
          signer: str(p.signer),
          nonce: str(p.nonce),
          status: optionalEnum(p.initialStatus, ORDER_STATUS, "order status"),
          registeredAt: str(p.registeredAt),
          market: marketBlock(market),
          order: orderSummary(order, market),
        }));
        break;
      }
      case "OrderState.OrderFillConsumed": {
        const p = payloadOf(entry);
        const orderHash = lower(p.orderHash);
        const order = directory.order(orderHash);
        const market = orderMarket(directory, order);
        const fillId = lower(p.executionReference);
        const fill = siblings.find((sibling) => {
          if (sibling.contractName !== "AtomicClearingEngine" || sibling.eventName !== "FillCleared") return false;
          const record = object(payloadOf(sibling).record, "fill record");
          return lower(record.takerOrderHash) === orderHash || lower(record.makerOrderHash) === orderHash;
        });
        const record = fill ? object(payloadOf(fill).record, "fill record") : null;
        const executionPriceTicks = record ? str(record.executionPriceTicks) : null;
        events.push(build(context, entry, "order.filled", {
          orderHash,
          fillId,
          consumer: str(p.consumer),
          market: marketBlock(market),
          side: order?.side ?? null,
          fillLots: str(p.fillLots),
          cumulativeFillLots: str(p.cumulativeFillLots),
          remainingLots: str(p.remainingLots),
          executionPriceTicks,
          executionPrice: price(market, executionPriceTicks),
          limitPriceTicks: order?.priceTicks ?? null,
          limitPrice: price(market, order?.priceTicks ?? null),
          previousStatus: optionalEnum(p.previousStatus, ORDER_STATUS, "order status"),
          status: optionalEnum(p.newStatus, ORDER_STATUS, "order status"),
        }));
        break;
      }
      case "OrderState.OrderCancelled":
      case "OrderState.OrderExpired":
      case "OrderState.OrderRejected": {
        const p = payloadOf(entry);
        const orderHash = lower(p.orderHash);
        const order = directory.order(orderHash);
        const market = orderMarket(directory, order);
        const reason = entry.eventName === "OrderCancelled" ? "cancelled" : entry.eventName === "OrderExpired" ? "expired" : "rejected";
        events.push(build(context, entry, "order.cancelled", {
          orderHash,
          reason,
          status: reason,
          previousStatus: optionalEnum(p.previousStatus, ORDER_STATUS, "order status"),
          market: marketBlock(market),
          side: order?.side ?? null,
          limitPriceTicks: order?.priceTicks ?? null,
          limitPrice: price(market, order?.priceTicks ?? null),
          filledLots: str(p.filledLots),
          cancelledLots: str(p.cancelledLots ?? p.expiredLots ?? p.rejectedLots),
          actor: str(p.signer ?? p.operator ?? p.consumer),
          rejectionReason: reason === "rejected" ? str(p.reason) : null,
        }));
        break;
      }
      case "AtomicClearingEngine.FillCleared": {
        const p = payloadOf(entry);
        const record = object(p.record, "fill record");
        const market = directory.bySeries(lower(record.targetId));
        const executionPriceTicks = str(record.executionPriceTicks);
        events.push(build(context, entry, "receipt.ready", {
          receiptKind: "fill",
          fillId: lower(p.fillId),
          market: marketBlock(market),
          takerOrderHash: str(record.takerOrderHash),
          makerOrderHash: str(record.makerOrderHash),
          buyerAccountId: str(record.buyerAccountId),
          sellerAccountId: str(record.sellerAccountId),
          channelKind: optionalEnum(record.channelKind, CHANNEL_KIND, "clearing channel"),
          targetId: str(record.targetId),
          fillLots: str(record.fillLots),
          executionPriceTicks,
          executionPrice: price(market, executionPriceTicks),
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
        const p = payloadOf(entry);
        const positionId = lower(p.positionId);
        const seriesId = lower(p.seriesId);
        directory.learnPosition(positionId, seriesId);
        const market = directory.bySeries(seriesId);
        const fill = siblings.find(
          (sibling) => sibling.eventName === "FillPositionCreated" && lower(payloadOf(sibling).positionId) === positionId,
        );
        const entryPriceTicks = fill ? str(payloadOf(fill).entryPriceTicks) : null;
        events.push(build(context, entry, "position.opened", {
          positionId,
          fillId: str(p.fillIdentity),
          market: marketBlock(market),
          seriesId,
          seriesVersion: str(p.seriesVersion),
          longAccountId: str(p.longAccountId),
          shortAccountId: str(p.shortAccountId),
          lots: str(p.lots),
          entryPriceTicks,
          entryPrice: price(market, entryPriceTicks),
          clearingEngine: str(p.clearingEngine),
        }));
        break;
      }
      case "PositionEngine.PositionStatusChanged": {
        const p = payloadOf(entry);
        const positionId = lower(p.positionId);
        const market = directory.bySeries(directory.positionSeries(positionId));
        const status = canonicalEnum(p.newStatus, POSITION_STATUS, "position status");
        const previousStatus = canonicalEnum(p.previousStatus, POSITION_STATUS, "position status");
        const base = { positionId, market: marketBlock(market), previousStatus, status, transitionReference: str(p.transitionReference) };
        events.push(build(context, entry, "position.status", { ...base, caller: str(p.caller) }));
        if (status === "lapsed") events.push(build(context, entry, "position.lapsed", base));
        if (CLOSING_POSITION_STATUSES.has(status)) {
          events.push(build(context, entry, "position.closed", { ...base, reason: status, remainingLots: null }));
        }
        break;
      }
      case "PositionEngine.PositionExactPayoffComputed": {
        const p = payloadOf(entry);
        const positionId = lower(p.positionId);
        const market = directory.bySeries(directory.positionSeries(positionId));
        const quantity = siblings.find(
          (sibling) => sibling.eventName === "PositionQuantityChanged" && lower(payloadOf(sibling).positionId) === positionId,
        );
        const q = quantity ? payloadOf(quantity) : null;
        events.push(build(context, entry, "position.exercised", {
          positionId,
          market: marketBlock(market),
          exercisedLots: str(p.evaluatedLots),
          terminalTransferMinor: str(p.terminalTransferMinor),
          fixingReference: str(p.fixingReference),
          finalFixingsHash: str(p.finalFixingsHash),
          remainingLots: q ? str(q.remainingLots) : null,
          cumulativeExercisedLots: q ? str(q.exercisedLots) : null,
        }));
        break;
      }
      case "PositionEngine.PositionQuantityChanged": {
        const p = payloadOf(entry);
        if (str(p.remainingLots) !== "0") break;
        const positionId = lower(p.positionId);
        // A terminal status change for the same position in the same transaction already reports the close.
        const closedByStatus = siblings.some((sibling) => {
          if (sibling.eventName !== "PositionStatusChanged") return false;
          const sp = payloadOf(sibling);
          return lower(sp.positionId) === positionId && CLOSING_POSITION_STATUSES.has(canonicalEnum(sp.newStatus, POSITION_STATUS, "position status"));
        });
        if (closedByStatus) break;
        events.push(build(context, entry, "position.closed", {
          positionId,
          market: marketBlock(directory.bySeries(directory.positionSeries(positionId))),
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
      case "FixingEngine.FixingEvidenceProposed":
      case "FixingEngine.FixingFinalized":
      case "FixingEngine.FixingDisputed": {
        const p = payloadOf(entry);
        const seriesId = lower(p.seriesId);
        const decimals = p.decimals === undefined ? null : Number(p.decimals);
        const value = str(p.value);
        const common = {
          fixingKey: lower(p.fixingKey),
          market: marketBlock(directory.bySeries(seriesId)),
          seriesId,
          seriesVersion: str(p.seriesVersion),
          slot: str(p.slot),
        };
        if (entry.eventName === "FixingEvidenceProposed") {
          events.push(build(context, entry, "fixing.proposed", {
            ...common,
            candidateIndex: str(p.candidateIndex),
            benchmarkId: str(p.benchmarkId),
            benchmarkVersion: str(p.benchmarkVersion),
            proposalHash: str(p.proposalHash),
            valueRaw: value,
            decimals,
            value: decimals === null ? null : formatScaled(value, decimals),
            batchSequence: str(p.batchSequence),
            submitter: str(p.submitter),
          }));
        } else if (entry.eventName === "FixingFinalized") {
          events.push(build(context, entry, "fixing.finalized", {
            ...common,
            resolution: canonicalEnum(p.resolutionKind, FIXING_RESOLUTION, "fixing resolution"),
            proposalHash: str(p.proposalHash),
            resultHash: str(p.resultHash),
            valueRaw: value,
            decimals,
            value: decimals === null ? null : formatScaled(value, decimals),
            terminalDisruptionTransferMinorPerLot: str(p.terminalDisruptionTransferMinorPerLot),
            effectiveAt: str(p.effectiveAt),
            finalizer: str(p.finalizer),
          }));
        } else {
          events.push(build(context, entry, "fixing.disputed", {
            ...common,
            incumbentProposalHash: str(p.incumbentProposalHash),
            conflictingProposalHash: str(p.conflictingProposalHash),
            batchSequence: str(p.batchSequence),
            submitter: str(p.submitter),
          }));
        }
        break;
      }
      case "CashSettlementCoordinator.CashSettlementFinalized": {
        const p = payloadOf(entry);
        const positionId = lower(p.positionId);
        events.push(build(context, entry, "settlement.finalized", {
          settlementId: str(p.settlementId),
          positionId,
          market: marketBlock(directory.bySeries(directory.positionSeries(positionId))),
          mode: canonicalEnum(p.mode, SETTLEMENT_MODE, "settlement mode"),
          outcomeHash: str(p.outcomeHash),
          fixingsHash: str(p.fixingsHash),
          positionOutcomeReference: str(p.positionOutcomeReference),
          terminalTransferMinor: str(p.terminalTransferMinor),
          terminalAmount: str(p.terminalAmount),
        }));
        break;
      }
      case "CollateralVault.TerminalClaimCreated": {
        const p = payloadOf(entry);
        const positionId = lower(p.positionId);
        events.push(build(context, entry, "settlement.claim_created", {
          claimId: str(p.claimId),
          reservationId: str(p.reservationId),
          positionId,
          market: marketBlock(directory.bySeries(directory.positionSeries(positionId))),
          payerAccountId: str(p.payerAccountId),
          receiverAccountId: str(p.receiverAccountId),
          terminalOutcomeReference: str(p.terminalOutcomeReference),
          amountMinor: str(p.amount),
        }));
        break;
      }
      case "CollateralVault.TerminalClaimFulfilled": {
        const p = payloadOf(entry);
        const claimId = lower(p.claimId);
        const viaCoordinator = siblings.find(
          (sibling) => sibling.eventName === "SettlementClaimFulfilled" && lower(payloadOf(sibling).claimId) === claimId,
        );
        const coordinator = viaCoordinator ? payloadOf(viaCoordinator) : null;
        const positionId = coordinator ? lower(coordinator.positionId) : directory.claimPosition(claimId);
        events.push(build(context, entry, "settlement.claim_fulfilled", {
          claimId,
          reservationId: str(p.reservationId),
          positionId,
          settlementId: coordinator ? str(coordinator.settlementId) : null,
          market: marketBlock(directory.bySeries(directory.positionSeries(positionId))),
          payerAccountId: str(p.payerAccountId),
          receiverAccountId: str(p.receiverAccountId),
          amountMinor: str(p.amount),
          caller: str(p.caller),
        }));
        break;
      }
      case "VerifiableReceiptLedger.ReceiptSubjectFinalized": {
        const p = payloadOf(entry);
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
        const entityId = canonical.name.startsWith("registry.") ? String((canonical.payload as { entityId: string }).entityId).toLowerCase() : null;
        const market = entry.contractName === "MarketRegistry" ? directory.byMarketId(entityId) : directory.bySeries(entityId);
        if (canonical.name === "registry.version.registered") {
          events.push(build(context, entry, "market.status", {
            registry: canonical.payload.registry,
            entityId: canonical.payload.entityId,
            market: marketBlock(market),
            change: "registered",
            version: canonical.payload.version,
            status: canonicalEnum(canonical.payload.initialStatus, REGISTRY_STATUS, "registry status"),
            previousStatus: null,
            definitionHash: canonical.payload.definitionHash,
          }));
        } else if (canonical.name === "registry.status.changed") {
          events.push(build(context, entry, "market.status", {
            registry: canonical.payload.registry,
            entityId: canonical.payload.entityId,
            market: marketBlock(market),
            change: "statusChanged",
            version: canonical.payload.version,
            status: canonicalEnum(canonical.payload.newStatus, REGISTRY_STATUS, "registry status"),
            previousStatus: canonicalEnum(canonical.payload.previousStatus, REGISTRY_STATUS, "registry status"),
          }));
        } else if (canonical.name === "registry.active-version.changed") {
          events.push(build(context, entry, "market.status", {
            registry: canonical.payload.registry,
            entityId: canonical.payload.entityId,
            market: marketBlock(market),
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
