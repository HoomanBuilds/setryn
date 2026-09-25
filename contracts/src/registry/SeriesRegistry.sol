// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";

import {IAdapterRegistry} from "../interfaces/IAdapterRegistry.sol";
import {IBenchmarkRegistry} from "../interfaces/IBenchmarkRegistry.sol";
import {ICalendarRegistry} from "../interfaces/ICalendarRegistry.sol";
import {IInstrumentRegistry} from "../interfaces/IInstrumentRegistry.sol";
import {IMarketRegistry} from "../interfaces/IMarketRegistry.sol";
import {IRiskDomainRegistry} from "../interfaces/IRiskDomainRegistry.sol";
import {ISeriesPayoffModuleV1} from "../interfaces/ISeriesPayoffModuleV1.sol";
import {ISeriesRegistry} from "../interfaces/ISeriesRegistry.sol";
import {ISessionRegistry} from "../interfaces/ISessionRegistry.sol";
import {InstrumentDefinitionLib} from "../libraries/InstrumentDefinitionLib.sol";
import {MarketDefinitionLib} from "../libraries/MarketDefinitionLib.sol";
import {SeriesDefinitionLib} from "../libraries/SeriesDefinitionLib.sol";
import {AdapterVersion} from "../types/AdapterDefinition.sol";
import {BenchmarkVersion} from "../types/BenchmarkDefinition.sol";
import {RegistryStatus} from "../types/Enums.sol";
import {AssetId, InstrumentId, MarketId, PayoffFamilyId, SeriesId} from "../types/Identifiers.sol";
import {InstrumentVersion} from "../types/InstrumentDefinition.sol";
import {MarketVersion} from "../types/MarketDefinition.sol";
import {RiskDomainVersion} from "../types/RiskDomainDefinition.sol";
import {SeriesDefinition, SeriesVersion} from "../types/SeriesDefinition.sol";
import {
    FixingCandidate,
    FixingSlot,
    SeriesDateProof,
    SeriesPayoffValidation,
    SeriesQualificationData,
    SeriesValidationContext
} from "../types/SeriesQualification.sol";
import {Lots} from "../types/Units.sol";

