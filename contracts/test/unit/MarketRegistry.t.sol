// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Test} from "forge-std/Test.sol";

import {IAssetRegistry} from "../../src/interfaces/IAssetRegistry.sol";
import {IBenchmarkRegistry} from "../../src/interfaces/IBenchmarkRegistry.sol";
import {ICalendarRegistry} from "../../src/interfaces/ICalendarRegistry.sol";
import {ICollateralVault} from "../../src/interfaces/ICollateralVault.sol";
import {IFeeScheduleRegistry} from "../../src/interfaces/IFeeScheduleRegistry.sol";
import {IMarketRegistry} from "../../src/interfaces/IMarketRegistry.sol";
import {IRiskDomainRegistry} from "../../src/interfaces/IRiskDomainRegistry.sol";
import {ISessionRegistry} from "../../src/interfaces/ISessionRegistry.sol";
import {ISettlementAssetRegistry} from "../../src/interfaces/ISettlementAssetRegistry.sol";
import {
    InvalidMarketLotBounds,
    MarketDefinitionLib,
    SettlementAssetMustEqualQuoteAsset,
    UnsupportedQuoteUnit
} from "../../src/libraries/MarketDefinitionLib.sol";
import {MarketRegistry} from "../../src/registry/MarketRegistry.sol";
import {RegistryStatus} from "../../src/types/Enums.sol";
import {
    AssetId,
    BenchmarkId,
    CalendarId,
    FeeScheduleId,
    MarketId,
    QuoteUnitId,
    RiskDomainId,
    SessionId
} from "../../src/types/Identifiers.sol";
import {MarketDefinition, MarketVersion} from "../../src/types/MarketDefinition.sol";
import {Lots, PriceTicks, TickSizeMinor} from "../../src/types/Units.sol";
import {
    MarketAssetRegistryMock,
    MarketBenchmarkRegistryMock,
    MarketCalendarRegistryMock,
    MarketCollateralVaultMock,
    MarketFeeScheduleRegistryMock,
    MarketRiskDomainRegistryMock,
    MarketSessionRegistryMock,
    MarketSettlementRegistryMock
} from "../mocks/MarketRegistryMocks.sol";

