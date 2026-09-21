// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {AssetDefinitionLib} from "../../src/libraries/AssetDefinitionLib.sol";
import {AssetRegistry} from "../../src/registry/AssetRegistry.sol";
import {AssetDefinition} from "../../src/types/AssetDefinition.sol";
import {RegistryStatus} from "../../src/types/Enums.sol";
import {AssetId} from "../../src/types/Identifiers.sol";
import {AssetRegistryHandler} from "./handlers/AssetRegistryHandler.sol";

/// forge-config: default.invariant.fail-on-revert = true
/// forge-config: ci.invariant.fail-on-revert = true
contract AssetRegistryInvariantTest is Test {
    AssetRegistry internal registry;
    AssetRegistryHandler internal handler;

    function setUp() public {
        registry = new AssetRegistry(3 days, address(this));
        handler = new AssetRegistryHandler(registry, makeAddr("outsider"));

        registry.grantRole(registry.REGISTRAR_ROLE(), address(handler));
        registry.grantRole(registry.STATUS_MANAGER_ROLE(), address(handler));

        bytes4[] memory selectors = new bytes4[](7);
        selectors[0] = AssetRegistryHandler.registerAsset.selector;
        selectors[1] = AssetRegistryHandler.registerDuplicate.selector;
        selectors[2] = AssetRegistryHandler.pauseAsset.selector;
        selectors[3] = AssetRegistryHandler.activateAsset.selector;
        selectors[4] = AssetRegistryHandler.deprecateAsset.selector;
        selectors[5] = AssetRegistryHandler.registerAssetUnauthorized.selector;
        selectors[6] = AssetRegistryHandler.mutateStatusUnauthorized.selector;

        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    /// @dev Proves a run was not vacuous: a handler that registered nothing, moved no status, or
    /// never hit a rejected path would otherwise satisfy every invariant below trivially.
    function afterInvariant() public view {
        assertGt(handler.uniqueRegistrations(), 0, "handler never registered an asset");
        assertGt(handler.successfulStatusOps(), 0, "handler never moved a status");
        assertGt(handler.rejectedCalls(), 0, "handler never exercised a rejected path");
    }

    function invariant_RegisteredAssetsAlwaysExist() public view {
        uint256 trackedCount = handler.trackedCount();

        for (uint256 i = 0; i < trackedCount; i++) {
            assertTrue(registry.exists(handler.trackedIdAt(i)), "registered asset stopped existing");
        }
    }

    function invariant_StatusIsNeverUnspecified() public view {
        uint256 trackedCount = handler.trackedCount();

        for (uint256 i = 0; i < trackedCount; i++) {
            assertTrue(
                registry.statusOf(handler.trackedIdAt(i)) != RegistryStatus.Unspecified,
                "registered asset fell back to Unspecified"
            );
        }
    }

    function invariant_StoredDefinitionHashesToStoredDefinitionHash() public view {
        uint256 trackedCount = handler.trackedCount();

        for (uint256 i = 0; i < trackedCount; i++) {
            AssetId assetId = handler.trackedIdAt(i);
            (AssetDefinition memory stored, bytes32 definitionHash,) = registry.getAsset(assetId);

            assertEq(
                AssetDefinitionLib.hashDefinition(stored), definitionHash, "stored definition no longer hashes to hash"
            );
        }
    }

    function invariant_AssetIdDerivesFromStoredDefinition() public view {
        uint256 trackedCount = handler.trackedCount();

        for (uint256 i = 0; i < trackedCount; i++) {
            AssetId assetId = handler.trackedIdAt(i);
            (AssetDefinition memory stored,,) = registry.getAsset(assetId);

            assertEq(
                AssetId.unwrap(AssetDefinitionLib.deriveAssetId(stored)),
                AssetId.unwrap(assetId),
                "stored definition no longer derives its key"
            );
        }
    }

    function invariant_DefinitionDataIsImmutable() public view {
        uint256 trackedCount = handler.trackedCount();

        for (uint256 i = 0; i < trackedCount; i++) {
            AssetId assetId = handler.trackedIdAt(i);
            AssetDefinition memory expected = handler.expectedDefinition(assetId);
            (AssetDefinition memory stored, bytes32 definitionHash,) = registry.getAsset(assetId);

            assertEq(stored.namespaceId, expected.namespaceId, "namespaceId mutated");
            assertEq(stored.referenceId, expected.referenceId, "referenceId mutated");
            assertEq(stored.symbol, expected.symbol, "symbol mutated");
            assertEq(uint8(stored.assetClass), uint8(expected.assetClass), "assetClass mutated");
            assertEq(stored.decimals, expected.decimals, "decimals mutated");
            assertEq(definitionHash, handler.expectedDefinitionHash(assetId), "definitionHash mutated");
        }
    }

    function invariant_DeprecatedNeverTransitionsOut() public view {
        uint256 trackedCount = handler.trackedCount();

        for (uint256 i = 0; i < trackedCount; i++) {
            AssetId assetId = handler.trackedIdAt(i);
            if (!handler.everDeprecated(assetId)) {
                continue;
            }

            assertEq(
                uint8(registry.statusOf(assetId)),
                uint8(RegistryStatus.Deprecated),
                "deprecated asset left its terminal status"
            );
        }
    }

    function invariant_AssetCountMatchesUniqueRegistrations() public view {
        assertEq(registry.assetCount(), handler.uniqueRegistrations(), "count drifted from successful registrations");
        assertEq(registry.assetCount(), handler.trackedCount(), "count drifted from the tracked asset set");
        assertLe(handler.trackedCount(), 8, "handler exceeded its tracked asset bound");
    }

    function invariant_ForbiddenCallsNeverSucceed() public view {
        assertFalse(handler.forbiddenCallSucceeded(), "a forbidden call was accepted");
    }
}
