// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {AccountId, CollateralId, CollateralLockId, PositionId, RiskDomainId} from "./Identifiers.sol";

type DefaultProcessId is bytes32;
type InsuranceDepositId is bytes32;
type InsuranceReservationId is bytes32;
type LiquidationBidId is bytes32;

enum DefaultProcessStatus {
    Unspecified,
    CureOpen,
    Cured,
    CommitOpen,
    RevealOpen,
    ReadyToClear,
    AuctionCleared,
    Resolved,
    TerminalResolved,
    RecoveryRequired
}

enum LiquidationBidStatus {
    Unspecified,
    Committed,
    Revealed,
    Winner,
    Loser,
    Unrevealed,
    Settled
}

enum InsuranceDepositStatus {
    Unspecified,
    Funded,
    Exhausted,
    Withdrawn
}

enum InsuranceReservationStatus {
    Unspecified,
    Reserved,
    Consumed,
    Released
}

struct DefaultProcessRules {
    uint32 maximumProofAgeSeconds;
    uint32 cureWindowSeconds;
    uint32 commitWindowSeconds;
    uint32 revealWindowSeconds;
    uint32 executionWindowSeconds;
    uint16 maximumBids;
    uint128 requiredBondMinor;
    uint128 minimumCapacityMinor;
    AccountId recoveryAccountId;
    bytes32 bidderQualificationHash;
    bytes32 scoringRuleId;
    bytes32 terminalRuleId;
}

struct InsurancePolicy {
    uint128 maximumDrawPerDefaultMinor;
    uint8 maximumDepositsPerDraw;
    AccountId insuranceAccountId;
    bytes32 allocationRuleId;
}

struct ObjectiveDefaultState {
    PositionId positionId;
    AccountId accountId;
    RiskDomainId riskDomainId;
    CollateralId collateralId;
    uint32 riskDomainVersion;
    uint64 evaluatedAt;
    uint64 finalResolutionAt;
    uint64 settlementDeadline;
    uint64 sequence;
    uint128 maintenanceRequirementMinor;
    uint128 collateralValueMinor;
    uint128 deficiencyMinor;
    uint128 availableCollateralMinor;
    bytes32 configurationHash;
    bytes32 witnessHash;
    bytes32 observationsHash;
    bytes32 stateHash;
}

struct DefaultProcess {
    DefaultProcessId processId;
    PositionId positionId;
    AccountId accountId;
    RiskDomainId riskDomainId;
    CollateralId collateralId;
    bytes32 defaultProcessHash;
    bytes32 insurancePolicyHash;
    bytes32 openingProofHash;
    bytes32 uncuredProofHash;
    bytes32 outcomeHash;
    uint32 riskDomainVersion;
    uint64 openedAt;
    uint64 cureEndsAt;
    uint64 commitEndsAt;
    uint64 revealEndsAt;
    uint64 executionEndsAt;
    uint64 finalResolutionAt;
    uint64 settlementDeadline;
    uint128 deficiencyMinor;
    uint128 lockedDefaulterCollateralMinor;
    uint128 takeoverContributionMinor;
    uint128 insuranceDrawMinor;
    uint128 terminalResidualMinor;
    uint64 openingRiskSequence;
    uint64 uncuredRiskSequence;
    DefaultProcessStatus status;
    LiquidationBidId winningBidId;
    InsuranceReservationId insuranceReservationId;
    CollateralLockId defaulterCollateralLockId;
    CollateralLockId cureCollateralLockId;
    uint128 cureCollateralMinor;
}

struct LiquidationBidReveal {
    DefaultProcessId processId;
    address bidder;
    AccountId bidderAccountId;
    uint128 takeoverContributionMinor;
    uint128 discountMinor;
    uint128 maximumInsuranceDrawMinor;
    bytes32 eligibilityEvidenceHash;
    bytes32 revealSalt;
}

struct LiquidationBidRecord {
    LiquidationBidId bidId;
    DefaultProcessId processId;
    address bidder;
    AccountId bidderAccountId;
    bytes32 sealedBidHash;
    bytes32 eligibilityEvidenceHash;
    CollateralLockId bondLockId;
    CollateralLockId capacityLockId;
    uint128 capacityMinor;
    uint128 takeoverContributionMinor;
    uint128 discountMinor;
    uint128 maximumInsuranceDrawMinor;
    LiquidationBidStatus status;
}

struct InsuranceDeposit {
    InsuranceDepositId depositId;
    AccountId funderAccountId;
    RiskDomainId riskDomainId;
    CollateralId collateralId;
    CollateralLockId lockId;
    bytes32 insurancePolicyHash;
    uint32 riskDomainVersion;
    uint64 expiry;
    uint128 fundedMinor;
    uint128 reservedMinor;
    uint128 consumedMinor;
    InsuranceDepositStatus status;
}

struct InsuranceReservationLine {
    InsuranceDepositId depositId;
    uint128 amountMinor;
}

struct InsuranceReservation {
    InsuranceReservationId reservationId;
    DefaultProcessId processId;
    uint128 amountMinor;
    InsuranceReservationStatus status;
    InsuranceReservationLine[] lines;
}

struct DefaultExecutionResult {
    bytes32 executionHash;
    bytes32 positionOutcomeReference;
    AccountId successorAccountId;
    uint128 defaulterCollateralAppliedMinor;
    uint128 takeoverContributionAppliedMinor;
    uint128 insuranceAppliedMinor;
    uint128 fullyBackedClaimMinor;
    uint128 unbackedClaimMinor;
}
