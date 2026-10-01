// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {SetrynTestUSDC} from "../../src/testnet/SetrynTestUSDC.sol";

contract SetrynTestUSDCTest is Test {
    SetrynTestUSDC internal token;
    address internal recipient = makeAddr("recipient");

    function setUp() public {
        token = new SetrynTestUSDC();
    }

    function test_MintsSixDecimalCollateralToCallerAndRecipient() public {
        token.mint(1_000e6);
        token.mintTo(recipient, 10_000e6);

        assertEq(token.name(), "Setryn Test USDC");
        assertEq(token.symbol(), "tUSDC");
        assertEq(token.decimals(), 6);
        assertEq(token.balanceOf(address(this)), 1_000e6);
        assertEq(token.balanceOf(recipient), 10_000e6);
    }

    function test_RefusesZeroAndAmountsAboveTheFaucetBalanceLimit() public {
        vm.expectRevert(
            abi.encodeWithSelector(SetrynTestUSDC.FaucetLimitExceeded.selector, recipient, uint256(0), uint256(0))
        );
        token.mintTo(recipient, 0);

        token.mintTo(recipient, token.MAXIMUM_FAUCET_BALANCE());
        vm.expectRevert(
            abi.encodeWithSelector(SetrynTestUSDC.FaucetLimitExceeded.selector, recipient, 10_000_000e6, uint256(1))
        );
        token.mintTo(recipient, 1);
    }

    function test_RefusesDeploymentOnArbitrumOne() public {
        vm.chainId(42_161);
        vm.expectRevert(abi.encodeWithSelector(SetrynTestUSDC.MainnetDeploymentDisabled.selector, 42_161));
        new SetrynTestUSDC();
    }
}
