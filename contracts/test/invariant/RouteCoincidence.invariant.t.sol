// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

contract RouteCoincidenceHandler is Test {
    uint128 public leftLots = 1;
    uint128 public rightLots = 1;
    uint128 public matchedLots = 1;
    uint128 public leftResidual;
    uint128 public rightResidual;

    function update(uint128 left, uint128 right) external {
        leftLots = uint128(bound(left, 1, type(uint128).max));
        rightLots = uint128(bound(right, 1, type(uint128).max));
        matchedLots = leftLots < rightLots ? leftLots : rightLots;
        leftResidual = leftLots - matchedLots;
        rightResidual = rightLots - matchedLots;
    }
}

contract RouteCoincidenceInvariantTest is Test {
    RouteCoincidenceHandler internal handler;

    function setUp() public {
        handler = new RouteCoincidenceHandler();
        targetContract(address(handler));
    }

    function invariant_MatchedAndResidualLotsAreConserved() public view {
        assertEq(uint256(handler.matchedLots()) + handler.leftResidual(), handler.leftLots());
        assertEq(uint256(handler.matchedLots()) + handler.rightResidual(), handler.rightLots());
    }

    function invariant_OnlyOneSideCanHaveResidualLots() public view {
        assertTrue(handler.leftResidual() == 0 || handler.rightResidual() == 0);
    }
}
