import { WaitForTransactionReceiptTimeoutError, type Hex, type TransactionReceipt } from "viem";

/** What steps need from a chain client: waiting for a receipt. */
export interface ReceiptReader {
  waitForTransactionReceipt(args: { hash: Hex; timeout?: number }): Promise<TransactionReceipt>;
}

/*
 * Progress of a multi-step wallet action (a deposit, an RFQ request, a lifecycle action), told the same way everywhere:
 * which step of how many, whether the wallet is waiting for the user or the chain is waiting for inclusion, and the
 * transaction hash as soon as there is one. When a step fails, the error carries what already landed, so the user is
 * never told "nothing was submitted" after something was.
 */

export type ActionPhase = "SIGN" | "PENDING" | "CONFIRMED";

export interface ActionProgress {
  /** 1-based index of the step and the most steps the action can take (some are skipped when not needed). */
  step: number;
  total: number;
  /** What the step does, in the user's words, for example "Approve USDC for the vault". */
  label: string;
  /** SIGN: waiting for the wallet. PENDING: sent, waiting for the chain. CONFIRMED: included. */
  phase: ActionPhase;
  transactionHash?: Hex;
}

export type ProgressListener = (progress: ActionProgress) => void;

/** A step that landed before a later one failed. */
export interface CompletedStep {
  label: string;
  transactionHash?: Hex;
}

/**
 * A failed action that knows its own history: the code (WALLET_REJECTED, TRANSACTION_REVERTED, TRANSACTION_PENDING,
 * or the underlying gateway code), the step that failed, and the steps that already landed on chain.
 */
export class ActionError extends Error {
  readonly code: string;
  readonly failedStep: string | null;
  readonly completed: readonly CompletedStep[];
  readonly transactionHash: Hex | null;

  constructor(code: string, options: { failedStep?: string | null; completed?: readonly CompletedStep[]; transactionHash?: Hex | null; cause?: unknown }) {
    super(code, { cause: options.cause });
    this.name = "ActionError";
    this.code = code;
    this.failedStep = options.failedStep ?? null;
    this.completed = options.completed ?? [];
    this.transactionHash = options.transactionHash ?? null;
  }
}

/** The EIP-1193 and JSON-RPC codes along an error's cause chain. */
export function errorCodes(error: unknown): unknown[] {
  const codes: unknown[] = [];
  for (let cause = error, depth = 0; cause && typeof cause === "object" && depth < 8; depth += 1) {
    codes.push((cause as { code?: unknown }).code);
    cause = (cause as { cause?: unknown }).cause;
  }
  return codes;
}

export function isWalletRejection(error: unknown): boolean {
  if (error instanceof ActionError) return error.code === "WALLET_REJECTED";
  return errorCodes(error).includes(4001) || (error instanceof Error && /user (rejected|denied)/i.test(error.message));
}

/** How long to wait for a transaction to be included before telling the user it is still pending (not failed). */
const RECEIPT_TIMEOUT_MS = 120_000;

/**
 * Runs an action's steps in order, reporting each one. `transaction` asks the wallet to send, reports the hash, waits for
 * inclusion and fails on a revert; `signature` asks the wallet to sign; `offchain` wraps a request to Setryn's servers.
 * A failure is rethrown as an ActionError that names the failed step and the steps that already landed.
 */
export class ActionSteps {
  readonly completed: CompletedStep[] = [];
  #step = 0;

  constructor(
    /** Null for an action with no onchain transaction of its own (offchain and signature steps only). */
    private readonly publicClient: ReceiptReader | null,
    private total: number,
    private readonly onProgress: ProgressListener | undefined,
  ) {}

