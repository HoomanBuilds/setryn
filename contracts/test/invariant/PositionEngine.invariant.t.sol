// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {PositionEngine} from "../../src/position/PositionEngine.sol";
import {TerminalLiabilityReservation} from "../../src/types/CollateralTypes.sol";
import {TerminalLiabilityReservationStatus, TerminalOutcomeKind} from "../../src/types/Enums.sol";
import {AccountId, PositionId, TerminalLiabilityReservationId} from "../../src/types/Identifiers.sol";
import {PositionEconomics, PositionLifecycle, PositionStatus} from "../../src/types/PositionTypes.sol";
import {LifecyclePositionSnapshot} from "../../src/types/LifecycleTypes.sol";
import {Lots} from "../../src/types/Units.sol";
import {LocalSetrynFixture, SetrynLocalFixture} from "../fixtures/SetrynLocalFixture.sol";
import {PositionEngineHandler} from "./handlers/PositionEngineHandler.sol";

contract PositionEngineInvariantTest is SetrynLocalFixture {
    LocalSetrynFixture internal fixture;
    PositionEngine internal engine;
    PositionEngineHandler internal handler;
    address internal shortTrader;
    AccountId internal shortAccount;

    function setUp() public {
        fixture = _deployLocalFixture(keccak256("position.engine.invariant"));
        shortTrader = makeAddr("position-invariant-short");
        vm.prank(shortTrader);
        shortAccount = fixture.collateralVault.createAccount(keccak256("position-invariant-short-account"));
        fixture.settlementToken.mint(shortTrader, 1_000_000e6);
        vm.startPrank(shortTrader);
        fixture.settlementToken.approve(address(fixture.collateralVault), type(uint256).max);
        fixture.collateralVault.deposit(fixture.settlementAssetId, 1, shortAccount, 1_000_000e6);
        vm.stopPrank();

        engine = new PositionEngine(2 days, address(this), fixture.seriesRegistry, fixture.collateralVault);
        handler = new PositionEngineHandler(
            engine, fixture.seriesId, fixture.traderAccountId, shortAccount, fixture.seriesQualification.payoffTerms
        );
        engine.grantRole(engine.CLEARING_ENGINE_ROLE(), address(handler));
        engine.grantRole(engine.LIFECYCLE_ENGINE_ROLE(), address(handler));
        fixture.collateralVault.grantRole(fixture.collateralVault.TERMINAL_RESERVATION_CREATOR_ROLE(), address(engine));
        fixture.collateralVault.grantRole(fixture.collateralVault.TERMINAL_RESERVATION_RESOLVER_ROLE(), address(engine));
        vm.prank(fixture.trader);
        fixture.collateralVault.setLockOperator(fixture.traderAccountId, address(engine), true);
        vm.prank(shortTrader);
        fixture.collateralVault.setLockOperator(shortAccount, address(engine), true);
        vm.warp(fixture.seriesDefinition.tradingStartsAt);

        bytes4[] memory selectors = new bytes4[](2);
        selectors[0] = PositionEngineHandler.create.selector;
        selectors[1] = PositionEngineHandler.close.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
        handler.create(1);
    }

    function invariant_EveryPositionRetainsExactTerminalCover() public view {
        uint256 count = handler.positionCount();
        assertEq(engine.positionCount(), count);
        for (uint256 i; i < count; ++i) {
            PositionId positionId = handler.positionAt(i);
            (PositionEconomics memory economics, PositionLifecycle memory lifecycle) = engine.getPosition(positionId);
            assertEq(PositionId.unwrap(economics.positionId), PositionId.unwrap(positionId));
            _assertReservation(
                economics.longReservationId,
                economics.longLiabilityKey,
                economics.longAccountId,
                economics.maxLongDebitMinor
            );
            _assertReservation(
                economics.shortReservationId,
                economics.shortLiabilityKey,
                economics.shortAccountId,
                economics.maxShortDebitMinor
            );
            if (lifecycle.status == PositionStatus.Live) {
                assertEq(
                    uint8(engine.terminalState(economics.longLiabilityKey).outcome),
                    uint8(TerminalOutcomeKind.Unspecified)
                );
                assertEq(
                    uint8(engine.terminalState(economics.shortLiabilityKey).outcome),
                    uint8(TerminalOutcomeKind.Unspecified)
                );
            } else {
                assertTrue(lifecycle.terminalOutcomeReference != bytes32(0));
            }
        }
    }

    function invariant_PositionStatesNeverReturnToAbsent() public view {
        uint256 count = handler.positionCount();
        for (uint256 i; i < count; ++i) {
            assertTrue(engine.positionStatus(handler.positionAt(i)) != PositionStatus.Unspecified);
        }
    }

    function invariant_CanonicalLifecycleSnapshotsRemainBoundToEveryPosition() public view {
        uint256 count = handler.positionCount();
        for (uint256 i; i < count; ++i) {
            PositionId positionId = handler.positionAt(i);
            LifecyclePositionSnapshot memory snapshot = engine.getLifecyclePosition(positionId);
            assertEq(PositionId.unwrap(snapshot.positionId), PositionId.unwrap(positionId));
            assertTrue(snapshot.immutableHash != bytes32(0));
            assertTrue(snapshot.lifecycleHash != bytes32(0));
            assertTrue(snapshot.economicsHash != bytes32(0));
        }
    }

    function invariant_OriginalQuantityAlwaysEqualsRemainingExercisedAndClosed() public view {
        uint256 count = handler.positionCount();
        for (uint256 i; i < count; ++i) {
            (PositionEconomics memory economics, PositionLifecycle memory lifecycle) =
                engine.getPosition(handler.positionAt(i));
            assertEq(
                Lots.unwrap(economics.originalLots),
                Lots.unwrap(lifecycle.remainingLots) + Lots.unwrap(lifecycle.exercisedLots)
                    + Lots.unwrap(lifecycle.closedLots)
            );
        }
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
        assertEq(reservation.initialAmount, amount);
        assertEq(reservation.remainingAmount, amount);
        assertEq(uint8(reservation.status), uint8(TerminalLiabilityReservationStatus.Active));
    }
}
