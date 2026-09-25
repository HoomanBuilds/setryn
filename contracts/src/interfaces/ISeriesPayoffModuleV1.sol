// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {PayoffFamilyId} from "../types/Identifiers.sol";
import {FixingSlot, SeriesPayoffValidation, SeriesValidationContext} from "../types/SeriesQualification.sol";

interface ISeriesPayoffModuleV1 {
    function payoffFamilyId() external view returns (PayoffFamilyId);

    function validateSeries(SeriesValidationContext calldata context, bytes calldata terms, FixingSlot[] calldata slots)
        external
        view
        returns (SeriesPayoffValidation memory validation);
}