  /** Lowers or raises the expected step count once the action knows which optional steps it needs. */
  plan(total: number): void {
    this.total = Math.max(total, this.#step);
  }

  /** Sets the expected count to the steps taken so far plus `count` more (a cleanup or a remainder). */
  planRemaining(count: number): void {
    this.total = this.#step + count;
  }

  #emit(label: string, phase: ActionPhase, transactionHash?: Hex): void {
    this.onProgress?.({ step: this.#step, total: Math.max(this.total, this.#step), label, phase, ...(transactionHash ? { transactionHash } : {}) });
  }

  #fail(error: unknown, label: string, transactionHash?: Hex): never {
    if (error instanceof ActionError) throw error;
    const code = isWalletRejection(error)
      ? "WALLET_REJECTED"
      : error instanceof WaitForTransactionReceiptTimeoutError
        ? "TRANSACTION_PENDING"
        : error instanceof Error && /^[A-Z][A-Z0-9_]{2,63}$/.test(error.message)
          ? error.message
          : "ACTION_FAILED";
    throw new ActionError(code, { failedStep: label, completed: [...this.completed], transactionHash: transactionHash ?? null, cause: error });
  }

  async transaction(label: string, send: () => Promise<Hex>): Promise<TransactionReceipt> {
    this.#step += 1;
    this.#emit(label, "SIGN");
    let hash: Hex | undefined;
    try {
      if (!this.publicClient) throw new Error("NO_CHAIN_CLIENT");
      hash = await send();
      this.#emit(label, "PENDING", hash);
      const receipt = await this.publicClient.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS });
      if (receipt.status !== "success") {
        throw new ActionError("TRANSACTION_REVERTED", { failedStep: label, completed: [...this.completed], transactionHash: hash });
      }
      this.completed.push({ label, transactionHash: hash });
      this.#emit(label, "CONFIRMED", hash);
      return receipt;
    } catch (error) {
      this.#fail(error, label, hash);
    }
  }

  /** A transaction someone else sent (a relayer): reports it and waits for inclusion like one of the action's own. */
  async confirm(label: string, hash: Hex): Promise<TransactionReceipt> {
    return this.transaction(label, async () => hash);
  }

  async signature<T>(label: string, sign: () => Promise<T>): Promise<T> {
    this.#step += 1;
    this.#emit(label, "SIGN");
    try {
      const value = await sign();
      this.completed.push({ label });
      this.#emit(label, "CONFIRMED");
      return value;
    } catch (error) {
      this.#fail(error, label);
    }
  }

  async offchain<T>(label: string, run: () => Promise<T>): Promise<T> {
    this.#step += 1;
    this.#emit(label, "PENDING");
    try {
      const value = await run();
      this.completed.push({ label });
      this.#emit(label, "CONFIRMED");
      return value;
    } catch (error) {
      this.#fail(error, label);
    }
  }
}

const WITHIN_ACTION = Symbol("withinAction");

/**
 * Marks a listener as reporting into an action that is already tracked (a trade the ticket tracks as one entry), so a
 * gateway call that would track itself, such as an RFQ request, reports its steps there instead of adding a second.
 */
export function withinAction(listener: ProgressListener): ProgressListener {
  return Object.assign((progress: ActionProgress) => listener(progress), { [WITHIN_ACTION]: true });
}

export function isWithinAction(listener: ProgressListener | undefined): listener is ProgressListener {
  return typeof listener === "function" && (listener as { [WITHIN_ACTION]?: boolean })[WITHIN_ACTION] === true;
}

/**
 * Numbers the steps of several gateway calls made for one user action (authorize, then place) as one sequence, so the
 * count runs "Step 3 of 5, Step 4 of 5" instead of starting over at each call. A call's first step is recognised by
 * its number going back, or by the same number starting again after it confirmed.
 */
export function sequenceProgress(listener: ProgressListener): ProgressListener {
  let base = 0;
  let last: ActionProgress | null = null;
  return (progress) => {
    if (last && (progress.step < last.step || (progress.step === last.step && last.phase === "CONFIRMED" && progress.phase !== "CONFIRMED"))) {
      base += last.total;
    }
    last = progress;
    listener({ ...progress, step: base + progress.step, total: base + progress.total });
  };
}

/** One line for the step in progress: "Step 2 of 3 · Approve USDC · confirm in your wallet". */
export function describeProgress(progress: ActionProgress): string {
  const where = progress.total > 1 ? `Step ${progress.step} of ${progress.total} · ` : "";
  const state = progress.phase === "SIGN" ? "confirm in your wallet" : progress.phase === "PENDING" ? "waiting for the chain" : "confirmed";
  return `${where}${progress.label} · ${state}`;
}
