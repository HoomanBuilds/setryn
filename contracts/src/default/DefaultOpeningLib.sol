// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IDefaultProcessEngine} from "../interfaces/IDefaultProcessEngine.sol";
import {IDefaultRiskSource} from "../interfaces/IDefaultRiskSource.sol";
import {DefaultProcessLib} from "../libraries/DefaultProcessLib.sol";
import {RiskDomainDefinitionLib} from "../libraries/RiskDomainDefinitionLib.sol";
import {CollateralLock} from "../types/CollateralTypes.sol";
import {
    DefaultProcess,
    DefaultProcessId,
    DefaultProcessRules,
    DefaultProcessStatus,
    InsurancePolicy,
    ObjectiveDefaultState
} from "../types/DefaultTypes.sol";
import {LockStatus} from "../types/Enums.sol";
import {AccountId, CollateralLockId, PositionId, RiskDomainId} from "../types/Identifiers.sol";
import {RiskDomainVersion} from "../types/RiskDomainDefinition.sol";
import {DefaultProcessDependencies} from "./DefaultProcessTypes.sol";

/// Linked logic for the default process engine: opening, cure collateral, cure checks, and phase advancement.
/// Runs through DELEGATECALL in the engine's context against its storage.
library DefaultOpeningLib {
    bytes32 internal constant CURE_LOCK = keccak256("SETRYN_DEFAULT_CURE_COLLATERAL");
    uint16 internal constant HARD_MAXIMUM_BIDS = 32;

    function lockCureCollateral(
        DefaultProcessDependencies memory deps,
        mapping(DefaultProcessId processId => DefaultProcess process) storage $processes,
        DefaultProcessId processId,
        uint128 amountMinor
    ) external {
        if (amountMinor == 0) revert IDefaultProcessEngine.ZeroAmount();
        DefaultProcess storage process = _requireProcess($processes, processId);
        if (process.status != DefaultProcessStatus.CureOpen) {
            revert IDefaultProcessEngine.InvalidDefaultProcessStatus(process.status);
        }
        if (block.timestamp >= process.cureEndsAt) {
            revert IDefaultProcessEngine.PhaseClosed(process.cureEndsAt, block.timestamp);
        }
        if (CollateralLockId.unwrap(process.cureCollateralLockId) != bytes32(0)) {
            revert IDefaultProcessEngine.InvalidBidFunding();
        }
        RiskDomainVersion memory domain =
            deps.riskDomainRegistry.getRiskDomain(process.riskDomainId, process.riskDomainVersion);
        process.cureCollateralLockId = _createLock(
            deps,
            keccak256(abi.encode(CURE_LOCK, DefaultProcessId.unwrap(processId))),
            process.accountId,
            domain,
            amountMinor,
            process.settlementDeadline
        );
        process.cureCollateralMinor = amountMinor;
        process.lockedDefaulterCollateralMinor += amountMinor;
        emit IDefaultProcessEngine.CureCollateralLocked(
            processId, CollateralLockId.unwrap(process.cureCollateralLockId), amountMinor, msg.sender
        );
    }

    function recheckCure(
        DefaultProcessDependencies memory deps,
        mapping(DefaultProcessId processId => DefaultProcess process) storage $processes,
        DefaultProcessId processId,
        DefaultProcessRules calldata rules
    ) external returns (bool cured) {
        DefaultProcess storage process = _requireProcess($processes, processId);
        _requireRules(process, rules);
        if (process.status == DefaultProcessStatus.Cured) return true;
        if (process.status != DefaultProcessStatus.CureOpen) {
            revert IDefaultProcessEngine.InvalidDefaultProcessStatus(process.status);
        }
        if (block.timestamp >= process.cureEndsAt) {
            revert IDefaultProcessEngine.PhaseClosed(process.cureEndsAt, block.timestamp);
        }
        ObjectiveDefaultState memory state =
            readState(deps, process.positionId, process.accountId, process.riskDomainId, process.riskDomainVersion);
        requireFreshState(state, rules.maximumProofAgeSeconds, process.openingRiskSequence);
        if (state.deficiencyMinor != 0) return false;
        _markCured(deps, process, state.stateHash);
        return true;
    }

    function advanceProcess(
        DefaultProcessDependencies memory deps,
        mapping(DefaultProcessId processId => DefaultProcess process) storage $processes,
        DefaultProcessId processId,
        DefaultProcessRules calldata rules
    ) external {
        DefaultProcess storage process = _requireProcess($processes, processId);
        _requireRules(process, rules);
        if (process.status == DefaultProcessStatus.CureOpen) {
            if (block.timestamp < process.cureEndsAt) {
                revert IDefaultProcessEngine.PhaseNotOpen(process.cureEndsAt, block.timestamp);
            }
            ObjectiveDefaultState memory state =
                readState(deps, process.positionId, process.accountId, process.riskDomainId, process.riskDomainVersion);
            requireFreshState(state, rules.maximumProofAgeSeconds, process.openingRiskSequence);
            if (state.deficiencyMinor == 0) {
                _markCured(deps, process, state.stateHash);
                return;
            }
            process.deficiencyMinor = state.deficiencyMinor;
            process.uncuredProofHash = state.stateHash;
            process.uncuredRiskSequence = state.sequence;
            _setStatus(process, DefaultProcessStatus.CommitOpen, state.stateHash);
            return;
        }
        if (process.status == DefaultProcessStatus.CommitOpen) {
            if (block.timestamp < process.commitEndsAt) {
                revert IDefaultProcessEngine.PhaseNotOpen(process.commitEndsAt, block.timestamp);
            }
            _setStatus(process, DefaultProcessStatus.RevealOpen, process.uncuredProofHash);
            return;
        }
        if (process.status == DefaultProcessStatus.RevealOpen) {
            if (block.timestamp < process.revealEndsAt) {
                revert IDefaultProcessEngine.PhaseNotOpen(process.revealEndsAt, block.timestamp);
            }
            _setStatus(process, DefaultProcessStatus.ReadyToClear, process.uncuredProofHash);
            return;
        }
        if (
            process.status == DefaultProcessStatus.AuctionCleared && block.timestamp >= process.executionEndsAt
                && block.timestamp < process.finalResolutionAt
        ) {
            _setStatus(process, DefaultProcessStatus.RecoveryRequired, process.uncuredProofHash);
            return;
        }
        revert IDefaultProcessEngine.InvalidDefaultProcessStatus(process.status);
    }

    function readState(
        DefaultProcessDependencies memory deps,
        PositionId positionId,
        AccountId accountId,
        RiskDomainId riskDomainId,
        uint32 riskDomainVersion
    ) public view returns (ObjectiveDefaultState memory state) {
        state = IDefaultRiskSource(address(deps.portfolioRiskEngine))
            .objectiveDefaultState(positionId, accountId, riskDomainId, riskDomainVersion);
        if (
            PositionId.unwrap(state.positionId) != PositionId.unwrap(positionId)
                || AccountId.unwrap(state.accountId) != AccountId.unwrap(accountId)
                || RiskDomainId.unwrap(state.riskDomainId) != RiskDomainId.unwrap(riskDomainId)
                || state.riskDomainVersion != riskDomainVersion
                || state.stateHash != DefaultProcessLib.hashObjectiveState(state)
                || state.maintenanceRequirementMinor < state.collateralValueMinor
                || state.deficiencyMinor != state.maintenanceRequirementMinor - state.collateralValueMinor
        ) revert IDefaultProcessEngine.DefaultStateMismatch();
    }

    function requireFreshState(ObjectiveDefaultState memory state, uint32 maximumAge, uint64 previousSequence)
        public
        view
    {
        if (state.evaluatedAt > block.timestamp || block.timestamp - state.evaluatedAt > maximumAge) {
            revert IDefaultProcessEngine.StaleDefaultProof(state.evaluatedAt, block.timestamp);
        }
        if (state.sequence <= previousSequence) {
            revert IDefaultProcessEngine.DefaultProofNotNewer(previousSequence, state.sequence);
        }
    }

    function requireDomain(
        DefaultProcessDependencies memory deps,
        RiskDomainId riskDomainId,
        uint32 riskDomainVersion,
        DefaultProcessRules calldata rules,
        InsurancePolicy calldata policy
    ) external view returns (RiskDomainVersion memory domain) {
        domain = _requireInsuranceDomain(deps, riskDomainId, riskDomainVersion, policy);
        bytes32 rulesHash = DefaultProcessLib.hashRules(rules);
        if (rulesHash != domain.definition.defaultProcessHash) {
            revert IDefaultProcessEngine.InvalidPolicyWitness(domain.definition.defaultProcessHash, rulesHash);
        }
    }

    function validateRules(DefaultProcessRules calldata rules, InsurancePolicy calldata policy, AccountId accountId)
        external
        pure
    {
        if (
            rules.maximumProofAgeSeconds == 0 || rules.cureWindowSeconds == 0 || rules.commitWindowSeconds == 0
                || rules.revealWindowSeconds == 0 || rules.executionWindowSeconds == 0 || rules.maximumBids == 0
                || rules.maximumBids > HARD_MAXIMUM_BIDS || rules.requiredBondMinor == 0
                || rules.minimumCapacityMinor == 0 || AccountId.unwrap(rules.recoveryAccountId) == bytes32(0)
                || AccountId.unwrap(rules.recoveryAccountId) == AccountId.unwrap(accountId)
                || rules.bidderQualificationHash == bytes32(0) || rules.scoringRuleId != DefaultProcessLib.SCORING_RULE
                || rules.terminalRuleId == bytes32(0) || policy.maximumDepositsPerDraw == 0
                || AccountId.unwrap(policy.insuranceAccountId) == bytes32(0)
                || AccountId.unwrap(policy.insuranceAccountId) == AccountId.unwrap(rules.recoveryAccountId)
                || policy.allocationRuleId != DefaultProcessLib.INSURANCE_ALLOCATION_RULE
        ) revert IDefaultProcessEngine.InvalidProcessRules();
    }

    function deriveDeadlines(uint64 finalResolutionAt, DefaultProcessRules calldata rules)
        external
        view
        returns (uint64 cureEndsAt, uint64 commitEndsAt, uint64 revealEndsAt, uint64 executionEndsAt)
    {
        cureEndsAt = _addDeadline(uint64(block.timestamp), rules.cureWindowSeconds, finalResolutionAt);
        commitEndsAt = _addDeadline(cureEndsAt, rules.commitWindowSeconds, finalResolutionAt);
        revealEndsAt = _addDeadline(commitEndsAt, rules.revealWindowSeconds, finalResolutionAt);
        executionEndsAt = _addDeadline(revealEndsAt, rules.executionWindowSeconds, finalResolutionAt);
    }

    function _addDeadline(uint64 start, uint32 duration, uint64 finalResolutionAt)
        internal
        pure
        returns (uint64 value)
    {
        uint256 candidate = uint256(start) + duration;
        if (candidate > finalResolutionAt) {
            revert IDefaultProcessEngine.DeadlineOutsideFinalResolution(uint64(candidate), finalResolutionAt);
        }
        return uint64(candidate);
    }

    function _markCured(DefaultProcessDependencies memory deps, DefaultProcess storage process, bytes32 proofHash)
        internal
    {
        _releaseDefaulterRemainder(deps, process);
        _setStatus(process, DefaultProcessStatus.Cured, proofHash);
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

    function _requireRules(DefaultProcess storage process, DefaultProcessRules calldata rules) internal view {
        bytes32 supplied = DefaultProcessLib.hashRules(rules);
        if (supplied != process.defaultProcessHash) {
            revert IDefaultProcessEngine.InvalidPolicyWitness(process.defaultProcessHash, supplied);
        }
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

    function _releaseDefaulterRemainder(DefaultProcessDependencies memory deps, DefaultProcess storage process)
        internal
    {
        _releaseIfActive(deps, process.defaulterCollateralLockId);
        _releaseIfActive(deps, process.cureCollateralLockId);
    }

    function _releaseIfActive(DefaultProcessDependencies memory deps, CollateralLockId lockId) internal {
        if (CollateralLockId.unwrap(lockId) == bytes32(0)) return;
        if (deps.collateralVault.lockStatusOf(lockId) != LockStatus.Active) return;
        CollateralLock memory lock = deps.collateralVault.getLock(lockId);
        if (block.timestamp < lock.expiry) deps.collateralVault.releaseLock(lockId);
        else deps.collateralVault.releaseExpiredLock(lockId);
    }
}
