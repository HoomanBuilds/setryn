// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {IExecutionPolicyRegistry} from "../../src/interfaces/IExecutionPolicyRegistry.sol";
import {IFeeScheduleRegistry} from "../../src/interfaces/IFeeScheduleRegistry.sol";
import {IMarketRegistry} from "../../src/interfaces/IMarketRegistry.sol";
import {IOrderState} from "../../src/interfaces/IOrderState.sol";
import {IPackageRegistry} from "../../src/interfaces/IPackageRegistry.sol";
import {IPackageWitnessRegistry} from "../../src/interfaces/IPackageWitnessRegistry.sol";
import {IPortfolioRiskEngine} from "../../src/interfaces/IPortfolioRiskEngine.sol";
import {IRiskAdmissionBindingRegistry} from "../../src/interfaces/IRiskAdmissionBindingRegistry.sol";
import {IRiskDomainRegistry} from "../../src/interfaces/IRiskDomainRegistry.sol";
import {ISeriesRegistry} from "../../src/interfaces/ISeriesRegistry.sol";
import {ISettlementAssetRegistry} from "../../src/interfaces/ISettlementAssetRegistry.sol";
import {ITradingSessionPolicy} from "../../src/interfaces/ITradingSessionPolicy.sol";
import {OrderState} from "../../src/orders/OrderState.sol";
import {OrderValidationGate} from "../../src/policy/OrderValidationGate.sol";
import {RiskAdmissionBindingRegistry} from "../../src/policy/RiskAdmissionBindingRegistry.sol";
import {MarketDefinition, MarketVersion} from "../../src/types/MarketDefinition.sol";
import {PackageLeg} from "../../src/types/PackageDefinition.sol";
import {SeriesDefinition, SeriesVersion} from "../../src/types/SeriesDefinition.sol";
import {RegistryStatus, Side} from "../../src/types/Enums.sol";
import {
    AccountId,
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
    SeriesId,
    SessionId
} from "../../src/types/Identifiers.sol";
import {
    OrderActionId,
    OrderStatus,
    OrderTargetKind,
    PublicOrder,
    RemainderPolicy,
    TimeInForce
} from "../../src/types/OrderTypes.sol";
import {
    RiskAdmission,
    RiskAdmissionConsumption,
    RiskAdmissionId,
    RiskAdmissionStatus
} from "../../src/types/RiskTypes.sol";
import {Lots, PriceTicks, TickSizeMinor} from "../../src/types/Units.sol";
import {RouteRiskEngineMock} from "../mocks/RoutingMocks.sol";

contract SequencingSettlementAssetStub {
    function isOpenForNewRisk(AssetId, uint32) external pure returns (bool) {
        return true;
    }
}

contract SequencingRiskDomainStub {
    function isOpenForNewRisk(RiskDomainId, uint32) external pure returns (bool) {
        return true;
    }
}

contract SequencingFeeScheduleStub {
    function isOpenForNewRisk(FeeScheduleId, uint32) external pure returns (bool) {
        return true;
    }
}

contract SequencingMarketStub {
    ISettlementAssetRegistry public settlementAssetRegistry;
    IRiskDomainRegistry public riskDomainRegistry;
    IFeeScheduleRegistry public feeScheduleRegistry;

    mapping(MarketId marketId => mapping(uint32 version => MarketVersion record)) private _records;
    mapping(MarketId marketId => mapping(uint32 version => bool open)) private _open;

    constructor(address settlement_, address risk_, address fee_) {
        settlementAssetRegistry = ISettlementAssetRegistry(settlement_);
        riskDomainRegistry = IRiskDomainRegistry(risk_);
        feeScheduleRegistry = IFeeScheduleRegistry(fee_);
    }

    function setMarket(MarketId marketId, uint32 version, MarketDefinition calldata definition, bool open_) external {
        _records[marketId][version] = MarketVersion({
            definition: definition,
            definitionHash: bytes32(uint256(1)),
            versionHash: bytes32(uint256(2)),
            version: version,
            status: RegistryStatus.Unspecified
        });
        _open[marketId][version] = open_;
    }

    function getMarket(MarketId marketId, uint32 version) external view returns (MarketVersion memory) {
        return _records[marketId][version];
    }

    function isOpenForNewRisk(MarketId marketId, uint32 version, uint32) external view returns (bool) {
        return _open[marketId][version];
    }
}

