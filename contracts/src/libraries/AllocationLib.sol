// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {FixedPointLib} from "./FixedPointLib.sol";
import {Rate, RateLib, WAD} from "../types/Units.sol";

error ZeroWeightSum();

error WeightSumOverflow();

error FixedRateSumAboveOne(uint256 rateSum);

/// @dev Two allocations that must never be confused with one another. Pro-rata allocation divides a
/// whole among claimants whose weights are only meaningful relative to each other. Fixed-rate
/// allocation pays out independently chosen shares of a whole and expects value to be left over.
///
/// @dev Both floor every part and return the leftover as an explicit residual. Who absorbs the
/// residual is a policy question with a different answer for fees, for settlement, and for
/// liquidation waterfalls, so a library that assigned it would move that decision out of sight of
/// the module that owns it.
library AllocationLib {
    /// @dev Normalized split: weights are divided by their own sum, so the parts distribute the
    /// entire total apart from the integer residual left by flooring. Weights carry no unit and no
    /// scale, and doubling every weight changes nothing.
    ///
    /// @dev The residual is strictly smaller than the number of weights, because each part loses
    /// less than one unit to flooring.
    function allocateProRata(uint256 total, uint256[] memory weights)
        internal
        pure
        returns (uint256[] memory parts, uint256 residual)
    {
        uint256 length = weights.length;
        uint256 weightSum;
        for (uint256 i; i < length; ++i) {
            (bool fits, uint256 next) = Math.tryAdd(weightSum, weights[i]);
            if (!fits) {
                revert WeightSumOverflow();
            }
            weightSum = next;
        }
        if (weightSum == 0) {
            revert ZeroWeightSum();
        }

        parts = new uint256[](length);
        uint256 assigned;
        for (uint256 i; i < length; ++i) {
            uint256 part = FixedPointLib.mulDivDown(total, weights[i], weightSum);
            parts[i] = part;
            assigned += part;
        }
        residual = total - assigned;
    }

    /// @dev Fixed shares: each rate is an absolute WAD-scaled fraction of the total and is floored
    /// on its own. The rates are never normalized, so rates summing to less than one WAD deliberately
    /// leave value undistributed, and that undistributed value is returned in the residual together
    /// with the rounding remainder. Normalizing here would silently inflate every share and turn a
    /// deliberate 30 percent payout into the whole pot.
    function allocateFixedRates(uint256 total, Rate[] memory rates)
        internal
        pure
        returns (uint256[] memory parts, uint256 residual)
    {
        uint256 length = rates.length;
        uint256 rateSum;
        for (uint256 i; i < length; ++i) {
            rateSum += RateLib.unwrap(rates[i]);
        }
        if (rateSum > WAD) {
            revert FixedRateSumAboveOne(rateSum);
        }

        parts = new uint256[](length);
        uint256 assigned;
        for (uint256 i; i < length; ++i) {
            uint256 part = FixedPointLib.mulDivDown(total, RateLib.unwrap(rates[i]), WAD);
            parts[i] = part;
            assigned += part;
        }
        residual = total - assigned;
    }

    /// @dev The one-share case of allocateFixedRates, without the array. This is the caller that
    /// genuinely needs the at-most-one bound, so it asserts it here rather than pushing the bound
    /// onto the Rate type, which must stay free to carry multipliers above one WAD.
    function allocateRate(uint256 total, Rate rate) internal pure returns (uint256 part, uint256 residual) {
        uint256 rateWad = RateLib.requireAtMostOne(rate);
        part = FixedPointLib.mulDivDown(total, rateWad, WAD);
        residual = total - part;
    }
}
