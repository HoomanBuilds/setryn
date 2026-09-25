// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {AdapterDefinitionLib} from "../../src/libraries/AdapterDefinitionLib.sol";
import {BenchmarkDefinitionLib} from "../../src/libraries/BenchmarkDefinitionLib.sol";
import {FeeScheduleDefinitionLib} from "../../src/libraries/FeeScheduleDefinitionLib.sol";
import {InstrumentDefinitionLib} from "../../src/libraries/InstrumentDefinitionLib.sol";
import {MarketDefinitionLib} from "../../src/libraries/MarketDefinitionLib.sol";
import {RiskDomainDefinitionLib} from "../../src/libraries/RiskDomainDefinitionLib.sol";
import {SeriesDefinitionLib} from "../../src/libraries/SeriesDefinitionLib.sol";
import {SessionDefinitionLib} from "../../src/libraries/SessionDefinitionLib.sol";
import {AdapterDefinition} from "../../src/types/AdapterDefinition.sol";
import {AssetDefinition} from "../../src/types/AssetDefinition.sol";
import {BenchmarkDefinition} from "../../src/types/BenchmarkDefinition.sol";
import {CalendarDay, CalendarDefinition} from "../../src/types/CalendarDefinition.sol";
import {FeeScheduleDefinition} from "../../src/types/FeeScheduleDefinition.sol";
import {InstrumentDefinition} from "../../src/types/InstrumentDefinition.sol";
import {MarketDefinition} from "../../src/types/MarketDefinition.sol";
import {RiskDomainDefinition} from "../../src/types/RiskDomainDefinition.sol";
import {SeriesDefinition} from "../../src/types/SeriesDefinition.sol";
import {
    CalendarDayProof,
    FixingCandidate,
    FixingSlot,
    SeriesDateKind,
    SeriesDateProof,
    SeriesQualificationData
} from "../../src/types/SeriesQualification.sol";
import {SessionDefinition} from "../../src/types/SessionDefinition.sol";
import {SettlementAssetDefinition} from "../../src/types/SettlementAssetDefinition.sol";
import {AssetClass} from "../../src/types/Enums.sol";
import {
    AdapterId,
    AdapterKindId,
    AssetId,
    BenchmarkId,
    CalendarId,
    FeeScheduleId,
    InstrumentId,
    MarketId,
    PayoffFamilyId,
    RiskDomainId,
    SessionId
} from "../../src/types/Identifiers.sol";
import {FeeRatePpm, Lots, PriceTicks, TickSizeMinor} from "../../src/types/Units.sol";

struct FixtureVaultConfig {
    uint48 defaultAdminDelay;
    uint64 maxLockDuration;
    uint64 evaluationGasHardCap;
}

struct FixtureSeriesSchedule {
    uint64 tradingStartsAt;
    uint64 lastTradingAt;
    uint64 expiryAt;
    uint64 exerciseOpensAt;
    uint64 exerciseCutoffAt;
    uint64 fixingWindowOpen;
    uint64 fixingWindowClose;
    uint64 primaryEvidenceDeadline;
    uint64 correctionCutoffAt;
    uint64 finalResolutionAt;
    uint64 settlementDeadline;
}

struct FixtureMarketDependencies {
    AssetId baseAssetId;
    AssetId quoteAssetId;
    uint32 settlementAssetVersion;
    BenchmarkId benchmarkId;
    uint32 benchmarkVersion;
    CalendarId calendarId;
    uint32 calendarVersion;
    SessionId sessionId;
    uint32 sessionVersion;
    RiskDomainId riskDomainId;
    uint32 riskDomainVersion;
    FeeScheduleId feeScheduleId;
    uint32 feeScheduleVersion;
}

