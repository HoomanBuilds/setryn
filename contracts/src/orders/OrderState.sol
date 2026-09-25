// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IOrderState} from "../interfaces/IOrderState.sol";
import {IOrderValidationGate} from "../interfaces/IOrderValidationGate.sol";
import {Eip712Lib} from "../libraries/Eip712Lib.sol";
import {OrderHashLib} from "../libraries/OrderHashLib.sol";
import {OrderNonceManager} from "./OrderNonceManager.sol";
import {OrderRecord, OrderStatus, PublicOrder, RemainderPolicy, TimeInForce} from "../types/OrderTypes.sol";
import {Lots} from "../types/Units.sol";

contract OrderState is IOrderState, OrderNonceManager, AccessControlDefaultAdminRules, ReentrancyGuard {
    bytes32 public constant ORDER_CONSUMER_ROLE = keccak256("SETRYN_ORDER_CONSUMER_ROLE");

    IOrderValidationGate private immutable _validationGate;
    uint64 private immutable _maximumOrderLifetime;

    mapping(bytes32 orderHash => OrderRecord record) private _orders;

    constructor(
        uint48 defaultAdminDelay,
        address initialAdmin,
        IOrderValidationGate validationGate_,
        uint64 maximumOrderLifetime_
    ) AccessControlDefaultAdminRules(defaultAdminDelay, _requireInitialAdmin(initialAdmin)) {
        address gate = address(validationGate_);
        if (gate == address(0)) revert ZeroValidationGate();
        if (gate.code.length == 0) revert ValidationGateHasNoCode(gate);
        if (maximumOrderLifetime_ == 0) revert ZeroMaximumOrderLifetime();

        _validationGate = validationGate_;
        _maximumOrderLifetime = maximumOrderLifetime_;
        _grantRole(ORDER_CONSUMER_ROLE, initialAdmin);
    }

    function validationGate() external view returns (IOrderValidationGate) {
        return _validationGate;
    }

    function maximumOrderLifetime() external view returns (uint64) {
        return _maximumOrderLifetime;
    }

    function domainSeparator() external view returns (bytes32) {
        return Eip712Lib.domainSeparator(block.chainid, address(this));
    }

    function hashOrder(PublicOrder calldata order) public view returns (bytes32) {
        return OrderHashLib.digest(order, block.chainid, address(this));
    }

    function registerSignedOrder(PublicOrder calldata order, bytes calldata signature)
        external
        nonReentrant
        returns (bytes32 orderHash)
    {
        OrderHashLib.validate(order, block.timestamp, _maximumOrderLifetime);
        orderHash = OrderHashLib.digest(order, block.chainid, address(this));
        if (_orders[orderHash].status != OrderStatus.Unspecified) revert OrderAlreadyRegistered(orderHash);
        _requireUnusedNonce(order.signer, order.nonce);
        if (!SignatureChecker.isValidSignatureNowCalldata(order.signer, orderHash, signature)) {
            revert InvalidOrderSignature(order.signer, orderHash);
        }
        _validationGate.validateOrderRegistration(order, orderHash);

        _consumeNonce(order.signer, order.nonce, orderHash);
        uint64 registeredAt = uint64(block.timestamp);
        _orders[orderHash] =
            OrderRecord({order: order, filledLots: Lots.wrap(0), status: OrderStatus.Open, registeredAt: registeredAt});
        emit OrderRegistered(orderHash, order.signer, order.nonce, order, registeredAt, OrderStatus.Open);
    }

    function cancelOrder(bytes32 orderHash) external nonReentrant {
        OrderRecord storage record = _requireOrder(orderHash);
        if (record.order.signer != msg.sender) revert UnauthorizedOrderCancellation(orderHash, msg.sender);
        OrderStatus previousStatus = _requireExecutable(orderHash, record);
        record.status = OrderStatus.Cancelled;
        emit OrderCancelled(
            orderHash,
            msg.sender,
            record.filledLots,
            Lots.wrap(Lots.unwrap(record.order.lots) - Lots.unwrap(record.filledLots)),
            previousStatus
        );
    }

    function expireOrder(bytes32 orderHash) external nonReentrant {
        OrderRecord storage record = _requireOrder(orderHash);
        OrderStatus previousStatus = _requireExecutable(orderHash, record);
        if (block.timestamp <= record.order.deadline) {
            revert OrderStillLive(orderHash, record.order.deadline, block.timestamp);
        }
        record.status = OrderStatus.Expired;
        emit OrderExpired(
            orderHash,
            msg.sender,
            record.filledLots,
            Lots.wrap(Lots.unwrap(record.order.lots) - Lots.unwrap(record.filledLots)),
            previousStatus
        );
    }

    function consumeOrderFill(bytes32 orderHash, Lots fillLots, bytes32 executionReference)
        external
        onlyRole(ORDER_CONSUMER_ROLE)
        nonReentrant
    {
        if (executionReference == bytes32(0)) revert ZeroExecutionReference();
        uint256 fill = Lots.unwrap(fillLots);
        if (fill == 0) revert ZeroFillLots();

        OrderRecord storage record = _requireOrder(orderHash);
        OrderStatus previousStatus = _requireExecutable(orderHash, record);
        if (block.timestamp > record.order.deadline) {
            revert OrderPastDeadline(orderHash, record.order.deadline, block.timestamp);
        }
        if (record.order.permittedExecutor != address(0) && record.order.permittedExecutor != msg.sender) {
            revert UnauthorizedExecutor(orderHash, record.order.permittedExecutor, msg.sender);
        }

        uint256 alreadyFilled = Lots.unwrap(record.filledLots);
        uint256 remaining = Lots.unwrap(record.order.lots) - alreadyFilled;
        if (fill > remaining) revert FillExceedsRemaining(orderHash, fill, remaining);
        if (record.order.timeInForce == TimeInForce.FOK && (alreadyFilled != 0 || fill != remaining)) {
            revert FillOrKillQuantityMismatch(orderHash, fill, remaining);
        }
        if (!record.order.allowPartialFills && fill != remaining) {
            revert PartialFillNotAllowed(orderHash, fill, remaining);
        }

        uint256 minimumFill = Lots.unwrap(record.order.minimumFillLots);
        if (fill < minimumFill && fill != remaining) revert FillBelowMinimum(orderHash, fill, minimumFill);
        Lots cumulativeFillLots = Lots.wrap(uint128(alreadyFilled + fill));
        _validationGate.validateOrderFill(record.order, orderHash, msg.sender, fillLots, cumulativeFillLots);

        record.filledLots = cumulativeFillLots;
        uint256 remainder = remaining - fill;
        OrderStatus newStatus;
        if (remainder == 0) {
            newStatus = OrderStatus.Filled;
        } else if (
            record.order.timeInForce == TimeInForce.IOC
                || record.order.remainderPolicy == RemainderPolicy.CancelRemainder
        ) {
            newStatus = OrderStatus.Cancelled;
        } else {
            newStatus = OrderStatus.PartiallyFilled;
        }
        record.status = newStatus;

        emit OrderFillConsumed(
            orderHash,
            msg.sender,
            executionReference,
            fillLots,
            cumulativeFillLots,
            Lots.wrap(uint128(remainder)),
            previousStatus,
            newStatus
        );
    }

    function rejectOrder(bytes32 orderHash, bytes32 reason) external onlyRole(ORDER_CONSUMER_ROLE) nonReentrant {
        if (reason == bytes32(0)) revert ZeroRejectionReason();
        OrderRecord storage record = _requireOrder(orderHash);
        OrderStatus previousStatus = _requireExecutable(orderHash, record);
        record.status = OrderStatus.Rejected;
        emit OrderRejected(
            orderHash,
            msg.sender,
            reason,
            record.filledLots,
            Lots.wrap(Lots.unwrap(record.order.lots) - Lots.unwrap(record.filledLots)),
            previousStatus
        );
    }

    function getOrder(bytes32 orderHash) external view returns (OrderRecord memory) {
        return _requireOrder(orderHash);
    }

    function statusOf(bytes32 orderHash) external view returns (OrderStatus) {
        return _orders[orderHash].status;
    }

    function remainingLots(bytes32 orderHash) external view returns (Lots) {
        OrderRecord storage record = _requireOrder(orderHash);
        return Lots.wrap(Lots.unwrap(record.order.lots) - Lots.unwrap(record.filledLots));
    }

    function _requireOrder(bytes32 orderHash) private view returns (OrderRecord storage record) {
        record = _orders[orderHash];
        if (record.status == OrderStatus.Unspecified) revert UnknownOrder(orderHash);
    }

    function _requireExecutable(bytes32 orderHash, OrderRecord storage record)
        private
        view
        returns (OrderStatus status)
    {
        status = record.status;
        if (status != OrderStatus.Open && status != OrderStatus.PartiallyFilled) {
            revert OrderNotExecutable(orderHash, status);
        }
    }

    function _requireInitialAdmin(address initialAdmin) private pure returns (address) {
        if (initialAdmin == address(0)) revert ZeroInitialAdmin();
        return initialAdmin;
    }
}
