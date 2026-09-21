// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {AllocationLib} from "../../../src/libraries/AllocationLib.sol";
import {DecimalScaleLib} from "../../../src/libraries/DecimalScaleLib.sol";
import {FixedPointLib} from "../../../src/libraries/FixedPointLib.sol";
import {NotionalLib} from "../../../src/libraries/NotionalLib.sol";
import {
    Lots,
    LotsLib,
    PriceTicks,
    PriceTicksLib,
    Rate,
    RateLib,
    TickSizeMinor,
    TickSizeMinorLib
} from "../../../src/types/Units.sol";

/// @dev The numeric libraries are internal and pure, so a reverting path is inlined into the test
/// and never reaches call depth. These external wrappers give the reverts a frame to be caught in.
contract NumericsHarness {
    function mulDivDown(uint256 x, uint256 y, uint256 denominator) external pure returns (uint256) {
        return FixedPointLib.mulDivDown(x, y, denominator);
    }

    function mulDivUp(uint256 x, uint256 y, uint256 denominator) external pure returns (uint256) {
        return FixedPointLib.mulDivUp(x, y, denominator);
    }

    function mulWadDown(uint256 x, uint256 y) external pure returns (uint256) {
        return FixedPointLib.mulWadDown(x, y);
    }

    function mulWadUp(uint256 x, uint256 y) external pure returns (uint256) {
        return FixedPointLib.mulWadUp(x, y);
    }

    function divWadDown(uint256 x, uint256 y) external pure returns (uint256) {
        return FixedPointLib.divWadDown(x, y);
    }

    function divWadUp(uint256 x, uint256 y) external pure returns (uint256) {
        return FixedPointLib.divWadUp(x, y);
    }

    function applyRateDown(uint256 amount, uint64 rate) external pure returns (uint256) {
        return FixedPointLib.applyRateDown(amount, Rate.wrap(rate));
    }

    function applyRateUp(uint256 amount, uint64 rate) external pure returns (uint256) {
        return FixedPointLib.applyRateUp(amount, Rate.wrap(rate));
    }

    function mulDivSignedFloor(int256 x, int256 y, uint256 denominator) external pure returns (int256) {
        return FixedPointLib.mulDivSignedFloor(x, y, denominator);
    }

    function mulDivSignedCeil(int256 x, int256 y, uint256 denominator) external pure returns (int256) {
        return FixedPointLib.mulDivSignedCeil(x, y, denominator);
    }

    function mulDivSignedTrunc(int256 x, int256 y, uint256 denominator) external pure returns (int256) {
        return FixedPointLib.mulDivSignedTrunc(x, y, denominator);
    }

    function mulDivSignedExpand(int256 x, int256 y, uint256 denominator) external pure returns (int256) {
        return FixedPointLib.mulDivSignedExpand(x, y, denominator);
    }

    function fillNotional(uint128 lots, int128 price, uint128 tickSize) external pure returns (int256) {
        return NotionalLib.fillNotional(Lots.wrap(lots), PriceTicks.wrap(price), TickSizeMinor.wrap(tickSize));
    }

    function grossNotional(uint128 lots, int128 price, uint128 tickSize) external pure returns (uint256) {
        return NotionalLib.grossNotional(Lots.wrap(lots), PriceTicks.wrap(price), TickSizeMinor.wrap(tickSize));
    }

    function rescaleDown(uint256 amount, uint8 fromDecimals, uint8 toDecimals) external pure returns (uint256) {
        return DecimalScaleLib.rescaleDown(amount, fromDecimals, toDecimals);
    }

    function rescaleUp(uint256 amount, uint8 fromDecimals, uint8 toDecimals) external pure returns (uint256) {
        return DecimalScaleLib.rescaleUp(amount, fromDecimals, toDecimals);
    }

    function rescaleSignedFloor(int256 amount, uint8 fromDecimals, uint8 toDecimals) external pure returns (int256) {
        return DecimalScaleLib.rescaleSignedFloor(amount, fromDecimals, toDecimals);
    }

    function rescaleSignedCeil(int256 amount, uint8 fromDecimals, uint8 toDecimals) external pure returns (int256) {
        return DecimalScaleLib.rescaleSignedCeil(amount, fromDecimals, toDecimals);
    }

    function allocateProRata(uint256 total, uint256[] calldata weights)
        external
        pure
        returns (uint256[] memory parts, uint256 residual)
    {
        return AllocationLib.allocateProRata(total, weights);
    }

    function allocateFixedRates(uint256 total, uint64[] calldata rawRates)
        external
        pure
        returns (uint256[] memory parts, uint256 residual)
    {
        Rate[] memory rates = new Rate[](rawRates.length);
        for (uint256 i; i < rawRates.length; ++i) {
            rates[i] = Rate.wrap(rawRates[i]);
        }
        return AllocationLib.allocateFixedRates(total, rates);
    }

    function allocateRate(uint256 total, uint64 rate) external pure returns (uint256 part, uint256 residual) {
        return AllocationLib.allocateRate(total, Rate.wrap(rate));
    }

    function lotsFromUint256(uint256 lots) external pure returns (uint128) {
        return Lots.unwrap(LotsLib.fromUint256(lots));
    }

    function priceTicksFromInt256(int256 priceTicks) external pure returns (int128) {
        return PriceTicks.unwrap(PriceTicksLib.fromInt256(priceTicks));
    }

    function rateFromWad(uint256 wad) external pure returns (uint64) {
        return Rate.unwrap(RateLib.fromWad(wad));
    }

    function rateFromBps(uint256 bps) external pure returns (uint64) {
        return Rate.unwrap(RateLib.fromBps(bps));
    }

    function rateToBps(uint64 rate) external pure returns (uint256) {
        return RateLib.toBps(Rate.wrap(rate));
    }

    function rateRequireAtMostOne(uint64 rate) external pure returns (uint256) {
        return RateLib.requireAtMostOne(Rate.wrap(rate));
    }

    function tickSizeRequirePositive(uint128 tickSizeMinor) external pure returns (uint256) {
        return TickSizeMinorLib.requirePositive(TickSizeMinor.wrap(tickSizeMinor));
    }
}
