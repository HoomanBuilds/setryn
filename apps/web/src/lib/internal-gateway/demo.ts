import type {
  CollateralIntent,
  CollateralIntentResult,
  ExecutionReceipt,
  FirmRfqQuote,
  GatewaySnapshot,
  InternalTradingGateway,
  PackageExecutionResult,
  PackageOrderIntent,
  RestingPackageOrder,
  RfqRequest,
  SignedOrderAuthorization,
  SubmissionUpdate,
} from "./types";

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
    const positions = Array.isArray(snapshot.positions) ? snapshot.positions : [];
    const rawRestingOrders = (snapshot as { restingOrders?: unknown }).restingOrders;
    const restingOrders: RestingPackageOrder[] = Array.isArray(rawRestingOrders)
      ? rawRestingOrders.filter((order): order is RestingPackageOrder => {
          if (!order || typeof order !== "object") return false;
          const candidate = order as Partial<RestingPackageOrder>;
          return (
            typeof candidate.id === "string" &&
            typeof candidate.orderHash === "string" &&
            typeof candidate.accountId === "string" &&
            typeof candidate.marketId === "string" &&
            typeof candidate.packageCode === "string" &&
            typeof candidate.routeId === "string" &&
            typeof candidate.routeLabel === "string" &&
            (candidate.side === "ENTER" || candidate.side === "EXIT") &&
            typeof candidate.lots === "number" &&
            typeof candidate.limitPrice === "number" &&
            candidate.timeInForce === "GTC" &&
            typeof candidate.collateralReservation === "number" &&
            typeof candidate.feeCap === "number" &&
            (candidate.closePositionId === null ||
              typeof candidate.closePositionId === "string") &&
            typeof candidate.createdAt === "string" &&
            (candidate.state === "WORKING" || candidate.state === "CANCELLED")
          );
        })
      : [];
    const executions = Array.isArray(snapshot.executions)
      ? snapshot.executions.map((execution) => {
          const result = execution.result as Partial<PackageExecutionResult> & {
            position?: PackageExecutionResult["position"];
          };
          if (result && typeof result.outcome === "string") return execution;
          return {
            ...execution,
            result: {
              fillId: result?.fillId ?? "FIL-LEGACY",
              outcome: "OPENED" as const,
              position: result?.position ?? null,
              closedPositionId: null,
              closedLots: 0,
              receipt: result?.receipt as PackageExecutionResult["receipt"],
            },
          };
        })
      : [];
    const rawRfqRequests = (snapshot as { rfqRequests?: unknown }).rfqRequests;
    const rfqRequests: RfqRequest[] = Array.isArray(rawRfqRequests)
      ? rawRfqRequests.filter((request): request is RfqRequest => {
          if (!request || typeof request !== "object") return false;
          const candidate = request as Partial<RfqRequest>;
          if (typeof candidate.id !== "string") return false;
          if (candidate.state !== "OPEN" && candidate.state !== "CANCELLED") return false;
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
          if (!Array.isArray(candidate.quotes) || candidate.quotes.length < 2) return false;
          return candidate.quotes.every((quote) => {
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
            return true;
          });
        })
      : [];
    return {
      ...snapshot,
      wallet: { status: "DISCONNECTED", address: null, chainId: null },
      positions,
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
      side: "LONG",
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
      lots: intent.lots,
      limitPrice: intent.limitPrice,
      timeInForce: intent.timeInForce,
      collateralReservation: reservation,
      feeCap: intent.feeCap,
      closePositionId: intent.closePositionId,
      createdAt,
      state: "WORKING",
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
    if (intent.disclosure !== "PRIVATE_RFQ") {
      throw new Error("RFQ_REQUIRES_PRIVATE_DISCLOSURE");
    }
    if (intent.routeId !== "SOLVER_RFQ") {
      throw new Error("RFQ_REQUIRES_SOLVER_ROUTE");
    }
    const expiresAt = new Date(Date.now() + 45_000).toISOString();
    const createdAt = new Date().toISOString();
    const requestId = identifier("RFQ");
    const isEnter = intent.side === "ENTER";
    const northstarPrice = intent.limitPrice;
    const meridianPrice = isEnter
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
      },
      {
        id: identifier("QTE"),
        solverLabel: "Meridian Solver",
        capacityLots: intent.lots,
        packagePrice: meridianPrice,
        feeCap: meridianFeeCap,
        settlementGuarantee: intent.settlementGuarantee,
        expiresAt,
      },
    ];
    const request: RfqRequest = {
      id: requestId,
      authorization,
      state: "OPEN",
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

  async cancelRfq(requestId: string): Promise<RfqRequest> {
    this.assertWritableEnvironment();
    const existingRequests = Array.isArray(this.snapshot.rfqRequests)
      ? this.snapshot.rfqRequests
      : [];
    const target = existingRequests.find((request) => request.id === requestId);
    if (!target) throw new Error("RFQ_NOT_FOUND");
    if (target.state !== "OPEN") throw new Error("RFQ_NOT_OPEN");
    const cancelled: RfqRequest = { ...target, state: "CANCELLED" };
    this.publish({
      ...this.snapshot,
      rfqRequests: existingRequests.map((request) =>
        request.id === requestId ? cancelled : request,
      ),
    });
    return cancelled;
  }

  getReceipt(receiptId: string) {
    return this.snapshot.receipts.find((receipt) => receipt.id === receiptId) ?? null;
  }
}
