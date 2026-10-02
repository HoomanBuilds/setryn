import { databaseConfigured, withAdvisoryLock } from "@setryn/persistence";

/**
 * Serializes the designated maker's transactions: risk reservations, order bindings, placements, withdrawals and
 * cleanup. A risk admission commits to the maker account's state when it is reserved, so a second reservation landing
 * before the first is bound invalidates it, and two senders racing on one key collide on nonces.
 *
 * Within one server process the work queues on the process's global object (route bundles can load this module
 * separately). Across processes, such as concurrent serverless instances, it also holds a transaction-scoped Postgres
 * advisory lock when SETRYN_DATABASE_URL is configured; without a database the queue protects one process only.
 */
const LOCK_KEY = Symbol.for("setryn.maker-lock");
const ADVISORY_LOCK_NAME = "designated-maker";
/** How long a critical section waits for another instance before giving up with MAKER_BUSY. */
const ADVISORY_LOCK_TIMEOUT_MS = 25_000;
/** Releases a database lock if a serverless instance freezes while waiting on an external RPC. */
const ADVISORY_LOCK_IDLE_TIMEOUT_MS = 60_000;

type LockHolder = { [LOCK_KEY]?: Promise<unknown> };

export async function withMakerLock<T>(work: () => Promise<T>): Promise<T> {
  const holder = globalThis as LockHolder;
  const previous = holder[LOCK_KEY] ?? Promise.resolve();
  const guarded = databaseConfigured()
    ? () =>
        withAdvisoryLock(ADVISORY_LOCK_NAME, work, ADVISORY_LOCK_TIMEOUT_MS, ADVISORY_LOCK_IDLE_TIMEOUT_MS).catch((error: unknown) => {
          if (error instanceof Error && error.message.startsWith("ADVISORY_LOCK_TIMEOUT")) throw new Error("MAKER_BUSY");
          throw error;
        })
    : work;
  const run = previous.catch(() => undefined).then(guarded);
  holder[LOCK_KEY] = run.catch(() => undefined);
  return run;
}
