/*
 * The Setryn mark: one versioned methodology for the fair value of a capped (range) forward, used everywhere a price
 * is shown or quoted from (market headers, maker quotes, PnL, routes and charts), so none of them can disagree.
 *
 * Contract economics. A long pays `price - floor` per unit at the fill and receives `clamp(fixing, floor, cap) - floor`
 * at expiry, out of collateral the short locked. So the fair price is
 *
 *     mark = floor + DF(T) * ( E[ clamp(S_T, floor, cap) ] - floor )
 *
 * where E[clamp(S_T, floor, cap)] = F - Call(F, cap) + Put(F, floor) under Black-76 (undiscounted, lognormal forward),
 * F = S * exp((rate - carry) * T) is the underlying's forward to expiry, and DF(T) = exp(-rate * T) discounts a payoff
 * received at expiry for consideration paid now. At or after expiry T = 0 and the mark is the clamped spot. The result
 * is rounded to the market's tick and kept one tick inside the band, where every quote must lie.
 *
 * Inputs. Spot, floor, cap and expiry are observed (Chainlink and the listed series). Volatility, rate and carry come
 * from a versioned parameter set; the set in use is a testnet assumption, labelled MODELED, not observed market data.
 * Version 1 deliberately takes nothing from maker quotes or fills, so the mark cannot be moved by the house's own
 * quotes or by a single trade.
 */

export const MARK_METHODOLOGY = "SETRYN_CAPPED_FORWARD_MARK" as const;
export const MARK_METHODOLOGY_VERSION = 1;

const SECONDS_PER_YEAR = 365 * 86_400;

/** Model inputs for one underlying, annualised and continuously compounded. */
export interface UnderlyingModelInputs {
  /** Lognormal volatility of the underlying, 0.5 = 50%. */
  volatility: number;
  /** Carry (yield) of holding the underlying: staking, lease rate, the foreign rate for FX. F = S * e^((rate - carry) T). */
  carry: number;
}

/** A named, dated set of model inputs. Changing any input means publishing a new set, never editing one in place. */
export interface MarkParameterSet {
  id: string;
  /** MODELED: assumptions, not observations of any market. */
  provenance: "MODELED";
  effectiveFrom: string;
  description: string;
  /** USD rate: the forward's financing and the discount of the expiry payoff. */
  rate: number;
  underlyings: Readonly<Record<string, UnderlyingModelInputs>>;
}

/**
 * Testnet inputs. Round, conservative assumptions for an Arbitrum Sepolia demonstration; they are not calibrated to
 * any options market and must be replaced by an observed or calibrated set before the mark is used for real money.
 */
export const TESTNET_MARK_PARAMETERS: MarkParameterSet = {
  id: "testnet-2026-10-02",
  provenance: "MODELED",
  effectiveFrom: "2026-10-02",
  description: "Testnet assumptions, not calibrated to any market: a 4% USD rate and round volatility and carry per underlying.",
  rate: 0.04,
  underlyings: {
    BTC: { volatility: 0.5, carry: 0 },
    ETH: { volatility: 0.65, carry: 0.03 },
    ARB: { volatility: 0.8, carry: 0 },
    "EUR/USD": { volatility: 0.08, carry: 0.02 },
    "XAU/USD": { volatility: 0.16, carry: 0.005 },
  },
};

/** The parameter set the platform marks with. */
export const MARK_PARAMETERS: MarkParameterSet = TESTNET_MARK_PARAMETERS;

/** The listed terms the mark needs; both catalog and runtime markets map onto it. */
export interface MarkTerms {
  underlying: string;
  floor: number;
  cap: number;
  /** Unix seconds of the expiry (the fixing time). */
  expiryAt: number;
  tickSize: number;
  priceDecimals: number;
}

/** Everything that produced one mark, so any number on screen can be traced to its inputs and methodology. */
export interface MarkModel {
  methodology: typeof MARK_METHODOLOGY;
  version: number;
  parameterSet: string;
  provenance: "MODELED";
  spot: number;
  volatility: number;
  rate: number;
  carry: number;
  /** Years from the evaluation time to expiry; zero at or after expiry. */
  yearsToExpiry: number;
  forward: number;
  discountFactor: number;
  /** The model value before rounding to the tick grid. */
  value: number;
}

export interface MarkValue {
  /** The mark on the market's tick grid, one tick inside the band. */
  price: number;
  model: MarkModel;
}

