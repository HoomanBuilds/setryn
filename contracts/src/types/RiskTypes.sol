// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {AccountId, CollateralId, PositionId, RiskDomainId, SeriesId} from "./Identifiers.sol";
import {PositionStatus} from "./PositionTypes.sol";
import {PriceTicks} from "./Units.sol";

type RiskAdmissionId is bytes32;

enum RiskAdmissionStatus {
    Unspecified,
    Reserved,
    Consumed,
    Released
}

struct PortfolioPositionWitness {
    PositionId positionId;
    SeriesId seriesId;
    uint32 seriesVersion;
    int128 signedLots;
    PriceTicks entryPriceTicks;
    uint128 maximumTerminalLiabilityBaseUnits;
    bytes32 economicsHash;
}

struct RiskObservation {
    bytes32 observationKey;
    bytes32 valueHash;
    uint64 observedAt;
}

struct RiskEvaluationContext {
    AccountId accountId;
    RiskDomainId riskDomainId;
    uint32 riskDomainVersion;
    CollateralId collateralId;
    bytes32 domainDefinitionHash;
    bytes32 riskModelId;
    bytes32 marginRulesHash;
    bytes32 scenarioSetHash;
    bytes32 concentrationRulesHash;
    uint128 collateralTotalBaseUnits;
    uint128 collateralLockedBaseUnits;
    uint128 collateralAvailableBaseUnits;
    uint128 currentOpenInterestBaseUnits;
    uint128 requestedOpenInterestBaseUnits;
    uint128 currentAccountTerminalLiabilityBaseUnits;
    uint128 requestedAccountTerminalLiabilityBaseUnits;
    uint128 currentAggregateTerminalLiabilityBaseUnits;
    uint128 requestedAggregateTerminalLiabilityBaseUnits;
}

struct PortfolioRiskMetrics {
    uint128 initialMarginBaseUnits;
    uint128 maintenanceMarginBaseUnits;
    uint128 stressLossBaseUnits;
    uint128 concentrationBaseUnits;
    uint128 openInterestBaseUnits;
    uint128 accountTerminalLiabilityBaseUnits;
    uint128 aggregateTerminalLiabilityBaseUnits;
    int256 liquidationDistanceBaseUnits;
    uint128 availableHeadroomBaseUnits;
}

struct PortfolioRiskResult {
    bytes32 configurationHash;
    bytes32 witnessHash;
    bytes32 observationsHash;
    PortfolioRiskMetrics metrics;
}

struct RiskAdmissionRequest {
    AccountId accountId;
    RiskDomainId riskDomainId;
    uint32 riskDomainVersion;
    uint128 openInterestIncreaseBaseUnits;
    uint128 terminalLiabilityIncreaseBaseUnits;
    uint64 deadline;
    uint256 nonce;
    bytes32 salt;
}

struct RiskAdmission {
    bytes32 requestHash;
    bytes32 resultHash;
    bytes32 reservedResultCommitment;
    AccountId accountId;
    RiskDomainId riskDomainId;
    uint32 riskDomainVersion;
    uint128 openInterestBaseUnits;
    uint128 terminalLiabilityBaseUnits;
    uint128 remainingOpenInterestBaseUnits;
    uint128 remainingTerminalLiabilityBaseUnits;
    uint64 deadline;
    RiskAdmissionStatus status;
}

struct RiskAdmissionConsumption {
    RiskAdmissionId admissionId;
    bytes32 expectedResultHash;
    AccountId expectedAccountId;
    RiskDomainId expectedRiskDomainId;
    uint32 expectedRiskDomainVersion;
    uint128 expectedOpenInterestBaseUnits;
    uint128 expectedTerminalLiabilityBaseUnits;
    uint16 expectedPositionCount;
    bytes32 executionReference;
}

struct PositionRiskSnapshot {
    PortfolioPositionWitness witness;
    AccountId accountId;
    RiskDomainId riskDomainId;
    uint32 riskDomainVersion;
    uint128 remainingLots;
    uint64 finalResolutionAt;
    uint64 settlementDeadline;
    uint64 lifecycleNonce;
    PositionStatus status;
    bytes32 terminalOutcomeReference;
    bytes32 stateHash;
}

struct PositionRiskExposure {
    bytes32 exposureId;
    RiskAdmissionId admissionId;
    AccountId accountId;
    RiskDomainId riskDomainId;
    uint32 riskDomainVersion;
    uint128 initialPositionLots;
    uint128 accountedPositionLots;
    uint128 initialOpenInterestBaseUnits;
    uint128 remainingOpenInterestBaseUnits;
    bytes32 positionsHash;
    uint16 positionCount;
}

struct RiskExposureReduction {
    bytes32 exposureId;
    PositionId canonicalPositionId;
    RiskAdmissionId admissionId;
    AccountId accountId;
    uint128 expectedPreviousPositionLots;
    uint128 expectedNewPositionLots;
    uint128 expectedOpenInterestReductionBaseUnits;
    bytes32 transitionId;
}

struct RiskAdmissionCancellation {
    RiskAdmissionId admissionId;
    bytes32 orderHash;
    AccountId accountId;
    address signer;
    uint256 nonce;
    uint64 deadline;
    bytes32 cancellationReference;
}

struct DefaultRiskProof {
    PositionId positionId;
    RiskAdmissionId admissionId;
    PortfolioPositionWitness[] positions;
    RiskObservation[] observations;
}
