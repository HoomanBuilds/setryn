// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {AccountId, AssetId, CollateralLockId, FeeScheduleId, FillId} from "./Identifiers.sol";
import {PackageLeg} from "./PackageDefinition.sol";
import {Lots, PriceTicks} from "./Units.sol";

enum ClearingEntryKind {
    Unspecified,
    Consideration,
    MakerFee,
    TakerFee
}

enum ClearingChannelKind {
    Unspecified,
    Direct,
    PrivateRfq,
    SealedAuction
}

struct OrderFunding {
    CollateralLockId terminalLiabilityLockId;
    CollateralLockId considerationLockId;
}

struct ClearingFeeFunding {
    bytes32 consumptionId;
    CollateralLockId chargeLockId;
    CollateralLockId budgetLockId;
}

struct BilateralMatch {
    bytes32 takerOrderHash;
    bytes32 makerOrderHash;
    Lots fillLots;
    PriceTicks executionPriceTicks;
    OrderFunding takerFunding;
    OrderFunding makerFunding;
    ClearingFeeFunding takerFeeFunding;
    ClearingFeeFunding makerFeeFunding;
}

struct SeriesClearingRequest {
    BilateralMatch matchData;
    bytes payoffTerms;
    ClearingChannelKind channelKind;
}

struct PackageClearingRequest {
    BilateralMatch matchData;
    PackageLeg[] legs;
    PriceTicks[] legEntryPriceTicks;
    bytes[] legPayoffTerms;
    ClearingChannelKind channelKind;
}

struct ClearingFeeQuote {
    AccountId recipientAccountId;
    FeeScheduleId feeScheduleId;
    uint32 feeScheduleVersion;
    uint128 makerFeeMinor;
    uint128 takerFeeMinor;
    bytes32 quoteReference;
}

struct ClearingAdmission {
    bytes32 takerOrderHash;
    bytes32 makerOrderHash;
    bytes32 targetId;
    bytes32 witnessHash;
    bytes32 executionModeId;
    address submitter;
    uint32 targetVersion;
    Lots fillLots;
    PriceTicks executionPriceTicks;
    bool isPackage;
}

struct FillRecord {
    FillId fillId;
    bytes32 takerOrderHash;
    bytes32 makerOrderHash;
    bytes32 targetId;
    bytes32 witnessHash;
    bytes32 executionModeId;
    bytes32 channelConsumptionId;
    bytes32 routeCommitment;
    address channelSource;
    ClearingChannelKind channelKind;
    AssetId settlementAssetId;
    AccountId buyerAccountId;
    AccountId sellerAccountId;
    bytes32 makerFeeResultHash;
    bytes32 takerFeeResultHash;
    uint32 targetVersion;
    uint32 settlementAssetVersion;
    uint64 clearedAt;
    Lots fillLots;
    Lots takerCumulativeLots;
    Lots makerCumulativeLots;
    PriceTicks executionPriceTicks;
    int256 considerationMinor;
    uint128 makerFeeChargeMinor;
    uint128 makerFeeRebateMinor;
    uint128 takerFeeChargeMinor;
    uint128 takerFeeRebateMinor;
    uint16 positionCount;
    bool isPackage;
}
