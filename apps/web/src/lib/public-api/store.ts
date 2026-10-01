import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { databaseConfigured, readDocument, updateDocument } from "@setryn/persistence";
import { setrynDataRoot } from "@/lib/webhooks/json-store";

/**
 * Persistent state of the public API: issued keys (hashed) and each key's recent request log. It lives in the
 * repository's git-ignored `.setryn/public-api/` directory, next to the other local runtime data. State is held on
 * `globalThis` so every route module in the server process shares one copy, and writes are serialized and atomic.
 */

export type ApiScope = "read" | "trade";

export interface RateLimitPolicy {
  /** Bucket size: the largest burst a key may send at once. */
  capacity: number;
  /** Tokens returned to the bucket per second. */
  refillPerSecond: number;
}

export interface StoredApiKey {
  id: string;
  name: string;
  /** Non-secret display prefix, e.g. `stk_test_3f9a1c2b7d4e`. */
  prefix: string;
  /** Hex SHA-256 of the full key. The key itself is never stored. */
  secretHash: string;
  scopes: ApiScope[];
  /** When non-empty, trade endpoints accept only orders signed by these addresses (lowercase). */
  signers: string[];
  rateLimit: RateLimitPolicy;
  /** Partner deployment the key is issued under; its apiRequestsPerMinute quota is shared by all its keys. */
  partnerCode?: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  usage: { requests: number; errors: number; rateLimited: number; replayRejected: number };
}

export interface RequestLogEntry {
  id: string;
  at: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  code?: string;
}

interface KeyFile {
  version: 1;
  keys: StoredApiKey[];
}

interface LogFile {
  version: 1;
  logs: Record<string, RequestLogEntry[]>;
}

export interface PublicApiStoreSnapshot {
  keys: StoredApiKey[];
  logs: Record<string, RequestLogEntry[]>;
}

interface DatabaseState extends PublicApiStoreSnapshot {
  version: 1;
}

const EMPTY_DATABASE_STATE = (): DatabaseState => ({ version: 1, keys: [], logs: {} });

export const REQUEST_LOG_LIMIT = 50;

interface StoreState {
  loaded: Promise<void> | null;
  keys: StoredApiKey[];
  logs: Record<string, RequestLogEntry[]>;
  writeChain: Promise<void>;
  flushTimer: ReturnType<typeof setTimeout> | null;
}

const STATE_KEY = Symbol.for("setryn.public-api.store");

function state(): StoreState {
  const holder = globalThis as unknown as Record<symbol, StoreState | undefined>;
  holder[STATE_KEY] ??= { loaded: null, keys: [], logs: {}, writeChain: Promise.resolve(), flushTimer: null };
  return holder[STATE_KEY];
}

export function storeDirectory(): string {
  if (process.env.SETRYN_PUBLIC_API_DIR) return resolve(/*turbopackIgnore: true*/ process.env.SETRYN_PUBLIC_API_DIR);
  return resolve(/*turbopackIgnore: true*/ setrynDataRoot(), "public-api");
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return fallback;
    throw error;
  }
}

export async function loadStore(): Promise<StoreState> {
  const current = state();
  current.loaded ??= (async () => {
    const directory = storeDirectory();
    const [keys, logs] = await Promise.all([
      readJson<KeyFile>(resolve(/*turbopackIgnore: true*/ directory, "keys.json"), { version: 1, keys: [] }),
      readJson<LogFile>(resolve(/*turbopackIgnore: true*/ directory, "requests.json"), { version: 1, logs: {} }),
    ]);
    current.keys = Array.isArray(keys.keys) ? keys.keys : [];
    current.logs = logs.logs && typeof logs.logs === "object" ? logs.logs : {};
  })().catch((error: unknown) => {
    current.loaded = null;
    throw error;
  });
  await current.loaded;
  return current;
}

export async function readStore(): Promise<PublicApiStoreSnapshot> {
  if (databaseConfigured()) {
    const stored = await readDocument("public-api", "state.json", EMPTY_DATABASE_STATE());
    return { keys: stored.keys, logs: stored.logs };
  }
  const stored = await loadStore();
  return { keys: stored.keys, logs: stored.logs };
}

export async function mutateStore<R>(mutate: (store: PublicApiStoreSnapshot) => R): Promise<R> {
  if (databaseConfigured()) {
    return updateDocument("public-api", "state.json", EMPTY_DATABASE_STATE(), (stored) => {
      const result = mutate(stored);
      return { next: stored, result };
    });
  }
  const stored = await loadStore();
  const result = mutate(stored);
  await persist();
  return result;
}

export async function recordApiRequest(keyId: string, entry: RequestLogEntry, code?: string): Promise<void> {
  await mutateStore((stored) => {
    const key = stored.keys.find((candidate) => candidate.id === keyId);
    if (!key) return;
    key.lastUsedAt = entry.at;
    key.usage.requests += 1;
    if (entry.status >= 400) key.usage.errors += 1;
    if (code === "RATE_LIMITED") key.usage.rateLimited += 1;
    if (code === "NONCE_REUSED" || code === "TIMESTAMP_OUT_OF_WINDOW" || code === "INVALID_SIGNATURE") {
      key.usage.replayRejected += 1;
    }
    const entries = stored.logs[keyId] ?? [];
    entries.unshift(entry);
    stored.logs[keyId] = entries.slice(0, REQUEST_LOG_LIMIT);
  });
}

async function atomicWrite(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

/** Writes both files now, after any write already in flight. */
export function persist(): Promise<void> {
  const current = state();
  const next = current.writeChain.then(async () => {
    const directory = storeDirectory();
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await atomicWrite(resolve(/*turbopackIgnore: true*/ directory, "keys.json"), { version: 1, keys: current.keys } satisfies KeyFile);
    await atomicWrite(resolve(/*turbopackIgnore: true*/ directory, "requests.json"), { version: 1, logs: current.logs } satisfies LogFile);
  });
  current.writeChain = next.catch(() => undefined);
  return next;
}

/** Usage counters and logs change on every request, so they are flushed at most once a second. */
export function schedulePersist(): void {
  const current = state();
  if (current.flushTimer) return;
  current.flushTimer = setTimeout(() => {
    current.flushTimer = null;
    void persist().catch(() => undefined);
  }, 1_000);
}

export function appendRequestLog(keyId: string, entry: RequestLogEntry): void {
  const current = state();
  const entries = current.logs[keyId] ?? [];
  entries.unshift(entry);
  current.logs[keyId] = entries.slice(0, REQUEST_LOG_LIMIT);
  schedulePersist();
}
