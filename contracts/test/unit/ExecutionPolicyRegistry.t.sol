// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {ExecutionPolicyRegistry} from "../../src/policy/ExecutionPolicyRegistry.sol";
import {OrderActionId} from "../../src/types/OrderTypes.sol";

contract ExecutionPolicyRegistryTest is Test {
    ExecutionPolicyRegistry internal registry;

    function setUp() public {
        registry = new ExecutionPolicyRegistry(0, address(this));
    }

    function test_PermissionsFailClosedAndCanBeRevoked() public {
        bytes32 setHash = keccak256("modes");
        bytes32 mode = keccak256("atomic");
        bytes32 kind = keccak256("privacy");
        bytes32 tag = keccak256("sealed");
        OrderActionId action = OrderActionId.wrap(keccak256("enter"));

        assertFalse(registry.executionModeAllowed(setHash, mode));
        assertFalse(registry.policyTagAllowed(kind, tag));
        assertFalse(registry.orderActionAllowed(action));

        registry.setExecutionMode(setHash, mode, true);
        registry.setPolicyTag(kind, tag, true);
        registry.setOrderAction(action, true);
        assertTrue(registry.executionModeAllowed(setHash, mode));
        assertTrue(registry.policyTagAllowed(kind, tag));
        assertTrue(registry.orderActionAllowed(action));

        registry.setExecutionMode(setHash, mode, false);
        registry.setPolicyTag(kind, tag, false);
        registry.setOrderAction(action, false);
        assertFalse(registry.executionModeAllowed(setHash, mode));
        assertFalse(registry.policyTagAllowed(kind, tag));
        assertFalse(registry.orderActionAllowed(action));
    }

    function testFuzz_UnknownExecutionModeFailsClosed(bytes32 setHash, bytes32 mode) public view {
        assertFalse(registry.executionModeAllowed(setHash, mode));
    }

    function test_EligibilityUsesStandardMerkleLeaf() public view {
        address participant = address(0xBEEF);
        bytes32 root = keccak256(bytes.concat(keccak256(abi.encode(participant))));
        assertTrue(registry.eligible(root, participant, new bytes32[](0)));
        assertFalse(registry.eligible(root, address(0xCAFE), new bytes32[](0)));
    }
}
