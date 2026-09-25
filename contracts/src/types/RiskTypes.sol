// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {AccountId, CollateralId, PositionId, RiskDomainId, SeriesId} from "./Identifiers.sol";
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
    AccountId accountId;
    RiskDomainId riskDomainId;
    uint32 riskDomainVersion;
    uint128 openInterestBaseUnits;
    uint128 terminalLiabilityBaseUnits;
    RiskAdmissionStatus status;
}
