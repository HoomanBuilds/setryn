// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IDefaultProcessEngine} from "../interfaces/IDefaultProcessEngine.sol";
import {DefaultProcessLib} from "../libraries/DefaultProcessLib.sol";
import {CollateralLock} from "../types/CollateralTypes.sol";
import {
    DefaultProcess,
    DefaultProcessId,
    DefaultProcessRules,
    DefaultProcessStatus,
    InsurancePolicy,
    LiquidationBidId,
    LiquidationBidRecord,
    LiquidationBidReveal,
    LiquidationBidStatus
} from "../types/DefaultTypes.sol";
import {LockStatus} from "../types/Enums.sol";
import {AccountId, CollateralLockId} from "../types/Identifiers.sol";
import {RiskDomainVersion} from "../types/RiskDomainDefinition.sol";
import {DefaultProcessDependencies} from "./DefaultProcessTypes.sol";

/// Linked logic for the default process engine: liquidation bid commitment, reveal, and auction clearing.
/// Runs through DELEGATECALL in the engine's context against its storage.
library DefaultAuctionLib {
    bytes32 internal constant BID_BOND_LOCK = keccak256("SETRYN_DEFAULT_BID_BOND");
    bytes32 internal constant BID_CAPACITY_LOCK = keccak256("SETRYN_DEFAULT_BID_CAPACITY");

    function commitBid(
        DefaultProcessDependencies memory deps,
        mapping(DefaultProcessId processId => DefaultProcess process) storage $processes,
        mapping(DefaultProcessId processId => LiquidationBidId[] bidIds) storage $processBidIds,
        mapping(LiquidationBidId bidId => LiquidationBidRecord bid) storage $bids,
        DefaultProcessId processId,
        DefaultProcessRules calldata rules,
        AccountId bidderAccountId,
        bytes32 sealedBidHash,
        bytes32 eligibilityEvidenceHash,
        uint128 capacityMinor
    ) external returns (LiquidationBidId bidId) {
        DefaultProcess storage process = _requireProcess($processes, processId);
        _requireRules(process, rules);
        if (process.status != DefaultProcessStatus.CommitOpen) {
            revert IDefaultProcessEngine.InvalidDefaultProcessStatus(process.status);
        }
        if (block.timestamp >= process.commitEndsAt) {
            revert IDefaultProcessEngine.PhaseClosed(process.commitEndsAt, block.timestamp);
        }
        if (sealedBidHash == bytes32(0) || eligibilityEvidenceHash == bytes32(0)) {
            revert IDefaultProcessEngine.BidCommitmentMismatch();
        }
        if (capacityMinor < rules.minimumCapacityMinor) revert IDefaultProcessEngine.InvalidBidFunding();
        LiquidationBidId[] storage bidIds = $processBidIds[processId];
        if (bidIds.length >= rules.maximumBids) revert IDefaultProcessEngine.BidCapacityReached(rules.maximumBids);
        (address controller,) = deps.collateralVault.getAccount(bidderAccountId);
        if (controller != msg.sender) revert IDefaultProcessEngine.BidderControllerMismatch(controller, msg.sender);
        if (!deps.bidderGate
                .isQualified(
                    processId,
                    msg.sender,
                    bidderAccountId,
                    process.riskDomainId,
                    process.riskDomainVersion,
                    rules.bidderQualificationHash,
                    eligibilityEvidenceHash
                )) revert IDefaultProcessEngine.BidderNotQualified(msg.sender, bidderAccountId);
        bidId = DefaultProcessLib.deriveBidId(processId, msg.sender, bidderAccountId, sealedBidHash);
        if ($bids[bidId].status != LiquidationBidStatus.Unspecified) return bidId;
        RiskDomainVersion memory domain =
            deps.riskDomainRegistry.getRiskDomain(process.riskDomainId, process.riskDomainVersion);
        CollateralLockId bondLockId = _createLock(
            deps,
            keccak256(abi.encode(BID_BOND_LOCK, LiquidationBidId.unwrap(bidId))),
            bidderAccountId,
            domain,
            rules.requiredBondMinor,
            process.settlementDeadline
        );
        CollateralLockId capacityLockId = _createLock(
            deps,
            keccak256(abi.encode(BID_CAPACITY_LOCK, LiquidationBidId.unwrap(bidId))),
            bidderAccountId,
            domain,
            capacityMinor,
            process.settlementDeadline
        );
        $bids[bidId] = LiquidationBidRecord({
            bidId: bidId,
            processId: processId,
            bidder: msg.sender,
            bidderAccountId: bidderAccountId,
            sealedBidHash: sealedBidHash,
            eligibilityEvidenceHash: eligibilityEvidenceHash,
            bondLockId: bondLockId,
            capacityLockId: capacityLockId,
            capacityMinor: capacityMinor,
            takeoverContributionMinor: 0,
            discountMinor: 0,
            maximumInsuranceDrawMinor: 0,
            status: LiquidationBidStatus.Committed
        });
        bidIds.push(bidId);
        emit IDefaultProcessEngine.LiquidationBidCommitted(
            processId,
            bidId,
            msg.sender,
            sealedBidHash,
            CollateralLockId.unwrap(bondLockId),
            CollateralLockId.unwrap(capacityLockId),
            capacityMinor
        );
    }

    function revealBid(
        DefaultProcessDependencies memory deps,
        mapping(DefaultProcessId processId => DefaultProcess process) storage $processes,
        mapping(LiquidationBidId bidId => LiquidationBidRecord bid) storage $bids,
        LiquidationBidId bidId,
        DefaultProcessRules calldata rules,
        InsurancePolicy calldata policy,
        LiquidationBidReveal calldata reveal
    ) external {
        LiquidationBidRecord storage bid = $bids[bidId];
        if (bid.status == LiquidationBidStatus.Unspecified) revert IDefaultProcessEngine.UnknownBid(bidId);
        if (bid.status != LiquidationBidStatus.Committed) {
            if (
                DefaultProcessLib.hashBidReveal(reveal) == bid.sealedBidHash
                    && bid.takeoverContributionMinor == reveal.takeoverContributionMinor
                    && bid.discountMinor == reveal.discountMinor
                    && bid.maximumInsuranceDrawMinor == reveal.maximumInsuranceDrawMinor
            ) return;
            revert IDefaultProcessEngine.BidCommitmentMismatch();
        }
        DefaultProcess storage process = _requireProcess($processes, bid.processId);
        _requireWitnesses(process, rules, policy);
        if (process.status != DefaultProcessStatus.RevealOpen) {
            revert IDefaultProcessEngine.InvalidDefaultProcessStatus(process.status);
        }
        if (block.timestamp >= process.revealEndsAt) {
            revert IDefaultProcessEngine.PhaseClosed(process.revealEndsAt, block.timestamp);
        }
        if (
            DefaultProcessId.unwrap(reveal.processId) != DefaultProcessId.unwrap(bid.processId)
                || reveal.bidder != bid.bidder || msg.sender != bid.bidder
                || AccountId.unwrap(reveal.bidderAccountId) != AccountId.unwrap(bid.bidderAccountId)
                || reveal.eligibilityEvidenceHash != bid.eligibilityEvidenceHash
                || DefaultProcessLib.hashBidReveal(reveal) != bid.sealedBidHash
        ) revert IDefaultProcessEngine.BidCommitmentMismatch();
        if (
            reveal.takeoverContributionMinor == 0 || reveal.takeoverContributionMinor > bid.capacityMinor
                || reveal.maximumInsuranceDrawMinor > policy.maximumDrawPerDefaultMinor
        ) revert IDefaultProcessEngine.InvalidBidFunding();
        if (!deps.bidderGate
                .isQualified(
                    bid.processId,
                    bid.bidder,
                    bid.bidderAccountId,
                    process.riskDomainId,
                    process.riskDomainVersion,
                    rules.bidderQualificationHash,
                    reveal.eligibilityEvidenceHash
                )) revert IDefaultProcessEngine.BidderNotQualified(bid.bidder, bid.bidderAccountId);
        bid.takeoverContributionMinor = reveal.takeoverContributionMinor;
        bid.discountMinor = reveal.discountMinor;
        bid.maximumInsuranceDrawMinor = reveal.maximumInsuranceDrawMinor;
        bid.status = LiquidationBidStatus.Revealed;
        emit IDefaultProcessEngine.LiquidationBidRevealed(
            bid.processId,
            bidId,
            reveal.takeoverContributionMinor,
            reveal.discountMinor,
            reveal.maximumInsuranceDrawMinor
        );
    }

    function clearAuction(
        DefaultProcessDependencies memory deps,
        mapping(DefaultProcessId processId => DefaultProcess process) storage $processes,
        mapping(DefaultProcessId processId => LiquidationBidId[] bidIds) storage $processBidIds,
        mapping(LiquidationBidId bidId => LiquidationBidRecord bid) storage $bids,
        DefaultProcessId processId,
        DefaultProcessRules calldata rules,
        InsurancePolicy calldata policy
    ) external returns (LiquidationBidId winningBidId) {
        DefaultProcess storage process = _requireProcess($processes, processId);
        _requireWitnesses(process, rules, policy);
        if (process.status == DefaultProcessStatus.AuctionCleared || process.status == DefaultProcessStatus.Resolved) {
            return process.winningBidId;
        }
        if (process.status == DefaultProcessStatus.RecoveryRequired) return LiquidationBidId.wrap(bytes32(0));
        if (process.status != DefaultProcessStatus.ReadyToClear) {
            revert IDefaultProcessEngine.InvalidDefaultProcessStatus(process.status);
        }
        LiquidationBidId[] storage bidIds = $processBidIds[processId];
        for (uint256 i; i < bidIds.length; ++i) {
            LiquidationBidRecord storage candidate = $bids[bidIds[i]];
            if (candidate.status != LiquidationBidStatus.Revealed) continue;
            if (
                LiquidationBidId.unwrap(winningBidId) == bytes32(0)
                    || DefaultProcessLib.isBetterBid(
                        candidate.takeoverContributionMinor,
                        candidate.discountMinor,
                        candidate.bidId,
                        $bids[winningBidId].takeoverContributionMinor,
                        $bids[winningBidId].discountMinor,
                        winningBidId
                    )
            ) winningBidId = candidate.bidId;
        }
        if (LiquidationBidId.unwrap(winningBidId) == bytes32(0)) {
            _releaseNonWinningBids(deps, $processBidIds, $bids, processId, LiquidationBidId.wrap(bytes32(0)));
            _setStatus(process, DefaultProcessStatus.RecoveryRequired, process.uncuredProofHash);
            return winningBidId;
        }
        _releaseNonWinningBids(deps, $processBidIds, $bids, processId, winningBidId);
        LiquidationBidRecord storage winner = $bids[winningBidId];
        winner.status = LiquidationBidStatus.Winner;
        process.winningBidId = winningBidId;
        uint128 residual = process.deficiencyMinor;
        uint128 defaulterApplied = _minimum(residual, process.lockedDefaulterCollateralMinor);
        residual -= defaulterApplied;
        uint128 takeoverApplied = _minimum(residual, winner.takeoverContributionMinor);
        residual -= takeoverApplied;
        uint128 insuranceDraw = _minimum(residual, policy.maximumDrawPerDefaultMinor);
        insuranceDraw = _minimum(insuranceDraw, winner.maximumInsuranceDrawMinor);
        residual -= insuranceDraw;
        process.takeoverContributionMinor = takeoverApplied;
        process.insuranceDrawMinor = insuranceDraw;
        process.terminalResidualMinor = residual;
        _setStatus(process, DefaultProcessStatus.AuctionCleared, winner.sealedBidHash);
        emit IDefaultProcessEngine.LiquidationAuctionCleared(
            processId, winningBidId, defaulterApplied, takeoverApplied, insuranceDraw, residual
        );
    }

    function _releaseNonWinningBids(
        DefaultProcessDependencies memory deps,
        mapping(DefaultProcessId processId => LiquidationBidId[] bidIds) storage $processBidIds,
        mapping(LiquidationBidId bidId => LiquidationBidRecord bid) storage $bids,
        DefaultProcessId processId,
        LiquidationBidId winningBidId
    ) internal {
        LiquidationBidId[] storage bidIds = $processBidIds[processId];
        for (uint256 i; i < bidIds.length; ++i) {
            if (LiquidationBidId.unwrap(bidIds[i]) == LiquidationBidId.unwrap(winningBidId)) continue;
            LiquidationBidRecord storage bid = $bids[bidIds[i]];
            if (bid.status == LiquidationBidStatus.Committed) bid.status = LiquidationBidStatus.Unrevealed;
            else if (bid.status == LiquidationBidStatus.Revealed) bid.status = LiquidationBidStatus.Loser;
            _releaseIfActive(deps, bid.bondLockId);
            _releaseIfActive(deps, bid.capacityLockId);
        }
    }

    function _requireRules(DefaultProcess storage process, DefaultProcessRules calldata rules) internal view {
        bytes32 supplied = DefaultProcessLib.hashRules(rules);
        if (supplied != process.defaultProcessHash) {
            revert IDefaultProcessEngine.InvalidPolicyWitness(process.defaultProcessHash, supplied);
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

    function _requirePolicy(DefaultProcess storage process, InsurancePolicy calldata policy) internal view {
        bytes32 supplied = DefaultProcessLib.hashInsurancePolicy(policy);
        if (supplied != process.insurancePolicyHash) {
            revert IDefaultProcessEngine.InvalidPolicyWitness(process.insurancePolicyHash, supplied);
        }
    }
}
