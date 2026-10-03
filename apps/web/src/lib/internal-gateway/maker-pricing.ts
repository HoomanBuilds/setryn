import { readReferenceQuotes } from "@/lib/market-data/reference";
import type { ReferenceQuote } from "@/lib/market-data/types";
import { readMarketDataSnapshot } from "@/lib/market-data/server";
import { cappedForwardMark, MARK_PARAMETERS, runtimeMarkTerms, type MarkBasis, type MarkModel } from "@/lib/pricing/mark";
import type { SetrynRuntimeMarket } from "./runtime";
import { priceOffset } from "./runtime-markets";

/*
 * The designated maker's two-sided price for a dated range forward: centred on the platform's mark (the same
 * capped-forward methodology and fill basis every screen shows, lib/pricing/mark.ts), so each expiry is quoted at its own
 * fair value rather than at spot. The basis comes from the market-data snapshot; without one the model alone centres it. Bid and ask sit at mark x (1 -/+ 0.001) or at least two ticks apart, on the market's tick grid
 * and strictly inside its (floor, cap) range. A market without a listing, without a fresh Chainlink spot, or without
 * model inputs for its underlying is not quoted.
 */

/** Half-spread around the mark, as a fraction of it. */
export const MAKER_HALF_SPREAD = 0.001;
/**
 * A reference older than this is not quoted against. The Arbitrum One aggregators update on a deviation threshold with
 * a 24-hour heartbeat, so an older answer is still within its threshold of the market; past the heartbeat plus a
 * margin the feed is treated as down (FX and gold also stop over the weekend, when the maker stops quoting them).
 */
export const MAX_REFERENCE_AGE_SECONDS = 26 * 60 * 60;
const MIN_SPREAD_TICKS = BigInt(2);

export type MakerPricingErrorCode = "LISTING_UNSUPPORTED" | "REFERENCE_UNAVAILABLE" | "QUOTE_OUTSIDE_RANGE" | "MARK_UNAVAILABLE";

export class MakerPricingError extends Error {
  readonly code: MakerPricingErrorCode;
  readonly status: number;
  readonly detail: string;

  constructor(code: MakerPricingErrorCode, detail: string) {
    super(code);
    this.name = "MakerPricingError";
    this.code = code;
    this.status = code === "REFERENCE_UNAVAILABLE" ? 503 : 409;
    this.detail = detail;
  }
}

export interface MakerQuote {
  marketKey: string;
  reference: ReferenceQuote;
  /** The modeled mark the quote is centred on, and its inputs. */
  mark: number;
  markModel: MarkModel;
  /** Onchain price ticks (relative to the floor) of the maker's bid and ask. */
  bidTicks: bigint;
  askTicks: bigint;
}

/** Ticks of the cap above the floor: the top of the market's price grid. */
function capTicks(market: SetrynRuntimeMarket): bigint {
  return BigInt(Math.round((Number(market.cap) - priceOffset(market)) * market.priceScale));
}

