// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {IAdapterRegistry} from "../../src/interfaces/IAdapterRegistry.sol";
import {IBenchmarkRegistry} from "../../src/interfaces/IBenchmarkRegistry.sol";
import {ICalendarRegistry} from "../../src/interfaces/ICalendarRegistry.sol";
import {IInstrumentRegistry} from "../../src/interfaces/IInstrumentRegistry.sol";
import {IMarketRegistry} from "../../src/interfaces/IMarketRegistry.sol";
import {IRiskDomainRegistry} from "../../src/interfaces/IRiskDomainRegistry.sol";
import {ISeriesRegistry} from "../../src/interfaces/ISeriesRegistry.sol";
import {ISessionRegistry} from "../../src/interfaces/ISessionRegistry.sol";
import {AdapterDefinitionLib} from "../../src/libraries/AdapterDefinitionLib.sol";
import {InstrumentDefinitionLib} from "../../src/libraries/InstrumentDefinitionLib.sol";
import {MarketDefinitionLib} from "../../src/libraries/MarketDefinitionLib.sol";
import {SeriesDefinitionLib} from "../../src/libraries/SeriesDefinitionLib.sol";
import {SessionDefinitionLib} from "../../src/libraries/SessionDefinitionLib.sol";
import {SeriesRegistry} from "../../src/registry/SeriesRegistry.sol";
import {AdapterDefinition} from "../../src/types/AdapterDefinition.sol";
import {BenchmarkDefinition} from "../../src/types/BenchmarkDefinition.sol";
import {CalendarDay} from "../../src/types/CalendarDefinition.sol";
import {RegistryStatus} from "../../src/types/Enums.sol";
import {
    AdapterId,
    AssetId,
    BenchmarkId,
    BenchmarkKindId,
    CalendarId,
    FeeScheduleId,
    InstrumentId,
    MarketId,
    PayoffFamilyId,
    RiskDomainId,
    SeriesId,
    SessionId
} from "../../src/types/Identifiers.sol";
import {InstrumentDefinition} from "../../src/types/InstrumentDefinition.sol";
import {MarketDefinition} from "../../src/types/MarketDefinition.sol";
import {SeriesDefinition} from "../../src/types/SeriesDefinition.sol";
import {
    CalendarDayProof,
    FixingCandidate,
    FixingSlot,
    SeriesDateKind,
    SeriesDateProof,
    SeriesPayoffValidation,
    SeriesQualificationData
} from "../../src/types/SeriesQualification.sol";
import {Lots, PriceTicks, TickSizeMinor} from "../../src/types/Units.sol";
import {
    SeriesAdapterRegistryMock,
    SeriesBenchmarkRegistryMock,
    SeriesCalendarRegistryMock,
    SeriesInstrumentRegistryMock,
    SeriesMarketRegistryMock,
    SeriesPayoffModuleMock,
    SeriesRiskDomainRegistryMock,
    SeriesSessionRegistryMock
} from "../mocks/SeriesRegistryMocks.sol";

