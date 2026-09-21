// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SignedMath} from "@openzeppelin/contracts/utils/math/SignedMath.sol";

import {Rate, RateLib, WAD} from "../types/Units.sol";

error DivisionByZero();

error MulDivOverflow(uint256 x, uint256 y, uint256 denominator);

error SignedCastOverflow(uint256 magnitude, bool negative);

/// @dev Full-precision multiply-then-divide with an explicitly named rounding direction on every
/// entry point. There is no unnamed default, because a rounding direction chosen by omission is how
/// a protocol leaks value.
///
/// @dev Signed denominators are rejected by construction: every signed entry point takes a uint256
/// denominator. A negative denominator only ever expresses a sign that belongs on the numerator, and
/// allowing it would give two encodings for one quotient.
library FixedPointLib {
    function mulDivDown(uint256 x, uint256 y, uint256 denominator) internal pure returns (uint256) {
        return _mulDiv(x, y, denominator, false);
    }

    function mulDivUp(uint256 x, uint256 y, uint256 denominator) internal pure returns (uint256) {
        return _mulDiv(x, y, denominator, true);
    }

    function mulWadDown(uint256 x, uint256 y) internal pure returns (uint256) {
        return _mulDiv(x, y, WAD, false);
    }

    function mulWadUp(uint256 x, uint256 y) internal pure returns (uint256) {
        return _mulDiv(x, y, WAD, true);
    }

    function divWadDown(uint256 x, uint256 y) internal pure returns (uint256) {
        return _mulDiv(x, WAD, y, false);
    }

    function divWadUp(uint256 x, uint256 y) internal pure returns (uint256) {
        return _mulDiv(x, WAD, y, true);
    }

    /// @dev Applying a Rate goes through the type rather than a raw uint64, so a rate can never be
    /// passed where a WAD-scaled amount is expected. The scale is unwrapped here and nowhere else.
    function applyRateDown(uint256 amount, Rate rate) internal pure returns (uint256) {
        return _mulDiv(amount, RateLib.unwrap(rate), WAD, false);
    }

    function applyRateUp(uint256 amount, Rate rate) internal pure returns (uint256) {
        return _mulDiv(amount, RateLib.unwrap(rate), WAD, true);
    }

    /// @dev Rounds toward negative infinity, so the quotient decreases monotonically with the
    /// numerator across the sign boundary.
    function mulDivSignedFloor(int256 x, int256 y, uint256 denominator) internal pure returns (int256) {
        return mulDivSigned(x, y, denominator, Math.Rounding.Floor);
    }

    /// @dev Rounds toward positive infinity.
    function mulDivSignedCeil(int256 x, int256 y, uint256 denominator) internal pure returns (int256) {
        return mulDivSigned(x, y, denominator, Math.Rounding.Ceil);
    }

    /// @dev Rounds toward zero, so the result is symmetric under negation of either operand.
    function mulDivSignedTrunc(int256 x, int256 y, uint256 denominator) internal pure returns (int256) {
        return mulDivSigned(x, y, denominator, Math.Rounding.Trunc);
    }

    /// @dev Rounds away from zero, the conservative direction for an amount a payer owes.
    function mulDivSignedExpand(int256 x, int256 y, uint256 denominator) internal pure returns (int256) {
        return mulDivSigned(x, y, denominator, Math.Rounding.Expand);
    }

    function mulDivSigned(int256 x, int256 y, uint256 denominator, Math.Rounding rounding)
        internal
        pure
        returns (int256)
    {
        bool negative = (x < 0) != (y < 0);
        uint256 magnitude = _mulDiv(SignedMath.abs(x), SignedMath.abs(y), denominator, _roundsUp(rounding, negative));
        return toSigned(magnitude, negative);
    }

    /// @dev int256 is asymmetric: its most negative value has a magnitude one larger than its most
    /// positive value. Reapplying the sign inside an unchecked negation is what lets a result land
    /// exactly on that boundary instead of reverting one step short of it.
    function toSigned(uint256 magnitude, bool negative) internal pure returns (int256) {
        if (negative) {
            if (magnitude > uint256(type(int256).max) + 1) {
                revert SignedCastOverflow(magnitude, negative);
            }
            unchecked {
                return -int256(magnitude);
            }
        }
        if (magnitude > uint256(type(int256).max)) {
            revert SignedCastOverflow(magnitude, negative);
        }
        return int256(magnitude);
    }

    /// @dev Translates a signed rounding direction into a decision about the unsigned magnitude.
    /// Rounding a negative quotient toward negative infinity means rounding its magnitude up.
    function _roundsUp(Math.Rounding rounding, bool negative) private pure returns (bool) {
        if (rounding == Math.Rounding.Floor) {
            return negative;
        }
        if (rounding == Math.Rounding.Ceil) {
            return !negative;
        }
        return rounding == Math.Rounding.Expand;
    }

    /// @dev The 512-bit product is inspected before dividing so that a zero denominator and a
    /// quotient wider than uint256 surface as named errors rather than as an arithmetic panic.
    function _mulDiv(uint256 x, uint256 y, uint256 denominator, bool roundUp) private pure returns (uint256) {
        if (denominator == 0) {
            revert DivisionByZero();
        }
        (uint256 high,) = Math.mul512(x, y);
        if (high >= denominator) {
            revert MulDivOverflow(x, y, denominator);
        }

        uint256 result = Math.mulDiv(x, y, denominator);
        if (roundUp && mulmod(x, y, denominator) > 0) {
            if (result == type(uint256).max) {
                revert MulDivOverflow(x, y, denominator);
            }
            unchecked {
                result += 1;
            }
        }
        return result;
    }
}
