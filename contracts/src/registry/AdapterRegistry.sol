// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";

import {IAdapterRegistry} from "../interfaces/IAdapterRegistry.sol";
import {AdapterDefinitionLib} from "../libraries/AdapterDefinitionLib.sol";
import {AdapterDefinition, AdapterVersion} from "../types/AdapterDefinition.sol";
import {RegistryStatus} from "../types/Enums.sol";
import {AdapterId} from "../types/Identifiers.sol";

/// @dev The canonical adapter registry. Each accepted definition becomes an immutable chain-local
/// version of a stable AdapterId lineage. Status is the only mutable field, nothing is ever deleted,
/// and at most one version per adapter is the active one.
///
/// @dev Registration lands in Paused so the qualifier who proposes an implementation can never be
/// the party that switches it on. Activation is a separate role, a separate act, and a fresh
/// revalidation of the live bytecode.
///
/// @dev The registry holds no funds, grants no approvals, and never calls, staticcalls,
/// delegatecalls, or interface-probes an implementation. Its only introspection is extcodesize and
/// extcodehash, so no adapter can ever execute in this contract's context or reenter it. Qualifying
/// an adapter is not running one.
///
/// @dev A runtime code hash attests the bytecode at the address, which behind a proxy is the proxy
/// bytecode alone. The evidenceHash of a definition is where the implementation slot, the upgrade
/// authority, the admin controls, the external dependencies, and the configuration must be covered.
contract AdapterRegistry is IAdapterRegistry, AccessControlDefaultAdminRules {
    bytes32 public constant ADAPTER_QUALIFIER_ROLE = keccak256("SETRYN_ADAPTER_QUALIFIER_ROLE");
    bytes32 public constant ADAPTER_STATUS_MANAGER_ROLE = keccak256("SETRYN_ADAPTER_STATUS_MANAGER_ROLE");

    /// @dev Version numbering starts at one, so zero is an unambiguous no-such-version sentinel for
    /// both the latest and the active pointer.
    uint32 private constant NO_VERSION = 0;

    mapping(AdapterId adapterId => mapping(uint32 version => AdapterVersion record)) private _versions;

    mapping(AdapterId adapterId => uint32 version) private _latestVersion;

    mapping(AdapterId adapterId => uint32 version) private _activeVersion;

    mapping(AdapterId adapterId => mapping(bytes32 definitionHash => uint32 version)) private _definitionVersion;

    uint256 private _adapterCount;

    /// @dev The zero check runs inside the base constructor argument so a Setryn error, not the
    /// OpenZeppelin one, is what a caller sees for a zero admin.
    constructor(uint48 defaultAdminDelay, address initialAdmin)
        AccessControlDefaultAdminRules(defaultAdminDelay, _requireInitialAdmin(initialAdmin))
    {
        _grantRole(ADAPTER_QUALIFIER_ROLE, initialAdmin);
        _grantRole(ADAPTER_STATUS_MANAGER_ROLE, initialAdmin);
    }

    /// @dev Every check, including the bytecode introspection, completes before any storage is
    /// touched. The implementation address is deliberately not required to be unique: one
    /// multi-capability deployment may legitimately back several adapter identities and kinds.
    function registerAdapter(AdapterDefinition calldata definition)
        external
        onlyRole(ADAPTER_QUALIFIER_ROLE)
        returns (AdapterId adapterId, uint32 version)
    {
        AdapterDefinitionLib.validate(definition);

        adapterId = AdapterDefinitionLib.deriveAdapterId(definition);
        bytes32 definitionHash = AdapterDefinitionLib.hashDefinition(definition, block.chainid);

        uint32 existingVersion = _definitionVersion[adapterId][definitionHash];
        if (existingVersion != NO_VERSION) {
            revert DuplicateAdapterDefinition(adapterId, definitionHash, existingVersion);
        }

        version = _latestVersion[adapterId];
        if (version == type(uint32).max) {
            revert AdapterVersionExhausted(adapterId);
        }

        version += 1;
        bytes32 versionHash = AdapterDefinitionLib.hashVersion(adapterId, version, definitionHash, block.chainid);

        _writeVersion(definition, adapterId, version, definitionHash, versionHash);

        emit AdapterRegistered(
            adapterId,
            version,
            versionHash,
            definitionHash,
            definition,
            block.chainid,
            RegistryStatus.Paused,
            msg.sender
        );
    }

    /// @dev Activation revalidates the live bytecode, because the implementation address may have
    /// been destroyed or redeployed with different code since the version was written. It fails
    /// closed rather than opening risk against an implementation nobody reviewed.
    function activateAdapter(AdapterId adapterId, uint32 version) external onlyRole(ADAPTER_STATUS_MANAGER_ROLE) {
        AdapterVersion storage record = _requireVersion(adapterId, version);
        _requireTransition(adapterId, version, record.status, RegistryStatus.Active);

        uint32 currentActive = _activeVersion[adapterId];
        if (currentActive != NO_VERSION) {
            revert AnotherAdapterVersionActive(adapterId, currentActive);
        }

        AdapterDefinitionLib.requireLiveRuntime(
            record.definition.implementation, record.definition.expectedRuntimeCodeHash
        );

        _setStatus(adapterId, version, record, RegistryStatus.Active);
        _setActiveVersion(adapterId, version);
    }

    function pauseAdapter(AdapterId adapterId, uint32 version) external onlyRole(ADAPTER_STATUS_MANAGER_ROLE) {
        _transition(adapterId, version, RegistryStatus.Paused);
    }

    function deprecateAdapter(AdapterId adapterId, uint32 version) external onlyRole(ADAPTER_STATUS_MANAGER_ROLE) {
        _transition(adapterId, version, RegistryStatus.Deprecated);
    }

    function getAdapter(AdapterId adapterId, uint32 version) external view returns (AdapterVersion memory) {
        return _requireVersion(adapterId, version);
    }

    function latestVersion(AdapterId adapterId) external view returns (uint32) {
        return _latestVersion[adapterId];
    }

    function activeVersion(AdapterId adapterId) external view returns (uint32) {
        return _activeVersion[adapterId];
    }

    function statusOf(AdapterId adapterId, uint32 version) external view returns (RegistryStatus) {
        return _versions[adapterId][version].status;
    }

    function adapterCount() external view returns (uint256) {
        return _adapterCount;
    }

    function exists(AdapterId adapterId, uint32 version) external view returns (bool) {
        return _versions[adapterId][version].status != RegistryStatus.Unspecified;
    }

    function runtimeMatches(AdapterId adapterId, uint32 version) external view returns (bool) {
        AdapterVersion storage record = _versions[adapterId][version];
        if (record.status == RegistryStatus.Unspecified) {
            return false;
        }
        return _runtimeMatches(record);
    }

    /// @dev The live gate is drift aware: a version that is Active on its own terms is closed for
    /// new risk the moment the bytecode at its implementation address stops matching.
    function isOpenForNewRisk(AdapterId adapterId, uint32 version) external view returns (bool) {
        AdapterVersion storage record = _versions[adapterId][version];
        if (record.status != RegistryStatus.Active || _activeVersion[adapterId] != version) {
            return false;
        }
        return _runtimeMatches(record);
    }

    function isLifecycleEnabled(AdapterId adapterId, uint32 version) external view returns (bool) {
        return _versions[adapterId][version].status != RegistryStatus.Unspecified;
    }

    function deriveAdapterId(AdapterDefinition calldata definition) external pure returns (AdapterId) {
        return AdapterDefinitionLib.deriveAdapterId(definition);
    }

    /// @dev The write path is split out of registerAdapter so the caller keeps only the values its
    /// event needs on the stack. Nothing here may run before every check above has passed.
    function _writeVersion(
        AdapterDefinition calldata definition,
        AdapterId adapterId,
        uint32 version,
        bytes32 definitionHash,
        bytes32 versionHash
    ) private {
        AdapterVersion storage record = _versions[adapterId][version];
        record.definition = definition;
        record.definitionHash = definitionHash;
        record.versionHash = versionHash;
        record.version = version;
        record.status = RegistryStatus.Paused;

        _latestVersion[adapterId] = version;
        _definitionVersion[adapterId][definitionHash] = version;
        _adapterCount += 1;
    }

    function _transition(AdapterId adapterId, uint32 version, RegistryStatus newStatus) private {
        AdapterVersion storage record = _requireVersion(adapterId, version);
        _requireTransition(adapterId, version, record.status, newStatus);

        _setStatus(adapterId, version, record, newStatus);

        if (_activeVersion[adapterId] == version) {
            _setActiveVersion(adapterId, NO_VERSION);
        }
    }

    function _setStatus(AdapterId adapterId, uint32 version, AdapterVersion storage record, RegistryStatus newStatus)
        private
    {
        RegistryStatus previousStatus = record.status;
        record.status = newStatus;

        emit AdapterStatusChanged(adapterId, version, previousStatus, newStatus, msg.sender);
    }

    function _setActiveVersion(AdapterId adapterId, uint32 newVersion) private {
        uint32 previousVersion = _activeVersion[adapterId];
        _activeVersion[adapterId] = newVersion;

        emit AdapterActiveVersionChanged(adapterId, previousVersion, newVersion, msg.sender);
    }

    function _requireVersion(AdapterId adapterId, uint32 version) private view returns (AdapterVersion storage record) {
        record = _versions[adapterId][version];
        if (record.status == RegistryStatus.Unspecified) {
            revert UnknownAdapterVersion(adapterId, version);
        }
    }

    function _requireTransition(
        AdapterId adapterId,
        uint32 version,
        RegistryStatus previousStatus,
        RegistryStatus newStatus
    ) private pure {
        if (!_isPermittedTransition(previousStatus, newStatus)) {
            revert InvalidAdapterTransition(adapterId, version, previousStatus, newStatus);
        }
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

    function _runtimeMatches(AdapterVersion storage record) private view returns (bool) {
        return AdapterDefinitionLib.runtimeMatches(
            record.definition.implementation, record.definition.expectedRuntimeCodeHash
        );
    }

    function _requireInitialAdmin(address initialAdmin) private pure returns (address) {
        if (initialAdmin == address(0)) {
            revert ZeroInitialAdmin();
        }
        return initialAdmin;
    }
}
