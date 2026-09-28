// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract DevnetSettlementToken is ERC20 {
    uint256 private constant ARBITRUM_ONE_CHAIN_ID = 42161;
    uint256 private constant ARBITRUM_SEPOLIA_CHAIN_ID = 421614;
    uint256 public constant MAXIMUM_FAUCET_BALANCE = 10_000_000e6;

    error PublicNetworkDeploymentDisabled(uint256 chainId);
    error FaucetLimitExceeded();

    constructor() ERC20("Setryn Devnet USD", "sUSD") {
        if (block.chainid == ARBITRUM_ONE_CHAIN_ID || block.chainid == ARBITRUM_SEPOLIA_CHAIN_ID) {
            revert PublicNetworkDeploymentDisabled(block.chainid);
        }
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(uint256 amount) external {
        if (amount == 0 || balanceOf(msg.sender) + amount > MAXIMUM_FAUCET_BALANCE) revert FaucetLimitExceeded();
        _mint(msg.sender, amount);
    }
}
