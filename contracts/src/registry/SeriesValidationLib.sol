// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IAdapterRegistry} from "../interfaces/IAdapterRegistry.sol";
import {IBenchmarkRegistry} from "../interfaces/IBenchmarkRegistry.sol";
import {ICalendarRegistry} from "../interfaces/ICalendarRegistry.sol";
import {IRiskDomainRegistry} from "../interfaces/IRiskDomainRegistry.sol";
import {ISeriesPayoffModuleV1} from "../interfaces/ISeriesPayoffModuleV1.sol";
import {ISeriesRegistry} from "../interfaces/ISeriesRegistry.sol";
import {ISessionRegistry} from "../interfaces/ISessionRegistry.sol";
import {InstrumentDefinitionLib} from "../libraries/InstrumentDefinitionLib.sol";
import {MarketDefinitionLib} from "../libraries/MarketDefinitionLib.sol";
import {SeriesDefinitionLib} from "../libraries/SeriesDefinitionLib.sol";
import {AdapterVersion} from "../types/AdapterDefinition.sol";
import {BenchmarkVersion} from "../types/BenchmarkDefinition.sol";
import {AssetId, InstrumentId, MarketId, PayoffFamilyId} from "../types/Identifiers.sol";
import {InstrumentVersion} from "../types/InstrumentDefinition.sol";
import {MarketVersion} from "../types/MarketDefinition.sol";
import {RiskDomainVersion} from "../types/RiskDomainDefinition.sol";
import {SeriesDefinition} from "../types/SeriesDefinition.sol";
import {
    FixingCandidate,
    FixingSlot,
    SeriesDateProof,
    SeriesPayoffValidation,
    SeriesQualificationData,
    SeriesValidationContext
} from "../types/SeriesQualification.sol";
import {Lots} from "../types/Units.sol";
import {SeriesRegistryDependencies} from "./SeriesRegistryTypes.sol";

