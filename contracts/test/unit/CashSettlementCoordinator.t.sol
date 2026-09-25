// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {ICollateralVault} from "../../src/interfaces/ICollateralVault.sol";
import {ICashSettlementCoordinator} from "../../src/interfaces/ICashSettlementCoordinator.sol";
import {IFixingEngine} from "../../src/interfaces/IFixingEngine.sol";
import {IFundedFeeEngine} from "../../src/interfaces/IFundedFeeEngine.sol";
import {IPositionEngine} from "../../src/interfaces/IPositionEngine.sol";
import {CashSettlementCoordinator} from "../../src/settlement/CashSettlementCoordinator.sol";
import {SeriesDefinitionLib} from "../../src/libraries/SeriesDefinitionLib.sol";
import {TerminalLiabilityReservation} from "../../src/types/CollateralTypes.sol";
import {TerminalLiabilityReservationStatus, TerminalOutcomeKind} from "../../src/types/Enums.sol";
import {FeeActionRequest} from "../../src/types/FeeEngineTypes.sol";
import {FixingResolutionKind, FixingResult} from "../../src/types/FixingTypes.sol";
import {
    AccountId,
    AdapterId,
    AdapterKindId,
    AssetId,
    BenchmarkId,
    CalendarId,
    CollateralId,
    DisruptionOutcomeId,
    ExercisePolicyId,
    FeeScheduleId,
    InstrumentId,
    MarketId,
    PayoffFamilyId,
    PositionId,
    QuoteUnitId,
    RiskDomainId,
    SeriesId,
    SettlementId,
    SessionId,
    SettlementClassId,
    TerminalClaimId,
    TerminalLiabilityReservationId,
    WindowKindId
} from "../../src/types/Identifiers.sol";
import {InstrumentDefinition, InstrumentVersion} from "../../src/types/InstrumentDefinition.sol";
import {MarketDefinition, MarketVersion} from "../../src/types/MarketDefinition.sol";
import {PositionEconomics} from "../../src/types/PositionTypes.sol";
import {SettlementMode, SettlementRecord} from "../../src/types/SettlementTypes.sol";
import {SeriesDefinition, SeriesVersion} from "../../src/types/SeriesDefinition.sol";
import {FixingCandidate, FixingSelectionRuleId, FixingSlot} from "../../src/types/SeriesQualification.sol";
import {Lots, PriceTicks, TickSizeMinor} from "../../src/types/Units.sol";
import {
    SettlementCollateralVaultMock,
    SettlementFeeEngineMock,
    SettlementFixingEngineMock,
    SettlementInstrumentRegistryMock,
    SettlementMarketRegistryMock,
    SettlementPositionEngineMock,
    SettlementSeriesRegistryMock
} from "../mocks/CashSettlementCoordinatorMocks.sol";

