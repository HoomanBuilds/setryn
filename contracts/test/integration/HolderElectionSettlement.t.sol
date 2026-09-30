// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {ICashSettlementCoordinator} from "../../src/interfaces/ICashSettlementCoordinator.sol";
import {IExactLotsPayoffModuleV1} from "../../src/interfaces/IExactLotsPayoffModuleV1.sol";
import {IFixingEngine} from "../../src/interfaces/IFixingEngine.sol";
import {IFundedFeeEngine} from "../../src/interfaces/IFundedFeeEngine.sol";
import {IPortfolioRiskEngine} from "../../src/interfaces/IPortfolioRiskEngine.sol";
import {IPositionEngine} from "../../src/interfaces/IPositionEngine.sol";
import {SeriesDefinitionLib} from "../../src/libraries/SeriesDefinitionLib.sol";
import {SettlementLib} from "../../src/libraries/SettlementLib.sol";
import {PositionEngine} from "../../src/position/PositionEngine.sol";
import {CashSettlementCoordinator} from "../../src/settlement/CashSettlementCoordinator.sol";
import {TerminalClaim} from "../../src/types/CollateralTypes.sol";
import {TerminalClaimStatus, TerminalLiabilityReservationStatus} from "../../src/types/Enums.sol";
import {FeeActionRequest} from "../../src/types/FeeEngineTypes.sol";
import {FixingResolutionKind, FixingResult} from "../../src/types/FixingTypes.sol";
import {
    AccountId,
    CollateralId,
    CollateralLockId,
    PositionId,
    SeriesId,
    SettlementId,
    TerminalClaimId,
    TerminalLiabilityReservationId
} from "../../src/types/Identifiers.sol";
import {CanonicalFixing} from "../../src/types/PayoffTypes.sol";
import {
    PositionCreation,
    PositionEconomics,
    PositionFunding,
    PositionLifecycle,
    PositionStatus
} from "../../src/types/PositionTypes.sol";
import {SeriesDefinition} from "../../src/types/SeriesDefinition.sol";
import {FixingSlot, SeriesQualificationData} from "../../src/types/SeriesQualification.sol";
import {CanonicalSettlementFixing, SettlementMode, SettlementRecord} from "../../src/types/SettlementTypes.sol";
import {Lots, PriceTicks} from "../../src/types/Units.sol";
import {LocalSetrynFixture, SetrynLocalFixture} from "../fixtures/SetrynLocalFixture.sol";
import {SettlementFeeEngineMock, SettlementFixingEngineMock} from "../mocks/CashSettlementCoordinatorMocks.sol";
import {PortfolioRiskEngineMock} from "../mocks/PortfolioRiskEngineMock.sol";

