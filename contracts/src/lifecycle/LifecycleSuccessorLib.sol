// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {CompressionPosition, CompressionSuccessor, ReplacementCollateral} from "../types/CompressionTypes.sol";
import {
    AccountId,
    CollateralId,
    CollateralLockId,
    PackageId,
    PositionId,
    RiskDomainId,
    SeriesId,
    TerminalLiabilityReservationId
} from "../types/Identifiers.sol";
import {
    LifecycleAction,
    LifecycleActionKind,
    LifecycleCollateralReplacement,
    LifecycleInput,
    LifecyclePositionSnapshot,
    LifecycleSuccessor
} from "../types/LifecycleTypes.sol";
import {
    PositionCreation,
    PositionEconomics,
    PositionFunding,
    PositionLifecycle,
    PositionProvenance,
    PositionStatus
} from "../types/PositionTypes.sol";
import {RiskExposureReduction} from "../types/RiskTypes.sol";
import {Lots, PriceTicks} from "../types/Units.sol";
import {TerminalLiabilityReservationStatus} from "../types/Enums.sol";
import {LifecycleExecutorDependencies} from "./LifecycleExecutorTypes.sol";
import "./PositionLifecycleExecutor.sol";

/// Linked logic for the position lifecycle executor: successor validation and creation, input application,
/// collateral replacement checks, and exposure release. Runs through DELEGATECALL in the executor's context.
library LifecycleSuccessorLib {
    function createLifecycleSuccessor(
        LifecycleExecutorDependencies memory deps,
        bytes32 executionId,
        uint256 index,
        bytes32 successorKey,
        SeriesId seriesId,
        uint32 seriesVersion,
        AccountId longAccountId,
        AccountId shortAccountId,
        Lots lots,
        PriceTicks entryPriceTicks,
        bytes memory terms,
        PositionProvenance memory provenance
    ) external returns (PositionId) {
        PositionFunding memory noFunding = PositionFunding({
            lockId: CollateralLockId.wrap(bytes32(0)),
            lockReference: bytes32(0),
            expectedRemainingAmount: 0,
            expectedExpiry: 0
        });
        return deps.positionEngine
            .createLifecycleSuccessorWithProvenance(
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
                    payoffTerms: terms
                }),
                provenance
            );
    }

    function validateLifecycleSuccessor(
        LifecycleExecutorDependencies memory deps,
        PositionId positionId,
        LifecycleSuccessor calldata expected
    ) external view {
        LifecyclePositionSnapshot memory actual = deps.positionEngine.getLifecyclePosition(positionId);
        if (
            SeriesId.unwrap(actual.seriesId) != SeriesId.unwrap(expected.seriesId)
                || actual.seriesVersion != expected.seriesVersion
                || AccountId.unwrap(actual.longAccountId) != AccountId.unwrap(expected.longAccountId)
                || AccountId.unwrap(actual.shortAccountId) != AccountId.unwrap(expected.shortAccountId)
                || RiskDomainId.unwrap(actual.riskDomainId) != RiskDomainId.unwrap(expected.riskDomainId)
                || actual.riskDomainVersion != expected.riskDomainVersion
                || CollateralId.unwrap(actual.collateralId) != CollateralId.unwrap(expected.collateralId)
                || Lots.unwrap(actual.positionLots) != Lots.unwrap(expected.lots)
                || PriceTicks.unwrap(actual.entryPriceTicks) != PriceTicks.unwrap(expected.entryPriceTicks)
                || actual.economicsHash != expected.economicsHash
                || actual.packageProvenanceHash != expected.packageProvenanceHash
                || actual.longTerminalLiabilityBaseUnits != expected.longTerminalLiabilityBaseUnits
                || actual.shortTerminalLiabilityBaseUnits != expected.shortTerminalLiabilityBaseUnits
        ) revert PositionLifecycleExecutor.SuccessorMismatch(expected.successorKey);
    }

    function validateCompressionSuccessor(
        LifecycleExecutorDependencies memory deps,
        PositionId positionId,
        CompressionSuccessor calldata expected
    ) external view {
        LifecyclePositionSnapshot memory actual = deps.positionEngine.getLifecyclePosition(positionId);
        if (
            SeriesId.unwrap(actual.seriesId) != SeriesId.unwrap(expected.seriesId)
                || actual.seriesVersion != expected.seriesVersion
                || AccountId.unwrap(actual.longAccountId) != AccountId.unwrap(expected.longAccountId)
                || AccountId.unwrap(actual.shortAccountId) != AccountId.unwrap(expected.shortAccountId)
                || RiskDomainId.unwrap(actual.riskDomainId) != RiskDomainId.unwrap(expected.riskDomainId)
                || actual.riskDomainVersion != expected.riskDomainVersion
                || CollateralId.unwrap(actual.collateralId) != CollateralId.unwrap(expected.collateralId)
                || Lots.unwrap(actual.positionLots) != Lots.unwrap(expected.lots)
                || PriceTicks.unwrap(actual.entryPriceTicks) != PriceTicks.unwrap(expected.entryPriceTicks)
                || actual.economicsHash != expected.economicsHash
                || actual.longTerminalLiabilityBaseUnits != expected.longTerminalLiabilityBaseUnits
                || actual.shortTerminalLiabilityBaseUnits != expected.shortTerminalLiabilityBaseUnits
        ) revert PositionLifecycleExecutor.SuccessorMismatch(expected.successorKey);
    }

    function _findLifecycleTerms(
        LifecycleExecutorDependencies memory deps,
        LifecycleSuccessor calldata successor,
        LifecycleInput[] calldata inputs
    ) internal view returns (bytes memory) {
        for (uint256 i; i < inputs.length; ++i) {
            LifecyclePositionSnapshot memory source = deps.positionEngine.getLifecyclePosition(inputs[i].positionId);
            if (
                SeriesId.unwrap(source.seriesId) == SeriesId.unwrap(successor.seriesId)
                    && source.seriesVersion == successor.seriesVersion
            ) return deps.positionEngine.payoffTerms(inputs[i].positionId);
        }
        revert PositionLifecycleExecutor.SuccessorMismatch(successor.successorKey);
    }

    function _findCompressionTerms(
        LifecycleExecutorDependencies memory deps,
        CompressionSuccessor calldata successor,
        CompressionPosition[] calldata inputs
    ) internal view returns (bytes memory) {
        for (uint256 i; i < inputs.length; ++i) {
            if (
                SeriesId.unwrap(inputs[i].seriesId) == SeriesId.unwrap(successor.seriesId)
                    && inputs[i].seriesVersion == successor.seriesVersion
            ) return deps.positionEngine.payoffTerms(inputs[i].positionId);
        }
        revert PositionLifecycleExecutor.SuccessorMismatch(successor.successorKey);
    }

    function lifecycleSuccessorWitness(
        LifecycleExecutorDependencies memory deps,
        mapping(
            bytes32 executionId => mapping(bytes32 successorKey => bytes32 witnessHash)
        ) storage $successorWitnessHash,
        mapping(bytes32 witnessKey => bytes payoffTerms) storage $successorTerms,
        mapping(
            bytes32 witnessKey => PositionProvenance provenance
        ) storage $successorProvenance,
        bytes32 executionId,
        LifecycleSuccessor calldata successor,
        LifecycleInput[] calldata inputs
    ) external view returns (bytes memory terms, PositionProvenance memory provenance) {
        bytes32 witnessKey = keccak256(abi.encode(executionId, successor.successorKey));
        if ($successorWitnessHash[executionId][successor.successorKey] != bytes32(0)) {
            terms = $successorTerms[witnessKey];
            provenance = $successorProvenance[witnessKey];
            if (provenance.packageProvenanceHash != successor.packageProvenanceHash) {
                revert PositionLifecycleExecutor.SuccessorMismatch(successor.successorKey);
            }
            return (terms, provenance);
        }
        if (successor.packageProvenanceHash != bytes32(0)) {
            revert PositionLifecycleExecutor.MissingSuccessorWitness(successor.successorKey);
        }
        terms = _findLifecycleTerms(deps, successor, inputs);
    }

    function compressionSuccessorWitness(
        LifecycleExecutorDependencies memory deps,
        mapping(
            bytes32 executionId => mapping(bytes32 successorKey => bytes32 witnessHash)
        ) storage $successorWitnessHash,
        mapping(bytes32 witnessKey => bytes payoffTerms) storage $successorTerms,
        mapping(
            bytes32 witnessKey => PositionProvenance provenance
        ) storage $successorProvenance,
        bytes32 executionId,
        CompressionSuccessor calldata successor,
        CompressionPosition[] calldata inputs
    ) external view returns (bytes memory terms, PositionProvenance memory provenance) {
        bytes32 witnessKey = keccak256(abi.encode(executionId, successor.successorKey));
        if ($successorWitnessHash[executionId][successor.successorKey] != bytes32(0)) {
            terms = $successorTerms[witnessKey];
            provenance = $successorProvenance[witnessKey];
            if (PackageId.unwrap(provenance.packageId) != bytes32(0)) {
                revert PositionLifecycleExecutor.SuccessorMismatch(successor.successorKey);
            }
            return (terms, provenance);
        }
        terms = _findCompressionTerms(deps, successor, inputs);
    }

    function applyLifecycleInputs(
        LifecycleExecutorDependencies memory deps,
        mapping(bytes32 executionId => bytes32 fixingReference) storage $exerciseFixingReference,
        mapping(bytes32 executionId => bytes finalFixings) storage $exerciseFixings,
        bytes32 executionId,
        LifecycleAction calldata action,
        LifecycleInput[] calldata inputs,
        uint256 successorCount
    ) external {
        if (action.kind == LifecycleActionKind.Exercise) {
            bytes32 fixingReference = $exerciseFixingReference[executionId];
            bytes memory finalFixings = $exerciseFixings[executionId];
            if (
                fixingReference == bytes32(0) || finalFixings.length == 0
                    || keccak256(abi.encode(fixingReference, keccak256(finalFixings))) != action.economicTransitionHash
            ) revert PositionLifecycleExecutor.ExerciseWitnessMismatch(executionId);
            for (uint256 i; i < inputs.length; ++i) {
                (, PositionLifecycle memory lifecycleBefore) = deps.positionEngine.getPosition(inputs[i].positionId);
                deps.positionEngine
                    .exercisePositionQuantity(
                        inputs[i].positionId,
                        inputs[i].actionLots,
                        action.actorAccountId,
                        lifecycleBefore.lifecycleNonce,
                        fixingReference,
                        finalFixings
                    );
                (PositionEconomics memory economics, PositionLifecycle memory lifecycleAfter) =
                    deps.positionEngine.getPosition(inputs[i].positionId);
                if (Lots.unwrap(lifecycleAfter.remainingLots) != 0) {
                    deps.positionEngine
                        .closePositionQuantity(
                            inputs[i].positionId,
                            lifecycleAfter.remainingLots,
                            action.actorAccountId,
                            lifecycleAfter.lifecycleNonce,
                            PositionStatus.Replaced,
                            executionId
                        );
                }
                _reducePositionExposure(deps, inputs[i].positionId);
                finalize(deps, economics.longReservationId);
                finalize(deps, economics.shortReservationId);
            }
            return;
        }
        if (action.kind == LifecycleActionKind.Abandon) {
            for (uint256 i; i < inputs.length; ++i) {
                (, PositionLifecycle memory lifecycleBefore) = deps.positionEngine.getPosition(inputs[i].positionId);
                deps.positionEngine
                    .abandonPositionQuantity(
                        inputs[i].positionId,
                        inputs[i].actionLots,
                        action.actorAccountId,
                        lifecycleBefore.lifecycleNonce,
                        executionId
                    );
                (PositionEconomics memory economics, PositionLifecycle memory lifecycleAfter) =
                    deps.positionEngine.getPosition(inputs[i].positionId);
                if (Lots.unwrap(lifecycleAfter.remainingLots) != 0) {
                    deps.positionEngine
                        .closePositionQuantity(
                            inputs[i].positionId,
                            lifecycleAfter.remainingLots,
                            action.actorAccountId,
                            lifecycleAfter.lifecycleNonce,
                            PositionStatus.Replaced,
                            executionId
                        );
                }
                _reducePositionExposure(deps, inputs[i].positionId);
                finalize(deps, economics.longReservationId);
                finalize(deps, economics.shortReservationId);
            }
            return;
        }
        if (action.kind == LifecycleActionKind.PartialUnwind) {
            if (successorCount == 0) revert PositionLifecycleExecutor.UnsupportedLifecycleAction(action.kind);
            for (uint256 i; i < inputs.length; ++i) {
                (PositionEconomics memory economics, PositionLifecycle memory lifecycle) =
                    deps.positionEngine.getPosition(inputs[i].positionId);
                deps.positionEngine
                    .closePositionQuantity(
                        inputs[i].positionId,
                        lifecycle.remainingLots,
                        action.actorAccountId,
                        lifecycle.lifecycleNonce,
                        PositionStatus.Replaced,
                        executionId
                    );
                _reducePositionExposure(deps, inputs[i].positionId);
                finalize(deps, economics.longReservationId);
                finalize(deps, economics.shortReservationId);
            }
            return;
        }
        PositionStatus terminalStatus = action.kind == LifecycleActionKind.Lapse
            ? PositionStatus.Lapsed
            : successorCount == 0 ? PositionStatus.ClosedByUnwind : PositionStatus.Replaced;
        for (uint256 i; i < inputs.length; ++i) {
            closeAndRelease(deps, inputs[i].positionId, terminalStatus, executionId);
        }
    }

    function validateLifecycleReplacements(
        LifecycleSuccessor[] calldata successors,
        LifecycleCollateralReplacement[] calldata replacements
    ) external pure {
        for (uint256 i; i < replacements.length; ++i) {
            uint256 total;
            for (uint256 j; j < successors.length; ++j) {
                if (AccountId.unwrap(successors[j].longAccountId) == AccountId.unwrap(replacements[i].accountId)) {
                    if (
                        CollateralId.unwrap(successors[j].collateralId)
                            != CollateralId.unwrap(replacements[i].collateralId)
                    ) {
                        revert PositionLifecycleExecutor.CollateralReplacementMismatch(replacements[i].accountId);
                    }
                    total += successors[j].longTerminalLiabilityBaseUnits;
                }
                if (AccountId.unwrap(successors[j].shortAccountId) == AccountId.unwrap(replacements[i].accountId)) {
                    if (
                        CollateralId.unwrap(successors[j].collateralId)
                            != CollateralId.unwrap(replacements[i].collateralId)
                    ) {
                        revert PositionLifecycleExecutor.CollateralReplacementMismatch(replacements[i].accountId);
                    }
                    total += successors[j].shortTerminalLiabilityBaseUnits;
                }
            }
            if (total != replacements[i].terminalLiabilityBaseUnits) {
                revert PositionLifecycleExecutor.CollateralReplacementMismatch(replacements[i].accountId);
            }
        }
        for (uint256 i; i < successors.length; ++i) {
            _requireLifecycleReplacement(successors[i].longAccountId, replacements);
            _requireLifecycleReplacement(successors[i].shortAccountId, replacements);
        }
    }

    function _requireLifecycleReplacement(AccountId accountId, LifecycleCollateralReplacement[] calldata replacements)
        internal
        pure
    {
        for (uint256 i; i < replacements.length; ++i) {
            if (AccountId.unwrap(replacements[i].accountId) == AccountId.unwrap(accountId)) return;
        }
        revert PositionLifecycleExecutor.CollateralReplacementMismatch(accountId);
    }

    function validateCompressionReplacements(
        CompressionSuccessor[] calldata successors,
        ReplacementCollateral[] calldata replacements
    ) external pure {
        for (uint256 i; i < replacements.length; ++i) {
            uint256 total;
            for (uint256 j; j < successors.length; ++j) {
                if (AccountId.unwrap(successors[j].longAccountId) == AccountId.unwrap(replacements[i].accountId)) {
                    if (
                        CollateralId.unwrap(successors[j].collateralId)
                            != CollateralId.unwrap(replacements[i].collateralId)
                    ) {
                        revert PositionLifecycleExecutor.CollateralReplacementMismatch(replacements[i].accountId);
                    }
                    total += successors[j].longTerminalLiabilityBaseUnits;
                }
                if (AccountId.unwrap(successors[j].shortAccountId) == AccountId.unwrap(replacements[i].accountId)) {
                    if (
                        CollateralId.unwrap(successors[j].collateralId)
                            != CollateralId.unwrap(replacements[i].collateralId)
                    ) {
                        revert PositionLifecycleExecutor.CollateralReplacementMismatch(replacements[i].accountId);
                    }
                    total += successors[j].shortTerminalLiabilityBaseUnits;
                }
            }
            if (total != replacements[i].terminalLiabilityBaseUnits) {
                revert PositionLifecycleExecutor.CollateralReplacementMismatch(replacements[i].accountId);
            }
        }
        for (uint256 i; i < successors.length; ++i) {
            _requireCompressionReplacement(successors[i].longAccountId, replacements);
            _requireCompressionReplacement(successors[i].shortAccountId, replacements);
        }
    }

    function _requireCompressionReplacement(AccountId accountId, ReplacementCollateral[] calldata replacements)
        internal
        pure
    {
        for (uint256 i; i < replacements.length; ++i) {
            if (AccountId.unwrap(replacements[i].accountId) == AccountId.unwrap(accountId)) return;
        }
        revert PositionLifecycleExecutor.CollateralReplacementMismatch(accountId);
    }

    function closeAndRelease(
        LifecycleExecutorDependencies memory deps,
        PositionId positionId,
        PositionStatus status,
        bytes32 transitionReference
    ) public {
        closeAndReleaseWithoutRisk(deps, positionId, status, transitionReference);
        _reducePositionExposure(deps, positionId);
    }

    function closeAndReleaseWithoutRisk(
        LifecycleExecutorDependencies memory deps,
        PositionId positionId,
        PositionStatus status,
        bytes32 transitionReference
    ) public {
        (PositionEconomics memory economics,) = deps.positionEngine.getPosition(positionId);
        deps.positionEngine.recordZeroLiabilityAlternative(positionId, status, transitionReference);
        finalize(deps, economics.longReservationId);
        finalize(deps, economics.shortReservationId);
    }

    function _reducePositionExposure(LifecycleExecutorDependencies memory deps, PositionId positionId) internal {
        (PositionEconomics memory economics,) = deps.positionEngine.getPosition(positionId);
        _reduceAccountExposure(deps, positionId, economics.longAccountId);
        if (AccountId.unwrap(economics.shortAccountId) != AccountId.unwrap(economics.longAccountId)) {
            _reduceAccountExposure(deps, positionId, economics.shortAccountId);
        }
    }

    function _reduceAccountExposure(
        LifecycleExecutorDependencies memory deps,
        PositionId positionId,
        AccountId accountId
    ) internal {
        RiskExposureReduction memory reduction =
            deps.portfolioRiskEngine.exposureReductionWitness(positionId, accountId);
        if (reduction.exposureId != bytes32(0)) deps.portfolioRiskEngine.reduceExposure(reduction);
    }

    function finalize(LifecycleExecutorDependencies memory deps, TerminalLiabilityReservationId reservationId) public {
        if (
            TerminalLiabilityReservationId.unwrap(reservationId) != bytes32(0)
                && deps.collateralVault.terminalLiabilityReservationStatusOf(reservationId)
                    == TerminalLiabilityReservationStatus.Active
        ) {
            deps.collateralVault.finalizeTerminalLiabilityReservation(reservationId);
        }
    }
}
