// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {BootstrapSetrynDevnet} from "../../script/BootstrapSetrynDevnet.s.sol";
import {DeploySetryn} from "../../script/DeploySetryn.s.sol";
import {CanonicalStrategyCompiler} from "../../src/compiler/CanonicalStrategyCompiler.sol";
import {DevnetSettlementToken} from "../../src/devnet/DevnetSettlementToken.sol";
import {FundedFeeEngine} from "../../src/fees/FundedFeeEngine.sol";
import {IAdapterRegistry} from "../../src/interfaces/IAdapterRegistry.sol";
import {IAssetRegistry} from "../../src/interfaces/IAssetRegistry.sol";
import {IBenchmarkRegistry} from "../../src/interfaces/IBenchmarkRegistry.sol";
import {ICalendarRegistry} from "../../src/interfaces/ICalendarRegistry.sol";
import {ICollateralVault} from "../../src/interfaces/ICollateralVault.sol";
import {IFeeScheduleRegistry} from "../../src/interfaces/IFeeScheduleRegistry.sol";
import {IInstrumentRegistry} from "../../src/interfaces/IInstrumentRegistry.sol";
import {IMarketRegistry} from "../../src/interfaces/IMarketRegistry.sol";
import {IPortfolioRiskEngine} from "../../src/interfaces/IPortfolioRiskEngine.sol";
import {IQuoteSettlementRouter} from "../../src/interfaces/IQuoteSettlementRouter.sol";
import {IRiskDomainRegistry} from "../../src/interfaces/IRiskDomainRegistry.sol";
import {ISequencerUptimeFeed} from "../../src/interfaces/ISequencerUptimeFeed.sol";
import {ISeriesRegistry} from "../../src/interfaces/ISeriesRegistry.sol";
import {ISessionRegistry} from "../../src/interfaces/ISessionRegistry.sol";
import {ISettlementAssetRegistry} from "../../src/interfaces/ISettlementAssetRegistry.sol";
import {ITradingSessionPolicy} from "../../src/interfaces/ITradingSessionPolicy.sol";
import {CappedForwardPayoffModule} from "../../src/payoff/ProductionPayoffModules.sol";
import {ExecutionPolicyRegistry} from "../../src/policy/ExecutionPolicyRegistry.sol";
import {RiskAdmissionBindingRegistry} from "../../src/policy/RiskAdmissionBindingRegistry.sol";
import {StreamCapacityState} from "../../src/types/CapacityManagerTypes.sol";
import {Side} from "../../src/types/Enums.sol";
import {AccountId, AssetId, CollateralId, FillId, PackageId, SeriesId} from "../../src/types/Identifiers.sol";
import {
    OrderActionId,
    OrderStatus,
    OrderTargetKind,
    PublicOrder,
    RemainderPolicy,
    TimeInForce
} from "../../src/types/OrderTypes.sol";
import {
    MakerQuoteTerms,
    QuoteCapacityTerms,
    QuoteSettlement,
    SignedMakerQuote,
    SignedTakerOrder,
    TakerSettlementTerms
} from "../../src/types/QuoteSettlementTypes.sol";
import {OrderRiskAuthorization, RiskAdmissionId} from "../../src/types/RiskTypes.sol";
import {SeriesDefinition} from "../../src/types/SeriesDefinition.sol";
import {StreamId} from "../../src/types/StreamTypes.sol";
import {Lots, PriceTicks} from "../../src/types/Units.sol";
import {SetrynDeploymentHarness} from "./harness/SetrynDeploymentHarness.sol";

