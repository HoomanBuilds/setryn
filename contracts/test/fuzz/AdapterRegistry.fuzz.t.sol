// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {AdapterDefinitionLib} from "../../src/libraries/AdapterDefinitionLib.sol";
import {AdapterRegistry} from "../../src/registry/AdapterRegistry.sol";
import {AdapterDefinition} from "../../src/types/AdapterDefinition.sol";
import {RegistryStatus} from "../../src/types/Enums.sol";
import {AdapterId, AdapterKindId} from "../../src/types/Identifiers.sol";

contract AdapterRegistryFuzzTest is Test {
    uint48 internal constant ADMIN_DELAY = 3 days;

    bytes32 internal constant NAMESPACE_ID = keccak256("setryn.adapter");
    bytes32 internal constant REFERENCE_ID = keccak256("chainlink:eth-usd");
    bytes32 internal constant INTERFACE_HASH = keccak256("adapter.interface.v1");
    bytes32 internal constant CAPABILITY_HASH = keccak256("adapter.capability.v1");
    bytes32 internal constant CONFIGURATION_SCHEMA_HASH = keccak256("adapter.config.v1");
    bytes32 internal constant EVIDENCE_HASH = keccak256("adapter.evidence.v1");

    bytes internal constant RUNTIME_CODE = hex"60006000f3";

    address internal admin = makeAddr("admin");
    address internal implementation = makeAddr("implementation");

    AdapterRegistry internal registry;

    function setUp() public {
        registry = new AdapterRegistry(ADMIN_DELAY, admin);
        vm.etch(implementation, RUNTIME_CODE);
    }

    /// @dev Identity is the namespace, reference, and kind triple alone, so no implementation
    /// revision, no commitment revision, and no chain may split one lineage, while every one of
    /// those revisions is still a distinct chain-local version.
    function testFuzz_AdapterIdIgnoresImplementationAndChain(
        address revisedImplementation,
        bytes32 interfaceHash,
        bytes32 capabilityHash,
        bytes32 configurationSchemaHash,
        bytes32 evidenceHash,
        uint64 chainId
    ) public {
        vm.assume(uint160(revisedImplementation) > 0xffff && revisedImplementation != implementation);
        vm.assume(revisedImplementation.code.length == 0);
        vm.assume(interfaceHash != bytes32(0) && capabilityHash != bytes32(0));
        vm.assume(configurationSchemaHash != bytes32(0) && evidenceHash != bytes32(0));
        chainId = uint64(bound(chainId, 1, type(uint64).max));

        bytes memory revisedCode = abi.encodePacked(RUNTIME_CODE, bytes32(uint256(uint160(revisedImplementation))));
        vm.etch(revisedImplementation, revisedCode);

        AdapterDefinition memory revised = _definition();
        revised.implementation = revisedImplementation;
        revised.expectedRuntimeCodeHash = keccak256(revisedCode);
        revised.interfaceHash = interfaceHash;
        revised.capabilityHash = capabilityHash;
        revised.configurationSchemaHash = configurationSchemaHash;
        revised.evidenceHash = evidenceHash;

        AdapterId expectedId = AdapterDefinitionLib.deriveAdapterId(_definition());
        assertEq(AdapterId.unwrap(registry.deriveAdapterId(revised)), AdapterId.unwrap(expectedId));

        vm.prank(admin);
        (AdapterId baselineId, uint32 baselineVersion) = registry.registerAdapter(_definition());

        vm.chainId(chainId);
        vm.prank(admin);
        (AdapterId revisedId, uint32 revisedVersion) = registry.registerAdapter(revised);

        assertEq(AdapterId.unwrap(baselineId), AdapterId.unwrap(revisedId));
        assertEq(baselineVersion, 1);
        assertEq(revisedVersion, 2);
        assertEq(
            registry.getAdapter(revisedId, 2).definitionHash, AdapterDefinitionLib.hashDefinition(revised, chainId)
        );
        assertEq(registry.adapterCount(), 2);
    }

    /// @dev The kind space is open: any nonzero tag qualifies, and two kinds under one namespaced
    /// reference are two independent lineages that each carry their own active pointer.
    function testFuzz_AnyNonzeroKindIsItsOwnLineage(bytes32 firstKind, bytes32 secondKind) public {
        vm.assume(firstKind != bytes32(0) && secondKind != bytes32(0));
        vm.assume(firstKind != secondKind);

        AdapterDefinition memory first = _definition();
        first.kindId = AdapterKindId.wrap(firstKind);

        AdapterDefinition memory second = _definition();
        second.kindId = AdapterKindId.wrap(secondKind);

        vm.startPrank(admin);
        (AdapterId firstId, uint32 firstVersion) = registry.registerAdapter(first);
        (AdapterId secondId, uint32 secondVersion) = registry.registerAdapter(second);
        registry.activateAdapter(firstId, firstVersion);
        vm.stopPrank();

        assertTrue(AdapterId.unwrap(firstId) != AdapterId.unwrap(secondId));
        assertEq(firstVersion, 1);
        assertEq(secondVersion, 1);
        assertTrue(registry.isOpenForNewRisk(firstId, firstVersion));
        assertFalse(registry.isOpenForNewRisk(secondId, secondVersion));
        assertEq(registry.activeVersion(secondId), 0);
        assertEq(uint8(registry.statusOf(secondId, secondVersion)), uint8(RegistryStatus.Paused));
    }

    /// @dev Runtime drift at the implementation address closes new risk for any code that is not the
    /// qualified one, without touching stored status or historical resolvability, and activation
    /// fails closed on the same drift.
    function testFuzz_RuntimeDriftGatesNewRiskOnly(bytes calldata driftedCode) public {
        vm.assume(driftedCode.length != 0 && driftedCode.length <= 1_024);
        bool drifts = keccak256(driftedCode) != keccak256(RUNTIME_CODE);

        vm.prank(admin);
        (AdapterId id, uint32 version) = registry.registerAdapter(_definition());

        vm.etch(implementation, driftedCode);

        assertEq(registry.runtimeMatches(id, version), !drifts);
        assertTrue(registry.isLifecycleEnabled(id, version));

        if (drifts) {
            vm.prank(admin);
            vm.expectRevert();
            registry.activateAdapter(id, version);
            assertEq(uint8(registry.statusOf(id, version)), uint8(RegistryStatus.Paused));

            vm.etch(implementation, RUNTIME_CODE);
        }

        vm.prank(admin);
        registry.activateAdapter(id, version);
        assertTrue(registry.isOpenForNewRisk(id, version));

        vm.etch(implementation, abi.encodePacked(RUNTIME_CODE, driftedCode));
        assertFalse(registry.isOpenForNewRisk(id, version));
        assertTrue(registry.isLifecycleEnabled(id, version));
        assertEq(uint8(registry.statusOf(id, version)), uint8(RegistryStatus.Active));
    }

    function _definition() internal view returns (AdapterDefinition memory) {
        return AdapterDefinition({
            namespaceId: NAMESPACE_ID,
            referenceId: REFERENCE_ID,
            kindId: AdapterDefinitionLib.ADAPTER_KIND_BENCHMARK,
            implementation: implementation,
            expectedRuntimeCodeHash: keccak256(RUNTIME_CODE),
            interfaceHash: INTERFACE_HASH,
            capabilityHash: CAPABILITY_HASH,
            configurationSchemaHash: CONFIGURATION_SCHEMA_HASH,
            evidenceHash: EVIDENCE_HASH
        });
    }
}
