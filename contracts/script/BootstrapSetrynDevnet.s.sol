// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Script} from "forge-std/Script.sol";

import {CanonicalStrategyCompiler} from "../src/compiler/CanonicalStrategyCompiler.sol";
import {DevnetMarketAdapter} from "../src/devnet/DevnetMarketAdapter.sol";
import {DevnetSettlementToken} from "../src/devnet/DevnetSettlementToken.sol";
import {IAdapterRegistry} from "../src/interfaces/IAdapterRegistry.sol";
import {IAssetRegistry} from "../src/interfaces/IAssetRegistry.sol";
import {IBenchmarkRegistry} from "../src/interfaces/IBenchmarkRegistry.sol";
import {ICalendarRegistry} from "../src/interfaces/ICalendarRegistry.sol";
import {IFeeScheduleRegistry} from "../src/interfaces/IFeeScheduleRegistry.sol";
import {ICollateralVault} from "../src/interfaces/ICollateralVault.sol";
import {IInstrumentRegistry} from "../src/interfaces/IInstrumentRegistry.sol";
import {IMarketRegistry} from "../src/interfaces/IMarketRegistry.sol";
import {IRiskDomainRegistry} from "../src/interfaces/IRiskDomainRegistry.sol";
import {ISeriesRegistry} from "../src/interfaces/ISeriesRegistry.sol";
import {ISettlementAssetRegistry} from "../src/interfaces/ISettlementAssetRegistry.sol";
import {ISessionRegistry} from "../src/interfaces/ISessionRegistry.sol";
import {ITradingSessionPolicy} from "../src/interfaces/ITradingSessionPolicy.sol";
import {AdapterDefinitionLib} from "../src/libraries/AdapterDefinitionLib.sol";
import {CalendarDefinitionLib} from "../src/libraries/CalendarDefinitionLib.sol";
import {BenchmarkDefinitionLib} from "../src/libraries/BenchmarkDefinitionLib.sol";
import {FeeScheduleDefinitionLib} from "../src/libraries/FeeScheduleDefinitionLib.sol";
import {FeeEngineLib} from "../src/libraries/FeeEngineLib.sol";
import {InstrumentDefinitionLib} from "../src/libraries/InstrumentDefinitionLib.sol";
import {MarketDefinitionLib} from "../src/libraries/MarketDefinitionLib.sol";
import {RiskDomainDefinitionLib} from "../src/libraries/RiskDomainDefinitionLib.sol";
import {SeriesDefinitionLib} from "../src/libraries/SeriesDefinitionLib.sol";
import {SessionDefinitionLib} from "../src/libraries/SessionDefinitionLib.sol";
import {CappedForwardPayoffModule} from "../src/payoff/ProductionPayoffModules.sol";
import {ExecutionPolicyRegistry} from "../src/policy/ExecutionPolicyRegistry.sol";
import {FundedFeeEngine} from "../src/fees/FundedFeeEngine.sol";
import {AdapterDefinition} from "../src/types/AdapterDefinition.sol";
import {AssetDefinition} from "../src/types/AssetDefinition.sol";
import {BenchmarkDefinition} from "../src/types/BenchmarkDefinition.sol";
import {CalendarDay, CalendarDefinition} from "../src/types/CalendarDefinition.sol";
import {AssetClass} from "../src/types/Enums.sol";
import {FeeScheduleDefinition} from "../src/types/FeeScheduleDefinition.sol";
import {FeeRecipient, FeeRecipientSet, FeeRule, FeeTier} from "../src/types/FeeEngineTypes.sol";
import {
    AdapterId,
    AdapterKindId,
    AssetId,
    BenchmarkId,
    CalendarId,
    AccountId,
    FeeActionId,
    FeeRemainderPolicyId,
    FeeScheduleId,
    InstrumentId,
    MarketId,
    PayoffFamilyId,
    RiskDomainId,
    SeriesId,
    SessionId
} from "../src/types/Identifiers.sol";
import {InstrumentDefinition} from "../src/types/InstrumentDefinition.sol";
import {MarketDefinition} from "../src/types/MarketDefinition.sol";
import {OrderActionId} from "../src/types/OrderTypes.sol";
import {
    CanonicalFixing,
    PayoffFixingRequirement,
    PayoffKind,
    StrategyCompileInput,
    StrategyCompileResult,
    StrategyInputMode
} from "../src/types/PayoffTypes.sol";
import {RiskDomainDefinition} from "../src/types/RiskDomainDefinition.sol";
import {SeriesDefinition} from "../src/types/SeriesDefinition.sol";
import {
    CalendarDayProof,
    FixingCandidate,
    FixingSlot,
    SeriesDateKind,
    SeriesDateProof,
    SeriesQualificationData
} from "../src/types/SeriesQualification.sol";
import {SessionDay, SessionDefinition, SessionWindow} from "../src/types/SessionDefinition.sol";
import {SettlementAssetDefinition} from "../src/types/SettlementAssetDefinition.sol";
import {FeeRatePpm, Lots, PriceTicks, TickSizeMinor} from "../src/types/Units.sol";

