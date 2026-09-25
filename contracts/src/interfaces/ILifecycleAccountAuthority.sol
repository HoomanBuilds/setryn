// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {AccountId} from "../types/Identifiers.sol";

interface ILifecycleAccountAuthority {
    function isAuthorizedSigner(AccountId accountId, address signer) external view returns (bool);
}
