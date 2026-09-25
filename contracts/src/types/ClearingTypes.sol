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

struct OrderFunding {
    CollateralLockId terminalLiabilityLockId;
    CollateralLockId considerationLockId;
    CollateralLockId feeLockId;
}

struct BilateralMatch {
    bytes32 takerOrderHash;
    bytes32 makerOrderHash;
    Lots fillLots;
    PriceTicks executionPriceTicks;
    OrderFunding takerFunding;
    OrderFunding makerFunding;
}

struct SeriesClearingRequest {
    BilateralMatch matchData;
    bytes payoffTerms;
}

struct PackageClearingRequest {
    BilateralMatch matchData;
    PackageLeg[] legs;
    PriceTicks[] legEntryPriceTicks;
    bytes[] legPayoffTerms;
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
    AssetId settlementAssetId;
    AccountId buyerAccountId;
    AccountId sellerAccountId;
    AccountId feeRecipientAccountId;
    bytes32 feeQuoteReference;
    uint32 targetVersion;
    uint32 settlementAssetVersion;
    uint64 clearedAt;
    Lots fillLots;
    Lots takerCumulativeLots;
    Lots makerCumulativeLots;
    PriceTicks executionPriceTicks;
    int256 considerationMinor;
    uint128 makerFeeMinor;
    uint128 takerFeeMinor;
    uint16 positionCount;
    bool isPackage;
}
