// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

import {DeadlineExpired, ZeroAction, ZeroSigner, ZeroVerifyingContract} from "../types/Errors.sol";

library Eip712Lib {
    string internal constant DOMAIN_NAME = "Setryn";
    string internal constant DOMAIN_VERSION = "1";

    bytes32 internal constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 internal constant DOMAIN_NAME_HASH = keccak256("Setryn");
    bytes32 internal constant DOMAIN_VERSION_HASH = keccak256("1");

    /// @dev The typestring is kept beside the typehash so a test can prove they agree. Solidity
    /// cannot hash a string constant inside another constant initializer, so the literal is repeated
    /// rather than referenced.
    string internal constant ACTION_HEADER_TYPESTRING =
        "ActionHeader(bytes32 action,address signer,uint256 nonce,uint64 deadline)";
    bytes32 internal constant ACTION_HEADER_TYPEHASH =
        keccak256("ActionHeader(bytes32 action,address signer,uint256 nonce,uint64 deadline)");

    struct ActionHeader {
        bytes32 action;
        address signer;
        uint256 nonce;
        uint64 deadline;
    }

    function domainSeparator(uint256 chainId, address verifyingContract) internal pure returns (bytes32) {
        if (verifyingContract == address(0)) {
            revert ZeroVerifyingContract();
        }
        return keccak256(abi.encode(DOMAIN_TYPEHASH, DOMAIN_NAME_HASH, DOMAIN_VERSION_HASH, chainId, verifyingContract));
    }

    function hashActionHeader(ActionHeader memory header) internal pure returns (bytes32) {
        return
            keccak256(abi.encode(ACTION_HEADER_TYPEHASH, header.action, header.signer, header.nonce, header.deadline));
    }

    function validateActionHeader(ActionHeader memory header, uint64 nowTs) internal pure {
        if (header.action == bytes32(0)) {
            revert ZeroAction();
        }
        if (header.signer == address(0)) {
            revert ZeroSigner();
        }
        if (header.deadline < nowTs) {
            revert DeadlineExpired(header.deadline, nowTs);
        }
    }

    function toTypedDataDigest(bytes32 separator, bytes32 structHash) internal pure returns (bytes32) {
        return MessageHashUtils.toTypedDataHash(separator, structHash);
    }
}
