// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {Lots, LotsLib} from "../types/Units.sol";

error PositionAmountOverflow(uint256 perLot, uint256 lots);

library PositionMathLib {
    function checkedAmount(uint128 perLot, Lots lots) internal pure returns (uint128) {
        uint256 lotCount = LotsLib.unwrap(lots);
        (bool fits, uint256 total) = Math.tryMul(uint256(perLot), lotCount);
        if (!fits || total > type(uint128).max) revert PositionAmountOverflow(perLot, lotCount);
        return uint128(total);
    }

    function scaleTransfer(int256 perLot, Lots lots) internal pure returns (int256) {
        bool negative = perLot < 0;
        uint256 magnitude = negative ? uint256(-(perLot + 1)) + 1 : uint256(perLot);
        uint256 lotCount = LotsLib.unwrap(lots);
        (bool fits, uint256 total) = Math.tryMul(magnitude, lotCount);
        if (!fits || total > type(uint128).max) revert PositionAmountOverflow(magnitude, lotCount);
        return negative ? -int256(total) : int256(total);
    }
}
