// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {IAtomicClearingEngine} from "../../src/interfaces/IAtomicClearingEngine.sol";
import {IStreamingQuoteEngine} from "../../src/interfaces/IStreamingQuoteEngine.sol";
import {StreamHashLib} from "../../src/libraries/StreamHashLib.sol";
import {StreamingQuoteEngine} from "../../src/stream/StreamingQuoteEngine.sol";
import {
    BilateralMatch,
    ClearingChannelKind,
    ClearingFeeFunding,
    OrderFunding,
    SeriesClearingRequest
} from "../../src/types/ClearingTypes.sol";
import {Side} from "../../src/types/Enums.sol";
import {
    AccountId,
    CollateralLockId,
    FeeScheduleId,
    PackageId,
    RiskDomainId,
    SeriesId
} from "../../src/types/Identifiers.sol";
import {OrderTargetKind} from "../../src/types/OrderTypes.sol";
import {
    StreamFill,
    StreamId,
    StreamLadderLevel,
    StreamPolicy,
    StreamPricingKind,
    StreamSizeBand
} from "../../src/types/StreamTypes.sol";
import {Lots, PriceTicks} from "../../src/types/Units.sol";
import {AtomicClearingStreamMock, StreamCapacityManagerMock} from "../mocks/BatchStreamMocks.sol";
import {BatchStreamHarness} from "./harness/BatchStreamHarness.sol";

