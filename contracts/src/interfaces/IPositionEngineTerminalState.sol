// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {TerminalOutcomeKind} from "../types/Enums.sol";
import {AccountId} from "../types/Identifiers.sol";

struct PositionTerminalState {
    bytes32 positionId;
    bytes32 terminalOutcomeReference;
    AccountId receiverAccountId;
    uint128 amount;
    TerminalOutcomeKind outcome;
    uint64 settlementDeadline;
    uint64 finalResolutionAt;
}

interface IPositionEngineTerminalState {
    function positionEngineId() external view returns (bytes32);

    function terminalStateInterfaceVersion() external pure returns (uint32);

    function terminalState(bytes32 positionId) external view returns (PositionTerminalState memory state);
}
