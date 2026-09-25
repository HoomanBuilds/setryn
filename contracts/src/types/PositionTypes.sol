// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {
    AccountId,
    AdapterId,
    AssetId,
    CollateralLockId,
    FeeScheduleId,
    InstrumentId,
    MarketId,
    PackageId,
    PositionId,
    RiskDomainId,
    SeriesId,
    TerminalLiabilityReservationId
} from "./Identifiers.sol";
import {Lots, PriceTicks} from "./Units.sol";

enum PositionStatus {
    Unspecified,
    Live,
    Fixing,
    SettlementReady,
    Settled,
    ClosedByUnwind,
    Replaced,
    Lapsed,
    CancelledByDisruption,
    Defaulted,
    TerminalClaim
}

enum PositionLiabilitySide {
    Unspecified,
    Long,
    Short
}

struct PositionFunding {
    CollateralLockId lockId;
    bytes32 lockReference;
    uint128 expectedRemainingAmount;
    uint64 expectedExpiry;
}

struct PositionCreation {
    bytes32 fillIdentity;
    SeriesId seriesId;
    uint32 seriesVersion;
    AccountId longAccountId;
    AccountId shortAccountId;
    uint32 ordinal;
    Lots lots;
    PriceTicks entryPriceTicks;
    PositionFunding longFunding;
    PositionFunding shortFunding;
    bytes payoffTerms;
}

struct PositionProvenance {
    PackageId packageId;
    uint32 packageVersion;
    uint32 packageOrdinal;
    bytes32 packageProvenanceHash;
}

struct PositionEconomics {
    PositionId positionId;
    bytes32 fillIdentity;
    SeriesId seriesId;
    bytes32 seriesVersionHash;
    MarketId marketId;
    InstrumentId instrumentId;
    AccountId longAccountId;
    AccountId shortAccountId;
    AdapterId payoffModuleId;
    address payoffModule;
    bytes32 payoffModuleCodeHash;
    AssetId settlementAssetId;
    RiskDomainId riskDomainId;
    FeeScheduleId feeScheduleId;
    bytes32 payoffTermsHash;
    bytes32 fixingSlotsHash;
    uint32 seriesVersion;
    uint32 marketVersion;
    uint32 instrumentVersion;
    uint32 payoffModuleVersion;
    uint32 settlementAssetVersion;
    uint32 riskDomainVersion;
    uint32 feeScheduleVersion;
    uint32 ordinal;
    uint64 fixingWindowOpen;
    uint64 finalResolutionAt;
    uint64 settlementDeadline;
    uint64 maxEvaluationGas;
    Lots lots;
    Lots originalLots;
    PriceTicks entryPriceTicks;
    uint128 maxLongDebitMinorPerLot;
    uint128 maxShortDebitMinorPerLot;
    uint128 maxLongDebitMinor;
    uint128 maxShortDebitMinor;
    int256 terminalDisruptionTransferMinorPerLot;
    bytes32 longLiabilityKey;
    bytes32 shortLiabilityKey;
    TerminalLiabilityReservationId longReservationId;
    TerminalLiabilityReservationId shortReservationId;
    PackageId packageId;
    uint32 packageVersion;
    uint32 packageOrdinal;
    bytes32 packageProvenanceHash;
}

struct PositionLifecycle {
    PositionStatus status;
    bytes32 finalFixingReference;
    bytes32 finalFixingsHash;
    bytes32 terminalOutcomeReference;
    int256 terminalTransferMinor;
    Lots remainingLots;
    Lots exercisedLots;
    Lots closedLots;
    AccountId lifecycleOwnerAccountId;
    uint64 ownerNonce;
    uint64 lifecycleNonce;
}
