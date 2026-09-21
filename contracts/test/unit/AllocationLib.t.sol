// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {
    AllocationLib,
    FixedRateSumAboveOne,
    WeightSumOverflow,
    ZeroWeightSum
} from "../../src/libraries/AllocationLib.sol";
import {Rate, RateAboveOne, RateLib, WAD} from "../../src/types/Units.sol";
import {NumericsHarness} from "./harness/NumericsHarness.sol";

contract AllocationLibTest is Test {
    NumericsHarness internal harness;

    function setUp() public {
        harness = new NumericsHarness();
    }

    /// @dev Weights are normalized by their own sum, so doubling every weight is a no-op. The parts
    /// distribute the whole total apart from the two units lost to flooring.
    function test_ProRataNormalizesWeightsAndFloorsParts() public pure {
        uint256[] memory weights = new uint256[](3);
        (weights[0], weights[1], weights[2]) = (1, 2, 4);

        (uint256[] memory parts, uint256 residual) = AllocationLib.allocateProRata(1000, weights);

        assertEq(parts[0], 142);
        assertEq(parts[1], 285);
        assertEq(parts[2], 571);
        assertEq(residual, 2);
        assertEq(parts[0] + parts[1] + parts[2] + residual, 1000);

        uint256[] memory doubled = new uint256[](3);
        (doubled[0], doubled[1], doubled[2]) = (2, 4, 8);
        (uint256[] memory scaledParts, uint256 scaledResidual) = AllocationLib.allocateProRata(1000, doubled);

        assertEq(scaledParts[0], parts[0]);
        assertEq(scaledParts[2], parts[2]);
        assertEq(scaledResidual, residual);
    }

    function test_ProRataRejectsDegenerateWeights() public {
        uint256[] memory zeroSum = new uint256[](2);

        vm.expectRevert(ZeroWeightSum.selector);
        harness.allocateProRata(1000, zeroSum);

        vm.expectRevert(ZeroWeightSum.selector);
        harness.allocateProRata(1000, new uint256[](0));

        uint256[] memory overflowing = new uint256[](2);
        (overflowing[0], overflowing[1]) = (type(uint256).max, 1);

        vm.expectRevert(WeightSumOverflow.selector);
        harness.allocateProRata(1000, overflowing);
    }

    /// @dev The decisive property of fixed-rate allocation: each rate is an absolute share, so rates
    /// summing to half a WAD pay out half the total and leave the rest in the residual. Scaling the
    /// rates changes the payout, which is exactly what normalization would have destroyed.
    function test_FixedRatesAreNeverNormalized() public pure {
        Rate[] memory half = new Rate[](2);
        (half[0], half[1]) = (RateLib.fromWad(2e17), RateLib.fromWad(3e17));

        (uint256[] memory parts, uint256 residual) = AllocationLib.allocateFixedRates(1000, half);

        assertEq(parts[0], 200);
        assertEq(parts[1], 300);
        assertEq(residual, 500, "undistributed value must stay in the residual");

        Rate[] memory whole = new Rate[](2);
        (whole[0], whole[1]) = (RateLib.fromWad(4e17), RateLib.fromWad(6e17));
        (uint256[] memory wholeParts, uint256 wholeResidual) = AllocationLib.allocateFixedRates(1000, whole);

        assertEq(wholeParts[0], 400);
        assertEq(wholeParts[1], 600);
        assertEq(wholeResidual, 0);
    }

    function test_FixedRatesFloorEachShareIndependently() public {
        Rate[] memory thirds = new Rate[](3);
        Rate third = RateLib.fromBps(3333);
        (thirds[0], thirds[1], thirds[2]) = (third, third, third);

        (uint256[] memory parts, uint256 residual) = AllocationLib.allocateFixedRates(1000, thirds);

        assertEq(parts[0], 333);
        assertEq(parts[1], 333);
        assertEq(parts[2], 333);
        assertEq(residual, 1);

        uint64[] memory aboveOne = new uint64[](2);
        (aboveOne[0], aboveOne[1]) = (uint64(6e17), uint64(5e17));

        vm.expectRevert(abi.encodeWithSelector(FixedRateSumAboveOne.selector, uint256(11e17)));
        harness.allocateFixedRates(1000, aboveOne);
    }

    function test_SingleRateAllocationFloorsAndBoundsTheRate() public {
        (uint256 part, uint256 residual) = AllocationLib.allocateRate(1000, RateLib.fromBps(3333));
        assertEq(part, 333);
        assertEq(residual, 667);

        (uint256 wholePart, uint256 wholeResidual) = AllocationLib.allocateRate(1000, RateLib.fromWad(WAD));
        assertEq(wholePart, 1000);
        assertEq(wholeResidual, 0);

        uint64 aboveOne = uint64(WAD) + 1;
        vm.expectRevert(abi.encodeWithSelector(RateAboveOne.selector, aboveOne));
        harness.allocateRate(1000, aboveOne);
    }
}
