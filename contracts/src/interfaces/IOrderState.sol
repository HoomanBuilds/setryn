// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IOrderNonceManager} from "./IOrderNonceManager.sol";
import {IOrderValidationGate} from "./IOrderValidationGate.sol";
import {OrderRecord, OrderStatus, PublicOrder} from "../types/OrderTypes.sol";
import {Lots} from "../types/Units.sol";

interface IOrderState is IOrderNonceManager {
    event OrderRegistered(
        bytes32 indexed orderHash,
        address indexed signer,
        uint256 indexed nonce,
        PublicOrder order,
        uint64 registeredAt,
        OrderStatus initialStatus
    );
    event OrderFillConsumed(
        bytes32 indexed orderHash,
        address indexed consumer,
        bytes32 indexed executionReference,
        Lots fillLots,
        Lots cumulativeFillLots,
        Lots remainingLots,
        OrderStatus previousStatus,
        OrderStatus newStatus
    );
    event OrderCancelled(
        bytes32 indexed orderHash,
        address indexed signer,
        Lots filledLots,
        Lots cancelledLots,
        OrderStatus previousStatus
    );
    event OrderExpired(
        bytes32 indexed orderHash,
        address indexed operator,
        Lots filledLots,
        Lots expiredLots,
        OrderStatus previousStatus
    );
    event OrderRejected(
        bytes32 indexed orderHash,
        address indexed consumer,
        bytes32 indexed reason,
        Lots filledLots,
        Lots rejectedLots,
        OrderStatus previousStatus
    );

    error ZeroInitialAdmin();
    error ZeroValidationGate();
    error ValidationGateHasNoCode(address gate);
    error ZeroMaximumOrderLifetime();
    error InvalidOrderSignature(address signer, bytes32 orderHash);
    error UnknownOrder(bytes32 orderHash);
    error OrderAlreadyRegistered(bytes32 orderHash);
    error OrderNotExecutable(bytes32 orderHash, OrderStatus status);
    error UnauthorizedOrderCancellation(bytes32 orderHash, address caller);
    error UnauthorizedExecutor(bytes32 orderHash, address expected, address actual);
    error OrderStillLive(bytes32 orderHash, uint64 deadline, uint256 currentTimestamp);
    error OrderPastDeadline(bytes32 orderHash, uint64 deadline, uint256 currentTimestamp);
    error ZeroFillLots();
    error FillExceedsRemaining(bytes32 orderHash, uint256 fillLots, uint256 remainingLots);
    error PartialFillNotAllowed(bytes32 orderHash, uint256 fillLots, uint256 remainingLots);
    error FillBelowMinimum(bytes32 orderHash, uint256 fillLots, uint256 minimumFillLots);
    error FillOrKillQuantityMismatch(bytes32 orderHash, uint256 fillLots, uint256 requiredLots);
    error ZeroExecutionReference();
    error ZeroRejectionReason();

    function ORDER_CONSUMER_ROLE() external view returns (bytes32);
    function validationGate() external view returns (IOrderValidationGate);
    function maximumOrderLifetime() external view returns (uint64);
    function domainSeparator() external view returns (bytes32);
    function hashOrder(PublicOrder calldata order) external view returns (bytes32);
    function registerSignedOrder(PublicOrder calldata order, bytes calldata signature) external returns (bytes32);
    function cancelOrder(bytes32 orderHash) external;
    function expireOrder(bytes32 orderHash) external;
    function consumeOrderFill(bytes32 orderHash, Lots fillLots, bytes32 executionReference) external;
    function rejectOrder(bytes32 orderHash, bytes32 reason) external;
    function getOrder(bytes32 orderHash) external view returns (OrderRecord memory);
    function statusOf(bytes32 orderHash) external view returns (OrderStatus);
    function remainingLots(bytes32 orderHash) external view returns (Lots);
}
