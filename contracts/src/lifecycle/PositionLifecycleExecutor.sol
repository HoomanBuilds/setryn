// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";

import {ICollateralVault} from "../interfaces/ICollateralVault.sol";
import {ICompressionLifecycleExecutor} from "../interfaces/ICompressionLifecycleExecutor.sol";
import {IDefaultLifecycleExecutor} from "../interfaces/IDefaultLifecycleExecutor.sol";
import {ILifecycleAtomicExecutor} from "../interfaces/ILifecycleAtomicExecutor.sol";
import {IPositionEngine} from "../interfaces/IPositionEngine.sol";
import {CompressionLib} from "../libraries/CompressionLib.sol";
import {LifecycleHashLib} from "../libraries/LifecycleHashLib.sol";
import {
    CompressionPlanId,
    CompressionPosition,
    CompressionSuccessor,
    ReplacementCollateral
} from "../types/CompressionTypes.sol";
import {
    DefaultExecutionResult,
    DefaultProcess,
    DefaultProcessRules,
    InsurancePolicy,
    LiquidationBidRecord
} from "../types/DefaultTypes.sol";
import {
    AccountId,
    CollateralId,
    CollateralLockId,
    PositionId,
    SeriesId,
    TerminalLiabilityReservationId
} from "../types/Identifiers.sol";
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
    PositionStatus
} from "../types/PositionTypes.sol";
import {Lots, PriceTicks} from "../types/Units.sol";

