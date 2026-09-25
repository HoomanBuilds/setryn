// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

contract ArbitrumOneNativeUsdcForkTest is Test {
    uint256 internal constant ARBITRUM_ONE_CHAIN_ID = 42_161;
    address internal constant NATIVE_USDC = 0xaf88d065e77c8cC2239327C5EDb3A432268e5831;

    bytes4 internal constant NAME_SELECTOR = bytes4(keccak256("name()"));
    bytes4 internal constant SYMBOL_SELECTOR = bytes4(keccak256("symbol()"));
    bytes4 internal constant DECIMALS_SELECTOR = bytes4(keccak256("decimals()"));
    bytes4 internal constant VERSION_SELECTOR = bytes4(keccak256("version()"));
    bytes4 internal constant DOMAIN_SEPARATOR_SELECTOR = bytes4(keccak256("DOMAIN_SEPARATOR()"));
    bytes4 internal constant TOTAL_SUPPLY_SELECTOR = bytes4(keccak256("totalSupply()"));

    bytes32 internal constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    function setUp() public {
        string memory rpcUrl = vm.envOr("ARBITRUM_RPC_URL", string(""));
        string memory blockNumber = vm.envOr("ARBITRUM_ONE_FORK_BLOCK_NUMBER", string(""));

        if (bytes(rpcUrl).length == 0 || bytes(blockNumber).length == 0) {
            vm.skip(
                true,
                "Set ARBITRUM_RPC_URL and ARBITRUM_ONE_FORK_BLOCK_NUMBER to run the pinned Arbitrum One fork suite"
            );
        }

        vm.createSelectFork(rpcUrl, vm.parseUint(blockNumber));
        assertEq(block.chainid, ARBITRUM_ONE_CHAIN_ID, "RPC must resolve to Arbitrum One");
    }

    function test_NativeUsdcCodeAndSetrynMetadataAssumptions() public view {
        assertGt(NATIVE_USDC.code.length, 0, "native USDC must have runtime code at the pinned block");
        assertTrue(NATIVE_USDC.codehash != bytes32(0), "native USDC runtime code hash must be nonzero");

        assertEq(abi.decode(_read(NAME_SELECTOR), (string)), "USD Coin");
        assertEq(abi.decode(_read(SYMBOL_SELECTOR), (string)), "USDC");
        assertEq(abi.decode(_read(DECIMALS_SELECTOR), (uint8)), 6);
    }

    function test_NativeUsdcDomainIsBoundToArbitrumAndProxyAddress() public view {
        string memory name = abi.decode(_read(NAME_SELECTOR), (string));
        string memory version = abi.decode(_read(VERSION_SELECTOR), (string));
        bytes32 actualDomainSeparator = abi.decode(_read(DOMAIN_SEPARATOR_SELECTOR), (bytes32));
        bytes32 expectedDomainSeparator = keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                keccak256(bytes(name)),
                keccak256(bytes(version)),
                ARBITRUM_ONE_CHAIN_ID,
                NATIVE_USDC
            )
        );

        assertEq(version, "2");
        assertEq(actualDomainSeparator, expectedDomainSeparator);
    }

    function test_ForkProbeCannotMutateNativeUsdc() public view {
        bytes32 codeHashBefore = NATIVE_USDC.codehash;
        uint256 totalSupplyBefore = abi.decode(_read(TOTAL_SUPPLY_SELECTOR), (uint256));

        _read(NAME_SELECTOR);
        _read(SYMBOL_SELECTOR);
        _read(DECIMALS_SELECTOR);
        _read(VERSION_SELECTOR);
        _read(DOMAIN_SEPARATOR_SELECTOR);

        assertEq(NATIVE_USDC.codehash, codeHashBefore);
        assertEq(abi.decode(_read(TOTAL_SUPPLY_SELECTOR), (uint256)), totalSupplyBefore);
    }

    function _read(bytes4 selector) private view returns (bytes memory returnData) {
        (bool success, bytes memory data) = NATIVE_USDC.staticcall(abi.encodeWithSelector(selector));
        assertTrue(success, "native USDC read failed at the pinned block");
        assertGt(data.length, 0, "native USDC read returned no data");
        return data;
    }
}
