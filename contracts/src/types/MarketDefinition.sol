// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {RegistryStatus} from "./Enums.sol";
import {AssetId, BenchmarkId, CalendarId, FeeScheduleId, QuoteUnitId, RiskDomainId, SessionId} from "./Identifiers.sol";
import {Lots, PriceTicks, TickSizeMinor} from "./Units.sol";

struct MarketDefinition {
    bytes32 namespaceId;
    bytes32 marketKey;
    AssetId baseAssetId;
    AssetId quoteAssetId;
    AssetId settlementAssetId;
    uint32 settlementAssetVersion;
    BenchmarkId markBenchmarkId;
    uint32 markBenchmarkVersion;
    CalendarId tradingCalendarId;
    uint32 tradingCalendarVersion;
    SessionId tradingSessionId;
    uint32 tradingSessionVersion;
    RiskDomainId riskDomainId;
    uint32 riskDomainVersion;
    FeeScheduleId feeScheduleId;
    uint32 feeScheduleVersion;
    QuoteUnitId quoteUnitId;
    TickSizeMinor tickSizeMinor;
    Lots lotStep;
    Lots minOrderLots;
    Lots maxOrderLots;
    PriceTicks minPriceTicks;
    PriceTicks maxPriceTicks;
    bytes32 executionModeSetHash;
    bytes32 qualificationEvidenceHash;
}

struct MarketVersion {
    MarketDefinition definition;
    bytes32 definitionHash;
    bytes32 versionHash;
    uint32 version;
    RegistryStatus status;
}
