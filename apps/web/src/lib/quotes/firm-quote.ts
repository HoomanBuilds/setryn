import type { Address, Hex } from "viem";
import type { SerializedPublicOrder } from "@/lib/internal-gateway/protocol";
import type { BookRow } from "@/lib/terminal/types";
import type { OrderRiskAuthorization } from "./protocol";

/*
 * Firm streaming quotes as they travel from the maker's quote engine to the terminal (docs/runbooks/firm-quotes.md).
 * A firm quote is the maker's EIP-712 signed public order plus its signed risk authorization naming the settlement
 * router and the maker's onchain capacity; anyone holding it can settle it through QuoteSettlementRouter until its
 * deadline. Nothing here is authoritative: the router re-verifies every signature, nonce, deadline, price and the
 * remaining capacity onchain, and a quote that fails any of them simply does not settle.
 */

/** How long a quote is signed for. Short, so a moved reference never leaves a stale price executable for long. */
export const QUOTE_LIFETIME_SECONDS = 45;
/** Signing, relaying and inclusion take seconds, so a quote with less than this left is shown but not offered. */
export const EXECUTION_MARGIN_SECONDS = 6;
/** A quote within this long of its deadline is re-signed by the engine before it can drop below the margin. */
export const RENEW_BEFORE_SECONDS = 25;

export type SerializedRiskAuthorization = Omit<
  OrderRiskAuthorization,
  "maxOpenInterestBaseUnits" | "maxTerminalLiabilityBaseUnits" | "maxAdmissionDeadline" | "nonce" | "deadline"
> & {
  maxOpenInterestBaseUnits: string;
  maxTerminalLiabilityBaseUnits: string;
  maxAdmissionDeadline: string;
  nonce: string;
  deadline: string;
};

export interface FirmQuote {
  /** The maker order hash: unique per quote, and what a taker's terms name to accept exactly this quote. */
  id: Hex;
  marketId: string;
  /** The maker's side as a book shows it: a BID quote buys from the taker, an ASK quote sells to the taker. */
  side: "BID" | "ASK";
  priceTicks: string;
  price: number;
  /** The most lots one settlement may take; a quote settles once. */
  lots: number;
  /** Unix seconds: the signed order deadline, after which the router refuses the quote. */
  expiresAt: number;
  /** Unix milliseconds the engine signed it. */
  issuedAt: number;
  maker: Address;
  makerAccountId: Hex;
  capacityId: Hex;
  /** The maker signed consent that a taker may exit a position held against it with this quote, in one transaction. */
  allowsOffsetUnwind: boolean;
  /** Lots the maker's onchain capacity could still back when the quote was issued. */
  capacityRemainingLots: number;
  order: SerializedPublicOrder;
  orderSignature: Hex;
  risk: SerializedRiskAuthorization;
  riskSignature: Hex;
}

export type MarketQuoteStatus = "FIRM" | "INDICATIVE" | "UNAVAILABLE";

export interface MarketQuoteState {
  marketId: string;
  /** FIRM: signed, capacity-backed quotes. INDICATIVE: a reference price only. UNAVAILABLE: nothing to show. */
  status: MarketQuoteStatus;
  /** Why the market is not firm, in words a trader can read. */
  reason: string | null;
  /** Executable maker levels, best price first. */
  bids: FirmQuote[];
  asks: FirmQuote[];
  /** Best executable level retained for consumers that only need the touch. */
  bid: FirmQuote | null;
  ask: FirmQuote | null;
  /** The reference the maker priced from, with its source and age, shown beside every quote. */
  reference: { price: number; updatedAt: number; source: string } | null;
}

export interface FirmQuoteBook {
  /** Increments whenever any quote changes, so a stream sends only real updates. */
  version: number;
  /** Unix milliseconds the engine produced this book. */
  asOf: number;
  chainId: number;
  router: Address | null;
  maker: Address | null;
  markets: Record<string, MarketQuoteState>;
}

export function quoteSecondsLeft(quote: Pick<FirmQuote, "expiresAt">, nowMs: number): number {
  return quote.expiresAt - nowMs / 1000;
}

/** Whether a quote may still be offered for settlement: unexpired with time left to sign, relay and include it. */
export function quoteExecutable(quote: Pick<FirmQuote, "expiresAt">, nowMs: number): boolean {
  return quoteSecondsLeft(quote, nowMs) >= EXECUTION_MARGIN_SECONDS;
}

