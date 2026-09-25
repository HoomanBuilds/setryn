// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {PositionId} from "../types/Identifiers.sol";
import {LifecycleActionKind, LifecyclePositionSnapshot} from "../types/LifecycleTypes.sol";

interface ILifecyclePositionSource {
    function getLifecyclePosition(PositionId positionId)
        external
        view
        returns (LifecyclePositionSnapshot memory snapshot);
    function isLifecycleActionEligible(PositionId positionId, LifecycleActionKind kind) external view returns (bool);
}
