// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IDefaultProcessEngine} from "../interfaces/IDefaultProcessEngine.sol";
import {DefaultProcessLib} from "../libraries/DefaultProcessLib.sol";
import {RiskDomainDefinitionLib} from "../libraries/RiskDomainDefinitionLib.sol";
import {CollateralLock} from "../types/CollateralTypes.sol";
import {
    DefaultExecutionResult,
    DefaultProcess,
    DefaultProcessId,
    DefaultProcessRules,
    DefaultProcessStatus,
    InsuranceDeposit,
    InsuranceDepositId,
    InsuranceDepositStatus,
    InsurancePolicy,
    InsuranceReservation,
    InsuranceReservationId,
    InsuranceReservationLine,
    InsuranceReservationStatus,
    LiquidationBidId,
    LiquidationBidRecord,
    LiquidationBidStatus
} from "../types/DefaultTypes.sol";
import {LockStatus} from "../types/Enums.sol";
import {AccountId, CollateralId, CollateralLockId, PositionId, RiskDomainId} from "../types/Identifiers.sol";
import {PositionEconomics} from "../types/PositionTypes.sol";
import {RiskExposureReduction} from "../types/RiskTypes.sol";
import {RiskDomainVersion} from "../types/RiskDomainDefinition.sol";
import {DefaultProcessDependencies} from "./DefaultProcessTypes.sol";

