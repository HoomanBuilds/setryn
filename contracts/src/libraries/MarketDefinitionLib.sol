// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {MarketDefinition} from "../types/MarketDefinition.sol";
import {
    AssetId,
    BenchmarkId,
    CalendarId,
    FeeScheduleId,
    MarketId,
    QuoteUnitId,
    RiskDomainId,
    SessionId
} from "../types/Identifiers.sol";
import {Lots, PriceTicks, TickSizeMinor} from "../types/Units.sol";
import {IdLib} from "./IdLib.sol";

error ZeroMarketNamespaceId();
error ZeroMarketKey();
error ZeroMarketAssetId();
error IdenticalMarketAssets(AssetId assetId);
error SettlementAssetMustEqualQuoteAsset(AssetId quoteAssetId, AssetId settlementAssetId);
error ZeroMarketDependencyVersion();
error UnsupportedQuoteUnit(QuoteUnitId quoteUnitId);
error ZeroMarketTickSize();
error ZeroMarketLotBound();
error InvalidMarketLotBounds(Lots lotStep, Lots minOrderLots, Lots maxOrderLots);
error InvalidMarketPriceBounds(PriceTicks minPriceTicks, PriceTicks maxPriceTicks);
error ZeroExecutionModeSetHash();
error ZeroMarketQualificationEvidenceHash();

