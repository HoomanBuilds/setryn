// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {MarketDefinitionLib} from "../../src/libraries/MarketDefinitionLib.sol";
import {
    AssetId,
    BenchmarkId,
    CalendarId,
    FeeScheduleId,
    MarketId,
    RiskDomainId,
    SessionId
} from "../../src/types/Identifiers.sol";
import {MarketDefinition} from "../../src/types/MarketDefinition.sol";
import {Lots, PriceTicks, TickSizeMinor} from "../../src/types/Units.sol";

contract MarketRegistryFuzzTest is Test {
    function testFuzz_ValidLotBoundsAndSignedPriceBoundsValidate(
        uint128 lotStep,
        uint128 minMultiplier,
        uint128 maxMultiplier,
        int128 firstPrice,
        int128 secondPrice
    ) public {
        lotStep = uint128(bound(lotStep, 1, 1e12));
        minMultiplier = uint128(bound(minMultiplier, 1, 1e6));
        maxMultiplier = uint128(bound(maxMultiplier, minMultiplier, 1e6));

        MarketDefinition memory definition = _definition();
        definition.lotStep = Lots.wrap(lotStep);
        definition.minOrderLots = Lots.wrap(lotStep * minMultiplier);
        definition.maxOrderLots = Lots.wrap(lotStep * maxMultiplier);
        definition.minPriceTicks = PriceTicks.wrap(firstPrice < secondPrice ? firstPrice : secondPrice);
        definition.maxPriceTicks = PriceTicks.wrap(firstPrice < secondPrice ? secondPrice : firstPrice);

        MarketDefinitionLib.validate(definition);
    }

    function testFuzz_LineageIgnoresVersionFieldsWhileDefinitionCommitsThem(
        uint128 tickSize,
        uint128 maximumLots,
        bytes32 evidenceHash,
        uint64 chainId
    ) public {
        tickSize = uint128(bound(tickSize, 1, type(uint128).max));
        maximumLots = uint128(bound(maximumLots, 1, type(uint128).max));
        if (evidenceHash == bytes32(0)) evidenceHash = bytes32(uint256(1));
        chainId = uint64(bound(chainId, 1, type(uint64).max));

        MarketDefinition memory baseline = _definition();
        MarketDefinition memory revised = baseline;
        revised.tickSizeMinor = TickSizeMinor.wrap(tickSize);
        revised.lotStep = Lots.wrap(1);
        revised.minOrderLots = Lots.wrap(1);
        revised.maxOrderLots = Lots.wrap(maximumLots);
        revised.qualificationEvidenceHash = evidenceHash;

        MarketId firstId = MarketDefinitionLib.deriveMarketId(baseline);
        MarketId secondId = MarketDefinitionLib.deriveMarketId(revised);
        assertEq(MarketId.unwrap(firstId), MarketId.unwrap(secondId));

        bytes32 firstHash = MarketDefinitionLib.hashDefinition(baseline, chainId);
        bytes32 secondHash = MarketDefinitionLib.hashDefinition(revised, chainId);
        if (
            TickSizeMinor.unwrap(revised.tickSizeMinor) != TickSizeMinor.unwrap(baseline.tickSizeMinor)
                || Lots.unwrap(revised.maxOrderLots) != Lots.unwrap(baseline.maxOrderLots)
                || revised.qualificationEvidenceHash != baseline.qualificationEvidenceHash
        ) assertTrue(firstHash != secondHash);
        assertEq(firstHash, MarketDefinitionLib.hashDefinition(baseline, chainId));
    }

    function testFuzz_DefinitionAndVersionHashesAreChainBound(uint64 firstChain, uint64 secondChain) public {
        firstChain = uint64(bound(firstChain, 1, type(uint64).max));
        secondChain = uint64(bound(secondChain, 1, type(uint64).max));
        vm.assume(firstChain != secondChain);

        MarketDefinition memory definition = _definition();
        MarketId marketId = MarketDefinitionLib.deriveMarketId(definition);
        bytes32 firstDefinitionHash = MarketDefinitionLib.hashDefinition(definition, firstChain);
        bytes32 secondDefinitionHash = MarketDefinitionLib.hashDefinition(definition, secondChain);

        assertTrue(firstDefinitionHash != secondDefinitionHash);
        assertTrue(
            MarketDefinitionLib.hashVersion(marketId, 1, firstDefinitionHash, firstChain)
                != MarketDefinitionLib.hashVersion(marketId, 1, secondDefinitionHash, secondChain)
        );
    }

    function _definition() private pure returns (MarketDefinition memory) {
        AssetId baseAssetId = AssetId.wrap(keccak256("base"));
        AssetId quoteAssetId = AssetId.wrap(keccak256("quote"));
        return MarketDefinition({
            namespaceId: keccak256("namespace"),
            marketKey: keccak256("market"),
            baseAssetId: baseAssetId,
            quoteAssetId: quoteAssetId,
            settlementAssetId: quoteAssetId,
            settlementAssetVersion: 1,
            markBenchmarkId: BenchmarkId.wrap(keccak256("benchmark")),
            markBenchmarkVersion: 1,
            tradingCalendarId: CalendarId.wrap(keccak256("calendar")),
            tradingCalendarVersion: 1,
            tradingSessionId: SessionId.wrap(keccak256("session")),
            tradingSessionVersion: 1,
            riskDomainId: RiskDomainId.wrap(keccak256("risk")),
            riskDomainVersion: 1,
            feeScheduleId: FeeScheduleId.wrap(keccak256("fee")),
            feeScheduleVersion: 1,
            quoteUnitId: MarketDefinitionLib.QUOTE_UNIT_SETTLEMENT_MINOR_PER_LOT,
            tickSizeMinor: TickSizeMinor.wrap(10),
            lotStep: Lots.wrap(1),
            minOrderLots: Lots.wrap(1),
            maxOrderLots: Lots.wrap(100),
            minPriceTicks: PriceTicks.wrap(type(int128).min),
            maxPriceTicks: PriceTicks.wrap(type(int128).max),
            executionModeSetHash: keccak256("modes"),
            qualificationEvidenceHash: keccak256("evidence")
        });
    }
}
