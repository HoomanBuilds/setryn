// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {IAdapterRegistry} from "../../src/interfaces/IAdapterRegistry.sol";
import {IBenchmarkRegistry} from "../../src/interfaces/IBenchmarkRegistry.sol";
import {IFixingEngine} from "../../src/interfaces/IFixingEngine.sol";
import {IMarketRegistry} from "../../src/interfaces/IMarketRegistry.sol";
import {ISeriesRegistry} from "../../src/interfaces/ISeriesRegistry.sol";
import {AdapterDefinitionLib} from "../../src/libraries/AdapterDefinitionLib.sol";
import {SeriesDefinitionLib} from "../../src/libraries/SeriesDefinitionLib.sol";
import {FixingEngine} from "../../src/fixing/FixingEngine.sol";
import {AdapterDefinition} from "../../src/types/AdapterDefinition.sol";
import {BenchmarkDefinition} from "../../src/types/BenchmarkDefinition.sol";
import {
    FixingResolutionKind,
    FixingResult,
    FixingStatus,
    HistoricalObservation,
    SequencerEvidence
} from "../../src/types/FixingTypes.sol";
import {
    AdapterId,
    AssetId,
    BenchmarkId,
    BenchmarkKindId,
    CalendarId,
    DisruptionOutcomeId,
    EvidenceOriginId,
    ExercisePolicyId,
    InstrumentId,
    MarketId,
    SeriesId,
    SessionId,
    WindowKindId
} from "../../src/types/Identifiers.sol";
import {SeriesDefinition} from "../../src/types/SeriesDefinition.sol";
import {FixingCandidate, FixingSlot} from "../../src/types/SeriesQualification.sol";
import {
    FixingAdapterRegistryMock,
    FixingBenchmarkRegistryMock,
    FixingMarketRegistryMock,
    FixingObservationAdapterMock,
    FixingSeriesRegistryMock
} from "../mocks/FixingEngineMocks.sol";

