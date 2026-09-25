// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Test} from "forge-std/Test.sol";

import {SettlementIdentityHandler} from "./handlers/SettlementIdentityHandler.sol";
import {SettlementHarness} from "../unit/harness/SettlementHarness.sol";

contract CashSettlementCoordinatorInvariantTest is StdInvariant, Test {
    bytes32 internal constant SETTLEMENT_ID_TYPEHASH = keccak256(
        "SetrynSettlementIdV1(uint256 chainId,address coordinator,bytes32 positionId,uint8 mode,bytes32 fixingsHash)"
    );

    SettlementIdentityHandler internal handler;

    function setUp() public {
        handler = new SettlementIdentityHandler(new SettlementHarness());
        targetContract(address(handler));
    }

    function invariant_SettlementIdentityMatchesCanonicalDomain() public view {
        bytes32 expected = keccak256(
            abi.encode(
                SETTLEMENT_ID_TYPEHASH,
                handler.lastChainId(),
                handler.lastCoordinator(),
                handler.lastPositionId(),
                handler.lastMode(),
                handler.lastFixingsHash()
            )
        );
        assertEq(handler.lastSettlementId(), expected);
    }
}
