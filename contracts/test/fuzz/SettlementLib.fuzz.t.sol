// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {SettlementHarness} from "../unit/harness/SettlementHarness.sol";
import {FixingResolutionKind} from "../../src/types/FixingTypes.sol";
import {PositionId, SettlementId} from "../../src/types/Identifiers.sol";
import {CanonicalSettlementFixing, SettlementMode} from "../../src/types/SettlementTypes.sol";

contract SettlementLibFuzzTest is Test {
    SettlementHarness internal harness = new SettlementHarness();

    function testFuzz_SettlementIdIsDomainSeparated(
        uint256 chainId,
        address coordinator,
        bytes32 rawPositionId,
        bytes32 fixingsHash
    ) public view {
        coordinator = address(uint160(bound(uint160(coordinator), 1, type(uint160).max)));
        PositionId positionId = PositionId.wrap(rawPositionId);
        SettlementId normal =
            harness.deriveSettlementId(chainId, coordinator, positionId, SettlementMode.Normal, fixingsHash);
        SettlementId disruption = harness.deriveSettlementId(
            chainId, coordinator, positionId, SettlementMode.TerminalDisruption, fixingsHash
        );

        assertNotEq(SettlementId.unwrap(normal), SettlementId.unwrap(disruption));
        assertNotEq(
            SettlementId.unwrap(normal),
            SettlementId.unwrap(
                harness.deriveSettlementId(
                    chainId, address(uint160(coordinator) ^ 1), positionId, SettlementMode.Normal, fixingsHash
                )
            )
        );
    }

    function testFuzz_CanonicalFixingHashCommitsToValue(int256 value, int256 otherValue) public view {
        vm.assume(value != otherValue);
        CanonicalSettlementFixing[] memory first = _fixings(value);
        CanonicalSettlementFixing[] memory second = _fixings(otherValue);

        assertNotEq(harness.hashFixings(first), harness.hashFixings(second));
    }

    function _fixings(int256 value) private pure returns (CanonicalSettlementFixing[] memory result) {
        result = new CanonicalSettlementFixing[](1);
        result[0] = CanonicalSettlementFixing({
            fixingKey: keccak256("fixing"),
            resultHash: keccak256(abi.encode(value)),
            resolutionKind: FixingResolutionKind.PrimaryFinal,
            value: value,
            terminalDisruptionTransferMinorPerLot: 0,
            effectiveAt: 1_000,
            slot: 0,
            decimals: 8
        });
    }
}
