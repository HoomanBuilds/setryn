// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Test} from "forge-std/Test.sol";

import {IMarketRegistry} from "../../src/interfaces/IMarketRegistry.sol";
import {IPackageRegistry} from "../../src/interfaces/IPackageRegistry.sol";
import {IRiskDomainRegistry} from "../../src/interfaces/IRiskDomainRegistry.sol";
import {ISeriesRegistry} from "../../src/interfaces/ISeriesRegistry.sol";
import {
    InvalidPackageLegOrder,
    InvalidPackageOrientation,
    NonPrimitivePackageRatios,
    PackageDefinitionLib,
    PackageLegLotsOverflow
} from "../../src/libraries/PackageDefinitionLib.sol";
import {PackageRegistry} from "../../src/registry/PackageRegistry.sol";
import {RegistryStatus} from "../../src/types/Enums.sol";
import {
    AdapterId,
    AdapterKindId,
    AssetId,
    BenchmarkId,
    CalendarId,
    DisruptionOutcomeId,
    ExercisePolicyId,
    FeeScheduleId,
    InstrumentId,
    MarketId,
    PackageId,
    QuoteUnitId,
    RiskDomainId,
    RiskModelId,
    SeriesId,
    SessionId
} from "../../src/types/Identifiers.sol";
import {MarketDefinition} from "../../src/types/MarketDefinition.sol";
import {PackageDefinition, PackageLeg, PackageVersion} from "../../src/types/PackageDefinition.sol";
import {RiskDomainDefinition} from "../../src/types/RiskDomainDefinition.sol";
import {SeriesDefinition, SeriesVersion} from "../../src/types/SeriesDefinition.sol";
import {Lots, PriceTicks, TickSizeMinor} from "../../src/types/Units.sol";
import {
    PackageMarketRegistryMock,
    PackageRiskDomainRegistryMock,
    PackageSeriesRegistryMock
} from "../mocks/PackageRegistryMocks.sol";

