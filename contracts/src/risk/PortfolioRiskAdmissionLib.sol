// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

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
import {RiskDomainVersion} from "../types/RiskDomainDefinition.sol";
import {
    PortfolioPositionWitness,
    PortfolioRiskMetrics,
    PortfolioRiskResult,
    RiskAdmission,
    RiskAdmissionConsumption,
    RiskAdmissionId,
    RiskAdmissionRequest,
    RiskAdmissionStatus,
    RiskEvaluationContext,
    RiskObservation
} from "../types/RiskTypes.sol";
import {PortfolioRiskDependencies, PendingRiskExposure} from "./PortfolioRiskTypes.sol";

/// Linked logic for the portfolio risk engine: risk evaluation, admission reservation, and consumption.
/// Runs through DELEGATECALL in the risk engine's context against its storage.
library PortfolioRiskAdmissionLib {
    bytes32 internal constant ACCOUNT_LIABILITY_CAP = keccak256("ACCOUNT_LIABILITY");
    bytes32 internal constant AGGREGATE_LIABILITY_CAP = keccak256("AGGREGATE_LIABILITY");
    uint16 internal constant MAXIMUM_ACTIVE_POSITIONS = 32;
    bytes32 internal constant OPEN_INTEREST_CAP = keccak256("OPEN_INTEREST");

    function reserveNewRisk(
        PortfolioRiskDependencies memory deps,
        mapping(RiskAdmissionId admissionId => RiskAdmission admission) storage $admissions,
        mapping(AccountId accountId => mapping(uint256 nonce => bool used)) storage $usedNonces,
        mapping(RiskDomainId domainId => mapping(uint32 version => uint128 amount)) storage $liveOpenInterest,
        mapping(RiskDomainId domainId => mapping(uint32 version => uint128 amount)) storage $reservedOpenInterest,
        mapping(RiskDomainId domainId => mapping(uint32 version => uint128 amount)) storage $reservedLiability,
        mapping(
            AccountId accountId => mapping(RiskDomainId domainId => mapping(uint32 version => uint128 amount))
        ) storage $accountReservedLiability,
        RiskAdmissionRequest calldata request,
        PortfolioPositionWitness[] calldata positions,
        RiskObservation[] calldata observations
    ) external returns (RiskAdmissionId admissionId, PortfolioRiskResult memory result) {
        if ($usedNonces[request.accountId][request.nonce]) {
            revert IPortfolioRiskEngine.RiskNonceAlreadyUsed(request.accountId, request.nonce);
        }
        result = evaluate(
            deps,
            $liveOpenInterest,
            $reservedOpenInterest,
            $reservedLiability,
            $accountReservedLiability,
            request,
            positions,
            observations,
            true
        );
        bytes32 requestHash = PortfolioRiskLib.hashRequest(request, block.chainid, address(this));
        admissionId = PortfolioRiskLib.deriveAdmissionId(requestHash);
        if ($admissions[admissionId].status != RiskAdmissionStatus.Unspecified) {
            revert IPortfolioRiskEngine.DuplicateRiskAdmission(admissionId);
        }
        $usedNonces[request.accountId][request.nonce] = true;
        _increaseReservations($reservedOpenInterest, $reservedLiability, $accountReservedLiability, request);
        bytes32 resultHash = PortfolioRiskLib.hashResult(result);
        $admissions[admissionId] = RiskAdmission({
            requestHash: requestHash,
            resultHash: resultHash,
            reservedResultCommitment: resultHash,
            accountId: request.accountId,
            riskDomainId: request.riskDomainId,
            riskDomainVersion: request.riskDomainVersion,
            openInterestBaseUnits: request.openInterestIncreaseBaseUnits,
            terminalLiabilityBaseUnits: request.terminalLiabilityIncreaseBaseUnits,
            remainingOpenInterestBaseUnits: request.openInterestIncreaseBaseUnits,
            remainingTerminalLiabilityBaseUnits: request.terminalLiabilityIncreaseBaseUnits,
            deadline: request.deadline,
            status: RiskAdmissionStatus.Reserved
        });
        emit IPortfolioRiskEngine.RiskAdmissionReserved(
            admissionId,
            request.accountId,
            request.riskDomainId,
            request.riskDomainVersion,
            requestHash,
            resultHash,
            request.openInterestIncreaseBaseUnits,
            request.terminalLiabilityIncreaseBaseUnits,
            request.deadline
        );
    }

    function consumeAdmission(
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
        mapping(bytes32 exposureId => PendingRiskExposure exposure) storage $pendingExposures,
        RiskAdmissionConsumption calldata consumption
    ) external {
        if (consumption.executionReference == bytes32(0)) revert IPortfolioRiskEngine.ZeroReference();
        RiskAdmission storage admission = _requireReserved($admissions, consumption.admissionId);
        if (block.timestamp > admission.deadline) {
            revert IPortfolioRiskEngine.RiskAdmissionExpiredForConsumption(consumption.admissionId, admission.deadline);
        }
        if (
            admission.reservedResultCommitment != consumption.expectedResultHash
                || admission.resultHash != consumption.expectedResultHash
                || AccountId.unwrap(admission.accountId) != AccountId.unwrap(consumption.expectedAccountId)
                || RiskDomainId.unwrap(admission.riskDomainId) != RiskDomainId.unwrap(consumption.expectedRiskDomainId)
                || admission.riskDomainVersion != consumption.expectedRiskDomainVersion
                || consumption.expectedOpenInterestBaseUnits == 0
                || consumption.expectedOpenInterestBaseUnits > admission.remainingOpenInterestBaseUnits
                || consumption.expectedTerminalLiabilityBaseUnits > admission.remainingTerminalLiabilityBaseUnits
                || consumption.expectedPositionCount == 0
                || consumption.expectedPositionCount > MAXIMUM_ACTIVE_POSITIONS
        ) revert IPortfolioRiskEngine.RiskAdmissionConsumptionMismatch(consumption.admissionId);
        if (!deps.riskDomainRegistry.isLifecycleEnabled(admission.riskDomainId, admission.riskDomainVersion)) {
            revert IPortfolioRiskEngine.RiskDomainNotLifecycleEnabled(
                admission.riskDomainId, admission.riskDomainVersion
            );
        }
        bytes32 exposureId = _exposureId(consumption.admissionId, consumption.executionReference, admission.accountId);
        if (RiskAdmissionId.unwrap($pendingExposures[exposureId].admissionId) != bytes32(0)) {
            revert IPortfolioRiskEngine.RiskAdmissionConsumptionMismatch(consumption.admissionId);
        }
        $pendingExposures[exposureId] = PendingRiskExposure({
            admissionId: consumption.admissionId,
            accountId: admission.accountId,
            riskDomainId: admission.riskDomainId,
            riskDomainVersion: admission.riskDomainVersion,
            openInterestBaseUnits: consumption.expectedOpenInterestBaseUnits,
            expectedPositionCount: consumption.expectedPositionCount,
            bound: false
        });
        _consumeReservations(
            $reservedOpenInterest,
            $reservedLiability,
            $accountReservedLiability,
            admission,
            consumption.expectedOpenInterestBaseUnits,
            consumption.expectedTerminalLiabilityBaseUnits
        );
        $liveOpenInterest[
            admission.riskDomainId
        ][admission.riskDomainVersion] += consumption.expectedOpenInterestBaseUnits;
        $accountLiveOpenInterest[
            admission.accountId
        ][admission.riskDomainId][admission.riskDomainVersion] += consumption.expectedOpenInterestBaseUnits;
        if (admission.remainingOpenInterestBaseUnits == 0) {
            if (admission.remainingTerminalLiabilityBaseUnits != 0) {
                revert IPortfolioRiskEngine.RiskAdmissionConsumptionMismatch(consumption.admissionId);
            }
            admission.status = RiskAdmissionStatus.Consumed;
            emit IPortfolioRiskEngine.RiskAdmissionConsumed(consumption.admissionId, consumption.executionReference);
        } else {
            emit IPortfolioRiskEngine.RiskAdmissionPartiallyConsumed(
                consumption.admissionId,
                PositionId.wrap(bytes32(0)),
                consumption.executionReference,
                consumption.expectedOpenInterestBaseUnits,
                consumption.expectedTerminalLiabilityBaseUnits,
                admission.remainingOpenInterestBaseUnits,
                admission.remainingTerminalLiabilityBaseUnits
            );
        }
    }

    function evaluate(
        PortfolioRiskDependencies memory deps,
        mapping(RiskDomainId domainId => mapping(uint32 version => uint128 amount)) storage $liveOpenInterest,
        mapping(RiskDomainId domainId => mapping(uint32 version => uint128 amount)) storage $reservedOpenInterest,
        mapping(RiskDomainId domainId => mapping(uint32 version => uint128 amount)) storage $reservedLiability,
        mapping(
            AccountId accountId => mapping(RiskDomainId domainId => mapping(uint32 version => uint128 amount))
        ) storage $accountReservedLiability,
        RiskAdmissionRequest calldata request,
        PortfolioPositionWitness[] calldata positions,
        RiskObservation[] calldata observations,
        bool requireOpen
    ) public view returns (PortfolioRiskResult memory result) {
        if (
            AccountId.unwrap(request.accountId) == bytes32(0) || RiskDomainId.unwrap(request.riskDomainId) == bytes32(0)
                || request.riskDomainVersion == 0 || request.openInterestIncreaseBaseUnits == 0
                || request.salt == bytes32(0)
        ) revert IPortfolioRiskEngine.InvalidRiskRequest();
        if (
            request.deadline <= block.timestamp
                || uint256(request.deadline) > block.timestamp + uint256(deps.maximumObservationAge)
        ) revert IPortfolioRiskEngine.RiskRequestExpired(request.deadline, block.timestamp);
        if (requireOpen && !deps.riskDomainRegistry.isOpenForNewRisk(request.riskDomainId, request.riskDomainVersion)) {
            revert IPortfolioRiskEngine.RiskDomainNotOpen(request.riskDomainId, request.riskDomainVersion);
        }
        deps.collateralVault.reentrancyCheck();
        RiskDomainVersion memory domain = _requireDomain(deps, request.riskDomainId, request.riskDomainVersion);
        AdapterVersion memory adapter = _requireAdapter(deps, domain, true);
        bytes32 witnessHash = PortfolioRiskLib.hashPositions(positions);
        bytes32 observationsHash =
            PortfolioRiskLib.hashObservations(observations, deps.maximumObservationAge, block.timestamp);
        RiskEvaluationContext memory context = _context(
            deps,
            $liveOpenInterest,
            $reservedOpenInterest,
            $reservedLiability,
            $accountReservedLiability,
            request,
            domain
        );
        result = PortfolioRiskLib.boundedEvaluate(
            adapter.definition.implementation, deps.maximumAdapterGas, context, positions, observations
        );
        bytes32 configurationHash = keccak256(
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
        if (
            result.configurationHash != configurationHash || result.witnessHash != witnessHash
                || result.observationsHash != observationsHash
        ) revert IPortfolioRiskEngine.RiskResultMismatch();
        _requireMetrics(result.metrics, context, domain);
    }

    function _context(
        PortfolioRiskDependencies memory deps,
        mapping(RiskDomainId domainId => mapping(uint32 version => uint128 amount)) storage $liveOpenInterest,
        mapping(RiskDomainId domainId => mapping(uint32 version => uint128 amount)) storage $reservedOpenInterest,
        mapping(RiskDomainId domainId => mapping(uint32 version => uint128 amount)) storage $reservedLiability,
        mapping(
            AccountId accountId => mapping(RiskDomainId domainId => mapping(uint32 version => uint128 amount))
        ) storage $accountReservedLiability,
        RiskAdmissionRequest calldata request,
        RiskDomainVersion memory domain
    ) internal view returns (RiskEvaluationContext memory context) {
        CollateralId collateralId = deps.collateralVault
            .deriveCollateralId(domain.definition.collateralAssetId, domain.definition.collateralAssetVersion);
        (uint128 total, uint128 locked, uint128 available) =
            deps.collateralVault.balanceOf(request.accountId, collateralId);
        uint256 accountLiability = deps.collateralVault
            .accountRiskDomainTerminalLiability(request.accountId, request.riskDomainId, request.riskDomainVersion)
        + $accountReservedLiability[request.accountId][request.riskDomainId][request.riskDomainVersion];
        uint256 aggregateLiability = deps.collateralVault
        .riskDomainTerminalLiability(request.riskDomainId, request.riskDomainVersion)
        + $reservedLiability[request.riskDomainId][request.riskDomainVersion];
        uint256 currentOpenInterest = $liveOpenInterest[request.riskDomainId][request.riskDomainVersion]
            + $reservedOpenInterest[request.riskDomainId][request.riskDomainVersion];
        if (
            accountLiability > type(uint128).max || aggregateLiability > type(uint128).max
                || currentOpenInterest > type(uint128).max
        ) revert IPortfolioRiskEngine.RiskResultMismatch();
        context = RiskEvaluationContext({
            accountId: request.accountId,
            riskDomainId: request.riskDomainId,
            riskDomainVersion: request.riskDomainVersion,
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
            requestedOpenInterestBaseUnits: request.openInterestIncreaseBaseUnits,
            currentAccountTerminalLiabilityBaseUnits: uint128(accountLiability),
            requestedAccountTerminalLiabilityBaseUnits: request.terminalLiabilityIncreaseBaseUnits,
            currentAggregateTerminalLiabilityBaseUnits: uint128(aggregateLiability),
            requestedAggregateTerminalLiabilityBaseUnits: request.terminalLiabilityIncreaseBaseUnits
        });
    }

    function _requireMetrics(
        PortfolioRiskMetrics memory metrics,
        RiskEvaluationContext memory context,
        RiskDomainVersion memory domain
    ) internal pure {
        uint256 openInterest = uint256(context.currentOpenInterestBaseUnits) + context.requestedOpenInterestBaseUnits;
        uint256 accountLiability = uint256(context.currentAccountTerminalLiabilityBaseUnits)
            + context.requestedAccountTerminalLiabilityBaseUnits;
        uint256 aggregateLiability = uint256(context.currentAggregateTerminalLiabilityBaseUnits)
            + context.requestedAggregateTerminalLiabilityBaseUnits;
        if (
            metrics.openInterestBaseUnits != openInterest
                || metrics.accountTerminalLiabilityBaseUnits != accountLiability
                || metrics.aggregateTerminalLiabilityBaseUnits != aggregateLiability
                || metrics.maintenanceMarginBaseUnits > metrics.initialMarginBaseUnits
        ) revert IPortfolioRiskEngine.RiskResultMismatch();
        if (metrics.initialMarginBaseUnits > context.collateralAvailableBaseUnits) {
            revert IPortfolioRiskEngine.InsufficientMargin(
                context.collateralAvailableBaseUnits, metrics.initialMarginBaseUnits
            );
        }
        if (openInterest > domain.definition.maxOpenInterestBaseUnits) {
            revert IPortfolioRiskEngine.RiskCapExceeded(
                OPEN_INTEREST_CAP, domain.definition.maxOpenInterestBaseUnits, openInterest
            );
        }
        if (accountLiability > domain.definition.maxAccountLiabilityBaseUnits) {
            revert IPortfolioRiskEngine.RiskCapExceeded(
                ACCOUNT_LIABILITY_CAP, domain.definition.maxAccountLiabilityBaseUnits, accountLiability
            );
        }
        if (aggregateLiability > domain.definition.maxAggregateLiabilityBaseUnits) {
            revert IPortfolioRiskEngine.RiskCapExceeded(
                AGGREGATE_LIABILITY_CAP, domain.definition.maxAggregateLiabilityBaseUnits, aggregateLiability
            );
        }
        uint128 headroom = context.collateralAvailableBaseUnits - metrics.initialMarginBaseUnits;
        headroom = _minimum(headroom, uint128(domain.definition.maxOpenInterestBaseUnits - openInterest));
        headroom = _minimum(headroom, uint128(domain.definition.maxAccountLiabilityBaseUnits - accountLiability));
        headroom = _minimum(headroom, uint128(domain.definition.maxAggregateLiabilityBaseUnits - aggregateLiability));
        int256 liquidationDistance =
            int256(uint256(context.collateralAvailableBaseUnits)) - int256(uint256(metrics.maintenanceMarginBaseUnits));
        if (
            metrics.availableHeadroomBaseUnits != headroom
                || metrics.liquidationDistanceBaseUnits != liquidationDistance
        ) revert IPortfolioRiskEngine.RiskResultMismatch();
    }

    function _increaseReservations(
        mapping(RiskDomainId domainId => mapping(uint32 version => uint128 amount)) storage $reservedOpenInterest,
        mapping(RiskDomainId domainId => mapping(uint32 version => uint128 amount)) storage $reservedLiability,
        mapping(
            AccountId accountId => mapping(RiskDomainId domainId => mapping(uint32 version => uint128 amount))
        ) storage $accountReservedLiability,
        RiskAdmissionRequest calldata request
    ) internal {
        $reservedOpenInterest[request.riskDomainId][request.riskDomainVersion] += request.openInterestIncreaseBaseUnits;
        $reservedLiability[
            request.riskDomainId
        ][request.riskDomainVersion] += request.terminalLiabilityIncreaseBaseUnits;
        $accountReservedLiability[
            request.accountId
        ][request.riskDomainId][request.riskDomainVersion] += request.terminalLiabilityIncreaseBaseUnits;
    }

    function _consumeReservations(
        mapping(RiskDomainId domainId => mapping(uint32 version => uint128 amount)) storage $reservedOpenInterest,
        mapping(RiskDomainId domainId => mapping(uint32 version => uint128 amount)) storage $reservedLiability,
        mapping(
            AccountId accountId => mapping(RiskDomainId domainId => mapping(uint32 version => uint128 amount))
        ) storage $accountReservedLiability,
        RiskAdmission storage admission,
        uint128 openInterest,
        uint128 liability
    ) internal {
        $reservedOpenInterest[admission.riskDomainId][admission.riskDomainVersion] -= openInterest;
        $reservedLiability[admission.riskDomainId][admission.riskDomainVersion] -= liability;
        $accountReservedLiability[admission.accountId][admission.riskDomainId][admission.riskDomainVersion] -= liability;
        admission.remainingOpenInterestBaseUnits -= openInterest;
        admission.remainingTerminalLiabilityBaseUnits -= liability;
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

    function _exposureId(RiskAdmissionId admissionId, bytes32 executionReference, AccountId accountId)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(keccak256("SetrynPositionRiskExposureV1"), admissionId, executionReference, accountId)
        );
    }

    function _requireReserved(
        mapping(RiskAdmissionId admissionId => RiskAdmission admission) storage $admissions,
        RiskAdmissionId admissionId
    ) internal view returns (RiskAdmission storage admission) {
        admission = $admissions[admissionId];
        if (admission.status == RiskAdmissionStatus.Unspecified) {
            revert IPortfolioRiskEngine.UnknownRiskAdmission(admissionId);
        }
        if (admission.status != RiskAdmissionStatus.Reserved) {
            revert IPortfolioRiskEngine.InvalidRiskAdmissionState(admissionId);
        }
    }
}
