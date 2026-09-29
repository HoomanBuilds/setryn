// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IPortfolioRiskEngine} from "../interfaces/IPortfolioRiskEngine.sol";
import {AdapterDefinitionLib} from "../libraries/AdapterDefinitionLib.sol";
import {PortfolioRiskLib} from "../libraries/PortfolioRiskLib.sol";
import {RiskDomainDefinitionLib} from "../libraries/RiskDomainDefinitionLib.sol";
import {AdapterVersion} from "../types/AdapterDefinition.sol";
import {
    AccountId,
    AdapterId,
    AdapterKindId,
    CollateralId,
    PositionId,
    RiskDomainId,
    RiskModelId
} from "../types/Identifiers.sol";
import {DefaultProcessLib} from "../libraries/DefaultProcessLib.sol";
import {ObjectiveDefaultState} from "../types/DefaultTypes.sol";
import {RiskDomainVersion} from "../types/RiskDomainDefinition.sol";
import {
    DefaultRiskProof,
    PortfolioPositionWitness,
    PortfolioRiskMetrics,
    PortfolioRiskResult,
    PositionRiskExposure,
    PositionRiskSnapshot,
    RiskAdmission,
    RiskAdmissionId,
    RiskAdmissionStatus,
    RiskExposureReduction,
    RiskEvaluationContext,
    RiskObservation
} from "../types/RiskTypes.sol";
import {PositionStatus} from "../types/PositionTypes.sol";
import {PortfolioRiskDependencies, PendingRiskExposure} from "./PortfolioRiskTypes.sol";

