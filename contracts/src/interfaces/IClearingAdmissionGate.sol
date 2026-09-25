// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {ClearingAdmission} from "../types/ClearingTypes.sol";
import {PublicOrder} from "../types/OrderTypes.sol";

interface IClearingAdmissionGate {
    function validateMatch(
        PublicOrder calldata takerOrder,
        PublicOrder calldata makerOrder,
        ClearingAdmission calldata admission
    ) external view;
}
