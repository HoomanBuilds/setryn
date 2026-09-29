// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {CollateralLock, TerminalLiabilityReplacement, TerminalLiabilityReservation} from "../types/CollateralTypes.sol";
import {CompressionPosition, CompressionSuccessor} from "../types/CompressionTypes.sol";
import {DefaultProcess, LiquidationBidRecord} from "../types/DefaultTypes.sol";
import {
    AccountId,
    CollateralId,
    PositionId,
    RiskDomainId,
    SeriesId,
    TerminalLiabilityReservationId
} from "../types/Identifiers.sol";
import {LifecycleInput, LifecycleSuccessor} from "../types/LifecycleTypes.sol";
import {PositionCreation, PositionEconomics, PositionFunding, PositionLiabilitySide} from "../types/PositionTypes.sol";
import {SeriesVersion} from "../types/SeriesDefinition.sol";
import {Lots, PriceTicks} from "../types/Units.sol";
import {LockStatus, TerminalLiabilityReservationStatus} from "../types/Enums.sol";
import {LifecycleExecutorDependencies, BackingTarget} from "./LifecycleExecutorTypes.sol";
import "./PositionLifecycleExecutor.sol";

/// Linked logic for the position lifecycle executor: terminal-liability backing replacement for lifecycle,
/// compression, and default successors. Runs through DELEGATECALL in the executor's context against its storage.
library LifecycleBackingLib {
    function replaceLifecycleBacking(
        LifecycleExecutorDependencies memory deps,
        bytes32 executionId,
        LifecycleInput[] calldata inputs,
        LifecycleSuccessor[] calldata successors
    ) external {
        TerminalLiabilityReservationId[] memory sources = _sourceReservations(deps, inputs);
        BackingTarget[] memory targets = new BackingTarget[](successors.length * 2);
        uint256 targetCount;
        for (uint256 i; i < successors.length; ++i) {
            LifecycleSuccessor calldata successor = successors[i];
            PositionId positionId = _deriveSuccessorPositionId(
                deps,
                executionId,
                i,
                successor.successorKey,
                successor.seriesId,
                successor.seriesVersion,
                successor.longAccountId,
                successor.shortAccountId,
                successor.lots,
                successor.entryPriceTicks
            );
            SeriesVersion memory series =
                deps.positionEngine.seriesRegistry().getSeries(successor.seriesId, successor.seriesVersion);
            targetCount = _appendTarget(
                deps,
                targets,
                targetCount,
                positionId,
                PositionLiabilitySide.Long,
                successor.longAccountId,
                successor.collateralId,
                successor.riskDomainId,
                successor.riskDomainVersion,
                series.definition.settlementDeadline,
                series.definition.finalResolutionAt,
                successor.longTerminalLiabilityBaseUnits
            );
            targetCount = _appendTarget(
                deps,
                targets,
                targetCount,
                positionId,
                PositionLiabilitySide.Short,
                successor.shortAccountId,
                successor.collateralId,
                successor.riskDomainId,
                successor.riskDomainVersion,
                series.definition.settlementDeadline,
                series.definition.finalResolutionAt,
                successor.shortTerminalLiabilityBaseUnits
            );
        }
        assembly ("memory-safe") {
            mstore(targets, targetCount)
        }
        _replaceBacking(deps, sources, targets);
    }

    function replaceCompressionBacking(
        LifecycleExecutorDependencies memory deps,
        bytes32 executionId,
        CompressionPosition[] calldata inputs,
        CompressionSuccessor[] calldata successors
    ) external {
        TerminalLiabilityReservationId[] memory sources = _sourceReservations(deps, inputs);
        BackingTarget[] memory targets = new BackingTarget[](successors.length * 2);
        uint256 targetCount;
        for (uint256 i; i < successors.length; ++i) {
            CompressionSuccessor calldata successor = successors[i];
            PositionId positionId = _deriveSuccessorPositionId(
                deps,
                executionId,
                i,
                successor.successorKey,
                successor.seriesId,
                successor.seriesVersion,
                successor.longAccountId,
                successor.shortAccountId,
                successor.lots,
                successor.entryPriceTicks
            );
            SeriesVersion memory series =
                deps.positionEngine.seriesRegistry().getSeries(successor.seriesId, successor.seriesVersion);
            targetCount = _appendTarget(
                deps,
                targets,
                targetCount,
                positionId,
                PositionLiabilitySide.Long,
                successor.longAccountId,
                successor.collateralId,
                successor.riskDomainId,
                successor.riskDomainVersion,
                series.definition.settlementDeadline,
                series.definition.finalResolutionAt,
                successor.longTerminalLiabilityBaseUnits
            );
            targetCount = _appendTarget(
                deps,
                targets,
                targetCount,
                positionId,
                PositionLiabilitySide.Short,
                successor.shortAccountId,
                successor.collateralId,
                successor.riskDomainId,
                successor.riskDomainVersion,
                series.definition.settlementDeadline,
                series.definition.finalResolutionAt,
                successor.shortTerminalLiabilityBaseUnits
            );
        }
        assembly ("memory-safe") {
            mstore(targets, targetCount)
        }
        _replaceBacking(deps, sources, targets);
    }

    function _sourceReservations(LifecycleExecutorDependencies memory deps, LifecycleInput[] calldata inputs)
        internal
        view
        returns (TerminalLiabilityReservationId[] memory sources)
    {
        sources = new TerminalLiabilityReservationId[](inputs.length * 2);
        uint256 count;
        for (uint256 i; i < inputs.length; ++i) {
            (PositionEconomics memory economics,) = deps.positionEngine.getPosition(inputs[i].positionId);
            count = _appendSource(sources, count, economics.longReservationId);
            count = _appendSource(sources, count, economics.shortReservationId);
        }
        assembly ("memory-safe") {
            mstore(sources, count)
        }
        _sortSources(sources);
    }

    function _sourceReservations(LifecycleExecutorDependencies memory deps, CompressionPosition[] calldata inputs)
        internal
        view
        returns (TerminalLiabilityReservationId[] memory sources)
    {
        sources = new TerminalLiabilityReservationId[](inputs.length * 2);
        uint256 count;
        for (uint256 i; i < inputs.length; ++i) {
            (PositionEconomics memory economics,) = deps.positionEngine.getPosition(inputs[i].positionId);
            count = _appendSource(sources, count, economics.longReservationId);
            count = _appendSource(sources, count, economics.shortReservationId);
        }
        assembly ("memory-safe") {
            mstore(sources, count)
        }
        _sortSources(sources);
    }

    function _replaceBacking(
        LifecycleExecutorDependencies memory deps,
        TerminalLiabilityReservationId[] memory sources,
        BackingTarget[] memory targets
    ) internal {
        bool[] memory assignedTargets = new bool[](targets.length);
        for (uint256 i; i < sources.length; ++i) {
            TerminalLiabilityReservation memory leader = deps.collateralVault.terminalLiabilityReservationOf(sources[i]);
            bool earlierGroup;
            for (uint256 j; j < i; ++j) {
                TerminalLiabilityReservation memory earlier =
                    deps.collateralVault.terminalLiabilityReservationOf(sources[j]);
                if (_sameBackingGroup(leader, earlier)) earlierGroup = true;
            }
            if (earlierGroup) continue;

            uint256 sourceCount;
            for (uint256 j; j < sources.length; ++j) {
                TerminalLiabilityReservation memory source =
                    deps.collateralVault.terminalLiabilityReservationOf(sources[j]);
                if (_sameBackingGroup(leader, source)) ++sourceCount;
            }
            uint256 replacementCount;
            for (uint256 j; j < targets.length; ++j) {
                if (_sameBackingGroup(leader, targets[j])) ++replacementCount;
            }
            if (replacementCount == 0) continue;

            TerminalLiabilityReservationId[] memory groupedSources = new TerminalLiabilityReservationId[](sourceCount);
            TerminalLiabilityReplacement[] memory replacements = new TerminalLiabilityReplacement[](replacementCount);
            uint256 sourceIndex;
            uint256 replacementIndex;
            for (uint256 j; j < sources.length; ++j) {
                TerminalLiabilityReservation memory source =
                    deps.collateralVault.terminalLiabilityReservationOf(sources[j]);
                if (_sameBackingGroup(leader, source)) groupedSources[sourceIndex++] = sources[j];
            }
            for (uint256 j; j < targets.length; ++j) {
                if (!_sameBackingGroup(leader, targets[j])) continue;
                BackingTarget memory target = targets[j];
                replacements[replacementIndex++] = TerminalLiabilityReplacement({
                    positionId: target.liabilityKey,
                    payerAccountId: target.payerAccountId,
                    assetId: leader.assetId,
                    riskDomainId: target.riskDomainId,
                    bindingVersion: leader.bindingVersion,
                    riskDomainVersion: target.riskDomainVersion,
                    settlementDeadline: target.settlementDeadline,
                    finalResolutionAt: target.finalResolutionAt,
                    amount: target.amount
                });
                assignedTargets[j] = true;
            }
            deps.positionEngine.replaceLifecycleReservations(groupedSources, replacements);
        }
        for (uint256 i; i < targets.length; ++i) {
            if (!assignedTargets[i]) {
                revert PositionLifecycleExecutor.CollateralReplacementMismatch(targets[i].payerAccountId);
            }
        }
    }

    function _appendSource(
        TerminalLiabilityReservationId[] memory sources,
        uint256 count,
        TerminalLiabilityReservationId source
    ) internal pure returns (uint256) {
        if (TerminalLiabilityReservationId.unwrap(source) == bytes32(0)) return count;
        sources[count] = source;
        return count + 1;
    }

    function _appendTarget(
        LifecycleExecutorDependencies memory deps,
        BackingTarget[] memory targets,
        uint256 count,
        PositionId positionId,
        PositionLiabilitySide side,
        AccountId payerAccountId,
        CollateralId collateralId,
        RiskDomainId riskDomainId,
        uint32 riskDomainVersion,
        uint64 settlementDeadline,
        uint64 finalResolutionAt,
        uint128 amount
    ) internal view returns (uint256) {
        if (amount == 0) return count;
        targets[count] = BackingTarget({
            liabilityKey: deps.positionEngine.deriveLiabilityKey(positionId, uint8(side)),
            payerAccountId: payerAccountId,
            collateralId: collateralId,
            riskDomainId: riskDomainId,
            riskDomainVersion: riskDomainVersion,
            settlementDeadline: settlementDeadline,
            finalResolutionAt: finalResolutionAt,
            amount: amount
        });
        return count + 1;
    }

    function _sortSources(TerminalLiabilityReservationId[] memory sources) internal pure {
        for (uint256 i = 1; i < sources.length; ++i) {
            TerminalLiabilityReservationId current = sources[i];
            uint256 j = i;
            while (
                j != 0
                    && TerminalLiabilityReservationId.unwrap(sources[j - 1])
                        > TerminalLiabilityReservationId.unwrap(current)
            ) {
                sources[j] = sources[j - 1];
                --j;
            }
            sources[j] = current;
        }
    }

    function _sameBackingGroup(TerminalLiabilityReservation memory left, TerminalLiabilityReservation memory right)
        internal
        pure
        returns (bool)
    {
        return AccountId.unwrap(left.payerAccountId) == AccountId.unwrap(right.payerAccountId)
            && CollateralId.unwrap(left.collateralId) == CollateralId.unwrap(right.collateralId)
            && RiskDomainId.unwrap(left.riskDomainId) == RiskDomainId.unwrap(right.riskDomainId)
            && left.riskDomainVersion == right.riskDomainVersion;
    }

    function _sameBackingGroup(TerminalLiabilityReservation memory source, BackingTarget memory target)
        internal
        pure
        returns (bool)
    {
        return AccountId.unwrap(source.payerAccountId) == AccountId.unwrap(target.payerAccountId)
            && CollateralId.unwrap(source.collateralId) == CollateralId.unwrap(target.collateralId)
            && RiskDomainId.unwrap(source.riskDomainId) == RiskDomainId.unwrap(target.riskDomainId)
            && source.riskDomainVersion == target.riskDomainVersion;
    }

    function prepareDefaultSuccessorBacking(
        LifecycleExecutorDependencies memory deps,
        PositionId successorId,
        DefaultProcess calldata process,
        LiquidationBidRecord calldata winningBid,
        PositionEconomics memory economics,
        AccountId successorLong,
        AccountId successorShort
    ) external {
        bool defaultedLong =
            AccountId.unwrap(process.accountId) == AccountId.unwrap(economics.longAccountId);
        uint128 bidderLiability = defaultedLong ? economics.maxLongDebitMinor : economics.maxShortDebitMinor;
        if (winningBid.capacityMinor < process.takeoverContributionMinor) {
            revert PositionLifecycleExecutor.CollateralReplacementMismatch(winningBid.bidderAccountId);
        }
        uint128 capacityForLiability = winningBid.capacityMinor - process.takeoverContributionMinor;
        CollateralLock memory capacityLock = deps.collateralVault.getLock(winningBid.capacityLockId);
        if (
            capacityForLiability < bidderLiability || capacityLock.initialAmount != winningBid.capacityMinor
                || capacityLock.remainingAmount != 0 || capacityLock.status != LockStatus.Released
                || AccountId.unwrap(capacityLock.accountId) != AccountId.unwrap(winningBid.bidderAccountId)
        ) revert PositionLifecycleExecutor.CollateralReplacementMismatch(winningBid.bidderAccountId);

        TerminalLiabilityReservationId survivorReservationId =
            defaultedLong ? economics.shortReservationId : economics.longReservationId;
        uint128 survivorLiability = defaultedLong ? economics.maxShortDebitMinor : economics.maxLongDebitMinor;
        if (survivorLiability == 0) return;
        TerminalLiabilityReservation memory survivor =
            deps.collateralVault.terminalLiabilityReservationOf(survivorReservationId);
        AccountId survivorAccount = defaultedLong ? successorShort : successorLong;
        PositionLiabilitySide survivorSide = defaultedLong ? PositionLiabilitySide.Short : PositionLiabilitySide.Long;
        if (
            survivor.status != TerminalLiabilityReservationStatus.Active
                || AccountId.unwrap(survivor.payerAccountId) != AccountId.unwrap(survivorAccount)
                || survivor.remainingAmount != survivorLiability
        ) revert PositionLifecycleExecutor.CollateralReplacementMismatch(survivorAccount);

        TerminalLiabilityReservationId[] memory sources = new TerminalLiabilityReservationId[](1);
        sources[0] = survivorReservationId;
        TerminalLiabilityReplacement[] memory replacements = new TerminalLiabilityReplacement[](1);
        replacements[0] = TerminalLiabilityReplacement({
            positionId: deps.positionEngine.deriveLiabilityKey(successorId, uint8(survivorSide)),
            payerAccountId: survivorAccount,
            assetId: survivor.assetId,
            riskDomainId: survivor.riskDomainId,
            bindingVersion: survivor.bindingVersion,
            riskDomainVersion: survivor.riskDomainVersion,
            settlementDeadline: economics.settlementDeadline,
            finalResolutionAt: economics.finalResolutionAt,
            amount: survivorLiability
        });
        deps.positionEngine.replaceLifecycleReservations(sources, replacements);
    }

    function _deriveSuccessorPositionId(
        LifecycleExecutorDependencies memory deps,
        bytes32 executionId,
        uint256 index,
        bytes32 successorKey,
        SeriesId seriesId,
        uint32 seriesVersion,
        AccountId longAccountId,
        AccountId shortAccountId,
        Lots lots,
        PriceTicks entryPriceTicks
    ) internal view returns (PositionId) {
        PositionFunding memory noFunding;
        return deps.positionEngine
            .derivePositionId(
                PositionCreation({
                    fillIdentity: keccak256(abi.encode(executionId, successorKey)),
                    seriesId: seriesId,
                    seriesVersion: seriesVersion,
                    longAccountId: longAccountId,
                    shortAccountId: shortAccountId,
                    ordinal: uint32(index),
                    lots: lots,
                    entryPriceTicks: entryPriceTicks,
                    longFunding: noFunding,
                    shortFunding: noFunding,
                    payoffTerms: bytes("")
                })
            );
    }
}
