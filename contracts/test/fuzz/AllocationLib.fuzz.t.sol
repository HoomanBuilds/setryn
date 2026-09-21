// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {AllocationLib} from "../../src/libraries/AllocationLib.sol";
import {FixedPointLib} from "../../src/libraries/FixedPointLib.sol";
import {Rate, WAD} from "../../src/types/Units.sol";

contract AllocationLibFuzzTest is Test {
    /// @dev Nothing is created and nothing disappears: the parts plus the residual are the total.
    /// The residual is bounded by the number of claimants because each part loses under one unit.
    function testFuzz_ProRataConservesTheTotal(uint128 total, uint64 w0, uint64 w1, uint64 w2) public pure {
        vm.assume(uint256(w0) + w1 + w2 > 0);

        uint256[] memory weights = new uint256[](3);
        (weights[0], weights[1], weights[2]) = (w0, w1, w2);

        (uint256[] memory parts, uint256 residual) = AllocationLib.allocateProRata(total, weights);

        assertEq(parts[0] + parts[1] + parts[2] + residual, total);
        assertLt(residual, 3);
    }

    /// @dev Each fixed share is floored against WAD alone, never against the sum of the rates, so
    /// rates that do not add up to one WAD leave the difference in the residual.
    function testFuzz_FixedRatesAreIndependentOfEachOther(uint128 total, uint64 r0, uint64 r1) public pure {
        uint64 first = uint64(uint256(r0) % (WAD + 1));
        uint64 second = uint64(uint256(r1) % (WAD + 1 - first));

        Rate[] memory rates = new Rate[](2);
        (rates[0], rates[1]) = (Rate.wrap(first), Rate.wrap(second));

        (uint256[] memory parts, uint256 residual) = AllocationLib.allocateFixedRates(total, rates);

        assertEq(parts[0], FixedPointLib.mulDivDown(total, first, WAD));
        assertEq(parts[1], FixedPointLib.mulDivDown(total, second, WAD));
        assertEq(parts[0] + parts[1] + residual, total);
    }
}
