// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Side} from "../types/Enums.sol";
import {StreamLadderLevel, StreamPolicy, StreamPricingKind, StreamSizeBand} from "../types/StreamTypes.sol";
import {Lots, PriceTicks} from "../types/Units.sol";

library StreamPricingLib {
    error UnsupportedPricingKind();
    error InvalidFillSize(uint128 fillLots);
    error InventoryLimitExceeded(int128 inventoryLots, uint128 maximumAbsoluteInventoryLots);
    error SkewLimitExceeded(uint256 skewTicks, uint128 maximumAbsoluteSkewTicks);
    error PriceOverflow(int256 priceTicks);

    function quote(
        StreamPolicy memory policy,
        StreamSizeBand[] memory bands,
        StreamLadderLevel[] memory levels,
        Lots fillLots,
        int128 inventoryBeforeLots
    ) internal pure returns (PriceTicks price) {
        uint128 quantity = Lots.unwrap(fillLots);
        _validateSize(bands, quantity);
        if (_absolute(inventoryBeforeLots) > policy.maximumAbsoluteInventoryLots) {
            revert InventoryLimitExceeded(inventoryBeforeLots, policy.maximumAbsoluteInventoryLots);
        }
        if (policy.pricingKind == StreamPricingKind.LadderV1) {
            return _ladderQuote(policy.makerSide, levels, quantity);
        }
        if (policy.pricingKind != StreamPricingKind.AffineV1) revert UnsupportedPricingKind();
        int256 inventorySkew = int256(policy.inventorySkewTicksPerLot) * int256(inventoryBeforeLots);
        if (_absolute(inventorySkew) > policy.maximumAbsoluteSkewTicks) {
            revert SkewLimitExceeded(_absolute(inventorySkew), policy.maximumAbsoluteSkewTicks);
        }
        int256 sizeAdjustment = int256(policy.sizeSlopeTicksPerLot) * int256(uint256(quantity));
        int256 base = policy.makerSide == Side.Buy
            ? int256(PriceTicks.unwrap(policy.baseBidPriceTicks)) - sizeAdjustment
            : int256(PriceTicks.unwrap(policy.baseAskPriceTicks)) + sizeAdjustment;
        int256 quoted = base + inventorySkew;
        if (quoted < type(int128).min || quoted > type(int128).max) revert PriceOverflow(quoted);
        return PriceTicks.wrap(int128(quoted));
    }

    function _validateSize(StreamSizeBand[] memory bands, uint128 quantity) private pure {
        for (uint256 i; i < bands.length; ++i) {
            uint128 minimum = Lots.unwrap(bands[i].minimumLots);
            uint128 maximum = Lots.unwrap(bands[i].maximumLots);
            uint128 step = Lots.unwrap(bands[i].lotStep);
            if (quantity >= minimum && quantity <= maximum && (quantity - minimum) % step == 0) return;
        }
        revert InvalidFillSize(quantity);
    }

    function _ladderQuote(Side makerSide, StreamLadderLevel[] memory levels, uint128 quantity)
        private
        pure
        returns (PriceTicks)
    {
        for (uint256 i; i < levels.length; ++i) {
            if (quantity <= Lots.unwrap(levels[i].maximumLots)) {
                return makerSide == Side.Buy ? levels[i].bidPriceTicks : levels[i].askPriceTicks;
            }
        }
        revert InvalidFillSize(quantity);
    }

    function _absolute(int256 value) private pure returns (uint256) {
        return value < 0 ? uint256(-value) : uint256(value);
    }
}
