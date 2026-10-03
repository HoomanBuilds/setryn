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
 *
 * Fill basis (version 2). Real trades then nudge the model toward where the expiry actually traded:
 *
 *     mark = model + confidence * basis
 *
 * where basis is the notional-weighted average of each fill's residual (fill price minus the model at the fill's own
 * time and spot), each weight halving every `halfLifeSeconds`, and confidence = W / (W + halfConfidenceNotional) for the
 * decayed weight W, so a little trading moves the mark a little. Every residual is clipped to `maxAdjustment` of the
 * model, so no fill, however far off, moves the mark further; the adjustment is clipped again against the current model.
 * Self-trades (one account on both sides) are excluded. Book quotes and maker midpoints are never inputs: the house maker
 * quotes around the mark, so its quotes would only return the mark. At expiry the basis is zero: the payoff is known.
 */

export const MARK_METHODOLOGY = "SETRYN_CAPPED_FORWARD_MARK" as const;
export const MARK_METHODOLOGY_VERSION = 2;

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
  methodologyVersion: 1 | 2;
  /** MODELED: assumptions, not observations of any market. */
  provenance: "MODELED";
  /** Unix seconds. Historical marks select the newest set effective at their evaluation time. */
  effectiveFrom: number;
  description: string;
  /** USD rate: the forward's financing and the discount of the expiry payoff. */
  rate: number;
  underlyings: Readonly<Record<string, UnderlyingModelInputs>>;
  basis: BasisParameters;
}

/** How fills adjust the model (version 2). */
export interface BasisParameters {
  /** A fill's weight halves every this many seconds. */
  halfLifeSeconds: number;
  /** Decayed USD notional at which the basis carries half its weight. */
  halfConfidenceNotional: number;
  /** Most the basis may move the mark, as a fraction of the model value; each residual is clipped to it too. */
  maxAdjustment: number;
}

const TESTNET_UNDERLYINGS: MarkParameterSet["underlyings"] = {
  BTC: { volatility: 0.5, carry: 0 },
  ETH: { volatility: 0.65, carry: 0.03 },
  ARB: { volatility: 0.8, carry: 0 },
  "EUR/USD": { volatility: 0.08, carry: 0.02 },
  "XAU/USD": { volatility: 0.16, carry: 0.005 },
};

const TESTNET_BASIS: BasisParameters = {
  halfLifeSeconds: 86_400,
  halfConfidenceNotional: 25_000,
  maxAdjustment: 0.02,
};

export const TESTNET_MARK_PARAMETERS_V1: MarkParameterSet = {
  id: "testnet-2026-10-01",
  methodologyVersion: 1,
  provenance: "MODELED",
  effectiveFrom: Date.parse("2026-10-01T00:00:00Z") / 1_000,
  description: "Initial testnet capped-forward model without an observed fill basis.",
  rate: 0.04,
  underlyings: TESTNET_UNDERLYINGS,
  basis: TESTNET_BASIS,
};

/** Testnet inputs. They are not calibrated and must be replaced before the mark is used for real money. */
export const TESTNET_MARK_PARAMETERS: MarkParameterSet = {
  id: "testnet-2026-10-03",
  methodologyVersion: 2,
  provenance: "MODELED",
  effectiveFrom: Date.parse("2026-10-03T00:00:00Z") / 1_000,
  description:
    "Testnet assumptions, not calibrated to any market: a 4% USD rate, round volatility and carry per underlying, and a fill basis with a one-day half-life, half weight at $25,000 of decayed notional and a 2% cap.",
  rate: 0.04,
  underlyings: TESTNET_UNDERLYINGS,
  basis: TESTNET_BASIS,
};

/** Append-only and ordered by effective time. Published entries are never edited or reordered. */
export const MARK_PARAMETER_SETS: readonly MarkParameterSet[] = [TESTNET_MARK_PARAMETERS_V1, TESTNET_MARK_PARAMETERS];

/** The current set, for controls that need its configured bounds rather than a historical selection. */
export const MARK_PARAMETERS: MarkParameterSet = MARK_PARAMETER_SETS[MARK_PARAMETER_SETS.length - 1];

/** The immutable methodology revision in force at an evaluation time. */
export function markParametersAt(atSeconds: number): MarkParameterSet | null {
  if (!Number.isFinite(atSeconds)) return null;
  for (let index = MARK_PARAMETER_SETS.length - 1; index >= 0; index -= 1) {
    const parameters = MARK_PARAMETER_SETS[index];
    if (atSeconds >= parameters.effectiveFrom) return parameters;
  }
  return null;
}

/** The listed terms the mark needs; both catalog and runtime markets map onto it. */
export interface MarkTerms {
  underlying: string;
  floor: number;
  cap: number;
  /** Unix seconds of the expiry (the fixing time). */
  expiryAt: number;
  /** Unix seconds the market opened. Charts never synthesize bars before it. */
  tradingStartsAt?: number;
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
  /** The capped-forward model value, before any basis and before rounding. */
  modelValue: number;
  /** The fill basis applied, or null when no fill informs the mark (or at expiry). */
  basis: MarkBasis | null;
  /** The mark before rounding to the tick grid: modelValue plus the basis adjustment. */
  value: number;
}

/** One fill as the basis sees it. */
export interface BasisFill {
  time: number;
  price: number;
  /** USD notional of the fill: lots x price x the contract multiplier. */
  notional: number;
  /** The model value (no basis, unrounded) at the fill's time, from the spot then in force. */
  modelValue: number;
}

