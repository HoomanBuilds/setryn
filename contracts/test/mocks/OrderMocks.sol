// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import {IOrderValidationGate} from "../../src/interfaces/IOrderValidationGate.sol";
import {OrderActionId, PublicOrder} from "../../src/types/OrderTypes.sol";
import {Lots} from "../../src/types/Units.sol";

contract OrderValidationGateMock is IOrderValidationGate {
    error RegistrationRejected();
    error FillRejected();
    error UnsupportedExecutionMode(bytes32 executionModeId);
    error UnsupportedOrderAction(bytes32 actionId);

    mapping(bytes32 executionModeId => bool supported) public supportedExecutionModes;
    mapping(bytes32 actionId => bool supported) public supportedOrderActions;
    bool public registrationAllowed = true;
    bool public fillAllowed = true;

    function setExecutionMode(bytes32 executionModeId, bool supported) external {
        supportedExecutionModes[executionModeId] = supported;
    }

    function setOrderAction(OrderActionId actionId, bool supported) external {
        supportedOrderActions[OrderActionId.unwrap(actionId)] = supported;
    }

    function setRegistrationAllowed(bool allowed) external {
        registrationAllowed = allowed;
    }

    function setFillAllowed(bool allowed) external {
        fillAllowed = allowed;
    }

    function validateOrderRegistration(PublicOrder calldata order, bytes32) external view {
        if (!registrationAllowed) revert RegistrationRejected();
        if (!supportedExecutionModes[order.executionModeId]) {
            revert UnsupportedExecutionMode(order.executionModeId);
        }
        if (!supportedOrderActions[OrderActionId.unwrap(order.actionId)]) {
            revert UnsupportedOrderAction(OrderActionId.unwrap(order.actionId));
        }
    }

    function validateOrderFill(PublicOrder calldata order, bytes32, address, Lots, Lots) external view {
        if (!fillAllowed) revert FillRejected();
        if (!supportedExecutionModes[order.executionModeId]) {
            revert UnsupportedExecutionMode(order.executionModeId);
        }
        if (!supportedOrderActions[OrderActionId.unwrap(order.actionId)]) {
            revert UnsupportedOrderAction(OrderActionId.unwrap(order.actionId));
        }
    }
}

contract OrderSigner1271Mock is IERC1271 {
    address public immutable owner;

    constructor(address owner_) {
        owner = owner_;
    }

    function isValidSignature(bytes32 hash, bytes memory signature) external view returns (bytes4) {
        return ECDSA.recover(hash, signature) == owner ? IERC1271.isValidSignature.selector : bytes4(0xffffffff);
    }
}
