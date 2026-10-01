// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract SetrynTestUSDC is ERC20 {
    uint256 private constant ARBITRUM_ONE_CHAIN_ID = 42_161;
    uint256 public constant MAXIMUM_FAUCET_BALANCE = 10_000_000e6;

    error MainnetDeploymentDisabled(uint256 chainId);
    error FaucetLimitExceeded(address recipient, uint256 balance, uint256 amount);

    constructor() ERC20("Setryn Test USDC", "tUSDC") {
        if (block.chainid == ARBITRUM_ONE_CHAIN_ID) revert MainnetDeploymentDisabled(block.chainid);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(uint256 amount) external {
        _faucetMint(msg.sender, amount);
    }

    function mintTo(address recipient, uint256 amount) external {
        _faucetMint(recipient, amount);
    }

    function _faucetMint(address recipient, uint256 amount) private {
        uint256 balance = balanceOf(recipient);
        if (amount == 0 || balance >= MAXIMUM_FAUCET_BALANCE || amount > MAXIMUM_FAUCET_BALANCE - balance) {
            revert FaucetLimitExceeded(recipient, balance, amount);
        }
        _mint(recipient, amount);
    }
}
