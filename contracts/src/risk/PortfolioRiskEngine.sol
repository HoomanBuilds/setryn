// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IAdapterRegistry} from "../interfaces/IAdapterRegistry.sol";
import {ICollateralVault} from "../interfaces/ICollateralVault.sol";
import {IPortfolioRiskEngine} from "../interfaces/IPortfolioRiskEngine.sol";
import {IPositionEngine} from "../interfaces/IPositionEngine.sol";
import {IDefaultRiskSource} from "../interfaces/IDefaultRiskSource.sol";
import {IRiskDomainRegistry} from "../interfaces/IRiskDomainRegistry.sol";
import {AdapterDefinitionLib} from "../libraries/AdapterDefinitionLib.sol";
import {RiskDomainDefinitionLib} from "../libraries/RiskDomainDefinitionLib.sol";
import {AdapterVersion} from "../types/AdapterDefinition.sol";
import {AccountId, AdapterId, AdapterKindId, PositionId, RiskDomainId} from "../types/Identifiers.sol";
import {ObjectiveDefaultState} from "../types/DefaultTypes.sol";
import {RiskDomainVersion} from "../types/RiskDomainDefinition.sol";
import {
    DefaultRiskProof,
    PortfolioPositionWitness,
    PortfolioRiskResult,
    PositionRiskExposure,
    RiskAdmission,
    RiskAdmissionConsumption,
    RiskAdmissionId,
    RiskAdmissionRequest,
    RiskAdmissionStatus,
    RiskExposureReduction,
    RiskObservation
} from "../types/RiskTypes.sol";

import {PortfolioRiskAdmissionLib} from "./PortfolioRiskAdmissionLib.sol";
import {PortfolioRiskExposureLib} from "./PortfolioRiskExposureLib.sol";
import {PendingRiskExposure, PortfolioRiskDependencies} from "./PortfolioRiskTypes.sol";

import {IPortfolioRiskEngineLinkedErrors} from "./IPortfolioRiskEngineLinkedErrors.sol";

