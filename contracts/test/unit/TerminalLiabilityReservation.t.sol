// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {CollateralVault} from "../../src/collateral/CollateralVault.sol";
import {ICollateralVault} from "../../src/interfaces/ICollateralVault.sol";
import {IRiskDomainRegistry} from "../../src/interfaces/IRiskDomainRegistry.sol";
import {PositionTerminalState} from "../../src/interfaces/IPositionEngineTerminalState.sol";
import {AssetRegistry} from "../../src/registry/AssetRegistry.sol";
import {SettlementAssetRegistry} from "../../src/registry/SettlementAssetRegistry.sol";
import {AssetDefinition} from "../../src/types/AssetDefinition.sol";
import {TerminalClaim, TerminalLiabilityReservation} from "../../src/types/CollateralTypes.sol";
import {
    AssetClass,
    TerminalClaimStatus,
    TerminalLiabilityReservationStatus,
    TerminalOutcomeKind
} from "../../src/types/Enums.sol";
import {
    AccountId,
    AssetId,
    CollateralId,
    RiskDomainId,
    TerminalClaimId,
    TerminalLiabilityReservationId
} from "../../src/types/Identifiers.sol";
import {SettlementAssetDefinition} from "../../src/types/SettlementAssetDefinition.sol";
import {MockCollateralERC20} from "../mocks/CollateralTokenMocks.sol";
import {PositionEngineTerminalStateMock, VaultRiskDomainRegistryMock} from "../mocks/TerminalLiabilityMocks.sol";