contract FixingEngineTest is Test {
    uint32 internal constant VERSION = 1;
    uint64 internal constant WINDOW_START = 1_000;
    uint64 internal constant WINDOW_END = 2_000;
    uint64 internal constant PRIMARY_DEADLINE = 2_500;
    uint64 internal constant CORRECTION_CUTOFF = 3_000;
    uint64 internal constant FINAL_RESOLUTION = 4_000;
    bytes32 internal constant CAPABILITY_HASH = keccak256("fixing.capability");

    FixingObservationAdapterMock internal observationAdapter;
    FixingAdapterRegistryMock internal adapters;
    FixingBenchmarkRegistryMock internal benchmarks;
    FixingMarketRegistryMock internal markets;
    FixingSeriesRegistryMock internal seriesRegistry;
    FixingEngine internal engine;
    AdapterId internal adapterId;
    BenchmarkId internal benchmarkId;
    SeriesId internal seriesId;

    function setUp() public {
        observationAdapter = new FixingObservationAdapterMock();
        adapters = new FixingAdapterRegistryMock();
        adapterId = adapters.setAdapter(_adapterDefinition(), VERSION, true, true);
        benchmarks = new FixingBenchmarkRegistryMock(IAdapterRegistry(address(adapters)));
        benchmarkId = benchmarks.setBenchmark(_benchmarkDefinition(), VERSION, true);
        markets = new FixingMarketRegistryMock(IBenchmarkRegistry(address(benchmarks)));
        seriesRegistry = new FixingSeriesRegistryMock(IMarketRegistry(address(markets)));

        FixingSlot[] memory slots = _officialSlots();
        SeriesDefinition memory definition = _seriesDefinition();
        definition.fixingSlotsHash = seriesRegistry.hashFixingSlots(definition, slots);
        seriesId = seriesRegistry.setSeries(definition, VERSION, true);
        engine = new FixingEngine(ISeriesRegistry(address(seriesRegistry)));
        observationAdapter.configure(_origin("L2_STATE"), 1, true, false);
    }

    function test_HistoricalEvidenceUsesPublicationLagNotCurrentSpotAge() public {
        vm.warp(2_300);
        HistoricalObservation[] memory observations = _singleObservation(1_100, 1_150);

        engine.submitEvidence(seriesId, VERSION, _officialSlots(), 0, 0, observations, hex"1234");

        assertEq(uint8(engine.fixingStatus(seriesId, VERSION, 0)), uint8(FixingStatus.Proposed));
        assertEq(engine.getProposal(seriesId, VERSION, 0).value, 100_000_000);
    }

    function test_RejectsWindowEndFuturePublicationAndExcessLag() public {
        vm.warp(2_300);
        HistoricalObservation[] memory observations = _singleObservation(WINDOW_END, WINDOW_END);
        vm.expectPartialRevert(IFixingEngine.ObservationOutsideWindow.selector);
        engine.submitEvidence(seriesId, VERSION, _officialSlots(), 0, 0, observations, hex"01");

        observations = _singleObservation(2_200, 2_301);
        vm.expectPartialRevert(IFixingEngine.FutureObservationPublication.selector);
        engine.submitEvidence(seriesId, VERSION, _officialSlots(), 0, 0, observations, hex"02");

        observations = _singleObservation(1_100, 1_201);
        vm.expectPartialRevert(IFixingEngine.PublicationLagExceeded.selector);
        engine.submitEvidence(seriesId, VERSION, _officialSlots(), 0, 0, observations, hex"03");
    }

    function test_CorrectionRequiresNewSequenceAndStrictCutoff() public {
        vm.warp(2_300);
        HistoricalObservation[] memory observations = _singleObservation(1_100, 1_150);
        engine.submitEvidence(seriesId, VERSION, _officialSlots(), 0, 0, observations, hex"01");

        engine.submitEvidence(seriesId, VERSION, _officialSlots(), 0, 0, observations, hex"02");
        assertEq(uint8(engine.fixingStatus(seriesId, VERSION, 0)), uint8(FixingStatus.Disputed));

        observationAdapter.configure(_origin("L2_STATE"), 2, true, false);
        engine.submitEvidence(seriesId, VERSION, _officialSlots(), 0, 0, observations, hex"03");
        assertEq(uint8(engine.fixingStatus(seriesId, VERSION, 0)), uint8(FixingStatus.Proposed));
        assertEq(engine.getProposal(seriesId, VERSION, 0).batchSequence, 2);

        vm.warp(CORRECTION_CUTOFF);
        observationAdapter.configure(_origin("L2_STATE"), 3, true, false);
        vm.expectPartialRevert(IFixingEngine.CorrectionWindowClosed.selector);
        engine.submitEvidence(seriesId, VERSION, _officialSlots(), 0, 0, observations, hex"04");
    }

    function test_InitialEvidenceIsRejectedAtCorrectionCutoff() public {
        vm.warp(CORRECTION_CUTOFF);
        vm.expectPartialRevert(IFixingEngine.CorrectionWindowClosed.selector);
        engine.submitEvidence(seriesId, VERSION, _officialSlots(), 0, 0, _singleObservation(1_100, 1_150), hex"01");
    }

    function test_SequencerRulesRejectL2AndDelayOutageIndependentEvidence() public {
        vm.warp(2_300);
        HistoricalObservation[] memory observations = _singleObservation(1_100, 1_150);
        observations[0].sequencer.sequencerUp = false;
        observations[0].sequencer.recoveryGraceEndsAt = 2_350;

        vm.expectPartialRevert(IFixingEngine.InvalidL2StateDuringSequencerOutage.selector);
        engine.submitEvidence(seriesId, VERSION, _officialSlots(), 0, 0, observations, hex"01");

        observationAdapter.configure(_origin("EXTERNAL_SIGNED"), 1, true, true);
        vm.expectPartialRevert(IFixingEngine.SequencerRecoveryGraceActive.selector);
        engine.submitEvidence(seriesId, VERSION, _officialSlots(), 0, 0, observations, hex"02");

        vm.warp(2_350);
        engine.submitEvidence(seriesId, VERSION, _officialSlots(), 0, 0, observations, hex"03");
        assertEq(uint8(engine.fixingStatus(seriesId, VERSION, 0)), uint8(FixingStatus.Proposed));
    }

    function test_FallbackCandidateOpensOnlyAfterPrecedingDeadline() public {
        HistoricalObservation[] memory observations = _singleObservation(1_100, 1_150);
        vm.warp(2_599);
        vm.expectPartialRevert(IFixingEngine.CandidateNotYetAvailable.selector);
        engine.submitEvidence(seriesId, VERSION, _officialSlots(), 0, 1, observations, hex"01");

        vm.warp(2_600);
        engine.submitEvidence(seriesId, VERSION, _officialSlots(), 0, 1, observations, hex"02");
        assertEq(engine.getProposal(seriesId, VERSION, 0).candidateIndex, 1);

        vm.warp(CORRECTION_CUTOFF);
        FixingResult memory result = engine.finalizeFixing(seriesId, VERSION, 0);
        assertEq(uint8(result.resolutionKind), uint8(FixingResolutionKind.FallbackFinal));
    }

    function test_NormalFinalizationIsPermissionlessBoundedAndImmutable() public {
        vm.warp(2_300);
        engine.submitEvidence(seriesId, VERSION, _officialSlots(), 0, 0, _singleObservation(1_100, 1_150), hex"01");

        vm.warp(CORRECTION_CUTOFF);
        FixingResult memory result = engine.finalizeFixing(seriesId, VERSION, 0);
        assertEq(uint8(result.resolutionKind), uint8(FixingResolutionKind.PrimaryFinal));
        assertEq(result.effectiveAt, CORRECTION_CUTOFF);
        assertEq(result.value, 100_000_000);

        vm.expectPartialRevert(IFixingEngine.FixingAlreadyFinalized.selector);
        engine.finalizeFixing(seriesId, VERSION, 0);
    }

    function test_TerminalFallbackIgnoresPausedDependenciesAndUsesPrecommittedOutcome() public {
        vm.warp(FINAL_RESOLUTION);
        FixingResult memory result = engine.applyTerminalFallback(seriesId, VERSION, 0);

        assertEq(uint8(result.resolutionKind), uint8(FixingResolutionKind.TerminalDisruption));
        assertEq(result.effectiveAt, FINAL_RESOLUTION);
        assertEq(result.terminalDisruptionTransferMinorPerLot, -500);
    }

    function test_IncompleteSelectionAndAdapterFailureDoNotMutateState() public {
        vm.warp(2_300);
        observationAdapter.configure(_origin("L2_STATE"), 1, false, false);
        vm.expectPartialRevert(IFixingEngine.IncompleteObservationSelection.selector);
        engine.submitEvidence(seriesId, VERSION, _officialSlots(), 0, 0, _singleObservation(1_100, 1_150), hex"01");
        assertEq(uint8(engine.fixingStatus(seriesId, VERSION, 0)), uint8(FixingStatus.Unspecified));

        observationAdapter.setShouldRevert(true);
        vm.expectPartialRevert(IFixingEngine.AdapterCallFailed.selector);
        engine.submitEvidence(seriesId, VERSION, _officialSlots(), 0, 0, _singleObservation(1_100, 1_150), hex"02");
    }

    function _singleObservation(uint64 observedAt, uint64 publishedAt)
        internal
        pure
        returns (HistoricalObservation[] memory observations)
    {
        observations = new HistoricalObservation[](1);
        observations[0] = HistoricalObservation({
            value: 100_000_000,
            weight: 0,
            observedAt: observedAt,
            publishedAt: publishedAt,
            providerSequence: 10,
            confidenceBps: 10,
            decimals: 8,
            finalityReference: keccak256("finality"),
            itemEvidenceHash: keccak256("item.evidence"),
            sequencer: SequencerEvidence({
                sequencerUp: true,
                inRecoveryGrace: false,
                recoveryGraceEndsAt: 0,
                proofHash: keccak256("sequencer.proof")
            })
        });
    }

    function _officialSlots() internal view returns (FixingSlot[] memory slots) {
        slots = new FixingSlot[](1);
        slots[0].slot = 0;
        slots[0].candidates = new FixingCandidate[](2);
        slots[0].candidates[0] = FixingCandidate({
            benchmarkId: benchmarkId,
            benchmarkVersion: VERSION,
            requiredWindowKindId: _windowKind(),
            selectionRuleId: SeriesDefinitionLib.FIXING_SELECTION_OFFICIAL,
            targetAt: 1_500,
            windowStartsAt: WINDOW_START,
            windowEndsAt: WINDOW_END,
            unavailableAfter: 2_600,
            maxPublicationLagSeconds: 100,
            minimumObservations: 1,
            maximumObservations: 1,
            selectionParametersHash: keccak256("official.selection")
        });
        slots[0].candidates[1] = FixingCandidate({
            benchmarkId: benchmarkId,
            benchmarkVersion: VERSION,
            requiredWindowKindId: _observationWindowKind(),
            selectionRuleId: SeriesDefinitionLib.FIXING_SELECTION_OFFICIAL,
            targetAt: 1_500,
            windowStartsAt: WINDOW_START,
            windowEndsAt: WINDOW_END,
            unavailableAfter: 3_500,
            maxPublicationLagSeconds: 100,
            minimumObservations: 1,
            maximumObservations: 1,
            selectionParametersHash: keccak256("fallback.selection")
        });
    }

    function _seriesDefinition() internal pure returns (SeriesDefinition memory) {
        return SeriesDefinition({
            namespaceId: keccak256("setryn"),
            seriesKey: keccak256("series"),
            marketId: MarketId.wrap(keccak256("market")),
            marketVersion: VERSION,
            instrumentId: InstrumentId.wrap(keccak256("instrument")),
            instrumentVersion: VERSION,
            tradingStartsAt: 100,
            lastTradingAt: 900,
            expiryAt: WINDOW_END,
            exerciseOpensAt: 0,
            exerciseCutoffAt: 0,
            fixingWindowOpen: WINDOW_START,
            fixingWindowClose: WINDOW_END,
            primaryEvidenceDeadline: PRIMARY_DEADLINE,
            correctionCutoffAt: CORRECTION_CUTOFF,
            finalResolutionAt: FINAL_RESOLUTION,
            settlementDeadline: 5_000,
            exercisePolicyId: ExercisePolicyId.wrap(keccak256("SetrynExercisePolicyV1:Automatic")),
            automaticExerciseThresholdMinor: 0,
            disruptionOutcomeId: DisruptionOutcomeId.wrap(keccak256("SetrynDisruptionOutcomeV1:PrecommittedValue")),
            terminalDisruptionTransferMinorPerLot: -500,
            payoffTermsHash: keccak256("terms"),
            fixingSlotsHash: bytes32(uint256(1)),
            dateAdjustmentEvidenceHash: keccak256("dates"),
            maxLongDebitMinorPerLot: 1_000,
            maxShortDebitMinorPerLot: 2_000,
            qualificationEvidenceHash: keccak256("series.evidence")
        });
    }

    function _adapterDefinition() internal view returns (AdapterDefinition memory) {
        return AdapterDefinition({
            namespaceId: keccak256("setryn"),
            referenceId: keccak256("fixing.adapter"),
            kindId: AdapterDefinitionLib.ADAPTER_KIND_BENCHMARK,
            implementation: address(observationAdapter),
            expectedRuntimeCodeHash: address(observationAdapter).codehash,
            interfaceHash: keccak256("SetrynFixingObservationAdapterV1.validateObservationBatch"),
            capabilityHash: CAPABILITY_HASH,
            configurationSchemaHash: keccak256("adapter.config"),
            evidenceHash: keccak256("adapter.evidence")
        });
    }

    function _benchmarkDefinition() internal view returns (BenchmarkDefinition memory) {
        return BenchmarkDefinition({
            namespaceId: keccak256("setryn"),
            referenceId: keccak256("btc.usd.fixing"),
            kindId: BenchmarkKindId.wrap(keccak256("SetrynBenchmarkKindV1:SettlementFixing")),
            baseAssetId: AssetId.wrap(keccak256("btc")),
            quoteAssetId: AssetId.wrap(keccak256("usd")),
            adapterId: adapterId,
            adapterVersion: VERSION,
            calendarId: CalendarId.wrap(keccak256("calendar")),
            calendarVersion: VERSION,
            sessionId: SessionId.wrap(keccak256("session")),
            sessionVersion: VERSION,
            feedKey: keccak256("feed"),
            requiredInterfaceHash: keccak256("SetrynFixingObservationAdapterV1.validateObservationBatch"),
            requiredCapabilityHash: CAPABILITY_HASH,
            outputDecimals: 8,
            maxStalenessSeconds: 60,
            maxFutureSkewSeconds: 0,
            maxConfidenceBps: 100,
            observationRuleHash: keccak256("observation.rule"),
            fallbackPolicyHash: keccak256("fallback"),
            disruptionPolicyHash: keccak256("disruption"),
            dataRightsHash: keccak256("rights"),
            evidenceHash: keccak256("benchmark.evidence")
        });
    }

    function _origin(string memory name) internal pure returns (EvidenceOriginId) {
        return EvidenceOriginId.wrap(keccak256(abi.encodePacked("SetrynEvidenceOriginV1:", name)));
    }

    function _windowKind() internal pure returns (WindowKindId) {
        return WindowKindId.wrap(keccak256("SetrynWindowKindV1:Fixing"));
    }

    function _observationWindowKind() internal pure returns (WindowKindId) {
        return WindowKindId.wrap(keccak256("SetrynWindowKindV1:Observation"));
    }
}