library MarketDefinitionLib {
    QuoteUnitId internal constant QUOTE_UNIT_SETTLEMENT_MINOR_PER_LOT =
        QuoteUnitId.wrap(keccak256("SetrynQuoteUnitV1:SettlementMinorPerLot"));

    string internal constant MARKET_KEY_TYPESTRING =
        "SetrynMarketKeyV1(bytes32 namespaceId,bytes32 marketKey,bytes32 baseAssetId,bytes32 quoteAssetId)";
    bytes32 internal constant MARKET_KEY_TYPEHASH =
        keccak256("SetrynMarketKeyV1(bytes32 namespaceId,bytes32 marketKey,bytes32 baseAssetId,bytes32 quoteAssetId)");

    string internal constant MARKET_DEFINITION_TYPESTRING =
        "SetrynMarketDefinitionV1(bytes32 namespaceId,bytes32 marketKey,bytes32 baseAssetId,bytes32 quoteAssetId,bytes32 settlementAssetId,uint32 settlementAssetVersion,bytes32 markBenchmarkId,uint32 markBenchmarkVersion,bytes32 tradingCalendarId,uint32 tradingCalendarVersion,bytes32 tradingSessionId,uint32 tradingSessionVersion,bytes32 riskDomainId,uint32 riskDomainVersion,bytes32 feeScheduleId,uint32 feeScheduleVersion,bytes32 quoteUnitId,uint128 tickSizeMinor,uint128 lotStep,uint128 minOrderLots,uint128 maxOrderLots,int128 minPriceTicks,int128 maxPriceTicks,bytes32 executionModeSetHash,bytes32 qualificationEvidenceHash,uint256 chainId)";
    bytes32 internal constant MARKET_DEFINITION_TYPEHASH = keccak256(
        "SetrynMarketDefinitionV1(bytes32 namespaceId,bytes32 marketKey,bytes32 baseAssetId,bytes32 quoteAssetId,bytes32 settlementAssetId,uint32 settlementAssetVersion,bytes32 markBenchmarkId,uint32 markBenchmarkVersion,bytes32 tradingCalendarId,uint32 tradingCalendarVersion,bytes32 tradingSessionId,uint32 tradingSessionVersion,bytes32 riskDomainId,uint32 riskDomainVersion,bytes32 feeScheduleId,uint32 feeScheduleVersion,bytes32 quoteUnitId,uint128 tickSizeMinor,uint128 lotStep,uint128 minOrderLots,uint128 maxOrderLots,int128 minPriceTicks,int128 maxPriceTicks,bytes32 executionModeSetHash,bytes32 qualificationEvidenceHash,uint256 chainId)"
    );

    string internal constant MARKET_VERSION_TYPESTRING =
        "SetrynMarketVersionV1(bytes32 marketId,uint32 version,bytes32 definitionHash,uint256 chainId)";
    bytes32 internal constant MARKET_VERSION_TYPEHASH =
        keccak256("SetrynMarketVersionV1(bytes32 marketId,uint32 version,bytes32 definitionHash,uint256 chainId)");

    function validate(MarketDefinition memory definition) internal pure {
        if (definition.namespaceId == bytes32(0)) revert ZeroMarketNamespaceId();
        if (definition.marketKey == bytes32(0)) revert ZeroMarketKey();
        if (
            AssetId.unwrap(definition.baseAssetId) == bytes32(0)
                || AssetId.unwrap(definition.quoteAssetId) == bytes32(0)
                || AssetId.unwrap(definition.settlementAssetId) == bytes32(0)
        ) revert ZeroMarketAssetId();
        if (AssetId.unwrap(definition.baseAssetId) == AssetId.unwrap(definition.quoteAssetId)) {
            revert IdenticalMarketAssets(definition.baseAssetId);
        }
        if (AssetId.unwrap(definition.quoteAssetId) != AssetId.unwrap(definition.settlementAssetId)) {
            revert SettlementAssetMustEqualQuoteAsset(definition.quoteAssetId, definition.settlementAssetId);
        }
        if (
            definition.settlementAssetVersion == 0 || BenchmarkId.unwrap(definition.markBenchmarkId) == bytes32(0)
                || definition.markBenchmarkVersion == 0 || CalendarId.unwrap(definition.tradingCalendarId) == bytes32(0)
                || definition.tradingCalendarVersion == 0 || SessionId.unwrap(definition.tradingSessionId) == bytes32(0)
                || definition.tradingSessionVersion == 0 || RiskDomainId.unwrap(definition.riskDomainId) == bytes32(0)
                || definition.riskDomainVersion == 0 || FeeScheduleId.unwrap(definition.feeScheduleId) == bytes32(0)
                || definition.feeScheduleVersion == 0
        ) revert ZeroMarketDependencyVersion();
        if (QuoteUnitId.unwrap(definition.quoteUnitId) != QuoteUnitId.unwrap(QUOTE_UNIT_SETTLEMENT_MINOR_PER_LOT)) {
            revert UnsupportedQuoteUnit(definition.quoteUnitId);
        }
        if (TickSizeMinor.unwrap(definition.tickSizeMinor) == 0) revert ZeroMarketTickSize();
        _validateLots(definition);
        if (PriceTicks.unwrap(definition.minPriceTicks) > PriceTicks.unwrap(definition.maxPriceTicks)) {
            revert InvalidMarketPriceBounds(definition.minPriceTicks, definition.maxPriceTicks);
        }
        if (definition.executionModeSetHash == bytes32(0)) revert ZeroExecutionModeSetHash();
        if (definition.qualificationEvidenceHash == bytes32(0)) revert ZeroMarketQualificationEvidenceHash();
    }

    function hashKey(MarketDefinition memory definition) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                MARKET_KEY_TYPEHASH,
                definition.namespaceId,
                definition.marketKey,
                AssetId.unwrap(definition.baseAssetId),
                AssetId.unwrap(definition.quoteAssetId)
            )
        );
    }

    function hashDefinition(MarketDefinition memory definition, uint256 chainId) internal pure returns (bytes32) {
        bytes memory first = abi.encode(
            MARKET_DEFINITION_TYPEHASH,
            definition.namespaceId,
            definition.marketKey,
            AssetId.unwrap(definition.baseAssetId),
            AssetId.unwrap(definition.quoteAssetId),
            AssetId.unwrap(definition.settlementAssetId),
            definition.settlementAssetVersion,
            BenchmarkId.unwrap(definition.markBenchmarkId),
            definition.markBenchmarkVersion,
            CalendarId.unwrap(definition.tradingCalendarId),
            definition.tradingCalendarVersion,
            SessionId.unwrap(definition.tradingSessionId),
            definition.tradingSessionVersion
        );
        bytes memory second = abi.encode(
            RiskDomainId.unwrap(definition.riskDomainId),
            definition.riskDomainVersion,
            FeeScheduleId.unwrap(definition.feeScheduleId),
            definition.feeScheduleVersion,
            QuoteUnitId.unwrap(definition.quoteUnitId),
            TickSizeMinor.unwrap(definition.tickSizeMinor),
            Lots.unwrap(definition.lotStep),
            Lots.unwrap(definition.minOrderLots),
            Lots.unwrap(definition.maxOrderLots),
            PriceTicks.unwrap(definition.minPriceTicks),
            PriceTicks.unwrap(definition.maxPriceTicks),
            definition.executionModeSetHash,
            definition.qualificationEvidenceHash,
            chainId
        );
        return keccak256(bytes.concat(first, second));
    }

    function hashVersion(MarketId marketId, uint32 version, bytes32 definitionHash, uint256 chainId)
        internal
        pure
        returns (bytes32)
    {
        return
            keccak256(abi.encode(MARKET_VERSION_TYPEHASH, MarketId.unwrap(marketId), version, definitionHash, chainId));
    }

    function deriveMarketId(MarketDefinition memory definition) internal pure returns (MarketId) {
        return IdLib.deriveMarketId(hashKey(definition));
    }

    function _validateLots(MarketDefinition memory definition) private pure {
        uint128 lotStep = Lots.unwrap(definition.lotStep);
        uint128 minimum = Lots.unwrap(definition.minOrderLots);
        uint128 maximum = Lots.unwrap(definition.maxOrderLots);
        if (lotStep == 0 || minimum == 0 || maximum == 0) revert ZeroMarketLotBound();
        if (minimum > maximum || minimum % lotStep != 0 || maximum % lotStep != 0) {
            revert InvalidMarketLotBounds(definition.lotStep, definition.minOrderLots, definition.maxOrderLots);
        }
    }
}