contract SeriesRegistry is ISeriesRegistry, AccessControlDefaultAdminRules {
    bytes32 public constant SERIES_QUALIFIER_ROLE = keccak256("SETRYN_SERIES_QUALIFIER_ROLE");
    bytes32 public constant SERIES_STATUS_MANAGER_ROLE = keccak256("SETRYN_SERIES_STATUS_MANAGER_ROLE");

    uint32 private constant NO_VERSION = 0;

    IMarketRegistry private immutable _marketRegistry;
    IInstrumentRegistry private immutable _instrumentRegistry;

    mapping(SeriesId seriesId => mapping(uint32 version => SeriesVersion record)) private _versions;
    mapping(SeriesId seriesId => uint32 version) private _latestVersion;
    mapping(SeriesId seriesId => uint32 version) private _activeVersion;
    mapping(SeriesId seriesId => mapping(bytes32 definitionHash => uint32 version)) private _definitionVersion;
    uint256 private _seriesCount;

    constructor(
        uint48 defaultAdminDelay,
        address initialAdmin,
        IMarketRegistry marketRegistry_,
        IInstrumentRegistry instrumentRegistry_
    ) AccessControlDefaultAdminRules(defaultAdminDelay, _requireInitialAdmin(initialAdmin)) {
        _requireRegistry(address(marketRegistry_));
        _requireRegistry(address(instrumentRegistry_));

        _marketRegistry = marketRegistry_;
        _instrumentRegistry = instrumentRegistry_;

        _grantRole(SERIES_QUALIFIER_ROLE, initialAdmin);
        _grantRole(SERIES_STATUS_MANAGER_ROLE, initialAdmin);
    }

    function registerSeries(SeriesDefinition calldata definition, SeriesQualificationData calldata qualification)
        external
        onlyRole(SERIES_QUALIFIER_ROLE)
        returns (SeriesId seriesId, uint32 version)
    {
        SeriesDefinitionLib.validate(definition);
        (MarketVersion memory market, InstrumentVersion memory instrument) = _requireDependencies(definition);
        SeriesDefinitionLib.validateQualificationData(definition, instrument.definition, qualification);
        _validateDates(market, qualification.dateProofs, false);
        _validateCandidates(market, qualification.fixingSlots, false);
        _validatePayoff(definition, market, instrument, qualification);
        _validateRiskCaps(definition, market);

        seriesId = SeriesDefinitionLib.deriveSeriesId(definition);
        bytes32 definitionHash = SeriesDefinitionLib.hashDefinition(definition, block.chainid);
        uint32 existingVersion = _definitionVersion[seriesId][definitionHash];
        if (existingVersion != NO_VERSION) {
            revert DuplicateSeriesDefinition(seriesId, definitionHash, existingVersion);
        }

        version = _latestVersion[seriesId];
        if (version == type(uint32).max) revert SeriesVersionExhausted(seriesId);
        version += 1;

        bytes32 versionHash = SeriesDefinitionLib.hashVersion(seriesId, version, definitionHash, block.chainid);
        _writeVersion(definition, seriesId, version, definitionHash, versionHash);

        emit SeriesRegistered(
            seriesId, version, versionHash, definitionHash, definition, block.chainid, RegistryStatus.Paused, msg.sender
        );
        emit SeriesQualificationPublished(seriesId, version, qualification);
    }

    function activateSeries(SeriesId seriesId, uint32 version, SeriesQualificationData calldata qualification)
        external
        onlyRole(SERIES_STATUS_MANAGER_ROLE)
    {
        SeriesVersion storage record = _requireVersion(seriesId, version);
        _requireTransition(seriesId, version, record.status, RegistryStatus.Active);
        uint32 currentActive = _activeVersion[seriesId];
        if (currentActive != NO_VERSION) revert AnotherSeriesVersionActive(seriesId, currentActive);
        if (block.timestamp > record.definition.lastTradingAt) {
            revert SeriesTradingEnded(record.definition.lastTradingAt, block.timestamp);
        }

        SeriesDefinition memory definition = record.definition;
        (MarketVersion memory market, InstrumentVersion memory instrument) = _requireDependencies(definition);
        SeriesDefinitionLib.validateQualificationData(definition, instrument.definition, qualification);
        _requireDependenciesOpen(definition, _currentDay());
        _validateDates(market, qualification.dateProofs, true);
        _validateCandidates(market, qualification.fixingSlots, true);
        _validatePayoff(definition, market, instrument, qualification);
        _validateRiskCaps(definition, market);

        _setStatus(seriesId, version, record, RegistryStatus.Active);
        _setActiveVersion(seriesId, version);
    }

    function pauseSeries(SeriesId seriesId, uint32 version) external onlyRole(SERIES_STATUS_MANAGER_ROLE) {
        _transition(seriesId, version, RegistryStatus.Paused);
    }

    function deprecateSeries(SeriesId seriesId, uint32 version) external onlyRole(SERIES_STATUS_MANAGER_ROLE) {
        _transition(seriesId, version, RegistryStatus.Deprecated);
    }

    function marketRegistry() external view returns (IMarketRegistry) {
        return _marketRegistry;
    }

    function instrumentRegistry() external view returns (IInstrumentRegistry) {
        return _instrumentRegistry;
    }

    function getSeries(SeriesId seriesId, uint32 version) external view returns (SeriesVersion memory) {
        return _requireVersion(seriesId, version);
    }

    function latestVersion(SeriesId seriesId) external view returns (uint32) {
        return _latestVersion[seriesId];
    }

    function activeVersion(SeriesId seriesId) external view returns (uint32) {
        return _activeVersion[seriesId];
    }

    function statusOf(SeriesId seriesId, uint32 version) external view returns (RegistryStatus) {
        return _versions[seriesId][version].status;
    }

    function seriesCount() external view returns (uint256) {
        return _seriesCount;
    }

    function exists(SeriesId seriesId, uint32 version) external view returns (bool) {
        return _versions[seriesId][version].status != RegistryStatus.Unspecified;
    }

    function isOpenForNewRisk(SeriesId seriesId, uint32 version, uint32 day) external view returns (bool) {
        SeriesVersion storage record = _versions[seriesId][version];
        if (record.status != RegistryStatus.Active || _activeVersion[seriesId] != version) return false;
        if (block.timestamp < record.definition.tradingStartsAt || block.timestamp > record.definition.lastTradingAt) {
            return false;
        }
        return _dependenciesOpen(record.definition, day);
    }

    function isLifecycleEnabled(SeriesId seriesId, uint32 version) external view returns (bool) {
        return _versions[seriesId][version].status != RegistryStatus.Unspecified;
    }

    function deriveSeriesId(SeriesDefinition calldata definition) external pure returns (SeriesId) {
        return SeriesDefinitionLib.deriveSeriesId(definition);
    }

    function hashPayoffTerms(bytes32 termsSchemaHash, bytes calldata terms) external pure returns (bytes32) {
        return SeriesDefinitionLib.hashPayoffTerms(termsSchemaHash, terms);
    }

    function hashFixingSlots(SeriesDefinition calldata definition, FixingSlot[] calldata slots, uint16 maximumSlots)
        external
        pure
        returns (bytes32)
    {
        return SeriesDefinitionLib.hashFixingSlots(definition, slots, maximumSlots);
    }

    function hashDateProofs(SeriesDefinition calldata definition, SeriesDateProof[] calldata dateProofs)
        external
        pure
        returns (bytes32)
    {
        return SeriesDefinitionLib.hashDateProofs(definition, dateProofs);
    }

    function _requireDependencies(SeriesDefinition memory definition)
        private
        view
        returns (MarketVersion memory market, InstrumentVersion memory instrument)
    {
        if (!_marketRegistry.isLifecycleEnabled(definition.marketId, definition.marketVersion)) {
            revert UnknownMarketDependency(definition.marketId, definition.marketVersion);
        }
        if (!_instrumentRegistry.isLifecycleEnabled(definition.instrumentId, definition.instrumentVersion)) {
            revert UnknownInstrumentDependency(definition.instrumentId, definition.instrumentVersion);
        }

        market = _marketRegistry.getMarket(definition.marketId, definition.marketVersion);
        instrument = _instrumentRegistry.getInstrument(definition.instrumentId, definition.instrumentVersion);
        _requireMarketRecord(definition, market);
        _requireInstrumentRecord(definition, instrument);
    }

    function _requireDependenciesOpen(SeriesDefinition memory definition, uint32 day) private view {
        if (!_marketRegistry.isOpenForNewRisk(definition.marketId, definition.marketVersion, day)) {
            revert MarketDependencyNotOpen(definition.marketId, definition.marketVersion, day);
        }
        if (!_instrumentRegistry.isOpenForNewRisk(definition.instrumentId, definition.instrumentVersion)) {
            revert InstrumentDependencyNotOpen(definition.instrumentId, definition.instrumentVersion);
        }
    }

    function _dependenciesOpen(SeriesDefinition storage definition, uint32 day) private view returns (bool) {
        return _marketRegistry.isOpenForNewRisk(definition.marketId, definition.marketVersion, day)
            && _instrumentRegistry.isOpenForNewRisk(definition.instrumentId, definition.instrumentVersion);
    }

    function _requireMarketRecord(SeriesDefinition memory definition, MarketVersion memory record) private view {
        if (
            record.version != definition.marketVersion
                || MarketId.unwrap(MarketDefinitionLib.deriveMarketId(record.definition))
                    != MarketId.unwrap(definition.marketId)
                || record.definitionHash != MarketDefinitionLib.hashDefinition(record.definition, block.chainid)
                || record.versionHash
                    != MarketDefinitionLib.hashVersion(
                        definition.marketId, definition.marketVersion, record.definitionHash, block.chainid
                    )
        ) revert MarketDependencyRecordMismatch(definition.marketId, definition.marketVersion);
    }

    function _requireInstrumentRecord(SeriesDefinition memory definition, InstrumentVersion memory record)
        private
        view
    {
        if (
            record.version != definition.instrumentVersion
                || InstrumentId.unwrap(InstrumentDefinitionLib.deriveInstrumentId(record.definition))
                    != InstrumentId.unwrap(definition.instrumentId)
                || record.definitionHash != InstrumentDefinitionLib.hashDefinition(record.definition, block.chainid)
                || record.versionHash
                    != InstrumentDefinitionLib.hashVersion(
                        definition.instrumentId, definition.instrumentVersion, record.definitionHash, block.chainid
                    )
        ) revert InstrumentDependencyRecordMismatch(definition.instrumentId, definition.instrumentVersion);
    }

    function _validateDates(MarketVersion memory market, SeriesDateProof[] calldata dateProofs, bool requireOpen)
        private
        view
    {
        ICalendarRegistry calendars = _marketRegistry.calendarRegistry();
        ISessionRegistry sessions = _marketRegistry.sessionRegistry();
        uint32 currentDay = _currentDay();

        for (uint256 i; i < dateProofs.length; ++i) {
            SeriesDateProof calldata dateProof = dateProofs[i];
            _validateCalendarDays(market, dateProof, i);

            uint32 day = SeriesDefinitionLib.effectiveDay(dateProof);
            if (!calendars.coversDay(
                    market.definition.tradingCalendarId, market.definition.tradingCalendarVersion, day
                )) revert CalendarDateHorizonTooNarrow(i, day);
            if (!sessions.coversDay(market.definition.tradingSessionId, market.definition.tradingSessionVersion, day)) {
                revert SessionDateHorizonTooNarrow(i, day);
            }
            if (!requireOpen || day < currentDay) continue;
            if (!calendars.isOpenForNewRisk(
                    market.definition.tradingCalendarId, market.definition.tradingCalendarVersion, day
                )) revert CalendarDateNotOpen(i, day);
            if (!sessions.isOpenForNewRisk(
                    market.definition.tradingSessionId, market.definition.tradingSessionVersion, day
                )) revert SessionDateNotOpen(i, day);
        }
    }

    function _validateCalendarDays(MarketVersion memory market, SeriesDateProof calldata dateProof, uint256 proofIndex)
        private
        view
    {
        ICalendarRegistry calendars = _marketRegistry.calendarRegistry();
        for (uint256 j; j < dateProof.calendarDays.length; ++j) {
            if (!calendars.verifyDay(
                    market.definition.tradingCalendarId,
                    market.definition.tradingCalendarVersion,
                    dateProof.calendarDays[j].calendarDay,
                    dateProof.calendarDays[j].merkleProof
                )) revert InvalidCalendarDayProof(proofIndex, j);
        }
    }

    function _validateCandidates(MarketVersion memory market, FixingSlot[] calldata slots, bool requireOpen)
        private
        view
    {
        IBenchmarkRegistry benchmarks = _marketRegistry.benchmarkRegistry();
        for (uint256 i; i < slots.length; ++i) {
            for (uint256 j; j < slots[i].candidates.length; ++j) {
                FixingCandidate calldata candidate = slots[i].candidates[j];
                if (!benchmarks.isLifecycleEnabled(candidate.benchmarkId, candidate.benchmarkVersion)) {
                    revert UnknownBenchmarkCandidate(slots[i].slot, j);
                }

                BenchmarkVersion memory benchmark =
                    benchmarks.getBenchmark(candidate.benchmarkId, candidate.benchmarkVersion);
                if (
                    AssetId.unwrap(benchmark.definition.baseAssetId) != AssetId.unwrap(market.definition.baseAssetId)
                        || AssetId.unwrap(benchmark.definition.quoteAssetId)
                            != AssetId.unwrap(market.definition.quoteAssetId)
                ) revert BenchmarkCandidatePairMismatch(slots[i].slot, j);

                uint32 firstDay = uint32(candidate.windowStartsAt / 1 days);
                uint32 lastDay = uint32((candidate.windowEndsAt - 1) / 1 days);
                if (
                    !benchmarks.coversDay(candidate.benchmarkId, candidate.benchmarkVersion, firstDay)
                        || !benchmarks.coversDay(candidate.benchmarkId, candidate.benchmarkVersion, lastDay)
                ) revert BenchmarkCandidateHorizonTooNarrow(slots[i].slot, j);
                if (
                    requireOpen
                        && (!benchmarks.isOpenForNewRisk(candidate.benchmarkId, candidate.benchmarkVersion, firstDay)
                            || !benchmarks.isOpenForNewRisk(candidate.benchmarkId, candidate.benchmarkVersion, lastDay))
                ) revert BenchmarkCandidateNotOpen(slots[i].slot, j);
            }
        }
    }

    function _validatePayoff(
        SeriesDefinition memory definition,
        MarketVersion memory market,
        InstrumentVersion memory instrument,
        SeriesQualificationData calldata qualification
    ) private view {
        IAdapterRegistry adapters = _instrumentRegistry.adapterRegistry();
        if (!adapters.runtimeMatches(instrument.definition.payoffModuleId, instrument.definition.payoffModuleVersion)) {
            revert PayoffModuleRuntimeMismatch();
        }
        AdapterVersion memory adapter =
            adapters.getAdapter(instrument.definition.payoffModuleId, instrument.definition.payoffModuleVersion);
        address implementation = adapter.definition.implementation;

        bytes4 familySelector = ISeriesPayoffModuleV1.payoffFamilyId.selector;
        bytes memory familyReturn = _boundedStaticcall(
            implementation,
            instrument.definition.maxEvaluationGas,
            familySelector,
            abi.encodeCall(ISeriesPayoffModuleV1.payoffFamilyId, ()),
            32
        );
        PayoffFamilyId actualFamily = abi.decode(familyReturn, (PayoffFamilyId));
        if (PayoffFamilyId.unwrap(actualFamily) != PayoffFamilyId.unwrap(instrument.definition.payoffFamilyId)) {
            revert PayoffFamilyMismatch(
                PayoffFamilyId.unwrap(instrument.definition.payoffFamilyId), PayoffFamilyId.unwrap(actualFamily)
            );
        }

        SeriesValidationContext memory context = SeriesValidationContext({
            chainId: block.chainid,
            marketId: definition.marketId,
            marketVersion: definition.marketVersion,
            instrumentId: definition.instrumentId,
            instrumentVersion: definition.instrumentVersion,
            payoffFamilyId: instrument.definition.payoffFamilyId,
            settlementAssetId: market.definition.settlementAssetId,
            settlementAssetVersion: market.definition.settlementAssetVersion,
            payoffTermsHash: definition.payoffTermsHash,
            fixingSlotsHash: definition.fixingSlotsHash,
            disruptionOutcomeId: definition.disruptionOutcomeId,
            finalResolutionAt: definition.finalResolutionAt
        });
        bytes4 validationSelector = ISeriesPayoffModuleV1.validateSeries.selector;
        bytes memory validationReturn = _boundedStaticcall(
            implementation,
            instrument.definition.maxEvaluationGas,
            validationSelector,
            abi.encodeCall(
                ISeriesPayoffModuleV1.validateSeries, (context, qualification.payoffTerms, qualification.fixingSlots)
            ),
            96
        );
        SeriesPayoffValidation memory validation = abi.decode(validationReturn, (SeriesPayoffValidation));
        if (
            validation.maxLongDebitMinorPerLot != definition.maxLongDebitMinorPerLot
                || validation.maxShortDebitMinorPerLot != definition.maxShortDebitMinorPerLot
        ) {
            revert PayoffDebitBoundsMismatch(
                definition.maxLongDebitMinorPerLot,
                validation.maxLongDebitMinorPerLot,
                definition.maxShortDebitMinorPerLot,
                validation.maxShortDebitMinorPerLot
            );
        }
        int256 minimumTransfer = -int256(uint256(validation.maxLongDebitMinorPerLot));
        int256 maximumTransfer = int256(uint256(validation.maxShortDebitMinorPerLot));
        if (
            validation.terminalDisruptionTransferMinorPerLot < minimumTransfer
                || validation.terminalDisruptionTransferMinorPerLot > maximumTransfer
        ) {
            revert PayoffDisruptionTransferOutsideBounds(
                validation.terminalDisruptionTransferMinorPerLot,
                validation.maxLongDebitMinorPerLot,
                validation.maxShortDebitMinorPerLot
            );
        }
        if (validation.terminalDisruptionTransferMinorPerLot != definition.terminalDisruptionTransferMinorPerLot) {
            revert PayoffDisruptionTransferMismatch(
                definition.terminalDisruptionTransferMinorPerLot, validation.terminalDisruptionTransferMinorPerLot
            );
        }
    }

    function _validateRiskCaps(SeriesDefinition memory definition, MarketVersion memory market) private view {
        IRiskDomainRegistry risks = _marketRegistry.riskDomainRegistry();
        RiskDomainVersion memory risk =
            risks.getRiskDomain(market.definition.riskDomainId, market.definition.riskDomainVersion);
        if (
            AssetId.unwrap(risk.definition.collateralAssetId) != AssetId.unwrap(market.definition.settlementAssetId)
                || risk.definition.collateralAssetVersion != market.definition.settlementAssetVersion
        ) revert RiskDomainRecordMismatch();

        uint256 lots = Lots.unwrap(market.definition.maxOrderLots);
        _requireLiabilityWithinCaps(
            lots * uint256(definition.maxLongDebitMinorPerLot),
            risk.definition.maxAccountLiabilityBaseUnits,
            risk.definition.maxAggregateLiabilityBaseUnits
        );
        _requireLiabilityWithinCaps(
            lots * uint256(definition.maxShortDebitMinorPerLot),
            risk.definition.maxAccountLiabilityBaseUnits,
            risk.definition.maxAggregateLiabilityBaseUnits
        );
    }

    function _requireLiabilityWithinCaps(uint256 liability, uint128 accountCap, uint128 aggregateCap) private pure {
        if (liability > accountCap || liability > aggregateCap) {
            revert SeriesLiabilityExceedsRiskCap(liability, accountCap, aggregateCap);
        }
    }

    function _boundedStaticcall(
        address implementation,
        uint64 gasLimit,
        bytes4 selector,
        bytes memory payload,
        uint256 expectedReturnLength
    ) private view returns (bytes memory returnData) {
        bool success;
        uint256 returnLength;
        assembly ("memory-safe") {
            success := staticcall(gasLimit, implementation, add(payload, 0x20), mload(payload), 0, 0)
            returnLength := returndatasize()
        }
        if (!success) revert PayoffModuleCallFailed(selector);
        if (returnLength != expectedReturnLength) revert InvalidPayoffModuleReturn(selector, returnLength);

        returnData = new bytes(returnLength);
        assembly ("memory-safe") {
            returndatacopy(add(returnData, 0x20), 0, returnLength)
        }
    }

    function _writeVersion(
        SeriesDefinition calldata definition,
        SeriesId seriesId,
        uint32 version,
        bytes32 definitionHash,
        bytes32 versionHash
    ) private {
        SeriesVersion storage record = _versions[seriesId][version];
        record.definition = definition;
        record.definitionHash = definitionHash;
        record.versionHash = versionHash;
        record.version = version;
        record.status = RegistryStatus.Paused;
        _latestVersion[seriesId] = version;
        _definitionVersion[seriesId][definitionHash] = version;
        _seriesCount += 1;
    }

    function _transition(SeriesId seriesId, uint32 version, RegistryStatus newStatus) private {
        SeriesVersion storage record = _requireVersion(seriesId, version);
        _requireTransition(seriesId, version, record.status, newStatus);
        _setStatus(seriesId, version, record, newStatus);
        if (_activeVersion[seriesId] == version) _setActiveVersion(seriesId, NO_VERSION);
    }

    function _setStatus(SeriesId seriesId, uint32 version, SeriesVersion storage record, RegistryStatus newStatus)
        private
    {
        RegistryStatus previousStatus = record.status;
        record.status = newStatus;
        emit SeriesStatusChanged(seriesId, version, previousStatus, newStatus, msg.sender);
    }

    function _setActiveVersion(SeriesId seriesId, uint32 newVersion) private {
        uint32 previousVersion = _activeVersion[seriesId];
        _activeVersion[seriesId] = newVersion;
        emit SeriesActiveVersionChanged(seriesId, previousVersion, newVersion, msg.sender);
    }

    function _requireVersion(SeriesId seriesId, uint32 version) private view returns (SeriesVersion storage record) {
        record = _versions[seriesId][version];
        if (record.status == RegistryStatus.Unspecified) revert UnknownSeriesVersion(seriesId, version);
    }

    function _requireTransition(
        SeriesId seriesId,
        uint32 version,
        RegistryStatus previousStatus,
        RegistryStatus newStatus
    ) private pure {
        if (!_isPermittedTransition(previousStatus, newStatus)) {
            revert InvalidSeriesTransition(seriesId, version, previousStatus, newStatus);
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

    function _currentDay() private view returns (uint32) {
        return uint32(block.timestamp / 1 days);
    }

    function _requireInitialAdmin(address initialAdmin) private pure returns (address) {
        if (initialAdmin == address(0)) revert ZeroInitialAdmin();
        return initialAdmin;
    }
}
