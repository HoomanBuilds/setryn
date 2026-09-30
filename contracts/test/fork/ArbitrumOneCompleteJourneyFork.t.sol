// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {DeploySetryn} from "../../script/DeploySetryn.s.sol";
import {
    ChainlinkHistoricalEvidenceItem,
    ChainlinkHistoricalRoundFixingAdapter,
    IChainlinkHistoricalFeed
} from "../../src/adapters/oracle/ChainlinkHistoricalRoundFixingAdapter.sol";
import {ISequencerUptimeFeed} from "../../src/interfaces/ISequencerUptimeFeed.sol";
import {IPortfolioRiskAdapterV1} from "../../src/interfaces/IPortfolioRiskAdapterV1.sol";
import {IAdapterRegistry} from "../../src/interfaces/IAdapterRegistry.sol";
import {IRiskDomainRegistry} from "../../src/interfaces/IRiskDomainRegistry.sol";
import {IBenchmarkRegistry} from "../../src/interfaces/IBenchmarkRegistry.sol";
import {ICalendarRegistry} from "../../src/interfaces/ICalendarRegistry.sol";
import {IFeeScheduleRegistry} from "../../src/interfaces/IFeeScheduleRegistry.sol";
import {IInstrumentRegistry} from "../../src/interfaces/IInstrumentRegistry.sol";
import {IMarketRegistry} from "../../src/interfaces/IMarketRegistry.sol";
import {ISeriesRegistry} from "../../src/interfaces/ISeriesRegistry.sol";
import {ISessionRegistry} from "../../src/interfaces/ISessionRegistry.sol";
import {ISettlementAssetRegistry} from "../../src/interfaces/ISettlementAssetRegistry.sol";
import {RegistryStatusController} from "../../src/policy/RegistryStatusController.sol";
import {AdapterDefinitionLib} from "../../src/libraries/AdapterDefinitionLib.sol";
import {BenchmarkDefinitionLib} from "../../src/libraries/BenchmarkDefinitionLib.sol";
import {CalendarDefinitionLib} from "../../src/libraries/CalendarDefinitionLib.sol";
import {FeeEngineLib} from "../../src/libraries/FeeEngineLib.sol";
import {FeeScheduleDefinitionLib} from "../../src/libraries/FeeScheduleDefinitionLib.sol";
import {InstrumentDefinitionLib} from "../../src/libraries/InstrumentDefinitionLib.sol";
import {MarketDefinitionLib} from "../../src/libraries/MarketDefinitionLib.sol";
import {PortfolioRiskLib} from "../../src/libraries/PortfolioRiskLib.sol";
import {RiskDomainDefinitionLib} from "../../src/libraries/RiskDomainDefinitionLib.sol";
import {SeriesDefinitionLib} from "../../src/libraries/SeriesDefinitionLib.sol";
import {SessionDefinitionLib} from "../../src/libraries/SessionDefinitionLib.sol";
import {AdapterDefinition, AdapterVersion} from "../../src/types/AdapterDefinition.sol";
import {AssetDefinition} from "../../src/types/AssetDefinition.sol";
import {BenchmarkDefinition} from "../../src/types/BenchmarkDefinition.sol";
import {CalendarDay, CalendarDefinition} from "../../src/types/CalendarDefinition.sol";
import {AssetClass, Side} from "../../src/types/Enums.sol";
import {FeeScheduleDefinition} from "../../src/types/FeeScheduleDefinition.sol";
import {FeeActionRequest, FeeRecipient, FeeRecipientSet, FeeRule, FeeTier} from "../../src/types/FeeEngineTypes.sol";
import {
    FixingStatus,
    HistoricalObservation,
    ObservationBatchValidation,
    ObservationValidationContext,
    SequencerEvidence
} from "../../src/types/FixingTypes.sol";
import {
    AccountId,
    AdapterId,
    AdapterKindId,
    AssetId,
    BenchmarkId,
    CalendarId,
    CollateralId,
    CollateralLockId,
    FeeActionId,
    FeeRemainderPolicyId,
    FeeScheduleId,
    FillId,
    InstrumentId,
    MarketId,
    PackageId,
    PayoffFamilyId,
    PositionId,
    RiskDomainId,
    SeriesId,
    SessionId,
    SettlementId
} from "../../src/types/Identifiers.sol";
import {InstrumentDefinition} from "../../src/types/InstrumentDefinition.sol";
import {MarketDefinition} from "../../src/types/MarketDefinition.sol";
import {
    OrderActionId,
    OrderStatus,
    OrderTargetKind,
    PublicOrder,
    RemainderPolicy,
    TimeInForce
} from "../../src/types/OrderTypes.sol";
import {
    CanonicalFixing,
    PayoffFixingRequirement,
    PayoffKind,
    StrategyCompileInput,
    StrategyInputMode
} from "../../src/types/PayoffTypes.sol";
import {
    PortfolioPositionWitness,
    PortfolioRiskMetrics,
    PortfolioRiskResult,
    RiskAdmissionId,
    RiskAdmissionRequest,
    RiskEvaluationContext,
    RiskObservation
} from "../../src/types/RiskTypes.sol";
import {EvidenceOriginId} from "../../src/types/Identifiers.sol";
import {RiskDomainDefinition} from "../../src/types/RiskDomainDefinition.sol";
import {RiskDomainVersion} from "../../src/types/RiskDomainDefinition.sol";
import {SeriesDefinition} from "../../src/types/SeriesDefinition.sol";
import {
    CalendarDayProof,
    FixingCandidate,
    FixingSlot,
    SeriesDateKind,
    SeriesDateProof,
    SeriesQualificationData
} from "../../src/types/SeriesQualification.sol";
import {SessionDay, SessionDefinition, SessionWindow} from "../../src/types/SessionDefinition.sol";
import {SettlementAssetDefinition} from "../../src/types/SettlementAssetDefinition.sol";
import {SettlementMode} from "../../src/types/SettlementTypes.sol";
import {FeeRatePpm, Lots, PriceTicks, TickSizeMinor} from "../../src/types/Units.sol";
import {
    BilateralMatch,
    ClearingChannelKind,
    ClearingFeeFunding,
    FillRecord,
    OrderFunding,
    SeriesClearingRequest
} from "../../src/types/ClearingTypes.sol";
import {PositionEconomics, PositionLifecycle, PositionStatus} from "../../src/types/PositionTypes.sol";

