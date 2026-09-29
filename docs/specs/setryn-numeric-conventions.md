# Setryn Numeric Conventions

This document fixes the canonical units and the pure financial arithmetic of the Setryn protocol. It
covers `contracts/src/types/Units.sol` and the four libraries in `contracts/src/libraries/`:
`FixedPointLib`, `NotionalLib`, `DecimalScaleLib`, and `AllocationLib`.

These conventions are frozen. A rule here is replaced by a new versioned rule, never edited in place.

## Canonical units

| Type | Width | Meaning |
| --- | --- | --- |
| `Lots` | `uint128` | Quantity of a package. Always nonnegative. |
| `PriceTicks` | `int128` | Signed price in ticks. |
| `TickSizeMinor` | `uint128` | Strictly positive minor-unit value of one tick of one lot. |
| `Rate` | `uint64` | Dimensionless ratio scaled by `WAD`. |
| `PackagePrice` | `int256` | Money in quote-asset minor units, buyer perspective. |

`Lots` is unsigned because direction is never encoded in a quantity. Direction is carried separately
by `Side`, so one quantity type describes both legs of a trade without a sign trap.

`PriceTicks` is signed because package prices, spreads, forward points, and rates all trade through
zero. A negative tick count is an ordinary quote, not an error sentinel.

`TickSizeMinor` carries the entire money scale of a market, which is why price itself stays a small
signed integer. A zero tick size is a malformed market and reverts with `ZeroTickSize`.

## Scales

- `WAD = 1e18` is the single fixed-point scale for dimensionless ratios. Money is never WAD scaled;
  money is always an integer count of quote-asset minor units.
- `BPS_DENOMINATOR = 1e4` and `WAD_PER_BPS = 1e14`. Basis points convert to WAD exactly in both
  directions. `RateLib.toBps` reverts with `InexactBpsConversion` rather than truncating a rate that
  was never expressible in basis points.
- `MAX_DECIMALS = 36` bounds every decimal exponent. It keeps `10 ** decimals` and the difference of
  two decimals far inside `uint256`, so a rescale can only fail on the magnitude of the amount.

## Rate is not capped at one WAD

`Rate` carries leverage factors, growth factors, and multipliers, all of which legitimately exceed
100 percent. The type imposes no upper bound beyond its own width.

A caller that genuinely splits a whole asserts the bound itself through `RateLib.requireAtMostOne`,
which reverts with `RateAboveOne`. `AllocationLib.allocateRate` and `AllocationLib.allocateFixedRates`
are the callers that do so.

## Rounding

Every rounding direction is named at the call site. There is no unnamed default, because a rounding
direction chosen by omission is how a protocol leaks value.

- Unsigned: `mulDivDown`, `mulDivUp`, and the `mulWad` / `divWad` pairs.
- Unsigned by `Rate`: `applyRateDown` and `applyRateUp` take the `Rate` type rather than a raw
  `uint64`, unwrap it internally, and divide by `WAD`. They are the only sanctioned way to apply a
  rate to an amount, so a rate can never be passed where a WAD-scaled amount is expected.
- Signed: `mulDivSignedFloor` (toward negative infinity), `mulDivSignedCeil` (toward positive
  infinity), `mulDivSignedTrunc` (toward zero), `mulDivSignedExpand` (away from zero).

Floor and ceil are directions on the number line, not on the magnitude, so flooring a negative
quotient rounds its magnitude up.

Signed `mulDiv` takes a positive `uint256` denominator. A negative denominator only expresses a sign
that belongs on the numerator, and allowing it would give two encodings for one quotient.

`FixedPointLib.toSigned` reapplies the sign inside an unchecked negation, so a result may land
exactly on `type(int256).min` instead of reverting one step short of it.

## Fill notional

Exact fill notional is `lots * priceTicks * tickSizeMinor`, in quote-asset minor units. There is no
division and therefore no rounding decision. The result carries the sign of the price alone.

`fillNotional` is not yet a cash flow for either party. Converting a notional into a directed debit
or credit needs `Side`, which belongs to the module that knows which party is being accounted for.

Two overflow boundaries are both named rather than left to panic: a product leaving `uint256`, and a
product that fits `uint256` but not the signed result type. Both revert with `NotionalOverflow`.

## Decimal rescaling

`DecimalScaleLib` validates both the source and the target decimals on every call, so a malformed
asset definition fails at the boundary instead of producing an amount wrong by orders of magnitude.
Out-of-range decimals revert with `DecimalsOutOfRange`.

Widening is exact and can only fail on overflow (`RescaleOverflow`). Narrowing discards precision and
is only reachable through an entry point that names its direction: `rescaleDown`, `rescaleUp`,
`rescaleSignedFloor`, `rescaleSignedCeil`.

## Allocation

Two operations that must never be confused.

`allocateProRata(total, weights)` is a **normalized** split. Weights are divided by their own sum, so
they carry no unit and no scale, and doubling every weight changes nothing. The parts distribute the
entire total apart from the integer residual left by flooring, and that residual is strictly smaller
than the number of claimants.

`allocateFixedRates(total, rates)` is a **fixed-share** split. Each `Rate` is an absolute WAD-scaled
fraction of the total, floored on its own against `WAD`. The rates are never normalized. Rates
summing to less than one WAD deliberately leave value undistributed, and that undistributed value is
returned in the residual together with the rounding remainder. Normalizing here would silently
inflate every share and turn a deliberate 30 percent payout into the whole pot. A rate sum above one
WAD reverts with `FixedRateSumAboveOne`.

`allocateRate(total, rate)` is the one-share case of the same rule, without the array.

Both array forms floor every part and return the leftover as an explicit residual. **No allocation
ever assigns the residual.** Who absorbs it is a policy question with a different answer for fees,
for settlement, and for liquidation waterfalls, so a library that assigned it would move that
decision out of sight of the module that owns it.

## Deliberately out of scope

Oracle price to tick conversion is not implemented. Benchmark feed scale, quote asset decimals, tick
schedule, and fixing conventions are not defined yet, and freezing that cross-module API before they
are would freeze it wrong.
