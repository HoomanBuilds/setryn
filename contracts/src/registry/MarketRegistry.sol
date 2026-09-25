// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";

import {IAssetRegistry} from "../interfaces/IAssetRegistry.sol";
import {IBenchmarkRegistry} from "../interfaces/IBenchmarkRegistry.sol";
import {ICalendarRegistry} from "../interfaces/ICalendarRegistry.sol";
import {ICollateralVault} from "../interfaces/ICollateralVault.sol";
import {IFeeScheduleRegistry} from "../interfaces/IFeeScheduleRegistry.sol";
import {IMarketRegistry} from "../interfaces/IMarketRegistry.sol";
import {IRiskDomainRegistry} from "../interfaces/IRiskDomainRegistry.sol";
import {ISessionRegistry} from "../interfaces/ISessionRegistry.sol";
import {ISettlementAssetRegistry} from "../interfaces/ISettlementAssetRegistry.sol";
import {MarketDefinitionLib} from "../libraries/MarketDefinitionLib.sol";
import {BenchmarkVersion} from "../types/BenchmarkDefinition.sol";
import {RegistryStatus} from "../types/Enums.sol";
import {FeeScheduleVersion} from "../types/FeeScheduleDefinition.sol";
import {
    AssetId,
    BenchmarkId,
    CalendarId,
    FeeScheduleId,
    MarketId,
    RiskDomainId,
    SessionId
} from "../types/Identifiers.sol";
import {MarketDefinition, MarketVersion} from "../types/MarketDefinition.sol";
import {RiskDomainVersion} from "../types/RiskDomainDefinition.sol";
import {SessionVersion} from "../types/SessionDefinition.sol";

