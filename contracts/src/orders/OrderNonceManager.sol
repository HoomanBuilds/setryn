// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IOrderNonceManager} from "../interfaces/IOrderNonceManager.sol";

abstract contract OrderNonceManager is IOrderNonceManager {
    mapping(address signer => mapping(uint256 nonce => bool used)) private _usedNonces;

    function cancelNonce(uint256 nonce) external {
        _requireUnusedNonce(msg.sender, nonce);
        _usedNonces[msg.sender][nonce] = true;
        emit OrderNonceCancelled(msg.sender, nonce);
    }

    function isNonceUsed(address signer, uint256 nonce) external view returns (bool) {
        return _usedNonces[signer][nonce];
    }

    function _consumeNonce(address signer, uint256 nonce, bytes32 orderHash) internal {
        _requireUnusedNonce(signer, nonce);
        _usedNonces[signer][nonce] = true;
        emit OrderNonceConsumed(signer, nonce, orderHash);
    }

    function _requireUnusedNonce(address signer, uint256 nonce) internal view {
        if (_usedNonces[signer][nonce]) revert OrderNonceAlreadyUsed(signer, nonce);
    }
}
