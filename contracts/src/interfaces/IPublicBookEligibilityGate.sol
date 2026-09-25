// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {BookEligibility} from "../types/BookTypes.sol";
import {BookId} from "../types/Identifiers.sol";
import {PublicOrder} from "../types/OrderTypes.sol";

interface IPublicBookEligibilityGate {
    function checkOrder(PublicOrder calldata order, bytes32 orderHash, BookId bookId)
        external
        view
        returns (BookEligibility memory eligibility);
}
