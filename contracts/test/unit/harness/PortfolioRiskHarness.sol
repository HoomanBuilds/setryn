// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {PortfolioRiskLib} from "../../../src/libraries/PortfolioRiskLib.sol";
import {
    PortfolioPositionWitness,
    PortfolioRiskResult,
    RiskAdmissionId,
    RiskAdmissionRequest,
    RiskEvaluationContext,
    RiskObservation
} from "../../../src/types/RiskTypes.sol";

contract PortfolioRiskHarness {
    function hashPositions(PortfolioPositionWitness[] calldata positions) external pure returns (bytes32) {
        return PortfolioRiskLib.hashPositions(positions);
    }

    function hashObservations(RiskObservation[] calldata observations, uint64 maximumAge, uint256 currentTimestamp)
        external
        pure
        returns (bytes32)
    {
        return PortfolioRiskLib.hashObservations(observations, maximumAge, currentTimestamp);
    }

    function hashRequest(RiskAdmissionRequest calldata request, uint256 chainId, address engine)
        external
        pure
        returns (bytes32)
    {
        return PortfolioRiskLib.hashRequest(request, chainId, engine);
    }

    function deriveAdmissionId(bytes32 requestHash) external pure returns (RiskAdmissionId) {
        return PortfolioRiskLib.deriveAdmissionId(requestHash);
    }

    function boundedEvaluate(
        address adapter,
        uint64 maximumGas,
        RiskEvaluationContext calldata context,
        PortfolioPositionWitness[] calldata positions,
        RiskObservation[] calldata observations
    ) external view returns (PortfolioRiskResult memory) {
        return PortfolioRiskLib.boundedEvaluate(adapter, maximumGas, context, positions, observations);
    }
}