/// @notice Holder-election settlement on the real position engine, vault, registries and settlement coordinator.
/// The coordinator is the only holder of the position engine's fixing role, so it must persist final-fixing
/// acceptance, leave the position Live for the holder's election, then record the exercised settlement or lapse the
/// unelected lots permissionlessly, without double settlement against the terminal-disruption path.
/// The fixing engine is a fixture that reports a finalized primary fixing; the fee and risk engines are mocks.
contract HolderElectionSettlementTest is SetrynLocalFixture {
    bytes32 internal constant SEED = keccak256("holder.election.settlement");
    uint128 internal constant DEPOSIT = 1_000_000e6;
    int256 internal constant FIXING_VALUE = 123_456_789;
    uint8 internal constant FIXING_DECIMALS = 8;

    LocalSetrynFixture internal fixture;
    PositionEngine internal engine;
    SettlementFixingEngineMock internal fixingEngine;
    CashSettlementCoordinator internal coordinator;
    address internal shortTrader;
    address internal keeper;
    AccountId internal shortAccount;
    CollateralId internal collateralId;
    uint256 internal fillNonce;

    function setUp() public {
        fixture = _deployLocalFixture(SEED);
        shortTrader = makeAddr("election-short-trader");
        keeper = makeAddr("election-permissionless-keeper");

        vm.prank(shortTrader);
        shortAccount = fixture.collateralVault.createAccount(keccak256("election-short-account"));
        fixture.settlementToken.mint(shortTrader, DEPOSIT);
        vm.startPrank(shortTrader);
        fixture.settlementToken.approve(address(fixture.collateralVault), type(uint256).max);
        fixture.collateralVault.deposit(fixture.settlementAssetId, 1, shortAccount, DEPOSIT);
        vm.stopPrank();

        engine = new PositionEngine(2 days, address(this), fixture.seriesRegistry, fixture.collateralVault);
        fixingEngine = new SettlementFixingEngineMock(address(fixture.seriesRegistry));
        coordinator = new CashSettlementCoordinator(
            IPositionEngine(address(engine)),
            IFixingEngine(address(fixingEngine)),
            IFundedFeeEngine(address(new SettlementFeeEngineMock(address(fixture.collateralVault)))),
            IPortfolioRiskEngine(address(new PortfolioRiskEngineMock(IPositionEngine(address(engine)))))
        );
        // Production role graph: only the coordinator may accept final fixings. The test keeps the lifecycle role
        // to stand in for the lifecycle executor that applies the holder's signed exercise.
        engine.grantRole(engine.FIXING_ENGINE_ROLE(), address(coordinator));
        engine.revokeRole(engine.FIXING_ENGINE_ROLE(), address(this));

        fixture.collateralVault.grantRole(fixture.collateralVault.TERMINAL_RESERVATION_CREATOR_ROLE(), address(engine));
        fixture.collateralVault.grantRole(fixture.collateralVault.TERMINAL_RESERVATION_RESOLVER_ROLE(), address(engine));
        fixture.collateralVault.grantRole(fixture.collateralVault.COLLATERAL_LOCKER_ROLE(), address(engine));
        fixture.collateralVault.grantRole(fixture.collateralVault.COLLATERAL_SETTLER_ROLE(), address(engine));
        vm.prank(fixture.trader);
        fixture.collateralVault.setLockOperator(fixture.traderAccountId, address(engine), true);
        vm.prank(shortTrader);
        fixture.collateralVault.setLockOperator(shortAccount, address(engine), true);

        collateralId = fixture.collateralVault.deriveCollateralId(fixture.settlementAssetId, 1);
        vm.warp(fixture.seriesDefinition.tradingStartsAt);
    }

    function test_NormalSettlementPersistsElectionFixingAndLeavesPositionLive() public {
        PositionId positionId = _openPosition(fixture.seriesId, 3);
        (PositionEconomics memory economics,) = engine.getPosition(positionId);
        _publishFixing(fixture.seriesId);
        vm.warp(economics.exerciseOpensAt);

        bytes32 fixingsHash = _expectedFixingsHash(fixture.seriesId);
        vm.expectEmit(address(coordinator));
        emit ICashSettlementCoordinator.HolderElectionFixingAccepted(
            positionId,
            fixingsHash,
            keccak256(_encodedFixings()),
            economics.exerciseOpensAt,
            economics.exerciseCutoffAt,
            keeper
        );
        assertEq(SettlementId.unwrap(_finalizeNormal(positionId)), bytes32(0), "election pending records nothing");

        (, PositionLifecycle memory lifecycle) = engine.getPosition(positionId);
        assertEq(uint8(lifecycle.status), uint8(PositionStatus.Live), "position awaits election");
        assertEq(lifecycle.finalFixingReference, fixingsHash, "fixing acceptance persisted");
        assertEq(lifecycle.finalFixingsHash, keccak256(_encodedFixings()));
        assertEq(Lots.unwrap(lifecycle.remainingLots), 3);
        assertEq(SettlementId.unwrap(coordinator.settlementOf(positionId)), bytes32(0));
        _assertReservation(economics.longReservationId, TerminalLiabilityReservationStatus.Active);
        _assertReservation(economics.shortReservationId, TerminalLiabilityReservationStatus.Active);

        // Repeats inside the window fail loudly instead of re-running fixing transitions.
        vm.expectRevert(
            abi.encodeWithSelector(
                ICashSettlementCoordinator.HolderElectionPending.selector, positionId, economics.exerciseCutoffAt
            )
        );
        _finalizeNormal(positionId);

        // Nobody can push the awaiting position back into Fixing to block the holder's election.
        vm.prank(keeper);
        vm.expectRevert(
            abi.encodeWithSelector(
                IPositionEngine.InvalidPositionTransition.selector,
                positionId,
                PositionStatus.Live,
                PositionStatus.Fixing
            )
        );
        engine.beginFixing(positionId);

        // The lapse path stays closed through the inclusive cutoff.
        vm.warp(economics.exerciseCutoffAt);
        vm.prank(keeper);
        vm.expectRevert();
        coordinator.finalizeLapsedPosition(positionId, new FeeActionRequest[](0));
    }

    function test_HolderExerciseInWindowSettlesPayoffAndReleasesCollateral() public {
        PositionId positionId = _openPosition(fixture.seriesId, 3);
        (PositionEconomics memory economics,) = engine.getPosition(positionId);
        _acceptElectionFixing(positionId, economics);

        vm.warp(economics.exerciseCutoffAt);
        _exercise(positionId, 3, 30_000);
        (, PositionLifecycle memory lifecycle) = engine.getPosition(positionId);
        assertEq(uint8(lifecycle.status), uint8(PositionStatus.Settled));

        uint128 shortReserved = _reserved(economics.shortReservationId);
        uint128 longReserved = _reserved(economics.longReservationId);
        SettlementRecord memory record = coordinator.getSettlement(_finalizeNormal(positionId));
        assertEq(uint8(record.mode), uint8(SettlementMode.Normal));
        assertEq(record.fixingsHash, _expectedFixingsHash(fixture.seriesId));
        assertEq(record.positionOutcomeReference, lifecycle.terminalOutcomeReference);
        assertEq(record.terminalTransferMinor, 30_000);
        assertEq(record.terminalAmount, 30_000);
        assertEq(AccountId.unwrap(record.payerAccountId), AccountId.unwrap(shortAccount));
        assertEq(AccountId.unwrap(record.receiverAccountId), AccountId.unwrap(fixture.traderAccountId));
        assertEq(record.shortCollateral.claimAmount, 30_000);
        assertEq(record.shortCollateral.releasedAmount, shortReserved - 30_000);
        assertEq(record.longCollateral.claimAmount, 0);
        assertEq(record.longCollateral.releasedAmount, longReserved);

        _fulfillAndWithdraw(record.shortCollateral.claimId, 30_000);
    }

    /// The lifecycle executor already finalizes both reservations when it applies the exercise; the coordinator must
    /// accept those terminal reservations idempotently, and no later path may settle the position again.
    function test_ExerciseWithExecutorFinalizedReservationsIsRecordedOnce() public {
        PositionId positionId = _openPosition(fixture.seriesId, 2);
        (PositionEconomics memory economics,) = engine.getPosition(positionId);
        _acceptElectionFixing(positionId, economics);

        _exercise(positionId, 2, -12_345);
        uint128 longReserved = _reserved(economics.longReservationId);
        TerminalClaimId claimId =
            fixture.collateralVault.finalizeTerminalLiabilityReservation(economics.longReservationId);
        fixture.collateralVault.finalizeTerminalLiabilityReservation(economics.shortReservationId);

        SettlementId settlementId = _finalizeNormal(positionId);
        SettlementRecord memory record = coordinator.getSettlement(settlementId);
        assertEq(uint8(record.mode), uint8(SettlementMode.Normal));
        assertEq(record.terminalTransferMinor, -12_345);
        assertEq(TerminalClaimId.unwrap(record.longCollateral.claimId), TerminalClaimId.unwrap(claimId));
        assertEq(record.longCollateral.claimAmount, 12_345);
        assertEq(record.longCollateral.releasedAmount, longReserved - 12_345);
        assertEq(uint8(record.shortCollateral.status), uint8(TerminalLiabilityReservationStatus.ReleasedAtTerminal));

        // Replays return the same record; the lapse path cannot reopen it; the disruption path returns it too.
        assertEq(SettlementId.unwrap(_finalizeNormal(positionId)), SettlementId.unwrap(settlementId));
        vm.warp(economics.exerciseCutoffAt + 1);
        vm.prank(keeper);
        assertEq(
            SettlementId.unwrap(coordinator.finalizeLapsedPosition(positionId, new FeeActionRequest[](0))),
            SettlementId.unwrap(settlementId)
        );
        vm.warp(economics.finalResolutionAt);
        vm.prank(keeper);
        assertEq(
            SettlementId.unwrap(
                coordinator.finalizeTerminalDisruption(
                    positionId, fixture.seriesQualification.fixingSlots, new FeeActionRequest[](0)
                )
            ),
            SettlementId.unwrap(settlementId)
        );

        vm.prank(keeper);
        coordinator.fulfillClaim(claimId);
        _withdrawAll(fixture.trader, fixture.traderAccountId, DEPOSIT - 12_345);
        _withdrawAll(shortTrader, shortAccount, DEPOSIT + 12_345);
    }

    function test_UnelectedLotsLapsePermissionlesslyAfterCutoff() public {
        PositionId positionId = _openPosition(fixture.seriesId, 3);
        (PositionEconomics memory economics,) = engine.getPosition(positionId);
        _acceptElectionFixing(positionId, economics);
        uint128 longReserved = _reserved(economics.longReservationId);
        uint128 shortReserved = _reserved(economics.shortReservationId);

        vm.warp(economics.exerciseCutoffAt + 1);
        SettlementId settlementId = _finalizeNormal(positionId);
        SettlementRecord memory record = coordinator.getSettlement(settlementId);
        assertEq(uint8(record.mode), uint8(SettlementMode.Lapsed));
        assertEq(record.fixingsHash, _expectedFixingsHash(fixture.seriesId));
        assertEq(record.terminalTransferMinor, 0);
        assertEq(record.terminalAmount, 0);
        assertEq(record.longCollateral.releasedAmount, longReserved);
        assertEq(record.shortCollateral.releasedAmount, shortReserved);

        (, PositionLifecycle memory lifecycle) = engine.getPosition(positionId);
        assertEq(uint8(lifecycle.status), uint8(PositionStatus.Lapsed));
        assertEq(Lots.unwrap(lifecycle.remainingLots), 0);
        assertEq(Lots.unwrap(lifecycle.closedLots), 3);

        // No double settlement through the terminal fallback.
        vm.warp(economics.finalResolutionAt);
        vm.prank(keeper);
        assertEq(
            SettlementId.unwrap(
                coordinator.finalizeTerminalDisruption(
                    positionId, fixture.seriesQualification.fixingSlots, new FeeActionRequest[](0)
                )
            ),
            SettlementId.unwrap(settlementId)
        );
        _withdrawAll(fixture.trader, fixture.traderAccountId, DEPOSIT);
        _withdrawAll(shortTrader, shortAccount, DEPOSIT);
    }

    /// With no final fixing ever accepted (for example still in dispute), unelected lots still lapse after the cutoff
    /// without any fixing witness.
    function test_LapseWithoutAcceptedFixingThroughFinalizeLapsedPosition() public {
        PositionId positionId = _openPosition(fixture.seriesId, 2);
        (PositionEconomics memory economics,) = engine.getPosition(positionId);
        vm.warp(economics.fixingWindowOpen);
        vm.prank(keeper);
        engine.beginFixing(positionId);

        vm.warp(economics.exerciseCutoffAt + 1);
        vm.prank(keeper);
        SettlementId settlementId = coordinator.finalizeLapsedPosition(positionId, new FeeActionRequest[](0));
        SettlementRecord memory record = coordinator.getSettlement(settlementId);
        assertEq(uint8(record.mode), uint8(SettlementMode.Lapsed));
        assertEq(record.terminalTransferMinor, 0);
        assertEq(uint8(engine.positionStatus(positionId)), uint8(PositionStatus.Lapsed));
        _assertReservation(economics.longReservationId, TerminalLiabilityReservationStatus.ReleasedAtTerminal);
        _assertReservation(economics.shortReservationId, TerminalLiabilityReservationStatus.ReleasedAtTerminal);
        _withdrawAll(fixture.trader, fixture.traderAccountId, DEPOSIT);
        _withdrawAll(shortTrader, shortAccount, DEPOSIT);
    }

    /// Exercised lots keep their payoff; the unelected remainder lapses to zero after the cutoff.
    function test_PartialExerciseThenLapseSettlesExercisedLotsOnly() public {
        PositionId positionId = _openPosition(fixture.seriesId, 3);
        (PositionEconomics memory economics,) = engine.getPosition(positionId);
        _acceptElectionFixing(positionId, economics);
        _exercise(positionId, 1, 10_000);

        vm.expectRevert(
            abi.encodeWithSelector(
                ICashSettlementCoordinator.HolderElectionPending.selector, positionId, economics.exerciseCutoffAt
            )
        );
        _finalizeNormal(positionId);

        vm.warp(economics.exerciseCutoffAt + 1);
        SettlementRecord memory record = coordinator.getSettlement(_finalizeNormal(positionId));
        assertEq(uint8(record.mode), uint8(SettlementMode.Normal));
        assertEq(record.terminalTransferMinor, 10_000);
        assertEq(record.shortCollateral.claimAmount, 10_000);
        (, PositionLifecycle memory lifecycle) = engine.getPosition(positionId);
        assertEq(uint8(lifecycle.status), uint8(PositionStatus.Settled));
        assertEq(Lots.unwrap(lifecycle.exercisedLots), 1);
        assertEq(Lots.unwrap(lifecycle.closedLots), 2);

        _fulfillAndWithdraw(record.shortCollateral.claimId, 10_000);
    }

    /// If nobody lapses the position before final resolution, the terminal fallback still resolves the accepted but
    /// unelected position: its lots lapse instead of taking the disruption transfer.
    function test_TerminalDisruptionStillResolvesAwaitingElectionPosition() public {
        PositionId positionId = _openPosition(fixture.seriesId, 3);
        (PositionEconomics memory economics,) = engine.getPosition(positionId);
        _acceptElectionFixing(positionId, economics);

        vm.warp(economics.finalResolutionAt);
        vm.expectRevert(
            abi.encodeWithSelector(
                ICashSettlementCoordinator.NormalSettlementClosed.selector,
                economics.finalResolutionAt,
                economics.finalResolutionAt
            )
        );
        _finalizeNormal(positionId);
        vm.expectRevert(
            abi.encodeWithSelector(
                IPositionEngine.FinalResolutionReached.selector,
                positionId,
                economics.finalResolutionAt,
                economics.finalResolutionAt
            )
        );
        engine.lapseUnelectedLots(positionId);

        vm.prank(keeper);
        SettlementId settlementId = coordinator.finalizeTerminalDisruption(
            positionId, fixture.seriesQualification.fixingSlots, new FeeActionRequest[](0)
        );
        SettlementRecord memory record = coordinator.getSettlement(settlementId);
        assertEq(uint8(record.mode), uint8(SettlementMode.TerminalDisruption));
        assertEq(record.terminalTransferMinor, 0);
        vm.prank(keeper);
        assertEq(
            SettlementId.unwrap(coordinator.finalizeLapsedPosition(positionId, new FeeActionRequest[](0))),
            SettlementId.unwrap(settlementId)
        );
        _withdrawAll(fixture.trader, fixture.traderAccountId, DEPOSIT);
        _withdrawAll(shortTrader, shortAccount, DEPOSIT);
    }

    /// Automatic-unless-abandoned below its threshold lapses at fixing acceptance. Normal settlement records that
    /// lapse instead of reverting and rolling the acceptance back.
    function test_AutomaticUnlessAbandonedBelowThresholdLapsesThroughNormalSettlement() public {
        SeriesId seriesId = _registerAutomaticUnlessAbandonedSeries(1_000);
        PositionId positionId = _openPosition(seriesId, 2);
        (PositionEconomics memory economics,) = engine.getPosition(positionId);
        _publishFixing(seriesId);
        vm.warp(economics.exerciseCutoffAt + 1);
        _mockPayoff(2, 999);

        SettlementRecord memory record = coordinator.getSettlement(_finalizeNormal(positionId));
        assertEq(uint8(record.mode), uint8(SettlementMode.Lapsed));
        assertEq(record.terminalTransferMinor, 0);
        assertEq(uint8(engine.positionStatus(positionId)), uint8(PositionStatus.Lapsed));
        _withdrawAll(fixture.trader, fixture.traderAccountId, DEPOSIT);
        _withdrawAll(shortTrader, shortAccount, DEPOSIT);
    }

    function _acceptElectionFixing(PositionId positionId, PositionEconomics memory economics) internal {
        _publishFixing(economics.seriesId);
        vm.warp(economics.exerciseOpensAt);
        assertEq(SettlementId.unwrap(_finalizeNormal(positionId)), bytes32(0));
        assertEq(uint8(engine.positionStatus(positionId)), uint8(PositionStatus.Live));
    }

    function _exercise(PositionId positionId, uint128 lots, int256 transfer) internal {
        _mockPayoff(lots, transfer);
        (, PositionLifecycle memory lifecycle) = engine.getPosition(positionId);
        engine.exercisePositionQuantity(
            positionId,
            Lots.wrap(lots),
            fixture.traderAccountId,
            lifecycle.lifecycleNonce,
            lifecycle.finalFixingReference,
            _encodedFixings()
        );
    }

    function _mockPayoff(uint128 lots, int256 transfer) internal {
        vm.mockCall(
            address(fixture.adapterImplementation),
            abi.encodeCall(
                IExactLotsPayoffModuleV1.evaluatePositionLots,
                (fixture.seriesQualification.payoffTerms, _encodedFixings(), lots)
            ),
            abi.encode(transfer)
        );
    }

    function _finalizeNormal(PositionId positionId) internal returns (SettlementId) {
        vm.prank(keeper);
        return coordinator.finalizeNormalSettlement(
            positionId, fixture.seriesQualification.fixingSlots, new FeeActionRequest[](0)
        );
    }

    function _publishFixing(SeriesId seriesId) internal {
        fixingEngine.setResult(seriesId, 1, 0, _fixingResult());
    }

    function _fixingResult() internal view returns (FixingResult memory) {
        return FixingResult({
            resultHash: keccak256("holder.election.fixing"),
            proposalHash: keccak256("holder.election.proposal"),
            resolutionKind: FixingResolutionKind.PrimaryFinal,
            effectiveAt: fixture.seriesDefinition.correctionCutoffAt,
            finalizedAt: fixture.seriesDefinition.correctionCutoffAt,
            finalizedBlock: 1,
            candidateIndex: 0,
            decimals: FIXING_DECIMALS,
            value: FIXING_VALUE,
            terminalDisruptionTransferMinorPerLot: 0
        });
    }

    function _expectedFixingsHash(SeriesId seriesId) internal view returns (bytes32) {
        FixingResult memory result = _fixingResult();
        CanonicalSettlementFixing[] memory fixings = new CanonicalSettlementFixing[](1);
        fixings[0] = CanonicalSettlementFixing({
            fixingKey: fixingEngine.deriveFixingKey(seriesId, 1, 0),
            resultHash: result.resultHash,
            resolutionKind: result.resolutionKind,
            value: result.value,
            terminalDisruptionTransferMinorPerLot: 0,
            effectiveAt: result.effectiveAt,
            slot: 0,
            decimals: result.decimals
        });
        return SettlementLib.hashFixings(fixings);
    }

    function _encodedFixings() internal view returns (bytes memory) {
        FixingSlot memory slot = fixture.seriesQualification.fixingSlots[0];
        CanonicalFixing[] memory fixings = new CanonicalFixing[](1);
        fixings[0] = CanonicalFixing({
            slot: 0,
            benchmarkId: slot.candidates[0].benchmarkId,
            benchmarkVersion: slot.candidates[0].benchmarkVersion,
            decimals: FIXING_DECIMALS,
            value: FIXING_VALUE
        });
        return abi.encode(fixings);
    }

    function _reserved(TerminalLiabilityReservationId reservationId) internal view returns (uint128) {
        return fixture.collateralVault.terminalLiabilityReservationOf(reservationId).remainingAmount;
    }

    function _assertReservation(TerminalLiabilityReservationId reservationId, TerminalLiabilityReservationStatus status)
        internal
        view
    {
        assertEq(uint8(fixture.collateralVault.terminalLiabilityReservationStatusOf(reservationId)), uint8(status));
    }

    function _fulfillAndWithdraw(TerminalClaimId claimId, uint128 amount) internal {
        vm.prank(keeper);
        coordinator.fulfillClaim(claimId);
        TerminalClaim memory claim = fixture.collateralVault.terminalClaimOf(claimId);
        assertEq(uint8(claim.status), uint8(TerminalClaimStatus.Fulfilled));
        assertEq(claim.amount, amount);
        _withdrawAll(fixture.trader, fixture.traderAccountId, DEPOSIT + amount);
        _withdrawAll(shortTrader, shortAccount, DEPOSIT - amount);
    }

    function _withdrawAll(address controller, AccountId accountId, uint128 expectedTotal) internal {
        (uint128 total, uint128 locked, uint128 available) = fixture.collateralVault.balanceOf(accountId, collateralId);
        assertEq(locked, 0, "no collateral may stay locked after terminal resolution");
        assertEq(total, expectedTotal);
        assertEq(available, total);
        vm.prank(controller);
        fixture.collateralVault.withdraw(fixture.settlementAssetId, 1, accountId, total, controller);
    }

    function _openPosition(SeriesId seriesId, uint128 lots) internal returns (PositionId positionId) {
        fillNonce += 1;
        PositionFunding memory unfunded = PositionFunding({
            lockId: CollateralLockId.wrap(bytes32(0)),
            lockReference: bytes32(0),
            expectedRemainingAmount: 0,
            expectedExpiry: 0
        });
        positionId = engine.createPosition(
            PositionCreation({
                fillIdentity: keccak256(abi.encode("election.fill", fillNonce)),
                seriesId: seriesId,
                seriesVersion: 1,
                longAccountId: fixture.traderAccountId,
                shortAccountId: shortAccount,
                ordinal: 0,
                lots: Lots.wrap(lots),
                entryPriceTicks: PriceTicks.wrap(100),
                longFunding: unfunded,
                shortFunding: unfunded,
                payoffTerms: fixture.seriesQualification.payoffTerms
            })
        );
    }

    function _registerAutomaticUnlessAbandonedSeries(uint128 threshold) internal returns (SeriesId seriesId) {
        SeriesDefinition memory definition = fixture.seriesDefinition;
        definition.seriesKey = keccak256("holder.election.aua.series");
        definition.exercisePolicyId = SeriesDefinitionLib.EXERCISE_POLICY_AUTOMATIC_UNLESS_ABANDONED;
        definition.automaticExerciseThresholdMinor = threshold;
        SeriesQualificationData memory qualification = fixture.seriesQualification;
        definition.fixingSlotsHash = fixture.seriesRegistry.hashFixingSlots(definition, qualification.fixingSlots, 4);
        definition.dateAdjustmentEvidenceHash =
            fixture.seriesRegistry.hashDateProofs(definition, qualification.dateProofs);
        (seriesId,) = fixture.seriesRegistry.registerSeries(definition, qualification);
        fixture.seriesRegistry.activateSeries(seriesId, 1, qualification);
    }
}
