// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {ClearingHandoffClaim, VerifiedClearingHandoff} from "../types/ClearingHandoffTypes.sol";

interface IClearingChannelHandoffAdapter {
    error HandoffAlreadyConsumed(bytes32 consumptionId);
    error HandoffClaimMismatch();
    error HandoffExpired(uint64 deadline, uint256 currentTimestamp);
    error CapacityDispositionMissing(bytes32 consumptionId);

    function consumeTypedHandoff(ClearingHandoffClaim calldata claim)
        external
        returns (VerifiedClearingHandoff memory handoff);
    function source() external view returns (address);
    function handoffConsumed(bytes32 consumptionId) external view returns (bool);
}
