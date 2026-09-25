// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {ObjectiveDefaultState} from "../types/DefaultTypes.sol";
import {AccountId, PositionId, RiskDomainId} from "../types/Identifiers.sol";

interface IDefaultRiskSource {
    function objectiveDefaultState(
        PositionId positionId,
        AccountId accountId,
        RiskDomainId riskDomainId,
        uint32 riskDomainVersion
    ) external view returns (ObjectiveDefaultState memory state);
}
