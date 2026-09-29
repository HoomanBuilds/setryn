// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {IOrderNonceManager} from "../../src/interfaces/IOrderNonceManager.sol";
import {IOrderState} from "../../src/interfaces/IOrderState.sol";
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
import {OrderSigner1271Mock, OrderValidationGateMock} from "../mocks/OrderMocks.sol";

contract OrderStateTest is Test {
    uint256 internal constant NOW = 1_800_000_000;
    uint64 internal constant MAXIMUM_LIFETIME = 30 days;
    bytes32 internal constant EXECUTION_MODE = keccak256("solver firm");
    OrderActionId internal constant ENTER_ACTION = OrderActionId.wrap(keccak256("enter"));
    bytes32 internal constant EXECUTION_REFERENCE = keccak256("execution 1");
    uint256 internal constant SECP256K1_N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;

    address internal admin = makeAddr("admin");
    address internal consumer = makeAddr("consumer");
    address internal stranger = makeAddr("stranger");
    address internal signer;
    uint256 internal signerKey;

    OrderValidationGateMock internal gate;
    OrderState internal state;

    function setUp() public {
        vm.warp(NOW);
        (signer, signerKey) = makeAddrAndKey("signer");
        gate = new OrderValidationGateMock();
        gate.setExecutionMode(EXECUTION_MODE, true);
        gate.setOrderAction(ENTER_ACTION, true);
        state = new OrderState(3 days, admin, gate, MAXIMUM_LIFETIME);
        bytes32 consumerRole = state.ORDER_CONSUMER_ROLE();
        vm.prank(admin);
        state.grantRole(consumerRole, consumer);
    }

    function test_RegistersEoaOrderAndConsumesNonceOnce() public {
        PublicOrder memory order = _order(signer, 1);
        bytes32 orderHash = state.hashOrder(order);
        bytes memory signature = _sign(signerKey, orderHash);

        assertEq(state.registerSignedOrder(order, signature), orderHash);
        OrderRecord memory record = state.getOrder(orderHash);
        assertEq(uint8(record.status), uint8(OrderStatus.Open));
        assertEq(Lots.unwrap(record.order.lots), 100);
        assertTrue(state.isNonceUsed(signer, order.nonce));

        vm.expectRevert(abi.encodeWithSelector(IOrderState.OrderAlreadyRegistered.selector, orderHash));
        state.registerSignedOrder(order, signature);
    }

    function test_CancelledNonceCannotRegisterAndFailedRegistrationDoesNotConsumeNonce() public {
        PublicOrder memory cancelled = _order(signer, 2);
        vm.prank(signer);
        state.cancelNonce(cancelled.nonce);
        bytes memory cancelledSignature = _sign(signerKey, state.hashOrder(cancelled));
        vm.expectRevert(
            abi.encodeWithSelector(IOrderNonceManager.OrderNonceAlreadyUsed.selector, signer, cancelled.nonce)
        );
        state.registerSignedOrder(cancelled, cancelledSignature);

        PublicOrder memory rejected = _order(signer, 3);
        gate.setRegistrationAllowed(false);
        bytes memory rejectedSignature = _sign(signerKey, state.hashOrder(rejected));
        vm.expectRevert(OrderValidationGateMock.RegistrationRejected.selector);
        state.registerSignedOrder(rejected, rejectedSignature);
        assertFalse(state.isNonceUsed(signer, rejected.nonce));
    }

    function test_RejectsWrongDomainAndHighSSignatures() public {
        PublicOrder memory order = _order(signer, 4);
        OrderState other = new OrderState(3 days, admin, gate, MAXIMUM_LIFETIME);
        bytes memory wrongVerifierSignature = _sign(signerKey, other.hashOrder(order));
        bytes32 currentDigest = state.hashOrder(order);
        vm.expectRevert(abi.encodeWithSelector(IOrderState.InvalidOrderSignature.selector, signer, currentDigest));
        state.registerSignedOrder(order, wrongVerifierSignature);

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, currentDigest);
        bytes32 highS = bytes32(SECP256K1_N - uint256(s));
        bytes memory malleable = abi.encodePacked(r, highS, v == 27 ? uint8(28) : uint8(27));
        vm.expectRevert(abi.encodeWithSelector(IOrderState.InvalidOrderSignature.selector, signer, currentDigest));
        state.registerSignedOrder(order, malleable);

        bytes memory chainSignature = _sign(signerKey, currentDigest);
        vm.chainId(block.chainid + 1);
        bytes32 otherChainDigest = state.hashOrder(order);
        vm.expectRevert(abi.encodeWithSelector(IOrderState.InvalidOrderSignature.selector, signer, otherChainDigest));
        state.registerSignedOrder(order, chainSignature);
    }

    function test_AcceptsErc1271Signer() public {
        (address owner, uint256 ownerKey) = makeAddrAndKey("safe owner");
        OrderSigner1271Mock wallet = new OrderSigner1271Mock(owner);
        PublicOrder memory order = _order(address(wallet), 5);
        bytes32 orderHash = state.hashOrder(order);

        state.registerSignedOrder(order, _sign(ownerKey, orderHash));
        assertEq(uint8(state.statusOf(orderHash)), uint8(OrderStatus.Open));
    }

    function test_PartialFillRepeatsGateAndCannotOverfill() public {
        (, bytes32 orderHash) = _register(6);
        vm.prank(consumer);
        state.consumeOrderFill(orderHash, Lots.wrap(40), EXECUTION_REFERENCE);

        OrderRecord memory record = state.getOrder(orderHash);
        assertEq(uint8(record.status), uint8(OrderStatus.PartiallyFilled));
        assertEq(Lots.unwrap(record.filledLots), 40);
        assertEq(Lots.unwrap(state.remainingLots(orderHash)), 60);

        gate.setFillAllowed(false);
        vm.expectRevert(OrderValidationGateMock.FillRejected.selector);
        vm.prank(consumer);
        state.consumeOrderFill(orderHash, Lots.wrap(10), keccak256("execution 2"));
        assertEq(Lots.unwrap(state.getOrder(orderHash).filledLots), 40);

        gate.setFillAllowed(true);
        vm.expectRevert(abi.encodeWithSelector(IOrderState.FillExceedsRemaining.selector, orderHash, 61, 60));
        vm.prank(consumer);
        state.consumeOrderFill(orderHash, Lots.wrap(61), keccak256("execution 3"));
    }

    function test_CancellationAndFillAreMutuallyTerminal() public {
        (, bytes32 cancelledHash) = _register(7);
        vm.prank(signer);
        state.cancelOrder(cancelledHash);
        vm.expectRevert(
            abi.encodeWithSelector(IOrderState.OrderNotExecutable.selector, cancelledHash, OrderStatus.Cancelled)
        );
        vm.prank(consumer);
        state.consumeOrderFill(cancelledHash, Lots.wrap(100), EXECUTION_REFERENCE);

        (, bytes32 filledHash) = _register(8);
        vm.prank(consumer);
        state.consumeOrderFill(filledHash, Lots.wrap(100), EXECUTION_REFERENCE);
        vm.expectRevert(abi.encodeWithSelector(IOrderState.OrderNotExecutable.selector, filledHash, OrderStatus.Filled));
        vm.prank(signer);
        state.cancelOrder(filledHash);
    }

    function test_IocCancelsRemainderInSameFill() public {
        PublicOrder memory order = _order(signer, 9);
        order.timeInForce = TimeInForce.IOC;
        order.remainderPolicy = RemainderPolicy.CancelRemainder;
        bytes32 orderHash = _registerOrder(order);

        vm.prank(consumer);
        state.consumeOrderFill(orderHash, Lots.wrap(40), EXECUTION_REFERENCE);
        OrderRecord memory record = state.getOrder(orderHash);
        assertEq(uint8(record.status), uint8(OrderStatus.Cancelled));
        assertEq(Lots.unwrap(record.filledLots), 40);
        assertEq(Lots.unwrap(state.remainingLots(orderHash)), 60);
    }

    function test_FokRequiresExactOriginalQuantity() public {
        PublicOrder memory order = _order(signer, 10);
        order.timeInForce = TimeInForce.FOK;
        order.allowPartialFills = false;
        order.minimumFillLots = order.lots;
        order.remainderPolicy = RemainderPolicy.CancelRemainder;
        bytes32 orderHash = _registerOrder(order);

        vm.expectRevert(abi.encodeWithSelector(IOrderState.FillOrKillQuantityMismatch.selector, orderHash, 99, 100));
        vm.prank(consumer);
        state.consumeOrderFill(orderHash, Lots.wrap(99), EXECUTION_REFERENCE);

        vm.prank(consumer);
        state.consumeOrderFill(orderHash, Lots.wrap(100), EXECUTION_REFERENCE);
        assertEq(uint8(state.statusOf(orderHash)), uint8(OrderStatus.Filled));
    }

    function test_ExpiryIsPermissionlessAfterInclusiveDeadline() public {
        (PublicOrder memory order, bytes32 orderHash) = _register(11);
        vm.warp(order.deadline);
        vm.expectRevert(
            abi.encodeWithSelector(
                IOrderState.OrderStillLive.selector, orderHash, order.deadline, vm.getBlockTimestamp()
            )
        );
        vm.prank(stranger);
        state.expireOrder(orderHash);

        vm.warp(order.deadline + 1);
        vm.prank(stranger);
        state.expireOrder(orderHash);
        assertEq(uint8(state.statusOf(orderHash)), uint8(OrderStatus.Expired));
    }

    function test_ConsumerRoleAndPermittedExecutorAreBothRequired() public {
        PublicOrder memory order = _order(signer, 12);
        order.permittedExecutor = consumer;
        bytes32 orderHash = _registerOrder(order);

        vm.expectRevert();
        vm.prank(stranger);
        state.consumeOrderFill(orderHash, Lots.wrap(100), EXECUTION_REFERENCE);

        address otherConsumer = makeAddr("other consumer");
        bytes32 consumerRole = state.ORDER_CONSUMER_ROLE();
        vm.prank(admin);
        state.grantRole(consumerRole, otherConsumer);
        vm.expectRevert(
            abi.encodeWithSelector(IOrderState.UnauthorizedExecutor.selector, orderHash, consumer, otherConsumer)
        );
        vm.prank(otherConsumer);
        state.consumeOrderFill(orderHash, Lots.wrap(100), EXECUTION_REFERENCE);
    }

    function test_UnknownExecutionModeFailsClosed() public {
        PublicOrder memory order = _order(signer, 13);
        order.executionModeId = keccak256("unknown execution mode");
        bytes memory signature = _sign(signerKey, state.hashOrder(order));
        vm.expectRevert(
            abi.encodeWithSelector(OrderValidationGateMock.UnsupportedExecutionMode.selector, order.executionModeId)
        );
        state.registerSignedOrder(order, signature);
    }

    function test_UnknownActionFailsClosed() public {
        PublicOrder memory order = _order(signer, 14);
        order.actionId = OrderActionId.wrap(keccak256("unknown action"));
        bytes memory signature = _sign(signerKey, state.hashOrder(order));
        vm.expectRevert(
            abi.encodeWithSelector(
                OrderValidationGateMock.UnsupportedOrderAction.selector, OrderActionId.unwrap(order.actionId)
            )
        );
        state.registerSignedOrder(order, signature);
    }

    function _register(uint256 nonce) internal returns (PublicOrder memory order, bytes32 orderHash) {
        order = _order(signer, nonce);
        orderHash = _registerOrder(order);
    }

    function _registerOrder(PublicOrder memory order) internal returns (bytes32 orderHash) {
        orderHash = state.hashOrder(order);
        state.registerSignedOrder(order, _sign(signerKey, orderHash));
    }

    function _sign(uint256 privateKey, bytes32 digest) internal returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function _order(address orderSigner, uint256 nonce) internal pure returns (PublicOrder memory) {
        return PublicOrder({
            signer: orderSigner,
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
            nonce: nonce,
            salt: keccak256(abi.encode("salt", nonce)),
            allowPartialFills: true,
            minimumFillLots: Lots.wrap(10),
            remainderPolicy: RemainderPolicy.KeepOpen,
            postOnly: false,
            reduceOnly: false
        });
    }
}
