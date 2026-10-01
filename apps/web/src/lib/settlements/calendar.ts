import type { OnchainLifecycleSchedule } from "@/lib/internal-gateway/types";
import type { PackageMarket } from "@/lib/terminal/types";

/**
 * Series schedule (docs/plans/network-runtime-real-data.md, section 2). Every listed series expires at 08:00 UTC and
 * runs on a fixed schedule relative to that expiry E: trading until E - 2h, the fixing window E - 1h to E, evidence
 * by E + 1h, corrections close E + 2h, holder election E + 2h to E + 2h45m, final resolution E + 3h, settlement
 * deadline E + 3h30m. The runtime listing carries each boundary as unix seconds; when the catalog entry carries them
 * they are read verbatim, otherwise they follow from the listed expiry by the same rule. A held position's own
 * onchain schedule (gateway lifecycle) overrides both.
 */

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

/** Listed series expire at this UTC time on their expiry date. */
export const EXPIRY_TIME_UTC = "08:00";

export const SCHEDULE_OFFSETS_MS = {
  lastTrading: -2 * HOUR_MS,
  windowOpens: -1 * HOUR_MS,
  evidenceDeadline: 1 * HOUR_MS,
  correctionsClose: 2 * HOUR_MS,
  electionOpens: 2 * HOUR_MS,
  electionCloses: 2 * HOUR_MS + 45 * MINUTE_MS,
  finalResolution: 3 * HOUR_MS,
  settlementDeadline: 3 * HOUR_MS + 30 * MINUTE_MS,
} as const;

/** Where a schedule was read from: the position's chain record, the listing, or the listing rule applied to expiry. */
export type ScheduleSource = "POSITION" | "LISTING" | "EXPIRY_RULE";

export interface SeriesSchedule {
  marketId: string;
  lastTradingMs: number;
  windowOpensMs: number;
  /** The fixing prints when the window closes, at expiry. */
  fixingMs: number;
  evidenceDeadlineMs: number;
  correctionsCloseMs: number;
  electionOpensMs: number;
  electionClosesMs: number;
  finalResolutionMs: number;
  settlementDeadlineMs: number;
  /** Length of the fixing window in minutes. */
  windowMinutes: number;
  source: ScheduleSource;
}

/** Optional schema 11 schedule fields (unix seconds) a catalog market may carry. */
type ListingSchedule = {
  expiryAt?: number | null;
  lastTradingAt?: number | null;
  fixingWindowOpen?: number | null;
  fixingWindowClose?: number | null;
  exerciseOpensAt?: number | null;
  exerciseCutoffAt?: number | null;
  finalResolutionAt?: number | null;
  settlementDeadline?: number | null;
};

function seconds(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value * 1000 : null;
}

