import postgres, { type Sql } from "postgres";

export interface DocumentMutation<T, R> {
  readonly next?: T;
  readonly result: R;
}

const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const KEY = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const CLIENT = Symbol.for("setryn.persistence.client");

interface ClientHolder {
  [CLIENT]?: { url: string; sql: Sql };
}

export function databaseConfigured(): boolean {
  return Boolean(process.env.SETRYN_DATABASE_URL?.trim());
}

export function databaseScope(): string {
  const raw = (
    process.env.SETRYN_NETWORK ??
    process.env.NEXT_PUBLIC_SETRYN_NETWORK ??
    process.env.SETRYN_DEPLOYMENT_ENVIRONMENT ??
    "local"
  ).trim().toLowerCase();
  if (!NAME.test(raw)) throw new Error(`invalid Setryn database scope ${raw}`);
  return raw;
}

function database(): Sql {
  const url = process.env.SETRYN_DATABASE_URL?.trim();
  if (!url) throw new Error("SETRYN_DATABASE_URL is not configured");
  const holder = globalThis as typeof globalThis & ClientHolder;
  if (holder[CLIENT]?.url === url) return holder[CLIENT].sql;
  const parsed = new URL(url);
  const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1";
  const sql = postgres(url, {
    max: positiveInteger(process.env.SETRYN_DATABASE_POOL_SIZE, 4),
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
    ssl: local ? false : "require",
    onnotice: () => undefined,
  });
  holder[CLIENT] = { url, sql };
  return sql;
}

export async function closeDatabase(): Promise<void> {
  const holder = globalThis as typeof globalThis & ClientHolder;
  if (!holder[CLIENT]) return;
  await holder[CLIENT].sql.end({ timeout: 5 });
  delete holder[CLIENT];
}

export async function readDocument<T>(collection: string, documentKey: string, fallback: T): Promise<T> {
  validateNames(collection, documentKey);
  const scope = databaseScope();
  const rows = await database()<[{ payload: T }?]>`
    select payload
    from setryn.runtime_documents
    where scope = ${scope} and collection = ${collection} and document_key = ${documentKey}
  `;
  return rows[0]?.payload ?? clone(fallback);
}

export async function updateDocument<T, R>(
  collection: string,
  documentKey: string,
  fallback: T,
  mutate: (current: T) => DocumentMutation<T, R>,
): Promise<R> {
  validateNames(collection, documentKey);
  const scope = databaseScope();
  const result = await database().begin(async (transaction) => {
    await transaction`
      insert into setryn.runtime_documents (scope, collection, document_key, payload)
      values (${scope}, ${collection}, ${documentKey}, ${transaction.json(fallback as never)})
      on conflict (scope, collection, document_key) do nothing
    `;
    const rows = await transaction<[{ payload: T }]>`
      select payload
      from setryn.runtime_documents
      where scope = ${scope} and collection = ${collection} and document_key = ${documentKey}
      for update
    `;
    const outcome = mutate(clone(rows[0].payload));
    if (outcome.next !== undefined) {
      await transaction`
        update setryn.runtime_documents
        set payload = ${transaction.json(outcome.next as never)}, revision = revision + 1, updated_at = now()
        where scope = ${scope} and collection = ${collection} and document_key = ${documentKey}
      `;
    }
    return outcome.result;
  });
  return result as R;
}

/** Thrown by `withAdvisoryLock` when another holder kept the lock past the timeout. */
export class AdvisoryLockTimeoutError extends Error {
  constructor(name: string) {
    super(`ADVISORY_LOCK_TIMEOUT:${name}`);
    this.name = "AdvisoryLockTimeoutError";
  }
}

/**
 * Runs `work` while holding a transaction-scoped Postgres advisory lock named for this scope, so one critical section
 * runs at a time across every server instance sharing the database. The lock needs no table; it is released when the
 * transaction ends, including when `work` throws or the connection drops. Waiting longer than `timeoutMs` throws
 * AdvisoryLockTimeoutError. `idleTimeoutMs` can bound a lock held by work that is suspended outside Postgres.
 */
export async function withAdvisoryLock<T>(
  name: string,
  work: () => Promise<T>,
  timeoutMs = 25_000,
  idleTimeoutMs?: number,
): Promise<T> {
  if (!NAME.test(name)) throw new Error(`invalid Setryn advisory lock name ${name}`);
  const key = `${databaseScope()}:${name}`;
  const timeout = `${Math.max(1, Math.round(timeoutMs))}ms`;
  const idleTimeout = idleTimeoutMs === undefined ? null : `${Math.max(1, Math.round(idleTimeoutMs))}ms`;
  let acquired = false;
  try {
    const result = await database().begin(async (transaction) => {
      await transaction`select set_config('lock_timeout', ${timeout}, true)`;
      if (idleTimeout !== null) {
        await transaction`select set_config('idle_in_transaction_session_timeout', ${idleTimeout}, true)`;
      }
      await transaction`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
      acquired = true;
      return { value: await work() };
    });
    return (result as { value: T }).value;
  } catch (error) {
    // 55P03 is lock_not_available: lock_timeout elapsed before the advisory lock was granted.
    if (!acquired && (error as { code?: string } | null)?.code === "55P03") throw new AdvisoryLockTimeoutError(name);
    throw error;
  }
}

function validateNames(collection: string, documentKey: string): void {
  if (!NAME.test(collection)) throw new Error(`invalid Setryn database collection ${collection}`);
  if (!KEY.test(documentKey)) throw new Error(`invalid Setryn database document key ${documentKey}`);
}

function positiveInteger(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 50) throw new Error("SETRYN_DATABASE_POOL_SIZE must be an integer from 1 to 50");
  return value;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
