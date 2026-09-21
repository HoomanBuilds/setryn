// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {CommonBase} from "forge-std/Base.sol";
import {StdCheats} from "forge-std/StdCheats.sol";
import {StdUtils} from "forge-std/StdUtils.sol";

import {AssetRegistry} from "../../../src/registry/AssetRegistry.sol";
import {AssetDefinition} from "../../../src/types/AssetDefinition.sol";
import {AssetClass} from "../../../src/types/Enums.sol";
import {AssetId} from "../../../src/types/Identifiers.sol";

/// @dev Drives the registry through bounded, deterministic sequences. Every registry call is
/// wrapped so a revert becomes recorded ghost state instead of a silently discarded step, and the
/// forbidden paths, unauthorized callers and duplicate registrations, record whether they ever
/// succeeded so a missing role check or a missing duplicate guard cannot pass as an invariant
/// success.
contract AssetRegistryHandler is CommonBase, StdCheats, StdUtils {
    uint256 internal constant MAX_TRACKED_ASSETS = 8;
    uint256 internal constant NAMESPACE_COUNT = 2;
    uint256 internal constant REFERENCE_COUNT = 4;

    AssetRegistry public registry;

    address public outsider;

    AssetId[] internal _trackedIds;

    mapping(AssetId assetId => bool tracked) internal _tracked;
    mapping(AssetId assetId => AssetDefinition definition) internal _expectedDefinition;
    mapping(AssetId assetId => bytes32 definitionHash) internal _expectedDefinitionHash;
    mapping(AssetId assetId => bool everDeprecated) internal _everDeprecated;

    uint256 public uniqueRegistrations;
    uint256 public successfulStatusOps;
    uint256 public rejectedCalls;
    bool public forbiddenCallSucceeded;

    constructor(AssetRegistry registry_, address outsider_) {
        registry = registry_;
        outsider = outsider_;
    }

    function registerAsset(uint256 seed) external {
        AssetDefinition memory definition = _buildDefinition(seed);

        try registry.registerAsset(definition) returns (AssetId assetId) {
            if (!_tracked[assetId]) {
                _tracked[assetId] = true;
                _trackedIds.push(assetId);
            }
            _expectedDefinition[assetId] = definition;
            _expectedDefinitionHash[assetId] = _hashDefinition(definition);
            uniqueRegistrations += 1;
        } catch {
            rejectedCalls += 1;
        }
    }

    function registerDuplicate(uint256 seed) external {
        if (_trackedIds.length == 0) {
            return;
        }

        AssetId assetId = _pick(seed);
        AssetDefinition memory conflicting = _expectedDefinition[assetId];
        conflicting.symbol = bytes32(_bound(seed, 1, type(uint256).max));
        conflicting.decimals = uint8(_bound(seed >> 8, 0, type(uint8).max));

        try registry.registerAsset(conflicting) returns (AssetId) {
            forbiddenCallSucceeded = true;
        } catch {
            rejectedCalls += 1;
        }
    }

    function pauseAsset(uint256 seed) external {
        if (_trackedIds.length == 0) {
            return;
        }

        AssetId assetId = _pick(seed);

        try registry.pauseAsset(assetId) {
            successfulStatusOps += 1;
        } catch {
            rejectedCalls += 1;
        }
    }

    function activateAsset(uint256 seed) external {
        if (_trackedIds.length == 0) {
            return;
        }

        AssetId assetId = _pick(seed);

        try registry.activateAsset(assetId) {
            successfulStatusOps += 1;
        } catch {
            rejectedCalls += 1;
        }
    }

    function deprecateAsset(uint256 seed) external {
        if (_trackedIds.length == 0) {
            return;
        }

        AssetId assetId = _pick(seed);

        try registry.deprecateAsset(assetId) {
            _everDeprecated[assetId] = true;
            successfulStatusOps += 1;
        } catch {
            rejectedCalls += 1;
        }
    }

    function registerAssetUnauthorized(uint256 seed) external {
        AssetDefinition memory definition = _buildDefinition(seed);
        uint256 countBefore = registry.assetCount();

        vm.prank(outsider);
        try registry.registerAsset(definition) returns (AssetId) {
            forbiddenCallSucceeded = true;
        } catch {
            rejectedCalls += 1;
        }

        if (registry.assetCount() != countBefore) {
            forbiddenCallSucceeded = true;
        }
    }

    function mutateStatusUnauthorized(uint256 seed) external {
        if (_trackedIds.length == 0) {
            return;
        }

        AssetId assetId = _pick(seed);
        uint8 statusBefore = uint8(registry.statusOf(assetId));
        uint256 action = _bound(seed >> 16, 0, 2);

        vm.prank(outsider);
        if (action == 0) {
            try registry.pauseAsset(assetId) {
                forbiddenCallSucceeded = true;
            } catch {
                rejectedCalls += 1;
            }
        } else if (action == 1) {
            try registry.activateAsset(assetId) {
                forbiddenCallSucceeded = true;
            } catch {
                rejectedCalls += 1;
            }
        } else {
            try registry.deprecateAsset(assetId) {
                forbiddenCallSucceeded = true;
            } catch {
                rejectedCalls += 1;
            }
        }

        if (uint8(registry.statusOf(assetId)) != statusBefore) {
            forbiddenCallSucceeded = true;
        }
    }

    function trackedCount() external view returns (uint256) {
        return _trackedIds.length;
    }

    function trackedIdAt(uint256 index) external view returns (AssetId) {
        return _trackedIds[index];
    }

    function expectedDefinition(AssetId assetId) external view returns (AssetDefinition memory) {
        return _expectedDefinition[assetId];
    }

    function expectedDefinitionHash(AssetId assetId) external view returns (bytes32) {
        return _expectedDefinitionHash[assetId];
    }

    function everDeprecated(AssetId assetId) external view returns (bool) {
        return _everDeprecated[assetId];
    }

    function _pick(uint256 seed) internal view returns (AssetId) {
        return _trackedIds[_bound(seed, 0, _trackedIds.length - 1)];
    }

    /// @dev Bounded to a small identity space so a run keeps re-touching the same assets instead of
    /// registering a fresh one on every call, and so the tracked set never exceeds its cap.
    function _buildDefinition(uint256 seed) internal view returns (AssetDefinition memory definition) {
        definition = AssetDefinition({
            namespaceId: bytes32(_bound(seed, 1, NAMESPACE_COUNT)),
            referenceId: bytes32(_bound(seed >> 8, 1, REFERENCE_COUNT)),
            symbol: bytes32(_bound(seed >> 16, 1, type(uint256).max)),
            assetClass: AssetClass(_bound(seed >> 24, 1, 7)),
            decimals: uint8(_bound(seed >> 32, 0, type(uint8).max))
        });

        if (_trackedIds.length >= MAX_TRACKED_ASSETS) {
            AssetDefinition memory tracked = _expectedDefinition[_pick(seed)];
            definition.namespaceId = tracked.namespaceId;
            definition.referenceId = tracked.referenceId;
        }

        if (seed % 11 == 0) {
            definition.symbol = bytes32(0);
        }
    }

    /// @dev Recomputed locally rather than read back from the registry so the ghost hash is an
    /// independent witness of what was submitted.
    function _hashDefinition(AssetDefinition memory definition) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256(
                    "SetrynAssetDefinitionV1(bytes32 namespaceId,bytes32 referenceId,bytes32 symbol,uint8 assetClass,uint8 decimals)"
                ),
                definition.namespaceId,
                definition.referenceId,
                definition.symbol,
                uint8(definition.assetClass),
                definition.decimals
            )
        );
    }
}
