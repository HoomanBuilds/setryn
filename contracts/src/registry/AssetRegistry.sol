// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";

import {IAssetRegistry} from "../interfaces/IAssetRegistry.sol";
import {AssetDefinitionLib} from "../libraries/AssetDefinitionLib.sol";
import {AssetDefinition} from "../types/AssetDefinition.sol";
import {RegistryStatus} from "../types/Enums.sol";
import {AssetId} from "../types/Identifiers.sol";

/// @dev The canonical asset registry. Definitions are immutable once written: status is the only
/// mutable field, it gates future qualification only, and nothing here ever deletes an asset.
contract AssetRegistry is IAssetRegistry, AccessControlDefaultAdminRules {
    bytes32 public constant REGISTRAR_ROLE = keccak256("SETRYN_REGISTRAR_ROLE");
    bytes32 public constant STATUS_MANAGER_ROLE = keccak256("SETRYN_STATUS_MANAGER_ROLE");

    struct AssetRecord {
        AssetDefinition definition;
        bytes32 definitionHash;
        RegistryStatus status;
    }

    mapping(AssetId assetId => AssetRecord record) private _records;

    uint256 private _assetCount;

    /// @dev The zero check runs inside the base constructor argument so a Setryn error, not the
    /// OpenZeppelin one, is what a caller sees for a zero admin.
    constructor(uint48 defaultAdminDelay, address initialAdmin)
        AccessControlDefaultAdminRules(defaultAdminDelay, _requireInitialAdmin(initialAdmin))
    {
        _grantRole(REGISTRAR_ROLE, initialAdmin);
        _grantRole(STATUS_MANAGER_ROLE, initialAdmin);
    }

    function registerAsset(AssetDefinition calldata definition)
        external
        onlyRole(REGISTRAR_ROLE)
        returns (AssetId assetId)
    {
        AssetDefinitionLib.validate(definition);

        assetId = AssetDefinitionLib.deriveAssetId(definition);
        bytes32 definitionHash = AssetDefinitionLib.hashDefinition(definition);

        AssetRecord storage record = _records[assetId];
        if (record.status != RegistryStatus.Unspecified) {
            revert AssetAlreadyRegistered(assetId, record.definitionHash, definitionHash);
        }

        record.definition = definition;
        record.definitionHash = definitionHash;
        record.status = RegistryStatus.Active;

        _assetCount += 1;

        emit AssetRegistered(
            assetId,
            definitionHash,
            definition.namespaceId,
            definition.referenceId,
            definition.symbol,
            definition.assetClass,
            definition.decimals,
            msg.sender
        );
    }

    function pauseAsset(AssetId assetId) external onlyRole(STATUS_MANAGER_ROLE) {
        _transition(assetId, RegistryStatus.Paused);
    }

    function activateAsset(AssetId assetId) external onlyRole(STATUS_MANAGER_ROLE) {
        _transition(assetId, RegistryStatus.Active);
    }

    function deprecateAsset(AssetId assetId) external onlyRole(STATUS_MANAGER_ROLE) {
        _transition(assetId, RegistryStatus.Deprecated);
    }

    function getAsset(AssetId assetId)
        external
        view
        returns (AssetDefinition memory definition, bytes32 definitionHash, RegistryStatus status)
    {
        AssetRecord storage record = _records[assetId];
        if (record.status == RegistryStatus.Unspecified) {
            revert UnknownAsset(assetId);
        }
        return (record.definition, record.definitionHash, record.status);
    }

    function statusOf(AssetId assetId) external view returns (RegistryStatus) {
        return _records[assetId].status;
    }

    function exists(AssetId assetId) external view returns (bool) {
        return _records[assetId].status != RegistryStatus.Unspecified;
    }

    function isActive(AssetId assetId) external view returns (bool) {
        return _records[assetId].status == RegistryStatus.Active;
    }

    function assetCount() external view returns (uint256) {
        return _assetCount;
    }

    function _transition(AssetId assetId, RegistryStatus newStatus) private {
        AssetRecord storage record = _records[assetId];
        RegistryStatus previousStatus = record.status;

        if (previousStatus == RegistryStatus.Unspecified) {
            revert UnknownAsset(assetId);
        }
        if (!_isPermittedTransition(previousStatus, newStatus)) {
            revert InvalidStatusTransition(assetId, previousStatus, newStatus);
        }

        record.status = newStatus;

        emit AssetStatusChanged(assetId, previousStatus, newStatus, msg.sender);
    }

    function _isPermittedTransition(RegistryStatus previousStatus, RegistryStatus newStatus)
        private
        pure
        returns (bool)
    {
        if (newStatus == RegistryStatus.Paused) {
            return previousStatus == RegistryStatus.Active;
        }
        if (newStatus == RegistryStatus.Active) {
            return previousStatus == RegistryStatus.Paused;
        }
        if (newStatus == RegistryStatus.Deprecated) {
            return previousStatus == RegistryStatus.Active || previousStatus == RegistryStatus.Paused;
        }
        return false;
    }

    function _requireInitialAdmin(address initialAdmin) private pure returns (address) {
        if (initialAdmin == address(0)) {
            revert ZeroInitialAdmin();
        }
        return initialAdmin;
    }
}
