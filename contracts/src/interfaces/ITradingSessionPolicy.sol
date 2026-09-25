// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {SessionId} from "../types/Identifiers.sol";
import {SessionDay, SessionWindow} from "../types/SessionDefinition.sol";

interface ITradingSessionPolicy {
    function publishSessionDay(
        SessionId sessionId,
        uint32 sessionVersion,
        SessionDay calldata sessionDay,
        SessionWindow[] calldata windows,
        bytes32[] calldata proof
    ) external;
    function isOpenForNewRisk(SessionId sessionId, uint32 sessionVersion, uint64 timestamp) external view returns (bool);
    function sequencerOperational() external view returns (bool);
}
