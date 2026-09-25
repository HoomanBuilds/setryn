// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {CanonicalPayoffLib} from "../../../src/libraries/CanonicalPayoffLib.sol";
import {CanonicalFixing, CanonicalPayoffTerms} from "../../../src/types/PayoffTypes.sol";

contract CanonicalPayoffHarness {
    function evaluate(CanonicalPayoffTerms calldata terms, CanonicalFixing[] calldata fixings, uint128 lots)
        external
        pure
        returns (int256)
    {
        return CanonicalPayoffLib.evaluate(terms, fixings, lots);
    }

    function roundTripTerms(bytes calldata encoded) external pure returns (bytes32) {
        return keccak256(abi.encode(CanonicalPayoffLib.decodeTerms(encoded)));
    }
}
