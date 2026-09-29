// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {OrderState} from "../../src/orders/OrderState.sol";
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
import {OrderValidationGateMock} from "../mocks/OrderMocks.sol";

contract OrderStateFuzzTest is Test {
    uint256 internal constant NOW = 1_800_000_000;
    bytes32 internal constant EXECUTION_MODE = keccak256("solver firm");
    OrderActionId internal constant ENTER_ACTION = OrderActionId.wrap(keccak256("enter"));

    address internal admin = makeAddr("admin");
    address internal consumer = makeAddr("consumer");
    address internal signer;
    uint256 internal signerKey;

    OrderState internal state;

    function setUp() public {
        vm.warp(NOW);
        (signer, signerKey) = makeAddrAndKey("signer");
        OrderValidationGateMock gate = new OrderValidationGateMock();
        gate.setExecutionMode(EXECUTION_MODE, true);
        gate.setOrderAction(ENTER_ACTION, true);
        state = new OrderState(3 days, admin, gate, 30 days);
        bytes32 consumerRole = state.ORDER_CONSUMER_ROLE();
        vm.prank(admin);
        state.grantRole(consumerRole, consumer);
    }

    function testFuzz_CumulativeFillsNeverExceedAuthorizedLots(uint128 firstRaw, uint128 secondRaw) public {
        uint128 first = uint128(bound(firstRaw, 1, 99));
        PublicOrder memory order = _order();
        bytes32 orderHash = state.hashOrder(order);
        state.registerSignedOrder(order, _sign(orderHash));

        vm.prank(consumer);
        state.consumeOrderFill(orderHash, Lots.wrap(first), keccak256(abi.encode("first", first)));

        uint128 remaining = 100 - first;
        uint128 second = uint128(bound(secondRaw, 1, remaining));
        vm.prank(consumer);
        state.consumeOrderFill(orderHash, Lots.wrap(second), keccak256(abi.encode("second", second)));

        OrderRecord memory record = state.getOrder(orderHash);
        assertLe(Lots.unwrap(record.filledLots), Lots.unwrap(order.lots));
        assertEq(Lots.unwrap(record.filledLots) + Lots.unwrap(state.remainingLots(orderHash)), 100);
        if (second == remaining) assertEq(uint8(record.status), uint8(OrderStatus.Filled));
    }

    function _sign(bytes32 digest) internal returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function _order() internal view returns (PublicOrder memory) {
        return PublicOrder({
            signer: signer,
            accountId: AccountId.wrap(keccak256("account")),
            policyId: keccak256("policy"),
            policyContextHash: keccak256("policy context"),
            actionId: ENTER_ACTION,
            targetKind: OrderTargetKind.Series,
            seriesId: SeriesId.wrap(keccak256("series")),
            packageId: PackageId.wrap(bytes32(0)),
            targetVersion: 1,
            side: Side.Buy,
            lots: Lots.wrap(100),
            priceTicks: PriceTicks.wrap(500),
            timeInForce: TimeInForce.GTC,
            deadline: uint64(NOW + 1 days),
            executionModeId: EXECUTION_MODE,
            feeScheduleId: FeeScheduleId.wrap(keccak256("fee schedule")),
            feeScheduleVersion: 1,
            maxFeeMinor: 10_000,
            recipient: address(0xB0B),
            permittedExecutor: address(0),
            nonce: 1,
            salt: keccak256("salt"),
            allowPartialFills: true,
            minimumFillLots: Lots.wrap(1),
            remainderPolicy: RemainderPolicy.KeepOpen,
            postOnly: false,
            reduceOnly: false
        });
    }
}