/// Linked validation logic for the series registry: dependency records, dates and calendars, fixing candidates,
/// payoff module evaluation, and risk caps. Runs through DELEGATECALL in the registry's context.
library SeriesValidationLib {
    function requireDependencies(SeriesRegistryDependencies memory deps, SeriesDefinition memory definition)
        external
        view
        returns (MarketVersion memory market, InstrumentVersion memory instrument)
    {
        if (!deps.marketRegistry.isLifecycleEnabled(definition.marketId, definition.marketVersion)) {
            revert ISeriesRegistry.UnknownMarketDependency(definition.marketId, definition.marketVersion);
        }
        if (!deps.instrumentRegistry.isLifecycleEnabled(definition.instrumentId, definition.instrumentVersion)) {
            revert ISeriesRegistry.UnknownInstrumentDependency(definition.instrumentId, definition.instrumentVersion);
        }

        market = deps.marketRegistry.getMarket(definition.marketId, definition.marketVersion);
        instrument = deps.instrumentRegistry.getInstrument(definition.instrumentId, definition.instrumentVersion);
        _requireMarketRecord(definition, market);
        _requireInstrumentRecord(definition, instrument);
    }

    function requireDependenciesOpen(
        SeriesRegistryDependencies memory deps,
        SeriesDefinition memory definition,
        uint32 day
    ) external view {
        if (!deps.marketRegistry.isOpenForNewRisk(definition.marketId, definition.marketVersion, day)) {
            revert ISeriesRegistry.MarketDependencyNotOpen(definition.marketId, definition.marketVersion, day);
        }
        if (!deps.instrumentRegistry.isOpenForNewRisk(definition.instrumentId, definition.instrumentVersion)) {
            revert ISeriesRegistry.InstrumentDependencyNotOpen(definition.instrumentId, definition.instrumentVersion);
        }
    }

    function dependenciesOpen(SeriesRegistryDependencies memory deps, SeriesDefinition storage definition, uint32 day)
        external
        view
        returns (bool)
    {
        return deps.marketRegistry.isOpenForNewRisk(definition.marketId, definition.marketVersion, day)
            && deps.instrumentRegistry.isOpenForNewRisk(definition.instrumentId, definition.instrumentVersion);
    }

    function _requireMarketRecord(SeriesDefinition memory definition, MarketVersion memory record) internal view {
        if (
            record.version != definition.marketVersion
                || MarketId.unwrap(MarketDefinitionLib.deriveMarketId(record.definition))
                    != MarketId.unwrap(definition.marketId)
                || record.definitionHash != MarketDefinitionLib.hashDefinition(record.definition, block.chainid)
                || record.versionHash
                    != MarketDefinitionLib.hashVersion(
                        definition.marketId, definition.marketVersion, record.definitionHash, block.chainid
                    )
        ) revert ISeriesRegistry.MarketDependencyRecordMismatch(definition.marketId, definition.marketVersion);
    }

    function _requireInstrumentRecord(SeriesDefinition memory definition, InstrumentVersion memory record)
        internal
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
        ) {
            revert ISeriesRegistry.InstrumentDependencyRecordMismatch(
                definition.instrumentId, definition.instrumentVersion
            );
        }
    }

    function validateDates(
        SeriesRegistryDependencies memory deps,
        MarketVersion memory market,
        SeriesDateProof[] calldata dateProofs,
        bool requireOpen
    ) external view {
        ICalendarRegistry calendars = deps.marketRegistry.calendarRegistry();
        ISessionRegistry sessions = deps.marketRegistry.sessionRegistry();
        uint32 currentDay = _currentDay();

        for (uint256 i; i < dateProofs.length; ++i) {
            SeriesDateProof calldata dateProof = dateProofs[i];
            _validateCalendarDays(deps, market, dateProof, i);

            uint32 day = SeriesDefinitionLib.effectiveDay(dateProof);
            if (!calendars.coversDay(
                    market.definition.tradingCalendarId, market.definition.tradingCalendarVersion, day
                )) revert ISeriesRegistry.CalendarDateHorizonTooNarrow(i, day);
            if (!sessions.coversDay(market.definition.tradingSessionId, market.definition.tradingSessionVersion, day)) {
                revert ISeriesRegistry.SessionDateHorizonTooNarrow(i, day);
            }
            if (!requireOpen || day < currentDay) continue;
            if (!calendars.isOpenForNewRisk(
                    market.definition.tradingCalendarId, market.definition.tradingCalendarVersion, day
                )) revert ISeriesRegistry.CalendarDateNotOpen(i, day);
            if (!sessions.isOpenForNewRisk(
                    market.definition.tradingSessionId, market.definition.tradingSessionVersion, day
                )) revert ISeriesRegistry.SessionDateNotOpen(i, day);
        }
    }

    function _validateCalendarDays(
        SeriesRegistryDependencies memory deps,
        MarketVersion memory market,
        SeriesDateProof calldata dateProof,
        uint256 proofIndex
    ) internal view {
        ICalendarRegistry calendars = deps.marketRegistry.calendarRegistry();
        for (uint256 j; j < dateProof.calendarDays.length; ++j) {
            if (!calendars.verifyDay(
                    market.definition.tradingCalendarId,
                    market.definition.tradingCalendarVersion,
                    dateProof.calendarDays[j].calendarDay,
                    dateProof.calendarDays[j].merkleProof
                )) revert ISeriesRegistry.InvalidCalendarDayProof(proofIndex, j);
        }
    }

    function validateCandidates(
        SeriesRegistryDependencies memory deps,
        MarketVersion memory market,
        FixingSlot[] calldata slots,
        bool requireOpen
    ) external view {
        IBenchmarkRegistry benchmarks = deps.marketRegistry.benchmarkRegistry();
        for (uint256 i; i < slots.length; ++i) {
            for (uint256 j; j < slots[i].candidates.length; ++j) {
                FixingCandidate calldata candidate = slots[i].candidates[j];
                if (!benchmarks.isLifecycleEnabled(candidate.benchmarkId, candidate.benchmarkVersion)) {
                    revert ISeriesRegistry.UnknownBenchmarkCandidate(slots[i].slot, j);
                }

                BenchmarkVersion memory benchmark =
                    benchmarks.getBenchmark(candidate.benchmarkId, candidate.benchmarkVersion);
                if (
                    AssetId.unwrap(benchmark.definition.baseAssetId) != AssetId.unwrap(market.definition.baseAssetId)
                        || AssetId.unwrap(benchmark.definition.quoteAssetId)
                            != AssetId.unwrap(market.definition.quoteAssetId)
                ) revert ISeriesRegistry.BenchmarkCandidatePairMismatch(slots[i].slot, j);

                uint32 firstDay = uint32(candidate.windowStartsAt / 1 days);
                uint32 lastDay = uint32((candidate.windowEndsAt - 1) / 1 days);
                if (
                    !benchmarks.coversDay(candidate.benchmarkId, candidate.benchmarkVersion, firstDay)
                        || !benchmarks.coversDay(candidate.benchmarkId, candidate.benchmarkVersion, lastDay)
                ) revert ISeriesRegistry.BenchmarkCandidateHorizonTooNarrow(slots[i].slot, j);
                if (
                    requireOpen
                        && (!benchmarks.isOpenForNewRisk(candidate.benchmarkId, candidate.benchmarkVersion, firstDay)
                            || !benchmarks.isOpenForNewRisk(candidate.benchmarkId, candidate.benchmarkVersion, lastDay))
                ) revert ISeriesRegistry.BenchmarkCandidateNotOpen(slots[i].slot, j);
            }
        }
    }

    function validatePayoff(
        SeriesRegistryDependencies memory deps,
        SeriesDefinition memory definition,
        MarketVersion memory market,
        InstrumentVersion memory instrument,
        SeriesQualificationData calldata qualification
    ) external view {
        IAdapterRegistry adapters = deps.instrumentRegistry.adapterRegistry();
        if (!adapters.runtimeMatches(instrument.definition.payoffModuleId, instrument.definition.payoffModuleVersion)) {
            revert ISeriesRegistry.PayoffModuleRuntimeMismatch();
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
            revert ISeriesRegistry.PayoffFamilyMismatch(
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
            revert ISeriesRegistry.PayoffDebitBoundsMismatch(
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
            revert ISeriesRegistry.PayoffDisruptionTransferOutsideBounds(
                validation.terminalDisruptionTransferMinorPerLot,
                validation.maxLongDebitMinorPerLot,
                validation.maxShortDebitMinorPerLot
            );
        }
        if (validation.terminalDisruptionTransferMinorPerLot != definition.terminalDisruptionTransferMinorPerLot) {
            revert ISeriesRegistry.PayoffDisruptionTransferMismatch(
                definition.terminalDisruptionTransferMinorPerLot, validation.terminalDisruptionTransferMinorPerLot
            );
        }
    }

    function validateRiskCaps(
        SeriesRegistryDependencies memory deps,
        SeriesDefinition memory definition,
        MarketVersion memory market
    ) external view {
        IRiskDomainRegistry risks = deps.marketRegistry.riskDomainRegistry();
        RiskDomainVersion memory risk =
            risks.getRiskDomain(market.definition.riskDomainId, market.definition.riskDomainVersion);
        if (
            AssetId.unwrap(risk.definition.collateralAssetId) != AssetId.unwrap(market.definition.settlementAssetId)
                || risk.definition.collateralAssetVersion != market.definition.settlementAssetVersion
        ) revert ISeriesRegistry.RiskDomainRecordMismatch();

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

    function _requireLiabilityWithinCaps(uint256 liability, uint128 accountCap, uint128 aggregateCap) internal pure {
        if (liability > accountCap || liability > aggregateCap) {
            revert ISeriesRegistry.SeriesLiabilityExceedsRiskCap(liability, accountCap, aggregateCap);
        }
    }

    function _boundedStaticcall(
        address implementation,
        uint64 gasLimit,
        bytes4 selector,
        bytes memory payload,
        uint256 expectedReturnLength
    ) internal view returns (bytes memory returnData) {
        bool success;
        uint256 returnLength;
        assembly ("memory-safe") {
            success := staticcall(gasLimit, implementation, add(payload, 0x20), mload(payload), 0, 0)
            returnLength := returndatasize()
        }
        if (!success) revert ISeriesRegistry.PayoffModuleCallFailed(selector);
        if (returnLength != expectedReturnLength) {
            revert ISeriesRegistry.InvalidPayoffModuleReturn(selector, returnLength);
        }

        returnData = new bytes(returnLength);
        assembly ("memory-safe") {
            returndatacopy(add(returnData, 0x20), 0, returnLength)
        }
    }

    function _currentDay() internal view returns (uint32) {
        return uint32(block.timestamp / 1 days);
    }
}
