// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {
    AccountId,
    AssetId,
    CollateralId,
    CollateralLockId,
    FeeScheduleId,
    PackageId,
    RiskDomainId,
    SeriesId
} from "./Identifiers.sol";
import {RemainderPolicy} from "./OrderTypes.sol";
import {Lots, PriceTicks} from "./Units.sol";

type RfqId is bytes32;
type MakerQuoteId is bytes32;

enum RfqTargetKind {
    Unspecified,
    Series,
    Package
}

enum RfqSidePolicy {
    Unspecified,
    BuyOnly,
    SellOnly,
    TwoWay
}

enum RfqStatus {
    Unspecified,
    Inviting,
    Collecting,
    SelectionLocked,
    CapacityReserved,
    Authorized,
    Submitted,
    Clearing,
    Settled,
    Cancelled,
    Expired,
    Rejected
}

enum MakerQuoteStatus {
    Unspecified,
    Offered,
    Reserved,
    Selected,
    Consumed,
    Cancelled,
    Expired,
    Rejected
}

enum FirmCapacityStatus {
    Unspecified,
    Active,
    Released,
    Expired,
    Consumed
}

struct PrivateRfqRequest {
    address taker;
    AccountId takerAccountId;
    bytes32 takerOrderHash;
    RfqTargetKind targetKind;
    SeriesId seriesId;
    PackageId packageId;
    uint32 targetVersion;
    bool hasPackageLegCommitment;
    bytes32 packageLegsHash;
    RfqSidePolicy sidePolicy;
    Lots lots;
    bool allowPartialFills;
    Lots minimumFillLots;
    RemainderPolicy remainderPolicy;
    FeeScheduleId feeScheduleId;
    uint32 feeScheduleVersion;
    uint128 maxFeeMinor;
    RiskDomainId riskDomainId;
    uint32 riskDomainVersion;
    bytes32 privacyModeId;
    bytes32 executionModeId;
    bytes32 disclosurePolicyHash;
    bytes32 eligibleMakerSetHash;
    uint64 deadline;
    address permittedExecutor;
    uint256 nonce;
    bytes32 salt;
}

struct MakerQuote {
    RfqId rfqId;
    address maker;
    AccountId makerAccountId;
    AccountId takerAccountId;
    bytes32 makerOrderHash;
    RfqTargetKind targetKind;
    SeriesId seriesId;
    PackageId packageId;
    uint32 targetVersion;
    bool hasPackageLegCommitment;
    bytes32 packageLegsHash;
    RfqSidePolicy sidePolicy;
    Lots lots;
    bool allowPartialFills;
    Lots minimumFillLots;
    RemainderPolicy remainderPolicy;
    PriceTicks bidPriceTicks;
    PriceTicks askPriceTicks;
    FeeScheduleId feeScheduleId;
    uint32 feeScheduleVersion;
    uint128 maxFeeMinor;
    RiskDomainId riskDomainId;
    uint32 riskDomainVersion;
    AssetId collateralAssetId;
    uint32 collateralBindingVersion;
    uint128 maximumLiability;
    bytes32 privacyModeId;
    bytes32 executionModeId;
    bytes32 disclosurePolicyHash;
    bytes32 eligibleMakerSetHash;
    uint64 deadline;
    uint64 capacityExpiry;
    address permittedExecutor;
    uint256 nonce;
    bytes32 salt;
}

struct RfqSelectionAuthorization {
    RfqId rfqId;
    MakerQuoteId quoteId;
    address taker;
    address executor;
    uint256 nonce;
    uint64 deadline;
    bytes32 salt;
}

struct CapacityCancelAuthorization {
    MakerQuoteId quoteId;
    address maker;
    uint256 nonce;
    uint64 deadline;
    bytes32 salt;
}

struct RfqRecord {
    PrivateRfqRequest request;
    MakerQuoteId selectedQuoteId;
    RfqStatus status;
    Lots cumulativeFilledLots;
    uint64 registeredAt;
}

struct MakerQuoteRecord {
    MakerQuote quote;
    MakerQuoteStatus status;
    Lots cumulativeFilledLots;
    uint64 offeredAt;
}

struct FirmCapacityRecord {
    MakerQuoteId quoteId;
    address maker;
    AccountId makerAccountId;
    CollateralId collateralId;
    CollateralLockId lockId;
    RiskDomainId riskDomainId;
    uint32 riskDomainVersion;
    uint64 expiry;
    FirmCapacityStatus status;
    uint128 initialLiability;
    uint128 remainingLiability;
}

struct ClearingHandoff {
    RfqId rfqId;
    MakerQuoteId quoteId;
    CollateralLockId makerLockId;
    AccountId makerAccountId;
    AccountId takerAccountId;
    Lots fillLots;
    uint128 liabilityAmount;
    PriceTicks bidPriceTicks;
    PriceTicks askPriceTicks;
    bytes32 executionReference;
}
