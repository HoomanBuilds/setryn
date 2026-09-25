// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IAssetRegistry} from "../../src/interfaces/IAssetRegistry.sol";
import {IBenchmarkRegistry} from "../../src/interfaces/IBenchmarkRegistry.sol";
import {ICalendarRegistry} from "../../src/interfaces/ICalendarRegistry.sol";
import {IFeeScheduleRegistry} from "../../src/interfaces/IFeeScheduleRegistry.sol";
import {IRiskDomainRegistry} from "../../src/interfaces/IRiskDomainRegistry.sol";
import {ISessionRegistry} from "../../src/interfaces/ISessionRegistry.sol";
import {ISettlementAssetRegistry} from "../../src/interfaces/ISettlementAssetRegistry.sol";
import {BenchmarkVersion} from "../../src/types/BenchmarkDefinition.sol";
import {RegistryStatus} from "../../src/types/Enums.sol";
import {FeeScheduleVersion} from "../../src/types/FeeScheduleDefinition.sol";
import {
    AssetId,
    BenchmarkId,
    CalendarId,
    FeeScheduleId,
    RiskDomainId,
    SessionId
} from "../../src/types/Identifiers.sol";
import {RiskDomainVersion} from "../../src/types/RiskDomainDefinition.sol";
import {SessionVersion} from "../../src/types/SessionDefinition.sol";

contract MarketAssetRegistryMock {
    mapping(AssetId assetId => bool value) public exists;
    mapping(AssetId assetId => bool value) public isActive;

    function setAsset(AssetId assetId, bool active) external {
        exists[assetId] = true;
        isActive[assetId] = active;
    }

    function statusOf(AssetId assetId) external view returns (RegistryStatus) {
        if (!exists[assetId]) return RegistryStatus.Unspecified;
        return isActive[assetId] ? RegistryStatus.Active : RegistryStatus.Paused;
    }
}

contract MarketSettlementRegistryMock {
    IAssetRegistry public immutable assetRegistry;
    mapping(AssetId assetId => mapping(uint32 version => bool value)) public isLifecycleEnabled;
    mapping(AssetId assetId => mapping(uint32 version => bool value)) public isOpenForNewRisk;

    constructor(IAssetRegistry assetRegistry_) {
        assetRegistry = assetRegistry_;
    }

    function setBinding(AssetId assetId, uint32 version, bool open) external {
        isLifecycleEnabled[assetId][version] = true;
        isOpenForNewRisk[assetId][version] = open;
    }
}

contract MarketCollateralVaultMock {
    ISettlementAssetRegistry public immutable settlementAssetRegistry;
    IRiskDomainRegistry public immutable riskDomainRegistry;
    uint32 public terminalReservationCapabilityVersion = 1;
    bool public capabilitySupported = true;

    constructor(ISettlementAssetRegistry settlementAssetRegistry_, IRiskDomainRegistry riskDomainRegistry_) {
        settlementAssetRegistry = settlementAssetRegistry_;
        riskDomainRegistry = riskDomainRegistry_;
    }

    function setTerminalReservationCapability(uint32 version, bool supported) external {
        terminalReservationCapabilityVersion = version;
        capabilitySupported = supported;
    }

    function supportsTerminalReservationCapability(uint32 version) external view returns (bool) {
        return capabilitySupported && version == terminalReservationCapabilityVersion;
    }
}

contract MarketCalendarRegistryMock {
    mapping(CalendarId calendarId => mapping(uint32 version => bool value)) public exists;
    mapping(CalendarId calendarId => mapping(uint32 version => bool value)) private _open;

    function setCalendar(CalendarId calendarId, uint32 version, bool open) external {
        exists[calendarId][version] = true;
        _open[calendarId][version] = open;
    }

    function isOpenForNewRisk(CalendarId calendarId, uint32 version, uint32) external view returns (bool) {
        return _open[calendarId][version];
    }
}

contract MarketSessionRegistryMock {
    ICalendarRegistry public immutable calendarRegistry;
    mapping(SessionId sessionId => mapping(uint32 version => SessionVersion record)) private _records;
    mapping(SessionId sessionId => mapping(uint32 version => bool value)) private _open;

    constructor(ICalendarRegistry calendarRegistry_) {
        calendarRegistry = calendarRegistry_;
    }

    function setSession(SessionId sessionId, uint32 version, CalendarId calendarId, uint32 calendarVersion, bool open)
        external
    {
        SessionVersion storage record = _records[sessionId][version];
        record.definition.calendarId = calendarId;
        record.definition.calendarVersion = calendarVersion;
        record.status = RegistryStatus.Paused;
        _open[sessionId][version] = open;
    }

    function exists(SessionId sessionId, uint32 version) external view returns (bool) {
        return _records[sessionId][version].status != RegistryStatus.Unspecified;
    }

    function getSession(SessionId sessionId, uint32 version) external view returns (SessionVersion memory) {
        return _records[sessionId][version];
    }

    function isOpenForNewRisk(SessionId sessionId, uint32 version, uint32) external view returns (bool) {
        return _open[sessionId][version];
    }
}