contract MarketRegistryTest is Test {
    uint48 internal constant ADMIN_DELAY = 3 days;
    uint32 internal constant VERSION = 1;

    address internal admin = makeAddr("admin");
    address internal qualifier = makeAddr("qualifier");
    address internal statusManager = makeAddr("statusManager");
    address internal outsider = makeAddr("outsider");

    AssetId internal baseAssetId = AssetId.wrap(keccak256("asset.base"));
    AssetId internal quoteAssetId = AssetId.wrap(keccak256("asset.quote"));
    BenchmarkId internal benchmarkId = BenchmarkId.wrap(keccak256("benchmark"));
    CalendarId internal calendarId = CalendarId.wrap(keccak256("calendar"));
    SessionId internal sessionId = SessionId.wrap(keccak256("session"));
    RiskDomainId internal riskDomainId = RiskDomainId.wrap(keccak256("risk"));
    FeeScheduleId internal feeScheduleId = FeeScheduleId.wrap(keccak256("fee"));

    MarketAssetRegistryMock internal assets;
    MarketSettlementRegistryMock internal settlements;
    MarketCalendarRegistryMock internal calendars;
    MarketSessionRegistryMock internal sessions;
    MarketBenchmarkRegistryMock internal benchmarks;
    MarketRiskDomainRegistryMock internal risks;
    MarketFeeScheduleRegistryMock internal fees;
    MarketCollateralVaultMock internal vault;
    MarketRegistry internal registry;

    function setUp() public {
        assets = new MarketAssetRegistryMock();
        settlements = new MarketSettlementRegistryMock(IAssetRegistry(address(assets)));
        calendars = new MarketCalendarRegistryMock();
        sessions = new MarketSessionRegistryMock(ICalendarRegistry(address(calendars)));
        benchmarks = new MarketBenchmarkRegistryMock(
            IAssetRegistry(address(assets)), ICalendarRegistry(address(calendars)), ISessionRegistry(address(sessions))
        );
        risks = new MarketRiskDomainRegistryMock(ISettlementAssetRegistry(address(settlements)));
        fees = new MarketFeeScheduleRegistryMock(ISettlementAssetRegistry(address(settlements)));
        vault = new MarketCollateralVaultMock(
            ISettlementAssetRegistry(address(settlements)), IRiskDomainRegistry(address(risks))
        );

        registry = new MarketRegistry(
            ADMIN_DELAY,
            admin,
            IAssetRegistry(address(assets)),
            ISettlementAssetRegistry(address(settlements)),
            ICollateralVault(address(vault)),
            IBenchmarkRegistry(address(benchmarks)),
            ICalendarRegistry(address(calendars)),
            ISessionRegistry(address(sessions)),
            IRiskDomainRegistry(address(risks)),
            IFeeScheduleRegistry(address(fees))
        );

        vm.startPrank(admin);
        registry.grantRole(registry.MARKET_QUALIFIER_ROLE(), qualifier);
        registry.grantRole(registry.MARKET_STATUS_MANAGER_ROLE(), statusManager);
        vm.stopPrank();

        _setDependencies(true);
    }

    function test_TypestringsMatchTypehashesAndCanonicalTag() public pure {
        assertEq(keccak256(bytes(MarketDefinitionLib.MARKET_KEY_TYPESTRING)), MarketDefinitionLib.MARKET_KEY_TYPEHASH);
        assertEq(
            keccak256(bytes(MarketDefinitionLib.MARKET_DEFINITION_TYPESTRING)),
            MarketDefinitionLib.MARKET_DEFINITION_TYPEHASH
        );
        assertEq(
            keccak256(bytes(MarketDefinitionLib.MARKET_VERSION_TYPESTRING)), MarketDefinitionLib.MARKET_VERSION_TYPEHASH
        );
        assertEq(
            QuoteUnitId.unwrap(MarketDefinitionLib.QUOTE_UNIT_SETTLEMENT_MINOR_PER_LOT),
            keccak256("SetrynQuoteUnitV1:SettlementMinorPerLot")
        );
    }

    function test_RegistrationIsQualifiedButDoesNotOpenRisk() public {
        vm.prank(qualifier);
        (MarketId marketId, uint32 version) = registry.registerMarket(_definition());

        assertEq(version, 1);
        assertEq(uint8(registry.statusOf(marketId, version)), uint8(RegistryStatus.Paused));
        assertEq(registry.activeVersion(marketId), 0);
        assertFalse(registry.isOpenForNewRisk(marketId, version, _today()));
        assertTrue(registry.isLifecycleEnabled(marketId, version));
    }

    function test_RolesSeparateQualificationFromActivation() public {
        MarketDefinition memory definition = _definition();

        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, outsider, registry.MARKET_QUALIFIER_ROLE()
            )
        );
        vm.prank(outsider);
        registry.registerMarket(definition);

        vm.prank(qualifier);
        (MarketId marketId, uint32 version) = registry.registerMarket(definition);

        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                qualifier,
                registry.MARKET_STATUS_MANAGER_ROLE()
            )
        );
        vm.prank(qualifier);
        registry.activateMarket(marketId, version);

        vm.prank(statusManager);
        registry.activateMarket(marketId, version);
        assertTrue(registry.isOpenForNewRisk(marketId, version, _today()));
    }

    function test_ActivationFailsClosedWhenExactDependencyIsNotOpen() public {
        vm.prank(qualifier);
        (MarketId marketId, uint32 version) = registry.registerMarket(_definition());
        settlements.setBinding(quoteAssetId, VERSION, false);

        vm.expectRevert(
            abi.encodeWithSelector(IMarketRegistry.SettlementAssetDependencyNotOpen.selector, quoteAssetId, VERSION)
        );
        vm.prank(statusManager);
        registry.activateMarket(marketId, version);

        assertEq(uint8(registry.statusOf(marketId, version)), uint8(RegistryStatus.Paused));
    }

    function test_ActivationAndLiveGateFailClosedWhenVaultCapabilityDrifts() public {
        vm.prank(qualifier);
        (MarketId marketId, uint32 version) = registry.registerMarket(_definition());
        vault.setTerminalReservationCapability(2, true);

        vm.expectRevert(
            abi.encodeWithSelector(IMarketRegistry.TerminalReservationCapabilityMismatch.selector, uint32(1), uint32(2))
        );
        vm.prank(statusManager);
        registry.activateMarket(marketId, version);
        assertFalse(registry.isOpenForNewRisk(marketId, version, _today()));
    }

    function test_RegistrationRejectsIncompatibleDependencyRelationships() public {
        benchmarks.setBenchmark(benchmarkId, VERSION, quoteAssetId, baseAssetId, true);

        vm.expectRevert(abi.encodeWithSelector(IMarketRegistry.BenchmarkPairMismatch.selector, benchmarkId, VERSION));
        vm.prank(qualifier);
        registry.registerMarket(_definition());
    }

    function test_AppendOnlyVersionsPreserveHashesAndHistory() public {
        MarketDefinition memory first = _definition();
        vm.prank(qualifier);
        (MarketId marketId, uint32 firstVersion) = registry.registerMarket(first);

        MarketDefinition memory second = _definition();
        second.tickSizeMinor = TickSizeMinor.wrap(25);
        second.qualificationEvidenceHash = keccak256("market.evidence.v2");
        vm.prank(qualifier);
        (MarketId secondId, uint32 secondVersion) = registry.registerMarket(second);

        MarketVersion memory storedFirst = registry.getMarket(marketId, firstVersion);
        MarketVersion memory storedSecond = registry.getMarket(secondId, secondVersion);
        assertEq(MarketId.unwrap(marketId), MarketId.unwrap(secondId));
        assertEq(firstVersion, 1);
        assertEq(secondVersion, 2);
        assertEq(storedFirst.definitionHash, MarketDefinitionLib.hashDefinition(first, block.chainid));
        assertEq(storedSecond.definitionHash, MarketDefinitionLib.hashDefinition(second, block.chainid));
        assertTrue(storedFirst.definitionHash != storedSecond.definitionHash);
        assertEq(TickSizeMinor.unwrap(storedFirst.definition.tickSizeMinor), 10);
    }

    function test_StatusTransitionsClearActivePointerAndPreserveLifecycle() public {
        vm.prank(qualifier);
        (MarketId marketId, uint32 version) = registry.registerMarket(_definition());

        vm.startPrank(statusManager);
        registry.activateMarket(marketId, version);
        registry.pauseMarket(marketId, version);
        registry.deprecateMarket(marketId, version);
        vm.stopPrank();

        assertEq(registry.activeVersion(marketId), 0);
        assertEq(uint8(registry.statusOf(marketId, version)), uint8(RegistryStatus.Deprecated));
        assertTrue(registry.isLifecycleEnabled(marketId, version));

        vm.expectRevert();
        vm.prank(statusManager);
        registry.activateMarket(marketId, version);
    }

    function test_InvalidCanonicalPriceAndLotCombinationsFailClosed() public {
        MarketDefinition memory definition = _definition();
        definition.settlementAssetId = baseAssetId;
        _expectRegistrationRevert(definition, SettlementAssetMustEqualQuoteAsset.selector);

        definition = _definition();
        definition.quoteUnitId = QuoteUnitId.wrap(keccak256("unsupported.quote.unit"));
        _expectRegistrationRevert(definition, UnsupportedQuoteUnit.selector);

        definition = _definition();
        definition.maxOrderLots = Lots.wrap(101);
        _expectRegistrationRevert(definition, InvalidMarketLotBounds.selector);
    }

    function _setDependencies(bool open) internal {
        assets.setAsset(baseAssetId, true);
        assets.setAsset(quoteAssetId, true);
        settlements.setBinding(quoteAssetId, VERSION, open);
        calendars.setCalendar(calendarId, VERSION, open);
        sessions.setSession(sessionId, VERSION, calendarId, VERSION, open);
        benchmarks.setBenchmark(benchmarkId, VERSION, baseAssetId, quoteAssetId, open);
        risks.setRiskDomain(riskDomainId, VERSION, quoteAssetId, VERSION, open);
        fees.setFeeSchedule(feeScheduleId, VERSION, quoteAssetId, VERSION, open);
    }

    function _definition() internal view returns (MarketDefinition memory) {
        return MarketDefinition({
            namespaceId: keccak256("setryn.market"),
            marketKey: keccak256("base-quote"),
            baseAssetId: baseAssetId,
            quoteAssetId: quoteAssetId,
            settlementAssetId: quoteAssetId,
            settlementAssetVersion: VERSION,
            markBenchmarkId: benchmarkId,
            markBenchmarkVersion: VERSION,
            tradingCalendarId: calendarId,
            tradingCalendarVersion: VERSION,
            tradingSessionId: sessionId,
            tradingSessionVersion: VERSION,
            riskDomainId: riskDomainId,
            riskDomainVersion: VERSION,
            feeScheduleId: feeScheduleId,
            feeScheduleVersion: VERSION,
            quoteUnitId: MarketDefinitionLib.QUOTE_UNIT_SETTLEMENT_MINOR_PER_LOT,
            tickSizeMinor: TickSizeMinor.wrap(10),
            lotStep: Lots.wrap(5),
            minOrderLots: Lots.wrap(5),
            maxOrderLots: Lots.wrap(100),
            minPriceTicks: PriceTicks.wrap(-1_000),
            maxPriceTicks: PriceTicks.wrap(1_000),
            executionModeSetHash: keccak256("execution.modes"),
            qualificationEvidenceHash: keccak256("market.evidence")
        });
    }

    function _expectRegistrationRevert(MarketDefinition memory definition, bytes4 selector) internal {
        vm.expectPartialRevert(selector);
        vm.prank(qualifier);
        registry.registerMarket(definition);
    }

    function _today() internal view returns (uint32) {
        return uint32(block.timestamp / 1 days);
    }
}
