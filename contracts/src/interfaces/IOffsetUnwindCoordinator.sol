// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {AccountId, PositionId} from "../types/Identifiers.sol";
import {LifecycleActionId} from "../types/LifecycleTypes.sol";

interface IOffsetUnwindCoordinator {
    /// @notice Two exactly mirrored positions between the same two accounts were closed together.
    /// @param actionId The executor's execution id; the positions' quantity events carry it as their transition
    /// reference.
    /// @param unwindReference The caller's reference for the unwind (the quote settlement router passes the fill id).
    event OffsetUnwound(
        LifecycleActionId indexed actionId,
        PositionId indexed firstPositionId,
        PositionId indexed secondPositionId,
        AccountId initiatorAccountId,
        AccountId counterpartyAccountId,
        uint128 lots,
        bytes32 unwindReference,
        bytes32 outcomeHash,
        address executor
    );

    error ZeroDependency(address dependency);
    error ZeroReference();
    error PositionIneligible(PositionId positionId);
    error NotAnOffset(PositionId firstPositionId, PositionId secondPositionId);
    error InitiatorNotParty(AccountId initiatorAccountId);

    function unwindOffset(
        PositionId firstPositionId,
        PositionId secondPositionId,
        AccountId initiatorAccountId,
        bytes32 unwindReference
    ) external returns (LifecycleActionId actionId, bytes32 outcomeHash);
}
