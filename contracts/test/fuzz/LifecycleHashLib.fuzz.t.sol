// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {LifecycleHashLib} from "../../src/libraries/LifecycleHashLib.sol";
import {PositionId} from "../../src/types/Identifiers.sol";
import {LifecycleInput} from "../../src/types/LifecycleTypes.sol";
import {Lots} from "../../src/types/Units.sol";
import {LifecycleHarness} from "../unit/harness/LifecycleHarness.sol";

contract LifecycleHashLibFuzzTest is Test {
    LifecycleHarness internal harness;

    function setUp() public {
        harness = new LifecycleHarness();
    }

    function testFuzz_InputOrderingIsCanonical(bytes32 firstRaw, bytes32 secondRaw) public {
        vm.assume(firstRaw != bytes32(0));
        vm.assume(secondRaw != bytes32(0));
        vm.assume(firstRaw != secondRaw);
        bytes32 lower = uint256(firstRaw) < uint256(secondRaw) ? firstRaw : secondRaw;
        bytes32 upper = lower == firstRaw ? secondRaw : firstRaw;
        LifecycleInput[] memory inputs = new LifecycleInput[](2);
        inputs[0] = _input(lower);
        inputs[1] = _input(upper);
        assertTrue(harness.hashInputs(inputs) != bytes32(0));
        (inputs[0], inputs[1]) = (inputs[1], inputs[0]);
        vm.expectRevert(LifecycleHashLib.InvalidLifecycleInput.selector);
        harness.hashInputs(inputs);
    }

    function _input(bytes32 positionId) internal pure returns (LifecycleInput memory) {
        return LifecycleInput({
            positionId: PositionId.wrap(positionId),
            expectedImmutableHash: keccak256(abi.encode("immutable", positionId)),
            expectedLifecycleHash: keccak256(abi.encode("lifecycle", positionId)),
            expectedPositionLots: Lots.wrap(10),
            actionLots: Lots.wrap(5)
        });
    }
}
