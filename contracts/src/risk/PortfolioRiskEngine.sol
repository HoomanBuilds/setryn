// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IAdapterRegistry} from "../interfaces/IAdapterRegistry.sol";
import {ICollateralVault} from "../interfaces/ICollateralVault.sol";
import {IPortfolioRiskEngine} from "../interfaces/IPortfolioRiskEngine.sol";
import {IRiskDomainRegistry} from "../interfaces/IRiskDomainRegistry.sol";
import {AdapterDefinitionLib} from "../libraries/AdapterDefinitionLib.sol";
import {PortfolioRiskLib} from "../libraries/PortfolioRiskLib.sol";
import {RiskDomainDefinitionLib} from "../libraries/RiskDomainDefinitionLib.sol";
import {AdapterVersion} from "../types/AdapterDefinition.sol";
import {AccountId, AdapterId, CollateralId, RiskDomainId, RiskModelId} from "../types/Identifiers.sol";
import {RiskDomainVersion} from "../types/RiskDomainDefinition.sol";
import {
    PortfolioPositionWitness,
    PortfolioRiskMetrics,
    PortfolioRiskResult,
    RiskAdmission,
    RiskAdmissionId,
    RiskAdmissionRequest,
    RiskAdmissionStatus,
    RiskEvaluationContext,
    RiskObservation
} from "../types/RiskTypes.sol";

