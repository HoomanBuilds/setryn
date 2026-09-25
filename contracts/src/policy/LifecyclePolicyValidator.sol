// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {ILifecyclePolicyValidator} from "../interfaces/ILifecyclePolicyValidator.sol";
import {IPositionEngine} from "../interfaces/IPositionEngine.sol";
import {ISeriesRegistry} from "../interfaces/ISeriesRegistry.sol";
import {IPackageRegistry} from "../interfaces/IPackageRegistry.sol";
import {IFeeScheduleRegistry} from "../interfaces/IFeeScheduleRegistry.sol";
import {IRiskDomainRegistry} from "../interfaces/IRiskDomainRegistry.sol";
import {InstrumentVersion} from "../types/InstrumentDefinition.sol";
import {MarketVersion} from "../types/MarketDefinition.sol";
import {PackageVersion} from "../types/PackageDefinition.sol";
import {PositionEconomics, PositionLifecycle} from "../types/PositionTypes.sol";
import {SeriesVersion} from "../types/SeriesDefinition.sol";
import {
    LifecycleAction,
    LifecycleActionKind,
    LifecycleCollateralReplacement,
    LifecycleConsent,
    LifecyclePositionSnapshot,
    LifecycleSuccessor
} from "../types/LifecycleTypes.sol";
import {ExercisePolicyId, FeeScheduleId, PackageId, RiskDomainId, SeriesId} from "../types/Identifiers.sol";
import {Lots} from "../types/Units.sol";

