// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Side} from "./Enums.sol";
import {AccountId, FeeScheduleId, PackageId, SeriesId} from "./Identifiers.sol";
import {Lots, PriceTicks} from "./Units.sol";

enum OrderTargetKind {
    Unspecified,
    Series,
    Package
}

enum TimeInForce {
    Unspecified,
    GTC,
    GTD,
    IOC,
    FOK
}

enum RemainderPolicy {
    Unspecified,
    KeepOpen,
    CancelRemainder
}

enum OrderStatus {
    Unspecified,
    Open,
    PartiallyFilled,
    Filled,
    Cancelled,
    Expired,
    Rejected
}

type OrderActionId is bytes32;

struct PublicOrder {
    address signer;
    AccountId accountId;
    bytes32 policyId;
    bytes32 policyContextHash;
    OrderActionId actionId;
    OrderTargetKind targetKind;
    SeriesId seriesId;
    PackageId packageId;
    uint32 targetVersion;
    Side side;
    Lots lots;
    PriceTicks priceTicks;
    TimeInForce timeInForce;
    uint64 deadline;
    bytes32 executionModeId;
    FeeScheduleId feeScheduleId;
    uint32 feeScheduleVersion;
    uint128 maxFeeMinor;
    address recipient;
    address permittedExecutor;
    uint256 nonce;
    bytes32 salt;
    bool allowPartialFills;
    Lots minimumFillLots;
    RemainderPolicy remainderPolicy;
    bool postOnly;
    bool reduceOnly;
}

struct OrderRecord {
    PublicOrder order;
    Lots filledLots;
    OrderStatus status;
    uint64 registeredAt;
}