/// @notice Offchain firm quotes settled through QuoteSettlementRouter on the production deployment graph: a maker opens
/// capacity once, signs quotes with no transaction, and an unprivileged address settles a taker's signed order against
/// one in a single atomic transaction. Covers entry and exit through the same path, replay, expiry, bad signatures,
/// exhausted capacity, price violations, relayer fees, and that a failed settlement leaves nothing behind.
contract QuoteSettlementRouterIntegrationTest is Test {
    uint256 internal constant EPOCH = 1_790_067_600;
    uint128 internal constant DEPOSIT = 1_000_000e6;
    uint128 internal constant MAX_FEE = 5_000_000;
    int128 internal constant ASK = 101;
    int128 internal constant BID = 99;
    bytes32 internal constant EXECUTION_MODE_PUBLIC_BOOK = keccak256("SETRYN_EXECUTION_MODE_PUBLIC_BOOK_V1");
    OrderActionId internal constant ENTER = OrderActionId.wrap(keccak256("SETRYN_ORDER_ACTION_ENTER_V1"));

    struct Trader {
        address signer;
        uint256 key;
        AccountId account;
    }

    SetrynDeploymentHarness internal harness;
    DeploySetryn.Deployment internal d;
    IQuoteSettlementRouter internal router;
    RiskAdmissionBindingRegistry internal bindings;

    address internal operator = makeAddr("quote-operator");
    address internal treasury = makeAddr("quote-treasury");
    address internal bot = makeAddr("independent-settlement-bot");

    DevnetSettlementToken internal token;
    SeriesId internal seriesId;
    AssetId internal settlementAssetId;
    bytes internal payoffTerms;
    uint128 internal perLot;
    Trader internal maker;
    Trader internal alice;
    Trader internal relayer;
    StreamId internal capacityId;
    uint256 internal nonce;

    function setUp() public {
        vm.warp(EPOCH);
        harness = new SetrynDeploymentHarness();
        d = harness.deploy(_config());
        BootstrapSetrynDevnet.Runtime memory runtime = new BootstrapSetrynDevnet().bootstrap(_bootstrapInput());
        router = IQuoteSettlementRouter(address(d.quoteSettlementRouter));
        bindings = d.riskAdmissionBindingRegistry;
        token = runtime.settlementToken;
        seriesId = runtime.series[0].seriesId;
        settlementAssetId = runtime.settlementAssetId;
        payoffTerms = runtime.series[0].payoffTerms;
        SeriesDefinition memory series = d.seriesRegistry.getSeries(seriesId, 1).definition;
        perLot = series.maxLongDebitMinorPerLot > series.maxShortDebitMinorPerLot
            ? series.maxLongDebitMinorPerLot
            : series.maxShortDebitMinorPerLot;

        vm.warp(EPOCH + 1 minutes);
        maker = _trader("quote-maker");
        alice = _trader("quote-alice");
        relayer = _trader("quote-relayer");
        capacityId = _openCapacity(perLot * 20, 1 hours);
    }

    /// The capacity is opened from the maker's signature by someone else; it locks the maker's collateral once.
    function test_CapacityOpensFromMakerSignatureForAnySubmitter() public view {
        StreamCapacityState memory state = d.streamCapacityManager.getStreamCapacity(capacityId);
        assertEq(state.capacity.owner, maker.signer);
        assertEq(state.capacity.remainingLiability, perLot * 20);
        assertEq(router.quoteCapacity(capacityId).maker, maker.signer);
    }

    /// One transaction from an address with no role: both orders register, both admissions bind and are consumed, the
    /// position exists, the capacity is drawn, and the operator and maker sent nothing.
    function test_AnyAddressSettlesAFirmQuoteInOneTransaction() public {
        QuoteSettlement memory settlement = _settlement(_ask(5, ASK), alice, Side.Buy, 2, ASK, 0);
        vm.prank(bot);
        uint256 gasBefore = gasleft();
        FillId fillId = router.settle(settlement);
        emit log_named_uint("settle gas", gasBefore - gasleft());

        assertEq(d.atomicClearingEngine.fillPositions(fillId).length, 1);
        bytes32 quoteHash = d.orderState.hashOrder(settlement.quote.order);
        bytes32 takerHash = d.orderState.hashOrder(settlement.taker.order);
        assertEq(uint8(d.orderState.statusOf(quoteHash)), uint8(OrderStatus.PartiallyFilled));
        assertEq(uint8(d.orderState.statusOf(takerHash)), uint8(OrderStatus.Filled));
        assertTrue(RiskAdmissionId.unwrap(bindings.admissionForOrder(quoteHash)) != bytes32(0));
        assertEq(d.streamCapacityManager.getStreamCapacity(capacityId).capacity.remainingLiability, perLot * 18);
        assertEq(d.streamCapacityManager.getStreamCapacity(capacityId).consumedSequence, 1);
    }

    /// Exit uses the same path: the buyer later sells into the maker's bid quote.
    function test_EntryAndExitSettleThroughTheSamePath() public {
        vm.prank(bot);
        router.settle(_settlement(_ask(5, ASK), alice, Side.Buy, 2, ASK, 0));
        vm.warp(block.timestamp + 5);
        vm.prank(bot);
        FillId exitFill = router.settle(_settlement(_bid(5, BID), alice, Side.Sell, 2, BID, 0));
        assertEq(d.atomicClearingEngine.fillPositions(exitFill).length, 1);
        assertEq(d.streamCapacityManager.getStreamCapacity(capacityId).consumedSequence, 2);
    }

    function test_QuoteCannotSettleTwice() public {
        SignedMakerQuote memory quote = _ask(5, ASK);
        vm.prank(bot);
        router.settle(_settlement(quote, alice, Side.Buy, 2, ASK, 0));
        QuoteSettlement memory replay = _settlement(quote, alice, Side.Buy, 2, ASK, 0);
        bytes32 quoteHash = d.orderState.hashOrder(quote.order);
        vm.expectRevert(abi.encodeWithSelector(IQuoteSettlementRouter.QuoteAlreadyConsumed.selector, quoteHash));
        vm.prank(bot);
        router.settle(replay);
    }

    function test_ExpiredQuoteReverts() public {
        QuoteSettlement memory settlement = _settlement(_ask(5, ASK), alice, Side.Buy, 2, ASK, 0);
        vm.warp(settlement.quote.order.deadline + 1);
        vm.expectRevert();
        vm.prank(bot);
        router.settle(settlement);
    }

    function test_InvalidTakerSignatureRevertsAndLeavesNothingBehind() public {
        QuoteSettlement memory settlement = _settlement(_ask(5, ASK), alice, Side.Buy, 2, ASK, 0);
        // The taker's risk authorization signed by the maker's key instead of the taker's.
        settlement.taker.riskSignature = _sign(maker, bindings.hashOrderRiskAuthorization(settlement.taker.risk));
        vm.expectRevert(RiskAdmissionBindingRegistry.InvalidRiskAuthorization.selector);
        vm.prank(bot);
        router.settle(settlement);

        bytes32 quoteHash = d.orderState.hashOrder(settlement.quote.order);
        assertEq(uint8(d.orderState.statusOf(quoteHash)), uint8(OrderStatus.Unspecified));
        assertEq(RiskAdmissionId.unwrap(bindings.admissionForOrder(quoteHash)), bytes32(0));
        assertEq(d.streamCapacityManager.getStreamCapacity(capacityId).consumedSequence, 0);
        assertEq(d.streamCapacityManager.getStreamCapacity(capacityId).capacity.remainingLiability, perLot * 20);
    }

    function test_InsufficientCapacityReverts() public {
        QuoteSettlement memory settlement = _settlement(_ask(25, ASK), alice, Side.Buy, 21, ASK, 0);
        vm.expectRevert();
        vm.prank(bot);
        router.settle(settlement);
    }

    function test_TakerLimitBelowQuoteReverts() public {
        QuoteSettlement memory settlement = _settlement(_ask(5, ASK), alice, Side.Buy, 2, ASK - 1, 0);
        vm.expectRevert(abi.encodeWithSelector(IQuoteSettlementRouter.PriceNotCrossed.selector, ASK - 1, ASK));
        vm.prank(bot);
        router.settle(settlement);
    }

    /// A relayer fee is charged only within the bound the taker signed, and only the named relayer may submit.
    function test_SignedRelayerFeeIsBoundedAndPaid() public {
        vm.prank(alice.signer);
        d.collateralVault.setLockOperator(alice.account, address(router), true);
        QuoteSettlement memory settlement = _settlement(_ask(5, ASK), alice, Side.Buy, 2, ASK, 50_000);
        CollateralId collateralId = d.collateralVault.deriveCollateralId(settlementAssetId, 1);
        (uint128 before,,) = d.collateralVault.balanceOf(relayer.account, collateralId);

        settlement.relayerFeeMinor = 50_001;
        vm.expectRevert(abi.encodeWithSelector(IQuoteSettlementRouter.RelayerFeeAboveMaximum.selector, 50_000, 50_001));
        vm.prank(relayer.signer);
        router.settle(settlement);

        settlement.relayerFeeMinor = 50_000;
        vm.expectRevert(abi.encodeWithSelector(IQuoteSettlementRouter.RelayerNotAuthorized.selector, relayer.signer, bot));
        vm.prank(bot);
        router.settle(settlement);

        vm.prank(relayer.signer);
        router.settle(settlement);
        (uint128 afterFee,,) = d.collateralVault.balanceOf(relayer.account, collateralId);
        assertEq(afterFee - before, 50_000);
    }

    // ------------------------------------------------------------------------------------------------------------
    // Quote and order construction, signed exactly as the offchain services sign them

    function _openCapacity(uint128 maximumLiability, uint64 lifetime) internal returns (StreamId id) {
        QuoteCapacityTerms memory terms = QuoteCapacityTerms({
            maker: maker.signer,
            makerAccountId: maker.account,
            seriesId: seriesId,
            seriesVersion: 1,
            maximumLiability: maximumLiability,
            liabilityPerLot: perLot,
            maximumAbsoluteInventoryLots: 50,
            expiry: uint64(block.timestamp + lifetime),
            nonce: 1
        });
        bytes memory signature = _sign(maker, router.hashCapacityTerms(terms));
        vm.prank(bot);
        id = router.openQuoteCapacity(terms, signature);
        assertEq(StreamId.unwrap(id), StreamId.unwrap(router.deriveCapacityId(terms)));
    }

    function _ask(uint128 lots, int128 price) internal returns (SignedMakerQuote memory) {
        return _quote(Side.Sell, lots, price);
    }

    function _bid(uint128 lots, int128 price) internal returns (SignedMakerQuote memory) {
        return _quote(Side.Buy, lots, price);
    }

    function _quote(Side side, uint128 lots, int128 price) internal returns (SignedMakerQuote memory quote) {
        quote.order = _order(maker, side, lots, price, TimeInForce.GTD, uint64(block.timestamp + 20));
        quote.orderSignature = _sign(maker, d.orderState.hashOrder(quote.order));
        quote.terms = MakerQuoteTerms({capacityId: capacityId});
        quote.risk = _authorization(quote.order, router.hashMakerQuoteTerms(quote.terms));
        quote.riskSignature = _sign(maker, bindings.hashOrderRiskAuthorization(quote.risk));
    }

    function _settlement(
        SignedMakerQuote memory quote,
        Trader memory taker,
        Side side,
        uint128 lots,
        int128 limit,
        uint128 maxRelayerFee
    ) internal returns (QuoteSettlement memory settlement) {
        SignedTakerOrder memory order;
        order.order = _order(taker, side, lots, limit, TimeInForce.FOK, uint64(block.timestamp + 60));
        order.orderSignature = _sign(taker, d.orderState.hashOrder(order.order));
        order.terms = TakerSettlementTerms({
            quoteOrderHash: d.orderState.hashOrder(quote.order),
            relayer: maxRelayerFee == 0 ? address(0) : relayer.signer,
            relayerAccountId: maxRelayerFee == 0 ? AccountId.wrap(bytes32(0)) : relayer.account,
            maxRelayerFeeMinor: maxRelayerFee
        });
        order.risk = _authorization(order.order, router.hashTakerSettlementTerms(order.terms));
        order.riskSignature = _sign(taker, bindings.hashOrderRiskAuthorization(order.risk));
        settlement = QuoteSettlement({
            quote: quote,
            taker: order,
            fillLots: Lots.wrap(lots),
            relayerFeeMinor: maxRelayerFee,
            payoffTerms: payoffTerms
        });
    }

    function _order(Trader memory trader, Side side, uint128 lots, int128 price, TimeInForce tif, uint64 deadline)
        internal
        returns (PublicOrder memory)
    {
        nonce += 1;
        bool fillOrKill = tif == TimeInForce.FOK;
        return PublicOrder({
            signer: trader.signer,
            accountId: trader.account,
            policyId: keccak256("SETRYN_QUOTE_TEST_POLICY"),
            policyContextHash: keccak256(abi.encode("quote-context", nonce)),
            actionId: ENTER,
            targetKind: OrderTargetKind.Series,
            seriesId: seriesId,
            packageId: PackageId.wrap(bytes32(0)),
            targetVersion: 1,
            side: side,
            lots: Lots.wrap(lots),
            priceTicks: PriceTicks.wrap(price),
            timeInForce: tif,
            deadline: deadline,
            executionModeId: EXECUTION_MODE_PUBLIC_BOOK,
            feeScheduleId: d.marketRegistry
                .getMarket(d.seriesRegistry.getSeries(seriesId, 1).definition.marketId, 1)
                .definition
                .feeScheduleId,
            feeScheduleVersion: 1,
            maxFeeMinor: MAX_FEE,
            recipient: trader.signer,
            permittedExecutor: address(d.atomicClearingEngine),
            nonce: nonce,
            salt: keccak256(abi.encode("quote-salt", trader.signer, nonce)),
            allowPartialFills: !fillOrKill,
            minimumFillLots: Lots.wrap(fillOrKill ? lots : 1),
            remainderPolicy: fillOrKill ? RemainderPolicy.CancelRemainder : RemainderPolicy.KeepOpen,
            postOnly: false,
            reduceOnly: false
        });
    }

    function _authorization(PublicOrder memory order, bytes32 binderTerms)
        internal
        view
        returns (OrderRiskAuthorization memory)
    {
        SeriesDefinition memory series = d.seriesRegistry.getSeries(order.seriesId, order.targetVersion).definition;
        uint128 liabilityPerLot =
            order.side == Side.Buy ? series.maxLongDebitMinorPerLot : series.maxShortDebitMinorPerLot;
        return OrderRiskAuthorization({
            orderHash: d.orderState.hashOrder(order),
            accountId: order.accountId,
            riskDomainId: d.marketRegistry.getMarket(series.marketId, series.marketVersion).definition.riskDomainId,
            riskDomainVersion: 1,
            maxOpenInterestBaseUnits: Lots.unwrap(order.lots),
            maxTerminalLiabilityBaseUnits: Lots.unwrap(order.lots) * liabilityPerLot,
            maxAdmissionDeadline: order.deadline + 60,
            binder: address(router),
            binderTerms: binderTerms,
            nonce: order.nonce,
            deadline: order.deadline
        });
    }

    function _sign(Trader memory trader, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(trader.key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _trader(string memory label) internal returns (Trader memory trader) {
        (trader.signer, trader.key) = makeAddrAndKey(label);
        vm.startPrank(trader.signer);
        trader.account = d.collateralVault.createAccount(keccak256(bytes(label)));
        token.mint(DEPOSIT);
        token.approve(address(d.collateralVault), type(uint256).max);
        d.collateralVault.deposit(settlementAssetId, 1, trader.account, DEPOSIT);
        d.collateralVault.setLockOperator(trader.account, address(d.atomicClearingEngine), true);
        d.collateralVault.setLockOperator(trader.account, address(d.positionEngine), true);
        vm.stopPrank();
    }

    function _config() internal returns (DeploySetryn.DeploymentConfig memory) {
        return DeploySetryn.DeploymentConfig({
            bootstrapAdmin: address(harness),
            governanceAdmin: makeAddr("quote-governance"),
            governanceOperator: operator,
            guardian: makeAddr("quote-guardian"),
            excessRecovery: makeAddr("quote-excess"),
            privacyKeyPublisher: makeAddr("quote-privacy"),
            lifecycleWitnessStager: makeAddr("quote-witness"),
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
            deploymentId: keccak256("SetrynQuoteSettlementRouterIntegrationV1"),
            sequencerFeed: ISequencerUptimeFeed(address(0)),
            statusGovernance: operator,
            retainOperatorStatusRoles: true,
            treasuryController: treasury
        });
    }

    function _bootstrapInput() internal view returns (BootstrapSetrynDevnet.BootstrapInput memory input) {
        BootstrapSetrynDevnet.Contracts memory c;
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
        input.families = new BootstrapSetrynDevnet.FamilySpec[](1);
        input.families[0] = BootstrapSetrynDevnet.FamilySpec({symbol: "BTC", feedKey: "Crypto.BTC/USD", assetClass: 1});
        input.specs = new BootstrapSetrynDevnet.MarketSpec[](1);
        input.specs[0] = BootstrapSetrynDevnet.MarketSpec({
            marketKey: "BTC-YC-24DEC26",
            family: 0,
            priceScale: 10,
            tickSizeMinor: 250_000,
            strike: 11_842_000_000_000,
            bandMinor: 1_950_000_000,
            maxOrderLots: 10
        });
    }
}
