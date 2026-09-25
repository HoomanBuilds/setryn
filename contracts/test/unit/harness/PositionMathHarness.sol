// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {PositionMathLib} from "../../../src/libraries/PositionMathLib.sol";
import {Lots} from "../../../src/types/Units.sol";

contract PositionMathHarness {
    function checkedAmount(uint128 perLot, Lots lots) external pure returns (uint128) {
        return PositionMathLib.checkedAmount(perLot, lots);
    }

    function scaleTransfer(int256 perLot, Lots lots) external pure returns (int256) {
        return PositionMathLib.scaleTransfer(perLot, lots);
    }
}
