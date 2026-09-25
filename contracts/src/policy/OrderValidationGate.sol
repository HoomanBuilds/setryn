// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IExecutionPolicyRegistry} from "../interfaces/IExecutionPolicyRegistry.sol";
import {IOrderValidationGate} from "../interfaces/IOrderValidationGate.sol";
import {IPackageRegistry} from "../interfaces/IPackageRegistry.sol";
import {IPackageWitnessRegistry} from "../interfaces/IPackageWitnessRegistry.sol";
import {IRiskAdmissionBindingRegistry} from "../interfaces/IRiskAdmissionBindingRegistry.sol";
import {ISeriesRegistry} from "../interfaces/ISeriesRegistry.sol";
import {ITradingSessionPolicy} from "../interfaces/ITradingSessionPolicy.sol";
import {PolicyGateBase} from "./PolicyGateBase.sol";
import {ExecutionPolicyLib} from "../libraries/ExecutionPolicyLib.sol";
import {PublicOrder, RemainderPolicy, TimeInForce} from "../types/OrderTypes.sol";
import {Lots} from "../types/Units.sol";

contract OrderValidationGate is IOrderValidationGate, PolicyGateBase {
    IRiskAdmissionBindingRegistry public immutable riskBindings;

    error InvalidOrderPolicy();

    constructor(
        ISeriesRegistry seriesRegistry_,
        IPackageRegistry packageRegistry_,
        IExecutionPolicyRegistry policyRegistry_,
        ITradingSessionPolicy sessionPolicy_,
        IPackageWitnessRegistry packageWitnessRegistry_,
        IRiskAdmissionBindingRegistry riskBindings_
    ) PolicyGateBase(seriesRegistry_, packageRegistry_, policyRegistry_, sessionPolicy_, packageWitnessRegistry_) {
        if (address(riskBindings_) == address(0) || address(riskBindings_).code.length == 0) {
            revert ZeroPolicyDependency(address(riskBindings_));
        }
        riskBindings = riskBindings_;
    }

    function validateOrderRegistration(PublicOrder calldata order, bytes32 orderHash) external view {
        if (
            orderHash == bytes32(0) || !policyRegistry.orderActionAllowed(order.actionId) || order.maxFeeMinor == 0
                || order.reduceOnly
        ) revert InvalidOrderPolicy();
        if (
            order.postOnly
                && (order.timeInForce != TimeInForce.GTC
                    && order.timeInForce != TimeInForce.GTD
                    || order.remainderPolicy != RemainderPolicy.KeepOpen)
        ) revert InvalidOrderPolicy();
        ExecutionPolicyLib.ResolvedTarget memory resolved = _validateOrder(order);
        if (!riskBindings.isLiveBinding(orderHash, order, resolved.riskDomainId, resolved.riskDomainVersion)) {
            revert InvalidOrderPolicy();
        }
    }

    function validateOrderFill(
        PublicOrder calldata order,
        bytes32 orderHash,
        address consumer,
        Lots fillLots,
        Lots cumulativeFillLots
    ) external view {
        if (
            orderHash == bytes32(0) || consumer == address(0) || Lots.unwrap(fillLots) == 0
                || Lots.unwrap(cumulativeFillLots) > Lots.unwrap(order.lots) || block.timestamp > order.deadline
                || !policyRegistry.orderActionAllowed(order.actionId) || order.reduceOnly
                || (order.permittedExecutor != address(0) && order.permittedExecutor != consumer)
        ) revert InvalidOrderPolicy();
        ExecutionPolicyLib.ResolvedTarget memory resolved = _validateOrder(order);
        if (!riskBindings.isLiveBinding(orderHash, order, resolved.riskDomainId, resolved.riskDomainVersion)) {
            revert InvalidOrderPolicy();
        }
    }
}
