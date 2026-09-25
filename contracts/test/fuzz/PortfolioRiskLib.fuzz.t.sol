// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {PositionId, SeriesId} from "../../src/types/Identifiers.sol";
import {PortfolioPositionWitness} from "../../src/types/RiskTypes.sol";
import {PriceTicks} from "../../src/types/Units.sol";
import {PortfolioRiskHarness} from "../unit/harness/PortfolioRiskHarness.sol";

contract PortfolioRiskLibFuzzTest is Test {
    bytes32 internal constant POSITION_TYPEHASH = keccak256(
        "SetrynPortfolioPositionWitnessV1(bytes32 positionId,bytes32 seriesId,uint32 seriesVersion,int128 signedLots,int128 entryPriceTicks,uint128 maximumTerminalLiabilityBaseUnits,bytes32 economicsHash)"
    );

    PortfolioRiskHarness internal harness;

    function setUp() public {
        harness = new PortfolioRiskHarness();
    }

    function testFuzz_HashMatchesReferenceEncoding(
        bytes32 positionRaw,
        bytes32 seriesRaw,
        int128 signedLots,
        int128 entryPrice,
        uint128 liability,
        bytes32 economicsHash
    ) public {
        vm.assume(positionRaw != bytes32(0));
        vm.assume(seriesRaw != bytes32(0));
        vm.assume(signedLots != 0);
        vm.assume(economicsHash != bytes32(0));
        PortfolioPositionWitness[] memory positions = new PortfolioPositionWitness[](1);
        positions[0] = PortfolioPositionWitness({
            positionId: PositionId.wrap(positionRaw),
            seriesId: SeriesId.wrap(seriesRaw),
            seriesVersion: 1,
            signedLots: signedLots,
            entryPriceTicks: PriceTicks.wrap(entryPrice),
            maximumTerminalLiabilityBaseUnits: liability,
            economicsHash: economicsHash
        });
        bytes32 positionHash = keccak256(
            abi.encode(
                POSITION_TYPEHASH, positionRaw, seriesRaw, uint32(1), signedLots, entryPrice, liability, economicsHash
            )
        );
        assertEq(harness.hashPositions(positions), keccak256(abi.encodePacked(positionHash)));
    }
}
