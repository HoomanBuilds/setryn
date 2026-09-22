// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";

import {IFeeScheduleRegistry} from "../interfaces/IFeeScheduleRegistry.sol";
import {ISettlementAssetRegistry} from "../interfaces/ISettlementAssetRegistry.sol";
import {FeeScheduleDefinitionLib} from "../libraries/FeeScheduleDefinitionLib.sol";
import {RegistryStatus} from "../types/Enums.sol";
import {FeeScheduleDefinition, FeeScheduleVersion} from "../types/FeeScheduleDefinition.sol";
import {AssetId, FeeScheduleId} from "../types/Identifiers.sol";
import {PPM_DENOMINATOR} from "../types/Units.sol";

/// @dev The canonical fee schedule registry. Each accepted definition becomes an immutable
/// chain-local version of a stable FeeScheduleId lineage. Status is the only mutable field, nothing
/// is ever deleted, and at most one version per schedule is the active one.
///
/// @dev Registration lands in Paused so the qualifier who proposes a rate card can never be the
/// party that switches it on. Activation is a separate role, a separate act, and a fresh check that
/// the exact settlement binding the schedule is denominated in is still open for new risk.
///
/// @dev No fee is ever charged here. This contract stores and gates economic policy; the rule set
/// and recipient set it commits to are resolved later by a fee model and a settlement engine. It
/// holds no funds, moves no tokens, grants no approvals, never delegatecalls, and never accepts
/// caller-supplied call data. Its only external calls are view reads of its one immutable registry
/// dependency, and every one of them completes before any storage write.
///
/// @dev It also proves no funding. The charge and rebate envelopes are independent bounds, so a
/// rebate-only schedule and a rebate envelope wider than the charge envelope both register. A fee
/// engine must reserve and verify the rebate budget before settlement and must never pay out because
/// registration succeeded.
contract FeeScheduleRegistry is IFeeScheduleRegistry, AccessControlDefaultAdminRules {
    bytes32 public constant FEE_SCHEDULE_QUALIFIER_ROLE = keccak256("SETRYN_FEE_SCHEDULE_QUALIFIER_ROLE");
    bytes32 public constant FEE_SCHEDULE_STATUS_MANAGER_ROLE = keccak256("SETRYN_FEE_SCHEDULE_STATUS_MANAGER_ROLE");

    /// @dev The exact denominator maxChargeRatePpm and maxRebateRatePpm are written against, aliased
    /// from the canonical PPM_DENOMINATOR rather than restated, and published in the ABI so an
    /// offchain quoting engine reads the scale instead of assuming it. This is a scale, not a budget:
    /// neither rate may exceed it, and a rate within it is still not evidence that any rebate is
    /// funded.
    uint256 public constant FEE_RATE_PPM_DENOMINATOR = PPM_DENOMINATOR;

    /// @dev Version numbering starts at one, so zero is an unambiguous no-such-version sentinel for
    /// both the latest and the active pointer.
    uint32 private constant NO_VERSION = 0;

    ISettlementAssetRegistry private immutable _settlementAssetRegistry;

    mapping(FeeScheduleId feeScheduleId => mapping(uint32 version => FeeScheduleVersion record)) private _versions;

    mapping(FeeScheduleId feeScheduleId => uint32 version) private _latestVersion;

    mapping(FeeScheduleId feeScheduleId => uint32 version) private _activeVersion;

    mapping(FeeScheduleId feeScheduleId => mapping(bytes32 definitionHash => uint32 version)) private
        _definitionVersion;

    uint256 private _feeScheduleCount;

    /// @dev The zero check runs inside the base constructor argument so a Setryn error, not the
    /// OpenZeppelin one, is what a caller sees for a zero admin.
    constructor(uint48 defaultAdminDelay, address initialAdmin, ISettlementAssetRegistry settlementAssetRegistry_)
        AccessControlDefaultAdminRules(defaultAdminDelay, _requireInitialAdmin(initialAdmin))
    {
        if (address(settlementAssetRegistry_) == address(0)) {
            revert ZeroSettlementAssetRegistry();
        }
        if (address(settlementAssetRegistry_).code.length == 0) {
            revert SettlementAssetRegistryHasNoCode(address(settlementAssetRegistry_));
        }

        _settlementAssetRegistry = settlementAssetRegistry_;

        _grantRole(FEE_SCHEDULE_QUALIFIER_ROLE, initialAdmin);
        _grantRole(FEE_SCHEDULE_STATUS_MANAGER_ROLE, initialAdmin);
    }

    /// @dev Every check, including the dependency read, completes before any storage is touched. The
    /// referenced settlement binding version must exist and stay historically resolvable, but it is
    /// deliberately allowed to be Paused or Deprecated here, because registration grants no risk
    /// authority and a rate card is often published ahead of the binding it will run against.
    function registerFeeSchedule(FeeScheduleDefinition calldata definition)
        external
        onlyRole(FEE_SCHEDULE_QUALIFIER_ROLE)
        returns (FeeScheduleId feeScheduleId, uint32 version)
    {
        FeeScheduleDefinitionLib.validate(definition);
        _requireSettlementBinding(definition.settlementAssetId, definition.settlementAssetVersion);

        feeScheduleId = FeeScheduleDefinitionLib.deriveFeeScheduleId(definition);
        bytes32 definitionHash = FeeScheduleDefinitionLib.hashDefinition(definition, block.chainid);

        uint32 existingVersion = _definitionVersion[feeScheduleId][definitionHash];
        if (existingVersion != NO_VERSION) {
            revert DuplicateFeeScheduleDefinition(feeScheduleId, definitionHash, existingVersion);
        }

        version = _latestVersion[feeScheduleId];
        if (version == type(uint32).max) {
            revert FeeScheduleVersionExhausted(feeScheduleId);
        }

        version += 1;
        bytes32 versionHash =
            FeeScheduleDefinitionLib.hashVersion(feeScheduleId, version, definitionHash, block.chainid);

        _writeVersion(definition, feeScheduleId, version, definitionHash, versionHash);

        emit FeeScheduleRegistered(
            feeScheduleId,
            version,
            versionHash,
            definitionHash,
            definition,
            block.chainid,
            RegistryStatus.Paused,
            msg.sender
        );
    }

    /// @dev Activation re-reads the settlement binding, because the token may have been paused or
    /// deprecated, or displaced as the active pointer, since registration. It fails closed rather
    /// than opening risk against money that can no longer be accepted.
    function activateFeeSchedule(FeeScheduleId feeScheduleId, uint32 version)
        external
        onlyRole(FEE_SCHEDULE_STATUS_MANAGER_ROLE)
    {
        FeeScheduleVersion storage record = _requireVersion(feeScheduleId, version);
        _requireTransition(feeScheduleId, version, record.status, RegistryStatus.Active);

        uint32 currentActive = _activeVersion[feeScheduleId];
        if (currentActive != NO_VERSION) {
            revert AnotherFeeScheduleVersionActive(feeScheduleId, currentActive);
        }

        AssetId settlementAssetId = record.definition.settlementAssetId;
        uint32 settlementAssetVersion = record.definition.settlementAssetVersion;
        _requireSettlementBinding(settlementAssetId, settlementAssetVersion);
        if (!_settlementAssetRegistry.isOpenForNewRisk(settlementAssetId, settlementAssetVersion)) {
            revert SettlementAssetDependencyNotOpen(settlementAssetId, settlementAssetVersion);
        }

        _setStatus(feeScheduleId, version, record, RegistryStatus.Active);
        _setActiveVersion(feeScheduleId, version);
    }

    function pauseFeeSchedule(FeeScheduleId feeScheduleId, uint32 version)
        external
        onlyRole(FEE_SCHEDULE_STATUS_MANAGER_ROLE)
    {
        _transition(feeScheduleId, version, RegistryStatus.Paused);
    }

    function deprecateFeeSchedule(FeeScheduleId feeScheduleId, uint32 version)
        external
        onlyRole(FEE_SCHEDULE_STATUS_MANAGER_ROLE)
    {
        _transition(feeScheduleId, version, RegistryStatus.Deprecated);
    }

    function settlementAssetRegistry() external view returns (ISettlementAssetRegistry) {
        return _settlementAssetRegistry;
    }

    function getFeeSchedule(FeeScheduleId feeScheduleId, uint32 version)
        external
        view
        returns (FeeScheduleVersion memory)
    {
        return _requireVersion(feeScheduleId, version);
    }

    function latestVersion(FeeScheduleId feeScheduleId) external view returns (uint32) {
        return _latestVersion[feeScheduleId];
    }

    function activeVersion(FeeScheduleId feeScheduleId) external view returns (uint32) {
        return _activeVersion[feeScheduleId];
    }

    function statusOf(FeeScheduleId feeScheduleId, uint32 version) external view returns (RegistryStatus) {
        return _versions[feeScheduleId][version].status;
    }

    function feeScheduleCount() external view returns (uint256) {
        return _feeScheduleCount;
    }

    function exists(FeeScheduleId feeScheduleId, uint32 version) external view returns (bool) {
        return _versions[feeScheduleId][version].status != RegistryStatus.Unspecified;
    }

    /// @dev The live gate is dependency aware: a schedule that is Active on its own terms is closed
    /// for new risk the moment the settlement binding it is denominated in stops accepting new risk,
    /// with no status change here at all.
    ///
    /// @dev The dependency call below is a trusted immutable registry. It is deliberately not
    /// wrapped in try/catch: a dependency contract that reverts on a view is broken, and hiding that
    /// behind a false would turn a broken dependency graph into a silent closed gate.
    function isOpenForNewRisk(FeeScheduleId feeScheduleId, uint32 version) external view returns (bool) {
        FeeScheduleVersion storage record = _versions[feeScheduleId][version];
        if (record.status != RegistryStatus.Active || _activeVersion[feeScheduleId] != version) {
            return false;
        }
        return _settlementAssetRegistry.isOpenForNewRisk(
            record.definition.settlementAssetId, record.definition.settlementAssetVersion
        );
    }

    function isLifecycleEnabled(FeeScheduleId feeScheduleId, uint32 version) external view returns (bool) {
        return _versions[feeScheduleId][version].status != RegistryStatus.Unspecified;
    }

    function deriveFeeScheduleId(FeeScheduleDefinition calldata definition) external pure returns (FeeScheduleId) {
        return FeeScheduleDefinitionLib.deriveFeeScheduleId(definition);
    }

    /// @dev The write path is split out of registerFeeSchedule so the caller keeps only the values
    /// its event needs on the stack. Nothing here may run before every check above has passed.
    function _writeVersion(
        FeeScheduleDefinition calldata definition,
        FeeScheduleId feeScheduleId,
        uint32 version,
        bytes32 definitionHash,
        bytes32 versionHash
    ) private {
        FeeScheduleVersion storage record = _versions[feeScheduleId][version];
        record.definition = definition;
        record.definitionHash = definitionHash;
        record.versionHash = versionHash;
        record.version = version;
        record.status = RegistryStatus.Paused;

        _latestVersion[feeScheduleId] = version;
        _definitionVersion[feeScheduleId][definitionHash] = version;
        _feeScheduleCount += 1;
    }

    /// @dev Existence alone, with no status requirement. Lifecycle enablement is the settlement
    /// registry answer for a version that was ever registered, which is exactly the property a fee
    /// schedule needs: the base units its flat bounds are written in must resolve forever, whether
    /// or not the token is currently accepting new risk.
    function _requireSettlementBinding(AssetId settlementAssetId, uint32 settlementAssetVersion) private view {
        if (!_settlementAssetRegistry.isLifecycleEnabled(settlementAssetId, settlementAssetVersion)) {
            revert UnknownSettlementAssetDependency(settlementAssetId, settlementAssetVersion);
        }
    }

    function _transition(FeeScheduleId feeScheduleId, uint32 version, RegistryStatus newStatus) private {
        FeeScheduleVersion storage record = _requireVersion(feeScheduleId, version);
        _requireTransition(feeScheduleId, version, record.status, newStatus);

        _setStatus(feeScheduleId, version, record, newStatus);

        if (_activeVersion[feeScheduleId] == version) {
            _setActiveVersion(feeScheduleId, NO_VERSION);
        }
    }

    function _setStatus(
        FeeScheduleId feeScheduleId,
        uint32 version,
        FeeScheduleVersion storage record,
        RegistryStatus newStatus
    ) private {
        RegistryStatus previousStatus = record.status;
        record.status = newStatus;

        emit FeeScheduleStatusChanged(feeScheduleId, version, previousStatus, newStatus, msg.sender);
    }

    function _setActiveVersion(FeeScheduleId feeScheduleId, uint32 newVersion) private {
        uint32 previousVersion = _activeVersion[feeScheduleId];
        _activeVersion[feeScheduleId] = newVersion;

        emit FeeScheduleActiveVersionChanged(feeScheduleId, previousVersion, newVersion, msg.sender);
    }

    function _requireVersion(FeeScheduleId feeScheduleId, uint32 version)
        private
        view
        returns (FeeScheduleVersion storage record)
    {
        record = _versions[feeScheduleId][version];
        if (record.status == RegistryStatus.Unspecified) {
            revert UnknownFeeScheduleVersion(feeScheduleId, version);
        }
    }

    function _requireTransition(
        FeeScheduleId feeScheduleId,
        uint32 version,
        RegistryStatus previousStatus,
        RegistryStatus newStatus
    ) private pure {
        if (!_isPermittedTransition(previousStatus, newStatus)) {
            revert InvalidFeeScheduleTransition(feeScheduleId, version, previousStatus, newStatus);
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