contract SequencingSeriesStub {
    IMarketRegistry public marketRegistry;

    mapping(SeriesId seriesId => mapping(uint32 version => SeriesVersion record)) private _records;
    mapping(SeriesId seriesId => mapping(uint32 version => bool open)) private _open;

    constructor(address market_) {
        marketRegistry = IMarketRegistry(market_);
    }

    function setSeries(SeriesId seriesId, uint32 version, SeriesDefinition calldata definition, bool open_) external {
        _records[seriesId][version] = SeriesVersion({
            definition: definition,
            definitionHash: bytes32(uint256(1)),
            versionHash: bytes32(uint256(2)),
            version: version,
            status: RegistryStatus.Unspecified
        });
        _open[seriesId][version] = open_;
    }

    function getSeries(SeriesId seriesId, uint32 version) external view returns (SeriesVersion memory) {
        return _records[seriesId][version];
    }

    function isOpenForNewRisk(SeriesId seriesId, uint32 version, uint32) external view returns (bool) {
        return _open[seriesId][version];
    }
}

contract SequencingPackageStub {
    ISeriesRegistry public seriesRegistry;

    constructor(address series_) {
        seriesRegistry = ISeriesRegistry(series_);
    }
}

contract SequencingExecutionPolicyStub {
    function orderActionAllowed(OrderActionId) external pure returns (bool) {
        return true;
    }

    function executionModeAllowed(bytes32, bytes32) external pure returns (bool) {
        return true;
    }
}

contract SequencingSessionPolicyStub {
    function isOpenForNewRisk(SessionId, uint32, uint64) external pure returns (bool) {
        return true;
    }
}

contract SequencingPackageWitnessStub {
    function getLegs(PackageId, uint32) external pure returns (PackageLeg[] memory legs) {}
}

/// @notice Mimics AtomicClearingEngine._consumeOrders/_consumeRiskAdmissions in both orders.
contract ClearingSequencerHarness {
    IOrderState public immutable orderState;
    RouteRiskEngineMock public immutable riskEngine;

    constructor(IOrderState orderState_, RouteRiskEngineMock riskEngine_) {
        orderState = orderState_;
        riskEngine = riskEngine_;
    }

    function clearOrdersThenAdmissions(
        bytes32 takerHash,
        bytes32 makerHash,
        Lots fillLots,
        bytes32 executionReference,
        RiskAdmissionConsumption calldata longConsumption,
        RiskAdmissionConsumption calldata shortConsumption
    ) external {
        orderState.consumeOrderFill(takerHash, fillLots, executionReference);
        orderState.consumeOrderFill(makerHash, fillLots, executionReference);
        riskEngine.consumeAdmission(longConsumption);
        riskEngine.consumeAdmission(shortConsumption);
    }

    function clearAdmissionsThenOrders(
        bytes32 takerHash,
        bytes32 makerHash,
        Lots fillLots,
        bytes32 executionReference,
        RiskAdmissionConsumption calldata longConsumption,
        RiskAdmissionConsumption calldata shortConsumption
    ) external {
        riskEngine.consumeAdmission(longConsumption);
        riskEngine.consumeAdmission(shortConsumption);
        orderState.consumeOrderFill(takerHash, fillLots, executionReference);
        orderState.consumeOrderFill(makerHash, fillLots, executionReference);
    }
}