/// Linked logic for the portfolio risk engine: exposure binding and reduction, reduction witnesses, and objective
/// default state publication. Runs through DELEGATECALL in the risk engine's context against its storage.
library PortfolioRiskExposureLib {
    bytes32 internal constant DEFAULT_PROOF_TYPEHASH = keccak256("SetrynObjectiveDefaultProofV2");
    bytes32 internal constant EXPOSURE_REDUCTION_TYPEHASH = keccak256("SetrynRiskExposureReductionV1");
    uint16 internal constant MAXIMUM_ACTIVE_POSITIONS = 32;

    function reduceExposure(
        PortfolioRiskDependencies memory deps,
        mapping(RiskDomainId domainId => mapping(uint32 version => uint128 amount)) storage $liveOpenInterest,
        mapping(
            AccountId accountId => mapping(RiskDomainId domainId => mapping(uint32 version => uint128 amount))
        ) storage $accountLiveOpenInterest,
        mapping(bytes32 exposureId => PositionRiskExposure exposure) storage $positionExposures,
        mapping(bytes32 positionKey => bytes32 exposureId) storage $positionExposureIds,
        mapping(bytes32 exposureId => PositionId[] positionIds) storage $exposurePositions,
        mapping(bytes32 exposureId => mapping(PositionId positionId => uint128 lots)) storage $initialPositionLots,
        mapping(bytes32 exposureId => mapping(PositionId positionId => uint128 lots)) storage $accountedPositionLots,
        mapping(
            AccountId accountId => mapping(RiskDomainId domainId => mapping(uint32 version => uint16 count))
        ) storage $activePositionCount,
        mapping(bytes32 transitionId => bool consumed) storage $consumedExposureTransitions,
        RiskExposureReduction calldata reduction
    ) external {
        if (reduction.transitionId == bytes32(0)) revert IPortfolioRiskEngine.ZeroReference();
        if ($consumedExposureTransitions[reduction.transitionId]) {
            revert IPortfolioRiskEngine.ExposureTransitionAlreadyConsumed(reduction.transitionId);
        }
        PositionRiskExposure storage exposure = $positionExposures[reduction.exposureId];
        PositionId[] storage positionIds = $exposurePositions[reduction.exposureId];
        if (
            exposure.exposureId != reduction.exposureId
                || RiskAdmissionId.unwrap(exposure.admissionId) != RiskAdmissionId.unwrap(reduction.admissionId)
                || AccountId.unwrap(exposure.accountId) != AccountId.unwrap(reduction.accountId)
                || positionIds.length == 0
                || PositionId.unwrap(positionIds[0]) != PositionId.unwrap(reduction.canonicalPositionId)
                || $positionExposureIds[_positionKey(reduction.canonicalPositionId, reduction.accountId)]
                    != reduction.exposureId || exposure.accountedPositionLots != reduction.expectedPreviousPositionLots
        ) revert IPortfolioRiskEngine.InvalidExposureReduction(reduction.canonicalPositionId, reduction.accountId);
        PositionRiskSnapshot memory snapshot =
            deps.positionEngine.positionRiskSnapshot(reduction.canonicalPositionId, reduction.accountId);
        if (
            RiskDomainId.unwrap(snapshot.riskDomainId) != RiskDomainId.unwrap(exposure.riskDomainId)
                || snapshot.riskDomainVersion != exposure.riskDomainVersion
                || snapshot.remainingLots != reduction.expectedNewPositionLots
                || snapshot.remainingLots >= exposure.accountedPositionLots
        ) revert IPortfolioRiskEngine.InvalidExposureReduction(reduction.canonicalPositionId, reduction.accountId);
        bytes32[] memory stateHashes = new bytes32[](positionIds.length);
        uint128 canonicalInitial = exposure.initialPositionLots;
        for (uint256 i; i < positionIds.length; ++i) {
            PositionRiskSnapshot memory component =
                deps.positionEngine.positionRiskSnapshot(positionIds[i], reduction.accountId);
            uint128 initialLots = $initialPositionLots[reduction.exposureId][positionIds[i]];
            uint128 accountedLots = $accountedPositionLots[reduction.exposureId][positionIds[i]];
            if (
                RiskDomainId.unwrap(component.riskDomainId) != RiskDomainId.unwrap(exposure.riskDomainId)
                    || component.riskDomainVersion != exposure.riskDomainVersion
                    || component.remainingLots >= accountedLots
                    || uint256(component.remainingLots) * canonicalInitial
                        != uint256(snapshot.remainingLots) * initialLots
            ) revert IPortfolioRiskEngine.InvalidExposureReduction(reduction.canonicalPositionId, reduction.accountId);
            stateHashes[i] = component.stateHash;
        }
        uint128 expectedRemaining = uint128(
            Math.mulDiv(
                exposure.initialOpenInterestBaseUnits,
                snapshot.remainingLots,
                exposure.initialPositionLots,
                Math.Rounding.Ceil
            )
        );
        uint128 expectedReduction = exposure.remainingOpenInterestBaseUnits - expectedRemaining;
        bytes32 expectedTransitionId = keccak256(
            abi.encode(
                EXPOSURE_REDUCTION_TYPEHASH,
                reduction.exposureId,
                reduction.canonicalPositionId,
                reduction.accountId,
                reduction.admissionId,
                reduction.expectedPreviousPositionLots,
                snapshot.remainingLots,
                expectedReduction,
                keccak256(abi.encodePacked(stateHashes))
            )
        );
        if (
            expectedReduction == 0 || expectedReduction != reduction.expectedOpenInterestReductionBaseUnits
                || expectedTransitionId != reduction.transitionId
        ) revert IPortfolioRiskEngine.InvalidExposureReduction(reduction.canonicalPositionId, reduction.accountId);
        uint128 domainLive = $liveOpenInterest[exposure.riskDomainId][exposure.riskDomainVersion];
        uint128 accountLive =
            $accountLiveOpenInterest[exposure.accountId][exposure.riskDomainId][exposure.riskDomainVersion];
        if (domainLive < expectedReduction || accountLive < expectedReduction) {
            revert IPortfolioRiskEngine.ExposureUnderflow(
                domainLive < accountLive ? domainLive : accountLive, expectedReduction
            );
        }
        $consumedExposureTransitions[reduction.transitionId] = true;
        exposure.accountedPositionLots = snapshot.remainingLots;
        exposure.remainingOpenInterestBaseUnits = expectedRemaining;
        for (uint256 i; i < positionIds.length; ++i) {
            PositionRiskSnapshot memory component =
                deps.positionEngine.positionRiskSnapshot(positionIds[i], reduction.accountId);
            $accountedPositionLots[reduction.exposureId][positionIds[i]] = component.remainingLots;
            if (component.remainingLots == 0) {
                delete $positionExposureIds[_positionKey(positionIds[i], reduction.accountId)];
            }
        }
        if (expectedRemaining == 0) {
            $activePositionCount[
                exposure.accountId
            ][exposure.riskDomainId][exposure.riskDomainVersion] -= exposure.positionCount;
        }
        $liveOpenInterest[exposure.riskDomainId][exposure.riskDomainVersion] = domainLive - expectedReduction;
        $accountLiveOpenInterest[exposure.accountId][exposure.riskDomainId][exposure.riskDomainVersion] =
            accountLive - expectedReduction;
        emit IPortfolioRiskEngine.ExposureReduced(
            exposure.accountId,
            exposure.riskDomainId,
            exposure.riskDomainVersion,
            expectedReduction,
            reduction.transitionId
        );
    }

    function exposureReductionWitness(
        PortfolioRiskDependencies memory deps,
        mapping(bytes32 exposureId => PositionRiskExposure exposure) storage $positionExposures,
        mapping(bytes32 positionKey => bytes32 exposureId) storage $positionExposureIds,
        mapping(bytes32 exposureId => PositionId[] positionIds) storage $exposurePositions,
        mapping(bytes32 exposureId => mapping(PositionId positionId => uint128 lots)) storage $initialPositionLots,
        mapping(bytes32 exposureId => mapping(PositionId positionId => uint128 lots)) storage $accountedPositionLots,
        PositionId positionId,
        AccountId accountId
    ) external view returns (RiskExposureReduction memory reduction) {
        bytes32 exposureId = $positionExposureIds[_positionKey(positionId, accountId)];
        if (exposureId == bytes32(0)) return reduction;
        PositionRiskExposure storage exposure = $positionExposures[exposureId];
        PositionId[] storage positionIds = $exposurePositions[exposureId];
        PositionRiskSnapshot memory requested = deps.positionEngine.positionRiskSnapshot(positionId, accountId);
        if (requested.remainingLots >= $accountedPositionLots[exposureId][positionId]) return reduction;
        PositionId canonicalPositionId = positionIds[0];
        PositionRiskSnapshot memory canonical = deps.positionEngine.positionRiskSnapshot(canonicalPositionId, accountId);
        if (canonical.remainingLots >= exposure.accountedPositionLots) {
            revert IPortfolioRiskEngine.InvalidExposureReduction(canonicalPositionId, accountId);
        }
        bytes32[] memory stateHashes = new bytes32[](positionIds.length);
        for (uint256 i; i < positionIds.length; ++i) {
            PositionRiskSnapshot memory component = deps.positionEngine.positionRiskSnapshot(positionIds[i], accountId);
            uint128 initialLots = $initialPositionLots[exposureId][positionIds[i]];
            uint128 accountedLots = $accountedPositionLots[exposureId][positionIds[i]];
            if (
                component.remainingLots >= accountedLots
                    || uint256(component.remainingLots) * exposure.initialPositionLots
                        != uint256(canonical.remainingLots) * initialLots
            ) revert IPortfolioRiskEngine.InvalidExposureReduction(canonicalPositionId, accountId);
            stateHashes[i] = component.stateHash;
        }
        uint128 expectedRemaining = uint128(
            Math.mulDiv(
                exposure.initialOpenInterestBaseUnits,
                canonical.remainingLots,
                exposure.initialPositionLots,
                Math.Rounding.Ceil
            )
        );
        uint128 expectedReduction = exposure.remainingOpenInterestBaseUnits - expectedRemaining;
        reduction = RiskExposureReduction({
            exposureId: exposureId,
            canonicalPositionId: canonicalPositionId,
            admissionId: exposure.admissionId,
            accountId: accountId,
            expectedPreviousPositionLots: exposure.accountedPositionLots,
            expectedNewPositionLots: canonical.remainingLots,
            expectedOpenInterestReductionBaseUnits: expectedReduction,
            transitionId: keccak256(
                abi.encode(
                    EXPOSURE_REDUCTION_TYPEHASH,
                    exposureId,
                    canonicalPositionId,
                    accountId,
                    exposure.admissionId,
                    exposure.accountedPositionLots,
                    canonical.remainingLots,
                    expectedReduction,
                    keccak256(abi.encodePacked(stateHashes))
                )
            )
        });
    }

    function publishObjectiveDefaultState(
        PortfolioRiskDependencies memory deps,
        mapping(RiskAdmissionId admissionId => RiskAdmission admission) storage $admissions,
        mapping(RiskDomainId domainId => mapping(uint32 version => uint128 amount)) storage $liveOpenInterest,
        mapping(RiskDomainId domainId => mapping(uint32 version => uint128 amount)) storage $reservedOpenInterest,
        mapping(
            AccountId accountId => mapping(RiskDomainId domainId => mapping(uint32 version => uint128 amount))
        ) storage $accountLiveOpenInterest,
        mapping(RiskDomainId domainId => mapping(uint32 version => uint128 amount)) storage $reservedLiability,
        mapping(
            AccountId accountId => mapping(RiskDomainId domainId => mapping(uint32 version => uint128 amount))
        ) storage $accountReservedLiability,
        mapping(bytes32 defaultStateKey => ObjectiveDefaultState state) storage $objectiveDefaultStates,
        mapping(bytes32 defaultStateKey => uint64 sequence) storage $defaultStateSequences,
        mapping(bytes32 exposureId => PositionRiskExposure exposure) storage $positionExposures,
        mapping(bytes32 positionKey => bytes32 exposureId) storage $positionExposureIds,
        mapping(
            AccountId accountId => mapping(RiskDomainId domainId => mapping(uint32 version => uint16 count))
        ) storage $activePositionCount,
        DefaultRiskProof calldata proof
    ) external returns (ObjectiveDefaultState memory state) {
        RiskAdmission storage admission = $admissions[proof.admissionId];
        PositionRiskExposure storage exposure =
            $positionExposures[$positionExposureIds[_positionKey(proof.positionId, admission.accountId)]];
        if (
            PositionId.unwrap(proof.positionId) == bytes32(0)
                || (admission.status != RiskAdmissionStatus.Reserved
                    && admission.status != RiskAdmissionStatus.Consumed)
                || RiskAdmissionId.unwrap(exposure.admissionId) != RiskAdmissionId.unwrap(proof.admissionId)
                || AccountId.unwrap(exposure.accountId) != AccountId.unwrap(admission.accountId)
                || exposure.remainingOpenInterestBaseUnits == 0
        ) revert IPortfolioRiskEngine.InvalidDefaultRiskProof();
        RiskDomainVersion memory domain = _requireDomain(deps, admission.riskDomainId, admission.riskDomainVersion);
        PositionRiskSnapshot memory target =
            deps.positionEngine.positionRiskSnapshot(proof.positionId, admission.accountId);
        if (
            RiskDomainId.unwrap(target.riskDomainId) != RiskDomainId.unwrap(admission.riskDomainId)
                || target.riskDomainVersion != admission.riskDomainVersion || target.remainingLots == 0
                || target.finalResolutionAt <= block.timestamp || target.settlementDeadline <= target.finalResolutionAt
                || (target.status != PositionStatus.Live
                    && target.status != PositionStatus.Fixing
                    && target.status != PositionStatus.SettlementReady)
        ) revert IPortfolioRiskEngine.InvalidDefaultRiskProof();
        bool targetIncluded;
        if (
            proof.positions.length
                != $activePositionCount[admission.accountId][admission.riskDomainId][admission.riskDomainVersion]
        ) revert IPortfolioRiskEngine.InvalidDefaultRiskProof();
        for (uint256 i; i < proof.positions.length; ++i) {
            PositionRiskSnapshot memory canonical =
                deps.positionEngine.positionRiskSnapshot(proof.positions[i].positionId, admission.accountId);
            PositionRiskExposure storage memberExposure = $positionExposures[
                $positionExposureIds[_positionKey(proof.positions[i].positionId, admission.accountId)]
            ];
            if (
                RiskDomainId.unwrap(canonical.riskDomainId) != RiskDomainId.unwrap(admission.riskDomainId)
                    || canonical.riskDomainVersion != admission.riskDomainVersion
                    || keccak256(abi.encode(canonical.witness)) != keccak256(abi.encode(proof.positions[i]))
                    || AccountId.unwrap(memberExposure.accountId) != AccountId.unwrap(admission.accountId)
                    || RiskDomainId.unwrap(memberExposure.riskDomainId) != RiskDomainId.unwrap(admission.riskDomainId)
                    || memberExposure.riskDomainVersion != admission.riskDomainVersion
                    || memberExposure.remainingOpenInterestBaseUnits == 0
            ) revert IPortfolioRiskEngine.InvalidDefaultRiskProof();
            if (PositionId.unwrap(proof.positions[i].positionId) == PositionId.unwrap(proof.positionId)) {
                targetIncluded = true;
            }
        }
        if (!targetIncluded) revert IPortfolioRiskEngine.InvalidDefaultRiskProof();
        PortfolioRiskResult memory result = _evaluateCurrentRisk(
            deps,
            $liveOpenInterest,
            $reservedOpenInterest,
            $reservedLiability,
            $accountReservedLiability,
            admission.accountId,
            domain,
            proof.positions,
            proof.observations
        );
        CollateralId collateralId = deps.collateralVault
            .deriveCollateralId(domain.definition.collateralAssetId, domain.definition.collateralAssetVersion);
        (uint128 total,, uint128 available) = deps.collateralVault.balanceOf(admission.accountId, collateralId);
        uint128 maintenance = result.metrics.maintenanceMarginBaseUnits;
        if (maintenance <= total) revert IPortfolioRiskEngine.InvalidDefaultRiskProof();
        uint64 evaluatedAt = uint64(block.timestamp);
        bytes32 deficiencyProofHash = keccak256(
            abi.encode(
                DEFAULT_PROOF_TYPEHASH,
                proof.positionId,
                proof.admissionId,
                target.stateHash,
                PortfolioRiskLib.hashResult(result),
                total,
                available,
                evaluatedAt
            )
        );
        bytes32 stateKey = _defaultStateKey(
            proof.positionId, admission.accountId, admission.riskDomainId, admission.riskDomainVersion
        );
        uint64 sequence = $defaultStateSequences[stateKey] + 1;
        $defaultStateSequences[stateKey] = sequence;
        bytes32 counterCommitment = keccak256(
            abi.encode(
                result.witnessHash,
                deficiencyProofHash,
                admission.requestHash,
                admission.resultHash,
                target.stateHash,
                $liveOpenInterest[admission.riskDomainId][admission.riskDomainVersion],
                $accountLiveOpenInterest[admission.accountId][admission.riskDomainId][admission.riskDomainVersion],
                deps.collateralVault
                    .accountRiskDomainTerminalLiability(
                        admission.accountId, admission.riskDomainId, admission.riskDomainVersion
                    )
            )
        );
        state = ObjectiveDefaultState({
            positionId: proof.positionId,
            accountId: admission.accountId,
            riskDomainId: admission.riskDomainId,
            collateralId: collateralId,
            riskDomainVersion: admission.riskDomainVersion,
            evaluatedAt: evaluatedAt,
            finalResolutionAt: target.finalResolutionAt,
            settlementDeadline: target.settlementDeadline,
            sequence: sequence,
            maintenanceRequirementMinor: maintenance,
            collateralValueMinor: total,
            deficiencyMinor: maintenance - total,
            availableCollateralMinor: available,
            configurationHash: result.configurationHash,
            witnessHash: counterCommitment,
            observationsHash: result.observationsHash,
            stateHash: bytes32(0)
        });
        state.stateHash = DefaultProcessLib.hashObjectiveState(state);
        $objectiveDefaultStates[stateKey] = state;
        emit IPortfolioRiskEngine.ObjectiveDefaultStatePublished(
            proof.positionId,
            admission.accountId,
            admission.riskDomainId,
            admission.riskDomainVersion,
            sequence,
            state.stateHash
        );
    }

    function _evaluateCurrentRisk(
        PortfolioRiskDependencies memory deps,
        mapping(RiskDomainId domainId => mapping(uint32 version => uint128 amount)) storage $liveOpenInterest,
        mapping(RiskDomainId domainId => mapping(uint32 version => uint128 amount)) storage $reservedOpenInterest,
        mapping(RiskDomainId domainId => mapping(uint32 version => uint128 amount)) storage $reservedLiability,
        mapping(
            AccountId accountId => mapping(RiskDomainId domainId => mapping(uint32 version => uint128 amount))
        ) storage $accountReservedLiability,
        AccountId accountId,
        RiskDomainVersion memory domain,
        PortfolioPositionWitness[] calldata positions,
        RiskObservation[] calldata observations
    ) internal view returns (PortfolioRiskResult memory result) {
        deps.collateralVault.reentrancyCheck();
        RiskDomainId domainId = RiskDomainDefinitionLib.deriveRiskDomainId(domain.definition);
        if (!deps.riskDomainRegistry.isLifecycleEnabled(domainId, domain.version)) {
            revert IPortfolioRiskEngine.RiskDomainNotLifecycleEnabled(domainId, domain.version);
        }
        AdapterVersion memory adapter = _requireAdapter(deps, domain, false);
        bytes32 witnessHash = PortfolioRiskLib.hashPositions(positions);
        bytes32 observationsHash =
            PortfolioRiskLib.hashObservations(observations, deps.maximumObservationAge, block.timestamp);
        RiskEvaluationContext memory context = _currentContext(
            deps,
            $liveOpenInterest,
            $reservedOpenInterest,
            $reservedLiability,
            $accountReservedLiability,
            accountId,
            domain
        );
        result = PortfolioRiskLib.boundedEvaluate(
            adapter.definition.implementation, deps.maximumAdapterGas, context, positions, observations
        );
        bytes32 configurationHash = _configurationHash(domain, adapter);
        if (
            result.configurationHash != configurationHash || result.witnessHash != witnessHash
                || result.observationsHash != observationsHash
        ) revert IPortfolioRiskEngine.RiskResultMismatch();
        _requireCurrentMetrics(result.metrics, context, domain);
    }

    function _currentContext(
        PortfolioRiskDependencies memory deps,
        mapping(RiskDomainId domainId => mapping(uint32 version => uint128 amount)) storage $liveOpenInterest,
        mapping(RiskDomainId domainId => mapping(uint32 version => uint128 amount)) storage $reservedOpenInterest,
        mapping(RiskDomainId domainId => mapping(uint32 version => uint128 amount)) storage $reservedLiability,
        mapping(
            AccountId accountId => mapping(RiskDomainId domainId => mapping(uint32 version => uint128 amount))
        ) storage $accountReservedLiability,
        AccountId accountId,
        RiskDomainVersion memory domain
    ) internal view returns (RiskEvaluationContext memory context) {
        RiskDomainId domainId = RiskDomainDefinitionLib.deriveRiskDomainId(domain.definition);
        CollateralId collateralId = deps.collateralVault
            .deriveCollateralId(domain.definition.collateralAssetId, domain.definition.collateralAssetVersion);
        (uint128 total, uint128 locked, uint128 available) = deps.collateralVault.balanceOf(accountId, collateralId);
        uint256 accountLiability = deps.collateralVault
        .accountRiskDomainTerminalLiability(accountId, domainId, domain.version)
        + $accountReservedLiability[accountId][domainId][domain.version];
        uint256 aggregateLiability = deps.collateralVault.riskDomainTerminalLiability(domainId, domain.version)
            + $reservedLiability[domainId][domain.version];
        uint256 currentOpenInterest =
            $liveOpenInterest[domainId][domain.version] + $reservedOpenInterest[domainId][domain.version];
        if (
            accountLiability > type(uint128).max || aggregateLiability > type(uint128).max
                || currentOpenInterest > type(uint128).max
        ) revert IPortfolioRiskEngine.RiskResultMismatch();
        context = RiskEvaluationContext({
            accountId: accountId,
            riskDomainId: domainId,
            riskDomainVersion: domain.version,
            collateralId: collateralId,
            domainDefinitionHash: domain.definitionHash,
            riskModelId: RiskModelId.unwrap(domain.definition.riskModelId),
            marginRulesHash: domain.definition.marginRulesHash,
            scenarioSetHash: domain.definition.scenarioSetHash,
            concentrationRulesHash: domain.definition.concentrationRulesHash,
            collateralTotalBaseUnits: total,
            collateralLockedBaseUnits: locked,
            collateralAvailableBaseUnits: available,
            currentOpenInterestBaseUnits: uint128(currentOpenInterest),
            requestedOpenInterestBaseUnits: 0,
            currentAccountTerminalLiabilityBaseUnits: uint128(accountLiability),
            requestedAccountTerminalLiabilityBaseUnits: 0,
            currentAggregateTerminalLiabilityBaseUnits: uint128(aggregateLiability),
            requestedAggregateTerminalLiabilityBaseUnits: 0
        });
    }

    function _requireCurrentMetrics(
        PortfolioRiskMetrics memory metrics,
        RiskEvaluationContext memory context,
        RiskDomainVersion memory domain
    ) internal pure {
        if (
            metrics.openInterestBaseUnits != context.currentOpenInterestBaseUnits
                || metrics.accountTerminalLiabilityBaseUnits != context.currentAccountTerminalLiabilityBaseUnits
                || metrics.aggregateTerminalLiabilityBaseUnits != context.currentAggregateTerminalLiabilityBaseUnits
                || metrics.maintenanceMarginBaseUnits > metrics.initialMarginBaseUnits
        ) revert IPortfolioRiskEngine.RiskResultMismatch();
        uint128 headroom = metrics.initialMarginBaseUnits >= context.collateralAvailableBaseUnits
            ? 0
            : context.collateralAvailableBaseUnits - metrics.initialMarginBaseUnits;
        headroom = _minimum(
            headroom, uint128(domain.definition.maxOpenInterestBaseUnits - context.currentOpenInterestBaseUnits)
        );
        headroom = _minimum(
            headroom,
            uint128(domain.definition.maxAccountLiabilityBaseUnits - context.currentAccountTerminalLiabilityBaseUnits)
        );
        headroom = _minimum(
            headroom,
            uint128(
                domain.definition.maxAggregateLiabilityBaseUnits - context.currentAggregateTerminalLiabilityBaseUnits
            )
        );
        int256 liquidationDistance =
            int256(uint256(context.collateralAvailableBaseUnits)) - int256(uint256(metrics.maintenanceMarginBaseUnits));
        if (
            metrics.availableHeadroomBaseUnits != headroom
                || metrics.liquidationDistanceBaseUnits != liquidationDistance
        ) revert IPortfolioRiskEngine.RiskResultMismatch();
    }

    function _configurationHash(RiskDomainVersion memory domain, AdapterVersion memory adapter)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                keccak256("SetrynRiskConfigurationV1"),
                domain.versionHash,
                adapter.versionHash,
                domain.definition.riskModelId,
                domain.definition.marginRulesHash,
                domain.definition.scenarioSetHash,
                domain.definition.concentrationRulesHash
            )
        );
    }

    function bindConsumedExposure(
        PortfolioRiskDependencies memory deps,
        mapping(RiskAdmissionId admissionId => RiskAdmission admission) storage $admissions,
        mapping(bytes32 exposureId => PositionRiskExposure exposure) storage $positionExposures,
        mapping(bytes32 positionKey => bytes32 exposureId) storage $positionExposureIds,
        mapping(bytes32 exposureId => PositionId[] positionIds) storage $exposurePositions,
        mapping(bytes32 exposureId => mapping(PositionId positionId => uint128 lots)) storage $initialPositionLots,
        mapping(bytes32 exposureId => mapping(PositionId positionId => uint128 lots)) storage $accountedPositionLots,
        mapping(
            AccountId accountId => mapping(RiskDomainId domainId => mapping(uint32 version => uint16 count))
        ) storage $activePositionCount,
        mapping(bytes32 exposureId => PendingRiskExposure exposure) storage $pendingExposures,
        RiskAdmissionId admissionId,
        bytes32 executionReference,
        PositionId[] calldata positionIds
    ) external {
        if (executionReference == bytes32(0)) revert IPortfolioRiskEngine.ZeroReference();
        RiskAdmission storage admission = $admissions[admissionId];
        if (admission.status != RiskAdmissionStatus.Reserved && admission.status != RiskAdmissionStatus.Consumed) {
            revert IPortfolioRiskEngine.InvalidRiskAdmissionState(admissionId);
        }
        bytes32 exposureId = _exposureId(admissionId, executionReference, admission.accountId);
        PendingRiskExposure storage pending = $pendingExposures[exposureId];
        if (
            RiskAdmissionId.unwrap(pending.admissionId) != RiskAdmissionId.unwrap(admissionId) || pending.bound
                || pending.expectedPositionCount != positionIds.length
        ) revert IPortfolioRiskEngine.RiskAdmissionConsumptionMismatch(admissionId);
        _bindPositionExposure(
            deps,
            $positionExposures,
            $positionExposureIds,
            $exposurePositions,
            $initialPositionLots,
            $accountedPositionLots,
            $activePositionCount,
            exposureId,
            pending,
            positionIds
        );
        pending.bound = true;
    }

    function _bindPositionExposure(
        PortfolioRiskDependencies memory deps,
        mapping(bytes32 exposureId => PositionRiskExposure exposure) storage $positionExposures,
        mapping(bytes32 positionKey => bytes32 exposureId) storage $positionExposureIds,
        mapping(bytes32 exposureId => PositionId[] positionIds) storage $exposurePositions,
        mapping(bytes32 exposureId => mapping(PositionId positionId => uint128 lots)) storage $initialPositionLots,
        mapping(bytes32 exposureId => mapping(PositionId positionId => uint128 lots)) storage $accountedPositionLots,
        mapping(
            AccountId accountId => mapping(RiskDomainId domainId => mapping(uint32 version => uint16 count))
        ) storage $activePositionCount,
        bytes32 exposureId,
        PendingRiskExposure storage pending,
        PositionId[] calldata positionIds
    ) internal {
        uint256 count = positionIds.length;
        if (count == 0 || count > MAXIMUM_ACTIVE_POSITIONS) {
            revert IPortfolioRiskEngine.InvalidExposurePosition(PositionId.wrap(bytes32(0)), pending.accountId);
        }
        uint16 active = $activePositionCount[pending.accountId][pending.riskDomainId][pending.riskDomainVersion];
        if (uint256(active) + count > MAXIMUM_ACTIVE_POSITIONS) {
            revert IPortfolioRiskEngine.InvalidExposurePosition(positionIds[0], pending.accountId);
        }
        if ($positionExposures[exposureId].exposureId != bytes32(0)) {
            revert IPortfolioRiskEngine.DuplicateExposurePosition(positionIds[0], pending.accountId);
        }
        uint128 canonicalLots;
        for (uint256 i; i < count; ++i) {
            PositionId positionId = positionIds[i];
            bytes32 positionKey = _positionKey(positionId, pending.accountId);
            if (PositionId.unwrap(positionId) == bytes32(0) || $positionExposureIds[positionKey] != bytes32(0)) {
                revert IPortfolioRiskEngine.DuplicateExposurePosition(positionId, pending.accountId);
            }
            PositionRiskSnapshot memory snapshot =
                deps.positionEngine.positionRiskSnapshot(positionId, pending.accountId);
            if (
                RiskDomainId.unwrap(snapshot.riskDomainId) != RiskDomainId.unwrap(pending.riskDomainId)
                    || snapshot.riskDomainVersion != pending.riskDomainVersion || snapshot.remainingLots == 0
                    || snapshot.status != PositionStatus.Live
            ) revert IPortfolioRiskEngine.InvalidExposurePosition(positionId, pending.accountId);
            for (uint256 j; j < i; ++j) {
                if (PositionId.unwrap(positionIds[j]) == PositionId.unwrap(positionId)) {
                    revert IPortfolioRiskEngine.DuplicateExposurePosition(positionId, pending.accountId);
                }
            }
            if (i == 0) canonicalLots = snapshot.remainingLots;
            $positionExposureIds[positionKey] = exposureId;
            $exposurePositions[exposureId].push(positionId);
            $initialPositionLots[exposureId][positionId] = snapshot.remainingLots;
            $accountedPositionLots[exposureId][positionId] = snapshot.remainingLots;
        }
        $positionExposures[exposureId] = PositionRiskExposure({
            exposureId: exposureId,
            admissionId: pending.admissionId,
            accountId: pending.accountId,
            riskDomainId: pending.riskDomainId,
            riskDomainVersion: pending.riskDomainVersion,
            initialPositionLots: canonicalLots,
            accountedPositionLots: canonicalLots,
            initialOpenInterestBaseUnits: pending.openInterestBaseUnits,
            remainingOpenInterestBaseUnits: pending.openInterestBaseUnits,
            positionsHash: keccak256(abi.encode(positionIds)),
            positionCount: uint16(count)
        });
        $activePositionCount[pending.accountId][pending.riskDomainId][pending.riskDomainVersion] =
            active + uint16(count);
    }

    function _requireDomain(PortfolioRiskDependencies memory deps, RiskDomainId riskDomainId, uint32 version)
        internal
        view
        returns (RiskDomainVersion memory domain)
    {
        domain = deps.riskDomainRegistry.getRiskDomain(riskDomainId, version);
        bytes32 definitionHash = RiskDomainDefinitionLib.hashDefinition(domain.definition, block.chainid);
        if (
            domain.version != version
                || RiskDomainId.unwrap(RiskDomainDefinitionLib.deriveRiskDomainId(domain.definition))
                    != RiskDomainId.unwrap(riskDomainId) || domain.definitionHash != definitionHash
                || domain.versionHash
                    != RiskDomainDefinitionLib.hashVersion(riskDomainId, version, definitionHash, block.chainid)
        ) revert IPortfolioRiskEngine.RiskDomainRecordMismatch(riskDomainId, version);
    }

    function _requireAdapter(PortfolioRiskDependencies memory deps, RiskDomainVersion memory domain, bool requireOpen)
        internal
        view
        returns (AdapterVersion memory adapter)
    {
        AdapterId adapterId = domain.definition.riskAdapterId;
        uint32 version = domain.definition.riskAdapterVersion;
        if (requireOpen
                ? !deps.adapterRegistry.isOpenForNewRisk(adapterId, version)
                : !deps.adapterRegistry.isLifecycleEnabled(adapterId, version)) revert IPortfolioRiskEngine.RiskAdapterRecordMismatch();
        adapter = deps.adapterRegistry.getAdapter(adapterId, version);
        bytes32 definitionHash = AdapterDefinitionLib.hashDefinition(adapter.definition, block.chainid);
        if (
            adapter.version != version
                || AdapterId.unwrap(AdapterDefinitionLib.deriveAdapterId(adapter.definition))
                    != AdapterId.unwrap(adapterId) || adapter.definitionHash != definitionHash
                || adapter.versionHash
                    != AdapterDefinitionLib.hashVersion(adapterId, version, definitionHash, block.chainid)
                || AdapterKindId.unwrap(adapter.definition.kindId)
                    != AdapterKindId.unwrap(domain.definition.requiredAdapterKindId)
                || adapter.definition.interfaceHash != domain.definition.requiredInterfaceHash
                || adapter.definition.capabilityHash != domain.definition.requiredCapabilityHash
                || adapter.definition.implementation.codehash != adapter.definition.expectedRuntimeCodeHash
        ) revert IPortfolioRiskEngine.RiskAdapterRecordMismatch();
    }

    function _minimum(uint128 left, uint128 right) internal pure returns (uint128) {
        return left < right ? left : right;
    }

    function _positionKey(PositionId positionId, AccountId accountId) internal pure returns (bytes32) {
        return keccak256(abi.encode(positionId, accountId));
    }

    function _exposureId(RiskAdmissionId admissionId, bytes32 executionReference, AccountId accountId)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(keccak256("SetrynPositionRiskExposureV1"), admissionId, executionReference, accountId)
        );
    }

    function _defaultStateKey(
        PositionId positionId,
        AccountId accountId,
        RiskDomainId riskDomainId,
        uint32 riskDomainVersion
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("SetrynObjectiveDefaultStateKeyV1"), positionId, accountId, riskDomainId, riskDomainVersion
            )
        );
    }
}
