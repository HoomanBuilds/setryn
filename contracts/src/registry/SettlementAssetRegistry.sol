// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import {IAssetRegistry} from "../interfaces/IAssetRegistry.sol";
import {ISettlementAssetRegistry} from "../interfaces/ISettlementAssetRegistry.sol";
import {SettlementAssetLib} from "../libraries/SettlementAssetLib.sol";
import {AssetDefinition} from "../types/AssetDefinition.sol";
import {RegistryStatus} from "../types/Enums.sol";
import {AssetId} from "../types/Identifiers.sol";
import {SettlementAssetBinding, SettlementAssetDefinition} from "../types/SettlementAssetDefinition.sol";
import {MAX_DECIMALS} from "../types/Units.sol";

/// @dev Chain-local operational qualification for canonical assets. AssetRegistry stays the
/// immutable, chain-portable identity source; this contract decides which ERC-20 contract on this
/// chain a given identity settles against, and whether that binding may take new risk right now.
///
/// @dev Every version is immutable once written. Status is the only mutable field, nothing is ever
/// deleted, and at most one version per asset is the active one. Registration lands in Paused so the
/// qualifier who proposes a binding can never be the party that switches it on.
///
/// @dev The registry holds no funds. It never calls transfer or approve, never delegatecalls, and
/// makes exactly two kinds of external read: the canonical registry and IERC20Metadata.decimals.
contract SettlementAssetRegistry is ISettlementAssetRegistry, AccessControlDefaultAdminRules {
    bytes32 public constant QUALIFIER_ROLE = keccak256("SETRYN_QUALIFIER_ROLE");
    bytes32 public constant STATUS_MANAGER_ROLE = keccak256("SETRYN_SETTLEMENT_STATUS_MANAGER_ROLE");

    /// @dev Version numbering starts at one, so zero is an unambiguous no-such-version sentinel for
    /// both the latest and the active pointer.
    uint32 private constant NO_VERSION = 0;

    IAssetRegistry private immutable _assetRegistry;

    mapping(AssetId assetId => mapping(uint32 version => SettlementAssetBinding binding)) private _bindings;

    mapping(AssetId assetId => uint32 version) private _latestVersion;

    mapping(AssetId assetId => uint32 version) private _activeVersion;

    /// @dev A token address is bound to at most one canonical asset for the life of this registry.
    /// Later versions of that same asset may reuse it; a second asset may never claim it.
    mapping(address token => AssetId assetId) private _tokenAsset;

    mapping(AssetId assetId => mapping(bytes32 definitionHash => uint32 version)) private _definitionVersion;

    uint256 private _bindingCount;

    /// @dev The zero check runs inside the base constructor argument so a Setryn error, not the
    /// OpenZeppelin one, is what a caller sees for a zero admin.
    constructor(uint48 defaultAdminDelay, address initialAdmin, IAssetRegistry assetRegistry_)
        AccessControlDefaultAdminRules(defaultAdminDelay, _requireInitialAdmin(initialAdmin))
    {
        if (address(assetRegistry_) == address(0)) {
            revert ZeroAssetRegistry();
        }
        if (address(assetRegistry_).code.length == 0) {
            revert AssetRegistryHasNoCode(address(assetRegistry_));
        }

        _assetRegistry = assetRegistry_;

        _grantRole(QUALIFIER_ROLE, initialAdmin);
        _grantRole(STATUS_MANAGER_ROLE, initialAdmin);
    }

    /// @dev Every check, including both external reads, completes before any storage is touched.
    function registerBinding(SettlementAssetDefinition calldata definition)
        external
        onlyRole(QUALIFIER_ROLE)
        returns (uint32 version)
    {
        AssetId assetId = definition.assetId;
        uint8 canonicalDecimals = _requireCanonicalDecimals(assetId);

        SettlementAssetLib.validate(definition);
        _requireReportedDecimals(definition.token, canonicalDecimals);

        _requireTokenUnclaimed(definition.token, assetId);

        bytes32 definitionHash = SettlementAssetLib.hashDefinition(definition, block.chainid);
        _requireUnseenDefinition(assetId, definitionHash);

        version = _latestVersion[assetId];
        if (version == type(uint32).max) {
            revert VersionExhausted(assetId);
        }

        version += 1;
        bytes32 versionHash = SettlementAssetLib.hashVersion(definitionHash, version, canonicalDecimals);

        _writeBinding(definition, version, definitionHash, versionHash, canonicalDecimals);

        emit SettlementAssetRegistered(
            assetId,
            version,
            versionHash,
            definitionHash,
            definition.token,
            definition.expectedRuntimeCodeHash,
            canonicalDecimals,
            definition.qualificationHash,
            block.chainid,
            msg.sender
        );
    }

    /// @dev Activation re-verifies the whole qualification against live chain state, because the
    /// token may have been upgraded or replaced since the version was written.
    function activateBinding(AssetId assetId, uint32 version) external onlyRole(STATUS_MANAGER_ROLE) {
        SettlementAssetBinding storage binding = _requireBinding(assetId, version);
        _requireTransition(assetId, version, binding.status, RegistryStatus.Active);

        uint32 currentActive = _activeVersion[assetId];
        if (currentActive != NO_VERSION) {
            revert AnotherVersionActive(assetId, currentActive);
        }

        RegistryStatus canonicalStatus = _assetRegistry.statusOf(assetId);
        if (canonicalStatus != RegistryStatus.Active) {
            revert CanonicalAssetNotActive(assetId, canonicalStatus);
        }

        address token = binding.definition.token;
        SettlementAssetLib.requireRuntimeCodeHash(token, binding.definition.expectedRuntimeCodeHash);
        _requireReportedDecimals(token, binding.decimals);

        _setStatus(assetId, version, binding, RegistryStatus.Active);
        _setActiveVersion(assetId, version);
    }

    function pauseBinding(AssetId assetId, uint32 version) external onlyRole(STATUS_MANAGER_ROLE) {
        _transition(assetId, version, RegistryStatus.Paused);
    }

    function deprecateBinding(AssetId assetId, uint32 version) external onlyRole(STATUS_MANAGER_ROLE) {
        _transition(assetId, version, RegistryStatus.Deprecated);
    }

    function assetRegistry() external view returns (IAssetRegistry) {
        return _assetRegistry;
    }

    /// @dev Reverts UnknownBinding rather than returning a zeroed struct, because an all-zero
    /// binding names the zero token and would read as a usable record.
    function getBinding(AssetId assetId, uint32 version) external view returns (SettlementAssetBinding memory) {
        return _requireBinding(assetId, version);
    }

    function latestVersion(AssetId assetId) external view returns (uint32) {
        return _latestVersion[assetId];
    }

    function activeVersion(AssetId assetId) external view returns (uint32) {
        return _activeVersion[assetId];
    }

    /// @dev Sentinel read. An unregistered version reads back as Unspecified, which is never a
    /// stored state, so no caller can confuse it with a live one.
    function statusOf(AssetId assetId, uint32 version) external view returns (RegistryStatus) {
        return _bindings[assetId][version].status;
    }

    function bindingCount() external view returns (uint256) {
        return _bindingCount;
    }

    function tokenAsset(address token) external view returns (AssetId) {
        return _tokenAsset[token];
    }

    function runtimeMatches(AssetId assetId, uint32 version) external view returns (bool) {
        SettlementAssetBinding storage binding = _bindings[assetId][version];
        if (binding.status == RegistryStatus.Unspecified) {
            return false;
        }
        return _runtimeMatches(binding);
    }

    function isOpenForNewRisk(AssetId assetId, uint32 version) external view returns (bool) {
        SettlementAssetBinding storage binding = _bindings[assetId][version];
        if (binding.status != RegistryStatus.Active || _activeVersion[assetId] != version) {
            return false;
        }
        if (!_assetRegistry.isActive(assetId)) {
            return false;
        }
        return _runtimeMatches(binding);
    }

    function isLifecycleEnabled(AssetId assetId, uint32 version) external view returns (bool) {
        return _bindings[assetId][version].status != RegistryStatus.Unspecified;
    }

    /// @dev The write path is split out of registerBinding so the caller keeps only the values its
    /// event needs on the stack. Nothing here may run before every check above has passed.
    function _writeBinding(
        SettlementAssetDefinition calldata definition,
        uint32 version,
        bytes32 definitionHash,
        bytes32 versionHash,
        uint8 decimals
    ) private {
        AssetId assetId = definition.assetId;

        SettlementAssetBinding storage binding = _bindings[assetId][version];
        binding.definition = definition;
        binding.definitionHash = definitionHash;
        binding.versionHash = versionHash;
        binding.version = version;
        binding.decimals = decimals;
        binding.status = RegistryStatus.Paused;

        _latestVersion[assetId] = version;
        _definitionVersion[assetId][definitionHash] = version;
        _tokenAsset[definition.token] = assetId;
        _bindingCount += 1;
    }

    function _transition(AssetId assetId, uint32 version, RegistryStatus newStatus) private {
        SettlementAssetBinding storage binding = _requireBinding(assetId, version);
        _requireTransition(assetId, version, binding.status, newStatus);

        _setStatus(assetId, version, binding, newStatus);

        if (_activeVersion[assetId] == version) {
            _setActiveVersion(assetId, NO_VERSION);
        }
    }

    function _setStatus(
        AssetId assetId,
        uint32 version,
        SettlementAssetBinding storage binding,
        RegistryStatus newStatus
    ) private {
        RegistryStatus previousStatus = binding.status;
        binding.status = newStatus;

        emit SettlementAssetStatusChanged(assetId, version, previousStatus, newStatus, msg.sender);
    }

    function _setActiveVersion(AssetId assetId, uint32 newVersion) private {
        uint32 previousVersion = _activeVersion[assetId];
        _activeVersion[assetId] = newVersion;

        emit SettlementAssetActiveVersionChanged(assetId, previousVersion, newVersion, msg.sender);
    }

    function _requireBinding(AssetId assetId, uint32 version)
        private
        view
        returns (SettlementAssetBinding storage binding)
    {
        binding = _bindings[assetId][version];
        if (binding.status == RegistryStatus.Unspecified) {
            revert UnknownBinding(assetId, version);
        }
    }

    function _requireTransition(
        AssetId assetId,
        uint32 version,
        RegistryStatus previousStatus,
        RegistryStatus newStatus
    ) private pure {
        if (!_isPermittedTransition(previousStatus, newStatus)) {
            revert InvalidBindingTransition(assetId, version, previousStatus, newStatus);
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

    function _requireTokenUnclaimed(address token, AssetId assetId) private view {
        AssetId boundAssetId = _tokenAsset[token];
        if (AssetId.unwrap(boundAssetId) != bytes32(0) && AssetId.unwrap(boundAssetId) != AssetId.unwrap(assetId)) {
            revert TokenBoundToDifferentAsset(token, boundAssetId, assetId);
        }
    }

    function _requireUnseenDefinition(AssetId assetId, bytes32 definitionHash) private view {
        uint32 existingVersion = _definitionVersion[assetId][definitionHash];
        if (existingVersion != NO_VERSION) {
            revert DuplicateSettlementDefinition(assetId, definitionHash, existingVersion);
        }
    }

    function _requireCanonicalDecimals(AssetId assetId) private view returns (uint8 canonicalDecimals) {
        if (!_assetRegistry.exists(assetId)) {
            revert UnknownCanonicalAsset(assetId);
        }

        (AssetDefinition memory definition,,) = _assetRegistry.getAsset(assetId);
        canonicalDecimals = definition.decimals;

        if (canonicalDecimals > MAX_DECIMALS) {
            revert CanonicalDecimalsOutOfRange(assetId, canonicalDecimals, MAX_DECIMALS);
        }
    }

    function _requireReportedDecimals(address token, uint8 expectedDecimals) private view {
        (bool available, bool wellFormed, uint8 reportedDecimals, uint256 rawDecimals) = _readDecimals(token);

        if (!available) {
            revert TokenDecimalsUnavailable(token);
        }
        if (!wellFormed) {
            revert TokenDecimalsMalformed(token, rawDecimals);
        }
        if (reportedDecimals != expectedDecimals) {
            revert TokenDecimalsMismatch(token, expectedDecimals, reportedDecimals);
        }
    }

    function _runtimeMatches(SettlementAssetBinding storage binding) private view returns (bool) {
        address token = binding.definition.token;
        if (!SettlementAssetLib.runtimeCodeHashMatches(token, binding.definition.expectedRuntimeCodeHash)) {
            return false;
        }

        (bool available, bool wellFormed, uint8 reportedDecimals,) = _readDecimals(token);
        return available && wellFormed && reportedDecimals == binding.decimals;
    }

    /// @dev A staticcall rather than a typed call, so a token that reverts, returns nothing, or
    /// returns a short or oversized word is a boolean outcome here instead of an unhandled revert
    /// inside a monitoring view.
    function _readDecimals(address token)
        private
        view
        returns (bool available, bool wellFormed, uint8 reportedDecimals, uint256 rawDecimals)
    {
        (bool success, bytes memory returnData) = token.staticcall(abi.encodeCall(IERC20Metadata.decimals, ()));

        if (!success || returnData.length != 32) {
            return (false, false, 0, 0);
        }

        rawDecimals = abi.decode(returnData, (uint256));
        if (rawDecimals > type(uint8).max) {
            return (true, false, 0, rawDecimals);
        }

        return (true, true, uint8(rawDecimals), rawDecimals);
    }

    function _requireInitialAdmin(address initialAdmin) private pure returns (address) {
        if (initialAdmin == address(0)) {
            revert ZeroInitialAdmin();
        }
        return initialAdmin;
    }
}
