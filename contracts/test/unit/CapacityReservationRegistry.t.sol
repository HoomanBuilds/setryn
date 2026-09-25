// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {CapacityReservationRegistry} from "../../src/capacity/CapacityReservationRegistry.sol";
import {ICapacityReservationRegistry} from "../../src/interfaces/ICapacityReservationRegistry.sol";
import {CollateralLockId} from "../../src/types/Identifiers.sol";

contract CapacityReservationRegistryTest is Test {
    CapacityReservationRegistry internal registry;

    function setUp() public {
        registry = new CapacityReservationRegistry(0, address(this));
        registry.grantRole(registry.CAPACITY_CLAIMANT_ROLE(), address(this));
    }

    function test_ClaimAndCloseArePermanent() public {
        bytes32 key = keccak256("key");
        bytes32 capacityId = keccak256("capacity");
        CollateralLockId lockId = CollateralLockId.wrap(keccak256("lock"));

        registry.claimCapacityReference(key, capacityId, lockId);
        registry.closeCapacityReference(key, keccak256("settled"));

        (bytes32 storedId, CollateralLockId storedLock, address claimant, bool closed) = registry.capacityReference(key);
        assertEq(storedId, capacityId);
        assertEq(CollateralLockId.unwrap(storedLock), CollateralLockId.unwrap(lockId));
        assertEq(claimant, address(this));
        assertTrue(closed);

        vm.expectRevert(
            abi.encodeWithSelector(
                ICapacityReservationRegistry.CapacityReferenceAlreadyClaimed.selector, key, capacityId
            )
        );
        registry.claimCapacityReference(key, keccak256("other"), CollateralLockId.wrap(keccak256("other lock")));
    }

    function testFuzz_OnlyOriginalClaimantCanClose(bytes32 key, bytes32 capacityId, bytes32 lock, address caller)
        public
    {
        vm.assume(key != bytes32(0) && capacityId != bytes32(0) && lock != bytes32(0));
        vm.assume(caller != address(this));
        registry.claimCapacityReference(key, capacityId, CollateralLockId.wrap(lock));

        vm.prank(caller);
        vm.expectRevert(
            abi.encodeWithSelector(ICapacityReservationRegistry.UnauthorizedCapacityClaimant.selector, caller)
        );
        registry.closeCapacityReference(key, keccak256("close"));
    }
}
