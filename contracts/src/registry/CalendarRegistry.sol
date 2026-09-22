// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

import {ICalendarRegistry} from "../interfaces/ICalendarRegistry.sol";
import {CalendarDefinitionLib} from "../libraries/CalendarDefinitionLib.sol";
import {CalendarDay, CalendarDefinition, CalendarVersion} from "../types/CalendarDefinition.sol";
import {RegistryStatus} from "../types/Enums.sol";
import {CalendarId} from "../types/Identifiers.sol";

/// @dev The canonical calendar registry. Each accepted definition becomes an immutable version of a
/// stable CalendarId lineage. Status is the only mutable field, nothing is ever deleted, and at most
/// one version per calendar is the active one.
///
/// @dev Registration lands in Paused so the registrar who publishes a schedule can never be the
/// party that switches it on. Activation is a separate role and a separate act.
///
/// @dev Business-day computation is entirely offchain. A version commits the resolved outcome as a
/// Merkle root over the classified days of a finite horizon, so the registry stores no day arrays,
/// no proofs, and no individual holidays. Cost is constant in the length of a schedule.
///
/// @dev The registry holds no funds, makes no external calls, and never delegatecalls.
contract CalendarRegistry is ICalendarRegistry, AccessControlDefaultAdminRules {
    bytes32 public constant CALENDAR_REGISTRAR_ROLE = keccak256("SETRYN_CALENDAR_REGISTRAR_ROLE");
    bytes32 public constant CALENDAR_STATUS_MANAGER_ROLE = keccak256("SETRYN_CALENDAR_STATUS_MANAGER_ROLE");

    /// @dev Version numbering starts at one, so zero is an unambiguous no-such-version sentinel for
    /// both the latest and the active pointer.
    uint32 private constant NO_VERSION = 0;

    mapping(CalendarId calendarId => mapping(uint32 version => CalendarVersion record)) private _versions;

    mapping(CalendarId calendarId => uint32 version) private _latestVersion;

    mapping(CalendarId calendarId => uint32 version) private _activeVersion;

    mapping(CalendarId calendarId => mapping(bytes32 definitionHash => uint32 version)) private _definitionVersion;

    uint256 private _calendarCount;

    /// @dev The zero check runs inside the base constructor argument so a Setryn error, not the
    /// OpenZeppelin one, is what a caller sees for a zero admin.
    constructor(uint48 defaultAdminDelay, address initialAdmin)
        AccessControlDefaultAdminRules(defaultAdminDelay, _requireInitialAdmin(initialAdmin))
    {
        _grantRole(CALENDAR_REGISTRAR_ROLE, initialAdmin);
        _grantRole(CALENDAR_STATUS_MANAGER_ROLE, initialAdmin);
    }

    /// @dev Every check completes before any storage is touched.
    function registerCalendar(CalendarDefinition calldata definition)
        external
        onlyRole(CALENDAR_REGISTRAR_ROLE)
        returns (CalendarId calendarId, uint32 version)
    {
        CalendarDefinitionLib.validate(definition);

        calendarId = CalendarDefinitionLib.deriveCalendarId(definition);
        bytes32 definitionHash = CalendarDefinitionLib.hashDefinition(definition);

        uint32 existingVersion = _definitionVersion[calendarId][definitionHash];
        if (existingVersion != NO_VERSION) {
            revert DuplicateCalendarDefinition(calendarId, definitionHash, existingVersion);
        }

        version = _latestVersion[calendarId];
        if (version == type(uint32).max) {
            revert CalendarVersionExhausted(calendarId);
        }

        version += 1;
        bytes32 versionHash = CalendarDefinitionLib.hashVersion(calendarId, version, definitionHash);

        _writeVersion(definition, calendarId, version, definitionHash, versionHash);

        emit CalendarRegistered(
            calendarId, version, versionHash, definitionHash, definition, RegistryStatus.Paused, msg.sender
        );
    }

    function activateCalendar(CalendarId calendarId, uint32 version) external onlyRole(CALENDAR_STATUS_MANAGER_ROLE) {
        CalendarVersion storage record = _requireVersion(calendarId, version);
        _requireTransition(calendarId, version, record.status, RegistryStatus.Active);

        uint32 currentActive = _activeVersion[calendarId];
        if (currentActive != NO_VERSION) {
            revert AnotherCalendarVersionActive(calendarId, currentActive);
        }

        _setStatus(calendarId, version, record, RegistryStatus.Active);
        _setActiveVersion(calendarId, version);
    }

    function pauseCalendar(CalendarId calendarId, uint32 version) external onlyRole(CALENDAR_STATUS_MANAGER_ROLE) {
        _transition(calendarId, version, RegistryStatus.Paused);
    }

    function deprecateCalendar(CalendarId calendarId, uint32 version) external onlyRole(CALENDAR_STATUS_MANAGER_ROLE) {
        _transition(calendarId, version, RegistryStatus.Deprecated);
    }

    function getCalendar(CalendarId calendarId, uint32 version) external view returns (CalendarVersion memory) {
        return _requireVersion(calendarId, version);
    }

    function latestVersion(CalendarId calendarId) external view returns (uint32) {
        return _latestVersion[calendarId];
    }

    function activeVersion(CalendarId calendarId) external view returns (uint32) {
        return _activeVersion[calendarId];
    }

    function statusOf(CalendarId calendarId, uint32 version) external view returns (RegistryStatus) {
        return _versions[calendarId][version].status;
    }

    function calendarCount() external view returns (uint256) {
        return _calendarCount;
    }

    function exists(CalendarId calendarId, uint32 version) external view returns (bool) {
        return _versions[calendarId][version].status != RegistryStatus.Unspecified;
    }

    function coversDay(CalendarId calendarId, uint32 version, uint32 day) external view returns (bool) {
        CalendarVersion storage record = _versions[calendarId][version];
        if (record.status == RegistryStatus.Unspecified) {
            return false;
        }
        return _coversDay(record, day);
    }

    function isOpenForNewRisk(CalendarId calendarId, uint32 version, uint32 day) external view returns (bool) {
        CalendarVersion storage record = _versions[calendarId][version];
        if (record.status != RegistryStatus.Active || _activeVersion[calendarId] != version) {
            return false;
        }
        return _coversDay(record, day);
    }

    function isLifecycleEnabled(CalendarId calendarId, uint32 version) external view returns (bool) {
        return _versions[calendarId][version].status != RegistryStatus.Unspecified;
    }

    function hashDay(CalendarId calendarId, CalendarDay calldata calendarDay) external pure returns (bytes32) {
        return CalendarDefinitionLib.hashDay(calendarId, calendarDay);
    }

    /// @dev The zero evidence and horizon checks run before the hashing helper, so the revert that
    /// helper raises for a zero evidenceHash can never escape a view that promises a boolean.
    function verifyDay(
        CalendarId calendarId,
        uint32 version,
        CalendarDay calldata calendarDay,
        bytes32[] calldata proof
    ) external view returns (bool) {
        CalendarVersion storage record = _versions[calendarId][version];
        if (record.status == RegistryStatus.Unspecified) {
            return false;
        }
        if (calendarDay.evidenceHash == bytes32(0)) {
            return false;
        }
        if (!_coversDay(record, calendarDay.day)) {
            return false;
        }

        bytes32 leaf = CalendarDefinitionLib.hashDay(calendarId, calendarDay);
        return MerkleProof.verifyCalldata(proof, record.definition.dayStatusRoot, leaf);
    }

    /// @dev The write path is split out of registerCalendar so the caller keeps only the values its
    /// event needs on the stack. Nothing here may run before every check above has passed.
    function _writeVersion(
        CalendarDefinition calldata definition,
        CalendarId calendarId,
        uint32 version,
        bytes32 definitionHash,
        bytes32 versionHash
    ) private {
        CalendarVersion storage record = _versions[calendarId][version];
        record.definition = definition;
        record.definitionHash = definitionHash;
        record.versionHash = versionHash;
        record.version = version;
        record.status = RegistryStatus.Paused;

        _latestVersion[calendarId] = version;
        _definitionVersion[calendarId][definitionHash] = version;
        _calendarCount += 1;
    }

    function _transition(CalendarId calendarId, uint32 version, RegistryStatus newStatus) private {
        CalendarVersion storage record = _requireVersion(calendarId, version);
        _requireTransition(calendarId, version, record.status, newStatus);

        _setStatus(calendarId, version, record, newStatus);

        if (_activeVersion[calendarId] == version) {
            _setActiveVersion(calendarId, NO_VERSION);
        }
    }

    function _setStatus(CalendarId calendarId, uint32 version, CalendarVersion storage record, RegistryStatus newStatus)
        private
    {
        RegistryStatus previousStatus = record.status;
        record.status = newStatus;

        emit CalendarStatusChanged(calendarId, version, previousStatus, newStatus, msg.sender);
    }

    function _setActiveVersion(CalendarId calendarId, uint32 newVersion) private {
        uint32 previousVersion = _activeVersion[calendarId];
        _activeVersion[calendarId] = newVersion;

        emit CalendarActiveVersionChanged(calendarId, previousVersion, newVersion, msg.sender);
    }

    function _requireVersion(CalendarId calendarId, uint32 version)
        private
        view
        returns (CalendarVersion storage record)
    {
        record = _versions[calendarId][version];
        if (record.status == RegistryStatus.Unspecified) {
            revert UnknownCalendarVersion(calendarId, version);
        }
    }

    function _requireTransition(
        CalendarId calendarId,
        uint32 version,
        RegistryStatus previousStatus,
        RegistryStatus newStatus
    ) private pure {
        if (!_isPermittedTransition(previousStatus, newStatus)) {
            revert InvalidCalendarTransition(calendarId, version, previousStatus, newStatus);
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

    function _coversDay(CalendarVersion storage record, uint32 day) private view returns (bool) {
        return day >= record.definition.validFromDay && day <= record.definition.validThroughDay;
    }

    function _requireInitialAdmin(address initialAdmin) private pure returns (address) {
        if (initialAdmin == address(0)) {
            revert ZeroInitialAdmin();
        }
        return initialAdmin;
    }
}
