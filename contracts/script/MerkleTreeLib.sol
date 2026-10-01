// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Hashes} from "@openzeppelin/contracts/utils/cryptography/Hashes.sol";

/// @notice Builds the commutative-pair Merkle trees OpenZeppelin's MerkleProof verifies, for the calendar and session
/// day commitments the network bootstrap registers. Leaves keep their given order; each level hashes neighbours in
/// pairs with sorted-pair keccak, and an odd last node is promoted unchanged. A one-leaf tree's root is the leaf and its
/// proof is empty.
library MerkleTreeLib {
    error EmptyTree();
    error LeafOutOfRange(uint256 index, uint256 count);

    /// Every level of the tree, leaves first and the root last.
    function build(bytes32[] memory leaves) internal pure returns (bytes32[][] memory levels) {
        if (leaves.length == 0) revert EmptyTree();
        uint256 depth = 1;
        for (uint256 width = leaves.length; width > 1; width = (width + 1) / 2) {
            ++depth;
        }
        levels = new bytes32[][](depth);
        levels[0] = leaves;
        for (uint256 level = 1; level < depth; ++level) {
            bytes32[] memory below = levels[level - 1];
            bytes32[] memory nodes = new bytes32[]((below.length + 1) / 2);
            for (uint256 i; i < nodes.length; ++i) {
                uint256 left = 2 * i;
                nodes[i] =
                    left + 1 < below.length ? Hashes.commutativeKeccak256(below[left], below[left + 1]) : below[left];
            }
            levels[level] = nodes;
        }
    }

    function root(bytes32[][] memory levels) internal pure returns (bytes32) {
        return levels[levels.length - 1][0];
    }

    /// The sibling path of one leaf, skipping levels where the node was promoted without a sibling.
    function proof(bytes32[][] memory levels, uint256 index) internal pure returns (bytes32[] memory path) {
        if (index >= levels[0].length) revert LeafOutOfRange(index, levels[0].length);
        bytes32[] memory siblings = new bytes32[](levels.length);
        uint256 count;
        for (uint256 level; level + 1 < levels.length; ++level) {
            uint256 sibling = index ^ 1;
            if (sibling < levels[level].length) siblings[count++] = levels[level][sibling];
            index /= 2;
        }
        path = new bytes32[](count);
        for (uint256 i; i < count; ++i) {
            path[i] = siblings[i];
        }
    }
}
