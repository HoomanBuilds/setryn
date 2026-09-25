// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IAdapterRegistry} from "../../src/interfaces/IAdapterRegistry.sol";
import {IBenchmarkRegistry} from "../../src/interfaces/IBenchmarkRegistry.sol";
import {ICalendarRegistry} from "../../src/interfaces/ICalendarRegistry.sol";
import {IRiskDomainRegistry} from "../../src/interfaces/IRiskDomainRegistry.sol";
import {ISeriesPayoffModuleV1} from "../../src/interfaces/ISeriesPayoffModuleV1.sol";
import {ISessionRegistry} from "../../src/interfaces/ISessionRegistry.sol";
import {InstrumentDefinitionLib} from "../../src/libraries/InstrumentDefinitionLib.sol";
import {MarketDefinitionLib} from "../../src/libraries/MarketDefinitionLib.sol";
import {AdapterDefinition, AdapterVersion} from "../../src/types/AdapterDefinition.sol";
import {BenchmarkDefinition, BenchmarkVersion} from "../../src/types/BenchmarkDefinition.sol";
import {CalendarDay} from "../../src/types/CalendarDefinition.sol";
import {RegistryStatus} from "../../src/types/Enums.sol";
import {
    AdapterId,
    AssetId,
    BenchmarkId,
    InstrumentId,
    MarketId,
    PayoffFamilyId,
    RiskDomainId
} from "../../src/types/Identifiers.sol";
import {InstrumentDefinition, InstrumentVersion} from "../../src/types/InstrumentDefinition.sol";
import {MarketDefinition, MarketVersion} from "../../src/types/MarketDefinition.sol";
import {RiskDomainDefinition, RiskDomainVersion} from "../../src/types/RiskDomainDefinition.sol";
import {SessionDay} from "../../src/types/SessionDefinition.sol";
import {FixingSlot, SeriesPayoffValidation, SeriesValidationContext} from "../../src/types/SeriesQualification.sol";

contract SeriesCalendarRegistryMock {
    bool public covers = true;
    bool public open = true;
    bool public proofValid = true;

    function setState(bool covers_, bool open_, bool proofValid_) external {
        covers = covers_;
        open = open_;
        proofValid = proofValid_;
    }

    function coversDay(bytes32, uint32, uint32) external view returns (bool) {
        return covers;
    }

    function isOpenForNewRisk(bytes32, uint32, uint32) external view returns (bool) {
        return open;
    }

    function verifyDay(bytes32, uint32, CalendarDay calldata, bytes32[] calldata) external view returns (bool) {
        return proofValid;
    }
}

contract SeriesSessionRegistryMock {
    bool public covers = true;
    bool public open = true;

    function setState(bool covers_, bool open_) external {
        covers = covers_;
        open = open_;
    }

    function coversDay(bytes32, uint32, uint32) external view returns (bool) {
        return covers;
    }

    function isOpenForNewRisk(bytes32, uint32, uint32) external view returns (bool) {
        return open;
    }

    function verifyDay(bytes32, uint32, SessionDay calldata, bytes32[] calldata) external pure returns (bool) {
        return true;
    }
}

contract SeriesBenchmarkRegistryMock {
    mapping(BenchmarkId benchmarkId => mapping(uint32 version => BenchmarkVersion record)) private _records;
    mapping(BenchmarkId benchmarkId => mapping(uint32 version => bool value)) private _lifecycle;
    mapping(BenchmarkId benchmarkId => mapping(uint32 version => bool value)) private _covers;
    mapping(BenchmarkId benchmarkId => mapping(uint32 version => bool value)) private _open;

    function setBenchmark(BenchmarkId benchmarkId, uint32 version, BenchmarkDefinition calldata definition) external {
        BenchmarkVersion storage record = _records[benchmarkId][version];
        record.definition = definition;
        record.version = version;
        record.status = RegistryStatus.Active;
        _lifecycle[benchmarkId][version] = true;
        _covers[benchmarkId][version] = true;
        _open[benchmarkId][version] = true;
    }

    function setState(BenchmarkId benchmarkId, uint32 version, bool lifecycle, bool covers, bool open) external {
        _lifecycle[benchmarkId][version] = lifecycle;
        _covers[benchmarkId][version] = covers;
        _open[benchmarkId][version] = open;
    }

    function getBenchmark(BenchmarkId benchmarkId, uint32 version) external view returns (BenchmarkVersion memory) {
        return _records[benchmarkId][version];
    }

    function isLifecycleEnabled(BenchmarkId benchmarkId, uint32 version) external view returns (bool) {
        return _lifecycle[benchmarkId][version];
    }

    function coversDay(BenchmarkId benchmarkId, uint32 version, uint32) external view returns (bool) {
        return _covers[benchmarkId][version];
    }

    function isOpenForNewRisk(BenchmarkId benchmarkId, uint32 version, uint32) external view returns (bool) {
        return _open[benchmarkId][version];
    }
}

