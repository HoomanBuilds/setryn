// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

import {FixingEngine} from "../../src/fixing/FixingEngine.sol";
import {ICollateralVault} from "../../src/interfaces/ICollateralVault.sol";
import {IExactLotsPayoffModuleV1} from "../../src/interfaces/IExactLotsPayoffModuleV1.sol";
import {IFixingEngine} from "../../src/interfaces/IFixingEngine.sol";
import {IFundedFeeEngine} from "../../src/interfaces/IFundedFeeEngine.sol";
import {IPortfolioRiskEngine} from "../../src/interfaces/IPortfolioRiskEngine.sol";
import {IPositionEngine} from "../../src/interfaces/IPositionEngine.sol";
import {SeriesDefinitionLib} from "../../src/libraries/SeriesDefinitionLib.sol";
import {PositionEngine} from "../../src/position/PositionEngine.sol";
import {CashSettlementCoordinator} from "../../src/settlement/CashSettlementCoordinator.sol";
import {TerminalClaim} from "../../src/types/CollateralTypes.sol";
import {
    LockStatus,
    TerminalClaimStatus,
    TerminalLiabilityReservationStatus,
    TerminalOutcomeKind
} from "../../src/types/Enums.sol";
import {FeeActionRequest} from "../../src/types/FeeEngineTypes.sol";
import {FixingResolutionKind, FixingStatus} from "../../src/types/FixingTypes.sol";
import {
    AccountId,
    CollateralId,
    CollateralLockId,
    PositionId,
    SeriesId,
    SettlementId,
    TerminalClaimId
} from "../../src/types/Identifiers.sol";
import {
    PositionCreation,
    PositionEconomics,
    PositionFunding,
    PositionLifecycle,
    PositionStatus
} from "../../src/types/PositionTypes.sol";
import {SeriesDefinition} from "../../src/types/SeriesDefinition.sol";
import {SeriesDateProof, SeriesQualificationData} from "../../src/types/SeriesQualification.sol";
import {SettlementMode, SettlementRecord} from "../../src/types/SettlementTypes.sol";
import {Lots, PriceTicks} from "../../src/types/Units.sol";
import {LocalSetrynFixture, SetrynLocalFixture} from "../fixtures/SetrynLocalFixture.sol";
import {SettlementFeeEngineMock} from "../mocks/CashSettlementCoordinatorMocks.sol";
import {PortfolioRiskEngineMock} from "../mocks/PortfolioRiskEngineMock.sol";

