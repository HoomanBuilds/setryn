import { executableAction } from "@/lib/terminal/economics";
import { formatNumber, priceUnitSuffix } from "@/lib/terminal/format";
import { findMarket } from "@/lib/terminal/markets";
import type { PackageMarket } from "@/lib/terminal/types";
import type { FirmRfqQuote, RfqRequest } from "@/lib/internal-gateway/types";
import type { ChipTone } from "@/components/activity/ledger-ui";

export type RfqStatusId = "OPEN" | "SELECTED" | "EXECUTED" | "CANCELLED" | "EXPIRED";

export interface RankedQuote {
  quote: FirmRfqQuote;
  rank: number;
  isBest: boolean;
  isSelected: boolean;
  expired: boolean;
  expiresMs: number;
  /** Signed price improvement against the taker limit, in package price units. */
  improvement: number;
  /** Capacity as a share of the requested size, capped at one. */
  coverage: number;
}

export interface RfqView {
  request: RfqRequest;
  market: PackageMarket | null;
  action: "BUY" | "SELL";
  intentLabel: "Enter" | "Exit";
  sideLabel: "Long" | "Short";
  actionLabel: "Buy" | "Sell";
  createdMs: number;
  expiresMs: number;
  expired: boolean;
  active: boolean;
  status: RfqStatusId;
  quotes: RankedQuote[];
  best: RankedQuote | null;
  selected: FirmRfqQuote | null;
  makers: number;
}

export const STATUS_LABEL: Record<RfqStatusId, string> = {
  OPEN: "Open",
  SELECTED: "Quote selected",
  EXECUTED: "Executed",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired",
};

export const STATUS_TONE: Record<RfqStatusId, ChipTone> = {
  OPEN: "brand",
  SELECTED: "up",
  EXECUTED: "ink",
  CANCELLED: "muted",
  EXPIRED: "muted",
};

/**
 * The least time a quote (and its request) must have left to be selected: locking takes up to five wallet prompts,
 * and a quote that expires between them leaves a half-finished selection.
 */
export const MIN_SELECTION_TTL_MS = 20_000;

/** True when the quote or its request expires too soon to finish a selection; false once already expired. */
export function tooCloseToExpiry(quote: Pick<FirmRfqQuote, "expiresAt">, request: Pick<RfqRequest, "expiresAt">, now: number): boolean {
  const left = Math.min(Date.parse(quote.expiresAt), Date.parse(request.expiresAt)) - now;
  return left > 0 && left < MIN_SELECTION_TTL_MS;
}

/** Taker ranking: price for the side, then lower fee cap, then larger capacity. */
export function compareQuotes(a: FirmRfqQuote, b: FirmRfqQuote, action: "BUY" | "SELL"): number {
  const price = action === "BUY" ? a.packagePrice - b.packagePrice : b.packagePrice - a.packagePrice;
  if (price !== 0) return price;
  if (a.feeCap !== b.feeCap) return a.feeCap - b.feeCap;
  return b.capacityLots - a.capacityLots;
}

