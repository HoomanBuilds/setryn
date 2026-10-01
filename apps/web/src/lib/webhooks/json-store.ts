import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { databaseConfigured, readDocument, updateDocument } from "@setryn/persistence";

/**
 * Locked JSON documents under the repository's `.setryn/` directory, compatible with the webhooks worker's store:
 * a `mkdir` lock beside each file and an atomic rename on write.
 */
const LOCK_STALE_MS = 10_000;
const LOCK_TIMEOUT_MS = 5_000;

export function setrynDataDirectory(...segments: string[]): string {
  if (segments[0] === "webhooks" && process.env.SETRYN_WEBHOOKS_DIR) {
    return resolve(/*turbopackIgnore: true*/ process.env.SETRYN_WEBHOOKS_DIR, ...segments.slice(1));
  }
  return resolve(/*turbopackIgnore: true*/ setrynDataRoot(), ...segments);
}

/**
 * Root of the server's local data: `<repo>/.setryn`. Vercel functions can only write under the temp directory, so
 * there it is `<tmp>/setryn`, which does not survive a cold start: set the per-store paths (SETRYN_ORG_STORE_PATH,
 * SETRYN_PUBLIC_API_DIR, SETRYN_WEBHOOKS_DIR) to durable storage for records that must persist.
 */
export function setrynDataRoot(): string {
  if (process.env.VERCEL) return join(tmpdir(), "setryn");
  const root = process.cwd().endsWith("/apps/web") ? "../.." : ".";
  return resolve(/*turbopackIgnore: true*/ process.cwd(), root, ".setryn");
}

export async function readJson<T>(directory: string, file: string, empty: T): Promise<T> {
  if (databaseConfigured()) return readDocument("webhooks", file, empty);
  try {
    return JSON.parse(await readFile(join(directory, file), "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return empty;
    throw error;
  }
}

async function writeJson(directory: string, file: string, value: unknown): Promise<void> {
  await mkdir(directory, { recursive: true });
  const target = join(directory, file);
  const temporary = `${target}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

async function lock(directory: string, file: string): Promise<() => Promise<void>> {
  await mkdir(directory, { recursive: true });
  const lockPath = `${join(directory, file)}.lock`;
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      await mkdir(lockPath);
      return async () => {
        await rm(lockPath, { recursive: true, force: true });
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const info = await stat(lockPath).catch(() => null);
      if (info && Date.now() - info.mtimeMs > LOCK_STALE_MS) {
        await rm(lockPath, { recursive: true, force: true });
        continue;
      }
      if (Date.now() > deadline) throw new Error("STORE_LOCK_TIMEOUT");
      await new Promise((resolveWait) => setTimeout(resolveWait, 15 + Math.random() * 25));
    }
  }
}

/** Read-modify-write under the file lock. Returning `next: undefined` leaves the file untouched. */
export async function updateJson<T, R>(
  directory: string,
  file: string,
  empty: T,
  mutate: (current: T) => { next?: T; result: R },
): Promise<R> {
  if (databaseConfigured()) return updateDocument("webhooks", file, empty, mutate);
  const release = await lock(directory, file);
  try {
    const { next, result } = mutate(await readJson(directory, file, empty));
    if (next !== undefined) await writeJson(directory, file, next);
    return result;
  } finally {
    await release();
  }
}
