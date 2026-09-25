// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Test} from "forge-std/Test.sol";

import {DefaultWaterfallHandler} from "./handlers/DefaultWaterfallHandler.sol";

contract DefaultProcessEngineInvariantTest is StdInvariant, Test {
    DefaultWaterfallHandler internal handler;

    function setUp() public {
        handler = new DefaultWaterfallHandler();
        targetContract(address(handler));
    }

    function invariant_WaterfallConservesDeficiency() public view {
        assertEq(
            uint256(handler.defaulterApplied()) + handler.takeoverApplied() + handler.insuranceApplied()
                + handler.terminalResidual(),
            handler.deficiency()
        );
    }
}
