// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {PositionId, SettlementId} from "../../../src/types/Identifiers.sol";
import {SettlementMode} from "../../../src/types/SettlementTypes.sol";
import {SettlementHarness} from "../../unit/harness/SettlementHarness.sol";

contract SettlementIdentityHandler {
    SettlementHarness public immutable harness;
    uint256 public lastChainId;
    address public lastCoordinator;
    bytes32 public lastPositionId;
    uint8 public lastMode;
    bytes32 public lastFixingsHash;
    bytes32 public lastSettlementId;

    constructor(SettlementHarness harness_) {
        harness = harness_;
        lastMode = uint8(SettlementMode.Normal);
        lastSettlementId = SettlementId.unwrap(
            harness_.deriveSettlementId(0, address(0), PositionId.wrap(bytes32(0)), SettlementMode.Normal, bytes32(0))
        );
    }

    function derive(uint256 chainId, address coordinator, bytes32 rawPositionId, uint8 rawMode, bytes32 fixingsHash)
        external
    {
        SettlementMode mode = SettlementMode(uint8(uint256(rawMode) % 3 + 1));
        SettlementId settlementId =
            harness.deriveSettlementId(chainId, coordinator, PositionId.wrap(rawPositionId), mode, fixingsHash);
        lastChainId = chainId;
        lastCoordinator = coordinator;
        lastPositionId = rawPositionId;
        lastMode = uint8(mode);
        lastFixingsHash = fixingsHash;
        lastSettlementId = SettlementId.unwrap(settlementId);
    }
}
