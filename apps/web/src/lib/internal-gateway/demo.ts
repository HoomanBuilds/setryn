import type {
  CollateralIntent,
  CollateralIntentResult,
  ExecutionReceipt,
  GatewaySnapshot,
  InternalTradingGateway,
  PackageExecutionResult,
  PackageOrderIntent,
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
    return {
      ...snapshot,
      wallet: { status: "DISCONNECTED", address: null, chainId: null },
      positions: Array.isArray(snapshot.positions) ? snapshot.positions : [],
      executions: Array.isArray(snapshot.executions) ? snapshot.executions : [],
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
    const signer = this.snapshot.wallet.address;
    if (!signer || this.snapshot.wallet.status !== "CONNECTED") throw new Error("CONNECT_WALLET");
    if (intent.collateralRequired + intent.feeCap > this.snapshot.account.available) {
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
    if (authorization.signer !== this.snapshot.wallet.address) throw new Error("SIGNER_MISMATCH");
    if (Date.parse(authorization.deadline) <= Date.now()) throw new Error("AUTHORIZATION_EXPIRED");
    const transactionHash = digest(`${authorization.orderHash}:transaction`);
    const updates: SubmissionUpdate[] = [
      { step: "AUTHORIZED", label: "Authorized", detail: "Package authorization is bound to the selected account and route." },
      { step: "SUBMITTED", label: "Submitted", detail: "Authorization accepted by the demo clearing runtime." },
      { step: "INCLUDED", label: "Included", detail: "Package execution was included as one clearing result.", transactionHash },
      { step: "FILLED", label: "Filled", detail: `${authorization.intent.lots} package lots filled at the selected route price.` },
      { step: "POSITION_CREATED", label: "Position created", detail: "Collateral reservation and package position were recorded together." },
    ];
    const journal: SubmissionUpdate[] = [];
    for (const update of updates) {
      await wait(320);
      journal.push(update);
      onUpdate(update);
    }

    const fillId = identifier("FIL");
    const positionId = identifier("STR");
    const receiptId = identifier("RCP");
    const receipt: ExecutionReceipt = {
      id: receiptId,
      orderHash: authorization.orderHash,
      fillId,
      transactionHash,
      marketId: authorization.intent.marketId,
      packageCode: authorization.intent.packageCode,
      routeLabel: authorization.intent.routeLabel,
      lots: authorization.intent.lots,
      price: authorization.intent.executionPrice,
      fees: authorization.intent.feeCap,
      guarantee: authorization.intent.settlementGuarantee,
      evidence: this.snapshot.environment.evidence,
      createdAt: new Date().toISOString(),
    };
    const position: PackageExecutionResult["position"] = {
      id: positionId,
      marketId: authorization.intent.marketId,
      side: authorization.intent.side === "ENTER" ? "LONG" : "SHORT",
      lots: authorization.intent.lots,
      entryPrice: authorization.intent.executionPrice,
      collateral: authorization.intent.collateralRequired,
      state: "ACTIVE" as const,
      createdAt: receipt.createdAt,
    };
    this.publish({
      ...this.snapshot,
      account: {
        ...this.snapshot.account,
        reserved:
          this.snapshot.account.reserved + authorization.intent.collateralRequired + authorization.intent.feeCap,
        available:
          this.snapshot.account.available - authorization.intent.collateralRequired - authorization.intent.feeCap,
      },
      positions: [position, ...this.snapshot.positions],
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
      position,
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

  getReceipt(receiptId: string) {
    return this.snapshot.receipts.find((receipt) => receipt.id === receiptId) ?? null;
  }
}
