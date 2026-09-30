"use client";

import { useEffect, useState } from "react";

/**
 * A two-press confirmation for actions a viewer asked to confirm: the first press arms the action for a few seconds
 * and the second runs it. When confirmation is off, the first press runs it.
 */
export function useConfirmStep(enabled: boolean, timeoutMs = 4_000) {
  const [armed, setArmed] = useState<string | null>(null);
  useEffect(() => {
    if (armed === null) return;
    const timer = window.setTimeout(() => setArmed(null), timeoutMs);
    return () => window.clearTimeout(timer);
  }, [armed, timeoutMs]);
  const run = (key: string, action: () => void) => {
    if (!enabled || armed === key) {
      setArmed(null);
      action();
      return;
    }
    setArmed(key);
  };
  return { armed, run, disarm: () => setArmed(null) };
}
