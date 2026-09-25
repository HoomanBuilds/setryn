// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {IPositionEngine} from "../../src/interfaces/IPositionEngine.sol";
import {IPositionPayoffModuleV1} from "../../src/interfaces/IPositionPayoffModuleV1.sol";
import {PositionEngine} from "../../src/position/PositionEngine.sol";
import {TerminalLiabilityReservation} from "../../src/types/CollateralTypes.sol";
import {TerminalLiabilityReservationStatus, TerminalOutcomeKind} from "../../src/types/Enums.sol";
import {AccountId, CollateralId, PositionId, TerminalLiabilityReservationId} from "../../src/types/Identifiers.sol";
import {
    PositionCreation,
    PositionEconomics,
    PositionLifecycle,
    PositionStatus
} from "../../src/types/PositionTypes.sol";
import {Lots, PriceTicks} from "../../src/types/Units.sol";
import {LocalSetrynFixture, SetrynLocalFixture} from "../fixtures/SetrynLocalFixture.sol";

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
        PositionId positionId = engine.createPosition(_creation(FILL, 0, 2));
        fixture.adapterRegistry.pauseAdapter(fixture.payoffAdapterId, 1);
        vm.warp(fixture.seriesDefinition.fixingWindowOpen);
        engine.beginFixing(positionId);

        bytes memory finalFixings = abi.encode(int256(10_000));
        vm.mockCall(
            address(fixture.adapterImplementation),
            abi.encodeCall(
                IPositionPayoffModuleV1.evaluatePosition, (fixture.seriesQualification.payoffTerms, finalFixings)
            ),
            abi.encode(int256(25_000))
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
        PositionId positionId = engine.createPosition(_creation(FILL, 0, 1));
        vm.warp(fixture.seriesDefinition.fixingWindowOpen);
        engine.beginFixing(positionId);
        bytes memory finalFixings = abi.encode(int256(1));
        vm.mockCall(
            address(fixture.adapterImplementation),
            abi.encodeCall(
                IPositionPayoffModuleV1.evaluatePosition, (fixture.seriesQualification.payoffTerms, finalFixings)
            ),
            abi.encode(int256(100_001))
        );

        vm.expectRevert(IPositionEngine.PayoffOutsideDebitBounds.selector);
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

        vm.expectRevert(IPositionEngine.InvalidPositionTransition.selector);
        engine.applyTerminalFallback(positionId);
    }

    function test_ZeroLiabilityAlternativeIsTerminalAndReplayGuarded() public {
        PositionId positionId = engine.createPosition(_creation(FILL, 0, 1));
        engine.recordZeroLiabilityAlternative(positionId, PositionStatus.ClosedByUnwind, keccak256("authorized-unwind"));
        assertEq(uint8(engine.positionStatus(positionId)), uint8(PositionStatus.ClosedByUnwind));

        vm.expectRevert(IPositionEngine.InvalidPositionTransition.selector);
        engine.recordZeroLiabilityAlternative(positionId, PositionStatus.Replaced, keccak256("replacement"));
    }

    function test_BeginFixingRejectsEarlyCall() public {
        PositionId positionId = engine.createPosition(_creation(FILL, 0, 1));
        vm.expectRevert(IPositionEngine.FixingWindowNotOpen.selector);
        engine.beginFixing(positionId);
    }

    function _creation(bytes32 fillIdentity, uint32 ordinal, uint128 lots)
        internal
        view
        returns (PositionCreation memory)
    {
        return PositionCreation({
            fillIdentity: fillIdentity,
            seriesId: fixture.seriesId,
            seriesVersion: 1,
            longAccountId: fixture.traderAccountId,
            shortAccountId: shortAccount,
            ordinal: ordinal,
            lots: Lots.wrap(lots),
            entryPriceTicks: PriceTicks.wrap(100),
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
