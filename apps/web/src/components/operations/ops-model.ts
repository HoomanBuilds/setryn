import type {
  AlertSeverity,
  AlertState,
  Freshness,
  HealthState,
  KillSwitchState,
  RecoveryState,
} from "@/lib/operations/types";

export type ViewId = "OVERVIEW" | "QUEUES" | "RECOVERY" | "POLICY" | "ALERTS";

export interface DevnetStatus {
  environment: "LOCAL_DEVNET";
  chainId: number;
  blockNumber: string;
  checkedAt: string;
  healthy: boolean;
  contracts: { label: string; address: string; healthy: boolean }[];
}

export type Detail =
  | { kind: "DEPENDENCY"; id: string }
  | { kind: "QUEUE"; id: string }
  | { kind: "RECOVERY"; id: string }
  | { kind: "ALERT"; id: string }
  | { kind: "POLICY"; id: string };

export type Tone = "up" | "brand" | "down" | "dim";

export function stateTone(
  state: HealthState | AlertSeverity | AlertState | KillSwitchState | RecoveryState,
): Tone {
  if (state === "HEALTHY" || state === "RESOLVED" || state === "ARMED" || state === "NOTICE") return "up";
  if (state === "RESOLUTION_READY") return "up";
  if (
    state === "DEGRADED" ||
    state === "WARNING" ||
    state === "ACKNOWLEDGED" ||
    state === "RECONCILING" ||
    state === "RECOVERY_QUEUED"
  ) {
    return "brand";
  }
  return "down";
}

export const TONE_TEXT: Record<Tone, string> = {
  up: "text-up",
  brand: "text-brand",
  down: "text-down",
  dim: "text-dim",
};

export function stateLabel(value: string): string {
  return value.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/** "18 s old" -> 18, "8 m old" -> 480, "45 s maximum" -> 45. Null when unparseable. */
export function parseSeconds(label: string): number | null {
  const match = /([\d.]+)\s*(ms|s|m|h)\b/i.exec(label);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const unit = match[2].toLowerCase();
  if (unit === "ms") return value / 1000;
  if (unit === "m") return value * 60;
  if (unit === "h") return value * 3600;
  return value;
}

/** Age against threshold as a 0..1 fill with the threshold tick position. */
export function freshnessGauge(freshness: Freshness): { fill: number; tick: number } | null {
  const age = parseSeconds(freshness.ageLabel);
  const limit = parseSeconds(freshness.thresholdLabel);
  if (age === null || limit === null || limit <= 0) return null;
  const scale = Math.max(age, limit) * 1.15;
  return { fill: age / scale, tick: limit / scale };
}
