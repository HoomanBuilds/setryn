// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {ISequencerUptimeFeed} from "../interfaces/ISequencerUptimeFeed.sol";

/// @notice A sequencer uptime feed that always reports the sequencer up since an hour before deployment.
/// @dev For local devnets, and for Arbitrum Sepolia only by DeploySetryn's explicit `testnet-static` choice: Chainlink
/// publishes no L2 sequencer uptime feed on Arbitrum Sepolia. It can never be deployed on Arbitrum One, where the
/// protocol must read the real Chainlink feed.
contract DevnetSequencerUptimeFeed is ISequencerUptimeFeed {
    uint256 private constant ARBITRUM_ONE_CHAIN_ID = 42161;

    uint256 public immutable startedAt;

    error PublicNetworkDeploymentDisabled(uint256 chainId);

    constructor() {
        if (block.chainid == ARBITRUM_ONE_CHAIN_ID) revert PublicNetworkDeploymentDisabled(block.chainid);
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
