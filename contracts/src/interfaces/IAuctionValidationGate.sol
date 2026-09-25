// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {
    AuctionDefinition,
    BidCommitAuthorization,
    SealedBid,
    SolverAction,
    SolverRoute
} from "../types/AuctionTypes.sol";
import {PackageLeg} from "../types/PackageDefinition.sol";

interface IAuctionValidationGate {
    function validateDefinition(AuctionDefinition calldata definition, PackageLeg[] calldata packageLegs) external view;
    function validateCommit(
        AuctionDefinition calldata definition,
        BidCommitAuthorization calldata authorization,
        bytes32[] calldata eligibilityProof
    ) external view;
    function validateBid(AuctionDefinition calldata definition, SealedBid calldata bid) external view;
    function validateRoute(
        AuctionDefinition calldata definition,
        SolverRoute calldata route,
        PackageLeg[] calldata routeLegs,
        SolverAction[] calldata actions
    ) external view;
}
