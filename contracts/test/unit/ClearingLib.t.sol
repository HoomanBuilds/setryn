// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {ClearingHarness} from "./harness/ClearingHarness.sol";
import {Side} from "../../src/types/Enums.sol";
import {AccountId, FeeScheduleId, PackageId, SeriesId} from "../../src/types/Identifiers.sol";
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

contract ClearingLibTest is Test {
    ClearingHarness internal harness = new ClearingHarness();

    function test_ValidCrossReturnsTakerDirection() public view {
        OrderRecord memory taker = _record(Side.Buy, 110);
        OrderRecord memory maker = _record(Side.Sell, 100);
        assertTrue(
            harness.validateMatch(
                keccak256("taker"), taker, keccak256("maker"), maker, Lots.wrap(10), PriceTicks.wrap(105)
            )
        );
    }

    function test_NonCrossingAndSameSideOrdersRevert() public {
        OrderRecord memory buyer = _record(Side.Buy, 99);
        OrderRecord memory seller = _record(Side.Sell, 100);
        vm.expectRevert();
        harness.validateMatch(
            keccak256("taker"), buyer, keccak256("maker"), seller, Lots.wrap(10), PriceTicks.wrap(100)
        );

        seller.order.side = Side.Buy;
        vm.expectRevert();
        harness.validateMatch(keccak256("taker"), buyer, keccak256("maker"), seller, Lots.wrap(10), PriceTicks.wrap(99));
    }

    function test_FundingReferencesBindOrderCumulativeQuantityAndPurpose() public view {
        bytes32 orderHash = keccak256("order");
        bytes32 first = harness.deriveFundingReference(orderHash, 10, keccak256("liability"));
        assertTrue(first != harness.deriveFundingReference(orderHash, 11, keccak256("liability")));
        assertTrue(first != harness.deriveFundingReference(orderHash, 10, keccak256("fee")));
    }

    function _record(Side side, int128 price) private pure returns (OrderRecord memory) {
        return OrderRecord({
            order: PublicOrder({
                signer: address(1),
                accountId: AccountId.wrap(keccak256(abi.encode(side))),
                policyId: keccak256("policy"),
                policyContextHash: keccak256("context"),
                actionId: OrderActionId.wrap(keccak256("enter")),
                targetKind: OrderTargetKind.Series,
                seriesId: SeriesId.wrap(keccak256("series")),
                packageId: PackageId.wrap(bytes32(0)),
                targetVersion: 1,
                side: side,
                lots: Lots.wrap(100),
                priceTicks: PriceTicks.wrap(price),
                timeInForce: TimeInForce.GTC,
                deadline: 1 days,
                executionModeId: keccak256("mode"),
                feeScheduleId: FeeScheduleId.wrap(keccak256("fees")),
                feeScheduleVersion: 1,
                maxFeeMinor: 100,
                recipient: address(2),
                permittedExecutor: address(0),
                nonce: 1,
                salt: keccak256("salt"),
                allowPartialFills: true,
                minimumFillLots: Lots.wrap(1),
                remainderPolicy: RemainderPolicy.KeepOpen,
                postOnly: false,
                reduceOnly: false
            }),
            filledLots: Lots.wrap(0),
            status: OrderStatus.Open,
            registeredAt: 1
        });
    }
}