interface IERC20Decimals {
    function decimals() external view returns (uint8);
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IChainlinkLatestFeed is IChainlinkHistoricalFeed {
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/// @notice Test-only portfolio risk adapter with Devnet-compatible accounting, no mainnet guard.
contract CompleteJourneyRiskAdapter is IPortfolioRiskAdapterV1 {
    IRiskDomainRegistry public immutable riskDomains;
    IAdapterRegistry public immutable adapters;
    uint64 public immutable maxAge;

    constructor(IRiskDomainRegistry riskDomains_, IAdapterRegistry adapters_, uint64 maxAge_) {
        riskDomains = riskDomains_;
        adapters = adapters_;
        maxAge = maxAge_;
    }

    function evaluatePortfolio(
        RiskEvaluationContext calldata context,
        PortfolioPositionWitness[] calldata positions,
        RiskObservation[] calldata observations
    ) external view returns (PortfolioRiskResult memory result) {
        RiskDomainVersion memory domain = riskDomains.getRiskDomain(context.riskDomainId, context.riskDomainVersion);
        AdapterVersion memory adapter =
            adapters.getAdapter(domain.definition.riskAdapterId, domain.definition.riskAdapterVersion);
        uint128 openInterest = context.currentOpenInterestBaseUnits + context.requestedOpenInterestBaseUnits;
        uint128 accountLiability =
            context.currentAccountTerminalLiabilityBaseUnits + context.requestedAccountTerminalLiabilityBaseUnits;
        uint128 aggregateLiability =
            context.currentAggregateTerminalLiabilityBaseUnits + context.requestedAggregateTerminalLiabilityBaseUnits;
        uint128 initialMargin = accountLiability;
        uint128 maintenanceMargin = uint128(uint256(initialMargin) * 8 / 10);
        uint128 headroom = context.collateralAvailableBaseUnits > initialMargin
            ? context.collateralAvailableBaseUnits - initialMargin
            : 0;
        headroom = _min(headroom, _remaining(domain.definition.maxOpenInterestBaseUnits, openInterest));
        headroom = _min(headroom, _remaining(domain.definition.maxAccountLiabilityBaseUnits, accountLiability));
        headroom = _min(headroom, _remaining(domain.definition.maxAggregateLiabilityBaseUnits, aggregateLiability));
        result = PortfolioRiskResult({
            configurationHash: keccak256(
                abi.encode(
                    keccak256("SetrynRiskConfigurationV1"),
                    domain.versionHash,
                    adapter.versionHash,
                    domain.definition.riskModelId,
                    domain.definition.marginRulesHash,
                    domain.definition.scenarioSetHash,
                    domain.definition.concentrationRulesHash
                )
            ),
            witnessHash: PortfolioRiskLib.hashPositions(positions),
            observationsHash: PortfolioRiskLib.hashObservations(observations, maxAge, block.timestamp),
            metrics: PortfolioRiskMetrics({
                initialMarginBaseUnits: initialMargin,
                maintenanceMarginBaseUnits: maintenanceMargin,
                stressLossBaseUnits: accountLiability,
                concentrationBaseUnits: accountLiability,
                openInterestBaseUnits: openInterest,
                accountTerminalLiabilityBaseUnits: accountLiability,
                aggregateTerminalLiabilityBaseUnits: aggregateLiability,
                liquidationDistanceBaseUnits: int256(uint256(context.collateralAvailableBaseUnits))
                    - int256(uint256(maintenanceMargin)),
                availableHeadroomBaseUnits: headroom
            })
        });
    }

    function _min(uint128 a, uint128 b) private pure returns (uint128) {
        return a < b ? a : b;
    }

    function _remaining(uint128 limit, uint128 current) private pure returns (uint128) {
        return current >= limit ? 0 : limit - current;
    }
}

/// @notice Phase 4 pinned Arbitrum One fork: complete user and settlement journey.
/// @dev Fork-local only. Never broadcasts, never uses deployment keys, never writes to mainnet.
///      All production addresses arrive via env. No-RPC runs skip.
contract ArbitrumOneCompleteJourneyForkTest is Test, DeploySetryn {
    uint256 internal constant ARBITRUM_ONE_CHAIN_ID = 42_161;
    uint32 internal constant VERSION = 1;

    bytes32 internal constant NAMESPACE = keccak256("SETRYN_COMPLETE_JOURNEY_V1");
    bytes32 internal constant EXECUTION_MODE_SET = keccak256("SETRYN_EXECUTION_MODE_SET_GENESIS_V1");
    bytes32 internal constant EXECUTION_MODE_PUBLIC_BOOK = keccak256("SETRYN_EXECUTION_MODE_PUBLIC_BOOK_V1");
    bytes32 internal constant FIXING_CAPABILITY = keccak256("SETRYN_COMPLETE_JOURNEY_FIXING_V1");
    bytes32 internal constant RISK_CAPABILITY = keccak256("SETRYN_COMPLETE_JOURNEY_RISK_V1");
    bytes32 internal constant PAYOFF_CAPABILITY = keccak256("SETRYN_EXACT_LOTS_PAYOFF_V1");
    bytes32 internal constant FIXING_INTERFACE = keccak256("SetrynFixingObservationAdapterV1.validateObservationBatch");
    bytes32 internal constant RISK_INTERFACE = keccak256("SETRYN_PORTFOLIO_RISK_INTERFACE_V1");
    bytes32 internal constant PAYOFF_INTERFACE = keccak256("SETRYN_SERIES_PAYOFF_INTERFACE_V1");
    bytes32 internal constant TERMS_SCHEMA = keccak256("SETRYN_NDF_TERMS_SCHEMA_V1");
    bytes32 internal constant CALENDAR_REFERENCE = keccak256("CALENDAR_CONTINUOUS");
    bytes32 internal constant SESSION_REFERENCE = keccak256("SESSION_CONTINUOUS");
    bytes32 internal constant DAY_EVIDENCE = keccak256("SETRYN_COMPLETE_JOURNEY_DAY_V1");

    uint64 internal constant RECOVERY_GRACE = 1 hours;
    uint32 internal constant CANDIDATE_LAG = 30 minutes;
    uint64 internal constant CANDIDATE_WINDOW = 30 minutes;

    address internal nativeUsdc;
    address internal sequencerFeed;
    address internal chainlinkFeed;
    address internal govOperator;
    address internal govAdmin;
    RegistryStatusController internal statusController;
    bytes32 internal feedKey;
    uint80 internal pinnedRoundId;
    bool internal hasPinnedRound;

    struct JourneyTiming {
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
        uint64 windowStartsAt;
        uint64 windowEndsAt;
        uint64 targetAt;
        uint64 unavailableAfter;
        uint32 fromDay;
        uint32 throughDay;
    }

    function setUp() public {
        string memory rpcUrl = vm.envOr("ARBITRUM_RPC_URL", string(""));
        string memory blockNumberRaw = vm.envOr("ARBITRUM_ONE_FORK_BLOCK_NUMBER", string(""));
        address configuredUsdc = vm.envOr("SETRYN_NATIVE_USDC", address(0));
        address configuredSequencer = vm.envOr("SETRYN_SEQUENCER_UPTIME_FEED", address(0));
        address configuredFeed = vm.envOr("SETRYN_CHAINLINK_FEED", address(0));
        string memory configuredKey = vm.envOr("SETRYN_CHAINLINK_FEED_KEY", string(""));

        if (
            bytes(rpcUrl).length == 0 || bytes(blockNumberRaw).length == 0 || configuredUsdc == address(0)
                || configuredSequencer == address(0) || configuredFeed == address(0)
        ) {
            vm.skip(
                true,
                "Set ARBITRUM_RPC_URL, ARBITRUM_ONE_FORK_BLOCK_NUMBER, SETRYN_NATIVE_USDC, SETRYN_SEQUENCER_UPTIME_FEED and SETRYN_CHAINLINK_FEED"
            );
        }
        if (bytes(configuredKey).length == 0) {
            vm.skip(true, "Set SETRYN_CHAINLINK_FEED_KEY to run the complete journey fork suite");
        }
        require(_startsWithHttps(rpcUrl), "ARBITRUM_RPC_URL must be explicit HTTPS");
        uint256 pinnedBlock = vm.parseUint(blockNumberRaw);
        require(pinnedBlock > 0, "ARBITRUM_ONE_FORK_BLOCK_NUMBER must be decimal");

        vm.createSelectFork(rpcUrl, pinnedBlock);
        require(block.chainid == ARBITRUM_ONE_CHAIN_ID, "RPC must resolve to Arbitrum One");
        require(configuredUsdc.code.length > 0, "native USDC must have code at pinned block");
        require(configuredSequencer.code.length > 0, "sequencer feed must have code at pinned block");
        require(configuredFeed.code.length > 0, "chainlink feed must have code at pinned block");
        require(IERC20Decimals(configuredUsdc).decimals() == 6, "native USDC must report 6 decimals");

        nativeUsdc = configuredUsdc;
        sequencerFeed = configuredSequencer;
        chainlinkFeed = configuredFeed;
        feedKey = _parseFeedKey(configuredKey);
        require(feedKey != bytes32(0), "feed key must be nonzero");

        uint256 configuredRound = vm.envOr("SETRYN_CHAINLINK_ROUND_ID", uint256(0));
        if (configuredRound != 0) {
            require(configuredRound <= type(uint80).max, "SETRYN_CHAINLINK_ROUND_ID must fit in uint80");
            pinnedRoundId = uint80(configuredRound);
            hasPinnedRound = true;
        }
    }

    function test_CompleteUserAndSettlementJourney() public {
        uint8 liveDecimals = IChainlinkHistoricalFeed(chainlinkFeed).decimals();
        assertTrue(liveDecimals > 0, "chainlink feed decimals must be nonzero");
        uint80 roundId = _resolveRoundId();
        (, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound) =
            IChainlinkHistoricalFeed(chainlinkFeed).getRoundData(roundId);
        require(answeredInRound == roundId, "round must be self-answered");
        require(answer > 0, "round answer must be positive");
        require(startedAt > 0 && updatedAt > 0, "round timestamps must be nonzero");
        require(updatedAt >= startedAt, "round timestamps must be ordered");
        require(updatedAt <= block.timestamp, "round must not be from the future");
        uint64 originalForkTimestamp = uint64(block.timestamp);
        uint64 forkTime = originalForkTimestamp;
        uint64 roundUpdatedAt = uint64(updatedAt);
        JourneyTiming memory timing = _buildTiming(forkTime, roundUpdatedAt);
        assertTrue(timing.tradingStartsAt < timing.lastTradingAt, "trading interval must be ordered");
        assertTrue(timing.lastTradingAt < timing.fixingWindowOpen, "trading must end before fixing opens");
        assertTrue(timing.lastTradingAt < originalForkTimestamp, "historical round must place trading before fork time");
        assertEq(block.timestamp, originalForkTimestamp, "must start at pinned fork time");

        Deployment memory d = _deployProductionGraph();

        (address alice, uint256 aliceKey) = makeAddrAndKey("journey-alice");
        (address bob, uint256 bobKey) = makeAddrAndKey("journey-bob");
        require(alice != bob, "users must be distinct");

        CompleteJourneyRiskAdapter riskAdapter =
            new CompleteJourneyRiskAdapter(d.riskDomainRegistry, d.adapterRegistry, 5 minutes);
        ChainlinkHistoricalRoundFixingAdapter fixingAdapter = new ChainlinkHistoricalRoundFixingAdapter(
            ARBITRUM_ONE_CHAIN_ID,
            chainlinkFeed,
            feedKey,
            FIXING_CAPABILITY,
            liveDecimals,
            sequencerFeed,
            RECOVERY_GRACE
        );
        assertTrue(address(riskAdapter).code.length > 0, "risk helper must have code");
        assertTrue(address(fixingAdapter).code.length > 0, "fixing adapter must have code");

        AssetId baseAssetId = _registerBaseAsset(d);
        AssetId settlementAssetId = _registerSettlementAsset(d);
        (AdapterId fixingAdapterId, AdapterId riskAdapterId, AdapterId payoffAdapterId) =
            _registerAdapters(d, riskAdapter, fixingAdapter);
        CalendarId calendarId = _registerCalendar(d, timing.fromDay, timing.throughDay);
        SessionId sessionId = _registerSession(d, calendarId, timing);
        _registerUsdcBinding(d, settlementAssetId);
        BenchmarkId benchmarkId =
            _registerBenchmark(d, baseAssetId, settlementAssetId, fixingAdapterId, calendarId, sessionId, liveDecimals);
        FeeScheduleId feeScheduleId = _registerFees(d, settlementAssetId);
        RiskDomainId riskDomainId = _registerRisk(d, settlementAssetId, riskAdapterId);
        InstrumentId instrumentId = _registerInstrument(d, payoffAdapterId);
        MarketId marketId = _registerMarket(
            d, baseAssetId, settlementAssetId, benchmarkId, calendarId, sessionId, riskDomainId, feeScheduleId
        );
        _allowExecution(d);

        assertTrue(AssetId.unwrap(baseAssetId) != bytes32(0), "base asset id nonzero");
        assertTrue(AssetId.unwrap(settlementAssetId) != bytes32(0), "settlement asset id nonzero");
        assertTrue(AdapterId.unwrap(fixingAdapterId) != bytes32(0), "fixing adapter id nonzero");
        assertTrue(AdapterId.unwrap(riskAdapterId) != bytes32(0), "risk adapter id nonzero");
        assertTrue(AdapterId.unwrap(payoffAdapterId) != bytes32(0), "payoff adapter id nonzero");
        assertTrue(BenchmarkId.unwrap(benchmarkId) != bytes32(0), "benchmark id nonzero");
        assertTrue(FeeScheduleId.unwrap(feeScheduleId) != bytes32(0), "fee schedule id nonzero");
        assertTrue(RiskDomainId.unwrap(riskDomainId) != bytes32(0), "risk domain id nonzero");
        assertTrue(InstrumentId.unwrap(instrumentId) != bytes32(0), "instrument id nonzero");
        assertTrue(MarketId.unwrap(marketId) != bytes32(0), "market id nonzero");

        (AccountId aliceAccount, AccountId bobAccount) = _fundUsers(d, settlementAssetId, alice, bob);
        assertTrue(AccountId.unwrap(aliceAccount) != bytes32(0), "alice account nonzero");
        assertTrue(AccountId.unwrap(bobAccount) != bytes32(0), "bob account nonzero");

        // Fork-local chronological rehearsal: the authenticated round is historical, so trading
        // occurred before the pinned fork time. Warp back into the configured trading interval
        // for series activation, orders, and clearing.
        uint64 tradingRehearsalAt = timing.tradingStartsAt + ((timing.lastTradingAt - timing.tradingStartsAt) / 2);
        assertGe(tradingRehearsalAt, timing.tradingStartsAt, "trading rehearsal must reach trading start");
        assertLe(tradingRehearsalAt, timing.lastTradingAt, "trading rehearsal must not pass last trading");
        assertLt(tradingRehearsalAt, originalForkTimestamp, "trading rehearsal must precede fork time");
        assertEq(block.timestamp, originalForkTimestamp, "must still be at fork time before trading warp");
        vm.warp(tradingRehearsalAt);
        assertEq(block.timestamp, tradingRehearsalAt, "must warp into trading interval");
        assertGe(block.timestamp, timing.tradingStartsAt, "rehearsal must not precede trading start");
        assertLe(block.timestamp, timing.lastTradingAt, "rehearsal must not pass last trading");

        (SeriesId seriesId, FixingSlot[] memory slots, bytes memory payoffTerms) =
            _configureSeries(d, benchmarkId, instrumentId, marketId, calendarId, timing, liveDecimals);
        assertTrue(SeriesId.unwrap(seriesId) != bytes32(0), "series id nonzero");
        assertTrue(slots.length == 1, "one fixing slot");
        assertTrue(payoffTerms.length > 0, "payoff terms nonzero");
        require(
            slots[0].candidates[0].windowStartsAt <= roundUpdatedAt
                && roundUpdatedAt < slots[0].candidates[0].windowEndsAt,
            "candidate window must include round updatedAt"
        );

        (
            bytes32 buyHash,
            bytes32 sellHash,
            RiskAdmissionId buyAdmissionId,
            bytes32 buyResultHash,
            RiskAdmissionId sellAdmissionId,
            bytes32 sellResultHash
        ) = _placeOpposingOrders(
            d, seriesId, feeScheduleId, riskDomainId, alice, aliceKey, bob, bobKey, aliceAccount, bobAccount
        );

        (FillId fillId, PositionId positionId) = _clearDirectly(
            d,
            payoffTerms,
            buyHash,
            sellHash,
            buyAdmissionId,
            buyResultHash,
            sellAdmissionId,
            sellResultHash,
            aliceAccount,
            bobAccount
        );
        assertTrue(FillId.unwrap(fillId) != bytes32(0), "fill id nonzero");
        assertTrue(PositionId.unwrap(positionId) != bytes32(0), "position id nonzero");
        _assertPositionLive(d, positionId, aliceAccount, bobAccount);

        // Rehearse forward to live fork time before touching sequencer evidence or fixing.
        // Never warp backward after this point.
        uint64 fixingRehearsalAt = _max64(originalForkTimestamp, roundUpdatedAt);
        assertGe(fixingRehearsalAt, originalForkTimestamp, "fixing rehearsal must reach fork time");
        assertGe(fixingRehearsalAt, roundUpdatedAt, "fixing rehearsal must reach round publication");
        assertGe(fixingRehearsalAt, block.timestamp, "fixing rehearsal must move forward");
        assertTrue(timing.lastTradingAt < fixingRehearsalAt, "fixing rehearsal must follow trading");
        vm.warp(fixingRehearsalAt);
        assertEq(block.timestamp, fixingRehearsalAt, "must warp forward to fork time for fixing");
        assertGe(block.timestamp, originalForkTimestamp, "must not rewind past fork time");
        assertGe(block.timestamp, roundUpdatedAt, "round must be publishable at fixing time");

        SequencerEvidence memory liveEvidence = _liveSequencer();
        assertTrue(liveEvidence.sequencerUp, "fork sequencer must be up");
        assertFalse(liveEvidence.inRecoveryGrace, "fork sequencer must be outside grace");
        assertTrue(liveEvidence.proofHash != bytes32(0), "sequencer proof nonzero");

        _tamperedBranchFailsBeforeSettlement(d, seriesId, slots, positionId, roundId, liveDecimals);
        _submitFixingFinalizeAndSettle(d, seriesId, slots, positionId, roundId, liveDecimals);
        _withdrawAndReconcile(d, settlementAssetId, alice, bob, aliceAccount, bobAccount);
        _assertHistoriesReadable(d, positionId, seriesId);
    }

    function _deployProductionGraph() internal returns (Deployment memory d) {
        address bootstrap = makeAddr("journey-bootstrap");
        address governanceAdmin = makeAddr("journey-gov-admin");
        address governanceOperator = makeAddr("journey-gov-operator");
        address guardian = makeAddr("journey-guardian");
        address excessRecovery = makeAddr("journey-excess");
        address privacyKeyPublisher = makeAddr("journey-privacy");
        address lifecycleWitnessStager = makeAddr("journey-witness");
        govOperator = governanceOperator;
        govAdmin = governanceAdmin;
        DeploymentConfig memory config = DeploymentConfig({
            bootstrapAdmin: bootstrap,
            governanceAdmin: governanceAdmin,
            governanceOperator: governanceOperator,
            guardian: guardian,
            excessRecovery: excessRecovery,
            privacyKeyPublisher: privacyKeyPublisher,
            lifecycleWitnessStager: lifecycleWitnessStager,
            defaultAdminDelay: 2 days,
            maxLockDuration: 30 days,
            evaluationGasHardCap: 2_000_000,
            maximumRiskAdapterGas: 500_000,
            maximumRiskObservationAge: 5 minutes,
            operationalReadGas: 500_000,
            operationalExecutionGas: 800_000,
            maximumOrderLifetime: 30 days,
            maximumRfqCapacityTail: 1 days,
            sequencerRecoveryGrace: 1 hours,
            deploymentId: keccak256("SetrynCompleteJourneyV1"),
            sequencerFeed: ISequencerUptimeFeed(sequencerFeed),
            statusGovernance: governanceAdmin,
            retainOperatorStatusRoles: false,
            treasuryController: makeAddr("treasury-safe")
        });
        vm.startPrank(bootstrap);
        (d,) = _deployAndWire(config);
        vm.stopPrank();
        assertEq(address(d.sequencerUptimeFeed), sequencerFeed, "must reuse exact sequencer feed");
        statusController = d.registryStatusController;
    }

    /// Activation runs only through the status controller's governance path, held by the governance timelock.
    function _govern(address registry, bytes memory data) internal {
        vm.prank(govAdmin);
        statusController.govern(registry, data);
    }

    function _resolveRoundId() internal view returns (uint80) {
        if (hasPinnedRound) return pinnedRoundId;
        (uint80 latestId,,,,) = IChainlinkLatestFeed(chainlinkFeed).latestRoundData();
        require(latestId != 0, "feed must expose a nonzero latest round");
        return latestId;
    }

    function _buildTiming(uint64 forkTime, uint64 roundUpdatedAt) internal pure returns (JourneyTiming memory timing) {
        require(roundUpdatedAt > 0, "round updatedAt must be nonzero");
        require(roundUpdatedAt <= forkTime, "round must not be from the future");
        require(roundUpdatedAt >= 1 hours + 1, "round timestamp too small for window math");
        require(forkTime <= type(uint64).max - 4 hours, "fork time too large for deadline math");

        uint64 windowStartsAt = roundUpdatedAt;
        uint64 windowEndsAt = windowStartsAt + CANDIDATE_WINDOW;
        uint64 targetAt = windowStartsAt;
        uint64 fixingOpen = windowStartsAt;
        uint64 fixingClose = windowEndsAt;
        uint64 tradingStartsAt = windowStartsAt - 1 hours;
        uint64 lastTradingAt = windowStartsAt - 1;
        uint64 expiryAt = fixingClose;
        uint64 exerciseOpensAt = expiryAt;
        uint64 exerciseCutoffAt = expiryAt + 1 hours;
        uint64 base = _max64(fixingClose, forkTime) + 2 hours;
        uint64 primaryDeadline = base;
        uint64 correctionCutoffAt = base + 1 hours;
        uint64 finalResolutionAt = correctionCutoffAt + 1 hours;
        uint64 settlementDeadline = finalResolutionAt + 1 hours;
        uint64 unavailableAfter = _max64(windowEndsAt, forkTime) + 1 hours;

        require(tradingStartsAt < lastTradingAt, "trading window must be ordered");
        require(lastTradingAt < fixingOpen, "trading must end before fixing opens");
        require(fixingOpen < fixingClose, "fixing window must be ordered");
        require(fixingClose <= expiryAt, "expiry must cover fixing close");
        require(expiryAt <= primaryDeadline, "primary deadline must cover expiry");
        require(primaryDeadline <= correctionCutoffAt, "correction must follow primary deadline");
        require(correctionCutoffAt < finalResolutionAt, "final resolution must follow correction");
        require(finalResolutionAt <= settlementDeadline, "settlement must follow final resolution");
        require(windowStartsAt < windowEndsAt, "candidate window must be ordered");
        require(targetAt >= windowStartsAt && targetAt < windowEndsAt, "target must sit in candidate window");
        require(unavailableAfter > windowEndsAt, "unavailableAfter must follow window end");
        require(unavailableAfter <= finalResolutionAt, "unavailableAfter must precede final resolution");
        require(exerciseCutoffAt < finalResolutionAt, "exercise cutoff must precede final resolution");

        timing = JourneyTiming({
            tradingStartsAt: tradingStartsAt,
            lastTradingAt: lastTradingAt,
            expiryAt: expiryAt,
            exerciseOpensAt: exerciseOpensAt,
            exerciseCutoffAt: exerciseCutoffAt,
            fixingWindowOpen: fixingOpen,
            fixingWindowClose: fixingClose,
            primaryEvidenceDeadline: primaryDeadline,
            correctionCutoffAt: correctionCutoffAt,
            finalResolutionAt: finalResolutionAt,
            settlementDeadline: settlementDeadline,
            windowStartsAt: windowStartsAt,
            windowEndsAt: windowEndsAt,
            targetAt: targetAt,
            unavailableAfter: unavailableAfter,
            fromDay: uint32(tradingStartsAt / 1 days),
            throughDay: uint32(settlementDeadline / 1 days)
        });
        require(timing.fromDay <= timing.throughDay, "calendar horizon must be ordered");
    }

    function _max64(uint64 a, uint64 b) internal pure returns (uint64) {
        return a >= b ? a : b;
    }

    function _liveSequencer() internal view returns (SequencerEvidence memory evidence) {
        (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound) =
            ISequencerUptimeFeed(sequencerFeed).latestRoundData();
        require(roundId != 0 && answeredInRound != 0, "bad sequencer round");
        bool up = answer == 0;
        uint64 endsAt;
        bool inGrace;
        if (up) {
            endsAt = uint64(startedAt) + RECOVERY_GRACE;
            inGrace = block.timestamp <= endsAt;
        }
        bytes32 proofHash = keccak256(
            abi.encode(
                sequencerFeed,
                ARBITRUM_ONE_CHAIN_ID,
                roundId,
                answer,
                startedAt,
                updatedAt,
                answeredInRound,
                RECOVERY_GRACE
            )
        );
        evidence = SequencerEvidence({
            sequencerUp: up, inRecoveryGrace: inGrace, recoveryGraceEndsAt: endsAt, proofHash: proofHash
        });
    }

    function _itemEvidenceHash(
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound,
        uint8 decimalsValue
    ) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                chainlinkFeed,
                ARBITRUM_ONE_CHAIN_ID,
                roundId,
                answer,
                startedAt,
                updatedAt,
                answeredInRound,
                decimalsValue
            )
        );
    }

    function _correctPayload(uint80 roundId, uint8 liveDecimals)
        internal
        view
        returns (HistoricalObservation[] memory observations, bytes memory evidence)
    {
        (uint80 returnedId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound) =
            IChainlinkHistoricalFeed(chainlinkFeed).getRoundData(roundId);
        require(returnedId == roundId, "feed must return the exact requested round");
        require(answeredInRound == roundId, "round must be self-answered");
        require(answer > 0, "round answer must be positive");
        SequencerEvidence memory sequencer = _liveSequencer();
        bytes32 itemHash = _itemEvidenceHash(roundId, answer, startedAt, updatedAt, answeredInRound, liveDecimals);
        observations = new HistoricalObservation[](1);
        observations[0] = HistoricalObservation({
            value: answer,
            weight: 1,
            observedAt: uint64(updatedAt),
            publishedAt: uint64(updatedAt),
            providerSequence: uint64(roundId),
            confidenceBps: 0,
            decimals: liveDecimals,
            finalityReference: bytes32(uint256(roundId)),
            itemEvidenceHash: itemHash,
            sequencer: sequencer
        });
        ChainlinkHistoricalEvidenceItem[] memory items = new ChainlinkHistoricalEvidenceItem[](1);
        items[0] = ChainlinkHistoricalEvidenceItem({roundId: roundId, sequencer: sequencer});
        evidence = abi.encode(items);
    }

    function _registerBaseAsset(Deployment memory d) internal returns (AssetId baseAssetId) {
        vm.prank(govOperator);
        baseAssetId = d.assetRegistry
            .registerAsset(
                AssetDefinition({
                    namespaceId: NAMESPACE,
                    referenceId: keccak256("ASSET_BTC"),
                    symbol: bytes32("BTC"),
                    assetClass: AssetClass.Crypto,
                    decimals: 8
                })
            );
        assertTrue(d.assetRegistry.isActive(baseAssetId), "base asset must be active after registration");
    }

    function _registerSettlementAsset(Deployment memory d) internal returns (AssetId settlementAssetId) {
        vm.prank(govOperator);
        settlementAssetId = d.assetRegistry
            .registerAsset(
                AssetDefinition({
                    namespaceId: NAMESPACE,
                    referenceId: keccak256("ASSET_NATIVE_USDC"),
                    symbol: bytes32("USDC"),
                    assetClass: AssetClass.Stablecoin,
                    decimals: 6
                })
            );
        assertTrue(d.assetRegistry.isActive(settlementAssetId), "settlement asset must be active after registration");
    }

    function _registerAdapters(
        Deployment memory d,
        CompleteJourneyRiskAdapter riskAdapter,
        ChainlinkHistoricalRoundFixingAdapter fixingAdapter
    ) internal returns (AdapterId fixingAdapterId, AdapterId riskAdapterId, AdapterId payoffAdapterId) {
        vm.prank(govOperator);
        (fixingAdapterId,) = d.adapterRegistry
            .registerAdapter(
                AdapterDefinition({
                    namespaceId: NAMESPACE,
                    referenceId: keccak256("ADAPTER_FIXING"),
                    kindId: AdapterDefinitionLib.ADAPTER_KIND_BENCHMARK,
                    implementation: address(fixingAdapter),
                    expectedRuntimeCodeHash: address(fixingAdapter).codehash,
                    interfaceHash: FIXING_INTERFACE,
                    capabilityHash: FIXING_CAPABILITY,
                    configurationSchemaHash: keccak256("SETRYN_COMPLETE_JOURNEY_ADAPTER_CONFIG_V1"),
                    evidenceHash: keccak256("SETRYN_COMPLETE_JOURNEY_FIXING_EVIDENCE_V1")
                })
            );
        vm.prank(govOperator);
        (riskAdapterId,) = d.adapterRegistry
            .registerAdapter(
                AdapterDefinition({
                    namespaceId: NAMESPACE,
                    referenceId: keccak256("ADAPTER_RISK"),
                    kindId: AdapterDefinitionLib.ADAPTER_KIND_RISK,
                    implementation: address(riskAdapter),
                    expectedRuntimeCodeHash: address(riskAdapter).codehash,
                    interfaceHash: RISK_INTERFACE,
                    capabilityHash: RISK_CAPABILITY,
                    configurationSchemaHash: keccak256("SETRYN_COMPLETE_JOURNEY_ADAPTER_CONFIG_V1"),
                    evidenceHash: keccak256("SETRYN_COMPLETE_JOURNEY_RISK_EVIDENCE_V1")
                })
            );
        vm.prank(govOperator);
        (payoffAdapterId,) = d.adapterRegistry
            .registerAdapter(
                AdapterDefinition({
                    namespaceId: NAMESPACE,
                    referenceId: keccak256("ADAPTER_NDF"),
                    kindId: AdapterDefinitionLib.ADAPTER_KIND_PAYOFF,
                    implementation: address(d.ndfPayoffModule),
                    expectedRuntimeCodeHash: address(d.ndfPayoffModule).codehash,
                    interfaceHash: PAYOFF_INTERFACE,
                    capabilityHash: PAYOFF_CAPABILITY,
                    configurationSchemaHash: keccak256("SETRYN_COMPLETE_JOURNEY_ADAPTER_CONFIG_V1"),
                    evidenceHash: keccak256("SETRYN_COMPLETE_JOURNEY_PAYOFF_EVIDENCE_V1")
                })
            );
        _govern(
            address(d.adapterRegistry), abi.encodeCall(IAdapterRegistry.activateAdapter, (fixingAdapterId, VERSION))
        );
        _govern(address(d.adapterRegistry), abi.encodeCall(IAdapterRegistry.activateAdapter, (riskAdapterId, VERSION)));
        _govern(
            address(d.adapterRegistry), abi.encodeCall(IAdapterRegistry.activateAdapter, (payoffAdapterId, VERSION))
        );
    }

    function _calendarId() internal view returns (CalendarId) {
        CalendarDefinition memory keyDef = CalendarDefinition({
            namespaceId: NAMESPACE,
            referenceId: CALENDAR_REFERENCE,
            timeZoneId: keccak256("Etc/UTC"),
            weekendMask: 0,
            validFromDay: 0,
            validThroughDay: 0,
            dayStatusRoot: bytes32(uint256(1)),
            ruleSetHash: keccak256("SETRYN_COMPLETE_JOURNEY_CALENDAR_RULES_V1"),
            sourceHash: keccak256("SETRYN_COMPLETE_JOURNEY_CALENDAR_SOURCE_V1")
        });
        return CalendarDefinitionLib.deriveCalendarId(keyDef);
    }

    function _calendarLeaf(CalendarId calendarId, uint32 day) internal pure returns (bytes32) {
        return CalendarDefinitionLib.hashDay(
            calendarId, CalendarDay({day: day, isBusinessDay: true, evidenceHash: DAY_EVIDENCE})
        );
    }

    function _hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encode(a, b)) : keccak256(abi.encode(b, a));
    }

    function _calendarLeaves(CalendarId calendarId, uint32 fromDay, uint32 throughDay)
        internal
        pure
        returns (bytes32[] memory leaves)
    {
        uint256 count = uint256(throughDay) - uint256(fromDay) + 1;
        leaves = new bytes32[](count);
        for (uint256 i; i < count; ++i) {
            leaves[i] = _calendarLeaf(calendarId, fromDay + uint32(i));
        }
    }

    function _merkleRoot(bytes32[] memory leaves) internal pure returns (bytes32) {
        require(leaves.length > 0, "calendar leaves must be nonempty");
        bytes32[] memory level = leaves;
        while (level.length > 1) {
            uint256 nextLen = (level.length + 1) / 2;
            bytes32[] memory next = new bytes32[](nextLen);
            for (uint256 i; i < nextLen; ++i) {
                uint256 left = i * 2;
                uint256 right = left + 1;
                if (right < level.length) {
                    next[i] = _hashPair(level[left], level[right]);
                } else {
                    next[i] = level[left];
                }
            }
            level = next;
        }
        return level[0];
    }

    function _calendarProof(bytes32[] memory leaves, uint256 index) internal pure returns (bytes32[] memory proof) {
        require(index < leaves.length, "calendar proof index out of range");
        uint256 depth;
        {
            uint256 width = leaves.length;
            while (width > 1) {
                width = (width + 1) / 2;
                ++depth;
            }
        }
        bytes32[] memory scratch = new bytes32[](depth);
        uint256 proofLen;
        bytes32[] memory level = leaves;
        uint256 pos = index;
        while (level.length > 1) {
            uint256 nextLen = (level.length + 1) / 2;
            bytes32[] memory next = new bytes32[](nextLen);
            for (uint256 i; i < nextLen; ++i) {
                uint256 left = i * 2;
                uint256 right = left + 1;
                if (right < level.length) {
                    next[i] = _hashPair(level[left], level[right]);
                    if (left == pos || right == pos) {
                        scratch[proofLen++] = left == pos ? level[right] : level[left];
                        pos = i;
                    }
                } else {
                    next[i] = level[left];
                    if (left == pos) {
                        pos = i;
                    }
                }
            }
            level = next;
        }
        proof = new bytes32[](proofLen);
        for (uint256 i; i < proofLen; ++i) {
            proof[i] = scratch[i];
        }
    }

    function _proofForDay(CalendarId calendarId, uint32 fromDay, uint32 throughDay, uint32 day)
        internal
        pure
        returns (bytes32[] memory)
    {
        bytes32[] memory leaves = _calendarLeaves(calendarId, fromDay, throughDay);
        require(day >= fromDay && day <= throughDay, "day outside calendar horizon");
        return _calendarProof(leaves, uint256(day) - uint256(fromDay));
    }

    function _registerCalendar(Deployment memory d, uint32 fromDay, uint32 throughDay)
        internal
        returns (CalendarId calendarId)
    {
        calendarId = _calendarId();
        bytes32[] memory leaves = _calendarLeaves(calendarId, fromDay, throughDay);
        bytes32 root = _merkleRoot(leaves);
        CalendarDefinition memory definition = CalendarDefinition({
            namespaceId: NAMESPACE,
            referenceId: CALENDAR_REFERENCE,
            timeZoneId: keccak256("Etc/UTC"),
            weekendMask: 0,
            validFromDay: fromDay,
            validThroughDay: throughDay,
            dayStatusRoot: root,
            ruleSetHash: keccak256("SETRYN_COMPLETE_JOURNEY_CALENDAR_RULES_V1"),
            sourceHash: keccak256("SETRYN_COMPLETE_JOURNEY_CALENDAR_SOURCE_V1")
        });
        require(
            CalendarId.unwrap(CalendarDefinitionLib.deriveCalendarId(definition)) == CalendarId.unwrap(calendarId),
            "calendar id must be stable"
        );
        vm.prank(govOperator);
        (CalendarId registeredId, uint32 calendarVersion) = d.calendarRegistry.registerCalendar(definition);
        require(CalendarId.unwrap(registeredId) == CalendarId.unwrap(calendarId), "calendar id mismatch");
        require(calendarVersion == VERSION, "calendar version");
        _govern(
            address(d.calendarRegistry),
            abi.encodeCall(ICalendarRegistry.activateCalendar, (calendarId, calendarVersion))
        );
    }

    function _registerSession(Deployment memory d, CalendarId calendarId, JourneyTiming memory timing)
        internal
        returns (SessionId sessionId)
    {
        SessionWindow[] memory windows = new SessionWindow[](2);
        windows[0] = SessionWindow({
            kindId: SessionDefinitionLib.WINDOW_KIND_TRADING,
            opensAt: timing.tradingStartsAt,
            closesAt: timing.settlementDeadline,
            policyHash: keccak256("SETRYN_COMPLETE_JOURNEY_TRADING_WINDOW_V1")
        });
        windows[1] = SessionWindow({
            kindId: SessionDefinitionLib.WINDOW_KIND_FIXING,
            opensAt: timing.fixingWindowOpen,
            closesAt: timing.fixingWindowClose,
            policyHash: keccak256("SETRYN_COMPLETE_JOURNEY_FIXING_WINDOW_V1")
        });
        SessionDefinition memory definition = SessionDefinition({
            namespaceId: NAMESPACE,
            referenceId: SESSION_REFERENCE,
            calendarId: calendarId,
            calendarVersion: VERSION,
            validFromDay: timing.fromDay,
            validThroughDay: timing.throughDay,
            dayScheduleRoot: bytes32(uint256(1)),
            windowKindSetHash: keccak256(
                abi.encode(
                    SessionDefinitionLib.WINDOW_KIND_TRADING,
                    SessionDefinitionLib.WINDOW_KIND_FIXING,
                    SessionDefinitionLib.WINDOW_KIND_MAINTENANCE
                )
            ),
            ruleSetHash: keccak256("SETRYN_COMPLETE_JOURNEY_SESSION_RULES_V1"),
            sourceHash: keccak256("SETRYN_COMPLETE_JOURNEY_SESSION_SOURCE_V1")
        });
        SessionId expected = SessionDefinitionLib.deriveSessionId(definition);
        SessionDay memory sessionDay = SessionDay({
            day: timing.fromDay,
            windowsHash: d.sessionRegistry.hashWindows(windows),
            evidenceHash: keccak256("SETRYN_COMPLETE_JOURNEY_SESSION_DAY_V1")
        });
        definition.dayScheduleRoot = SessionDefinitionLib.hashDay(expected, sessionDay);
        vm.prank(govOperator);
        uint32 version;
        (sessionId, version) = d.sessionRegistry.registerSession(definition);
        require(version == VERSION, "session version");
        _govern(address(d.sessionRegistry), abi.encodeCall(ISessionRegistry.activateSession, (sessionId, version)));
        d.tradingSessionPolicy.publishSessionDay(sessionId, version, sessionDay, windows, new bytes32[](0));
    }

    function _registerUsdcBinding(Deployment memory d, AssetId settlementAssetId) internal {
        vm.prank(govOperator);
        uint32 version = d.settlementAssetRegistry
            .registerBinding(
                SettlementAssetDefinition({
                    assetId: settlementAssetId,
                    token: nativeUsdc,
                    expectedRuntimeCodeHash: nativeUsdc.codehash,
                    qualificationHash: keccak256("SETRYN_COMPLETE_JOURNEY_USDC_BINDING_V1")
                })
            );
        require(version == VERSION, "usdc binding version");
        _govern(
            address(d.settlementAssetRegistry),
            abi.encodeCall(ISettlementAssetRegistry.activateBinding, (settlementAssetId, version))
        );
        assertTrue(d.settlementAssetRegistry.isOpenForNewRisk(settlementAssetId, version), "usdc open for risk");
    }

    function _registerBenchmark(
        Deployment memory d,
        AssetId baseAssetId,
        AssetId settlementAssetId,
        AdapterId fixingAdapterId,
        CalendarId calendarId,
        SessionId sessionId,
        uint8 liveDecimals
    ) internal returns (BenchmarkId benchmarkId) {
        BenchmarkDefinition memory definition = BenchmarkDefinition({
            namespaceId: NAMESPACE,
            referenceId: keccak256("BENCHMARK_BTC_USD"),
            kindId: BenchmarkDefinitionLib.BENCHMARK_KIND_SETTLEMENT_FIXING,
            baseAssetId: baseAssetId,
            quoteAssetId: settlementAssetId,
            adapterId: fixingAdapterId,
            adapterVersion: VERSION,
            calendarId: calendarId,
            calendarVersion: VERSION,
            sessionId: sessionId,
            sessionVersion: VERSION,
            feedKey: feedKey,
            requiredInterfaceHash: FIXING_INTERFACE,
            requiredCapabilityHash: FIXING_CAPABILITY,
            outputDecimals: liveDecimals,
            maxStalenessSeconds: 120,
            maxFutureSkewSeconds: 5,
            maxConfidenceBps: 100,
            observationRuleHash: keccak256("SETRYN_COMPLETE_JOURNEY_OBSERVATION_RULE_V1"),
            fallbackPolicyHash: keccak256("SETRYN_COMPLETE_JOURNEY_FALLBACK_V1"),
            disruptionPolicyHash: keccak256("SETRYN_COMPLETE_JOURNEY_DISRUPTION_V1"),
            dataRightsHash: keccak256(abi.encode("SETRYN_COMPLETE_JOURNEY_RIGHTS_V1", chainlinkFeed)),
            evidenceHash: keccak256(abi.encode("SETRYN_COMPLETE_JOURNEY_BENCHMARK_EVIDENCE_V1", chainlinkFeed))
        });
        vm.prank(govOperator);
        uint32 version;
        (benchmarkId, version) = d.benchmarkRegistry.registerBenchmark(definition);
        require(version == VERSION, "benchmark version");
        _govern(
            address(d.benchmarkRegistry), abi.encodeCall(IBenchmarkRegistry.activateBenchmark, (benchmarkId, version))
        );
    }

    function _registerFees(Deployment memory d, AssetId settlementAssetId)
        internal
        returns (FeeScheduleId feeScheduleId)
    {
        AccountId feeRecipient = d.collateralVault.deriveAccountId(address(this), keccak256("JOURNEY_FEES"));
        AccountId createdFeeRecipient = d.collateralVault.createAccount(keccak256("JOURNEY_FEES"));
        assertEq(
            AccountId.unwrap(createdFeeRecipient),
            AccountId.unwrap(feeRecipient),
            "fee recipient account must match commitment"
        );
        FeeRule[] memory rules = new FeeRule[](3);
        rules[0] = FeeRule({
            actionId: FeeScheduleDefinitionLib.FEE_ACTION_MAKER_FILL,
            requiresOpenSchedule: true,
            chargeRatePpm: FeeRatePpm.wrap(0),
            rebateRatePpm: FeeRatePpm.wrap(0),
            flatChargeMinor: 1,
            flatRebateMinor: 0,
            tiers: new FeeTier[](0)
        });
        rules[1] = FeeRule({
            actionId: FeeScheduleDefinitionLib.FEE_ACTION_TAKER_FILL,
            requiresOpenSchedule: true,
            chargeRatePpm: FeeRatePpm.wrap(0),
            rebateRatePpm: FeeRatePpm.wrap(0),
            flatChargeMinor: 1,
            flatRebateMinor: 0,
            tiers: new FeeTier[](0)
        });
        rules[2] = FeeRule({
            actionId: FeeScheduleDefinitionLib.FEE_ACTION_SETTLEMENT,
            requiresOpenSchedule: true,
            chargeRatePpm: FeeRatePpm.wrap(0),
            rebateRatePpm: FeeRatePpm.wrap(0),
            flatChargeMinor: 1,
            flatRebateMinor: 0,
            tiers: new FeeTier[](0)
        });
        for (uint256 i; i < rules.length; ++i) {
            for (uint256 j = i + 1; j < rules.length; ++j) {
                if (FeeActionId.unwrap(rules[i].actionId) > FeeActionId.unwrap(rules[j].actionId)) {
                    FeeRule memory tmp = rules[i];
                    rules[i] = rules[j];
                    rules[j] = tmp;
                }
            }
        }
        FeeRecipient[] memory entries = new FeeRecipient[](1);
        entries[0] = FeeRecipient({accountId: feeRecipient, sharePpm: 1_000_000});
        FeeRecipientSet memory recipients = FeeRecipientSet({
            remainderPolicyId: FeeRemainderPolicyId.wrap(keccak256("SetrynFeeRemainderPolicyV1:DesignatedRecipient")),
            remainderRecipientIndex: 0,
            recipients: entries
        });
        FeeScheduleDefinition memory definition = FeeScheduleDefinition({
            namespaceId: NAMESPACE,
            scheduleKey: keccak256("FEE_SCHEDULE_STANDARD_V1"),
            feeModelId: FeeScheduleDefinitionLib.FEE_MODEL_FLAT_PER_ACTION,
            settlementAssetId: settlementAssetId,
            settlementAssetVersion: VERSION,
            feeRulesHash: FeeEngineLib.hashRules(rules),
            recipientsHash: FeeEngineLib.hashRecipients(recipients),
            maxChargeRatePpm: FeeRatePpm.wrap(10_000),
            maxRebateRatePpm: FeeRatePpm.wrap(5_000),
            maxFlatChargeBaseUnits: 10e6,
            maxFlatRebateBaseUnits: 5e6,
            evidenceHash: keccak256("SETRYN_COMPLETE_JOURNEY_FEE_EVIDENCE_V1")
        });
        vm.prank(govOperator);
        uint32 version;
        (feeScheduleId, version) = d.feeScheduleRegistry.registerFeeSchedule(definition);
        require(version == VERSION, "fee version");
        _govern(
            address(d.feeScheduleRegistry),
            abi.encodeCall(IFeeScheduleRegistry.activateFeeSchedule, (feeScheduleId, version))
        );
        d.fundedFeeEngine.installScheduleWitness(feeScheduleId, version, rules, recipients);
        assertTrue(d.fundedFeeEngine.witnessInstalled(feeScheduleId, version), "fee witness installed");
    }

    function _registerRisk(Deployment memory d, AssetId settlementAssetId, AdapterId riskAdapterId)
        internal
        returns (RiskDomainId riskDomainId)
    {
        RiskDomainDefinition memory definition = RiskDomainDefinition({
            namespaceId: NAMESPACE,
            domainKey: keccak256("RISK_DOMAIN_ISOLATED_V1"),
            riskModelId: RiskDomainDefinitionLib.RISK_MODEL_ISOLATED_MARGIN,
            collateralAssetId: settlementAssetId,
            collateralAssetVersion: VERSION,
            riskAdapterId: riskAdapterId,
            riskAdapterVersion: VERSION,
            requiredAdapterKindId: AdapterDefinitionLib.ADAPTER_KIND_RISK,
            requiredInterfaceHash: RISK_INTERFACE,
            requiredCapabilityHash: RISK_CAPABILITY,
            marginRulesHash: keccak256("SETRYN_COMPLETE_JOURNEY_MARGIN_V1"),
            scenarioSetHash: keccak256("SETRYN_COMPLETE_JOURNEY_SCENARIOS_V1"),
            concentrationRulesHash: keccak256("SETRYN_COMPLETE_JOURNEY_CONCENTRATION_V1"),
            defaultProcessHash: keccak256("SETRYN_COMPLETE_JOURNEY_DEFAULT_V1"),
            insurancePolicyHash: keccak256("SETRYN_COMPLETE_JOURNEY_INSURANCE_V1"),
            qualificationEvidenceHash: keccak256("SETRYN_COMPLETE_JOURNEY_RISK_EVIDENCE_V1"),
            maxOpenInterestBaseUnits: 100_000_000e6,
            maxAggregateLiabilityBaseUnits: 50_000_000e6,
            maxAccountLiabilityBaseUnits: 5_000_000e6,
            maxAggregateReservationBaseUnits: 25_000_000e6,
            maxAccountReservationBaseUnits: 2_500_000e6
        });
        vm.prank(govOperator);
        uint32 version;
        (riskDomainId, version) = d.riskDomainRegistry.registerRiskDomain(definition);
        require(version == VERSION, "risk version");
        _govern(
            address(d.riskDomainRegistry),
            abi.encodeCall(IRiskDomainRegistry.activateRiskDomain, (riskDomainId, version))
        );
    }

    function _registerInstrument(Deployment memory d, AdapterId payoffAdapterId)
        internal
        returns (InstrumentId instrumentId)
    {
        InstrumentDefinition memory definition = InstrumentDefinition({
            namespaceId: NAMESPACE,
            instrumentKey: keccak256("INSTRUMENT_NDF_V1"),
            payoffFamilyId: PayoffFamilyId.wrap(keccak256("SETRYN_NDF_V1")),
            settlementClassId: InstrumentDefinitionLib.SETTLEMENT_CLASS_CASH,
            payoffModuleId: payoffAdapterId,
            payoffModuleVersion: VERSION,
            requiredAdapterKindId: AdapterDefinitionLib.ADAPTER_KIND_PAYOFF,
            requiredInterfaceHash: PAYOFF_INTERFACE,
            requiredCapabilityHash: PAYOFF_CAPABILITY,
            termsSchemaHash: TERMS_SCHEMA,
            maxFixingSlots: 4,
            maxTermsBytes: 4_096,
            maxEvaluationGas: 500_000,
            lifecyclePolicyHash: keccak256("SETRYN_COMPLETE_JOURNEY_LIFECYCLE_V1"),
            qualificationEvidenceHash: keccak256("SETRYN_COMPLETE_JOURNEY_INSTRUMENT_EVIDENCE_V1")
        });
        vm.prank(govOperator);
        uint32 version;
        (instrumentId, version) = d.instrumentRegistry.registerInstrument(definition);
        require(version == VERSION, "instrument version");
        _govern(
            address(d.instrumentRegistry),
            abi.encodeCall(IInstrumentRegistry.activateInstrument, (instrumentId, version))
        );
    }

    function _registerMarket(
        Deployment memory d,
        AssetId baseAssetId,
        AssetId settlementAssetId,
        BenchmarkId benchmarkId,
        CalendarId calendarId,
        SessionId sessionId,
        RiskDomainId riskDomainId,
        FeeScheduleId feeScheduleId
    ) internal returns (MarketId marketId) {
        MarketDefinition memory definition = MarketDefinition({
            namespaceId: NAMESPACE,
            marketKey: keccak256("MARKET_BTC_USD_NDF_V1"),
            baseAssetId: baseAssetId,
            quoteAssetId: settlementAssetId,
            settlementAssetId: settlementAssetId,
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
            tickSizeMinor: TickSizeMinor.wrap(1_000),
            lotStep: Lots.wrap(1),
            minOrderLots: Lots.wrap(1),
            maxOrderLots: Lots.wrap(10),
            minPriceTicks: PriceTicks.wrap(-1_000_000_000),
            maxPriceTicks: PriceTicks.wrap(1_000_000_000),
            executionModeSetHash: EXECUTION_MODE_SET,
            qualificationEvidenceHash: keccak256("SETRYN_COMPLETE_JOURNEY_MARKET_EVIDENCE_V1")
        });
        vm.prank(govOperator);
        uint32 version;
        (marketId, version) = d.marketRegistry.registerMarket(definition);
        require(version == VERSION, "market version");
        _govern(address(d.marketRegistry), abi.encodeCall(IMarketRegistry.activateMarket, (marketId, version)));
    }

    function _allowExecution(Deployment memory d) internal {
        vm.startPrank(govOperator);
        d.executionPolicyRegistry.setExecutionMode(EXECUTION_MODE_SET, EXECUTION_MODE_PUBLIC_BOOK, true);
        d.executionPolicyRegistry.setOrderAction(OrderActionId.wrap(keccak256("SETRYN_ORDER_ACTION_ENTER_V1")), true);
        vm.stopPrank();
    }

    function _configureSeries(
        Deployment memory d,
        BenchmarkId benchmarkId,
        InstrumentId instrumentId,
        MarketId marketId,
        CalendarId calendarId,
        JourneyTiming memory timing,
        uint8 liveDecimals
    ) internal returns (SeriesId seriesId, FixingSlot[] memory slots, bytes memory payoffTerms) {
        PayoffFixingRequirement[] memory requirements = new PayoffFixingRequirement[](1);
        requirements[0] = PayoffFixingRequirement({
            slot: 0,
            benchmarkId: benchmarkId,
            benchmarkVersion: VERSION,
            windowKindId: SessionDefinitionLib.WINDOW_KIND_FIXING,
            decimals: liveDecimals
        });
        uint256 scale = 10 ** uint256(liveDecimals);
        StrategyCompileInput memory input = StrategyCompileInput({
            kind: PayoffKind.Ndf,
            inputMode: StrategyInputMode.Outright,
            valueDecimals: liveDecimals,
            primaryInput: int256(100_000 * scale),
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
        payoffTerms = d.strategyCompiler.compileStrategy(input).canonicalTerms;

        SeriesDefinition memory definition = SeriesDefinition({
            namespaceId: NAMESPACE,
            seriesKey: keccak256("SERIES_BTC_USD_NDF_V1"),
            marketId: marketId,
            marketVersion: VERSION,
            instrumentId: instrumentId,
            instrumentVersion: VERSION,
            tradingStartsAt: timing.tradingStartsAt,
            lastTradingAt: timing.lastTradingAt,
            expiryAt: timing.expiryAt,
            exerciseOpensAt: timing.exerciseOpensAt,
            exerciseCutoffAt: timing.exerciseCutoffAt,
            fixingWindowOpen: timing.fixingWindowOpen,
            fixingWindowClose: timing.fixingWindowClose,
            primaryEvidenceDeadline: timing.primaryEvidenceDeadline,
            correctionCutoffAt: timing.correctionCutoffAt,
            finalResolutionAt: timing.finalResolutionAt,
            settlementDeadline: timing.settlementDeadline,
            exercisePolicyId: SeriesDefinitionLib.EXERCISE_POLICY_AUTOMATIC_UNLESS_ABANDONED,
            automaticExerciseThresholdMinor: 1,
            disruptionOutcomeId: SeriesDefinitionLib.DISRUPTION_OUTCOME_FLAT,
            terminalDisruptionTransferMinorPerLot: 0,
            payoffTermsHash: bytes32(uint256(1)),
            fixingSlotsHash: bytes32(uint256(1)),
            dateAdjustmentEvidenceHash: bytes32(uint256(1)),
            maxLongDebitMinorPerLot: 1_000e6,
            maxShortDebitMinorPerLot: 1_000e6,
            qualificationEvidenceHash: keccak256("SETRYN_COMPLETE_JOURNEY_SERIES_EVIDENCE_V1")
        });
        SeriesQualificationData memory qualification =
            _qualification(calendarId, timing, benchmarkId, definition, payoffTerms);
        definition.payoffTermsHash = d.seriesRegistry.hashPayoffTerms(TERMS_SCHEMA, qualification.payoffTerms);
        definition.fixingSlotsHash = d.seriesRegistry.hashFixingSlots(definition, qualification.fixingSlots, 4);
        definition.dateAdjustmentEvidenceHash = d.seriesRegistry.hashDateProofs(definition, qualification.dateProofs);
        vm.prank(govOperator);
        uint32 version;
        (seriesId, version) = d.seriesRegistry.registerSeries(definition, qualification);
        require(version == VERSION, "series version");
        _govern(
            address(d.seriesRegistry),
            abi.encodeCall(ISeriesRegistry.activateSeries, (seriesId, version, qualification))
        );
        slots = qualification.fixingSlots;
    }

    function _timestampForKind(JourneyTiming memory timing, SeriesDateKind kind) internal pure returns (uint64) {
        if (kind == SeriesDateKind.TradingStarts) return timing.tradingStartsAt;
        if (kind == SeriesDateKind.LastTrading) return timing.lastTradingAt;
        if (kind == SeriesDateKind.Expiry) return timing.expiryAt;
        if (kind == SeriesDateKind.ExerciseOpens) return timing.exerciseOpensAt;
        if (kind == SeriesDateKind.ExerciseCutoff) return timing.exerciseCutoffAt;
        if (kind == SeriesDateKind.FixingWindowOpen) return timing.fixingWindowOpen;
        if (kind == SeriesDateKind.FixingWindowClose) return timing.fixingWindowClose;
        if (kind == SeriesDateKind.PrimaryEvidenceDeadline) return timing.primaryEvidenceDeadline;
        if (kind == SeriesDateKind.CorrectionCutoff) return timing.correctionCutoffAt;
        if (kind == SeriesDateKind.FinalResolution) return timing.finalResolutionAt;
        if (kind == SeriesDateKind.SettlementDeadline) return timing.settlementDeadline;
        revert("unknown series date kind");
    }

    function _qualification(
        CalendarId calendarId,
        JourneyTiming memory timing,
        BenchmarkId benchmarkId,
        SeriesDefinition memory definition,
        bytes memory payoffTerms
    ) internal view returns (SeriesQualificationData memory qualification) {
        qualification.payoffTerms = payoffTerms;
        qualification.fixingSlots = new FixingSlot[](1);
        qualification.fixingSlots[0].slot = 0;
        qualification.fixingSlots[0].candidates = new FixingCandidate[](1);
        qualification.fixingSlots[0].candidates[0] = FixingCandidate({
            benchmarkId: benchmarkId,
            benchmarkVersion: VERSION,
            requiredWindowKindId: SessionDefinitionLib.WINDOW_KIND_FIXING,
            selectionRuleId: SeriesDefinitionLib.FIXING_SELECTION_OFFICIAL,
            targetAt: timing.targetAt,
            windowStartsAt: timing.windowStartsAt,
            windowEndsAt: timing.windowEndsAt,
            unavailableAfter: timing.unavailableAfter,
            maxPublicationLagSeconds: CANDIDATE_LAG,
            minimumObservations: 1,
            maximumObservations: 1,
            selectionParametersHash: keccak256("SETRYN_COMPLETE_JOURNEY_SELECTION_V1")
        });
        qualification.dateProofs = new SeriesDateProof[](11);
        for (uint8 rawKind = 1; rawKind <= 11; ++rawKind) {
            uint256 index = uint256(rawKind) - 1;
            SeriesDateKind kind = SeriesDateKind(rawKind);
            uint64 timestamp = _timestampForKind(timing, kind);
            uint32 effectiveDay = uint32(uint256(timestamp) / 1 days);
            qualification.dateProofs[index].kind = kind;
            qualification.dateProofs[index].conventionId = SeriesDefinitionLib.DATE_ADJUSTMENT_UNADJUSTED;
            qualification.dateProofs[index].scheduledDay = effectiveDay;
            qualification.dateProofs[index].calendarDays = new CalendarDayProof[](1);
            qualification.dateProofs[index].calendarDays[0].calendarDay =
                CalendarDay({day: effectiveDay, isBusinessDay: true, evidenceHash: DAY_EVIDENCE});
            qualification.dateProofs[index].calendarDays[0].merkleProof =
                _proofForDay(calendarId, timing.fromDay, timing.throughDay, effectiveDay);
        }
    }

    function _fundUsers(Deployment memory d, AssetId settlementAssetId, address alice, address bob)
        internal
        returns (AccountId aliceAccount, AccountId bobAccount)
    {
        uint128 depositAmount = 20_000e6;
        deal(nativeUsdc, alice, depositAmount);
        deal(nativeUsdc, bob, depositAmount);
        require(IERC20Decimals(nativeUsdc).balanceOf(alice) == depositAmount, "alice deal must land");
        require(IERC20Decimals(nativeUsdc).balanceOf(bob) == depositAmount, "bob deal must land");

        vm.prank(alice);
        aliceAccount = d.collateralVault.createAccount(keccak256("JOURNEY_ALICE_V1"));
        vm.prank(bob);
        bobAccount = d.collateralVault.createAccount(keccak256("JOURNEY_BOB_V1"));

        vm.startPrank(alice);
        IERC20Decimals(nativeUsdc).approve(address(d.collateralVault), type(uint256).max);
        d.collateralVault.deposit(settlementAssetId, VERSION, aliceAccount, depositAmount);
        vm.stopPrank();
        vm.startPrank(bob);
        IERC20Decimals(nativeUsdc).approve(address(d.collateralVault), type(uint256).max);
        d.collateralVault.deposit(settlementAssetId, VERSION, bobAccount, depositAmount);
        vm.stopPrank();

        CollateralId collateralId = d.collateralVault.deriveCollateralId(settlementAssetId, VERSION);
        (uint128 aliceTotal,,) = d.collateralVault.balanceOf(aliceAccount, collateralId);
        (uint128 bobTotal,,) = d.collateralVault.balanceOf(bobAccount, collateralId);
        assertEq(aliceTotal, depositAmount, "alice vault balance must equal deposit");
        assertEq(bobTotal, depositAmount, "bob vault balance must equal deposit");
    }

    function _placeOpposingOrders(
        Deployment memory d,
        SeriesId seriesId,
        FeeScheduleId feeScheduleId,
        RiskDomainId riskDomainId,
        address alice,
        uint256 aliceKey,
        address bob,
        uint256 bobKey,
        AccountId aliceAccount,
        AccountId bobAccount
    )
        internal
        returns (
            bytes32 buyHash,
            bytes32 sellHash,
            RiskAdmissionId buyAdmissionId,
            bytes32 buyResultHash,
            RiskAdmissionId sellAdmissionId,
            bytes32 sellResultHash
        )
    {
        bytes32 policyId = keccak256("SETRYN_COMPLETE_JOURNEY_POLICY_V1");
        OrderActionId enterAction = OrderActionId.wrap(keccak256("SETRYN_ORDER_ACTION_ENTER_V1"));
        PublicOrder memory buyOrder = PublicOrder({
            signer: alice,
            accountId: aliceAccount,
            policyId: policyId,
            policyContextHash: keccak256("JOURNEY_BUY_CONTEXT_V1"),
            actionId: enterAction,
            targetKind: OrderTargetKind.Series,
            seriesId: seriesId,
            packageId: PackageId.wrap(bytes32(0)),
            targetVersion: VERSION,
            side: Side.Buy,
            lots: Lots.wrap(2),
            priceTicks: PriceTicks.wrap(100),
            timeInForce: TimeInForce.GTC,
            deadline: uint64(block.timestamp + 1 hours),
            executionModeId: EXECUTION_MODE_PUBLIC_BOOK,
            feeScheduleId: feeScheduleId,
            feeScheduleVersion: VERSION,
            maxFeeMinor: 1_000e6,
            recipient: alice,
            permittedExecutor: address(0),
            nonce: 1,
            salt: keccak256("JOURNEY_BUY_SALT_V1"),
            allowPartialFills: false,
            minimumFillLots: Lots.wrap(2),
            remainderPolicy: RemainderPolicy.KeepOpen,
            postOnly: false,
            reduceOnly: false
        });
        PublicOrder memory sellOrder = PublicOrder({
            signer: bob,
            accountId: bobAccount,
            policyId: policyId,
            policyContextHash: keccak256("JOURNEY_SELL_CONTEXT_V1"),
            actionId: enterAction,
            targetKind: OrderTargetKind.Series,
            seriesId: seriesId,
            packageId: PackageId.wrap(bytes32(0)),
            targetVersion: VERSION,
            side: Side.Sell,
            lots: Lots.wrap(2),
            priceTicks: PriceTicks.wrap(100),
            timeInForce: TimeInForce.GTC,
            deadline: uint64(block.timestamp + 1 hours),
            executionModeId: EXECUTION_MODE_PUBLIC_BOOK,
            feeScheduleId: feeScheduleId,
            feeScheduleVersion: VERSION,
            maxFeeMinor: 1_000e6,
            recipient: bob,
            permittedExecutor: address(0),
            nonce: 1,
            salt: keccak256("JOURNEY_SELL_SALT_V1"),
            allowPartialFills: false,
            minimumFillLots: Lots.wrap(2),
            remainderPolicy: RemainderPolicy.KeepOpen,
            postOnly: false,
            reduceOnly: false
        });
        bytes32 buyHash_ = d.orderState.hashOrder(buyOrder);
        bytes32 sellHash_ = d.orderState.hashOrder(sellOrder);
        assertTrue(buyHash_ != bytes32(0), "buy order hash nonzero");
        assertTrue(sellHash_ != bytes32(0), "sell order hash nonzero");
        assertTrue(buyHash_ != sellHash_, "opposing order hashes must differ");
        (uint8 vBuy, bytes32 rBuy, bytes32 sBuy) = vm.sign(aliceKey, buyHash_);
        (uint8 vSell, bytes32 rSell, bytes32 sSell) = vm.sign(bobKey, sellHash_);
        // Buyer maps to long, seller maps to short. Preserve exact mapping.
        (RiskAdmissionId buyAdmission_, bytes32 buyResult_) =
            _reserveAndBindRisk(d, buyOrder, buyHash_, alice, riskDomainId);
        (RiskAdmissionId sellAdmission_, bytes32 sellResult_) =
            _reserveAndBindRisk(d, sellOrder, sellHash_, bob, riskDomainId);
        bytes32 registeredBuy = d.orderState.registerSignedOrder(buyOrder, abi.encodePacked(rBuy, sBuy, vBuy));
        bytes32 registeredSell = d.orderState.registerSignedOrder(sellOrder, abi.encodePacked(rSell, sSell, vSell));
        assertEq(registeredBuy, buyHash_, "buy registration must return hash");
        assertEq(registeredSell, sellHash_, "sell registration must return hash");
        assertTrue(uint8(d.orderState.statusOf(buyHash_)) == 1, "buy order must be open");
        assertTrue(uint8(d.orderState.statusOf(sellHash_)) == 1, "sell order must be open");
        buyHash = buyHash_;
        sellHash = sellHash_;
        buyAdmissionId = buyAdmission_;
        buyResultHash = buyResult_;
        sellAdmissionId = sellAdmission_;
        sellResultHash = sellResult_;
    }

    function _reserveAndBindRisk(
        Deployment memory d,
        PublicOrder memory order,
        bytes32 orderHash,
        address signer,
        RiskDomainId riskDomainId
    ) internal returns (RiskAdmissionId admissionId, bytes32 resultHash) {
        PortfolioPositionWitness[] memory witnesses = new PortfolioPositionWitness[](1);
        witnesses[0] = PortfolioPositionWitness({
            positionId: PositionId.wrap(keccak256(abi.encode("JOURNEY_WITNESS", signer, orderHash))),
            seriesId: order.seriesId,
            seriesVersion: order.targetVersion,
            signedLots: order.side == Side.Buy ? int128(2) : int128(-2),
            entryPriceTicks: order.priceTicks,
            maximumTerminalLiabilityBaseUnits: 2_000e6,
            economicsHash: keccak256(abi.encode("JOURNEY_ECO", signer, orderHash))
        });
        RiskObservation[] memory observations = new RiskObservation[](1);
        observations[0] = RiskObservation({
            observationKey: keccak256(abi.encode("JOURNEY_OBS", signer)),
            valueHash: keccak256(abi.encode("JOURNEY_VAL", block.timestamp)),
            observedAt: uint64(block.timestamp)
        });
        RiskAdmissionRequest memory request = RiskAdmissionRequest({
            accountId: order.accountId,
            riskDomainId: riskDomainId,
            riskDomainVersion: VERSION,
            openInterestIncreaseBaseUnits: 2,
            terminalLiabilityIncreaseBaseUnits: 2_000e6,
            deadline: uint64(block.timestamp + 4 minutes),
            nonce: uint256(keccak256(abi.encode(signer, orderHash))),
            salt: keccak256(abi.encode("JOURNEY_RISK_SALT", signer, orderHash))
        });
        vm.prank(address(d.atomicClearingEngine));
        (RiskAdmissionId reservedId, PortfolioRiskResult memory result) =
            d.portfolioRiskEngine.reserveNewRisk(request, witnesses, observations);
        require(RiskAdmissionId.unwrap(reservedId) != bytes32(0), "admission nonzero");
        bytes32 storedHash = d.portfolioRiskEngine.getAdmission(reservedId).resultHash;
        require(storedHash != bytes32(0), "result hash nonzero");
        require(storedHash == keccak256(abi.encode(result)), "result hash must match reservation");
        vm.prank(signer);
        bytes32 boundHash = d.riskAdmissionBindingRegistry.bindOrderRisk(order, reservedId);
        assertEq(boundHash, orderHash, "risk binding must return order hash");
        admissionId = reservedId;
        resultHash = storedHash;
    }

    function _clearDirectly(
        Deployment memory d,
        bytes memory payoffTerms,
        bytes32 buyOrderHash,
        bytes32 sellOrderHash,
        RiskAdmissionId buyAdmissionId,
        bytes32 buyResultHash,
        RiskAdmissionId sellAdmissionId,
        bytes32 sellResultHash,
        AccountId aliceAccount,
        AccountId bobAccount
    ) internal returns (FillId fillId, PositionId positionId) {
        require(buyOrderHash != bytes32(0) && sellOrderHash != bytes32(0), "order hashes nonzero");
        require(
            RiskAdmissionId.unwrap(buyAdmissionId) != bytes32(0)
                && RiskAdmissionId.unwrap(sellAdmissionId) != bytes32(0),
            "admissions nonzero"
        );
        require(buyResultHash != bytes32(0) && sellResultHash != bytes32(0), "result hashes nonzero");
        require(payoffTerms.length > 0, "payoff terms nonzero");

        // Production direct path creates liability, consideration, and fee locks itself.
        // Both the clearing engine (liability/consideration/fee locks) and the position
        // engine (terminal liability reservations) must be approved lock operators via
        // normal account-controller approvals.
        (address aliceController,) = d.collateralVault.getAccount(aliceAccount);
        (address bobController,) = d.collateralVault.getAccount(bobAccount);
        vm.prank(aliceController);
        d.collateralVault.setLockOperator(aliceAccount, address(d.atomicClearingEngine), true);
        vm.prank(bobController);
        d.collateralVault.setLockOperator(bobAccount, address(d.atomicClearingEngine), true);
        vm.prank(aliceController);
        d.collateralVault.setLockOperator(aliceAccount, address(d.positionEngine), true);
        vm.prank(bobController);
        d.collateralVault.setLockOperator(bobAccount, address(d.positionEngine), true);

        OrderFunding memory noFunding = OrderFunding({
            terminalLiabilityLockId: CollateralLockId.wrap(bytes32(0)),
            considerationLockId: CollateralLockId.wrap(bytes32(0))
        });
        ClearingFeeFunding memory noFeeFunding = ClearingFeeFunding({
            consumptionId: bytes32(0),
            chargeLockId: CollateralLockId.wrap(bytes32(0)),
            budgetLockId: CollateralLockId.wrap(bytes32(0))
        });
        // Buyer is long, seller is short. Buy order is taker, sell order is maker.
        BilateralMatch memory matchData = BilateralMatch({
            takerOrderHash: buyOrderHash,
            makerOrderHash: sellOrderHash,
            fillLots: Lots.wrap(2),
            executionPriceTicks: PriceTicks.wrap(100),
            longAdmissionId: buyAdmissionId,
            longAdmissionResultHash: buyResultHash,
            shortAdmissionId: sellAdmissionId,
            shortAdmissionResultHash: sellResultHash,
            takerFunding: noFunding,
            makerFunding: noFunding,
            takerFeeFunding: noFeeFunding,
            makerFeeFunding: noFeeFunding
        });
        SeriesClearingRequest memory request = SeriesClearingRequest({
            matchData: matchData, payoffTerms: payoffTerms, channelKind: ClearingChannelKind.Direct
        });

        // Exact production principal holding MATCH_EXECUTOR_ROLE. No new test role.
        require(
            d.atomicClearingEngine.hasRole(d.atomicClearingEngine.MATCH_EXECUTOR_ROLE(), govOperator),
            "gov operator must hold match executor role"
        );
        vm.prank(govOperator);
        fillId = d.atomicClearingEngine.clearSeries(request);
        require(FillId.unwrap(fillId) != bytes32(0), "fill id nonzero");

        FillRecord memory record = d.atomicClearingEngine.getFill(fillId);
        require(FillId.unwrap(record.fillId) == FillId.unwrap(fillId), "fill must be readable");
        require(Lots.unwrap(record.fillLots) == 2, "fill lots must be 2");
        require(PriceTicks.unwrap(record.executionPriceTicks) == 100, "fill price must be 100");

        PositionId[] memory positions = d.atomicClearingEngine.fillPositions(fillId);
        require(positions.length == 1, "direct fill must create exactly one position");
        positionId = positions[0];
        require(PositionId.unwrap(positionId) != bytes32(0), "position id nonzero");

        require(uint8(d.orderState.statusOf(buyOrderHash)) == uint8(OrderStatus.Filled), "buy order must be filled");
        require(uint8(d.orderState.statusOf(sellOrderHash)) == uint8(OrderStatus.Filled), "sell order must be filled");
    }

    function _assertPositionLive(
        Deployment memory d,
        PositionId positionId,
        AccountId aliceAccount,
        AccountId bobAccount
    ) internal view {
        (PositionEconomics memory economics, PositionLifecycle memory lifecycle) =
            d.positionEngine.getPosition(positionId);
        require(uint8(lifecycle.status) == uint8(PositionStatus.Live), "position must be live after clearing");
        require(AccountId.unwrap(economics.longAccountId) == AccountId.unwrap(aliceAccount), "long must be alice");
        require(AccountId.unwrap(economics.shortAccountId) == AccountId.unwrap(bobAccount), "short must be bob");
        require(Lots.unwrap(economics.lots) == 2, "position lots must be 2");
        require(economics.maxLongDebitMinor == 2_000e6, "long debit must equal caps");
        require(economics.maxShortDebitMinor == 2_000e6, "short debit must equal caps");
    }

    function _tamperedBranchFailsBeforeSettlement(
        Deployment memory d,
        SeriesId seriesId,
        FixingSlot[] memory slots,
        PositionId positionId,
        uint80 roundId,
        uint8 liveDecimals
    ) internal {
        require(
            uint8(d.positionEngine.positionStatus(positionId)) == uint8(PositionStatus.Live),
            "position must be live before tampered branch"
        );
        (HistoricalObservation[] memory observations, bytes memory evidence) = _correctPayload(roundId, liveDecimals);
        observations[0].value += 1;
        require(
            uint8(d.fixingEngine.fixingStatus(seriesId, VERSION, 0)) == uint8(FixingStatus.Unspecified),
            "fixing must be unproposed before tampered branch"
        );
        vm.expectRevert();
        d.fixingEngine.submitEvidence(seriesId, VERSION, slots, 0, 0, observations, evidence);
        require(
            uint8(d.positionEngine.positionStatus(positionId)) == uint8(PositionStatus.Live),
            "tampered branch must leave position intact"
        );
        require(
            uint8(d.fixingEngine.fixingStatus(seriesId, VERSION, 0)) == uint8(FixingStatus.Unspecified),
            "tampered branch must leave fixing unproposed"
        );
    }

    function _submitFixingFinalizeAndSettle(
        Deployment memory d,
        SeriesId seriesId,
        FixingSlot[] memory slots,
        PositionId positionId,
        uint80 roundId,
        uint8 liveDecimals
    ) internal {
        (HistoricalObservation[] memory observations, bytes memory evidence) = _correctPayload(roundId, liveDecimals);
        require(observations[0].publishedAt <= block.timestamp, "round must be publishable at submit time");
        d.fixingEngine.submitEvidence(seriesId, VERSION, slots, 0, 0, observations, evidence);
        require(
            uint8(d.fixingEngine.fixingStatus(seriesId, VERSION, 0)) == uint8(FixingStatus.Proposed),
            "fixing must be proposed"
        );
        uint64 warpTarget = slots[0].candidates[0].unavailableAfter + 2 hours;
        require(warpTarget >= block.timestamp, "finalize warp must move forward");
        vm.warp(warpTarget);
        d.fixingEngine.finalizeFixing(seriesId, VERSION, 0);
        require(
            uint8(d.fixingEngine.fixingStatus(seriesId, VERSION, 0)) == uint8(FixingStatus.Finalized),
            "fixing must be finalized"
        );
        (PositionEconomics memory preSettleEconomics,) = d.positionEngine.getPosition(positionId);
        if (block.timestamp <= preSettleEconomics.exerciseCutoffAt) {
            uint64 settlementAt = preSettleEconomics.exerciseCutoffAt + 1;
            require(settlementAt > block.timestamp, "settlement warp must move forward");
            require(settlementAt < preSettleEconomics.finalResolutionAt, "settlement must precede final resolution");
            vm.warp(settlementAt);
        }
        require(block.timestamp > preSettleEconomics.exerciseCutoffAt, "settlement must follow exercise cutoff");
        require(block.timestamp < preSettleEconomics.finalResolutionAt, "settlement must precede final resolution");
        FeeActionRequest[] memory noFees = new FeeActionRequest[](0);
        SettlementId settlementId = d.cashSettlementCoordinator.finalizeNormalSettlement(positionId, slots, noFees);
        require(SettlementId.unwrap(settlementId) != bytes32(0), "settlement id nonzero");
        require(
            uint8(d.cashSettlementCoordinator.getSettlement(settlementId).mode) == uint8(SettlementMode.Normal),
            "settlement must be normal"
        );
        (, PositionLifecycle memory settledLifecycle) = d.positionEngine.getPosition(positionId);
        require(
            uint8(settledLifecycle.status) == uint8(PositionStatus.Settled), "position must be settled after normal"
        );
        require(settledLifecycle.terminalOutcomeReference != bytes32(0), "terminal outcome must be nonzero");
    }

    function _withdrawAndReconcile(
        Deployment memory d,
        AssetId settlementAssetId,
        address alice,
        address bob,
        AccountId aliceAccount,
        AccountId bobAccount
    ) internal {
        CollateralId collateralId = d.collateralVault.deriveCollateralId(settlementAssetId, VERSION);
        (uint128 aliceTotalBefore,,) = d.collateralVault.balanceOf(aliceAccount, collateralId);
        (uint128 bobTotalBefore,,) = d.collateralVault.balanceOf(bobAccount, collateralId);
        assertTrue(aliceTotalBefore > 0 && bobTotalBefore > 0, "prefixed balances nonzero");

        _fulfillAndWithdraw(d, settlementAssetId, alice, aliceAccount, collateralId);
        _fulfillAndWithdraw(d, settlementAssetId, bob, bobAccount, collateralId);

        uint256 aliceUsdc = IERC20Decimals(nativeUsdc).balanceOf(alice);
        uint256 bobUsdc = IERC20Decimals(nativeUsdc).balanceOf(bob);
        assertTrue(aliceUsdc + bobUsdc <= 40_000e6, "total USDC must not exceed funded amount");
        assertTrue(d.collateralVault.isSolvent(nativeUsdc), "vault must remain solvent");
    }

    function _fulfillAndWithdraw(
        Deployment memory d,
        AssetId settlementAssetId,
        address user,
        AccountId accountId,
        CollateralId collateralId
    ) internal {
        (uint128 total, uint128 locked, uint128 available) = d.collateralVault.balanceOf(accountId, collateralId);
        total;
        locked;
        if (available == 0) return;
        vm.prank(user);
        d.collateralVault.withdraw(settlementAssetId, VERSION, accountId, available, user);
        (uint128 totalAfter,,) = d.collateralVault.balanceOf(accountId, collateralId);
        assertTrue(totalAfter <= total, "withdraw must not increase balance");
    }

    function _assertHistoriesReadable(Deployment memory d, PositionId positionId, SeriesId seriesId) internal view {
        assertTrue(PositionId.unwrap(positionId) != bytes32(0), "position id readable");
        assertTrue(SeriesId.unwrap(seriesId) != bytes32(0), "series id readable");
        assertTrue(d.positionEngine.positionCount() >= 1, "position history must contain journey position");
        SettlementId settlementId = d.cashSettlementCoordinator.settlementOf(positionId);
        assertTrue(SettlementId.unwrap(settlementId) != bytes32(0), "settlement history must be readable");
        assertTrue(
            SettlementId.unwrap(d.cashSettlementCoordinator.getSettlement(settlementId).settlementId) != bytes32(0),
            "settlement record must be readable"
        );
    }

    function _parseFeedKey(string memory raw) internal pure returns (bytes32) {
        bytes memory data = bytes(raw);
        if (data.length == 66 && data[0] == "0" && (data[1] == "x" || data[1] == "X")) {
            bytes32 parsed;
            for (uint256 i; i < 32; ++i) {
                uint8 hi = _hexNibble(data[2 + i * 2]);
                uint8 lo = _hexNibble(data[3 + i * 2]);
                parsed |= bytes32(uint256(uint8(hi * 16 + lo)) << (8 * (31 - i)));
            }
            require(parsed != bytes32(0), "feed key hex must be nonzero");
            return parsed;
        }
        return keccak256(data);
    }

    function _hexNibble(bytes1 ch) internal pure returns (uint8) {
        uint8 value = uint8(ch);
        if (value >= 48 && value <= 57) return value - 48;
        if (value >= 97 && value <= 102) return value - 87;
        if (value >= 65 && value <= 70) return value - 55;
        revert("invalid feed key hex");
    }

    function _startsWithHttps(string memory value) internal pure returns (bool) {
        bytes memory data = bytes(value);
        if (data.length < 8) return false;
        return data[0] == "h" && data[1] == "t" && data[2] == "t" && data[3] == "p" && data[4] == "s" && data[5] == ":"
            && data[6] == "/" && data[7] == "/";
    }
}