/// @notice Regression for production clearing sequencing: order fills must be validated and
/// consumed while bound admissions are still Reserved, then the exact admissions are consumed.
/// Mirrors AtomicClearingEngine._clearSeries/_clearPackage which share _consumeOrders and
/// _consumeRiskAdmissions. Uses production OrderState, OrderValidationGate, and
/// RiskAdmissionBindingRegistry; only the unrelated ExecutionPolicy registries are stubbed open.
contract AtomicClearingEngineSequencingTest is Test {
    uint256 internal constant NOW = 1_800_000_000;
    uint32 internal constant TARGET_VERSION = 1;

    SeriesId internal constant SERIES_ID = SeriesId.wrap(keccak256("seq.series"));
    MarketId internal constant MARKET_ID = MarketId.wrap(keccak256("seq.market"));
    RiskDomainId internal constant RISK_DOMAIN_ID = RiskDomainId.wrap(keccak256("seq.risk"));
    FeeScheduleId internal constant FEE_SCHEDULE_ID = FeeScheduleId.wrap(keccak256("seq.fee"));
    AssetId internal constant SETTLEMENT_ASSET_ID = AssetId.wrap(keccak256("seq.asset"));
    SessionId internal constant SESSION_ID = SessionId.wrap(keccak256("seq.session"));
    bytes32 internal constant EXECUTION_MODE_SET = keccak256("seq.mode-set");
    bytes32 internal constant EXECUTION_MODE = keccak256("seq.mode");
    OrderActionId internal constant ENTER_ACTION = OrderActionId.wrap(keccak256("enter"));
    bytes32 internal constant EXECUTION_REFERENCE = keccak256("seq.execution");

    SequencingSettlementAssetStub internal settlementStub;
    SequencingRiskDomainStub internal riskStub;
    SequencingFeeScheduleStub internal feeStub;
    SequencingMarketStub internal marketStub;
    SequencingSeriesStub internal seriesStub;
    SequencingPackageStub internal packageStub;
    SequencingExecutionPolicyStub internal policyStub;
    SequencingSessionPolicyStub internal sessionStub;
    SequencingPackageWitnessStub internal witnessStub;

    RouteRiskEngineMock internal riskEngine;
    RiskAdmissionBindingRegistry internal bindings;
    OrderValidationGate internal gate;
    OrderState internal orderState;
    ClearingSequencerHarness internal sequencer;

    address internal takerSigner;
    uint256 internal takerKey;
    address internal makerSigner;
    uint256 internal makerKey;
    AccountId internal takerAccount = AccountId.wrap(keccak256("seq.taker-account"));
    AccountId internal makerAccount = AccountId.wrap(keccak256("seq.maker-account"));

    function setUp() public {
        vm.warp(NOW);
        (takerSigner, takerKey) = makeAddrAndKey("seq-taker");
        (makerSigner, makerKey) = makeAddrAndKey("seq-maker");

        settlementStub = new SequencingSettlementAssetStub();
        riskStub = new SequencingRiskDomainStub();
        feeStub = new SequencingFeeScheduleStub();
        marketStub = new SequencingMarketStub(address(settlementStub), address(riskStub), address(feeStub));
        seriesStub = new SequencingSeriesStub(address(marketStub));
        packageStub = new SequencingPackageStub(address(seriesStub));
        policyStub = new SequencingExecutionPolicyStub();
        sessionStub = new SequencingSessionPolicyStub();
        witnessStub = new SequencingPackageWitnessStub();

        marketStub.setMarket(MARKET_ID, TARGET_VERSION, _marketDefinition(), true);
        seriesStub.setSeries(SERIES_ID, TARGET_VERSION, _seriesDefinition(), true);

        riskEngine = new RouteRiskEngineMock();
        bindings = new RiskAdmissionBindingRegistry(IPortfolioRiskEngine(address(riskEngine)), address(0));
        gate = new OrderValidationGate(
            ISeriesRegistry(address(seriesStub)),
            IPackageRegistry(address(packageStub)),
            IExecutionPolicyRegistry(address(policyStub)),
            ITradingSessionPolicy(address(sessionStub)),
            IPackageWitnessRegistry(address(witnessStub)),
            IRiskAdmissionBindingRegistry(address(bindings))
        );
        orderState = new OrderState(3 days, address(this), gate, 30 days);
        bindings.bindOrderVerifyingContract(address(orderState));

        sequencer = new ClearingSequencerHarness(IOrderState(address(orderState)), riskEngine);
        orderState.grantRole(orderState.ORDER_CONSUMER_ROLE(), address(sequencer));
    }

    function test_RevertsWhenAdmissionsConsumedBeforeOrders() public {
        (
            bytes32 takerHash,
            bytes32 makerHash,
            RiskAdmissionConsumption memory longC,
            RiskAdmissionConsumption memory shortC
        ) = _setupMatchedPair();

        assertTrue(bindings.isLiveBinding(takerHash, _takerOrder(), RISK_DOMAIN_ID, TARGET_VERSION));
        assertTrue(bindings.isLiveBinding(makerHash, _makerOrder(), RISK_DOMAIN_ID, TARGET_VERSION));

        vm.expectRevert(OrderValidationGate.InvalidOrderPolicy.selector);
        sequencer.clearAdmissionsThenOrders(takerHash, makerHash, Lots.wrap(10), EXECUTION_REFERENCE, longC, shortC);

        assertEq(uint8(orderState.statusOf(takerHash)), uint8(OrderStatus.Open));
        assertEq(uint8(orderState.statusOf(makerHash)), uint8(OrderStatus.Open));
        assertEq(uint8(riskEngine.getAdmission(longC.admissionId).status), uint8(RiskAdmissionStatus.Reserved));
        assertEq(uint8(riskEngine.getAdmission(shortC.admissionId).status), uint8(RiskAdmissionStatus.Reserved));
    }

    function test_SucceedsWhenOrdersConsumedBeforeAdmissions() public {
        (
            bytes32 takerHash,
            bytes32 makerHash,
            RiskAdmissionConsumption memory longC,
            RiskAdmissionConsumption memory shortC
        ) = _setupMatchedPair();

        sequencer.clearOrdersThenAdmissions(takerHash, makerHash, Lots.wrap(10), EXECUTION_REFERENCE, longC, shortC);

        assertEq(uint8(orderState.statusOf(takerHash)), uint8(OrderStatus.Filled));
        assertEq(uint8(orderState.statusOf(makerHash)), uint8(OrderStatus.Filled));
        assertEq(uint8(riskEngine.getAdmission(longC.admissionId).status), uint8(RiskAdmissionStatus.Consumed));
        assertEq(uint8(riskEngine.getAdmission(shortC.admissionId).status), uint8(RiskAdmissionStatus.Consumed));
    }

    function test_RollsBackOrderConsumptionWhenLaterAdmissionFails() public {
        (
            bytes32 takerHash,
            bytes32 makerHash,
            RiskAdmissionConsumption memory longC,
            RiskAdmissionConsumption memory shortC
        ) = _setupMatchedPair();

        RiskAdmissionConsumption memory badLong = longC;
        badLong.expectedResultHash = keccak256("wrong-result");

        vm.expectRevert();
        sequencer.clearOrdersThenAdmissions(takerHash, makerHash, Lots.wrap(10), EXECUTION_REFERENCE, badLong, shortC);

        assertEq(uint8(orderState.statusOf(takerHash)), uint8(OrderStatus.Open));
        assertEq(uint8(orderState.statusOf(makerHash)), uint8(OrderStatus.Open));
        assertEq(uint8(riskEngine.getAdmission(longC.admissionId).status), uint8(RiskAdmissionStatus.Reserved));
        assertEq(uint8(riskEngine.getAdmission(shortC.admissionId).status), uint8(RiskAdmissionStatus.Reserved));
        assertTrue(bindings.isLiveBinding(takerHash, _takerOrder(), RISK_DOMAIN_ID, TARGET_VERSION));
        assertTrue(bindings.isLiveBinding(makerHash, _makerOrder(), RISK_DOMAIN_ID, TARGET_VERSION));
    }

    function _setupMatchedPair()
        internal
        returns (
            bytes32 takerHash,
            bytes32 makerHash,
            RiskAdmissionConsumption memory longC,
            RiskAdmissionConsumption memory shortC
        )
    {
        PublicOrder memory taker = _takerOrder();
        PublicOrder memory maker = _makerOrder();

        RiskAdmissionId takerAdmissionId = RiskAdmissionId.wrap(keccak256("seq.taker-admission"));
        RiskAdmissionId makerAdmissionId = RiskAdmissionId.wrap(keccak256("seq.maker-admission"));
        bytes32 takerResult = keccak256("seq.taker-result");
        bytes32 makerResult = keccak256("seq.maker-result");

        riskEngine.setAdmission(
            takerAdmissionId,
            RiskAdmission({
                requestHash: keccak256("seq.taker-request"),
                resultHash: takerResult,
                reservedResultCommitment: takerResult,
                accountId: takerAccount,
                riskDomainId: RISK_DOMAIN_ID,
                riskDomainVersion: TARGET_VERSION,
                openInterestBaseUnits: 10,
                terminalLiabilityBaseUnits: 2_000,
                remainingOpenInterestBaseUnits: 10,
                remainingTerminalLiabilityBaseUnits: 1_000_000,
                deadline: uint64(NOW + 4 hours),
                status: RiskAdmissionStatus.Reserved
            })
        );
        riskEngine.setAdmission(
            makerAdmissionId,
            RiskAdmission({
                requestHash: keccak256("seq.maker-request"),
                resultHash: makerResult,
                reservedResultCommitment: makerResult,
                accountId: makerAccount,
                riskDomainId: RISK_DOMAIN_ID,
                riskDomainVersion: TARGET_VERSION,
                openInterestBaseUnits: 10,
                terminalLiabilityBaseUnits: 2_000,
                remainingOpenInterestBaseUnits: 10,
                remainingTerminalLiabilityBaseUnits: 1_000_000,
                deadline: uint64(NOW + 4 hours),
                status: RiskAdmissionStatus.Reserved
            })
        );

        vm.prank(takerSigner);
        takerHash = bindings.bindOrderRisk(taker, takerAdmissionId);
        vm.prank(makerSigner);
        makerHash = bindings.bindOrderRisk(maker, makerAdmissionId);

        takerHash = _register(taker, takerKey, takerHash);
        makerHash = _register(maker, makerKey, makerHash);

        longC = RiskAdmissionConsumption({
            admissionId: takerAdmissionId,
            expectedResultHash: takerResult,
            expectedAccountId: takerAccount,
            expectedRiskDomainId: RISK_DOMAIN_ID,
            expectedRiskDomainVersion: TARGET_VERSION,
            expectedOpenInterestBaseUnits: 10,
            expectedTerminalLiabilityBaseUnits: 2_000,
            expectedPositionCount: 1,
            executionReference: EXECUTION_REFERENCE
        });
        shortC = RiskAdmissionConsumption({
            admissionId: makerAdmissionId,
            expectedResultHash: makerResult,
            expectedAccountId: makerAccount,
            expectedRiskDomainId: RISK_DOMAIN_ID,
            expectedRiskDomainVersion: TARGET_VERSION,
            expectedOpenInterestBaseUnits: 10,
            expectedTerminalLiabilityBaseUnits: 2_000,
            expectedPositionCount: 1,
            executionReference: EXECUTION_REFERENCE
        });
    }

    function _register(PublicOrder memory order, uint256 key, bytes32 expectedHash)
        internal
        returns (bytes32 orderHash)
    {
        orderHash = orderState.hashOrder(order);
        assertEq(orderHash, expectedHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, orderHash);
        assertEq(orderState.registerSignedOrder(order, abi.encodePacked(r, s, v)), orderHash);
    }

    function _takerOrder() internal view returns (PublicOrder memory) {
        return _order(takerSigner, takerAccount, Side.Buy, 1);
    }

    function _makerOrder() internal view returns (PublicOrder memory) {
        return _order(makerSigner, makerAccount, Side.Sell, 1);
    }

    function _order(address signer, AccountId accountId, Side side, uint256 nonce)
        internal
        pure
        returns (PublicOrder memory)
    {
        return PublicOrder({
            signer: signer,
            accountId: accountId,
            policyId: keccak256("seq.policy"),
            policyContextHash: keccak256("seq.context"),
            actionId: ENTER_ACTION,
            targetKind: OrderTargetKind.Series,
            seriesId: SERIES_ID,
            packageId: PackageId.wrap(bytes32(0)),
            targetVersion: TARGET_VERSION,
            side: side,
            lots: Lots.wrap(10),
            priceTicks: PriceTicks.wrap(100),
            timeInForce: TimeInForce.GTC,
            deadline: uint64(NOW + 1 days),
            executionModeId: EXECUTION_MODE,
            feeScheduleId: FEE_SCHEDULE_ID,
            feeScheduleVersion: TARGET_VERSION,
            maxFeeMinor: 1_000,
            recipient: signer,
            permittedExecutor: address(0),
            nonce: nonce,
            salt: keccak256(abi.encode("seq.salt", signer, nonce)),
            allowPartialFills: true,
            minimumFillLots: Lots.wrap(1),
            remainderPolicy: RemainderPolicy.KeepOpen,
            postOnly: false,
            reduceOnly: false
        });
    }

    function _marketDefinition() internal pure returns (MarketDefinition memory definition) {
        definition = MarketDefinition({
            namespaceId: keccak256("seq.namespace"),
            marketKey: keccak256("seq.market-key"),
            baseAssetId: AssetId.wrap(keccak256("seq.base")),
            quoteAssetId: SETTLEMENT_ASSET_ID,
            settlementAssetId: SETTLEMENT_ASSET_ID,
            settlementAssetVersion: TARGET_VERSION,
            markBenchmarkId: BenchmarkId.wrap(keccak256("seq.benchmark")),
            markBenchmarkVersion: TARGET_VERSION,
            tradingCalendarId: CalendarId.wrap(keccak256("seq.calendar")),
            tradingCalendarVersion: TARGET_VERSION,
            tradingSessionId: SESSION_ID,
            tradingSessionVersion: TARGET_VERSION,
            riskDomainId: RISK_DOMAIN_ID,
            riskDomainVersion: TARGET_VERSION,
            feeScheduleId: FEE_SCHEDULE_ID,
            feeScheduleVersion: TARGET_VERSION,
            quoteUnitId: QuoteUnitId.wrap(keccak256("SetrynQuoteUnitV1:SettlementMinorPerLot")),
            tickSizeMinor: TickSizeMinor.wrap(1_000),
            lotStep: Lots.wrap(1),
            minOrderLots: Lots.wrap(1),
            maxOrderLots: Lots.wrap(100),
            minPriceTicks: PriceTicks.wrap(-1_000_000),
            maxPriceTicks: PriceTicks.wrap(1_000_000),
            executionModeSetHash: EXECUTION_MODE_SET,
            qualificationEvidenceHash: keccak256("seq.market-evidence")
        });
    }

    function _seriesDefinition() internal pure returns (SeriesDefinition memory definition) {
        definition = SeriesDefinition({
            namespaceId: keccak256("seq.namespace"),
            seriesKey: keccak256("seq.series-key"),
            marketId: MARKET_ID,
            marketVersion: TARGET_VERSION,
            instrumentId: InstrumentId.wrap(keccak256("seq.instrument")),
            instrumentVersion: TARGET_VERSION,
            tradingStartsAt: uint64(NOW - 1 days),
            lastTradingAt: uint64(NOW + 1 days),
            expiryAt: uint64(NOW + 2 days),
            exerciseOpensAt: uint64(NOW + 2 days),
            exerciseCutoffAt: uint64(NOW + 3 days),
            fixingWindowOpen: uint64(NOW + 2 days),
            fixingWindowClose: uint64(NOW + 2 days + 1 hours),
            primaryEvidenceDeadline: uint64(NOW + 4 days),
            correctionCutoffAt: uint64(NOW + 5 days),
            finalResolutionAt: uint64(NOW + 6 days),
            settlementDeadline: uint64(NOW + 7 days),
            exercisePolicyId: ExercisePolicyId.wrap(bytes32(uint256(1))),
            automaticExerciseThresholdMinor: 0,
            disruptionOutcomeId: DisruptionOutcomeId.wrap(bytes32(uint256(1))),
            terminalDisruptionTransferMinorPerLot: 0,
            payoffTermsHash: bytes32(uint256(1)),
            fixingSlotsHash: bytes32(uint256(1)),
            dateAdjustmentEvidenceHash: bytes32(uint256(1)),
            maxLongDebitMinorPerLot: 1_000_000,
            maxShortDebitMinorPerLot: 1_000_000,
            qualificationEvidenceHash: keccak256("seq.series-evidence")
        });
    }
}
