// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {MarketDefinitionLib} from "../../src/libraries/MarketDefinitionLib.sol";
import {SeriesDefinitionLib} from "../../src/libraries/SeriesDefinitionLib.sol";
import {MarketId, SeriesId} from "../../src/types/Identifiers.sol";
import {MarketDefinition} from "../../src/types/MarketDefinition.sol";
import {SeriesDefinition} from "../../src/types/SeriesDefinition.sol";
import {FixtureMarketDependencies, SetrynDefinitionFixtures} from "./SetrynDefinitionFixtures.sol";
import {LocalSetrynFixture, SetrynLocalFixture} from "./SetrynLocalFixture.sol";

contract SetrynLocalFixtureTest is SetrynLocalFixture {
    function test_DeploysActiveRegistryGraphAndVault() public {
        LocalSetrynFixture memory fixture = _deployLocalFixture(keccak256("fixture.primary"));
        uint32 today = uint32(block.timestamp / 1 days);

        assertTrue(fixture.assetRegistry.isActive(fixture.baseAssetId));
        assertTrue(fixture.assetRegistry.isActive(fixture.settlementAssetId));
        assertTrue(fixture.adapterRegistry.isOpenForNewRisk(fixture.benchmarkAdapterId, 1));
        assertTrue(fixture.adapterRegistry.isOpenForNewRisk(fixture.riskAdapterId, 1));
        assertTrue(fixture.adapterRegistry.isOpenForNewRisk(fixture.payoffAdapterId, 1));
        assertTrue(fixture.calendarRegistry.isOpenForNewRisk(fixture.calendarId, 1, today));
        assertTrue(fixture.sessionRegistry.isOpenForNewRisk(fixture.sessionId, 1, today));
        assertTrue(fixture.settlementAssetRegistry.isOpenForNewRisk(fixture.settlementAssetId, 1));
        assertTrue(fixture.benchmarkRegistry.isOpenForNewRisk(fixture.benchmarkId, 1, today));
        assertTrue(fixture.feeScheduleRegistry.isOpenForNewRisk(fixture.feeScheduleId, 1));
        assertTrue(fixture.riskDomainRegistry.isOpenForNewRisk(fixture.riskDomainId, 1));
        assertTrue(fixture.instrumentRegistry.isOpenForNewRisk(fixture.instrumentId, 1));
        assertTrue(fixture.marketRegistry.isOpenForNewRisk(fixture.marketId, 1, today));
        assertTrue(fixture.seriesRegistry.exists(fixture.seriesId, 1));
        assertTrue(fixture.seriesRegistry.isLifecycleEnabled(fixture.seriesId, 1));

        assertEq(address(fixture.collateralVault.settlementAssetRegistry()), address(fixture.settlementAssetRegistry));
        assertEq(fixture.collateralVault.maxLockDuration(), 30 days);
        (uint128 total, uint128 locked, uint128 available) = fixture.collateralVault
            .balanceOf(
                fixture.traderAccountId, fixture.collateralVault.deriveCollateralId(fixture.settlementAssetId, 1)
            );
        assertEq(total, 1_000_000e6);
        assertEq(locked, 0);
        assertEq(available, total);
        assertTrue(fixture.collateralVault.isSolvent(address(fixture.settlementToken)));
        assertEq(
            SeriesId.unwrap(fixture.seriesId),
            SeriesId.unwrap(fixture.seriesRegistry.deriveSeriesId(fixture.seriesDefinition))
        );
    }

    function test_DifferentSeedsProduceDistinctMarketAndSeriesLineages() public {
        LocalSetrynFixture memory first = _deployLocalFixture(keccak256("fixture.first"));
        bytes32 secondSeed = keccak256("fixture.second");
        MarketDefinition memory secondMarketDefinition = SetrynDefinitionFixtures.market(
            secondSeed,
            FixtureMarketDependencies({
                baseAssetId: first.baseAssetId,
                quoteAssetId: first.settlementAssetId,
                settlementAssetVersion: 1,
                benchmarkId: first.benchmarkId,
                benchmarkVersion: 1,
                calendarId: first.calendarId,
                calendarVersion: 1,
                sessionId: first.sessionId,
                sessionVersion: 1,
                riskDomainId: first.riskDomainId,
                riskDomainVersion: 1,
                feeScheduleId: first.feeScheduleId,
                feeScheduleVersion: 1
            })
        );
        MarketId secondMarketId = MarketDefinitionLib.deriveMarketId(secondMarketDefinition);
        SeriesDefinition memory secondSeriesDefinition = SetrynDefinitionFixtures.series(
            secondSeed,
            secondMarketId,
            1,
            first.instrumentId,
            1,
            SetrynDefinitionFixtures.datedSchedule(uint64(block.timestamp + 1 days))
        );
        SeriesId secondSeriesId = SeriesDefinitionLib.deriveSeriesId(secondSeriesDefinition);

        assertTrue(MarketId.unwrap(first.marketId) != MarketId.unwrap(secondMarketId));
        assertTrue(SeriesId.unwrap(first.seriesId) != SeriesId.unwrap(secondSeriesId));
    }
}
