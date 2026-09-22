// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";

import {IAdapterRegistry} from "../interfaces/IAdapterRegistry.sol";
import {IAssetRegistry} from "../interfaces/IAssetRegistry.sol";
import {IBenchmarkRegistry} from "../interfaces/IBenchmarkRegistry.sol";
import {ICalendarRegistry} from "../interfaces/ICalendarRegistry.sol";
import {ISessionRegistry} from "../interfaces/ISessionRegistry.sol";
import {AdapterDefinitionLib} from "../libraries/AdapterDefinitionLib.sol";
import {BenchmarkDefinitionLib} from "../libraries/BenchmarkDefinitionLib.sol";
import {AdapterVersion} from "../types/AdapterDefinition.sol";
import {BenchmarkDefinition, BenchmarkVersion} from "../types/BenchmarkDefinition.sol";
import {RegistryStatus} from "../types/Enums.sol";
import {AdapterId, AdapterKindId, AssetId, BenchmarkId, CalendarId, SessionId} from "../types/Identifiers.sol";
import {SessionVersion} from "../types/SessionDefinition.sol";

/// @dev The canonical benchmark registry. Each accepted definition becomes an immutable chain-local
/// version of a stable BenchmarkId lineage. Status is the only mutable field, nothing is ever
/// deleted, and at most one version per benchmark is the active one.
///
/// @dev Registration lands in Paused so the qualifier who proposes an economic reference can never
/// be the party that switches it on. Activation is a separate role, a separate act, and a fresh
/// dependency-aware revalidation of the assets, the adapter, the calendar, and the session.
///
/// @dev No price is ever read here. This contract stores and gates benchmark specifications; the
/// feed key and the validity bounds it commits to are consumed later by a benchmark adapter and the
/// fixing engine. It never calls an adapter implementation, never accepts caller-supplied call data,
/// holds no funds, and never delegatecalls. Its only external calls are view reads of its four
/// immutable registry dependencies, and every one of them completes before any storage write.
///
/// @dev The benchmark has no horizon fields of its own. The session version it depends on owns the
/// operating horizon, which is why the session and the calendar it names must be the exact pair the
/// session itself was registered against.
contract BenchmarkRegistry is IBenchmarkRegistry, AccessControlDefaultAdminRules {
    bytes32 public constant BENCHMARK_QUALIFIER_ROLE = keccak256("SETRYN_BENCHMARK_QUALIFIER_ROLE");
    bytes32 public constant BENCHMARK_STATUS_MANAGER_ROLE = keccak256("SETRYN_BENCHMARK_STATUS_MANAGER_ROLE");

    /// @dev Version numbering starts at one, so zero is an unambiguous no-such-version sentinel for
    /// both the latest and the active pointer.
    uint32 private constant NO_VERSION = 0;

    IAssetRegistry private immutable _assetRegistry;

    IAdapterRegistry private immutable _adapterRegistry;

    ICalendarRegistry private immutable _calendarRegistry;

    ISessionRegistry private immutable _sessionRegistry;

    mapping(BenchmarkId benchmarkId => mapping(uint32 version => BenchmarkVersion record)) private _versions;

    mapping(BenchmarkId benchmarkId => uint32 version) private _latestVersion;

    mapping(BenchmarkId benchmarkId => uint32 version) private _activeVersion;

    mapping(BenchmarkId benchmarkId => mapping(bytes32 definitionHash => uint32 version)) private _definitionVersion;

    uint256 private _benchmarkCount;

    /// @dev The zero check runs inside the base constructor argument so a Setryn error, not the
    /// OpenZeppelin one, is what a caller sees for a zero admin.
    ///
    /// @dev The session registry is required to resolve its business days against the very calendar
    /// registry supplied here. Without that check a benchmark could commit to a calendar version
    /// this contract can read while its session was checked against a different deployment entirely,
    /// and the dependency graph would never close.
    constructor(
        uint48 defaultAdminDelay,
        address initialAdmin,
        IAssetRegistry assetRegistry_,
        IAdapterRegistry adapterRegistry_,
        ICalendarRegistry calendarRegistry_,
        ISessionRegistry sessionRegistry_
    ) AccessControlDefaultAdminRules(defaultAdminDelay, _requireInitialAdmin(initialAdmin)) {
        if (address(assetRegistry_) == address(0)) {
            revert ZeroAssetRegistry();
        }
        if (address(assetRegistry_).code.length == 0) {
            revert AssetRegistryHasNoCode(address(assetRegistry_));
        }
        if (address(adapterRegistry_) == address(0)) {
            revert ZeroAdapterRegistry();
        }
        if (address(adapterRegistry_).code.length == 0) {
            revert AdapterRegistryHasNoCode(address(adapterRegistry_));
        }
        if (address(calendarRegistry_) == address(0)) {
            revert ZeroCalendarRegistry();
        }
        if (address(calendarRegistry_).code.length == 0) {
            revert CalendarRegistryHasNoCode(address(calendarRegistry_));
        }
        if (address(sessionRegistry_) == address(0)) {
            revert ZeroSessionRegistry();
        }
        if (address(sessionRegistry_).code.length == 0) {
            revert SessionRegistryHasNoCode(address(sessionRegistry_));
        }

        address sessionCalendarRegistry = address(sessionRegistry_.calendarRegistry());
        if (sessionCalendarRegistry != address(calendarRegistry_)) {
            revert DependencyGraphMismatch(address(calendarRegistry_), sessionCalendarRegistry);
        }

        _assetRegistry = assetRegistry_;
        _adapterRegistry = adapterRegistry_;
        _calendarRegistry = calendarRegistry_;
        _sessionRegistry = sessionRegistry_;

        _grantRole(BENCHMARK_QUALIFIER_ROLE, initialAdmin);
        _grantRole(BENCHMARK_STATUS_MANAGER_ROLE, initialAdmin);
    }

    /// @dev Every check, including all dependency reads, completes before any storage is touched.
    /// The referenced assets, adapter, calendar, and session versions must all exist and the adapter
    /// must be exactly compatible, but they are deliberately allowed to be Paused or Deprecated
    /// here, because registration grants no risk authority and a reference is often published ahead
    /// of the dependencies it will eventually be switched on against.
    function registerBenchmark(BenchmarkDefinition calldata definition)
        external
        onlyRole(BENCHMARK_QUALIFIER_ROLE)
        returns (BenchmarkId benchmarkId, uint32 version)
    {
        BenchmarkDefinitionLib.validate(definition);
        _requireDependencies(definition);

        benchmarkId = BenchmarkDefinitionLib.deriveBenchmarkId(definition);
        bytes32 definitionHash = BenchmarkDefinitionLib.hashDefinition(definition, block.chainid);

        uint32 existingVersion = _definitionVersion[benchmarkId][definitionHash];
        if (existingVersion != NO_VERSION) {
            revert DuplicateBenchmarkDefinition(benchmarkId, definitionHash, existingVersion);
        }

        version = _latestVersion[benchmarkId];
        if (version == type(uint32).max) {
            revert BenchmarkVersionExhausted(benchmarkId);
        }

        version += 1;
        bytes32 versionHash = BenchmarkDefinitionLib.hashVersion(benchmarkId, version, definitionHash, block.chainid);

        _writeVersion(definition, benchmarkId, version, definitionHash, versionHash);

        emit BenchmarkRegistered(
            benchmarkId,
            version,
            versionHash,
            definitionHash,
            definition,
            block.chainid,
            RegistryStatus.Paused,
            msg.sender
        );
    }

    /// @dev Activation re-reads every dependency, because an adapter may have been paused or drifted
    /// from its qualified bytecode, an asset may have been deprecated, and a calendar or session
    /// version may have been displaced as the active pointer since registration. It fails closed
    /// rather than opening risk against a reference nobody can currently observe.
    function activateBenchmark(BenchmarkId benchmarkId, uint32 version)
        external
        onlyRole(BENCHMARK_STATUS_MANAGER_ROLE)
    {
        BenchmarkVersion storage record = _requireVersion(benchmarkId, version);
        _requireTransition(benchmarkId, version, record.status, RegistryStatus.Active);

        uint32 currentActive = _activeVersion[benchmarkId];
        if (currentActive != NO_VERSION) {
            revert AnotherBenchmarkVersionActive(benchmarkId, currentActive);
        }

        BenchmarkDefinition memory definition = record.definition;
        (uint32 validFromDay, uint32 validThroughDay) = _requireDependencies(definition);
        _requireDependenciesOpen(definition, validFromDay, validThroughDay);

        _setStatus(benchmarkId, version, record, RegistryStatus.Active);
        _setActiveVersion(benchmarkId, version);
    }

    function pauseBenchmark(BenchmarkId benchmarkId, uint32 version) external onlyRole(BENCHMARK_STATUS_MANAGER_ROLE) {
        _transition(benchmarkId, version, RegistryStatus.Paused);
    }

    function deprecateBenchmark(BenchmarkId benchmarkId, uint32 version)
        external
        onlyRole(BENCHMARK_STATUS_MANAGER_ROLE)
    {
        _transition(benchmarkId, version, RegistryStatus.Deprecated);
    }

    function assetRegistry() external view returns (IAssetRegistry) {
        return _assetRegistry;
    }

    function adapterRegistry() external view returns (IAdapterRegistry) {
        return _adapterRegistry;
    }

    function calendarRegistry() external view returns (ICalendarRegistry) {
        return _calendarRegistry;
    }

    function sessionRegistry() external view returns (ISessionRegistry) {
        return _sessionRegistry;
    }

    function getBenchmark(BenchmarkId benchmarkId, uint32 version) external view returns (BenchmarkVersion memory) {
        return _requireVersion(benchmarkId, version);
    }

    function latestVersion(BenchmarkId benchmarkId) external view returns (uint32) {
        return _latestVersion[benchmarkId];
    }

    function activeVersion(BenchmarkId benchmarkId) external view returns (uint32) {
        return _activeVersion[benchmarkId];
    }

    function statusOf(BenchmarkId benchmarkId, uint32 version) external view returns (RegistryStatus) {
        return _versions[benchmarkId][version].status;
    }

    function benchmarkCount() external view returns (uint256) {
        return _benchmarkCount;
    }

    function exists(BenchmarkId benchmarkId, uint32 version) external view returns (bool) {
        return _versions[benchmarkId][version].status != RegistryStatus.Unspecified;
    }

    function coversDay(BenchmarkId benchmarkId, uint32 version, uint32 day) external view returns (bool) {
        BenchmarkVersion storage record = _versions[benchmarkId][version];
        if (record.status == RegistryStatus.Unspecified) {
            return false;
        }
        (uint32 validFromDay, uint32 validThroughDay) =
            _sessionHorizon(record.definition.sessionId, record.definition.sessionVersion);
        return day >= validFromDay && day <= validThroughDay;
    }

    /// @dev The live gate is dependency aware in every direction: a benchmark that is Active on its
    /// own terms is closed for new risk the moment a leg of its pair is paused, its oracle adapter
    /// drifts from its qualified bytecode, or the day falls outside what its calendar and session
    /// still resolve.
    ///
    /// @dev The dependency calls below are trusted immutable registries. They are deliberately not
    /// wrapped in try/catch: a dependency contract that reverts on a view is broken, and hiding that
    /// behind a false would turn a broken dependency graph into a silent closed gate.
    function isOpenForNewRisk(BenchmarkId benchmarkId, uint32 version, uint32 day) external view returns (bool) {
        BenchmarkVersion storage record = _versions[benchmarkId][version];
        if (record.status != RegistryStatus.Active || _activeVersion[benchmarkId] != version) {
            return false;
        }

        BenchmarkDefinition memory definition = record.definition;
        if (!_assetRegistry.isActive(definition.baseAssetId) || !_assetRegistry.isActive(definition.quoteAssetId)) {
            return false;
        }
        if (!_adapterRegistry.isOpenForNewRisk(definition.adapterId, definition.adapterVersion)) {
            return false;
        }

        (uint32 validFromDay, uint32 validThroughDay) = _sessionHorizon(definition.sessionId, definition.sessionVersion);
        if (day < validFromDay || day > validThroughDay) {
            return false;
        }
        if (!_calendarRegistry.isOpenForNewRisk(definition.calendarId, definition.calendarVersion, day)) {
            return false;
        }
        return _sessionRegistry.isOpenForNewRisk(definition.sessionId, definition.sessionVersion, day);
    }

    function isLifecycleEnabled(BenchmarkId benchmarkId, uint32 version) external view returns (bool) {
        return _versions[benchmarkId][version].status != RegistryStatus.Unspecified;
    }

    function deriveBenchmarkId(BenchmarkDefinition calldata definition) external pure returns (BenchmarkId) {
        return BenchmarkDefinitionLib.deriveBenchmarkId(definition);
    }

    /// @dev The write path is split out of registerBenchmark so the caller keeps only the values its
    /// event needs on the stack. Nothing here may run before every check above has passed.
    function _writeVersion(
        BenchmarkDefinition calldata definition,
        BenchmarkId benchmarkId,
        uint32 version,
        bytes32 definitionHash,
        bytes32 versionHash
    ) private {
        BenchmarkVersion storage record = _versions[benchmarkId][version];
        record.definition = definition;
        record.definitionHash = definitionHash;
        record.versionHash = versionHash;
        record.version = version;
        record.status = RegistryStatus.Paused;

        _latestVersion[benchmarkId] = version;
        _definitionVersion[benchmarkId][definitionHash] = version;
        _benchmarkCount += 1;
    }

    /// @dev Existence and exact compatibility of every dependency, with no status requirement at
    /// all. It returns the session horizon so the activation path does not have to read the session
    /// record a second time to learn the endpoints it must gate on.
    function _requireDependencies(BenchmarkDefinition memory definition)
        private
        view
        returns (uint32 validFromDay, uint32 validThroughDay)
    {
        _requireAssetsExist(definition.baseAssetId, definition.quoteAssetId);
        _requireCompatibleAdapter(definition);
        _requireCalendarExists(definition.calendarId, definition.calendarVersion);
        return _requireCompatibleSession(definition);
    }

    function _requireAssetsExist(AssetId baseAssetId, AssetId quoteAssetId) private view {
        if (!_assetRegistry.exists(baseAssetId)) {
            revert UnknownAssetDependency(baseAssetId);
        }
        if (!_assetRegistry.exists(quoteAssetId)) {
            revert UnknownAssetDependency(quoteAssetId);
        }
    }

    /// @dev The adapter must be an oracle adapter and must carry exactly the ABI revision and
    /// capability set this benchmark requires. A superset is refused as firmly as an unrelated
    /// adapter: an implementation that does more than was demanded was still reviewed against a
    /// different commitment.
    function _requireCompatibleAdapter(BenchmarkDefinition memory definition) private view {
        AdapterId adapterId = definition.adapterId;
        uint32 adapterVersion = definition.adapterVersion;

        if (!_adapterRegistry.exists(adapterId, adapterVersion)) {
            revert UnknownAdapterDependency(adapterId, adapterVersion);
        }

        AdapterVersion memory record = _adapterRegistry.getAdapter(adapterId, adapterVersion);
        if (
            AdapterKindId.unwrap(record.definition.kindId)
                != AdapterKindId.unwrap(AdapterDefinitionLib.ADAPTER_KIND_BENCHMARK)
        ) {
            revert AdapterKindMismatch(
                adapterId, adapterVersion, AdapterDefinitionLib.ADAPTER_KIND_BENCHMARK, record.definition.kindId
            );
        }
        if (record.definition.interfaceHash != definition.requiredInterfaceHash) {
            revert AdapterInterfaceMismatch(
                adapterId, adapterVersion, definition.requiredInterfaceHash, record.definition.interfaceHash
            );
        }
        if (record.definition.capabilityHash != definition.requiredCapabilityHash) {
            revert AdapterCapabilityMismatch(
                adapterId, adapterVersion, definition.requiredCapabilityHash, record.definition.capabilityHash
            );
        }
    }

    function _requireCalendarExists(CalendarId calendarId, uint32 calendarVersion) private view {
        if (!_calendarRegistry.exists(calendarId, calendarVersion)) {
            revert UnknownCalendarDependency(calendarId, calendarVersion);
        }
    }

    /// @dev The session must name the very calendar version the benchmark commits to. Anything else
    /// would let the day gate and the horizon be read from two schedules that never agreed on which
    /// days exist.
    function _requireCompatibleSession(BenchmarkDefinition memory definition)
        private
        view
        returns (uint32 validFromDay, uint32 validThroughDay)
    {
        SessionId sessionId = definition.sessionId;
        uint32 sessionVersion = definition.sessionVersion;

        if (!_sessionRegistry.exists(sessionId, sessionVersion)) {
            revert UnknownSessionDependency(sessionId, sessionVersion);
        }

        SessionVersion memory record = _sessionRegistry.getSession(sessionId, sessionVersion);
        if (
            CalendarId.unwrap(record.definition.calendarId) != CalendarId.unwrap(definition.calendarId)
                || record.definition.calendarVersion != definition.calendarVersion
        ) {
            revert SessionCalendarMismatch(
                sessionId,
                sessionVersion,
                definition.calendarId,
                definition.calendarVersion,
                record.definition.calendarId,
                record.definition.calendarVersion
            );
        }

        return (record.definition.validFromDay, record.definition.validThroughDay);
    }

    /// @dev The live status gate applied at activation only. Both endpoints of the session horizon
    /// are required for the calendar and the session, because those gates are evaluated per day: a
    /// dependency open at one end and closed at the other would let a benchmark be switched on for a
    /// range it cannot resolve.
    function _requireDependenciesOpen(
        BenchmarkDefinition memory definition,
        uint32 validFromDay,
        uint32 validThroughDay
    ) private view {
        _requireAssetActive(definition.baseAssetId);
        _requireAssetActive(definition.quoteAssetId);

        if (!_adapterRegistry.isOpenForNewRisk(definition.adapterId, definition.adapterVersion)) {
            revert AdapterDependencyNotOpen(definition.adapterId, definition.adapterVersion);
        }
        if (
            !_calendarRegistry.isOpenForNewRisk(definition.calendarId, definition.calendarVersion, validFromDay)
                || !_calendarRegistry.isOpenForNewRisk(
                    definition.calendarId, definition.calendarVersion, validThroughDay
                )
        ) {
            revert CalendarDependencyNotOpen(
                definition.calendarId, definition.calendarVersion, validFromDay, validThroughDay
            );
        }
        if (
            !_sessionRegistry.isOpenForNewRisk(definition.sessionId, definition.sessionVersion, validFromDay)
                || !_sessionRegistry.isOpenForNewRisk(definition.sessionId, definition.sessionVersion, validThroughDay)
        ) {
            revert SessionDependencyNotOpen(
                definition.sessionId, definition.sessionVersion, validFromDay, validThroughDay
            );
        }
    }

    function _requireAssetActive(AssetId assetId) private view {
        RegistryStatus status = _assetRegistry.statusOf(assetId);
        if (status != RegistryStatus.Active) {
            revert AssetDependencyNotActive(assetId, status);
        }
    }

    /// @dev The operating horizon of a benchmark is exactly the horizon of the session version it
    /// depends on. Sessions are append-only and never deleted, so a registered benchmark can always
    /// resolve this read.
    function _sessionHorizon(SessionId sessionId, uint32 sessionVersion)
        private
        view
        returns (uint32 validFromDay, uint32 validThroughDay)
    {
        SessionVersion memory record = _sessionRegistry.getSession(sessionId, sessionVersion);
        return (record.definition.validFromDay, record.definition.validThroughDay);
    }

    function _transition(BenchmarkId benchmarkId, uint32 version, RegistryStatus newStatus) private {
        BenchmarkVersion storage record = _requireVersion(benchmarkId, version);
        _requireTransition(benchmarkId, version, record.status, newStatus);

        _setStatus(benchmarkId, version, record, newStatus);

        if (_activeVersion[benchmarkId] == version) {
            _setActiveVersion(benchmarkId, NO_VERSION);
        }
    }

    function _setStatus(
        BenchmarkId benchmarkId,
        uint32 version,
        BenchmarkVersion storage record,
        RegistryStatus newStatus
    ) private {
        RegistryStatus previousStatus = record.status;
        record.status = newStatus;

        emit BenchmarkStatusChanged(benchmarkId, version, previousStatus, newStatus, msg.sender);
    }

    function _setActiveVersion(BenchmarkId benchmarkId, uint32 newVersion) private {
        uint32 previousVersion = _activeVersion[benchmarkId];
        _activeVersion[benchmarkId] = newVersion;

        emit BenchmarkActiveVersionChanged(benchmarkId, previousVersion, newVersion, msg.sender);
    }

    function _requireVersion(BenchmarkId benchmarkId, uint32 version)
        private
        view
        returns (BenchmarkVersion storage record)
    {
        record = _versions[benchmarkId][version];
        if (record.status == RegistryStatus.Unspecified) {
            revert UnknownBenchmarkVersion(benchmarkId, version);
        }
    }

    function _requireTransition(
        BenchmarkId benchmarkId,
        uint32 version,
        RegistryStatus previousStatus,
        RegistryStatus newStatus
    ) private pure {
        if (!_isPermittedTransition(previousStatus, newStatus)) {
            revert InvalidBenchmarkTransition(benchmarkId, version, previousStatus, newStatus);
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
