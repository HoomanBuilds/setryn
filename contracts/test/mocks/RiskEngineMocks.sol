// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IPortfolioRiskAdapterV1} from "../../src/interfaces/IPortfolioRiskAdapterV1.sol";
import {
    PortfolioPositionWitness,
    PortfolioRiskResult,
    RiskEvaluationContext,
    RiskObservation
} from "../../src/types/RiskTypes.sol";

contract PortfolioRiskAdapterMock is IPortfolioRiskAdapterV1 {
    PortfolioRiskResult private _result;

    function setResult(PortfolioRiskResult calldata result) external {
        _result = result;
    }

    function evaluatePortfolio(
        RiskEvaluationContext calldata,
        PortfolioPositionWitness[] calldata,
        RiskObservation[] calldata
    ) external view returns (PortfolioRiskResult memory result) {
        return _result;
    }
}
