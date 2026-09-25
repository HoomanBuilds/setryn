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
import {IPortfolioRiskEngine} from "../interfaces/IPortfolioRiskEngine.sol";
import {CompressionLib} from "../libraries/CompressionLib.sol";
import {LifecycleHashLib} from "../libraries/LifecycleHashLib.sol";
import {CollateralLock, TerminalLiabilityReplacement, TerminalLiabilityReservation} from "../types/CollateralTypes.sol";
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
    PackageId,
    PositionId,
    RiskDomainId,
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
    PositionLiabilitySide,
    PositionLifecycle,
    PositionProvenance,
    PositionStatus
} from "../types/PositionTypes.sol";
import {SeriesVersion} from "../types/SeriesDefinition.sol";
import {RiskExposureReduction} from "../types/RiskTypes.sol";
import {Lots, PriceTicks} from "../types/Units.sol";
import {LockStatus, TerminalLiabilityReservationStatus} from "../types/Enums.sol";

contract PositionLifecycleExecutor is
    ILifecycleAtomicExecutor,
    ICompressionLifecycleExecutor,
    IDefaultLifecycleExecutor,
    AccessControlDefaultAdminRules,
    ReentrancyGuard
{
    struct BackingTarget {
        bytes32 liabilityKey;
        AccountId payerAccountId;
        CollateralId collateralId;
        RiskDomainId riskDomainId;
        uint32 riskDomainVersion;
        uint64 settlementDeadline;
        uint64 finalResolutionAt;
        uint128 amount;
    }
    bytes32 public constant SIGNED_LIFECYCLE_ENGINE_ROLE = keccak256("SETRYN_SIGNED_LIFECYCLE_ENGINE_ROLE");
    bytes32 public constant COMPRESSION_COORDINATOR_ROLE = keccak256("SETRYN_COMPRESSION_COORDINATOR_ROLE");
    bytes32 public constant DEFAULT_PROCESS_ENGINE_ROLE = keccak256("SETRYN_DEFAULT_PROCESS_ENGINE_ROLE");
    bytes32 public constant WITNESS_STAGER_ROLE = keccak256("SETRYN_LIFECYCLE_WITNESS_STAGER_ROLE");
    bytes32 private constant LIFECYCLE_OUTCOME_TYPEHASH = keccak256("SetrynLifecycleExecutionOutcomeV1");
    bytes32 private constant COMPRESSION_OUTCOME_TYPEHASH = keccak256("SetrynCompressionExecutionOutcomeV1");
    bytes32 private constant DEFAULT_OUTCOME_TYPEHASH = keccak256("SetrynDefaultExecutionOutcomeV1");

    IPositionEngine public immutable positionEngine;
    ICollateralVault public immutable collateralVault;
    IPortfolioRiskEngine public immutable portfolioRiskEngine;

    mapping(bytes32 executionId => bool consumed) public executionConsumed;
    mapping(bytes32 executionId => mapping(bytes32 successorKey => bytes32 witnessHash)) public successorWitnessHash;
    mapping(bytes32 witnessKey => bytes payoffTerms) private _successorTerms;
    mapping(bytes32 witnessKey => PositionProvenance provenance) private _successorProvenance;
    mapping(bytes32 executionId => bytes32 fixingReference) private _exerciseFixingReference;
    mapping(bytes32 executionId => bytes finalFixings) private _exerciseFixings;

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
    error WitnessAlreadyStaged(bytes32 witnessKey);
    error MissingSuccessorWitness(bytes32 successorKey);
    error ExerciseWitnessMismatch(bytes32 executionId);

    constructor(
        uint48 defaultAdminDelay,
        address initialAdmin,
        IPositionEngine positionEngine_,
        IPortfolioRiskEngine portfolioRiskEngine_
    ) AccessControlDefaultAdminRules(defaultAdminDelay, initialAdmin) {
        _requireDependency(address(positionEngine_));
        _requireDependency(address(portfolioRiskEngine_));
        if (address(portfolioRiskEngine_.positionEngine()) != address(positionEngine_)) {
            revert ZeroDependency(address(portfolioRiskEngine_.positionEngine()));
        }
        ICollateralVault vault = positionEngine_.collateralVault();
        _requireDependency(address(vault));
        positionEngine = positionEngine_;
        collateralVault = vault;
        portfolioRiskEngine = portfolioRiskEngine_;
        _grantRole(SIGNED_LIFECYCLE_ENGINE_ROLE, initialAdmin);
        _grantRole(COMPRESSION_COORDINATOR_ROLE, initialAdmin);
        _grantRole(DEFAULT_PROCESS_ENGINE_ROLE, initialAdmin);
        _grantRole(WITNESS_STAGER_ROLE, initialAdmin);
    }

    function stageSuccessorWitness(
        bytes32 executionId,
        bytes32 successorKey,
        bytes calldata payoffTerms,
        PositionProvenance calldata provenance
    ) external onlyRole(WITNESS_STAGER_ROLE) {
        if (executionId == bytes32(0) || successorKey == bytes32(0) || payoffTerms.length == 0) {
            revert MissingSuccessorWitness(successorKey);
        }
        bytes32 witnessKey = keccak256(abi.encode(executionId, successorKey));
        if (successorWitnessHash[executionId][successorKey] != bytes32(0)) {
            revert WitnessAlreadyStaged(witnessKey);
        }
        bytes32 witnessHash = keccak256(abi.encode(payoffTerms, provenance));
        successorWitnessHash[executionId][successorKey] = witnessHash;
        _successorTerms[witnessKey] = payoffTerms;
        _successorProvenance[witnessKey] = provenance;
    }

    function stageExerciseWitness(bytes32 executionId, bytes32 fixingReference, bytes calldata finalFixings)
        external
        onlyRole(WITNESS_STAGER_ROLE)
    {
        if (executionId == bytes32(0) || fixingReference == bytes32(0) || finalFixings.length == 0) {
            revert ExerciseWitnessMismatch(executionId);
        }
        if (_exerciseFixingReference[executionId] != bytes32(0)) revert WitnessAlreadyStaged(executionId);
        _exerciseFixingReference[executionId] = fixingReference;
        _exerciseFixings[executionId] = finalFixings;
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
                    || Lots.unwrap(inputs[i].actionLots) > Lots.unwrap(snapshot.positionLots)
            ) revert InputPositionMismatch(inputs[i].positionId);
        }
        _validateLifecycleReplacements(successors, collateralReplacements);
        bool settleInputsFirst = action.kind == LifecycleActionKind.Exercise;
        if (settleInputsFirst) {
            _applyLifecycleInputs(executionId, action, inputs, successors.length);
        } else {
            _replaceLifecycleBacking(executionId, inputs, successors);
        }
        PositionId[] memory created = new PositionId[](successors.length);
        for (uint256 i; i < successors.length; ++i) {
            (bytes memory terms, PositionProvenance memory provenance) =
                _lifecycleSuccessorWitness(executionId, successors[i], inputs);
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
                terms,
                provenance
            );
            _validateLifecycleSuccessor(created[i], successors[i]);
        }
        if (!settleInputsFirst) _applyLifecycleInputs(executionId, action, inputs, successors.length);
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
        _replaceCompressionBacking(executionId, inputs, successors);
        PositionId[] memory created = new PositionId[](successors.length);
        for (uint256 i; i < successors.length; ++i) {
            (bytes memory terms, PositionProvenance memory provenance) =
                _compressionSuccessorWitness(executionId, successors[i], inputs);
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
                terms,
                provenance
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
        if (lifecycle.status != PositionStatus.Live || Lots.unwrap(lifecycle.exercisedLots) != 0) {
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
        PositionId expectedSuccessorId = _deriveSuccessorPositionId(
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
        _prepareDefaultSuccessorBacking(expectedSuccessorId, process, winningBid, economics, longAccount, shortAccount);
        PositionId successorId = _createLifecycleSuccessor(
            executionId,
            0,
            winningBid.eligibilityEvidenceHash,
            economics.seriesId,
            economics.seriesVersion,
            longAccount,
            shortAccount,
            lifecycle.remainingLots,
            economics.entryPriceTicks,
            positionEngine.payoffTerms(process.positionId),
            PositionProvenance({
                packageId: economics.packageId,
                packageVersion: economics.packageVersion,
                packageOrdinal: economics.packageOrdinal,
                packageProvenanceHash: economics.packageProvenanceHash
            })
        );
        if (PositionId.unwrap(successorId) != PositionId.unwrap(expectedSuccessorId)) {
            revert SuccessorMismatch(winningBid.eligibilityEvidenceHash);
        }
        LifecyclePositionSnapshot memory source = positionEngine.getLifecyclePosition(process.positionId);
        LifecyclePositionSnapshot memory successor = positionEngine.getLifecyclePosition(successorId);
        if (
            successor.longTerminalLiabilityBaseUnits != source.longTerminalLiabilityBaseUnits
                || successor.shortTerminalLiabilityBaseUnits != source.shortTerminalLiabilityBaseUnits
                || RiskDomainId.unwrap(successor.riskDomainId) != RiskDomainId.unwrap(source.riskDomainId)
                || successor.riskDomainVersion != source.riskDomainVersion
                || CollateralId.unwrap(successor.collateralId) != CollateralId.unwrap(source.collateralId)
        ) revert SuccessorMismatch(winningBid.eligibilityEvidenceHash);
        _closeAndReleaseWithoutRisk(process.positionId, PositionStatus.Replaced, executionId);
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
            terminalResidualMinor: terminalResidualMinor,
            fullyBackedClaimMinor: 0,
            unbackedClaimMinor: 0
        });
    }

    function _prepareDefaultSuccessorBacking(
        PositionId successorId,
        DefaultProcess calldata process,
        LiquidationBidRecord calldata winningBid,
        PositionEconomics memory economics,
        AccountId successorLong,
        AccountId successorShort
    ) private {
        bool defaultedLong = AccountId.unwrap(process.accountId) == AccountId.unwrap(economics.longAccountId);
        uint128 bidderLiability = defaultedLong ? economics.maxLongDebitMinor : economics.maxShortDebitMinor;
        if (winningBid.capacityMinor < process.takeoverContributionMinor) {
            revert CollateralReplacementMismatch(winningBid.bidderAccountId);
        }
        uint128 capacityForLiability = winningBid.capacityMinor - process.takeoverContributionMinor;
        CollateralLock memory capacityLock = collateralVault.getLock(winningBid.capacityLockId);
        if (
            capacityForLiability < bidderLiability || capacityLock.initialAmount != winningBid.capacityMinor
                || capacityLock.remainingAmount != 0 || capacityLock.status != LockStatus.Released
                || AccountId.unwrap(capacityLock.accountId) != AccountId.unwrap(winningBid.bidderAccountId)
        ) revert CollateralReplacementMismatch(winningBid.bidderAccountId);

        TerminalLiabilityReservationId survivorReservationId =
            defaultedLong ? economics.shortReservationId : economics.longReservationId;
        uint128 survivorLiability = defaultedLong ? economics.maxShortDebitMinor : economics.maxLongDebitMinor;
        if (survivorLiability == 0) return;
        TerminalLiabilityReservation memory survivor =
            collateralVault.terminalLiabilityReservationOf(survivorReservationId);
        AccountId survivorAccount = defaultedLong ? successorShort : successorLong;
        PositionLiabilitySide survivorSide = defaultedLong ? PositionLiabilitySide.Short : PositionLiabilitySide.Long;
        if (
            survivor.status != TerminalLiabilityReservationStatus.Active
                || AccountId.unwrap(survivor.payerAccountId) != AccountId.unwrap(survivorAccount)
                || survivor.remainingAmount != survivorLiability
        ) revert CollateralReplacementMismatch(survivorAccount);

        TerminalLiabilityReservationId[] memory sources = new TerminalLiabilityReservationId[](1);
        sources[0] = survivorReservationId;
        TerminalLiabilityReplacement[] memory replacements = new TerminalLiabilityReplacement[](1);
        replacements[0] = TerminalLiabilityReplacement({
            positionId: positionEngine.deriveLiabilityKey(successorId, uint8(survivorSide)),
            payerAccountId: survivorAccount,
            assetId: survivor.assetId,
            riskDomainId: survivor.riskDomainId,
            bindingVersion: survivor.bindingVersion,
            riskDomainVersion: survivor.riskDomainVersion,
            settlementDeadline: economics.settlementDeadline,
            finalResolutionAt: economics.finalResolutionAt,
            amount: survivorLiability
        });
        positionEngine.replaceLifecycleReservations(sources, replacements);
    }

    function applyTerminalDefaultRule(
        DefaultProcess calldata process,
        DefaultProcessRules calldata,
        InsurancePolicy calldata,
        uint128 insuranceDrawMinor,
        uint128 terminalResidualMinor
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
            terminalResidualMinor: terminalResidualMinor,
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
        bytes memory terms,
        PositionProvenance memory provenance
    ) private returns (PositionId) {
        PositionFunding memory noFunding = PositionFunding({
            lockId: CollateralLockId.wrap(bytes32(0)),
            lockReference: bytes32(0),
            expectedRemainingAmount: 0,
            expectedExpiry: 0
        });
        return positionEngine.createLifecycleSuccessorWithProvenance(
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

    function _replaceLifecycleBacking(
        bytes32 executionId,
        LifecycleInput[] calldata inputs,
        LifecycleSuccessor[] calldata successors
    ) private {
        TerminalLiabilityReservationId[] memory sources = _sourceReservations(inputs);
        BackingTarget[] memory targets = new BackingTarget[](successors.length * 2);
        uint256 targetCount;
        for (uint256 i; i < successors.length; ++i) {
            LifecycleSuccessor calldata successor = successors[i];
            PositionId positionId = _deriveSuccessorPositionId(
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
                positionEngine.seriesRegistry().getSeries(successor.seriesId, successor.seriesVersion);
            targetCount = _appendTarget(
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
        _replaceBacking(sources, targets);
    }

    function _replaceCompressionBacking(
        bytes32 executionId,
        CompressionPosition[] calldata inputs,
        CompressionSuccessor[] calldata successors
    ) private {
        TerminalLiabilityReservationId[] memory sources = _sourceReservations(inputs);
        BackingTarget[] memory targets = new BackingTarget[](successors.length * 2);
        uint256 targetCount;
        for (uint256 i; i < successors.length; ++i) {
            CompressionSuccessor calldata successor = successors[i];
            PositionId positionId = _deriveSuccessorPositionId(
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
                positionEngine.seriesRegistry().getSeries(successor.seriesId, successor.seriesVersion);
            targetCount = _appendTarget(
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
        _replaceBacking(sources, targets);
    }

    function _sourceReservations(LifecycleInput[] calldata inputs)
        private
        view
        returns (TerminalLiabilityReservationId[] memory sources)
    {
        sources = new TerminalLiabilityReservationId[](inputs.length * 2);
        uint256 count;
        for (uint256 i; i < inputs.length; ++i) {
            (PositionEconomics memory economics,) = positionEngine.getPosition(inputs[i].positionId);
            count = _appendSource(sources, count, economics.longReservationId);
            count = _appendSource(sources, count, economics.shortReservationId);
        }
        assembly ("memory-safe") {
            mstore(sources, count)
        }
        _sortSources(sources);
    }

    function _sourceReservations(CompressionPosition[] calldata inputs)
        private
        view
        returns (TerminalLiabilityReservationId[] memory sources)
    {
        sources = new TerminalLiabilityReservationId[](inputs.length * 2);
        uint256 count;
        for (uint256 i; i < inputs.length; ++i) {
            (PositionEconomics memory economics,) = positionEngine.getPosition(inputs[i].positionId);
            count = _appendSource(sources, count, economics.longReservationId);
            count = _appendSource(sources, count, economics.shortReservationId);
        }
        assembly ("memory-safe") {
            mstore(sources, count)
        }
        _sortSources(sources);
    }

    function _replaceBacking(TerminalLiabilityReservationId[] memory sources, BackingTarget[] memory targets) private {
        bool[] memory assignedTargets = new bool[](targets.length);
        for (uint256 i; i < sources.length; ++i) {
            TerminalLiabilityReservation memory leader = collateralVault.terminalLiabilityReservationOf(sources[i]);
            bool earlierGroup;
            for (uint256 j; j < i; ++j) {
                TerminalLiabilityReservation memory earlier = collateralVault.terminalLiabilityReservationOf(sources[j]);
                if (_sameBackingGroup(leader, earlier)) earlierGroup = true;
            }
            if (earlierGroup) continue;

            uint256 sourceCount;
            for (uint256 j; j < sources.length; ++j) {
                TerminalLiabilityReservation memory source = collateralVault.terminalLiabilityReservationOf(sources[j]);
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
                TerminalLiabilityReservation memory source = collateralVault.terminalLiabilityReservationOf(sources[j]);
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
            positionEngine.replaceLifecycleReservations(groupedSources, replacements);
        }
        for (uint256 i; i < targets.length; ++i) {
            if (!assignedTargets[i]) revert CollateralReplacementMismatch(targets[i].payerAccountId);
        }
    }

    function _appendSource(
        TerminalLiabilityReservationId[] memory sources,
        uint256 count,
        TerminalLiabilityReservationId source
    ) private pure returns (uint256) {
        if (TerminalLiabilityReservationId.unwrap(source) == bytes32(0)) return count;
        sources[count] = source;
        return count + 1;
    }

    function _appendTarget(
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
    ) private view returns (uint256) {
        if (amount == 0) return count;
        targets[count] = BackingTarget({
            liabilityKey: positionEngine.deriveLiabilityKey(positionId, uint8(side)),
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

    function _deriveSuccessorPositionId(
        bytes32 executionId,
        uint256 index,
        bytes32 successorKey,
        SeriesId seriesId,
        uint32 seriesVersion,
        AccountId longAccountId,
        AccountId shortAccountId,
        Lots lots,
        PriceTicks entryPriceTicks
    ) private view returns (PositionId) {
        PositionFunding memory noFunding;
        return positionEngine.derivePositionId(
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

    function _sortSources(TerminalLiabilityReservationId[] memory sources) private pure {
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
        private
        pure
        returns (bool)
    {
        return AccountId.unwrap(left.payerAccountId) == AccountId.unwrap(right.payerAccountId)
            && CollateralId.unwrap(left.collateralId) == CollateralId.unwrap(right.collateralId)
            && RiskDomainId.unwrap(left.riskDomainId) == RiskDomainId.unwrap(right.riskDomainId)
            && left.riskDomainVersion == right.riskDomainVersion;
    }

    function _sameBackingGroup(TerminalLiabilityReservation memory source, BackingTarget memory target)
        private
        pure
        returns (bool)
    {
        return AccountId.unwrap(source.payerAccountId) == AccountId.unwrap(target.payerAccountId)
            && CollateralId.unwrap(source.collateralId) == CollateralId.unwrap(target.collateralId)
            && RiskDomainId.unwrap(source.riskDomainId) == RiskDomainId.unwrap(target.riskDomainId)
            && source.riskDomainVersion == target.riskDomainVersion;
    }

    function _validateLifecycleSuccessor(PositionId positionId, LifecycleSuccessor calldata expected) private view {
        LifecyclePositionSnapshot memory actual = positionEngine.getLifecyclePosition(positionId);
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
        ) revert SuccessorMismatch(expected.successorKey);
    }

    function _validateCompressionSuccessor(PositionId positionId, CompressionSuccessor calldata expected) private view {
        LifecyclePositionSnapshot memory actual = positionEngine.getLifecyclePosition(positionId);
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

    function _lifecycleSuccessorWitness(
        bytes32 executionId,
        LifecycleSuccessor calldata successor,
        LifecycleInput[] calldata inputs
    ) private view returns (bytes memory terms, PositionProvenance memory provenance) {
        bytes32 witnessKey = keccak256(abi.encode(executionId, successor.successorKey));
        if (successorWitnessHash[executionId][successor.successorKey] != bytes32(0)) {
            terms = _successorTerms[witnessKey];
            provenance = _successorProvenance[witnessKey];
            if (provenance.packageProvenanceHash != successor.packageProvenanceHash) {
                revert SuccessorMismatch(successor.successorKey);
            }
            return (terms, provenance);
        }
        if (successor.packageProvenanceHash != bytes32(0)) revert MissingSuccessorWitness(successor.successorKey);
        terms = _findLifecycleTerms(successor, inputs);
    }

    function _compressionSuccessorWitness(
        bytes32 executionId,
        CompressionSuccessor calldata successor,
        CompressionPosition[] calldata inputs
    ) private view returns (bytes memory terms, PositionProvenance memory provenance) {
        bytes32 witnessKey = keccak256(abi.encode(executionId, successor.successorKey));
        if (successorWitnessHash[executionId][successor.successorKey] != bytes32(0)) {
            terms = _successorTerms[witnessKey];
            provenance = _successorProvenance[witnessKey];
            if (PackageId.unwrap(provenance.packageId) != bytes32(0)) {
                revert SuccessorMismatch(successor.successorKey);
            }
            return (terms, provenance);
        }
        terms = _findCompressionTerms(successor, inputs);
    }

    function _applyLifecycleInputs(
        bytes32 executionId,
        LifecycleAction calldata action,
        LifecycleInput[] calldata inputs,
        uint256 successorCount
    ) private {
        if (action.kind == LifecycleActionKind.Exercise) {
            bytes32 fixingReference = _exerciseFixingReference[executionId];
            bytes memory finalFixings = _exerciseFixings[executionId];
            if (
                fixingReference == bytes32(0) || finalFixings.length == 0
                    || keccak256(abi.encode(fixingReference, keccak256(finalFixings))) != action.economicTransitionHash
            ) revert ExerciseWitnessMismatch(executionId);
            for (uint256 i; i < inputs.length; ++i) {
                (, PositionLifecycle memory lifecycleBefore) = positionEngine.getPosition(inputs[i].positionId);
                positionEngine.exercisePositionQuantity(
                    inputs[i].positionId,
                    inputs[i].actionLots,
                    action.actorAccountId,
                    lifecycleBefore.lifecycleNonce,
                    fixingReference,
                    finalFixings
                );
                (PositionEconomics memory economics, PositionLifecycle memory lifecycleAfter) =
                    positionEngine.getPosition(inputs[i].positionId);
                if (Lots.unwrap(lifecycleAfter.remainingLots) != 0) {
                    positionEngine.closePositionQuantity(
                        inputs[i].positionId,
                        lifecycleAfter.remainingLots,
                        action.actorAccountId,
                        lifecycleAfter.lifecycleNonce,
                        PositionStatus.Replaced,
                        executionId
                    );
                }
                _reducePositionExposure(inputs[i].positionId);
                _finalize(economics.longReservationId);
                _finalize(economics.shortReservationId);
            }
            return;
        }
        if (action.kind == LifecycleActionKind.Abandon) {
            for (uint256 i; i < inputs.length; ++i) {
                (, PositionLifecycle memory lifecycleBefore) = positionEngine.getPosition(inputs[i].positionId);
                positionEngine.abandonPositionQuantity(
                    inputs[i].positionId,
                    inputs[i].actionLots,
                    action.actorAccountId,
                    lifecycleBefore.lifecycleNonce,
                    executionId
                );
                (PositionEconomics memory economics, PositionLifecycle memory lifecycleAfter) =
                    positionEngine.getPosition(inputs[i].positionId);
                if (Lots.unwrap(lifecycleAfter.remainingLots) != 0) {
                    positionEngine.closePositionQuantity(
                        inputs[i].positionId,
                        lifecycleAfter.remainingLots,
                        action.actorAccountId,
                        lifecycleAfter.lifecycleNonce,
                        PositionStatus.Replaced,
                        executionId
                    );
                }
                _reducePositionExposure(inputs[i].positionId);
                _finalize(economics.longReservationId);
                _finalize(economics.shortReservationId);
            }
            return;
        }
        if (action.kind == LifecycleActionKind.PartialUnwind) {
            if (successorCount == 0) revert UnsupportedLifecycleAction(action.kind);
            for (uint256 i; i < inputs.length; ++i) {
                (PositionEconomics memory economics, PositionLifecycle memory lifecycle) =
                    positionEngine.getPosition(inputs[i].positionId);
                positionEngine.closePositionQuantity(
                    inputs[i].positionId,
                    lifecycle.remainingLots,
                    action.actorAccountId,
                    lifecycle.lifecycleNonce,
                    PositionStatus.Replaced,
                    executionId
                );
                _reducePositionExposure(inputs[i].positionId);
                _finalize(economics.longReservationId);
                _finalize(economics.shortReservationId);
            }
            return;
        }
        PositionStatus terminalStatus = action.kind == LifecycleActionKind.Lapse
            ? PositionStatus.Lapsed
            : successorCount == 0 ? PositionStatus.ClosedByUnwind : PositionStatus.Replaced;
        for (uint256 i; i < inputs.length; ++i) {
            _closeAndRelease(inputs[i].positionId, terminalStatus, executionId);
        }
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
        _closeAndReleaseWithoutRisk(positionId, status, transitionReference);
        _reducePositionExposure(positionId);
    }

    function _closeAndReleaseWithoutRisk(PositionId positionId, PositionStatus status, bytes32 transitionReference)
        private
    {
        (PositionEconomics memory economics,) = positionEngine.getPosition(positionId);
        positionEngine.recordZeroLiabilityAlternative(positionId, status, transitionReference);
        _finalize(economics.longReservationId);
        _finalize(economics.shortReservationId);
    }

    function _reducePositionExposure(PositionId positionId) private {
        (PositionEconomics memory economics,) = positionEngine.getPosition(positionId);
        _reduceAccountExposure(positionId, economics.longAccountId);
        if (AccountId.unwrap(economics.shortAccountId) != AccountId.unwrap(economics.longAccountId)) {
            _reduceAccountExposure(positionId, economics.shortAccountId);
        }
    }

    function _reduceAccountExposure(PositionId positionId, AccountId accountId) private {
        RiskExposureReduction memory reduction = portfolioRiskEngine.exposureReductionWitness(positionId, accountId);
        if (reduction.exposureId != bytes32(0)) portfolioRiskEngine.reduceExposure(reduction);
    }

    function _finalize(TerminalLiabilityReservationId reservationId) private {
        if (
            TerminalLiabilityReservationId.unwrap(reservationId) != bytes32(0)
                && collateralVault.terminalLiabilityReservationStatusOf(reservationId)
                    == TerminalLiabilityReservationStatus.Active
        ) {
            collateralVault.finalizeTerminalLiabilityReservation(reservationId);
        }
    }

    function _supportedAction(LifecycleActionKind kind, uint256 successorCount) private pure returns (bool) {
        if (kind == LifecycleActionKind.FullUnwind || kind == LifecycleActionKind.Lapse) return successorCount == 0;
        if (kind == LifecycleActionKind.Exercise || kind == LifecycleActionKind.Abandon) return true;
        if (successorCount == 0) return false;
        return kind == LifecycleActionKind.Transfer || kind == LifecycleActionKind.Assignment
            || kind == LifecycleActionKind.PartialUnwind || kind == LifecycleActionKind.Split
            || kind == LifecycleActionKind.Merge || kind == LifecycleActionKind.Amendment
            || kind == LifecycleActionKind.Novation || kind == LifecycleActionKind.Roll
            || kind == LifecycleActionKind.CollateralPolicyChange || kind == LifecycleActionKind.CompressionHandoff;
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