contract PackageRegistryTest is Test {
    uint32 internal constant VERSION = 1;
    uint128 internal constant A_LONG = 100;
    uint128 internal constant A_SHORT = 400;
    uint128 internal constant B_LONG = 250;
    uint128 internal constant B_SHORT = 700;

    address internal admin = makeAddr("admin");
    address internal qualifier = makeAddr("qualifier");
    address internal statusManager = makeAddr("statusManager");
    address internal outsider = makeAddr("outsider");

    AssetId internal settlementAssetId = AssetId.wrap(keccak256("asset.usdc"));
    PackageRiskDomainRegistryMock internal risks;
    PackageMarketRegistryMock internal markets;
    PackageSeriesRegistryMock internal series;
    PackageRegistry internal registry;
    RiskDomainId internal riskDomainId;
    SeriesId internal seriesA;
    SeriesId internal seriesB;
    MarketId internal marketA;
    MarketId internal marketB;

    function setUp() public {
        risks = new PackageRiskDomainRegistryMock();
        riskDomainId = risks.setRiskDomain(_riskDefinition(10_000_000), VERSION);
        markets = new PackageMarketRegistryMock(IRiskDomainRegistry(address(risks)));
        marketA = markets.setMarket(_marketDefinition(keccak256("market.a"), riskDomainId), VERSION);
        marketB = markets.setMarket(_marketDefinition(keccak256("market.b"), riskDomainId), VERSION);
        series = new PackageSeriesRegistryMock(IMarketRegistry(address(markets)));
        seriesA =
            series.setSeries(_seriesDefinition(keccak256("series.a"), marketA, A_LONG, A_SHORT), VERSION, true, true);
        seriesB =
            series.setSeries(_seriesDefinition(keccak256("series.b"), marketB, B_LONG, B_SHORT), VERSION, true, true);

        registry = new PackageRegistry(3 days, admin, ISeriesRegistry(address(series)));
        vm.startPrank(admin);
        registry.grantRole(registry.PACKAGE_QUALIFIER_ROLE(), qualifier);
        registry.grantRole(registry.PACKAGE_STATUS_MANAGER_ROLE(), statusManager);
        vm.stopPrank();
    }

    function test_TypestringsMatchTypehashesAndCanonicalTag() public pure {
        assertEq(
            keccak256(bytes(PackageDefinitionLib.PACKAGE_KEY_TYPESTRING)), PackageDefinitionLib.PACKAGE_KEY_TYPEHASH
        );
        assertEq(
            keccak256(bytes(PackageDefinitionLib.PACKAGE_LEG_TYPESTRING)), PackageDefinitionLib.PACKAGE_LEG_TYPEHASH
        );
        assertEq(
            keccak256(bytes(PackageDefinitionLib.PACKAGE_LEGS_TYPESTRING)), PackageDefinitionLib.PACKAGE_LEGS_TYPEHASH
        );
        assertEq(
            keccak256(bytes(PackageDefinitionLib.PACKAGE_DEFINITION_TYPESTRING)),
            PackageDefinitionLib.PACKAGE_DEFINITION_TYPEHASH
        );
        assertEq(
            keccak256(bytes(PackageDefinitionLib.PACKAGE_VERSION_TYPESTRING)),
            PackageDefinitionLib.PACKAGE_VERSION_TYPEHASH
        );
        assertEq(
            QuoteUnitId.unwrap(PackageDefinitionLib.QUOTE_UNIT_SETTLEMENT_MINOR_PER_LOT),
            keccak256("SetrynQuoteUnitV1:SettlementMinorPerLot")
        );
    }

    function test_QualifiedRegistrationPublishesCommitmentAndLandsPaused() public {
        PackageLeg[] memory legs = _canonicalLegs();
        PackageDefinition memory definition = _packageDefinition(legs);

        vm.prank(qualifier);
        (PackageId packageId, uint32 version) = registry.registerPackage(definition, legs);

        assertEq(version, 1);
        assertEq(uint8(registry.statusOf(packageId, version)), uint8(RegistryStatus.Paused));
        assertEq(registry.activeVersion(packageId), 0);
        assertTrue(registry.isLifecycleEnabled(packageId, version));
        assertFalse(registry.isOpenForNewRisk(packageId, version, legs, _today()));
    }

    function test_RolesSeparateQualificationAndActivation() public {
        PackageLeg[] memory legs = _canonicalLegs();
        PackageDefinition memory definition = _packageDefinition(legs);

        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, outsider, registry.PACKAGE_QUALIFIER_ROLE()
            )
        );
        vm.prank(outsider);
        registry.registerPackage(definition, legs);

        vm.prank(qualifier);
        (PackageId packageId, uint32 version) = registry.registerPackage(definition, legs);

        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                qualifier,
                registry.PACKAGE_STATUS_MANAGER_ROLE()
            )
        );
        vm.prank(qualifier);
        registry.activatePackage(packageId, version, legs);
    }

    function test_ActivationRevalidatesExactLegsAndLiveDependencies() public {
        PackageLeg[] memory legs = _canonicalLegs();
        PackageDefinition memory definition = _packageDefinition(legs);
        vm.prank(qualifier);
        (PackageId packageId, uint32 version) = registry.registerPackage(definition, legs);

        series.setOpen(legs[1].seriesId, legs[1].seriesVersion, false);
        vm.expectPartialRevert(IPackageRegistry.SeriesDependencyNotOpen.selector);
        vm.prank(statusManager);
        registry.activatePackage(packageId, version, legs);

        series.setOpen(legs[1].seriesId, legs[1].seriesVersion, true);
        PackageLeg[] memory wrongLegs = _canonicalLegs();
        wrongLegs[1].ratio = -3;
        vm.expectPartialRevert(IPackageRegistry.PackageLegCommitmentMismatch.selector);
        vm.prank(statusManager);
        registry.activatePackage(packageId, version, wrongLegs);

        vm.prank(statusManager);
        registry.activatePackage(packageId, version, legs);
        assertTrue(registry.isOpenForNewRisk(packageId, version, legs, _today()));

        series.setOpen(legs[0].seriesId, legs[0].seriesVersion, false);
        assertFalse(registry.isOpenForNewRisk(packageId, version, legs, _today()));
        assertTrue(registry.isLifecycleEnabled(packageId, version));
    }

    function test_AppendOnlyVersionsKeepOneActiveVersionPerLineage() public {
        PackageLeg[] memory legs = _canonicalLegs();
        PackageDefinition memory first = _packageDefinition(legs);
        vm.prank(qualifier);
        (PackageId packageId, uint32 firstVersion) = registry.registerPackage(first, legs);

        PackageDefinition memory second = _packageDefinition(legs);
        second.tickSizeMinor = TickSizeMinor.wrap(2);
        second.qualificationEvidenceHash = keccak256("package.evidence.v2");
        vm.prank(qualifier);
        (PackageId secondId, uint32 secondVersion) = registry.registerPackage(second, legs);

        assertEq(PackageId.unwrap(packageId), PackageId.unwrap(secondId));
        assertEq(firstVersion, 1);
        assertEq(secondVersion, 2);
        PackageVersion memory storedFirst = registry.getPackage(packageId, firstVersion);
        assertEq(TickSizeMinor.unwrap(storedFirst.definition.tickSizeMinor), 1);

        vm.prank(statusManager);
        registry.activatePackage(packageId, firstVersion, legs);
        vm.expectPartialRevert(IPackageRegistry.AnotherPackageVersionActive.selector);
        vm.prank(statusManager);
        registry.activatePackage(packageId, secondVersion, legs);
    }

    function test_RegistrationRejectsNonCanonicalLegs() public {
        PackageLeg[] memory legs = _canonicalLegs();
        PackageLeg memory first = legs[0];
        legs[0] = legs[1];
        legs[1] = first;
        PackageDefinition memory definition = _uncheckedPackageDefinition(legs);
        vm.expectRevert(InvalidPackageOrientation.selector);
        vm.prank(qualifier);
        registry.registerPackage(definition, legs);

        legs = _canonicalLegs();
        legs[1].seriesId = legs[0].seriesId;
        legs[1].seriesVersion = legs[0].seriesVersion;
        definition = _uncheckedPackageDefinition(legs);
        vm.expectRevert(InvalidPackageLegOrder.selector);
        vm.prank(qualifier);
        registry.registerPackage(definition, legs);

        legs = _canonicalLegs();
        legs[0].ratio = 2;
        legs[1].ratio = -4;
        definition = _uncheckedPackageDefinition(legs);
        vm.expectRevert(NonPrimitivePackageRatios.selector);
        vm.prank(qualifier);
        registry.registerPackage(definition, legs);
    }

    function test_RegistrationRejectsSettlementAndRiskDomainMismatch() public {
        PackageLeg[] memory legs = _canonicalLegs();
        PackageDefinition memory definition = _packageDefinition(legs);
        definition.settlementAssetVersion = 2;
        vm.expectPartialRevert(IPackageRegistry.PackageSettlementMismatch.selector);
        vm.prank(qualifier);
        registry.registerPackage(definition, legs);

        RiskDomainId otherRisk =
            risks.setRiskDomain(_riskDefinitionWithKey(10_000_000, keccak256("other.domain")), VERSION);
        MarketId otherMarket = markets.setMarket(_marketDefinition(keccak256("market.other"), otherRisk), VERSION);
        SeriesId otherSeries = series.setSeries(
            _seriesDefinition(keccak256("series.other"), otherMarket, B_LONG, B_SHORT), VERSION, true, true
        );
        legs = _sortedLegs(seriesA, otherSeries);
        definition = _packageDefinition(legs);
        vm.expectPartialRevert(IPackageRegistry.PackageRiskDomainMismatch.selector);
        vm.prank(qualifier);
        registry.registerPackage(definition, legs);
    }

    function test_RegistrationRejectsWrongDerivedBoundsAndRiskCap() public {
        PackageLeg[] memory legs = _canonicalLegs();
        PackageDefinition memory definition = _packageDefinition(legs);
        definition.maxLongDebitMinorPerPackageLot += 1;
        vm.expectPartialRevert(IPackageRegistry.PackageTerminalDebitBoundsMismatch.selector);
        vm.prank(qualifier);
        registry.registerPackage(definition, legs);

        PackageRiskDomainRegistryMock lowRisks = new PackageRiskDomainRegistryMock();
        RiskDomainId lowRisk = lowRisks.setRiskDomain(_riskDefinition(1), VERSION);
        PackageMarketRegistryMock lowMarkets = new PackageMarketRegistryMock(IRiskDomainRegistry(address(lowRisks)));
        MarketId lowMarketA = lowMarkets.setMarket(_marketDefinition(keccak256("low.market.a"), lowRisk), VERSION);
        MarketId lowMarketB = lowMarkets.setMarket(_marketDefinition(keccak256("low.market.b"), lowRisk), VERSION);
        PackageSeriesRegistryMock lowSeries = new PackageSeriesRegistryMock(IMarketRegistry(address(lowMarkets)));
        SeriesId lowA = lowSeries.setSeries(
            _seriesDefinition(keccak256("low.series.a"), lowMarketA, A_LONG, A_SHORT), VERSION, true, true
        );
        SeriesId lowB = lowSeries.setSeries(
            _seriesDefinition(keccak256("low.series.b"), lowMarketB, B_LONG, B_SHORT), VERSION, true, true
        );
        PackageRegistry lowRegistry = new PackageRegistry(3 days, admin, ISeriesRegistry(address(lowSeries)));
        vm.prank(admin);
        lowRegistry.grantRole(lowRegistry.PACKAGE_QUALIFIER_ROLE(), qualifier);
        legs = _sortedLegs(lowA, lowB);
        definition = _packageDefinitionFor(legs, lowSeries);
        vm.expectPartialRevert(IPackageRegistry.PackageLiabilityExceedsRiskCap.selector);
        vm.prank(qualifier);
        lowRegistry.registerPackage(definition, legs);
    }

    function test_MaximumPackageLotsMustFitEveryLegRatio() public {
        PackageLeg[] memory legs = _canonicalLegs();
        legs[1].ratio = type(int32).min;
        PackageDefinition memory definition = _uncheckedPackageDefinition(legs);
        definition.maxOrderLots = Lots.wrap(type(uint128).max);
        vm.expectRevert(PackageLegLotsOverflow.selector);
        vm.prank(qualifier);
        registry.registerPackage(definition, legs);
    }

    function _canonicalLegs() internal view returns (PackageLeg[] memory) {
        return _sortedLegs(seriesA, seriesB);
    }

    function _sortedLegs(SeriesId firstSeries, SeriesId secondSeries) internal pure returns (PackageLeg[] memory legs) {
        legs = new PackageLeg[](2);
        bool alreadySorted = uint256(SeriesId.unwrap(firstSeries)) < uint256(SeriesId.unwrap(secondSeries));
        legs[0] = PackageLeg({seriesId: alreadySorted ? firstSeries : secondSeries, seriesVersion: VERSION, ratio: 1});
        legs[1] = PackageLeg({seriesId: alreadySorted ? secondSeries : firstSeries, seriesVersion: VERSION, ratio: -2});
    }

    function _packageDefinition(PackageLeg[] memory legs) internal view returns (PackageDefinition memory) {
        return _packageDefinitionFor(legs, series);
    }

    function _packageDefinitionFor(PackageLeg[] memory legs, PackageSeriesRegistryMock source)
        internal
        view
        returns (PackageDefinition memory definition)
    {
        uint128[] memory longBounds = new uint128[](2);
        uint128[] memory shortBounds = new uint128[](2);
        for (uint256 i; i < 2; ++i) {
            SeriesVersion memory record = source.getSeries(legs[i].seriesId, legs[i].seriesVersion);
            longBounds[i] = record.definition.maxLongDebitMinorPerLot;
            shortBounds[i] = record.definition.maxShortDebitMinorPerLot;
        }
        (uint128 longDebit, uint128 shortDebit) =
            PackageDefinitionLib.deriveTerminalDebitBounds(legs, longBounds, shortBounds);
        definition = _uncheckedPackageDefinition(legs);
        definition.maxLongDebitMinorPerPackageLot = longDebit;
        definition.maxShortDebitMinorPerPackageLot = shortDebit;
    }

    function _uncheckedPackageDefinition(PackageLeg[] memory legs) internal pure returns (PackageDefinition memory) {
        return PackageDefinition({
            namespaceId: keccak256("setryn"),
            packageKey: keccak256("carry.package"),
            settlementAssetId: AssetId.wrap(keccak256("asset.usdc")),
            settlementAssetVersion: VERSION,
            legsHash: PackageDefinitionLib.hashLegsUnchecked(legs),
            quoteUnitId: PackageDefinitionLib.QUOTE_UNIT_SETTLEMENT_MINOR_PER_LOT,
            tickSizeMinor: TickSizeMinor.wrap(1),
            lotStep: Lots.wrap(1),
            minOrderLots: Lots.wrap(1),
            maxOrderLots: Lots.wrap(100),
            minPriceTicks: PriceTicks.wrap(-1_000_000),
            maxPriceTicks: PriceTicks.wrap(1_000_000),
            maxLongDebitMinorPerPackageLot: 1,
            maxShortDebitMinorPerPackageLot: 1,
            lifecyclePolicyHash: keccak256("package.lifecycle"),
            qualificationEvidenceHash: keccak256("package.evidence")
        });
    }

    function _marketDefinition(bytes32 marketKey, RiskDomainId domainId)
        internal
        view
        returns (MarketDefinition memory)
    {
        return MarketDefinition({
            namespaceId: keccak256("setryn"),
            marketKey: marketKey,
            baseAssetId: AssetId.wrap(keccak256(abi.encode(marketKey, "base"))),
            quoteAssetId: settlementAssetId,
            settlementAssetId: settlementAssetId,
            settlementAssetVersion: VERSION,
            markBenchmarkId: BenchmarkId.wrap(keccak256(abi.encode(marketKey, "benchmark"))),
            markBenchmarkVersion: VERSION,
            tradingCalendarId: CalendarId.wrap(keccak256("calendar")),
            tradingCalendarVersion: VERSION,
            tradingSessionId: SessionId.wrap(keccak256("session")),
            tradingSessionVersion: VERSION,
            riskDomainId: domainId,
            riskDomainVersion: VERSION,
            feeScheduleId: FeeScheduleId.wrap(keccak256("fee")),
            feeScheduleVersion: VERSION,
            quoteUnitId: QuoteUnitId.wrap(keccak256("SetrynQuoteUnitV1:SettlementMinorPerLot")),
            tickSizeMinor: TickSizeMinor.wrap(1),
            lotStep: Lots.wrap(1),
            minOrderLots: Lots.wrap(1),
            maxOrderLots: Lots.wrap(100),
            minPriceTicks: PriceTicks.wrap(-1_000_000),
            maxPriceTicks: PriceTicks.wrap(1_000_000),
            executionModeSetHash: keccak256("execution.modes"),
            qualificationEvidenceHash: keccak256("market.evidence")
        });
    }

    function _seriesDefinition(bytes32 seriesKey, MarketId marketId, uint128 longDebit, uint128 shortDebit)
        internal
        pure
        returns (SeriesDefinition memory)
    {
        return SeriesDefinition({
            namespaceId: keccak256("setryn"),
            seriesKey: seriesKey,
            marketId: marketId,
            marketVersion: VERSION,
            instrumentId: InstrumentId.wrap(keccak256(abi.encode(seriesKey, "instrument"))),
            instrumentVersion: VERSION,
            tradingStartsAt: 1,
            lastTradingAt: type(uint64).max - 10,
            expiryAt: type(uint64).max - 9,
            exerciseOpensAt: 0,
            exerciseCutoffAt: 0,
            fixingWindowOpen: type(uint64).max - 8,
            fixingWindowClose: type(uint64).max - 7,
            primaryEvidenceDeadline: type(uint64).max - 6,
            correctionCutoffAt: type(uint64).max - 5,
            finalResolutionAt: type(uint64).max - 4,
            settlementDeadline: type(uint64).max - 3,
            exercisePolicyId: ExercisePolicyId.wrap(keccak256("exercise.auto")),
            disruptionOutcomeId: DisruptionOutcomeId.wrap(keccak256("disruption.flat")),
            terminalDisruptionTransferMinorPerLot: 0,
            payoffTermsHash: keccak256("terms"),
            fixingSlotsHash: keccak256("fixings"),
            dateAdjustmentEvidenceHash: keccak256("dates"),
            maxLongDebitMinorPerLot: longDebit,
            maxShortDebitMinorPerLot: shortDebit,
            qualificationEvidenceHash: keccak256("series.evidence")
        });
    }

    function _riskDefinition(uint128 cap) internal view returns (RiskDomainDefinition memory) {
        return _riskDefinitionWithKey(cap, keccak256(abi.encode("domain", cap, address(this))));
    }

    function _riskDefinitionWithKey(uint128 cap, bytes32 domainKey)
        internal
        view
        returns (RiskDomainDefinition memory)
    {
        return RiskDomainDefinition({
            namespaceId: keccak256("setryn"),
            domainKey: domainKey,
            riskModelId: RiskModelId.wrap(keccak256("risk.model")),
            collateralAssetId: settlementAssetId,
            collateralAssetVersion: VERSION,
            riskAdapterId: AdapterId.wrap(keccak256("risk.adapter")),
            riskAdapterVersion: VERSION,
            requiredAdapterKindId: AdapterKindId.wrap(keccak256("risk.kind")),
            requiredInterfaceHash: keccak256("risk.interface"),
            requiredCapabilityHash: keccak256("risk.capability"),
            marginRulesHash: keccak256("margin.rules"),
            scenarioSetHash: keccak256("scenarios"),
            concentrationRulesHash: keccak256("concentration"),
            defaultProcessHash: keccak256("default"),
            insurancePolicyHash: keccak256("insurance"),
            qualificationEvidenceHash: keccak256("risk.evidence"),
            maxOpenInterestBaseUnits: cap,
            maxAggregateLiabilityBaseUnits: cap,
            maxAccountLiabilityBaseUnits: cap,
            maxAggregateReservationBaseUnits: 0,
            maxAccountReservationBaseUnits: 0
        });
    }

    function _today() internal view returns (uint32) {
        return uint32(block.timestamp / 1 days);
    }
}