function parse(value: string): number {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

export function rfqView(request: RfqRequest, now: number): RfqView {
  const intent = request.authorization.intent;
  const candidate = findMarket(intent.marketId);
  const market = candidate.id === intent.marketId ? candidate : null;
  const action = executableAction(intent.side, intent.packageSide);
  const createdMs = parse(request.createdAt);
  const expiresMs = parse(request.expiresAt);
  const expired = expiresMs <= now;
  const openLike = request.state === "OPEN" || request.state === "SELECTED";
  const active = openLike && !expired;
  const status: RfqStatusId = openLike && expired ? "EXPIRED" : request.state;

  const withExpiry = request.quotes.map((quote) => {
    const quoteExpiresMs = parse(quote.expiresAt);
    return { quote, expiresMs: quoteExpiresMs, expired: quoteExpiresMs <= now };
  });
  // Best price for the taker: lowest ask when buying, highest bid when selling. Ties break on the
  // lower fee cap, then the larger capacity, so the order never depends on arrival.
  const ranked = [...withExpiry].sort((a, b) => compareQuotes(a.quote, b.quote, action));
  // While a request is live, only live quotes compete for best.
  const contenders = active ? ranked.filter((entry) => !entry.expired) : ranked;
  const bestId = contenders[0]?.quote.id ?? null;
  const quotes: RankedQuote[] = ranked.map((entry, index) => ({
    ...entry,
    rank: index + 1,
    isBest: entry.quote.id === bestId,
    isSelected: entry.quote.id === request.selectedQuoteId,
    improvement:
      action === "BUY"
        ? intent.limitPrice - entry.quote.packagePrice
        : entry.quote.packagePrice - intent.limitPrice,
    coverage: intent.lots > 0 ? Math.min(1, entry.quote.capacityLots / intent.lots) : 0,
  }));

  const selected = request.selectedQuoteId
    ? (request.quotes.find((quote) => quote.id === request.selectedQuoteId) ?? null)
    : null;

  return {
    request,
    market,
    action,
    intentLabel: intent.side === "ENTER" ? "Enter" : "Exit",
    sideLabel: intent.packageSide === "SHORT" ? "Short" : "Long",
    actionLabel: action === "BUY" ? "Buy" : "Sell",
    createdMs,
    expiresMs,
    expired,
    active,
    status,
    quotes,
    best: quotes.find((entry) => entry.isBest) ?? null,
    selected,
    makers: new Set(request.quotes.map((quote) => quote.solverLabel)).size,
  };
}

export function priceText(value: number, market: PackageMarket | null, withUnit = true): string {
  if (!market) return formatNumber(value, 2);
  const text = formatNumber(value, market.priceDecimals);
  return withUnit ? `${text} ${priceUnitSuffix(market.priceUnit)}` : text;
}

export function unitText(market: PackageMarket | null): string {
  return market ? priceUnitSuffix(market.priceUnit) : "";
}

export function signedPriceText(value: number, market: PackageMarket | null): string {
  const decimals = market ? market.priceDecimals : 2;
  const rounded = Number(value.toFixed(decimals));
  const sign = rounded > 0 ? "+" : rounded < 0 ? "-" : "±";
  return `${sign}${formatNumber(Math.abs(rounded), decimals)}`;
}

/* ------------------------------------------------------------------ */
/* Quote competition                                                   */
/* ------------------------------------------------------------------ */

export type ExclusionReason = "EXPIRED" | "CAPACITY" | "CLASS";

export interface CompetingQuote extends RankedQuote {
  /** Why the quote cannot be auto-ranked against the winner, or null when it competes. */
  exclusion: ExclusionReason | null;
  /** Signed improvement over the winner in price units; positive means better for the taker. */
  versusWinner: number | null;
}

export interface QuoteCompetition {
  /** The settlement class automatic ranking is confined to. */
  primaryClass: string | null;
  quotes: CompetingQuote[];
  eligible: CompetingQuote[];
  winner: CompetingQuote | null;
  runnerUp: CompetingQuote | null;
  /** Excluded quotes that beat the winner on price: shown as tradeoffs, never collapsed into a winner. */
  tradeoffs: CompetingQuote[];
}

export const EXCLUSION_COPY: Record<ExclusionReason, string> = {
  EXPIRED: "Quote expired",
  CAPACITY: "Capacity below requested size",
  CLASS: "Different settlement class",
};

/**
 * Ranks quotes only among the same settlement guarantee class and among quotes
 * that can execute the full size before they expire. Execution requires capacity
 * at least equal to the requested lots, so a smaller quote is excluded with that
 * reason rather than silently ranked.
 */
export function quoteCompetition(view: RfqView): QuoteCompetition {
  const lots = view.request.authorization.intent.lots;
  const live = view.quotes.filter((entry) => !entry.expired || !view.active);
  const classCounts = new Map<string, number>();
  for (const entry of live) {
    classCounts.set(entry.quote.settlementGuarantee, (classCounts.get(entry.quote.settlementGuarantee) ?? 0) + 1);
  }
  /* The primary class is the one most quotes share; ties go to the class of the best-ranked quote. */
  let primaryClass: string | null = null;
  let primaryCount = 0;
  for (const entry of live) {
    const count = classCounts.get(entry.quote.settlementGuarantee) ?? 0;
    if (count > primaryCount) {
      primaryClass = entry.quote.settlementGuarantee;
      primaryCount = count;
    }
  }
  const quotes: CompetingQuote[] = view.quotes.map((entry) => {
    const exclusion: ExclusionReason | null =
      view.active && entry.expired
        ? "EXPIRED"
        : entry.quote.capacityLots < lots
          ? "CAPACITY"
          : primaryClass !== null && entry.quote.settlementGuarantee !== primaryClass
            ? "CLASS"
            : null;
    return { ...entry, exclusion, versusWinner: null };
  });
  const eligible = quotes.filter((entry) => entry.exclusion === null);
  const winner = eligible[0] ?? null;
  for (const entry of quotes) {
    if (!winner) break;
    const delta = entry.quote.packagePrice - winner.quote.packagePrice;
    entry.versusWinner = view.action === "BUY" ? -delta : delta;
  }
  const tradeoffs = quotes.filter(
    (entry) => entry.exclusion !== null && entry.exclusion !== "EXPIRED" && winner !== null && (entry.versusWinner ?? 0) > 0,
  );
  return { primaryClass, quotes, eligible, winner, runnerUp: eligible[1] ?? null, tradeoffs };
}
