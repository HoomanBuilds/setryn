// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Test} from "forge-std/Test.sol";

import {FeeSplitHandler} from "./handlers/FeeSplitHandler.sol";
import {FeeEngineHarness} from "../unit/harness/FeeEngineHarness.sol";

contract FeeEngineInvariantTest is StdInvariant, Test {
    FeeSplitHandler internal handler;

    function setUp() public {
        handler = new FeeSplitHandler(new FeeEngineHarness());
        targetContract(address(handler));
    }

    function invariant_RecipientSplitsConserveTheChargedAmount() public view {
        assertEq(handler.lastAllocated(), handler.lastCharge());
    }
}
