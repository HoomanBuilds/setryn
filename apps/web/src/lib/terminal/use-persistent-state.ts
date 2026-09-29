"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

const CHANGE_EVENT = "setryn:persistent-state";
/** Session fallback when storage is unavailable (private windows, blocked site data). */
const memory = new Map<string, string>();

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key) ?? memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}

function decode<T>(raw: string | null, fallback: T, parse: (value: unknown) => T | undefined): T {
  if (raw === null) return fallback;
  try {
    return parse(JSON.parse(raw)) ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Per-viewer preference stored in localStorage and read through useSyncExternalStore, so the server render uses the
 * fallback, the client hydrates without a mismatch, and every hook instance on the key stays in sync. `fallback` and
 * `parse` must be stable (module-level) values.
 */
export function usePersistentState<T>(
  key: string,
  fallback: T,
  parse: (value: unknown) => T | undefined,
): [T, (next: T | ((current: T) => T)) => void] {
  const raw = useSyncExternalStore(
    subscribe,
    () => readRaw(key),
    () => null,
  );
  const value = useMemo(() => decode(raw, fallback, parse), [raw, fallback, parse]);
  const setValue = useCallback(
    (next: T | ((current: T) => T)) => {
      const current = decode(readRaw(key), fallback, parse);
      const resolved = typeof next === "function" ? (next as (current: T) => T)(current) : next;
      const serialized = JSON.stringify(resolved);
      memory.set(key, serialized);
      try {
        window.localStorage.setItem(key, serialized);
      } catch {
        // The in-memory copy keeps the preference for this session.
      }
      window.dispatchEvent(new Event(CHANGE_EVENT));
    },
    [key, fallback, parse],
  );
  return [value, setValue];
}
