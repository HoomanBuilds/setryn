// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IPositionEngine} from "../../src/interfaces/IPositionEngine.sol";
import {AccountId, PositionId} from "../../src/types/Identifiers.sol";
import {RiskExposureReduction} from "../../src/types/RiskTypes.sol";

contract PortfolioRiskEngineMock {
    IPositionEngine public immutable positionEngine;
    bytes32 public lastTransitionId;

    constructor(IPositionEngine positionEngine_) {
        positionEngine = positionEngine_;
    }

    function exposureReductionWitness(PositionId, AccountId)
        external
        pure
        returns (RiskExposureReduction memory reduction)
    {}

    function reduceExposure(RiskExposureReduction calldata reduction) external {
        lastTransitionId = reduction.transitionId;
    }
}
