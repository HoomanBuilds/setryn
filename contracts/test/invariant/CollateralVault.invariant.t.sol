// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {CollateralVault} from "../../src/collateral/CollateralVault.sol";
import {IRiskDomainRegistry} from "../../src/interfaces/IRiskDomainRegistry.sol";
import {AssetRegistry} from "../../src/registry/AssetRegistry.sol";
import {SettlementAssetRegistry} from "../../src/registry/SettlementAssetRegistry.sol";
import {AssetDefinition} from "../../src/types/AssetDefinition.sol";
import {AssetClass} from "../../src/types/Enums.sol";
import {AccountId, AssetId, CollateralId, RiskDomainId} from "../../src/types/Identifiers.sol";
import {SettlementAssetDefinition} from "../../src/types/SettlementAssetDefinition.sol";
import {CollateralVaultHandler} from "./handlers/CollateralVaultHandler.sol";
import {MockCollateralERC20} from "../mocks/CollateralTokenMocks.sol";
import {PositionEngineTerminalStateMock, VaultRiskDomainRegistryMock} from "../mocks/TerminalLiabilityMocks.sol";

contract CollateralVaultInvariantTest is Test {
    AssetRegistry internal canonical;
    SettlementAssetRegistry internal settlement;
    CollateralVault internal vault;
    VaultRiskDomainRegistryMock internal risks;
    PositionEngineTerminalStateMock internal positionEngine;
    MockCollateralERC20 internal token;
    CollateralVaultHandler internal handler;

    AssetId internal assetId;
    uint32 internal bindingVersion;
    CollateralId internal collateralId;

    function setUp() public {
        canonical = new AssetRegistry(3 days, address(this));
        settlement = new SettlementAssetRegistry(3 days, address(this), canonical);
        token = new MockCollateralERC20(6);

        assetId = canonical.registerAsset(
            AssetDefinition({
                namespaceId: keccak256("setryn.stablecoin"),
                referenceId: keccak256("invariant.usd"),
                symbol: keccak256("IUSD"),
                assetClass: AssetClass.Stablecoin,
                decimals: 6
            })
        );
        bindingVersion = settlement.registerBinding(
            SettlementAssetDefinition({
                assetId: assetId,
                token: address(token),
                expectedRuntimeCodeHash: address(token).codehash,
                qualificationHash: keccak256("invariant.qualification")
            })
        );
        settlement.activateBinding(assetId, bindingVersion);

        risks = new VaultRiskDomainRegistryMock(settlement);
        risks.setRiskDomain(
            RiskDomainId.wrap(keccak256("risk.invariant")),
            1,
            assetId,
            bindingVersion,
            type(uint128).max,
            type(uint128).max,
            type(uint128).max,
            type(uint128).max,
            true
        );
        positionEngine = new PositionEngineTerminalStateMock(keccak256("invariant.position.engine"));
        vault = new CollateralVault(3 days, address(this), settlement, IRiskDomainRegistry(address(risks)), 7 days);
        collateralId = vault.deriveCollateralId(assetId, bindingVersion);

        address[] memory actors = new address[](3);
        AccountId[] memory accounts = new AccountId[](3);
        for (uint256 i = 0; i < actors.length; i++) {
            actors[i] = makeAddr(string.concat("vault-actor-", vm.toString(i)));
            vm.prank(actors[i]);
            accounts[i] = vault.createAccount(bytes32(i + 1));
        }

        handler = new CollateralVaultHandler(
            vault, token, positionEngine, assetId, bindingVersion, collateralId, actors, accounts
        );
        vault.grantRole(vault.COLLATERAL_LOCKER_ROLE(), address(handler));
        vault.grantRole(vault.COLLATERAL_SETTLER_ROLE(), address(positionEngine));
        vault.grantRole(vault.TERMINAL_RESERVATION_CREATOR_ROLE(), address(handler));
        vault.grantRole(vault.TERMINAL_RESERVATION_RESOLVER_ROLE(), address(positionEngine));

        for (uint256 i = 0; i < actors.length; i++) {
            vm.startPrank(actors[i]);
            token.approve(address(vault), type(uint256).max);
            vault.setLockOperator(accounts[i], address(handler), true);
            vm.stopPrank();
        }

        bytes4[] memory selectors = new bytes4[](9);
        selectors[0] = CollateralVaultHandler.deposit.selector;
        selectors[1] = CollateralVaultHandler.withdraw.selector;
        selectors[2] = CollateralVaultHandler.createLock.selector;
        selectors[3] = CollateralVaultHandler.releaseLock.selector;
        selectors[4] = CollateralVaultHandler.expireLock.selector;
        selectors[5] = CollateralVaultHandler.createReservation.selector;
        selectors[6] = CollateralVaultHandler.convertLock.selector;
        selectors[7] = CollateralVaultHandler.resolveReservation.selector;
        selectors[8] = CollateralVaultHandler.fulfillClaim.selector;

        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));

        handler.deposit(0, 100e6);
        handler.createReservation(0, 40e6);
        handler.resolveReservation(0, 1, 20e6, 2);
        handler.fulfillClaim(0);
    }

    function invariant_CustodyAndLedgerAreConserved() public view {
        uint256 sumTotals;
        uint256 actorCount = handler.actorCount();
        for (uint256 i = 0; i < actorCount; i++) {
            (uint128 total,,) = vault.balanceOf(handler.accountAt(i), collateralId);
            sumTotals += total;
        }

        uint256 liability = vault.collateralLiability(collateralId);
        assertEq(sumTotals, liability, "account totals drifted from collateral liability");
        assertEq(liability, vault.tokenLiability(address(token)), "binding and token liabilities diverged");
        assertEq(vault.tokenLiability(address(token)), token.balanceOf(address(vault)), "custody lost backing");
        assertEq(
            token.balanceOf(address(vault)) + handler.ghostWithdrawn(),
            handler.ghostDeposited(),
            "deposits and withdrawals did not conserve custody"
        );
    }

    function invariant_EncumbranceClassesConserveLockedCollateral() public view {
        uint256 sumPreTrade;
        uint256 sumTerminal;
        uint256 sumClaims;
        uint256 sumLocked;
        uint256 actorCount = handler.actorCount();

        for (uint256 i = 0; i < actorCount; i++) {
            AccountId accountId = handler.accountAt(i);
            (uint128 total, uint128 locked,) = vault.balanceOf(accountId, collateralId);
            (uint128 preTrade, uint128 terminal, uint128 claims, uint128 classifiedLocked) =
                vault.encumbranceOf(accountId, collateralId);

            assertEq(uint256(locked), uint256(classifiedLocked), "account locked view diverged");
            assertEq(
                uint256(classifiedLocked),
                uint256(preTrade) + uint256(terminal) + uint256(claims),
                "account encumbrance classes diverged"
            );
            assertLe(locked, total, "account encumbrance exceeded total");

            sumPreTrade += preTrade;
            sumTerminal += terminal;
            sumClaims += claims;
            sumLocked += locked;
        }

        (uint256 aggregatePreTrade, uint256 aggregateTerminal, uint256 aggregateClaims) =
            vault.collateralEncumbrance(collateralId);
        assertEq(sumPreTrade, aggregatePreTrade, "pre-trade aggregate diverged");
        assertEq(sumTerminal, aggregateTerminal, "terminal reservation aggregate diverged");
        assertEq(sumClaims, aggregateClaims, "terminal claim aggregate diverged");
        assertEq(sumLocked, aggregatePreTrade + aggregateTerminal + aggregateClaims, "aggregate locked diverged");
        assertLe(sumLocked, vault.collateralLiability(collateralId), "encumbrance exceeded liability");
    }
}
