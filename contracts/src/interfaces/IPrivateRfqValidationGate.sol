// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {PackageLeg} from "../types/PackageDefinition.sol";
import {MakerQuote, PrivateRfqRequest, RfqSelectionAuthorization} from "../types/RfqTypes.sol";
import {Lots} from "../types/Units.sol";

interface IPrivateRfqValidationGate {
    function validateRequest(PrivateRfqRequest calldata request, PackageLeg[] calldata packageLegs) external view;
    function validateQuote(
        PrivateRfqRequest calldata request,
        MakerQuote calldata quote,
        bytes32[] calldata eligibleMakerProof
    ) external view;
    function validateSelection(
        PrivateRfqRequest calldata request,
        MakerQuote calldata quote,
        RfqSelectionAuthorization calldata selection
    ) external view;
    function validateHandoff(
        PrivateRfqRequest calldata request,
        MakerQuote calldata quote,
        address clearingEngine,
        Lots fillLots,
        uint128 liabilityAmount
    ) external view;
}
