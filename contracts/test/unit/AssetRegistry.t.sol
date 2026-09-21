// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Test} from "forge-std/Test.sol";

import {IAssetRegistry} from "../../src/interfaces/IAssetRegistry.sol";
import {AssetDefinitionLib, ZeroSymbol} from "../../src/libraries/AssetDefinitionLib.sol";
import {AssetRegistry} from "../../src/registry/AssetRegistry.sol";
import {AssetDefinition} from "../../src/types/AssetDefinition.sol";
import {AssetClass, RegistryStatus} from "../../src/types/Enums.sol";
import {AssetId} from "../../src/types/Identifiers.sol";

contract AssetRegistryTest is Test {
    uint48 internal constant ADMIN_DELAY = 3 days;

    bytes32 internal constant NAMESPACE_ID = keccak256("setryn.crypto");
    bytes32 internal constant REFERENCE_ETH = keccak256("ethereum:native");
    bytes32 internal constant REFERENCE_BTC = keccak256("bitcoin:native");
    bytes32 internal constant REFERENCE_SOL = keccak256("solana:native");
    bytes32 internal constant SYMBOL = keccak256("SYM");
    bytes32 internal constant ALTERNATE_SYMBOL = keccak256("SYM2");

    address internal admin = makeAddr("admin");
    address internal registrar = makeAddr("registrar");
    address internal statusManager = makeAddr("statusManager");
    address internal outsider = makeAddr("outsider");
    address internal newRegistrar = makeAddr("newRegistrar");
    address internal newStatusManager = makeAddr("newStatusManager");

    AssetRegistry internal registry;

    function setUp() public {
        registry = new AssetRegistry(ADMIN_DELAY, admin);

        vm.startPrank(admin);
        registry.grantRole(registry.REGISTRAR_ROLE(), registrar);
        registry.grantRole(registry.STATUS_MANAGER_ROLE(), statusManager);
        vm.stopPrank();
    }

    function test_RoleConstantsAreFrozenAndDistinct() public view {
        assertEq(registry.REGISTRAR_ROLE(), keccak256(bytes("SETRYN_REGISTRAR_ROLE")));
        assertEq(registry.STATUS_MANAGER_ROLE(), keccak256(bytes("SETRYN_STATUS_MANAGER_ROLE")));
        assertTrue(registry.REGISTRAR_ROLE() != registry.STATUS_MANAGER_ROLE());
        assertTrue(registry.REGISTRAR_ROLE() != registry.DEFAULT_ADMIN_ROLE());
        assertTrue(registry.STATUS_MANAGER_ROLE() != registry.DEFAULT_ADMIN_ROLE());
    }

    function test_ConstructorGrantsEveryRoleToInitialAdmin() public {
        AssetRegistry fresh = new AssetRegistry(ADMIN_DELAY, admin);

        assertTrue(fresh.hasRole(fresh.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(fresh.hasRole(fresh.REGISTRAR_ROLE(), admin));
        assertTrue(fresh.hasRole(fresh.STATUS_MANAGER_ROLE(), admin));
        assertEq(fresh.defaultAdmin(), admin);
        assertEq(fresh.defaultAdminDelay(), ADMIN_DELAY);
        assertEq(fresh.assetCount(), 0);
    }

    function test_ConstructorRejectsZeroInitialAdmin() public {
        vm.expectRevert(IAssetRegistry.ZeroInitialAdmin.selector);
        new AssetRegistry(ADMIN_DELAY, address(0));
    }

    function test_ConstructorAcceptsZeroDelay() public {
        AssetRegistry fresh = new AssetRegistry(0, admin);

        assertEq(fresh.defaultAdminDelay(), 0);
        assertTrue(fresh.hasRole(fresh.DEFAULT_ADMIN_ROLE(), admin));
    }

    function test_RolesAreSeparate() public view {
        assertFalse(registry.hasRole(registry.STATUS_MANAGER_ROLE(), registrar));
        assertFalse(registry.hasRole(registry.REGISTRAR_ROLE(), statusManager));
        assertFalse(registry.hasRole(registry.DEFAULT_ADMIN_ROLE(), registrar));
        assertFalse(registry.hasRole(registry.DEFAULT_ADMIN_ROLE(), statusManager));
    }

    function test_OperationalRolesAreAdministeredByTheDefaultAdminRole() public view {
        assertEq(registry.getRoleAdmin(registry.REGISTRAR_ROLE()), registry.DEFAULT_ADMIN_ROLE());
        assertEq(registry.getRoleAdmin(registry.STATUS_MANAGER_ROLE()), registry.DEFAULT_ADMIN_ROLE());
    }

    function test_AdminGrantsRegistrarRole() public {
        bytes32 registrarRole = registry.REGISTRAR_ROLE();
        assertFalse(registry.hasRole(registrarRole, newRegistrar));

        vm.expectEmit(true, true, true, true, address(registry));
        emit IAccessControl.RoleGranted(registrarRole, newRegistrar, admin);

        vm.prank(admin);
        registry.grantRole(registrarRole, newRegistrar);

        assertTrue(registry.hasRole(registrarRole, newRegistrar));
        assertFalse(registry.hasRole(registry.STATUS_MANAGER_ROLE(), newRegistrar));

        vm.prank(newRegistrar);
        AssetId assetId = registry.registerAsset(_definition(REFERENCE_ETH));

        assertTrue(registry.exists(assetId));
        assertEq(registry.assetCount(), 1);
    }

    function test_AdminGrantsStatusManagerRole() public {
        AssetId assetId = _register(_definition(REFERENCE_ETH));
        bytes32 statusRole = registry.STATUS_MANAGER_ROLE();

        vm.expectEmit(true, true, true, true, address(registry));
        emit IAccessControl.RoleGranted(statusRole, newStatusManager, admin);

        vm.prank(admin);
        registry.grantRole(statusRole, newStatusManager);

        assertTrue(registry.hasRole(statusRole, newStatusManager));
        assertFalse(registry.hasRole(registry.REGISTRAR_ROLE(), newStatusManager));

        vm.prank(newStatusManager);
        registry.pauseAsset(assetId);

        assertEq(uint8(registry.statusOf(assetId)), uint8(RegistryStatus.Paused));
    }

    function test_AdminRevokesRegistrarRoleAndCapabilityIsLostImmediately() public {
        bytes32 registrarRole = registry.REGISTRAR_ROLE();
        AssetDefinition memory definition = _definition(REFERENCE_ETH);

        vm.expectEmit(true, true, true, true, address(registry));
        emit IAccessControl.RoleRevoked(registrarRole, registrar, admin);

        vm.prank(admin);
        registry.revokeRole(registrarRole, registrar);

        assertFalse(registry.hasRole(registrarRole, registrar));

        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, registrar, registrarRole)
        );
        vm.prank(registrar);
        registry.registerAsset(definition);

        assertEq(registry.assetCount(), 0);
    }

    function test_AdminRevokesStatusManagerRoleAndCapabilityIsLostImmediately() public {
        AssetId assetId = _register(_definition(REFERENCE_ETH));
        bytes32 statusRole = registry.STATUS_MANAGER_ROLE();

        vm.expectEmit(true, true, true, true, address(registry));
        emit IAccessControl.RoleRevoked(statusRole, statusManager, admin);

        vm.prank(admin);
        registry.revokeRole(statusRole, statusManager);

        assertFalse(registry.hasRole(statusRole, statusManager));

        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, statusManager, statusRole)
        );
        vm.prank(statusManager);
        registry.pauseAsset(assetId);

        assertEq(uint8(registry.statusOf(assetId)), uint8(RegistryStatus.Active));
    }

    function test_AdminCanRegrantARevokedRole() public {
        bytes32 registrarRole = registry.REGISTRAR_ROLE();

        vm.startPrank(admin);
        registry.revokeRole(registrarRole, registrar);
        registry.grantRole(registrarRole, registrar);
        vm.stopPrank();

        assertTrue(registry.hasRole(registrarRole, registrar));

        _register(_definition(REFERENCE_ETH));

        assertEq(registry.assetCount(), 1);
    }

    function test_NonAdminCannotGrantOperationalRoles() public {
        _assertCannotGrantOperationalRoles(registrar);
        _assertCannotGrantOperationalRoles(statusManager);
        _assertCannotGrantOperationalRoles(outsider);
    }

    function test_NonAdminCannotRevokeOperationalRoles() public {
        _assertCannotRevokeOperationalRoles(registrar);
        _assertCannotRevokeOperationalRoles(statusManager);
        _assertCannotRevokeOperationalRoles(outsider);
    }

    function test_RegisterRejectsCallerWithoutRegistrarRole() public {
        AssetDefinition memory definition = _definition(REFERENCE_ETH);

        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, outsider, registry.REGISTRAR_ROLE()
            )
        );
        vm.prank(outsider);
        registry.registerAsset(definition);

        assertEq(registry.assetCount(), 0);
    }

    function test_RegisterRejectsStatusManager() public {
        AssetDefinition memory definition = _definition(REFERENCE_ETH);

        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, statusManager, registry.REGISTRAR_ROLE()
            )
        );
        vm.prank(statusManager);
        registry.registerAsset(definition);
    }

    function test_StatusMutationsRejectRegistrar() public {
        AssetId assetId = _register(_definition(REFERENCE_ETH));
        bytes32 statusRole = registry.STATUS_MANAGER_ROLE();

        vm.startPrank(registrar);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, registrar, statusRole)
        );
        registry.pauseAsset(assetId);

        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, registrar, statusRole)
        );
        registry.activateAsset(assetId);

        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, registrar, statusRole)
        );
        registry.deprecateAsset(assetId);
        vm.stopPrank();

        assertEq(uint8(registry.statusOf(assetId)), uint8(RegistryStatus.Active));
    }

    function test_StatusMutationsRejectOutsider() public {
        AssetId assetId = _register(_definition(REFERENCE_ETH));

        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, outsider, registry.STATUS_MANAGER_ROLE()
            )
        );
        vm.prank(outsider);
        registry.pauseAsset(assetId);

        assertEq(uint8(registry.statusOf(assetId)), uint8(RegistryStatus.Active));
    }

    function test_RegisterStoresCompleteDefinition() public {
        AssetDefinition memory definition = _definition(REFERENCE_ETH);

        vm.prank(registrar);
        AssetId assetId = registry.registerAsset(definition);

        assertEq(AssetId.unwrap(assetId), AssetId.unwrap(AssetDefinitionLib.deriveAssetId(definition)));

        (AssetDefinition memory stored, bytes32 definitionHash, RegistryStatus status) = registry.getAsset(assetId);

        assertEq(stored.namespaceId, definition.namespaceId);
        assertEq(stored.referenceId, definition.referenceId);
        assertEq(stored.symbol, definition.symbol);
        assertEq(uint8(stored.assetClass), uint8(definition.assetClass));
        assertEq(stored.decimals, definition.decimals);
        assertEq(definitionHash, AssetDefinitionLib.hashDefinition(definition));
        assertEq(uint8(status), uint8(RegistryStatus.Active));

        assertTrue(registry.exists(assetId));
        assertTrue(registry.isActive(assetId));
        assertEq(uint8(registry.statusOf(assetId)), uint8(RegistryStatus.Active));
        assertEq(registry.assetCount(), 1);
    }

    function test_RegisterEmitsCompleteEvent() public {
        AssetDefinition memory definition = _definition(REFERENCE_ETH);
        AssetId assetId = AssetDefinitionLib.deriveAssetId(definition);

        vm.expectEmit(true, true, true, true, address(registry));
        emit IAssetRegistry.AssetRegistered(
            assetId,
            AssetDefinitionLib.hashDefinition(definition),
            definition.namespaceId,
            definition.referenceId,
            definition.symbol,
            definition.assetClass,
            definition.decimals,
            registrar
        );

        vm.prank(registrar);
        registry.registerAsset(definition);
    }

    function test_RegisterRejectsEveryInvalidField() public {
        AssetDefinition memory definition = _definition(REFERENCE_ETH);
        definition.symbol = bytes32(0);

        vm.expectRevert(ZeroSymbol.selector);
        vm.prank(registrar);
        registry.registerAsset(definition);

        assertEq(registry.assetCount(), 0);
    }

    function test_CountIncrementsOncePerRegistration() public {
        _register(_definition(REFERENCE_ETH));
        assertEq(registry.assetCount(), 1);

        _register(_definition(REFERENCE_BTC));
        assertEq(registry.assetCount(), 2);

        _register(_definition(REFERENCE_SOL));
        assertEq(registry.assetCount(), 3);
    }

    function test_DuplicateRegistrationWithIdenticalDefinitionReverts() public {
        AssetDefinition memory definition = _definition(REFERENCE_ETH);
        AssetId assetId = _register(definition);
        bytes32 definitionHash = AssetDefinitionLib.hashDefinition(definition);

        vm.expectRevert(
            abi.encodeWithSelector(
                IAssetRegistry.AssetAlreadyRegistered.selector, assetId, definitionHash, definitionHash
            )
        );
        vm.prank(registrar);
        registry.registerAsset(definition);

        assertEq(registry.assetCount(), 1);
    }

    function test_DuplicateRegistrationWithConflictingDefinitionReverts() public {
        AssetDefinition memory definition = _definition(REFERENCE_ETH);
        AssetId assetId = _register(definition);

        AssetDefinition memory conflicting = _definition(REFERENCE_ETH);
        conflicting.symbol = ALTERNATE_SYMBOL;
        conflicting.assetClass = AssetClass.TokenizedAsset;
        conflicting.decimals = 6;

        assertEq(AssetId.unwrap(AssetDefinitionLib.deriveAssetId(conflicting)), AssetId.unwrap(assetId));

        vm.expectRevert(
            abi.encodeWithSelector(
                IAssetRegistry.AssetAlreadyRegistered.selector,
                assetId,
                AssetDefinitionLib.hashDefinition(definition),
                AssetDefinitionLib.hashDefinition(conflicting)
            )
        );
        vm.prank(registrar);
        registry.registerAsset(conflicting);

        _assertDefinitionUnchanged(assetId, definition);
        assertEq(registry.assetCount(), 1);
    }

    function test_DuplicateRegistrationRevertsAfterDeprecation() public {
        AssetDefinition memory definition = _definition(REFERENCE_ETH);
        AssetId assetId = _register(definition);

        vm.prank(statusManager);
        registry.deprecateAsset(assetId);

        vm.expectRevert(
            abi.encodeWithSelector(
                IAssetRegistry.AssetAlreadyRegistered.selector,
                assetId,
                AssetDefinitionLib.hashDefinition(definition),
                AssetDefinitionLib.hashDefinition(definition)
            )
        );
        vm.prank(registrar);
        registry.registerAsset(definition);

        assertEq(uint8(registry.statusOf(assetId)), uint8(RegistryStatus.Deprecated));
        assertEq(registry.assetCount(), 1);
    }

    function test_ActiveToPaused() public {
        AssetId assetId = _register(_definition(REFERENCE_ETH));

        vm.expectEmit(true, true, true, true, address(registry));
        emit IAssetRegistry.AssetStatusChanged(assetId, RegistryStatus.Active, RegistryStatus.Paused, statusManager);

        vm.prank(statusManager);
        registry.pauseAsset(assetId);

        assertEq(uint8(registry.statusOf(assetId)), uint8(RegistryStatus.Paused));
        assertTrue(registry.exists(assetId));
        assertFalse(registry.isActive(assetId));
    }

    function test_PausedToActive() public {
        AssetId assetId = _register(_definition(REFERENCE_ETH));

        vm.prank(statusManager);
        registry.pauseAsset(assetId);

        vm.expectEmit(true, true, true, true, address(registry));
        emit IAssetRegistry.AssetStatusChanged(assetId, RegistryStatus.Paused, RegistryStatus.Active, statusManager);

        vm.prank(statusManager);
        registry.activateAsset(assetId);

        assertTrue(registry.isActive(assetId));
    }

    function test_ActiveToDeprecated() public {
        AssetId assetId = _register(_definition(REFERENCE_ETH));

        vm.expectEmit(true, true, true, true, address(registry));
        emit IAssetRegistry.AssetStatusChanged(assetId, RegistryStatus.Active, RegistryStatus.Deprecated, statusManager);

        vm.prank(statusManager);
        registry.deprecateAsset(assetId);

        assertEq(uint8(registry.statusOf(assetId)), uint8(RegistryStatus.Deprecated));
    }

    function test_PausedToDeprecated() public {
        AssetId assetId = _register(_definition(REFERENCE_ETH));

        vm.startPrank(statusManager);
        registry.pauseAsset(assetId);

        vm.expectEmit(true, true, true, true, address(registry));
        emit IAssetRegistry.AssetStatusChanged(assetId, RegistryStatus.Paused, RegistryStatus.Deprecated, statusManager);

        registry.deprecateAsset(assetId);
        vm.stopPrank();

        assertEq(uint8(registry.statusOf(assetId)), uint8(RegistryStatus.Deprecated));
    }

    function test_ActiveToActiveIsForbidden() public {
        AssetId assetId = _register(_definition(REFERENCE_ETH));

        vm.expectRevert(
            abi.encodeWithSelector(
                IAssetRegistry.InvalidStatusTransition.selector, assetId, RegistryStatus.Active, RegistryStatus.Active
            )
        );
        vm.prank(statusManager);
        registry.activateAsset(assetId);
    }

    function test_PausedToPausedIsForbidden() public {
        AssetId assetId = _register(_definition(REFERENCE_ETH));

        vm.startPrank(statusManager);
        registry.pauseAsset(assetId);

        vm.expectRevert(
            abi.encodeWithSelector(
                IAssetRegistry.InvalidStatusTransition.selector, assetId, RegistryStatus.Paused, RegistryStatus.Paused
            )
        );
        registry.pauseAsset(assetId);
        vm.stopPrank();
    }

    function test_DeprecatedIsTerminal() public {
        AssetDefinition memory definition = _definition(REFERENCE_ETH);
        AssetId assetId = _register(definition);

        vm.startPrank(statusManager);
        registry.deprecateAsset(assetId);

        vm.expectRevert(
            abi.encodeWithSelector(
                IAssetRegistry.InvalidStatusTransition.selector,
                assetId,
                RegistryStatus.Deprecated,
                RegistryStatus.Active
            )
        );
        registry.activateAsset(assetId);

        vm.expectRevert(
            abi.encodeWithSelector(
                IAssetRegistry.InvalidStatusTransition.selector,
                assetId,
                RegistryStatus.Deprecated,
                RegistryStatus.Paused
            )
        );
        registry.pauseAsset(assetId);

        vm.expectRevert(
            abi.encodeWithSelector(
                IAssetRegistry.InvalidStatusTransition.selector,
                assetId,
                RegistryStatus.Deprecated,
                RegistryStatus.Deprecated
            )
        );
        registry.deprecateAsset(assetId);
        vm.stopPrank();

        assertEq(uint8(registry.statusOf(assetId)), uint8(RegistryStatus.Deprecated));
        _assertDefinitionUnchanged(assetId, definition);
    }

    function test_StatusTransitionsNeverChangeDefinitionOrCount() public {
        AssetDefinition memory definition = _definition(REFERENCE_ETH);
        AssetId assetId = _register(definition);

        vm.startPrank(statusManager);
        registry.pauseAsset(assetId);
        _assertDefinitionUnchanged(assetId, definition);
        assertEq(registry.assetCount(), 1);

        registry.activateAsset(assetId);
        _assertDefinitionUnchanged(assetId, definition);
        assertEq(registry.assetCount(), 1);

        registry.deprecateAsset(assetId);
        _assertDefinitionUnchanged(assetId, definition);
        assertEq(registry.assetCount(), 1);
        vm.stopPrank();
    }

    function test_NonexistentGetters() public view {
        AssetId unknown = AssetId.wrap(keccak256("never registered"));

        assertFalse(registry.exists(unknown));
        assertFalse(registry.isActive(unknown));
        assertEq(uint8(registry.statusOf(unknown)), uint8(RegistryStatus.Unspecified));
    }

    function test_GetAssetRevertsForNonexistentId() public {
        AssetId unknown = AssetId.wrap(keccak256("never registered"));

        vm.expectRevert(abi.encodeWithSelector(IAssetRegistry.UnknownAsset.selector, unknown));
        registry.getAsset(unknown);
    }

    function test_StatusMutationsRevertForNonexistentId() public {
        AssetId unknown = AssetId.wrap(keccak256("never registered"));

        vm.startPrank(statusManager);
        vm.expectRevert(abi.encodeWithSelector(IAssetRegistry.UnknownAsset.selector, unknown));
        registry.pauseAsset(unknown);

        vm.expectRevert(abi.encodeWithSelector(IAssetRegistry.UnknownAsset.selector, unknown));
        registry.activateAsset(unknown);

        vm.expectRevert(abi.encodeWithSelector(IAssetRegistry.UnknownAsset.selector, unknown));
        registry.deprecateAsset(unknown);
        vm.stopPrank();

        assertEq(registry.assetCount(), 0);
    }

    function test_AssetIdDoesNotDependOnRegistryAddressOrChain() public {
        AssetDefinition memory definition = _definition(REFERENCE_ETH);
        AssetId first = _register(definition);

        AssetRegistry other = new AssetRegistry(ADMIN_DELAY, admin);
        assertTrue(address(other) != address(registry));

        vm.chainId(421614);
        vm.roll(block.number + 10_000);
        vm.warp(block.timestamp + 10_000);

        vm.prank(admin);
        AssetId second = other.registerAsset(definition);

        assertEq(AssetId.unwrap(second), AssetId.unwrap(first));
    }

    function _assertCannotGrantOperationalRoles(address caller) internal {
        bytes32 adminRole = registry.DEFAULT_ADMIN_ROLE();
        bytes32 registrarRole = registry.REGISTRAR_ROLE();
        bytes32 statusRole = registry.STATUS_MANAGER_ROLE();
        bytes memory expectedError =
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, caller, adminRole);

        vm.startPrank(caller);
        vm.expectRevert(expectedError);
        registry.grantRole(registrarRole, newRegistrar);

        vm.expectRevert(expectedError);
        registry.grantRole(statusRole, newStatusManager);
        vm.stopPrank();

        assertFalse(registry.hasRole(registrarRole, newRegistrar));
        assertFalse(registry.hasRole(statusRole, newStatusManager));
    }

    function _assertCannotRevokeOperationalRoles(address caller) internal {
        bytes32 adminRole = registry.DEFAULT_ADMIN_ROLE();
        bytes32 registrarRole = registry.REGISTRAR_ROLE();
        bytes32 statusRole = registry.STATUS_MANAGER_ROLE();
        bytes memory expectedError =
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, caller, adminRole);

        vm.startPrank(caller);
        vm.expectRevert(expectedError);
        registry.revokeRole(registrarRole, registrar);

        vm.expectRevert(expectedError);
        registry.revokeRole(statusRole, statusManager);
        vm.stopPrank();

        assertTrue(registry.hasRole(registrarRole, registrar));
        assertTrue(registry.hasRole(statusRole, statusManager));
    }

    function _register(AssetDefinition memory definition) internal returns (AssetId assetId) {
        vm.prank(registrar);
        assetId = registry.registerAsset(definition);
    }

    function _assertDefinitionUnchanged(AssetId assetId, AssetDefinition memory expected) internal view {
        (AssetDefinition memory stored, bytes32 definitionHash,) = registry.getAsset(assetId);

        assertEq(stored.namespaceId, expected.namespaceId);
        assertEq(stored.referenceId, expected.referenceId);
        assertEq(stored.symbol, expected.symbol);
        assertEq(uint8(stored.assetClass), uint8(expected.assetClass));
        assertEq(stored.decimals, expected.decimals);
        assertEq(definitionHash, AssetDefinitionLib.hashDefinition(expected));
    }

    function _definition(bytes32 referenceId) internal pure returns (AssetDefinition memory) {
        return AssetDefinition({
            namespaceId: NAMESPACE_ID,
            referenceId: referenceId,
            symbol: SYMBOL,
            assetClass: AssetClass.Crypto,
            decimals: 18
        });
    }
}
