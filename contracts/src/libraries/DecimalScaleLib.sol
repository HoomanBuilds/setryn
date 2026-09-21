// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SignedMath} from "@openzeppelin/contracts/utils/math/SignedMath.sol";

import {FixedPointLib} from "./FixedPointLib.sol";
import {MAX_DECIMALS} from "../types/Units.sol";

error DecimalsOutOfRange(uint8 decimals);

error RescaleOverflow(uint256 magnitude, uint8 fromDecimals, uint8 toDecimals);

/// @dev Moves an integer amount between two decimal conventions. Both the source and the target
/// decimals are validated on every call, so a malformed asset definition fails at the boundary
/// instead of producing an amount that is silently wrong by orders of magnitude.
///
/// @dev Widening is exact and can only fail on overflow. Narrowing discards precision, so it is only
/// reachable through an entry point that names its rounding direction.
library DecimalScaleLib {
    /// @dev Narrowing rounds toward zero; widening is exact.
    function rescaleDown(uint256 amount, uint8 fromDecimals, uint8 toDecimals) internal pure returns (uint256) {
        _validate(fromDecimals, toDecimals);
        if (toDecimals >= fromDecimals) {
            return _widen(amount, fromDecimals, toDecimals);
        }
        return amount / (10 ** (fromDecimals - toDecimals));
    }

    /// @dev Narrowing rounds away from zero; widening is exact.
    function rescaleUp(uint256 amount, uint8 fromDecimals, uint8 toDecimals) internal pure returns (uint256) {
        _validate(fromDecimals, toDecimals);
        if (toDecimals >= fromDecimals) {
            return _widen(amount, fromDecimals, toDecimals);
        }
        return Math.ceilDiv(amount, 10 ** (fromDecimals - toDecimals));
    }

    /// @dev Narrowing rounds toward negative infinity, so a negative amount rescales to the more
    /// negative neighbour rather than toward zero.
    function rescaleSignedFloor(int256 amount, uint8 fromDecimals, uint8 toDecimals) internal pure returns (int256) {
        return _rescaleSigned(amount, fromDecimals, toDecimals, Math.Rounding.Floor);
    }

    /// @dev Narrowing rounds toward positive infinity.
    function rescaleSignedCeil(int256 amount, uint8 fromDecimals, uint8 toDecimals) internal pure returns (int256) {
        return _rescaleSigned(amount, fromDecimals, toDecimals, Math.Rounding.Ceil);
    }

    function _rescaleSigned(int256 amount, uint8 fromDecimals, uint8 toDecimals, Math.Rounding rounding)
        private
        pure
        returns (int256)
    {
        _validate(fromDecimals, toDecimals);
        if (toDecimals >= fromDecimals) {
            uint256 widened = _widen(SignedMath.abs(amount), fromDecimals, toDecimals);
            bool negative = amount < 0;
            uint256 limit = negative ? uint256(type(int256).max) + 1 : uint256(type(int256).max);
            if (widened > limit) {
                revert RescaleOverflow(SignedMath.abs(amount), fromDecimals, toDecimals);
            }
            return FixedPointLib.toSigned(widened, negative);
        }
        return FixedPointLib.mulDivSigned(amount, 1, 10 ** (fromDecimals - toDecimals), rounding);
    }

    function _widen(uint256 magnitude, uint8 fromDecimals, uint8 toDecimals) private pure returns (uint256) {
        (bool fits, uint256 scaled) = Math.tryMul(magnitude, 10 ** (toDecimals - fromDecimals));
        if (!fits) {
            revert RescaleOverflow(magnitude, fromDecimals, toDecimals);
        }
        return scaled;
    }

    function _validate(uint8 fromDecimals, uint8 toDecimals) private pure {
        if (fromDecimals > MAX_DECIMALS) {
            revert DecimalsOutOfRange(fromDecimals);
        }
        if (toDecimals > MAX_DECIMALS) {
            revert DecimalsOutOfRange(toDecimals);
        }
    }
}
