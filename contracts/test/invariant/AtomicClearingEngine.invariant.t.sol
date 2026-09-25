// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {ClearingIdentityHandler} from "./handlers/ClearingIdentityHandler.sol";

contract AtomicClearingEngineInvariantTest is Test {
    ClearingIdentityHandler internal handler;

    function setUp() public {
        handler = new ClearingIdentityHandler();
        targetContract(address(handler));
        handler.clear(0, 0, bytes32(0));
    }

    function invariant_EachAcceptedCumulativeFillHasUniqueIdentity() public view {
        assertGt(handler.uniqueFillCount(), 0);
        assertGe(handler.cumulativeLots(), handler.uniqueFillCount());
    }
}
