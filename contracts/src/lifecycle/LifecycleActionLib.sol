// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {CompressionLib} from "../libraries/CompressionLib.sol";
import {LifecycleHashLib} from "../libraries/LifecycleHashLib.sol";
import {
    CompressionPlanId,
    CompressionPosition,
    CompressionSuccessor,
    ReplacementCollateral
} from "../types/CompressionTypes.sol";
import {DefaultExecutionResult, DefaultProcess, LiquidationBidRecord} from "../types/DefaultTypes.sol";
import {AccountId, CollateralId, PositionId, RiskDomainId, SeriesId} from "../types/Identifiers.sol";
import {
    LifecycleAction,
    LifecycleActionId,
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
import {Lots, PriceTicks} from "../types/Units.sol";
import {LifecycleExecutorDependencies} from "./LifecycleExecutorTypes.sol";
import {LifecycleBackingLib} from "./LifecycleBackingLib.sol";
import {LifecycleSuccessorLib} from "./LifecycleSuccessorLib.sol";
import "./PositionLifecycleExecutor.sol";

/// Linked logic for the position lifecycle executor: atomic lifecycle actions, compression, default novation, and
/// terminal default rules. Callers are authorized by the executor before this runs through DELEGATECALL in its context.
library LifecycleActionLib {
    bytes32 internal constant COMPRESSION_OUTCOME_TYPEHASH = keccak256("SetrynCompressionExecutionOutcomeV1");
    bytes32 internal constant DEFAULT_OUTCOME_TYPEHASH = keccak256("SetrynDefaultExecutionOutcomeV1");
    bytes32 internal constant LIFECYCLE_OUTCOME_TYPEHASH = keccak256("SetrynLifecycleExecutionOutcomeV1");

    function executeLifecycleActionBody(
        LifecycleExecutorDependencies memory deps,
        mapping(bytes32 executionId => bool consumed) storage $executionConsumed,
        mapping(
            bytes32 executionId => mapping(bytes32 successorKey => bytes32 witnessHash)
        ) storage $successorWitnessHash,
        mapping(bytes32 witnessKey => bytes payoffTerms) storage $successorTerms,
        mapping(
            bytes32 witnessKey => PositionProvenance provenance
        ) storage $successorProvenance,
        mapping(bytes32 executionId => bytes32 fixingReference) storage $exerciseFixingReference,
        mapping(bytes32 executionId => bytes finalFixings) storage $exerciseFixings,
        LifecycleActionId actionId,
        LifecycleAction calldata action,
        LifecycleInput[] calldata inputs,
        LifecycleSuccessor[] calldata successors,
        LifecycleCollateralReplacement[] calldata collateralReplacements
    ) external returns (bytes32 outcomeHash) {
        bytes32 executionId = LifecycleActionId.unwrap(actionId);
        _consume($executionConsumed, executionId);
        if (!_supportedAction(action.kind, successors.length)) {
            revert PositionLifecycleExecutor.UnsupportedLifecycleAction(action.kind);
        }
        for (uint256 i; i < inputs.length; ++i) {
            LifecyclePositionSnapshot memory snapshot = deps.positionEngine.getLifecyclePosition(inputs[i].positionId);
            if (
                snapshot.immutableHash != inputs[i].expectedImmutableHash
                    || snapshot.lifecycleHash != inputs[i].expectedLifecycleHash
                    || Lots.unwrap(snapshot.positionLots) != Lots.unwrap(inputs[i].expectedPositionLots)
                    || Lots.unwrap(inputs[i].actionLots) > Lots.unwrap(snapshot.positionLots)
            ) revert PositionLifecycleExecutor.InputPositionMismatch(inputs[i].positionId);
        }
        LifecycleSuccessorLib.validateLifecycleReplacements(successors, collateralReplacements);
        bool settleInputsFirst = action.kind == LifecycleActionKind.Exercise;
        if (settleInputsFirst) {
            LifecycleSuccessorLib.applyLifecycleInputs(
                deps, $exerciseFixingReference, $exerciseFixings, executionId, action, inputs, successors.length
            );
        } else {
            LifecycleBackingLib.replaceLifecycleBacking(deps, executionId, inputs, successors);
        }
        PositionId[] memory created = new PositionId[](successors.length);
        for (uint256 i; i < successors.length; ++i) {
            (bytes memory terms, PositionProvenance memory provenance) = LifecycleSuccessorLib.lifecycleSuccessorWitness(
                deps, $successorWitnessHash, $successorTerms, $successorProvenance, executionId, successors[i], inputs
            );
            created[i] = LifecycleSuccessorLib.createLifecycleSuccessor(
                deps,
                executionId,
                i,
                successors[i].successorKey,
                successors[i].seriesId,
                successors[i].seriesVersion,
                successors[i].longAccountId,
                successors[i].shortAccountId,
                successors[i].lots,
                successors[i].entryPriceTicks,
                terms,
                provenance
            );
            LifecycleSuccessorLib.validateLifecycleSuccessor(deps, created[i], successors[i]);
        }
        if (!settleInputsFirst) {
            LifecycleSuccessorLib.applyLifecycleInputs(
                deps, $exerciseFixingReference, $exerciseFixings, executionId, action, inputs, successors.length
            );
        }
        outcomeHash = keccak256(
            abi.encode(
                LIFECYCLE_OUTCOME_TYPEHASH,
                executionId,
                action.kind,
                LifecycleHashLib.hashInputs(inputs),
                LifecycleHashLib.hashSuccessors(successors),
                LifecycleHashLib.hashCollateralReplacements(collateralReplacements),
                created
            )
        );
    }

    function executeCompressionBody(
        LifecycleExecutorDependencies memory deps,
        mapping(bytes32 executionId => bool consumed) storage $executionConsumed,
        mapping(
            bytes32 executionId => mapping(bytes32 successorKey => bytes32 witnessHash)
        ) storage $successorWitnessHash,
        mapping(bytes32 witnessKey => bytes payoffTerms) storage $successorTerms,
        mapping(
            bytes32 witnessKey => PositionProvenance provenance
        ) storage $successorProvenance,
        CompressionPlanId planId,
        CompressionPosition[] calldata inputs,
        CompressionSuccessor[] calldata successors,
        ReplacementCollateral[] calldata replacementCollateral
    ) external returns (bytes32 outcomeHash) {
        bytes32 executionId = CompressionPlanId.unwrap(planId);
        _consume($executionConsumed, executionId);
        LifecycleSuccessorLib.validateCompressionReplacements(successors, replacementCollateral);
        LifecycleBackingLib.replaceCompressionBacking(deps, executionId, inputs, successors);
        PositionId[] memory created = new PositionId[](successors.length);
        for (uint256 i; i < successors.length; ++i) {
            (bytes memory terms, PositionProvenance memory provenance) = LifecycleSuccessorLib.compressionSuccessorWitness(
                deps, $successorWitnessHash, $successorTerms, $successorProvenance, executionId, successors[i], inputs
            );
            created[i] = LifecycleSuccessorLib.createLifecycleSuccessor(
                deps,
                executionId,
                i,
                successors[i].successorKey,
                successors[i].seriesId,
                successors[i].seriesVersion,
                successors[i].longAccountId,
                successors[i].shortAccountId,
                successors[i].lots,
                successors[i].entryPriceTicks,
                terms,
                provenance
            );
            LifecycleSuccessorLib.validateCompressionSuccessor(deps, created[i], successors[i]);
        }
        for (uint256 i; i < inputs.length; ++i) {
            LifecycleSuccessorLib.closeAndRelease(deps, inputs[i].positionId, PositionStatus.Replaced, executionId);
        }
        outcomeHash = keccak256(
            abi.encode(
                COMPRESSION_OUTCOME_TYPEHASH,
                executionId,
                CompressionLib.hashInputs(inputs),
                CompressionLib.hashSuccessors(successors),
                CompressionLib.hashReplacementCollateral(replacementCollateral),
                created
            )
        );
    }

    function executeDefaultNovationBody(
        LifecycleExecutorDependencies memory deps,
        mapping(bytes32 executionId => bool consumed) storage $executionConsumed,
        DefaultProcess calldata process,
        LiquidationBidRecord calldata winningBid,
        uint128 insuranceDrawMinor,
        uint128 terminalResidualMinor
    ) external returns (DefaultExecutionResult memory result) {
        bytes32 executionId = keccak256(
            abi.encode(DEFAULT_OUTCOME_TYPEHASH, address(this), process.processId, winningBid.bidId, process.positionId)
        );
        _consume($executionConsumed, executionId);
        if (terminalResidualMinor != 0) revert PositionLifecycleExecutor.DefaultResidualNotZero(terminalResidualMinor);
        (PositionEconomics memory economics, PositionLifecycle memory lifecycle) =
            deps.positionEngine.getPosition(process.positionId);
        if (lifecycle.status != PositionStatus.Live || Lots.unwrap(lifecycle.exercisedLots) != 0) {
            revert PositionLifecycleExecutor.InputPositionMismatch(process.positionId);
        }
        AccountId longAccount = economics.longAccountId;
        AccountId shortAccount = economics.shortAccountId;
        if (AccountId.unwrap(process.accountId) == AccountId.unwrap(longAccount)) {
            longAccount = winningBid.bidderAccountId;
        } else if (AccountId.unwrap(process.accountId) == AccountId.unwrap(shortAccount)) {
            shortAccount = winningBid.bidderAccountId;
        } else {
            revert PositionLifecycleExecutor.DefaultPositionMismatch(process.positionId, process.accountId);
        }
        PositionId expectedSuccessorId = _deriveSuccessorPositionId(
            deps,
            executionId,
            0,
            winningBid.eligibilityEvidenceHash,
            economics.seriesId,
            economics.seriesVersion,
            longAccount,
            shortAccount,
            lifecycle.remainingLots,
            economics.entryPriceTicks
        );
        LifecycleBackingLib.prepareDefaultSuccessorBacking(
            deps, expectedSuccessorId, process, winningBid, economics, longAccount, shortAccount
        );
        PositionId successorId = LifecycleSuccessorLib.createLifecycleSuccessor(
            deps,
            executionId,
            0,
            winningBid.eligibilityEvidenceHash,
            economics.seriesId,
            economics.seriesVersion,
            longAccount,
            shortAccount,
            lifecycle.remainingLots,
            economics.entryPriceTicks,
            deps.positionEngine.payoffTerms(process.positionId),
            PositionProvenance({
                packageId: economics.packageId,
                packageVersion: economics.packageVersion,
                packageOrdinal: economics.packageOrdinal,
                packageProvenanceHash: economics.packageProvenanceHash
            })
        );
        if (PositionId.unwrap(successorId) != PositionId.unwrap(expectedSuccessorId)) {
            revert PositionLifecycleExecutor.SuccessorMismatch(winningBid.eligibilityEvidenceHash);
        }
        LifecyclePositionSnapshot memory source = deps.positionEngine.getLifecyclePosition(process.positionId);
        LifecyclePositionSnapshot memory successor = deps.positionEngine.getLifecyclePosition(successorId);
        if (
            successor.longTerminalLiabilityBaseUnits != source.longTerminalLiabilityBaseUnits
                || successor.shortTerminalLiabilityBaseUnits != source.shortTerminalLiabilityBaseUnits
                || RiskDomainId.unwrap(successor.riskDomainId) != RiskDomainId.unwrap(source.riskDomainId)
                || successor.riskDomainVersion != source.riskDomainVersion
                || CollateralId.unwrap(successor.collateralId) != CollateralId.unwrap(source.collateralId)
        ) revert PositionLifecycleExecutor.SuccessorMismatch(winningBid.eligibilityEvidenceHash);
        LifecycleSuccessorLib.closeAndReleaseWithoutRisk(deps, process.positionId, PositionStatus.Replaced, executionId);
        (, PositionLifecycle memory closedLifecycle) = deps.positionEngine.getPosition(process.positionId);
        uint128 defaulterApplied = process.deficiencyMinor < process.lockedDefaulterCollateralMinor
            ? process.deficiencyMinor
            : process.lockedDefaulterCollateralMinor;
        result = DefaultExecutionResult({
            executionHash: keccak256(abi.encode(DEFAULT_OUTCOME_TYPEHASH, executionId, successorId)),
            positionOutcomeReference: closedLifecycle.terminalOutcomeReference,
            successorAccountId: winningBid.bidderAccountId,
            defaulterCollateralAppliedMinor: defaulterApplied,
            takeoverContributionAppliedMinor: process.takeoverContributionMinor,
            insuranceAppliedMinor: insuranceDrawMinor,
            terminalResidualMinor: terminalResidualMinor,
            fullyBackedClaimMinor: 0,
            unbackedClaimMinor: 0
        });
    }

    function applyTerminalDefaultRuleBody(
        LifecycleExecutorDependencies memory deps,
        mapping(bytes32 executionId => bool consumed) storage $executionConsumed,
        DefaultProcess calldata process,
        uint128 insuranceDrawMinor,
        uint128 terminalResidualMinor
    ) external returns (DefaultExecutionResult memory result) {
        bytes32 executionId = keccak256(abi.encode(DEFAULT_OUTCOME_TYPEHASH, process.processId, process.positionId));
        _consume($executionConsumed, executionId);
        PositionStatus status = deps.positionEngine.positionStatus(process.positionId);
        if (status != PositionStatus.Defaulted) {
            deps.positionEngine.markDefaulted(process.positionId, executionId);
        }
        deps.positionEngine.applyTerminalFallback(process.positionId);
        (PositionEconomics memory economics, PositionLifecycle memory lifecycle) =
            deps.positionEngine.getPosition(process.positionId);
        LifecycleSuccessorLib.finalize(deps, economics.longReservationId);
        LifecycleSuccessorLib.finalize(deps, economics.shortReservationId);
        uint128 defaulterApplied = process.deficiencyMinor < process.lockedDefaulterCollateralMinor
            ? process.deficiencyMinor
            : process.lockedDefaulterCollateralMinor;
        result = DefaultExecutionResult({
            executionHash: keccak256(
                abi.encode(DEFAULT_OUTCOME_TYPEHASH, executionId, lifecycle.terminalOutcomeReference)
            ),
            positionOutcomeReference: lifecycle.terminalOutcomeReference,
            successorAccountId: AccountId.wrap(bytes32(0)),
            defaulterCollateralAppliedMinor: defaulterApplied,
            takeoverContributionAppliedMinor: 0,
            insuranceAppliedMinor: insuranceDrawMinor,
            terminalResidualMinor: terminalResidualMinor,
            fullyBackedClaimMinor: 0,
            unbackedClaimMinor: 0
        });
    }

    function _supportedAction(LifecycleActionKind kind, uint256 successorCount) internal pure returns (bool) {
        if (kind == LifecycleActionKind.FullUnwind || kind == LifecycleActionKind.Lapse) return successorCount == 0;
        if (kind == LifecycleActionKind.Exercise || kind == LifecycleActionKind.Abandon) return true;
        if (successorCount == 0) return false;
        return kind == LifecycleActionKind.Transfer || kind == LifecycleActionKind.Assignment
            || kind == LifecycleActionKind.PartialUnwind || kind == LifecycleActionKind.Split
            || kind == LifecycleActionKind.Merge || kind == LifecycleActionKind.Amendment
            || kind == LifecycleActionKind.Novation || kind == LifecycleActionKind.Roll
            || kind == LifecycleActionKind.CollateralPolicyChange || kind == LifecycleActionKind.CompressionHandoff;
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

    function _consume(mapping(bytes32 executionId => bool consumed) storage $executionConsumed, bytes32 executionId)
        internal
    {
        if ($executionConsumed[executionId]) revert PositionLifecycleExecutor.ExecutionAlreadyConsumed(executionId);
        $executionConsumed[executionId] = true;
    }
}