contract PositionLifecycleExecutor is
    ILifecycleAtomicExecutor,
    ICompressionLifecycleExecutor,
    IDefaultLifecycleExecutor,
    AccessControlDefaultAdminRules,
    ReentrancyGuard
{
    bytes32 public constant SIGNED_LIFECYCLE_ENGINE_ROLE = keccak256("SETRYN_SIGNED_LIFECYCLE_ENGINE_ROLE");
    bytes32 public constant COMPRESSION_COORDINATOR_ROLE = keccak256("SETRYN_COMPRESSION_COORDINATOR_ROLE");
    bytes32 public constant DEFAULT_PROCESS_ENGINE_ROLE = keccak256("SETRYN_DEFAULT_PROCESS_ENGINE_ROLE");
    bytes32 private constant LIFECYCLE_OUTCOME_TYPEHASH = keccak256("SetrynLifecycleExecutionOutcomeV1");
    bytes32 private constant COMPRESSION_OUTCOME_TYPEHASH = keccak256("SetrynCompressionExecutionOutcomeV1");
    bytes32 private constant DEFAULT_OUTCOME_TYPEHASH = keccak256("SetrynDefaultExecutionOutcomeV1");

    IPositionEngine public immutable positionEngine;
    ICollateralVault public immutable collateralVault;

    mapping(bytes32 executionId => bool consumed) public executionConsumed;

    error ZeroDependency(address dependency);
    error DependencyHasNoCode(address dependency);
    error UnauthorizedCaller(bytes32 role, address actual);
    error ExecutionAlreadyConsumed(bytes32 executionId);
    error UnsupportedLifecycleAction(LifecycleActionKind kind);
    error InputPositionMismatch(PositionId positionId);
    error SuccessorMismatch(bytes32 successorKey);
    error CollateralReplacementMismatch(AccountId accountId);
    error DefaultPositionMismatch(PositionId positionId, AccountId accountId);
    error DefaultResidualNotZero(uint128 residualMinor);

    constructor(uint48 defaultAdminDelay, address initialAdmin, IPositionEngine positionEngine_)
        AccessControlDefaultAdminRules(defaultAdminDelay, initialAdmin)
    {
        _requireDependency(address(positionEngine_));
        ICollateralVault vault = positionEngine_.collateralVault();
        _requireDependency(address(vault));
        positionEngine = positionEngine_;
        collateralVault = vault;
        _grantRole(SIGNED_LIFECYCLE_ENGINE_ROLE, initialAdmin);
        _grantRole(COMPRESSION_COORDINATOR_ROLE, initialAdmin);
        _grantRole(DEFAULT_PROCESS_ENGINE_ROLE, initialAdmin);
    }

    function executeLifecycleAction(
        LifecycleActionId actionId,
        LifecycleAction calldata action,
        LifecycleInput[] calldata inputs,
        LifecycleSuccessor[] calldata successors,
        LifecycleCollateralReplacement[] calldata collateralReplacements
    ) external nonReentrant returns (bytes32 outcomeHash) {
        _requireCaller(SIGNED_LIFECYCLE_ENGINE_ROLE);
        bytes32 executionId = LifecycleActionId.unwrap(actionId);
        _consume(executionId);
        if (!_supportedAction(action.kind, successors.length)) revert UnsupportedLifecycleAction(action.kind);
        for (uint256 i; i < inputs.length; ++i) {
            LifecyclePositionSnapshot memory snapshot = positionEngine.getLifecyclePosition(inputs[i].positionId);
            if (
                snapshot.immutableHash != inputs[i].expectedImmutableHash
                    || snapshot.lifecycleHash != inputs[i].expectedLifecycleHash
                    || Lots.unwrap(snapshot.positionLots) != Lots.unwrap(inputs[i].expectedPositionLots)
                    || Lots.unwrap(inputs[i].actionLots) != Lots.unwrap(snapshot.positionLots)
            ) revert InputPositionMismatch(inputs[i].positionId);
        }
        _validateLifecycleReplacements(successors, collateralReplacements);
        PositionId[] memory created = new PositionId[](successors.length);
        for (uint256 i; i < successors.length; ++i) {
            bytes memory terms = _findLifecycleTerms(successors[i], inputs);
            created[i] = _createLifecycleSuccessor(
                executionId,
                i,
                successors[i].successorKey,
                successors[i].seriesId,
                successors[i].seriesVersion,
                successors[i].longAccountId,
                successors[i].shortAccountId,
                successors[i].lots,
                successors[i].entryPriceTicks,
                terms
            );
            _validateLifecycleSuccessor(created[i], successors[i]);
        }
        PositionStatus terminalStatus = action.kind == LifecycleActionKind.Lapse
            ? PositionStatus.Lapsed
            : successors.length == 0 ? PositionStatus.ClosedByUnwind : PositionStatus.Replaced;
        for (uint256 i; i < inputs.length; ++i) {
            _closeAndRelease(inputs[i].positionId, terminalStatus, executionId);
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

    function executeCompression(
        CompressionPlanId planId,
        CompressionPosition[] calldata inputs,
        CompressionSuccessor[] calldata successors,
        ReplacementCollateral[] calldata replacementCollateral
    ) external nonReentrant returns (bytes32 outcomeHash) {
        _requireCaller(COMPRESSION_COORDINATOR_ROLE);
        bytes32 executionId = CompressionPlanId.unwrap(planId);
        _consume(executionId);
        _validateCompressionReplacements(successors, replacementCollateral);
        PositionId[] memory created = new PositionId[](successors.length);
        for (uint256 i; i < successors.length; ++i) {
            bytes memory terms = _findCompressionTerms(successors[i], inputs);
            created[i] = _createLifecycleSuccessor(
                executionId,
                i,
                successors[i].successorKey,
                successors[i].seriesId,
                successors[i].seriesVersion,
                successors[i].longAccountId,
                successors[i].shortAccountId,
                successors[i].lots,
                successors[i].entryPriceTicks,
                terms
            );
            _validateCompressionSuccessor(created[i], successors[i]);
        }
        for (uint256 i; i < inputs.length; ++i) {
            _closeAndRelease(inputs[i].positionId, PositionStatus.Replaced, executionId);
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

    function executeDefaultNovation(
        DefaultProcess calldata process,
        DefaultProcessRules calldata,
        InsurancePolicy calldata,
        LiquidationBidRecord calldata winningBid,
        uint128 insuranceDrawMinor,
        uint128 terminalResidualMinor
    ) external nonReentrant returns (DefaultExecutionResult memory result) {
        _requireCaller(DEFAULT_PROCESS_ENGINE_ROLE);
        bytes32 executionId = keccak256(
            abi.encode(DEFAULT_OUTCOME_TYPEHASH, address(this), process.processId, winningBid.bidId, process.positionId)
        );
        _consume(executionId);
        if (terminalResidualMinor != 0) revert DefaultResidualNotZero(terminalResidualMinor);
        (PositionEconomics memory economics, PositionLifecycle memory lifecycle) =
            positionEngine.getPosition(process.positionId);
        if (lifecycle.status != PositionStatus.Live) {
            revert InputPositionMismatch(process.positionId);
        }
        AccountId longAccount = economics.longAccountId;
        AccountId shortAccount = economics.shortAccountId;
        if (AccountId.unwrap(process.accountId) == AccountId.unwrap(longAccount)) {
            longAccount = winningBid.bidderAccountId;
        } else if (AccountId.unwrap(process.accountId) == AccountId.unwrap(shortAccount)) {
            shortAccount = winningBid.bidderAccountId;
        } else {
            revert DefaultPositionMismatch(process.positionId, process.accountId);
        }
        PositionId successorId = _createLifecycleSuccessor(
            executionId,
            0,
            winningBid.eligibilityEvidenceHash,
            economics.seriesId,
            economics.seriesVersion,
            longAccount,
            shortAccount,
            economics.lots,
            economics.entryPriceTicks,
            positionEngine.payoffTerms(process.positionId)
        );
        LifecyclePositionSnapshot memory source = positionEngine.getLifecyclePosition(process.positionId);
        LifecyclePositionSnapshot memory successor = positionEngine.getLifecyclePosition(successorId);
        if (
            successor.economicsHash != source.economicsHash
                || successor.longTerminalLiabilityBaseUnits != source.longTerminalLiabilityBaseUnits
                || successor.shortTerminalLiabilityBaseUnits != source.shortTerminalLiabilityBaseUnits
                || successor.riskDomainId != source.riskDomainId
                || successor.riskDomainVersion != source.riskDomainVersion
                || CollateralId.unwrap(successor.collateralId) != CollateralId.unwrap(source.collateralId)
        ) revert SuccessorMismatch(winningBid.eligibilityEvidenceHash);
        _closeAndRelease(process.positionId, PositionStatus.Replaced, executionId);
        (, PositionLifecycle memory closedLifecycle) = positionEngine.getPosition(process.positionId);
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
            fullyBackedClaimMinor: 0,
            unbackedClaimMinor: 0
        });
    }

    function applyTerminalDefaultRule(
        DefaultProcess calldata process,
        DefaultProcessRules calldata,
        InsurancePolicy calldata,
        uint128 insuranceDrawMinor,
        uint128
    ) external nonReentrant returns (DefaultExecutionResult memory result) {
        _requireCaller(DEFAULT_PROCESS_ENGINE_ROLE);
        bytes32 executionId = keccak256(abi.encode(DEFAULT_OUTCOME_TYPEHASH, process.processId, process.positionId));
        _consume(executionId);
        PositionStatus status = positionEngine.positionStatus(process.positionId);
        if (status != PositionStatus.Defaulted) {
            positionEngine.markDefaulted(process.positionId, executionId);
        }
        positionEngine.applyTerminalFallback(process.positionId);
        (PositionEconomics memory economics, PositionLifecycle memory lifecycle) =
            positionEngine.getPosition(process.positionId);
        _finalize(economics.longReservationId);
        _finalize(economics.shortReservationId);
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
            fullyBackedClaimMinor: 0,
            unbackedClaimMinor: 0
        });
    }

    function _createLifecycleSuccessor(
        bytes32 executionId,
        uint256 index,
        bytes32 successorKey,
        SeriesId seriesId,
        uint32 seriesVersion,
        AccountId longAccountId,
        AccountId shortAccountId,
        Lots lots,
        PriceTicks entryPriceTicks,
        bytes memory terms
    ) private returns (PositionId) {
        PositionFunding memory noFunding = PositionFunding({
            lockId: CollateralLockId.wrap(bytes32(0)),
            lockReference: bytes32(0),
            expectedRemainingAmount: 0,
            expectedExpiry: 0
        });
        return positionEngine.createLifecycleSuccessor(
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
            })
        );
    }

    function _validateLifecycleSuccessor(PositionId positionId, LifecycleSuccessor calldata expected) private view {
        LifecyclePositionSnapshot memory actual = positionEngine.getLifecyclePosition(positionId);
        if (
            SeriesId.unwrap(actual.seriesId) != SeriesId.unwrap(expected.seriesId)
                || actual.seriesVersion != expected.seriesVersion
                || AccountId.unwrap(actual.longAccountId) != AccountId.unwrap(expected.longAccountId)
                || AccountId.unwrap(actual.shortAccountId) != AccountId.unwrap(expected.shortAccountId)
                || actual.riskDomainId != expected.riskDomainId
                || actual.riskDomainVersion != expected.riskDomainVersion
                || CollateralId.unwrap(actual.collateralId) != CollateralId.unwrap(expected.collateralId)
                || Lots.unwrap(actual.positionLots) != Lots.unwrap(expected.lots)
                || PriceTicks.unwrap(actual.entryPriceTicks) != PriceTicks.unwrap(expected.entryPriceTicks)
                || actual.economicsHash != expected.economicsHash
                || actual.packageProvenanceHash != expected.packageProvenanceHash
                || actual.longTerminalLiabilityBaseUnits != expected.longTerminalLiabilityBaseUnits
                || actual.shortTerminalLiabilityBaseUnits != expected.shortTerminalLiabilityBaseUnits
        ) revert SuccessorMismatch(expected.successorKey);
    }

    function _validateCompressionSuccessor(PositionId positionId, CompressionSuccessor calldata expected) private view {
        LifecyclePositionSnapshot memory actual = positionEngine.getLifecyclePosition(positionId);
        if (
            SeriesId.unwrap(actual.seriesId) != SeriesId.unwrap(expected.seriesId)
                || actual.seriesVersion != expected.seriesVersion
                || AccountId.unwrap(actual.longAccountId) != AccountId.unwrap(expected.longAccountId)
                || AccountId.unwrap(actual.shortAccountId) != AccountId.unwrap(expected.shortAccountId)
                || actual.riskDomainId != expected.riskDomainId
                || actual.riskDomainVersion != expected.riskDomainVersion
                || CollateralId.unwrap(actual.collateralId) != CollateralId.unwrap(expected.collateralId)
                || Lots.unwrap(actual.positionLots) != Lots.unwrap(expected.lots)
                || PriceTicks.unwrap(actual.entryPriceTicks) != PriceTicks.unwrap(expected.entryPriceTicks)
                || actual.economicsHash != expected.economicsHash
                || actual.longTerminalLiabilityBaseUnits != expected.longTerminalLiabilityBaseUnits
                || actual.shortTerminalLiabilityBaseUnits != expected.shortTerminalLiabilityBaseUnits
        ) revert SuccessorMismatch(expected.successorKey);
    }

    function _findLifecycleTerms(LifecycleSuccessor calldata successor, LifecycleInput[] calldata inputs)
        private
        view
        returns (bytes memory)
    {
        for (uint256 i; i < inputs.length; ++i) {
            LifecyclePositionSnapshot memory source = positionEngine.getLifecyclePosition(inputs[i].positionId);
            if (
                SeriesId.unwrap(source.seriesId) == SeriesId.unwrap(successor.seriesId)
                    && source.seriesVersion == successor.seriesVersion
            ) return positionEngine.payoffTerms(inputs[i].positionId);
        }
        revert SuccessorMismatch(successor.successorKey);
    }

    function _findCompressionTerms(CompressionSuccessor calldata successor, CompressionPosition[] calldata inputs)
        private
        view
        returns (bytes memory)
    {
        for (uint256 i; i < inputs.length; ++i) {
            if (
                SeriesId.unwrap(inputs[i].seriesId) == SeriesId.unwrap(successor.seriesId)
                    && inputs[i].seriesVersion == successor.seriesVersion
            ) return positionEngine.payoffTerms(inputs[i].positionId);
        }
        revert SuccessorMismatch(successor.successorKey);
    }

    function _validateLifecycleReplacements(
        LifecycleSuccessor[] calldata successors,
        LifecycleCollateralReplacement[] calldata replacements
    ) private pure {
        for (uint256 i; i < replacements.length; ++i) {
            uint256 total;
            for (uint256 j; j < successors.length; ++j) {
                if (AccountId.unwrap(successors[j].longAccountId) == AccountId.unwrap(replacements[i].accountId)) {
                    if (
                        CollateralId.unwrap(successors[j].collateralId)
                            != CollateralId.unwrap(replacements[i].collateralId)
                    ) {
                        revert CollateralReplacementMismatch(replacements[i].accountId);
                    }
                    total += successors[j].longTerminalLiabilityBaseUnits;
                }
                if (AccountId.unwrap(successors[j].shortAccountId) == AccountId.unwrap(replacements[i].accountId)) {
                    if (
                        CollateralId.unwrap(successors[j].collateralId)
                            != CollateralId.unwrap(replacements[i].collateralId)
                    ) {
                        revert CollateralReplacementMismatch(replacements[i].accountId);
                    }
                    total += successors[j].shortTerminalLiabilityBaseUnits;
                }
            }
            if (total != replacements[i].terminalLiabilityBaseUnits) {
                revert CollateralReplacementMismatch(replacements[i].accountId);
            }
        }
        for (uint256 i; i < successors.length; ++i) {
            _requireLifecycleReplacement(successors[i].longAccountId, replacements);
            _requireLifecycleReplacement(successors[i].shortAccountId, replacements);
        }
    }

    function _requireLifecycleReplacement(AccountId accountId, LifecycleCollateralReplacement[] calldata replacements)
        private
        pure
    {
        for (uint256 i; i < replacements.length; ++i) {
            if (AccountId.unwrap(replacements[i].accountId) == AccountId.unwrap(accountId)) return;
        }
        revert CollateralReplacementMismatch(accountId);
    }

    function _validateCompressionReplacements(
        CompressionSuccessor[] calldata successors,
        ReplacementCollateral[] calldata replacements
    ) private pure {
        for (uint256 i; i < replacements.length; ++i) {
            uint256 total;
            for (uint256 j; j < successors.length; ++j) {
                if (AccountId.unwrap(successors[j].longAccountId) == AccountId.unwrap(replacements[i].accountId)) {
                    if (
                        CollateralId.unwrap(successors[j].collateralId)
                            != CollateralId.unwrap(replacements[i].collateralId)
                    ) {
                        revert CollateralReplacementMismatch(replacements[i].accountId);
                    }
                    total += successors[j].longTerminalLiabilityBaseUnits;
                }
                if (AccountId.unwrap(successors[j].shortAccountId) == AccountId.unwrap(replacements[i].accountId)) {
                    if (
                        CollateralId.unwrap(successors[j].collateralId)
                            != CollateralId.unwrap(replacements[i].collateralId)
                    ) {
                        revert CollateralReplacementMismatch(replacements[i].accountId);
                    }
                    total += successors[j].shortTerminalLiabilityBaseUnits;
                }
            }
            if (total != replacements[i].terminalLiabilityBaseUnits) {
                revert CollateralReplacementMismatch(replacements[i].accountId);
            }
        }
        for (uint256 i; i < successors.length; ++i) {
            _requireCompressionReplacement(successors[i].longAccountId, replacements);
            _requireCompressionReplacement(successors[i].shortAccountId, replacements);
        }
    }

    function _requireCompressionReplacement(AccountId accountId, ReplacementCollateral[] calldata replacements)
        private
        pure
    {
        for (uint256 i; i < replacements.length; ++i) {
            if (AccountId.unwrap(replacements[i].accountId) == AccountId.unwrap(accountId)) return;
        }
        revert CollateralReplacementMismatch(accountId);
    }

    function _closeAndRelease(PositionId positionId, PositionStatus status, bytes32 transitionReference) private {
        (PositionEconomics memory economics,) = positionEngine.getPosition(positionId);
        positionEngine.recordZeroLiabilityAlternative(positionId, status, transitionReference);
        _finalize(economics.longReservationId);
        _finalize(economics.shortReservationId);
    }

    function _finalize(TerminalLiabilityReservationId reservationId) private {
        if (TerminalLiabilityReservationId.unwrap(reservationId) != bytes32(0)) {
            collateralVault.finalizeTerminalLiabilityReservation(reservationId);
        }
    }

    function _supportedAction(LifecycleActionKind kind, uint256 successorCount) private pure returns (bool) {
        if (kind == LifecycleActionKind.FullUnwind || kind == LifecycleActionKind.Lapse) return successorCount == 0;
        if (successorCount == 0) return false;
        return kind == LifecycleActionKind.Transfer || kind == LifecycleActionKind.Assignment
            || kind == LifecycleActionKind.Split || kind == LifecycleActionKind.Merge
            || kind == LifecycleActionKind.Amendment || kind == LifecycleActionKind.Novation
            || kind == LifecycleActionKind.Roll || kind == LifecycleActionKind.CollateralPolicyChange
            || kind == LifecycleActionKind.CompressionHandoff;
    }

    function _consume(bytes32 executionId) private {
        if (executionConsumed[executionId]) revert ExecutionAlreadyConsumed(executionId);
        executionConsumed[executionId] = true;
    }

    function _requireCaller(bytes32 role) private view {
        if (!hasRole(role, msg.sender)) revert UnauthorizedCaller(role, msg.sender);
    }

    function _requireDependency(address dependency) private view {
        if (dependency == address(0)) revert ZeroDependency(dependency);
        if (dependency.code.length == 0) revert DependencyHasNoCode(dependency);
    }
}
