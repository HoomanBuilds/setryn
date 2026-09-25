// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

interface IOrderNonceManager {
    event OrderNonceConsumed(address indexed signer, uint256 indexed nonce, bytes32 indexed orderHash);
    event OrderNonceCancelled(address indexed signer, uint256 indexed nonce);

    error OrderNonceAlreadyUsed(address signer, uint256 nonce);

    function cancelNonce(uint256 nonce) external;
    function isNonceUsed(address signer, uint256 nonce) external view returns (bool);
}
