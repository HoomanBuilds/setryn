// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {CollateralVault} from "../../src/collateral/CollateralVault.sol";
import {IAdapterRegistry} from "../../src/interfaces/IAdapterRegistry.sol";
import {IAssetRegistry} from "../../src/interfaces/IAssetRegistry.sol";
import {IBenchmarkRegistry} from "../../src/interfaces/IBenchmarkRegistry.sol";
import {ICalendarRegistry} from "../../src/interfaces/ICalendarRegistry.sol";
import {ICollateralVault} from "../../src/interfaces/ICollateralVault.sol";
import {IFeeScheduleRegistry} from "../../src/interfaces/IFeeScheduleRegistry.sol";
import {IRiskDomainRegistry} from "../../src/interfaces/IRiskDomainRegistry.sol";
import {ISeriesPayoffModuleV1} from "../../src/interfaces/ISeriesPayoffModuleV1.sol";
import {IInstrumentRegistry} from "../../src/interfaces/IInstrumentRegistry.sol";
import {IMarketRegistry} from "../../src/interfaces/IMarketRegistry.sol";
import {ISessionRegistry} from "../../src/interfaces/ISessionRegistry.sol";
import {ISettlementAssetRegistry} from "../../src/interfaces/ISettlementAssetRegistry.sol";
import {AdapterDefinitionLib} from "../../src/libraries/AdapterDefinitionLib.sol";
import {CalendarDefinitionLib} from "../../src/libraries/CalendarDefinitionLib.sol";
import {AdapterRegistry} from "../../src/registry/AdapterRegistry.sol";
import {AssetRegistry} from "../../src/registry/AssetRegistry.sol";
import {BenchmarkRegistry} from "../../src/registry/BenchmarkRegistry.sol";
import {CalendarRegistry} from "../../src/registry/CalendarRegistry.sol";
import {FeeScheduleRegistry} from "../../src/registry/FeeScheduleRegistry.sol";
import {InstrumentRegistry} from "../../src/registry/InstrumentRegistry.sol";
import {MarketRegistry} from "../../src/registry/MarketRegistry.sol";
import {RiskDomainRegistry} from "../../src/registry/RiskDomainRegistry.sol";
import {SeriesRegistry} from "../../src/registry/SeriesRegistry.sol";
import {SessionRegistry} from "../../src/registry/SessionRegistry.sol";
import {SettlementAssetRegistry} from "../../src/registry/SettlementAssetRegistry.sol";
import {CalendarDefinition} from "../../src/types/CalendarDefinition.sol";
import {AssetClass} from "../../src/types/Enums.sol";
import {
    AdapterId,
    AccountId,
    AssetId,
    BenchmarkId,
    CalendarId,
    FeeScheduleId,
    InstrumentId,
    MarketId,
    PayoffFamilyId,
    RiskDomainId,
    SeriesId,
    SessionId
} from "../../src/types/Identifiers.sol";
import {SeriesDefinition} from "../../src/types/SeriesDefinition.sol";
import {
    FixingSlot,
    SeriesPayoffValidation,
    SeriesQualificationData,
    SeriesValidationContext
} from "../../src/types/SeriesQualification.sol";
import {MockCollateralERC20} from "../mocks/CollateralTokenMocks.sol";
import {
    FixtureMarketDependencies,
    FixtureSeriesSchedule,
    FixtureVaultConfig,
    SetrynDefinitionFixtures
} from "./SetrynDefinitionFixtures.sol";

contract FixtureAdapterImplementation is ISeriesPayoffModuleV1 {
    PayoffFamilyId private immutable _payoffFamily;

    constructor(PayoffFamilyId payoffFamily_) {
        _payoffFamily = payoffFamily_;
    }

    function fixtureRevision() external pure returns (uint256) {
        return 1;
    }

    function payoffFamilyId() external view returns (PayoffFamilyId) {
        return _payoffFamily;
    }

    function validateSeries(SeriesValidationContext calldata, bytes calldata, FixingSlot[] calldata)
        external
        pure
        returns (SeriesPayoffValidation memory)
    {
        return SeriesPayoffValidation({
            maxLongDebitMinorPerLot: 100_000,
            maxShortDebitMinorPerLot: 100_000,
            terminalDisruptionTransferMinorPerLot: 0
        });
    }
}

