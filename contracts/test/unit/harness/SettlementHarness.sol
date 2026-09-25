// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {SettlementLib} from "../../../src/libraries/SettlementLib.sol";
import {CanonicalSettlementFixing, SettlementMode} from "../../../src/types/SettlementTypes.sol";
import {PositionId, SettlementId} from "../../../src/types/Identifiers.sol";

contract SettlementHarness {
    function hashFixings(CanonicalSettlementFixing[] memory fixings) external pure returns (bytes32) {
        return SettlementLib.hashFixings(fixings);
    }

    function deriveSettlementId(
        uint256 chainId,
        address coordinator,
        PositionId positionId,
        SettlementMode mode,
        bytes32 fixingsHash
    ) external pure returns (SettlementId) {
        return SettlementLib.deriveSettlementId(chainId, coordinator, positionId, mode, fixingsHash);
    }
}
