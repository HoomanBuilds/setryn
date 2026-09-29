// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ICollateralVault} from "../interfaces/ICollateralVault.sol";
import {IPositionEngineTerminalState, PositionTerminalState} from "../interfaces/IPositionEngineTerminalState.sol";
import {CollateralIdLib} from "../libraries/CollateralIdLib.sol";
import {
    CollateralAccount,
    CollateralBalance,
    CollateralLock,
    TerminalClaim,
    TerminalLiabilityReplacement,
    TerminalLiabilityReservation
} from "../types/CollateralTypes.sol";
import {
    LockStatus,
    TerminalClaimStatus,
    TerminalLiabilityReservationStatus,
    TerminalOutcomeKind
} from "../types/Enums.sol";
import {
    AccountId,
    AssetId,
    CollateralId,
    CollateralLockId,
    RiskDomainId,
    TerminalClaimId,
    TerminalLiabilityReservationId
} from "../types/Identifiers.sol";
import {RiskDomainVersion} from "../types/RiskDomainDefinition.sol";
import {CollateralVaultDependencies, PositionEngineQualification} from "./CollateralVaultTypes.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

/// Linked ledger logic for the collateral vault: pledged-lock consumption and the terminal-liability reservation
/// lifecycle (creation, conversion, replacement, and objective finalization). Moves no tokens; runs through
/// DELEGATECALL in the vault's context against its ledger storage after the vault's role and reentrancy checks.
library CollateralReservationLib {
    using SafeERC20 for IERC20;

    uint32 internal constant POSITION_ENGINE_TERMINAL_STATE_INTERFACE_VERSION = 1;
    bytes32 internal constant TERMINAL_RESERVATION_RESOLVER_ROLE =
        keccak256("SETRYN_TERMINAL_RESERVATION_RESOLVER_ROLE");

    function replaceTerminalLiabilityReservations(
        mapping(
            AccountId accountId => mapping(CollateralId collateralId => CollateralBalance balance)
        ) storage $balances,
        mapping(AccountId accountId => mapping(CollateralId collateralId => uint128 amount)) storage $terminalReserved,
        mapping(CollateralId collateralId => uint256 amount) storage $terminalReservationEncumbrance,
        mapping(
            TerminalLiabilityReservationId reservationId => TerminalLiabilityReservation reservation
        ) storage $terminalLiabilityReservations,
        mapping(
            RiskDomainId riskDomainId => mapping(uint32 version => uint256 amount)
        ) storage $riskDomainTerminalLiability,
        mapping(
            AccountId accountId => mapping(RiskDomainId riskDomainId => mapping(uint32 version => uint256 amount))
        ) storage $accountRiskDomainTerminalLiability,
        TerminalLiabilityReservationId[] calldata sourceReservationIds,
        TerminalLiabilityReplacement[] calldata replacements
    ) external returns (TerminalLiabilityReservationId[] memory replacementReservationIds) {
        if (sourceReservationIds.length == 0 || replacements.length == 0) {
            revert ICollateralVault.InvalidTerminalLiabilityReplacement();
        }
        TerminalLiabilityReservation storage first =
            _requireActiveTerminalLiabilityReservation($terminalLiabilityReservations, sourceReservationIds[0]);
        if (
            first.creator != msg.sender || first.positionEngine != msg.sender
                || first.positionEngineCodeHash != msg.sender.codehash
        ) {
            revert ICollateralVault.InvalidTerminalLiabilityReplacement();
        }
        uint256 sourceTotal;
        bytes32 previousSource;
        for (uint256 i; i < sourceReservationIds.length; ++i) {
            bytes32 currentSource = TerminalLiabilityReservationId.unwrap(sourceReservationIds[i]);
            if (currentSource <= previousSource) revert ICollateralVault.InvalidTerminalLiabilityReplacement();
            previousSource = currentSource;
            TerminalLiabilityReservation storage source =
                _requireActiveTerminalLiabilityReservation($terminalLiabilityReservations, sourceReservationIds[i]);
            if (
                source.creator != msg.sender || source.positionEngine != msg.sender
                    || source.positionEngineId != first.positionEngineId
                    || source.positionEngineCodeHash != first.positionEngineCodeHash
                    || AccountId.unwrap(source.payerAccountId) != AccountId.unwrap(first.payerAccountId)
                    || CollateralId.unwrap(source.collateralId) != CollateralId.unwrap(first.collateralId)
                    || RiskDomainId.unwrap(source.riskDomainId) != RiskDomainId.unwrap(first.riskDomainId)
                    || source.riskDomainVersion != first.riskDomainVersion
            ) revert ICollateralVault.InvalidTerminalLiabilityReplacement();
            sourceTotal += source.remainingAmount;
        }

        replacementReservationIds = new TerminalLiabilityReservationId[](replacements.length);
        uint256 replacementTotal;
        for (uint256 i; i < replacements.length; ++i) {
            TerminalLiabilityReplacement calldata replacement = replacements[i];
            if (
                replacement.positionId == bytes32(0) || replacement.amount == 0
                    || AccountId.unwrap(replacement.payerAccountId) != AccountId.unwrap(first.payerAccountId)
                    || AssetId.unwrap(replacement.assetId) != AssetId.unwrap(first.assetId)
                    || replacement.bindingVersion != first.bindingVersion
                    || RiskDomainId.unwrap(replacement.riskDomainId) != RiskDomainId.unwrap(first.riskDomainId)
                    || replacement.riskDomainVersion != first.riskDomainVersion
                    || replacement.finalResolutionAt > replacement.settlementDeadline
            ) revert ICollateralVault.InvalidTerminalLiabilityReplacement();
            TerminalLiabilityReservationId replacementId =
                _deriveTerminalLiabilityReservationId(msg.sender, first.positionEngineId, replacement.positionId);
            _requireUnusedTerminalLiabilityReservation($terminalLiabilityReservations, replacementId);
            replacementReservationIds[i] = replacementId;
            replacementTotal += replacement.amount;
        }
        if (replacementTotal > sourceTotal || replacementTotal > type(uint128).max) {
            revert ICollateralVault.InvalidTerminalLiabilityReplacement();
        }

        for (uint256 i; i < sourceReservationIds.length; ++i) {
            TerminalLiabilityReservation storage source = $terminalLiabilityReservations[sourceReservationIds[i]];
            source.remainingAmount = 0;
            source.status = TerminalLiabilityReservationStatus.Replaced;
        }
        for (uint256 i; i < replacements.length; ++i) {
            TerminalLiabilityReplacement calldata replacement = replacements[i];
            TerminalLiabilityReservation storage reservation =
                $terminalLiabilityReservations[replacementReservationIds[i]];
            reservation.positionId = replacement.positionId;
            reservation.positionEngineId = first.positionEngineId;
            reservation.positionEngineCodeHash = first.positionEngineCodeHash;
            reservation.payerAccountId = first.payerAccountId;
            reservation.collateralId = first.collateralId;
            reservation.assetId = first.assetId;
            reservation.riskDomainId = first.riskDomainId;
            reservation.creator = msg.sender;
            reservation.positionEngine = msg.sender;
            reservation.bindingVersion = first.bindingVersion;
            reservation.riskDomainVersion = first.riskDomainVersion;
            reservation.settlementDeadline = replacement.settlementDeadline;
            reservation.finalResolutionAt = replacement.finalResolutionAt;
            reservation.status = TerminalLiabilityReservationStatus.Active;
            reservation.initialAmount = replacement.amount;
            reservation.remainingAmount = replacement.amount;
            _emitTerminalLiabilityReservationCreated(
                replacementReservationIds[i], reservation, CollateralLockId.wrap(bytes32(0))
            );
        }

        uint128 released = uint128(sourceTotal - replacementTotal);
        if (released != 0) {
            $terminalReserved[first.payerAccountId][first.collateralId] -= released;
            $terminalReservationEncumbrance[first.collateralId] -= released;
            $balances[first.payerAccountId][first.collateralId].locked -= released;
            _decreaseRiskDomainTerminalLiability(
                $riskDomainTerminalLiability,
                $accountRiskDomainTerminalLiability,
                first.payerAccountId,
                first.riskDomainId,
                first.riskDomainVersion,
                released
            );
        }
        bytes32 replacementHash = keccak256(abi.encode(sourceReservationIds, replacements));
        emit ICollateralVault.TerminalLiabilityReservationsReplaced(
            replacementHash,
            first.payerAccountId,
            first.collateralId,
            uint128(sourceTotal),
            uint128(replacementTotal),
            released,
            msg.sender
        );
    }

    function createTerminalLiabilityReservation(
        CollateralVaultDependencies memory deps,
        mapping(AccountId accountId => CollateralAccount account) storage $accounts,
        mapping(
            AccountId accountId => mapping(CollateralId collateralId => CollateralBalance balance)
        ) storage $balances,
        mapping(AccountId accountId => mapping(address operator => uint64 approvalEpoch)) storage $lockOperators,
        mapping(AccountId accountId => mapping(CollateralId collateralId => uint128 amount)) storage $terminalReserved,
        mapping(CollateralId collateralId => uint256 amount) storage $terminalReservationEncumbrance,
        mapping(
            TerminalLiabilityReservationId reservationId => TerminalLiabilityReservation reservation
        ) storage $terminalLiabilityReservations,
        mapping(
            RiskDomainId riskDomainId => mapping(uint32 version => uint256 amount)
        ) storage $riskDomainTerminalLiability,
        mapping(
            AccountId accountId => mapping(RiskDomainId riskDomainId => mapping(uint32 version => uint256 amount))
        ) storage $accountRiskDomainTerminalLiability,
        bytes32 positionId,
        AccountId payerAccountId,
        AssetId assetId,
        uint32 bindingVersion,
        RiskDomainId riskDomainId,
        uint32 riskDomainVersion,
        uint128 amount,
        address positionEngine
    ) external returns (TerminalLiabilityReservationId reservationId) {
        _requireTerminalReservationInputs(positionId, riskDomainId, riskDomainVersion, amount);
        _requireAccount($accounts, payerAccountId);
        if (!_isLockOperator($accounts, $lockOperators, payerAccountId, msg.sender)) {
            revert ICollateralVault.LockOperatorNotApproved(payerAccountId, msg.sender);
        }
        if (!deps.settlementAssetRegistry.isOpenForNewRisk(assetId, bindingVersion)) {
            revert ICollateralVault.BindingClosedForNewRisk(assetId, bindingVersion);
        }

        PositionEngineQualification memory engine = _requirePositionEngineForNewRisk(positionEngine, positionId);
        _requireRiskDomainForReservation(
            deps,
            $riskDomainTerminalLiability,
            $accountRiskDomainTerminalLiability,
            payerAccountId,
            assetId,
            bindingVersion,
            riskDomainId,
            riskDomainVersion,
            amount
        );

        reservationId = _deriveTerminalLiabilityReservationId(positionEngine, engine.positionEngineId, positionId);
        _requireUnusedTerminalLiabilityReservation($terminalLiabilityReservations, reservationId);

        CollateralId collateralId = _collateralId(deps, assetId, bindingVersion);
        _pledgeAvailable($balances, payerAccountId, collateralId, amount);
        $terminalReserved[payerAccountId][collateralId] += amount;
        $terminalReservationEncumbrance[collateralId] += amount;

        TerminalLiabilityReservation storage reservation = $terminalLiabilityReservations[reservationId];
        reservation.positionId = positionId;
        reservation.payerAccountId = payerAccountId;
        reservation.collateralId = collateralId;
        reservation.assetId = assetId;
        reservation.riskDomainId = riskDomainId;
        reservation.creator = msg.sender;
        reservation.positionEngine = positionEngine;
        reservation.positionEngineId = engine.positionEngineId;
        reservation.positionEngineCodeHash = engine.positionEngineCodeHash;
        reservation.bindingVersion = bindingVersion;
        reservation.riskDomainVersion = riskDomainVersion;
        reservation.settlementDeadline = engine.settlementDeadline;
        reservation.finalResolutionAt = engine.finalResolutionAt;
        reservation.status = TerminalLiabilityReservationStatus.Active;
        reservation.initialAmount = amount;
        reservation.remainingAmount = amount;

        _increaseRiskDomainTerminalLiability(
            $riskDomainTerminalLiability,
            $accountRiskDomainTerminalLiability,
            payerAccountId,
            riskDomainId,
            riskDomainVersion,
            amount
        );

        _emitTerminalLiabilityReservationCreated(reservationId, reservation, CollateralLockId.wrap(bytes32(0)));
    }

    function convertLockToTerminalLiabilityReservation(
        CollateralVaultDependencies memory deps,
        mapping(AccountId accountId => CollateralAccount account) storage $accounts,
        mapping(AccountId accountId => mapping(address operator => uint64 approvalEpoch)) storage $lockOperators,
        mapping(CollateralLockId lockId => CollateralLock lock) storage $locks,
        mapping(AccountId accountId => mapping(CollateralId collateralId => uint128 amount)) storage $preTradeLocked,
        mapping(AccountId accountId => mapping(CollateralId collateralId => uint128 amount)) storage $terminalReserved,
        mapping(CollateralId collateralId => uint256 amount) storage $preTradeEncumbrance,
        mapping(CollateralId collateralId => uint256 amount) storage $terminalReservationEncumbrance,
        mapping(
            TerminalLiabilityReservationId reservationId => TerminalLiabilityReservation reservation
        ) storage $terminalLiabilityReservations,
        mapping(
            RiskDomainId riskDomainId => mapping(uint32 version => uint256 amount)
        ) storage $riskDomainTerminalLiability,
        mapping(
            AccountId accountId => mapping(RiskDomainId riskDomainId => mapping(uint32 version => uint256 amount))
        ) storage $accountRiskDomainTerminalLiability,
        CollateralLockId lockId,
        bytes32 positionId,
        RiskDomainId riskDomainId,
        uint32 riskDomainVersion,
        uint128 amount
    ) external returns (TerminalLiabilityReservationId reservationId) {
        _requireTerminalReservationInputs(positionId, riskDomainId, riskDomainVersion, amount);

        CollateralLock storage lock = _requireActiveLock($locks, lockId);
        if (msg.sender != lock.operator) {
            revert ICollateralVault.NotLockOperator(lockId, msg.sender);
        }
        if (!_isLockOperator($accounts, $lockOperators, lock.accountId, msg.sender)) {
            revert ICollateralVault.LockOperatorNotApproved(lock.accountId, msg.sender);
        }
        if (block.timestamp >= lock.expiry) {
            revert ICollateralVault.LockExpired(lockId, lock.expiry);
        }
        if (!deps.settlementAssetRegistry.isOpenForNewRisk(lock.assetId, lock.bindingVersion)) {
            revert ICollateralVault.BindingClosedForNewRisk(lock.assetId, lock.bindingVersion);
        }

        {
            address positionEngine = lock.settlementOperator;
            PositionEngineQualification memory engine = _requirePositionEngineForNewRisk(positionEngine, positionId);

            uint128 lockRemaining = lock.remainingAmount;
            if (amount > lockRemaining) {
                revert ICollateralVault.AmountAboveLockRemaining(lockId, lockRemaining, amount);
            }
            _requireRiskDomainForReservation(
                deps,
                $riskDomainTerminalLiability,
                $accountRiskDomainTerminalLiability,
                lock.accountId,
                lock.assetId,
                lock.bindingVersion,
                riskDomainId,
                riskDomainVersion,
                amount
            );

            reservationId = _deriveTerminalLiabilityReservationId(positionEngine, engine.positionEngineId, positionId);
            _requireUnusedTerminalLiabilityReservation($terminalLiabilityReservations, reservationId);

            uint128 newLockRemaining = lockRemaining - amount;
            lock.remainingAmount = newLockRemaining;
            if (newLockRemaining == 0) {
                lock.status = LockStatus.Consumed;
            }

            AccountId payerAccountId = lock.accountId;
            CollateralId collateralId = lock.collateralId;
            $preTradeLocked[payerAccountId][collateralId] -= amount;
            $preTradeEncumbrance[collateralId] -= amount;
            $terminalReserved[payerAccountId][collateralId] += amount;
            $terminalReservationEncumbrance[collateralId] += amount;

            TerminalLiabilityReservation storage reservation = $terminalLiabilityReservations[reservationId];
            reservation.positionId = positionId;
            reservation.payerAccountId = payerAccountId;
            reservation.collateralId = collateralId;
            reservation.assetId = lock.assetId;
            reservation.riskDomainId = riskDomainId;
            reservation.creator = msg.sender;
            reservation.positionEngine = positionEngine;
            reservation.positionEngineId = engine.positionEngineId;
            reservation.positionEngineCodeHash = engine.positionEngineCodeHash;
            reservation.bindingVersion = lock.bindingVersion;
            reservation.riskDomainVersion = riskDomainVersion;
            reservation.settlementDeadline = engine.settlementDeadline;
            reservation.finalResolutionAt = engine.finalResolutionAt;
            reservation.status = TerminalLiabilityReservationStatus.Active;
            reservation.initialAmount = amount;
            reservation.remainingAmount = amount;

            _increaseRiskDomainTerminalLiability(
                $riskDomainTerminalLiability,
                $accountRiskDomainTerminalLiability,
                payerAccountId,
                riskDomainId,
                riskDomainVersion,
                amount
            );
        }

        _emitCollateralLockConverted(lockId, reservationId, lock, amount);
        _emitTerminalLiabilityReservationCreated(reservationId, $terminalLiabilityReservations[reservationId], lockId);
    }

    function consumeLock(
        mapping(AccountId accountId => CollateralAccount account) storage $accounts,
        mapping(
            AccountId accountId => mapping(CollateralId collateralId => CollateralBalance balance)
        ) storage $balances,
        mapping(CollateralLockId lockId => CollateralLock lock) storage $locks,
        mapping(
            AccountId accountId
                => mapping(
                CollateralId collateralId => uint128 amount
            )
        ) storage $preTradeLocked,
        mapping(CollateralId collateralId => uint256 amount) storage $preTradeEncumbrance,
        CollateralLockId lockId,
        AccountId recipientAccountId,
        uint128 amount
    ) external {
        CollateralLock storage lock = _requireActiveLock($locks, lockId);
        address pinnedSettlementOperator = lock.settlementOperator;
        if (msg.sender != pinnedSettlementOperator) {
            revert ICollateralVault.NotLockSettlementOperator(lockId, pinnedSettlementOperator, msg.sender);
        }
        if (block.timestamp >= lock.expiry) {
            revert ICollateralVault.LockExpired(lockId, lock.expiry);
        }
        _requireAccount($accounts, recipientAccountId);
        if (amount == 0) {
            revert ICollateralVault.ZeroAmount();
        }

        AccountId payerAccountId = lock.accountId;
        if (AccountId.unwrap(payerAccountId) == AccountId.unwrap(recipientAccountId)) {
            revert ICollateralVault.SelfConsumption(payerAccountId);
        }

        uint128 remaining = lock.remainingAmount;
        if (amount > remaining) {
            revert ICollateralVault.AmountAboveLockRemaining(lockId, remaining, amount);
        }

        CollateralId collateralId = lock.collateralId;
        CollateralBalance storage payerBalance = $balances[payerAccountId][collateralId];
        payerBalance.total = payerBalance.total - amount;
        payerBalance.locked = payerBalance.locked - amount;
        $preTradeLocked[payerAccountId][collateralId] -= amount;
        $preTradeEncumbrance[collateralId] -= amount;

        _creditTotal($balances, recipientAccountId, collateralId, amount);

        remaining = remaining - amount;
        lock.remainingAmount = remaining;

        LockStatus newStatus = LockStatus.Active;
        if (remaining == 0) {
            newStatus = LockStatus.Consumed;
            lock.status = newStatus;
        }

        emit ICollateralVault.CollateralLockConsumed(
            lockId, payerAccountId, recipientAccountId, collateralId, amount, remaining, newStatus, msg.sender
        );
    }

    function _finalizeTerminalLiabilityReservation(
        mapping(AccountId accountId => CollateralAccount account) storage $accounts,
        mapping(
            AccountId accountId => mapping(CollateralId collateralId => CollateralBalance balance)
        ) storage $balances,
        mapping(AccountId accountId => mapping(CollateralId collateralId => uint128 amount)) storage $terminalReserved,
        mapping(
            AccountId accountId => mapping(CollateralId collateralId => uint128 amount)
        ) storage $terminalClaimBacking,
        mapping(CollateralId collateralId => uint256 amount) storage $terminalReservationEncumbrance,
        mapping(CollateralId collateralId => uint256 amount) storage $terminalClaimEncumbrance,
        mapping(
            TerminalLiabilityReservationId reservationId => TerminalLiabilityReservation reservation
        ) storage $terminalLiabilityReservations,
        mapping(TerminalClaimId claimId => TerminalClaim claim) storage $terminalClaims,
        mapping(
            RiskDomainId riskDomainId => mapping(uint32 version => uint256 amount)
        ) storage $riskDomainTerminalLiability,
        mapping(
            AccountId accountId => mapping(RiskDomainId riskDomainId => mapping(uint32 version => uint256 amount))
        ) storage $accountRiskDomainTerminalLiability,
        TerminalLiabilityReservationId reservationId,
        bool requireFinalResolution
    ) external returns (TerminalClaimId claimId) {
        TerminalLiabilityReservation storage reservation =
            _requireActiveTerminalLiabilityReservation($terminalLiabilityReservations, reservationId);
        PositionTerminalState memory state = _readPinnedTerminalState(reservation);
        TerminalOutcomeKind outcome = state.outcome;
        if (outcome == TerminalOutcomeKind.Unspecified) {
            revert ICollateralVault.PositionNotTerminal(reservation.positionId);
        }

        if (requireFinalResolution && block.timestamp < reservation.finalResolutionAt) {
            revert ICollateralVault.TerminalClaimFallbackNotReached(
                reservation.finalResolutionAt, uint64(block.timestamp)
            );
        }

        if (outcome == TerminalOutcomeKind.NoEffect || outcome == TerminalOutcomeKind.Flat) {
            if (AccountId.unwrap(state.receiverAccountId) != bytes32(0) || state.amount != 0) {
                revert ICollateralVault.InvalidTerminalState(outcome, state.receiverAccountId, state.amount);
            }
            _releaseTerminalReservation(
                $balances,
                $terminalReserved,
                $terminalReservationEncumbrance,
                $riskDomainTerminalLiability,
                $accountRiskDomainTerminalLiability,
                reservationId,
                reservation,
                state
            );
            return TerminalClaimId.wrap(bytes32(0));
        }

        if (outcome != TerminalOutcomeKind.Payout && outcome != TerminalOutcomeKind.Claim) {
            revert ICollateralVault.InvalidTerminalState(outcome, state.receiverAccountId, state.amount);
        }
        if (outcome == TerminalOutcomeKind.Claim && block.timestamp < reservation.finalResolutionAt) {
            revert ICollateralVault.TerminalClaimFallbackNotReached(
                reservation.finalResolutionAt, uint64(block.timestamp)
            );
        }
        return _convertTerminalReservationToClaim(
            $accounts,
            $balances,
            $terminalReserved,
            $terminalClaimBacking,
            $terminalReservationEncumbrance,
            $terminalClaimEncumbrance,
            $terminalClaims,
            $riskDomainTerminalLiability,
            $accountRiskDomainTerminalLiability,
            reservationId,
            reservation,
            state
        );
    }

    function _releaseTerminalReservation(
        mapping(
            AccountId accountId => mapping(CollateralId collateralId => CollateralBalance balance)
        ) storage $balances,
        mapping(AccountId accountId => mapping(CollateralId collateralId => uint128 amount)) storage $terminalReserved,
        mapping(CollateralId collateralId => uint256 amount) storage $terminalReservationEncumbrance,
        mapping(
            RiskDomainId riskDomainId => mapping(uint32 version => uint256 amount)
        ) storage $riskDomainTerminalLiability,
        mapping(
            AccountId accountId => mapping(RiskDomainId riskDomainId => mapping(uint32 version => uint256 amount))
        ) storage $accountRiskDomainTerminalLiability,
        TerminalLiabilityReservationId reservationId,
        TerminalLiabilityReservation storage reservation,
        PositionTerminalState memory state
    ) internal {
        uint128 remaining = reservation.remainingAmount;
        AccountId payerAccountId = reservation.payerAccountId;
        CollateralId collateralId = reservation.collateralId;

        $balances[payerAccountId][collateralId].locked -= remaining;
        $terminalReserved[payerAccountId][collateralId] -= remaining;
        $terminalReservationEncumbrance[collateralId] -= remaining;
        _decreaseRiskDomainTerminalLiability(
            $riskDomainTerminalLiability,
            $accountRiskDomainTerminalLiability,
            payerAccountId,
            reservation.riskDomainId,
            reservation.riskDomainVersion,
            remaining
        );

        _terminalizeReservation(
            reservation,
            payerAccountId,
            0,
            state.terminalOutcomeReference,
            state.outcome,
            TerminalLiabilityReservationStatus.ReleasedAtTerminal
        );
        _emitTerminalLiabilityReservationResolved(reservationId, reservation, remaining);
    }

    function _convertTerminalReservationToClaim(
        mapping(AccountId accountId => CollateralAccount account) storage $accounts,
        mapping(
            AccountId accountId => mapping(CollateralId collateralId => CollateralBalance balance)
        ) storage $balances,
        mapping(AccountId accountId => mapping(CollateralId collateralId => uint128 amount)) storage $terminalReserved,
        mapping(
            AccountId accountId => mapping(CollateralId collateralId => uint128 amount)
        ) storage $terminalClaimBacking,
        mapping(CollateralId collateralId => uint256 amount) storage $terminalReservationEncumbrance,
        mapping(CollateralId collateralId => uint256 amount) storage $terminalClaimEncumbrance,
        mapping(TerminalClaimId claimId => TerminalClaim claim) storage $terminalClaims,
        mapping(
            RiskDomainId riskDomainId => mapping(uint32 version => uint256 amount)
        ) storage $riskDomainTerminalLiability,
        mapping(
            AccountId accountId => mapping(RiskDomainId riskDomainId => mapping(uint32 version => uint256 amount))
        ) storage $accountRiskDomainTerminalLiability,
        TerminalLiabilityReservationId reservationId,
        TerminalLiabilityReservation storage reservation,
        PositionTerminalState memory state
    ) internal returns (TerminalClaimId claimId) {
        _requireAccount($accounts, state.receiverAccountId);
        if (state.amount == 0) {
            revert ICollateralVault.InvalidTerminalState(state.outcome, state.receiverAccountId, state.amount);
        }
        if (AccountId.unwrap(state.receiverAccountId) == AccountId.unwrap(reservation.payerAccountId)) {
            revert ICollateralVault.SelfConsumption(state.receiverAccountId);
        }

        uint128 remaining = reservation.remainingAmount;
        if (state.amount > remaining) {
            revert ICollateralVault.AmountAboveTerminalLiabilityReservation(reservationId, remaining, state.amount);
        }
        claimId = _deriveTerminalClaimId(reservationId, state.terminalOutcomeReference);
        if ($terminalClaims[claimId].status != TerminalClaimStatus.Unspecified) {
            revert ICollateralVault.TerminalClaimAlreadyExists(claimId);
        }

        AccountId payerAccountId = reservation.payerAccountId;
        CollateralId collateralId = reservation.collateralId;
        uint128 releasedAmount = remaining - state.amount;
        $balances[payerAccountId][collateralId].locked -= releasedAmount;
        $terminalReserved[payerAccountId][collateralId] -= remaining;
        $terminalReservationEncumbrance[collateralId] -= remaining;
        $terminalClaimBacking[payerAccountId][collateralId] += state.amount;
        $terminalClaimEncumbrance[collateralId] += state.amount;
        _decreaseRiskDomainTerminalLiability(
            $riskDomainTerminalLiability,
            $accountRiskDomainTerminalLiability,
            payerAccountId,
            reservation.riskDomainId,
            reservation.riskDomainVersion,
            releasedAmount
        );

        TerminalClaim storage claim = $terminalClaims[claimId];
        claim.reservationId = reservationId;
        claim.positionId = reservation.positionId;
        claim.payerAccountId = payerAccountId;
        claim.receiverAccountId = state.receiverAccountId;
        claim.collateralId = collateralId;
        claim.riskDomainId = reservation.riskDomainId;
        claim.terminalOutcomeReference = state.terminalOutcomeReference;
        claim.status = TerminalClaimStatus.Active;
        claim.riskDomainVersion = reservation.riskDomainVersion;
        claim.amount = state.amount;

        _terminalizeReservation(
            reservation,
            state.receiverAccountId,
            state.amount,
            state.terminalOutcomeReference,
            state.outcome,
            TerminalLiabilityReservationStatus.ConvertedToClaim
        );

        _emitTerminalLiabilityReservationResolved(reservationId, reservation, releasedAmount);
        _emitTerminalClaimCreated(claimId, claim);
    }

    function _readPinnedTerminalState(TerminalLiabilityReservation storage reservation)
        internal
        view
        returns (PositionTerminalState memory state)
    {
        address positionEngine = reservation.positionEngine;
        bytes32 actualCodeHash = positionEngine.codehash;
        if (actualCodeHash != reservation.positionEngineCodeHash) {
            revert ICollateralVault.PositionEngineCodeChanged(
                positionEngine, reservation.positionEngineCodeHash, actualCodeHash
            );
        }
        bytes32 actualPositionEngineId = IPositionEngineTerminalState(positionEngine).positionEngineId();
        if (actualPositionEngineId != reservation.positionEngineId) {
            revert ICollateralVault.PositionEngineIdentityChanged(
                positionEngine, reservation.positionEngineId, actualPositionEngineId
            );
        }

        state = IPositionEngineTerminalState(positionEngine).terminalState(reservation.positionId);
        _requirePositionStateIdentity(reservation.positionId, state);
        if (
            state.settlementDeadline != reservation.settlementDeadline
                || state.finalResolutionAt != reservation.finalResolutionAt
        ) {
            revert ICollateralVault.PositionDeadlinesChanged(
                reservation.settlementDeadline,
                state.settlementDeadline,
                reservation.finalResolutionAt,
                state.finalResolutionAt
            );
        }
        if (state.terminalOutcomeReference == bytes32(0)) {
            revert ICollateralVault.PositionNotTerminal(reservation.positionId);
        }
    }

    function _emitTerminalLiabilityReservationResolved(
        TerminalLiabilityReservationId reservationId,
        TerminalLiabilityReservation storage reservation,
        uint128 releasedAmount
    ) internal {
        emit ICollateralVault.TerminalLiabilityReservationResolved(
            reservationId,
            reservation.positionId,
            reservation.terminalOutcomeReference,
            reservation.payerAccountId,
            reservation.terminalAccountId,
            reservation.collateralId,
            reservation.terminalAmount,
            releasedAmount,
            reservation.terminalOutcome,
            reservation.status,
            msg.sender
        );
    }

    function _emitTerminalClaimCreated(TerminalClaimId claimId, TerminalClaim storage claim) internal {
        emit ICollateralVault.TerminalClaimCreated(
            claimId,
            claim.reservationId,
            claim.positionId,
            claim.payerAccountId,
            claim.receiverAccountId,
            claim.collateralId,
            claim.terminalOutcomeReference,
            claim.amount
        );
    }

    function _terminalizeReservation(
        TerminalLiabilityReservation storage reservation,
        AccountId terminalAccountId,
        uint128 terminalAmount,
        bytes32 terminalOutcomeReference,
        TerminalOutcomeKind terminalOutcome,
        TerminalLiabilityReservationStatus status
    ) internal {
        reservation.remainingAmount = 0;
        reservation.terminalAccountId = terminalAccountId;
        reservation.terminalAmount = terminalAmount;
        reservation.terminalOutcomeReference = terminalOutcomeReference;
        reservation.terminalOutcome = terminalOutcome;
        reservation.status = status;
    }

    function _requirePositionEngineForNewRisk(address positionEngine, bytes32 positionId)
        internal
        view
        returns (PositionEngineQualification memory qualification)
    {
        if (positionEngine.code.length == 0) {
            revert ICollateralVault.PositionEngineHasNoCode(positionEngine);
        }
        if (!IAccessControl(address(this)).hasRole(TERMINAL_RESERVATION_RESOLVER_ROLE, positionEngine)) {
            revert ICollateralVault.PositionEngineNotAuthorized(positionEngine);
        }

        uint32 actualVersion = IPositionEngineTerminalState(positionEngine).terminalStateInterfaceVersion();
        if (actualVersion != POSITION_ENGINE_TERMINAL_STATE_INTERFACE_VERSION) {
            revert ICollateralVault.PositionEngineInterfaceVersionMismatch(
                positionEngine, POSITION_ENGINE_TERMINAL_STATE_INTERFACE_VERSION, actualVersion
            );
        }
        qualification.positionEngineId = IPositionEngineTerminalState(positionEngine).positionEngineId();
        if (qualification.positionEngineId == bytes32(0)) {
            revert ICollateralVault.ZeroPositionEngineId(positionEngine);
        }
        qualification.positionEngineCodeHash = positionEngine.codehash;
        PositionTerminalState memory state = IPositionEngineTerminalState(positionEngine).terminalState(positionId);
        _requirePositionStateIdentity(positionId, state);
        if (state.outcome != TerminalOutcomeKind.Unspecified) {
            revert ICollateralVault.PositionAlreadyTerminal(positionId, state.outcome);
        }
        uint64 nowTs = uint64(block.timestamp);
        if (
            state.finalResolutionAt <= nowTs || state.settlementDeadline < state.finalResolutionAt
                || state.settlementDeadline == 0
        ) {
            revert ICollateralVault.InvalidPositionDeadlines(state.settlementDeadline, state.finalResolutionAt, nowTs);
        }
        qualification.settlementDeadline = state.settlementDeadline;
        qualification.finalResolutionAt = state.finalResolutionAt;
    }

    function _requireRiskDomainForReservation(
        CollateralVaultDependencies memory deps,
        mapping(
            RiskDomainId riskDomainId => mapping(uint32 version => uint256 amount)
        ) storage $riskDomainTerminalLiability,
        mapping(
            AccountId accountId => mapping(RiskDomainId riskDomainId => mapping(uint32 version => uint256 amount))
        ) storage $accountRiskDomainTerminalLiability,
        AccountId payerAccountId,
        AssetId assetId,
        uint32 bindingVersion,
        RiskDomainId riskDomainId,
        uint32 riskDomainVersion,
        uint128 amount
    ) internal view {
        if (!deps.riskDomainRegistry.isOpenForNewRisk(riskDomainId, riskDomainVersion)) {
            revert ICollateralVault.RiskDomainNotOpenForNewRisk(riskDomainId, riskDomainVersion);
        }
        RiskDomainVersion memory record = deps.riskDomainRegistry.getRiskDomain(riskDomainId, riskDomainVersion);
        if (
            AssetId.unwrap(record.definition.collateralAssetId) != AssetId.unwrap(assetId)
                || record.definition.collateralAssetVersion != bindingVersion
        ) {
            revert ICollateralVault.RiskDomainCollateralMismatch(
                riskDomainId,
                riskDomainVersion,
                assetId,
                bindingVersion,
                record.definition.collateralAssetId,
                record.definition.collateralAssetVersion
            );
        }

        uint128 aggregateReservationCap = record.definition.maxAggregateReservationBaseUnits;
        uint128 accountReservationCap = record.definition.maxAccountReservationBaseUnits;
        if (aggregateReservationCap == 0 || accountReservationCap == 0) {
            revert ICollateralVault.TerminalReservationsDisabled(riskDomainId, riskDomainVersion);
        }

        uint256 aggregateCap = aggregateReservationCap;
        if (record.definition.maxAggregateLiabilityBaseUnits < aggregateCap) {
            aggregateCap = record.definition.maxAggregateLiabilityBaseUnits;
        }
        uint256 accountCap = accountReservationCap;
        if (record.definition.maxAccountLiabilityBaseUnits < accountCap) {
            accountCap = record.definition.maxAccountLiabilityBaseUnits;
        }

        uint256 aggregateRequested = $riskDomainTerminalLiability[riskDomainId][riskDomainVersion] + amount;
        if (aggregateRequested > aggregateCap) {
            revert ICollateralVault.AggregateTerminalLiabilityCapExceeded(
                riskDomainId, riskDomainVersion, aggregateCap, aggregateRequested
            );
        }
        uint256 accountRequested =
            $accountRiskDomainTerminalLiability[payerAccountId][riskDomainId][riskDomainVersion] + amount;
        if (accountRequested > accountCap) {
            revert ICollateralVault.AccountTerminalLiabilityCapExceeded(
                riskDomainId, riskDomainVersion, payerAccountId, accountCap, accountRequested
            );
        }
    }

    function _requireTerminalReservationInputs(
        bytes32 positionId,
        RiskDomainId riskDomainId,
        uint32 riskDomainVersion,
        uint128 amount
    ) internal pure {
        if (positionId == bytes32(0)) {
            revert ICollateralVault.ZeroPositionId();
        }
        if (RiskDomainId.unwrap(riskDomainId) == bytes32(0)) {
            revert ICollateralVault.ZeroRiskDomainId();
        }
        if (riskDomainVersion == 0) {
            revert ICollateralVault.ZeroRiskDomainVersion();
        }
        if (amount == 0) {
            revert ICollateralVault.ZeroAmount();
        }
    }

    function _emitCollateralLockConverted(
        CollateralLockId lockId,
        TerminalLiabilityReservationId reservationId,
        CollateralLock storage lock,
        uint128 convertedAmount
    ) internal {
        emit ICollateralVault.CollateralLockConverted(
            lockId,
            reservationId,
            lock.accountId,
            lock.collateralId,
            convertedAmount,
            lock.remainingAmount,
            lock.status,
            msg.sender
        );
    }

    function _decreaseRiskDomainTerminalLiability(
        mapping(
            RiskDomainId riskDomainId => mapping(uint32 version => uint256 amount)
        ) storage $riskDomainTerminalLiability,
        mapping(
            AccountId accountId => mapping(RiskDomainId riskDomainId => mapping(uint32 version => uint256 amount))
        ) storage $accountRiskDomainTerminalLiability,
        AccountId payerAccountId,
        RiskDomainId riskDomainId,
        uint32 riskDomainVersion,
        uint128 amount
    ) internal {
        $riskDomainTerminalLiability[riskDomainId][riskDomainVersion] -= amount;
        $accountRiskDomainTerminalLiability[payerAccountId][riskDomainId][riskDomainVersion] -= amount;
    }

    function _increaseRiskDomainTerminalLiability(
        mapping(
            RiskDomainId riskDomainId => mapping(uint32 version => uint256 amount)
        ) storage $riskDomainTerminalLiability,
        mapping(
            AccountId accountId => mapping(RiskDomainId riskDomainId => mapping(uint32 version => uint256 amount))
        ) storage $accountRiskDomainTerminalLiability,
        AccountId payerAccountId,
        RiskDomainId riskDomainId,
        uint32 riskDomainVersion,
        uint128 amount
    ) internal {
        $riskDomainTerminalLiability[riskDomainId][riskDomainVersion] += amount;
        $accountRiskDomainTerminalLiability[payerAccountId][riskDomainId][riskDomainVersion] += amount;
    }

    function _requireActiveTerminalLiabilityReservation(
        mapping(
            TerminalLiabilityReservationId reservationId => TerminalLiabilityReservation reservation
        ) storage $terminalLiabilityReservations,
        TerminalLiabilityReservationId reservationId
    ) internal view returns (TerminalLiabilityReservation storage reservation) {
        reservation = $terminalLiabilityReservations[reservationId];
        TerminalLiabilityReservationStatus status = reservation.status;
        if (status == TerminalLiabilityReservationStatus.Unspecified) {
            revert ICollateralVault.UnknownTerminalLiabilityReservation(reservationId);
        }
        if (status != TerminalLiabilityReservationStatus.Active) {
            revert ICollateralVault.TerminalLiabilityReservationNotActive(reservationId, status);
        }
    }

    function _requireUnusedTerminalLiabilityReservation(
        mapping(
            TerminalLiabilityReservationId reservationId => TerminalLiabilityReservation reservation
        ) storage $terminalLiabilityReservations,
        TerminalLiabilityReservationId reservationId
    ) internal view {
        if ($terminalLiabilityReservations[reservationId].status != TerminalLiabilityReservationStatus.Unspecified) {
            revert ICollateralVault.TerminalLiabilityReservationAlreadyExists(reservationId);
        }
    }

    function _deriveTerminalLiabilityReservationId(address positionEngine, bytes32 positionEngineId, bytes32 positionId)
        internal
        view
        returns (TerminalLiabilityReservationId)
    {
        return CollateralIdLib.deriveTerminalLiabilityReservationId(
            block.chainid, address(this), positionEngine, positionEngineId, positionId
        );
    }

    function _deriveTerminalClaimId(TerminalLiabilityReservationId reservationId, bytes32 terminalOutcomeReference)
        internal
        view
        returns (TerminalClaimId)
    {
        return
            CollateralIdLib.deriveTerminalClaimId(block.chainid, address(this), reservationId, terminalOutcomeReference);
    }

    function _emitTerminalLiabilityReservationCreated(
        TerminalLiabilityReservationId reservationId,
        TerminalLiabilityReservation storage reservation,
        CollateralLockId sourceLockId
    ) internal {
        emit ICollateralVault.TerminalLiabilityReservationCreated(
            reservationId,
            reservation.positionId,
            reservation.payerAccountId,
            reservation.collateralId,
            reservation.assetId,
            reservation.riskDomainId,
            reservation.bindingVersion,
            reservation.riskDomainVersion,
            reservation.creator,
            reservation.positionEngine,
            reservation.positionEngineId,
            reservation.positionEngineCodeHash,
            reservation.initialAmount,
            reservation.settlementDeadline,
            reservation.finalResolutionAt,
            sourceLockId
        );
    }

    function _requirePositionStateIdentity(bytes32 positionId, PositionTerminalState memory state) internal pure {
        if (state.positionId != positionId) {
            revert ICollateralVault.PositionStateMismatch(positionId, state.positionId);
        }
    }

    function _requireAccount(
        mapping(AccountId accountId => CollateralAccount account) storage $accounts,
        AccountId accountId
    ) internal view {
        if ($accounts[accountId].controller == address(0)) {
            revert ICollateralVault.UnknownAccount(accountId);
        }
    }

    /// @dev An approval counts only while the epoch it was written under is still the account's
    /// current one. The nonzero test carries the unknown-account case for free: such an account has
    /// epoch zero and every stored approval against it is also zero.
    function _isLockOperator(
        mapping(AccountId accountId => CollateralAccount account) storage $accounts,
        mapping(AccountId accountId => mapping(address operator => uint64 approvalEpoch)) storage $lockOperators,
        AccountId accountId,
        address operator
    ) internal view returns (bool) {
        uint64 approvalEpoch = $lockOperators[accountId][operator];
        return approvalEpoch != 0 && approvalEpoch == $accounts[accountId].lockOperatorEpoch;
    }

    function _requireActiveLock(
        mapping(CollateralLockId lockId => CollateralLock lock) storage $locks,
        CollateralLockId lockId
    ) internal view returns (CollateralLock storage lock) {
        lock = $locks[lockId];
        LockStatus status = lock.status;
        if (status == LockStatus.Unspecified) {
            revert ICollateralVault.UnknownLock(lockId);
        }
        if (status != LockStatus.Active) {
            revert ICollateralVault.LockNotActive(lockId, status);
        }
    }

    function _pledgeAvailable(
        mapping(
            AccountId accountId => mapping(CollateralId collateralId => CollateralBalance balance)
        ) storage $balances,
        AccountId accountId,
        CollateralId collateralId,
        uint128 amount
    ) internal {
        CollateralBalance storage balance = $balances[accountId][collateralId];
        uint128 available = balance.total - balance.locked;
        if (available < amount) {
            revert ICollateralVault.InsufficientAvailable(accountId, collateralId, available, amount);
        }
        balance.locked = balance.locked + amount;
    }

    function _creditTotal(
        mapping(
            AccountId accountId => mapping(CollateralId collateralId => CollateralBalance balance)
        ) storage $balances,
        AccountId accountId,
        CollateralId collateralId,
        uint128 amount
    ) internal returns (uint128 newTotal) {
        CollateralBalance storage balance = $balances[accountId][collateralId];
        newTotal = _addTotal(accountId, collateralId, balance.total, amount);
        balance.total = newTotal;
    }

    /// @dev A named overflow outcome rather than an opaque Panic(0x11), so an exhausted uint128
    /// balance is a stated protocol failure instead of an arithmetic accident.
    function _addTotal(AccountId accountId, CollateralId collateralId, uint128 current, uint128 amount)
        internal
        pure
        returns (uint128)
    {
        uint256 next = uint256(current) + uint256(amount);
        if (next > type(uint128).max) {
            revert ICollateralVault.BalanceOverflow(accountId, collateralId, current, amount);
        }
        return uint128(next);
    }

    function _collateralId(CollateralVaultDependencies memory deps, AssetId assetId, uint32 bindingVersion)
        internal
        view
        returns (CollateralId)
    {
        return CollateralIdLib.deriveCollateralId(
            block.chainid, address(deps.settlementAssetRegistry), assetId, bindingVersion
        );
    }
}