struct LocalSetrynFixture {
    MockCollateralERC20 settlementToken;
    FixtureAdapterImplementation adapterImplementation;
    AssetRegistry assetRegistry;
    AdapterRegistry adapterRegistry;
    CalendarRegistry calendarRegistry;
    SessionRegistry sessionRegistry;
    SettlementAssetRegistry settlementAssetRegistry;
    BenchmarkRegistry benchmarkRegistry;
    FeeScheduleRegistry feeScheduleRegistry;
    RiskDomainRegistry riskDomainRegistry;
    InstrumentRegistry instrumentRegistry;
    MarketRegistry marketRegistry;
    SeriesRegistry seriesRegistry;
    CollateralVault collateralVault;
    AssetId baseAssetId;
    AssetId settlementAssetId;
    AdapterId benchmarkAdapterId;
    AdapterId riskAdapterId;
    AdapterId payoffAdapterId;
    CalendarId calendarId;
    SessionId sessionId;
    BenchmarkId benchmarkId;
    FeeScheduleId feeScheduleId;
    RiskDomainId riskDomainId;
    InstrumentId instrumentId;
    MarketId marketId;
    SeriesId seriesId;
    SeriesDefinition seriesDefinition;
    SeriesQualificationData seriesQualification;
    address trader;
    AccountId traderAccountId;
}

