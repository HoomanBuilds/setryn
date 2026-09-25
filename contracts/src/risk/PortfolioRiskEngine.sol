// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IAdapterRegistry} from "../interfaces/IAdapterRegistry.sol";
import {ICollateralVault} from "../interfaces/ICollateralVault.sol";
import {IPortfolioRiskEngine} from "../interfaces/IPortfolioRiskEngine.sol";
import {IPositionEngine} from "../interfaces/IPositionEngine.sol";
import {IDefaultRiskSource} from "../interfaces/IDefaultRiskSource.sol";
import {IRiskDomainRegistry} from "../interfaces/IRiskDomainRegistry.sol";
import {AdapterDefinitionLib} from "../libraries/AdapterDefinitionLib.sol";
import {PortfolioRiskLib} from "../libraries/PortfolioRiskLib.sol";
import {RiskDomainDefinitionLib} from "../libraries/RiskDomainDefinitionLib.sol";
import {AdapterVersion} from "../types/AdapterDefinition.sol";
import {AccountId, AdapterId, CollateralId, PositionId, RiskDomainId, RiskModelId} from "../types/Identifiers.sol";
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
    RiskAdmissionConsumption,
    RiskAdmissionId,
    RiskAdmissionRequest,
    RiskAdmissionStatus,
    RiskExposureReduction,
    RiskEvaluationContext,
    RiskObservation
} from "../types/RiskTypes.sol";
import {PositionStatus} from "../types/PositionTypes.sol";