contract SeriesRiskDomainRegistryMock {
    mapping(RiskDomainId riskDomainId => mapping(uint32 version => RiskDomainVersion record)) private _records;

    function setRiskDomain(
        RiskDomainId riskDomainId,
        uint32 version,
        AssetId collateralAssetId,
        uint32 collateralAssetVersion,
        uint128 accountCap,
        uint128 aggregateCap
    ) external {
        RiskDomainDefinition storage definition = _records[riskDomainId][version].definition;
        definition.collateralAssetId = collateralAssetId;
        definition.collateralAssetVersion = collateralAssetVersion;
        definition.maxAccountLiabilityBaseUnits = accountCap;
        definition.maxAggregateLiabilityBaseUnits = aggregateCap;
        _records[riskDomainId][version].version = version;
        _records[riskDomainId][version].status = RegistryStatus.Active;
    }

    function getRiskDomain(RiskDomainId riskDomainId, uint32 version) external view returns (RiskDomainVersion memory) {
        return _records[riskDomainId][version];
    }
}

contract SeriesAdapterRegistryMock {
    mapping(AdapterId adapterId => mapping(uint32 version => AdapterVersion record)) private _records;
    mapping(AdapterId adapterId => mapping(uint32 version => bool value)) private _runtimeMatches;

    function setAdapter(AdapterId adapterId, uint32 version, AdapterDefinition calldata definition, bool matches)
        external
    {
        _records[adapterId][version].definition = definition;
        _records[adapterId][version].version = version;
        _records[adapterId][version].status = RegistryStatus.Active;
        _runtimeMatches[adapterId][version] = matches;
    }

    function setRuntimeMatches(AdapterId adapterId, uint32 version, bool matches) external {
        _runtimeMatches[adapterId][version] = matches;
    }

    function getAdapter(AdapterId adapterId, uint32 version) external view returns (AdapterVersion memory) {
        return _records[adapterId][version];
    }

    function runtimeMatches(AdapterId adapterId, uint32 version) external view returns (bool) {
        return _runtimeMatches[adapterId][version];
    }
}

