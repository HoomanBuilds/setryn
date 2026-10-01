// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {BootstrapSetrynMarkets} from "../../script/BootstrapSetrynMarkets.s.sol";
import {DeploySetryn} from "../../script/DeploySetryn.s.sol";
import {NetworkListing} from "../../script/NetworkListing.sol";
import {NetworkSeriesQualification} from "../../script/NetworkSeriesQualification.sol";
import {UpdateFeeSchedule} from "../../script/UpdateFeeSchedule.s.sol";
import {SignedObservationFixingAdapter} from "../../src/adapters/oracle/SignedObservationFixingAdapter.sol";
import {CanonicalStrategyCompiler} from "../../src/compiler/CanonicalStrategyCompiler.sol";
import {FundedFeeEngine} from "../../src/fees/FundedFeeEngine.sol";
import {IAdapterRegistry} from "../../src/interfaces/IAdapterRegistry.sol";
import {IAssetRegistry} from "../../src/interfaces/IAssetRegistry.sol";
import {IBenchmarkRegistry} from "../../src/interfaces/IBenchmarkRegistry.sol";
import {ICalendarRegistry} from "../../src/interfaces/ICalendarRegistry.sol";
import {ICollateralVault} from "../../src/interfaces/ICollateralVault.sol";
import {IFeeScheduleRegistry} from "../../src/interfaces/IFeeScheduleRegistry.sol";
import {IFundedFeeEngine} from "../../src/interfaces/IFundedFeeEngine.sol";
import {IInstrumentRegistry} from "../../src/interfaces/IInstrumentRegistry.sol";
import {IMarketRegistry} from "../../src/interfaces/IMarketRegistry.sol";
import {IRegistryStatusController} from "../../src/interfaces/IRegistryStatusController.sol";
import {IRiskDomainRegistry} from "../../src/interfaces/IRiskDomainRegistry.sol";
import {ISequencerUptimeFeed} from "../../src/interfaces/ISequencerUptimeFeed.sol";
import {ISeriesRegistry} from "../../src/interfaces/ISeriesRegistry.sol";
import {ISessionRegistry} from "../../src/interfaces/ISessionRegistry.sol";
import {ISettlementAssetRegistry} from "../../src/interfaces/ISettlementAssetRegistry.sol";
import {ITradingSessionPolicy} from "../../src/interfaces/ITradingSessionPolicy.sol";
import {FixingEvidenceLib} from "../../src/libraries/FixingEvidenceLib.sol";
import {CappedForwardPayoffModule} from "../../src/payoff/ProductionPayoffModules.sol";
import {ExecutionPolicyRegistry} from "../../src/policy/ExecutionPolicyRegistry.sol";
import {
    FixingResult,
    HistoricalObservation,
    ObservationValidationContext,
    SequencerEvidence
} from "../../src/types/FixingTypes.sol";
import {SeriesId} from "../../src/types/Identifiers.sol";
import {PriceTicks} from "../../src/types/Units.sol";
import {MarketVersion} from "../../src/types/MarketDefinition.sol";
import {CanonicalFixing, CanonicalPayoffTerms} from "../../src/types/PayoffTypes.sol";
import {SeriesDefinition} from "../../src/types/SeriesDefinition.sol";
import {FixingCandidate, FixingSlot} from "../../src/types/SeriesQualification.sol";
import {SetrynDeploymentHarness} from "./harness/SetrynDeploymentHarness.sol";