/// Linked logic for the default process engine: insurance deposits and reservations, liquidation execution, and
/// terminal default resolution. Runs through DELEGATECALL in the engine's context against its storage.
library DefaultResolutionLib {
    bytes32 internal constant INSURANCE_LOCK = keccak256("SETRYN_DEFAULT_INSURANCE");

    function executeLiquidation(
        DefaultProcessDependencies memory deps,
        mapping(DefaultProcessId processId => DefaultProcess process) storage $processes,
        mapping(LiquidationBidId bidId => LiquidationBidRecord bid) storage $bids,
        mapping(InsuranceDepositId depositId => InsuranceDeposit deposit) storage $insuranceDeposits,
        mapping(
            InsuranceReservationId reservationId => InsuranceReservation reservation
        ) storage $insuranceReservations,
        DefaultProcessId processId,
        DefaultProcessRules calldata rules,
        InsurancePolicy calldata policy
    ) external returns (bytes32 outcomeHash) {
        DefaultProcess storage process = _requireProcess($processes, processId);
        _requireWitnesses(process, rules, policy);
        if (process.status == DefaultProcessStatus.Resolved) return process.outcomeHash;
        if (process.status != DefaultProcessStatus.AuctionCleared) {
            revert IDefaultProcessEngine.InvalidDefaultProcessStatus(process.status);
        }
        if (block.timestamp >= process.executionEndsAt) {
            revert IDefaultProcessEngine.PhaseClosed(process.executionEndsAt, block.timestamp);
        }
        if (
            process.insuranceDrawMinor != 0
                && InsuranceReservationId.unwrap(process.insuranceReservationId) == bytes32(0)
        ) revert IDefaultProcessEngine.InsuranceReservationMismatch();
        LiquidationBidRecord storage winner = $bids[process.winningBidId];
        uint128 defaulterApplied = _minimum(process.deficiencyMinor, process.lockedDefaulterCollateralMinor);
        _consumeDefaulter(deps, process, rules.recoveryAccountId, defaulterApplied);
        if (process.takeoverContributionMinor != 0) {
            deps.collateralVault
                .consumeLock(winner.capacityLockId, rules.recoveryAccountId, process.takeoverContributionMinor);
        }
        _releaseIfActive(deps, winner.capacityLockId);
        _consumeInsurance(deps, $insuranceDeposits, $insuranceReservations, process, rules.recoveryAccountId);
        DefaultExecutionResult memory result = deps.lifecycleExecutor
            .executeDefaultNovation(
                process, rules, policy, winner, process.insuranceDrawMinor, process.terminalResidualMinor
            );
        _reducePositionExposure(deps, process.positionId);
        _validateExecutionResult(
            result,
            winner.bidderAccountId,
            defaulterApplied,
            process.takeoverContributionMinor,
            process.insuranceDrawMinor,
            process.terminalResidualMinor
        );
        _releaseIfActive(deps, winner.bondLockId);
        winner.status = LiquidationBidStatus.Settled;
        _releaseDefaulterRemainder(deps, process);
        return _recordOutcome(process, result, DefaultProcessStatus.Resolved);
    }

    function resolveTerminalDefault(
        DefaultProcessDependencies memory deps,
        mapping(DefaultProcessId processId => DefaultProcess process) storage $processes,
        mapping(LiquidationBidId bidId => LiquidationBidRecord bid) storage $bids,
        mapping(InsuranceDepositId depositId => InsuranceDeposit deposit) storage $insuranceDeposits,
        mapping(
            InsuranceReservationId reservationId => InsuranceReservation reservation
        ) storage $insuranceReservations,
        DefaultProcessId processId,
        DefaultProcessRules calldata rules,
        InsurancePolicy calldata policy,
        InsuranceDepositId[] calldata depositIds
    ) external returns (bytes32 outcomeHash) {
        DefaultProcess storage process = _requireProcess($processes, processId);
        _requireWitnesses(process, rules, policy);
        if (process.status == DefaultProcessStatus.TerminalResolved) return process.outcomeHash;
        if (block.timestamp < process.finalResolutionAt) {
            revert IDefaultProcessEngine.PhaseNotOpen(process.finalResolutionAt, block.timestamp);
        }
        if (process.status == DefaultProcessStatus.Cured || process.status == DefaultProcessStatus.Resolved) {
            revert IDefaultProcessEngine.InvalidDefaultProcessStatus(process.status);
        }
        uint128 residual = process.deficiencyMinor;
        uint128 defaulterApplied = _minimum(residual, process.lockedDefaulterCollateralMinor);
        residual -= defaulterApplied;
        InsuranceReservationId existingReservationId = process.insuranceReservationId;
        if (InsuranceReservationId.unwrap(existingReservationId) != bytes32(0)) {
            _releaseReservation($insuranceDeposits, $insuranceReservations, existingReservationId);
            process.insuranceReservationId = InsuranceReservationId.wrap(bytes32(0));
        }
        uint128 fundedAvailable = _availableInsurance(deps, $insuranceDeposits, process, policy, depositIds);
        uint128 insuranceDraw = _minimum(_minimum(residual, policy.maximumDrawPerDefaultMinor), fundedAvailable);
        residual -= insuranceDraw;
        process.takeoverContributionMinor = 0;
        process.insuranceDrawMinor = insuranceDraw;
        process.terminalResidualMinor = residual;
        _reserveInsurance(deps, $insuranceDeposits, $insuranceReservations, process, policy, depositIds, insuranceDraw);
        _consumeDefaulter(deps, process, rules.recoveryAccountId, defaulterApplied);
        _consumeInsurance(deps, $insuranceDeposits, $insuranceReservations, process, rules.recoveryAccountId);
        if (LiquidationBidId.unwrap(process.winningBidId) != bytes32(0)) {
            LiquidationBidRecord storage winner = $bids[process.winningBidId];
            _releaseIfActive(deps, winner.bondLockId);
            _releaseIfActive(deps, winner.capacityLockId);
            winner.status = LiquidationBidStatus.Loser;
        }
        DefaultExecutionResult memory result =
            deps.lifecycleExecutor.applyTerminalDefaultRule(process, rules, policy, insuranceDraw, residual);
        _reducePositionExposure(deps, process.positionId);
        _validateExecutionResult(result, AccountId.wrap(bytes32(0)), defaulterApplied, 0, insuranceDraw, residual);
        _releaseDefaulterRemainder(deps, process);
        return _recordOutcome(process, result, DefaultProcessStatus.TerminalResolved);
    }

    function depositInsurance(
        DefaultProcessDependencies memory deps,
        mapping(InsuranceDepositId depositId => InsuranceDeposit deposit) storage $insuranceDeposits,
        RiskDomainId riskDomainId,
        uint32 riskDomainVersion,
        AccountId funderAccountId,
        uint128 amountMinor,
        uint64 expiry,
        bytes32 salt,
        InsurancePolicy calldata policy
    ) external returns (InsuranceDepositId depositId) {
        if (amountMinor == 0) revert IDefaultProcessEngine.ZeroAmount();
        if (salt == bytes32(0)) revert IDefaultProcessEngine.ZeroSalt();
        RiskDomainVersion memory domain = _requireInsuranceDomain(deps, riskDomainId, riskDomainVersion, policy);
        if (AccountId.unwrap(funderAccountId) != AccountId.unwrap(policy.insuranceAccountId)) {
            revert IDefaultProcessEngine.InsuranceDepositMismatch(InsuranceDepositId.wrap(bytes32(0)));
        }
        (address controller,) = deps.collateralVault.getAccount(funderAccountId);
        if (controller != msg.sender) revert IDefaultProcessEngine.BidderControllerMismatch(controller, msg.sender);
        if (expiry <= block.timestamp) revert IDefaultProcessEngine.PhaseClosed(expiry, block.timestamp);
        depositId = DefaultProcessLib.deriveInsuranceDepositId(
            block.chainid, address(this), riskDomainId, riskDomainVersion, funderAccountId, salt
        );
        if ($insuranceDeposits[depositId].status != InsuranceDepositStatus.Unspecified) return depositId;
        CollateralLockId lockId = _createLock(
            deps,
            keccak256(abi.encode(INSURANCE_LOCK, InsuranceDepositId.unwrap(depositId))),
            funderAccountId,
            domain,
            amountMinor,
            expiry
        );
        $insuranceDeposits[depositId] = InsuranceDeposit({
            depositId: depositId,
            funderAccountId: funderAccountId,
            riskDomainId: riskDomainId,
            collateralId: _domainCollateral(deps, domain),
            lockId: lockId,
            insurancePolicyHash: domain.definition.insurancePolicyHash,
            riskDomainVersion: riskDomainVersion,
            expiry: expiry,
            fundedMinor: amountMinor,
            reservedMinor: 0,
            consumedMinor: 0,
            status: InsuranceDepositStatus.Funded
        });
        emit IDefaultProcessEngine.InsuranceDeposited(
            depositId,
            riskDomainId,
            riskDomainVersion,
            funderAccountId,
            CollateralLockId.unwrap(lockId),
            amountMinor,
            expiry
        );
    }

    function reserveInsurance(
        DefaultProcessDependencies memory deps,
        mapping(DefaultProcessId processId => DefaultProcess process) storage $processes,
        mapping(InsuranceDepositId depositId => InsuranceDeposit deposit) storage $insuranceDeposits,
        mapping(
            InsuranceReservationId reservationId => InsuranceReservation reservation
        ) storage $insuranceReservations,
        DefaultProcessId processId,
        InsurancePolicy calldata policy,
        InsuranceDepositId[] calldata depositIds
    ) external returns (InsuranceReservationId reservationId) {
        DefaultProcess storage process = _requireProcess($processes, processId);
        _requirePolicy(process, policy);
        if (process.status != DefaultProcessStatus.AuctionCleared) {
            revert IDefaultProcessEngine.InvalidDefaultProcessStatus(process.status);
        }
        return _reserveInsurance(
            deps, $insuranceDeposits, $insuranceReservations, process, policy, depositIds, process.insuranceDrawMinor
        );
    }

    function withdrawInsuranceDeposit(
        DefaultProcessDependencies memory deps,
        mapping(InsuranceDepositId depositId => InsuranceDeposit deposit) storage $insuranceDeposits,
        InsuranceDepositId depositId
    ) external {
        InsuranceDeposit storage deposit = $insuranceDeposits[depositId];
        if (deposit.status == InsuranceDepositStatus.Unspecified) {
            revert IDefaultProcessEngine.UnknownInsuranceDeposit(depositId);
        }
        if (deposit.status == InsuranceDepositStatus.Withdrawn) return;
        (address controller,) = deps.collateralVault.getAccount(deposit.funderAccountId);
        if (controller != msg.sender) revert IDefaultProcessEngine.BidderControllerMismatch(controller, msg.sender);
        if (deposit.reservedMinor != 0 || deposit.status != InsuranceDepositStatus.Funded) {
            revert IDefaultProcessEngine.InsuranceDepositMismatch(depositId);
        }
        _releaseIfActive(deps, deposit.lockId);
        deposit.status = InsuranceDepositStatus.Withdrawn;
    }

    function _reserveInsurance(
        DefaultProcessDependencies memory deps,
        mapping(InsuranceDepositId depositId => InsuranceDeposit deposit) storage $insuranceDeposits,
        mapping(
            InsuranceReservationId reservationId => InsuranceReservation reservation
        ) storage $insuranceReservations,
        DefaultProcess storage process,
        InsurancePolicy calldata policy,
        InsuranceDepositId[] calldata depositIds,
        uint128 required
    ) internal returns (InsuranceReservationId reservationId) {
        if (required == 0) return InsuranceReservationId.wrap(bytes32(0));
        if (InsuranceReservationId.unwrap(process.insuranceReservationId) != bytes32(0)) {
            return process.insuranceReservationId;
        }
        if (depositIds.length == 0 || depositIds.length > policy.maximumDepositsPerDraw) {
            revert IDefaultProcessEngine.InsuranceFundingInsufficient(required, 0);
        }
        reservationId = DefaultProcessLib.deriveInsuranceReservationId(process.processId, required);
        if ($insuranceReservations[reservationId].status != InsuranceReservationStatus.Unspecified) {
            revert IDefaultProcessEngine.InsuranceAlreadyReserved(reservationId);
        }
        InsuranceReservation storage reservation = $insuranceReservations[reservationId];
        reservation.reservationId = reservationId;
        reservation.processId = process.processId;
        reservation.amountMinor = required;
        reservation.status = InsuranceReservationStatus.Reserved;
        uint128 remaining = required;
        bytes32 previous;
        for (uint256 i; i < depositIds.length && remaining != 0; ++i) {
            bytes32 current = InsuranceDepositId.unwrap(depositIds[i]);
            if (current <= previous) revert IDefaultProcessEngine.InsuranceDepositOrderMismatch(i);
            previous = current;
            InsuranceDeposit storage deposit = $insuranceDeposits[depositIds[i]];
            _requireInsuranceDeposit(deps, process, depositIds[i], deposit);
            uint128 available = deposit.fundedMinor - deposit.reservedMinor - deposit.consumedMinor;
            uint128 amount = _minimum(available, remaining);
            if (amount == 0) continue;
            deposit.reservedMinor += amount;
            reservation.lines.push(InsuranceReservationLine({depositId: depositIds[i], amountMinor: amount}));
            remaining -= amount;
        }
        if (remaining != 0) revert IDefaultProcessEngine.InsuranceFundingInsufficient(required, required - remaining);
        process.insuranceReservationId = reservationId;
        emit IDefaultProcessEngine.InsuranceReserved(
            reservationId, process.processId, required, keccak256(abi.encode(reservation.lines))
        );
    }

    function _availableInsurance(
        DefaultProcessDependencies memory deps,
        mapping(InsuranceDepositId depositId => InsuranceDeposit deposit) storage $insuranceDeposits,
        DefaultProcess storage process,
        InsurancePolicy calldata policy,
        InsuranceDepositId[] calldata depositIds
    ) internal view returns (uint128 availableTotal) {
        if (depositIds.length > policy.maximumDepositsPerDraw) {
            revert IDefaultProcessEngine.InsuranceFundingInsufficient(policy.maximumDrawPerDefaultMinor, 0);
        }
        bytes32 previous;
        for (uint256 i; i < depositIds.length; ++i) {
            bytes32 current = InsuranceDepositId.unwrap(depositIds[i]);
            if (current <= previous) revert IDefaultProcessEngine.InsuranceDepositOrderMismatch(i);
            previous = current;
            InsuranceDeposit storage deposit = $insuranceDeposits[depositIds[i]];
            _requireInsuranceDeposit(deps, process, depositIds[i], deposit);
            uint128 available = deposit.fundedMinor - deposit.reservedMinor - deposit.consumedMinor;
            uint256 next = uint256(availableTotal) + available;
            availableTotal = next > type(uint128).max ? type(uint128).max : uint128(next);
        }
    }

    function _consumeInsurance(
        DefaultProcessDependencies memory deps,
        mapping(InsuranceDepositId depositId => InsuranceDeposit deposit) storage $insuranceDeposits,
        mapping(
            InsuranceReservationId reservationId => InsuranceReservation reservation
        ) storage $insuranceReservations,
        DefaultProcess storage process,
        AccountId recipient
    ) internal {
        if (process.insuranceDrawMinor == 0) return;
        InsuranceReservation storage reservation = $insuranceReservations[process.insuranceReservationId];
        if (
            reservation.status != InsuranceReservationStatus.Reserved
                || reservation.amountMinor != process.insuranceDrawMinor
        ) revert IDefaultProcessEngine.InsuranceReservationMismatch();
        for (uint256 i; i < reservation.lines.length; ++i) {
            InsuranceReservationLine storage line = reservation.lines[i];
            InsuranceDeposit storage deposit = $insuranceDeposits[line.depositId];
            deposit.reservedMinor -= line.amountMinor;
            deposit.consumedMinor += line.amountMinor;
            deps.collateralVault.consumeLock(deposit.lockId, recipient, line.amountMinor);
            if (deposit.consumedMinor == deposit.fundedMinor) deposit.status = InsuranceDepositStatus.Exhausted;
        }
        reservation.status = InsuranceReservationStatus.Consumed;
        emit IDefaultProcessEngine.InsuranceConsumed(
            reservation.reservationId, process.processId, reservation.amountMinor
        );
    }

    function _releaseReservation(
        mapping(InsuranceDepositId depositId => InsuranceDeposit deposit) storage $insuranceDeposits,
        mapping(
            InsuranceReservationId reservationId => InsuranceReservation reservation
        ) storage $insuranceReservations,
        InsuranceReservationId reservationId
    ) internal {
        if (InsuranceReservationId.unwrap(reservationId) == bytes32(0)) return;
        InsuranceReservation storage reservation = $insuranceReservations[reservationId];
        if (reservation.status != InsuranceReservationStatus.Reserved) return;
        for (uint256 i; i < reservation.lines.length; ++i) {
            InsuranceReservationLine storage line = reservation.lines[i];
            $insuranceDeposits[line.depositId].reservedMinor -= line.amountMinor;
        }
        reservation.status = InsuranceReservationStatus.Released;
    }

    function _consumeDefaulter(
        DefaultProcessDependencies memory deps,
        DefaultProcess storage process,
        AccountId recipient,
        uint128 amount
    ) internal {
        uint128 remaining = amount;
        remaining = _consumeFromLock(deps, process.defaulterCollateralLockId, recipient, remaining);
        remaining = _consumeFromLock(deps, process.cureCollateralLockId, recipient, remaining);
        if (remaining != 0) revert IDefaultProcessEngine.InvalidExecutionResult();
    }

    function _consumeFromLock(
        DefaultProcessDependencies memory deps,
        CollateralLockId lockId,
        AccountId recipient,
        uint128 amount
    ) internal returns (uint128 remaining) {
        if (amount == 0 || CollateralLockId.unwrap(lockId) == bytes32(0)) return amount;
        CollateralLock memory lock = deps.collateralVault.getLock(lockId);
        uint128 consumed = _minimum(amount, lock.remainingAmount);
        if (consumed != 0) deps.collateralVault.consumeLock(lockId, recipient, consumed);
        return amount - consumed;
    }

    function _recordOutcome(
        DefaultProcess storage process,
        DefaultExecutionResult memory result,
        DefaultProcessStatus status
    ) internal returns (bytes32 outcomeHash) {
        outcomeHash = DefaultProcessLib.hashOutcome(
            process.processId,
            process.winningBidId,
            process.insuranceReservationId,
            result,
            process.terminalResidualMinor
        );
        process.outcomeHash = outcomeHash;
        _setStatus(process, status, outcomeHash);
        emit IDefaultProcessEngine.DefaultResolved(
            process.processId, outcomeHash, result.positionOutcomeReference, status, result
        );
    }

    function _validateExecutionResult(
        DefaultExecutionResult memory result,
        AccountId expectedSuccessor,
        uint128 defaulterApplied,
        uint128 takeoverApplied,
        uint128 insuranceApplied,
        uint128 terminalResidual
    ) internal pure {
        if (
            result.executionHash == bytes32(0) || result.positionOutcomeReference == bytes32(0)
                || AccountId.unwrap(result.successorAccountId) != AccountId.unwrap(expectedSuccessor)
                || result.defaulterCollateralAppliedMinor != defaulterApplied
                || result.takeoverContributionAppliedMinor != takeoverApplied
                || result.insuranceAppliedMinor != insuranceApplied || result.terminalResidualMinor != terminalResidual
                || result.unbackedClaimMinor != 0 || result.fullyBackedClaimMinor > terminalResidual
        ) revert IDefaultProcessEngine.InvalidExecutionResult();
    }

    function _reducePositionExposure(DefaultProcessDependencies memory deps, PositionId positionId) internal {
        (PositionEconomics memory economics,) = deps.portfolioRiskEngine.positionEngine().getPosition(positionId);
        _reduceAccountExposure(deps, positionId, economics.longAccountId);
        if (AccountId.unwrap(economics.shortAccountId) != AccountId.unwrap(economics.longAccountId)) {
            _reduceAccountExposure(deps, positionId, economics.shortAccountId);
        }
    }

    function _reduceAccountExposure(DefaultProcessDependencies memory deps, PositionId positionId, AccountId accountId)
        internal
    {
        RiskExposureReduction memory reduction =
            deps.portfolioRiskEngine.exposureReductionWitness(positionId, accountId);
        if (reduction.exposureId != bytes32(0)) deps.portfolioRiskEngine.reduceExposure(reduction);
    }

    function _requireInsuranceDeposit(
        DefaultProcessDependencies memory deps,
        DefaultProcess storage process,
        InsuranceDepositId depositId,
        InsuranceDeposit storage deposit
    ) internal view {
        if (
            deposit.status != InsuranceDepositStatus.Funded
                || RiskDomainId.unwrap(deposit.riskDomainId) != RiskDomainId.unwrap(process.riskDomainId)
                || deposit.riskDomainVersion != process.riskDomainVersion
                || CollateralId.unwrap(deposit.collateralId) != CollateralId.unwrap(process.collateralId)
                || deposit.insurancePolicyHash != process.insurancePolicyHash
                || deposit.expiry <= process.settlementDeadline
        ) revert IDefaultProcessEngine.InsuranceDepositMismatch(depositId);
        CollateralLock memory lock = deps.collateralVault.getLock(deposit.lockId);
        if (
            lock.status != LockStatus.Active || lock.settlementOperator != address(this)
                || CollateralId.unwrap(lock.collateralId) != CollateralId.unwrap(process.collateralId)
                || lock.remainingAmount != deposit.fundedMinor - deposit.consumedMinor
        ) revert IDefaultProcessEngine.InsuranceDepositMismatch(depositId);
    }

    function _requireInsuranceDomain(
        DefaultProcessDependencies memory deps,
        RiskDomainId riskDomainId,
        uint32 riskDomainVersion,
        InsurancePolicy calldata policy
    ) internal view returns (RiskDomainVersion memory domain) {
        if (!deps.riskDomainRegistry.isLifecycleEnabled(riskDomainId, riskDomainVersion)) {
            revert IDefaultProcessEngine.RiskDomainRecordMismatch();
        }
        domain = deps.riskDomainRegistry.getRiskDomain(riskDomainId, riskDomainVersion);
        bytes32 definitionHash = RiskDomainDefinitionLib.hashDefinition(domain.definition, block.chainid);
        if (
            domain.version != riskDomainVersion || domain.definitionHash != definitionHash
                || RiskDomainId.unwrap(RiskDomainDefinitionLib.deriveRiskDomainId(domain.definition))
                    != RiskDomainId.unwrap(riskDomainId)
                || domain.versionHash
                    != RiskDomainDefinitionLib.hashVersion(
                        riskDomainId, riskDomainVersion, definitionHash, block.chainid
                    )
        ) revert IDefaultProcessEngine.RiskDomainRecordMismatch();
        bytes32 policyHash = DefaultProcessLib.hashInsurancePolicy(policy);
        if (policyHash != domain.definition.insurancePolicyHash) {
            revert IDefaultProcessEngine.InvalidPolicyWitness(domain.definition.insurancePolicyHash, policyHash);
        }
    }

    function _requirePolicy(DefaultProcess storage process, InsurancePolicy calldata policy) internal view {
        bytes32 supplied = DefaultProcessLib.hashInsurancePolicy(policy);
        if (supplied != process.insurancePolicyHash) {
            revert IDefaultProcessEngine.InvalidPolicyWitness(process.insurancePolicyHash, supplied);
        }
    }

    function _requireWitnesses(
        DefaultProcess storage process,
        DefaultProcessRules calldata rules,
        InsurancePolicy calldata policy
    ) internal view {
        _requireRules(process, rules);
        _requirePolicy(process, policy);
    }

    function _createLock(
        DefaultProcessDependencies memory deps,
        bytes32 lockReference,
        AccountId accountId,
        RiskDomainVersion memory domain,
        uint128 amount,
        uint64 expiry
    ) internal returns (CollateralLockId) {
        return deps.collateralVault
            .createLock(
                lockReference,
                accountId,
                domain.definition.collateralAssetId,
                domain.definition.collateralAssetVersion,
                amount,
                expiry,
                address(this)
            );
    }

    function _domainCollateral(DefaultProcessDependencies memory deps, RiskDomainVersion memory domain)
        internal
        view
        returns (CollateralId)
    {
        return deps.collateralVault
            .deriveCollateralId(domain.definition.collateralAssetId, domain.definition.collateralAssetVersion);
    }

    function _releaseIfActive(DefaultProcessDependencies memory deps, CollateralLockId lockId) internal {
        if (CollateralLockId.unwrap(lockId) == bytes32(0)) return;
        if (deps.collateralVault.lockStatusOf(lockId) != LockStatus.Active) return;
        CollateralLock memory lock = deps.collateralVault.getLock(lockId);
        if (block.timestamp < lock.expiry) deps.collateralVault.releaseLock(lockId);
        else deps.collateralVault.releaseExpiredLock(lockId);
    }

    function _setStatus(DefaultProcess storage process, DefaultProcessStatus status, bytes32 evidenceHash) internal {
        DefaultProcessStatus previous = process.status;
        process.status = status;
        emit IDefaultProcessEngine.DefaultStatusChanged(process.processId, previous, status, evidenceHash, msg.sender);
    }

    function _requireProcess(
        mapping(DefaultProcessId processId => DefaultProcess process) storage $processes,
        DefaultProcessId processId
    ) internal view returns (DefaultProcess storage process) {
        process = $processes[processId];
        if (process.status == DefaultProcessStatus.Unspecified) {
            revert IDefaultProcessEngine.UnknownDefaultProcess(processId);
        }
    }

    function _minimum(uint128 left, uint128 right) internal pure returns (uint128) {
        return left < right ? left : right;
    }

    function _releaseDefaulterRemainder(DefaultProcessDependencies memory deps, DefaultProcess storage process)
        internal
    {
        _releaseIfActive(deps, process.defaulterCollateralLockId);
        _releaseIfActive(deps, process.cureCollateralLockId);
    }

    function _requireRules(DefaultProcess storage process, DefaultProcessRules calldata rules) internal view {
        bytes32 supplied = DefaultProcessLib.hashRules(rules);
        if (supplied != process.defaultProcessHash) {
            revert IDefaultProcessEngine.InvalidPolicyWitness(process.defaultProcessHash, supplied);
        }
    }
}
