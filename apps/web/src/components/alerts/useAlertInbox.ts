"use client";

import { useEffect, useMemo } from "react";
import { useGatewaySnapshot } from "@/components/gateway/InternalGatewayProvider";
import { useWallClock } from "@/components/home/kit";
import { usePreviewBoard } from "@/components/terminal/PreviewMarketProvider";
import {
  ALERT_LEDGER_KEY,
  ALERT_RULES_KEY,
  DEFAULT_ALERT_RULES,
  EMPTY_ALERT_LEDGER,
  alertInbox,
  latchAlerts,
  parseAlertLedger,
  parseAlertRules,
  type AlertInbox,
  type AlertLedger,
  type AlertRule,
} from "@/lib/alerts";
import { usePersistentState } from "@/lib/terminal/use-persistent-state";

export function useAlertRules() {
  return usePersistentState<readonly AlertRule[]>(ALERT_RULES_KEY, DEFAULT_ALERT_RULES, parseAlertRules);
}

export function useAlertLedger() {
  return usePersistentState<AlertLedger>(ALERT_LEDGER_KEY, EMPTY_ALERT_LEDGER, parseAlertLedger);
}

/**
 * The viewer's live alert inbox: gateway snapshot, shared preview board, per-viewer rules and ledger. Rule
 * conditions that start holding are latched into the ledger here, so a price alert stays listed after the mark
 * moves back. Mount it once per surface; every instance shares the same stored ledger.
 */
export function useAlertInbox(): AlertInbox & {
  rules: readonly AlertRule[];
  ledger: AlertLedger;
  setRules: ReturnType<typeof useAlertRules>[1];
  setLedger: ReturnType<typeof useAlertLedger>[1];
  nowMs: number;
} {
  const snapshot = useGatewaySnapshot();
  const { markets, previewEpochSeconds } = usePreviewBoard();
  const nowMs = useWallClock();
  const [rules, setRules] = useAlertRules();
  const [ledger, setLedger] = useAlertLedger();

  const inbox = useMemo(
    () => alertInbox({ snapshot, markets, previewEpochSeconds, nowMs, rules, ledger }),
    [snapshot, markets, previewEpochSeconds, nowMs, rules, ledger],
  );

  const { latches } = inbox;
  useEffect(() => {
    if (latches.length === 0) return;
    setLedger((current) => latchAlerts(current, latches, Date.now()));
  }, [latches, setLedger]);

  return { ...inbox, rules, ledger, setRules, setLedger, nowMs };
}
