// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IAdapterRegistry} from "./IAdapterRegistry.sol";
import {ICollateralVault} from "./ICollateralVault.sol";
import {IRiskDomainRegistry} from "./IRiskDomainRegistry.sol";
import {AccountId, RiskDomainId} from "../types/Identifiers.sol";
import {
    DefaultRiskProof,
    PortfolioPositionWitness,
    PortfolioRiskResult,
    RiskAdmission,
    RiskAdmissionId,
    RiskAdmissionRequest,
    RiskObservation
} from "../types/RiskTypes.sol";
import {ObjectiveDefaultState} from "../types/DefaultTypes.sol";
import {PositionId} from "../types/Identifiers.sol";

interface IPortfolioRiskEngine {
    event RiskAdmissionReserved(
        RiskAdmissionId indexed admissionId,
        AccountId indexed accountId,
        RiskDomainId indexed riskDomainId,
        uint32 riskDomainVersion,
        bytes32 requestHash,
        bytes32 resultHash,
        uint128 openInterestBaseUnits,
        uint128 terminalLiabilityBaseUnits
    );
    event RiskAdmissionConsumed(RiskAdmissionId indexed admissionId, bytes32 indexed executionReference);
    event RiskAdmissionReleased(RiskAdmissionId indexed admissionId, bytes32 indexed releaseReference);
    event ExposureReduced(
        AccountId indexed accountId,
        RiskDomainId indexed riskDomainId,
        uint32 indexed riskDomainVersion,
        uint128 openInterestReductionBaseUnits,
        bytes32 reductionReference
    );
    event ObjectiveDefaultStatePublished(
        PositionId indexed positionId,
        AccountId indexed accountId,
        RiskDomainId indexed riskDomainId,
        uint32 riskDomainVersion,
        uint64 sequence,
        bytes32 stateHash
    );

    error ZeroDependency(address dependency);
    error DependencyHasNoCode(address dependency);
    error InvalidRiskRequest();
    error RiskRequestExpired(uint64 deadline, uint256 currentTimestamp);
    error RiskDomainNotOpen(RiskDomainId riskDomainId, uint32 version);
    error RiskDomainNotLifecycleEnabled(RiskDomainId riskDomainId, uint32 version);
    error RiskDomainRecordMismatch(RiskDomainId riskDomainId, uint32 version);
    error RiskAdapterRecordMismatch();
    error RiskAdapterCallFailed();
    error InvalidRiskAdapterReturn(uint256 length);
    error InvalidPortfolioWitness();
    error InvalidObservations();
    error StaleObservation(bytes32 observationKey, uint64 observedAt, uint256 currentTimestamp);
    error RiskResultMismatch();
    error InsufficientMargin(uint128 available, uint128 required);
    error RiskCapExceeded(bytes32 capKind, uint256 cap, uint256 requested);
    error DuplicateRiskAdmission(RiskAdmissionId admissionId);
    error UnknownRiskAdmission(RiskAdmissionId admissionId);
    error InvalidRiskAdmissionState(RiskAdmissionId admissionId);
    error RiskNonceAlreadyUsed(AccountId accountId, uint256 nonce);
    error ExposureUnderflow(uint128 current, uint128 requestedReduction);
    error ZeroReference();
    error InvalidDefaultRiskProof();
    error UnknownDefaultRiskState(PositionId positionId, AccountId accountId);

    function reserveNewRisk(
        RiskAdmissionRequest calldata request,
        PortfolioPositionWitness[] calldata positions,
        RiskObservation[] calldata observations
    ) external returns (RiskAdmissionId admissionId, PortfolioRiskResult memory result);
    function consumeAdmission(RiskAdmissionId admissionId, bytes32 executionReference) external;
    function releaseAdmission(RiskAdmissionId admissionId, bytes32 releaseReference) external;
    function reduceExposure(
        AccountId accountId,
        RiskDomainId riskDomainId,
        uint32 riskDomainVersion,
        uint128 openInterestReductionBaseUnits,
        bytes32 reductionReference
    ) external;
    function previewRisk(
        RiskAdmissionRequest calldata request,
        PortfolioPositionWitness[] calldata positions,
        RiskObservation[] calldata observations
    ) external view returns (PortfolioRiskResult memory result);
    function riskDomainRegistry() external view returns (IRiskDomainRegistry);
    function adapterRegistry() external view returns (IAdapterRegistry);
    function collateralVault() external view returns (ICollateralVault);
    function getAdmission(RiskAdmissionId admissionId) external view returns (RiskAdmission memory admission);
    function publishObjectiveDefaultState(DefaultRiskProof calldata proof)
        external
        returns (ObjectiveDefaultState memory state);
}