/// @notice Pause-path rehearsal on the local registry graph (docs/runbooks/incident-response.md).
/// Proves the AGENTS.md rule: revoking authority stops new risk, but historical positions and their
/// collateral still reach terminal resolution through objective committed state and permissionless calls.
/// Real registries, vault, position engine, fixing engine and settlement coordinator are used; only the
/// fee engine and portfolio risk engine are mocks, and they are not on the gating path.
contract PausePathRehearsalTest is SetrynLocalFixture {
    bytes32 internal constant SEED = keccak256("pause.path.rehearsal");
    uint128 internal constant DEPOSIT = 1_000_000e6;

    LocalSetrynFixture internal fixture;
    PositionEngine internal engine;
    FixingEngine internal fixingEngine;
    CashSettlementCoordinator internal coordinator;
    address internal shortTrader;
    address internal keeper;
    AccountId internal shortAccount;
    CollateralId internal collateralId;
    uint256 internal fillNonce;

    function setUp() public {
        fixture = _deployLocalFixture(SEED);
        shortTrader = makeAddr("pause-short-trader");
        keeper = makeAddr("pause-permissionless-keeper");

        vm.prank(shortTrader);
        shortAccount = fixture.collateralVault.createAccount(keccak256("pause-short-account"));
        fixture.settlementToken.mint(shortTrader, DEPOSIT);
        vm.startPrank(shortTrader);
        fixture.settlementToken.approve(address(fixture.collateralVault), type(uint256).max);
        fixture.collateralVault.deposit(fixture.settlementAssetId, 1, shortAccount, DEPOSIT);
        vm.stopPrank();

        engine = new PositionEngine(2 days, address(this), fixture.seriesRegistry, fixture.collateralVault);
        fixingEngine = new FixingEngine(fixture.seriesRegistry);
        PortfolioRiskEngineMock riskEngine = new PortfolioRiskEngineMock(IPositionEngine(address(engine)));
        SettlementFeeEngineMock feeEngine = new SettlementFeeEngineMock(address(fixture.collateralVault));
        coordinator = new CashSettlementCoordinator(
            IPositionEngine(address(engine)),
            IFixingEngine(address(fixingEngine)),
            IFundedFeeEngine(address(feeEngine)),
            IPortfolioRiskEngine(address(riskEngine))
        );

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

    /// Each control surface closes new-risk admission on its own, and resuming it restores admission.
    /// The historical position stays Live and lifecycle-enabled throughout.
    function test_EachPauseSurfaceRefusesNewRiskAndResumeRestoresAdmission() public {
        PositionId historical = _openPosition(fixture.seriesId, 2);

        // Series.
        fixture.seriesRegistry.pauseSeries(fixture.seriesId, 1);
        _assertAdmissionClosed(historical);
        fixture.seriesRegistry.activateSeries(fixture.seriesId, 1, fixture.seriesQualification);
        _assertAdmissionOpen();

        // Market.
        fixture.marketRegistry.pauseMarket(fixture.marketId, 1);
        _assertAdmissionClosed(historical);
        fixture.marketRegistry.activateMarket(fixture.marketId, 1);
        _assertAdmissionOpen();

        // Instrument.
        fixture.instrumentRegistry.pauseInstrument(fixture.instrumentId, 1);
        _assertAdmissionClosed(historical);
        fixture.instrumentRegistry.activateInstrument(fixture.instrumentId, 1);
        _assertAdmissionOpen();

        // Payoff adapter (reached through the instrument).
        fixture.adapterRegistry.pauseAdapter(fixture.payoffAdapterId, 1);
        _assertAdmissionClosed(historical);
        fixture.adapterRegistry.activateAdapter(fixture.payoffAdapterId, 1);
        _assertAdmissionOpen();

        // Risk adapter (reached through the risk domain).
        fixture.adapterRegistry.pauseAdapter(fixture.riskAdapterId, 1);
        _assertAdmissionClosed(historical);
        fixture.adapterRegistry.activateAdapter(fixture.riskAdapterId, 1);
        _assertAdmissionOpen();

        // Benchmark.
        fixture.benchmarkRegistry.pauseBenchmark(fixture.benchmarkId, 1);
        _assertAdmissionClosed(historical);
        fixture.benchmarkRegistry.activateBenchmark(fixture.benchmarkId, 1);
        _assertAdmissionOpen();

        // Risk domain.
        fixture.riskDomainRegistry.pauseRiskDomain(fixture.riskDomainId, 1);
        _assertAdmissionClosed(historical);
        fixture.riskDomainRegistry.activateRiskDomain(fixture.riskDomainId, 1);
        _assertAdmissionOpen();

        // Fee schedule.
        fixture.feeScheduleRegistry.pauseFeeSchedule(fixture.feeScheduleId, 1);
        _assertAdmissionClosed(historical);
        fixture.feeScheduleRegistry.activateFeeSchedule(fixture.feeScheduleId, 1);
        _assertAdmissionOpen();

        // Settlement asset binding: also closes deposits, never withdrawals.
        fixture.settlementAssetRegistry.pauseBinding(fixture.settlementAssetId, 1);
        _assertAdmissionClosed(historical);
        vm.prank(fixture.trader);
        vm.expectRevert(
            abi.encodeWithSelector(ICollateralVault.BindingClosedForNewRisk.selector, fixture.settlementAssetId, 1)
        );
        fixture.collateralVault.deposit(fixture.settlementAssetId, 1, fixture.traderAccountId, 1);
        vm.prank(fixture.trader);
        fixture.collateralVault.withdraw(fixture.settlementAssetId, 1, fixture.traderAccountId, 1e6, fixture.trader);
        fixture.settlementAssetRegistry.activateBinding(fixture.settlementAssetId, 1);
        _assertAdmissionOpen();

        // Vault authority: revoking the position engine's reservation-creator role stops new positions.
        bytes32 creatorRole = fixture.collateralVault.TERMINAL_RESERVATION_CREATOR_ROLE();
        fixture.collateralVault.revokeRole(creatorRole, address(engine));
        PositionCreation memory refused = _creation(fixture.seriesId, _nextFill(), 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, address(engine), creatorRole
            )
        );
        engine.createPosition(refused);
        fixture.collateralVault.grantRole(creatorRole, address(engine));
        _assertAdmissionOpen();

        assertEq(uint8(engine.positionStatus(historical)), uint8(PositionStatus.Live));
    }

    /// Every surface paused and every privileged role on the resolution path revoked. The open position still
    /// resolves through the permissionless terminal-disruption path, and both sides withdraw all collateral.
    function test_FullPauseAndRevocationDoNotDeadlockTerminalDisruptionOrWithdrawal() public {
        PositionId positionId = _openPosition(fixture.seriesId, 3);
        (PositionEconomics memory economics,) = engine.getPosition(positionId);

        // A pre-trade funding lock that is still open when authority is revoked.
        uint64 lockExpiry = uint64(block.timestamp + 1 hours);
        CollateralLockId strandedLock = engine.createPositionFundingLock(
            keccak256("pause.pretrade.lock"), fixture.traderAccountId, fixture.settlementAssetId, 1, 50_000, lockExpiry
        );

        _pauseEverything();
        _revokeResolutionPathAuthority();
        assertFalse(fixture.seriesRegistry.isOpenForNewRisk(fixture.seriesId, 1, _today()));
        assertTrue(fixture.seriesRegistry.isLifecycleEnabled(fixture.seriesId, 1));

        // No privileged caller exists for new risk.
        vm.expectRevert();
        engine.createPosition(_creation(fixture.seriesId, _nextFill(), 1));

        // Disputed or missing fixings: normal settlement is closed until final resolution; then anyone may
        // apply the objective committed disruption outcome.
        vm.warp(economics.finalResolutionAt);
        FeeActionRequest[] memory noFees = new FeeActionRequest[](0);
        vm.prank(keeper);
        SettlementId settlementId =
            coordinator.finalizeTerminalDisruption(positionId, fixture.seriesQualification.fixingSlots, noFees);

        SettlementRecord memory record = coordinator.getSettlement(settlementId);
        assertEq(uint8(record.mode), uint8(SettlementMode.TerminalDisruption));
        assertEq(record.terminalTransferMinor, 0);
        assertEq(uint8(fixingEngine.fixingStatus(fixture.seriesId, 1, 0)), uint8(FixingStatus.Finalized));
        assertEq(
            uint8(fixingEngine.getFinalizedFixing(fixture.seriesId, 1, 0).resolutionKind),
            uint8(FixingResolutionKind.TerminalDisruption)
        );
        (, PositionLifecycle memory lifecycle) = engine.getPosition(positionId);
        assertEq(uint8(lifecycle.status), uint8(PositionStatus.Settled));
        assertEq(
            uint8(fixture.collateralVault.terminalLiabilityReservationStatusOf(economics.longReservationId)),
            uint8(TerminalLiabilityReservationStatus.ReleasedAtTerminal)
        );
        assertEq(
            uint8(fixture.collateralVault.terminalLiabilityReservationStatusOf(economics.shortReservationId)),
            uint8(TerminalLiabilityReservationStatus.ReleasedAtTerminal)
        );

        // Replaying the permissionless path is idempotent.
        vm.prank(keeper);
        assertEq(
            SettlementId.unwrap(
                coordinator.finalizeTerminalDisruption(positionId, fixture.seriesQualification.fixingSlots, noFees)
            ),
            SettlementId.unwrap(settlementId)
        );

        // The stranded pre-trade lock is released permissionlessly once it expires.
        assertEq(uint8(fixture.collateralVault.lockStatusOf(strandedLock)), uint8(LockStatus.Active));
        vm.prank(keeper);
        fixture.collateralVault.releaseExpiredLock(strandedLock);
        assertEq(uint8(fixture.collateralVault.lockStatusOf(strandedLock)), uint8(LockStatus.Expired));

        _withdrawAll(fixture.trader, fixture.traderAccountId, DEPOSIT);
        _withdrawAll(shortTrader, shortAccount, DEPOSIT);
    }

    /// Normal fixing under full pause: the committed payout moves between accounts through permissionless
    /// settle, reservation finalization and claim fulfilment, and both sides withdraw the result.
    function test_FullPauseDoesNotDeadlockNormalSettlementPayoutOrWithdrawal() public {
        SeriesId automaticSeriesId = _registerAutomaticExerciseSeries();
        PositionId positionId = _openPosition(automaticSeriesId, 2);
        (PositionEconomics memory economics,) = engine.getPosition(positionId);

        _pauseEverything();
        fixture.seriesRegistry.pauseSeries(automaticSeriesId, 1);
        assertFalse(fixture.seriesRegistry.isOpenForNewRisk(automaticSeriesId, 1, _today()));

        vm.warp(fixture.seriesDefinition.fixingWindowOpen);
        vm.prank(keeper);
        engine.beginFixing(positionId);

        // The fixing engine role delivers the committed fixing; the payoff module is paused but pinned by code hash.
        bytes memory finalFixings = abi.encode(int256(10_000));
        vm.mockCall(
            address(fixture.adapterImplementation),
            abi.encodeCall(
                IExactLotsPayoffModuleV1.evaluatePositionLots,
                (fixture.seriesQualification.payoffTerms, finalFixings, uint128(2))
            ),
            abi.encode(int256(50_000))
        );
        engine.acceptFinalFixing(positionId, keccak256("pause.fixing"), finalFixings);
        _revokeResolutionPathAuthority();

        vm.startPrank(keeper);
        engine.settle(positionId);
        TerminalClaimId claimId =
            fixture.collateralVault.finalizeTerminalLiabilityReservation(economics.shortReservationId);
        assertEq(
            TerminalClaimId.unwrap(
                fixture.collateralVault.finalizeTerminalLiabilityReservation(economics.longReservationId)
            ),
            bytes32(0)
        );
        fixture.collateralVault.fulfillTerminalClaim(claimId);
        vm.stopPrank();

        assertEq(uint8(engine.terminalState(economics.shortLiabilityKey).outcome), uint8(TerminalOutcomeKind.Payout));
        TerminalClaim memory claim = fixture.collateralVault.terminalClaimOf(claimId);
        assertEq(uint8(claim.status), uint8(TerminalClaimStatus.Fulfilled));
        assertEq(claim.amount, 50_000);

        _withdrawAll(fixture.trader, fixture.traderAccountId, DEPOSIT + 50_000);
        _withdrawAll(shortTrader, shortAccount, DEPOSIT - 50_000);
    }

    function _pauseEverything() internal {
        fixture.seriesRegistry.pauseSeries(fixture.seriesId, 1);
        fixture.marketRegistry.pauseMarket(fixture.marketId, 1);
        fixture.instrumentRegistry.pauseInstrument(fixture.instrumentId, 1);
        fixture.adapterRegistry.pauseAdapter(fixture.payoffAdapterId, 1);
        fixture.adapterRegistry.pauseAdapter(fixture.riskAdapterId, 1);
        fixture.adapterRegistry.pauseAdapter(fixture.benchmarkAdapterId, 1);
        fixture.benchmarkRegistry.pauseBenchmark(fixture.benchmarkId, 1);
        fixture.riskDomainRegistry.pauseRiskDomain(fixture.riskDomainId, 1);
        fixture.feeScheduleRegistry.pauseFeeSchedule(fixture.feeScheduleId, 1);
        fixture.settlementAssetRegistry.pauseBinding(fixture.settlementAssetId, 1);
        fixture.calendarRegistry.pauseCalendar(fixture.calendarId, 1);
        fixture.sessionRegistry.pauseSession(fixture.sessionId, 1);
        fixture.assetRegistry.pauseAsset(fixture.baseAssetId);
    }

    /// Strips every privileged role that could create risk or that an operator might assume is needed to finish.
    function _revokeResolutionPathAuthority() internal {
        fixture.collateralVault.revokeRole(fixture.collateralVault.TERMINAL_RESERVATION_CREATOR_ROLE(), address(engine));
        fixture.collateralVault
            .revokeRole(fixture.collateralVault.TERMINAL_RESERVATION_RESOLVER_ROLE(), address(engine));
        fixture.collateralVault.revokeRole(fixture.collateralVault.COLLATERAL_LOCKER_ROLE(), address(engine));
        fixture.collateralVault.revokeRole(fixture.collateralVault.COLLATERAL_SETTLER_ROLE(), address(engine));
        engine.revokeRole(engine.CLEARING_ENGINE_ROLE(), address(this));
        engine.revokeRole(engine.FUNDING_REQUESTER_ROLE(), address(this));
        engine.revokeRole(engine.FIXING_ENGINE_ROLE(), address(this));
        vm.prank(fixture.trader);
        fixture.collateralVault.setLockOperator(fixture.traderAccountId, address(engine), false);
        vm.prank(shortTrader);
        fixture.collateralVault.setLockOperator(shortAccount, address(engine), false);
    }

    function _assertAdmissionClosed(PositionId historical) internal {
        assertFalse(fixture.seriesRegistry.isOpenForNewRisk(fixture.seriesId, 1, _today()));
        assertTrue(fixture.seriesRegistry.isLifecycleEnabled(fixture.seriesId, 1));
        PositionCreation memory creation = _creation(fixture.seriesId, _nextFill(), 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                IPositionEngine.SeriesClosedForNewRisk.selector, SeriesId.unwrap(fixture.seriesId), uint32(1)
            )
        );
        engine.createPosition(creation);
        assertEq(uint8(engine.positionStatus(historical)), uint8(PositionStatus.Live));
    }

    function _assertAdmissionOpen() internal {
        assertTrue(fixture.seriesRegistry.isOpenForNewRisk(fixture.seriesId, 1, _today()));
        _openPosition(fixture.seriesId, 1);
    }

    function _openPosition(SeriesId seriesId, uint128 lots) internal returns (PositionId positionId) {
        positionId = engine.createPosition(_creation(seriesId, _nextFill(), lots));
        assertEq(uint8(engine.positionStatus(positionId)), uint8(PositionStatus.Live));
    }

    function _withdrawAll(address controller, AccountId accountId, uint128 expectedTotal) internal {
        (uint128 total, uint128 locked, uint128 available) = fixture.collateralVault.balanceOf(accountId, collateralId);
        assertEq(locked, 0, "no collateral may stay locked after terminal resolution");
        assertEq(total, expectedTotal);
        assertEq(available, total);
        uint256 walletBefore = fixture.settlementToken.balanceOf(controller);
        vm.prank(controller);
        fixture.collateralVault.withdraw(fixture.settlementAssetId, 1, accountId, total, controller);
        assertEq(fixture.settlementToken.balanceOf(controller), walletBefore + total);
        (total,,) = fixture.collateralVault.balanceOf(accountId, collateralId);
        assertEq(total, 0);
    }

    function _nextFill() internal returns (bytes32) {
        fillNonce += 1;
        return keccak256(abi.encode("pause.fill", fillNonce));
    }

    function _today() internal view returns (uint32) {
        return uint32(block.timestamp / 1 days);
    }

    function _creation(SeriesId seriesId, bytes32 fillIdentity, uint128 lots)
        internal
        view
        returns (PositionCreation memory)
    {
        PositionFunding memory unfunded = PositionFunding({
            lockId: CollateralLockId.wrap(bytes32(0)),
            lockReference: bytes32(0),
            expectedRemainingAmount: 0,
            expectedExpiry: 0
        });
        return PositionCreation({
            fillIdentity: fillIdentity,
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
        });
    }

    /// Sibling of the fixture series with automatic exercise, so a final fixing makes it settlement ready.
    function _registerAutomaticExerciseSeries() internal returns (SeriesId seriesId) {
        SeriesDefinition memory definition = fixture.seriesDefinition;
        definition.seriesKey = keccak256("pause.path.automatic.series");
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
}
