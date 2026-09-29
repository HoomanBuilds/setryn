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
import {AccountId, PositionId, SeriesId} from "../types/Identifiers.sol";
import {
    LifecycleAction,
    LifecycleActionId,
    LifecycleActionKind,
    LifecycleCollateralReplacement,
    LifecycleInput,
    LifecycleSuccessor
} from "../types/LifecycleTypes.sol";
import {PositionCreation, PositionFunding, PositionProvenance} from "../types/PositionTypes.sol";
import {Lots, PriceTicks} from "../types/Units.sol";

import {LifecycleActionLib} from "./LifecycleActionLib.sol";
import {LifecycleExecutorDependencies} from "./LifecycleExecutorTypes.sol";

import {IPositionLifecycleExecutorLinkedErrors} from "./IPositionLifecycleExecutorLinkedErrors.sol";

contract PositionLifecycleExecutor is
    IPositionLifecycleExecutorLinkedErrors,
    ILifecycleAtomicExecutor,
    ICompressionLifecycleExecutor,
    IDefaultLifecycleExecutor,
    AccessControlDefaultAdminRules,
    ReentrancyGuard
{
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
        return LifecycleActionLib.executeLifecycleActionBody(
            _dependencies(),
            executionConsumed,
            successorWitnessHash,
            _successorTerms,
            _successorProvenance,
            _exerciseFixingReference,
            _exerciseFixings,
            actionId,
            action,
            inputs,
            successors,
            collateralReplacements
        );
    }

    function executeCompression(
        CompressionPlanId planId,
        CompressionPosition[] calldata inputs,
        CompressionSuccessor[] calldata successors,
        ReplacementCollateral[] calldata replacementCollateral
    ) external nonReentrant returns (bytes32 outcomeHash) {
        _requireCaller(COMPRESSION_COORDINATOR_ROLE);
        return LifecycleActionLib.executeCompressionBody(
            _dependencies(),
            executionConsumed,
            successorWitnessHash,
            _successorTerms,
            _successorProvenance,
            planId,
            inputs,
            successors,
            replacementCollateral
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
        return LifecycleActionLib.executeDefaultNovationBody(
            _dependencies(), executionConsumed, process, winningBid, insuranceDrawMinor, terminalResidualMinor
        );
    }

    function applyTerminalDefaultRule(
        DefaultProcess calldata process,
        DefaultProcessRules calldata,
        InsurancePolicy calldata,
        uint128 insuranceDrawMinor,
        uint128 terminalResidualMinor
    ) external nonReentrant returns (DefaultExecutionResult memory result) {
        _requireCaller(DEFAULT_PROCESS_ENGINE_ROLE);
        return LifecycleActionLib.applyTerminalDefaultRuleBody(
            _dependencies(), executionConsumed, process, insuranceDrawMinor, terminalResidualMinor
        );
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

    function _consume(bytes32 executionId) private {
        if (executionConsumed[executionId]) revert ExecutionAlreadyConsumed(executionId);
        executionConsumed[executionId] = true;
    }

    function _requireCaller(bytes32 role) private view {
        if (!hasRole(role, msg.sender)) revert UnauthorizedCaller(role, msg.sender);
    }

    /// Linked libraries execute in this contract's context and receive the immutable dependency graph explicitly.
    function _dependencies() private view returns (LifecycleExecutorDependencies memory) {
        return LifecycleExecutorDependencies({
            positionEngine: positionEngine, collateralVault: collateralVault, portfolioRiskEngine: portfolioRiskEngine
        });
    }

    function _requireDependency(address dependency) private view {
        if (dependency == address(0)) revert ZeroDependency(dependency);
        if (dependency.code.length == 0) revert DependencyHasNoCode(dependency);
    }
}
