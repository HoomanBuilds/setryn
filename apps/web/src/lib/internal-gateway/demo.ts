import type {
  CollateralIntent,
  CollateralIntentResult,
  ExecutionPosition,
  ExecutionReceipt,
  FirmRfqQuote,
  GatewayAccount,
  GatewayExecution,
  GatewaySnapshot,
  InternalTradingGateway,
  LocalMakerQuoteInput,
  PackageExecutionResult,
  PackageOrderIntent,
  RestingPackageOrder,
  RfqQuoteProvenance,
  RfqRequest,
  SignedOrderAuthorization,
  SubmissionUpdate,
} from "./types";
import {
  GTD_MAX_MS,
  GUARANTEE_COPY,
  executableAction,
  isPackageSide,
  limitCrosses,
  routePrice,
} from "@/lib/terminal/economics";
import type { PackageMarket } from "@/lib/terminal/types";

const wait = (duration: number) => new Promise((resolve) => window.setTimeout(resolve, duration));
const STORAGE_KEY = "setryn:demo-gateway:v1";

function identifier(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

function digest(value: string): string {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `0x${(hash >>> 0).toString(16).padStart(8, "0").repeat(8)}`;
}

function isKnownTimeInForce(value: unknown): value is PackageOrderIntent["timeInForce"] {
  return value === "GTC" || value === "GTD" || value === "IOC" || value === "FOK";
}

function isIntentMarketableForPartial(intent: PackageOrderIntent): boolean {
  if (intent.orderType === "MARKET") return true;
  if (intent.orderType !== "LIMIT") return false;
  if (!isPackageSide(intent.packageSide)) return false;
  if (!Number.isFinite(intent.limitPrice) || !Number.isFinite(intent.executionPrice)) return false;
  return limitCrosses(intent.limitPrice, intent.executionPrice, executableAction(intent.side, intent.packageSide));
}

function validateFillLots(intent: PackageOrderIntent, requireFull: boolean) {
  const requested = (intent as { lots?: unknown }).lots;
  const fill = (intent as { fillLots?: unknown }).fillLots;
  const isExit = intent.side === "EXIT";
  if (!Number.isFinite(requested) || (requested as number) <= 0) {
    throw new Error(isExit ? "INVALID_CLOSE_LOTS" : "INVALID_LOTS");
  }
  if (!Number.isFinite(fill) || (fill as number) <= 0) {
    throw new Error("INVALID_FILL_LOTS");
  }
  const req = requested as number;
  const fl = fill as number;
  if (fl - req > 1e-9) throw new Error("FILL_EXCEEDS_REQUESTED");
  const isPartial = Math.abs(fl - req) > 1e-9;
  if (requireFull || intent.timeInForce !== "IOC") {
    if (isPartial) throw new Error("FILL_MUST_EQUAL_REQUESTED");
    return;
  }
  if (isPartial && !isIntentMarketableForPartial(intent)) {
    throw new Error("IOC_PARTIAL_REQUIRES_MARKETABLE");
  }
}

function normalizeReceiptLots(candidate: Partial<ExecutionReceipt>): ExecutionReceipt | null {
  if (typeof candidate.id !== "string" || candidate.id.length === 0) return null;
  if (typeof candidate.marketId !== "string" || candidate.marketId.length === 0) return null;
  if (typeof candidate.lots !== "number" || !Number.isFinite(candidate.lots) || candidate.lots <= 0) {
    return null;
  }
  const lots = candidate.lots;
  const requested = (candidate as { requestedLots?: unknown }).requestedLots;
  const filled = (candidate as { filledLots?: unknown }).filledLots;
  const cancelled = (candidate as { cancelledLots?: unknown }).cancelledLots;
  if (requested === undefined && filled === undefined && cancelled === undefined) {
    return {
      ...(candidate as ExecutionReceipt),
      requestedLots: lots,
      filledLots: lots,
      cancelledLots: 0,
    };
  }
  if (
    typeof requested !== "number" ||
    !Number.isFinite(requested) ||
    requested <= 0 ||
    typeof filled !== "number" ||
    !Number.isFinite(filled) ||
    filled <= 0 ||
    typeof cancelled !== "number" ||
    !Number.isFinite(cancelled) ||
    cancelled < 0
  ) {
    return null;
  }
  if (filled - requested > 1e-9) return null;
  if (Math.abs(lots - filled) > 1e-9) return null;
  if (Math.abs(requested - (filled + cancelled)) > 1e-9) return null;
  return candidate as ExecutionReceipt;
}

function normalizeResultLots(
  result: Partial<PackageExecutionResult>,
  receipt: ExecutionReceipt,
): PackageExecutionResult | null {
  const requested = (result as { requestedLots?: unknown }).requestedLots;
  const filled = (result as { filledLots?: unknown }).filledLots;
  const cancelled = (result as { cancelledLots?: unknown }).cancelledLots;
  if (requested === undefined && filled === undefined && cancelled === undefined) {
    return {
      ...(result as PackageExecutionResult),
      requestedLots: receipt.requestedLots,
      filledLots: receipt.filledLots,
      cancelledLots: receipt.cancelledLots,
    };
  }
  if (
    typeof requested !== "number" ||
    !Number.isFinite(requested) ||
    requested <= 0 ||
    typeof filled !== "number" ||
    !Number.isFinite(filled) ||
    filled <= 0 ||
    typeof cancelled !== "number" ||
    !Number.isFinite(cancelled) ||
    cancelled < 0
  ) {
    return null;
  }
  if (filled - requested > 1e-9) return null;
  if (Math.abs(requested - (filled + cancelled)) > 1e-9) return null;
  if (
    Math.abs(requested - receipt.requestedLots) > 1e-9 ||
    Math.abs(filled - receipt.filledLots) > 1e-9 ||
    Math.abs(cancelled - receipt.cancelledLots) > 1e-9
  ) {
    return null;
  }
  return result as PackageExecutionResult;
}

function validateIntentExpiry(intent: PackageOrderIntent, referenceMs = Date.now()) {
  if (!isKnownTimeInForce(intent.timeInForce)) throw new Error("INVALID_TIME_IN_FORCE");
  const expiresAt = (intent as { expiresAt?: unknown }).expiresAt ?? null;
  if (intent.timeInForce === "GTD") {
    if (intent.orderType !== "LIMIT") throw new Error("GTD_REQUIRES_LIMIT");
    if (typeof expiresAt !== "string" || expiresAt.length === 0) {
      throw new Error("GTD_EXPIRY_REQUIRED");
    }
    const parsed = Date.parse(expiresAt);
    if (!Number.isFinite(parsed)) throw new Error("GTD_EXPIRY_REQUIRED");
    if (parsed <= referenceMs) throw new Error("GTD_EXPIRY_PAST");
    if (parsed - referenceMs > GTD_MAX_MS) throw new Error("GTD_EXPIRY_TOO_FAR");
    return;
  }
  if (expiresAt !== null) throw new Error("EXPIRY_FORBIDDEN");
}

function isValidGtdPair(
  timeInForce: unknown,
  expiresAt: unknown,
  createdAt: string,
): boolean {
  if (timeInForce === "GTC" || timeInForce === "IOC" || timeInForce === "FOK") {
    return expiresAt === null || expiresAt === undefined;
  }
  if (timeInForce !== "GTD") return false;
  if (typeof expiresAt !== "string" || expiresAt.length === 0) return false;
  const parsed = Date.parse(expiresAt);
  const created = Date.parse(createdAt);
  if (!Number.isFinite(parsed) || !Number.isFinite(created)) return false;
  if (parsed <= created) return false;
  if (parsed - created > GTD_MAX_MS) return false;
  return true;
}

const RESTING_TOL = 1e-9;
const MONEY_TOL = 1e-6;

function toCents(value: number): number {
  const quantized = Math.round(value * 100) / 100;
  return quantized === 0 ? 0 : quantized;
}

function executedAmount(total: number, filledLots: number, requestedLots: number): number {
  if (
    !Number.isFinite(total) ||
    total < 0 ||
    !Number.isFinite(filledLots) ||
    filledLots <= 0 ||
    !Number.isFinite(requestedLots) ||
    requestedLots <= 0 ||
    filledLots - requestedLots > RESTING_TOL
  ) {
    throw new Error("INVALID_LEDGER");
  }
  if (requestedLots - filledLots <= RESTING_TOL) return toCents(total);
  return toCents(total * (filledLots / requestedLots));
}

function deriveReserved(
  positions: readonly ExecutionPosition[],
  orders: readonly RestingPackageOrder[],
): number {
  let total = 0;
  for (const position of positions) {
    if (
      typeof position.collateral === "number" &&
      Number.isFinite(position.collateral) &&
      position.collateral > 0
    ) {
      total += position.collateral;
    }
  }
  for (const order of orders) {
    if (!isLiveRestingState(order.state)) continue;
    if (order.side !== "ENTER") continue;
    total += restingRemainingReservation(order);
  }
  return toCents(total);
}

function buildCoherentAccount(
  base: GatewayAccount,
  posted: number,
  positions: readonly ExecutionPosition[],
  orders: readonly RestingPackageOrder[],
): GatewayAccount {
  const cleanPosted = toCents(posted);
  if (!Number.isFinite(cleanPosted) || cleanPosted < -MONEY_TOL) {
    throw new Error("INVALID_LEDGER");
  }
  const safePosted = cleanPosted < 0 ? 0 : cleanPosted;
  const reserved = deriveReserved(positions, orders);
  if (!Number.isFinite(reserved) || reserved < -MONEY_TOL) {
    throw new Error("INVALID_LEDGER");
  }
  const safeReserved = reserved < 0 ? 0 : reserved;
  if (safeReserved - safePosted > MONEY_TOL) {
    throw new Error("INSUFFICIENT_AVAILABLE_COLLATERAL");
  }
  const eligible = safePosted;
  const available = toCents(eligible - safeReserved);
  if (!Number.isFinite(available) || available < -MONEY_TOL) {
    throw new Error("INVALID_LEDGER");
  }
  const safeAvailable = available < 0 ? 0 : available;
  if (eligible - safePosted > MONEY_TOL) throw new Error("INVALID_LEDGER");
  return {
    ...base,
    posted: safePosted,
    eligible,
    reserved: safeReserved,
    available: safeAvailable,
    equity: safePosted,
  };
}

function isLiveRestingState(state: unknown): boolean {
  return state === "WORKING" || state === "PARTIALLY_FILLED";
}

function restingRemainingLots(order: RestingPackageOrder): number {
  if (typeof order.remainingLots === "number" && Number.isFinite(order.remainingLots)) {
    return order.remainingLots;
  }
  const filled = typeof order.filledLots === "number" && Number.isFinite(order.filledLots) ? order.filledLots : 0;
  return Math.max(0, order.lots - filled);
}

function restingRemainingReservation(order: RestingPackageOrder): number {
  if (
    typeof order.remainingCollateralReservation === "number" &&
    Number.isFinite(order.remainingCollateralReservation)
  ) {
    return order.remainingCollateralReservation;
  }
  return order.state === "WORKING" || order.state === "PARTIALLY_FILLED"
    ? order.collateralReservation
    : 0;
}

function restingRemainingFee(order: RestingPackageOrder): number {
  if (typeof order.remainingFeeCap === "number" && Number.isFinite(order.remainingFeeCap)) {
    return order.remainingFeeCap;
  }
  return order.state === "WORKING" || order.state === "PARTIALLY_FILLED" ? order.feeCap : 0;
}

function isNonEmptyId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isIdArray(value: unknown): value is string[] {
  if (!Array.isArray(value)) return false;
  if (!value.every((entry) => isNonEmptyId(entry))) return false;
  return new Set(value).size === value.length;
}

interface RestingProgress {
  filledLots: number;
  remainingLots: number;
  remainingCollateralReservation: number;
  remainingFeeCap: number;
  fillIds: string[];
  receiptIds: string[];
}

function migrateRestingProgress(
  candidate: Partial<RestingPackageOrder> & { packageSide?: unknown },
): RestingProgress | null {
  const lots = candidate.lots;
  const reservation = candidate.collateralReservation;
  const feeCap = candidate.feeCap;
  const state = candidate.state;
  const side = candidate.side;
  if (typeof lots !== "number" || !Number.isFinite(lots) || lots <= 0) return null;
  if (typeof reservation !== "number" || !Number.isFinite(reservation) || reservation < 0) return null;
  if (typeof feeCap !== "number" || !Number.isFinite(feeCap) || feeCap < 0) return null;
  const rawFilled = (candidate as { filledLots?: unknown }).filledLots;
  const rawRemaining = (candidate as { remainingLots?: unknown }).remainingLots;
  const rawRemainingRes = (candidate as { remainingCollateralReservation?: unknown })
    .remainingCollateralReservation;
  const rawRemainingFee = (candidate as { remainingFeeCap?: unknown }).remainingFeeCap;
  const rawFillIds = (candidate as { fillIds?: unknown }).fillIds;
  const rawReceiptIds = (candidate as { receiptIds?: unknown }).receiptIds;
  const singularFillId = candidate.fillId;
  const singularReceiptId = candidate.receiptId;
  const legacy =
    rawFilled === undefined &&
    rawRemaining === undefined &&
    rawRemainingRes === undefined &&
    rawRemainingFee === undefined &&
    rawFillIds === undefined &&
    rawReceiptIds === undefined;
  if (legacy) {
    if (side === "EXIT" && reservation !== 0) return null;
    if (state === "FILLED") {
      if (!isNonEmptyId(singularFillId) || !isNonEmptyId(singularReceiptId)) return null;
      return {
        filledLots: lots,
        remainingLots: 0,
        remainingCollateralReservation: 0,
        remainingFeeCap: 0,
        fillIds: [singularFillId],
        receiptIds: [singularReceiptId],
      };
    }
    const isLive = state === "WORKING";
    const isTerminal =
      state === "CANCELLED" || state === "REPLACED" || state === "EXPIRED";
    if (!isLive && !isTerminal) return null;
    return {
      filledLots: 0,
      remainingLots: lots,
      remainingCollateralReservation: isLive ? reservation : 0,
      remainingFeeCap: isLive ? feeCap : 0,
      fillIds: [],
      receiptIds: [],
    };
  }
  if (
    typeof rawFilled !== "number" ||
    !Number.isFinite(rawFilled) ||
    rawFilled < 0 ||
    typeof rawRemaining !== "number" ||
    !Number.isFinite(rawRemaining) ||
    rawRemaining < 0 ||
    typeof rawRemainingRes !== "number" ||
    !Number.isFinite(rawRemainingRes) ||
    rawRemainingRes < 0 ||
    typeof rawRemainingFee !== "number" ||
    !Number.isFinite(rawRemainingFee) ||
    rawRemainingFee < 0 ||
    !isIdArray(rawFillIds) ||
    !isIdArray(rawReceiptIds)
  ) {
    return null;
  }
  if (Math.abs(rawFilled + rawRemaining - lots) > RESTING_TOL) return null;
  if (rawFillIds.length !== rawReceiptIds.length) return null;
  if (rawRemainingRes - reservation > RESTING_TOL) return null;
  if (rawRemainingFee - feeCap > RESTING_TOL) return null;
  if (side === "EXIT") {
    if (reservation !== 0 || rawRemainingRes !== 0) return null;
  } else if (rawRemainingFee - rawRemainingRes > RESTING_TOL) {
    return null;
  }
  const hasHistory = rawFillIds.length > 0;
  const filledPositive = rawFilled > RESTING_TOL;
  const remainingPositive = rawRemaining > RESTING_TOL;
  if (hasHistory !== filledPositive) return null;
  if (hasHistory) {
    if (singularFillId !== rawFillIds[rawFillIds.length - 1]) return null;
    if (singularReceiptId !== rawReceiptIds[rawReceiptIds.length - 1]) return null;
  } else if (singularFillId != null || singularReceiptId != null) {
    return null;
  }
  if (state === "WORKING") {
    if (filledPositive || !remainingPositive || hasHistory) return null;
    if (Math.abs(rawRemaining - lots) > RESTING_TOL) return null;
    if (Math.abs(rawRemainingRes - reservation) > RESTING_TOL) return null;
    if (Math.abs(rawRemainingFee - feeCap) > RESTING_TOL) return null;
  } else if (state === "PARTIALLY_FILLED") {
    if (!filledPositive || !remainingPositive || !hasHistory) return null;
  } else if (state === "FILLED") {
    if (Math.abs(rawFilled - lots) > RESTING_TOL || remainingPositive) return null;
    if (!hasHistory) return null;
    if (Math.abs(rawRemainingRes) > RESTING_TOL || Math.abs(rawRemainingFee) > RESTING_TOL) {
      return null;
    }
  } else {
    if (!remainingPositive) return null;
    if (Math.abs(rawRemainingRes) > RESTING_TOL || Math.abs(rawRemainingFee) > RESTING_TOL) {
      return null;
    }
  }
  return {
    filledLots: rawFilled,
    remainingLots: rawRemaining,
    remainingCollateralReservation: rawRemainingRes,
    remainingFeeCap: rawRemainingFee,
    fillIds: [...rawFillIds],
    receiptIds: [...rawReceiptIds],
  };
}

function splitTrancheAmounts(
  remainingReservation: number,
  remainingFee: number,
  trancheLots: number,
  remainingLots: number,
  isFinal: boolean,
): { trancheFee: number; trancheCollateral: number } | null {
  if (!Number.isFinite(trancheLots) || trancheLots <= 0) return null;
  if (!Number.isFinite(remainingLots) || remainingLots <= 0) return null;
  if (trancheLots - remainingLots > RESTING_TOL) return null;
  const remainingCollateral = Math.max(0, remainingReservation - remainingFee);
  if (isFinal) {
    return { trancheFee: remainingFee, trancheCollateral: remainingCollateral };
  }
  const fraction = trancheLots / remainingLots;
  return {
    trancheFee: remainingFee * fraction,
    trancheCollateral: remainingCollateral * fraction,
  };
}

function initialSnapshot(): GatewaySnapshot {
  return {
    environment: {
      id: "LOCAL_DEMO",
      label: "Local demo",
      chainId: 421614,
      evidence: "DEMO",
    },
    wallet: { status: "DISCONNECTED", address: null, chainId: null },
    account: {
      id: "SET-01",
      label: "Desk 01",
      riskDomain: "Crypto carry domain",
      collateralAsset: "USDC",
      posted: 378_000,
      eligible: 378_000,
      reserved: 0,
      available: 378_000,
      equity: 378_000,
    },
    positions: [],
    receipts: [],
    executions: [],
    restingOrders: [],
    rfqRequests: [],
  };
}

function restoreSnapshot(): GatewaySnapshot {
  if (typeof window === "undefined") return initialSnapshot();
  try {
    const stored = window.sessionStorage.getItem(STORAGE_KEY);
    if (!stored) return initialSnapshot();
    const snapshot = JSON.parse(stored) as GatewaySnapshot;
    if (snapshot.environment.id !== "LOCAL_DEMO" || !Array.isArray(snapshot.receipts)) {
      return initialSnapshot();
    }
    const rawPositions = Array.isArray(snapshot.positions) ? snapshot.positions : [];
    const positions: ExecutionPosition[] = [];
    for (const entry of rawPositions) {
      if (!entry || typeof entry !== "object") continue;
      const candidate = entry as Partial<ExecutionPosition> & { packageSide?: unknown; side?: unknown };
      if (typeof candidate.id !== "string" || candidate.id.length === 0) continue;
      if (typeof candidate.marketId !== "string" || candidate.marketId.length === 0) continue;
      if (typeof candidate.lots !== "number" || !Number.isFinite(candidate.lots) || candidate.lots <= 0) continue;
      if (typeof candidate.entryPrice !== "number" || !Number.isFinite(candidate.entryPrice)) continue;
      if (typeof candidate.collateral !== "number" || !Number.isFinite(candidate.collateral) || candidate.collateral < 0) continue;
      if (typeof candidate.createdAt !== "string" || !Number.isFinite(Date.parse(candidate.createdAt))) continue;
      if (candidate.state !== undefined && candidate.state !== "ACTIVE") continue;
      const rawSide = candidate.side;
      if (rawSide === undefined) {
        positions.push({ ...(candidate as ExecutionPosition), side: "LONG", state: "ACTIVE" });
        continue;
      }
      if (!isPackageSide(rawSide)) continue;
      positions.push({ ...(candidate as ExecutionPosition), side: rawSide, state: "ACTIVE" });
    }
    const rawReceipts = Array.isArray(snapshot.receipts) ? snapshot.receipts : [];
    const receipts: ExecutionReceipt[] = [];
    for (const entry of rawReceipts) {
      if (!entry || typeof entry !== "object") continue;
      const candidate = entry as Partial<ExecutionReceipt> & { packageSide?: unknown };
      if (typeof candidate.id !== "string" || candidate.id.length === 0) continue;
      if (typeof candidate.marketId !== "string" || candidate.marketId.length === 0) continue;
      const rawSide = candidate.packageSide;
      const withSide =
        rawSide === undefined
          ? { ...(candidate as ExecutionReceipt), packageSide: "LONG" as const }
          : isPackageSide(rawSide)
            ? (candidate as ExecutionReceipt)
            : null;
      if (!withSide) continue;
      const normalized = normalizeReceiptLots(withSide);
      if (!normalized) continue;
      receipts.push({ ...normalized, packageSide: withSide.packageSide });
    }
    const rawRestingOrders = (snapshot as { restingOrders?: unknown }).restingOrders;
    const normalizedRestingOrders: RestingPackageOrder[] = Array.isArray(rawRestingOrders)
      ? rawRestingOrders
          .filter((order): order is RestingPackageOrder => {
            if (!order || typeof order !== "object") return false;
            const candidate = order as Partial<RestingPackageOrder> & { packageSide?: unknown };
            if (
              typeof candidate.id !== "string" ||
              typeof candidate.orderHash !== "string" ||
              typeof candidate.accountId !== "string" ||
              typeof candidate.marketId !== "string" ||
              typeof candidate.packageCode !== "string" ||
              typeof candidate.routeId !== "string" ||
              typeof candidate.routeLabel !== "string" ||
              (candidate.side !== "ENTER" && candidate.side !== "EXIT") ||
              typeof candidate.lots !== "number" ||
              !Number.isFinite(candidate.lots) ||
              candidate.lots <= 0 ||
              typeof candidate.limitPrice !== "number" ||
              !Number.isFinite(candidate.limitPrice) ||
              (candidate.timeInForce !== "GTC" && candidate.timeInForce !== "GTD") ||
              typeof candidate.collateralReservation !== "number" ||
              !Number.isFinite(candidate.collateralReservation) ||
              candidate.collateralReservation < 0 ||
              typeof candidate.feeCap !== "number" ||
              !Number.isFinite(candidate.feeCap) ||
              candidate.feeCap < 0 ||
              (candidate.closePositionId !== null &&
                typeof candidate.closePositionId !== "string") ||
              typeof candidate.createdAt !== "string" ||
              !Number.isFinite(Date.parse(candidate.createdAt))
            ) {
              return false;
            }
            if (candidate.packageSide !== undefined && !isPackageSide(candidate.packageSide)) {
              return false;
            }
          if (
            candidate.state !== "WORKING" &&
            candidate.state !== "PARTIALLY_FILLED" &&
            candidate.state !== "CANCELLED" &&
            candidate.state !== "FILLED" &&
            candidate.state !== "REPLACED" &&
            candidate.state !== "EXPIRED"
          ) {
            return false;
          }
          {
            const rawExpiresAt = (candidate as { expiresAt?: unknown }).expiresAt;
            if (candidate.timeInForce === "GTD") {
              if (!isValidGtdPair(candidate.timeInForce, rawExpiresAt, candidate.createdAt)) {
                return false;
              }
            } else if (rawExpiresAt !== null && rawExpiresAt !== undefined) {
              return false;
            }
          }
          {
            const rawExpiredAt = (candidate as { expiredAt?: unknown }).expiredAt;
            if (candidate.state !== "EXPIRED" && rawExpiredAt != null) {
              return false;
            }
          }
          if (
            candidate.orderType !== undefined &&
            candidate.orderType !== "LIMIT"
          ) {
            return false;
          }
          if (
            candidate.contractMultiplier !== undefined &&
            (!Number.isFinite(candidate.contractMultiplier) || candidate.contractMultiplier <= 0)
          ) {
            return false;
          }
          if (
            candidate.settlementGuarantee !== undefined &&
            (typeof candidate.settlementGuarantee !== "string" ||
              candidate.settlementGuarantee.length === 0)
          ) {
            return false;
          }
          if (
            candidate.disclosure !== undefined &&
            candidate.disclosure !== "PUBLIC" &&
            candidate.disclosure !== "PRIVATE_RFQ"
          ) {
            return false;
          }
          if (
            candidate.recipient !== undefined &&
            typeof candidate.recipient !== "string"
          ) {
            return false;
          }
          if (
            candidate.collateralRequired !== undefined &&
            (!Number.isFinite(candidate.collateralRequired) || candidate.collateralRequired < 0)
          ) {
            return false;
          }
          const replacesOrderId = (candidate as { replacesOrderId?: unknown }).replacesOrderId;
          if (
            replacesOrderId !== undefined &&
            replacesOrderId !== null &&
            (typeof replacesOrderId !== "string" || replacesOrderId.length === 0)
          ) {
            return false;
          }
          const replacedByOrderId = (candidate as { replacedByOrderId?: unknown }).replacedByOrderId;
          if (
            replacedByOrderId !== undefined &&
            replacedByOrderId !== null &&
            (typeof replacedByOrderId !== "string" || replacedByOrderId.length === 0)
          ) {
            return false;
          }
          const replacedAt = (candidate as { replacedAt?: unknown }).replacedAt;
          if (
            replacedAt !== undefined &&
            replacedAt !== null &&
            (typeof replacedAt !== "string" || !Number.isFinite(Date.parse(replacedAt)))
          ) {
            return false;
          }
          if (candidate.state === "REPLACED") {
            if (
              typeof replacedByOrderId !== "string" ||
              replacedByOrderId.length === 0 ||
              typeof replacedAt !== "string" ||
              !Number.isFinite(Date.parse(replacedAt))
            ) {
              return false;
            }
          } else if (replacedAt != null || replacedByOrderId != null) {
            return false;
          }
          const progress = migrateRestingProgress(candidate);
          if (!progress) return false;
          if (Math.abs(progress.filledLots + progress.remainingLots - candidate.lots) > RESTING_TOL) {
            return false;
          }
          const hasHistory = progress.fillIds.length > 0;
          const filledAt = (candidate as { filledAt?: unknown }).filledAt;
          const cancelledAt = (candidate as { cancelledAt?: unknown }).cancelledAt;
          if (candidate.state === "WORKING") {
            if (
              filledAt != null ||
              candidate.fillId != null ||
              candidate.receiptId != null ||
              cancelledAt != null
            ) {
              return false;
            }
            return true;
          }
          if (candidate.state === "PARTIALLY_FILLED") {
            if (
              typeof filledAt !== "string" ||
              !Number.isFinite(Date.parse(filledAt)) ||
              !isNonEmptyId(candidate.fillId) ||
              !isNonEmptyId(candidate.receiptId) ||
              cancelledAt != null
            ) {
              return false;
            }
            return true;
          }
          if (candidate.state === "FILLED") {
            if (
              typeof filledAt !== "string" ||
              !Number.isFinite(Date.parse(filledAt)) ||
              !isNonEmptyId(candidate.fillId) ||
              !isNonEmptyId(candidate.receiptId) ||
              cancelledAt != null
            ) {
              return false;
            }
            if (
              candidate.fillId !== progress.fillIds[progress.fillIds.length - 1] ||
              candidate.receiptId !== progress.receiptIds[progress.receiptIds.length - 1]
            ) {
              return false;
            }
            return true;
          }
          if (candidate.state === "CANCELLED") {
            if (typeof cancelledAt !== "string" || !Number.isFinite(Date.parse(cancelledAt))) {
              return false;
            }
            if (!(progress.remainingLots > RESTING_TOL)) {
              return false;
            }
            if (hasHistory) {
              if (
                typeof filledAt !== "string" ||
                !Number.isFinite(Date.parse(filledAt)) ||
                !isNonEmptyId(candidate.fillId) ||
                !isNonEmptyId(candidate.receiptId)
              ) {
                return false;
              }
              if (
                candidate.fillId !== progress.fillIds[progress.fillIds.length - 1] ||
                candidate.receiptId !== progress.receiptIds[progress.receiptIds.length - 1]
              ) {
                return false;
              }
            } else if (filledAt != null || candidate.fillId != null || candidate.receiptId != null) {
              return false;
            }
            return true;
          }
          if (candidate.state === "EXPIRED") {
            const expiredAt = (candidate as { expiredAt?: unknown }).expiredAt;
            const expiresAt = (candidate as { expiresAt?: unknown }).expiresAt;
            if (typeof expiredAt !== "string" || !Number.isFinite(Date.parse(expiredAt))) {
              return false;
            }
            if (typeof expiresAt !== "string" || !Number.isFinite(Date.parse(expiresAt))) {
              return false;
            }
            if (Date.parse(expiredAt) < Date.parse(expiresAt)) return false;
            if (
              cancelledAt != null ||
              (candidate as { replacedAt?: unknown }).replacedAt != null ||
              (candidate as { replacedByOrderId?: unknown }).replacedByOrderId != null
            ) {
              return false;
            }
            if (!(progress.remainingLots > RESTING_TOL)) {
              return false;
            }
            if (hasHistory) {
              if (
                typeof filledAt !== "string" ||
                !Number.isFinite(Date.parse(filledAt)) ||
                !isNonEmptyId(candidate.fillId) ||
                !isNonEmptyId(candidate.receiptId)
              ) {
                return false;
              }
              if (
                candidate.fillId !== progress.fillIds[progress.fillIds.length - 1] ||
                candidate.receiptId !== progress.receiptIds[progress.receiptIds.length - 1]
              ) {
                return false;
              }
            } else if (filledAt != null || candidate.fillId != null || candidate.receiptId != null) {
              return false;
            }
            return true;
          }
          if (candidate.state === "REPLACED") {
            if (cancelledAt != null) {
              return false;
            }
            if (!(progress.remainingLots > RESTING_TOL)) {
              return false;
            }
            if (hasHistory) {
              if (
                typeof filledAt !== "string" ||
                !Number.isFinite(Date.parse(filledAt)) ||
                !isNonEmptyId(candidate.fillId) ||
                !isNonEmptyId(candidate.receiptId)
              ) {
                return false;
              }
              if (
                candidate.fillId !== progress.fillIds[progress.fillIds.length - 1] ||
                candidate.receiptId !== progress.receiptIds[progress.receiptIds.length - 1]
              ) {
                return false;
              }
            } else if (filledAt != null || candidate.fillId != null || candidate.receiptId != null) {
              return false;
            }
            return true;
          }
          return false;
        })
          .map((order) => {
            const typed = order as RestingPackageOrder & { packageSide?: unknown };
            const candidate = typed as Partial<RestingPackageOrder> & { packageSide?: unknown };
            const progress = migrateRestingProgress(candidate);
            const withSide =
              typed.packageSide === undefined
                ? { ...typed, packageSide: "LONG" as const }
                : (typed as RestingPackageOrder);
            const withProgress = progress
              ? {
                  ...withSide,
                  filledLots: progress.filledLots,
                  remainingLots: progress.remainingLots,
                  remainingCollateralReservation: progress.remainingCollateralReservation,
                  remainingFeeCap: progress.remainingFeeCap,
                  fillIds: progress.fillIds,
                  receiptIds: progress.receiptIds,
                }
              : (withSide as RestingPackageOrder);
            const withReplaces =
              (withProgress as { replacesOrderId?: unknown }).replacesOrderId === undefined
                ? { ...withProgress, replacesOrderId: null as string | null }
                : (withProgress as RestingPackageOrder);
            if ((withReplaces as { expiresAt?: unknown }).expiresAt === undefined) {
              return { ...withReplaces, expiresAt: null as string | null };
            }
            return withReplaces as RestingPackageOrder;
          })
      : [];
    const restingById = new Map(normalizedRestingOrders.map((order) => [order.id, order]));
    const restingOrders: RestingPackageOrder[] = normalizedRestingOrders.filter((order) => {
      const replacesId = order.replacesOrderId ?? null;
      const isReplaced = order.state === "REPLACED";
      if (!isReplaced && replacesId == null) return true;
      if (isReplaced) {
        const nextId = order.replacedByOrderId ?? null;
        if (typeof nextId !== "string" || nextId.length === 0) return false;
        const next = restingById.get(nextId);
        if (!next) return false;
        if ((next.replacesOrderId ?? null) !== order.id) return false;
      }
      if (replacesId != null) {
        if (typeof replacesId !== "string" || replacesId.length === 0) return false;
        const prev = restingById.get(replacesId);
        if (!prev) return false;
        if (prev.state !== "REPLACED") return false;
        if ((prev.replacedByOrderId ?? null) !== order.id) return false;
      }
      return true;
    });
    const rawExecutions = Array.isArray(snapshot.executions) ? snapshot.executions : [];
    const executions: GatewayExecution[] = [];
    for (const execution of rawExecutions) {
      if (!execution || typeof execution !== "object") continue;
      const candidate = execution as Partial<GatewayExecution>;
      if (typeof candidate.id !== "string" || typeof candidate.orderHash !== "string") continue;
      if (!candidate.result || typeof candidate.result !== "object") continue;
      const result = candidate.result as Partial<PackageExecutionResult> & {
        position?: PackageExecutionResult["position"] | null;
        receipt?: PackageExecutionResult["receipt"];
      };
      let normalized = result;
      if (typeof result.outcome !== "string") {
        normalized = {
          fillId: result.fillId ?? "FIL-LEGACY",
          outcome: "OPENED" as const,
          position: result.position ?? null,
          closedPositionId: null,
          closedLots: 0,
          receipt: result.receipt as PackageExecutionResult["receipt"],
        };
      }
      if (!normalized.receipt || typeof normalized.receipt !== "object") continue;
      const receiptCandidate = normalized.receipt as Partial<ExecutionReceipt> & {
        packageSide?: unknown;
      };
      let receiptWithSide: ExecutionReceipt | null = null;
      if (receiptCandidate.packageSide === undefined) {
        receiptWithSide = {
          ...(receiptCandidate as ExecutionReceipt),
          packageSide: "LONG" as const,
        };
      } else if (isPackageSide(receiptCandidate.packageSide)) {
        receiptWithSide = receiptCandidate as ExecutionReceipt;
      } else {
        continue;
      }
      const normalizedReceipt = normalizeReceiptLots(receiptWithSide);
      if (!normalizedReceipt) continue;
      normalized = {
        ...(normalized as PackageExecutionResult),
        receipt: {
          ...normalizedReceipt,
          packageSide: receiptWithSide.packageSide,
        },
      };
      const normalizedResult = normalizeResultLots(
        normalized,
        (normalized as PackageExecutionResult).receipt as ExecutionReceipt,
      );
      if (!normalizedResult) continue;
      normalized = normalizedResult;
      const position = (normalized as PackageExecutionResult).position;
      if (position !== null && position !== undefined) {
        const positionCandidate = position as Partial<ExecutionPosition> & { side?: unknown };
        if (positionCandidate.side === undefined) {
          normalized = {
            ...(normalized as PackageExecutionResult),
            position: { ...(position as ExecutionPosition), side: "LONG" as const },
          };
        } else if (!isPackageSide(positionCandidate.side)) {
          continue;
        }
      }
      {
        const finalResult = normalized as PackageExecutionResult;
        if (finalResult.outcome === "OPENED") {
          if (finalResult.position != null) {
            const posLots = (finalResult.position as Partial<ExecutionPosition>).lots;
            if (
              typeof posLots !== "number" ||
              !Number.isFinite(posLots) ||
              Math.abs(posLots - finalResult.filledLots) > 1e-9
            ) {
              continue;
            }
          }
        } else if (finalResult.outcome === "REDUCED" || finalResult.outcome === "CLOSED") {
          const closedLots = (finalResult as { closedLots?: unknown }).closedLots;
          if (
            typeof closedLots !== "number" ||
            !Number.isFinite(closedLots) ||
            Math.abs(closedLots - finalResult.filledLots) > 1e-9
          ) {
            continue;
          }
          if (finalResult.outcome === "CLOSED") {
            if (finalResult.position != null) continue;
          } else if (finalResult.position == null) {
            continue;
          }
        } else {
          continue;
        }
      }
      executions.push({ ...(candidate as GatewayExecution), result: normalized as PackageExecutionResult });
    }
    const rawRfqRequests = (snapshot as { rfqRequests?: unknown }).rfqRequests;
    const rfqRequests: RfqRequest[] = Array.isArray(rawRfqRequests)
      ? rawRfqRequests.filter((request): request is RfqRequest => {
          if (!request || typeof request !== "object") return false;
          const candidate = request as Partial<RfqRequest>;
          if (typeof candidate.id !== "string") return false;
          if (
            candidate.state !== "OPEN" &&
            candidate.state !== "SELECTED" &&
            candidate.state !== "CANCELLED" &&
            candidate.state !== "EXECUTED"
          )
            return false;
          if (
            typeof candidate.createdAt !== "string" ||
            !Number.isFinite(Date.parse(candidate.createdAt))
          )
            return false;
          if (
            typeof candidate.expiresAt !== "string" ||
            !Number.isFinite(Date.parse(candidate.expiresAt))
          )
            return false;
          const authorization = candidate.authorization as Partial<SignedOrderAuthorization> | null | undefined;
          if (!authorization || typeof authorization !== "object") return false;
          if (typeof authorization.orderHash !== "string" || authorization.orderHash.length === 0)
            return false;
          if (typeof authorization.signature !== "string" || authorization.signature.length === 0)
            return false;
          if (typeof authorization.signer !== "string" || authorization.signer.length === 0)
            return false;
          if (typeof authorization.nonce !== "string" || authorization.nonce.length === 0)
            return false;
          if (typeof authorization.deadline !== "string" || authorization.deadline.length === 0)
            return false;
          if (!authorization.intent || typeof authorization.intent !== "object") return false;
          const intentCandidate = authorization.intent as Partial<PackageOrderIntent> & {
            packageSide?: unknown;
            replacesOrderId?: unknown;
            timeInForce?: unknown;
            expiresAt?: unknown;
            lots?: unknown;
            fillLots?: unknown;
          };
          if (intentCandidate.packageSide !== undefined && !isPackageSide(intentCandidate.packageSide)) {
            return false;
          }
          {
            const requested = intentCandidate.lots;
            const fill = intentCandidate.fillLots;
            if (fill !== undefined) {
              if (
                typeof requested !== "number" ||
                !Number.isFinite(requested) ||
                requested <= 0 ||
                typeof fill !== "number" ||
                !Number.isFinite(fill) ||
                fill <= 0 ||
                Math.abs(fill - requested) > 1e-9
              ) {
                return false;
              }
            }
          }
          if (
            intentCandidate.timeInForce !== undefined &&
            !isKnownTimeInForce(intentCandidate.timeInForce)
          ) {
            return false;
          }
          if (intentCandidate.timeInForce === "GTD") {
            return false;
          }
          {
            const rawExpiresAt = intentCandidate.expiresAt;
            if (rawExpiresAt !== null && rawExpiresAt !== undefined) return false;
          }
          if (
            intentCandidate.replacesOrderId !== undefined &&
            intentCandidate.replacesOrderId !== null
          ) {
            return false;
          }
          if (!Array.isArray(candidate.quotes) || candidate.quotes.length < 2) return false;
          const quotesValid = candidate.quotes.every((quote) => {
            if (!quote || typeof quote !== "object") return false;
            const candidateQuote = quote as Partial<FirmRfqQuote>;
            if (typeof candidateQuote.id !== "string" || candidateQuote.id.length === 0)
              return false;
            if (
              typeof candidateQuote.solverLabel !== "string" ||
              candidateQuote.solverLabel.length === 0
            )
              return false;
            if (
              typeof candidateQuote.packagePrice !== "number" ||
              !Number.isFinite(candidateQuote.packagePrice)
            )
              return false;
            if (
              typeof candidateQuote.feeCap !== "number" ||
              !Number.isFinite(candidateQuote.feeCap) ||
              candidateQuote.feeCap < 0
            )
              return false;
            if (
              typeof candidateQuote.capacityLots !== "number" ||
              !Number.isFinite(candidateQuote.capacityLots) ||
              candidateQuote.capacityLots <= 0
            )
              return false;
            if (
              typeof candidateQuote.expiresAt !== "string" ||
              !Number.isFinite(Date.parse(candidateQuote.expiresAt))
            )
              return false;
            if (
              typeof candidateQuote.settlementGuarantee !== "string" ||
              candidateQuote.settlementGuarantee.length === 0
            )
              return false;
            const provenance = (candidateQuote as { provenance?: unknown }).provenance;
            if (
              provenance !== undefined &&
              provenance !== "SEEDED_SOLVER" &&
              provenance !== "LOCAL_DEMO"
            )
              return false;
            return true;
          });
          if (!quotesValid) return false;
          if (candidate.state === "SELECTED") {
            if (
              typeof candidate.selectedQuoteId !== "string" ||
              candidate.selectedQuoteId.length === 0
            )
              return false;
            if (!candidate.quotes.some((quote) => quote.id === candidate.selectedQuoteId))
              return false;
            if (candidate.receiptId !== null) return false;
          } else if (candidate.state === "EXECUTED") {
            if (
              typeof candidate.selectedQuoteId !== "string" ||
              candidate.selectedQuoteId.length === 0
            )
              return false;
            if (!candidate.quotes.some((quote) => quote.id === candidate.selectedQuoteId))
              return false;
            if (typeof candidate.receiptId !== "string" || candidate.receiptId.length === 0)
              return false;
          } else {
            if (candidate.selectedQuoteId !== null) return false;
            if (candidate.receiptId !== null) return false;
          }
          return true;
        })
        .map((request) => {
          const typed = request as RfqRequest;
          const intent = typed.authorization.intent as PackageOrderIntent & { packageSide?: unknown };
          const withSide =
            intent.packageSide === undefined
              ? { ...intent, packageSide: "LONG" as const }
              : intent;
          const migratedIntent =
            (withSide as { replacesOrderId?: unknown }).replacesOrderId === undefined
              ? { ...withSide, replacesOrderId: null as string | null }
              : withSide;
          const withExpiry =
            (migratedIntent as { expiresAt?: unknown }).expiresAt === undefined
              ? { ...migratedIntent, expiresAt: null as string | null }
              : migratedIntent;
          const withFill =
            (withExpiry as { fillLots?: unknown }).fillLots === undefined
              ? { ...withExpiry, fillLots: (withExpiry as PackageOrderIntent).lots }
              : withExpiry;
          return {
            ...typed,
            authorization: { ...typed.authorization, intent: withFill },
            quotes: typed.quotes.map((quote) => {
              const provenance = (quote as Partial<FirmRfqQuote>).provenance as
                | RfqQuoteProvenance
                | undefined;
              if (provenance === "LOCAL_DEMO" || provenance === "SEEDED_SOLVER") {
                return { ...quote, provenance };
              }
              return { ...quote, provenance: "SEEDED_SOLVER" as RfqQuoteProvenance };
            }),
          };
        })
      : [];
    const storedAccount = (snapshot as { account?: unknown }).account as
      | Partial<GatewayAccount>
      | undefined;
    const fallback = initialSnapshot();
    const baseAccount: GatewayAccount = {
      id:
        typeof storedAccount?.id === "string" && storedAccount.id.length > 0
          ? storedAccount.id
          : fallback.account.id,
      label:
        typeof storedAccount?.label === "string" && storedAccount.label.length > 0
          ? storedAccount.label
          : fallback.account.label,
      riskDomain:
        typeof storedAccount?.riskDomain === "string" && storedAccount.riskDomain.length > 0
          ? storedAccount.riskDomain
          : fallback.account.riskDomain,
      collateralAsset: "USDC",
      posted: fallback.account.posted,
      eligible: fallback.account.posted,
      reserved: 0,
      available: fallback.account.posted,
      equity: fallback.account.posted,
    };
    const storedPosted = storedAccount?.posted;
    const sanePosted =
      typeof storedPosted === "number" && Number.isFinite(storedPosted) && storedPosted >= 0
        ? toCents(storedPosted)
        : fallback.account.posted;
    const account = buildCoherentAccount(baseAccount, sanePosted, positions, restingOrders);
    return {
      ...snapshot,
      wallet: { status: "DISCONNECTED", address: null, chainId: null },
      account,
      positions,
      receipts,
      executions,
      restingOrders,
      rfqRequests,
    };
  } catch {
    return initialSnapshot();
  }
}

export class DemoTradingGateway implements InternalTradingGateway {
  private snapshot: GatewaySnapshot = restoreSnapshot();

  private readonly listeners = new Set<() => void>();

  getSnapshot = () => this.snapshot;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private publish(snapshot: GatewaySnapshot) {
    this.snapshot = snapshot;
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    }
    this.listeners.forEach((listener) => listener());
  }

  private assertWritableEnvironment() {
    if (this.snapshot.environment.id !== "LOCAL_DEMO" && this.snapshot.environment.id !== "ARBITRUM_SEPOLIA") {
      throw new Error("MAINNET_WRITE_DISABLED");
    }
  }

  async connectWallet() {
    this.publish({ ...this.snapshot, wallet: { status: "CONNECTING", address: null, chainId: null } });
    await wait(350);
    this.publish({
      ...this.snapshot,
      wallet: {
        status: "CONNECTED",
        address: "0x72F8b1463D7a431cD93c4a7737fC1944B1E2A9d0",
        chainId: this.snapshot.environment.chainId,
      },
    });
  }

  async submitCollateralIntent(intent: CollateralIntent): Promise<CollateralIntentResult> {
    this.assertWritableEnvironment();
    if (this.snapshot.wallet.status !== "CONNECTED") throw new Error("CONNECT_WALLET");
    if (!Number.isFinite(intent.amount) || intent.amount <= 0) throw new Error("INVALID_AMOUNT");
    const amount = toCents(intent.amount);
    if (!(amount > 0)) throw new Error("INVALID_AMOUNT");
    const coherent = buildCoherentAccount(
      this.snapshot.account,
      this.snapshot.account.posted,
      this.snapshot.positions,
      this.snapshot.restingOrders,
    );
    if (intent.kind === "WITHDRAW" && amount - coherent.available > MONEY_TOL) {
      throw new Error("INSUFFICIENT_AVAILABLE_COLLATERAL");
    }
    const direction = intent.kind === "DEPOSIT" ? 1 : -1;
    const nextPosted = toCents(coherent.posted + direction * amount);
    const account = buildCoherentAccount(
      this.snapshot.account,
      nextPosted,
      this.snapshot.positions,
      this.snapshot.restingOrders,
    );
    await wait(450);
    this.publish({
      ...this.snapshot,
      account,
    });
    return { intentId: identifier("COL"), kind: intent.kind, amount, status: "COMPLETED" };
  }

  async authorizeOrder(intent: PackageOrderIntent): Promise<SignedOrderAuthorization> {
    this.assertWritableEnvironment();
    if (!Number.isFinite(intent.contractMultiplier) || intent.contractMultiplier <= 0) {
      throw new Error("INVALID_CONTRACT_MULTIPLIER");
    }
    if (!isPackageSide(intent.packageSide)) throw new Error("INVALID_PACKAGE_SIDE");
    const signer = this.snapshot.wallet.address;
    if (!signer || this.snapshot.wallet.status !== "CONNECTED") throw new Error("CONNECT_WALLET");
    const replacesOrderId =
      (intent as { replacesOrderId?: unknown }).replacesOrderId ?? null;
    if (replacesOrderId != null) {
      validateFillLots(intent, true);
      if (typeof replacesOrderId !== "string" || replacesOrderId.length === 0) {
        throw new Error("REPLACEMENT_ORDER_NOT_FOUND");
      }
      const oldOrder = this.snapshot.restingOrders.find((order) => order.id === replacesOrderId);
      if (!oldOrder) throw new Error("REPLACEMENT_ORDER_NOT_FOUND");
      if (!isLiveRestingState(oldOrder.state)) throw new Error("REPLACEMENT_ORDER_NOT_WORKING");
      if (
        intent.orderType !== "LIMIT" ||
        (intent.timeInForce !== "GTC" && intent.timeInForce !== "GTD")
      ) {
        throw new Error("REPLACEMENT_REQUIRES_LIMIT_GTC");
      }
      if (intent.timeInForce !== oldOrder.timeInForce) {
        throw new Error("REPLACEMENT_TIF_MISMATCH");
      }
      validateIntentExpiry(intent);
      if (
        intent.accountId !== oldOrder.accountId ||
        intent.marketId !== oldOrder.marketId ||
        intent.packageCode !== oldOrder.packageCode ||
        intent.side !== oldOrder.side ||
        intent.packageSide !== oldOrder.packageSide ||
        (intent.closePositionId ?? null) !== (oldOrder.closePositionId ?? null)
      ) {
        throw new Error("REPLACEMENT_MISMATCH");
      }
      if (intent.disclosure !== oldOrder.disclosure) {
        throw new Error("REPLACEMENT_MISMATCH");
      }
      if (oldOrder.side === "EXIT" && oldOrder.collateralReservation !== 0) {
        throw new Error("REPLACEMENT_MISMATCH");
      }
      if (intent.side === "ENTER" && intent.closePositionId != null) {
        throw new Error("CLOSE_POSITION_FORBIDDEN_FOR_ENTRY");
      }
      if (intent.side === "EXIT") {
        if (!intent.closePositionId) throw new Error("CLOSE_POSITION_REQUIRED");
        if (intent.collateralRequired !== 0) throw new Error("EXIT_REQUIRES_ZERO_COLLATERAL");
        const target = this.snapshot.positions.find(
          (position) => position.id === intent.closePositionId,
        );
        if (!target) throw new Error("POSITION_NOT_FOUND");
        if (target.marketId !== intent.marketId) throw new Error("POSITION_MARKET_MISMATCH");
        if (intent.packageSide !== target.side) throw new Error("PACKAGE_SIDE_MISMATCH");
        if (!Number.isFinite(intent.lots) || intent.lots <= 0) throw new Error("INVALID_CLOSE_LOTS");
        if (intent.lots - target.lots > 1e-9) throw new Error("CLOSE_LOTS_EXCEEDS_POSITION");
        if (intent.fillLots - target.lots > 1e-9) throw new Error("CLOSE_LOTS_EXCEEDS_POSITION");
        const fillForExit = intent.fillLots;
        const releasable = toCents(
          target.lots > 0 ? (target.collateral * fillForExit) / target.lots : 0,
        );
        const multiplier = intent.contractMultiplier;
        const direction = target.side === "SHORT" ? -1 : 1;
        const realizedPnl = toCents(
          (intent.executionPrice - target.entryPrice) * fillForExit * multiplier * direction,
        );
        const exitFee = executedAmount(intent.feeCap, fillForExit, intent.lots);
        const nextPosted = toCents(this.snapshot.account.posted + realizedPnl - exitFee);
        const exitIsFullAuth = fillForExit >= target.lots - 1e-9;
        const nextPositionsAuth = (() => {
          const remainingLots = target.lots - fillForExit;
          const remainingCollateral = toCents(Math.max(0, target.collateral - releasable));
          if (exitIsFullAuth || remainingLots <= 1e-9) {
            return this.snapshot.positions.filter((position) => position.id !== target.id);
          }
          return this.snapshot.positions.map((position) =>
            position.id === target.id
              ? { ...position, lots: remainingLots, collateral: remainingCollateral }
              : position,
          );
        })();
        try {
          buildCoherentAccount(
            this.snapshot.account,
            nextPosted,
            nextPositionsAuth,
            this.snapshot.restingOrders,
          );
        } catch {
          throw new Error("INSUFFICIENT_AVAILABLE_COLLATERAL");
        }
      } else {
        if (!Number.isFinite(intent.lots) || intent.lots <= 0) throw new Error("INVALID_LOTS");
        const collateral = toCents(intent.collateralRequired);
        const fee = toCents(intent.feeCap);
        if (!Number.isFinite(collateral) || collateral < 0) {
          throw new Error("INSUFFICIENT_AVAILABLE_COLLATERAL");
        }
        if (!Number.isFinite(fee) || fee < 0) {
          throw new Error("INSUFFICIENT_AVAILABLE_COLLATERAL");
        }
        const coherent = buildCoherentAccount(
          this.snapshot.account,
          this.snapshot.account.posted,
          this.snapshot.positions,
          this.snapshot.restingOrders,
        );
        const newRequirement = toCents(collateral + fee);
        const released = toCents(restingRemainingReservation(oldOrder));
        if (newRequirement - released - coherent.available > MONEY_TOL) {
          throw new Error("INSUFFICIENT_AVAILABLE_COLLATERAL");
        }
      }
      await wait(300);
      const nonce = crypto.randomUUID();
      const orderHash = digest(JSON.stringify({ ...intent, nonce, chainId: this.snapshot.environment.chainId }));
      return {
        orderHash,
        signature: `demo:${digest(`${orderHash}:${signer}`)}`,
        signer,
        nonce,
        deadline: new Date(Date.now() + 15 * 60_000).toISOString(),
        intent,
      };
    }
    if (intent.side === "ENTER" && intent.closePositionId != null) {
      throw new Error("CLOSE_POSITION_FORBIDDEN_FOR_ENTRY");
    }
    validateFillLots(intent, false);
    if (intent.side === "EXIT") {
      if (!intent.closePositionId) throw new Error("CLOSE_POSITION_REQUIRED");
      if (intent.collateralRequired !== 0) throw new Error("EXIT_REQUIRES_ZERO_COLLATERAL");
      const target = this.snapshot.positions.find(
        (position) => position.id === intent.closePositionId,
      );
      if (!target) throw new Error("POSITION_NOT_FOUND");
      if (target.marketId !== intent.marketId) throw new Error("POSITION_MARKET_MISMATCH");
      if (intent.packageSide !== target.side) throw new Error("PACKAGE_SIDE_MISMATCH");
      if (!Number.isFinite(intent.lots) || intent.lots <= 0) throw new Error("INVALID_CLOSE_LOTS");
      if (intent.lots - target.lots > 1e-9) throw new Error("CLOSE_LOTS_EXCEEDS_POSITION");
      if (intent.fillLots - target.lots > 1e-9) throw new Error("CLOSE_LOTS_EXCEEDS_POSITION");
      const fillForExit = intent.fillLots;
      const releasable = toCents(
        target.lots > 0 ? (target.collateral * fillForExit) / target.lots : 0,
      );
      const multiplier = intent.contractMultiplier;
      const direction = target.side === "SHORT" ? -1 : 1;
      const realizedPnl = toCents(
        (intent.executionPrice - target.entryPrice) * fillForExit * multiplier * direction,
      );
      const exitFee = executedAmount(intent.feeCap, fillForExit, intent.lots);
      const nextPosted = toCents(this.snapshot.account.posted + realizedPnl - exitFee);
      const exitIsFullAuth = fillForExit >= target.lots - 1e-9;
      const nextPositionsAuth = (() => {
        const remainingLots = target.lots - fillForExit;
        const remainingCollateral = toCents(Math.max(0, target.collateral - releasable));
        if (exitIsFullAuth || remainingLots <= 1e-9) {
          return this.snapshot.positions.filter((position) => position.id !== target.id);
        }
        return this.snapshot.positions.map((position) =>
          position.id === target.id
            ? { ...position, lots: remainingLots, collateral: remainingCollateral }
            : position,
        );
      })();
      try {
        buildCoherentAccount(
          this.snapshot.account,
          nextPosted,
          nextPositionsAuth,
          this.snapshot.restingOrders,
        );
      } catch {
        throw new Error("INSUFFICIENT_AVAILABLE_COLLATERAL");
      }
    } else {
      const collateral = executedAmount(intent.collateralRequired, intent.fillLots, intent.lots);
      const fee = executedAmount(intent.feeCap, intent.fillLots, intent.lots);
      const coherent = buildCoherentAccount(
        this.snapshot.account,
        this.snapshot.account.posted,
        this.snapshot.positions,
        this.snapshot.restingOrders,
      );
      if (collateral + fee - coherent.available > MONEY_TOL) {
        throw new Error("INSUFFICIENT_AVAILABLE_COLLATERAL");
      }
    }
    validateIntentExpiry(intent);
    await wait(300);
    const nonce = crypto.randomUUID();
    const orderHash = digest(JSON.stringify({ ...intent, nonce, chainId: this.snapshot.environment.chainId }));
    return {
      orderHash,
      signature: `demo:${digest(`${orderHash}:${signer}`)}`,
      signer,
      nonce,
      deadline: new Date(Date.now() + 15 * 60_000).toISOString(),
      intent,
    };
  }

  async submitAuthorizedOrder(
    authorization: SignedOrderAuthorization,
    onUpdate: (update: SubmissionUpdate) => void,
  ): Promise<PackageExecutionResult> {
    this.assertWritableEnvironment();
    if ((authorization.intent as { replacesOrderId?: unknown }).replacesOrderId != null) {
      throw new Error("REPLACE_FLOW_REQUIRED");
    }
    if (
      !Number.isFinite(authorization.intent.contractMultiplier) ||
      authorization.intent.contractMultiplier <= 0
    ) {
      throw new Error("INVALID_CONTRACT_MULTIPLIER");
    }
    if (authorization.signer !== this.snapshot.wallet.address) throw new Error("SIGNER_MISMATCH");
    if (Date.parse(authorization.deadline) <= Date.now()) throw new Error("AUTHORIZATION_EXPIRED");
    const intent = authorization.intent;
    if (!isPackageSide(intent.packageSide)) throw new Error("INVALID_PACKAGE_SIDE");
    validateIntentExpiry(intent);
    validateFillLots(intent, false);
    const isExit = intent.side === "EXIT";
    if (!isExit && intent.closePositionId != null) {
      throw new Error("CLOSE_POSITION_FORBIDDEN_FOR_ENTRY");
    }
    const requestedLots = intent.lots;
    const filledLots = intent.fillLots;
    const cancelledLots = Math.max(0, requestedLots - filledLots);
    const settledFee = executedAmount(intent.feeCap, filledLots, requestedLots);
    const settledEntryCollateral = isExit
      ? 0
      : executedAmount(intent.collateralRequired, filledLots, requestedLots);

    const coherentView = buildCoherentAccount(
      this.snapshot.account,
      this.snapshot.account.posted,
      this.snapshot.positions,
      this.snapshot.restingOrders,
    );
    let exitTargetId: string | null = null;
    let exitCloseLots = 0;
    let exitRelease = 0;
    let exitRealizedPnl = 0;
    let exitIsFull = false;
    if (isExit) {
      if (!intent.closePositionId) throw new Error("CLOSE_POSITION_REQUIRED");
      if (intent.collateralRequired !== 0) throw new Error("EXIT_REQUIRES_ZERO_COLLATERAL");
      const target = this.snapshot.positions.find(
        (position) => position.id === intent.closePositionId,
      );
      if (!target) throw new Error("POSITION_NOT_FOUND");
      if (target.marketId !== intent.marketId) throw new Error("POSITION_MARKET_MISMATCH");
      if (intent.packageSide !== target.side) throw new Error("PACKAGE_SIDE_MISMATCH");
      if (!Number.isFinite(intent.lots) || intent.lots <= 0) throw new Error("INVALID_CLOSE_LOTS");
      if (intent.lots - target.lots > 1e-9) throw new Error("CLOSE_LOTS_EXCEEDS_POSITION");
      exitTargetId = target.id;
      exitCloseLots = filledLots;
      exitRelease = toCents(target.lots > 0 ? (target.collateral * filledLots) / target.lots : 0);
      const multiplier = intent.contractMultiplier;
      const direction = target.side === "SHORT" ? -1 : 1;
      exitRealizedPnl = toCents(
        (intent.executionPrice - target.entryPrice) * filledLots * multiplier * direction,
      );
      exitIsFull = filledLots >= target.lots - 1e-9;
      const nextPosted = toCents(coherentView.posted + exitRealizedPnl - settledFee);
      const nextPositions = (() => {
        const remainingLots = target.lots - exitCloseLots;
        const remainingCollateral = toCents(Math.max(0, target.collateral - exitRelease));
        if (exitIsFull || remainingLots <= 1e-9) {
          return this.snapshot.positions.filter((position) => position.id !== target.id);
        }
        return this.snapshot.positions.map((position) =>
          position.id === target.id
            ? { ...position, lots: remainingLots, collateral: remainingCollateral }
            : position,
        );
      })();
      buildCoherentAccount(this.snapshot.account, nextPosted, nextPositions, this.snapshot.restingOrders);
    } else {
      if (settledEntryCollateral + settledFee - coherentView.available > MONEY_TOL) {
        throw new Error("INSUFFICIENT_AVAILABLE_COLLATERAL");
      }
      const nextPosted = toCents(coherentView.posted - settledFee);
      const previewPosition: ExecutionPosition = {
        id: "preview",
        marketId: intent.marketId,
        side: intent.packageSide,
        lots: filledLots,
        entryPrice: intent.executionPrice,
        collateral: settledEntryCollateral,
        state: "ACTIVE",
        createdAt: new Date().toISOString(),
      };
      buildCoherentAccount(
        this.snapshot.account,
        nextPosted,
        [...this.snapshot.positions, previewPosition],
        this.snapshot.restingOrders,
      );
    }

    const transactionHash = digest(`${authorization.orderHash}:transaction`);
    const filledDetail = isExit
      ? `${filledLots} package lots closed at the selected route price.`
      : `${filledLots} package lots filled at the selected route price.`;
    const positionStep: SubmissionUpdate = isExit
      ? exitIsFull
        ? {
            step: "POSITION_CLOSED",
            label: "Position closed",
            detail: `Closed ${filledLots} lots; the local demo account recorded the $${exitRealizedPnl.toFixed(2)} package result and released $${exitRelease.toFixed(2)} collateral.`,
          }
        : {
            step: "POSITION_UPDATED",
            label: "Position reduced",
            detail: `Closed ${filledLots} lots pro rata; the local demo account recorded the $${exitRealizedPnl.toFixed(2)} package result and the remaining package position stays active.`,
          }
      : {
          step: "POSITION_CREATED",
          label: "Position created",
          detail: "Collateral reservation and package position were recorded together.",
        };
    const updates: SubmissionUpdate[] = [
      { step: "AUTHORIZED", label: "Authorized", detail: "Package authorization is bound to the selected account and route." },
      { step: "SUBMITTED", label: "Submitted", detail: "Authorization accepted by the demo clearing runtime." },
      { step: "INCLUDED", label: "Included", detail: "Package execution was included as one clearing result.", transactionHash },
      {
        step: "FILLED",
        label: "Filled",
        detail: filledDetail,
      },
      ...(cancelledLots > 1e-9
        ? [
            {
              step: "IOC_CANCELLED" as const,
              label: "Remainder cancelled",
              detail: `Cancelled ${cancelledLots} lots; the unfilled quantity incurred no fee or collateral lock.`,
            },
          ]
        : []),
      positionStep,
    ];
    const journal: SubmissionUpdate[] = [];
    for (const update of updates) {
      await wait(320);
      journal.push(update);
      onUpdate(update);
    }

    const fillId = identifier("FIL");
    const receiptId = identifier("RCP");
    const settledRelease = toCents(exitRelease);
    const settledPnl = toCents(exitRealizedPnl);
    const receipt: ExecutionReceipt = {
      id: receiptId,
      orderHash: authorization.orderHash,
      fillId,
      transactionHash,
      marketId: intent.marketId,
      packageCode: intent.packageCode,
      packageSide: intent.packageSide,
      routeLabel: intent.routeLabel,
      lots: filledLots,
      requestedLots,
      filledLots,
      cancelledLots,
      price: intent.executionPrice,
      fees: settledFee,
      realizedPnlUsd: isExit ? settledPnl : 0,
      collateralReleasedUsd: isExit ? settledRelease : 0,
      guarantee: intent.settlementGuarantee,
      evidence: this.snapshot.environment.evidence,
      createdAt: new Date().toISOString(),
    };

    if (isExit) {
      const target = this.snapshot.positions.find((position) => position.id === exitTargetId);
      if (!target) throw new Error("POSITION_NOT_FOUND");
      const freshRelease = toCents(
        target.lots > 0 ? (target.collateral * exitCloseLots) / target.lots : 0,
      );
      const multiplier = intent.contractMultiplier;
      const direction = target.side === "SHORT" ? -1 : 1;
      const freshPnl = toCents(
        (intent.executionPrice - target.entryPrice) * exitCloseLots * multiplier * direction,
      );
      const freshIsFull = exitCloseLots >= target.lots - 1e-9;
      const remainingLots = target.lots - exitCloseLots;
      const remainingCollateral = toCents(Math.max(0, target.collateral - freshRelease));
      const updatedPosition =
        freshIsFull || remainingLots <= 1e-9
          ? null
          : {
              ...target,
              lots: remainingLots,
              collateral: remainingCollateral,
            };
      const nextPositions =
        updatedPosition === null
          ? this.snapshot.positions.filter((position) => position.id !== target.id)
          : this.snapshot.positions.map((position) =>
              position.id === target.id ? updatedPosition : position,
            );
      const nextPosted = toCents(this.snapshot.account.posted + freshPnl - settledFee);
      const account = buildCoherentAccount(
        this.snapshot.account,
        nextPosted,
        nextPositions,
        this.snapshot.restingOrders,
      );
      const settledReceipt: ExecutionReceipt = {
        ...receipt,
        fees: settledFee,
        realizedPnlUsd: freshPnl,
        collateralReleasedUsd: freshRelease,
      };
      this.publish({
        ...this.snapshot,
        account,
        positions: nextPositions,
        receipts: [settledReceipt, ...this.snapshot.receipts],
      });
      const receiptUpdate = {
        step: "RECEIPT_READY" as const,
        label: "Receipt ready",
        detail: "Execution evidence is available for inspection.",
      };
      journal.push(receiptUpdate);
      onUpdate(receiptUpdate);
      const result: PackageExecutionResult = {
        fillId,
        outcome: updatedPosition === null ? "CLOSED" : "REDUCED",
        requestedLots,
        filledLots,
        cancelledLots,
        position: updatedPosition,
        closedPositionId: target.id,
        closedLots: exitCloseLots,
        receipt: settledReceipt,
      };
      this.publish({
        ...this.snapshot,
        executions: [
          {
            id: identifier("EXE"),
            orderHash: authorization.orderHash,
            updates: journal,
            result,
            createdAt: settledReceipt.createdAt,
          },
          ...this.snapshot.executions,
        ],
      });
      return result;
    }

    const positionId = identifier("STR");
    const coherentAfterWait = buildCoherentAccount(
      this.snapshot.account,
      this.snapshot.account.posted,
      this.snapshot.positions,
      this.snapshot.restingOrders,
    );
    if (settledEntryCollateral + settledFee - coherentAfterWait.available > MONEY_TOL) {
      throw new Error("INSUFFICIENT_AVAILABLE_COLLATERAL");
    }
    const position: PackageExecutionResult["position"] = {
      id: positionId,
      marketId: intent.marketId,
      side: intent.packageSide,
      lots: filledLots,
      entryPrice: intent.executionPrice,
      collateral: settledEntryCollateral,
      state: "ACTIVE" as const,
      createdAt: receipt.createdAt,
    };
    const nextPosted = toCents(this.snapshot.account.posted - settledFee);
    const nextPositions = position
      ? [position, ...this.snapshot.positions]
      : [...this.snapshot.positions];
    const account = buildCoherentAccount(
      this.snapshot.account,
      nextPosted,
      nextPositions,
      this.snapshot.restingOrders,
    );
    this.publish({
      ...this.snapshot,
      account,
      positions: nextPositions,
      receipts: [receipt, ...this.snapshot.receipts],
    });
    const receiptUpdate = {
      step: "RECEIPT_READY" as const,
      label: "Receipt ready",
      detail: "Execution evidence is available for inspection.",
    };
    journal.push(receiptUpdate);
    onUpdate(receiptUpdate);
    const result: PackageExecutionResult = {
      fillId,
      outcome: "OPENED",
      requestedLots,
      filledLots,
      cancelledLots,
      position,
      closedPositionId: null,
      closedLots: 0,
      receipt,
    };
    this.publish({
      ...this.snapshot,
      executions: [
        {
          id: identifier("EXE"),
          orderHash: authorization.orderHash,
          updates: journal,
          result,
          createdAt: receipt.createdAt,
        },
        ...this.snapshot.executions,
      ],
    });
    return result;
  }

  async placeRestingOrder(
    authorization: SignedOrderAuthorization,
  ): Promise<RestingPackageOrder> {
    this.assertWritableEnvironment();
    if ((authorization.intent as { replacesOrderId?: unknown }).replacesOrderId != null) {
      throw new Error("REPLACE_FLOW_REQUIRED");
    }
    if (
      !Number.isFinite(authorization.intent.contractMultiplier) ||
      authorization.intent.contractMultiplier <= 0
    ) {
      throw new Error("INVALID_CONTRACT_MULTIPLIER");
    }
    if (authorization.intent.orderType !== "LIMIT") {
      throw new Error("RESTING_ORDER_REQUIRES_LIMIT");
    }
    if (authorization.intent.timeInForce !== "GTC" && authorization.intent.timeInForce !== "GTD") {
      throw new Error("RESTING_ORDER_REQUIRES_GTC");
    }
    if (authorization.signer !== this.snapshot.wallet.address) throw new Error("SIGNER_MISMATCH");
    if (Date.parse(authorization.deadline) <= Date.now()) throw new Error("AUTHORIZATION_EXPIRED");
    const intent = authorization.intent;
    if (!isPackageSide(intent.packageSide)) throw new Error("INVALID_PACKAGE_SIDE");
    validateIntentExpiry(intent);
    validateFillLots(intent, true);
    const isExit = intent.side === "EXIT";
    if (!isExit && intent.closePositionId != null) {
      throw new Error("CLOSE_POSITION_FORBIDDEN_FOR_ENTRY");
    }

    let reservation = 0;
    let feeCap = 0;
    if (isExit) {
      if (!intent.closePositionId) throw new Error("CLOSE_POSITION_REQUIRED");
      if (intent.collateralRequired !== 0) throw new Error("EXIT_REQUIRES_ZERO_COLLATERAL");
      const target = this.snapshot.positions.find(
        (position) => position.id === intent.closePositionId,
      );
      if (!target) throw new Error("POSITION_NOT_FOUND");
      if (target.marketId !== intent.marketId) throw new Error("POSITION_MARKET_MISMATCH");
      if (intent.packageSide !== target.side) throw new Error("PACKAGE_SIDE_MISMATCH");
      if (!Number.isFinite(intent.lots) || intent.lots <= 0) throw new Error("INVALID_CLOSE_LOTS");
      if (intent.lots - target.lots > 1e-9) throw new Error("CLOSE_LOTS_EXCEEDS_POSITION");
      reservation = 0;
      feeCap = toCents(intent.feeCap);
      if (!Number.isFinite(feeCap) || feeCap < 0) throw new Error("INVALID_LEDGER");
    } else {
      const collateral = toCents(intent.collateralRequired);
      feeCap = toCents(intent.feeCap);
      if (!Number.isFinite(collateral) || collateral < 0) throw new Error("INVALID_LEDGER");
      if (!Number.isFinite(feeCap) || feeCap < 0) throw new Error("INVALID_LEDGER");
      const coherent = buildCoherentAccount(
        this.snapshot.account,
        this.snapshot.account.posted,
        this.snapshot.positions,
        this.snapshot.restingOrders,
      );
      if (collateral + feeCap - coherent.available > MONEY_TOL) {
        throw new Error("INSUFFICIENT_AVAILABLE_COLLATERAL");
      }
      reservation = toCents(collateral + feeCap);
    }

    const createdAt = new Date().toISOString();
    const quantizedCollateral = isExit ? 0 : toCents(intent.collateralRequired);
    const order: RestingPackageOrder = {
      id: identifier("ORD"),
      orderHash: authorization.orderHash,
      accountId: intent.accountId,
      marketId: intent.marketId,
      packageCode: intent.packageCode,
      routeId: intent.routeId,
      routeLabel: intent.routeLabel,
      side: intent.side,
      packageSide: intent.packageSide,
      lots: intent.lots,
      filledLots: 0,
      remainingLots: intent.lots,
      limitPrice: intent.limitPrice,
      timeInForce: intent.timeInForce,
      expiresAt: intent.expiresAt,
      collateralReservation: reservation,
      remainingCollateralReservation: reservation,
      feeCap,
      remainingFeeCap: feeCap,
      fillIds: [],
      receiptIds: [],
      closePositionId: intent.closePositionId,
      replacesOrderId: null,
      createdAt,
      state: "WORKING",
      orderType: intent.orderType,
      contractMultiplier: intent.contractMultiplier,
      settlementGuarantee: intent.settlementGuarantee,
      disclosure: intent.disclosure,
      recipient: intent.recipient,
      collateralRequired: quantizedCollateral,
    };
    const existingOrders = Array.isArray(this.snapshot.restingOrders)
      ? this.snapshot.restingOrders
      : [];
    const nextOrders = [order, ...existingOrders];
    const account = buildCoherentAccount(
      this.snapshot.account,
      this.snapshot.account.posted,
      this.snapshot.positions,
      nextOrders,
    );
    this.publish({
      ...this.snapshot,
      account,
      restingOrders: nextOrders,
    });
    return order;
  }

  async replaceRestingOrder(
    oldOrderId: string,
    authorization: SignedOrderAuthorization,
  ): Promise<RestingPackageOrder> {
    this.assertWritableEnvironment();
    if (
      !Number.isFinite(authorization.intent.contractMultiplier) ||
      authorization.intent.contractMultiplier <= 0
    ) {
      throw new Error("INVALID_CONTRACT_MULTIPLIER");
    }
    if (authorization.signer !== this.snapshot.wallet.address) throw new Error("SIGNER_MISMATCH");
    if (Date.parse(authorization.deadline) <= Date.now()) throw new Error("AUTHORIZATION_EXPIRED");
    const intent = authorization.intent;
    const replacesOrderId = (intent as { replacesOrderId?: unknown }).replacesOrderId;
    if (typeof replacesOrderId !== "string" || replacesOrderId.length === 0) {
      throw new Error("REPLACEMENT_ID_MISMATCH");
    }
    if (replacesOrderId !== oldOrderId) throw new Error("REPLACEMENT_ID_MISMATCH");
    if (!isPackageSide(intent.packageSide)) throw new Error("INVALID_PACKAGE_SIDE");
    if (
      intent.orderType !== "LIMIT" ||
      (intent.timeInForce !== "GTC" && intent.timeInForce !== "GTD")
    ) {
      throw new Error("REPLACEMENT_REQUIRES_LIMIT_GTC");
    }
    const existingOrders = Array.isArray(this.snapshot.restingOrders)
      ? this.snapshot.restingOrders
      : [];
    const oldOrder = existingOrders.find((order) => order.id === oldOrderId);
    if (!oldOrder) throw new Error("REPLACEMENT_ORDER_NOT_FOUND");
    if (!isLiveRestingState(oldOrder.state)) throw new Error("REPLACEMENT_ORDER_NOT_WORKING");
    if (intent.timeInForce !== oldOrder.timeInForce) {
      throw new Error("REPLACEMENT_TIF_MISMATCH");
    }
    validateIntentExpiry(intent);
    validateFillLots(intent, true);
    if (
      intent.accountId !== oldOrder.accountId ||
      intent.marketId !== oldOrder.marketId ||
      intent.packageCode !== oldOrder.packageCode ||
      intent.side !== oldOrder.side ||
      intent.packageSide !== oldOrder.packageSide ||
      (intent.closePositionId ?? null) !== (oldOrder.closePositionId ?? null)
    ) {
      throw new Error("REPLACEMENT_MISMATCH");
    }
    if (intent.disclosure !== oldOrder.disclosure) {
      throw new Error("REPLACEMENT_MISMATCH");
    }
    if (oldOrder.side === "EXIT" && oldOrder.collateralReservation !== 0) {
      throw new Error("REPLACEMENT_MISMATCH");
    }
    const isExit = intent.side === "EXIT";
    if (!isExit && intent.closePositionId != null) {
      throw new Error("CLOSE_POSITION_FORBIDDEN_FOR_ENTRY");
    }
    let newReservation = 0;
    let newFeeCap = 0;
    if (isExit) {
      if (!intent.closePositionId) throw new Error("CLOSE_POSITION_REQUIRED");
      if (intent.collateralRequired !== 0) throw new Error("EXIT_REQUIRES_ZERO_COLLATERAL");
      const target = this.snapshot.positions.find(
        (position) => position.id === intent.closePositionId,
      );
      if (!target) throw new Error("POSITION_NOT_FOUND");
      if (target.marketId !== intent.marketId) throw new Error("POSITION_MARKET_MISMATCH");
      if (intent.packageSide !== target.side) throw new Error("PACKAGE_SIDE_MISMATCH");
      if (!Number.isFinite(intent.lots) || intent.lots <= 0) throw new Error("INVALID_CLOSE_LOTS");
      if (intent.lots - target.lots > 1e-9) throw new Error("CLOSE_LOTS_EXCEEDS_POSITION");
      newFeeCap = toCents(intent.feeCap);
      if (!Number.isFinite(newFeeCap) || newFeeCap < 0) throw new Error("INVALID_LEDGER");
      newReservation = 0;
    } else {
      if (!Number.isFinite(intent.lots) || intent.lots <= 0) throw new Error("INVALID_LOTS");
      const newCollateral = toCents(intent.collateralRequired);
      newFeeCap = toCents(intent.feeCap);
      if (!Number.isFinite(newCollateral) || newCollateral < 0) {
        throw new Error("INSUFFICIENT_AVAILABLE_COLLATERAL");
      }
      if (!Number.isFinite(newFeeCap) || newFeeCap < 0) {
        throw new Error("INSUFFICIENT_AVAILABLE_COLLATERAL");
      }
      newReservation = toCents(newCollateral + newFeeCap);
      const coherent = buildCoherentAccount(
        this.snapshot.account,
        this.snapshot.account.posted,
        this.snapshot.positions,
        this.snapshot.restingOrders,
      );
      const released = toCents(restingRemainingReservation(oldOrder));
      const delta = toCents(newReservation - released);
      if (delta - coherent.available > MONEY_TOL) {
        throw new Error("INSUFFICIENT_AVAILABLE_COLLATERAL");
      }
    }
    const now = new Date().toISOString();
    const newId = identifier("ORD");
    const newOrder: RestingPackageOrder = {
      id: newId,
      orderHash: authorization.orderHash,
      accountId: intent.accountId,
      marketId: intent.marketId,
      packageCode: intent.packageCode,
      routeId: intent.routeId,
      routeLabel: intent.routeLabel,
      side: intent.side,
      packageSide: intent.packageSide,
      lots: intent.lots,
      filledLots: 0,
      remainingLots: intent.lots,
      limitPrice: intent.limitPrice,
      timeInForce: intent.timeInForce,
      expiresAt: intent.expiresAt,
      collateralReservation: newReservation,
      remainingCollateralReservation: newReservation,
      feeCap: newFeeCap,
      remainingFeeCap: newFeeCap,
      fillIds: [],
      receiptIds: [],
      closePositionId: intent.closePositionId,
      replacesOrderId: oldOrderId,
      createdAt: now,
      state: "WORKING",
      orderType: intent.orderType,
      contractMultiplier: intent.contractMultiplier,
      settlementGuarantee: intent.settlementGuarantee,
      disclosure: intent.disclosure,
      recipient: intent.recipient,
      collateralRequired: isExit ? 0 : toCents(intent.collateralRequired),
    };
    const replaced: RestingPackageOrder = {
      ...oldOrder,
      state: "REPLACED",
      replacedAt: now,
      replacedByOrderId: newId,
      remainingCollateralReservation: 0,
      remainingFeeCap: 0,
    };
    const nextOrders = [
      newOrder,
      ...existingOrders.map((order) => (order.id === oldOrderId ? replaced : order)),
    ];
    const account = buildCoherentAccount(
      this.snapshot.account,
      this.snapshot.account.posted,
      this.snapshot.positions,
      nextOrders,
    );
    this.publish({
      ...this.snapshot,
      account,
      restingOrders: nextOrders,
    });
    return newOrder;
  }

  async cancelRestingOrder(orderId: string): Promise<RestingPackageOrder> {
    this.assertWritableEnvironment();
    const existingOrders = Array.isArray(this.snapshot.restingOrders)
      ? this.snapshot.restingOrders
      : [];
    const target = existingOrders.find((order) => order.id === orderId);
    if (!target) throw new Error("RESTING_ORDER_NOT_FOUND");
    if (!isLiveRestingState(target.state)) throw new Error("RESTING_ORDER_NOT_WORKING");
    const cancelledAt = new Date().toISOString();
    const cancelled: RestingPackageOrder = {
      ...target,
      state: "CANCELLED",
      cancelledAt,
      remainingCollateralReservation: 0,
      remainingFeeCap: 0,
    };
    const nextOrders = existingOrders.map((order) => (order.id === orderId ? cancelled : order));
    const account = buildCoherentAccount(
      this.snapshot.account,
      this.snapshot.account.posted,
      this.snapshot.positions,
      nextOrders,
    );
    this.publish({
      ...this.snapshot,
      account,
      restingOrders: nextOrders,
    });
    return cancelled;
  }

  reconcileRestingOrders(markets: readonly PackageMarket[]): RestingPackageOrder[] {
    if (
      this.snapshot.environment.id !== "LOCAL_DEMO" &&
      this.snapshot.environment.id !== "ARBITRUM_SEPOLIA"
    ) {
      return [];
    }
    const live = this.snapshot.restingOrders.filter((order) => isLiveRestingState(order.state));
    if (live.length === 0) return [];
    const expired: RestingPackageOrder[] = [];
    for (const order of live) {
      const completed = this.expireWorkingOrder(order.id);
      if (completed) expired.push(completed);
    }
    const remaining = this.snapshot.restingOrders.filter((order) =>
      isLiveRestingState(order.state),
    );
    const groups = new Map<string, RestingPackageOrder[]>();
    for (const order of remaining) {
      const key = `${order.marketId}::${order.routeId}`;
      const list = groups.get(key);
      if (list) list.push(order);
      else groups.set(key, [order]);
    }
    const sortedKeys = [...groups.keys()].sort();
    const remainingLotsByRoute = new Map<string, number>();
    const filled: RestingPackageOrder[] = [];
    for (const key of sortedKeys) {
      const list = (groups.get(key) ?? []).slice();
      list.sort((left, right) => {
        const leftAction =
          isPackageSide(left.packageSide) && (left.side === "ENTER" || left.side === "EXIT")
            ? executableAction(left.side, left.packageSide)
            : null;
        const rightAction =
          isPackageSide(right.packageSide) && (right.side === "ENTER" || right.side === "EXIT")
            ? executableAction(right.side, right.packageSide)
            : null;
        if (leftAction && rightAction && leftAction === rightAction) {
          if (leftAction === "BUY") {
            if (Math.abs(right.limitPrice - left.limitPrice) > RESTING_TOL) {
              return right.limitPrice - left.limitPrice;
            }
          } else if (Math.abs(left.limitPrice - right.limitPrice) > RESTING_TOL) {
            return left.limitPrice - right.limitPrice;
          }
        }
        const leftCreated = Date.parse(left.createdAt);
        const rightCreated = Date.parse(right.createdAt);
        if (Number.isFinite(leftCreated) && Number.isFinite(rightCreated) && leftCreated !== rightCreated) {
          return leftCreated - rightCreated;
        }
        return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
      });
      for (const order of list) {
        const completed = this.fillWorkingOrder(order.id, markets, remainingLotsByRoute);
        if (completed) filled.push(completed);
      }
    }
    return [...expired, ...filled];
  }

  private expireWorkingOrder(orderId: string): RestingPackageOrder | null {
    const order = this.snapshot.restingOrders.find((candidate) => candidate.id === orderId);
    if (!order || !isLiveRestingState(order.state)) return null;
    if (order.timeInForce !== "GTD") return null;
    if (typeof order.expiresAt !== "string") return null;
    const parsed = Date.parse(order.expiresAt);
    if (!Number.isFinite(parsed)) return null;
    if (parsed > Date.now()) return null;
    const expiredAt = new Date().toISOString();
    const expired: RestingPackageOrder = {
      ...order,
      state: "EXPIRED",
      expiredAt,
      remainingCollateralReservation: 0,
      remainingFeeCap: 0,
    };
    const nextOrders = this.snapshot.restingOrders.map((candidate) =>
      candidate.id === orderId ? expired : candidate,
    );
    let account: GatewayAccount;
    try {
      account = buildCoherentAccount(
        this.snapshot.account,
        this.snapshot.account.posted,
        this.snapshot.positions,
        nextOrders,
      );
    } catch {
      return null;
    }
    this.publish({
      ...this.snapshot,
      account,
      restingOrders: nextOrders,
    });
    return expired;
  }

  private fillWorkingOrder(
    orderId: string,
    markets: readonly PackageMarket[],
    remainingLotsByRoute: Map<string, number>,
  ): RestingPackageOrder | null {
    const order = this.snapshot.restingOrders.find((candidate) => candidate.id === orderId);
    if (!order || !isLiveRestingState(order.state)) return null;
    if (order.timeInForce !== "GTC" && order.timeInForce !== "GTD") return null;
    if (order.timeInForce === "GTD") {
      if (typeof order.expiresAt !== "string") return null;
      const parsed = Date.parse(order.expiresAt);
      if (!Number.isFinite(parsed) || parsed <= Date.now()) return null;
    } else if (order.expiresAt !== null && order.expiresAt !== undefined) {
      return null;
    }
    if (order.orderType !== undefined && order.orderType !== "LIMIT") return null;
    if (!Number.isFinite(order.lots) || order.lots <= 0) return null;
    if (!Number.isFinite(order.limitPrice)) return null;
    const market = markets.find((candidate) => candidate.id === order.marketId);
    if (!market) return null;
    if (market.qualification === "SUSPENDED") return null;
    const route = market.routes.find((candidate) => candidate.id === order.routeId);
    if (!route) return null;
    const capacityKey = `${order.marketId}::${order.routeId}`;
    let routeRemaining = remainingLotsByRoute.get(capacityKey);
    if (routeRemaining === undefined) {
      routeRemaining = route.availableLots;
      remainingLotsByRoute.set(capacityKey, routeRemaining);
    }
    if (!Number.isFinite(routeRemaining) || routeRemaining <= RESTING_TOL) return null;
    const orderRemaining = restingRemainingLots(order);
    if (!Number.isFinite(orderRemaining) || orderRemaining <= RESTING_TOL) return null;
    if (orderRemaining - order.lots > RESTING_TOL) return null;
    if (!isPackageSide(order.packageSide)) return null;
    const action = executableAction(order.side, order.packageSide);
    const fillPrice = routePrice(route, action);
    if (!Number.isFinite(fillPrice)) return null;
    if (!limitCrosses(order.limitPrice, fillPrice, action)) return null;
    const contractMultiplier = order.contractMultiplier ?? market.contractMultiplier;
    if (!Number.isFinite(contractMultiplier) || contractMultiplier <= 0) return null;
    if (!Number.isFinite(order.feeCap) || order.feeCap < 0) return null;
    const settlementGuarantee =
      order.settlementGuarantee ?? GUARANTEE_COPY[route.guarantee]?.label ?? null;
    if (!settlementGuarantee) return null;
    let trancheLots = Math.min(orderRemaining, routeRemaining);
    if (order.side === "EXIT") {
      const target = this.snapshot.positions.find(
        (position) => position.id === order.closePositionId,
      );
      if (!target) return null;
      if (!Number.isFinite(target.lots) || target.lots <= RESTING_TOL) return null;
      trancheLots = Math.min(trancheLots, target.lots);
    }
    if (!Number.isFinite(trancheLots) || trancheLots <= RESTING_TOL) return null;
    if (trancheLots - orderRemaining > RESTING_TOL) return null;
    if (trancheLots - order.lots > RESTING_TOL) return null;
    if (order.side === "ENTER") {
      const completed = this.fillWorkingEntry(
        order,
        trancheLots,
        fillPrice,
        contractMultiplier,
        settlementGuarantee,
      );
      if (completed) {
        remainingLotsByRoute.set(capacityKey, Math.max(0, routeRemaining - completed.trancheLots));
        return completed.order;
      }
      return null;
    }
    const completedExit = this.fillWorkingExit(
      order,
      market,
      trancheLots,
      fillPrice,
      contractMultiplier,
      settlementGuarantee,
    );
    if (completedExit) {
      remainingLotsByRoute.set(capacityKey, Math.max(0, routeRemaining - completedExit.trancheLots));
      return completedExit.order;
    }
    return null;
  }

  private fillWorkingEntry(
    order: RestingPackageOrder,
    trancheLots: number,
    fillPrice: number,
    contractMultiplier: number,
    settlementGuarantee: string,
  ): { order: RestingPackageOrder; trancheLots: number } | null {
    void contractMultiplier;
    if (order.closePositionId != null) return null;
    if (!isPackageSide(order.packageSide)) return null;
    const filledSoFar =
      typeof order.filledLots === "number" && Number.isFinite(order.filledLots) ? order.filledLots : 0;
    const orderRemaining = restingRemainingLots(order);
    const remainingRes = restingRemainingReservation(order);
    const remainingFee = restingRemainingFee(order);
    if (!Number.isFinite(orderRemaining) || orderRemaining <= RESTING_TOL) return null;
    if (!Number.isFinite(trancheLots) || trancheLots <= RESTING_TOL) return null;
    if (trancheLots - orderRemaining > RESTING_TOL) return null;
    if (trancheLots - order.lots > RESTING_TOL) return null;
    const isFinal = trancheLots >= orderRemaining - RESTING_TOL;
    const executedLots = isFinal ? orderRemaining : trancheLots;
    const split = splitTrancheAmounts(remainingRes, remainingFee, executedLots, orderRemaining, isFinal);
    if (!split) return null;
    if (!Number.isFinite(split.trancheFee) || split.trancheFee < 0) return null;
    if (!Number.isFinite(split.trancheCollateral) || split.trancheCollateral < 0) return null;
    if (split.trancheFee - remainingFee > RESTING_TOL) return null;
    if (split.trancheFee + split.trancheCollateral - remainingRes > RESTING_TOL) return null;
    const newFilled = isFinal ? order.lots : filledSoFar + executedLots;
    const newRemaining = isFinal ? 0 : Math.max(0, orderRemaining - executedLots);
    const trancheFee = toCents(split.trancheFee);
    const trancheCollateral = toCents(split.trancheCollateral);
    if (trancheFee < 0 || trancheCollateral < 0) return null;
    const newRemainingFee = isFinal ? 0 : toCents(Math.max(0, remainingFee - trancheFee));
    const newRemainingRes = isFinal
      ? 0
      : toCents(Math.max(0, remainingRes - trancheFee - trancheCollateral));
    if (Math.abs(newFilled + newRemaining - order.lots) > RESTING_TOL) return null;
    const now = new Date().toISOString();
    const fillId = identifier("FIL");
    const receiptId = identifier("RCP");
    const transactionHash = digest(`${order.orderHash}:${fillId}:transaction`);
    const receipt: ExecutionReceipt = {
      id: receiptId,
      orderHash: order.orderHash,
      fillId,
      transactionHash,
      marketId: order.marketId,
      packageCode: order.packageCode,
      packageSide: order.packageSide,
      routeLabel: order.routeLabel,
      lots: executedLots,
      requestedLots: executedLots,
      filledLots: executedLots,
      cancelledLots: 0,
      price: fillPrice,
      fees: trancheFee,
      realizedPnlUsd: 0,
      collateralReleasedUsd: 0,
      guarantee: settlementGuarantee,
      evidence: this.snapshot.environment.evidence,
      createdAt: now,
    };
    const position: ExecutionPosition = {
      id: identifier("STR"),
      marketId: order.marketId,
      side: order.packageSide,
      lots: executedLots,
      entryPrice: fillPrice,
      collateral: trancheCollateral,
      state: "ACTIVE",
      createdAt: now,
    };
    const journal: SubmissionUpdate[] = [
      { step: "AUTHORIZED", label: "Authorized", detail: "Package authorization is bound to the selected account and route." },
      { step: "SUBMITTED", label: "Submitted", detail: "Authorization accepted by the demo clearing runtime." },
      { step: "INCLUDED", label: "Included", detail: "Package execution was included as one clearing result.", transactionHash },
      { step: "FILLED", label: "Filled", detail: `${executedLots} package lots filled at the selected route price.` },
      { step: "POSITION_CREATED", label: "Position created", detail: "Collateral reservation and package position were recorded together." },
      { step: "RECEIPT_READY", label: "Receipt ready", detail: "Execution evidence is available for inspection." },
    ];
    const result: PackageExecutionResult = {
      fillId,
      outcome: "OPENED",
      requestedLots: executedLots,
      filledLots: executedLots,
      cancelledLots: 0,
      position,
      closedPositionId: null,
      closedLots: 0,
      receipt,
    };
    const updated: RestingPackageOrder = {
      ...order,
      state: isFinal ? "FILLED" : "PARTIALLY_FILLED",
      filledLots: newFilled,
      remainingLots: newRemaining,
      remainingCollateralReservation: newRemainingRes,
      remainingFeeCap: newRemainingFee,
      fillIds: [...(order.fillIds ?? []), fillId],
      receiptIds: [...(order.receiptIds ?? []), receiptId],
      filledAt: now,
      fillId,
      receiptId,
    };
    const nextPositions = [position, ...this.snapshot.positions];
    const nextOrders = this.snapshot.restingOrders.map((candidate) =>
      candidate.id === order.id ? updated : candidate,
    );
    let account: GatewayAccount;
    try {
      account = buildCoherentAccount(
        this.snapshot.account,
        toCents(this.snapshot.account.posted - trancheFee),
        nextPositions,
        nextOrders,
      );
    } catch {
      return null;
    }
    this.publish({
      ...this.snapshot,
      account,
      positions: nextPositions,
      receipts: [receipt, ...this.snapshot.receipts],
      executions: [
        {
          id: identifier("EXE"),
          orderHash: order.orderHash,
          updates: journal,
          result,
          createdAt: now,
        },
        ...this.snapshot.executions,
      ],
      restingOrders: nextOrders,
    });
    return { order: updated, trancheLots: executedLots };
  }

  private fillWorkingExit(
    order: RestingPackageOrder,
    market: PackageMarket,
    trancheLots: number,
    fillPrice: number,
    contractMultiplier: number,
    settlementGuarantee: string,
  ): { order: RestingPackageOrder; trancheLots: number } | null {
    void market;
    if (!order.closePositionId) return null;
    if (!isPackageSide(order.packageSide)) return null;
    if (order.collateralRequired !== undefined && order.collateralRequired !== 0) return null;
    const target = this.snapshot.positions.find(
      (position) => position.id === order.closePositionId,
    );
    if (!target) return null;
    if (target.marketId !== order.marketId) return null;
    if (order.packageSide !== target.side) return null;
    if (!Number.isFinite(order.lots) || order.lots <= 0) return null;
    const filledSoFar =
      typeof order.filledLots === "number" && Number.isFinite(order.filledLots) ? order.filledLots : 0;
    const orderRemaining = restingRemainingLots(order);
    const remainingFee = restingRemainingFee(order);
    if (!Number.isFinite(orderRemaining) || orderRemaining <= RESTING_TOL) return null;
    if (!Number.isFinite(trancheLots) || trancheLots <= RESTING_TOL) return null;
    if (trancheLots - orderRemaining > RESTING_TOL) return null;
    if (trancheLots - order.lots > RESTING_TOL) return null;
    if (!Number.isFinite(target.lots) || target.lots <= RESTING_TOL) return null;
    if (trancheLots - target.lots > RESTING_TOL) return null;
    const isFinal = trancheLots >= orderRemaining - RESTING_TOL;
    const executedLots = isFinal ? Math.min(orderRemaining, target.lots) : trancheLots;
    if (executedLots <= RESTING_TOL) return null;
    const orderFinal = executedLots >= orderRemaining - RESTING_TOL;
    const split = splitTrancheAmounts(0, remainingFee, executedLots, orderRemaining, orderFinal);
    if (!split) return null;
    const rawTrancheFee = split.trancheFee;
    if (!Number.isFinite(rawTrancheFee) || rawTrancheFee < 0) return null;
    if (rawTrancheFee - remainingFee > RESTING_TOL) return null;
    const trancheFee = toCents(rawTrancheFee);
    const release = toCents(target.lots > 0 ? (target.collateral * executedLots) / target.lots : 0);
    const direction = target.side === "SHORT" ? -1 : 1;
    const realizedPnl = toCents(
      (fillPrice - target.entryPrice) * executedLots * contractMultiplier * direction,
    );
    if (!Number.isFinite(release) || !Number.isFinite(realizedPnl)) return null;
    const positionClosed = executedLots >= target.lots - RESTING_TOL;
    const targetRemainingLots = positionClosed ? 0 : target.lots - executedLots;
    const remainingCollateral = toCents(Math.max(0, target.collateral - release));
    const updatedPosition =
      positionClosed || targetRemainingLots <= RESTING_TOL
        ? null
        : {
            ...target,
            lots: targetRemainingLots,
            collateral: remainingCollateral,
          };
    const newFilled = orderFinal ? order.lots : filledSoFar + executedLots;
    const newRemaining = orderFinal ? 0 : Math.max(0, orderRemaining - executedLots);
    const newRemainingFee = orderFinal ? 0 : toCents(Math.max(0, remainingFee - trancheFee));
    if (Math.abs(newFilled + newRemaining - order.lots) > RESTING_TOL) return null;
    const now = new Date().toISOString();
    const fillId = identifier("FIL");
    const receiptId = identifier("RCP");
    const transactionHash = digest(`${order.orderHash}:${fillId}:transaction`);
    const receipt: ExecutionReceipt = {
      id: receiptId,
      orderHash: order.orderHash,
      fillId,
      transactionHash,
      marketId: order.marketId,
      packageCode: order.packageCode,
      packageSide: order.packageSide,
      routeLabel: order.routeLabel,
      lots: executedLots,
      requestedLots: executedLots,
      filledLots: executedLots,
      cancelledLots: 0,
      price: fillPrice,
      fees: trancheFee,
      realizedPnlUsd: realizedPnl,
      collateralReleasedUsd: release,
      guarantee: settlementGuarantee,
      evidence: this.snapshot.environment.evidence,
      createdAt: now,
    };
    const positionStep: SubmissionUpdate =
      updatedPosition === null
        ? {
            step: "POSITION_CLOSED",
            label: "Position closed",
            detail: `Closed ${executedLots} lots; the local demo account recorded the $${realizedPnl.toFixed(2)} package result and released $${release.toFixed(2)} collateral.`,
          }
        : {
            step: "POSITION_UPDATED",
            label: "Position reduced",
            detail: `Closed ${executedLots} lots pro rata; the local demo account recorded the $${realizedPnl.toFixed(2)} package result and the remaining package position stays active.`,
          };
    const journal: SubmissionUpdate[] = [
      { step: "AUTHORIZED", label: "Authorized", detail: "Package authorization is bound to the selected account and route." },
      { step: "SUBMITTED", label: "Submitted", detail: "Authorization accepted by the demo clearing runtime." },
      { step: "INCLUDED", label: "Included", detail: "Package execution was included as one clearing result.", transactionHash },
      { step: "FILLED", label: "Filled", detail: `${executedLots} package lots closed at the selected route price.` },
      positionStep,
      { step: "RECEIPT_READY", label: "Receipt ready", detail: "Execution evidence is available for inspection." },
    ];
    const result: PackageExecutionResult = {
      fillId,
      outcome: updatedPosition === null ? "CLOSED" : "REDUCED",
      requestedLots: executedLots,
      filledLots: executedLots,
      cancelledLots: 0,
      position: updatedPosition,
      closedPositionId: target.id,
      closedLots: executedLots,
      receipt,
    };
    const updated: RestingPackageOrder = {
      ...order,
      state: orderFinal ? "FILLED" : "PARTIALLY_FILLED",
      filledLots: newFilled,
      remainingLots: newRemaining,
      remainingCollateralReservation: 0,
      remainingFeeCap: newRemainingFee,
      fillIds: [...(order.fillIds ?? []), fillId],
      receiptIds: [...(order.receiptIds ?? []), receiptId],
      filledAt: now,
      fillId,
      receiptId,
    };
    const execution: GatewayExecution = {
      id: identifier("EXE"),
      orderHash: order.orderHash,
      updates: journal,
      result,
      createdAt: now,
    };
    const nextPositions =
      updatedPosition === null
        ? this.snapshot.positions.filter((position) => position.id !== target.id)
        : this.snapshot.positions.map((position) =>
            position.id === target.id ? updatedPosition : position,
          );
    const nextOrders = this.snapshot.restingOrders.map((candidate) =>
      candidate.id === order.id ? updated : candidate,
    );
    let account: GatewayAccount;
    try {
      account = buildCoherentAccount(
        this.snapshot.account,
        toCents(this.snapshot.account.posted + realizedPnl - trancheFee),
        nextPositions,
        nextOrders,
      );
    } catch {
      return null;
    }
    this.publish({
      ...this.snapshot,
      account,
      positions: nextPositions,
      receipts: [receipt, ...this.snapshot.receipts],
      executions: [execution, ...this.snapshot.executions],
      restingOrders: nextOrders,
    });
    return { order: updated, trancheLots: executedLots };
  }

  async requestRfq(authorization: SignedOrderAuthorization): Promise<RfqRequest> {
    this.assertWritableEnvironment();
    if ((authorization.intent as { replacesOrderId?: unknown }).replacesOrderId != null) {
      throw new Error("REPLACE_FLOW_REQUIRED");
    }
    if (
      !Number.isFinite(authorization.intent.contractMultiplier) ||
      authorization.intent.contractMultiplier <= 0
    ) {
      throw new Error("INVALID_CONTRACT_MULTIPLIER");
    }
    if (authorization.signer !== this.snapshot.wallet.address) throw new Error("SIGNER_MISMATCH");
    if (Date.parse(authorization.deadline) <= Date.now()) throw new Error("AUTHORIZATION_EXPIRED");
    const intent = authorization.intent;
    if (!isPackageSide(intent.packageSide)) throw new Error("INVALID_PACKAGE_SIDE");
    validateFillLots(intent, true);
    if (intent.timeInForce === "GTD") {
      throw new Error("EXPIRY_FORBIDDEN");
    }
    if ((intent as { expiresAt?: unknown }).expiresAt !== null) {
      throw new Error("EXPIRY_FORBIDDEN");
    }
    if (intent.disclosure !== "PRIVATE_RFQ") {
      throw new Error("RFQ_REQUIRES_PRIVATE_DISCLOSURE");
    }
    if (intent.routeId !== "SOLVER_RFQ") {
      throw new Error("RFQ_REQUIRES_SOLVER_ROUTE");
    }
    const expiresAt = new Date(Date.now() + 300_000).toISOString();
    const createdAt = new Date().toISOString();
    const requestId = identifier("RFQ");
    const action = executableAction(intent.side, intent.packageSide);
    const northstarPrice = intent.limitPrice;
    const meridianPrice =
      action === "BUY"
        ? Math.min(intent.limitPrice, intent.limitPrice * 0.999)
        : Math.max(intent.limitPrice, intent.limitPrice * 1.001);
    const northstarFeeCap = intent.feeCap;
    const meridianFeeCap = Math.max(0, intent.feeCap * 0.9);
    const quotes: FirmRfqQuote[] = [
      {
        id: identifier("QTE"),
        solverLabel: "Northstar Solver",
        capacityLots: intent.lots,
        packagePrice: northstarPrice,
        feeCap: northstarFeeCap,
        settlementGuarantee: intent.settlementGuarantee,
        expiresAt,
        provenance: "SEEDED_SOLVER",
      },
      {
        id: identifier("QTE"),
        solverLabel: "Meridian Solver",
        capacityLots: intent.lots,
        packagePrice: meridianPrice,
        feeCap: meridianFeeCap,
        settlementGuarantee: intent.settlementGuarantee,
        expiresAt,
        provenance: "SEEDED_SOLVER",
      },
    ];
    const request: RfqRequest = {
      id: requestId,
      authorization,
      state: "OPEN",
      selectedQuoteId: null,
      receiptId: null,
      expiresAt,
      createdAt,
      quotes,
    };
    const existingRequests = Array.isArray(this.snapshot.rfqRequests)
      ? this.snapshot.rfqRequests
      : [];
    this.publish({
      ...this.snapshot,
      rfqRequests: [request, ...existingRequests],
    });
    return request;
  }

  async selectRfqQuote(requestId: string, quoteId: string): Promise<RfqRequest> {
    this.assertWritableEnvironment();
    const existingRequests = Array.isArray(this.snapshot.rfqRequests)
      ? this.snapshot.rfqRequests
      : [];
    const target = existingRequests.find((request) => request.id === requestId);
    if (!target) throw new Error("RFQ_NOT_FOUND");
    if (target.state !== "OPEN") throw new Error("RFQ_NOT_OPEN");
    const quote = target.quotes.find((candidate) => candidate.id === quoteId);
    if (!quote) throw new Error("RFQ_QUOTE_NOT_FOUND");
    if (Date.parse(target.expiresAt) <= Date.now() || Date.parse(quote.expiresAt) <= Date.now()) {
      throw new Error("RFQ_EXPIRED");
    }
    if (quote.capacityLots + 1e-9 < target.authorization.intent.lots) {
      throw new Error("RFQ_CAPACITY_EXCEEDED");
    }
    const selected: RfqRequest = {
      ...target,
      state: "SELECTED",
      selectedQuoteId: quote.id,
      receiptId: null,
    };
    this.publish({
      ...this.snapshot,
      rfqRequests: existingRequests.map((request) =>
        request.id === requestId ? selected : request,
      ),
    });
    return selected;
  }

  async cancelRfq(requestId: string): Promise<RfqRequest> {
    this.assertWritableEnvironment();
    const existingRequests = Array.isArray(this.snapshot.rfqRequests)
      ? this.snapshot.rfqRequests
      : [];
    const target = existingRequests.find((request) => request.id === requestId);
    if (!target) throw new Error("RFQ_NOT_FOUND");
    if (target.state !== "OPEN" && target.state !== "SELECTED") throw new Error("RFQ_NOT_OPEN");
    const cancelled: RfqRequest = {
      ...target,
      state: "CANCELLED",
      selectedQuoteId: null,
      receiptId: null,
    };
    this.publish({
      ...this.snapshot,
      rfqRequests: existingRequests.map((request) =>
        request.id === requestId ? cancelled : request,
      ),
    });
    return cancelled;
  }

  async completeRfq(requestId: string, receiptId: string): Promise<RfqRequest> {
    this.assertWritableEnvironment();
    const existingRequests = Array.isArray(this.snapshot.rfqRequests)
      ? this.snapshot.rfqRequests
      : [];
    const target = existingRequests.find((request) => request.id === requestId);
    if (!target) throw new Error("RFQ_NOT_FOUND");
    if (target.state !== "SELECTED") throw new Error("RFQ_NOT_SELECTED");
    if (typeof receiptId !== "string" || receiptId.length === 0) {
      throw new Error("RFQ_RECEIPT_REQUIRED");
    }
    const receipt = this.snapshot.receipts.find((candidate) => candidate.id === receiptId);
    if (!receipt) throw new Error("RFQ_RECEIPT_NOT_FOUND");
    if (receipt.marketId !== target.authorization.intent.marketId) {
      throw new Error("RFQ_RECEIPT_MARKET_MISMATCH");
    }
    const completed: RfqRequest = { ...target, state: "EXECUTED", receiptId };
    this.publish({
      ...this.snapshot,
      rfqRequests: existingRequests.map((request) =>
        request.id === requestId ? completed : request,
      ),
    });
    return completed;
  }

  async submitLocalMakerQuote(
    requestId: string,
    input: LocalMakerQuoteInput,
  ): Promise<RfqRequest> {
    this.assertWritableEnvironment();
    const existingRequests = Array.isArray(this.snapshot.rfqRequests)
      ? this.snapshot.rfqRequests
      : [];
    const target = existingRequests.find((request) => request.id === requestId);
    if (!target) throw new Error("RFQ_NOT_FOUND");
    if (target.state !== "OPEN") throw new Error("RFQ_NOT_OPEN");
    if (Date.parse(target.expiresAt) <= Date.now()) throw new Error("RFQ_EXPIRED");
    if (!Number.isFinite(input.packagePrice) || input.packagePrice <= 0) {
      throw new Error("INVALID_PACKAGE_PRICE");
    }
    if (!Number.isFinite(input.feeCap) || input.feeCap < 0) {
      throw new Error("INVALID_FEE_CAP");
    }
    if (!Number.isFinite(input.capacityLots) || input.capacityLots <= 0) {
      throw new Error("INVALID_CAPACITY");
    }
    if (!Number.isFinite(input.ttlSeconds) || input.ttlSeconds < 5 || input.ttlSeconds > 45) {
      throw new Error("INVALID_TTL");
    }
    const settlementGuarantee = target.authorization.intent.settlementGuarantee;
    if (typeof settlementGuarantee !== "string" || settlementGuarantee.length === 0) {
      throw new Error("RFQ_GUARANTEE_MISSING");
    }
    const ttlExpiresAt = Date.now() + Math.floor(input.ttlSeconds * 1000);
    const requestExpiresAt = Date.parse(target.expiresAt);
    const quoteExpiresAt = new Date(Math.min(ttlExpiresAt, requestExpiresAt)).toISOString();
    const quote: FirmRfqQuote = {
      id: identifier("QTE"),
      solverLabel: "Local demo maker",
      packagePrice: input.packagePrice,
      feeCap: input.feeCap,
      capacityLots: input.capacityLots,
      expiresAt: quoteExpiresAt,
      settlementGuarantee,
      provenance: "LOCAL_DEMO",
    };
    const seeded = target.quotes.filter((candidate) => {
      const provenance = (candidate as Partial<FirmRfqQuote>).provenance;
      return provenance !== "LOCAL_DEMO";
    });
    const normalizedSeeded = seeded.map((candidate) => {
      if (candidate.provenance === "SEEDED_SOLVER" || candidate.provenance === "LOCAL_DEMO") {
        return candidate;
      }
      return { ...candidate, provenance: "SEEDED_SOLVER" as RfqQuoteProvenance };
    });
    const updated: RfqRequest = {
      ...target,
      quotes: [...normalizedSeeded, quote],
    };
    this.publish({
      ...this.snapshot,
      rfqRequests: existingRequests.map((request) =>
        request.id === requestId ? updated : request,
      ),
    });
    return updated;
  }

  async withdrawLocalMakerQuote(requestId: string): Promise<RfqRequest> {
    this.assertWritableEnvironment();
    const existingRequests = Array.isArray(this.snapshot.rfqRequests)
      ? this.snapshot.rfqRequests
      : [];
    const target = existingRequests.find((request) => request.id === requestId);
    if (!target) throw new Error("RFQ_NOT_FOUND");
    if (target.state !== "OPEN") throw new Error("RFQ_NOT_OPEN");
    if (Date.parse(target.expiresAt) <= Date.now()) throw new Error("RFQ_EXPIRED");
    const owned = target.quotes.filter((candidate) => candidate.provenance === "LOCAL_DEMO");
    const legacyOwned =
      owned.length > 0
        ? owned
        : target.quotes.filter(
            (candidate) =>
              candidate.solverLabel === "Local demo maker" &&
              (candidate as Partial<FirmRfqQuote>).provenance === undefined,
          );
    if (legacyOwned.length === 0) throw new Error("RFQ_QUOTE_NOT_FOUND");
    const ownedIds = new Set(legacyOwned.map((candidate) => candidate.id));
    const updated: RfqRequest = {
      ...target,
      quotes: target.quotes.filter((candidate) => !ownedIds.has(candidate.id)),
    };
    this.publish({
      ...this.snapshot,
      rfqRequests: existingRequests.map((request) =>
        request.id === requestId ? updated : request,
      ),
    });
    return updated;
  }

  getReceipt(receiptId: string) {
    return this.snapshot.receipts.find((receipt) => receipt.id === receiptId) ?? null;
  }
}