contract LifecyclePolicyValidator is ILifecyclePolicyValidator {
    bytes32 public constant POLICY_CONTEXT_TYPEHASH = keccak256(
        "SetrynLifecyclePolicyContextV1(uint8 actionKind,bytes32 dependencyRoot,bytes32 payoffVectorRoot,bytes32 riskDomainId,uint32 riskDomainVersion,bytes32 feeScheduleId,uint32 feeScheduleVersion,bool breaksPackageProvenance,bytes32 packageBreakPermissionHash)"
    );
    bytes32 public constant PACKAGE_BREAK_TYPEHASH = keccak256(
        "SetrynLifecyclePackageBreakV1(uint8 actionKind,bytes32 inputPackageRoot,bytes32 successorPackageRoot)"
    );

    uint256 public constant MAXIMUM_POSITIONS = 16;

    IPositionEngine public immutable positionEngine;
    ISeriesRegistry public immutable seriesRegistry;
    IPackageRegistry public immutable packageRegistry;
    IFeeScheduleRegistry public immutable feeScheduleRegistry;
    IRiskDomainRegistry public immutable riskDomainRegistry;

    error ZeroDependency();
    error DependencyHasNoCode();
    error DependencyGraphMismatch(address expected, address actual);
    error InvalidPolicyContext(bytes32 expected, bytes32 actual);
    error InvalidDependency();
    error InvalidExerciseConvention();
    error InvalidPackageBreak(bytes32 expected, bytes32 actual);
    error PositionBoundExceeded();

    constructor(IPositionEngine positionEngine_, IPackageRegistry packageRegistry_) {
        if (address(positionEngine_) == address(0) || address(packageRegistry_) == address(0)) revert ZeroDependency();
        if (address(positionEngine_).code.length == 0 || address(packageRegistry_).code.length == 0) {
            revert DependencyHasNoCode();
        }
        positionEngine = positionEngine_;
        seriesRegistry = positionEngine_.seriesRegistry();
        if (address(packageRegistry_.seriesRegistry()) != address(seriesRegistry)) {
            revert DependencyGraphMismatch(address(seriesRegistry), address(packageRegistry_.seriesRegistry()));
        }
        packageRegistry = packageRegistry_;
        feeScheduleRegistry = seriesRegistry.marketRegistry().feeScheduleRegistry();
        riskDomainRegistry = seriesRegistry.marketRegistry().riskDomainRegistry();
    }

    function validateLifecycleAction(
        LifecycleAction calldata action,
        LifecyclePositionSnapshot[] calldata inputs,
        LifecycleSuccessor[] calldata successors,
        LifecycleCollateralReplacement[] calldata,
        LifecycleConsent[] calldata
    ) external view {
        if (inputs.length == 0 || inputs.length > MAXIMUM_POSITIONS || successors.length > MAXIMUM_POSITIONS) {
            revert PositionBoundExceeded();
        }
        if (
            !riskDomainRegistry.isLifecycleEnabled(action.riskDomainId, action.riskDomainVersion)
                || !feeScheduleRegistry.isLifecycleEnabled(action.feeScheduleId, action.feeScheduleVersion)
        ) revert InvalidDependency();

        bytes32 dependencyRoot;
        bytes32 payoffVectorRoot;
        bytes32 inputPackageRoot;
        bytes32 successorPackageRoot;
        for (uint256 i; i < inputs.length; ++i) {
            (bytes32 dependencyLeaf, bytes32 payoffLeaf, bytes32 packageLeaf) = _validateInput(action, inputs[i]);
            dependencyRoot = keccak256(abi.encode(dependencyRoot, dependencyLeaf));
            payoffVectorRoot = keccak256(abi.encode(payoffVectorRoot, payoffLeaf));
            if (packageLeaf != bytes32(0)) inputPackageRoot = keccak256(abi.encode(inputPackageRoot, packageLeaf));
        }
        for (uint256 i; i < successors.length; ++i) {
            (bytes32 dependencyLeaf, bytes32 payoffLeaf) = _validateSuccessor(action, successors[i]);
            dependencyRoot = keccak256(abi.encode(dependencyRoot, dependencyLeaf));
            payoffVectorRoot = keccak256(abi.encode(payoffVectorRoot, payoffLeaf));
            if (successors[i].packageProvenanceHash != bytes32(0)) {
                successorPackageRoot = keccak256(abi.encode(successorPackageRoot, successors[i].packageProvenanceHash));
            }
        }

        bytes32 expectedBreakHash =
            keccak256(abi.encode(PACKAGE_BREAK_TYPEHASH, uint8(action.kind), inputPackageRoot, successorPackageRoot));
        if (action.breaksPackageProvenance) {
            if (action.packageBreakPermissionHash != expectedBreakHash) {
                revert InvalidPackageBreak(expectedBreakHash, action.packageBreakPermissionHash);
            }
        } else if (inputPackageRoot != successorPackageRoot) {
            revert InvalidPackageBreak(inputPackageRoot, successorPackageRoot);
        }

        bytes32 expectedContext = keccak256(
            abi.encode(
                POLICY_CONTEXT_TYPEHASH,
                uint8(action.kind),
                dependencyRoot,
                payoffVectorRoot,
                action.riskDomainId,
                action.riskDomainVersion,
                action.feeScheduleId,
                action.feeScheduleVersion,
                action.breaksPackageProvenance,
                action.packageBreakPermissionHash
            )
        );
        if (expectedContext != action.policyContextHash) {
            revert InvalidPolicyContext(expectedContext, action.policyContextHash);
        }
    }

    function _validateInput(LifecycleAction calldata action, LifecyclePositionSnapshot calldata input)
        private
        view
        returns (bytes32 dependencyLeaf, bytes32 payoffLeaf, bytes32 packageLeaf)
    {
        if (
            RiskDomainId.unwrap(input.riskDomainId) != RiskDomainId.unwrap(action.riskDomainId)
                || input.riskDomainVersion != action.riskDomainVersion
                || FeeScheduleId.unwrap(input.feeScheduleId) != FeeScheduleId.unwrap(action.feeScheduleId)
                || input.feeScheduleVersion != action.feeScheduleVersion
                || !seriesRegistry.isLifecycleEnabled(input.seriesId, input.seriesVersion)
        ) revert InvalidDependency();
        SeriesVersion memory series = seriesRegistry.getSeries(input.seriesId, input.seriesVersion);
        MarketVersion memory market =
            seriesRegistry.marketRegistry().getMarket(series.definition.marketId, series.definition.marketVersion);
        InstrumentVersion memory instrument = seriesRegistry.instrumentRegistry()
            .getInstrument(series.definition.instrumentId, series.definition.instrumentVersion);
        if (
            RiskDomainId.unwrap(market.definition.riskDomainId) != RiskDomainId.unwrap(action.riskDomainId)
                || market.definition.riskDomainVersion != action.riskDomainVersion
                || FeeScheduleId.unwrap(market.definition.feeScheduleId) != FeeScheduleId.unwrap(action.feeScheduleId)
                || market.definition.feeScheduleVersion != action.feeScheduleVersion
                || ExercisePolicyId.unwrap(input.exercisePolicyId)
                    != ExercisePolicyId.unwrap(series.definition.exercisePolicyId)
        ) revert InvalidDependency();
        _validateExercise(action.kind, input, series);

        (PositionEconomics memory economics, PositionLifecycle memory lifecycle) =
            positionEngine.getPosition(input.positionId);
        if (
            SeriesId.unwrap(economics.seriesId) != SeriesId.unwrap(input.seriesId)
                || economics.seriesVersion != input.seriesVersion
                || Lots.unwrap(lifecycle.remainingLots) != Lots.unwrap(input.positionLots)
        ) revert InvalidDependency();

        bytes32 packagePolicyHash;
        if (PackageId.unwrap(economics.packageId) != bytes32(0)) {
            if (!packageRegistry.isLifecycleEnabled(economics.packageId, economics.packageVersion)) {
                revert InvalidDependency();
            }
            PackageVersion memory package = packageRegistry.getPackage(economics.packageId, economics.packageVersion);
            packagePolicyHash = package.definition.lifecyclePolicyHash;
            if (economics.packageProvenanceHash != input.packageProvenanceHash) revert InvalidDependency();
        } else if (input.packageProvenanceHash != bytes32(0)) {
            revert InvalidDependency();
        }

        dependencyLeaf = keccak256(
            abi.encode(
                input.seriesId,
                input.seriesVersion,
                series.versionHash,
                market.versionHash,
                instrument.versionHash,
                instrument.definition.lifecyclePolicyHash,
                economics.packageId,
                economics.packageVersion,
                packagePolicyHash
            )
        );
        payoffLeaf = keccak256(
            abi.encode(
                input.positionId,
                input.economicsHash,
                series.definition.payoffTermsHash,
                series.definition.exercisePolicyId,
                input.positionLots,
                input.longTerminalLiabilityBaseUnits,
                input.shortTerminalLiabilityBaseUnits
            )
        );
        packageLeaf = input.packageProvenanceHash;
    }

    function _validateSuccessor(LifecycleAction calldata action, LifecycleSuccessor calldata successor)
        private
        view
        returns (bytes32 dependencyLeaf, bytes32 payoffLeaf)
    {
        if (
            RiskDomainId.unwrap(successor.riskDomainId) != RiskDomainId.unwrap(action.riskDomainId)
                || successor.riskDomainVersion != action.riskDomainVersion
                || !seriesRegistry.isLifecycleEnabled(successor.seriesId, successor.seriesVersion)
        ) revert InvalidDependency();
        SeriesVersion memory series = seriesRegistry.getSeries(successor.seriesId, successor.seriesVersion);
        MarketVersion memory market =
            seriesRegistry.marketRegistry().getMarket(series.definition.marketId, series.definition.marketVersion);
        InstrumentVersion memory instrument = seriesRegistry.instrumentRegistry()
            .getInstrument(series.definition.instrumentId, series.definition.instrumentVersion);
        if (
            RiskDomainId.unwrap(market.definition.riskDomainId) != RiskDomainId.unwrap(action.riskDomainId)
                || market.definition.riskDomainVersion != action.riskDomainVersion
                || FeeScheduleId.unwrap(market.definition.feeScheduleId) != FeeScheduleId.unwrap(action.feeScheduleId)
                || market.definition.feeScheduleVersion != action.feeScheduleVersion
        ) revert InvalidDependency();
        dependencyLeaf = keccak256(
            abi.encode(
                successor.seriesId,
                successor.seriesVersion,
                series.versionHash,
                market.versionHash,
                instrument.versionHash,
                instrument.definition.lifecyclePolicyHash
            )
        );
        payoffLeaf = keccak256(
            abi.encode(
                successor.successorKey,
                successor.economicsHash,
                series.definition.payoffTermsHash,
                series.definition.exercisePolicyId,
                successor.lots,
                successor.longTerminalLiabilityBaseUnits,
                successor.shortTerminalLiabilityBaseUnits
            )
        );
    }

    function _validateExercise(
        LifecycleActionKind kind,
        LifecyclePositionSnapshot calldata input,
        SeriesVersion memory series
    ) private view {
        if (kind == LifecycleActionKind.Exercise) {
            if (
                block.timestamp < series.definition.exerciseOpensAt
                    || block.timestamp > series.definition.exerciseCutoffAt
                    || Lots.unwrap(input.remainingExerciseLots) == 0
            ) revert InvalidExerciseConvention();
        } else if (kind == LifecycleActionKind.Lapse && block.timestamp < input.lapseEligibleAt) {
            revert InvalidExerciseConvention();
        }
    }
}
