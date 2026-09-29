import type { PackageMarket } from "@/lib/terminal/types";

/**
 * Fixing schedule model. Series terms in the preview fixtures carry only an
 * expiry date and a 16:00 benchmark, so the session, the observation window
 * and the business-day rule below are modeled from those terms. Nothing here
 * is read from a venue calendar or an oracle, and every value derived from it
 * is labeled MODELED where it is shown.
 */

export const CALENDAR_VERSION = "LDN business calendar v1 (modeled)";

/** Benchmark sessions fix at 16:00 UTC, matching the terminal countdowns. */
export const FIXING_TIME_UTC = "16:00";

/** Observation window ahead of the fixing print, in minutes. */
export const FIXING_WINDOW_MINUTES = 30;

export const ADJUSTMENT_RULE = "Preceding London business day";

export interface MarketHoliday {
  iso: string;
  name: string;
}

/** England and Wales bank holidays across the listed maturities. */
export const LONDON_HOLIDAYS: readonly MarketHoliday[] = [
  { iso: "2026-12-25", name: "Christmas Day" },
  { iso: "2026-12-28", name: "Boxing Day (substitute)" },
  { iso: "2027-01-01", name: "New Year's Day" },
  { iso: "2027-03-26", name: "Good Friday" },
  { iso: "2027-03-29", name: "Easter Monday" },
  { iso: "2027-05-03", name: "Early May bank holiday" },
  { iso: "2027-05-31", name: "Spring bank holiday" },
  { iso: "2027-08-30", name: "Summer bank holiday" },
  { iso: "2027-12-27", name: "Christmas Day (substitute)" },
  { iso: "2027-12-28", name: "Boxing Day (substitute)" },
];

const DAY_MS = 86_400_000;

function dayMs(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`);
}

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function holidayOn(iso: string): MarketHoliday | null {
  return LONDON_HOLIDAYS.find((holiday) => holiday.iso === iso) ?? null;
}

export function isWeekend(iso: string): boolean {
  const day = new Date(dayMs(iso)).getUTCDay();
  return day === 0 || day === 6;
}

export function isBusinessDay(iso: string): boolean {
  return !isWeekend(iso) && holidayOn(iso) === null;
}

export function precedingBusinessDay(iso: string): string {
  let cursor = dayMs(iso) - DAY_MS;
  while (!isBusinessDay(isoDay(cursor))) cursor -= DAY_MS;
  return isoDay(cursor);
}

export interface FixingAdjustment {
  /** Scheduled date from series terms. */
  scheduled: string;
  /** Date the modeled rule would move the session to. */
  adjusted: string;
  reason: string;
  rule: string;
}

export interface FixingSchedule {
  marketId: string;
  /** Fixing print from series terms: expiry date at 16:00 UTC. Never silently moved. */
  fixingAt: string;
  windowOpensAt: string;
  fixingMs: number;
  windowOpensMs: number;
  /** Present when the scheduled date is not a London business day. */
  adjustment: FixingAdjustment | null;
}

export function fixingSchedule(market: Pick<PackageMarket, "id" | "expiryIso">): FixingSchedule {
  const fixingAt = `${market.expiryIso}T${FIXING_TIME_UTC}:00Z`;
  const fixingMs = Date.parse(fixingAt);
  const windowOpensMs = fixingMs - FIXING_WINDOW_MINUTES * 60_000;
  let adjustment: FixingAdjustment | null = null;
  if (!isBusinessDay(market.expiryIso)) {
    const holiday = holidayOn(market.expiryIso);
    adjustment = {
      scheduled: market.expiryIso,
      adjusted: precedingBusinessDay(market.expiryIso),
      reason: holiday ? `${holiday.name}, London closed` : "Weekend, London closed",
      rule: ADJUSTMENT_RULE,
    };
  }
  return {
    marketId: market.id,
    fixingAt,
    windowOpensAt: new Date(windowOpensMs).toISOString(),
    fixingMs,
    windowOpensMs,
    adjustment,
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** "24 Dec 2026, 16:00 UTC", the form the lifecycle fixtures already use. */
export function formatUtcSession(ms: number): string {
  const date = new Date(ms);
  return `${pad(date.getUTCDate())} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}, ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
}

/** "24 Dec 16:00" for dense rows. */
export function formatUtcShort(ms: number): string {
  const date = new Date(ms);
  return `${pad(date.getUTCDate())} ${MONTHS[date.getUTCMonth()]} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

export function formatUtcDate(iso: string): string {
  const date = new Date(dayMs(iso));
  return `${pad(date.getUTCDate())} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

export function monthLabel(ms: number): string {
  const date = new Date(ms);
  return `${MONTHS[date.getUTCMonth()]} ${String(date.getUTCFullYear()).slice(2)}`;
}

/** Compact countdown from the feed clock: 42s, 4m 05s, 3h 07m, 3d 07h, 93d. */
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

/**
 * Lifecycle fixtures state boundary timing as text ("12:00 UTC",
 * "closes 09:21 UTC", "07 Oct 2026, 16:00 UTC"). A time without a date falls
 * on the feed clock's UTC day. Text without a clock time has no timestamp.
 */
export function parseBoundaryTiming(timing: string, nowMs: number): number | null {
  const dated = /(\d{2}) ([A-Z][a-z]{2}) (\d{4}), (\d{2}):(\d{2}) UTC/.exec(timing);
  if (dated) {
    const month = MONTHS.indexOf(dated[2]);
    if (month < 0) return null;
    return Date.UTC(Number(dated[3]), month, Number(dated[1]), Number(dated[4]), Number(dated[5]));
  }
  const clock = /(\d{2}):(\d{2}) UTC/.exec(timing);
  if (clock) {
    const now = new Date(nowMs);
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), Number(clock[1]), Number(clock[2]));
  }
  return null;
}
