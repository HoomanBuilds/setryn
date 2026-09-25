// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {RegistryStatus} from "./Enums.sol";
import {AssetId, PackageId, QuoteUnitId, SeriesId} from "./Identifiers.sol";
import {Lots, PriceTicks, TickSizeMinor} from "./Units.sol";

struct PackageLeg {
    SeriesId seriesId;
    uint32 seriesVersion;
    int32 ratio;
}

struct PackageDefinition {
    bytes32 namespaceId;
    bytes32 packageKey;
    AssetId settlementAssetId;
    uint32 settlementAssetVersion;
    bytes32 legsHash;
    QuoteUnitId quoteUnitId;
    TickSizeMinor tickSizeMinor;
    Lots lotStep;
    Lots minOrderLots;
    Lots maxOrderLots;
    PriceTicks minPriceTicks;
    PriceTicks maxPriceTicks;
    uint128 maxLongDebitMinorPerPackageLot;
    uint128 maxShortDebitMinorPerPackageLot;
    bytes32 lifecyclePolicyHash;
    bytes32 qualificationEvidenceHash;
}

struct PackageVersion {
    PackageDefinition definition;
    bytes32 definitionHash;
    bytes32 versionHash;
    uint32 version;
    RegistryStatus status;
}