library SetrynDefinitionFixtures {
    function vaultConfig() internal pure returns (FixtureVaultConfig memory) {
        return FixtureVaultConfig({defaultAdminDelay: 2 days, maxLockDuration: 30 days, evaluationGasHardCap: 500_000});
    }

    function asset(bytes32 seed, bytes32 symbol, AssetClass assetClass, uint8 decimals)
        internal
        pure
        returns (AssetDefinition memory)
    {
        return AssetDefinition({
            namespaceId: _value(seed, "asset.namespace"),
            referenceId: _value(seed, "asset.reference"),
            symbol: symbol,
            assetClass: assetClass,
            decimals: decimals
        });
    }

    function settlementAsset(bytes32 seed, AssetId assetId, address token)
        internal
        view
        returns (SettlementAssetDefinition memory)
    {
        return SettlementAssetDefinition({
            assetId: assetId,
            token: token,
            expectedRuntimeCodeHash: token.codehash,
            qualificationHash: _value(seed, "settlement.qualification")
        });
    }

    function adapter(bytes32 seed, AdapterKindId kindId, address implementation)
        internal
        view
        returns (AdapterDefinition memory)
    {
        return AdapterDefinition({
            namespaceId: _value(seed, "adapter.namespace"),
            referenceId: _value(seed, "adapter.reference"),
            kindId: kindId,
            implementation: implementation,
            expectedRuntimeCodeHash: implementation.codehash,
            interfaceHash: _value(seed, "adapter.interface"),
            capabilityHash: _value(seed, "adapter.capability"),
            configurationSchemaHash: _value(seed, "adapter.configuration"),
            evidenceHash: _value(seed, "adapter.evidence")
        });
    }

    function calendar(bytes32 seed, uint32 validFromDay, uint32 validThroughDay, bytes32 dayStatusRoot)
        internal
        pure
        returns (CalendarDefinition memory)
    {
        return CalendarDefinition({
            namespaceId: _value(seed, "calendar.namespace"),
            referenceId: _value(seed, "calendar.reference"),
            timeZoneId: keccak256("Etc/UTC"),
            weekendMask: 0x60,
            validFromDay: validFromDay,
            validThroughDay: validThroughDay,
            dayStatusRoot: dayStatusRoot,
            ruleSetHash: _value(seed, "calendar.rules"),
            sourceHash: _value(seed, "calendar.source")
        });
    }

    function session(
        bytes32 seed,
        CalendarId calendarId,
        uint32 calendarVersion,
        uint32 validFromDay,
        uint32 validThroughDay
    ) internal pure returns (SessionDefinition memory) {
        return SessionDefinition({
            namespaceId: _value(seed, "session.namespace"),
            referenceId: _value(seed, "session.reference"),
            calendarId: calendarId,
            calendarVersion: calendarVersion,
            validFromDay: validFromDay,
            validThroughDay: validThroughDay,
            dayScheduleRoot: _value(seed, "session.days"),
            windowKindSetHash: _value(seed, "session.window-kinds"),
            ruleSetHash: _value(seed, "session.rules"),
            sourceHash: _value(seed, "session.source")
        });
    }

    function benchmark(
        bytes32 seed,
        AssetId baseAssetId,
        AssetId quoteAssetId,
        AdapterId adapterId,
        uint32 adapterVersion,
        CalendarId calendarId,
        uint32 calendarVersion,
        SessionId sessionId,
        uint32 sessionVersion
    ) internal pure returns (BenchmarkDefinition memory) {
        return BenchmarkDefinition({
            namespaceId: _value(seed, "benchmark.namespace"),
            referenceId: _value(seed, "benchmark.reference"),
            kindId: BenchmarkDefinitionLib.BENCHMARK_KIND_SETTLEMENT_FIXING,
            baseAssetId: baseAssetId,
            quoteAssetId: quoteAssetId,
            adapterId: adapterId,
            adapterVersion: adapterVersion,
            calendarId: calendarId,
            calendarVersion: calendarVersion,
            sessionId: sessionId,
            sessionVersion: sessionVersion,
            feedKey: _value(seed, "benchmark.feed"),
            requiredInterfaceHash: _value(seed, "adapter.interface"),
            requiredCapabilityHash: _value(seed, "adapter.capability"),
            outputDecimals: 8,
            maxStalenessSeconds: 120,
            maxFutureSkewSeconds: 5,
            maxConfidenceBps: 100,
            observationRuleHash: _value(seed, "benchmark.observation"),
            fallbackPolicyHash: _value(seed, "benchmark.fallback"),
            disruptionPolicyHash: _value(seed, "benchmark.disruption"),
            dataRightsHash: _value(seed, "benchmark.data-rights"),
            evidenceHash: _value(seed, "benchmark.evidence")
        });
    }

    function feeSchedule(bytes32 seed, AssetId settlementAssetId, uint32 settlementAssetVersion)
        internal
        pure
        returns (FeeScheduleDefinition memory)
    {
        return FeeScheduleDefinition({
            namespaceId: _value(seed, "fee.namespace"),
            scheduleKey: _value(seed, "fee.key"),
            feeModelId: FeeScheduleDefinitionLib.FEE_MODEL_MAKER_TAKER,
            settlementAssetId: settlementAssetId,
            settlementAssetVersion: settlementAssetVersion,
            feeRulesHash: _value(seed, "fee.rules"),
            recipientsHash: _value(seed, "fee.recipients"),
            maxChargeRatePpm: FeeRatePpm.wrap(10_000),
            maxRebateRatePpm: FeeRatePpm.wrap(5_000),
            maxFlatChargeBaseUnits: 10e6,
            maxFlatRebateBaseUnits: 5e6,
            evidenceHash: _value(seed, "fee.evidence")
        });
    }

    function riskDomain(
        bytes32 seed,
        AssetId collateralAssetId,
        uint32 collateralAssetVersion,
        AdapterId riskAdapterId,
        uint32 riskAdapterVersion
    ) internal pure returns (RiskDomainDefinition memory) {
        return RiskDomainDefinition({
            namespaceId: _value(seed, "risk.namespace"),
            domainKey: _value(seed, "risk.key"),
            riskModelId: RiskDomainDefinitionLib.RISK_MODEL_ISOLATED_MARGIN,
            collateralAssetId: collateralAssetId,
            collateralAssetVersion: collateralAssetVersion,
            riskAdapterId: riskAdapterId,
            riskAdapterVersion: riskAdapterVersion,
            requiredAdapterKindId: AdapterDefinitionLib.ADAPTER_KIND_RISK,
            requiredInterfaceHash: _value(seed, "adapter.interface"),
            requiredCapabilityHash: _value(seed, "adapter.capability"),
            marginRulesHash: _value(seed, "risk.margin"),
            scenarioSetHash: _value(seed, "risk.scenarios"),
            concentrationRulesHash: _value(seed, "risk.concentration"),
            defaultProcessHash: _value(seed, "risk.default"),
            insurancePolicyHash: _value(seed, "risk.insurance"),
            qualificationEvidenceHash: _value(seed, "risk.evidence"),
            maxOpenInterestBaseUnits: 10_000_000e6,
            maxAggregateLiabilityBaseUnits: 5_000_000e6,
            maxAccountLiabilityBaseUnits: 500_000e6,
            maxAggregateReservationBaseUnits: 2_500_000e6,
            maxAccountReservationBaseUnits: 250_000e6
        });
    }

    function instrument(bytes32 seed, AdapterId payoffModuleId, uint32 payoffModuleVersion, uint64 maxEvaluationGas)
        internal
        pure
        returns (InstrumentDefinition memory)
    {
        return InstrumentDefinition({
            namespaceId: _value(seed, "instrument.namespace"),
            instrumentKey: _value(seed, "instrument.key"),
            payoffFamilyId: payoffFamily(seed),
            settlementClassId: InstrumentDefinitionLib.SETTLEMENT_CLASS_CASH,
            payoffModuleId: payoffModuleId,
            payoffModuleVersion: payoffModuleVersion,
            requiredAdapterKindId: AdapterDefinitionLib.ADAPTER_KIND_PAYOFF,
            requiredInterfaceHash: _value(seed, "adapter.interface"),
            requiredCapabilityHash: _value(seed, "adapter.capability"),
            termsSchemaHash: _value(seed, "instrument.terms-schema"),
            maxFixingSlots: 4,
            maxTermsBytes: 1_024,
            maxEvaluationGas: maxEvaluationGas,
            lifecyclePolicyHash: _value(seed, "instrument.lifecycle"),
            qualificationEvidenceHash: _value(seed, "instrument.evidence")
        });
    }

    function market(bytes32 seed, FixtureMarketDependencies memory dependencies)
        internal
        pure
        returns (MarketDefinition memory)
    {
        return MarketDefinition({
            namespaceId: _value(seed, "market.namespace"),
            marketKey: _value(seed, "market.key"),
            baseAssetId: dependencies.baseAssetId,
            quoteAssetId: dependencies.quoteAssetId,
            settlementAssetId: dependencies.quoteAssetId,
            settlementAssetVersion: dependencies.settlementAssetVersion,
            markBenchmarkId: dependencies.benchmarkId,
            markBenchmarkVersion: dependencies.benchmarkVersion,
            tradingCalendarId: dependencies.calendarId,
            tradingCalendarVersion: dependencies.calendarVersion,
            tradingSessionId: dependencies.sessionId,
            tradingSessionVersion: dependencies.sessionVersion,
            riskDomainId: dependencies.riskDomainId,
            riskDomainVersion: dependencies.riskDomainVersion,
            feeScheduleId: dependencies.feeScheduleId,
            feeScheduleVersion: dependencies.feeScheduleVersion,
            quoteUnitId: MarketDefinitionLib.QUOTE_UNIT_SETTLEMENT_MINOR_PER_LOT,
            tickSizeMinor: TickSizeMinor.wrap(1),
            lotStep: Lots.wrap(1),
            minOrderLots: Lots.wrap(1),
            maxOrderLots: Lots.wrap(1_000_000),
            minPriceTicks: PriceTicks.wrap(type(int64).min),
            maxPriceTicks: PriceTicks.wrap(type(int64).max),
            executionModeSetHash: _value(seed, "market.execution-modes"),
            qualificationEvidenceHash: _value(seed, "market.evidence")
        });
    }

    function series(
        bytes32 seed,
        MarketId marketId,
        uint32 marketVersion,
        InstrumentId instrumentId,
        uint32 instrumentVersion,
        FixtureSeriesSchedule memory schedule
    ) internal pure returns (SeriesDefinition memory) {
        return SeriesDefinition({
            namespaceId: _value(seed, "series.namespace"),
            seriesKey: _value(seed, "series.key"),
            marketId: marketId,
            marketVersion: marketVersion,
            instrumentId: instrumentId,
            instrumentVersion: instrumentVersion,
            tradingStartsAt: schedule.tradingStartsAt,
            lastTradingAt: schedule.lastTradingAt,
            expiryAt: schedule.expiryAt,
            exerciseOpensAt: schedule.exerciseOpensAt,
            exerciseCutoffAt: schedule.exerciseCutoffAt,
            fixingWindowOpen: schedule.fixingWindowOpen,
            fixingWindowClose: schedule.fixingWindowClose,
            primaryEvidenceDeadline: schedule.primaryEvidenceDeadline,
            correctionCutoffAt: schedule.correctionCutoffAt,
            finalResolutionAt: schedule.finalResolutionAt,
            settlementDeadline: schedule.settlementDeadline,
            exercisePolicyId: SeriesDefinitionLib.EXERCISE_POLICY_HOLDER_ELECTION,
            disruptionOutcomeId: SeriesDefinitionLib.DISRUPTION_OUTCOME_FLAT,
            terminalDisruptionTransferMinorPerLot: 0,
            payoffTermsHash: _value(seed, "series.payoff-terms"),
            fixingSlotsHash: _value(seed, "series.fixing-slots"),
            dateAdjustmentEvidenceHash: _value(seed, "series.date-adjustment"),
            maxLongDebitMinorPerLot: 100_000,
            maxShortDebitMinorPerLot: 100_000,
            qualificationEvidenceHash: _value(seed, "series.evidence")
        });
    }

    function datedSchedule(uint64 tradingStartsAt) internal pure returns (FixtureSeriesSchedule memory) {
        return FixtureSeriesSchedule({
            tradingStartsAt: tradingStartsAt,
            lastTradingAt: tradingStartsAt + 1 hours,
            expiryAt: tradingStartsAt + 3 hours,
            exerciseOpensAt: tradingStartsAt + 3 hours,
            exerciseCutoffAt: tradingStartsAt + 4 hours,
            fixingWindowOpen: tradingStartsAt + 2 hours,
            fixingWindowClose: tradingStartsAt + 3 hours,
            primaryEvidenceDeadline: tradingStartsAt + 5 hours,
            correctionCutoffAt: tradingStartsAt + 6 hours,
            finalResolutionAt: tradingStartsAt + 7 hours,
            settlementDeadline: tradingStartsAt + 8 hours
        });
    }

    function payoffFamily(bytes32 seed) internal pure returns (PayoffFamilyId) {
        return PayoffFamilyId.wrap(_value(seed, "instrument.payoff-family"));
    }

    function calendarDay(bytes32 seed, uint32 day) internal pure returns (CalendarDay memory) {
        return CalendarDay({day: day, isBusinessDay: true, evidenceHash: _value(seed, "calendar.day")});
    }

    function seriesQualification(bytes32 seed, SeriesDefinition memory definition, BenchmarkId benchmarkId)
        internal
        pure
        returns (SeriesQualificationData memory qualification)
    {
        qualification.payoffTerms = abi.encode(uint256(1));
        qualification.fixingSlots = new FixingSlot[](1);
        qualification.fixingSlots[0].slot = 0;
        qualification.fixingSlots[0].candidates = new FixingCandidate[](1);
        qualification.fixingSlots[0].candidates[0] = FixingCandidate({
            benchmarkId: benchmarkId,
            benchmarkVersion: 1,
            requiredWindowKindId: SessionDefinitionLib.WINDOW_KIND_FIXING,
            selectionRuleId: SeriesDefinitionLib.FIXING_SELECTION_OFFICIAL,
            targetAt: definition.fixingWindowOpen + 15 minutes,
            windowStartsAt: definition.fixingWindowOpen,
            windowEndsAt: definition.fixingWindowClose - 30 minutes,
            unavailableAfter: definition.fixingWindowClose,
            maxPublicationLagSeconds: 30 minutes,
            minimumObservations: 1,
            maximumObservations: 1,
            selectionParametersHash: _value(seed, "series.fixing-selection")
        });

        qualification.dateProofs = new SeriesDateProof[](11);
        for (
            uint8 rawKind = uint8(SeriesDateKind.TradingStarts);
            rawKind <= uint8(SeriesDateKind.SettlementDeadline);
            ++rawKind
        ) {
            SeriesDateKind kind = SeriesDateKind(rawKind);
            uint64 timestamp = SeriesDefinitionLib.timestampForKind(definition, kind);
            uint256 index = uint256(rawKind) - 1;
            qualification.dateProofs[index].kind = kind;
            qualification.dateProofs[index].conventionId = SeriesDefinitionLib.DATE_ADJUSTMENT_UNADJUSTED;
            qualification.dateProofs[index].scheduledDay = uint32(timestamp / 1 days);
            qualification.dateProofs[index].calendarDays = new CalendarDayProof[](1);
            qualification.dateProofs[index].calendarDays[0].calendarDay = calendarDay(seed, uint32(timestamp / 1 days));
            qualification.dateProofs[index].calendarDays[0].merkleProof = new bytes32[](0);
        }
    }

    function _value(bytes32 seed, string memory field) private pure returns (bytes32) {
        return keccak256(abi.encode("setryn.fixture.v1", seed, field));
    }
}
