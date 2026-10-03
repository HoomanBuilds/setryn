# Setryn Mark Methodology

Status: version 2, testnet. Source of truth: `apps/web/src/lib/pricing/mark.ts`.

Every Setryn price that is not a fill is one mark, computed one way. It feeds market headers and lists, 24h change,
maker quotes, PnL and position values, routes, alerts, the public API and the chart. Each expiry is marked on its own
terms, so two dates on one underlying never share a number.

## Contract and model

A long pays `price - floor` per unit at the fill and receives `clamp(fixing, floor, cap) - floor` at expiry. The model
value is the fair price of that claim:

```
model = floor + DF(T) * ( E[clamp(S_T, floor, cap)] - floor )

E[clamp(S_T, floor, cap)] = F - Call76(F, cap) + Put76(F, floor)      (undiscounted Black-76)
F  = S * exp((rate - carry) * T)
DF = exp(-rate * T)
T  = max(0, expiry - evaluation time) in years of 365 days
```

## Fill basis (version 2)

Executed trades then pull the model toward where the expiry actually traded:

```
mark     = model + adjustment
residual = clip(fill price - model at the fill's own time and spot, ±maxAdjustment x model)
basis    = sum(w * residual) / sum(w),     w = notional x 0.5^(age / halfLife)
adjustment = clip(confidence x basis, ±maxAdjustment x model),   confidence = W / (W + halfConfidenceNotional)
```

`W` is the decayed notional. A little trading moves the mark a little, and heavy recent trading moves it close to the
traded level, never more than `maxAdjustment` away from the model.

- **Self-trades are excluded:** one account on both sides is not a price.
- **Fills older than eight half-lives are ignored:** they carry under 0.4% of their weight.
- **No basis at expiry:** the payoff is then known.

Book quotes and maker midpoints are never inputs. The house maker quotes around the mark, so its quotes would only
return the mark. Fills at the house's own quotes do count. Persistent one-sided demand lifts the mark by at most the
cap, and the effect decays with the half-life once the flow stops.

The result is rounded to the market's tick and held one tick inside `(floor, cap)`, where every quote must lie.

## Inputs

| Input | Source | Provenance |
| --- | --- | --- |
| Spot `S` | Chainlink feed of the underlying on Arbitrum One, read-only | Observed |
| Floor, cap, expiry, tick | The listed series | Observed |
| Fills | The deployment's `FillCleared` events | Observed |
| Volatility, rate, carry, basis parameters | Versioned parameter set | MODELED |

Parameter set `testnet-2026-10-03`: rate 4%, and the basis has a 24-hour half-life, half weight at $25,000 of decayed
notional, and a 2% cap.

| Underlying | Volatility | Carry |
| --- | --- | --- |
| BTC | 50% | 0% |
| ETH | 65% | 3% |
| ARB | 80% | 0% |
| EUR/USD | 8% | 2% |
| XAU/USD | 16% | 0.5% |

These are round testnet assumptions, not calibrated to any options market, and they are labelled MODELED wherever the
mark appears. A change to any input is published as a new parameter set; a set is never edited in place. An underlying
the set does not cover has no mark (`markSource: NONE`) rather than a guessed one.

Market-implied analytics (implied carry, basis, forward points) come from the last traded price, not the mark, because
the mark would only return the model's own inputs.

## Time

- **24h change:** compares the current mark with the same mark 24 hours earlier: the spot then, the time to expiry then,
  and the basis from the fills before then. It shows as unknown, not 0%, when that spot is not available.
- **After expiry:** the mark is the clamp of the Chainlink reading in force at expiry (the fixing reading), not
  today's spot.

## Chart

The bars are always the market's own mark, before and after any trade. Each bar spans four points:

- the mark at the bar's open, from the reading then in force;
- the mark at the bar's highest and lowest readings, each at its own time;
- the mark at the bar's close.

The mark rises with spot at any one time, so these points bound the bar. A bar with no fresh reading (older than the
feed's heartbeat plus an hour), or one overlapping a hole in the stored rounds, is a gap: an empty slot, never a
carried price. Beside the bars:

- fills are markers at their actual prices, coloured by aggressor side, with the lots traded in each bar as volume;
- the Chainlink spot is a faint labelled line on the same scale, kept out of the autoscale;
- floor and cap are price lines, pinned to the pane edge when off screen, and `band` fits them into the scale;
- the best bid and ask are labels on the price scale. A drawn bid/ask ribbon waits for a public book with depth: with
  one maker at a fixed spread it would say nothing;
- the expiry is a vertical line.

## Data

Rounds and fills are stored in Supabase by the market-data ingester ([runbook](../runbooks/market-data.md)). Marks and
candles are computed on read, so a new parameter set or version applies to all history at once and nothing has to be
migrated. Without the database the app reads the same inputs from chain over a shorter window, and says so.

## Changes

| Version | Set | Change |
| --- | --- | --- |
| 1 | testnet-2026-10-02 | Capped-forward model from MODELED volatility, rate and carry |
| 2 | testnet-2026-10-03 | Adds the capped, decaying fill basis. Past expiry the mark uses the fixing reading. Gaps instead of carried prices |

## Known limits

- The inputs are testnet assumptions. They must be replaced with an observed or calibrated set before the mark is
  used for real money.
- After expiry, the mark uses the Chainlink reading at expiry until the protocol's own fixing is final. It does not
  read the finalized fixing yet.
