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
  // Best price for the taker: lowest ask when buying, highest bid when selling.
  const better = (a: number, b: number) => (action === "BUY" ? a - b : b - a);
  const ranked = [...withExpiry].sort((a, b) => better(a.quote.packagePrice, b.quote.packagePrice));
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
