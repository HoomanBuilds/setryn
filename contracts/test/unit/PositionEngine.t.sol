// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {IPositionEngine} from "../../src/interfaces/IPositionEngine.sol";
import {IPortfolioRiskEngine} from "../../src/interfaces/IPortfolioRiskEngine.sol";
import {IExactLotsPayoffModuleV1} from "../../src/interfaces/IExactLotsPayoffModuleV1.sol";
import {PositionLifecycleExecutor} from "../../src/lifecycle/PositionLifecycleExecutor.sol";
import {SeriesDefinitionLib} from "../../src/libraries/SeriesDefinitionLib.sol";
import {PositionEngine} from "../../src/position/PositionEngine.sol";
import {CollateralLock, TerminalLiabilityReservation} from "../../src/types/CollateralTypes.sol";
import {LockStatus, TerminalLiabilityReservationStatus, TerminalOutcomeKind} from "../../src/types/Enums.sol";
import {
    AccountId,
    CollateralId,
    CollateralLockId,
    PackageId,
    PositionId,
    SeriesId,
    TerminalLiabilityReservationId
} from "../../src/types/Identifiers.sol";
import {
    PositionCreation,
    PositionEconomics,
    PositionFunding,
    PositionLifecycle,
    PositionLiabilitySide,
    PositionProvenance,
    PositionStatus
} from "../../src/types/PositionTypes.sol";
import {CompressionPosition} from "../../src/types/CompressionTypes.sol";
import {SeriesDefinition} from "../../src/types/SeriesDefinition.sol";
import {SeriesDateProof, SeriesQualificationData} from "../../src/types/SeriesQualification.sol";
import {
    LifecycleAction,
    LifecycleActionId,
    LifecycleActionKind,
    LifecycleCollateralReplacement,
    LifecycleInput,
    LifecyclePositionSnapshot,
    LifecycleSuccessor
} from "../../src/types/LifecycleTypes.sol";
import {Lots, PriceTicks} from "../../src/types/Units.sol";
import {LocalSetrynFixture, SetrynLocalFixture} from "../fixtures/SetrynLocalFixture.sol";
import {PortfolioRiskEngineMock} from "../mocks/PortfolioRiskEngineMock.sol";

