// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {GmxV2MarketProps, GmxV2OrderAdapter} from "../../src/adapters/venue/GmxV2OrderAdapter.sol";
import {OperationalAdapterLib} from "../../src/libraries/OperationalAdapterLib.sol";
import {AdapterRuntimeDescriptor} from "../../src/types/OperationalAdapterTypes.sol";

/// @notice Minimal DataStore read surface for fork qualification (live ORDER_LIST reads).
interface IGmxV2ForkDataStore {
    function containsBytes32(bytes32 setKey, bytes32 value) external view returns (bool);
    function getBytes32Count(bytes32 setKey) external view returns (uint256);
}

/// @notice Minimal Reader market surface for fork qualification (exact four-address Market.Props).
interface IGmxV2ForkReader {
    function getMarket(address dataStore, address marketKey) external view returns (GmxV2MarketProps memory);
}

/// @notice Pinned Arbitrum One fork qualification for the GMX V2 bounded-async order adapter.
/// @dev Read-only by default: verifies explicit HTTPS RPC, decimal block, dependency code,
///      descriptor, canonical hashing, live Reader market state, and live ORDER_LIST reads
///      without moving value, requiring no keys and never broadcasting. Any local rehearsal
///      runs only when every amount fixture is explicitly supplied via env and performs
///      adapter-local staging plus cancellation only; it never calls the GMX multicall and
///      never broadcasts. GMX ExchangeRouter/Router/OrderVault/OrderHandler/DataStore/Reader/
///      WNT/market/collateral addresses are never hardcoded; they all come from env.
contract ArbitrumOneGmxV2OrderForkTest is Test {
    uint256 internal constant ARBITRUM_ONE_CHAIN_ID = 42_161;

    address internal exchangeRouter;
    address internal tokenTransferRouter;
    address internal orderVault;
    address internal orderHandler;
    address internal dataStore;
    address internal reader;
    address internal wnt;
    address internal market;
    address internal collateralToken;
    GmxV2OrderAdapter internal adapter;

    function setUp() public {
        string memory rpcUrl = vm.envOr("ARBITRUM_RPC_URL", string(""));
        string memory blockNumber = vm.envOr("ARBITRUM_ONE_FORK_BLOCK_NUMBER", string(""));
        address configuredExchangeRouter = vm.envOr("SETRYN_GMX_EXCHANGE_ROUTER", address(0));
        address configuredRouter = vm.envOr("SETRYN_GMX_ROUTER", address(0));
        address configuredVault = vm.envOr("SETRYN_GMX_ORDER_VAULT", address(0));
        address configuredHandler = vm.envOr("SETRYN_GMX_ORDER_HANDLER", address(0));
        address configuredDataStore = vm.envOr("SETRYN_GMX_DATASTORE", address(0));
        address configuredReader = vm.envOr("SETRYN_GMX_READER", address(0));
        address configuredWnt = vm.envOr("SETRYN_GMX_WNT", address(0));
        address configuredMarket = vm.envOr("SETRYN_GMX_MARKET", address(0));
        address configuredCollateral = vm.envOr("SETRYN_GMX_COLLATERAL_TOKEN", address(0));

        if (
            bytes(rpcUrl).length == 0 || bytes(blockNumber).length == 0 || configuredExchangeRouter == address(0)
                || configuredRouter == address(0) || configuredVault == address(0) || configuredHandler == address(0)
                || configuredDataStore == address(0) || configuredReader == address(0) || configuredWnt == address(0)
                || configuredMarket == address(0) || configuredCollateral == address(0)
        ) {
            vm.skip(
                true,
                "Set ARBITRUM_RPC_URL, ARBITRUM_ONE_FORK_BLOCK_NUMBER, SETRYN_GMX_EXCHANGE_ROUTER, SETRYN_GMX_ROUTER, SETRYN_GMX_ORDER_VAULT, SETRYN_GMX_ORDER_HANDLER, SETRYN_GMX_DATASTORE, SETRYN_GMX_READER, SETRYN_GMX_WNT, SETRYN_GMX_MARKET and SETRYN_GMX_COLLATERAL_TOKEN to run the GMX V2 fork suite"
            );
        }
        _requireHttps(rpcUrl);
        uint256 pinnedBlock = _requireDecimalBlock(blockNumber);

        vm.createSelectFork(rpcUrl, pinnedBlock);
        assertEq(block.chainid, ARBITRUM_ONE_CHAIN_ID, "RPC must resolve to Arbitrum One");
        assertGt(configuredExchangeRouter.code.length, 0, "configured ExchangeRouter must have code");
        assertGt(configuredRouter.code.length, 0, "configured Router must have code");
        assertGt(configuredVault.code.length, 0, "configured OrderVault must have code");
        assertGt(configuredHandler.code.length, 0, "configured OrderHandler must have code");
        assertGt(configuredDataStore.code.length, 0, "configured DataStore must have code");
        assertGt(configuredReader.code.length, 0, "configured Reader must have code");
        assertGt(configuredWnt.code.length, 0, "configured WNT must have code");
        assertGt(configuredMarket.code.length, 0, "configured market must have code");
        assertGt(configuredCollateral.code.length, 0, "configured collateral must have code");

        exchangeRouter = configuredExchangeRouter;
        tokenTransferRouter = configuredRouter;
        orderVault = configuredVault;
        orderHandler = configuredHandler;
        dataStore = configuredDataStore;
        reader = configuredReader;
        wnt = configuredWnt;
        market = configuredMarket;
        collateralToken = configuredCollateral;
        adapter = new GmxV2OrderAdapter(
            ARBITRUM_ONE_CHAIN_ID,
            exchangeRouter,
            tokenTransferRouter,
            orderVault,
            orderHandler,
            dataStore,
            reader,
            wnt,
            address(this),
            0,
            address(this),
            address(this),
            address(this),
            2_000_000
        );
    }

    function test_DescriptorIsProxyFreeValueMovingAsync() public view {
        AdapterRuntimeDescriptor memory descriptor = adapter.operationalAdapterDescriptor();
        assertEq(descriptor.self, address(adapter));
        assertEq(descriptor.chainId, ARBITRUM_ONE_CHAIN_ID);
        assertEq(descriptor.interfaceHash, OperationalAdapterLib.INTERFACE_EXTERNAL_VENUE);
        assertEq(descriptor.capabilityHash, OperationalAdapterLib.CAPABILITY_EXTERNAL_ASYNC);
        assertTrue(descriptor.proxyFree);
        assertTrue(descriptor.valueMoving);
    }

    function test_DependencyCodeMarketAndOrderListReadOnly() public view {
        assertGt(exchangeRouter.code.length, 0, "ExchangeRouter must retain code");
        assertGt(tokenTransferRouter.code.length, 0, "Router must retain code");
        assertGt(orderVault.code.length, 0, "OrderVault must retain code");
        assertGt(orderHandler.code.length, 0, "OrderHandler must retain code");
        assertGt(dataStore.code.length, 0, "DataStore must retain code");
        assertGt(reader.code.length, 0, "Reader must retain code");
        assertGt(wnt.code.length, 0, "WNT must retain code");
        assertEq(address(adapter.exchangeRouter()), exchangeRouter, "adapter must bind the exact ExchangeRouter");
        assertEq(adapter.tokenTransferRouter(), tokenTransferRouter, "adapter must bind the exact Router target");
        assertEq(adapter.orderVault(), orderVault, "adapter must bind the exact OrderVault");
        assertEq(adapter.orderHandler(), orderHandler, "adapter must bind the exact OrderHandler sender");
        assertEq(address(adapter.dataStore()), dataStore, "adapter must bind the exact DataStore");
        assertEq(address(adapter.reader()), reader, "adapter must bind the exact Reader");
        assertEq(adapter.wnt(), wnt, "adapter must bind the exact WNT");
        assertEq(adapter.expectedChainId(), ARBITRUM_ONE_CHAIN_ID, "adapter must bind Arbitrum One");
        assertEq(adapter.executor(), address(this), "adapter must bind the exact executor");
        assertEq(adapter.ORDER_LIST(), keccak256(abi.encode("ORDER_LIST")), "ORDER_LIST must match Keys.ORDER_LIST");

        GmxV2MarketProps memory props = IGmxV2ForkReader(reader).getMarket(dataStore, market);
        assertTrue(props.marketToken != address(0), "market must exist in bound DataStore");
        assertTrue(
            collateralToken == props.longToken || collateralToken == props.shortToken,
            "configured collateral must be a member long/short token of the configured market"
        );

        // Live ORDER_LIST reads against the pinned block: the zero key is never listed, and
        // the count query must succeed. Both are static reads; no writes, no broadcast.
        assertFalse(
            IGmxV2ForkDataStore(dataStore).containsBytes32(adapter.ORDER_LIST(), bytes32(0)),
            "zero key must be absent from ORDER_LIST"
        );
        assertFalse(adapter.orderExists(bytes32(uint256(1))), "unknown key must read absent via adapter");
        IGmxV2ForkDataStore(dataStore).getBytes32Count(adapter.ORDER_LIST());

        assertEq(
            IERC20(collateralToken).allowance(address(adapter), tokenTransferRouter),
            0,
            "adapter must hold no Router allowance"
        );
    }

    function test_CanonicalHashesDeterministicReadOnly() public view {
        bytes32 policy = keccak256("fork-recovery-policy");
        uint64 deadline = uint64(block.timestamp + 1 hours);
        address[] memory path = new address[](0);
        bytes32 pathHash = adapter.hashSwapPath(path);
        GmxV2OrderAdapter.GmxV2ActionHashInputs memory hashInputs = GmxV2OrderAdapter.GmxV2ActionHashInputs({
            kind: uint8(GmxV2OrderAdapter.GmxV2OrderKind.Increase),
            market: market,
            initialCollateralToken: collateralToken,
            swapPathHash: pathHash,
            receiver: address(this),
            uiFeeReceiver: address(this),
            sizeDeltaUsd: 50 ether,
            initialCollateralDeltaAmount: 5 ether,
            triggerPrice: 0,
            acceptablePrice: 1,
            executionFee: 0.1 ether,
            orderType: adapter.MARKET_INCREASE(),
            isLong: true,
            shouldUnwrapNativeToken: false,
            referralCode: bytes32(0),
            deadline: deadline,
            recoveryPolicyHash: policy
        });
        bytes32 first = adapter.hashStagedAction(hashInputs);
        bytes32 second = adapter.hashStagedAction(hashInputs);
        assertEq(first, second, "canonical action hash must be deterministic");
        assertTrue(first != bytes32(0), "canonical action hash must be nonzero");
        GmxV2OrderAdapter.GmxV2PostconditionsInputs memory postInputs = GmxV2OrderAdapter.GmxV2PostconditionsInputs({
            actionHash: first,
            market: market,
            initialCollateralToken: collateralToken,
            swapPathHash: pathHash,
            receiver: address(this),
            sizeDeltaUsd: 50 ether,
            initialCollateralDeltaAmount: 5 ether,
            triggerPrice: 0,
            acceptablePrice: 1,
            executionFee: 0.1 ether,
            orderType: adapter.MARKET_INCREASE(),
            isLong: true,
            shouldUnwrapNativeToken: false,
            deadline: deadline,
            recoveryPolicyHash: policy
        });
        bytes32 postFirst = adapter.hashExpectedPostconditions(postInputs);
        bytes32 postSecond = adapter.hashExpectedPostconditions(postInputs);
        assertEq(postFirst, postSecond, "expected postconditions must be precomputable");
        assertTrue(postFirst != bytes32(0), "postconditions must be nonzero");
    }

    function test_LocalRehearsalWhenEveryFixtureSupplied() public {
        uint256 collateralAmount = vm.envOr("SETRYN_GMX_FORK_COLLATERAL_AMOUNT", uint256(0));
        uint256 executionFee = vm.envOr("SETRYN_GMX_FORK_EXECUTION_FEE", uint256(0));
        uint256 sizeDeltaUsd = vm.envOr("SETRYN_GMX_FORK_SIZE_USD", uint256(0));
        if (collateralAmount == 0 || executionFee == 0 || sizeDeltaUsd == 0) {
            vm.skip(
                true,
                "Set SETRYN_GMX_FORK_COLLATERAL_AMOUNT, SETRYN_GMX_FORK_EXECUTION_FEE and SETRYN_GMX_FORK_SIZE_USD to run the local rehearsal; read-only qualification above already passed"
            );
        }
        deal(collateralToken, address(adapter), collateralAmount, true);
        adapter.syncInventory(collateralToken);
        assertEq(adapter.inventoriedBalance(collateralToken), collateralAmount);
        vm.deal(address(this), executionFee);
        adapter.fundNativeExecutionInventory{value: executionFee}();
        assertEq(adapter.nativeInventoried(), executionFee);

        bytes32 policy = keccak256("fork-rehearsal-recovery");
        uint64 deadline = uint64(block.timestamp + 1 hours);
        address[] memory path = new address[](0);
        bytes32 actionHash = adapter.stageOrder(
            GmxV2OrderAdapter.GmxV2StageOrderInputs({
                kind: GmxV2OrderAdapter.GmxV2OrderKind.Increase,
                market: market,
                initialCollateralToken: collateralToken,
                swapPath: path,
                receiver: address(this),
                uiFeeReceiver: address(this),
                sizeDeltaUsd: sizeDeltaUsd,
                initialCollateralDeltaAmount: collateralAmount,
                triggerPrice: 0,
                acceptablePrice: 1,
                executionFee: executionFee,
                orderType: adapter.MARKET_INCREASE(),
                isLong: true,
                shouldUnwrapNativeToken: false,
                referralCode: bytes32(0),
                deadline: deadline,
                recoveryPolicyHash: policy
            })
        );
        assertEq(adapter.reservedBalance(collateralToken), collateralAmount);
        assertEq(adapter.nativeReserved(), executionFee);
        adapter.cancelStagedAction(actionHash);
        assertEq(adapter.reservedBalance(collateralToken), 0);
        assertEq(adapter.nativeReserved(), 0);
        assertEq(
            IERC20(collateralToken).allowance(address(adapter), tokenTransferRouter),
            0,
            "rehearsal must leave no Router allowance and must never broadcast"
        );
    }

    function _requireHttps(string memory rpcUrl) private pure {
        bytes memory raw = bytes(rpcUrl);
        require(raw.length > 8, "ARBITRUM_RPC_URL must be explicit HTTPS");
        require(
            raw[0] == "h" && raw[1] == "t" && raw[2] == "t" && raw[3] == "p" && raw[4] == "s" && raw[5] == ":"
                && raw[6] == "/" && raw[7] == "/",
            "ARBITRUM_RPC_URL must use https://"
        );
    }

    function _requireDecimalBlock(string memory blockNumber) private pure returns (uint256) {
        bytes memory raw = bytes(blockNumber);
        require(raw.length > 0, "ARBITRUM_ONE_FORK_BLOCK_NUMBER must be a decimal block");
        for (uint256 i = 0; i < raw.length; i++) {
            require(raw[i] >= "0" && raw[i] <= "9", "ARBITRUM_ONE_FORK_BLOCK_NUMBER must be decimal");
        }
        return _parseUint(blockNumber);
    }

    function _parseUint(string memory value) private pure returns (uint256 result) {
        bytes memory raw = bytes(value);
        for (uint256 i = 0; i < raw.length; i++) {
            result = result * 10 + (uint8(raw[i]) - 48);
        }
        require(result > 0, "pinned block must be nonzero");
    }
}