contract TerminalLiabilityReservationTest is Test {
    uint48 internal constant ADMIN_DELAY = 3 days;
    uint64 internal constant MAX_LOCK_DURATION = 7 days;
    uint128 internal constant UNIT = 1e6;
    bytes32 internal constant POSITION = keccak256("position.one");
    bytes32 internal constant ENGINE_ID = keccak256("position-engine.one");
    bytes32 internal constant OUTCOME = keccak256("terminal.outcome.one");
    RiskDomainId internal constant RISK_DOMAIN = RiskDomainId.wrap(keccak256("risk.usd.fully-funded"));

    address internal admin = makeAddr("admin");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal creator = makeAddr("creator");
    address internal outsider = makeAddr("outsider");

    VaultRiskDomainRegistryMock internal risks;
    PositionEngineTerminalStateMock internal engine;
    PositionEngineTerminalStateMock internal secondEngine;
    CollateralVault internal vault;
    MockCollateralERC20 internal token;
    AssetId internal assetId;
    uint32 internal bindingVersion;
    CollateralId internal collateralId;
    AccountId internal aliceAccount;
    AccountId internal bobAccount;
    uint64 internal finalResolutionAt;
    uint64 internal settlementDeadline;

    function setUp() public {
        AssetRegistry canonical = new AssetRegistry(ADMIN_DELAY, admin);
        SettlementAssetRegistry settlement = new SettlementAssetRegistry(ADMIN_DELAY, admin, canonical);
        risks = new VaultRiskDomainRegistryMock(settlement);
        engine = new PositionEngineTerminalStateMock(ENGINE_ID);
        secondEngine = new PositionEngineTerminalStateMock(ENGINE_ID);
        token = new MockCollateralERC20(6);

        vm.startPrank(admin);
        assetId = canonical.registerAsset(
            AssetDefinition({
                namespaceId: keccak256("setryn.stablecoin"),
                referenceId: keccak256("usd"),
                symbol: keccak256("USD"),
                assetClass: AssetClass.Stablecoin,
                decimals: 6
            })
        );
        bindingVersion = settlement.registerBinding(
            SettlementAssetDefinition({
                assetId: assetId,
                token: address(token),
                expectedRuntimeCodeHash: address(token).codehash,
                qualificationHash: keccak256("qualification")
            })
        );
        settlement.activateBinding(assetId, bindingVersion);
        risks.setRiskDomain(RISK_DOMAIN, 1, assetId, bindingVersion, 100 * UNIT, 60 * UNIT, 100 * UNIT, 60 * UNIT, true);
        vault =
            new CollateralVault(ADMIN_DELAY, admin, settlement, IRiskDomainRegistry(address(risks)), MAX_LOCK_DURATION);
        vault.grantRole(vault.TERMINAL_RESERVATION_CREATOR_ROLE(), creator);
        vault.grantRole(vault.TERMINAL_RESERVATION_RESOLVER_ROLE(), address(engine));
        vault.grantRole(vault.TERMINAL_RESERVATION_RESOLVER_ROLE(), address(secondEngine));
        vm.stopPrank();

        collateralId = vault.deriveCollateralId(assetId, bindingVersion);
        aliceAccount = _account(alice, keccak256("alice"));
        bobAccount = _account(bob, keccak256("bob"));
        token.mint(alice, 100 * UNIT);
        vm.startPrank(alice);
        token.approve(address(vault), type(uint256).max);
        vault.setLockOperator(aliceAccount, creator, true);
        vault.deposit(assetId, bindingVersion, aliceAccount, 100 * UNIT);
        vm.stopPrank();

        finalResolutionAt = uint64(block.timestamp + 2 days);
        settlementDeadline = uint64(block.timestamp + 3 days);
        engine.setPending(POSITION, finalResolutionAt, settlementDeadline);
        secondEngine.setPending(POSITION, finalResolutionAt, settlementDeadline);
    }

    function test_ReservationPinsEngineIdentityCodeDeadlinesAndCounters() public {
        TerminalLiabilityReservationId id = _reserve(address(engine), 40 * UNIT);
        TerminalLiabilityReservation memory reservation = vault.terminalLiabilityReservationOf(id);
        assertEq(reservation.positionEngine, address(engine));
        assertEq(reservation.positionEngineId, ENGINE_ID);
        assertEq(reservation.positionEngineCodeHash, address(engine).codehash);
        assertEq(reservation.finalResolutionAt, finalResolutionAt);
        assertEq(reservation.settlementDeadline, settlementDeadline);
        assertEq(vault.riskDomainTerminalLiability(RISK_DOMAIN, 1), 40 * UNIT);
        assertEq(vault.accountRiskDomainTerminalLiability(aliceAccount, RISK_DOMAIN, 1), 40 * UNIT);
    }

    function test_ReservationIdentityIsNamespacedByPositionEngine() public {
        TerminalLiabilityReservationId first = _reserve(address(engine), 20 * UNIT);
        TerminalLiabilityReservationId second = _reserve(address(secondEngine), 20 * UNIT);
        assertTrue(TerminalLiabilityReservationId.unwrap(first) != TerminalLiabilityReservationId.unwrap(second));
    }

    function test_NewReservationRejectsEoaAndEnforcesAccountCap() public {
        vm.expectRevert(abi.encodeWithSelector(ICollateralVault.PositionEngineHasNoCode.selector, outsider));
        vm.prank(creator);
        vault.createTerminalLiabilityReservation(
            POSITION, aliceAccount, assetId, bindingVersion, RISK_DOMAIN, 1, UNIT, outsider
        );

        _reserve(address(engine), 60 * UNIT);
        bytes32 secondPosition = keccak256("position.two");
        engine.setPending(secondPosition, finalResolutionAt, settlementDeadline);
        vm.expectPartialRevert(ICollateralVault.AccountTerminalLiabilityCapExceeded.selector);
        vm.prank(creator);
        vault.createTerminalLiabilityReservation(
            secondPosition, aliceAccount, assetId, bindingVersion, RISK_DOMAIN, 1, UNIT, address(engine)
        );
    }

    function test_RoleRemovalBlocksNewRiskButNotHistoricalFinalization() public {
        TerminalLiabilityReservationId id = _reserve(address(engine), 40 * UNIT);
        vm.startPrank(admin);
        vault.revokeRole(vault.TERMINAL_RESERVATION_RESOLVER_ROLE(), address(engine));
        vm.stopPrank();
        risks.setRiskDomain(
            RISK_DOMAIN, 1, assetId, bindingVersion, 100 * UNIT, 60 * UNIT, 100 * UNIT, 60 * UNIT, false
        );

        engine.setTerminal(_terminal(POSITION, bobAccount, 25 * UNIT, TerminalOutcomeKind.Payout));
        vm.prank(outsider);
        TerminalClaimId claimId = vault.finalizeTerminalLiabilityReservation(id);
        TerminalClaim memory claim = vault.terminalClaimOf(claimId);
        assertEq(AccountId.unwrap(claim.receiverAccountId), AccountId.unwrap(bobAccount));
        assertEq(claim.amount, 25 * UNIT);

        bytes32 secondPosition = keccak256("position.two");
        engine.setPending(secondPosition, finalResolutionAt, settlementDeadline);
        vm.expectRevert(abi.encodeWithSelector(ICollateralVault.PositionEngineNotAuthorized.selector, address(engine)));
        vm.prank(creator);
        vault.createTerminalLiabilityReservation(
            secondPosition, aliceAccount, assetId, bindingVersion, RISK_DOMAIN, 1, UNIT, address(engine)
        );
    }

    function test_FinalResolutionFallbackCreatesExactFullyBackedClaim() public {
        TerminalLiabilityReservationId id = _reserve(address(engine), 40 * UNIT);
        vm.warp(finalResolutionAt);
        engine.setTerminal(_terminal(POSITION, bobAccount, 35 * UNIT, TerminalOutcomeKind.Claim));

        vm.prank(outsider);
        TerminalClaimId claimId = vault.materializeTerminalClaimAfterFinalResolution(id);
        assertEq(uint8(vault.terminalClaimStatusOf(claimId)), uint8(TerminalClaimStatus.Active));
        (, uint128 locked,) = vault.balanceOf(aliceAccount, collateralId);
        assertEq(locked, 35 * UNIT);
        vm.prank(outsider);
        vault.fulfillTerminalClaim(claimId);
        assertEq(vault.riskDomainTerminalLiability(RISK_DOMAIN, 1), 0);
    }

    function test_FlatStateReleasesExactReservationWithoutClaim() public {
        TerminalLiabilityReservationId id = _reserve(address(engine), 40 * UNIT);
        engine.setTerminal(_terminal(POSITION, AccountId.wrap(bytes32(0)), 0, TerminalOutcomeKind.Flat));
        vm.prank(outsider);
        TerminalClaimId claimId = vault.finalizeTerminalLiabilityReservation(id);
        assertEq(TerminalClaimId.unwrap(claimId), bytes32(0));
        assertEq(
            uint8(vault.terminalLiabilityReservationStatusOf(id)),
            uint8(TerminalLiabilityReservationStatus.ReleasedAtTerminal)
        );
        assertEq(vault.riskDomainTerminalLiability(RISK_DOMAIN, 1), 0);
    }

    function _reserve(address positionEngine, uint128 amount) private returns (TerminalLiabilityReservationId) {
        vm.prank(creator);
        return vault.createTerminalLiabilityReservation(
            POSITION, aliceAccount, assetId, bindingVersion, RISK_DOMAIN, 1, amount, positionEngine
        );
    }

    function _terminal(bytes32 positionId, AccountId receiver, uint128 amount, TerminalOutcomeKind outcome)
        private
        view
        returns (PositionTerminalState memory)
    {
        return PositionTerminalState({
            positionId: positionId,
            terminalOutcomeReference: OUTCOME,
            receiverAccountId: receiver,
            amount: amount,
            outcome: outcome,
            settlementDeadline: settlementDeadline,
            finalResolutionAt: finalResolutionAt
        });
    }

    function _account(address controller, bytes32 salt) private returns (AccountId accountId) {
        vm.prank(controller);
        accountId = vault.createAccount(salt);
    }
}
