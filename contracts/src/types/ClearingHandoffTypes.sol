// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {ClearingFeeFunding} from "./ClearingTypes.sol";
import {Side} from "./Enums.sol";
import {PackageLeg} from "./PackageDefinition.sol";
import {
    AccountId,
    FeeScheduleId,
    PackageId,
    RiskDomainId,
    SeriesId,
    TerminalLiabilityReservationId
} from "./Identifiers.sol";
import {OrderTargetKind} from "./OrderTypes.sol";
import {PositionFunding, PositionLiabilitySide} from "./PositionTypes.sol";
import {Lots, PriceTicks} from "./Units.sol";
import {RiskAdmissionId} from "./RiskTypes.sol";

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

enum UnusedCapacityPolicy {
    Unspecified,
    KeepLocked,
    ReleaseOnTerminalFill,
    ReleaseAtExpiry
}

struct CapacityReservationDisposition {
    uint32 positionOrdinal;
    PositionLiabilitySide side;
    AccountId accountId;
    PositionFunding funding;
    uint128 reservationAmount;
    CapacityDispositionKind capacityDisposition;
    TerminalLiabilityReservationId reservationId;
    UnusedCapacityPolicy unusedCapacityPolicy;
}

struct ClearingHandoffClaim {
    ClearingHandoffKind kind;
    bytes32 consumptionId;
    bytes32 sourceId;
    uint32 sourceVersion;
    bytes32 sourceCommitment;
    bytes32 takerOrderHash;
    bytes32 makerOrderHash;
    AccountId takerAccountId;
    AccountId makerAccountId;
    Side takerSide;
    OrderTargetKind targetKind;
    SeriesId seriesId;
    PackageId packageId;
    uint32 targetVersion;
    bytes32 selectedQuoteOrRouteId;
    bytes32 packageWitnessHash;
    PackageLeg[] packageLegs;
    Lots fillLots;
    PriceTicks executionPriceTicks;
    FeeScheduleId feeScheduleId;
    uint32 feeScheduleVersion;
    uint128 takerMaximumFeeMinor;
    uint128 makerMaximumFeeMinor;
    ClearingFeeFunding makerFeeFunding;
    ClearingFeeFunding takerFeeFunding;
    RiskDomainId riskDomainId;
    uint32 riskDomainVersion;
    bytes32 executionModeId;
    RiskAdmissionId longAdmissionId;
    bytes32 longAdmissionResultHash;
    RiskAdmissionId shortAdmissionId;
    bytes32 shortAdmissionResultHash;
    uint64 deadline;
    CapacityReservationDisposition[] capacityDispositions;
}

struct VerifiedClearingHandoff {
    ClearingHandoffClaim claim;
    bytes32 provenanceHash;
}
