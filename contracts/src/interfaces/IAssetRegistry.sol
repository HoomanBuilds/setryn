// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {AssetDefinition} from "../types/AssetDefinition.sol";
import {AssetClass, RegistryStatus} from "../types/Enums.sol";
import {AssetId} from "../types/Identifiers.sol";

interface IAssetRegistry {
    /// @dev Carries every definition field so an indexer can rebuild the full asset set from logs
    /// alone. The registry keeps no enumerable array; these events are the enumeration source.
    event AssetRegistered(
        AssetId indexed assetId,
        bytes32 indexed definitionHash,
        bytes32 indexed namespaceId,
        bytes32 referenceId,
        bytes32 symbol,
        AssetClass assetClass,
        uint8 decimals,
        address registrar
    );

    event AssetStatusChanged(
        AssetId indexed assetId, RegistryStatus previousStatus, RegistryStatus newStatus, address indexed operator
    );

    error ZeroInitialAdmin();

    error AssetAlreadyRegistered(AssetId assetId, bytes32 storedDefinitionHash, bytes32 submittedDefinitionHash);

    error UnknownAsset(AssetId assetId);

    error InvalidStatusTransition(AssetId assetId, RegistryStatus previousStatus, RegistryStatus newStatus);

    function registerAsset(AssetDefinition calldata definition) external returns (AssetId assetId);

    function pauseAsset(AssetId assetId) external;

    function activateAsset(AssetId assetId) external;

    function deprecateAsset(AssetId assetId) external;

    function getAsset(AssetId assetId)
        external
        view
        returns (AssetDefinition memory definition, bytes32 definitionHash, RegistryStatus status);

    function statusOf(AssetId assetId) external view returns (RegistryStatus);

    function exists(AssetId assetId) external view returns (bool);

    function isActive(AssetId assetId) external view returns (bool);

    function assetCount() external view returns (uint256);
}
