// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Test} from "forge-std/Test.sol";

import {IAssetRegistry} from "../../src/interfaces/IAssetRegistry.sol";
import {AssetDefinitionLib} from "../../src/libraries/AssetDefinitionLib.sol";
import {AssetRegistry} from "../../src/registry/AssetRegistry.sol";
import {AssetDefinition} from "../../src/types/AssetDefinition.sol";
import {AssetClass, RegistryStatus} from "../../src/types/Enums.sol";
import {AssetId} from "../../src/types/Identifiers.sol";

contract AssetRegistryFuzzTest is Test {
    uint48 internal constant ADMIN_DELAY = 3 days;

    bytes32 internal constant NAMESPACE_ID = keccak256("setryn.crypto");
    bytes32 internal constant SYMBOL = keccak256("SYM");

    address internal admin = makeAddr("admin");
    address internal registrar = makeAddr("registrar");
    address internal statusManager = makeAddr("statusManager");

    AssetRegistry internal registry;

    function setUp() public {
        registry = new AssetRegistry(ADMIN_DELAY, admin);

        vm.startPrank(admin);
        registry.grantRole(registry.REGISTRAR_ROLE(), registrar);
        registry.grantRole(registry.STATUS_MANAGER_ROLE(), statusManager);
        vm.stopPrank();
    }

    function testFuzz_RegisterStoresAnyValidDefinition(
        bytes32 namespaceId,
        bytes32 referenceId,
        bytes32 symbol,
        uint8 assetClass,
        uint8 decimals
    ) public {
        AssetDefinition memory definition = _definition(namespaceId, referenceId, symbol, assetClass, decimals);

        vm.prank(registrar);
        AssetId assetId = registry.registerAsset(definition);

        (AssetDefinition memory stored, bytes32 definitionHash, RegistryStatus status) = registry.getAsset(assetId);

        assertEq(AssetId.unwrap(assetId), AssetId.unwrap(AssetDefinitionLib.deriveAssetId(definition)));
        assertEq(stored.namespaceId, definition.namespaceId);
        assertEq(stored.referenceId, definition.referenceId);
        assertEq(stored.symbol, definition.symbol);
        assertEq(uint8(stored.assetClass), uint8(definition.assetClass));
        assertEq(stored.decimals, definition.decimals);
        assertEq(definitionHash, AssetDefinitionLib.hashDefinition(definition));
        assertEq(uint8(status), uint8(RegistryStatus.Active));
        assertEq(registry.assetCount(), 1);
    }

    function testFuzz_DuplicateRejectedForAnyNonIdentityChange(
        bytes32 namespaceId,
        bytes32 referenceId,
        bytes32 symbol,
        bytes32 otherSymbol,
        uint8 assetClass,
        uint8 otherAssetClass,
        uint8 decimals,
        uint8 otherDecimals
    ) public {
        vm.assume(otherSymbol != bytes32(0));

        AssetDefinition memory definition = _definition(namespaceId, referenceId, symbol, assetClass, decimals);
        AssetDefinition memory conflicting =
            _definition(namespaceId, referenceId, otherSymbol, otherAssetClass, otherDecimals);

        vm.prank(registrar);
        AssetId assetId = registry.registerAsset(definition);

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

        assertEq(registry.assetCount(), 1);
    }

    function testFuzz_DistinctIdentitiesRegisterIndependently(
        bytes32 namespaceId,
        bytes32 referenceId,
        bytes32 otherReferenceId,
        bytes32 symbol
    ) public {
        vm.assume(referenceId != otherReferenceId);
        vm.assume(otherReferenceId != bytes32(0));

        AssetDefinition memory first = _definition(namespaceId, referenceId, symbol, 1, 18);
        AssetDefinition memory second = _definition(namespaceId, otherReferenceId, symbol, 1, 18);

        vm.startPrank(registrar);
        AssetId firstId = registry.registerAsset(first);
        AssetId secondId = registry.registerAsset(second);
        vm.stopPrank();

        assertTrue(AssetId.unwrap(firstId) != AssetId.unwrap(secondId));
        assertEq(registry.assetCount(), 2);
    }

    function testFuzz_UnauthorizedCallersAreAlwaysRejected(address caller, bytes32 referenceId) public {
        vm.assume(caller != registrar && caller != statusManager && caller != admin);

        AssetDefinition memory definition = _definition(NAMESPACE_ID, referenceId, SYMBOL, 1, 18);

        vm.prank(registrar);
        AssetId assetId = registry.registerAsset(definition);

        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, caller, registry.REGISTRAR_ROLE()
            )
        );
        vm.prank(caller);
        registry.registerAsset(definition);

        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, caller, registry.STATUS_MANAGER_ROLE()
            )
        );
        vm.prank(caller);
        registry.pauseAsset(assetId);

        assertEq(registry.assetCount(), 1);
        assertEq(uint8(registry.statusOf(assetId)), uint8(RegistryStatus.Active));
    }

    /// @dev Replays a random operation sequence against an off-chain model of the permitted
    /// transition graph, and re-checks the immutable fields after every step.
    function testFuzz_StatusSequenceFollowsTheTransitionGraph(uint8[8] memory operations, bytes32 referenceId) public {
        AssetDefinition memory definition = _definition(NAMESPACE_ID, referenceId, SYMBOL, 1, 18);
        bytes32 expectedHash = AssetDefinitionLib.hashDefinition(definition);

        vm.prank(registrar);
        AssetId assetId = registry.registerAsset(definition);

        RegistryStatus model = RegistryStatus.Active;

        for (uint256 i = 0; i < operations.length; i++) {
            RegistryStatus target = _targetStatus(operations[i]);
            bool expectedOk = _permitted(model, target);

            vm.prank(statusManager);
            (bool ok,) = address(registry).call(abi.encodeWithSelector(_selector(target), assetId));

            assertEq(ok, expectedOk, "transition outcome diverged from the model");
            if (ok) {
                model = target;
            }

            assertEq(uint8(registry.statusOf(assetId)), uint8(model));

            (AssetDefinition memory stored, bytes32 definitionHash,) = registry.getAsset(assetId);
            assertEq(stored.namespaceId, definition.namespaceId);
            assertEq(stored.referenceId, definition.referenceId);
            assertEq(stored.symbol, definition.symbol);
            assertEq(uint8(stored.assetClass), uint8(definition.assetClass));
            assertEq(stored.decimals, definition.decimals);
            assertEq(definitionHash, expectedHash);
            assertEq(registry.assetCount(), 1);
        }
    }

    function testFuzz_UnknownIdsAreNeverMutable(bytes32 rawAssetId) public {
        AssetId unknown = AssetId.wrap(rawAssetId);

        assertFalse(registry.exists(unknown));
        assertFalse(registry.isActive(unknown));
        assertEq(uint8(registry.statusOf(unknown)), uint8(RegistryStatus.Unspecified));

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

    function _targetStatus(uint8 operation) internal pure returns (RegistryStatus) {
        uint8 choice = operation % 3;
        if (choice == 0) {
            return RegistryStatus.Paused;
        }
        if (choice == 1) {
            return RegistryStatus.Active;
        }
        return RegistryStatus.Deprecated;
    }

    function _selector(RegistryStatus target) internal pure returns (bytes4) {
        if (target == RegistryStatus.Paused) {
            return IAssetRegistry.pauseAsset.selector;
        }
        if (target == RegistryStatus.Active) {
            return IAssetRegistry.activateAsset.selector;
        }
        return IAssetRegistry.deprecateAsset.selector;
    }

    function _permitted(RegistryStatus previous, RegistryStatus target) internal pure returns (bool) {
        if (target == RegistryStatus.Paused) {
            return previous == RegistryStatus.Active;
        }
        if (target == RegistryStatus.Active) {
            return previous == RegistryStatus.Paused;
        }
        return previous == RegistryStatus.Active || previous == RegistryStatus.Paused;
    }

    function _definition(bytes32 namespaceId, bytes32 referenceId, bytes32 symbol, uint8 assetClass, uint8 decimals)
        internal
        pure
        returns (AssetDefinition memory)
    {
        vm.assume(namespaceId != bytes32(0));
        vm.assume(referenceId != bytes32(0));
        vm.assume(symbol != bytes32(0));

        return AssetDefinition({
            namespaceId: namespaceId,
            referenceId: referenceId,
            symbol: symbol,
            assetClass: AssetClass((assetClass % 7) + 1),
            decimals: decimals
        });
    }
}
