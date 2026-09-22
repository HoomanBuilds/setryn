// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

/// @dev WAD is the single fixed-point scale for dimensionless ratios. Money is never WAD scaled;
/// money is always an integer count of quote-asset minor units.
uint256 constant WAD = 1e18;

uint256 constant BPS_DENOMINATOR = 1e4;

/// @dev PPM_DENOMINATOR is the single denominator for every fee rate in this protocol. Parts per
/// million is the professional fee precision: one tenth of a basis point is expressible exactly, so
/// a venue never has to round a quoted maker rebate or taker charge to fit the encoding. It is
/// published as an inspectable constant precisely so an offchain quoting engine and an onchain fee
/// model can never disagree about the scale a stored rate was written in.
uint256 constant PPM_DENOMINATOR = 1e6;

/// @dev Basis points convert to WAD exactly because 1e18 divides into 1e4 equal integer steps, so a
/// rate expressed in basis points never loses precision in either direction.
uint256 constant WAD_PER_BPS = 1e14;

/// @dev MAX_DECIMALS bounds every decimal exponent this protocol will rescale by. It keeps both
/// 10 ** decimals and 10 ** (decimalsA - decimalsB) far inside uint256, so a rescale can only fail
/// on the magnitude of the amount and never on the exponent itself.
uint8 constant MAX_DECIMALS = 36;

error LotsOverflow(uint256 lots);

error PriceTicksOverflow(int256 priceTicks);

error ZeroTickSize();

error RateOverflow(uint256 value);

error InexactBpsConversion(uint64 rate);

error RateAboveOne(uint64 rate);

/// @dev Lots is an unsigned quantity. Direction is never encoded in a lot count; it is carried
/// separately by Side, so one quantity type can describe both legs of a trade without a sign trap.
type Lots is uint128;

/// @dev PriceTicks is signed because package prices, spreads, forward points, and rates all trade
/// through zero. A negative tick count is an ordinary quote, not an error sentinel.
type PriceTicks is int128;

/// @dev TickSizeMinor is the strictly positive quote-asset minor-unit value of one tick of one lot.
/// It carries the entire money scale of a market, so price itself stays a small signed integer.
type TickSizeMinor is uint128;

/// @dev Rate is a dimensionless WAD-scaled ratio. It is deliberately not capped at one WAD, because
/// leverage factors, growth factors, and multipliers are legitimate rates above 100 percent. A
/// caller that genuinely needs a share of a whole must assert that bound itself.
type Rate is uint64;

/// @dev FeeRatePpm is an unsigned fee rate against PPM_DENOMINATOR. It is deliberately unsigned:
/// a charge and a rebate are two separate nonnegative bounds rather than one signed number, so a
/// sign flip can never turn a fee the protocol collects into a fee the protocol pays. uint32 holds
/// four thousand times the whole, so a rate can never overflow its own scale, and a product of a
/// rate with a uint128 money amount stays far inside uint256.
type FeeRatePpm is uint32;

library FeeRatePpmLib {
    function unwrap(FeeRatePpm rate) internal pure returns (uint256) {
        return uint256(FeeRatePpm.unwrap(rate));
    }

    function isZero(FeeRatePpm rate) internal pure returns (bool) {
        return FeeRatePpm.unwrap(rate) == 0;
    }

    /// @dev A fee rate is meant to be a share of a whole, but raw UDVT wrapping cannot enforce that
    /// semantics: any uint32 can be wrapped. FeeScheduleDefinitionLib validates the at-most-one
    /// bound on the definitions it accepts; any other consumer must call isAtMostOne or apply its
    /// own exact validation before using a raw value.
    function isAtMostOne(FeeRatePpm rate) internal pure returns (bool) {
        return uint256(FeeRatePpm.unwrap(rate)) <= PPM_DENOMINATOR;
    }
}

