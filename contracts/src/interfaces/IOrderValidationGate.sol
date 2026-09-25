// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {PublicOrder} from "../types/OrderTypes.sol";
import {Lots} from "../types/Units.sol";

interface IOrderValidationGate {
    function validateOrderRegistration(PublicOrder calldata order, bytes32 orderHash) external view;

    function validateOrderFill(
        PublicOrder calldata order,
        bytes32 orderHash,
        address consumer,
        Lots fillLots,
        Lots cumulativeFillLots
    ) external view;
}