/** Expiry instant of a listed series. */
export function expiryMs(market: Pick<PackageMarket, "expiryIso">): number {
  const listed = seconds((market as ListingSchedule).expiryAt);
  if (listed !== null) return listed;
  const iso = market.expiryIso;
  const parsed = Date.parse(iso.length > 10 ? iso : `${iso}T${EXPIRY_TIME_UTC}:00Z`);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function fromIso(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** The series schedule of a market, from the listing when it carries one, else from its expiry. */
export function seriesSchedule(
  market: Pick<PackageMarket, "id" | "expiryIso">,
  position?: OnchainLifecycleSchedule | null,
): SeriesSchedule {
  const listing = market as ListingSchedule;
  const expiry = seconds(listing.fixingWindowClose) ?? expiryMs(market);
  const at = (field: number | null, offset: number) => field ?? expiry + offset;
  const listed = seconds(listing.fixingWindowOpen) !== null || seconds(listing.expiryAt) !== null;
  const derived: SeriesSchedule = {
    marketId: market.id,
    lastTradingMs: at(seconds(listing.lastTradingAt), SCHEDULE_OFFSETS_MS.lastTrading),
    windowOpensMs: at(seconds(listing.fixingWindowOpen), SCHEDULE_OFFSETS_MS.windowOpens),
    fixingMs: expiry,
    evidenceDeadlineMs: expiry + SCHEDULE_OFFSETS_MS.evidenceDeadline,
    correctionsCloseMs: expiry + SCHEDULE_OFFSETS_MS.correctionsClose,
    electionOpensMs: at(seconds(listing.exerciseOpensAt), SCHEDULE_OFFSETS_MS.electionOpens),
    electionClosesMs: at(seconds(listing.exerciseCutoffAt), SCHEDULE_OFFSETS_MS.electionCloses),
    finalResolutionMs: at(seconds(listing.finalResolutionAt), SCHEDULE_OFFSETS_MS.finalResolution),
    settlementDeadlineMs: at(seconds(listing.settlementDeadline), SCHEDULE_OFFSETS_MS.settlementDeadline),
    windowMinutes: 60,
    source: listed ? "LISTING" : "EXPIRY_RULE",
  };
  if (position) {
    const windowOpens = fromIso(position.fixingWindowOpen);
    const windowCloses = fromIso(position.fixingWindowClose);
    const schedule: SeriesSchedule = {
      ...derived,
      lastTradingMs: fromIso(position.lastTradingAt) ?? derived.lastTradingMs,
      windowOpensMs: windowOpens ?? derived.windowOpensMs,
      fixingMs: windowCloses ?? derived.fixingMs,
      correctionsCloseMs: fromIso(position.correctionCutoffAt) ?? derived.correctionsCloseMs,
      electionOpensMs: fromIso(position.exerciseOpensAt) ?? derived.electionOpensMs,
      electionClosesMs: fromIso(position.exerciseCutoffAt) ?? derived.electionClosesMs,
      finalResolutionMs: fromIso(position.finalResolutionAt) ?? derived.finalResolutionMs,
      settlementDeadlineMs: fromIso(position.settlementDeadline) ?? derived.settlementDeadlineMs,
      source: "POSITION",
    };
    return withWindow(schedule);
  }
  return withWindow(derived);
}

function withWindow(schedule: SeriesSchedule): SeriesSchedule {
  const minutes = Math.round((schedule.fixingMs - schedule.windowOpensMs) / MINUTE_MS);
  return { ...schedule, windowMinutes: minutes > 0 ? minutes : schedule.windowMinutes };
}

export const SCHEDULE_SOURCE_LABEL: Record<ScheduleSource, string> = {
  POSITION: "Position schedule, onchain",
  LISTING: "Series listing",
  EXPIRY_RULE: "Series terms, from the listed expiry",
};

/** Whole days from now to the series expiry, never negative. */
export function daysToExpiryAt(market: Pick<PackageMarket, "expiryIso">, nowMs: number): number {
  const ms = expiryMs(market);
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, Math.round((ms - nowMs) / 86_400_000));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** "24 Dec 2026, 08:00 UTC". */
export function formatUtcSession(ms: number): string {
  const date = new Date(ms);
  return `${pad(date.getUTCDate())} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}, ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
}

/** "24 Dec 08:00" for dense rows. */
export function formatUtcShort(ms: number): string {
  const date = new Date(ms);
  return `${pad(date.getUTCDate())} ${MONTHS[date.getUTCMonth()]} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

/** "24 Dec 2026" from a date or an instant. */
export function formatUtcDate(value: string | number): string {
  const date = new Date(typeof value === "number" ? value : Date.parse(value.length > 10 ? value : `${value}T00:00:00Z`));
  return `${pad(date.getUTCDate())} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

export function monthLabel(ms: number): string {
  const date = new Date(ms);
  return `${MONTHS[date.getUTCMonth()]} ${String(date.getUTCFullYear()).slice(2)}`;
}

/** Compact countdown on the platform clock: 42s, 4m 05s, 3h 07m, 3d 07h, 93d. */
export function formatCountdownMs(ms: number): string {
  if (ms <= 0) return "now";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${pad(seconds % 60)}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${pad(minutes % 60)}m`;
  const days = Math.floor(hours / 24);
  if (days < 10) return `${days}d ${pad(hours % 24)}h`;
  return `${days}d`;
}