contract StreamingQuoteEngineTest is Test {
    uint256 internal constant MAKER_KEY = 0xA11CE;

    StreamingQuoteEngine internal engine;
    AtomicClearingStreamMock internal clearing;
    StreamCapacityManagerMock internal capacity;
    BatchStreamHarness internal harness;

    function setUp() public {
        vm.warp(1_800_000_000);
        clearing = new AtomicClearingStreamMock();
        capacity = new StreamCapacityManagerMock();
        engine = new StreamingQuoteEngine(IAtomicClearingEngine(address(clearing)), capacity);
        harness = new BatchStreamHarness();
    }

    function test_FillConsumesExactSequenceAndCannotReplay() public {
        (StreamId streamId, StreamPolicy memory policy) = _register();
        StreamFill memory fill = _fill(streamId);
        SeriesClearingRequest memory request = _request(policy, fill);

        engine.fillSeries(fill, request);
        assertEq(engine.nextSequence(streamId), 2);
        vm.expectRevert(abi.encodeWithSelector(IStreamingQuoteEngine.InvalidSequence.selector, 2, 1));
        engine.fillSeries(fill, request);
    }

    function test_AtomicFailureRollsBackSequenceAndCapacity() public {
        (StreamId streamId, StreamPolicy memory policy) = _register();
        StreamFill memory fill = _fill(streamId);
        SeriesClearingRequest memory request = _request(policy, fill);
        clearing.setFailClearing(true);

        vm.expectRevert();
        engine.fillSeries(fill, request);
        assertEq(engine.nextSequence(streamId), 1);
        assertEq(capacity.consumedSequence(streamId), 0);
    }

    function testFuzz_AffineQuoteMovesOutwardWithSize(uint64 first, uint64 second) public view {
        first = uint64(bound(first, 1, 50));
        second = uint64(bound(second, first, 100));
        StreamPolicy memory policy = _policy();
        StreamSizeBand[] memory bands = _bands();
        StreamLadderLevel[] memory noLadder = new StreamLadderLevel[](0);
        PriceTicks firstQuote = harness.quote(policy, bands, noLadder, Lots.wrap(first), 0);
        PriceTicks secondQuote = harness.quote(policy, bands, noLadder, Lots.wrap(second), 0);
        assertGe(PriceTicks.unwrap(secondQuote), PriceTicks.unwrap(firstQuote));
    }

    function _register() private returns (StreamId streamId, StreamPolicy memory policy) {
        policy = _policy();
        StreamSizeBand[] memory bands = _bands();
        policy.sizeBandsHash = harness.hashSizeBands(bands);
        StreamLadderLevel[] memory noLadder = new StreamLadderLevel[](0);
        streamId = StreamHashLib.streamId(policy, block.chainid, address(engine));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(MAKER_KEY, StreamId.unwrap(streamId));
        bytes memory signature = abi.encodePacked(r, s, v);
        assertEq(StreamId.unwrap(engine.registerStream(policy, bands, noLadder, signature)), StreamId.unwrap(streamId));
    }

    function _policy() private view returns (StreamPolicy memory) {
        return StreamPolicy({
            maker: vm.addr(MAKER_KEY),
            makerAccountId: AccountId.wrap(keccak256("maker account")),
            makerOrderHash: keccak256("maker order"),
            targetKind: OrderTargetKind.Series,
            seriesId: SeriesId.wrap(keccak256("series")),
            packageId: PackageId.wrap(bytes32(0)),
            targetVersion: 1,
            packageWitnessHash: bytes32(0),
            makerSide: Side.Sell,
            pricingKind: StreamPricingKind.AffineV1,
            sizeBandsHash: bytes32(0),
            ladderHash: bytes32(0),
            baseBidPriceTicks: PriceTicks.wrap(99),
            baseAskPriceTicks: PriceTicks.wrap(100),
            sizeSlopeTicksPerLot: 1,
            inventorySkewTicksPerLot: 1,
            maximumAbsoluteInventoryLots: 100,
            maximumAbsoluteSkewTicks: 100,
            refreshInterval: 60,
            quoteLifetime: 30,
            validAfter: uint64(block.timestamp - 1),
            expiry: uint64(block.timestamp + 1 days),
            feeScheduleId: FeeScheduleId.wrap(keccak256("fee")),
            feeScheduleVersion: 1,
            riskDomainId: RiskDomainId.wrap(keccak256("risk")),
            riskDomainVersion: 1,
            executionModeId: keccak256("atomic"),
            permittedExecutor: address(this),
            capacityPolicyHash: keccak256("capacity policy"),
            capacityReservationId: keccak256("capacity reservation"),
            nonce: 1,
            salt: keccak256("stream salt")
        });
    }

    function _bands() private pure returns (StreamSizeBand[] memory bands) {
        bands = new StreamSizeBand[](1);
        bands[0] = StreamSizeBand({minimumLots: Lots.wrap(1), maximumLots: Lots.wrap(100), lotStep: Lots.wrap(1)});
    }

    function _fill(StreamId streamId) private view returns (StreamFill memory) {
        OrderFunding memory noFunding = OrderFunding({
            terminalLiabilityLockId: CollateralLockId.wrap(bytes32(0)),
            considerationLockId: CollateralLockId.wrap(bytes32(0))
        });
        ClearingFeeFunding memory noFeeFunding = ClearingFeeFunding({
            consumptionId: bytes32(0),
            chargeLockId: CollateralLockId.wrap(bytes32(0)),
            budgetLockId: CollateralLockId.wrap(bytes32(0))
        });
        return StreamFill({
            streamId: streamId,
            sequence: 1,
            refreshedAt: uint64(block.timestamp),
            quoteDeadline: uint64(block.timestamp + 30),
            takerOrderHash: keccak256("taker order"),
            fillLots: Lots.wrap(2),
            expectedPriceTicks: PriceTicks.wrap(102),
            fundingHash: keccak256(abi.encode(noFunding, noFunding, noFeeFunding, noFeeFunding))
        });
    }

    function _request(StreamPolicy memory policy, StreamFill memory fill)
        private
        pure
        returns (SeriesClearingRequest memory request)
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
        request = SeriesClearingRequest({
            matchData: BilateralMatch({
                takerOrderHash: fill.takerOrderHash,
                makerOrderHash: policy.makerOrderHash,
                fillLots: fill.fillLots,
                executionPriceTicks: fill.expectedPriceTicks,
                takerFunding: noFunding,
                makerFunding: noFunding,
                takerFeeFunding: noFeeFunding,
                makerFeeFunding: noFeeFunding
            }),
            payoffTerms: bytes("terms"),
            channelKind: ClearingChannelKind.Direct
        });
    }
}
