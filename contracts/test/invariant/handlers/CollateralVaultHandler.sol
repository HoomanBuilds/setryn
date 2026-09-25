// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {CommonBase} from "forge-std/Base.sol";
import {StdCheats} from "forge-std/StdCheats.sol";
import {StdUtils} from "forge-std/StdUtils.sol";

import {CollateralVault} from "../../../src/collateral/CollateralVault.sol";
import {PositionTerminalState} from "../../../src/interfaces/IPositionEngineTerminalState.sol";
import {MockCollateralERC20} from "../../mocks/CollateralTokenMocks.sol";
import {PositionEngineTerminalStateMock} from "../../mocks/TerminalLiabilityMocks.sol";
import {TerminalLiabilityReservation} from "../../../src/types/CollateralTypes.sol";
import {
    LockStatus,
    TerminalClaimStatus,
    TerminalLiabilityReservationStatus,
    TerminalOutcomeKind
} from "../../../src/types/Enums.sol";
import {
    AccountId,
    AssetId,
    CollateralId,
    CollateralLockId,
    RiskDomainId,
    TerminalClaimId,
    TerminalLiabilityReservationId
} from "../../../src/types/Identifiers.sol";

contract CollateralVaultHandler is CommonBase, StdCheats, StdUtils {
    uint128 internal constant MAX_ACTION_AMOUNT = 1_000_000e6;
    RiskDomainId internal constant RISK_DOMAIN = RiskDomainId.wrap(keccak256("risk.invariant"));

    CollateralVault public vault;
    MockCollateralERC20 public token;
    PositionEngineTerminalStateMock public positionEngine;
    AssetId public assetId;
    uint32 public bindingVersion;
    CollateralId public collateralId;

    address[] internal _actors;
    AccountId[] internal _accounts;
    CollateralLockId[] internal _locks;
    TerminalLiabilityReservationId[] internal _reservations;
    TerminalClaimId[] internal _claims;

    uint256 internal _lockNonce;
    uint256 internal _positionNonce;
    uint256 internal _outcomeNonce;

    uint256 public ghostDeposited;
    uint256 public ghostWithdrawn;

    constructor(
        CollateralVault vault_,
        MockCollateralERC20 token_,
        PositionEngineTerminalStateMock positionEngine_,
        AssetId assetId_,
        uint32 bindingVersion_,
        CollateralId collateralId_,
        address[] memory actors_,
        AccountId[] memory accounts_
    ) {
        vault = vault_;
        token = token_;
        positionEngine = positionEngine_;
        assetId = assetId_;
        bindingVersion = bindingVersion_;
        collateralId = collateralId_;
        _actors = actors_;
        _accounts = accounts_;
    }

    function deposit(uint256 actorSeed, uint128 rawAmount) external {
        uint128 amount = uint128(_bound(rawAmount, 1, MAX_ACTION_AMOUNT));
        address actor = _actor(actorSeed);
        token.mint(actor, amount);

        vm.prank(actor);
        vault.deposit(assetId, bindingVersion, _account(actorSeed), amount);
        ghostDeposited += amount;
    }

    function withdraw(uint256 actorSeed, uint128 rawAmount) external {
        AccountId accountId = _account(actorSeed);
        (,, uint128 available) = vault.balanceOf(accountId, collateralId);
        if (available == 0) {
            return;
        }

        uint128 amount = uint128(_bound(rawAmount, 1, available));
        vm.prank(_actor(actorSeed));
        vault.withdraw(assetId, bindingVersion, accountId, amount, _actor(actorSeed));
        ghostWithdrawn += amount;
    }

    function createLock(uint256 actorSeed, uint128 rawAmount) external {
        AccountId accountId = _account(actorSeed);
        (,, uint128 available) = vault.balanceOf(accountId, collateralId);
        if (available == 0) {
            return;
        }

        uint128 amount = uint128(_bound(rawAmount, 1, available));
        bytes32 lockReference = keccak256(abi.encode("lock", ++_lockNonce));
        CollateralLockId lockId = vault.createLock(
            lockReference,
            accountId,
            assetId,
            bindingVersion,
            amount,
            uint64(block.timestamp + 1 days),
            address(positionEngine)
        );
        _locks.push(lockId);
    }

    function releaseLock(uint256 lockSeed) external {
        if (_locks.length == 0) {
            return;
        }
        CollateralLockId lockId = _locks[lockSeed % _locks.length];
        if (vault.lockStatusOf(lockId) != LockStatus.Active) {
            return;
        }
        if (block.timestamp >= vault.getLock(lockId).expiry) {
            return;
        }
        vault.releaseLock(lockId);
    }

    function expireLock(uint256 lockSeed) external {
        if (_locks.length == 0) {
            return;
        }
        CollateralLockId lockId = _locks[lockSeed % _locks.length];
        if (vault.lockStatusOf(lockId) != LockStatus.Active) {
            return;
        }
        uint64 expiry = vault.getLock(lockId).expiry;
        if (block.timestamp < expiry) {
            vm.warp(expiry);
        }
        vault.releaseExpiredLock(lockId);
    }

    function createReservation(uint256 actorSeed, uint128 rawAmount) external {
        AccountId accountId = _account(actorSeed);
        (,, uint128 available) = vault.balanceOf(accountId, collateralId);
        if (available == 0) {
            return;
        }

        uint128 amount = uint128(_bound(rawAmount, 1, available));
        bytes32 positionId = keccak256(abi.encode("direct-position", ++_positionNonce));
        positionEngine.setPending(positionId, uint64(block.timestamp + 2 days), uint64(block.timestamp + 3 days));
        TerminalLiabilityReservationId reservationId = vault.createTerminalLiabilityReservation(
            positionId, accountId, assetId, bindingVersion, RISK_DOMAIN, 1, amount, address(positionEngine)
        );
        _reservations.push(reservationId);
    }

    function convertLock(uint256 lockSeed, uint128 rawAmount) external {
        if (_locks.length == 0) {
            return;
        }
        CollateralLockId lockId = _locks[lockSeed % _locks.length];
        if (vault.lockStatusOf(lockId) != LockStatus.Active) {
            return;
        }
        uint128 remaining = vault.getLock(lockId).remainingAmount;
        if (remaining == 0 || block.timestamp >= vault.getLock(lockId).expiry) {
            return;
        }

        uint128 amount = uint128(_bound(rawAmount, 1, remaining));
        bytes32 positionId = keccak256(abi.encode("converted-position", ++_positionNonce));
        positionEngine.setPending(positionId, uint64(block.timestamp + 2 days), uint64(block.timestamp + 3 days));
        TerminalLiabilityReservationId reservationId =
            vault.convertLockToTerminalLiabilityReservation(lockId, positionId, RISK_DOMAIN, 1, amount);
        _reservations.push(reservationId);
    }

    function resolveReservation(uint256 reservationSeed, uint256 receiverSeed, uint128 rawAmount, uint8 action)
        external
    {
        if (_reservations.length == 0) {
            return;
        }
        TerminalLiabilityReservationId reservationId = _reservations[reservationSeed % _reservations.length];
        if (vault.terminalLiabilityReservationStatusOf(reservationId) != TerminalLiabilityReservationStatus.Active) {
            return;
        }

        TerminalLiabilityReservation memory reservation = vault.terminalLiabilityReservationOf(reservationId);
        uint128 remaining = reservation.remainingAmount;
        bytes32 outcome = keccak256(abi.encode("outcome", reservationId, ++_outcomeNonce));
        uint256 payerIndex = _accountIndex(vault.terminalLiabilityReservationOf(reservationId).payerAccountId);
        uint256 receiverIndex = (payerIndex + 1 + (receiverSeed % (_accounts.length - 1))) % _accounts.length;
        AccountId receiverAccountId = _accounts[receiverIndex];
        uint8 selected = action % 3;

        if (selected == 0) {
            uint128 amount = uint128(_bound(rawAmount, 1, remaining));
            positionEngine.setTerminal(
                _terminalState(reservation, receiverAccountId, amount, outcome, TerminalOutcomeKind.Payout)
            );
            TerminalClaimId claimId = vault.finalizeTerminalLiabilityReservation(reservationId);
            _claims.push(claimId);
        } else if (selected == 1) {
            TerminalOutcomeKind kind = action % 2 == 0 ? TerminalOutcomeKind.NoEffect : TerminalOutcomeKind.Flat;
            positionEngine.setTerminal(_terminalState(reservation, AccountId.wrap(bytes32(0)), 0, outcome, kind));
            vault.finalizeTerminalLiabilityReservation(reservationId);
        } else {
            uint128 amount = uint128(_bound(rawAmount, 1, remaining));
            if (block.timestamp < reservation.finalResolutionAt) vm.warp(reservation.finalResolutionAt);
            positionEngine.setTerminal(
                _terminalState(reservation, receiverAccountId, amount, outcome, TerminalOutcomeKind.Claim)
            );
            TerminalClaimId claimId = vault.materializeTerminalClaimAfterFinalResolution(reservationId);
            _claims.push(claimId);
        }
    }

    function fulfillClaim(uint256 claimSeed) external {
        if (_claims.length == 0) {
            return;
        }
        TerminalClaimId claimId = _claims[claimSeed % _claims.length];
        if (vault.terminalClaimStatusOf(claimId) != TerminalClaimStatus.Active) {
            return;
        }
        vault.fulfillTerminalClaim(claimId);
    }

    function actorCount() external view returns (uint256) {
        return _actors.length;
    }

    function actorAt(uint256 index) external view returns (address) {
        return _actors[index];
    }

    function accountAt(uint256 index) external view returns (AccountId) {
        return _accounts[index];
    }

    function _actor(uint256 seed) internal view returns (address) {
        return _actors[seed % _actors.length];
    }

    function _account(uint256 seed) internal view returns (AccountId) {
        return _accounts[seed % _accounts.length];
    }

    function _accountIndex(AccountId accountId) internal view returns (uint256 index) {
        for (uint256 i = 0; i < _accounts.length; i++) {
            if (AccountId.unwrap(_accounts[i]) == AccountId.unwrap(accountId)) {
                return i;
            }
        }
        revert();
    }

    function _terminalState(
        TerminalLiabilityReservation memory reservation,
        AccountId receiverAccountId,
        uint128 amount,
        bytes32 outcomeReference,
        TerminalOutcomeKind outcome
    ) private pure returns (PositionTerminalState memory) {
        return PositionTerminalState({
            positionId: reservation.positionId,
            terminalOutcomeReference: outcomeReference,
            receiverAccountId: receiverAccountId,
            amount: amount,
            outcome: outcome,
            settlementDeadline: reservation.settlementDeadline,
            finalResolutionAt: reservation.finalResolutionAt
        });
    }
}