contract CashSettlementCoordinatorTest is Test {
    uint32 internal constant VERSION = 1;
    uint64 internal constant FINAL_RESOLUTION = 4_000;
    AccountId internal constant LONG = AccountId.wrap(bytes32(uint256(1)));
    AccountId internal constant SHORT = AccountId.wrap(bytes32(uint256(2)));
    AssetId internal constant ASSET = AssetId.wrap(keccak256("usdc"));

    SettlementInstrumentRegistryMock internal instruments;
    SettlementMarketRegistryMock internal markets;
    SettlementSeriesRegistryMock internal seriesRegistry;
    SettlementCollateralVaultMock internal vault;
    SettlementPositionEngineMock internal positions;
    SettlementFixingEngineMock internal fixings;
    SettlementFeeEngineMock internal fees;
    CashSettlementCoordinator internal coordinator;
    PositionId internal positionId;
    SeriesId internal seriesId;

    function setUp() public {
        instruments = new SettlementInstrumentRegistryMock();
        markets = new SettlementMarketRegistryMock();
        seriesRegistry = new SettlementSeriesRegistryMock(address(instruments), address(markets));
        vault = new SettlementCollateralVaultMock();
        positions = new SettlementPositionEngineMock(address(seriesRegistry), address(vault));
        fixings = new SettlementFixingEngineMock(address(seriesRegistry));
        fees = new SettlementFeeEngineMock(address(vault));

        InstrumentId instrumentId = instruments.setInstrument(_instrument(), VERSION);
        MarketId marketId = MarketId.wrap(markets.setMarket(_market(), VERSION));
        bytes memory terms = abi.encode(uint256(7));
        SeriesDefinition memory definition = _series(marketId, instrumentId, terms);
        FixingSlot[] memory slotWitness = _slots(definition);
        definition.fixingSlotsHash = seriesRegistry.hashFixingSlots(definition, slotWitness, 16);
        seriesId = seriesRegistry.setSeries(definition, VERSION);
        SeriesVersion memory seriesRecord = seriesRegistry.getSeries(seriesId, VERSION);
        InstrumentVersion memory instrumentRecord = instruments.getInstrument(instrumentId, VERSION);
        MarketVersion memory marketRecord = markets.getMarket(MarketId.unwrap(marketId), VERSION);
        positionId = PositionId.wrap(keccak256("position"));
        PositionEconomics memory economics =
            _economics(seriesRecord, instrumentRecord, marketRecord, positionId, seriesId, instrumentId, marketId);
        positions.seed(economics, terms, 10);
        _seedReservation(economics.longReservationId, economics.longLiabilityKey, LONG, economics, 100);
        _seedReservation(economics.shortReservationId, economics.shortLiabilityKey, SHORT, economics, 100);

        fixings.setResult(
            seriesId,
            VERSION,
            0,
            FixingResult({
                resultHash: keccak256("fixing.result"),
                proposalHash: keccak256("proposal"),
                resolutionKind: FixingResolutionKind.PrimaryFinal,
                effectiveAt: 3_000,
                finalizedAt: 3_000,
                finalizedBlock: 1,
                candidateIndex: 0,
                decimals: 8,
                value: 100_000_000,
                terminalDisruptionTransferMinorPerLot: 0
            })
        );
        coordinator = new CashSettlementCoordinator(
            IPositionEngine(address(positions)), IFixingEngine(address(fixings)), IFundedFeeEngine(address(fees))
        );
    }

    function test_NormalSettlementCreatesBackedClaimAndIsIdempotent() public {
        vm.warp(3_500);
        FeeActionRequest[] memory noFees = new FeeActionRequest[](0);
        FixingSlot[] memory slotWitness = _currentSlots();

        bytes32 settlementId =
            SettlementId.unwrap(coordinator.finalizeNormalSettlement(positionId, slotWitness, noFees));
        SettlementRecord memory record = coordinator.getSettlement(SettlementId.wrap(settlementId));

        assertEq(uint8(record.mode), uint8(SettlementMode.Normal));
        assertEq(record.terminalTransferMinor, 10);
        assertEq(record.terminalAmount, 10);
        assertEq(TerminalClaimId.unwrap(record.shortCollateral.claimId) != bytes32(0), true);
        assertEq(record.shortCollateral.claimAmount, 10);
        assertEq(record.shortCollateral.releasedAmount, 90);
        assertEq(
            SettlementId.unwrap(coordinator.finalizeNormalSettlement(positionId, slotWitness, noFees)), settlementId
        );

        coordinator.fulfillClaim(record.shortCollateral.claimId);
        coordinator.fulfillClaim(record.shortCollateral.claimId);
    }

    function test_FinalBoundaryUsesPrecommittedDisruptionNotEarlierNormalFixing() public {
        vm.warp(FINAL_RESOLUTION);
        FeeActionRequest[] memory noFees = new FeeActionRequest[](0);
        FixingSlot[] memory slotWitness = _currentSlots();

        SettlementId settlementId = coordinator.finalizeTerminalDisruption(positionId, slotWitness, noFees);
        SettlementRecord memory record = coordinator.getSettlement(settlementId);

        assertEq(uint8(record.mode), uint8(SettlementMode.TerminalDisruption));
        assertEq(record.terminalTransferMinor, -5);
        assertEq(record.terminalAmount, 5);
        assertEq(record.longCollateral.claimAmount, 5);
    }

    function test_NormalSettlementRejectsAtFinalBoundary() public {
        vm.warp(FINAL_RESOLUTION);
        vm.expectPartialRevert(ICashSettlementCoordinator.NormalSettlementClosed.selector);
        coordinator.finalizeNormalSettlement(positionId, _currentSlots(), new FeeActionRequest[](0));
    }

    function test_LapsedPositionReleasesBothReservationsOnlyAfterObjectiveLifecycleState() public {
        positions.setLapsed(positionId, keccak256("lapsed"));

        SettlementId settlementId = coordinator.finalizeLapsedPosition(positionId, new FeeActionRequest[](0));
        SettlementRecord memory record = coordinator.getSettlement(settlementId);

        assertEq(uint8(record.mode), uint8(SettlementMode.Lapsed));
        assertEq(record.terminalTransferMinor, 0);
        assertEq(record.longCollateral.releasedAmount, 100);
        assertEq(record.shortCollateral.releasedAmount, 100);
    }

    function _instrument() private pure returns (InstrumentDefinition memory) {
        return InstrumentDefinition({
            namespaceId: keccak256("setryn"),
            instrumentKey: keccak256("cash"),
            payoffFamilyId: PayoffFamilyId.wrap(keccak256("linear")),
            settlementClassId: SettlementClassId.wrap(keccak256("SetrynSettlementClassV1:Cash")),
            payoffModuleId: AdapterId.wrap(keccak256("payoff")),
            payoffModuleVersion: VERSION,
            requiredAdapterKindId: AdapterKindId.wrap(keccak256("SetrynAdapterKindV1:Payoff")),
            requiredInterfaceHash: keccak256("interface"),
            requiredCapabilityHash: keccak256("capability"),
            termsSchemaHash: keccak256("terms.schema"),
            maxFixingSlots: 16,
            maxTermsBytes: 4_096,
            maxEvaluationGas: 500_000,
            lifecyclePolicyHash: keccak256("lifecycle"),
            qualificationEvidenceHash: keccak256("instrument.evidence")
        });
    }

    function _market() private pure returns (MarketDefinition memory) {
        return MarketDefinition({
            namespaceId: keccak256("setryn"),
            marketKey: keccak256("btc.usdc"),
            baseAssetId: AssetId.wrap(keccak256("btc")),
            quoteAssetId: ASSET,
            settlementAssetId: ASSET,
            settlementAssetVersion: VERSION,
            markBenchmarkId: BenchmarkId.wrap(keccak256("mark")),
            markBenchmarkVersion: VERSION,
            tradingCalendarId: CalendarId.wrap(keccak256("calendar")),
            tradingCalendarVersion: VERSION,
            tradingSessionId: SessionId.wrap(keccak256("session")),
            tradingSessionVersion: VERSION,
            riskDomainId: RiskDomainId.wrap(keccak256("risk")),
            riskDomainVersion: VERSION,
            feeScheduleId: FeeScheduleId.wrap(keccak256("fee")),
            feeScheduleVersion: VERSION,
            quoteUnitId: QuoteUnitId.wrap(keccak256("SetrynQuoteUnitV1:SettlementMinorPerLot")),
            tickSizeMinor: TickSizeMinor.wrap(1),
            lotStep: Lots.wrap(1),
            minOrderLots: Lots.wrap(1),
            maxOrderLots: Lots.wrap(1_000),
            minPriceTicks: PriceTicks.wrap(-1_000_000),
            maxPriceTicks: PriceTicks.wrap(1_000_000),
            executionModeSetHash: keccak256("execution.modes"),
            qualificationEvidenceHash: keccak256("market.evidence")
        });
    }

    function _series(MarketId marketId, InstrumentId instrumentId, bytes memory terms)
        private
        view
        returns (SeriesDefinition memory)
    {
        return SeriesDefinition({
            namespaceId: keccak256("setryn"),
            seriesKey: keccak256("series"),
            marketId: marketId,
            marketVersion: VERSION,
            instrumentId: instrumentId,
            instrumentVersion: VERSION,
            tradingStartsAt: 100,
            lastTradingAt: 900,
            expiryAt: 2_000,
            exerciseOpensAt: 0,
            exerciseCutoffAt: 0,
            fixingWindowOpen: 1_000,
            fixingWindowClose: 2_000,
            primaryEvidenceDeadline: 2_500,
            correctionCutoffAt: 3_000,
            finalResolutionAt: FINAL_RESOLUTION,
            settlementDeadline: 5_000,
            exercisePolicyId: ExercisePolicyId.wrap(keccak256("automatic")),
            disruptionOutcomeId: DisruptionOutcomeId.wrap(keccak256("precommitted")),
            terminalDisruptionTransferMinorPerLot: -5,
            payoffTermsHash: seriesRegistry.hashPayoffTerms(keccak256("terms.schema"), terms),
            fixingSlotsHash: bytes32(uint256(1)),
            dateAdjustmentEvidenceHash: keccak256("dates"),
            maxLongDebitMinorPerLot: 100,
            maxShortDebitMinorPerLot: 100,
            qualificationEvidenceHash: keccak256("series.evidence")
        });
    }

    function _slots(SeriesDefinition memory definition) private pure returns (FixingSlot[] memory result) {
        result = new FixingSlot[](1);
        result[0].slot = 0;
        result[0].candidates = new FixingCandidate[](1);
        result[0].candidates[0] = FixingCandidate({
            benchmarkId: BenchmarkId.wrap(keccak256("fixing")),
            benchmarkVersion: VERSION,
            requiredWindowKindId: WindowKindId.wrap(keccak256("SetrynWindowKindV1:Fixing")),
            selectionRuleId: FixingSelectionRuleId.wrap(keccak256("SetrynFixingSelectionRuleV1:Official")),
            targetAt: 1_500,
            windowStartsAt: definition.fixingWindowOpen,
            windowEndsAt: definition.fixingWindowClose,
            unavailableAfter: 2_600,
            maxPublicationLagSeconds: 100,
            minimumObservations: 1,
            maximumObservations: 1,
            selectionParametersHash: keccak256("official")
        });
    }

    function _currentSlots() private view returns (FixingSlot[] memory) {
        return _slots(seriesRegistry.getSeries(seriesId, VERSION).definition);
    }

    function _economics(
        SeriesVersion memory series,
        InstrumentVersion memory instrument,
        MarketVersion memory market,
        PositionId id,
        SeriesId exactSeriesId,
        InstrumentId instrumentId,
        MarketId marketId
    ) private pure returns (PositionEconomics memory economics) {
        economics.positionId = id;
        economics.fillIdentity = keccak256("fill");
        economics.seriesId = exactSeriesId;
        economics.seriesVersionHash = series.versionHash;
        economics.marketId = marketId;
        economics.instrumentId = instrumentId;
        economics.longAccountId = LONG;
        economics.shortAccountId = SHORT;
        economics.payoffModuleId = instrument.definition.payoffModuleId;
        economics.payoffModule = address(0x1234);
        economics.payoffModuleCodeHash = keccak256("code");
        economics.settlementAssetId = market.definition.settlementAssetId;
        economics.riskDomainId = market.definition.riskDomainId;
        economics.feeScheduleId = market.definition.feeScheduleId;
        economics.payoffTermsHash = series.definition.payoffTermsHash;
        economics.fixingSlotsHash = series.definition.fixingSlotsHash;
        economics.seriesVersion = VERSION;
        economics.marketVersion = VERSION;
        economics.instrumentVersion = VERSION;
        economics.payoffModuleVersion = VERSION;
        economics.settlementAssetVersion = VERSION;
        economics.riskDomainVersion = VERSION;
        economics.feeScheduleVersion = VERSION;
        economics.fixingWindowOpen = series.definition.fixingWindowOpen;
        economics.finalResolutionAt = series.definition.finalResolutionAt;
        economics.settlementDeadline = series.definition.settlementDeadline;
        economics.maxEvaluationGas = instrument.definition.maxEvaluationGas;
        economics.lots = Lots.wrap(1);
        economics.entryPriceTicks = PriceTicks.wrap(100);
        economics.maxLongDebitMinorPerLot = 100;
        economics.maxShortDebitMinorPerLot = 100;
        economics.maxLongDebitMinor = 100;
        economics.maxShortDebitMinor = 100;
        economics.terminalDisruptionTransferMinorPerLot = -5;
        economics.longLiabilityKey = keccak256("long.liability");
        economics.shortLiabilityKey = keccak256("short.liability");
        economics.longReservationId = TerminalLiabilityReservationId.wrap(keccak256("long.reservation"));
        economics.shortReservationId = TerminalLiabilityReservationId.wrap(keccak256("short.reservation"));
    }

    function _seedReservation(
        TerminalLiabilityReservationId id,
        bytes32 liabilityKey,
        AccountId payer,
        PositionEconomics memory economics,
        uint128 amount
    ) private {
        vault.seedReservation(
            id,
            TerminalLiabilityReservation({
                positionId: liabilityKey,
                positionEngineId: positions.positionEngineId(),
                positionEngineCodeHash: address(positions).codehash,
                payerAccountId: payer,
                collateralId: CollateralId.wrap(keccak256("collateral")),
                assetId: ASSET,
                riskDomainId: economics.riskDomainId,
                creator: address(this),
                positionEngine: address(positions),
                terminalOutcomeReference: bytes32(0),
                terminalAccountId: AccountId.wrap(bytes32(0)),
                bindingVersion: VERSION,
                riskDomainVersion: VERSION,
                settlementDeadline: 5_000,
                finalResolutionAt: FINAL_RESOLUTION,
                status: TerminalLiabilityReservationStatus.Active,
                terminalOutcome: TerminalOutcomeKind.Unspecified,
                initialAmount: amount,
                remainingAmount: amount,
                terminalAmount: 0
            })
        );
    }
}
