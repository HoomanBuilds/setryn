// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {AccountId} from "../types/Identifiers.sol";

interface ICompressionAuthority {
    function isAuthorizedSigner(AccountId accountId, address signer) external view returns (bool);

    function consumeAuthorizedSigner(
        AccountId accountId,
        address signer,
        bytes32 qualificationHash,
        uint256 policyNonce
    ) external returns (bool);
}