contract MarketBenchmarkRegistryMock {
    IAssetRegistry public immutable assetRegistry;
    ICalendarRegistry public immutable calendarRegistry;
    ISessionRegistry public immutable sessionRegistry;
    mapping(BenchmarkId benchmarkId => mapping(uint32 version => BenchmarkVersion record)) private _records;
    mapping(BenchmarkId benchmarkId => mapping(uint32 version => bool value)) private _open;

    constructor(IAssetRegistry assetRegistry_, ICalendarRegistry calendarRegistry_, ISessionRegistry sessionRegistry_) {
        assetRegistry = assetRegistry_;
        calendarRegistry = calendarRegistry_;
        sessionRegistry = sessionRegistry_;
    }

    function setBenchmark(BenchmarkId benchmarkId, uint32 version, AssetId baseAssetId, AssetId quoteAssetId, bool open)
        external
    {
        BenchmarkVersion storage record = _records[benchmarkId][version];
        record.definition.baseAssetId = baseAssetId;
        record.definition.quoteAssetId = quoteAssetId;
        record.status = RegistryStatus.Paused;
        _open[benchmarkId][version] = open;
    }

    function exists(BenchmarkId benchmarkId, uint32 version) external view returns (bool) {
        return _records[benchmarkId][version].status != RegistryStatus.Unspecified;
    }

    function getBenchmark(BenchmarkId benchmarkId, uint32 version) external view returns (BenchmarkVersion memory) {
        return _records[benchmarkId][version];
    }

    function isOpenForNewRisk(BenchmarkId benchmarkId, uint32 version, uint32) external view returns (bool) {
        return _open[benchmarkId][version];
    }
}

contract MarketRiskDomainRegistryMock {
    ISettlementAssetRegistry public immutable settlementAssetRegistry;
    mapping(RiskDomainId riskDomainId => mapping(uint32 version => RiskDomainVersion record)) private _records;
    mapping(RiskDomainId riskDomainId => mapping(uint32 version => bool value)) public isOpenForNewRisk;

    constructor(ISettlementAssetRegistry settlementAssetRegistry_) {
        settlementAssetRegistry = settlementAssetRegistry_;
    }

    function setRiskDomain(RiskDomainId riskDomainId, uint32 version, AssetId assetId, uint32 assetVersion, bool open)
        external
    {
        RiskDomainVersion storage record = _records[riskDomainId][version];
        record.definition.collateralAssetId = assetId;
        record.definition.collateralAssetVersion = assetVersion;
        record.status = RegistryStatus.Paused;
        isOpenForNewRisk[riskDomainId][version] = open;
    }

    function exists(RiskDomainId riskDomainId, uint32 version) external view returns (bool) {
        return _records[riskDomainId][version].status != RegistryStatus.Unspecified;
    }

    function getRiskDomain(RiskDomainId riskDomainId, uint32 version) external view returns (RiskDomainVersion memory) {
        return _records[riskDomainId][version];
    }
}

contract MarketFeeScheduleRegistryMock {
    ISettlementAssetRegistry public immutable settlementAssetRegistry;
    mapping(FeeScheduleId feeScheduleId => mapping(uint32 version => FeeScheduleVersion record)) private _records;
    mapping(FeeScheduleId feeScheduleId => mapping(uint32 version => bool value)) public isOpenForNewRisk;

    constructor(ISettlementAssetRegistry settlementAssetRegistry_) {
        settlementAssetRegistry = settlementAssetRegistry_;
    }

    function setFeeSchedule(
        FeeScheduleId feeScheduleId,
        uint32 version,
        AssetId assetId,
        uint32 assetVersion,
        bool open
    ) external {
        FeeScheduleVersion storage record = _records[feeScheduleId][version];
        record.definition.settlementAssetId = assetId;
        record.definition.settlementAssetVersion = assetVersion;
        record.status = RegistryStatus.Paused;
        isOpenForNewRisk[feeScheduleId][version] = open;
    }

    function exists(FeeScheduleId feeScheduleId, uint32 version) external view returns (bool) {
        return _records[feeScheduleId][version].status != RegistryStatus.Unspecified;
    }

    function getFeeSchedule(FeeScheduleId feeScheduleId, uint32 version)
        external
        view
        returns (FeeScheduleVersion memory)
    {
        return _records[feeScheduleId][version];
    }
}