contract MarketRegistry is IMarketRegistry, AccessControlDefaultAdminRules {
    bytes32 public constant MARKET_QUALIFIER_ROLE = keccak256("SETRYN_MARKET_QUALIFIER_ROLE");
    bytes32 public constant MARKET_STATUS_MANAGER_ROLE = keccak256("SETRYN_MARKET_STATUS_MANAGER_ROLE");

    uint32 private constant NO_VERSION = 0;
    uint32 private constant REQUIRED_TERMINAL_RESERVATION_CAPABILITY_VERSION = 1;

    IAssetRegistry private immutable _assetRegistry;
    ISettlementAssetRegistry private immutable _settlementAssetRegistry;
    ICollateralVault private immutable _collateralVault;
    IBenchmarkRegistry private immutable _benchmarkRegistry;
    ICalendarRegistry private immutable _calendarRegistry;
    ISessionRegistry private immutable _sessionRegistry;
    IRiskDomainRegistry private immutable _riskDomainRegistry;
    IFeeScheduleRegistry private immutable _feeScheduleRegistry;

    mapping(MarketId marketId => mapping(uint32 version => MarketVersion record)) private _versions;
    mapping(MarketId marketId => uint32 version) private _latestVersion;
    mapping(MarketId marketId => uint32 version) private _activeVersion;
    mapping(MarketId marketId => mapping(bytes32 definitionHash => uint32 version)) private _definitionVersion;
    uint256 private _marketCount;

    constructor(
        uint48 defaultAdminDelay,
        address initialAdmin,
        IAssetRegistry assetRegistry_,
        ISettlementAssetRegistry settlementAssetRegistry_,
        ICollateralVault collateralVault_,
        IBenchmarkRegistry benchmarkRegistry_,
        ICalendarRegistry calendarRegistry_,
        ISessionRegistry sessionRegistry_,
        IRiskDomainRegistry riskDomainRegistry_,
        IFeeScheduleRegistry feeScheduleRegistry_
    ) AccessControlDefaultAdminRules(defaultAdminDelay, _requireInitialAdmin(initialAdmin)) {
        _requireRegistry(address(assetRegistry_));
        _requireRegistry(address(settlementAssetRegistry_));
        _requireRegistry(address(collateralVault_));
        _requireRegistry(address(benchmarkRegistry_));
        _requireRegistry(address(calendarRegistry_));
        _requireRegistry(address(sessionRegistry_));
        _requireRegistry(address(riskDomainRegistry_));
        _requireRegistry(address(feeScheduleRegistry_));

        _requireDependencyGraph(
            assetRegistry_,
            settlementAssetRegistry_,
            collateralVault_,
            benchmarkRegistry_,
            calendarRegistry_,
            sessionRegistry_,
            riskDomainRegistry_,
            feeScheduleRegistry_
        );

        _assetRegistry = assetRegistry_;
        _settlementAssetRegistry = settlementAssetRegistry_;
        _collateralVault = collateralVault_;
        _benchmarkRegistry = benchmarkRegistry_;
        _calendarRegistry = calendarRegistry_;
        _sessionRegistry = sessionRegistry_;
        _riskDomainRegistry = riskDomainRegistry_;
        _feeScheduleRegistry = feeScheduleRegistry_;

        _grantRole(MARKET_QUALIFIER_ROLE, initialAdmin);
        _grantRole(MARKET_STATUS_MANAGER_ROLE, initialAdmin);
    }

    function registerMarket(MarketDefinition calldata definition)
        external
        onlyRole(MARKET_QUALIFIER_ROLE)
        returns (MarketId marketId, uint32 version)
    {
        MarketDefinitionLib.validate(definition);
        _requireDependencies(definition);

        marketId = MarketDefinitionLib.deriveMarketId(definition);
        bytes32 definitionHash = MarketDefinitionLib.hashDefinition(definition, block.chainid);
        uint32 existingVersion = _definitionVersion[marketId][definitionHash];
        if (existingVersion != NO_VERSION) {
            revert DuplicateMarketDefinition(marketId, definitionHash, existingVersion);
        }

        version = _latestVersion[marketId];
        if (version == type(uint32).max) revert MarketVersionExhausted(marketId);
        version += 1;

        bytes32 versionHash = MarketDefinitionLib.hashVersion(marketId, version, definitionHash, block.chainid);
        _writeVersion(definition, marketId, version, definitionHash, versionHash);

        emit MarketRegistered(
            marketId, version, versionHash, definitionHash, definition, block.chainid, RegistryStatus.Paused, msg.sender
        );
    }

    function activateMarket(MarketId marketId, uint32 version) external onlyRole(MARKET_STATUS_MANAGER_ROLE) {
        MarketVersion storage record = _requireVersion(marketId, version);
        _requireTransition(marketId, version, record.status, RegistryStatus.Active);
        uint32 currentActive = _activeVersion[marketId];
        if (currentActive != NO_VERSION) revert AnotherMarketVersionActive(marketId, currentActive);

        MarketDefinition memory definition = record.definition;
        _requireDependencies(definition);
        _requireDependenciesOpen(definition, _currentDay());

        _setStatus(marketId, version, record, RegistryStatus.Active);
        _setActiveVersion(marketId, version);
    }

    function pauseMarket(MarketId marketId, uint32 version) external onlyRole(MARKET_STATUS_MANAGER_ROLE) {
        _transition(marketId, version, RegistryStatus.Paused);
    }

    function deprecateMarket(MarketId marketId, uint32 version) external onlyRole(MARKET_STATUS_MANAGER_ROLE) {
        _transition(marketId, version, RegistryStatus.Deprecated);
    }

    function assetRegistry() external view returns (IAssetRegistry) {
        return _assetRegistry;
    }

    function settlementAssetRegistry() external view returns (ISettlementAssetRegistry) {
        return _settlementAssetRegistry;
    }

    function collateralVault() external view returns (ICollateralVault) {
        return _collateralVault;
    }

    function benchmarkRegistry() external view returns (IBenchmarkRegistry) {
        return _benchmarkRegistry;
    }

    function calendarRegistry() external view returns (ICalendarRegistry) {
        return _calendarRegistry;
    }

    function sessionRegistry() external view returns (ISessionRegistry) {
        return _sessionRegistry;
    }

    function riskDomainRegistry() external view returns (IRiskDomainRegistry) {
        return _riskDomainRegistry;
    }

    function feeScheduleRegistry() external view returns (IFeeScheduleRegistry) {
        return _feeScheduleRegistry;
    }

    function getMarket(MarketId marketId, uint32 version) external view returns (MarketVersion memory) {
        return _requireVersion(marketId, version);
    }

    function latestVersion(MarketId marketId) external view returns (uint32) {
        return _latestVersion[marketId];
    }

    function activeVersion(MarketId marketId) external view returns (uint32) {
        return _activeVersion[marketId];
    }

    function statusOf(MarketId marketId, uint32 version) external view returns (RegistryStatus) {
        return _versions[marketId][version].status;
    }

    function marketCount() external view returns (uint256) {
        return _marketCount;
    }

    function exists(MarketId marketId, uint32 version) external view returns (bool) {
        return _versions[marketId][version].status != RegistryStatus.Unspecified;
    }

    function isOpenForNewRisk(MarketId marketId, uint32 version, uint32 day) external view returns (bool) {
        MarketVersion storage record = _versions[marketId][version];
        if (record.status != RegistryStatus.Active || _activeVersion[marketId] != version) return false;
        return _dependenciesOpen(record.definition, day);
    }

    function isLifecycleEnabled(MarketId marketId, uint32 version) external view returns (bool) {
        return _versions[marketId][version].status != RegistryStatus.Unspecified;
    }

    function deriveMarketId(MarketDefinition calldata definition) external pure returns (MarketId) {
        return MarketDefinitionLib.deriveMarketId(definition);
    }

    function _requireDependencies(MarketDefinition memory definition) private view {
        _requireAssetExists(definition.baseAssetId);
        _requireAssetExists(definition.quoteAssetId);
        if (!_settlementAssetRegistry.isLifecycleEnabled(
                definition.settlementAssetId, definition.settlementAssetVersion
            )) {
            revert UnknownSettlementAssetDependency(definition.settlementAssetId, definition.settlementAssetVersion);
        }
        if (!_benchmarkRegistry.exists(definition.markBenchmarkId, definition.markBenchmarkVersion)) {
            revert UnknownBenchmarkDependency(definition.markBenchmarkId, definition.markBenchmarkVersion);
        }
        if (!_calendarRegistry.exists(definition.tradingCalendarId, definition.tradingCalendarVersion)) {
            revert UnknownCalendarDependency(definition.tradingCalendarId, definition.tradingCalendarVersion);
        }
        if (!_sessionRegistry.exists(definition.tradingSessionId, definition.tradingSessionVersion)) {
            revert UnknownSessionDependency(definition.tradingSessionId, definition.tradingSessionVersion);
        }
        if (!_riskDomainRegistry.exists(definition.riskDomainId, definition.riskDomainVersion)) {
            revert UnknownRiskDomainDependency(definition.riskDomainId, definition.riskDomainVersion);
        }
        if (!_feeScheduleRegistry.exists(definition.feeScheduleId, definition.feeScheduleVersion)) {
            revert UnknownFeeScheduleDependency(definition.feeScheduleId, definition.feeScheduleVersion);
        }
        _requireCompatibleDefinitions(definition);
    }

    function _requireCompatibleDefinitions(MarketDefinition memory definition) private view {
        BenchmarkVersion memory benchmark =
            _benchmarkRegistry.getBenchmark(definition.markBenchmarkId, definition.markBenchmarkVersion);
        if (
            AssetId.unwrap(benchmark.definition.baseAssetId) != AssetId.unwrap(definition.baseAssetId)
                || AssetId.unwrap(benchmark.definition.quoteAssetId) != AssetId.unwrap(definition.quoteAssetId)
        ) revert BenchmarkPairMismatch(definition.markBenchmarkId, definition.markBenchmarkVersion);

        SessionVersion memory session =
            _sessionRegistry.getSession(definition.tradingSessionId, definition.tradingSessionVersion);
        if (
            CalendarId.unwrap(session.definition.calendarId) != CalendarId.unwrap(definition.tradingCalendarId)
                || session.definition.calendarVersion != definition.tradingCalendarVersion
        ) revert SessionCalendarMismatch(definition.tradingSessionId, definition.tradingSessionVersion);

        RiskDomainVersion memory risk =
            _riskDomainRegistry.getRiskDomain(definition.riskDomainId, definition.riskDomainVersion);
        if (
            AssetId.unwrap(risk.definition.collateralAssetId) != AssetId.unwrap(definition.settlementAssetId)
                || risk.definition.collateralAssetVersion != definition.settlementAssetVersion
        ) revert RiskDomainSettlementMismatch(definition.riskDomainId, definition.riskDomainVersion);

        FeeScheduleVersion memory fee =
            _feeScheduleRegistry.getFeeSchedule(definition.feeScheduleId, definition.feeScheduleVersion);
        if (
            AssetId.unwrap(fee.definition.settlementAssetId) != AssetId.unwrap(definition.settlementAssetId)
                || fee.definition.settlementAssetVersion != definition.settlementAssetVersion
        ) revert FeeScheduleSettlementMismatch(definition.feeScheduleId, definition.feeScheduleVersion);
    }

    function _requireDependenciesOpen(MarketDefinition memory definition, uint32 day) private view {
        _requireAssetActive(definition.baseAssetId);
        _requireAssetActive(definition.quoteAssetId);
        if (!_settlementAssetRegistry.isOpenForNewRisk(definition.settlementAssetId, definition.settlementAssetVersion))
        {
            revert SettlementAssetDependencyNotOpen(definition.settlementAssetId, definition.settlementAssetVersion);
        }
        if (!_benchmarkRegistry.isOpenForNewRisk(definition.markBenchmarkId, definition.markBenchmarkVersion, day)) {
            revert BenchmarkDependencyNotOpen(definition.markBenchmarkId, definition.markBenchmarkVersion, day);
        }
        if (!_calendarRegistry.isOpenForNewRisk(definition.tradingCalendarId, definition.tradingCalendarVersion, day)) {
            revert CalendarDependencyNotOpen(definition.tradingCalendarId, definition.tradingCalendarVersion, day);
        }
        if (!_sessionRegistry.isOpenForNewRisk(definition.tradingSessionId, definition.tradingSessionVersion, day)) {
            revert SessionDependencyNotOpen(definition.tradingSessionId, definition.tradingSessionVersion, day);
        }
        if (!_riskDomainRegistry.isOpenForNewRisk(definition.riskDomainId, definition.riskDomainVersion)) {
            revert RiskDomainDependencyNotOpen(definition.riskDomainId, definition.riskDomainVersion);
        }
        if (!_feeScheduleRegistry.isOpenForNewRisk(definition.feeScheduleId, definition.feeScheduleVersion)) {
            revert FeeScheduleDependencyNotOpen(definition.feeScheduleId, definition.feeScheduleVersion);
        }
        _requireVaultDependencyOpen();
    }

    function _dependenciesOpen(MarketDefinition storage definition, uint32 day) private view returns (bool) {
        if (!_assetRegistry.isActive(definition.baseAssetId) || !_assetRegistry.isActive(definition.quoteAssetId)) {
            return false;
        }
        return _settlementAssetRegistry.isOpenForNewRisk(
            definition.settlementAssetId, definition.settlementAssetVersion
        ) && _benchmarkRegistry.isOpenForNewRisk(definition.markBenchmarkId, definition.markBenchmarkVersion, day)
            && _calendarRegistry.isOpenForNewRisk(definition.tradingCalendarId, definition.tradingCalendarVersion, day)
            && _sessionRegistry.isOpenForNewRisk(definition.tradingSessionId, definition.tradingSessionVersion, day)
            && _riskDomainRegistry.isOpenForNewRisk(definition.riskDomainId, definition.riskDomainVersion)
            && _feeScheduleRegistry.isOpenForNewRisk(definition.feeScheduleId, definition.feeScheduleVersion)
            && _terminalReservationCapabilityOpen();
    }

    function _requireAssetExists(AssetId assetId) private view {
        if (!_assetRegistry.exists(assetId)) revert UnknownAssetDependency(assetId);
    }

    function _requireAssetActive(AssetId assetId) private view {
        if (!_assetRegistry.isActive(assetId)) {
            revert AssetDependencyNotActive(assetId, _assetRegistry.statusOf(assetId));
        }
    }

    function _writeVersion(
        MarketDefinition calldata definition,
        MarketId marketId,
        uint32 version,
        bytes32 definitionHash,
        bytes32 versionHash
    ) private {
        MarketVersion storage record = _versions[marketId][version];
        record.definition = definition;
        record.definitionHash = definitionHash;
        record.versionHash = versionHash;
        record.version = version;
        record.status = RegistryStatus.Paused;
        _latestVersion[marketId] = version;
        _definitionVersion[marketId][definitionHash] = version;
        _marketCount += 1;
    }

    function _transition(MarketId marketId, uint32 version, RegistryStatus newStatus) private {
        MarketVersion storage record = _requireVersion(marketId, version);
        _requireTransition(marketId, version, record.status, newStatus);
        _setStatus(marketId, version, record, newStatus);
        if (_activeVersion[marketId] == version) _setActiveVersion(marketId, NO_VERSION);
    }

    function _setStatus(MarketId marketId, uint32 version, MarketVersion storage record, RegistryStatus newStatus)
        private
    {
        RegistryStatus previousStatus = record.status;
        record.status = newStatus;
        emit MarketStatusChanged(marketId, version, previousStatus, newStatus, msg.sender);
    }

    function _setActiveVersion(MarketId marketId, uint32 newVersion) private {
        uint32 previousVersion = _activeVersion[marketId];
        _activeVersion[marketId] = newVersion;
        emit MarketActiveVersionChanged(marketId, previousVersion, newVersion, msg.sender);
    }

    function _requireVersion(MarketId marketId, uint32 version) private view returns (MarketVersion storage record) {
        record = _versions[marketId][version];
        if (record.status == RegistryStatus.Unspecified) revert UnknownMarketVersion(marketId, version);
    }

    function _requireTransition(
        MarketId marketId,
        uint32 version,
        RegistryStatus previousStatus,
        RegistryStatus newStatus
    ) private pure {
        if (!_isPermittedTransition(previousStatus, newStatus)) {
            revert InvalidMarketTransition(marketId, version, previousStatus, newStatus);
        }
    }

    function _isPermittedTransition(RegistryStatus previousStatus, RegistryStatus newStatus)
        private
        pure
        returns (bool)
    {
        if (newStatus == RegistryStatus.Paused) return previousStatus == RegistryStatus.Active;
        if (newStatus == RegistryStatus.Active) return previousStatus == RegistryStatus.Paused;
        if (newStatus == RegistryStatus.Deprecated) {
            return previousStatus == RegistryStatus.Active || previousStatus == RegistryStatus.Paused;
        }
        return false;
    }

    function _requireRegistry(address dependency) private view {
        if (dependency == address(0)) revert ZeroRegistryDependency();
        if (dependency.code.length == 0) revert RegistryDependencyHasNoCode(dependency);
    }

    function _requireDependencyGraph(
        IAssetRegistry assetRegistry_,
        ISettlementAssetRegistry settlementAssetRegistry_,
        ICollateralVault collateralVault_,
        IBenchmarkRegistry benchmarkRegistry_,
        ICalendarRegistry calendarRegistry_,
        ISessionRegistry sessionRegistry_,
        IRiskDomainRegistry riskDomainRegistry_,
        IFeeScheduleRegistry feeScheduleRegistry_
    ) private view {
        _requireSameRegistry(address(assetRegistry_), address(settlementAssetRegistry_.assetRegistry()));
        _requireSameRegistry(address(assetRegistry_), address(benchmarkRegistry_.assetRegistry()));
        _requireSameRegistry(address(calendarRegistry_), address(benchmarkRegistry_.calendarRegistry()));
        _requireSameRegistry(address(sessionRegistry_), address(benchmarkRegistry_.sessionRegistry()));
        _requireSameRegistry(address(calendarRegistry_), address(sessionRegistry_.calendarRegistry()));
        _requireSameRegistry(address(settlementAssetRegistry_), address(riskDomainRegistry_.settlementAssetRegistry()));
        _requireSameRegistry(address(settlementAssetRegistry_), address(feeScheduleRegistry_.settlementAssetRegistry()));
        _requireSameRegistry(address(settlementAssetRegistry_), address(collateralVault_.settlementAssetRegistry()));
        _requireSameRegistry(address(riskDomainRegistry_), address(collateralVault_.riskDomainRegistry()));
        _requireTerminalReservationCapability(collateralVault_);
    }

    function _requireTerminalReservationCapability() private view {
        _requireTerminalReservationCapability(_collateralVault);
    }

    function _requireTerminalReservationCapability(ICollateralVault collateralVault_) private view {
        uint32 actualVersion = collateralVault_.terminalReservationCapabilityVersion();
        if (actualVersion != REQUIRED_TERMINAL_RESERVATION_CAPABILITY_VERSION) {
            revert TerminalReservationCapabilityMismatch(
                REQUIRED_TERMINAL_RESERVATION_CAPABILITY_VERSION, actualVersion
            );
        }
        if (!collateralVault_.supportsTerminalReservationCapability(REQUIRED_TERMINAL_RESERVATION_CAPABILITY_VERSION)) {
            revert TerminalReservationCapabilityNotSupported(REQUIRED_TERMINAL_RESERVATION_CAPABILITY_VERSION);
        }
    }

    function _terminalReservationCapabilityOpen() private view returns (bool) {
        return address(_collateralVault.settlementAssetRegistry()) == address(_settlementAssetRegistry)
            && address(_collateralVault.riskDomainRegistry()) == address(_riskDomainRegistry)
            && _collateralVault.terminalReservationCapabilityVersion()
                == REQUIRED_TERMINAL_RESERVATION_CAPABILITY_VERSION
            && _collateralVault.supportsTerminalReservationCapability(REQUIRED_TERMINAL_RESERVATION_CAPABILITY_VERSION);
    }

    function _requireVaultDependencyOpen() private view {
        _requireSameRegistry(address(_settlementAssetRegistry), address(_collateralVault.settlementAssetRegistry()));
        _requireSameRegistry(address(_riskDomainRegistry), address(_collateralVault.riskDomainRegistry()));
        _requireTerminalReservationCapability();
    }

    function _requireSameRegistry(address expectedRegistry, address actualRegistry) private pure {
        if (expectedRegistry != actualRegistry) revert DependencyGraphMismatch(expectedRegistry, actualRegistry);
    }

    function _currentDay() private view returns (uint32) {
        return uint32(block.timestamp / 1 days);
    }

    function _requireInitialAdmin(address initialAdmin) private pure returns (address) {
        if (initialAdmin == address(0)) revert ZeroInitialAdmin();
        return initialAdmin;
    }
}
