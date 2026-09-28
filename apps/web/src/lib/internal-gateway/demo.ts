import type {
  CollateralIntent,
  CollateralIntentResult,
  ExecutionPosition,
  ExecutionReceipt,
  FirmRfqQuote,
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
      eligible: 351_080,
      reserved: 305_560,
      available: 45_520,
      equity: 386_240,
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
      if (rawSide === undefined) {
        receipts.push({ ...(candidate as ExecutionReceipt), packageSide: "LONG" });
        continue;
      }
      if (!isPackageSide(rawSide)) continue;
      receipts.push({ ...(candidate as ExecutionReceipt), packageSide: rawSide });
    }
    const rawRestingOrders = (snapshot as { restingOrders?: unknown }).restingOrders;
    const restingOrders: RestingPackageOrder[] = Array.isArray(rawRestingOrders)
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
              typeof candidate.limitPrice !== "number" ||
              candidate.timeInForce !== "GTC" ||
              typeof candidate.collateralReservation !== "number" ||
              typeof candidate.feeCap !== "number" ||
              (candidate.closePositionId !== null &&
                typeof candidate.closePositionId !== "string") ||
              typeof candidate.createdAt !== "string"
            ) {
              return false;
            }
            if (candidate.packageSide !== undefined && !isPackageSide(candidate.packageSide)) {
              return false;
            }
          if (
            candidate.state !== "WORKING" &&
            candidate.state !== "CANCELLED" &&
            candidate.state !== "FILLED"
          ) {
            return false;
          }
          if (
            candidate.orderType !== undefined &&
            candidate.orderType !== "LIMIT" &&
            candidate.orderType !== "MARKET"
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
          if (candidate.state === "FILLED") {
            return (
              typeof candidate.filledAt === "string" &&
              Number.isFinite(Date.parse(candidate.filledAt)) &&
              typeof candidate.fillId === "string" &&
              candidate.fillId.length > 0 &&
              typeof candidate.receiptId === "string" &&
              candidate.receiptId.length > 0
            );
          }
          return true;
        })
          .map((order) => {
            const typed = order as RestingPackageOrder & { packageSide?: unknown };
            if (typed.packageSide === undefined) return { ...typed, packageSide: "LONG" as const };
            return typed as RestingPackageOrder;
          })
      : [];
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
      if (receiptCandidate.packageSide === undefined) {
        normalized = {
          ...(normalized as PackageExecutionResult),
          receipt: { ...(receiptCandidate as ExecutionReceipt), packageSide: "LONG" as const },
        };
      } else if (!isPackageSide(receiptCandidate.packageSide)) {
        continue;
      }
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
          };
          if (intentCandidate.packageSide !== undefined && !isPackageSide(intentCandidate.packageSide)) {
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
          const migratedIntent =
            intent.packageSide === undefined
              ? { ...intent, packageSide: "LONG" as const }
              : intent;
          return {
            ...typed,
            authorization: { ...typed.authorization, intent: migratedIntent },
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
    return {
      ...snapshot,
      wallet: { status: "DISCONNECTED", address: null, chainId: null },
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
    if (intent.kind === "WITHDRAW" && intent.amount > this.snapshot.account.available) {
      throw new Error("INSUFFICIENT_AVAILABLE_COLLATERAL");
    }
    await wait(450);
    const direction = intent.kind === "DEPOSIT" ? 1 : -1;
    const account = this.snapshot.account;
    this.publish({
      ...this.snapshot,
      account: {
        ...account,
        posted: account.posted + direction * intent.amount,
        eligible: account.eligible + direction * intent.amount,
        available: account.available + direction * intent.amount,
        equity: account.equity + direction * intent.amount,
      },
    });
    return { intentId: identifier("COL"), kind: intent.kind, amount: intent.amount, status: "COMPLETED" };
  }

  async authorizeOrder(intent: PackageOrderIntent): Promise<SignedOrderAuthorization> {
    this.assertWritableEnvironment();
    if (!Number.isFinite(intent.contractMultiplier) || intent.contractMultiplier <= 0) {
      throw new Error("INVALID_CONTRACT_MULTIPLIER");
    }
    if (!isPackageSide(intent.packageSide)) throw new Error("INVALID_PACKAGE_SIDE");
    const signer = this.snapshot.wallet.address;
    if (!signer || this.snapshot.wallet.status !== "CONNECTED") throw new Error("CONNECT_WALLET");
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
      const releasable =
        target.lots > 0 ? (target.collateral * intent.lots) / target.lots : 0;
      const multiplier = intent.contractMultiplier;
      const direction = target.side === "SHORT" ? -1 : 1;
      const realizedPnl =
        (intent.executionPrice - target.entryPrice) * intent.lots * multiplier * direction;
      const closeResult = releasable + realizedPnl - intent.feeCap;
      if (this.snapshot.account.available + closeResult < -1e-9) {
        throw new Error("INSUFFICIENT_AVAILABLE_COLLATERAL");
      }
    } else if (intent.collateralRequired + intent.feeCap > this.snapshot.account.available) {
      throw new Error("INSUFFICIENT_AVAILABLE_COLLATERAL");
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

  async submitAuthorizedOrder(
    authorization: SignedOrderAuthorization,
    onUpdate: (update: SubmissionUpdate) => void,
  ): Promise<PackageExecutionResult> {
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
    if (!isPackageSide(intent.packageSide)) throw new Error("INVALID_PACKAGE_SIDE");
    const isExit = intent.side === "EXIT";
    if (!isExit && intent.closePositionId != null) {
      throw new Error("CLOSE_POSITION_FORBIDDEN_FOR_ENTRY");
    }

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
      exitCloseLots = intent.lots;
      exitRelease = target.lots > 0 ? (target.collateral * intent.lots) / target.lots : 0;
      const multiplier = intent.contractMultiplier;
      const direction = target.side === "SHORT" ? -1 : 1;
      exitRealizedPnl =
        (intent.executionPrice - target.entryPrice) * intent.lots * multiplier * direction;
      exitIsFull = intent.lots >= target.lots - 1e-9;
      const closeResult = exitRelease + exitRealizedPnl - intent.feeCap;
      if (this.snapshot.account.available + closeResult < -1e-9) {
        throw new Error("INSUFFICIENT_AVAILABLE_COLLATERAL");
      }
    }

    const transactionHash = digest(`${authorization.orderHash}:transaction`);
    const positionStep: SubmissionUpdate = isExit
      ? exitIsFull
        ? {
            step: "POSITION_CLOSED",
            label: "Position closed",
            detail: `Closed ${intent.lots} lots; the local demo account recorded the $${exitRealizedPnl.toFixed(2)} package result and released $${exitRelease.toFixed(2)} collateral.`,
          }
        : {
            step: "POSITION_UPDATED",
            label: "Position reduced",
            detail: `Closed ${intent.lots} lots pro rata; the local demo account recorded the $${exitRealizedPnl.toFixed(2)} package result and the remaining package position stays active.`,
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
        detail: isExit
          ? `${intent.lots} package lots closed at the selected route price.`
          : `${intent.lots} package lots filled at the selected route price.`,
      },
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
    const receipt: ExecutionReceipt = {
      id: receiptId,
      orderHash: authorization.orderHash,
      fillId,
      transactionHash,
      marketId: intent.marketId,
      packageCode: intent.packageCode,
      packageSide: intent.packageSide,
      routeLabel: intent.routeLabel,
      lots: intent.lots,
      price: intent.executionPrice,
      fees: intent.feeCap,
      realizedPnlUsd: isExit ? exitRealizedPnl : 0,
      collateralReleasedUsd: isExit ? exitRelease : 0,
      guarantee: intent.settlementGuarantee,
      evidence: this.snapshot.environment.evidence,
      createdAt: new Date().toISOString(),
    };

    if (isExit) {
      const target = this.snapshot.positions.find((position) => position.id === exitTargetId);
      if (!target) throw new Error("POSITION_NOT_FOUND");
      const remainingLots = target.lots - exitCloseLots;
      const remainingCollateral = Math.max(0, target.collateral - exitRelease);
      const updatedPosition =
        exitIsFull || remainingLots <= 1e-9
          ? null
          : {
              ...target,
              lots: remainingLots,
              collateral: remainingCollateral,
            };
      const closeResult = exitRelease + exitRealizedPnl - intent.feeCap;
      const nextAvailable = this.snapshot.account.available + closeResult;
      if (nextAvailable < -1e-9) throw new Error("INSUFFICIENT_AVAILABLE_COLLATERAL");
      this.publish({
        ...this.snapshot,
        account: {
          ...this.snapshot.account,
          reserved: Math.max(0, this.snapshot.account.reserved - exitRelease),
          available: nextAvailable,
          eligible: this.snapshot.account.eligible + closeResult,
          equity: this.snapshot.account.equity + closeResult,
        },
        positions:
          updatedPosition === null
            ? this.snapshot.positions.filter((position) => position.id !== target.id)
            : this.snapshot.positions.map((position) =>
                position.id === target.id ? updatedPosition : position,
              ),
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
        outcome: updatedPosition === null ? "CLOSED" : "REDUCED",
        position: updatedPosition,
        closedPositionId: target.id,
        closedLots: exitCloseLots,
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

    const positionId = identifier("STR");
    const position: PackageExecutionResult["position"] = {
      id: positionId,
      marketId: intent.marketId,
      side: intent.packageSide,
      lots: intent.lots,
      entryPrice: intent.executionPrice,
      collateral: intent.collateralRequired,
      state: "ACTIVE" as const,
      createdAt: receipt.createdAt,
    };
    this.publish({
      ...this.snapshot,
      account: {
        ...this.snapshot.account,
        reserved:
          this.snapshot.account.reserved + intent.collateralRequired + intent.feeCap,
        available:
          this.snapshot.account.available - intent.collateralRequired - intent.feeCap,
      },
      positions: position ? [position, ...this.snapshot.positions] : [...this.snapshot.positions],
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
    if (
      !Number.isFinite(authorization.intent.contractMultiplier) ||
      authorization.intent.contractMultiplier <= 0
    ) {
      throw new Error("INVALID_CONTRACT_MULTIPLIER");
    }
    if (authorization.intent.orderType !== "LIMIT") {
      throw new Error("RESTING_ORDER_REQUIRES_LIMIT");
    }
    if (authorization.intent.timeInForce !== "GTC") {
      throw new Error("RESTING_ORDER_REQUIRES_GTC");
    }
    if (authorization.signer !== this.snapshot.wallet.address) throw new Error("SIGNER_MISMATCH");
    if (Date.parse(authorization.deadline) <= Date.now()) throw new Error("AUTHORIZATION_EXPIRED");
    const intent = authorization.intent;
    if (!isPackageSide(intent.packageSide)) throw new Error("INVALID_PACKAGE_SIDE");
    const isExit = intent.side === "EXIT";
    if (!isExit && intent.closePositionId != null) {
      throw new Error("CLOSE_POSITION_FORBIDDEN_FOR_ENTRY");
    }

    let reservation = 0;
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
    } else {
      if (intent.collateralRequired + intent.feeCap > this.snapshot.account.available) {
        throw new Error("INSUFFICIENT_AVAILABLE_COLLATERAL");
      }
      reservation = intent.collateralRequired + intent.feeCap;
    }

    const createdAt = new Date().toISOString();
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
      limitPrice: intent.limitPrice,
      timeInForce: intent.timeInForce,
      collateralReservation: reservation,
      feeCap: intent.feeCap,
      closePositionId: intent.closePositionId,
      createdAt,
      state: "WORKING",
      orderType: intent.orderType,
      contractMultiplier: intent.contractMultiplier,
      settlementGuarantee: intent.settlementGuarantee,
      disclosure: intent.disclosure,
      recipient: intent.recipient,
      collateralRequired: isExit ? 0 : intent.collateralRequired,
    };
    const existingOrders = Array.isArray(this.snapshot.restingOrders)
      ? this.snapshot.restingOrders
      : [];
    if (isExit) {
      this.publish({
        ...this.snapshot,
        restingOrders: [order, ...existingOrders],
      });
    } else {
      this.publish({
        ...this.snapshot,
        account: {
          ...this.snapshot.account,
          reserved: this.snapshot.account.reserved + reservation,
          available: this.snapshot.account.available - reservation,
        },
        restingOrders: [order, ...existingOrders],
      });
    }
    return order;
  }

  async cancelRestingOrder(orderId: string): Promise<RestingPackageOrder> {
    this.assertWritableEnvironment();
    const existingOrders = Array.isArray(this.snapshot.restingOrders)
      ? this.snapshot.restingOrders
      : [];
    const target = existingOrders.find((order) => order.id === orderId);
    if (!target) throw new Error("RESTING_ORDER_NOT_FOUND");
    if (target.state !== "WORKING") throw new Error("RESTING_ORDER_NOT_WORKING");
    const cancelledAt = new Date().toISOString();
    const cancelled: RestingPackageOrder = {
      ...target,
      state: "CANCELLED",
      cancelledAt,
    };
    const isExit = target.side === "EXIT";
    let account = this.snapshot.account;
    if (!isExit) {
      const reservation = target.collateralReservation;
      account = {
        ...account,
        reserved: Math.max(0, account.reserved - reservation),
        available: account.available + reservation,
      };
    }
    this.publish({
      ...this.snapshot,
      account,
      restingOrders: existingOrders.map((order) => (order.id === orderId ? cancelled : order)),
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
    const working = this.snapshot.restingOrders.filter((order) => order.state === "WORKING");
    if (working.length === 0) return [];
    const remainingLotsByRoute = new Map<string, number>();
    const filled: RestingPackageOrder[] = [];
    for (const order of working) {
      const completed = this.fillWorkingOrder(order.id, markets, remainingLotsByRoute);
      if (completed) filled.push(completed);
    }
    return filled;
  }

  private fillWorkingOrder(
    orderId: string,
    markets: readonly PackageMarket[],
    remainingLotsByRoute: Map<string, number>,
  ): RestingPackageOrder | null {
    const order = this.snapshot.restingOrders.find((candidate) => candidate.id === orderId);
    if (!order || order.state !== "WORKING") return null;
    if (order.timeInForce !== "GTC") return null;
    if (order.orderType !== undefined && order.orderType !== "LIMIT") return null;
    if (!Number.isFinite(order.lots) || order.lots <= 0) return null;
    if (!Number.isFinite(order.limitPrice)) return null;
    const market = markets.find((candidate) => candidate.id === order.marketId);
    if (!market) return null;
    if (market.qualification === "SUSPENDED") return null;
    const route = market.routes.find((candidate) => candidate.id === order.routeId);
    if (!route) return null;
    const capacityKey = `${order.marketId}::${order.routeId}`;
    let remainingLots = remainingLotsByRoute.get(capacityKey);
    if (remainingLots === undefined) {
      remainingLots = route.availableLots;
      remainingLotsByRoute.set(capacityKey, remainingLots);
    }
    if (order.lots - remainingLots > 1e-9) return null;
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
    if (order.side === "ENTER") {
      const completed = this.fillWorkingEntry(order, fillPrice, contractMultiplier, settlementGuarantee);
      if (completed) {
        remainingLotsByRoute.set(capacityKey, remainingLots - order.lots);
      }
      return completed;
    }
    const completedExit = this.fillWorkingExit(
      order,
      market,
      fillPrice,
      contractMultiplier,
      settlementGuarantee,
    );
    if (completedExit) {
      remainingLotsByRoute.set(capacityKey, remainingLots - order.lots);
    }
    return completedExit;
  }

  private fillWorkingEntry(
    order: RestingPackageOrder,
    fillPrice: number,
    contractMultiplier: number,
    settlementGuarantee: string,
  ): RestingPackageOrder | null {
    void contractMultiplier;
    if (order.closePositionId != null) return null;
    if (!isPackageSide(order.packageSide)) return null;
    const collateralRequired =
      order.collateralRequired ?? Math.max(0, order.collateralReservation - order.feeCap);
    if (!Number.isFinite(collateralRequired) || collateralRequired < 0) return null;
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
      lots: order.lots,
      price: fillPrice,
      fees: order.feeCap,
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
      lots: order.lots,
      entryPrice: fillPrice,
      collateral: collateralRequired,
      state: "ACTIVE",
      createdAt: now,
    };
    const journal: SubmissionUpdate[] = [
      { step: "AUTHORIZED", label: "Authorized", detail: "Package authorization is bound to the selected account and route." },
      { step: "SUBMITTED", label: "Submitted", detail: "Authorization accepted by the demo clearing runtime." },
      { step: "INCLUDED", label: "Included", detail: "Package execution was included as one clearing result.", transactionHash },
      { step: "FILLED", label: "Filled", detail: `${order.lots} package lots filled at the selected route price.` },
      { step: "POSITION_CREATED", label: "Position created", detail: "Collateral reservation and package position were recorded together." },
      { step: "RECEIPT_READY", label: "Receipt ready", detail: "Execution evidence is available for inspection." },
    ];
    const result: PackageExecutionResult = {
      fillId,
      outcome: "OPENED",
      position,
      closedPositionId: null,
      closedLots: 0,
      receipt,
    };
    const filled: RestingPackageOrder = {
      ...order,
      state: "FILLED",
      filledAt: now,
      fillId,
      receiptId,
    };
    this.publish({
      ...this.snapshot,
      positions: [position, ...this.snapshot.positions],
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
      restingOrders: this.snapshot.restingOrders.map((candidate) =>
        candidate.id === order.id ? filled : candidate,
      ),
    });
    return filled;
  }

  private fillWorkingExit(
    order: RestingPackageOrder,
    market: PackageMarket,
    fillPrice: number,
    contractMultiplier: number,
    settlementGuarantee: string,
  ): RestingPackageOrder | null {
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
    if (order.lots - target.lots > 1e-9) return null;
    const release = target.lots > 0 ? (target.collateral * order.lots) / target.lots : 0;
    const direction = target.side === "SHORT" ? -1 : 1;
    const realizedPnl =
      (fillPrice - target.entryPrice) * order.lots * contractMultiplier * direction;
    if (!Number.isFinite(release) || !Number.isFinite(realizedPnl)) return null;
    const closeResult = release + realizedPnl - order.feeCap;
    if (this.snapshot.account.available + closeResult < -1e-9) return null;
    const isFull = order.lots >= target.lots - 1e-9;
    const remainingLots = target.lots - order.lots;
    const remainingCollateral = Math.max(0, target.collateral - release);
    const updatedPosition =
      isFull || remainingLots <= 1e-9
        ? null
        : {
            ...target,
            lots: remainingLots,
            collateral: remainingCollateral,
          };
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
      lots: order.lots,
      price: fillPrice,
      fees: order.feeCap,
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
            detail: `Closed ${order.lots} lots; the local demo account recorded the $${realizedPnl.toFixed(2)} package result and released $${release.toFixed(2)} collateral.`,
          }
        : {
            step: "POSITION_UPDATED",
            label: "Position reduced",
            detail: `Closed ${order.lots} lots pro rata; the local demo account recorded the $${realizedPnl.toFixed(2)} package result and the remaining package position stays active.`,
          };
    const journal: SubmissionUpdate[] = [
      { step: "AUTHORIZED", label: "Authorized", detail: "Package authorization is bound to the selected account and route." },
      { step: "SUBMITTED", label: "Submitted", detail: "Authorization accepted by the demo clearing runtime." },
      { step: "INCLUDED", label: "Included", detail: "Package execution was included as one clearing result.", transactionHash },
      { step: "FILLED", label: "Filled", detail: `${order.lots} package lots closed at the selected route price.` },
      positionStep,
      { step: "RECEIPT_READY", label: "Receipt ready", detail: "Execution evidence is available for inspection." },
    ];
    const result: PackageExecutionResult = {
      fillId,
      outcome: updatedPosition === null ? "CLOSED" : "REDUCED",
      position: updatedPosition,
      closedPositionId: target.id,
      closedLots: order.lots,
      receipt,
    };
    const filled: RestingPackageOrder = {
      ...order,
      state: "FILLED",
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
    this.publish({
      ...this.snapshot,
      account: {
        ...this.snapshot.account,
        reserved: Math.max(0, this.snapshot.account.reserved - release),
        available: this.snapshot.account.available + closeResult,
        eligible: this.snapshot.account.eligible + closeResult,
        equity: this.snapshot.account.equity + closeResult,
      },
      positions:
        updatedPosition === null
          ? this.snapshot.positions.filter((position) => position.id !== target.id)
          : this.snapshot.positions.map((position) =>
              position.id === target.id ? updatedPosition : position,
            ),
      receipts: [receipt, ...this.snapshot.receipts],
      executions: [execution, ...this.snapshot.executions],
      restingOrders: this.snapshot.restingOrders.map((candidate) =>
        candidate.id === order.id ? filled : candidate,
      ),
    });
    return filled;
  }

  async requestRfq(authorization: SignedOrderAuthorization): Promise<RfqRequest> {
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
    if (!isPackageSide(intent.packageSide)) throw new Error("INVALID_PACKAGE_SIDE");
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