/**
 * The book rows a market's firm quotes contribute. Every row is labelled STREAM_FIRM; a quote too close to its deadline
 * stays visible as not executable, and an expired one is dropped, so an expired quote is never presented as liquidity.
 */
export function firmQuoteRows(state: MarketQuoteState | undefined, nowMs: number): BookRow[] {
  if (!state || state.status !== "FIRM") return [];
  const rows: BookRow[] = [];
  for (const quotes of [state.asks, state.bids]) {
    for (const [level, quote] of quotes.entries()) {
      if (!quote || quoteSecondsLeft(quote, nowMs) <= 0) continue;
      rows.push({
        // A renewed signature changes the quote hash, but it is still the same visible ladder level. Keeping the
        // row identity stable prevents React from replacing the element under the pointer on every renewal.
        id: `firm:${state.marketId}:${quote.side}:${level}`,
        side: quote.side,
        source: "STREAM_FIRM",
        price: quote.price,
        lots: quote.lots,
        firmness: "FIRM",
        executable: quoteExecutable(quote, nowMs),
        ttlSeconds: Math.max(0, Math.floor(quoteSecondsLeft(quote, nowMs))),
        origin: "Designated maker",
      });
    }
  }
  return rows;
}

/**
 * The firm quote a taker on `takerSide` would accept for `lots` within `limitPrice`: the opposite side's quote, if it is
 * executable, large enough, and no worse than the limit.
 */
export function acceptableQuote(
  state: MarketQuoteState | undefined,
  takerSide: "BUY" | "SELL",
  lots: number,
  limitPrice: number,
  nowMs: number,
): FirmQuote | null {
  if (!state || state.status !== "FIRM") return null;
  if (lots < 1) return null;
  const levels = takerSide === "BUY" ? state.asks : state.bids;
  return (
    levels.find(
      (quote) =>
        quoteExecutable(quote, nowMs) &&
        lots <= quote.lots &&
        (!Number.isFinite(limitPrice) || (takerSide === "BUY" ? quote.price <= limitPrice : quote.price >= limitPrice)),
    ) ?? null
  );
}

export function serializeRiskAuthorization(authorization: OrderRiskAuthorization): SerializedRiskAuthorization {
  return {
    ...authorization,
    maxOpenInterestBaseUnits: authorization.maxOpenInterestBaseUnits.toString(),
    maxTerminalLiabilityBaseUnits: authorization.maxTerminalLiabilityBaseUnits.toString(),
    maxAdmissionDeadline: authorization.maxAdmissionDeadline.toString(),
    nonce: authorization.nonce.toString(),
    deadline: authorization.deadline.toString(),
  };
}

const HEX32 = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const UNSIGNED = /^[0-9]+$/;

/** Parses a serialized authorization strictly; anything malformed throws, so a relayer never forwards garbage. */
export function parseRiskAuthorization(candidate: unknown): OrderRiskAuthorization {
  if (!candidate || typeof candidate !== "object") throw new Error("INVALID_RISK_AUTHORIZATION");
  const value = candidate as Record<string, unknown>;
  const hex32 = (key: string) => {
    const field = value[key];
    if (typeof field !== "string" || !HEX32.test(field)) throw new Error("INVALID_RISK_AUTHORIZATION");
    return field as Hex;
  };
  const unsigned = (key: string) => {
    const field = value[key];
    if (typeof field !== "string" || !UNSIGNED.test(field)) throw new Error("INVALID_RISK_AUTHORIZATION");
    return BigInt(field);
  };
  const binder = value.binder;
  const version = value.riskDomainVersion;
  if (typeof binder !== "string" || !ADDRESS.test(binder)) throw new Error("INVALID_RISK_AUTHORIZATION");
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) throw new Error("INVALID_RISK_AUTHORIZATION");
  return {
    orderHash: hex32("orderHash"),
    accountId: hex32("accountId"),
    riskDomainId: hex32("riskDomainId"),
    riskDomainVersion: version,
    maxOpenInterestBaseUnits: unsigned("maxOpenInterestBaseUnits"),
    maxTerminalLiabilityBaseUnits: unsigned("maxTerminalLiabilityBaseUnits"),
    maxAdmissionDeadline: unsigned("maxAdmissionDeadline"),
    binder: binder as Address,
    binderTerms: hex32("binderTerms"),
    nonce: unsigned("nonce"),
    deadline: unsigned("deadline"),
  };
}