contract PortfolioRiskEngine is
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

    struct PendingRiskExposure {
        RiskAdmissionId admissionId;
        AccountId accountId;
        RiskDomainId riskDomainId;
        uint32 riskDomainVersion;
        uint128 openInterestBaseUnits;
        uint16 expectedPositionCount;
        bool bound;
    }

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
        emit RiskAdmissionReserved(
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

    function previewRisk(
        RiskAdmissionRequest calldata request,
        PortfolioPositionWitness[] calldata positions,
        RiskObservation[] calldata observations
    ) external view returns (PortfolioRiskResult memory result) {
        return _evaluate(request, positions, observations, true);
    }

    function consumeAdmission(RiskAdmissionConsumption calldata consumption)
        external
        onlyRole(RISK_CONSUMER_ROLE)
        nonReentrant
    {
        if (consumption.executionReference == bytes32(0)) revert ZeroReference();
        RiskAdmission storage admission = _requireReserved(consumption.admissionId);
        if (block.timestamp > admission.deadline) {
            revert RiskAdmissionExpiredForConsumption(consumption.admissionId, admission.deadline);
        }
        if (
            admission.reservedResultCommitment != consumption.expectedResultHash
                || admission.resultHash != consumption.expectedResultHash
                || admission.accountId != consumption.expectedAccountId
                || admission.riskDomainId != consumption.expectedRiskDomainId
                || admission.riskDomainVersion != consumption.expectedRiskDomainVersion
                || consumption.expectedOpenInterestBaseUnits == 0
                || consumption.expectedOpenInterestBaseUnits > admission.remainingOpenInterestBaseUnits
                || consumption.expectedTerminalLiabilityBaseUnits > admission.remainingTerminalLiabilityBaseUnits
                || consumption.expectedPositionCount == 0
                || consumption.expectedPositionCount > MAXIMUM_ACTIVE_POSITIONS
        ) revert RiskAdmissionConsumptionMismatch(consumption.admissionId);
        if (!_riskDomainRegistry.isLifecycleEnabled(admission.riskDomainId, admission.riskDomainVersion)) {
            revert RiskDomainNotLifecycleEnabled(admission.riskDomainId, admission.riskDomainVersion);
        }
        bytes32 exposureId = _exposureId(consumption.admissionId, consumption.executionReference, admission.accountId);
        if (RiskAdmissionId.unwrap(_pendingExposures[exposureId].admissionId) != bytes32(0)) {
            revert RiskAdmissionConsumptionMismatch(consumption.admissionId);
        }
        _pendingExposures[exposureId] = PendingRiskExposure({
            admissionId: consumption.admissionId,
            accountId: admission.accountId,
            riskDomainId: admission.riskDomainId,
            riskDomainVersion: admission.riskDomainVersion,
            openInterestBaseUnits: consumption.expectedOpenInterestBaseUnits,
            expectedPositionCount: consumption.expectedPositionCount,
            bound: false
        });
        _consumeReservations(
            admission, consumption.expectedOpenInterestBaseUnits, consumption.expectedTerminalLiabilityBaseUnits
        );
        _liveOpenInterest[
            admission.riskDomainId
        ][admission.riskDomainVersion] += consumption.expectedOpenInterestBaseUnits;
        _accountLiveOpenInterest[
            admission.accountId
        ][admission.riskDomainId][admission.riskDomainVersion] += consumption.expectedOpenInterestBaseUnits;
        if (admission.remainingOpenInterestBaseUnits == 0) {
            if (admission.remainingTerminalLiabilityBaseUnits != 0) {
                revert RiskAdmissionConsumptionMismatch(consumption.admissionId);
            }
            admission.status = RiskAdmissionStatus.Consumed;
            emit RiskAdmissionConsumed(consumption.admissionId, consumption.executionReference);
        } else {
            emit RiskAdmissionPartiallyConsumed(
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

    function bindConsumedExposure(
        RiskAdmissionId admissionId,
        bytes32 executionReference,
        PositionId[] calldata positionIds
    ) external onlyRole(RISK_CONSUMER_ROLE) nonReentrant {
        if (executionReference == bytes32(0)) revert ZeroReference();
        RiskAdmission storage admission = _admissions[admissionId];
        if (admission.status != RiskAdmissionStatus.Reserved && admission.status != RiskAdmissionStatus.Consumed) {
            revert InvalidRiskAdmissionState(admissionId);
        }
        bytes32 exposureId = _exposureId(admissionId, executionReference, admission.accountId);
        PendingRiskExposure storage pending = _pendingExposures[exposureId];
        if (pending.admissionId != admissionId || pending.bound || pending.expectedPositionCount != positionIds.length) revert RiskAdmissionConsumptionMismatch(admissionId);
        _bindPositionExposure(exposureId, pending, positionIds);
        pending.bound = true;
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
        if (reduction.transitionId == bytes32(0)) revert ZeroReference();
        if (_consumedExposureTransitions[reduction.transitionId]) {
            revert ExposureTransitionAlreadyConsumed(reduction.transitionId);
        }
        PositionRiskExposure storage exposure = _positionExposures[reduction.exposureId];
        PositionId[] storage positionIds = _exposurePositions[reduction.exposureId];
        if (
            exposure.exposureId != reduction.exposureId || exposure.admissionId != reduction.admissionId
                || exposure.accountId != reduction.accountId || positionIds.length == 0
                || positionIds[0] != reduction.canonicalPositionId
                || _positionExposureIds[_positionKey(reduction.canonicalPositionId, reduction.accountId)]
                    != reduction.exposureId || exposure.accountedPositionLots != reduction.expectedPreviousPositionLots
        ) revert InvalidExposureReduction(reduction.canonicalPositionId, reduction.accountId);
        PositionRiskSnapshot memory snapshot =
            _positionEngine.positionRiskSnapshot(reduction.canonicalPositionId, reduction.accountId);
        if (
            snapshot.riskDomainId != exposure.riskDomainId || snapshot.riskDomainVersion != exposure.riskDomainVersion
                || snapshot.remainingLots != reduction.expectedNewPositionLots
                || snapshot.remainingLots >= exposure.accountedPositionLots
        ) revert InvalidExposureReduction(reduction.canonicalPositionId, reduction.accountId);
        bytes32[] memory stateHashes = new bytes32[](positionIds.length);
        uint128 canonicalInitial = exposure.initialPositionLots;
        for (uint256 i; i < positionIds.length; ++i) {
            PositionRiskSnapshot memory component =
                _positionEngine.positionRiskSnapshot(positionIds[i], reduction.accountId);
            uint128 initialLots = _initialPositionLots[reduction.exposureId][positionIds[i]];
            uint128 accountedLots = _accountedPositionLots[reduction.exposureId][positionIds[i]];
            if (
                component.riskDomainId != exposure.riskDomainId
                    || component.riskDomainVersion != exposure.riskDomainVersion
                    || component.remainingLots >= accountedLots
                    || uint256(component.remainingLots) * canonicalInitial
                        != uint256(snapshot.remainingLots) * initialLots
            ) revert InvalidExposureReduction(reduction.canonicalPositionId, reduction.accountId);
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
        ) revert InvalidExposureReduction(reduction.canonicalPositionId, reduction.accountId);
        uint128 domainLive = _liveOpenInterest[exposure.riskDomainId][exposure.riskDomainVersion];
        uint128 accountLive =
            _accountLiveOpenInterest[exposure.accountId][exposure.riskDomainId][exposure.riskDomainVersion];
        if (domainLive < expectedReduction || accountLive < expectedReduction) {
            revert ExposureUnderflow(domainLive < accountLive ? domainLive : accountLive, expectedReduction);
        }
        _consumedExposureTransitions[reduction.transitionId] = true;
        exposure.accountedPositionLots = snapshot.remainingLots;
        exposure.remainingOpenInterestBaseUnits = expectedRemaining;
        for (uint256 i; i < positionIds.length; ++i) {
            PositionRiskSnapshot memory component =
                _positionEngine.positionRiskSnapshot(positionIds[i], reduction.accountId);
            _accountedPositionLots[reduction.exposureId][positionIds[i]] = component.remainingLots;
            if (component.remainingLots == 0) {
                delete _positionExposureIds[_positionKey(positionIds[i], reduction.accountId)];
            }
        }
        if (expectedRemaining == 0) {
            _activePositionCount[
                exposure.accountId
            ][exposure.riskDomainId][exposure.riskDomainVersion] -= exposure.positionCount;
        }
        _liveOpenInterest[exposure.riskDomainId][exposure.riskDomainVersion] = domainLive - expectedReduction;
        _accountLiveOpenInterest[exposure.accountId][exposure.riskDomainId][exposure.riskDomainVersion] =
            accountLive - expectedReduction;
        emit ExposureReduced(
            exposure.accountId,
            exposure.riskDomainId,
            exposure.riskDomainVersion,
            expectedReduction,
            reduction.transitionId
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
        RiskAdmission storage admission = _admissions[proof.admissionId];
        PositionRiskExposure storage exposure =
            _positionExposures[_positionExposureIds[_positionKey(proof.positionId, admission.accountId)]];
        if (
            PositionId.unwrap(proof.positionId) == bytes32(0)
                || (admission.status != RiskAdmissionStatus.Reserved
                    && admission.status != RiskAdmissionStatus.Consumed) || exposure.admissionId != proof.admissionId
                || exposure.accountId != admission.accountId || exposure.remainingOpenInterestBaseUnits == 0
        ) revert InvalidDefaultRiskProof();
        RiskDomainVersion memory domain = _requireDomain(admission.riskDomainId, admission.riskDomainVersion);
        PositionRiskSnapshot memory target = _positionEngine.positionRiskSnapshot(proof.positionId, admission.accountId);
        if (
            target.riskDomainId != admission.riskDomainId || target.riskDomainVersion != admission.riskDomainVersion
                || target.remainingLots == 0 || target.finalResolutionAt <= block.timestamp
                || target.settlementDeadline <= target.finalResolutionAt
                || (target.status != PositionStatus.Live
                    && target.status != PositionStatus.Fixing
                    && target.status != PositionStatus.SettlementReady)
        ) revert InvalidDefaultRiskProof();
        bool targetIncluded;
        if (
            proof.positions.length
                != _activePositionCount[admission.accountId][admission.riskDomainId][admission.riskDomainVersion]
        ) revert InvalidDefaultRiskProof();
        for (uint256 i; i < proof.positions.length; ++i) {
            PositionRiskSnapshot memory canonical =
                _positionEngine.positionRiskSnapshot(proof.positions[i].positionId, admission.accountId);
            PositionRiskExposure storage memberExposure = _positionExposures[
                _positionExposureIds[_positionKey(proof.positions[i].positionId, admission.accountId)]
            ];
            if (
                canonical.riskDomainId != admission.riskDomainId
                    || canonical.riskDomainVersion != admission.riskDomainVersion
                    || keccak256(abi.encode(canonical.witness)) != keccak256(abi.encode(proof.positions[i]))
                    || memberExposure.accountId != admission.accountId
                    || memberExposure.riskDomainId != admission.riskDomainId
                    || memberExposure.riskDomainVersion != admission.riskDomainVersion
                    || memberExposure.remainingOpenInterestBaseUnits == 0
            ) revert InvalidDefaultRiskProof();
            if (proof.positions[i].positionId == proof.positionId) targetIncluded = true;
        }
        if (!targetIncluded) revert InvalidDefaultRiskProof();
        PortfolioRiskResult memory result =
            _evaluateCurrentRisk(admission.accountId, domain, proof.positions, proof.observations);
        CollateralId collateralId = _collateralVault.deriveCollateralId(
            domain.definition.collateralAssetId, domain.definition.collateralAssetVersion
        );
        (uint128 total,, uint128 available) = _collateralVault.balanceOf(admission.accountId, collateralId);
        uint128 maintenance = result.metrics.maintenanceMarginBaseUnits;
        if (maintenance <= total) revert InvalidDefaultRiskProof();
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
        uint64 sequence = _defaultStateSequences[stateKey] + 1;
        _defaultStateSequences[stateKey] = sequence;
        bytes32 counterCommitment = keccak256(
            abi.encode(
                result.witnessHash,
                deficiencyProofHash,
                admission.requestHash,
                admission.resultHash,
                target.stateHash,
                _liveOpenInterest[admission.riskDomainId][admission.riskDomainVersion],
                _accountLiveOpenInterest[admission.accountId][admission.riskDomainId][admission.riskDomainVersion],
                _collateralVault.accountRiskDomainTerminalLiability(
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
        _objectiveDefaultStates[stateKey] = state;
        emit ObjectiveDefaultStatePublished(
            proof.positionId,
            admission.accountId,
            admission.riskDomainId,
            admission.riskDomainVersion,
            sequence,
            state.stateHash
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
        if (
            request.deadline <= block.timestamp
                || uint256(request.deadline) > block.timestamp + uint256(maximumObservationAge)
        ) revert RiskRequestExpired(request.deadline, block.timestamp);
        if (requireOpen && !_riskDomainRegistry.isOpenForNewRisk(request.riskDomainId, request.riskDomainVersion)) {
            revert RiskDomainNotOpen(request.riskDomainId, request.riskDomainVersion);
        }
        _collateralVault.reentrancyCheck();
        RiskDomainVersion memory domain = _requireDomain(request.riskDomainId, request.riskDomainVersion);
        AdapterVersion memory adapter = _requireAdapter(domain, true);
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

    function _evaluateCurrentRisk(
        AccountId accountId,
        RiskDomainVersion memory domain,
        PortfolioPositionWitness[] calldata positions,
        RiskObservation[] calldata observations
    ) private view returns (PortfolioRiskResult memory result) {
        _collateralVault.reentrancyCheck();
        RiskDomainId domainId = RiskDomainDefinitionLib.deriveRiskDomainId(domain.definition);
        if (!_riskDomainRegistry.isLifecycleEnabled(domainId, domain.version)) {
            revert RiskDomainNotLifecycleEnabled(domainId, domain.version);
        }
        AdapterVersion memory adapter = _requireAdapter(domain, false);
        bytes32 witnessHash = PortfolioRiskLib.hashPositions(positions);
        bytes32 observationsHash =
            PortfolioRiskLib.hashObservations(observations, maximumObservationAge, block.timestamp);
        RiskEvaluationContext memory context = _currentContext(accountId, domain);
        result = PortfolioRiskLib.boundedEvaluate(
            adapter.definition.implementation, maximumAdapterGas, context, positions, observations
        );
        bytes32 configurationHash = _configurationHash(domain, adapter);
        if (
            result.configurationHash != configurationHash || result.witnessHash != witnessHash
                || result.observationsHash != observationsHash
        ) revert RiskResultMismatch();
        _requireCurrentMetrics(result.metrics, context, domain);
    }

    function _currentContext(AccountId accountId, RiskDomainVersion memory domain)
        private
        view
        returns (RiskEvaluationContext memory context)
    {
        RiskDomainId domainId = RiskDomainDefinitionLib.deriveRiskDomainId(domain.definition);
        CollateralId collateralId = _collateralVault.deriveCollateralId(
            domain.definition.collateralAssetId, domain.definition.collateralAssetVersion
        );
        (uint128 total, uint128 locked, uint128 available) = _collateralVault.balanceOf(accountId, collateralId);
        uint256 accountLiability = _collateralVault.accountRiskDomainTerminalLiability(
            accountId, domainId, domain.version
        ) + _accountReservedLiability[accountId][domainId][domain.version];
        uint256 aggregateLiability = _collateralVault.riskDomainTerminalLiability(domainId, domain.version)
            + _reservedLiability[domainId][domain.version];
        uint256 currentOpenInterest =
            _liveOpenInterest[domainId][domain.version] + _reservedOpenInterest[domainId][domain.version];
        if (
            accountLiability > type(uint128).max || aggregateLiability > type(uint128).max
                || currentOpenInterest > type(uint128).max
        ) revert RiskResultMismatch();
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
    ) private pure {
        if (
            metrics.openInterestBaseUnits != context.currentOpenInterestBaseUnits
                || metrics.accountTerminalLiabilityBaseUnits != context.currentAccountTerminalLiabilityBaseUnits
                || metrics.aggregateTerminalLiabilityBaseUnits != context.currentAggregateTerminalLiabilityBaseUnits
                || metrics.maintenanceMarginBaseUnits > metrics.initialMarginBaseUnits
        ) revert RiskResultMismatch();
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
        ) revert RiskResultMismatch();
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
                || adapter.definition.kindId != domain.definition.requiredAdapterKindId
                || adapter.definition.interfaceHash != domain.definition.requiredInterfaceHash
                || adapter.definition.capabilityHash != domain.definition.requiredCapabilityHash
                || adapter.definition.implementation.codehash != adapter.definition.expectedRuntimeCodeHash
        ) revert RiskAdapterRecordMismatch();
    }

    function _configurationHash(RiskDomainVersion memory domain, AdapterVersion memory adapter)
        private
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

    function _increaseReservations(RiskAdmissionRequest calldata request) private {
        _reservedOpenInterest[request.riskDomainId][request.riskDomainVersion] += request.openInterestIncreaseBaseUnits;
        _reservedLiability[
            request.riskDomainId
        ][request.riskDomainVersion] += request.terminalLiabilityIncreaseBaseUnits;
        _accountReservedLiability[
            request.accountId
        ][request.riskDomainId][request.riskDomainVersion] += request.terminalLiabilityIncreaseBaseUnits;
    }

    function _bindPositionExposure(
        bytes32 exposureId,
        PendingRiskExposure storage pending,
        PositionId[] calldata positionIds
    ) private {
        uint256 count = positionIds.length;
        if (count == 0 || count > MAXIMUM_ACTIVE_POSITIONS) {
            revert InvalidExposurePosition(PositionId.wrap(bytes32(0)), pending.accountId);
        }
        uint16 active = _activePositionCount[pending.accountId][pending.riskDomainId][pending.riskDomainVersion];
        if (uint256(active) + count > MAXIMUM_ACTIVE_POSITIONS) {
            revert InvalidExposurePosition(positionIds[0], pending.accountId);
        }
        if (_positionExposures[exposureId].exposureId != bytes32(0)) {
            revert DuplicateExposurePosition(positionIds[0], pending.accountId);
        }
        uint128 canonicalLots;
        for (uint256 i; i < count; ++i) {
            PositionId positionId = positionIds[i];
            bytes32 positionKey = _positionKey(positionId, pending.accountId);
            if (PositionId.unwrap(positionId) == bytes32(0) || _positionExposureIds[positionKey] != bytes32(0)) {
                revert DuplicateExposurePosition(positionId, pending.accountId);
            }
            PositionRiskSnapshot memory snapshot = _positionEngine.positionRiskSnapshot(positionId, pending.accountId);
            if (
                snapshot.riskDomainId != pending.riskDomainId || snapshot.riskDomainVersion != pending.riskDomainVersion
                    || snapshot.remainingLots == 0 || snapshot.status != PositionStatus.Live
            ) revert InvalidExposurePosition(positionId, pending.accountId);
            for (uint256 j; j < i; ++j) {
                if (positionIds[j] == positionId) {
                    revert DuplicateExposurePosition(positionId, pending.accountId);
                }
            }
            if (i == 0) canonicalLots = snapshot.remainingLots;
            _positionExposureIds[positionKey] = exposureId;
            _exposurePositions[exposureId].push(positionId);
            _initialPositionLots[exposureId][positionId] = snapshot.remainingLots;
            _accountedPositionLots[exposureId][positionId] = snapshot.remainingLots;
        }
        _positionExposures[exposureId] = PositionRiskExposure({
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
        _activePositionCount[pending.accountId][pending.riskDomainId][pending.riskDomainVersion] =
            active + uint16(count);
    }

    function _consumeReservations(RiskAdmission storage admission, uint128 openInterest, uint128 liability) private {
        _reservedOpenInterest[admission.riskDomainId][admission.riskDomainVersion] -= openInterest;
        _reservedLiability[admission.riskDomainId][admission.riskDomainVersion] -= liability;
        _accountReservedLiability[admission.accountId][admission.riskDomainId][admission.riskDomainVersion] -= liability;
        admission.remainingOpenInterestBaseUnits -= openInterest;
        admission.remainingTerminalLiabilityBaseUnits -= liability;
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

    function _requireDependency(address dependency) private view {
        if (dependency == address(0)) revert ZeroDependency(dependency);
        if (dependency.code.length == 0) revert DependencyHasNoCode(dependency);
    }
}
