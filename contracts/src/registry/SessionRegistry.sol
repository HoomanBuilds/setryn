// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

import {ICalendarRegistry} from "../interfaces/ICalendarRegistry.sol";
import {ISessionRegistry} from "../interfaces/ISessionRegistry.sol";
import {SessionDefinitionLib} from "../libraries/SessionDefinitionLib.sol";
import {RegistryStatus} from "../types/Enums.sol";
import {CalendarId, SessionId} from "../types/Identifiers.sol";
import {SessionDay, SessionDefinition, SessionVersion, SessionWindow} from "../types/SessionDefinition.sol";

/// @dev The canonical session registry. Each accepted definition becomes an immutable version of a
/// stable SessionId lineage. Status is the only mutable field, nothing is ever deleted, and at most
/// one version per session is the active one.
///
/// @dev Registration lands in Paused so the registrar who publishes a schedule can never be the
/// party that switches it on. Activation is a separate role, a separate act, and an additional
/// dependency check against the calendar registry.
///
/// @dev Session computation is entirely offchain. A version commits the resolved outcome as a Merkle
/// root over one SessionDay leaf per civil business day of a finite horizon, so the registry stores
/// no day arrays, no windows, no proofs, and no holidays. Cost is constant in schedule length.
///
/// @dev The registry holds no funds and never delegatecalls. Its only external calls are view reads
/// of the immutable calendar registry, and every one of them completes before any storage write.
contract SessionRegistry is ISessionRegistry, AccessControlDefaultAdminRules {
    bytes32 public constant SESSION_REGISTRAR_ROLE = keccak256("SETRYN_SESSION_REGISTRAR_ROLE");
    bytes32 public constant SESSION_STATUS_MANAGER_ROLE = keccak256("SETRYN_SESSION_STATUS_MANAGER_ROLE");

    /// @dev Version numbering starts at one, so zero is an unambiguous no-such-version sentinel for
    /// both the latest and the active pointer.
    uint32 private constant NO_VERSION = 0;

    ICalendarRegistry private immutable _calendarRegistry;

    mapping(SessionId sessionId => mapping(uint32 version => SessionVersion record)) private _versions;

    mapping(SessionId sessionId => uint32 version) private _latestVersion;

    mapping(SessionId sessionId => uint32 version) private _activeVersion;

    mapping(SessionId sessionId => mapping(bytes32 definitionHash => uint32 version)) private _definitionVersion;

    uint256 private _sessionCount;

    /// @dev The zero check runs inside the base constructor argument so a Setryn error, not the
    /// OpenZeppelin one, is what a caller sees for a zero admin.
    constructor(uint48 defaultAdminDelay, address initialAdmin, ICalendarRegistry calendarRegistry_)
        AccessControlDefaultAdminRules(defaultAdminDelay, _requireInitialAdmin(initialAdmin))
    {
        if (address(calendarRegistry_) == address(0)) {
            revert ZeroCalendarRegistry();
        }
        if (address(calendarRegistry_).code.length == 0) {
            revert CalendarRegistryHasNoCode(address(calendarRegistry_));
        }

        _calendarRegistry = calendarRegistry_;

        _grantRole(SESSION_REGISTRAR_ROLE, initialAdmin);
        _grantRole(SESSION_STATUS_MANAGER_ROLE, initialAdmin);
    }

    /// @dev Every check, including all three calendar reads, completes before any storage is
    /// touched. The dependency must exist and must cover both session horizon endpoints, but it is
    /// deliberately allowed to be Paused or Deprecated here, because registration grants no risk
    /// authority and a schedule is often published ahead of its calendar being switched on.
    function registerSession(SessionDefinition calldata definition)
        external
        onlyRole(SESSION_REGISTRAR_ROLE)
        returns (SessionId sessionId, uint32 version)
    {
        SessionDefinitionLib.validate(definition);
        _requireCalendarCoverage(definition);

        sessionId = SessionDefinitionLib.deriveSessionId(definition);
        bytes32 definitionHash = SessionDefinitionLib.hashDefinition(definition);

        uint32 existingVersion = _definitionVersion[sessionId][definitionHash];
        if (existingVersion != NO_VERSION) {
            revert DuplicateSessionDefinition(sessionId, definitionHash, existingVersion);
        }

        version = _latestVersion[sessionId];
        if (version == type(uint32).max) {
            revert SessionVersionExhausted(sessionId);
        }

        version += 1;
        bytes32 versionHash = SessionDefinitionLib.hashVersion(sessionId, version, definitionHash);

        _writeVersion(definition, sessionId, version, definitionHash, versionHash);

        emit SessionRegistered(
            sessionId, version, versionHash, definitionHash, definition, RegistryStatus.Paused, msg.sender
        );
    }

    /// @dev Activation re-reads the calendar dependency, because the calendar version this schedule
    /// was resolved against may have been paused, deprecated, or displaced as the active pointer
    /// since registration. It fails closed rather than degrading to a calendar-free session.
    function activateSession(SessionId sessionId, uint32 version) external onlyRole(SESSION_STATUS_MANAGER_ROLE) {
        SessionVersion storage record = _requireVersion(sessionId, version);
        _requireTransition(sessionId, version, record.status, RegistryStatus.Active);

        uint32 currentActive = _activeVersion[sessionId];
        if (currentActive != NO_VERSION) {
            revert AnotherSessionVersionActive(sessionId, currentActive);
        }

        _requireCalendarOpen(record.definition);

        _setStatus(sessionId, version, record, RegistryStatus.Active);
        _setActiveVersion(sessionId, version);
    }

    function pauseSession(SessionId sessionId, uint32 version) external onlyRole(SESSION_STATUS_MANAGER_ROLE) {
        _transition(sessionId, version, RegistryStatus.Paused);
    }

    function deprecateSession(SessionId sessionId, uint32 version) external onlyRole(SESSION_STATUS_MANAGER_ROLE) {
        _transition(sessionId, version, RegistryStatus.Deprecated);
    }

    function calendarRegistry() external view returns (ICalendarRegistry) {
        return _calendarRegistry;
    }

    function getSession(SessionId sessionId, uint32 version) external view returns (SessionVersion memory) {
        return _requireVersion(sessionId, version);
    }

    function latestVersion(SessionId sessionId) external view returns (uint32) {
        return _latestVersion[sessionId];
    }

    function activeVersion(SessionId sessionId) external view returns (uint32) {
        return _activeVersion[sessionId];
    }

    function statusOf(SessionId sessionId, uint32 version) external view returns (RegistryStatus) {
        return _versions[sessionId][version].status;
    }

    function sessionCount() external view returns (uint256) {
        return _sessionCount;
    }

    function exists(SessionId sessionId, uint32 version) external view returns (bool) {
        return _versions[sessionId][version].status != RegistryStatus.Unspecified;
    }

    function coversDay(SessionId sessionId, uint32 version, uint32 day) external view returns (bool) {
        SessionVersion storage record = _versions[sessionId][version];
        if (record.status == RegistryStatus.Unspecified) {
            return false;
        }
        return _coversDay(record, day);
    }

    /// @dev The live gate is dependency aware: a session that is Active on its own terms is still
    /// closed for new risk the moment its calendar version stops being open for that day.
    function isOpenForNewRisk(SessionId sessionId, uint32 version, uint32 day) external view returns (bool) {
        SessionVersion storage record = _versions[sessionId][version];
        if (record.status != RegistryStatus.Active || _activeVersion[sessionId] != version) {
            return false;
        }
        if (!_coversDay(record, day)) {
            return false;
        }
        return _calendarRegistry.isOpenForNewRisk(record.definition.calendarId, record.definition.calendarVersion, day);
    }

    function isLifecycleEnabled(SessionId sessionId, uint32 version) external view returns (bool) {
        return _versions[sessionId][version].status != RegistryStatus.Unspecified;
    }

    function hashWindow(SessionWindow calldata window) external pure returns (bytes32) {
        return SessionDefinitionLib.hashWindow(window);
    }

    function hashWindows(SessionWindow[] calldata windows) external pure returns (bytes32) {
        return SessionDefinitionLib.hashWindows(windows);
    }

    function hashDay(SessionId sessionId, SessionDay calldata sessionDay) external pure returns (bytes32) {
        return SessionDefinitionLib.hashDay(sessionId, sessionDay);
    }

    /// @dev The zero and horizon checks run before the hashing helper, so the reverts that helper
    /// raises for a zero windowsHash or evidenceHash can never escape a view that promises a
    /// boolean. The calendar dependency is never consulted here: this is historical evidence.
    function verifyDay(SessionId sessionId, uint32 version, SessionDay calldata sessionDay, bytes32[] calldata proof)
        external
        view
        returns (bool)
    {
        SessionVersion storage record = _versions[sessionId][version];
        if (record.status == RegistryStatus.Unspecified) {
            return false;
        }
        if (sessionDay.windowsHash == bytes32(0) || sessionDay.evidenceHash == bytes32(0)) {
            return false;
        }
        if (!_coversDay(record, sessionDay.day)) {
            return false;
        }

        bytes32 leaf = SessionDefinitionLib.hashDay(sessionId, sessionDay);
        return MerkleProof.verifyCalldata(proof, record.definition.dayScheduleRoot, leaf);
    }

    /// @dev The write path is split out of registerSession so the caller keeps only the values its
    /// event needs on the stack. Nothing here may run before every check above has passed.
    function _writeVersion(
        SessionDefinition calldata definition,
        SessionId sessionId,
        uint32 version,
        bytes32 definitionHash,
        bytes32 versionHash
    ) private {
        SessionVersion storage record = _versions[sessionId][version];
        record.definition = definition;
        record.definitionHash = definitionHash;
        record.versionHash = versionHash;
        record.version = version;
        record.status = RegistryStatus.Paused;

        _latestVersion[sessionId] = version;
        _definitionVersion[sessionId][definitionHash] = version;
        _sessionCount += 1;
    }

    function _requireCalendarCoverage(SessionDefinition calldata definition) private view {
        CalendarId calendarId = definition.calendarId;
        uint32 calendarVersion = definition.calendarVersion;

        if (!_calendarRegistry.exists(calendarId, calendarVersion)) {
            revert UnknownCalendarDependency(calendarId, calendarVersion);
        }
        if (
            !_calendarRegistry.coversDay(calendarId, calendarVersion, definition.validFromDay)
                || !_calendarRegistry.coversDay(calendarId, calendarVersion, definition.validThroughDay)
        ) {
            revert CalendarHorizonTooNarrow(
                calendarId, calendarVersion, definition.validFromDay, definition.validThroughDay
            );
        }
    }

    /// @dev Both endpoints are required because the calendar gate is evaluated per day. A dependency
    /// that is open at one end of the horizon and closed at the other would let a session be
    /// switched on for a range it cannot resolve.
    function _requireCalendarOpen(SessionDefinition storage definition) private view {
        CalendarId calendarId = definition.calendarId;
        uint32 calendarVersion = definition.calendarVersion;
        uint32 validFromDay = definition.validFromDay;
        uint32 validThroughDay = definition.validThroughDay;

        if (
            !_calendarRegistry.isOpenForNewRisk(calendarId, calendarVersion, validFromDay)
                || !_calendarRegistry.isOpenForNewRisk(calendarId, calendarVersion, validThroughDay)
        ) {
            revert CalendarDependencyNotOpen(calendarId, calendarVersion, validFromDay, validThroughDay);
        }
    }

    function _transition(SessionId sessionId, uint32 version, RegistryStatus newStatus) private {
        SessionVersion storage record = _requireVersion(sessionId, version);
        _requireTransition(sessionId, version, record.status, newStatus);

        _setStatus(sessionId, version, record, newStatus);

        if (_activeVersion[sessionId] == version) {
            _setActiveVersion(sessionId, NO_VERSION);
        }
    }

    function _setStatus(SessionId sessionId, uint32 version, SessionVersion storage record, RegistryStatus newStatus)
        private
    {
        RegistryStatus previousStatus = record.status;
        record.status = newStatus;

        emit SessionStatusChanged(sessionId, version, previousStatus, newStatus, msg.sender);
    }

    function _setActiveVersion(SessionId sessionId, uint32 newVersion) private {
        uint32 previousVersion = _activeVersion[sessionId];
        _activeVersion[sessionId] = newVersion;

        emit SessionActiveVersionChanged(sessionId, previousVersion, newVersion, msg.sender);
    }

    function _requireVersion(SessionId sessionId, uint32 version) private view returns (SessionVersion storage record) {
        record = _versions[sessionId][version];
        if (record.status == RegistryStatus.Unspecified) {
            revert UnknownSessionVersion(sessionId, version);
        }
    }

    function _requireTransition(
        SessionId sessionId,
        uint32 version,
        RegistryStatus previousStatus,
        RegistryStatus newStatus
    ) private pure {
        if (!_isPermittedTransition(previousStatus, newStatus)) {
            revert InvalidSessionTransition(sessionId, version, previousStatus, newStatus);
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

    function _coversDay(SessionVersion storage record, uint32 day) private view returns (bool) {
        return day >= record.definition.validFromDay && day <= record.definition.validThroughDay;
    }

    function _requireInitialAdmin(address initialAdmin) private pure returns (address) {
        if (initialAdmin == address(0)) {
            revert ZeroInitialAdmin();
        }
        return initialAdmin;
    }
}
