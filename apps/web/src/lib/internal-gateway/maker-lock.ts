/**
 * Serializes the designated maker's risk reservations and order bindings. A risk admission commits to the maker
 * account's state when it is reserved, so a second reservation landing before the first is bound invalidates it.
 * Route bundles can load this module separately, so the queue lives on the server process's global object.
 */
const LOCK_KEY = Symbol.for("setryn.maker-lock");

type LockHolder = { [LOCK_KEY]?: Promise<unknown> };

export async function withMakerLock<T>(work: () => Promise<T>): Promise<T> {
  const holder = globalThis as LockHolder;
  const previous = holder[LOCK_KEY] ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(work);
  holder[LOCK_KEY] = run.catch(() => undefined);
  return run;
}