/** Prices one market from a reference reading; pure, so a batch of markets shares one read. */
export function quoteFromReference(
  market: SetrynRuntimeMarket,
  reference: ReferenceQuote | undefined,
  nowSeconds: number,
  basis: MarkBasis | null = null,
): MakerQuote {
  if (!market.underlying || market.floor === undefined || market.cap === undefined || market.priceOffset === undefined) {
    throw new MakerPricingError("LISTING_UNSUPPORTED", `${market.marketKey} has no network listing to price from.`);
  }
  if (!reference || !(reference.price > 0)) {
    throw new MakerPricingError("REFERENCE_UNAVAILABLE", `No reference price is available for ${market.underlying}.`);
  }
  if (nowSeconds - reference.updatedAt > MAX_REFERENCE_AGE_SECONDS) {
    throw new MakerPricingError("REFERENCE_UNAVAILABLE", `The ${market.underlying} reference is older than its 24-hour heartbeat.`);
  }
  const offset = priceOffset(market);
  const scale = market.priceScale;
  const top = capTicks(market);
  // Floor and cap are excluded, and a two-tick spread needs room: bid >= 1, ask <= top - 1, ask - bid >= 2.
  if (top < BigInt(4)) throw new MakerPricingError("QUOTE_OUTSIDE_RANGE", `${market.marketKey} has no room between floor and cap.`);
  // The quote is centred on the modeled mark, never on spot: a capped forward's fair value depends on its expiry.
  const terms = runtimeMarkTerms(market);
  const modeled = terms ? cappedForwardMark(terms, reference.price, nowSeconds, MARK_PARAMETERS, basis) : null;
  if (!modeled) throw new MakerPricingError("MARK_UNAVAILABLE", `${market.marketKey} has no model inputs for ${market.underlying}.`);
  const fair = modeled.price;
  const fairTicks = BigInt(Math.round((fair - offset) * scale));
  // The bid rounds down and the ask up, so rounding never narrows the spread.
  let bid = BigInt(Math.floor((fair * (1 - MAKER_HALF_SPREAD) - offset) * scale + 1e-9));
  let ask = BigInt(Math.ceil((fair * (1 + MAKER_HALF_SPREAD) - offset) * scale - 1e-9));
  if (ask - bid < MIN_SPREAD_TICKS) {
    bid = bid < fairTicks - BigInt(1) ? bid : fairTicks - BigInt(1);
    ask = ask > fairTicks + BigInt(1) ? ask : fairTicks + BigInt(1);
  }
  // Strictly inside (floor, cap): a reference beyond either bound quotes at the edge of the range.
  const minBid = BigInt(1);
  const maxAsk = top - BigInt(1);
  if (bid < minBid) bid = minBid;
  if (bid > maxAsk - MIN_SPREAD_TICKS) bid = maxAsk - MIN_SPREAD_TICKS;
  if (ask < bid + MIN_SPREAD_TICKS) ask = bid + MIN_SPREAD_TICKS;
  if (ask > maxAsk) ask = maxAsk;
  return { marketKey: market.marketKey, reference, mark: modeled.price, markModel: modeled.model, bidTicks: bid, askTicks: ask };
}

/** The maker's quotes for every requested market from one reference read; a market that cannot be priced maps to its error. */
export async function makerQuotes(markets: readonly SetrynRuntimeMarket[]): Promise<Map<string, MakerQuote | MakerPricingError>> {
  const underlyings = [...new Set(markets.map((market) => market.underlying).filter((value): value is string => Boolean(value)))];
  let references: Record<string, ReferenceQuote> = {};
  if (underlyings.length > 0) {
    references = await readReferenceQuotes(underlyings).catch(() => ({}));
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  // The fill basis each market's mark carries, from the same snapshot the screens read.
  const snapshot = await readMarketDataSnapshot().catch(() => null);
  const bases = new Map((snapshot?.markets ?? []).map((live) => [live.marketKey, live.markModel?.basis ?? null]));
  const quotes = new Map<string, MakerQuote | MakerPricingError>();
  for (const market of markets) {
    try {
      const reference = market.underlying ? references[market.underlying] : undefined;
      quotes.set(market.marketKey, quoteFromReference(market, reference, nowSeconds, bases.get(market.marketKey) ?? null));
    } catch (error) {
      if (error instanceof MakerPricingError) quotes.set(market.marketKey, error);
      else throw error;
    }
  }
  return quotes;
}

/** One market's maker quote, or the MakerPricingError that refuses it. */
export async function makerQuote(market: SetrynRuntimeMarket): Promise<MakerQuote> {
  const result = (await makerQuotes([market])).get(market.marketKey);
  if (!result) throw new MakerPricingError("REFERENCE_UNAVAILABLE", `No reference price is available for ${market.marketKey}.`);
  if (result instanceof MakerPricingError) throw result;
  return result;
}

/** A route's refusal for an unpriceable market. */
export function makerPricingResponse(error: unknown): Response | null {
  if (!(error instanceof MakerPricingError)) return null;
  return Response.json({ error: error.code, message: error.detail }, { status: error.status, headers: { "Cache-Control": "no-store" } });
}