contract SeriesMarketRegistryMock {
    ICalendarRegistry public immutable calendarRegistry;
    ISessionRegistry public immutable sessionRegistry;
    IBenchmarkRegistry public immutable benchmarkRegistry;
    IRiskDomainRegistry public immutable riskDomainRegistry;

    mapping(MarketId marketId => mapping(uint32 version => MarketVersion record)) private _records;
    mapping(MarketId marketId => mapping(uint32 version => bool value)) private _lifecycle;
    mapping(MarketId marketId => mapping(uint32 version => bool value)) private _open;

    constructor(
        ICalendarRegistry calendarRegistry_,
        ISessionRegistry sessionRegistry_,
        IBenchmarkRegistry benchmarkRegistry_,
        IRiskDomainRegistry riskDomainRegistry_
    ) {
        calendarRegistry = calendarRegistry_;
        sessionRegistry = sessionRegistry_;
        benchmarkRegistry = benchmarkRegistry_;
        riskDomainRegistry = riskDomainRegistry_;
    }

    function setMarket(MarketDefinition calldata definition, uint32 version, bool lifecycle, bool open)
        external
        returns (MarketId marketId)
    {
        marketId = MarketDefinitionLib.deriveMarketId(definition);
        bytes32 definitionHash = MarketDefinitionLib.hashDefinition(definition, block.chainid);
        MarketVersion storage record = _records[marketId][version];
        record.definition = definition;
        record.definitionHash = definitionHash;
        record.versionHash = MarketDefinitionLib.hashVersion(marketId, version, definitionHash, block.chainid);
        record.version = version;
        record.status = lifecycle ? RegistryStatus.Paused : RegistryStatus.Unspecified;
        _lifecycle[marketId][version] = lifecycle;
        _open[marketId][version] = open;
    }

    function setOpen(MarketId marketId, uint32 version, bool open) external {
        _open[marketId][version] = open;
    }

    function corruptVersion(MarketId marketId, uint32 version, uint32 storedVersion) external {
        _records[marketId][version].version = storedVersion;
    }

    function getMarket(MarketId marketId, uint32 version) external view returns (MarketVersion memory) {
        return _records[marketId][version];
    }

    function isLifecycleEnabled(MarketId marketId, uint32 version) external view returns (bool) {
        return _lifecycle[marketId][version];
    }

    function isOpenForNewRisk(MarketId marketId, uint32 version, uint32) external view returns (bool) {
        return _open[marketId][version];
    }
}

contract SeriesInstrumentRegistryMock {
    IAdapterRegistry public immutable adapterRegistry;

    mapping(InstrumentId instrumentId => mapping(uint32 version => InstrumentVersion record)) private _records;
    mapping(InstrumentId instrumentId => mapping(uint32 version => bool value)) private _lifecycle;
    mapping(InstrumentId instrumentId => mapping(uint32 version => bool value)) private _open;

    constructor(IAdapterRegistry adapterRegistry_) {
        adapterRegistry = adapterRegistry_;
    }

    function setInstrument(InstrumentDefinition calldata definition, uint32 version, bool lifecycle, bool open)
        external
        returns (InstrumentId instrumentId)
    {
        instrumentId = InstrumentDefinitionLib.deriveInstrumentId(definition);
        bytes32 definitionHash = InstrumentDefinitionLib.hashDefinition(definition, block.chainid);
        InstrumentVersion storage record = _records[instrumentId][version];
        record.definition = definition;
        record.definitionHash = definitionHash;
        record.versionHash = InstrumentDefinitionLib.hashVersion(instrumentId, version, definitionHash, block.chainid);
        record.version = version;
        record.status = lifecycle ? RegistryStatus.Paused : RegistryStatus.Unspecified;
        _lifecycle[instrumentId][version] = lifecycle;
        _open[instrumentId][version] = open;
    }

    function setOpen(InstrumentId instrumentId, uint32 version, bool open) external {
        _open[instrumentId][version] = open;
    }

    function getInstrument(InstrumentId instrumentId, uint32 version) external view returns (InstrumentVersion memory) {
        return _records[instrumentId][version];
    }

    function isLifecycleEnabled(InstrumentId instrumentId, uint32 version) external view returns (bool) {
        return _lifecycle[instrumentId][version];
    }

    function isOpenForNewRisk(InstrumentId instrumentId, uint32 version) external view returns (bool) {
        return _open[instrumentId][version];
    }
}

contract SeriesPayoffModuleMock is ISeriesPayoffModuleV1 {
    PayoffFamilyId private _family;
    SeriesPayoffValidation private _validation;
    bool private _revertValidation;

    function setFamily(PayoffFamilyId family_) external {
        _family = family_;
    }

    function setValidation(SeriesPayoffValidation calldata validation_) external {
        _validation = validation_;
    }

    function setRevertValidation(bool value) external {
        _revertValidation = value;
    }

    function payoffFamilyId() external view returns (PayoffFamilyId) {
        return _family;
    }

    function validateSeries(SeriesValidationContext calldata, bytes calldata, FixingSlot[] calldata)
        external
        view
        returns (SeriesPayoffValidation memory)
    {
        if (_revertValidation) revert();
        return _validation;
    }
}

contract SeriesMalformedPayoffModule {
    fallback(bytes calldata) external returns (bytes memory) {
        return hex"01";
    }
}
