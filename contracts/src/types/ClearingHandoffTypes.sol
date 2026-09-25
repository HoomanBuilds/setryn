// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {ClearingFeeFunding} from "./ClearingTypes.sol";
import {PackageLeg} from "./PackageDefinition.sol";
import {CollateralLockId, FeeScheduleId, RiskDomainId, TerminalLiabilityReservationId} from "./Identifiers.sol";
import {Lots, PriceTicks} from "./Units.sol";

enum ClearingHandoffKind {
    Unspecified,
    PrivateRfq,
    SealedAuction
}

enum CapacityDispositionKind {
    Unspecified,
    ConvertedToTerminalLiability,
    ConsumedAsSignedObligation,
    ReleasedBySignedLifecycle
}

struct ClearingHandoffClaim {
    ClearingHandoffKind kind;
    bytes32 consumptionId;
    bytes32 sourceId;
    uint32 sourceVersion;
    bytes32 sourceCommitment;
    bytes32 takerOrderHash;
    bytes32 makerOrderHash;
    bytes32 selectedQuoteOrRouteId;
    bytes32 packageWitnessHash;
    PackageLeg[] packageLegs;
    Lots fillLots;
    PriceTicks executionPriceTicks;
    FeeScheduleId feeScheduleId;
    uint32 feeScheduleVersion;
    ClearingFeeFunding makerFeeFunding;
    ClearingFeeFunding takerFeeFunding;
    RiskDomainId riskDomainId;
    uint32 riskDomainVersion;
    bytes32 executionModeId;
    uint64 deadline;
}

struct CapacityReservationDisposition {
    CollateralLockId capacityLockId;
    uint128 capacityAmount;
    CapacityDispositionKind capacityDisposition;
    TerminalLiabilityReservationId reservationId;
    bytes32 unusedRemainderLifecycleHash;
}

struct VerifiedClearingHandoff {
    ClearingHandoffClaim claim;
    CapacityReservationDisposition[] capacityDispositions;
    bytes32 provenanceHash;
}
