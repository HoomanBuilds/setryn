// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";

import {BootstrapSetrynDevnet} from "../../script/BootstrapSetrynDevnet.s.sol";
import {DeploySetryn} from "../../script/DeploySetryn.s.sol";
import {DevnetSeriesQualification} from "../../script/DevnetSeriesQualification.sol";
import {UpdateFeeSchedule} from "../../script/UpdateFeeSchedule.s.sol";
import {CanonicalStrategyCompiler} from "../../src/compiler/CanonicalStrategyCompiler.sol";
import {DevnetSettlementToken} from "../../src/devnet/DevnetSettlementToken.sol";
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
import {IRiskDomainRegistry} from "../../src/interfaces/IRiskDomainRegistry.sol";
import {ISequencerUptimeFeed} from "../../src/interfaces/ISequencerUptimeFeed.sol";
import {ISeriesRegistry} from "../../src/interfaces/ISeriesRegistry.sol";
import {ISessionRegistry} from "../../src/interfaces/ISessionRegistry.sol";
import {ISettlementAssetRegistry} from "../../src/interfaces/ISettlementAssetRegistry.sol";
import {ITradingSessionPolicy} from "../../src/interfaces/ITradingSessionPolicy.sol";
import {IPublicOrderBook} from "../../src/interfaces/IPublicOrderBook.sol";
import {ExecutionPolicyLib} from "../../src/libraries/ExecutionPolicyLib.sol";
import {FeeScheduleDefinitionLib} from "../../src/libraries/FeeScheduleDefinitionLib.sol";
import {CappedForwardPayoffModule} from "../../src/payoff/ProductionPayoffModules.sol";
import {ExecutionPolicyRegistry} from "../../src/policy/ExecutionPolicyRegistry.sol";
import {LevelHint} from "../../src/types/BookTypes.sol";
import {
    BilateralMatch,
    ClearingChannelKind,
    ClearingFeeFunding,
    OrderFunding,
    SeriesClearingRequest
} from "../../src/types/ClearingTypes.sol";
import {RegistryStatus, Side} from "../../src/types/Enums.sol";
import {FeeActionRequest, FeeLedgerEntryKind} from "../../src/types/FeeEngineTypes.sol";
import {FixingResult, HistoricalObservation, SequencerEvidence} from "../../src/types/FixingTypes.sol";
import {
    AccountId,
    AssetId,
    BenchmarkId,
    CollateralId,
    CollateralLockId,
    FeeActionId,
    BookId,
    FeeScheduleId,
    FillId,
    MarketId,
    PackageId,
    PositionId,
    SeriesId,
    SettlementId
} from "../../src/types/Identifiers.sol";
import {
    OrderActionId,
    OrderTargetKind,
    PublicOrder,
    RemainderPolicy,
    TimeInForce
} from "../../src/types/OrderTypes.sol";
import {CanonicalFixing} from "../../src/types/PayoffTypes.sol";
import {PositionEconomics, PositionLifecycle, PositionStatus} from "../../src/types/PositionTypes.sol";
import {
    PortfolioPositionWitness,
    RiskAdmissionId,
    RiskAdmissionRequest,
    RiskObservation
} from "../../src/types/RiskTypes.sol";
import {SeriesDefinition} from "../../src/types/SeriesDefinition.sol";
import {FixingSlot} from "../../src/types/SeriesQualification.sol";
import {SettlementMode, SettlementRecord} from "../../src/types/SettlementTypes.sol";
import {FeeRatePpm, Lots, PriceTicks} from "../../src/types/Units.sol";
import {SetrynDeploymentHarness} from "./harness/SetrynDeploymentHarness.sol";

