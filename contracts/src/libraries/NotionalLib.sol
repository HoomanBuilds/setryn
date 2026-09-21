// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {FixedPointLib} from "./FixedPointLib.sol";
import {Lots, LotsLib, PriceTicks, PriceTicksLib, TickSizeMinor, TickSizeMinorLib} from "../types/Units.sol";

error NotionalOverflow(uint256 lots, uint256 priceTicksMagnitude, uint256 tickSizeMinor);

/// @dev Fill notional is exact by construction: lots times signed price ticks times a strictly
/// positive tick size, with no division and therefore no rounding decision to make. Every money
/// amount this library returns is a whole count of quote-asset minor units.
///
/// @dev The result carries the sign of the price alone. It is not a cash flow for either side of a
/// trade yet; converting a notional into a directed debit or credit needs Side, which belongs to the
/// module that knows which party is being accounted for.
library NotionalLib {
    /// @dev Signed notional in quote-asset minor units. Zero lots and a zero price are both ordinary
    /// inputs that produce zero, while a zero tick size is a malformed market and reverts.
    function fillNotional(Lots lots, PriceTicks priceTicks, TickSizeMinor tickSizeMinor)
        internal
        pure
        returns (int256)
    {
        uint256 magnitude = _grossNotional(lots, priceTicks, tickSizeMinor);
        bool negative = PriceTicksLib.isNegative(priceTicks);

        uint256 limit = negative ? uint256(type(int256).max) + 1 : uint256(type(int256).max);
        if (magnitude > limit) {
            revert NotionalOverflow(
                LotsLib.unwrap(lots), PriceTicksLib.abs(priceTicks), TickSizeMinorLib.unwrap(tickSizeMinor)
            );
        }
        return FixedPointLib.toSigned(magnitude, negative);
    }

    /// @dev Unsigned magnitude of the same product, for exposure and margin sizing where the sign of
    /// the quote is irrelevant.
    function grossNotional(Lots lots, PriceTicks priceTicks, TickSizeMinor tickSizeMinor)
        internal
        pure
        returns (uint256)
    {
        return _grossNotional(lots, priceTicks, tickSizeMinor);
    }

    function _grossNotional(Lots lots, PriceTicks priceTicks, TickSizeMinor tickSizeMinor)
        private
        pure
        returns (uint256)
    {
        uint256 lotCount = LotsLib.unwrap(lots);
        uint256 priceMagnitude = PriceTicksLib.abs(priceTicks);
        uint256 tickSize = TickSizeMinorLib.requirePositive(tickSizeMinor);

        (bool priceFits, uint256 perLot) = Math.tryMul(priceMagnitude, tickSize);
        if (!priceFits) {
            revert NotionalOverflow(lotCount, priceMagnitude, tickSize);
        }
        (bool totalFits, uint256 total) = Math.tryMul(lotCount, perLot);
        if (!totalFits) {
            revert NotionalOverflow(lotCount, priceMagnitude, tickSize);
        }
        return total;
    }
}
