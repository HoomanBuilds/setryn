// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {
    AccountId,
    CollateralId,
    ExercisePolicyId,
    FeeScheduleId,
    PositionId,
    RiskDomainId,
    SeriesId
} from "./Identifiers.sol";
import {Lots, PriceTicks} from "./Units.sol";
import {PositionExerciseState} from "./PositionTypes.sol";

type LifecycleActionId is bytes32;

enum LifecycleActionKind {
    Unspecified,
    Transfer,
    Assignment,
    PartialUnwind,
    FullUnwind,
    Split,
    Merge,
    Amendment,
    Novation,
    Roll,
    Exercise,
    Lapse,
    CollateralPolicyChange,
    CompressionHandoff,
    Abandon
}

enum LifecycleActionStatus {
    Unspecified,
    Authorized,
    Executing,
    Executed,
    Cancelled,
    Expired
}

struct LifecyclePositionSnapshot {
    PositionId positionId;
    bytes32 immutableHash;
    bytes32 lifecycleHash;
    SeriesId seriesId;
    uint32 seriesVersion;
    AccountId longAccountId;
    AccountId shortAccountId;
    RiskDomainId riskDomainId;
    uint32 riskDomainVersion;
    FeeScheduleId feeScheduleId;
    uint32 feeScheduleVersion;
    CollateralId collateralId;
    Lots positionLots;
    Lots remainingExerciseLots;
    PriceTicks entryPriceTicks;
    bytes32 economicsHash;
    bytes32 packageProvenanceHash;
    ExercisePolicyId exercisePolicyId;
    PositionExerciseState exerciseState;
    uint128 automaticExerciseThresholdMinor;
    uint64 expiryAt;
    uint64 exerciseOpensAt;
    uint64 exerciseCutoffAt;
    uint64 lapseEligibleAt;
    uint128 longTerminalLiabilityBaseUnits;
    uint128 shortTerminalLiabilityBaseUnits;
}

struct LifecycleInput {
    PositionId positionId;
    bytes32 expectedImmutableHash;
    bytes32 expectedLifecycleHash;
    Lots expectedPositionLots;
    Lots actionLots;
}

struct LifecycleSuccessor {
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
    bytes32 packageProvenanceHash;
    uint128 longTerminalLiabilityBaseUnits;
    uint128 shortTerminalLiabilityBaseUnits;
}

struct LifecycleCollateralReplacement {
    AccountId accountId;
    CollateralId collateralId;
    uint128 terminalLiabilityBaseUnits;
}

struct LifecycleAction {
    LifecycleActionKind kind;
    address actor;
    AccountId actorAccountId;
    bytes32 policyContextHash;
    bytes32 inputsHash;
    bytes32 successorsHash;
    bytes32 collateralReplacementsHash;
    bytes32 participantSetHash;
    bytes32 consentsHash;
    RiskDomainId riskDomainId;
    uint32 riskDomainVersion;
    FeeScheduleId feeScheduleId;
    uint32 feeScheduleVersion;
    bytes32 economicTransitionHash;
    bytes32 compressionPlanId;
    bool breaksPackageProvenance;
    bytes32 packageBreakPermissionHash;
    uint128 actorMaximumLiabilityIncreaseBaseUnits;
    uint128 actorMaximumCollateralIncreaseBaseUnits;
    uint16 inputCount;
    uint16 successorCount;
    uint16 participantCount;
    uint64 deadline;
    uint256 nonce;
    address permittedExecutor;
    bytes32 salt;
}

struct LifecycleConsent {
    LifecycleActionId actionId;
    AccountId accountId;
    address signer;
    uint256 nonce;
    uint64 deadline;
    uint128 maximumLiabilityIncreaseBaseUnits;
    uint128 maximumCollateralIncreaseBaseUnits;
    bool allowsPackageBreak;
    bytes32 salt;
}

struct LifecycleActionRecord {
    bytes32 actionHash;
    bytes32 executionOutcomeHash;
    LifecycleActionStatus status;
}