contract PortfolioRiskEngine is IPortfolioRiskEngine, AccessControlDefaultAdminRules, ReentrancyGuard {
    bytes32 public constant RISK_CONSUMER_ROLE = keccak256("SETRYN_RISK_CONSUMER_ROLE");
    bytes32 private constant OPEN_INTEREST_CAP = keccak256("OPEN_INTEREST");
    bytes32 private constant ACCOUNT_LIABILITY_CAP = keccak256("ACCOUNT_LIABILITY");
    bytes32 private constant AGGREGATE_LIABILITY_CAP = keccak256("AGGREGATE_LIABILITY");

    IRiskDomainRegistry private immutable _riskDomainRegistry;
    IAdapterRegistry private immutable _adapterRegistry;
    ICollateralVault private immutable _collateralVault;
    uint64 public immutable maximumAdapterGas;
    uint64 public immutable maximumObservationAge;

    mapping(RiskAdmissionId admissionId => RiskAdmission admission) private _admissions;
    mapping(AccountId accountId => mapping(uint256 nonce => bool used)) private _usedNonces;
    mapping(RiskDomainId domainId => mapping(uint32 version => uint128 amount)) private _liveOpenInterest;
    mapping(RiskDomainId domainId => mapping(uint32 version => uint128 amount)) private _reservedOpenInterest;
    mapping(AccountId accountId => mapping(RiskDomainId domainId => mapping(uint32 version => uint128 amount))) private
        _accountLiveOpenInterest;
    mapping(RiskDomainId domainId => mapping(uint32 version => uint128 amount)) private _reservedLiability;
    mapping(AccountId accountId => mapping(RiskDomainId domainId => mapping(uint32 version => uint128 amount))) private
        _accountReservedLiability;

    constructor(
        uint48 defaultAdminDelay,
        address initialAdmin,
        IRiskDomainRegistry riskDomainRegistry_,
        IAdapterRegistry adapterRegistry_,
        ICollateralVault collateralVault_,
        uint64 maximumAdapterGas_,
        uint64 maximumObservationAge_
    ) AccessControlDefaultAdminRules(defaultAdminDelay, initialAdmin) {
        _requireDependency(address(riskDomainRegistry_));
        _requireDependency(address(adapterRegistry_));
        _requireDependency(address(collateralVault_));
        if (maximumAdapterGas_ == 0 || maximumObservationAge_ == 0) revert InvalidRiskRequest();
        _riskDomainRegistry = riskDomainRegistry_;
        _adapterRegistry = adapterRegistry_;
        _collateralVault = collateralVault_;
        maximumAdapterGas = maximumAdapterGas_;
        maximumObservationAge = maximumObservationAge_;
        _grantRole(RISK_CONSUMER_ROLE, initialAdmin);
    }

    function reserveNewRisk(
        RiskAdmissionRequest calldata request,
        PortfolioPositionWitness[] calldata positions,
        RiskObservation[] calldata observations
    )
        external
        onlyRole(RISK_CONSUMER_ROLE)
        nonReentrant
        returns (RiskAdmissionId admissionId, PortfolioRiskResult memory result)
    {
        if (_usedNonces[request.accountId][request.nonce]) {
            revert RiskNonceAlreadyUsed(request.accountId, request.nonce);
        }
        result = _evaluate(request, positions, observations, true);
        bytes32 requestHash = PortfolioRiskLib.hashRequest(request, block.chainid, address(this));
        admissionId = PortfolioRiskLib.deriveAdmissionId(requestHash);
        if (_admissions[admissionId].status != RiskAdmissionStatus.Unspecified) {
            revert DuplicateRiskAdmission(admissionId);
        }
        _usedNonces[request.accountId][request.nonce] = true;
        _increaseReservations(request);
        bytes32 resultHash = PortfolioRiskLib.hashResult(result);
        _admissions[admissionId] = RiskAdmission({
            requestHash: requestHash,
            resultHash: resultHash,
            accountId: request.accountId,
            riskDomainId: request.riskDomainId,
            riskDomainVersion: request.riskDomainVersion,
            openInterestBaseUnits: request.openInterestIncreaseBaseUnits,
            terminalLiabilityBaseUnits: request.terminalLiabilityIncreaseBaseUnits,
            status: RiskAdmissionStatus.Reserved
        });
        emit RiskAdmissionReserved(
            admissionId,
            request.accountId,
            request.riskDomainId,
            request.riskDomainVersion,
            requestHash,
            resultHash,
            request.openInterestIncreaseBaseUnits,
            request.terminalLiabilityIncreaseBaseUnits
        );
    }

    function previewRisk(
        RiskAdmissionRequest calldata request,
        PortfolioPositionWitness[] calldata positions,
        RiskObservation[] calldata observations
    ) external view returns (PortfolioRiskResult memory result) {
        return _evaluate(request, positions, observations, true);
    }

    function consumeAdmission(RiskAdmissionId admissionId, bytes32 executionReference)
        external
        onlyRole(RISK_CONSUMER_ROLE)
        nonReentrant
    {
        if (executionReference == bytes32(0)) revert ZeroReference();
        RiskAdmission storage admission = _requireReserved(admissionId);
        if (!_riskDomainRegistry.isLifecycleEnabled(admission.riskDomainId, admission.riskDomainVersion)) {
            revert RiskDomainNotLifecycleEnabled(admission.riskDomainId, admission.riskDomainVersion);
        }
        _releaseReservations(admission);
        _liveOpenInterest[admission.riskDomainId][admission.riskDomainVersion] += admission.openInterestBaseUnits;
        _accountLiveOpenInterest[
            admission.accountId
        ][admission.riskDomainId][admission.riskDomainVersion] += admission.openInterestBaseUnits;
        admission.status = RiskAdmissionStatus.Consumed;
        emit RiskAdmissionConsumed(admissionId, executionReference);
    }

    function releaseAdmission(RiskAdmissionId admissionId, bytes32 releaseReference)
        external
        onlyRole(RISK_CONSUMER_ROLE)
        nonReentrant
    {
        if (releaseReference == bytes32(0)) revert ZeroReference();
        RiskAdmission storage admission = _requireReserved(admissionId);
        _releaseReservations(admission);
        admission.status = RiskAdmissionStatus.Released;
        emit RiskAdmissionReleased(admissionId, releaseReference);
    }

    function reduceExposure(
        AccountId accountId,
        RiskDomainId riskDomainId,
        uint32 riskDomainVersion,
        uint128 openInterestReductionBaseUnits,
        bytes32 reductionReference
    ) external onlyRole(RISK_CONSUMER_ROLE) nonReentrant {
        if (reductionReference == bytes32(0) || openInterestReductionBaseUnits == 0) {
            revert InvalidRiskRequest();
        }
        if (!_riskDomainRegistry.isLifecycleEnabled(riskDomainId, riskDomainVersion)) {
            revert RiskDomainNotLifecycleEnabled(riskDomainId, riskDomainVersion);
        }
        uint128 accountCurrent = _accountLiveOpenInterest[accountId][riskDomainId][riskDomainVersion];
        uint128 aggregateCurrent = _liveOpenInterest[riskDomainId][riskDomainVersion];
        if (openInterestReductionBaseUnits > accountCurrent) {
            revert ExposureUnderflow(accountCurrent, openInterestReductionBaseUnits);
        }
        if (openInterestReductionBaseUnits > aggregateCurrent) {
            revert ExposureUnderflow(aggregateCurrent, openInterestReductionBaseUnits);
        }
        _accountLiveOpenInterest[accountId][riskDomainId][riskDomainVersion] =
            accountCurrent - openInterestReductionBaseUnits;
        _liveOpenInterest[riskDomainId][riskDomainVersion] = aggregateCurrent - openInterestReductionBaseUnits;
        emit ExposureReduced(
            accountId, riskDomainId, riskDomainVersion, openInterestReductionBaseUnits, reductionReference
        );
    }

    function riskDomainRegistry() external view returns (IRiskDomainRegistry) {
        return _riskDomainRegistry;
    }

    function adapterRegistry() external view returns (IAdapterRegistry) {
        return _adapterRegistry;
    }

    function collateralVault() external view returns (ICollateralVault) {
        return _collateralVault;
    }

    function getAdmission(RiskAdmissionId admissionId) external view returns (RiskAdmission memory admission) {
        admission = _admissions[admissionId];
        if (admission.status == RiskAdmissionStatus.Unspecified) revert UnknownRiskAdmission(admissionId);
    }

    function openInterest(RiskDomainId riskDomainId, uint32 version)
        external
        view
        returns (uint128 live, uint128 reserved)
    {
        return (_liveOpenInterest[riskDomainId][version], _reservedOpenInterest[riskDomainId][version]);
    }

    function _evaluate(
        RiskAdmissionRequest calldata request,
        PortfolioPositionWitness[] calldata positions,
        RiskObservation[] calldata observations,
        bool requireOpen
    ) private view returns (PortfolioRiskResult memory result) {
        if (
            AccountId.unwrap(request.accountId) == bytes32(0) || RiskDomainId.unwrap(request.riskDomainId) == bytes32(0)
                || request.riskDomainVersion == 0 || request.openInterestIncreaseBaseUnits == 0
                || request.salt == bytes32(0)
        ) revert InvalidRiskRequest();
        if (request.deadline < block.timestamp) revert RiskRequestExpired(request.deadline, block.timestamp);
        if (requireOpen && !_riskDomainRegistry.isOpenForNewRisk(request.riskDomainId, request.riskDomainVersion)) {
            revert RiskDomainNotOpen(request.riskDomainId, request.riskDomainVersion);
        }
        _collateralVault.reentrancyCheck();
        RiskDomainVersion memory domain = _requireDomain(request.riskDomainId, request.riskDomainVersion);
        AdapterVersion memory adapter = _requireAdapter(domain);
        bytes32 witnessHash = PortfolioRiskLib.hashPositions(positions);
        bytes32 observationsHash =
            PortfolioRiskLib.hashObservations(observations, maximumObservationAge, block.timestamp);
        RiskEvaluationContext memory context = _context(request, domain);
        result = PortfolioRiskLib.boundedEvaluate(
            adapter.definition.implementation, maximumAdapterGas, context, positions, observations
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
        ) revert RiskResultMismatch();
        _requireMetrics(result.metrics, context, domain);
    }

    function _context(RiskAdmissionRequest calldata request, RiskDomainVersion memory domain)
        private
        view
        returns (RiskEvaluationContext memory context)
    {
        CollateralId collateralId = _collateralVault.deriveCollateralId(
            domain.definition.collateralAssetId, domain.definition.collateralAssetVersion
        );
        (uint128 total, uint128 locked, uint128 available) = _collateralVault.balanceOf(request.accountId, collateralId);
        uint256 accountLiability = _collateralVault.accountRiskDomainTerminalLiability(
            request.accountId, request.riskDomainId, request.riskDomainVersion
        ) + _accountReservedLiability[request.accountId][request.riskDomainId][request.riskDomainVersion];
        uint256 aggregateLiability = _collateralVault.riskDomainTerminalLiability(
            request.riskDomainId, request.riskDomainVersion
        ) + _reservedLiability[request.riskDomainId][request.riskDomainVersion];
        uint256 currentOpenInterest = _liveOpenInterest[request.riskDomainId][request.riskDomainVersion]
            + _reservedOpenInterest[request.riskDomainId][request.riskDomainVersion];
        if (
            accountLiability > type(uint128).max || aggregateLiability > type(uint128).max
                || currentOpenInterest > type(uint128).max
        ) revert RiskResultMismatch();
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
    ) private pure {
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
        ) revert RiskResultMismatch();
        if (metrics.initialMarginBaseUnits > context.collateralAvailableBaseUnits) {
            revert InsufficientMargin(context.collateralAvailableBaseUnits, metrics.initialMarginBaseUnits);
        }
        if (openInterest > domain.definition.maxOpenInterestBaseUnits) {
            revert RiskCapExceeded(OPEN_INTEREST_CAP, domain.definition.maxOpenInterestBaseUnits, openInterest);
        }
        if (accountLiability > domain.definition.maxAccountLiabilityBaseUnits) {
            revert RiskCapExceeded(
                ACCOUNT_LIABILITY_CAP, domain.definition.maxAccountLiabilityBaseUnits, accountLiability
            );
        }
        if (aggregateLiability > domain.definition.maxAggregateLiabilityBaseUnits) {
            revert RiskCapExceeded(
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
        ) revert RiskResultMismatch();
    }

    function _requireDomain(RiskDomainId riskDomainId, uint32 version)
        private
        view
        returns (RiskDomainVersion memory domain)
    {
        domain = _riskDomainRegistry.getRiskDomain(riskDomainId, version);
        bytes32 definitionHash = RiskDomainDefinitionLib.hashDefinition(domain.definition, block.chainid);
        if (
            domain.version != version
                || RiskDomainId.unwrap(RiskDomainDefinitionLib.deriveRiskDomainId(domain.definition))
                    != RiskDomainId.unwrap(riskDomainId) || domain.definitionHash != definitionHash
                || domain.versionHash
                    != RiskDomainDefinitionLib.hashVersion(riskDomainId, version, definitionHash, block.chainid)
        ) revert RiskDomainRecordMismatch(riskDomainId, version);
    }

    function _requireAdapter(RiskDomainVersion memory domain) private view returns (AdapterVersion memory adapter) {
        AdapterId adapterId = domain.definition.riskAdapterId;
        uint32 version = domain.definition.riskAdapterVersion;
        if (!_adapterRegistry.isOpenForNewRisk(adapterId, version)) revert RiskAdapterRecordMismatch();
        adapter = _adapterRegistry.getAdapter(adapterId, version);
        bytes32 definitionHash = AdapterDefinitionLib.hashDefinition(adapter.definition, block.chainid);
        if (
            adapter.version != version
                || AdapterId.unwrap(AdapterDefinitionLib.deriveAdapterId(adapter.definition))
                    != AdapterId.unwrap(adapterId) || adapter.definitionHash != definitionHash
                || adapter.versionHash
                    != AdapterDefinitionLib.hashVersion(adapterId, version, definitionHash, block.chainid)
                || adapter.definition.kindId != domain.definition.requiredAdapterKindId
                || adapter.definition.interfaceHash != domain.definition.requiredInterfaceHash
                || adapter.definition.capabilityHash != domain.definition.requiredCapabilityHash
                || adapter.definition.implementation.codehash != adapter.definition.expectedRuntimeCodeHash
        ) revert RiskAdapterRecordMismatch();
    }

    function _increaseReservations(RiskAdmissionRequest calldata request) private {
        _reservedOpenInterest[request.riskDomainId][request.riskDomainVersion] += request.openInterestIncreaseBaseUnits;
        _reservedLiability[
            request.riskDomainId
        ][request.riskDomainVersion] += request.terminalLiabilityIncreaseBaseUnits;
        _accountReservedLiability[
            request.accountId
        ][request.riskDomainId][request.riskDomainVersion] += request.terminalLiabilityIncreaseBaseUnits;
    }

    function _releaseReservations(RiskAdmission storage admission) private {
        _reservedOpenInterest[admission.riskDomainId][admission.riskDomainVersion] -= admission.openInterestBaseUnits;
        _reservedLiability[admission.riskDomainId][admission.riskDomainVersion] -= admission.terminalLiabilityBaseUnits;
        _accountReservedLiability[
            admission.accountId
        ][admission.riskDomainId][admission.riskDomainVersion] -= admission.terminalLiabilityBaseUnits;
    }

    function _requireReserved(RiskAdmissionId admissionId) private view returns (RiskAdmission storage admission) {
        admission = _admissions[admissionId];
        if (admission.status == RiskAdmissionStatus.Unspecified) revert UnknownRiskAdmission(admissionId);
        if (admission.status != RiskAdmissionStatus.Reserved) revert InvalidRiskAdmissionState(admissionId);
    }

    function _minimum(uint128 left, uint128 right) private pure returns (uint128) {
        return left < right ? left : right;
    }

    function _requireDependency(address dependency) private view {
        if (dependency == address(0)) revert ZeroDependency(dependency);
        if (dependency.code.length == 0) revert DependencyHasNoCode(dependency);
    }
}
