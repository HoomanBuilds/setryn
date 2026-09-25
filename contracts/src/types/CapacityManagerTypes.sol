// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {AccountId, AssetId, CollateralId, CollateralLockId, FillId, RiskDomainId} from "./Identifiers.sol";
import {StreamId} from "./StreamTypes.sol";

enum ManagedCapacityStatus {
    Unspecified,
    Active,
    Exhausted,
    Released,
    Expired
}

struct ManagedCapacity {
    address owner;
    AccountId accountId;
    AssetId collateralAssetId;
    CollateralId collateralId;
    RiskDomainId riskDomainId;
    CollateralLockId lockId;
    bytes32 lockReference;
    uint32 collateralBindingVersion;
    uint32 riskDomainVersion;
    uint64 expiry;
    ManagedCapacityStatus status;
    uint128 initialLiability;
    uint128 remainingLiability;
}

struct StreamCapacityState {
    ManagedCapacity capacity;
    StreamId streamId;
    uint64 consumedSequence;
    int128 inventoryLots;
}

struct CapacityConsumptionRecord {
    bytes32 capacityId;
    bytes32 consumptionHash;
    FillId fillId;
    uint64 sequence;
    uint128 liabilityConsumed;
    uint128 remainingLiability;
    bool finalized;
}
