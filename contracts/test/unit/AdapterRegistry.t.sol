// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Test} from "forge-std/Test.sol";

import {IAdapterRegistry} from "../../src/interfaces/IAdapterRegistry.sol";
import {
    AdapterDefinitionLib,
    AdapterImplementationHasNoCode,
    AdapterRuntimeCodeHashMismatch,
    ZeroAdapterCapabilityHash,
    ZeroAdapterConfigurationSchemaHash,
    ZeroAdapterEvidenceHash,
    ZeroAdapterImplementation,
    ZeroAdapterInterfaceHash,
    ZeroAdapterKindId,
    ZeroAdapterNamespaceId,
    ZeroAdapterReferenceId,
    ZeroAdapterRuntimeCodeHash
} from "../../src/libraries/AdapterDefinitionLib.sol";
import {IdLib} from "../../src/libraries/IdLib.sol";
import {AdapterRegistry} from "../../src/registry/AdapterRegistry.sol";
import {AdapterDefinition, AdapterVersion} from "../../src/types/AdapterDefinition.sol";
import {RegistryStatus} from "../../src/types/Enums.sol";
import {AdapterId, AdapterKindId} from "../../src/types/Identifiers.sol";

contract AdapterRegistryTest is Test {
    uint48 internal constant ADMIN_DELAY = 3 days;

    bytes32 internal constant NAMESPACE_ID = keccak256("setryn.adapter");
    bytes32 internal constant REFERENCE_PRIMARY = keccak256("chainlink:eth-usd");
    bytes32 internal constant REFERENCE_SECONDARY = keccak256("uniswap:v4-pool");
    bytes32 internal constant INTERFACE_HASH = keccak256("adapter.interface.v1");
    bytes32 internal constant CAPABILITY_HASH = keccak256("adapter.capability.v1");
    bytes32 internal constant CONFIGURATION_SCHEMA_HASH = keccak256("adapter.config.v1");
    bytes32 internal constant EVIDENCE_HASH = keccak256("adapter.evidence.v1");

    bytes internal constant RUNTIME_CODE = hex"60006000f3";
    bytes internal constant REVISED_RUNTIME_CODE = hex"60016000f3";

    address internal admin = makeAddr("admin");
    address internal qualifier = makeAddr("qualifier");
    address internal statusManager = makeAddr("statusManager");
    address internal outsider = makeAddr("outsider");

    address internal implementation = makeAddr("implementation");
    address internal revisedImplementation = makeAddr("revisedImplementation");

    AdapterRegistry internal registry;

    AdapterId internal adapterId;

    function setUp() public {
        registry = new AdapterRegistry(ADMIN_DELAY, admin);

        vm.startPrank(admin);
        registry.grantRole(registry.ADAPTER_QUALIFIER_ROLE(), qualifier);
        registry.grantRole(registry.ADAPTER_STATUS_MANAGER_ROLE(), statusManager);
        vm.stopPrank();

        vm.etch(implementation, RUNTIME_CODE);
        vm.etch(revisedImplementation, REVISED_RUNTIME_CODE);

        adapterId = AdapterDefinitionLib.deriveAdapterId(_definition());
    }

    function test_TypestringsMatchTheirTypehashes() public pure {
        assertEq(
            keccak256(bytes(AdapterDefinitionLib.ADAPTER_KEY_TYPESTRING)), AdapterDefinitionLib.ADAPTER_KEY_TYPEHASH
        );
        assertEq(
            keccak256(bytes(AdapterDefinitionLib.ADAPTER_DEFINITION_TYPESTRING)),
            AdapterDefinitionLib.ADAPTER_DEFINITION_TYPEHASH
        );
        assertEq(
            keccak256(bytes(AdapterDefinitionLib.ADAPTER_VERSION_TYPESTRING)),
            AdapterDefinitionLib.ADAPTER_VERSION_TYPEHASH
        );
    }

    /// @dev The published kinds are convenience constants, so they are frozen literals and must
    /// never collide with one another.
    function test_KindConstantsAreFrozenAndDistinct() public pure {
        AdapterKindId[7] memory kinds = [
            AdapterDefinitionLib.ADAPTER_KIND_BENCHMARK,
            AdapterDefinitionLib.ADAPTER_KIND_VENUE,
            AdapterDefinitionLib.ADAPTER_KIND_SETTLEMENT,
            AdapterDefinitionLib.ADAPTER_KIND_DELIVERY,
            AdapterDefinitionLib.ADAPTER_KIND_CURVE,
            AdapterDefinitionLib.ADAPTER_KIND_RISK,
            AdapterDefinitionLib.ADAPTER_KIND_PRIVACY
        ];

        assertEq(AdapterKindId.unwrap(kinds[0]), keccak256(bytes("SetrynAdapterKindV1:Benchmark")));
        assertEq(AdapterKindId.unwrap(kinds[6]), keccak256(bytes("SetrynAdapterKindV1:Privacy")));

        for (uint256 i = 0; i < kinds.length; i++) {
            assertTrue(AdapterKindId.unwrap(kinds[i]) != bytes32(0));
            for (uint256 j = i + 1; j < kinds.length; j++) {
                assertTrue(AdapterKindId.unwrap(kinds[i]) != AdapterKindId.unwrap(kinds[j]));
            }
        }
    }

    function test_RoleConstantsAreFrozenAndDistinct() public view {
        assertEq(registry.ADAPTER_QUALIFIER_ROLE(), keccak256(bytes("SETRYN_ADAPTER_QUALIFIER_ROLE")));
        assertEq(registry.ADAPTER_STATUS_MANAGER_ROLE(), keccak256(bytes("SETRYN_ADAPTER_STATUS_MANAGER_ROLE")));
        assertTrue(registry.ADAPTER_QUALIFIER_ROLE() != registry.ADAPTER_STATUS_MANAGER_ROLE());
        assertTrue(registry.ADAPTER_QUALIFIER_ROLE() != registry.DEFAULT_ADMIN_ROLE());
        assertTrue(registry.ADAPTER_STATUS_MANAGER_ROLE() != registry.DEFAULT_ADMIN_ROLE());
    }

    function test_ConstructorGrantsOperationalRolesToInitialAdmin() public {
        AdapterRegistry fresh = new AdapterRegistry(ADMIN_DELAY, admin);

        assertTrue(fresh.hasRole(fresh.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(fresh.hasRole(fresh.ADAPTER_QUALIFIER_ROLE(), admin));
        assertTrue(fresh.hasRole(fresh.ADAPTER_STATUS_MANAGER_ROLE(), admin));
        assertEq(fresh.defaultAdmin(), admin);
        assertEq(fresh.defaultAdminDelay(), ADMIN_DELAY);
        assertEq(fresh.adapterCount(), 0);
    }

    function test_ConstructorRejectsZeroAdmin() public {
        vm.expectRevert(IAdapterRegistry.ZeroInitialAdmin.selector);
        new AdapterRegistry(ADMIN_DELAY, address(0));
    }

    /// @dev The V1 key commits namespace, reference, and kind alone, so replacing the implementation
    /// keeps one lineage, while changing the kind is a different logical adapter.
    function test_AdapterIdCommitsOnlyNamespaceReferenceAndKind() public view {
        AdapterDefinition memory revised = _definition();
        revised.implementation = revisedImplementation;
        revised.expectedRuntimeCodeHash = keccak256(REVISED_RUNTIME_CODE);
        revised.interfaceHash = keccak256("adapter.interface.v2");
        revised.capabilityHash = keccak256("adapter.capability.v2");
        revised.configurationSchemaHash = keccak256("adapter.config.v2");
        revised.evidenceHash = keccak256("adapter.evidence.v2");

        assertEq(AdapterId.unwrap(registry.deriveAdapterId(revised)), AdapterId.unwrap(adapterId));

        AdapterDefinition memory otherKind = _definition();
        otherKind.kindId = AdapterDefinitionLib.ADAPTER_KIND_VENUE;
        assertTrue(AdapterId.unwrap(registry.deriveAdapterId(otherKind)) != AdapterId.unwrap(adapterId));

        AdapterDefinition memory otherReference = _definition();
        otherReference.referenceId = REFERENCE_SECONDARY;
        assertTrue(AdapterId.unwrap(registry.deriveAdapterId(otherReference)) != AdapterId.unwrap(adapterId));

        assertEq(
            AdapterId.unwrap(adapterId),
            AdapterId.unwrap(IdLib.deriveAdapterId(AdapterDefinitionLib.hashKey(_definition())))
        );
    }

    /// @dev Identity is chain portable while qualification is chain local, so the same definition
    /// keeps one AdapterId on two chains and still produces two distinct commitments and versions.
    function test_QualificationIsChainBoundWhileIdentityIsNot() public {
        AdapterDefinition memory definition = _definition();

        bytes32 arbitrumHash = AdapterDefinitionLib.hashDefinition(definition, 42_161);
        bytes32 sepoliaHash = AdapterDefinitionLib.hashDefinition(definition, 421_614);
        assertTrue(arbitrumHash != sepoliaHash);
        assertTrue(
            AdapterDefinitionLib.hashVersion(adapterId, 1, arbitrumHash, 42_161)
                != AdapterDefinitionLib.hashVersion(adapterId, 1, arbitrumHash, 421_614)
        );

        vm.chainId(42_161);
        vm.prank(qualifier);
        (AdapterId firstId, uint32 firstVersion) = registry.registerAdapter(definition);

        vm.chainId(421_614);
        vm.prank(qualifier);
        (AdapterId secondId, uint32 secondVersion) = registry.registerAdapter(definition);

        assertEq(AdapterId.unwrap(firstId), AdapterId.unwrap(secondId));
        assertEq(firstVersion, 1);
        assertEq(secondVersion, 2);
        assertEq(registry.getAdapter(firstId, 1).definitionHash, arbitrumHash);
        assertEq(registry.getAdapter(firstId, 2).definitionHash, sepoliaHash);
    }

    /// @dev The kind space is open. A tag this deployment has never heard of registers exactly like
    /// a published one, which is what keeps future oracle, venue, curve, or risk kinds possible.
    function test_RegistrationAcceptsAnyNonzeroKindId() public {
        AdapterDefinition memory unknownKind = _definition();
        unknownKind.kindId = AdapterKindId.wrap(keccak256("vendor.invented.kind.2031"));

        vm.prank(qualifier);
        (AdapterId unknownKindId, uint32 version) = registry.registerAdapter(unknownKind);

        assertEq(version, 1);
        assertTrue(AdapterId.unwrap(unknownKindId) != AdapterId.unwrap(adapterId));
        assertEq(
            AdapterKindId.unwrap(registry.getAdapter(unknownKindId, 1).definition.kindId),
            AdapterKindId.unwrap(unknownKind.kindId)
        );
    }

    function test_RegistrationRejectsZeroFields() public {
        AdapterDefinition memory definition = _definition();

        definition.namespaceId = bytes32(0);
        _expectRegisterRevert(definition, ZeroAdapterNamespaceId.selector);

        definition = _definition();
        definition.referenceId = bytes32(0);
        _expectRegisterRevert(definition, ZeroAdapterReferenceId.selector);

        definition = _definition();
        definition.kindId = AdapterKindId.wrap(bytes32(0));
        _expectRegisterRevert(definition, ZeroAdapterKindId.selector);

        definition = _definition();
        definition.expectedRuntimeCodeHash = bytes32(0);
        _expectRegisterRevert(definition, ZeroAdapterRuntimeCodeHash.selector);

        definition = _definition();
        definition.interfaceHash = bytes32(0);
        _expectRegisterRevert(definition, ZeroAdapterInterfaceHash.selector);

        definition = _definition();
        definition.capabilityHash = bytes32(0);
        _expectRegisterRevert(definition, ZeroAdapterCapabilityHash.selector);

        definition = _definition();
        definition.configurationSchemaHash = bytes32(0);
        _expectRegisterRevert(definition, ZeroAdapterConfigurationSchemaHash.selector);

        definition = _definition();
        definition.evidenceHash = bytes32(0);
        _expectRegisterRevert(definition, ZeroAdapterEvidenceHash.selector);
    }

    function test_RegistrationRejectsZeroOrCodelessImplementation() public {
        AdapterDefinition memory definition = _definition();
        definition.implementation = address(0);
        _expectRegisterRevert(definition, ZeroAdapterImplementation.selector);

        definition = _definition();
        definition.implementation = outsider;

        vm.prank(qualifier);
        vm.expectRevert(abi.encodeWithSelector(AdapterImplementationHasNoCode.selector, outsider));
        registry.registerAdapter(definition);
    }

    function test_RegistrationRejectsRuntimeCodeHashMismatch() public {
        AdapterDefinition memory definition = _definition();
        definition.expectedRuntimeCodeHash = keccak256(REVISED_RUNTIME_CODE);

        vm.prank(qualifier);
        vm.expectRevert(
            abi.encodeWithSelector(
                AdapterRuntimeCodeHashMismatch.selector,
                implementation,
                keccak256(REVISED_RUNTIME_CODE),
                keccak256(RUNTIME_CODE)
            )
        );
        registry.registerAdapter(definition);
    }

    /// @dev Registration lands Paused, stores the whole definition and both commitments, and grants
    /// no authority at all: the active pointer stays at the zero sentinel.
    function test_RegistrationLandsPausedAndStoresTheVersion() public {
        vm.prank(qualifier);
        (AdapterId id, uint32 version) = registry.registerAdapter(_definition());

        AdapterVersion memory record = registry.getAdapter(id, version);

        assertEq(version, 1);
        assertEq(uint8(record.status), uint8(RegistryStatus.Paused));
        assertEq(record.version, 1);
        assertEq(record.definitionHash, AdapterDefinitionLib.hashDefinition(_definition(), block.chainid));
        assertEq(record.versionHash, AdapterDefinitionLib.hashVersion(id, 1, record.definitionHash, block.chainid));
        assertEq(record.definition.implementation, implementation);
        assertEq(record.definition.expectedRuntimeCodeHash, keccak256(RUNTIME_CODE));
        assertEq(record.definition.interfaceHash, INTERFACE_HASH);
        assertEq(record.definition.capabilityHash, CAPABILITY_HASH);
        assertEq(record.definition.configurationSchemaHash, CONFIGURATION_SCHEMA_HASH);
        assertEq(record.definition.evidenceHash, EVIDENCE_HASH);

        assertEq(registry.latestVersion(id), 1);
        assertEq(registry.activeVersion(id), 0);
        assertEq(registry.adapterCount(), 1);
        assertTrue(registry.exists(id, 1));
        assertTrue(registry.runtimeMatches(id, 1));
        assertFalse(registry.isOpenForNewRisk(id, 1));
        assertTrue(registry.isLifecycleEnabled(id, 1));
    }

    /// @dev The event carries every field an indexer needs to rebuild the version, because the
    /// registry keeps no enumerable array.
    function test_RegistrationEmitsAReconstructableEvent() public {
        AdapterDefinition memory definition = _definition();
        bytes32 definitionHash = AdapterDefinitionLib.hashDefinition(definition, block.chainid);
        bytes32 versionHash = AdapterDefinitionLib.hashVersion(adapterId, 1, definitionHash, block.chainid);

        vm.expectEmit(true, true, true, true, address(registry));
        emit IAdapterRegistry.AdapterRegistered(
            adapterId, 1, versionHash, definitionHash, definition, block.chainid, RegistryStatus.Paused, qualifier
        );

        vm.prank(qualifier);
        registry.registerAdapter(definition);
    }

    function test_VersionsAreSequentialAndDuplicateDefinitionsRevert() public {
        AdapterDefinition memory definition = _definition();

        vm.prank(qualifier);
        (AdapterId id,) = registry.registerAdapter(definition);

        vm.prank(qualifier);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAdapterRegistry.DuplicateAdapterDefinition.selector,
                id,
                AdapterDefinitionLib.hashDefinition(definition, block.chainid),
                uint32(1)
            )
        );
        registry.registerAdapter(definition);

        AdapterDefinition memory revised = _revisedDefinition();
        vm.prank(qualifier);
        (, uint32 secondVersion) = registry.registerAdapter(revised);

        assertEq(secondVersion, 2);
        assertEq(registry.latestVersion(id), 2);
        assertEq(registry.adapterCount(), 2);
    }

    /// @dev Exhaustion is unreachable in practice, so the latest-version pointer is poked directly
    /// to prove the named error replaces what would otherwise be an opaque arithmetic panic. The slot
    /// is discovered through the getter rather than hardcoded, so inherited storage layout changes
    /// cannot silently point this at the wrong word.
    function test_VersionExhaustionIsANamedError() public {
        vm.record();
        registry.latestVersion(adapterId);
        (bytes32[] memory readSlots,) = vm.accesses(address(registry));
        vm.store(address(registry), readSlots[0], bytes32(uint256(type(uint32).max)));

        vm.prank(qualifier);
        vm.expectRevert(abi.encodeWithSelector(IAdapterRegistry.AdapterVersionExhausted.selector, adapterId));
        registry.registerAdapter(_definition());
    }

    /// @dev Qualifying an implementation and opening risk against it are different authorities and
    /// are never held by the same role.
    function test_RolesAreSeparated() public {
        bytes32 qualifierRole = registry.ADAPTER_QUALIFIER_ROLE();
        bytes32 statusManagerRole = registry.ADAPTER_STATUS_MANAGER_ROLE();

        vm.prank(statusManager);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, statusManager, qualifierRole
            )
        );
        registry.registerAdapter(_definition());

        vm.prank(qualifier);
        (AdapterId id, uint32 version) = registry.registerAdapter(_definition());

        vm.prank(qualifier);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, qualifier, statusManagerRole
            )
        );
        registry.activateAdapter(id, version);

        vm.prank(outsider);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, outsider, qualifierRole)
        );
        registry.registerAdapter(_definition());
    }

    function test_TransitionGraphIsEnforcedAndDeprecatedIsTerminal() public {
        (AdapterId id, uint32 version) = _register(_definition());

        vm.prank(statusManager);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAdapterRegistry.InvalidAdapterTransition.selector,
                id,
                version,
                RegistryStatus.Paused,
                RegistryStatus.Paused
            )
        );
        registry.pauseAdapter(id, version);

        vm.prank(statusManager);
        registry.activateAdapter(id, version);
        assertEq(uint8(registry.statusOf(id, version)), uint8(RegistryStatus.Active));

        vm.prank(statusManager);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAdapterRegistry.InvalidAdapterTransition.selector,
                id,
                version,
                RegistryStatus.Active,
                RegistryStatus.Active
            )
        );
        registry.activateAdapter(id, version);

        vm.prank(statusManager);
        registry.pauseAdapter(id, version);

        vm.prank(statusManager);
        registry.deprecateAdapter(id, version);
        assertEq(uint8(registry.statusOf(id, version)), uint8(RegistryStatus.Deprecated));

        vm.prank(statusManager);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAdapterRegistry.InvalidAdapterTransition.selector,
                id,
                version,
                RegistryStatus.Deprecated,
                RegistryStatus.Active
            )
        );
        registry.activateAdapter(id, version);

        vm.prank(statusManager);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAdapterRegistry.InvalidAdapterTransition.selector,
                id,
                version,
                RegistryStatus.Deprecated,
                RegistryStatus.Deprecated
            )
        );
        registry.deprecateAdapter(id, version);
    }

    /// @dev A second activation never silently displaces the incumbent, and clearing the pointer is
    /// an explicit event rather than an inferred absence.
    function test_OnlyOneVersionIsActiveAndPausingClearsThePointer() public {
        (AdapterId id,) = _register(_definition());
        (, uint32 secondVersion) = _register(_revisedDefinition());

        vm.prank(statusManager);
        registry.activateAdapter(id, 1);

        vm.prank(statusManager);
        vm.expectRevert(abi.encodeWithSelector(IAdapterRegistry.AnotherAdapterVersionActive.selector, id, uint32(1)));
        registry.activateAdapter(id, secondVersion);

        assertEq(registry.activeVersion(id), 1);
        assertEq(uint8(registry.statusOf(id, secondVersion)), uint8(RegistryStatus.Paused));

        vm.expectEmit(true, true, true, true, address(registry));
        emit IAdapterRegistry.AdapterActiveVersionChanged(id, 1, 0, statusManager);
        vm.prank(statusManager);
        registry.pauseAdapter(id, 1);

        assertEq(registry.activeVersion(id), 0);
        assertFalse(registry.isOpenForNewRisk(id, 1));

        vm.prank(statusManager);
        registry.activateAdapter(id, secondVersion);
        assertEq(registry.activeVersion(id), secondVersion);
        assertTrue(registry.isOpenForNewRisk(id, secondVersion));

        vm.prank(statusManager);
        registry.deprecateAdapter(id, secondVersion);
        assertEq(registry.activeVersion(id), 0);
    }

    /// @dev Activation is revalidated against live chain state, because the address may have been
    /// redeployed with different code since it was qualified.
    function test_ActivationFailsClosedOnRuntimeDrift() public {
        (AdapterId id, uint32 version) = _register(_definition());

        vm.etch(implementation, REVISED_RUNTIME_CODE);

        vm.prank(statusManager);
        vm.expectRevert(
            abi.encodeWithSelector(
                AdapterRuntimeCodeHashMismatch.selector,
                implementation,
                keccak256(RUNTIME_CODE),
                keccak256(REVISED_RUNTIME_CODE)
            )
        );
        registry.activateAdapter(id, version);

        assertEq(uint8(registry.statusOf(id, version)), uint8(RegistryStatus.Paused));
        assertFalse(registry.runtimeMatches(id, version));

        vm.etch(implementation, RUNTIME_CODE);
        vm.prank(statusManager);
        registry.activateAdapter(id, version);
        assertTrue(registry.isOpenForNewRisk(id, version));
    }

    /// @dev Drift after activation closes new risk immediately without any transaction, while
    /// lifecycle resolvability is untouched.
    function test_RuntimeDriftClosesNewRiskButNotLifecycle() public {
        (AdapterId id, uint32 version) = _register(_definition());

        vm.prank(statusManager);
        registry.activateAdapter(id, version);
        assertTrue(registry.isOpenForNewRisk(id, version));

        vm.etch(implementation, REVISED_RUNTIME_CODE);

        assertFalse(registry.runtimeMatches(id, version));
        assertFalse(registry.isOpenForNewRisk(id, version));
        assertTrue(registry.isLifecycleEnabled(id, version));
        assertEq(uint8(registry.statusOf(id, version)), uint8(RegistryStatus.Active));
        assertEq(registry.activeVersion(id), version);
    }

    /// @dev Positions opened through a retired adapter must stay resolvable, so a deprecated version
    /// keeps its stored definition and both commitments forever.
    function test_HistoricalVersionsStayResolvableAfterDeprecation() public {
        (AdapterId id, uint32 version) = _register(_definition());
        AdapterVersion memory beforeStatusChange = registry.getAdapter(id, version);

        vm.startPrank(statusManager);
        registry.activateAdapter(id, version);
        registry.deprecateAdapter(id, version);
        vm.stopPrank();

        AdapterVersion memory afterStatusChange = registry.getAdapter(id, version);

        assertEq(afterStatusChange.definitionHash, beforeStatusChange.definitionHash);
        assertEq(afterStatusChange.versionHash, beforeStatusChange.versionHash);
        assertEq(afterStatusChange.definition.implementation, beforeStatusChange.definition.implementation);
        assertEq(afterStatusChange.definition.evidenceHash, beforeStatusChange.definition.evidenceHash);
        assertEq(uint8(afterStatusChange.status), uint8(RegistryStatus.Deprecated));

        assertTrue(registry.isLifecycleEnabled(id, version));
        assertTrue(registry.exists(id, version));
        assertFalse(registry.isOpenForNewRisk(id, version));
    }

    function test_UnknownVersionsRevertOnGetAndMutationsButAnswerSentinels() public {
        AdapterId unknownId = AdapterId.wrap(keccak256("unknown.adapter"));

        vm.expectRevert(abi.encodeWithSelector(IAdapterRegistry.UnknownAdapterVersion.selector, unknownId, uint32(1)));
        registry.getAdapter(unknownId, 1);

        vm.startPrank(statusManager);
        vm.expectRevert(abi.encodeWithSelector(IAdapterRegistry.UnknownAdapterVersion.selector, unknownId, uint32(1)));
        registry.activateAdapter(unknownId, 1);

        vm.expectRevert(abi.encodeWithSelector(IAdapterRegistry.UnknownAdapterVersion.selector, unknownId, uint32(1)));
        registry.pauseAdapter(unknownId, 1);

        vm.expectRevert(abi.encodeWithSelector(IAdapterRegistry.UnknownAdapterVersion.selector, unknownId, uint32(1)));
        registry.deprecateAdapter(unknownId, 1);
        vm.stopPrank();

        assertEq(uint8(registry.statusOf(unknownId, 1)), uint8(RegistryStatus.Unspecified));
        assertEq(registry.latestVersion(unknownId), 0);
        assertEq(registry.activeVersion(unknownId), 0);
        assertFalse(registry.exists(unknownId, 1));
        assertFalse(registry.runtimeMatches(unknownId, 1));
        assertFalse(registry.isOpenForNewRisk(unknownId, 1));
        assertFalse(registry.isLifecycleEnabled(unknownId, 1));
    }

    /// @dev A multi-capability deployment is a legitimate shape, so one implementation address may
    /// back several lineages and several kinds at once. Address uniqueness is never enforced.
    function test_OneImplementationMayBackSeveralAdaptersAndKinds() public {
        AdapterDefinition memory venue = _definition();
        venue.kindId = AdapterDefinitionLib.ADAPTER_KIND_VENUE;

        AdapterDefinition memory otherReference = _definition();
        otherReference.referenceId = REFERENCE_SECONDARY;

        (AdapterId benchmarkAdapter,) = _register(_definition());
        (AdapterId venueAdapter,) = _register(venue);
        (AdapterId secondaryAdapter,) = _register(otherReference);

        assertTrue(AdapterId.unwrap(benchmarkAdapter) != AdapterId.unwrap(venueAdapter));
        assertTrue(AdapterId.unwrap(benchmarkAdapter) != AdapterId.unwrap(secondaryAdapter));

        assertEq(registry.getAdapter(venueAdapter, 1).definition.implementation, implementation);
        assertEq(registry.getAdapter(secondaryAdapter, 1).definition.implementation, implementation);
        assertEq(registry.adapterCount(), 3);

        vm.startPrank(statusManager);
        registry.activateAdapter(benchmarkAdapter, 1);
        registry.activateAdapter(venueAdapter, 1);
        vm.stopPrank();

        assertTrue(registry.isOpenForNewRisk(benchmarkAdapter, 1));
        assertTrue(registry.isOpenForNewRisk(venueAdapter, 1));
    }

    /// @dev adapterCount counts immutable versions, not lineages, so it is the number of records an
    /// indexer must have seen.
    function test_AdapterCountCountsVersionsNotLineages() public {
        assertEq(registry.adapterCount(), 0);

        _register(_definition());
        assertEq(registry.adapterCount(), 1);

        _register(_revisedDefinition());
        assertEq(registry.adapterCount(), 2);

        AdapterDefinition memory otherLineage = _definition();
        otherLineage.referenceId = REFERENCE_SECONDARY;
        _register(otherLineage);
        assertEq(registry.adapterCount(), 3);
    }

    function _register(AdapterDefinition memory definition) internal returns (AdapterId id, uint32 version) {
        vm.prank(qualifier);
        (id, version) = registry.registerAdapter(definition);
    }

    function _expectRegisterRevert(AdapterDefinition memory definition, bytes4 selector) internal {
        vm.prank(qualifier);
        vm.expectRevert(selector);
        registry.registerAdapter(definition);
    }

    function _definition() internal view returns (AdapterDefinition memory) {
        return AdapterDefinition({
            namespaceId: NAMESPACE_ID,
            referenceId: REFERENCE_PRIMARY,
            kindId: AdapterDefinitionLib.ADAPTER_KIND_BENCHMARK,
            implementation: implementation,
            expectedRuntimeCodeHash: keccak256(RUNTIME_CODE),
            interfaceHash: INTERFACE_HASH,
            capabilityHash: CAPABILITY_HASH,
            configurationSchemaHash: CONFIGURATION_SCHEMA_HASH,
            evidenceHash: EVIDENCE_HASH
        });
    }

    /// @dev The same lineage re-qualified against a replacement implementation, which is exactly the
    /// upgrade path: a new immutable version under an unchanged AdapterId.
    function _revisedDefinition() internal view returns (AdapterDefinition memory revised) {
        revised = _definition();
        revised.implementation = revisedImplementation;
        revised.expectedRuntimeCodeHash = keccak256(REVISED_RUNTIME_CODE);
        revised.interfaceHash = keccak256("adapter.interface.v2");
        revised.evidenceHash = keccak256("adapter.evidence.v2");
    }
}