contract BootstrapSetrynDevnet is Script {
    uint256 private constant ARBITRUM_ONE_CHAIN_ID = 42161;
    uint256 private constant ARBITRUM_SEPOLIA_CHAIN_ID = 421614;
    uint32 private constant VERSION = 1;
    bytes32 private constant NAMESPACE = keccak256("SETRYN_GENESIS_MARKETS_V1");
    bytes32 private constant EXECUTION_MODE_SET = keccak256("SETRYN_EXECUTION_MODE_SET_GENESIS_V1");
    bytes32 private constant EXECUTION_MODE_PUBLIC_BOOK = keccak256("SETRYN_EXECUTION_MODE_PUBLIC_BOOK_V1");
    bytes32 private constant BENCHMARK_INTERFACE = keccak256("SETRYN_FIXING_OBSERVATION_INTERFACE_V1");
    bytes32 private constant BENCHMARK_CAPABILITY = keccak256("SETRYN_DEVNET_FIXING_CAPABILITY_V1");
    bytes32 private constant RISK_INTERFACE = keccak256("SETRYN_PORTFOLIO_RISK_INTERFACE_V1");
    bytes32 private constant RISK_CAPABILITY = keccak256("SETRYN_DEVNET_PORTFOLIO_RISK_V1");
    bytes32 private constant PAYOFF_INTERFACE = keccak256("SETRYN_SERIES_PAYOFF_INTERFACE_V1");
    bytes32 private constant PAYOFF_CAPABILITY = keccak256("SETRYN_EXACT_LOTS_PAYOFF_V1");
    bytes32 private constant TERMS_SCHEMA = keccak256("SETRYN_CANONICAL_CAPPED_FORWARD_TERMS_V1");

    error PublicNetworkBootstrapDisabled(uint256 chainId);
    error InvalidDependency(string name);
    error UnexpectedVersion(string name, uint32 version);

    struct Contracts {
        IAssetRegistry assets;
        IAdapterRegistry adapters;
        ICalendarRegistry calendars;
        ISessionRegistry sessions;
        ISettlementAssetRegistry settlementAssets;
        IBenchmarkRegistry benchmarks;
        IFeeScheduleRegistry fees;
        IRiskDomainRegistry risks;
        IInstrumentRegistry instruments;
        IMarketRegistry markets;
        ISeriesRegistry series;
        CanonicalStrategyCompiler compiler;
        CappedForwardPayoffModule payoffModule;
        ExecutionPolicyRegistry executionPolicy;
        ITradingSessionPolicy tradingSessionPolicy;
        ICollateralVault collateralVault;
        FundedFeeEngine fundedFeeEngine;
        address portfolioRiskEngine;
        address riskAdmissionBindingRegistry;
        address orderState;
        address atomicClearingEngine;
        address privateRfqValidationGate;
        address privateRfqBook;
        address publicOrderBook;
        address positionEngine;
        address lifecyclePolicyValidator;
        address signedLifecycleEngine;
    }

    struct Runtime {
        DevnetSettlementToken settlementToken;
        DevnetMarketAdapter marketAdapter;
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
        AccountId feeRecipientAccountId;
        bytes payoffTerms;
        uint128 maxLongDebitMinorPerLot;
        uint128 maxShortDebitMinorPerLot;
        uint32 day;
    }

    struct Schedule {
        uint64 tradingStartsAt;
        uint64 lastTradingAt;
        uint64 expiryAt;
        uint64 exerciseOpensAt;
        uint64 exerciseCutoffAt;
        uint64 fixingWindowOpen;
        uint64 fixingWindowClose;
        uint64 primaryEvidenceDeadline;
        uint64 correctionCutoffAt;
        uint64 finalResolutionAt;
        uint64 settlementDeadline;
    }

    function run() external returns (Runtime memory runtime) {
        if (block.chainid == ARBITRUM_ONE_CHAIN_ID || block.chainid == ARBITRUM_SEPOLIA_CHAIN_ID) {
            revert PublicNetworkBootstrapDisabled(block.chainid);
        }

        Contracts memory c = _loadContracts();
        address operator = vm.envAddress("SETRYN_GOVERNANCE_OPERATOR");
        uint64 observationAge = uint64(vm.envOr("SETRYN_MAXIMUM_RISK_OBSERVATION_AGE", uint256(5 minutes)));
        runtime.day = uint32(block.timestamp / 1 days);
        Schedule memory schedule = _schedule(runtime.day);

        vm.startBroadcast(operator);
        runtime.settlementToken = new DevnetSettlementToken();
        runtime.marketAdapter = new DevnetMarketAdapter(c.risks, c.adapters, observationAge);
        _registerAssets(c, runtime);
        _registerAdapters(c, runtime);
        (runtime.calendarId, runtime.sessionId) = _registerCalendarAndSession(c, runtime.day, schedule);
        _registerSettlementBinding(c, runtime);
        runtime.benchmarkId = _registerBenchmark(c, runtime);
        runtime.feeRecipientAccountId = c.collateralVault.createAccount(keccak256("SETRYN_PROTOCOL_FEES_DEVNET_V1"));
        (FeeRule[] memory feeRules, FeeRecipientSet memory feeRecipients) =
            _feeWitness(runtime.feeRecipientAccountId);
        runtime.feeScheduleId = _registerFeeSchedule(c, runtime, feeRules, feeRecipients);
        c.fundedFeeEngine.installScheduleWitness(runtime.feeScheduleId, VERSION, feeRules, feeRecipients);
        runtime.riskDomainId = _registerRiskDomain(c, runtime);
        runtime.instrumentId = _registerInstrument(c, runtime);
        runtime.marketId = _registerMarket(c, runtime);
        (
            runtime.seriesId,
            runtime.payoffTerms,
            runtime.maxLongDebitMinorPerLot,
            runtime.maxShortDebitMinorPerLot
        ) = _registerSeries(c, runtime, schedule);
        c.executionPolicy.setExecutionMode(EXECUTION_MODE_SET, EXECUTION_MODE_PUBLIC_BOOK, true);
        c.executionPolicy.setOrderAction(OrderActionId.wrap(keccak256("SETRYN_ORDER_ACTION_ENTER_V1")), true);
        _publishSessionDay(c, runtime.sessionId, runtime.day, schedule);
        vm.stopBroadcast();

        _writeRuntime(c, runtime, operator, vm.envString("SETRYN_RUNTIME_OUTPUT"));
    }

    function _registerAssets(Contracts memory c, Runtime memory runtime) private {
        runtime.baseAssetId = c.assets
            .registerAsset(
                AssetDefinition({
                    namespaceId: NAMESPACE,
                    referenceId: keccak256("SETRYN_ASSET_BTC"),
                    symbol: bytes32("BTC"),
                    assetClass: AssetClass.Crypto,
                    decimals: 8
                })
            );
        runtime.settlementAssetId = c.assets
            .registerAsset(
                AssetDefinition({
                    namespaceId: NAMESPACE,
                    referenceId: keccak256("SETRYN_ASSET_DEVNET_USD"),
                    symbol: bytes32("sUSD"),
                    assetClass: AssetClass.Stablecoin,
                    decimals: 6
                })
            );
    }

    function _registerAdapters(Contracts memory c, Runtime memory runtime) private {
        (runtime.benchmarkAdapterId,) = c.adapters
            .registerAdapter(
                _adapter(
                    keccak256("SETRYN_ADAPTER_DEVNET_FIXING"),
                    AdapterDefinitionLib.ADAPTER_KIND_BENCHMARK,
                    address(runtime.marketAdapter),
                    BENCHMARK_INTERFACE,
                    BENCHMARK_CAPABILITY
                )
            );
        (runtime.riskAdapterId,) = c.adapters
            .registerAdapter(
                _adapter(
                    keccak256("SETRYN_ADAPTER_DEVNET_RISK"),
                    AdapterDefinitionLib.ADAPTER_KIND_RISK,
                    address(runtime.marketAdapter),
                    RISK_INTERFACE,
                    RISK_CAPABILITY
                )
            );
        (runtime.payoffAdapterId,) = c.adapters
            .registerAdapter(
                _adapter(
                    keccak256("SETRYN_ADAPTER_CAPPED_FORWARD"),
                    AdapterDefinitionLib.ADAPTER_KIND_PAYOFF,
                    address(c.payoffModule),
                    PAYOFF_INTERFACE,
                    PAYOFF_CAPABILITY
                )
            );
        c.adapters.activateAdapter(runtime.benchmarkAdapterId, VERSION);
        c.adapters.activateAdapter(runtime.riskAdapterId, VERSION);
        c.adapters.activateAdapter(runtime.payoffAdapterId, VERSION);
    }

    function _registerCalendarAndSession(Contracts memory c, uint32 day, Schedule memory schedule)
        private
        returns (CalendarId calendarId, SessionId sessionId)
    {
        CalendarDefinition memory calendar = CalendarDefinition({
            namespaceId: NAMESPACE,
            referenceId: keccak256("SETRYN_CALENDAR_CONTINUOUS_UTC"),
            timeZoneId: keccak256("Etc/UTC"),
            weekendMask: 0,
            validFromDay: day,
            validThroughDay: day,
            dayStatusRoot: bytes32(uint256(1)),
            ruleSetHash: keccak256("SETRYN_CONTINUOUS_CALENDAR_RULES_V1"),
            sourceHash: keccak256("SETRYN_LOCAL_CHAIN_CLOCK_V1")
        });
        calendarId = CalendarDefinitionLib.deriveCalendarId(calendar);
        CalendarDay memory calendarDay = _calendarDay(day);
        calendar.dayStatusRoot = CalendarDefinitionLib.hashDay(calendarId, calendarDay);
        uint32 calendarVersion;
        (calendarId, calendarVersion) = c.calendars.registerCalendar(calendar);
        _requireVersion("calendar", calendarVersion);
        c.calendars.activateCalendar(calendarId, calendarVersion);

        SessionWindow[] memory windows = _sessionWindows(day, schedule);
        SessionDefinition memory session = SessionDefinition({
            namespaceId: NAMESPACE,
            referenceId: keccak256("SETRYN_SESSION_CONTINUOUS_UTC"),
            calendarId: calendarId,
            calendarVersion: calendarVersion,
            validFromDay: day,
            validThroughDay: day,
            dayScheduleRoot: bytes32(uint256(1)),
            windowKindSetHash: keccak256(
                abi.encode(
                    SessionDefinitionLib.WINDOW_KIND_TRADING,
                    SessionDefinitionLib.WINDOW_KIND_FIXING,
                    SessionDefinitionLib.WINDOW_KIND_MAINTENANCE
                )
            ),
            ruleSetHash: keccak256("SETRYN_CONTINUOUS_SESSION_RULES_V1"),
            sourceHash: keccak256("SETRYN_LOCAL_SESSION_SOURCE_V1")
        });
        sessionId = SessionDefinitionLib.deriveSessionId(session);
        SessionDay memory sessionDay = SessionDay({
            day: day,
            windowsHash: c.sessions.hashWindows(windows),
            evidenceHash: keccak256("SETRYN_LOCAL_SESSION_DAY_V1")
        });
        session.dayScheduleRoot = SessionDefinitionLib.hashDay(sessionId, sessionDay);
        uint32 sessionVersion;
        (sessionId, sessionVersion) = c.sessions.registerSession(session);
        _requireVersion("session", sessionVersion);
        c.sessions.activateSession(sessionId, sessionVersion);
    }

    function _registerSettlementBinding(Contracts memory c, Runtime memory runtime) private {
        uint32 version = c.settlementAssets
            .registerBinding(
                SettlementAssetDefinition({
                    assetId: runtime.settlementAssetId,
                    token: address(runtime.settlementToken),
                    expectedRuntimeCodeHash: address(runtime.settlementToken).codehash,
                    qualificationHash: keccak256("SETRYN_DEVNET_USD_BINDING_V1")
                })
            );
        _requireVersion("settlement asset", version);
        c.settlementAssets.activateBinding(runtime.settlementAssetId, version);
    }

    function _registerBenchmark(Contracts memory c, Runtime memory runtime) private returns (BenchmarkId id) {
        BenchmarkDefinition memory definition = BenchmarkDefinition({
            namespaceId: NAMESPACE,
            referenceId: keccak256("SETRYN_BENCHMARK_BTC_USD"),
            kindId: BenchmarkDefinitionLib.BENCHMARK_KIND_SETTLEMENT_FIXING,
            baseAssetId: runtime.baseAssetId,
            quoteAssetId: runtime.settlementAssetId,
            adapterId: runtime.benchmarkAdapterId,
            adapterVersion: VERSION,
            calendarId: runtime.calendarId,
            calendarVersion: VERSION,
            sessionId: runtime.sessionId,
            sessionVersion: VERSION,
            feedKey: keccak256("Crypto.BTC/USD"),
            requiredInterfaceHash: BENCHMARK_INTERFACE,
            requiredCapabilityHash: BENCHMARK_CAPABILITY,
            outputDecimals: 8,
            maxStalenessSeconds: 120,
            maxFutureSkewSeconds: 5,
            maxConfidenceBps: 100,
            observationRuleHash: keccak256("SETRYN_BTC_USD_OBSERVATION_RULE_V1"),
            fallbackPolicyHash: keccak256("SETRYN_BTC_USD_FALLBACK_POLICY_V1"),
            disruptionPolicyHash: keccak256("SETRYN_BTC_USD_DISRUPTION_POLICY_V1"),
            dataRightsHash: keccak256("SETRYN_DEVNET_DATA_RIGHTS_V1"),
            evidenceHash: keccak256("SETRYN_BTC_USD_BENCHMARK_EVIDENCE_V1")
        });
        uint32 version;
        (id, version) = c.benchmarks.registerBenchmark(definition);
        _requireVersion("benchmark", version);
        c.benchmarks.activateBenchmark(id, version);
    }

    function _registerFeeSchedule(
        Contracts memory c,
        Runtime memory runtime,
        FeeRule[] memory rules,
        FeeRecipientSet memory recipients
    ) private returns (FeeScheduleId id) {
        FeeScheduleDefinition memory definition = FeeScheduleDefinition({
            namespaceId: NAMESPACE,
            scheduleKey: keccak256("SETRYN_FEE_SCHEDULE_STANDARD_V1"),
            feeModelId: FeeScheduleDefinitionLib.FEE_MODEL_MAKER_TAKER,
            settlementAssetId: runtime.settlementAssetId,
            settlementAssetVersion: VERSION,
            feeRulesHash: FeeEngineLib.hashRules(rules),
            recipientsHash: FeeEngineLib.hashRecipients(recipients),
            maxChargeRatePpm: FeeRatePpm.wrap(10_000),
            maxRebateRatePpm: FeeRatePpm.wrap(5_000),
            maxFlatChargeBaseUnits: 10e6,
            maxFlatRebateBaseUnits: 5e6,
            evidenceHash: keccak256("SETRYN_FEE_SCHEDULE_EVIDENCE_V1")
        });
        uint32 version;
        (id, version) = c.fees.registerFeeSchedule(definition);
        _requireVersion("fee schedule", version);
        c.fees.activateFeeSchedule(id, version);
    }

    function _feeWitness(AccountId recipientAccountId)
        private
        pure
        returns (FeeRule[] memory rules, FeeRecipientSet memory recipients)
    {
        rules = new FeeRule[](2);
        rules[0] = FeeRule({
            actionId: FeeScheduleDefinitionLib.FEE_ACTION_MAKER_FILL,
            requiresOpenSchedule: true,
            chargeRatePpm: FeeRatePpm.wrap(500),
            rebateRatePpm: FeeRatePpm.wrap(0),
            flatChargeMinor: 0,
            flatRebateMinor: 0,
            tiers: new FeeTier[](0)
        });
        rules[1] = FeeRule({
            actionId: FeeScheduleDefinitionLib.FEE_ACTION_TAKER_FILL,
            requiresOpenSchedule: true,
            chargeRatePpm: FeeRatePpm.wrap(1_000),
            rebateRatePpm: FeeRatePpm.wrap(0),
            flatChargeMinor: 0,
            flatRebateMinor: 0,
            tiers: new FeeTier[](0)
        });
        if (FeeActionId.unwrap(rules[0].actionId) > FeeActionId.unwrap(rules[1].actionId)) {
            FeeRule memory first = rules[0];
            rules[0] = rules[1];
            rules[1] = first;
        }

        FeeRecipient[] memory entries = new FeeRecipient[](1);
        entries[0] = FeeRecipient({accountId: recipientAccountId, sharePpm: 1_000_000});
        recipients = FeeRecipientSet({
            remainderPolicyId: FeeRemainderPolicyId.wrap(
                keccak256("SetrynFeeRemainderPolicyV1:DesignatedRecipient")
            ),
            remainderRecipientIndex: 0,
            recipients: entries
        });
    }

    function _registerRiskDomain(Contracts memory c, Runtime memory runtime) private returns (RiskDomainId id) {
        RiskDomainDefinition memory definition = RiskDomainDefinition({
            namespaceId: NAMESPACE,
            domainKey: keccak256("SETRYN_RISK_DOMAIN_BTC_USD_ISOLATED_V1"),
            riskModelId: RiskDomainDefinitionLib.RISK_MODEL_ISOLATED_MARGIN,
            collateralAssetId: runtime.settlementAssetId,
            collateralAssetVersion: VERSION,
            riskAdapterId: runtime.riskAdapterId,
            riskAdapterVersion: VERSION,
            requiredAdapterKindId: AdapterDefinitionLib.ADAPTER_KIND_RISK,
            requiredInterfaceHash: RISK_INTERFACE,
            requiredCapabilityHash: RISK_CAPABILITY,
            marginRulesHash: keccak256("SETRYN_BTC_USD_MARGIN_RULES_V1"),
            scenarioSetHash: keccak256("SETRYN_BTC_USD_SCENARIO_SET_V1"),
            concentrationRulesHash: keccak256("SETRYN_BTC_USD_CONCENTRATION_RULES_V1"),
            defaultProcessHash: keccak256("SETRYN_BTC_USD_DEFAULT_PROCESS_V1"),
            insurancePolicyHash: keccak256("SETRYN_BTC_USD_INSURANCE_POLICY_V1"),
            qualificationEvidenceHash: keccak256("SETRYN_BTC_USD_RISK_EVIDENCE_V1"),
            maxOpenInterestBaseUnits: 100_000_000e6,
            maxAggregateLiabilityBaseUnits: 50_000_000e6,
            maxAccountLiabilityBaseUnits: 5_000_000e6,
            maxAggregateReservationBaseUnits: 25_000_000e6,
            maxAccountReservationBaseUnits: 2_500_000e6
        });
        uint32 version;
        (id, version) = c.risks.registerRiskDomain(definition);
        _requireVersion("risk domain", version);
        c.risks.activateRiskDomain(id, version);
    }

    function _registerInstrument(Contracts memory c, Runtime memory runtime) private returns (InstrumentId id) {
        InstrumentDefinition memory definition = InstrumentDefinition({
            namespaceId: NAMESPACE,
            instrumentKey: keccak256("SETRYN_INSTRUMENT_CAPPED_FORWARD_V1"),
            payoffFamilyId: PayoffFamilyId.wrap(keccak256("SETRYN_CAPPED_FORWARD_V1")),
            settlementClassId: InstrumentDefinitionLib.SETTLEMENT_CLASS_CASH,
            payoffModuleId: runtime.payoffAdapterId,
            payoffModuleVersion: VERSION,
            requiredAdapterKindId: AdapterDefinitionLib.ADAPTER_KIND_PAYOFF,
            requiredInterfaceHash: PAYOFF_INTERFACE,
            requiredCapabilityHash: PAYOFF_CAPABILITY,
            termsSchemaHash: TERMS_SCHEMA,
            maxFixingSlots: 4,
            maxTermsBytes: 2_048,
            maxEvaluationGas: 500_000,
            lifecyclePolicyHash: keccak256("SETRYN_CAPPED_FORWARD_LIFECYCLE_V1"),
            qualificationEvidenceHash: keccak256("SETRYN_CAPPED_FORWARD_INSTRUMENT_EVIDENCE_V1")
        });
        uint32 version;
        (id, version) = c.instruments.registerInstrument(definition);
        _requireVersion("instrument", version);
        c.instruments.activateInstrument(id, version);
    }

    function _registerMarket(Contracts memory c, Runtime memory runtime) private returns (MarketId id) {
        MarketDefinition memory definition = MarketDefinition({
            namespaceId: NAMESPACE,
            marketKey: keccak256("SETRYN_MARKET_BTC_USD_CAPPED_FORWARD_V1"),
            baseAssetId: runtime.baseAssetId,
            quoteAssetId: runtime.settlementAssetId,
            settlementAssetId: runtime.settlementAssetId,
            settlementAssetVersion: VERSION,
            markBenchmarkId: runtime.benchmarkId,
            markBenchmarkVersion: VERSION,
            tradingCalendarId: runtime.calendarId,
            tradingCalendarVersion: VERSION,
            tradingSessionId: runtime.sessionId,
            tradingSessionVersion: VERSION,
            riskDomainId: runtime.riskDomainId,
            riskDomainVersion: VERSION,
            feeScheduleId: runtime.feeScheduleId,
            feeScheduleVersion: VERSION,
            quoteUnitId: MarketDefinitionLib.QUOTE_UNIT_SETTLEMENT_MINOR_PER_LOT,
            tickSizeMinor: TickSizeMinor.wrap(100_000),
            lotStep: Lots.wrap(1),
            minOrderLots: Lots.wrap(1),
            maxOrderLots: Lots.wrap(10),
            minPriceTicks: PriceTicks.wrap(-1_000_000_000),
            maxPriceTicks: PriceTicks.wrap(1_000_000_000),
            executionModeSetHash: EXECUTION_MODE_SET,
            qualificationEvidenceHash: keccak256("SETRYN_BTC_USD_MARKET_EVIDENCE_V1")
        });
        uint32 version;
        (id, version) = c.markets.registerMarket(definition);
        _requireVersion("market", version);
        c.markets.activateMarket(id, version);
    }

    function _registerSeries(Contracts memory c, Runtime memory runtime, Schedule memory schedule)
        private
        returns (
            SeriesId id,
            bytes memory payoffTerms,
            uint128 maxLongDebitMinorPerLot,
            uint128 maxShortDebitMinorPerLot
        )
    {
        PayoffFixingRequirement[] memory requirements = new PayoffFixingRequirement[](1);
        requirements[0] = PayoffFixingRequirement({
            slot: 0,
            benchmarkId: runtime.benchmarkId,
            benchmarkVersion: VERSION,
            windowKindId: SessionDefinitionLib.WINDOW_KIND_FIXING,
            decimals: 8
        });
        StrategyCompileInput memory input = StrategyCompileInput({
            kind: PayoffKind.CappedForward,
            inputMode: StrategyInputMode.Outright,
            valueDecimals: 8,
            primaryInput: 100_000e8,
            secondaryInput: 0,
            premiumMinorPerLot: 0,
            multiplierNumerator: 1e6,
            multiplierDenominator: 1e8,
            minimumTransferMinorPerLot: -1_000e6,
            maximumTransferMinorPerLot: 1_000e6,
            disruptionTransferMinorPerLot: 0,
            fixingRequirements: requirements,
            previewFixings: new CanonicalFixing[](0),
            previewLots: Lots.wrap(0),
            cashPriceTicks: PriceTicks.wrap(0),
            cashTickSizeMinor: TickSizeMinor.wrap(0)
        });
        StrategyCompileResult memory compiled = c.compiler.compileStrategy(input);
        payoffTerms = compiled.canonicalTerms;
        maxLongDebitMinorPerLot = compiled.maxLongDebitMinorPerLot;
        maxShortDebitMinorPerLot = compiled.maxShortDebitMinorPerLot;
        SeriesDefinition memory definition = _seriesDefinition(runtime, schedule, compiled);
        SeriesQualificationData memory qualification = _qualification(runtime, definition, compiled.canonicalTerms);
        definition.payoffTermsHash = c.series.hashPayoffTerms(TERMS_SCHEMA, qualification.payoffTerms);
        definition.fixingSlotsHash = c.series.hashFixingSlots(definition, qualification.fixingSlots, 4);
        definition.dateAdjustmentEvidenceHash = c.series.hashDateProofs(definition, qualification.dateProofs);

        uint32 version;
        (id, version) = c.series.registerSeries(definition, qualification);
        _requireVersion("series", version);
        c.series.activateSeries(id, version, qualification);
    }

    function _seriesDefinition(Runtime memory runtime, Schedule memory schedule, StrategyCompileResult memory compiled)
        private
        pure
        returns (SeriesDefinition memory)
    {
        return SeriesDefinition({
            namespaceId: NAMESPACE,
            seriesKey: keccak256("SETRYN_SERIES_BTC_USD_GENESIS_V1"),
            marketId: runtime.marketId,
            marketVersion: VERSION,
            instrumentId: runtime.instrumentId,
            instrumentVersion: VERSION,
            tradingStartsAt: schedule.tradingStartsAt,
            lastTradingAt: schedule.lastTradingAt,
            expiryAt: schedule.expiryAt,
            exerciseOpensAt: schedule.exerciseOpensAt,
            exerciseCutoffAt: schedule.exerciseCutoffAt,
            fixingWindowOpen: schedule.fixingWindowOpen,
            fixingWindowClose: schedule.fixingWindowClose,
            primaryEvidenceDeadline: schedule.primaryEvidenceDeadline,
            correctionCutoffAt: schedule.correctionCutoffAt,
            finalResolutionAt: schedule.finalResolutionAt,
            settlementDeadline: schedule.settlementDeadline,
            exercisePolicyId: SeriesDefinitionLib.EXERCISE_POLICY_HOLDER_ELECTION,
            automaticExerciseThresholdMinor: 0,
            disruptionOutcomeId: SeriesDefinitionLib.DISRUPTION_OUTCOME_FLAT,
            terminalDisruptionTransferMinorPerLot: 0,
            payoffTermsHash: bytes32(uint256(1)),
            fixingSlotsHash: bytes32(uint256(1)),
            dateAdjustmentEvidenceHash: bytes32(uint256(1)),
            maxLongDebitMinorPerLot: compiled.maxLongDebitMinorPerLot,
            maxShortDebitMinorPerLot: compiled.maxShortDebitMinorPerLot,
            qualificationEvidenceHash: keccak256("SETRYN_BTC_USD_SERIES_EVIDENCE_V1")
        });
    }

    function _qualification(Runtime memory runtime, SeriesDefinition memory definition, bytes memory payoffTerms)
        private
        pure
        returns (SeriesQualificationData memory qualification)
    {
        qualification.payoffTerms = payoffTerms;
        qualification.fixingSlots = new FixingSlot[](1);
        qualification.fixingSlots[0].slot = 0;
        qualification.fixingSlots[0].candidates = new FixingCandidate[](1);
        qualification.fixingSlots[0].candidates[0] = FixingCandidate({
            benchmarkId: runtime.benchmarkId,
            benchmarkVersion: VERSION,
            requiredWindowKindId: SessionDefinitionLib.WINDOW_KIND_FIXING,
            selectionRuleId: SeriesDefinitionLib.FIXING_SELECTION_OFFICIAL,
            targetAt: definition.fixingWindowOpen + 15 minutes,
            windowStartsAt: definition.fixingWindowOpen,
            windowEndsAt: definition.fixingWindowOpen + 30 minutes,
            unavailableAfter: definition.fixingWindowClose + 30 minutes,
            maxPublicationLagSeconds: 30 minutes,
            minimumObservations: 1,
            maximumObservations: 1,
            selectionParametersHash: keccak256("SETRYN_BTC_USD_FIXING_SELECTION_V1")
        });

        qualification.dateProofs = new SeriesDateProof[](11);
        CalendarDay memory calendarDay = _calendarDay(runtime.day);
        for (uint8 rawKind = 1; rawKind <= 11; ++rawKind) {
            uint256 index = uint256(rawKind) - 1;
            qualification.dateProofs[index].kind = SeriesDateKind(rawKind);
            qualification.dateProofs[index].conventionId = SeriesDefinitionLib.DATE_ADJUSTMENT_UNADJUSTED;
            qualification.dateProofs[index].scheduledDay = runtime.day;
            qualification.dateProofs[index].calendarDays = new CalendarDayProof[](1);
            qualification.dateProofs[index].calendarDays[0].calendarDay = calendarDay;
            qualification.dateProofs[index].calendarDays[0].merkleProof = new bytes32[](0);
        }
    }

    function _publishSessionDay(Contracts memory c, SessionId sessionId, uint32 day, Schedule memory schedule) private {
        SessionWindow[] memory windows = _sessionWindows(day, schedule);
        SessionDay memory sessionDay = SessionDay({
            day: day,
            windowsHash: c.sessions.hashWindows(windows),
            evidenceHash: keccak256("SETRYN_LOCAL_SESSION_DAY_V1")
        });
        c.tradingSessionPolicy.publishSessionDay(sessionId, VERSION, sessionDay, windows, new bytes32[](0));
    }

    function _sessionWindows(uint32 day, Schedule memory schedule)
        private
        pure
        returns (SessionWindow[] memory windows)
    {
        uint64 dayStart = uint64(uint256(day) * 1 days);
        windows = new SessionWindow[](2);
        windows[0] = SessionWindow({
            kindId: SessionDefinitionLib.WINDOW_KIND_TRADING,
            opensAt: dayStart + 8 hours,
            closesAt: dayStart + 22 hours,
            policyHash: keccak256("SETRYN_CONTINUOUS_TRADING_WINDOW_V1")
        });
        windows[1] = SessionWindow({
            kindId: SessionDefinitionLib.WINDOW_KIND_FIXING,
            opensAt: schedule.fixingWindowOpen,
            closesAt: schedule.fixingWindowClose,
            policyHash: keccak256("SETRYN_BTC_USD_FIXING_WINDOW_V1")
        });
    }

    function _calendarDay(uint32 day) private pure returns (CalendarDay memory) {
        return CalendarDay({day: day, isBusinessDay: true, evidenceHash: keccak256("SETRYN_LOCAL_CALENDAR_DAY_V1")});
    }

    function _schedule(uint32 day) private pure returns (Schedule memory schedule) {
        uint64 dayStart = uint64(uint256(day) * 1 days);
        schedule = Schedule({
            tradingStartsAt: dayStart + 10 hours,
            lastTradingAt: dayStart + 18 hours,
            expiryAt: dayStart + 20 hours,
            exerciseOpensAt: dayStart + 20 hours,
            exerciseCutoffAt: dayStart + 21 hours,
            fixingWindowOpen: dayStart + 19 hours,
            fixingWindowClose: dayStart + 20 hours,
            primaryEvidenceDeadline: dayStart + 21 hours,
            correctionCutoffAt: dayStart + 22 hours,
            finalResolutionAt: dayStart + 23 hours,
            settlementDeadline: dayStart + 23 hours + 30 minutes
        });
    }

    function _adapter(
        bytes32 referenceId,
        AdapterKindId kindId,
        address implementation,
        bytes32 interfaceHash,
        bytes32 capabilityHash
    ) private view returns (AdapterDefinition memory) {
        return AdapterDefinition({
            namespaceId: NAMESPACE,
            referenceId: referenceId,
            kindId: kindId,
            implementation: implementation,
            expectedRuntimeCodeHash: implementation.codehash,
            interfaceHash: interfaceHash,
            capabilityHash: capabilityHash,
            configurationSchemaHash: keccak256("SETRYN_DEVNET_ADAPTER_CONFIGURATION_V1"),
            evidenceHash: keccak256(abi.encode("SETRYN_DEVNET_ADAPTER_EVIDENCE_V1", referenceId, implementation))
        });
    }

    function _loadContracts() private view returns (Contracts memory c) {
        c.assets = IAssetRegistry(_dependency("SETRYN_ASSET_REGISTRY"));
        c.adapters = IAdapterRegistry(_dependency("SETRYN_ADAPTER_REGISTRY"));
        c.calendars = ICalendarRegistry(_dependency("SETRYN_CALENDAR_REGISTRY"));
        c.sessions = ISessionRegistry(_dependency("SETRYN_SESSION_REGISTRY"));
        c.settlementAssets = ISettlementAssetRegistry(_dependency("SETRYN_SETTLEMENT_ASSET_REGISTRY"));
        c.benchmarks = IBenchmarkRegistry(_dependency("SETRYN_BENCHMARK_REGISTRY"));
        c.fees = IFeeScheduleRegistry(_dependency("SETRYN_FEE_SCHEDULE_REGISTRY"));
        c.risks = IRiskDomainRegistry(_dependency("SETRYN_RISK_DOMAIN_REGISTRY"));
        c.instruments = IInstrumentRegistry(_dependency("SETRYN_INSTRUMENT_REGISTRY"));
        c.markets = IMarketRegistry(_dependency("SETRYN_MARKET_REGISTRY"));
        c.series = ISeriesRegistry(_dependency("SETRYN_SERIES_REGISTRY"));
        c.compiler = CanonicalStrategyCompiler(_dependency("SETRYN_CANONICAL_STRATEGY_COMPILER"));
        c.payoffModule = CappedForwardPayoffModule(_dependency("SETRYN_CAPPED_FORWARD_PAYOFF_MODULE"));
        c.executionPolicy = ExecutionPolicyRegistry(_dependency("SETRYN_EXECUTION_POLICY_REGISTRY"));
        c.tradingSessionPolicy = ITradingSessionPolicy(_dependency("SETRYN_TRADING_SESSION_POLICY"));
        c.collateralVault = ICollateralVault(_dependency("SETRYN_COLLATERAL_VAULT"));
        c.fundedFeeEngine = FundedFeeEngine(_dependency("SETRYN_FUNDED_FEE_ENGINE"));
        c.portfolioRiskEngine = _dependency("SETRYN_PORTFOLIO_RISK_ENGINE");
        c.riskAdmissionBindingRegistry = _dependency("SETRYN_RISK_ADMISSION_BINDING_REGISTRY");
        c.orderState = _dependency("SETRYN_ORDER_STATE");
        c.atomicClearingEngine = _dependency("SETRYN_ATOMIC_CLEARING_ENGINE");
        c.privateRfqValidationGate = _dependency("SETRYN_PRIVATE_RFQ_VALIDATION_GATE");
        c.privateRfqBook = _dependency("SETRYN_PRIVATE_RFQ_BOOK");
        c.publicOrderBook = _dependency("SETRYN_PUBLIC_ORDER_BOOK");
        c.positionEngine = _dependency("SETRYN_POSITION_ENGINE");
        c.lifecyclePolicyValidator = _dependency("SETRYN_LIFECYCLE_POLICY_VALIDATOR");
        c.signedLifecycleEngine = _dependency("SETRYN_SIGNED_LIFECYCLE_ENGINE");
    }

    function _dependency(string memory name) private view returns (address dependency) {
        dependency = vm.envAddress(name);
        if (dependency == address(0) || dependency.code.length == 0) revert InvalidDependency(name);
    }

    function _requireVersion(string memory name, uint32 version) private pure {
        if (version != VERSION) revert UnexpectedVersion(name, version);
    }

    function _writeRuntime(Contracts memory c, Runtime memory runtime, address operator, string memory output) private {
        string memory objectKey = "setryn-runtime";
        vm.serializeUint(objectKey, "schemaVersion", 6);
        vm.serializeUint(objectKey, "chainId", block.chainid);
        vm.serializeUint(objectKey, "day", runtime.day);
        vm.serializeAddress(objectKey, "operator", operator);
        vm.serializeAddress(objectKey, "settlementToken", address(runtime.settlementToken));
        vm.serializeAddress(objectKey, "marketAdapter", address(runtime.marketAdapter));
        vm.serializeAddress(objectKey, "assetRegistry", address(c.assets));
        vm.serializeAddress(objectKey, "adapterRegistry", address(c.adapters));
        vm.serializeAddress(objectKey, "calendarRegistry", address(c.calendars));
        vm.serializeAddress(objectKey, "sessionRegistry", address(c.sessions));
        vm.serializeAddress(objectKey, "settlementAssetRegistry", address(c.settlementAssets));
        vm.serializeAddress(objectKey, "benchmarkRegistry", address(c.benchmarks));
        vm.serializeAddress(objectKey, "feeScheduleRegistry", address(c.fees));
        vm.serializeAddress(objectKey, "riskDomainRegistry", address(c.risks));
        vm.serializeAddress(objectKey, "instrumentRegistry", address(c.instruments));
        vm.serializeAddress(objectKey, "marketRegistry", address(c.markets));
        vm.serializeAddress(objectKey, "seriesRegistry", address(c.series));
        vm.serializeAddress(objectKey, "canonicalStrategyCompiler", address(c.compiler));
        vm.serializeAddress(objectKey, "cappedForwardPayoffModule", address(c.payoffModule));
        vm.serializeAddress(objectKey, "collateralVault", address(c.collateralVault));
        vm.serializeAddress(objectKey, "fundedFeeEngine", address(c.fundedFeeEngine));
        vm.serializeAddress(objectKey, "portfolioRiskEngine", c.portfolioRiskEngine);
        vm.serializeAddress(objectKey, "riskAdmissionBindingRegistry", c.riskAdmissionBindingRegistry);
        vm.serializeAddress(objectKey, "executionPolicyRegistry", address(c.executionPolicy));
        vm.serializeAddress(objectKey, "tradingSessionPolicy", address(c.tradingSessionPolicy));
        vm.serializeAddress(objectKey, "orderState", c.orderState);
        vm.serializeAddress(objectKey, "atomicClearingEngine", c.atomicClearingEngine);
        vm.serializeAddress(objectKey, "privateRfqValidationGate", c.privateRfqValidationGate);
        vm.serializeAddress(objectKey, "privateRfqBook", c.privateRfqBook);
        vm.serializeAddress(objectKey, "publicOrderBook", c.publicOrderBook);
        vm.serializeAddress(objectKey, "positionEngine", c.positionEngine);
        vm.serializeAddress(objectKey, "lifecyclePolicyValidator", c.lifecyclePolicyValidator);
        vm.serializeAddress(objectKey, "signedLifecycleEngine", c.signedLifecycleEngine);
        vm.serializeBytes32(objectKey, "baseAssetId", AssetId.unwrap(runtime.baseAssetId));
        vm.serializeBytes32(objectKey, "settlementAssetId", AssetId.unwrap(runtime.settlementAssetId));
        vm.serializeBytes32(objectKey, "benchmarkAdapterId", AdapterId.unwrap(runtime.benchmarkAdapterId));
        vm.serializeBytes32(objectKey, "riskAdapterId", AdapterId.unwrap(runtime.riskAdapterId));
        vm.serializeBytes32(objectKey, "payoffAdapterId", AdapterId.unwrap(runtime.payoffAdapterId));
        vm.serializeBytes32(objectKey, "calendarId", CalendarId.unwrap(runtime.calendarId));
        vm.serializeBytes32(objectKey, "sessionId", SessionId.unwrap(runtime.sessionId));
        vm.serializeBytes32(objectKey, "benchmarkId", BenchmarkId.unwrap(runtime.benchmarkId));
        vm.serializeBytes32(objectKey, "feeScheduleId", FeeScheduleId.unwrap(runtime.feeScheduleId));
        vm.serializeBytes32(objectKey, "feeRecipientAccountId", AccountId.unwrap(runtime.feeRecipientAccountId));
        vm.serializeUint(objectKey, "maxLongDebitMinorPerLot", runtime.maxLongDebitMinorPerLot);
        vm.serializeUint(objectKey, "maxShortDebitMinorPerLot", runtime.maxShortDebitMinorPerLot);
        vm.serializeBytes32(objectKey, "riskDomainId", RiskDomainId.unwrap(runtime.riskDomainId));
        vm.serializeBytes32(objectKey, "instrumentId", InstrumentId.unwrap(runtime.instrumentId));
        vm.serializeBytes32(objectKey, "marketId", MarketId.unwrap(runtime.marketId));
        vm.serializeBytes32(objectKey, "seriesId", SeriesId.unwrap(runtime.seriesId));
        vm.serializeBytes32(objectKey, "executionModeSetHash", EXECUTION_MODE_SET);
        vm.serializeBytes32(objectKey, "executionModeId", EXECUTION_MODE_PUBLIC_BOOK);
        vm.serializeBytes(objectKey, "payoffTerms", runtime.payoffTerms);
        string memory json = vm.serializeBytes32(
            objectKey,
            "enterActionId",
            OrderActionId.unwrap(OrderActionId.wrap(keccak256("SETRYN_ORDER_ACTION_ENTER_V1")))
        );
        vm.writeJson(json, output);
    }
}
