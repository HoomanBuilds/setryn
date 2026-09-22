// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";

import {IAdapterRegistry} from "../interfaces/IAdapterRegistry.sol";
import {IRiskDomainRegistry} from "../interfaces/IRiskDomainRegistry.sol";
import {ISettlementAssetRegistry} from "../interfaces/ISettlementAssetRegistry.sol";
import {RiskDomainDefinitionLib} from "../libraries/RiskDomainDefinitionLib.sol";
import {AdapterDefinition, AdapterVersion} from "../types/AdapterDefinition.sol";
import {RegistryStatus} from "../types/Enums.sol";
import {AdapterId, AdapterKindId, AssetId, RiskDomainId} from "../types/Identifiers.sol";
import {RiskDomainDefinition, RiskDomainVersion} from "../types/RiskDomainDefinition.sol";

/// @dev The canonical risk domain registry. Each accepted definition becomes an immutable
/// chain-local version of a stable RiskDomainId lineage, describing one isolated clearing perimeter.
/// Status is the only mutable field, nothing is ever deleted, and at most one version per domain is
/// the active one.
///
/// @dev Registration lands in Paused so the qualifier who proposes a risk policy can never be the
/// party that switches it on. Activation is a separate role, a separate act, and a fresh
/// dependency-aware revalidation of the collateral binding and the risk adapter.
///
/// @dev No risk is ever carried here. This contract stores and gates risk policy; the margin rules,
/// scenario set, concentration limits, default waterfall, and insurance policy it commits to are
/// resolved later by a risk engine and a clearing engine. It holds no funds, moves no tokens, grants
/// no approvals, never delegatecalls, and never accepts caller-supplied call data. Its only external
/// calls are view reads of its two immutable registry dependencies, and every one of them completes
/// before any storage write.
///
/// @dev The risk adapter is read for evidence only. This registry never calls an adapter
/// implementation; it compares the adapter's stored kind, interface, and capability commitments
/// against what the domain requires and fails closed on any difference.
///
/// @dev The two dependency registries have no objective graph relationship to each other: the
/// adapter registry has no registry dependencies at all, and the collateral binding it would be
/// compared against is not one of them. No closure check is invented between them, and this
/// constructor asserts none.
contract RiskDomainRegistry is IRiskDomainRegistry, AccessControlDefaultAdminRules {
    bytes32 public constant RISK_DOMAIN_QUALIFIER_ROLE = keccak256("SETRYN_RISK_DOMAIN_QUALIFIER_ROLE");
    bytes32 public constant RISK_DOMAIN_STATUS_MANAGER_ROLE = keccak256("SETRYN_RISK_DOMAIN_STATUS_MANAGER_ROLE");

    /// @dev Version numbering starts at one, so zero is an unambiguous no-such-version sentinel for
    /// both the latest and the active pointer.
    uint32 private constant NO_VERSION = 0;

    ISettlementAssetRegistry private immutable _settlementAssetRegistry;

    IAdapterRegistry private immutable _adapterRegistry;

    mapping(RiskDomainId riskDomainId => mapping(uint32 version => RiskDomainVersion record)) private _versions;

    mapping(RiskDomainId riskDomainId => uint32 version) private _latestVersion;

    mapping(RiskDomainId riskDomainId => uint32 version) private _activeVersion;

    mapping(RiskDomainId riskDomainId => mapping(bytes32 definitionHash => uint32 version)) private _definitionVersion;

    uint256 private _riskDomainCount;

    /// @dev The zero check runs inside the base constructor argument so a Setryn error, not the
    /// OpenZeppelin one, is what a caller sees for a zero admin.
    constructor(
        uint48 defaultAdminDelay,
        address initialAdmin,
        ISettlementAssetRegistry settlementAssetRegistry_,
        IAdapterRegistry adapterRegistry_
    ) AccessControlDefaultAdminRules(defaultAdminDelay, _requireInitialAdmin(initialAdmin)) {
        if (address(settlementAssetRegistry_) == address(0)) {
            revert ZeroSettlementAssetRegistry();
        }
        if (address(settlementAssetRegistry_).code.length == 0) {
            revert SettlementAssetRegistryHasNoCode(address(settlementAssetRegistry_));
        }
        if (address(adapterRegistry_) == address(0)) {
            revert ZeroAdapterRegistry();
        }
        if (address(adapterRegistry_).code.length == 0) {
            revert AdapterRegistryHasNoCode(address(adapterRegistry_));
        }

        _settlementAssetRegistry = settlementAssetRegistry_;
        _adapterRegistry = adapterRegistry_;

        _grantRole(RISK_DOMAIN_QUALIFIER_ROLE, initialAdmin);
        _grantRole(RISK_DOMAIN_STATUS_MANAGER_ROLE, initialAdmin);
    }

    /// @dev Every check, including both dependency reads, completes before any storage is touched.
    /// The referenced collateral binding and adapter version must exist and the adapter must be
    /// exactly compatible, but both are deliberately allowed to be Paused or Deprecated here,
    /// because registration grants no risk authority.
    function registerRiskDomain(RiskDomainDefinition calldata definition)
        external
        onlyRole(RISK_DOMAIN_QUALIFIER_ROLE)
        returns (RiskDomainId riskDomainId, uint32 version)
    {
        RiskDomainDefinitionLib.validate(definition);
        _requireDependencies(definition);

        riskDomainId = RiskDomainDefinitionLib.deriveRiskDomainId(definition);
        bytes32 definitionHash = RiskDomainDefinitionLib.hashDefinition(definition, block.chainid);

        uint32 existingVersion = _definitionVersion[riskDomainId][definitionHash];
        if (existingVersion != NO_VERSION) {
            revert DuplicateRiskDomainDefinition(riskDomainId, definitionHash, existingVersion);
        }

        version = _latestVersion[riskDomainId];
        if (version == type(uint32).max) {
            revert RiskDomainVersionExhausted(riskDomainId);
        }

        version += 1;
        bytes32 versionHash = RiskDomainDefinitionLib.hashVersion(riskDomainId, version, definitionHash, block.chainid);

        _writeVersion(definition, riskDomainId, version, definitionHash, versionHash);

        emit RiskDomainRegistered(
            riskDomainId,
            version,
            versionHash,
            definitionHash,
            definition,
            block.chainid,
            RegistryStatus.Paused,
            msg.sender
        );
    }

    /// @dev Activation re-reads both dependencies, because the collateral token may have been paused
    /// or deprecated and the adapter may have been paused or drifted from its qualified bytecode
    /// since registration. It fails closed rather than opening risk against a perimeter that cannot
    /// currently be margined or evaluated.
    function activateRiskDomain(RiskDomainId riskDomainId, uint32 version)
        external
        onlyRole(RISK_DOMAIN_STATUS_MANAGER_ROLE)
    {
        RiskDomainVersion storage record = _requireVersion(riskDomainId, version);
        _requireTransition(riskDomainId, version, record.status, RegistryStatus.Active);

        uint32 currentActive = _activeVersion[riskDomainId];
        if (currentActive != NO_VERSION) {
            revert AnotherRiskDomainVersionActive(riskDomainId, currentActive);
        }

        RiskDomainDefinition memory definition = record.definition;
        _requireDependencies(definition);
        _requireDependenciesOpen(definition);

        _setStatus(riskDomainId, version, record, RegistryStatus.Active);
        _setActiveVersion(riskDomainId, version);
    }

    function pauseRiskDomain(RiskDomainId riskDomainId, uint32 version)
        external
        onlyRole(RISK_DOMAIN_STATUS_MANAGER_ROLE)
    {
        _transition(riskDomainId, version, RegistryStatus.Paused);
    }

    function deprecateRiskDomain(RiskDomainId riskDomainId, uint32 version)
        external
        onlyRole(RISK_DOMAIN_STATUS_MANAGER_ROLE)
    {
        _transition(riskDomainId, version, RegistryStatus.Deprecated);
    }

    function settlementAssetRegistry() external view returns (ISettlementAssetRegistry) {
        return _settlementAssetRegistry;
    }

    function adapterRegistry() external view returns (IAdapterRegistry) {
        return _adapterRegistry;
    }

    function getRiskDomain(RiskDomainId riskDomainId, uint32 version) external view returns (RiskDomainVersion memory) {
        return _requireVersion(riskDomainId, version);
    }

    function latestVersion(RiskDomainId riskDomainId) external view returns (uint32) {
        return _latestVersion[riskDomainId];
    }

    function activeVersion(RiskDomainId riskDomainId) external view returns (uint32) {
        return _activeVersion[riskDomainId];
    }

    function statusOf(RiskDomainId riskDomainId, uint32 version) external view returns (RegistryStatus) {
        return _versions[riskDomainId][version].status;
    }

    function riskDomainCount() external view returns (uint256) {
        return _riskDomainCount;
    }

    function exists(RiskDomainId riskDomainId, uint32 version) external view returns (bool) {
        return _versions[riskDomainId][version].status != RegistryStatus.Unspecified;
    }

    /// @dev The live gate is dependency aware in both directions: a domain that is Active on its own
    /// terms is closed for new risk the moment the collateral it is margined in stops accepting new
    /// risk or its risk adapter drifts from its qualified bytecode, with no status change here.
    ///
    /// @dev The dependency calls below are trusted immutable registries. They are deliberately not
    /// wrapped in try/catch: a dependency contract that reverts on a view is broken, and hiding that
    /// behind a false would turn a broken dependency graph into a silent closed gate.
    function isOpenForNewRisk(RiskDomainId riskDomainId, uint32 version) external view returns (bool) {
        RiskDomainVersion storage record = _versions[riskDomainId][version];
        if (record.status != RegistryStatus.Active || _activeVersion[riskDomainId] != version) {
            return false;
        }

        AssetId collateralAssetId = record.definition.collateralAssetId;
        uint32 collateralAssetVersion = record.definition.collateralAssetVersion;
        if (!_settlementAssetRegistry.isOpenForNewRisk(collateralAssetId, collateralAssetVersion)) {
            return false;
        }
        return _adapterRegistry.isOpenForNewRisk(record.definition.riskAdapterId, record.definition.riskAdapterVersion);
    }

    function isLifecycleEnabled(RiskDomainId riskDomainId, uint32 version) external view returns (bool) {
        return _versions[riskDomainId][version].status != RegistryStatus.Unspecified;
    }

    function deriveRiskDomainId(RiskDomainDefinition calldata definition) external pure returns (RiskDomainId) {
        return RiskDomainDefinitionLib.deriveRiskDomainId(definition);
    }

    /// @dev The write path is split out of registerRiskDomain so the caller keeps only the values
    /// its event needs on the stack. Nothing here may run before every check above has passed.
    function _writeVersion(
        RiskDomainDefinition calldata definition,
        RiskDomainId riskDomainId,
        uint32 version,
        bytes32 definitionHash,
        bytes32 versionHash
    ) private {
        RiskDomainVersion storage record = _versions[riskDomainId][version];
        record.definition = definition;
        record.definitionHash = definitionHash;
        record.versionHash = versionHash;
        record.version = version;
        record.status = RegistryStatus.Paused;

        _latestVersion[riskDomainId] = version;
        _definitionVersion[riskDomainId][definitionHash] = version;
        _riskDomainCount += 1;
    }

    /// @dev Existence of the collateral binding and existence plus exact compatibility of the risk
    /// adapter, with no status requirement at all.
    function _requireDependencies(RiskDomainDefinition memory definition) private view {
        _requireCollateralBinding(definition.collateralAssetId, definition.collateralAssetVersion);
        _requireCompatibleAdapter(definition);
    }

    /// @dev Existence alone. Lifecycle enablement is the settlement registry answer for a version
    /// that was ever registered, which is exactly the property a risk domain needs: the base units
    /// its caps are written in must resolve forever, whether or not the token is currently accepting
    /// new risk.
    function _requireCollateralBinding(AssetId collateralAssetId, uint32 collateralAssetVersion) private view {
        if (!_settlementAssetRegistry.isLifecycleEnabled(collateralAssetId, collateralAssetVersion)) {
            revert UnknownCollateralDependency(collateralAssetId, collateralAssetVersion);
        }
    }

    /// @dev The adapter must carry exactly the capability category, ABI revision, and capability set
    /// this domain requires. A superset is refused as firmly as an unrelated adapter: an
    /// implementation that does more than was demanded was still reviewed against a different
    /// commitment. The required kind is a field of the definition rather than a constant here,
    /// because a risk domain may legitimately be qualified against a capability category invented
    /// after this deployment.
    function _requireCompatibleAdapter(RiskDomainDefinition memory definition) private view {
        AdapterId riskAdapterId = definition.riskAdapterId;
        uint32 riskAdapterVersion = definition.riskAdapterVersion;

        if (!_adapterRegistry.exists(riskAdapterId, riskAdapterVersion)) {
            revert UnknownRiskAdapterDependency(riskAdapterId, riskAdapterVersion);
        }

        AdapterVersion memory record = _adapterRegistry.getAdapter(riskAdapterId, riskAdapterVersion);
        AdapterDefinition memory adapter = record.definition;

        if (AdapterKindId.unwrap(adapter.kindId) != AdapterKindId.unwrap(definition.requiredAdapterKindId)) {
            revert RiskAdapterKindMismatch(
                riskAdapterId, riskAdapterVersion, definition.requiredAdapterKindId, adapter.kindId
            );
        }
        if (adapter.interfaceHash != definition.requiredInterfaceHash) {
            revert RiskAdapterInterfaceMismatch(
                riskAdapterId, riskAdapterVersion, definition.requiredInterfaceHash, adapter.interfaceHash
            );
        }
        if (adapter.capabilityHash != definition.requiredCapabilityHash) {
            revert RiskAdapterCapabilityMismatch(
                riskAdapterId, riskAdapterVersion, definition.requiredCapabilityHash, adapter.capabilityHash
            );
        }
    }

    /// @dev The live status gate applied at activation only. Both dependencies must be open for new
    /// risk, because a domain switched on against collateral nobody may post or an adapter nobody
    /// may route through would carry risk it cannot margin or evaluate.
    function _requireDependenciesOpen(RiskDomainDefinition memory definition) private view {
        AssetId collateralAssetId = definition.collateralAssetId;
        uint32 collateralAssetVersion = definition.collateralAssetVersion;
        if (!_settlementAssetRegistry.isOpenForNewRisk(collateralAssetId, collateralAssetVersion)) {
            revert CollateralDependencyNotOpen(collateralAssetId, collateralAssetVersion);
        }
        if (!_adapterRegistry.isOpenForNewRisk(definition.riskAdapterId, definition.riskAdapterVersion)) {
            revert RiskAdapterDependencyNotOpen(definition.riskAdapterId, definition.riskAdapterVersion);
        }
    }

    function _transition(RiskDomainId riskDomainId, uint32 version, RegistryStatus newStatus) private {
        RiskDomainVersion storage record = _requireVersion(riskDomainId, version);
        _requireTransition(riskDomainId, version, record.status, newStatus);

        _setStatus(riskDomainId, version, record, newStatus);

        if (_activeVersion[riskDomainId] == version) {
            _setActiveVersion(riskDomainId, NO_VERSION);
        }
    }

    function _setStatus(
        RiskDomainId riskDomainId,
        uint32 version,
        RiskDomainVersion storage record,
        RegistryStatus newStatus
    ) private {
        RegistryStatus previousStatus = record.status;
        record.status = newStatus;

        emit RiskDomainStatusChanged(riskDomainId, version, previousStatus, newStatus, msg.sender);
    }

    function _setActiveVersion(RiskDomainId riskDomainId, uint32 newVersion) private {
        uint32 previousVersion = _activeVersion[riskDomainId];
        _activeVersion[riskDomainId] = newVersion;

        emit RiskDomainActiveVersionChanged(riskDomainId, previousVersion, newVersion, msg.sender);
    }

    function _requireVersion(RiskDomainId riskDomainId, uint32 version)
        private
        view
        returns (RiskDomainVersion storage record)
    {
        record = _versions[riskDomainId][version];
        if (record.status == RegistryStatus.Unspecified) {
            revert UnknownRiskDomainVersion(riskDomainId, version);
        }
    }

    function _requireTransition(
        RiskDomainId riskDomainId,
        uint32 version,
        RegistryStatus previousStatus,
        RegistryStatus newStatus
    ) private pure {
        if (!_isPermittedTransition(previousStatus, newStatus)) {
            revert InvalidRiskDomainTransition(riskDomainId, version, previousStatus, newStatus);
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

    function _requireInitialAdmin(address initialAdmin) private pure returns (address) {
        if (initialAdmin == address(0)) {
            revert ZeroInitialAdmin();
        }
        return initialAdmin;
    }
}
