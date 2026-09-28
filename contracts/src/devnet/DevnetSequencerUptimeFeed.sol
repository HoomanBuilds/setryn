// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {ISequencerUptimeFeed} from "../interfaces/ISequencerUptimeFeed.sol";

contract DevnetSequencerUptimeFeed is ISequencerUptimeFeed {
    uint256 private constant ARBITRUM_ONE_CHAIN_ID = 42161;
    uint256 private constant ARBITRUM_SEPOLIA_CHAIN_ID = 421614;

    uint256 public immutable startedAt;

    error PublicNetworkDeploymentDisabled(uint256 chainId);

    constructor() {
        if (block.chainid == ARBITRUM_ONE_CHAIN_ID || block.chainid == ARBITRUM_SEPOLIA_CHAIN_ID) {
            revert PublicNetworkDeploymentDisabled(block.chainid);
        }
        startedAt = block.timestamp > 1 hours ? block.timestamp - 1 hours : 1;
    }

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt_, uint256 updatedAt, uint80 answeredInRound)
    {
        return (1, 0, startedAt, block.timestamp, 1);
    }
}
