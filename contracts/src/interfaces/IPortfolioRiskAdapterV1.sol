// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {
    PortfolioPositionWitness,
    PortfolioRiskResult,
    RiskEvaluationContext,
    RiskObservation
} from "../types/RiskTypes.sol";

interface IPortfolioRiskAdapterV1 {
    function evaluatePortfolio(
        RiskEvaluationContext calldata context,
        PortfolioPositionWitness[] calldata positions,
        RiskObservation[] calldata observations
    ) external view returns (PortfolioRiskResult memory result);
}