/** Standard normal CDF (Abramowitz and Stegun 26.2.17, absolute error below 7.5e-8). */
export function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const density = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const tail = density * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - tail : tail;
}

/** E[clamp(S_T, floor, cap)] for a lognormal forward: F - Call(cap) + Put(floor), undiscounted Black-76. */
export function expectedClamp(forward: number, floor: number, cap: number, volatility: number, years: number): number {
  const deviation = volatility * Math.sqrt(years);
  if (!(deviation > 0)) return Math.min(cap, Math.max(floor, forward));
  const call = (strike: number) => {
    const d1 = (Math.log(forward / strike) + (deviation * deviation) / 2) / deviation;
    return forward * normalCdf(d1) - strike * normalCdf(d1 - deviation);
  };
  const put = (strike: number) => {
    const d1 = (Math.log(forward / strike) + (deviation * deviation) / 2) / deviation;
    return strike * normalCdf(deviation - d1) - forward * normalCdf(-d1);
  };
  return forward - call(cap) + (floor > 0 ? put(floor) : 0);
}

function roundToTick(value: number, terms: MarkTerms): number {
  const low = terms.floor + terms.tickSize;
  const high = terms.cap - terms.tickSize;
  const ticks = Math.round(Math.min(high, Math.max(low, value)) / terms.tickSize);
  return Number((ticks * terms.tickSize).toFixed(terms.priceDecimals));
}

/**
 * The mark of one capped forward from a spot reading at `atSeconds`, or null when the inputs cannot produce one (no
 * spot, an underlying the parameter set does not cover, or terms without room inside the band).
 */
export function cappedForwardMark(
  terms: MarkTerms,
  spot: number,
  atSeconds: number,
  parameters: MarkParameterSet = MARK_PARAMETERS,
): MarkValue | null {
  const inputs = parameters.underlyings[terms.underlying];
  if (!inputs || !(spot > 0) || !Number.isFinite(atSeconds)) return null;
  if (!(terms.cap > terms.floor) || !(terms.tickSize > 0) || terms.cap - terms.floor < 2 * terms.tickSize) return null;
  const years = Math.max(0, (terms.expiryAt - atSeconds) / SECONDS_PER_YEAR);
  const forward = spot * Math.exp((parameters.rate - inputs.carry) * years);
  const discountFactor = Math.exp(-parameters.rate * years);
  const expected = expectedClamp(forward, terms.floor, terms.cap, inputs.volatility, years);
  const value = terms.floor + discountFactor * (expected - terms.floor);
  if (!Number.isFinite(value)) return null;
  return {
    price: roundToTick(value, terms),
    model: {
      methodology: MARK_METHODOLOGY,
      version: MARK_METHODOLOGY_VERSION,
      parameterSet: parameters.id,
      provenance: parameters.provenance,
      spot,
      volatility: inputs.volatility,
      rate: parameters.rate,
      carry: inputs.carry,
      yearsToExpiry: years,
      forward,
      discountFactor,
      value,
    },
  };
}

/** A runtime (deployment) market's terms, or null when it lacks any the mark needs. */
export function runtimeMarkTerms(market: {
  underlying?: string;
  floor?: string;
  cap?: string;
  expiryAt?: number;
  priceScale: number;
  priceDecimals?: number;
}): MarkTerms | null {
  if (!market.underlying || market.floor === undefined || market.cap === undefined || market.expiryAt === undefined) return null;
  const floor = Number(market.floor);
  const cap = Number(market.cap);
  if (!Number.isFinite(floor) || !Number.isFinite(cap) || !(market.priceScale > 0)) return null;
  return {
    underlying: market.underlying,
    floor,
    cap,
    expiryAt: market.expiryAt,
    tickSize: 1 / market.priceScale,
    priceDecimals: market.priceDecimals ?? Math.round(Math.log10(market.priceScale)),
  };
}

/** One line describing the methodology and inputs, for tooltips and chart captions. */
export function describeMark(model: Pick<MarkModel, "version" | "parameterSet" | "volatility" | "rate" | "carry">): string {
  const percent = (value: number) => `${Number((value * 100).toFixed(2))}%`;
  return `Modeled mark, capped-forward v${model.version} (${model.parameterSet}): spot, floor, cap and time to expiry with ${percent(model.volatility)} volatility, ${percent(model.rate)} rate, ${percent(model.carry)} carry.`;
}