abstract contract SetrynLocalFixture is Test {
    function _deployLocalFixture(bytes32 seed) internal returns (LocalSetrynFixture memory fixture) {
        FixtureVaultConfig memory config = SetrynDefinitionFixtures.vaultConfig();
        address admin = address(this);
        uint32 today = uint32(block.timestamp / 1 days);
        FixtureSeriesSchedule memory schedule =
            SetrynDefinitionFixtures.datedSchedule(uint64((uint256(today) + 1) * 1 days + 1 hours));

        fixture.settlementToken = new MockCollateralERC20(6);
        fixture.adapterImplementation = new FixtureAdapterImplementation(SetrynDefinitionFixtures.payoffFamily(seed));

        fixture.assetRegistry = new AssetRegistry(config.defaultAdminDelay, admin);
        fixture.adapterRegistry = new AdapterRegistry(config.defaultAdminDelay, admin);
        fixture.calendarRegistry = new CalendarRegistry(config.defaultAdminDelay, admin);
        fixture.sessionRegistry =
            new SessionRegistry(config.defaultAdminDelay, admin, ICalendarRegistry(address(fixture.calendarRegistry)));
        fixture.settlementAssetRegistry = new SettlementAssetRegistry(
            config.defaultAdminDelay, admin, IAssetRegistry(address(fixture.assetRegistry))
        );

        _registerAssets(fixture, seed);
        _registerAdapters(fixture, seed);
        _registerCalendarAndSession(fixture, seed, today, schedule);
        _registerSettlementBinding(fixture, seed);
        _deployDependentRegistries(fixture, config, admin);
        _registerBenchmark(fixture, seed);
        _registerFeeAndRisk(fixture, seed);
        _registerInstrumentAndMarket(fixture, seed, config);

        fixture.seriesRegistry = new SeriesRegistry(
            config.defaultAdminDelay,
            admin,
            IMarketRegistry(address(fixture.marketRegistry)),
            IInstrumentRegistry(address(fixture.instrumentRegistry))
        );

        _fundTraderAccount(fixture, seed);

        fixture.seriesDefinition =
            SetrynDefinitionFixtures.series(seed, fixture.marketId, 1, fixture.instrumentId, 1, schedule);
        fixture.seriesQualification =
            SetrynDefinitionFixtures.seriesQualification(seed, fixture.seriesDefinition, fixture.benchmarkId);
        fixture.seriesDefinition.payoffTermsHash = fixture.seriesRegistry
            .hashPayoffTerms(
                SetrynDefinitionFixtures.instrument(seed, fixture.payoffAdapterId, 1, config.evaluationGasHardCap / 2)
                .termsSchemaHash,
                fixture.seriesQualification.payoffTerms
            );
        fixture.seriesDefinition.fixingSlotsHash = fixture.seriesRegistry
        .hashFixingSlots(fixture.seriesDefinition, fixture.seriesQualification.fixingSlots, 4);
        fixture.seriesDefinition.dateAdjustmentEvidenceHash =
            fixture.seriesRegistry.hashDateProofs(fixture.seriesDefinition, fixture.seriesQualification.dateProofs);
        (fixture.seriesId,) =
            fixture.seriesRegistry.registerSeries(fixture.seriesDefinition, fixture.seriesQualification);
        fixture.seriesRegistry.activateSeries(fixture.seriesId, 1, fixture.seriesQualification);
    }

    function _fundTraderAccount(LocalSetrynFixture memory fixture, bytes32 seed) private {
        fixture.trader = address(uint160(uint256(keccak256(abi.encode("setryn.fixture.trader", seed)))));

        vm.prank(fixture.trader);
        fixture.traderAccountId = fixture.collateralVault.createAccount(keccak256(abi.encode(seed, "account")));

        fixture.settlementToken.mint(fixture.trader, 1_000_000e6);
        vm.startPrank(fixture.trader);
        fixture.settlementToken.approve(address(fixture.collateralVault), type(uint256).max);
        fixture.collateralVault.deposit(fixture.settlementAssetId, 1, fixture.traderAccountId, 1_000_000e6);
        vm.stopPrank();
    }

    function _registerAssets(LocalSetrynFixture memory fixture, bytes32 seed) private {
        fixture.baseAssetId = fixture.assetRegistry
            .registerAsset(
                SetrynDefinitionFixtures.asset(
                    keccak256(abi.encode(seed, "base")), bytes32("BASE"), AssetClass.Crypto, 8
                )
            );
        fixture.settlementAssetId = fixture.assetRegistry
            .registerAsset(
                SetrynDefinitionFixtures.asset(
                    keccak256(abi.encode(seed, "settlement")), bytes32("USDC"), AssetClass.Stablecoin, 6
                )
            );
    }

    function _registerAdapters(LocalSetrynFixture memory fixture, bytes32 seed) private {
        (fixture.benchmarkAdapterId,) = fixture.adapterRegistry
            .registerAdapter(
                SetrynDefinitionFixtures.adapter(
                    seed, AdapterDefinitionLib.ADAPTER_KIND_BENCHMARK, address(fixture.adapterImplementation)
                )
            );
        (fixture.riskAdapterId,) = fixture.adapterRegistry
            .registerAdapter(
                SetrynDefinitionFixtures.adapter(
                    seed, AdapterDefinitionLib.ADAPTER_KIND_RISK, address(fixture.adapterImplementation)
                )
            );
        (fixture.payoffAdapterId,) = fixture.adapterRegistry
            .registerAdapter(
                SetrynDefinitionFixtures.adapter(
                    seed, AdapterDefinitionLib.ADAPTER_KIND_PAYOFF, address(fixture.adapterImplementation)
                )
            );

        fixture.adapterRegistry.activateAdapter(fixture.benchmarkAdapterId, 1);
        fixture.adapterRegistry.activateAdapter(fixture.riskAdapterId, 1);
        fixture.adapterRegistry.activateAdapter(fixture.payoffAdapterId, 1);
    }

    function _registerCalendarAndSession(
        LocalSetrynFixture memory fixture,
        bytes32 seed,
        uint32 today,
        FixtureSeriesSchedule memory schedule
    ) private {
        uint32 scheduleDay = uint32(schedule.tradingStartsAt / 1 days);
        CalendarDefinition memory definition =
            SetrynDefinitionFixtures.calendar(seed, today, scheduleDay, bytes32(uint256(1)));
        CalendarId expectedCalendarId = CalendarDefinitionLib.deriveCalendarId(definition);
        definition.dayStatusRoot =
            CalendarDefinitionLib.hashDay(expectedCalendarId, SetrynDefinitionFixtures.calendarDay(seed, scheduleDay));
        (fixture.calendarId,) = fixture.calendarRegistry.registerCalendar(definition);
        fixture.calendarRegistry.activateCalendar(fixture.calendarId, 1);

        (fixture.sessionId,) = fixture.sessionRegistry
            .registerSession(SetrynDefinitionFixtures.session(seed, fixture.calendarId, 1, today, scheduleDay));
        fixture.sessionRegistry.activateSession(fixture.sessionId, 1);
    }

    function _registerSettlementBinding(LocalSetrynFixture memory fixture, bytes32 seed) private {
        fixture.settlementAssetRegistry
            .registerBinding(
                SetrynDefinitionFixtures.settlementAsset(
                    seed, fixture.settlementAssetId, address(fixture.settlementToken)
                )
            );
        fixture.settlementAssetRegistry.activateBinding(fixture.settlementAssetId, 1);
    }

    function _deployDependentRegistries(
        LocalSetrynFixture memory fixture,
        FixtureVaultConfig memory config,
        address admin
    ) private {
        fixture.benchmarkRegistry = new BenchmarkRegistry(
            config.defaultAdminDelay,
            admin,
            IAssetRegistry(address(fixture.assetRegistry)),
            IAdapterRegistry(address(fixture.adapterRegistry)),
            ICalendarRegistry(address(fixture.calendarRegistry)),
            ISessionRegistry(address(fixture.sessionRegistry))
        );
        fixture.feeScheduleRegistry = new FeeScheduleRegistry(
            config.defaultAdminDelay, admin, ISettlementAssetRegistry(address(fixture.settlementAssetRegistry))
        );
        fixture.riskDomainRegistry = new RiskDomainRegistry(
            config.defaultAdminDelay,
            admin,
            ISettlementAssetRegistry(address(fixture.settlementAssetRegistry)),
            IAdapterRegistry(address(fixture.adapterRegistry))
        );
        fixture.instrumentRegistry = new InstrumentRegistry(
            config.defaultAdminDelay,
            admin,
            IAdapterRegistry(address(fixture.adapterRegistry)),
            config.evaluationGasHardCap
        );
        fixture.collateralVault = new CollateralVault(
            config.defaultAdminDelay,
            admin,
            ISettlementAssetRegistry(address(fixture.settlementAssetRegistry)),
            IRiskDomainRegistry(address(fixture.riskDomainRegistry)),
            config.maxLockDuration
        );
        fixture.marketRegistry = new MarketRegistry(
            config.defaultAdminDelay,
            admin,
            IAssetRegistry(address(fixture.assetRegistry)),
            ISettlementAssetRegistry(address(fixture.settlementAssetRegistry)),
            ICollateralVault(address(fixture.collateralVault)),
            IBenchmarkRegistry(address(fixture.benchmarkRegistry)),
            ICalendarRegistry(address(fixture.calendarRegistry)),
            ISessionRegistry(address(fixture.sessionRegistry)),
            IRiskDomainRegistry(address(fixture.riskDomainRegistry)),
            IFeeScheduleRegistry(address(fixture.feeScheduleRegistry))
        );
    }

    function _registerBenchmark(LocalSetrynFixture memory fixture, bytes32 seed) private {
        (fixture.benchmarkId,) = fixture.benchmarkRegistry
            .registerBenchmark(
                SetrynDefinitionFixtures.benchmark(
                    seed,
                    fixture.baseAssetId,
                    fixture.settlementAssetId,
                    fixture.benchmarkAdapterId,
                    1,
                    fixture.calendarId,
                    1,
                    fixture.sessionId,
                    1
                )
            );
        fixture.benchmarkRegistry.activateBenchmark(fixture.benchmarkId, 1);
    }

    function _registerFeeAndRisk(LocalSetrynFixture memory fixture, bytes32 seed) private {
        (fixture.feeScheduleId,) = fixture.feeScheduleRegistry
            .registerFeeSchedule(SetrynDefinitionFixtures.feeSchedule(seed, fixture.settlementAssetId, 1));
        fixture.feeScheduleRegistry.activateFeeSchedule(fixture.feeScheduleId, 1);

        (fixture.riskDomainId,) = fixture.riskDomainRegistry
            .registerRiskDomain(
                SetrynDefinitionFixtures.riskDomain(seed, fixture.settlementAssetId, 1, fixture.riskAdapterId, 1)
            );
        fixture.riskDomainRegistry.activateRiskDomain(fixture.riskDomainId, 1);
    }

    function _registerInstrumentAndMarket(
        LocalSetrynFixture memory fixture,
        bytes32 seed,
        FixtureVaultConfig memory config
    ) private {
        (fixture.instrumentId,) = fixture.instrumentRegistry
            .registerInstrument(
                SetrynDefinitionFixtures.instrument(seed, fixture.payoffAdapterId, 1, config.evaluationGasHardCap / 2)
            );
        fixture.instrumentRegistry.activateInstrument(fixture.instrumentId, 1);

        (fixture.marketId,) = fixture.marketRegistry
            .registerMarket(
                SetrynDefinitionFixtures.market(
                    seed,
                    FixtureMarketDependencies({
                        baseAssetId: fixture.baseAssetId,
                        quoteAssetId: fixture.settlementAssetId,
                        settlementAssetVersion: 1,
                        benchmarkId: fixture.benchmarkId,
                        benchmarkVersion: 1,
                        calendarId: fixture.calendarId,
                        calendarVersion: 1,
                        sessionId: fixture.sessionId,
                        sessionVersion: 1,
                        riskDomainId: fixture.riskDomainId,
                        riskDomainVersion: 1,
                        feeScheduleId: fixture.feeScheduleId,
                        feeScheduleVersion: 1
                    })
                )
            );
        fixture.marketRegistry.activateMarket(fixture.marketId, 1);
    }
}