contract SeriesRegistryTest is Test {
    uint64 internal constant NOW = 1_800_000_000;
    uint32 internal constant VERSION = 1;
    uint128 internal constant LONG_DEBIT = 1_000_000;
    uint128 internal constant SHORT_DEBIT = 2_000_000;

    address internal admin = makeAddr("admin");
    address internal qualifier = makeAddr("qualifier");
    address internal statusManager = makeAddr("statusManager");

    AssetId internal baseAssetId = AssetId.wrap(keccak256("asset.base"));
    AssetId internal quoteAssetId = AssetId.wrap(keccak256("asset.quote"));
    BenchmarkId internal benchmarkId = BenchmarkId.wrap(keccak256("benchmark.fixing"));
    CalendarId internal calendarId = CalendarId.wrap(keccak256("calendar"));
    SessionId internal sessionId = SessionId.wrap(keccak256("session"));
    RiskDomainId internal riskDomainId = RiskDomainId.wrap(keccak256("risk"));
    AdapterId internal payoffAdapterId = AdapterId.wrap(keccak256("payoff.adapter"));
    PayoffFamilyId internal payoffFamilyId = PayoffFamilyId.wrap(keccak256("payoff.family"));

    SeriesCalendarRegistryMock internal calendars;
    SeriesSessionRegistryMock internal sessions;
    SeriesBenchmarkRegistryMock internal benchmarks;
    SeriesRiskDomainRegistryMock internal risks;
    SeriesAdapterRegistryMock internal adapters;
    SeriesPayoffModuleMock internal payoff;
    SeriesMarketRegistryMock internal markets;
    SeriesInstrumentRegistryMock internal instruments;
    SeriesRegistry internal registry;
    MarketId internal marketId;
    InstrumentId internal instrumentId;

    function setUp() public {
        vm.warp(NOW);
        calendars = new SeriesCalendarRegistryMock();
        sessions = new SeriesSessionRegistryMock();
        benchmarks = new SeriesBenchmarkRegistryMock();
        risks = new SeriesRiskDomainRegistryMock();
        adapters = new SeriesAdapterRegistryMock();
        payoff = new SeriesPayoffModuleMock();
        payoff.setFamily(payoffFamilyId);
        payoff.setValidation(
            SeriesPayoffValidation({
                maxLongDebitMinorPerLot: LONG_DEBIT,
                maxShortDebitMinorPerLot: SHORT_DEBIT,
                terminalDisruptionTransferMinorPerLot: 0
            })
        );
        adapters.setAdapter(payoffAdapterId, VERSION, _adapterDefinition(address(payoff)), true);

        markets = new SeriesMarketRegistryMock(
            ICalendarRegistry(address(calendars)),
            ISessionRegistry(address(sessions)),
            IBenchmarkRegistry(address(benchmarks)),
            IRiskDomainRegistry(address(risks))
        );
        instruments = new SeriesInstrumentRegistryMock(IAdapterRegistry(address(adapters)));
        marketId = markets.setMarket(_marketDefinition(), VERSION, true, true);
        instrumentId = instruments.setInstrument(_instrumentDefinition(), VERSION, true, true);
        risks.setRiskDomain(riskDomainId, VERSION, quoteAssetId, VERSION, 1_000_000_000, 2_000_000_000);
        benchmarks.setBenchmark(benchmarkId, VERSION, _benchmarkDefinition());

        registry = new SeriesRegistry(
            3 days, admin, IMarketRegistry(address(markets)), IInstrumentRegistry(address(instruments))
        );
        vm.startPrank(admin);
        registry.grantRole(registry.SERIES_QUALIFIER_ROLE(), qualifier);
        registry.grantRole(registry.SERIES_STATUS_MANAGER_ROLE(), statusManager);
        vm.stopPrank();
    }

    function test_RegistrationPublishesBoundedCanonicalQualificationAndLandsPaused() public {
        (SeriesDefinition memory definition, SeriesQualificationData memory qualification) = _qualifiedSeries();

        vm.prank(qualifier);
        (SeriesId seriesId, uint32 version) = registry.registerSeries(definition, qualification);

        assertEq(version, 1);
        assertEq(uint8(registry.statusOf(seriesId, version)), uint8(RegistryStatus.Paused));
        assertTrue(registry.isLifecycleEnabled(seriesId, version));
    }

    function test_ActivationRehashesFreshQualificationData() public {
        (SeriesDefinition memory definition, SeriesQualificationData memory qualification) = _qualifiedSeries();
        vm.prank(qualifier);
        (SeriesId seriesId, uint32 version) = registry.registerSeries(definition, qualification);

        qualification.payoffTerms = abi.encode(uint256(999));
        vm.expectRevert();
        vm.prank(statusManager);
        registry.activateSeries(seriesId, version, qualification);
    }

    function test_RegistrationRejectsOversizeTermsAndMalformedCandidates() public {
        (SeriesDefinition memory definition, SeriesQualificationData memory qualification) = _qualifiedSeries();
        qualification.payoffTerms = new bytes(1_025);
        vm.expectRevert();
        vm.prank(qualifier);
        registry.registerSeries(definition, qualification);

        (definition, qualification) = _qualifiedSeries();
        qualification.fixingSlots[0].candidates[0].windowEndsAt =
        qualification.fixingSlots[0].candidates[0].windowStartsAt;
        vm.expectRevert();
        vm.prank(qualifier);
        registry.registerSeries(definition, qualification);
    }

    function test_RegistrationRejectsPayoffBoundsOrRuntimeDrift() public {
        (SeriesDefinition memory definition, SeriesQualificationData memory qualification) = _qualifiedSeries();
        payoff.setValidation(
            SeriesPayoffValidation({
                maxLongDebitMinorPerLot: LONG_DEBIT + 1,
                maxShortDebitMinorPerLot: SHORT_DEBIT,
                terminalDisruptionTransferMinorPerLot: 0
            })
        );
        vm.expectPartialRevert(ISeriesRegistry.PayoffDebitBoundsMismatch.selector);
        vm.prank(qualifier);
        registry.registerSeries(definition, qualification);

        payoff.setValidation(
            SeriesPayoffValidation({
                maxLongDebitMinorPerLot: LONG_DEBIT,
                maxShortDebitMinorPerLot: SHORT_DEBIT,
                terminalDisruptionTransferMinorPerLot: 0
            })
        );
        adapters.setRuntimeMatches(payoffAdapterId, VERSION, false);
        vm.expectPartialRevert(ISeriesRegistry.PayoffModuleRuntimeMismatch.selector);
        vm.prank(qualifier);
        registry.registerSeries(definition, qualification);
    }

    function test_ActivationRechecksFutureCandidateAndDateHorizons() public {
        (SeriesDefinition memory definition, SeriesQualificationData memory qualification) = _qualifiedSeries();
        vm.prank(qualifier);
        (SeriesId seriesId, uint32 version) = registry.registerSeries(definition, qualification);

        benchmarks.setState(benchmarkId, VERSION, true, true, false);
        vm.expectPartialRevert(ISeriesRegistry.BenchmarkCandidateNotOpen.selector);
        vm.prank(statusManager);
        registry.activateSeries(seriesId, version, qualification);

        benchmarks.setState(benchmarkId, VERSION, true, true, true);
        sessions.setState(true, false);
        vm.expectPartialRevert(ISeriesRegistry.SessionDateNotOpen.selector);
        vm.prank(statusManager);
        registry.activateSeries(seriesId, version, qualification);
    }

    function test_RiskCapsBoundMaximumMarketLots() public {
        (SeriesDefinition memory definition, SeriesQualificationData memory qualification) = _qualifiedSeries();
        risks.setRiskDomain(riskDomainId, VERSION, quoteAssetId, VERSION, 10, 10);

        vm.expectPartialRevert(ISeriesRegistry.SeriesLiabilityExceedsRiskCap.selector);
        vm.prank(qualifier);
        registry.registerSeries(definition, qualification);
    }

    function _qualifiedSeries()
        internal
        view
        returns (SeriesDefinition memory definition, SeriesQualificationData memory qualification)
    {
        definition = _definition();
        qualification.payoffTerms = abi.encode(uint256(1));
        qualification.fixingSlots = _fixingSlots(definition);
        qualification.dateProofs = _dateProofs(definition);
        definition.payoffTermsHash =
            registry.hashPayoffTerms(_instrumentDefinition().termsSchemaHash, qualification.payoffTerms);
        definition.fixingSlotsHash =
            registry.hashFixingSlots(definition, qualification.fixingSlots, _instrumentDefinition().maxFixingSlots);
        definition.dateAdjustmentEvidenceHash = registry.hashDateProofs(definition, qualification.dateProofs);
    }

    function _fixingSlots(SeriesDefinition memory definition) internal view returns (FixingSlot[] memory slots) {
        slots = new FixingSlot[](1);
        slots[0].slot = 0;
        slots[0].candidates = new FixingCandidate[](1);
        slots[0].candidates[0] = FixingCandidate({
            benchmarkId: benchmarkId,
            benchmarkVersion: VERSION,
            requiredWindowKindId: SessionDefinitionLib.WINDOW_KIND_FIXING,
            selectionRuleId: SeriesDefinitionLib.FIXING_SELECTION_OFFICIAL,
            targetAt: definition.fixingWindowOpen + 1 hours,
            windowStartsAt: definition.fixingWindowOpen,
            windowEndsAt: definition.fixingWindowClose - 1 hours,
            unavailableAfter: definition.fixingWindowClose,
            maxPublicationLagSeconds: 3_600,
            minimumObservations: 1,
            maximumObservations: 1,
            selectionParametersHash: keccak256("official.fixing")
        });
    }

    function _dateProofs(SeriesDefinition memory definition) internal pure returns (SeriesDateProof[] memory proofs) {
        proofs = new SeriesDateProof[](9);
        _setDateProof(proofs, 0, SeriesDateKind.TradingStarts, definition.tradingStartsAt);
        _setDateProof(proofs, 1, SeriesDateKind.LastTrading, definition.lastTradingAt);
        _setDateProof(proofs, 2, SeriesDateKind.Expiry, definition.expiryAt);
        _setDateProof(proofs, 3, SeriesDateKind.FixingWindowOpen, definition.fixingWindowOpen);
        _setDateProof(proofs, 4, SeriesDateKind.FixingWindowClose, definition.fixingWindowClose);
        _setDateProof(proofs, 5, SeriesDateKind.PrimaryEvidenceDeadline, definition.primaryEvidenceDeadline);
        _setDateProof(proofs, 6, SeriesDateKind.CorrectionCutoff, definition.correctionCutoffAt);
        _setDateProof(proofs, 7, SeriesDateKind.FinalResolution, definition.finalResolutionAt);
        _setDateProof(proofs, 8, SeriesDateKind.SettlementDeadline, definition.settlementDeadline);
    }

    function _setDateProof(SeriesDateProof[] memory proofs, uint256 index, SeriesDateKind kind, uint64 timestamp)
        internal
        pure
    {
        uint32 day = uint32(timestamp / 1 days);
        proofs[index].kind = kind;
        proofs[index].conventionId = SeriesDefinitionLib.DATE_ADJUSTMENT_UNADJUSTED;
        proofs[index].scheduledDay = day;
        proofs[index].calendarDays = new CalendarDayProof[](1);
        proofs[index].calendarDays[0].calendarDay =
            CalendarDay({day: day, isBusinessDay: true, evidenceHash: keccak256(abi.encode(kind, day))});
        proofs[index].calendarDays[0].merkleProof = new bytes32[](0);
    }

    function _definition() internal view returns (SeriesDefinition memory) {
        return SeriesDefinition({
            namespaceId: keccak256("setryn.series"),
            seriesKey: keccak256("base-quote-capped-forward-dec26"),
            marketId: marketId,
            marketVersion: VERSION,
            instrumentId: instrumentId,
            instrumentVersion: VERSION,
            tradingStartsAt: NOW - 1 days,
            lastTradingAt: NOW + 7 days,
            expiryAt: NOW + 9 days,
            exerciseOpensAt: 0,
            exerciseCutoffAt: 0,
            fixingWindowOpen: NOW + 8 days,
            fixingWindowClose: NOW + 9 days,
            primaryEvidenceDeadline: NOW + 10 days,
            correctionCutoffAt: NOW + 11 days,
            finalResolutionAt: NOW + 12 days,
            settlementDeadline: NOW + 13 days,
            exercisePolicyId: SeriesDefinitionLib.EXERCISE_POLICY_AUTOMATIC,
            disruptionOutcomeId: SeriesDefinitionLib.DISRUPTION_OUTCOME_FLAT,
            terminalDisruptionTransferMinorPerLot: 0,
            payoffTermsHash: bytes32(0),
            fixingSlotsHash: bytes32(0),
            dateAdjustmentEvidenceHash: bytes32(0),
            maxLongDebitMinorPerLot: LONG_DEBIT,
            maxShortDebitMinorPerLot: SHORT_DEBIT,
            qualificationEvidenceHash: keccak256("series.evidence")
        });
    }

    function _marketDefinition() internal view returns (MarketDefinition memory) {
        return MarketDefinition({
            namespaceId: keccak256("setryn.market"),
            marketKey: keccak256("base-quote"),
            baseAssetId: baseAssetId,
            quoteAssetId: quoteAssetId,
            settlementAssetId: quoteAssetId,
            settlementAssetVersion: VERSION,
            markBenchmarkId: benchmarkId,
            markBenchmarkVersion: VERSION,
            tradingCalendarId: calendarId,
            tradingCalendarVersion: VERSION,
            tradingSessionId: sessionId,
            tradingSessionVersion: VERSION,
            riskDomainId: riskDomainId,
            riskDomainVersion: VERSION,
            feeScheduleId: FeeScheduleId.wrap(keccak256("fee")),
            feeScheduleVersion: VERSION,
            quoteUnitId: MarketDefinitionLib.QUOTE_UNIT_SETTLEMENT_MINOR_PER_LOT,
            tickSizeMinor: TickSizeMinor.wrap(10),
            lotStep: Lots.wrap(1),
            minOrderLots: Lots.wrap(1),
            maxOrderLots: Lots.wrap(100),
            minPriceTicks: PriceTicks.wrap(-1_000_000),
            maxPriceTicks: PriceTicks.wrap(1_000_000),
            executionModeSetHash: keccak256("execution.modes"),
            qualificationEvidenceHash: keccak256("market.evidence")
        });
    }

    function _instrumentDefinition() internal view returns (InstrumentDefinition memory) {
        return InstrumentDefinition({
            namespaceId: keccak256("setryn.instrument"),
            instrumentKey: keccak256("capped-forward"),
            payoffFamilyId: payoffFamilyId,
            settlementClassId: InstrumentDefinitionLib.SETTLEMENT_CLASS_CASH,
            payoffModuleId: payoffAdapterId,
            payoffModuleVersion: VERSION,
            requiredAdapterKindId: AdapterDefinitionLib.ADAPTER_KIND_PAYOFF,
            requiredInterfaceHash: keccak256("payoff.interface"),
            requiredCapabilityHash: keccak256("payoff.capability"),
            termsSchemaHash: keccak256("payoff.terms.schema"),
            maxFixingSlots: 4,
            maxTermsBytes: 1_024,
            maxEvaluationGas: 500_000,
            lifecyclePolicyHash: keccak256("lifecycle.policy"),
            qualificationEvidenceHash: keccak256("instrument.evidence")
        });
    }

    function _adapterDefinition(address implementation) internal view returns (AdapterDefinition memory) {
        return AdapterDefinition({
            namespaceId: keccak256("setryn.adapter"),
            referenceId: keccak256("payoff.module"),
            kindId: AdapterDefinitionLib.ADAPTER_KIND_PAYOFF,
            implementation: implementation,
            expectedRuntimeCodeHash: implementation.codehash,
            interfaceHash: keccak256("payoff.interface"),
            capabilityHash: keccak256("payoff.capability"),
            configurationSchemaHash: keccak256("payoff.config"),
            evidenceHash: keccak256("payoff.evidence")
        });
    }

    function _benchmarkDefinition() internal view returns (BenchmarkDefinition memory) {
        return BenchmarkDefinition({
            namespaceId: keccak256("setryn.benchmark"),
            referenceId: keccak256("fixing"),
            kindId: BenchmarkKindId.wrap(keccak256("fixing.kind")),
            baseAssetId: baseAssetId,
            quoteAssetId: quoteAssetId,
            adapterId: AdapterId.wrap(keccak256("oracle.adapter")),
            adapterVersion: VERSION,
            calendarId: calendarId,
            calendarVersion: VERSION,
            sessionId: sessionId,
            sessionVersion: VERSION,
            feedKey: keccak256("feed"),
            requiredInterfaceHash: keccak256("oracle.interface"),
            requiredCapabilityHash: keccak256("oracle.capability"),
            outputDecimals: 8,
            maxStalenessSeconds: 3_600,
            maxFutureSkewSeconds: 60,
            maxConfidenceBps: 100,
            observationRuleHash: keccak256("observation"),
            fallbackPolicyHash: keccak256("fallback"),
            disruptionPolicyHash: keccak256("disruption"),
            dataRightsHash: keccak256("rights"),
            evidenceHash: keccak256("evidence")
        });
    }
}
