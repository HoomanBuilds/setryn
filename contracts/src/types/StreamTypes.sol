// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Side} from "./Enums.sol";
import {AccountId, AssetId, FeeScheduleId, PackageId, RiskDomainId, SeriesId} from "./Identifiers.sol";
import {OrderTargetKind} from "./OrderTypes.sol";
import {Lots, PriceTicks} from "./Units.sol";

type StreamId is bytes32;

enum StreamPricingKind {
    Unspecified,
    AffineV1,
    LadderV1
}

struct StreamSizeBand {
    Lots minimumLots;
    Lots maximumLots;
    Lots lotStep;
}

struct StreamLadderLevel {
    Lots maximumLots;
    PriceTicks bidPriceTicks;
    PriceTicks askPriceTicks;
}

struct StreamPolicy {
    address maker;
    AccountId makerAccountId;
    bytes32 makerOrderHash;
    OrderTargetKind targetKind;
    SeriesId seriesId;
    PackageId packageId;
    uint32 targetVersion;
    bytes32 packageWitnessHash;
    Side makerSide;
    StreamPricingKind pricingKind;
    bytes32 sizeBandsHash;
    bytes32 ladderHash;
    PriceTicks baseBidPriceTicks;
    PriceTicks baseAskPriceTicks;
    int128 sizeSlopeTicksPerLot;
    int128 inventorySkewTicksPerLot;
    uint128 maximumAbsoluteInventoryLots;
    uint128 maximumAbsoluteSkewTicks;
    uint32 refreshInterval;
    uint32 quoteLifetime;
    uint64 validAfter;
    uint64 expiry;
    FeeScheduleId feeScheduleId;
    uint32 feeScheduleVersion;
    RiskDomainId riskDomainId;
    uint32 riskDomainVersion;
    AssetId collateralAssetId;
    uint32 collateralBindingVersion;
    uint128 maximumLiability;
    uint128 liabilityPerLot;
    uint64 capacityExpiry;
    bytes32 executionModeId;
    address permittedExecutor;
    bytes32 capacityPolicyHash;
    bytes32 capacityReservationId;
    uint256 nonce;
    bytes32 salt;
}

struct StreamFill {
    StreamId streamId;
    uint64 sequence;
    uint64 refreshedAt;
    uint64 quoteDeadline;
    bytes32 takerOrderHash;
    Lots fillLots;
    PriceTicks expectedPriceTicks;
    bytes32 fundingHash;
}

struct StreamCapacityConsumption {
    int128 inventoryBeforeLots;
    int128 inventoryAfterLots;
    uint128 liabilityConsumed;
    bytes32 consumptionHash;
}
