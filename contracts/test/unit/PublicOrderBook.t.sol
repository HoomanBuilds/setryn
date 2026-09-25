// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {PublicOrderBook} from "../../src/book/PublicOrderBook.sol";
import {IAtomicClearingEngine} from "../../src/interfaces/IAtomicClearingEngine.sol";
import {IOrderState} from "../../src/interfaces/IOrderState.sol";
import {IPackageRegistry} from "../../src/interfaces/IPackageRegistry.sol";
import {IPublicBookEligibilityGate} from "../../src/interfaces/IPublicBookEligibilityGate.sol";
import {ISeriesRegistry} from "../../src/interfaces/ISeriesRegistry.sol";
import {BookOrder, LevelHint, PriceLevel} from "../../src/types/BookTypes.sol";
import {Side} from "../../src/types/Enums.sol";
import {
    AccountId,
    AssetId,
    BookId,
    FeeScheduleId,
    MarketId,
    PackageId,
    SeriesId
} from "../../src/types/Identifiers.sol";
import {
    OrderActionId,
    OrderRecord,
    OrderStatus,
    OrderTargetKind,
    PublicOrder,
    RemainderPolicy,
    TimeInForce
} from "../../src/types/OrderTypes.sol";
import {Lots, PriceTicks} from "../../src/types/Units.sol";
import {
    MockBookClearingEngine,
    MockBookMarketRegistry,
    MockBookOrderState,
    MockBookPackageRegistry,
    MockBookSeriesRegistry,
    MockPublicBookEligibilityGate
} from "../mocks/PublicOrderBookMocks.sol";

contract PublicOrderBookTest is Test {
    MockBookOrderState internal orders;
    MockBookClearingEngine internal clearing;
    PublicOrderBook internal book;
    SeriesId internal seriesId = SeriesId.wrap(keccak256("series"));
    FeeScheduleId internal feeScheduleId = FeeScheduleId.wrap(keccak256("fees"));

    function setUp() public {
        MockBookMarketRegistry markets = new MockBookMarketRegistry();
        MockBookSeriesRegistry series = new MockBookSeriesRegistry(address(markets));
        MockBookPackageRegistry packages = new MockBookPackageRegistry(ISeriesRegistry(address(series)));
        orders = new MockBookOrderState();
        clearing = new MockBookClearingEngine(
            IOrderState(address(orders)), ISeriesRegistry(address(series)), IPackageRegistry(address(packages))
        );
        MockPublicBookEligibilityGate gate = new MockPublicBookEligibilityGate();
        book = new PublicOrderBook(
            IOrderState(address(orders)),
            IAtomicClearingEngine(address(clearing)),
            IPublicBookEligibilityGate(address(gate))
        );

        MarketId marketId = MarketId.wrap(keccak256("market"));
        markets.setMarket(marketId, 1, AssetId.wrap(keccak256("USDC")), 1, feeScheduleId, 1);
        series.setSeries(seriesId, 1, marketId, 1);
    }

    function test_SamePriceOrdersKeepFIFOSequence() public {
        bytes32 firstHash = keccak256("first");
        bytes32 secondHash = keccak256("second");
        orders.setOrder(firstHash, _record(Side.Buy, 100, false));
        orders.setOrder(secondHash, _record(Side.Buy, 100, false));
        BookId bookId = book.placeSeriesOrder(firstHash, LevelHint(bytes32(0), bytes32(0)));
        book.placeSeriesOrder(secondHash, LevelHint(bytes32(0), bytes32(0)));

        BookOrder memory first = book.getBookOrder(firstHash);
        BookOrder memory second = book.getBookOrder(secondHash);
        PriceLevel memory level = book.getPriceLevel(book.deriveLevelId(bookId, Side.Buy, PriceTicks.wrap(100)));
        assertLt(first.sequence, second.sequence);
        assertEq(level.headOrderHash, firstHash);
        assertEq(level.tailOrderHash, secondHash);
        assertEq(level.totalLots, 20);
    }

    function test_HigherBidNeedsVerifiedHeadHintAndBecomesBest() public {
        bytes32 lowerHash = keccak256("lower");
        bytes32 higherHash = keccak256("higher");
        orders.setOrder(lowerHash, _record(Side.Buy, 100, false));
        orders.setOrder(higherHash, _record(Side.Buy, 110, false));
        BookId bookId = book.placeSeriesOrder(lowerHash, LevelHint(bytes32(0), bytes32(0)));
        bytes32 lowerLevel = book.deriveLevelId(bookId, Side.Buy, PriceTicks.wrap(100));
        book.placeSeriesOrder(higherHash, LevelHint(bytes32(0), lowerLevel));
        assertEq(book.bestLevel(bookId, Side.Buy), book.deriveLevelId(bookId, Side.Buy, PriceTicks.wrap(110)));
    }

    function test_PostOnlyCrossingOrderReverts() public {
        bytes32 bidHash = keccak256("bid");
        bytes32 askHash = keccak256("ask");
        orders.setOrder(bidHash, _record(Side.Buy, 100, false));
        orders.setOrder(askHash, _record(Side.Sell, 100, true));
        book.placeSeriesOrder(bidHash, LevelHint(bytes32(0), bytes32(0)));
        vm.expectRevert();
        book.placeSeriesOrder(askHash, LevelHint(bytes32(0), bytes32(0)));
    }

    function _record(Side side, int128 price, bool postOnly) private view returns (OrderRecord memory) {
        return OrderRecord({
            order: PublicOrder({
                signer: address(this),
                accountId: AccountId.wrap(keccak256(abi.encode(side, price))),
                policyId: keccak256("policy"),
                policyContextHash: keccak256("context"),
                actionId: OrderActionId.wrap(keccak256("enter")),
                targetKind: OrderTargetKind.Series,
                seriesId: seriesId,
                packageId: PackageId.wrap(bytes32(0)),
                targetVersion: 1,
                side: side,
                lots: Lots.wrap(10),
                priceTicks: PriceTicks.wrap(price),
                timeInForce: TimeInForce.GTC,
                deadline: uint64(block.timestamp + 1 days),
                executionModeId: keccak256("mode"),
                feeScheduleId: feeScheduleId,
                feeScheduleVersion: 1,
                maxFeeMinor: 100,
                recipient: address(this),
                permittedExecutor: address(clearing),
                nonce: uint256(keccak256(abi.encode(side, price, postOnly))),
                salt: keccak256(abi.encode(side, price, postOnly)),
                allowPartialFills: true,
                minimumFillLots: Lots.wrap(1),
                remainderPolicy: RemainderPolicy.KeepOpen,
                postOnly: postOnly,
                reduceOnly: false
            }),
            filledLots: Lots.wrap(0),
            status: OrderStatus.Open,
            registeredAt: uint64(block.timestamp)
        });
    }
}