/// @notice The network bootstrap on the production deployment graph: a listing of dated range forwards registers,
/// trades today under a published session day, fixes from a threshold-signed observation through the FixingEngine, and
/// re-versions under a fee change with a byte-identical multi-day qualification. A second deployment without the
/// operator's status shortcut activates everything through RegistryStatusController.govern, as on Arbitrum Sepolia.
contract NetworkMarketsBootstrapIntegrationTest is Test {
    uint256 internal constant NOW = 1_790_830_800; // 2026-10-01T04:00:00Z
    uint64 internal constant LISTED_AT = 1_790_823_600; // 2026-10-01T03:00:00Z
    uint64 internal constant EXPIRY_DEC = 1_798_099_200; // 2026-12-24T08:00:00Z
    uint64 internal constant EXPIRY_MAR = 1_806_048_000; // 2027-03-26T08:00:00Z
    uint256 internal constant PUBLISHER_KEY = 0xA11CE;

    SetrynDeploymentHarness internal harness;
    DeploySetryn.Deployment internal d;
    BootstrapSetrynMarkets internal bootstrapper;

    address internal operator = makeAddr("network-operator");
    address internal governance = makeAddr("network-governance");
    address internal treasury = makeAddr("network-treasury");
    address internal keeper = makeAddr("network-keeper");

    function setUp() public {
        vm.warp(NOW);
        harness = new SetrynDeploymentHarness();
        bootstrapper = new BootstrapSetrynMarkets();
    }

    function test_ListingTradesTodayAndFixesFromSignedObservation() public {
        d = harness.deploy(_config(true));
        BootstrapSetrynMarkets.Runtime memory runtime = bootstrapper.bootstrap(_input(address(0)));

        assertTrue(runtime.settlementTokenMintable);
        assertEq(runtime.series.length, 3);
        assertEq(runtime.horizon.fromDay, uint32(LISTED_AT / 1 days));
        assertEq(runtime.horizon.throughDay, uint32(EXPIRY_MAR / 1 days) + 2);
        assertTrue(d.tradingSessionPolicy.isOpenForNewRisk(runtime.sessionId, 1, uint64(block.timestamp)));
        for (uint256 i; i < runtime.series.length; ++i) {
            BootstrapSetrynMarkets.SeriesRecord memory record = runtime.series[i];
            assertTrue(d.seriesRegistry.isOpenForNewRisk(record.seriesId, 1, runtime.day), record.spec.marketKey);
            assertEq(record.maxLongDebitMinorPerLot, 0, "the long pays at the fill and owes nothing at expiry");
            assertEq(record.maxShortDebitMinorPerLot, record.spec.bandMinor);
            MarketVersion memory market = d.marketRegistry.getMarket(record.marketId, 1);
            assertEq(int256(PriceTicks.unwrap(market.definition.minPriceTicks)), 0);
            assertEq(
                uint256(int256(PriceTicks.unwrap(market.definition.maxPriceTicks))),
                record.spec.bandMinor / record.spec.tickSizeMinor
            );
        }
        (address controller,) = d.collateralVault.getAccount(runtime.feeRecipientAccountId);
        assertEq(controller, treasury);

        // The December BTC range forward: floor 42,000, cap 125,000, 0.01 BTC per lot. A 97,000 fixing pays the long
        // 0.01 x (97,000 - 42,000) = 550 USDC per lot.
        BootstrapSetrynMarkets.SeriesRecord memory btc = runtime.series[0];
        CanonicalPayoffTerms memory terms = abi.decode(btc.payoffTerms, (CanonicalPayoffTerms));
        assertEq(terms.primaryStrike, 4_200_000_000_000);
        assertEq(terms.minimumTransferMinorPerLot, 0);
        assertEq(terms.maximumTransferMinorPerLot, 830_000_000);

        SeriesDefinition memory series = d.seriesRegistry.getSeries(btc.seriesId, 1).definition;
        FixingSlot[] memory slots = NetworkSeriesQualification.fixingSlots(btc.benchmarkId, series);
        FixingCandidate memory candidate = slots[0].candidates[0];
        assertEq(candidate.targetAt, EXPIRY_DEC - 1);
        assertEq(candidate.windowStartsAt, EXPIRY_DEC - 1 hours);
        assertEq(candidate.windowEndsAt, EXPIRY_DEC);

        vm.warp(EXPIRY_DEC + 5 minutes);
        HistoricalObservation[] memory observations = _observation(candidate.targetAt, 9_700_000_000_000);
        bytes memory evidence = _signedEvidence(runtime, btc.seriesId, candidate, observations);
        vm.prank(keeper);
        d.fixingEngine.submitEvidence(btc.seriesId, 1, slots, 0, 0, observations, evidence);
        // A second relay of the same signed batch is the same proposal, not a dispute.
        vm.prank(keeper);
        d.fixingEngine.submitEvidence(btc.seriesId, 1, slots, 0, 0, observations, evidence);

        vm.warp(series.correctionCutoffAt);
        vm.prank(keeper);
        FixingResult memory result = d.fixingEngine.finalizeFixing(btc.seriesId, 1, 0);
        assertEq(result.value, 9_700_000_000_000);
        assertEq(result.candidateIndex, 0);
        assertEq(
            d.cappedForwardPayoffModule.evaluatePositionLots(btc.payoffTerms, _fixings(btc, result.value), 1),
            550_000_000
        );
    }

    function test_FeeUpdateReproducesTheMultiDayQualification() public {
        d = harness.deploy(_config(true));
        BootstrapSetrynMarkets.Runtime memory runtime = bootstrapper.bootstrap(_input(address(0)));
        UpdateFeeSchedule updater = new UpdateFeeSchedule();
        UpdateFeeSchedule.SeriesTarget[] memory targets = new UpdateFeeSchedule.SeriesTarget[](runtime.series.length);
        for (uint256 i; i < targets.length; ++i) {
            targets[i] = UpdateFeeSchedule.SeriesTarget({
                marketId: runtime.series[i].marketId,
                seriesId: runtime.series[i].seriesId,
                benchmarkId: runtime.series[i].benchmarkId,
                payoffTerms: runtime.series[i].payoffTerms
            });
        }
        UpdateFeeSchedule.Result memory result = updater.applyLocal(
            UpdateFeeSchedule.FeeUpdate({
                fees: IFeeScheduleRegistry(address(d.feeScheduleRegistry)),
                feeEngine: IFundedFeeEngine(address(d.fundedFeeEngine)),
                feeScheduleId: runtime.feeScheduleId,
                makerFeeRatePpm: 250,
                takerFeeRatePpm: 2_000,
                maxChargeRatePpm: 0,
                evidenceHash: bytes32(0)
            }),
            UpdateFeeSchedule.Cascade({
                markets: IMarketRegistry(address(d.marketRegistry)),
                series: ISeriesRegistry(address(d.seriesRegistry)),
                day: 0,
                targets: targets
            }),
            operator
        );
        assertEq(result.version, 2);
        for (uint256 i; i < targets.length; ++i) {
            SeriesId seriesId = targets[i].seriesId;
            assertEq(result.seriesVersions[i], 2);
            assertTrue(d.seriesRegistry.isOpenForNewRisk(seriesId, 2, runtime.day));
            assertEq(
                d.seriesRegistry.getSeries(seriesId, 2).definition.dateAdjustmentEvidenceHash,
                d.seriesRegistry.getSeries(seriesId, 1).definition.dateAdjustmentEvidenceHash
            );
        }
    }

    function test_GovernanceActivatesThroughTheStatusController() public {
        d = harness.deploy(_config(false));
        BootstrapSetrynMarkets.Runtime memory runtime =
            bootstrapper.bootstrap(_input(address(d.registryStatusController)));
        assertEq(d.registryStatusController.governance(), governance);
        for (uint256 i; i < runtime.series.length; ++i) {
            assertTrue(d.seriesRegistry.isOpenForNewRisk(runtime.series[i].seriesId, 1, runtime.day));
        }
        assertTrue(d.tradingSessionPolicy.isOpenForNewRisk(runtime.sessionId, 1, uint64(block.timestamp)));
    }

    function test_RefusesMainnetAndForeignSepoliaSettlementTokens() public {
        d = harness.deploy(_config(true));
        BootstrapSetrynMarkets.BootstrapInput memory input = _input(address(0));
        vm.chainId(42_161);
        vm.expectRevert(abi.encodeWithSelector(BootstrapSetrynMarkets.MainnetBootstrapDisabled.selector, 42_161));
        bootstrapper.bootstrap(input);

        vm.chainId(421_614);
        input.listing.network = "arbitrum-sepolia";
        input.settlementToken = address(d.collateralVault);
        vm.expectRevert(
            abi.encodeWithSelector(BootstrapSetrynMarkets.InvalidSettlementToken.selector, address(d.collateralVault))
        );
        bootstrapper.bootstrap(input);
    }

    function _signedEvidence(
        BootstrapSetrynMarkets.Runtime memory runtime,
        SeriesId seriesId,
        FixingCandidate memory candidate,
        HistoricalObservation[] memory observations
    ) internal view returns (bytes memory) {
        bytes32[] memory hashes = new bytes32[](observations.length);
        for (uint256 i; i < observations.length; ++i) {
            hashes[i] = FixingEvidenceLib.hashObservation(observations[i]);
        }
        ObservationValidationContext memory context = ObservationValidationContext({
            chainId: block.chainid,
            fixingEngine: address(d.fixingEngine),
            seriesId: seriesId,
            seriesVersion: 1,
            slot: 0,
            candidateIndex: 0,
            benchmarkId: candidate.benchmarkId,
            benchmarkVersion: candidate.benchmarkVersion,
            benchmarkVersionHash: d.benchmarkRegistry.getBenchmark(candidate.benchmarkId, 1).versionHash,
            feedKey: keccak256("Crypto.BTC/USD"),
            requiredCapabilityHash: keccak256("SETRYN_SIGNED_OBSERVATION_FIXING_CAPABILITY_V1"),
            selectionRuleId: candidate.selectionRuleId,
            selectionParametersHash: candidate.selectionParametersHash,
            observationsHash: keccak256(
                abi.encode(FixingEvidenceLib.OBSERVATIONS_TYPEHASH, keccak256(abi.encodePacked(hashes)))
            ),
            candidateDeadline: candidate.unavailableAfter
        });
        SignedObservationFixingAdapter adapter = runtime.fixingAdapter;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(PUBLISHER_KEY, adapter.batchDigest(context, 42));
        bytes[] memory signatures = new bytes[](1);
        signatures[0] = abi.encodePacked(r, s, v);
        return abi.encode(uint64(42), signatures);
    }

    function _observation(uint64 observedAt, int256 value) internal pure returns (HistoricalObservation[] memory list) {
        list = new HistoricalObservation[](1);
        list[0] = HistoricalObservation({
            value: value,
            weight: 1,
            observedAt: observedAt,
            publishedAt: observedAt,
            providerSequence: 42,
            confidenceBps: 0,
            decimals: 8,
            finalityReference: bytes32(uint256(42)),
            itemEvidenceHash: keccak256("chainlink round 42"),
            sequencer: SequencerEvidence({
                sequencerUp: true, inRecoveryGrace: false, recoveryGraceEndsAt: 0, proofHash: keccak256("arbitrum one")
            })
        });
    }

    function _fixings(BootstrapSetrynMarkets.SeriesRecord memory record, int256 value)
        internal
        pure
        returns (bytes memory)
    {
        CanonicalFixing[] memory fixings = new CanonicalFixing[](1);
        fixings[0] =
            CanonicalFixing({slot: 0, benchmarkId: record.benchmarkId, benchmarkVersion: 1, decimals: 8, value: value});
        return abi.encode(fixings);
    }

    function _input(address statusController)
        internal
        view
        returns (BootstrapSetrynMarkets.BootstrapInput memory input)
    {
        BootstrapSetrynMarkets.Contracts memory c;
        c.assets = IAssetRegistry(address(d.assetRegistry));
        c.adapters = IAdapterRegistry(address(d.adapterRegistry));
        c.calendars = ICalendarRegistry(address(d.calendarRegistry));
        c.sessions = ISessionRegistry(address(d.sessionRegistry));
        c.settlementAssets = ISettlementAssetRegistry(address(d.settlementAssetRegistry));
        c.benchmarks = IBenchmarkRegistry(address(d.benchmarkRegistry));
        c.fees = IFeeScheduleRegistry(address(d.feeScheduleRegistry));
        c.risks = IRiskDomainRegistry(address(d.riskDomainRegistry));
        c.instruments = IInstrumentRegistry(address(d.instrumentRegistry));
        c.markets = IMarketRegistry(address(d.marketRegistry));
        c.series = ISeriesRegistry(address(d.seriesRegistry));
        c.compiler = CanonicalStrategyCompiler(address(d.strategyCompiler));
        c.payoffModule = CappedForwardPayoffModule(address(d.cappedForwardPayoffModule));
        c.executionPolicy = ExecutionPolicyRegistry(address(d.executionPolicyRegistry));
        c.tradingSessionPolicy = ITradingSessionPolicy(address(d.tradingSessionPolicy));
        c.collateralVault = ICollateralVault(address(d.collateralVault));
        c.fundedFeeEngine = FundedFeeEngine(address(d.fundedFeeEngine));
        c.portfolioRiskEngine = address(d.portfolioRiskEngine);
        c.riskAdmissionBindingRegistry = address(d.riskAdmissionBindingRegistry);
        c.orderState = address(d.orderState);
        c.atomicClearingEngine = address(d.atomicClearingEngine);
        c.privateRfqValidationGate = address(d.privateRfqValidationGate);
        c.privateRfqBook = address(d.privateRfqBook);
        c.publicOrderBook = address(d.publicOrderBook);
        c.positionEngine = address(d.positionEngine);
        c.lifecyclePolicyValidator = address(d.lifecyclePolicyValidator);
        c.signedLifecycleEngine = address(d.signedLifecycleEngine);

        input.contracts = c;
        input.operator = operator;
        input.treasuryController = treasury;
        input.acceptTreasuryControl = true;
        input.observationAge = 5 minutes;
        input.oracleSigners = new address[](1);
        input.oracleSigners[0] = vm.addr(PUBLISHER_KEY);
        input.oracleThreshold = 1;
        input.statusController = IRegistryStatusController(statusController);
        input.listing = _listing();
    }

    function _listing() internal pure returns (NetworkListing.Listing memory listing) {
        listing.network = "local";
        listing.listedAt = LISTED_AT;
        listing.families = new NetworkListing.Family[](2);
        listing.families[0] = NetworkListing.Family({
            symbol: "BTC",
            underlying: "BTC",
            feedKey: "Crypto.BTC/USD",
            assetClass: 1,
            referenceFeed: 0x6ce185860a4963106506C203335A2910413708e9,
            strategyKind: "DATED_YIELD_CARRY"
        });
        listing.families[1] = NetworkListing.Family({
            symbol: "EUR",
            underlying: "EUR/USD",
            feedKey: "FX.EUR/USD",
            assetClass: 3,
            referenceFeed: 0xA14d53bC1F1c0F31B4aA3BD109344E5009051a84,
            strategyKind: "DELIVERABLE_FORWARD"
        });
        listing.markets = new NetworkListing.Market[](3);
        listing.markets[0] = _btc("BTC-YC-24DEC26", EXPIRY_DEC);
        listing.markets[1] = _btc("BTC-YC-26MAR27", EXPIRY_MAR);
        listing.markets[2] = NetworkListing.Market({
            marketKey: "EURUSD-FW-24DEC26",
            family: 1,
            displayName: "EUR/USD Dated Forward \xc2\xb7 24 Dec 26",
            expiryAt: EXPIRY_DEC,
            floorE8: 91_000_000,
            capE8: 136_000_000,
            floor: "0.91",
            cap: "1.36",
            lotSize: "10000",
            tickPrice: "0.00001",
            priceDecimals: 5,
            priceScale: 100_000,
            tickSizeMinor: 100_000,
            payoffMultiplierNumerator: 10_000_000_000,
            payoffMultiplierDenominator: 100_000_000,
            bandMinor: 4_500_000_000,
            maxOrderLots: 100
        });
    }

    function _btc(string memory marketKey, uint64 expiryAt) internal pure returns (NetworkListing.Market memory) {
        return NetworkListing.Market({
            marketKey: marketKey,
            family: 0,
            displayName: "BTC Dated Forward",
            expiryAt: expiryAt,
            floorE8: 4_200_000_000_000,
            capE8: 12_500_000_000_000,
            floor: "42000",
            cap: "125000",
            lotSize: "0.01",
            tickPrice: "1",
            priceDecimals: 0,
            priceScale: 1,
            tickSizeMinor: 10_000,
            payoffMultiplierNumerator: 10_000,
            payoffMultiplierDenominator: 100_000_000,
            bandMinor: 830_000_000,
            maxOrderLots: 100
        });
    }

    function _config(bool operatorStatusShortcut) internal returns (DeploySetryn.DeploymentConfig memory) {
        return DeploySetryn.DeploymentConfig({
            bootstrapAdmin: address(harness),
            governanceAdmin: governance,
            governanceOperator: operator,
            guardian: makeAddr("network-guardian"),
            excessRecovery: makeAddr("network-excess"),
            privacyKeyPublisher: makeAddr("network-privacy"),
            lifecycleWitnessStager: makeAddr("network-witness"),
            defaultAdminDelay: 2 days,
            maxLockDuration: 30 days,
            evaluationGasHardCap: 2_000_000,
            maximumRiskAdapterGas: 500_000,
            maximumRiskObservationAge: 5 minutes,
            operationalReadGas: 500_000,
            operationalExecutionGas: 800_000,
            maximumOrderLifetime: 30 days,
            maximumRfqCapacityTail: 1 days,
            sequencerRecoveryGrace: 1,
            deploymentId: keccak256("SetrynNetworkMarketsBootstrapV1"),
            sequencerFeed: ISequencerUptimeFeed(address(0)),
            statusGovernance: operatorStatusShortcut ? operator : governance,
            retainOperatorStatusRoles: operatorStatusShortcut,
            treasuryController: treasury
        });
    }
}
