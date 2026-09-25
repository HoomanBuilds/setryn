// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {AccountId, CollateralId, PositionId, RiskDomainId, SeriesId} from "./Identifiers.sol";
import {Lots, PriceTicks} from "./Units.sol";

type CompressionPlanId is bytes32;

enum CompressionPlanStatus {
    Unspecified,
    Authorized,
    Executing,
    Executed,
    Cancelled,
    Expired
}

struct CompressionPosition {
    PositionId positionId;
    SeriesId seriesId;
    uint32 seriesVersion;
    AccountId longAccountId;
    AccountId shortAccountId;
    RiskDomainId riskDomainId;
    uint32 riskDomainVersion;
    CollateralId collateralId;
    Lots lots;
    PriceTicks entryPriceTicks;
    bytes32 economicsHash;
    uint128 longTerminalLiabilityBaseUnits;
    uint128 shortTerminalLiabilityBaseUnits;
    bytes32 lifecycleHash;
}

struct CompressionSuccessor {
    bytes32 successorKey;
    SeriesId seriesId;
    uint32 seriesVersion;
    AccountId longAccountId;
    AccountId shortAccountId;
    RiskDomainId riskDomainId;
    uint32 riskDomainVersion;
    CollateralId collateralId;
    Lots lots;
    PriceTicks entryPriceTicks;
    bytes32 economicsHash;
    uint128 longTerminalLiabilityBaseUnits;
    uint128 shortTerminalLiabilityBaseUnits;
}

struct ReplacementCollateral {
    AccountId accountId;
    CollateralId collateralId;
    uint128 terminalLiabilityBaseUnits;
}

struct CompressionConsent {
    CompressionPlanId planId;
    AccountId accountId;
    address signer;
    uint256 nonce;
    uint64 deadline;
    uint128 maximumLiabilityIncreaseBaseUnits;
    uint128 maximumPayoffReductionBaseUnits;
    bytes32 salt;
}

struct CompressionPlanDefinition {
    bytes32 namespaceId;
    bytes32 planNonce;
    RiskDomainId riskDomainId;
    uint32 riskDomainVersion;
    CollateralId collateralId;
    bytes32 inputsHash;
    bytes32 successorsHash;
    bytes32 replacementCollateralHash;
    uint16 inputCount;
    uint16 successorCount;
    uint16 accountCount;
    uint64 deadline;
    bytes32 qualificationHash;
}

struct CompressionPlanRecord {
    bytes32 definitionHash;
    bytes32 executionOutcomeHash;
    CompressionPlanStatus status;
}
