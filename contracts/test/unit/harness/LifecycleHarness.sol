// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {LifecycleHashLib} from "../../../src/libraries/LifecycleHashLib.sol";
import {LifecycleInput} from "../../../src/types/LifecycleTypes.sol";

contract LifecycleHarness {
    function hashInputs(LifecycleInput[] calldata inputs) external pure returns (bytes32) {
        return LifecycleHashLib.hashInputs(inputs);
    }
}