contract PortfolioRiskEngine is
    IPortfolioRiskEngineLinkedErrors,
    IPortfolioRiskEngine,
    IDefaultRiskSource,
    AccessControlDefaultAdminRules,
    ReentrancyGuard
{
    bytes32 public constant RISK_CONSUMER_ROLE = keccak256("SETRYN_RISK_CONSUMER_ROLE");
    bytes32 public constant EXPOSURE_REDUCER_ROLE = keccak256("SETRYN_EXPOSURE_REDUCER_ROLE");
    bytes32 private constant OPEN_INTEREST_CAP = keccak256("OPEN_INTEREST");
    bytes32 private constant ACCOUNT_LIABILITY_CAP = keccak256("ACCOUNT_LIABILITY");
    bytes32 private constant AGGREGATE_LIABILITY_CAP = keccak256("AGGREGATE_LIABILITY");
    bytes32 private constant EXPOSURE_REDUCTION_TYPEHASH = keccak256("SetrynRiskExposureReductionV1");
    bytes32 private constant DEFAULT_PROOF_TYPEHASH = keccak256("SetrynObjectiveDefaultProofV2");
    uint16 private constant MAXIMUM_ACTIVE_POSITIONS = 32;

    IRiskDomainRegistry private immutable _riskDomainRegistry;
    IAdapterRegistry private immutable _adapterRegistry;
    ICollateralVault private immutable _collateralVault;
    IPositionEngine private immutable _positionEngine;
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
    mapping(bytes32 defaultStateKey => ObjectiveDefaultState state) private _objectiveDefaultStates;
    mapping(bytes32 defaultStateKey => uint64 sequence) private _defaultStateSequences;
    mapping(bytes32 exposureId => PositionRiskExposure exposure) private _positionExposures;
    mapping(bytes32 positionKey => bytes32 exposureId) private _positionExposureIds;
    mapping(bytes32 exposureId => PositionId[] positionIds) private _exposurePositions;
    mapping(bytes32 exposureId => mapping(PositionId positionId => uint128 lots)) private _initialPositionLots;
    mapping(bytes32 exposureId => mapping(PositionId positionId => uint128 lots)) private _accountedPositionLots;
    mapping(AccountId accountId => mapping(RiskDomainId domainId => mapping(uint32 version => uint16 count))) private
        _activePositionCount;
    mapping(bytes32 transitionId => bool consumed) private _consumedExposureTransitions;

    mapping(bytes32 exposureId => PendingRiskExposure exposure) private _pendingExposures;

    constructor(
        uint48 defaultAdminDelay,
        address initialAdmin,
        IRiskDomainRegistry riskDomainRegistry_,
        IAdapterRegistry adapterRegistry_,
        ICollateralVault collateralVault_,
        IPositionEngine positionEngine_,
        uint64 maximumAdapterGas_,
        uint64 maximumObservationAge_
    ) AccessControlDefaultAdminRules(defaultAdminDelay, initialAdmin) {
        _requireDependency(address(riskDomainRegistry_));
        _requireDependency(address(adapterRegistry_));
        _requireDependency(address(collateralVault_));
        _requireDependency(address(positionEngine_));
        if (maximumAdapterGas_ == 0 || maximumObservationAge_ == 0) revert InvalidRiskRequest();
        if (address(positionEngine_.collateralVault()) != address(collateralVault_)) revert InvalidRiskRequest();
        _riskDomainRegistry = riskDomainRegistry_;
        _adapterRegistry = adapterRegistry_;
        _collateralVault = collateralVault_;
        _positionEngine = positionEngine_;
        maximumAdapterGas = maximumAdapterGas_;
        maximumObservationAge = maximumObservationAge_;
        _grantRole(RISK_CONSUMER_ROLE, initialAdmin);
        _grantRole(EXPOSURE_REDUCER_ROLE, initialAdmin);
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
        return PortfolioRiskAdmissionLib.reserveNewRisk(
            _dependencies(),
            _admissions,
            _usedNonces,
            _liveOpenInterest,
            _reservedOpenInterest,
            _reservedLiability,
            _accountReservedLiability,
            request,
            positions,
            observations
        );
    }

    function previewRisk(
        RiskAdmissionRequest calldata request,
        PortfolioPositionWitness[] calldata positions,
        RiskObservation[] calldata observations
    ) external view returns (PortfolioRiskResult memory result) {
        return PortfolioRiskAdmissionLib.evaluate(
            _dependencies(),
            _liveOpenInterest,
            _reservedOpenInterest,
            _reservedLiability,
            _accountReservedLiability,
            request,
            positions,
            observations,
            true
        );
    }

    function consumeAdmission(RiskAdmissionConsumption calldata consumption)
        external
        onlyRole(RISK_CONSUMER_ROLE)
        nonReentrant
    {
        PortfolioRiskAdmissionLib.consumeAdmission(
            _dependencies(),
            _admissions,
            _liveOpenInterest,
            _reservedOpenInterest,
            _accountLiveOpenInterest,
            _reservedLiability,
            _accountReservedLiability,
            _pendingExposures,
            consumption
        );
    }

    function bindConsumedExposure(
        RiskAdmissionId admissionId,
        bytes32 executionReference,
        PositionId[] calldata positionIds
    ) external onlyRole(RISK_CONSUMER_ROLE) nonReentrant {
        PortfolioRiskExposureLib.bindConsumedExposure(
            _dependencies(),
            _admissions,
            _positionExposures,
            _positionExposureIds,
            _exposurePositions,
            _initialPositionLots,
            _accountedPositionLots,
            _activePositionCount,
            _pendingExposures,
            admissionId,
            executionReference,
            positionIds
        );
    }

    function releaseAdmission(RiskAdmissionId admissionId, bytes32 releaseReference)
        external
        onlyRole(RISK_CONSUMER_ROLE)
        nonReentrant
    {
        if (releaseReference == bytes32(0)) revert ZeroReference();
        RiskAdmission storage admission = _requireReserved(admissionId);
        bool partiallyConsumed = admission.remainingOpenInterestBaseUnits < admission.openInterestBaseUnits;
        _releaseReservations(admission);
        admission.status = partiallyConsumed ? RiskAdmissionStatus.Consumed : RiskAdmissionStatus.Released;
        emit RiskAdmissionReleased(admissionId, releaseReference);
    }

    function expireAdmission(RiskAdmissionId admissionId) external nonReentrant {
        RiskAdmission storage admission = _requireReserved(admissionId);
        if (block.timestamp <= admission.deadline) {
            revert RiskAdmissionNotExpired(admissionId, admission.deadline);
        }
        bool partiallyConsumed = admission.remainingOpenInterestBaseUnits < admission.openInterestBaseUnits;
        _releaseReservations(admission);
        admission.status = partiallyConsumed ? RiskAdmissionStatus.Consumed : RiskAdmissionStatus.Released;
        emit RiskAdmissionExpired(admissionId, admission.deadline);
    }

    function reduceExposure(RiskExposureReduction calldata reduction)
        external
        onlyRole(EXPOSURE_REDUCER_ROLE)
        nonReentrant
    {
        PortfolioRiskExposureLib.reduceExposure(
            _dependencies(),
            _liveOpenInterest,
            _accountLiveOpenInterest,
            _positionExposures,
            _positionExposureIds,
            _exposurePositions,
            _initialPositionLots,
            _accountedPositionLots,
            _activePositionCount,
            _consumedExposureTransitions,
            reduction
        );
    }

    function exposureReductionWitness(PositionId positionId, AccountId accountId)
        external
        view
        returns (RiskExposureReduction memory reduction)
    {
        return PortfolioRiskExposureLib.exposureReductionWitness(
            _dependencies(),
            _positionExposures,
            _positionExposureIds,
            _exposurePositions,
            _initialPositionLots,
            _accountedPositionLots,
            positionId,
            accountId
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

    function positionEngine() external view returns (IPositionEngine) {
        return _positionEngine;
    }

    function getAdmission(RiskAdmissionId admissionId) external view returns (RiskAdmission memory admission) {
        admission = _admissions[admissionId];
        if (admission.status == RiskAdmissionStatus.Unspecified) revert UnknownRiskAdmission(admissionId);
    }

    function positionExposure(PositionId positionId, AccountId accountId)
        external
        view
        returns (PositionRiskExposure memory exposure)
    {
        exposure = _positionExposures[_positionExposureIds[_positionKey(positionId, accountId)]];
        if (RiskAdmissionId.unwrap(exposure.admissionId) == bytes32(0)) {
            revert InvalidExposurePosition(positionId, accountId);
        }
    }

    function publishObjectiveDefaultState(DefaultRiskProof calldata proof)
        external
        nonReentrant
        returns (ObjectiveDefaultState memory state)
    {
        return PortfolioRiskExposureLib.publishObjectiveDefaultState(
            _dependencies(),
            _admissions,
            _liveOpenInterest,
            _reservedOpenInterest,
            _accountLiveOpenInterest,
            _reservedLiability,
            _accountReservedLiability,
            _objectiveDefaultStates,
            _defaultStateSequences,
            _positionExposures,
            _positionExposureIds,
            _activePositionCount,
            proof
        );
    }

    function objectiveDefaultState(
        PositionId positionId,
        AccountId accountId,
        RiskDomainId riskDomainId,
        uint32 riskDomainVersion
    ) external view returns (ObjectiveDefaultState memory state) {
        state = _objectiveDefaultStates[_defaultStateKey(positionId, accountId, riskDomainId, riskDomainVersion)];
        if (state.sequence == 0) revert UnknownDefaultRiskState(positionId, accountId);
    }

    function openInterest(RiskDomainId riskDomainId, uint32 version)
        external
        view
        returns (uint128 live, uint128 reserved)
    {
        return (_liveOpenInterest[riskDomainId][version], _reservedOpenInterest[riskDomainId][version]);
    }

    function _defaultStateKey(
        PositionId positionId,
        AccountId accountId,
        RiskDomainId riskDomainId,
        uint32 riskDomainVersion
    ) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("SetrynObjectiveDefaultStateKeyV1"), positionId, accountId, riskDomainId, riskDomainVersion
            )
        );
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

    function _requireAdapter(RiskDomainVersion memory domain, bool requireOpen)
        private
        view
        returns (AdapterVersion memory adapter)
    {
        AdapterId adapterId = domain.definition.riskAdapterId;
        uint32 version = domain.definition.riskAdapterVersion;
        if (requireOpen
                ? !_adapterRegistry.isOpenForNewRisk(adapterId, version)
                : !_adapterRegistry.isLifecycleEnabled(adapterId, version)) revert RiskAdapterRecordMismatch();
        adapter = _adapterRegistry.getAdapter(adapterId, version);
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
        ) revert RiskAdapterRecordMismatch();
    }

    function _releaseReservations(RiskAdmission storage admission) private {
        _reservedOpenInterest[
            admission.riskDomainId
        ][admission.riskDomainVersion] -= admission.remainingOpenInterestBaseUnits;
        _reservedLiability[
            admission.riskDomainId
        ][admission.riskDomainVersion] -= admission.remainingTerminalLiabilityBaseUnits;
        _accountReservedLiability[
            admission.accountId
        ][admission.riskDomainId][admission.riskDomainVersion] -= admission.remainingTerminalLiabilityBaseUnits;
        admission.remainingOpenInterestBaseUnits = 0;
        admission.remainingTerminalLiabilityBaseUnits = 0;
    }

    function _positionKey(PositionId positionId, AccountId accountId) private pure returns (bytes32) {
        return keccak256(abi.encode(positionId, accountId));
    }

    function _exposureId(RiskAdmissionId admissionId, bytes32 executionReference, AccountId accountId)
        private
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(keccak256("SetrynPositionRiskExposureV1"), admissionId, executionReference, accountId)
        );
    }

    function _requireReserved(RiskAdmissionId admissionId) private view returns (RiskAdmission storage admission) {
        admission = _admissions[admissionId];
        if (admission.status == RiskAdmissionStatus.Unspecified) revert UnknownRiskAdmission(admissionId);
        if (admission.status != RiskAdmissionStatus.Reserved) revert InvalidRiskAdmissionState(admissionId);
    }

    function _minimum(uint128 left, uint128 right) private pure returns (uint128) {
        return left < right ? left : right;
    }

    /// Linked libraries execute in this contract's context and receive the immutable dependency graph explicitly.
    function _dependencies() private view returns (PortfolioRiskDependencies memory) {
        return PortfolioRiskDependencies({
            riskDomainRegistry: _riskDomainRegistry,
            adapterRegistry: _adapterRegistry,
            collateralVault: _collateralVault,
            positionEngine: _positionEngine,
            maximumAdapterGas: maximumAdapterGas,
            maximumObservationAge: maximumObservationAge
        });
    }

    function _requireDependency(address dependency) private view {
        if (dependency == address(0)) revert ZeroDependency(dependency);
        if (dependency.code.length == 0) revert DependencyHasNoCode(dependency);
    }
}