library LotsLib {
    function unwrap(Lots lots) internal pure returns (uint256) {
        return uint256(Lots.unwrap(lots));
    }

    function isZero(Lots lots) internal pure returns (bool) {
        return Lots.unwrap(lots) == 0;
    }

    function fromUint256(uint256 lots) internal pure returns (Lots) {
        if (lots > type(uint128).max) {
            revert LotsOverflow(lots);
        }
        return Lots.wrap(uint128(lots));
    }
}

library PriceTicksLib {
    function unwrap(PriceTicks priceTicks) internal pure returns (int256) {
        return int256(PriceTicks.unwrap(priceTicks));
    }

    function isZero(PriceTicks priceTicks) internal pure returns (bool) {
        return PriceTicks.unwrap(priceTicks) == 0;
    }

    function isPositive(PriceTicks priceTicks) internal pure returns (bool) {
        return PriceTicks.unwrap(priceTicks) > 0;
    }

    function isNegative(PriceTicks priceTicks) internal pure returns (bool) {
        return PriceTicks.unwrap(priceTicks) < 0;
    }

    /// @dev Widening to int256 before taking the magnitude keeps the most negative tick count
    /// representable, so the minimum price is an ordinary value rather than a revert.
    function abs(PriceTicks priceTicks) internal pure returns (uint256) {
        int256 widened = int256(PriceTicks.unwrap(priceTicks));
        return widened < 0 ? uint256(-widened) : uint256(widened);
    }

    function fromInt256(int256 priceTicks) internal pure returns (PriceTicks) {
        if (priceTicks < type(int128).min || priceTicks > type(int128).max) {
            revert PriceTicksOverflow(priceTicks);
        }
        return PriceTicks.wrap(int128(priceTicks));
    }
}

library TickSizeMinorLib {
    function unwrap(TickSizeMinor tickSize) internal pure returns (uint256) {
        return uint256(TickSizeMinor.unwrap(tickSize));
    }

    function isZero(TickSizeMinor tickSize) internal pure returns (bool) {
        return TickSizeMinor.unwrap(tickSize) == 0;
    }

    function requirePositive(TickSizeMinor tickSize) internal pure returns (uint256) {
        uint256 raw = uint256(TickSizeMinor.unwrap(tickSize));
        if (raw == 0) {
            revert ZeroTickSize();
        }
        return raw;
    }
}

library RateLib {
    function unwrap(Rate rate) internal pure returns (uint256) {
        return uint256(Rate.unwrap(rate));
    }

    function isZero(Rate rate) internal pure returns (bool) {
        return Rate.unwrap(rate) == 0;
    }

    function fromWad(uint256 wad) internal pure returns (Rate) {
        if (wad > type(uint64).max) {
            revert RateOverflow(wad);
        }
        return Rate.wrap(uint64(wad));
    }

    function fromBps(uint256 bps) internal pure returns (Rate) {
        if (bps > uint256(type(uint64).max) / WAD_PER_BPS) {
            revert RateOverflow(bps);
        }
        return Rate.wrap(uint64(bps * WAD_PER_BPS));
    }

    /// @dev Reverts rather than truncating, so a rate that was never expressible in basis points can
    /// never be silently rounded into one.
    function toBps(Rate rate) internal pure returns (uint256) {
        uint64 raw = Rate.unwrap(rate);
        if (raw % WAD_PER_BPS != 0) {
            revert InexactBpsConversion(raw);
        }
        return uint256(raw) / WAD_PER_BPS;
    }

    function isAtMostOne(Rate rate) internal pure returns (bool) {
        return uint256(Rate.unwrap(rate)) <= WAD;
    }

    /// @dev The opt-in bound for callers that split a whole. It is a helper and not a property of
    /// the Rate type, because most rates in this protocol may legitimately exceed one WAD.
    function requireAtMostOne(Rate rate) internal pure returns (uint256) {
        uint64 raw = Rate.unwrap(rate);
        if (uint256(raw) > WAD) {
            revert RateAboveOne(raw);
        }
        return uint256(raw);
    }
}