/// @notice Fee repricing on the production deployment graph and the real devnet bootstrap: DeploySetryn wiring, the
/// BootstrapSetrynDevnet qualification, and UpdateFeeSchedule's local cascade, with public-book fills cleared through
/// AtomicClearingEngine and FundedFeeEngine.
///
/// @dev What it pins down: a fill signed under the active version pays exactly that version's maker and taker rates into
/// the treasury-controlled fee account; repricing re-versions every market and series, so orders signed under the retired
/// version can neither rest nor clear; positions opened under the retired version still reach their final fixing and
/// settle (normal holder-election exercise and the permissionless terminal fallback) with no fee.
contract FeeScheduleUpdateIntegrationTest is Test {
    uint256 internal constant EPOCH = 1_790_067_600; // 2026-09-22T09:00:00Z, the devnet scenario clock
    uint128 internal constant LOTS = 2;
    int128 internal constant PRICE = 100;
    uint128 internal constant MAX_FEE = 1_000_000;
    uint128 internal constant DEPOSIT = 100_000e6;
    bytes32 internal constant EXECUTION_MODE_PUBLIC_BOOK = keccak256("SETRYN_EXECUTION_MODE_PUBLIC_BOOK_V1");
    OrderActionId internal constant ENTER = OrderActionId.wrap(keccak256("SETRYN_ORDER_ACTION_ENTER_V1"));

    struct Trader {
        address signer;
        uint256 key;
        AccountId account;
    }

    struct Registered {
        bytes32 orderHash;
        RiskAdmissionId admissionId;
        bytes32 resultHash;
    }

    SetrynDeploymentHarness internal harness;
    DeploySetryn.Deployment internal d;
    UpdateFeeSchedule internal updater;

    address internal operator = makeAddr("fee-update-operator");
    address internal treasury = makeAddr("fee-update-treasury");
    address internal keeper = makeAddr("fee-update-keeper");

    DevnetSettlementToken internal token;
    FeeScheduleId internal feeScheduleId;
    AccountId internal feeAccount;
    CollateralId internal collateralId;
    MarketId internal marketId;
    SeriesId internal seriesId;
    AssetId internal settlementAssetId;
    BenchmarkId internal benchmarkId;
    bytes internal payoffTerms;
    uint32 internal day;
    uint128 internal notional;
    Trader internal alice;
    Trader internal bob;
    uint256 internal nonce;

    function setUp() public {
        vm.warp(EPOCH);
        harness = new SetrynDeploymentHarness();
        d = harness.deploy(_config());

        BootstrapSetrynDevnet bootstrapScript = new BootstrapSetrynDevnet();
        BootstrapSetrynDevnet.Runtime memory runtime = bootstrapScript.bootstrap(_bootstrapInput());
        updater = new UpdateFeeSchedule();

        token = runtime.settlementToken;
        feeScheduleId = runtime.feeScheduleId;
        feeAccount = runtime.feeRecipientAccountId;
        collateralId = d.collateralVault.deriveCollateralId(runtime.settlementAssetId, 1);
        marketId = runtime.series[0].marketId;
        seriesId = runtime.series[0].seriesId;
        benchmarkId = runtime.series[0].benchmarkId;
        settlementAssetId = runtime.settlementAssetId;
        payoffTerms = runtime.series[0].payoffTerms;
        day = runtime.day;
        notional = LOTS * uint128(PRICE) * runtime.series[0].tickSizeMinor;
        assertEq(runtime.treasuryController, treasury);
        assertEq(runtime.feeScheduleVersion, 1);

        vm.warp(EPOCH + 1 minutes);
        alice = _trader("fee-update-alice");
        bob = _trader("fee-update-bob");
    }

    /// v1 fills pay v1 rates; after repricing to v2 and v3 every fill pays exactly the active version's rates, the
    /// retired version's orders can neither rest nor clear, its positions stay live, and only the treasury can withdraw.
    function test_RepricingReversionsMarketsAndChargesTheActiveVersion() public {
        (, PositionId v1Position, Vm.Log[] memory logs) = _fill(1, 1);
        _assertFillFees(logs, 500, 1_000);
        uint128 collected = _fee(500) + _fee(1_000);
        assertEq(_feeBalance(), collected, "v1 fees reach the treasury account");

        // Orders signed under v1 before the change: one resting maker with a registered taker, one never rested.
        Registered memory staleMaker = _register(bob, _order(bob, Side.Sell, 1, 1));
        Registered memory staleTaker = _register(alice, _order(alice, Side.Buy, 1, 1));
        Registered memory unrested = _register(bob, _order(bob, Side.Sell, 1, 1));
        BookId v1Book = d.publicOrderBook.placeSeriesOrder(staleMaker.orderHash, LevelHint(bytes32(0), bytes32(0)));

        UpdateFeeSchedule.Result memory v2 = _update(250, 2_000);
        assertEq(v2.previousVersion, 1);
        assertEq(v2.version, 2);
        assertEq(v2.marketVersions[0], 2);
        assertEq(v2.seriesVersions[0], 2);
        IFeeScheduleRegistry fees = IFeeScheduleRegistry(address(d.feeScheduleRegistry));
        assertEq(fees.activeVersion(feeScheduleId), 2);
        assertEq(uint8(fees.statusOf(feeScheduleId, 1)), uint8(RegistryStatus.Paused));
        assertFalse(fees.isOpenForNewRisk(feeScheduleId, 1));
        assertEq(d.marketRegistry.activeVersion(marketId), 2);
        assertEq(d.seriesRegistry.activeVersion(seriesId), 2);
        assertFalse(d.seriesRegistry.isOpenForNewRisk(seriesId, 1, day), "series v1 closes with fee v1");
        assertTrue(d.seriesRegistry.isOpenForNewRisk(seriesId, 2, day), "series v2 trades under fee v2");
        assertEq(d.marketRegistry.getMarket(marketId, 2).definition.feeScheduleVersion, 2);
        assertEq(d.seriesRegistry.getSeries(seriesId, 2).definition.marketVersion, 2);

        // The retired version's orders: the unrested one cannot rest, the resting one cannot clear, and a new v1 or a
        // v2 order against series v1 cannot even register.
        vm.expectRevert(abi.encodeWithSelector(IPublicOrderBook.OrderNotExecutable.selector, bytes32(0)));
        d.publicOrderBook.placeSeriesOrder(unrested.orderHash, LevelHint(bytes32(0), bytes32(0)));
        SeriesClearingRequest[] memory stale = new SeriesClearingRequest[](1);
        stale[0] = _request(staleTaker, staleMaker);
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(IPublicOrderBook.OrderNotExecutable.selector, bytes32(0)));
        d.publicOrderBook.matchSeries(v1Book, stale);
        PublicOrder memory lateV1 = _order(alice, Side.Buy, 1, 1);
        bytes memory lateSignature = _sign(alice, d.orderState.hashOrder(lateV1));
        vm.expectRevert(ExecutionPolicyLib.TargetNotOpen.selector);
        d.orderState.registerSignedOrder(lateV1, lateSignature);
        PublicOrder memory mixed = _order(alice, Side.Buy, 1, 2);
        bytes memory mixedSignature = _sign(alice, d.orderState.hashOrder(mixed));
        vm.expectRevert(ExecutionPolicyLib.TargetNotOpen.selector);
        d.orderState.registerSignedOrder(mixed, mixedSignature);

        // Existing v1 exposure is untouched.
        (PositionEconomics memory economics, PositionLifecycle memory lifecycle) =
            d.positionEngine.getPosition(v1Position);
        assertEq(uint8(lifecycle.status), uint8(PositionStatus.Live));
        assertEq(economics.seriesVersion, 1);
        assertEq(economics.feeScheduleVersion, 1);

        (,, logs) = _fill(2, 2);
        _assertFillFees(logs, 250, 2_000);
        collected += _fee(250) + _fee(2_000);
        assertEq(_feeBalance(), collected, "v2 fees reach the treasury account");

        UpdateFeeSchedule.Result memory v3 = _update(0, 1_000);
        assertEq(v3.version, 3);
        assertEq(v3.seriesVersions[0], 3);
        (,, logs) = _fill(3, 3);
        _assertFillFees(logs, 0, 1_000);
        collected += _fee(1_000);
        assertEq(_feeBalance(), collected, "a zero maker rate charges only the taker");

        // Treasury control: the operator created the account but only the treasury controller can withdraw.
        (address controller, address pending) = d.collateralVault.getAccount(feeAccount);
        assertEq(controller, treasury);
        assertEq(pending, address(0));
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(ICollateralVault.NotAccountController.selector, feeAccount, operator));
        d.collateralVault.withdraw(settlementAssetId, 1, feeAccount, collected, operator);
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(ICollateralVault.NotAccountController.selector, feeAccount, keeper));
        d.collateralVault.withdraw(settlementAssetId, 1, feeAccount, collected, keeper);
        vm.prank(treasury);
        d.collateralVault.withdraw(settlementAssetId, 1, feeAccount, collected, treasury);
        assertEq(token.balanceOf(treasury), collected);
        assertEq(_feeBalance(), 0);
    }

    /// A position opened under the retired series version reaches its final fixing and settles through the normal
    /// holder-election path after repricing, with no fee action and no fee movement.
    function test_RetiredVersionPositionSettlesNormally() public {
        (, PositionId positionId,) = _fill(1, 1);
        _update(250, 2_000);
        uint128 feesBefore = _feeBalance();
        (PositionEconomics memory economics,) = d.positionEngine.getPosition(positionId);
        SeriesDefinition memory series = d.seriesRegistry.getSeries(seriesId, 1).definition;
        FixingSlot[] memory slots = _fixingSlots(series);

        vm.warp(economics.fixingWindowOpen + 20 minutes);
        vm.prank(keeper);
        d.positionEngine.beginFixing(positionId);
        _submitFixing(slots, series.fixingWindowOpen + 15 minutes);
        vm.warp(series.correctionCutoffAt);
        vm.prank(keeper);
        d.fixingEngine.finalizeFixing(seriesId, 1, 0);

        vm.warp(economics.exerciseOpensAt);
        vm.prank(keeper);
        assertEq(
            SettlementId.unwrap(
                d.cashSettlementCoordinator.finalizeNormalSettlement(positionId, slots, new FeeActionRequest[](0))
            ),
            bytes32(0),
            "holder election pending"
        );
        (, PositionLifecycle memory lifecycle) = d.positionEngine.getPosition(positionId);
        FixingResult memory fixing = d.fixingEngine.getFinalizedFixing(seriesId, 1, 0);
        CanonicalFixing[] memory fixings = new CanonicalFixing[](1);
        fixings[0] = CanonicalFixing({
            slot: 0,
            benchmarkId: slots[0].candidates[0].benchmarkId,
            benchmarkVersion: slots[0].candidates[0].benchmarkVersion,
            decimals: fixing.decimals,
            value: fixing.value
        });
        // Stands in for the lifecycle executor applying the holder's signed exercise.
        vm.prank(address(d.positionLifecycleExecutor));
        d.positionEngine
            .exercisePositionQuantity(
                positionId,
                Lots.wrap(LOTS),
                economics.longAccountId,
                lifecycle.lifecycleNonce,
                lifecycle.finalFixingReference,
                abi.encode(fixings)
            );

        vm.prank(keeper);
        SettlementId settlementId =
            d.cashSettlementCoordinator.finalizeNormalSettlement(positionId, slots, new FeeActionRequest[](0));
        SettlementRecord memory record = d.cashSettlementCoordinator.getSettlement(settlementId);
        assertEq(uint8(record.mode), uint8(SettlementMode.Normal));
        assertEq(uint8(d.positionEngine.positionStatus(positionId)), uint8(PositionStatus.Settled));
        assertEq(_feeBalance(), feesBefore, "settlement charges no fee");
    }

    /// With no fixing at all, a retired-version position still resolves permissionlessly after final resolution.
    function test_RetiredVersionPositionResolvesThroughTerminalFallback() public {
        (, PositionId positionId,) = _fill(1, 1);
        _update(0, 1_000);
        uint128 feesBefore = _feeBalance();
        (PositionEconomics memory economics,) = d.positionEngine.getPosition(positionId);
        FixingSlot[] memory slots = _fixingSlots(d.seriesRegistry.getSeries(seriesId, 1).definition);

        vm.warp(economics.finalResolutionAt);
        vm.startPrank(keeper);
        d.fixingEngine.applyTerminalFallback(seriesId, 1, 0);
        SettlementId settlementId =
            d.cashSettlementCoordinator.finalizeTerminalDisruption(positionId, slots, new FeeActionRequest[](0));
        vm.stopPrank();
        SettlementRecord memory record = d.cashSettlementCoordinator.getSettlement(settlementId);
        assertEq(uint8(record.mode), uint8(SettlementMode.TerminalDisruption));
        assertEq(_feeBalance(), feesBefore, "terminal resolution charges no fee");
    }

    /// The update never writes off a local chain, never widens the charge ceiling implicitly, and plans n+1 from the
    /// active version's own witness.
    function test_UpdateRefusesPublicChainsAndCeilingBreaches() public {
        UpdateFeeSchedule.FeeUpdate memory update = UpdateFeeSchedule.FeeUpdate({
            fees: IFeeScheduleRegistry(address(d.feeScheduleRegistry)),
            feeEngine: IFundedFeeEngine(address(d.fundedFeeEngine)),
            feeScheduleId: feeScheduleId,
            makerFeeRatePpm: 0,
            takerFeeRatePpm: 20_000,
            maxChargeRatePpm: 0,
            evidenceHash: bytes32(0)
        });
        vm.expectRevert(abi.encodeWithSelector(UpdateFeeSchedule.FeeRateAboveCeiling.selector, 20_000, 10_000));
        updater.planUpdate(update);

        update.maxChargeRatePpm = 20_000;
        UpdateFeeSchedule.Plan memory plan = updater.planUpdate(update);
        assertEq(plan.activeVersion, 1);
        assertEq(plan.nextVersion, 2);
        assertEq(FeeRatePpm.unwrap(plan.definition.maxChargeRatePpm), 20_000);
        assertEq(
            plan.definition.recipientsHash,
            d.feeScheduleRegistry.getFeeSchedule(feeScheduleId, 1).definition.recipientsHash
        );

        UpdateFeeSchedule.Cascade memory cascade;
        vm.chainId(42_161);
        vm.expectRevert(abi.encodeWithSelector(UpdateFeeSchedule.LocalChainRequired.selector, 42_161));
        updater.applyLocal(update, cascade, operator);
    }

    // ------------------------------------------------------------------------------------------------------------
    // Fills

    function _fill(uint32 seriesVersion, uint32 feeVersion)
        internal
        returns (FillId fillId, PositionId positionId, Vm.Log[] memory logs)
    {
        Registered memory maker = _register(bob, _order(bob, Side.Sell, seriesVersion, feeVersion));
        Registered memory taker = _register(alice, _order(alice, Side.Buy, seriesVersion, feeVersion));
        BookId bookId = d.publicOrderBook.placeSeriesOrder(maker.orderHash, LevelHint(bytes32(0), bytes32(0)));
        SeriesClearingRequest[] memory proposals = new SeriesClearingRequest[](1);
        proposals[0] = _request(taker, maker);
        vm.recordLogs();
        vm.prank(keeper);
        FillId[] memory fillIds = d.publicOrderBook.matchSeries(bookId, proposals);
        logs = vm.getRecordedLogs();
        assertEq(fillIds.length, 1);
        fillId = fillIds[0];
        positionId = d.atomicClearingEngine.fillPositions(fillId)[0];
    }

    function _request(Registered memory taker, Registered memory maker)
        internal
        view
        returns (SeriesClearingRequest memory)
    {
        OrderFunding memory noFunding = OrderFunding({
            terminalLiabilityLockId: CollateralLockId.wrap(bytes32(0)),
            considerationLockId: CollateralLockId.wrap(bytes32(0))
        });
        ClearingFeeFunding memory noFeeFunding = ClearingFeeFunding({
            consumptionId: bytes32(0),
            chargeLockId: CollateralLockId.wrap(bytes32(0)),
            budgetLockId: CollateralLockId.wrap(bytes32(0))
        });
        return SeriesClearingRequest({
            matchData: BilateralMatch({
                takerOrderHash: taker.orderHash,
                makerOrderHash: maker.orderHash,
                fillLots: Lots.wrap(LOTS),
                executionPriceTicks: PriceTicks.wrap(PRICE),
                longAdmissionId: taker.admissionId,
                longAdmissionResultHash: taker.resultHash,
                shortAdmissionId: maker.admissionId,
                shortAdmissionResultHash: maker.resultHash,
                takerFunding: noFunding,
                makerFunding: noFunding,
                takerFeeFunding: noFeeFunding,
                makerFeeFunding: noFeeFunding
            }),
            payoffTerms: payoffTerms,
            channelKind: ClearingChannelKind.Direct
        });
    }

    function _order(Trader memory trader, Side side, uint32 seriesVersion, uint32 feeVersion)
        internal
        returns (PublicOrder memory)
    {
        nonce += 1;
        return PublicOrder({
            signer: trader.signer,
            accountId: trader.account,
            policyId: keccak256("SETRYN_FEE_UPDATE_TEST_POLICY"),
            policyContextHash: keccak256(abi.encode("fee-update-context", nonce)),
            actionId: ENTER,
            targetKind: OrderTargetKind.Series,
            seriesId: seriesId,
            packageId: PackageId.wrap(bytes32(0)),
            targetVersion: seriesVersion,
            side: side,
            lots: Lots.wrap(LOTS),
            priceTicks: PriceTicks.wrap(PRICE),
            timeInForce: TimeInForce.GTC,
            deadline: uint64(block.timestamp + 1 hours),
            executionModeId: EXECUTION_MODE_PUBLIC_BOOK,
            feeScheduleId: feeScheduleId,
            feeScheduleVersion: feeVersion,
            maxFeeMinor: MAX_FEE,
            recipient: trader.signer,
            permittedExecutor: address(0),
            nonce: nonce,
            salt: keccak256(abi.encode("fee-update-salt", trader.signer, nonce)),
            allowPartialFills: false,
            minimumFillLots: Lots.wrap(LOTS),
            remainderPolicy: RemainderPolicy.KeepOpen,
            postOnly: false,
            reduceOnly: false
        });
    }

    /// Reserves the order's risk as the operator (the devnet risk consumer), binds it as the signer, and registers the
    /// signed order.
    function _register(Trader memory trader, PublicOrder memory order) internal returns (Registered memory registered) {
        registered.orderHash = d.orderState.hashOrder(order);
        uint128 liability = order.side == Side.Buy
            ? d.seriesRegistry.getSeries(seriesId, order.targetVersion).definition.maxLongDebitMinorPerLot * LOTS
            : d.seriesRegistry.getSeries(seriesId, order.targetVersion).definition.maxShortDebitMinorPerLot * LOTS;
        PortfolioPositionWitness[] memory witnesses = new PortfolioPositionWitness[](1);
        witnesses[0] = PortfolioPositionWitness({
            positionId: PositionId.wrap(keccak256(abi.encode("fee-update-witness", registered.orderHash))),
            seriesId: order.seriesId,
            seriesVersion: order.targetVersion,
            signedLots: order.side == Side.Buy ? int128(LOTS) : -int128(LOTS),
            entryPriceTicks: order.priceTicks,
            maximumTerminalLiabilityBaseUnits: liability,
            economicsHash: keccak256(abi.encode("fee-update-economics", registered.orderHash))
        });
        RiskObservation[] memory observations = new RiskObservation[](1);
        observations[0] = RiskObservation({
            observationKey: keccak256(abi.encode("fee-update-observation", registered.orderHash)),
            valueHash: keccak256(abi.encode("fee-update-value", block.timestamp)),
            observedAt: uint64(block.timestamp)
        });
        RiskAdmissionRequest memory request = RiskAdmissionRequest({
            accountId: order.accountId,
            riskDomainId: d.marketRegistry.getMarket(marketId, 1).definition.riskDomainId,
            riskDomainVersion: 1,
            openInterestIncreaseBaseUnits: LOTS,
            terminalLiabilityIncreaseBaseUnits: liability,
            deadline: uint64(block.timestamp + 4 minutes),
            nonce: uint256(registered.orderHash),
            salt: keccak256(abi.encode("fee-update-risk", registered.orderHash))
        });
        vm.prank(operator);
        (registered.admissionId,) = d.portfolioRiskEngine.reserveNewRisk(request, witnesses, observations);
        registered.resultHash = d.portfolioRiskEngine.getAdmission(registered.admissionId).resultHash;
        vm.prank(trader.signer);
        d.riskAdmissionBindingRegistry.bindOrderRisk(order, registered.admissionId);
        assertEq(d.orderState.registerSignedOrder(order, _sign(trader, registered.orderHash)), registered.orderHash);
    }

    function _sign(Trader memory trader, bytes32 orderHash) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(trader.key, orderHash);
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

    // ------------------------------------------------------------------------------------------------------------
    // Fee assertions

    /// Every FeeLedgerEntryRecorded of the fill: the maker and taker each pay exactly notional x their rate (rounded
    /// up) and the treasury account receives the same; a zero rate records nothing for that side.
    function _assertFillFees(Vm.Log[] memory logs, uint32 makerPpm, uint32 takerPpm) internal view {
        int256 makerDebit;
        int256 makerCredit;
        int256 takerDebit;
        int256 takerCredit;
        uint256 entries;
        bytes32 makerAction = FeeActionId.unwrap(FeeScheduleDefinitionLib.FEE_ACTION_MAKER_FILL);
        bytes32 takerAction = FeeActionId.unwrap(FeeScheduleDefinitionLib.FEE_ACTION_TAKER_FILL);
        for (uint256 i; i < logs.length; ++i) {
            Vm.Log memory log = logs[i];
            if (
                log.emitter != address(d.fundedFeeEngine)
                    || log.topics[0] != IFundedFeeEngine.FeeLedgerEntryRecorded.selector
            ) {
                continue;
            }
            ++entries;
            FeeLedgerEntryKind kind = FeeLedgerEntryKind(uint8(uint256(log.topics[2])));
            (AccountId account, int256 amount) = abi.decode(log.data, (AccountId, int256));
            bool maker = log.topics[3] == makerAction;
            assertTrue(maker || log.topics[3] == takerAction, "only fill actions are charged");
            if (kind == FeeLedgerEntryKind.ChargeDebit) {
                assertEq(
                    AccountId.unwrap(account),
                    AccountId.unwrap(maker ? bob.account : alice.account),
                    "payer is the order"
                );
                if (maker) makerDebit += amount;
                else takerDebit += amount;
            } else {
                assertEq(uint8(kind), uint8(FeeLedgerEntryKind.ChargeCredit), "no rebates");
                assertEq(AccountId.unwrap(account), AccountId.unwrap(feeAccount), "credit goes to the treasury account");
                if (maker) makerCredit += amount;
                else takerCredit += amount;
            }
        }
        assertEq(
            entries, (makerPpm == 0 ? 0 : 2) + (takerPpm == 0 ? 0 : 2), "one debit and one credit per charged side"
        );
        assertEq(makerDebit, -int256(uint256(_fee(makerPpm))), "maker pays the active maker rate");
        assertEq(makerCredit, int256(uint256(_fee(makerPpm))));
        assertEq(takerDebit, -int256(uint256(_fee(takerPpm))), "taker pays the active taker rate");
        assertEq(takerCredit, int256(uint256(_fee(takerPpm))));
    }

    function _fee(uint32 ppm) internal view returns (uint128) {
        return uint128((uint256(notional) * ppm + 999_999) / 1_000_000);
    }

    function _feeBalance() internal view returns (uint128 total) {
        (total,,) = d.collateralVault.balanceOf(feeAccount, collateralId);
    }

    // ------------------------------------------------------------------------------------------------------------
    // Repricing, fixing, and deployment plumbing

    function _update(uint32 makerPpm, uint32 takerPpm) internal returns (UpdateFeeSchedule.Result memory) {
        UpdateFeeSchedule.FeeUpdate memory update = UpdateFeeSchedule.FeeUpdate({
            fees: IFeeScheduleRegistry(address(d.feeScheduleRegistry)),
            feeEngine: IFundedFeeEngine(address(d.fundedFeeEngine)),
            feeScheduleId: feeScheduleId,
            makerFeeRatePpm: makerPpm,
            takerFeeRatePpm: takerPpm,
            maxChargeRatePpm: 0,
            evidenceHash: bytes32(0)
        });
        UpdateFeeSchedule.SeriesTarget[] memory targets = new UpdateFeeSchedule.SeriesTarget[](1);
        targets[0] = UpdateFeeSchedule.SeriesTarget({
            marketId: marketId, seriesId: seriesId, benchmarkId: benchmarkId, payoffTerms: payoffTerms
        });
        UpdateFeeSchedule.Cascade memory cascade = UpdateFeeSchedule.Cascade({
            markets: IMarketRegistry(address(d.marketRegistry)),
            series: ISeriesRegistry(address(d.seriesRegistry)),
            day: day,
            targets: targets
        });
        return updater.applyLocal(update, cascade, operator);
    }

    function _fixingSlots(SeriesDefinition memory series) internal view returns (FixingSlot[] memory) {
        return DevnetSeriesQualification.qualification(day, benchmarkId, series, payoffTerms).fixingSlots;
    }

    function _submitFixing(FixingSlot[] memory slots, uint64 observedAt) internal {
        HistoricalObservation[] memory observations = new HistoricalObservation[](1);
        observations[0] = HistoricalObservation({
            value: 11_960_420_000_000,
            weight: 1,
            observedAt: observedAt,
            publishedAt: observedAt,
            providerSequence: observedAt,
            confidenceBps: 0,
            decimals: 8,
            finalityReference: keccak256("fee-update-finality"),
            itemEvidenceHash: keccak256("fee-update-item"),
            sequencer: SequencerEvidence({
                sequencerUp: true,
                inRecoveryGrace: false,
                recoveryGraceEndsAt: 0,
                proofHash: keccak256("fee-update-sequencer")
            })
        });
        vm.prank(keeper);
        d.fixingEngine.submitEvidence(seriesId, 1, slots, 0, 0, observations, bytes("fee-update-adapter-evidence"));
    }

    function _config() internal returns (DeploySetryn.DeploymentConfig memory) {
        return DeploySetryn.DeploymentConfig({
            bootstrapAdmin: address(harness),
            governanceAdmin: makeAddr("fee-update-governance"),
            governanceOperator: operator,
            guardian: makeAddr("fee-update-guardian"),
            excessRecovery: makeAddr("fee-update-excess"),
            privacyKeyPublisher: makeAddr("fee-update-privacy"),
            lifecycleWitnessStager: makeAddr("fee-update-witness"),
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
            deploymentId: keccak256("SetrynFeeScheduleUpdateIntegrationV1"),
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
