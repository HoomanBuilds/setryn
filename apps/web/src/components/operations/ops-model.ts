import type { SeriesStatus } from "@/lib/market-data/types";
import type { SeriesPhase } from "@/lib/operations/deployment";
import type { AlertSeverity, AlertState, Freshness, HealthState } from "@/lib/operations/types";

export type ViewId = "OVERVIEW" | "SERIES" | "SCHEDULE" | "TERMINAL" | "CONTRACTS" | "POLICY" | "ALERTS";

export type Detail =
  | { kind: "DEPENDENCY"; id: string }
  | { kind: "SERIES"; id: string }
  | { kind: "ALERT"; id: string }
  | { kind: "CONTRACT"; id: string };

export type Tone = "up" | "brand" | "down" | "dim";

export function stateTone(state: HealthState | AlertSeverity | AlertState | SeriesStatus | SeriesPhase): Tone {
  if (state === "HEALTHY" || state === "RESOLVED" || state === "NOTICE" || state === "ACTIVE" || state === "TRADING") return "up";
  if (
    state === "DEGRADED" ||
    state === "WARNING" ||
    state === "ACKNOWLEDGED" ||
    state === "PAUSED" ||
    state === "PRE_FIXING" ||
    state === "FIXING" ||
    state === "ELECTION" ||
    state === "RESOLUTION" ||
    state === "SETTLEMENT" ||
    state === "EXPIRED"
  ) {
    return "brand";
  }
  if (state === "UNKNOWN" || state === "UNSCHEDULED" || state === "COMPLETE" || state === "DEPRECATED") return "dim";
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

/** "18 s old" -> 18, "8 m old" -> 480, "6 h maximum" -> 21600. Null when unparseable. */
export function parseSeconds(label: string): number | null {
  const match = /([\d.]+)\s*(ms|s|m|h|d)\b/i.exec(label);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const unit = match[2].toLowerCase();
  if (unit === "ms") return value / 1000;
  if (unit === "m") return value * 60;
  if (unit === "h") return value * 3600;
  if (unit === "d") return value * 86_400;
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

export function shortHex(value: string | null | undefined, head = 6, tail = 4): string {
  if (!value) return "-";
  return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function utc(seconds: number): string {
  return `${new Date(seconds * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export function countdown(seconds: number): string {
  if (!Number.isFinite(seconds)) return "-";
  const value = Math.max(0, Math.round(seconds));
  if (value < 60) return `${value}s`;
  if (value < 3_600) return `${Math.floor(value / 60)}m ${String(value % 60).padStart(2, "0")}s`;
  if (value < 86_400) return `${Math.floor(value / 3_600)}h ${String(Math.floor((value % 3_600) / 60)).padStart(2, "0")}m`;
  return `${Math.floor(value / 86_400)}d ${Math.floor((value % 86_400) / 3_600)}h`;
}
