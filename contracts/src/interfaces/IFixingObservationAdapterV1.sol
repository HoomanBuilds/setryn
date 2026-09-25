// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {ObservationBatchValidation, ObservationValidationContext} from "../types/FixingTypes.sol";

interface IFixingObservationAdapterV1 {
    function validateObservationBatch(ObservationValidationContext calldata context, bytes calldata evidence)
        external
        view
        returns (ObservationBatchValidation memory validation);
}