contract PositionEngineTest is SetrynLocalFixture {
    bytes32 internal constant SEED = keccak256("position.engine.unit");
    bytes32 internal constant FILL = keccak256("fill.one");
    bytes32 internal constant FIXING = keccak256("fixing.one");

    LocalSetrynFixture internal fixture;
    PositionEngine internal engine;
    address internal shortTrader;
    address internal outsider;
    AccountId internal shortAccount;

    function setUp() public {
        fixture = _deployLocalFixture(SEED);
        shortTrader = makeAddr("short-trader");
        outsider = makeAddr("outsider");
        vm.prank(shortTrader);
        shortAccount = fixture.collateralVault.createAccount(keccak256("short-account"));
        fixture.settlementToken.mint(shortTrader, 1_000_000e6);
        vm.startPrank(shortTrader);
        fixture.settlementToken.approve(address(fixture.collateralVault), type(uint256).max);
        fixture.collateralVault.deposit(fixture.settlementAssetId, 1, shortAccount, 1_000_000e6);
        vm.stopPrank();

        engine = new PositionEngine(2 days, address(this), fixture.seriesRegistry, fixture.collateralVault);
        fixture.collateralVault.grantRole(fixture.collateralVault.TERMINAL_RESERVATION_CREATOR_ROLE(), address(engine));
        fixture.collateralVault.grantRole(fixture.collateralVault.TERMINAL_RESERVATION_RESOLVER_ROLE(), address(engine));
        fixture.collateralVault.grantRole(fixture.collateralVault.COLLATERAL_LOCKER_ROLE(), address(engine));
        fixture.collateralVault.grantRole(fixture.collateralVault.COLLATERAL_SETTLER_ROLE(), address(engine));

        vm.prank(fixture.trader);
        fixture.collateralVault.setLockOperator(fixture.traderAccountId, address(engine), true);
        vm.prank(shortTrader);
        fixture.collateralVault.setLockOperator(shortAccount, address(engine), true);
        vm.warp(fixture.seriesDefinition.tradingStartsAt);
    }

    function test_CreatePinsEconomicsAndBothFundedReservationsBeforeLive() public {
        PositionId positionId = engine.createPosition(_creation(FILL, 0, 2));
        (PositionEconomics memory economics, PositionLifecycle memory lifecycle) = engine.getPosition(positionId);

        assertEq(uint8(lifecycle.status), uint8(PositionStatus.Live));
        assertEq(economics.seriesVersionHash, fixture.seriesRegistry.getSeries(fixture.seriesId, 1).versionHash);
        assertEq(economics.maxLongDebitMinor, 200_000);
        assertEq(economics.maxShortDebitMinor, 200_000);
        assertEq(keccak256(engine.payoffTerms(positionId)), keccak256(fixture.seriesQualification.payoffTerms));
        _assertReservation(economics.longReservationId, economics.longLiabilityKey, fixture.traderAccountId, 200_000);
        _assertReservation(economics.shortReservationId, economics.shortLiabilityKey, shortAccount, 200_000);
    }

    function test_CreateAdoptsExactPretradeLockWithoutReleaseGap() public {
        bytes32 lockReference = keccak256("position.pretrade.long");
        uint64 expiry = uint64(block.timestamp + 1 days);
        CollateralLockId lockId = engine.createPositionFundingLock(
            lockReference, fixture.traderAccountId, fixture.settlementAssetId, 1, 100_000, expiry
        );
        PositionCreation memory creation = _creation(FILL, 0, 1);
        creation.longFunding = PositionFunding({
            lockId: lockId, lockReference: lockReference, expectedRemainingAmount: 100_000, expectedExpiry: expiry
        });

        PositionId positionId = engine.createPosition(creation);
        (PositionEconomics memory economics,) = engine.getPosition(positionId);
        CollateralLock memory converted = fixture.collateralVault.getLock(lockId);

        assertEq(uint8(converted.status), uint8(LockStatus.Consumed));
        assertEq(converted.remainingAmount, 0);
        _assertReservation(economics.longReservationId, economics.longLiabilityKey, fixture.traderAccountId, 100_000);
    }

    function test_CreateRejectsAdoptionWhenExpectedRemainingIsStale() public {
        bytes32 lockReference = keccak256("position.pretrade.stale");
        uint64 expiry = uint64(block.timestamp + 1 days);
        CollateralLockId lockId = engine.createPositionFundingLock(
            lockReference, fixture.traderAccountId, fixture.settlementAssetId, 1, 100_000, expiry
        );
        PositionCreation memory creation = _creation(FILL, 0, 1);
        creation.longFunding = PositionFunding({
            lockId: lockId, lockReference: lockReference, expectedRemainingAmount: 99_999, expectedExpiry: expiry
        });

        PositionId positionId = engine.derivePositionId(creation);
        bytes32 longLiabilityKey = engine.deriveLiabilityKey(positionId, uint8(PositionLiabilitySide.Long));
        vm.expectRevert(
            abi.encodeWithSelector(IPositionEngine.PositionFundingMismatch.selector, longLiabilityKey, lockId)
        );
        engine.createPosition(creation);
    }

    function test_ReplayAndUnauthorizedCreationAreRejected() public {
        PositionCreation memory creation = _creation(FILL, 0, 1);
        vm.prank(outsider);
        vm.expectRevert();
        engine.createPosition(creation);

        PositionId positionId = engine.createPosition(creation);
        vm.expectRevert(abi.encodeWithSelector(IPositionEngine.PositionAlreadyExists.selector, positionId));
        engine.createPosition(creation);
    }

    function test_PausedDependencyDoesNotDeadlockHistoricalFixingAndSettlement() public {
        SeriesId automaticSeriesId = _registerAutomaticExerciseSeries();
        PositionId positionId = engine.createPosition(_creationFor(automaticSeriesId, FILL, 0, 2));
        fixture.adapterRegistry.pauseAdapter(fixture.payoffAdapterId, 1);
        vm.warp(fixture.seriesDefinition.fixingWindowOpen);
        engine.beginFixing(positionId);

        bytes memory finalFixings = abi.encode(int256(10_000));
        vm.mockCall(
            address(fixture.adapterImplementation),
            abi.encodeCall(
                IExactLotsPayoffModuleV1.evaluatePositionLots,
                (fixture.seriesQualification.payoffTerms, finalFixings, uint128(2))
            ),
            abi.encode(int256(50_000))
        );
        engine.acceptFinalFixing(positionId, FIXING, finalFixings);
        engine.settle(positionId);

        (PositionEconomics memory economics, PositionLifecycle memory lifecycle) = engine.getPosition(positionId);
        assertEq(uint8(lifecycle.status), uint8(PositionStatus.Settled));
        assertEq(lifecycle.terminalTransferMinor, 50_000);
        assertEq(uint8(engine.terminalState(economics.shortLiabilityKey).outcome), uint8(TerminalOutcomeKind.Payout));
        assertEq(
            AccountId.unwrap(engine.terminalState(economics.shortLiabilityKey).receiverAccountId),
            AccountId.unwrap(fixture.traderAccountId)
        );
        assertEq(engine.terminalState(economics.shortLiabilityKey).amount, 50_000);
        assertEq(uint8(engine.terminalState(economics.longLiabilityKey).outcome), uint8(TerminalOutcomeKind.Flat));
    }

    function test_PayoffAboveStoredDebitBoundCannotBecomeSettlementReady() public {
        SeriesId automaticSeriesId = _registerAutomaticExerciseSeries();
        PositionId positionId = engine.createPosition(_creationFor(automaticSeriesId, FILL, 0, 1));
        vm.warp(fixture.seriesDefinition.fixingWindowOpen);
        engine.beginFixing(positionId);
        bytes memory finalFixings = abi.encode(int256(1));
        vm.mockCall(
            address(fixture.adapterImplementation),
            abi.encodeCall(
                IExactLotsPayoffModuleV1.evaluatePositionLots,
                (fixture.seriesQualification.payoffTerms, finalFixings, uint128(1))
            ),
            abi.encode(int256(100_001))
        );
        (PositionEconomics memory economics,) = engine.getPosition(positionId);

        vm.expectRevert(
            abi.encodeWithSelector(
                IPositionEngine.PayoffOutsideDebitBounds.selector,
                int256(100_001),
                economics.maxLongDebitMinorPerLot,
                economics.maxShortDebitMinorPerLot
            )
        );
        engine.acceptFinalFixing(positionId, FIXING, finalFixings);
        assertEq(uint8(engine.positionStatus(positionId)), uint8(PositionStatus.Fixing));
    }

    function test_FinalResolutionFallbackIsPermissionlessAndObjective() public {
        PositionId positionId = engine.createPosition(_creation(FILL, 0, 3));
        vm.warp(fixture.seriesDefinition.finalResolutionAt);
        vm.prank(outsider);
        engine.applyTerminalFallback(positionId);

        (PositionEconomics memory economics, PositionLifecycle memory lifecycle) = engine.getPosition(positionId);
        assertEq(uint8(lifecycle.status), uint8(PositionStatus.Settled));
        assertEq(lifecycle.terminalTransferMinor, 0);
        assertTrue(lifecycle.terminalOutcomeReference != bytes32(0));
        assertEq(uint8(engine.terminalState(economics.longLiabilityKey).outcome), uint8(TerminalOutcomeKind.Flat));
        assertEq(uint8(engine.terminalState(economics.shortLiabilityKey).outcome), uint8(TerminalOutcomeKind.Flat));

        vm.expectRevert(
            abi.encodeWithSelector(
                IPositionEngine.InvalidPositionTransition.selector,
                positionId,
                PositionStatus.Settled,
                PositionStatus.TerminalClaim
            )
        );
        engine.applyTerminalFallback(positionId);
    }

    function test_ZeroLiabilityAlternativeIsTerminalAndReplayGuarded() public {
        PositionId positionId = engine.createPosition(_creation(FILL, 0, 1));
        engine.recordZeroLiabilityAlternative(positionId, PositionStatus.ClosedByUnwind, keccak256("authorized-unwind"));
        assertEq(uint8(engine.positionStatus(positionId)), uint8(PositionStatus.ClosedByUnwind));

        vm.expectRevert(
            abi.encodeWithSelector(
                IPositionEngine.InvalidPositionTransition.selector,
                positionId,
                PositionStatus.ClosedByUnwind,
                PositionStatus.Replaced
            )
        );
        engine.recordZeroLiabilityAlternative(positionId, PositionStatus.Replaced, keccak256("replacement"));
    }

    function test_BeginFixingRejectsEarlyCall() public {
        PositionId positionId = engine.createPosition(_creation(FILL, 0, 1));
        vm.expectRevert(
            abi.encodeWithSelector(
                IPositionEngine.FixingWindowNotOpen.selector,
                positionId,
                fixture.seriesDefinition.fixingWindowOpen,
                uint64(vm.getBlockTimestamp())
            )
        );
        engine.beginFixing(positionId);
    }

    function test_LifecycleAndCompressionSnapshotsComeFromPinnedPositionState() public {
        PositionId positionId = engine.createPosition(_creation(FILL, 0, 2));

        LifecyclePositionSnapshot memory lifecycle = engine.getLifecyclePosition(positionId);
        CompressionPosition memory compression = engine.getCompressionPosition(positionId);

        assertEq(PositionId.unwrap(lifecycle.positionId), PositionId.unwrap(positionId));
        assertTrue(lifecycle.immutableHash != bytes32(0));
        assertTrue(lifecycle.lifecycleHash != bytes32(0));
        assertTrue(lifecycle.economicsHash != bytes32(0));
        assertEq(Lots.unwrap(lifecycle.positionLots), 2);
        assertEq(lifecycle.longTerminalLiabilityBaseUnits, 200_000);
        assertEq(lifecycle.shortTerminalLiabilityBaseUnits, 200_000);
        assertEq(compression.economicsHash, lifecycle.economicsHash);
        assertEq(compression.lifecycleHash, lifecycle.lifecycleHash);
    }

    function test_LifecycleEligibilityTracksRemainingQuantity() public {
        PositionId positionId = engine.createPosition(_creation(FILL, 0, 1));

        assertTrue(engine.isLifecycleActionEligible(positionId, LifecycleActionKind.PartialUnwind));
        assertTrue(engine.isLifecycleActionEligible(positionId, LifecycleActionKind.FullUnwind));
        assertTrue(engine.isCompressionEligible(positionId));

        engine.recordZeroLiabilityAlternative(positionId, PositionStatus.Replaced, keccak256("replacement"));
        assertFalse(engine.isLifecycleActionEligible(positionId, LifecycleActionKind.FullUnwind));
        assertFalse(engine.isCompressionEligible(positionId));
    }

    function testFuzz_LifecycleSnapshotLiabilityScalesExactly(uint8 rawLots) public {
        uint128 lots = uint128(bound(rawLots, 1, 100));
        PositionId positionId = engine.createPosition(_creation(FILL, 0, lots));

        LifecyclePositionSnapshot memory snapshot = engine.getLifecyclePosition(positionId);
        assertEq(Lots.unwrap(snapshot.positionLots), lots);
        assertEq(snapshot.longTerminalLiabilityBaseUnits, lots * 100_000);
        assertEq(snapshot.shortTerminalLiabilityBaseUnits, lots * 100_000);
    }

    function test_PartialCloseMaintainsAuthoritativeQuantityConservation() public {
        PositionId positionId = engine.createPosition(_creation(FILL, 0, 5));

        engine.closePositionQuantity(
            positionId,
            Lots.wrap(2),
            fixture.traderAccountId,
            0,
            PositionStatus.ClosedByUnwind,
            keccak256("partial-close")
        );

        (, PositionLifecycle memory lifecycle) = engine.getPosition(positionId);
        assertEq(uint8(lifecycle.status), uint8(PositionStatus.Live));
        assertEq(Lots.unwrap(lifecycle.remainingLots), 3);
        assertEq(Lots.unwrap(lifecycle.exercisedLots), 0);
        assertEq(Lots.unwrap(lifecycle.closedLots), 2);
        assertEq(lifecycle.lifecycleNonce, 1);
    }

    function test_PartialExerciseUsesExactLotsAndAccumulatesTransfer() public {
        PositionId positionId = engine.createPosition(_creation(FILL, 0, 5));
        bytes memory finalFixings = abi.encode(int256(123));
        vm.warp(fixture.seriesDefinition.fixingWindowOpen);
        engine.beginFixing(positionId);
        engine.acceptFinalFixing(positionId, FIXING, finalFixings);
        assertEq(uint8(engine.positionStatus(positionId)), uint8(PositionStatus.Live));
        vm.warp(fixture.seriesDefinition.exerciseOpensAt);
        vm.mockCall(
            address(fixture.adapterImplementation),
            abi.encodeCall(
                IExactLotsPayoffModuleV1.evaluatePositionLots,
                (fixture.seriesQualification.payoffTerms, finalFixings, uint128(2))
            ),
            abi.encode(int256(7))
        );

        engine.exercisePositionQuantity(positionId, Lots.wrap(2), fixture.traderAccountId, 0, FIXING, finalFixings);

        (, PositionLifecycle memory lifecycle) = engine.getPosition(positionId);
        assertEq(uint8(lifecycle.status), uint8(PositionStatus.Live));
        assertEq(Lots.unwrap(lifecycle.remainingLots), 3);
        assertEq(Lots.unwrap(lifecycle.exercisedLots), 2);
        assertEq(Lots.unwrap(lifecycle.closedLots), 0);
        assertEq(lifecycle.terminalTransferMinor, 7);
    }

    function test_LifecycleSuccessorPinsPackageProvenance() public {
        PackageId packageId = PackageId.wrap(keccak256("package"));
        bytes32 provenanceHash = keccak256(
            abi.encode(
                keccak256(
                    "SetrynPositionPackageProvenanceV1(bytes32 packageId,uint32 packageVersion,uint32 packageOrdinal)"
                ),
                packageId,
                uint32(2),
                uint32(3)
            )
        );
        PositionProvenance memory provenance = PositionProvenance({
            packageId: packageId, packageVersion: 2, packageOrdinal: 3, packageProvenanceHash: provenanceHash
        });

        PositionId positionId =
            engine.createLifecycleSuccessorWithProvenance(_creation(keccak256("successor"), 3, 2), provenance);
        (PositionEconomics memory economics,) = engine.getPosition(positionId);

        assertEq(PackageId.unwrap(economics.packageId), PackageId.unwrap(provenance.packageId));
        assertEq(economics.packageVersion, 2);
        assertEq(economics.packageOrdinal, 3);
        assertEq(engine.getLifecyclePosition(positionId).packageProvenanceHash, provenanceHash);
    }

    function test_LifecycleExecutorFailsClosedForPartialUnwindWithoutSuccessor() public {
        IPortfolioRiskEngine riskEngine =
            IPortfolioRiskEngine(address(new PortfolioRiskEngineMock(IPositionEngine(address(engine)))));
        PositionLifecycleExecutor executor = new PositionLifecycleExecutor(2 days, address(this), engine, riskEngine);
        LifecycleAction memory action;
        action.kind = LifecycleActionKind.PartialUnwind;

        vm.expectRevert(
            abi.encodeWithSelector(
                PositionLifecycleExecutor.UnsupportedLifecycleAction.selector, LifecycleActionKind.PartialUnwind
            )
        );
        executor.executeLifecycleAction(
            LifecycleActionId.wrap(keccak256("unsupported-partial")),
            action,
            new LifecycleInput[](0),
            new LifecycleSuccessor[](0),
            new LifecycleCollateralReplacement[](0)
        );
    }

    /// Registers a sibling of the fixture series whose exercise is automatic, so final fixing alone makes it
    /// settlement ready. The fixture series uses holder election, which records the fixing and returns to live.
    function _registerAutomaticExerciseSeries() internal returns (SeriesId seriesId) {
        SeriesDefinition memory definition = fixture.seriesDefinition;
        definition.seriesKey = keccak256("position.engine.automatic.series");
        definition.exercisePolicyId = SeriesDefinitionLib.EXERCISE_POLICY_AUTOMATIC;
        definition.exerciseOpensAt = 0;
        definition.exerciseCutoffAt = 0;
        SeriesQualificationData memory qualification = fixture.seriesQualification;
        qualification.dateProofs = _scheduledDateProofs(definition, qualification.dateProofs);
        definition.fixingSlotsHash = fixture.seriesRegistry.hashFixingSlots(definition, qualification.fixingSlots, 4);
        definition.dateAdjustmentEvidenceHash =
            fixture.seriesRegistry.hashDateProofs(definition, qualification.dateProofs);
        (seriesId,) = fixture.seriesRegistry.registerSeries(definition, qualification);
        fixture.seriesRegistry.activateSeries(seriesId, 1, qualification);
    }

    function _scheduledDateProofs(SeriesDefinition memory definition, SeriesDateProof[] memory proofs)
        internal
        pure
        returns (SeriesDateProof[] memory scheduled)
    {
        uint256 count;
        for (uint256 i; i < proofs.length; ++i) {
            if (SeriesDefinitionLib.timestampForKind(definition, proofs[i].kind) != 0) ++count;
        }
        scheduled = new SeriesDateProof[](count);
        count = 0;
        for (uint256 i; i < proofs.length; ++i) {
            if (SeriesDefinitionLib.timestampForKind(definition, proofs[i].kind) != 0) scheduled[count++] = proofs[i];
        }
    }

    function _creation(bytes32 fillIdentity, uint32 ordinal, uint128 lots)
        internal
        view
        returns (PositionCreation memory)
    {
        return _creationFor(fixture.seriesId, fillIdentity, ordinal, lots);
    }

    function _creationFor(SeriesId seriesId, bytes32 fillIdentity, uint32 ordinal, uint128 lots)
        internal
        view
        returns (PositionCreation memory)
    {
        return PositionCreation({
            fillIdentity: fillIdentity,
            seriesId: seriesId,
            seriesVersion: 1,
            longAccountId: fixture.traderAccountId,
            shortAccountId: shortAccount,
            ordinal: ordinal,
            lots: Lots.wrap(lots),
            entryPriceTicks: PriceTicks.wrap(100),
            longFunding: PositionFunding({
                lockId: CollateralLockId.wrap(bytes32(0)),
                lockReference: bytes32(0),
                expectedRemainingAmount: 0,
                expectedExpiry: 0
            }),
            shortFunding: PositionFunding({
                lockId: CollateralLockId.wrap(bytes32(0)),
                lockReference: bytes32(0),
                expectedRemainingAmount: 0,
                expectedExpiry: 0
            }),
            payoffTerms: fixture.seriesQualification.payoffTerms
        });
    }

    function _assertReservation(
        TerminalLiabilityReservationId reservationId,
        bytes32 liabilityKey,
        AccountId payer,
        uint128 amount
    ) private view {
        TerminalLiabilityReservation memory reservation =
            fixture.collateralVault.terminalLiabilityReservationOf(reservationId);
        assertEq(reservation.positionId, liabilityKey);
        assertEq(AccountId.unwrap(reservation.payerAccountId), AccountId.unwrap(payer));
        assertEq(reservation.positionEngine, address(engine));
        assertEq(reservation.initialAmount, amount);
        assertEq(reservation.remainingAmount, amount);
        assertEq(uint8(reservation.status), uint8(TerminalLiabilityReservationStatus.Active));
        CollateralId collateralId = fixture.collateralVault.deriveCollateralId(fixture.settlementAssetId, 1);
        (, uint128 locked,) = fixture.collateralVault.balanceOf(payer, collateralId);
        assertGe(locked, amount);
    }
}