/** The fill basis at one time. OBSERVED: it comes from executed trades, unlike the MODELED inputs. */
export interface MarkBasis {
  provenance: "OBSERVED_FILLS";
  /** Weighted mean residual (fill price minus model), in price units. */
  basis: number;
  /** W / (W + halfConfidenceNotional), from 0 to 1. */
  confidence: number;
  /** What the mark moved by: confidence x basis, clipped to maxAdjustment of the model. */
  adjustment: number;
  /** Decayed USD notional W behind the basis. */
  weight: number;
  fills: number;
  halfLifeSeconds: number;
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
 * The fill basis at `atSeconds` from fills at or before it (version 2), or null when no fill informs it. Fills older than
 * eight half-lives carry under 0.4% of their weight and are ignored.
 */
export function markBasis(
  fills: readonly BasisFill[],
  atSeconds: number,
  parameters: MarkParameterSet | null = markParametersAt(atSeconds),
): MarkBasis | null {
  if (!parameters || parameters.methodologyVersion < 2) return null;
  const { halfLifeSeconds, halfConfidenceNotional, maxAdjustment } = parameters.basis;
  const horizon = Math.max(parameters.effectiveFrom, atSeconds - 8 * halfLifeSeconds);
  let weight = 0;
  let weighted = 0;
  let count = 0;
  for (const fill of fills) {
    if (fill.time > atSeconds || fill.time < horizon) continue;
    if (!(fill.notional > 0) || !(fill.modelValue > 0) || !Number.isFinite(fill.price)) continue;
    const limit = maxAdjustment * fill.modelValue;
    const residual = Math.min(limit, Math.max(-limit, fill.price - fill.modelValue));
    const w = fill.notional * 0.5 ** ((atSeconds - fill.time) / halfLifeSeconds);
    weight += w;
    weighted += w * residual;
    count += 1;
  }
  if (count === 0 || !(weight > 0)) return null;
  const basis = weighted / weight;
  const confidence = weight / (weight + halfConfidenceNotional);
  return { provenance: "OBSERVED_FILLS", basis, confidence, adjustment: confidence * basis, weight, fills: count, halfLifeSeconds };
}

/**
 * The mark of one capped forward from a spot reading at `atSeconds`, or null when the inputs cannot produce one (no
 * spot, an underlying the parameter set does not cover, or terms without room inside the band). `basis` is the fill
 * basis at the same time (markBasis); it is ignored at expiry.
 */
export function cappedForwardMark(
  terms: MarkTerms,
  spot: number,
  atSeconds: number,
  parameters: MarkParameterSet | null = markParametersAt(atSeconds),
  basis: MarkBasis | null = null,
): MarkValue | null {
  if (!parameters) return null;
  const inputs = parameters.underlyings[terms.underlying];
  if (!inputs || !(spot > 0) || !Number.isFinite(atSeconds)) return null;
  if (!(terms.cap > terms.floor) || !(terms.tickSize > 0) || terms.cap - terms.floor < 2 * terms.tickSize) return null;
  const years = Math.max(0, (terms.expiryAt - atSeconds) / SECONDS_PER_YEAR);
  const forward = spot * Math.exp((parameters.rate - inputs.carry) * years);
  const discountFactor = Math.exp(-parameters.rate * years);
  const expected = expectedClamp(forward, terms.floor, terms.cap, inputs.volatility, years);
  const modelValue = terms.floor + discountFactor * (expected - terms.floor);
  if (!Number.isFinite(modelValue)) return null;
  // At expiry the payoff is known, so trading carries no information the clamp does not already hold.
  const applied = years > 0 && basis ? basis : null;
  const limit = parameters.basis.maxAdjustment * modelValue;
  const adjustment = applied ? Math.min(limit, Math.max(-limit, applied.adjustment)) : 0;
  const value = modelValue + adjustment;
  return {
    price: roundToTick(value, terms),
    model: {
      methodology: MARK_METHODOLOGY,
      version: parameters.methodologyVersion,
      parameterSet: parameters.id,
      provenance: parameters.provenance,
      spot,
      volatility: inputs.volatility,
      rate: parameters.rate,
      carry: inputs.carry,
      yearsToExpiry: years,
      forward,
      discountFactor,
      modelValue,
      basis: applied ? { ...applied, adjustment } : null,
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
  tradingStartsAt?: number;
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
    tradingStartsAt: market.tradingStartsAt,
    tickSize: 1 / market.priceScale,
    priceDecimals: market.priceDecimals ?? Math.round(Math.log10(market.priceScale)),
  };
}

/** One line describing the methodology and inputs, for tooltips and chart captions. */
export function describeMark(
  model: Pick<MarkModel, "version" | "parameterSet" | "volatility" | "rate" | "carry"> & { basis?: MarkBasis | null },
): string {
  const percent = (value: number) => `${Number((value * 100).toFixed(2))}%`;
  const base = `Mark, capped-forward v${model.version} (${model.parameterSet}): spot, floor, cap and time to expiry with ${percent(model.volatility)} volatility, ${percent(model.rate)} rate and ${percent(model.carry)} carry (MODELED inputs).`;
  const basis = model.basis;
  if (!basis) return `${base} No fill basis: no recent trade informs it.`;
  const sign = basis.adjustment >= 0 ? "+" : "-";
  return `${base} Fill basis ${sign}${Number(Math.abs(basis.adjustment).toPrecision(3))} from ${basis.fills} fill${basis.fills === 1 ? "" : "s"} (OBSERVED, ${percent(basis.confidence)} confidence, ${Math.round(basis.halfLifeSeconds / 3600)}h half-life).`;
}
