# Setryn Mark Methodology

Status: version 1, testnet. Source of truth: `apps/web/src/lib/pricing/mark.ts`.

Every Setryn price that is not a fill is one mark, computed one way: market headers and lists, 24h change, maker
quotes, PnL and position values, routes, alerts, the public API and the chart. Each expiry is marked on its own terms,
so two dates on one underlying never share a number.

## Contract and formula

A long pays `price - floor` per unit at the fill and receives `clamp(fixing, floor, cap) - floor` at expiry. The mark
is the fair price of that claim:

```
mark = floor + DF(T) * ( E[clamp(S_T, floor, cap)] - floor )

E[clamp(S_T, floor, cap)] = F - Call76(F, cap) + Put76(F, floor)      (undiscounted Black-76)
F  = S * exp((rate - carry) * T)
DF = exp(-rate * T)
T  = max(0, expiry - evaluation time) in years of 365 days
```

The result is rounded to the market's tick and held one tick inside `(floor, cap)`, where every quote must lie. At or
after expiry `T = 0` and the mark is the clamped spot.

## Inputs

| Input | Source | Provenance |
| --- | --- | --- |
| Spot `S` | Chainlink feed of the underlying on Arbitrum One, read-only | Observed |
| Floor, cap, expiry, tick | The listed series | Observed |
| Volatility, rate, carry | Versioned parameter set | MODELED |

Parameter set `testnet-2026-10-02` (rate 4%):

| Underlying | Volatility | Carry |
| --- | --- | --- |
| BTC | 50% | 0% |
| ETH | 65% | 3% |
| ARB | 80% | 0% |
| EUR/USD | 8% | 2% |
| XAU/USD | 16% | 0.5% |

These are round testnet assumptions, not calibrated to any options market, and are labelled MODELED wherever the mark
appears. A change to any input is published as a new parameter set; a set is never edited in place. An underlying the
set does not cover has no mark (`markSource: NONE`) rather than a guessed one.

## What the mark does not use

Version 1 takes nothing from maker quotes, book midpoints or fills. The house maker quotes around the mark, so a mark
built from its own quotes would be circular, and a single trade must not move every position's value. Book prices and
fills are shown beside the mark and never replace it.

Market-implied analytics (implied carry, basis, forward points) come from the last traded price, not the mark, because
the mark would only return the model's own inputs.

## 24h change

The 24h change compares the current mark with the same model evaluated 24 hours earlier, at the spot in force then and
the time to expiry then. While that spot is not yet in the server's reference history, the change shows as unknown
rather than 0%.

## Chart

The chart's bars are always the market's own mark, evaluated at every Chainlink round at that round's time to expiry,
before and after any trade. Beside them:

- fills are markers at their actual prices, coloured by aggressor side, with the lots traded in each bar as volume;
- the Chainlink spot is a faint labelled line on the same scale, kept out of the autoscale;
- floor and cap are price lines, pinned to the pane edge when they are outside the visible range, and the `band`
  control fits them into the scale.

An expired market's chart ends at its expiry.

## Known limits of version 1

- Chart history and the 24h prior are rebuilt from Chainlink rounds held in server memory. Durable storage is a later
  slice.
- After expiry and before settlement the mark is the clamped current spot, not the fixing.
- Testnet inputs must be replaced with an observed or calibrated set before the mark is used for real money.
