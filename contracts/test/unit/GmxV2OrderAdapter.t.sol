// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import {
    GmxV2CreateOrderParams,
    GmxV2EventTypes,
    GmxV2MarketProps,
    GmxV2OrderAdapter,
    IGmxV2ExchangeRouter
} from "../../src/adapters/venue/GmxV2OrderAdapter.sol";
import {OperationalAdapterLib} from "../../src/libraries/OperationalAdapterLib.sol";
import {AccountId, MarketId, PackageId, SeriesId} from "../../src/types/Identifiers.sol";
import {
    AdapterRuntimeDescriptor,
    ExecutionGuaranteeClass,
    ExternalTerminalFallback,
    ExternalVenueRequest,
    ExternalVenueResult,
    OperationalActionState,
    OperationalBinding
} from "../../src/types/OperationalAdapterTypes.sol";

contract MockMintableERC20 is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockCodeTarget {
    uint256 internal _slot;
}

/// @notice Mirrors the GMX Router plugin: pulls ERC20 via transferFrom on behalf of the router.
contract MockGmxRouter {
    function pluginTransfer(address token, address account, address receiver, uint256 amount) external {
        IERC20(token).transferFrom(account, receiver, amount);
    }
}

/// @notice Mirrors the GMX OrderVault: receives collateral and wrapped fee, accepts native.
contract MockGmxOrderVault {
    receive() external payable {}
}

/// @notice Mirrors the GMX DataStore pending-order set: ORDER_LIST containsBytes32 only.
contract MockGmxDataStore {
    bytes32 private constant ORDER_LIST = keccak256(abi.encode("ORDER_LIST"));
    mapping(bytes32 key => bool present) private _orders;

    function addOrder(bytes32 key) external {
        _orders[key] = true;
    }

    function removeOrder(bytes32 key) external {
        delete _orders[key];
    }

    function containsBytes32(bytes32 setKey, bytes32 value) external view returns (bool) {
        if (setKey != ORDER_LIST) return false;
        return _orders[value];
    }
}

contract MockGmxReader {
    mapping(address market => GmxV2MarketProps props) private _markets;

    function setMarket(address market, GmxV2MarketProps calldata props) external {
        _markets[market] = props;
    }

    function getMarket(address, address marketKey) external view returns (GmxV2MarketProps memory) {
        return _markets[marketKey];
    }
}

/// @notice Mirrors the production ExchangeRouter multicall flow: native value funds sendWnt,
///         collateral is pulled through the Router plugin into the OrderVault, and createOrder
///         registers the key in the DataStore ORDER_LIST set.
contract MockGmxExchangeRouter is IGmxV2ExchangeRouter {
    MockGmxRouter public router;
    address public orderVault;
    MockGmxDataStore public dataStore;
    uint256 public orderNonce;
    bytes[] public lastCalls;
    uint256 public lastValue;
    bytes32 public lastOrderKey;
    GmxV2CreateOrderParams public lastParams;
    bool public hasLastParams;
    mapping(bytes32 => bool) public cancelledOrders;
    bool public shortNative;
    bool public shortCollateral;

    constructor(address router_, address vault_, address store_) {
        router = MockGmxRouter(router_);
        orderVault = vault_;
        dataStore = MockGmxDataStore(store_);
    }

    function setShortNative(bool value) external {
        shortNative = value;
    }

    function setShortCollateral(bool value) external {
        shortCollateral = value;
    }

    function lastCallsLength() external view returns (uint256) {
        return lastCalls.length;
    }

    function multicall(bytes[] calldata data) external payable override returns (bytes[] memory results) {
        delete lastCalls;
        for (uint256 i = 0; i < data.length; i++) {
            lastCalls.push(data[i]);
        }
        lastValue = msg.value;
        uint256 expectedValue;
        for (uint256 i = 0; i < data.length; i++) {
            if (bytes4(data[i]) == this.sendWnt.selector) {
                (, uint256 amount) = abi.decode(_strip(data[i]), (address, uint256));
                expectedValue += amount;
            }
        }
        require(msg.value == expectedValue, "mock: inexact native fee value");
        results = new bytes[](data.length);
        uint256 vaultNativeStart = address(orderVault).balance;
        for (uint256 i = 0; i < data.length; i++) {
            bytes4 selector = bytes4(data[i]);
            if (selector == this.sendTokens.selector) {
                (address token, address receiver, uint256 amount) =
                    abi.decode(_strip(data[i]), (address, address, uint256));
                uint256 actual = shortCollateral && amount > 0 ? amount - 1 : amount;
                router.pluginTransfer(token, msg.sender, receiver, actual);
                results[i] = abi.encode(true);
            } else if (selector == this.sendWnt.selector) {
                (address receiver, uint256 amount) = abi.decode(_strip(data[i]), (address, uint256));
                uint256 actual = shortNative && amount > 0 ? amount - 1 : amount;
                (bool ok,) = receiver.call{value: actual}("");
                require(ok, "mock: native forward failed");
                results[i] = abi.encode(true);
            } else if (selector == this.createOrder.selector) {
                GmxV2CreateOrderParams memory params = abi.decode(_strip(data[i]), (GmxV2CreateOrderParams));
                // Mirrors OrderUtils.createOrder: the wrapped fee recorded in the vault must
                // cover the requested execution fee or creation reverts the whole multicall.
                require(
                    address(orderVault).balance - vaultNativeStart >= params.numbers.executionFee,
                    "mock: insufficient wnt for execution fee"
                );
                orderNonce += 1;
                bytes32 key = keccak256(abi.encode("order", msg.sender, orderNonce, block.timestamp, data[i]));
                if (key == bytes32(0)) key = bytes32(uint256(1));
                lastOrderKey = key;
                lastParams = params;
                hasLastParams = true;
                dataStore.addOrder(key);
                results[i] = abi.encode(key);
            } else {
                revert("mock: unknown multicall selector");
            }
        }
    }

    function sendWnt(address receiver, uint256 amount) external payable override {
        (bool ok,) = receiver.call{value: amount}("");
        require(ok, "mock: sendWnt failed");
    }

    function sendTokens(address token, address receiver, uint256 amount) external override {
        router.pluginTransfer(token, msg.sender, receiver, amount);
    }

    function createOrder(GmxV2CreateOrderParams calldata params) external payable override returns (bytes32) {
        orderNonce += 1;
        bytes32 key = keccak256(abi.encode("order", msg.sender, orderNonce, block.timestamp));
        if (key == bytes32(0)) key = bytes32(uint256(1));
        lastOrderKey = key;
        lastParams = params;
        hasLastParams = true;
        dataStore.addOrder(key);
        return key;
    }

    function cancelOrder(bytes32 key) external payable override {
        cancelledOrders[key] = true;
    }

    function _strip(bytes calldata data) private pure returns (bytes calldata out) {
        require(data.length >= 4, "short calldata");
        out = data[4:];
    }

    receive() external payable {}
}

contract GmxV2OrderAdapterTest is Test {
    MockMintableERC20 private collateral;
    MockMintableERC20 private wntToken;
    MockMintableERC20 private otherToken;
    MockCodeTarget private market;
    MockGmxRouter private transferRouter;
    MockGmxOrderVault private vault;
    MockCodeTarget private orderHandler;
    MockGmxDataStore private dataStore;
    MockGmxReader private reader;
    MockGmxExchangeRouter private exchangeRouter;
    GmxV2OrderAdapter private adapter;

    uint256 private constant CALLBACK_GAS = 2_000_000;

    receive() external payable {}

    function setUp() external {
        collateral = new MockMintableERC20("Collateral", "COL");
        wntToken = new MockMintableERC20("Wrapped Native", "WNT");
        otherToken = new MockMintableERC20("Other", "OTH");
        market = new MockCodeTarget();
        transferRouter = new MockGmxRouter();
        vault = new MockGmxOrderVault();
        orderHandler = new MockCodeTarget();
        dataStore = new MockGmxDataStore();
        reader = new MockGmxReader();
        exchangeRouter = new MockGmxExchangeRouter(address(transferRouter), address(vault), address(dataStore));
        reader.setMarket(
            address(market),
            GmxV2MarketProps({
                marketToken: address(market),
                indexToken: address(otherToken),
                longToken: address(collateral),
                shortToken: address(otherToken)
            })
        );
        adapter = new GmxV2OrderAdapter(
            block.chainid,
            address(exchangeRouter),
            address(transferRouter),
            address(vault),
            address(orderHandler),
            address(dataStore),
            address(reader),
            address(wntToken),
            address(this),
            0,
            address(this),
            address(this),
            address(this),
            CALLBACK_GAS
        );
        collateral.mint(address(this), 1_000_000 ether);
        otherToken.mint(address(this), 1_000_000 ether);
        vm.deal(address(this), 1_000_000 ether);
    }

    function test_DescriptorIsBoundedAsync() external view {
        AdapterRuntimeDescriptor memory descriptor = adapter.operationalAdapterDescriptor();
        assertEq(descriptor.self, address(adapter));
        assertEq(descriptor.chainId, block.chainid);
        assertEq(descriptor.interfaceHash, OperationalAdapterLib.INTERFACE_EXTERNAL_VENUE);
        assertEq(descriptor.capabilityHash, OperationalAdapterLib.CAPABILITY_EXTERNAL_ASYNC);
        assertTrue(descriptor.proxyFree);
        assertTrue(descriptor.valueMoving);
    }

    function test_BindingsAreExact() external view {
        assertEq(address(adapter.exchangeRouter()), address(exchangeRouter));
        assertEq(adapter.tokenTransferRouter(), address(transferRouter));
        assertEq(adapter.orderVault(), address(vault));
        assertEq(adapter.orderHandler(), address(orderHandler));
        assertEq(address(adapter.dataStore()), address(dataStore));
        assertEq(address(adapter.reader()), address(reader));
        assertEq(adapter.wnt(), address(wntToken));
        assertEq(adapter.executor(), address(this));
        assertEq(adapter.ORDER_LIST(), keccak256(abi.encode("ORDER_LIST")), "ORDER_LIST must match Keys.ORDER_LIST");
    }

    function test_StagingReservesCollateralAndNative() external {
        uint256 colAmount = 5 ether;
        uint256 fee = 0.1 ether;
        _fundCollateral(colAmount);
        _fundNative(fee);
        bytes32 actionHash = _stageIncrease(colAmount, fee);
        assertTrue(actionHash != bytes32(0));
        assertEq(adapter.reservedBalance(address(collateral)), colAmount);
        assertEq(adapter.nativeReserved(), fee);
        assertEq(adapter.unreservedBalance(address(collateral)), 0);
        assertEq(adapter.nativeUnreserved(), 0);
    }

    function test_DecreaseStagingReservesOnlyNative() external {
        uint256 fee = 0.1 ether;
        _fundNative(fee);
        bytes32 actionHash = _stageDecrease(2 ether, fee);
        assertTrue(actionHash != bytes32(0));
        assertEq(adapter.reservedBalance(address(collateral)), 0);
        assertEq(adapter.nativeReserved(), fee);
    }

    function test_RevertWhenOverReservation() external {
        _fundCollateral(1 ether);
        _fundNative(0.05 ether);
        _stageIncrease(1 ether, 0.05 ether);
        vm.expectRevert();
        _stageIncreaseRaw(1, 1, uint64(block.timestamp + 1 hours));
    }

    function test_RevertOnInvalidStagingInputs() external {
        _fundCollateral(10 ether);
        _fundNative(10 ether);
        uint64 deadline = uint64(block.timestamp + 1 hours);
        address[] memory path = new address[](0);
        vm.expectRevert(GmxV2OrderAdapter.ZeroReceiver.selector);
        adapter.stageOrder(
            GmxV2OrderAdapter.GmxV2StageOrderInputs({
                kind: GmxV2OrderAdapter.GmxV2OrderKind.Increase,
                market: address(market),
                initialCollateralToken: address(collateral),
                swapPath: path,
                receiver: address(0),
                uiFeeReceiver: address(this),
                sizeDeltaUsd: 10 ether,
                initialCollateralDeltaAmount: 5 ether,
                triggerPrice: 0,
                acceptablePrice: 1,
                executionFee: 0.1 ether,
                orderType: 2,
                isLong: true,
                shouldUnwrapNativeToken: false,
                referralCode: bytes32(0),
                deadline: deadline,
                recoveryPolicyHash: keccak256("recovery")
            })
        );
        vm.expectRevert(GmxV2OrderAdapter.ZeroExecutionFee.selector);
        adapter.stageOrder(
            GmxV2OrderAdapter.GmxV2StageOrderInputs({
                kind: GmxV2OrderAdapter.GmxV2OrderKind.Increase,
                market: address(market),
                initialCollateralToken: address(collateral),
                swapPath: path,
                receiver: address(this),
                uiFeeReceiver: address(this),
                sizeDeltaUsd: 10 ether,
                initialCollateralDeltaAmount: 5 ether,
                triggerPrice: 0,
                acceptablePrice: 1,
                executionFee: 0,
                orderType: 2,
                isLong: true,
                shouldUnwrapNativeToken: false,
                referralCode: bytes32(0),
                deadline: deadline,
                recoveryPolicyHash: keccak256("recovery")
            })
        );
        vm.expectRevert(abi.encodeWithSelector(GmxV2OrderAdapter.InvalidOrderTypeForKind.selector, uint8(0), uint8(0)));
        adapter.stageOrder(
            GmxV2OrderAdapter.GmxV2StageOrderInputs({
                kind: GmxV2OrderAdapter.GmxV2OrderKind.Increase,
                market: address(market),
                initialCollateralToken: address(collateral),
                swapPath: path,
                receiver: address(this),
                uiFeeReceiver: address(this),
                sizeDeltaUsd: 10 ether,
                initialCollateralDeltaAmount: 5 ether,
                triggerPrice: 0,
                acceptablePrice: 1,
                executionFee: 0.1 ether,
                orderType: 0,
                isLong: true,
                shouldUnwrapNativeToken: false,
                referralCode: bytes32(0),
                deadline: deadline,
                recoveryPolicyHash: keccak256("recovery")
            })
        );
        vm.expectRevert(abi.encodeWithSelector(GmxV2OrderAdapter.LimitOrderMissingTrigger.selector, uint8(3)));
        adapter.stageOrder(
            GmxV2OrderAdapter.GmxV2StageOrderInputs({
                kind: GmxV2OrderAdapter.GmxV2OrderKind.Increase,
                market: address(market),
                initialCollateralToken: address(collateral),
                swapPath: path,
                receiver: address(this),
                uiFeeReceiver: address(this),
                sizeDeltaUsd: 10 ether,
                initialCollateralDeltaAmount: 5 ether,
                triggerPrice: 0,
                acceptablePrice: 1,
                executionFee: 0.1 ether,
                orderType: 3,
                isLong: true,
                shouldUnwrapNativeToken: false,
                referralCode: bytes32(0),
                deadline: deadline,
                recoveryPolicyHash: keccak256("recovery")
            })
        );
    }

    function test_RevertSwapWithMarket() external {
        _fundCollateral(10 ether);
        _fundNative(10 ether);
        address[] memory path = new address[](1);
        path[0] = address(market);
        vm.expectRevert(abi.encodeWithSelector(GmxV2OrderAdapter.UnexpectedMarketForSwap.selector, address(market)));
        adapter.stageOrder(
            GmxV2OrderAdapter.GmxV2StageOrderInputs({
                kind: GmxV2OrderAdapter.GmxV2OrderKind.Swap,
                market: address(market),
                initialCollateralToken: address(collateral),
                swapPath: path,
                receiver: address(this),
                uiFeeReceiver: address(this),
                sizeDeltaUsd: 0,
                initialCollateralDeltaAmount: 1 ether,
                triggerPrice: 0,
                acceptablePrice: 0,
                executionFee: 0.1 ether,
                orderType: 0,
                isLong: true,
                shouldUnwrapNativeToken: false,
                referralCode: bytes32(0),
                deadline: uint64(block.timestamp + 1 hours),
                recoveryPolicyHash: keccak256("recovery")
            })
        );
    }

    function test_RevertOnMarketMembershipMismatch() external {
        _fundCollateral(10 ether);
        _fundNative(10 ether);
        MockMintableERC20 stranger = new MockMintableERC20("Stranger", "STR");
        stranger.mint(address(adapter), 10 ether);
        adapter.syncInventory(address(stranger));
        uint64 deadline = uint64(block.timestamp + 1 hours);
        address[] memory path = new address[](0);
        vm.expectRevert(
            abi.encodeWithSelector(
                GmxV2OrderAdapter.MarketMembershipMismatch.selector, address(market), address(stranger)
            )
        );
        adapter.stageOrder(
            GmxV2OrderAdapter.GmxV2StageOrderInputs({
                kind: GmxV2OrderAdapter.GmxV2OrderKind.Increase,
                market: address(market),
                initialCollateralToken: address(stranger),
                swapPath: path,
                receiver: address(this),
                uiFeeReceiver: address(this),
                sizeDeltaUsd: 10 ether,
                initialCollateralDeltaAmount: 1 ether,
                triggerPrice: 0,
                acceptablePrice: 1,
                executionFee: 0.1 ether,
                orderType: 2,
                isLong: true,
                shouldUnwrapNativeToken: false,
                referralCode: bytes32(0),
                deadline: deadline,
                recoveryPolicyHash: keccak256("recovery")
            })
        );
    }

    function test_SubmissionUsesThreeLegsAndNativeValue() external {
        uint256 colAmount = 5 ether;
        uint256 fee = 0.2 ether;
        _fundCollateral(colAmount);
        _fundNative(fee);
        uint256 adapterNativeBefore = address(adapter).balance;
        bytes32 actionHash = _stageIncrease(colAmount, fee);
        ExternalVenueRequest memory request = _request(actionHash);
        ExternalVenueResult memory result = adapter.submitExternalAction(request);
        assertEq(uint8(result.state), uint8(OperationalActionState.Submitted));
        assertTrue(result.venueActionReference != bytes32(0));
        assertTrue(result.evidenceHash != bytes32(0));

        assertEq(exchangeRouter.lastCallsLength(), 3);
        assertEq(exchangeRouter.lastValue(), fee);
        (address wntReceiver, uint256 wntAmount) =
            abi.decode(_stripSelector(exchangeRouter.lastCalls(0)), (address, uint256));
        assertEq(wntReceiver, address(vault));
        assertEq(wntAmount, fee);
        (address t0, address r0, uint256 a0) =
            abi.decode(_stripSelector(exchangeRouter.lastCalls(1)), (address, address, uint256));
        assertEq(t0, address(collateral));
        assertEq(r0, address(vault));
        assertEq(a0, colAmount);
        GmxV2CreateOrderParams memory params =
            abi.decode(_stripSelector(exchangeRouter.lastCalls(2)), (GmxV2CreateOrderParams));
        assertEq(params.addresses.callbackContract, address(adapter));
        assertEq(params.addresses.cancellationReceiver, address(adapter));
        assertEq(params.addresses.market, address(market));
        assertEq(params.addresses.initialCollateralToken, address(collateral));
        assertEq(params.numbers.executionFee, fee);
        assertEq(params.numbers.callbackGasLimit, CALLBACK_GAS);
        assertEq(params.addresses.receiver, address(this));
        assertEq(params.numbers.minOutputAmount, 0);
        assertEq(params.numbers.validFromTime, 0);
        assertFalse(params.autoCancel);
        assertEq(params.decreasePositionSwapType, 0);
        assertEq(params.dataList.length, 0);

        assertEq(collateral.allowance(address(adapter), address(transferRouter)), 0);
        assertEq(collateral.balanceOf(address(adapter)), 0);
        assertEq(address(adapter).balance, adapterNativeBefore - fee);
        assertEq(adapter.nativeInventoried(), 0);
        assertTrue(adapter.orderExists(result.venueActionReference));

        ExternalVenueRequest memory copy = request;
        bytes32 requestHash = OperationalAdapterLib.hashExternalRequest(copy);
        ExternalVenueResult memory reconciled = adapter.reconcileExternalAction(requestHash);
        assertEq(uint8(reconciled.state), uint8(OperationalActionState.Submitted));
        assertEq(reconciled.venueActionReference, result.venueActionReference);
    }

    function test_DecreaseSubmissionUsesTwoLegsAndMovesNoCollateral() external {
        uint256 fee = 0.2 ether;
        uint256 size = 50 ether;
        _fundNative(fee);
        collateral.mint(address(adapter), 7 ether);
        adapter.syncInventory(address(collateral));
        uint256 collateralBefore = collateral.balanceOf(address(adapter));
        bytes32 actionHash = _stageDecreaseWithSize(3 ether, fee, size);
        ExternalVenueRequest memory request = _requestFor(actionHash, int256(0), int256(size) + int256(100 ether));
        ExternalVenueResult memory result = adapter.submitExternalAction(request);
        assertEq(exchangeRouter.lastCallsLength(), 2);
        assertEq(exchangeRouter.lastValue(), fee);
        assertEq(collateral.balanceOf(address(adapter)), collateralBefore);
        assertEq(adapter.reservedBalance(address(collateral)), 0);
        assertEq(adapter.nativeReserved(), fee);
        GmxV2OrderAdapter.StoredGmxV2Request memory storedReq =
            adapter.getStoredRequest(OperationalAdapterLib.hashExternalRequest(_copy(request)));
        assertEq(storedReq.collateralAmount, 0);
        assertTrue(result.venueActionReference != bytes32(0));
    }

    function test_ExecutionCallbackBecomesCompleteAndReleases() external {
        uint256 colAmount = 5 ether;
        uint256 fee = 0.2 ether;
        uint256 size = 50 ether;
        _fundCollateral(colAmount);
        _fundNative(fee);
        bytes32 actionHash = _stageIncreaseWithSize(colAmount, fee, size);
        ExternalVenueRequest memory request = _requestFor(actionHash, int256(size), int256(size) + int256(100 ether));
        ExternalVenueResult memory submitted = adapter.submitExternalAction(request);
        bytes32 orderKey = submitted.venueActionReference;
        GmxV2EventTypes.EventLogData memory orderData = _boundOrderData(actionHash);
        GmxV2EventTypes.EventLogData memory eventData = _emptyEventData();
        vm.prank(address(orderHandler));
        adapter.afterOrderExecution(orderKey, orderData, eventData);
        ExternalVenueRequest memory copy = request;
        bytes32 requestHash = OperationalAdapterLib.hashExternalRequest(copy);
        ExternalVenueResult memory finalResult = adapter.reconcileExternalAction(requestHash);
        assertEq(uint8(finalResult.state), uint8(OperationalActionState.Complete));
        assertEq(finalResult.realizedValue, int256(size));
        assertEq(finalResult.postconditionsHash, request.binding.expectedPostconditionsHash);
        assertTrue(finalResult.evidenceHash != bytes32(0));
        assertEq(adapter.reservedBalance(address(collateral)), 0);
        assertEq(adapter.nativeReserved(), 0);
        assertTrue(adapter.getStoredRequest(requestHash).reservationReleased);
        vm.prank(address(orderHandler));
        vm.expectRevert(abi.encodeWithSelector(GmxV2OrderAdapter.OrderAlreadyResolved.selector, orderKey));
        adapter.afterOrderExecution(orderKey, orderData, eventData);
    }

    function test_CancellationBecomesRecoveringAndNeverComplete() external {
        uint256 colAmount = 3 ether;
        uint256 fee = 0.1 ether;
        _fundCollateral(colAmount);
        _fundNative(fee);
        bytes32 actionHash = _stageIncrease(colAmount, fee);
        ExternalVenueRequest memory request = _request(actionHash);
        ExternalVenueResult memory submitted = adapter.submitExternalAction(request);
        bytes32 orderKey = submitted.venueActionReference;
        GmxV2EventTypes.EventLogData memory orderData = _boundOrderData(actionHash);
        vm.prank(address(orderHandler));
        adapter.afterOrderCancellation(orderKey, orderData, _emptyEventData());
        ExternalVenueRequest memory copy = request;
        bytes32 requestHash = OperationalAdapterLib.hashExternalRequest(copy);
        ExternalVenueResult memory current = adapter.reconcileExternalAction(requestHash);
        assertEq(uint8(current.state), uint8(OperationalActionState.Recovering));
        assertEq(current.postconditionsHash, bytes32(0));
        assertEq(adapter.reservedBalance(address(collateral)), colAmount);
        assertEq(adapter.nativeReserved(), fee);
        assertFalse(adapter.getStoredRequest(requestHash).reservationReleased);
    }

    function test_FrozenBecomesRecovering() external {
        uint256 colAmount = 3 ether;
        uint256 fee = 0.1 ether;
        _fundCollateral(colAmount);
        _fundNative(fee);
        bytes32 actionHash = _stageIncrease(colAmount, fee);
        ExternalVenueRequest memory request = _request(actionHash);
        ExternalVenueResult memory submitted = adapter.submitExternalAction(request);
        bytes32 orderKey = submitted.venueActionReference;
        GmxV2EventTypes.EventLogData memory orderData = _boundOrderData(actionHash);
        vm.prank(address(orderHandler));
        adapter.afterOrderFrozen(orderKey, orderData, _emptyEventData());
        ExternalVenueRequest memory copy = request;
        bytes32 requestHash = OperationalAdapterLib.hashExternalRequest(copy);
        assertEq(uint8(adapter.reconcileExternalAction(requestHash).state), uint8(OperationalActionState.Recovering));
    }

    function test_RevertCallbackWhenUnauthorized() external {
        uint256 colAmount = 2 ether;
        uint256 fee = 0.1 ether;
        _fundCollateral(colAmount);
        _fundNative(fee);
        bytes32 actionHash = _stageIncrease(colAmount, fee);
        ExternalVenueRequest memory request = _request(actionHash);
        ExternalVenueResult memory submitted = adapter.submitExternalAction(request);
        GmxV2EventTypes.EventLogData memory orderData = _boundOrderData(actionHash);
        // ExchangeRouter is NOT the callback sender; only the OrderHandler is trusted.
        vm.prank(address(exchangeRouter));
        vm.expectRevert();
        adapter.afterOrderExecution(submitted.venueActionReference, orderData, _emptyEventData());
        vm.prank(makeAddr("stranger"));
        vm.expectRevert();
        adapter.afterOrderExecution(submitted.venueActionReference, orderData, _emptyEventData());
    }

    function test_RevertCallbackOnUnknownOrMismatchedOrder() external {
        uint256 colAmount = 2 ether;
        uint256 fee = 0.1 ether;
        _fundCollateral(colAmount);
        _fundNative(fee);
        bytes32 actionHash = _stageIncrease(colAmount, fee);
        ExternalVenueRequest memory request = _request(actionHash);
        ExternalVenueResult memory submitted = adapter.submitExternalAction(request);
        GmxV2EventTypes.EventLogData memory orderData = _boundOrderData(actionHash);
        bytes32 unknownKey = keccak256("unknown");
        vm.prank(address(orderHandler));
        vm.expectRevert(abi.encodeWithSelector(GmxV2OrderAdapter.UnknownOrder.selector, unknownKey));
        adapter.afterOrderExecution(unknownKey, orderData, _emptyEventData());
        orderData.addressItems.items[4].value = address(otherToken);
        vm.prank(address(orderHandler));
        vm.expectRevert(
            abi.encodeWithSelector(GmxV2OrderAdapter.OrderFieldMismatch.selector, submitted.venueActionReference)
        );
        adapter.afterOrderExecution(submitted.venueActionReference, orderData, _emptyEventData());
    }

    function test_RevertCallbackOnWrongCancellationReceiver() external {
        _fundCollateral(2 ether);
        _fundNative(0.1 ether);
        bytes32 actionHash = _stageIncrease(2 ether, 0.1 ether);
        ExternalVenueRequest memory request = _request(actionHash);
        ExternalVenueResult memory submitted = adapter.submitExternalAction(request);
        GmxV2EventTypes.EventLogData memory orderData = _boundOrderData(actionHash);
        orderData.addressItems.items[6].value = makeAddr("elsewhere");
        vm.prank(address(orderHandler));
        vm.expectRevert();
        adapter.afterOrderExecution(submitted.venueActionReference, orderData, _emptyEventData());
    }

    function test_RecoverTimeoutBoundariesAndTerminal() external {
        uint256 colAmount = 4 ether;
        uint256 fee = 0.1 ether;
        _fundCollateral(colAmount);
        _fundNative(fee);
        bytes32 actionHash = _stageIncrease(colAmount, fee);
        ExternalVenueRequest memory request = _request(actionHash);
        ExternalVenueResult memory submitted = adapter.submitExternalAction(request);
        bytes32 orderKey = submitted.venueActionReference;
        ExternalVenueRequest memory copy = request;
        bytes32 requestHash = OperationalAdapterLib.hashExternalRequest(copy);
        vm.expectRevert();
        adapter.recoverExternalAction(requestHash);
        vm.warp(request.timeoutAt);
        // Simulate keeper removal plus refunds: collateral back as ERC20, fee back as native.
        dataStore.removeOrder(orderKey);
        collateral.mint(address(adapter), colAmount);
        (bool ok,) = address(adapter).call{value: fee}("");
        assertTrue(ok);
        ExternalVenueResult memory recovered = adapter.recoverExternalAction(requestHash);
        assertTrue(
            recovered.state == OperationalActionState.Recovered || recovered.state == OperationalActionState.NoEffect
        );
        assertTrue(recovered.recoveryOutcomeHash != bytes32(0));
        assertEq(adapter.reservedBalance(address(collateral)), 0);
        assertEq(adapter.nativeReserved(), 0);
        assertEq(adapter.inventoriedBalance(address(collateral)), colAmount);
        assertEq(adapter.nativeInventoried(), fee);
        assertTrue(exchangeRouter.cancelledOrders(orderKey));
        vm.expectRevert(abi.encodeWithSelector(GmxV2OrderAdapter.NoRecoveryForTerminal.selector, requestHash));
        adapter.recoverExternalAction(requestHash);
        vm.warp(request.recoveryDeadline + 1);
        _fundCollateral(1 ether);
        _fundNative(1 ether);
        uint64 secondDeadline = uint64(request.recoveryDeadline + 3600);
        bytes32 secondAction = _stageIncreaseRaw(1 ether, 0.05 ether, secondDeadline);
        ExternalVenueRequest memory second = _request(secondAction);
        adapter.submitExternalAction(second);
        ExternalVenueRequest memory secondCopy = second;
        bytes32 secondHash = OperationalAdapterLib.hashExternalRequest(secondCopy);
        vm.expectRevert();
        adapter.recoverExternalAction(secondHash);
    }

    function test_RecoverPendingWhenOrderStillPresent() external {
        uint256 colAmount = 2 ether;
        uint256 fee = 0.1 ether;
        _fundCollateral(colAmount);
        _fundNative(fee);
        bytes32 actionHash = _stageIncrease(colAmount, fee);
        ExternalVenueRequest memory request = _request(actionHash);
        ExternalVenueResult memory submitted = adapter.submitExternalAction(request);
        ExternalVenueRequest memory copy = request;
        bytes32 requestHash = OperationalAdapterLib.hashExternalRequest(copy);
        vm.warp(request.timeoutAt);
        assertTrue(adapter.orderExists(submitted.venueActionReference));
        ExternalVenueResult memory pending = adapter.recoverExternalAction(requestHash);
        assertEq(uint8(pending.state), uint8(OperationalActionState.Recovering));
        assertTrue(exchangeRouter.cancelledOrders(submitted.venueActionReference));
        assertEq(adapter.nativeReserved(), fee);
    }

    function test_RecoverAfterCancellationReconcilesAndReleasesOnce() external {
        uint256 colAmount = 2 ether;
        uint256 fee = 0.1 ether;
        _fundCollateral(colAmount);
        _fundNative(fee);
        bytes32 actionHash = _stageIncrease(colAmount, fee);
        ExternalVenueRequest memory request = _request(actionHash);
        ExternalVenueResult memory submitted = adapter.submitExternalAction(request);
        bytes32 orderKey = submitted.venueActionReference;
        ExternalVenueRequest memory copy = request;
        bytes32 requestHash = OperationalAdapterLib.hashExternalRequest(copy);
        GmxV2EventTypes.EventLogData memory orderData = _boundOrderData(actionHash);
        vm.prank(address(orderHandler));
        adapter.afterOrderCancellation(orderKey, orderData, _emptyEventData());
        vm.warp(request.timeoutAt);
        dataStore.removeOrder(orderKey);
        collateral.mint(address(adapter), colAmount);
        (bool ok,) = address(adapter).call{value: fee}("");
        assertTrue(ok);
        ExternalVenueResult memory recovered = adapter.recoverExternalAction(requestHash);
        assertEq(uint8(recovered.state), uint8(OperationalActionState.Recovered));
        assertEq(adapter.reservedBalance(address(collateral)), 0);
        assertEq(adapter.nativeReserved(), 0);
        vm.expectRevert(abi.encodeWithSelector(GmxV2OrderAdapter.NoRecoveryForTerminal.selector, requestHash));
        adapter.recoverExternalAction(requestHash);
    }

    function test_RefundExecutionFeeAcceptsNativeFromOrderHandler() external {
        _fundNative(1 ether);
        bytes32 key = keccak256("refund-key");
        uint256 before = address(adapter).balance;
        vm.deal(address(orderHandler), 0.05 ether);
        vm.prank(address(orderHandler));
        adapter.refundExecutionFee{value: 0.05 ether}(key, _emptyEventData());
        assertEq(address(adapter).balance, before + 0.05 ether);
        vm.prank(makeAddr("stranger"));
        vm.expectRevert();
        adapter.refundExecutionFee(key, _emptyEventData());
    }

    function test_InexactNativeDeltaReverts() external {
        uint256 colAmount = 5 ether;
        uint256 fee = 0.2 ether;
        _fundCollateral(colAmount);
        _fundNative(fee);
        bytes32 actionHash = _stageIncrease(colAmount, fee);
        ExternalVenueRequest memory request = _request(actionHash);
        exchangeRouter.setShortNative(true);
        vm.expectRevert();
        adapter.submitExternalAction(request);
        exchangeRouter.setShortNative(false);
        assertFalse(adapter.getStagedAction(actionHash).consumed);
        assertEq(adapter.nativeReserved(), fee);
    }

    function test_InexactTokenDeltaReverts() external {
        uint256 colAmount = 5 ether;
        uint256 fee = 0.2 ether;
        _fundCollateral(colAmount);
        _fundNative(fee);
        bytes32 actionHash = _stageIncrease(colAmount, fee);
        ExternalVenueRequest memory request = _request(actionHash);
        exchangeRouter.setShortCollateral(true);
        vm.expectRevert();
        adapter.submitExternalAction(request);
        exchangeRouter.setShortCollateral(false);
        assertFalse(adapter.getStagedAction(actionHash).consumed);
        assertEq(adapter.reservedBalance(address(collateral)), colAmount);
    }

    function test_CancelReleasesOnlyUnconsumed() external {
        _fundCollateral(5 ether);
        _fundNative(1 ether);
        bytes32 actionHash = _stageIncrease(5 ether, 1 ether);
        assertEq(adapter.reservedBalance(address(collateral)), 5 ether);
        assertEq(adapter.nativeReserved(), 1 ether);
        adapter.cancelStagedAction(actionHash);
        assertEq(adapter.reservedBalance(address(collateral)), 0);
        assertEq(adapter.nativeReserved(), 0);
        ExternalVenueRequest memory request = _request(actionHash);
        vm.expectRevert();
        adapter.submitExternalAction(request);
    }

    function test_WithdrawLimitedToUnreserved() external {
        _fundCollateral(10 ether);
        _fundNative(10 ether);
        _stageIncrease(6 ether, 1 ether);
        address recipient = makeAddr("recipient");
        vm.expectRevert();
        adapter.withdrawInventory(address(collateral), 5 ether, recipient);
        adapter.withdrawInventory(address(collateral), 4 ether, recipient);
        assertEq(collateral.balanceOf(recipient), 4 ether);
        vm.expectRevert();
        adapter.withdrawNativeInventory(10 ether, recipient);
        adapter.withdrawNativeInventory(9 ether, recipient);
        assertEq(recipient.balance, 9 ether);
    }

    function test_RevertOnBadAsyncBoundsAndFallback() external {
        _fundCollateral(2 ether);
        _fundNative(1 ether);
        bytes32 actionHash = _stageIncrease(2 ether, 0.1 ether);
        ExternalVenueRequest memory bad = _request(actionHash);
        bad.guaranteeClass = ExecutionGuaranteeClass.AtomicSameDomain;
        vm.expectRevert(GmxV2OrderAdapter.UnsupportedGuaranteeClass.selector);
        adapter.submitExternalAction(bad);
        ExternalVenueRequest memory bad2 = _request(actionHash);
        bad2.interimExposureOwner = AccountId.wrap(bytes32(0));
        vm.expectRevert(GmxV2OrderAdapter.InvalidAsyncBounds.selector);
        adapter.submitExternalAction(bad2);
        ExternalVenueRequest memory bad3 = _request(actionHash);
        bad3.terminalFallback.state = OperationalActionState.Complete;
        vm.expectRevert(GmxV2OrderAdapter.InvalidTerminalFallback.selector);
        adapter.submitExternalAction(bad3);
    }

    function test_SwapStagingAndRealizedIsCollateral() external {
        uint256 colAmount = 7 ether;
        uint256 fee = 0.1 ether;
        _fundCollateral(colAmount);
        _fundNative(fee);
        address[] memory path = new address[](2);
        path[0] = address(market);
        // Swap paths are market addresses; the mock reader target doubles as a market hop here.
        MockCodeTarget hop = new MockCodeTarget();
        path[1] = address(hop);
        bytes32 policy = keccak256("swap-recovery");
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 actionHash = adapter.stageOrder(
            GmxV2OrderAdapter.GmxV2StageOrderInputs({
                kind: GmxV2OrderAdapter.GmxV2OrderKind.Swap,
                market: address(0),
                initialCollateralToken: address(collateral),
                swapPath: path,
                receiver: address(this),
                uiFeeReceiver: address(this),
                sizeDeltaUsd: 0,
                initialCollateralDeltaAmount: colAmount,
                triggerPrice: 0,
                acceptablePrice: 0,
                executionFee: fee,
                orderType: 0,
                isLong: true,
                shouldUnwrapNativeToken: false,
                referralCode: bytes32(0),
                deadline: deadline,
                recoveryPolicyHash: policy
            })
        );
        ExternalVenueRequest memory request = _requestFor(actionHash, int256(colAmount) - int256(1), int256(colAmount));
        ExternalVenueResult memory submitted = adapter.submitExternalAction(request);
        assertEq(exchangeRouter.lastCallsLength(), 3);
        GmxV2EventTypes.EventLogData memory orderData = _boundOrderData(actionHash);
        vm.prank(address(orderHandler));
        adapter.afterOrderExecution(submitted.venueActionReference, orderData, _emptyEventData());
        ExternalVenueRequest memory copy = request;
        bytes32 requestHash = OperationalAdapterLib.hashExternalRequest(copy);
        assertEq(adapter.reconcileExternalAction(requestHash).realizedValue, int256(colAmount));
    }

    function test_ExpectedPostconditionsPrecomputable() external view {
        bytes32 fakePath = keccak256("path");
        GmxV2OrderAdapter.GmxV2ActionHashInputs memory hashInputs = GmxV2OrderAdapter.GmxV2ActionHashInputs({
            kind: uint8(GmxV2OrderAdapter.GmxV2OrderKind.Increase),
            market: address(market),
            initialCollateralToken: address(collateral),
            swapPathHash: fakePath,
            receiver: address(this),
            uiFeeReceiver: address(this),
            sizeDeltaUsd: 10 ether,
            initialCollateralDeltaAmount: 5 ether,
            triggerPrice: 0,
            acceptablePrice: 1,
            executionFee: 0.1 ether,
            orderType: 2,
            isLong: true,
            shouldUnwrapNativeToken: false,
            referralCode: bytes32(0),
            deadline: uint64(999_999_999),
            recoveryPolicyHash: keccak256("recovery")
        });
        bytes32 action = adapter.hashStagedAction(hashInputs);
        GmxV2OrderAdapter.GmxV2PostconditionsInputs memory postInputs = GmxV2OrderAdapter.GmxV2PostconditionsInputs({
            actionHash: action,
            market: address(market),
            initialCollateralToken: address(collateral),
            swapPathHash: fakePath,
            receiver: address(this),
            sizeDeltaUsd: 10 ether,
            initialCollateralDeltaAmount: 5 ether,
            triggerPrice: 0,
            acceptablePrice: 1,
            executionFee: 0.1 ether,
            orderType: 2,
            isLong: true,
            shouldUnwrapNativeToken: false,
            deadline: uint64(999_999_999),
            recoveryPolicyHash: keccak256("recovery")
        });
        bytes32 first = adapter.hashExpectedPostconditions(postInputs);
        bytes32 second = adapter.hashExpectedPostconditions(postInputs);
        assertEq(first, second);
        assertTrue(first != bytes32(0));
    }

    function _fundCollateral(uint256 amount) private {
        collateral.transfer(address(adapter), amount);
        adapter.syncInventory(address(collateral));
    }

    function _fundNative(uint256 amount) private {
        adapter.fundNativeExecutionInventory{value: amount}();
    }

    function _stripSelector(bytes memory data) private pure returns (bytes memory out) {
        require(data.length >= 4, "short calldata");
        out = new bytes(data.length - 4);
        for (uint256 i = 0; i < out.length; i++) {
            out[i] = data[i + 4];
        }
    }

    function _copy(ExternalVenueRequest memory request) private pure returns (ExternalVenueRequest memory) {
        return request;
    }

    function _stageIncrease(uint256 colAmount, uint256 fee) private returns (bytes32) {
        return _stageIncreaseWithSize(colAmount, fee, 50 ether);
    }

    function _stageIncreaseWithSize(uint256 colAmount, uint256 fee, uint256 size) private returns (bytes32) {
        uint64 deadline = uint64(block.timestamp + 1 hours);
        address[] memory path = new address[](0);
        return adapter.stageOrder(
            GmxV2OrderAdapter.GmxV2StageOrderInputs({
                kind: GmxV2OrderAdapter.GmxV2OrderKind.Increase,
                market: address(market),
                initialCollateralToken: address(collateral),
                swapPath: path,
                receiver: address(this),
                uiFeeReceiver: address(this),
                sizeDeltaUsd: size,
                initialCollateralDeltaAmount: colAmount,
                triggerPrice: 0,
                acceptablePrice: 1,
                executionFee: fee,
                orderType: 2,
                isLong: true,
                shouldUnwrapNativeToken: false,
                referralCode: bytes32(uint256(7)),
                deadline: deadline,
                recoveryPolicyHash: keccak256("recovery-policy")
            })
        );
    }

    function _stageDecrease(uint256 collateralDelta, uint256 fee) private returns (bytes32) {
        return _stageDecreaseWithSize(collateralDelta, fee, 50 ether);
    }

    function _stageDecreaseWithSize(uint256 collateralDelta, uint256 fee, uint256 size) private returns (bytes32) {
        uint64 deadline = uint64(block.timestamp + 1 hours);
        address[] memory path = new address[](0);
        return adapter.stageOrder(
            GmxV2OrderAdapter.GmxV2StageOrderInputs({
                kind: GmxV2OrderAdapter.GmxV2OrderKind.Decrease,
                market: address(market),
                initialCollateralToken: address(collateral),
                swapPath: path,
                receiver: address(this),
                uiFeeReceiver: address(this),
                sizeDeltaUsd: size,
                initialCollateralDeltaAmount: collateralDelta,
                triggerPrice: 0,
                acceptablePrice: 1,
                executionFee: fee,
                orderType: 4,
                isLong: true,
                shouldUnwrapNativeToken: false,
                referralCode: bytes32(0),
                deadline: deadline,
                recoveryPolicyHash: keccak256("recovery-policy")
            })
        );
    }

    function _stageIncreaseRaw(uint256 colAmount, uint256 fee, uint64 deadline) private returns (bytes32) {
        address[] memory path = new address[](0);
        return adapter.stageOrder(
            GmxV2OrderAdapter.GmxV2StageOrderInputs({
                kind: GmxV2OrderAdapter.GmxV2OrderKind.Increase,
                market: address(market),
                initialCollateralToken: address(collateral),
                swapPath: path,
                receiver: address(this),
                uiFeeReceiver: address(this),
                sizeDeltaUsd: 10 ether,
                initialCollateralDeltaAmount: colAmount,
                triggerPrice: 0,
                acceptablePrice: 1,
                executionFee: fee,
                orderType: 2,
                isLong: true,
                shouldUnwrapNativeToken: false,
                referralCode: bytes32(0),
                deadline: deadline,
                recoveryPolicyHash: keccak256("recovery-2")
            })
        );
    }

    function _request(bytes32 actionHash) private view returns (ExternalVenueRequest memory) {
        GmxV2OrderAdapter.StagedGmxV2Order memory staged = adapter.getStagedAction(actionHash);
        int256 realized = int256(staged.sizeDeltaUsd);
        return _requestFor(
            actionHash,
            realized - int256(1 ether) < 0 ? int256(0) : realized - int256(1 ether),
            realized + int256(100 ether)
        );
    }

    function _requestFor(bytes32 actionHash, int256 minValue, int256 maxValue)
        private
        view
        returns (ExternalVenueRequest memory)
    {
        GmxV2OrderAdapter.StagedGmxV2Order memory staged = adapter.getStagedAction(actionHash);
        GmxV2OrderAdapter.GmxV2PostconditionsInputs memory postInputs = GmxV2OrderAdapter.GmxV2PostconditionsInputs({
            actionHash: actionHash,
            market: staged.market,
            initialCollateralToken: staged.initialCollateralToken,
            swapPathHash: staged.swapPathHash,
            receiver: staged.receiver,
            sizeDeltaUsd: staged.sizeDeltaUsd,
            initialCollateralDeltaAmount: staged.initialCollateralDeltaAmount,
            triggerPrice: staged.triggerPrice,
            acceptablePrice: staged.acceptablePrice,
            executionFee: staged.executionFee,
            orderType: staged.orderType,
            isLong: staged.isLong,
            shouldUnwrapNativeToken: staged.shouldUnwrapNativeToken,
            deadline: staged.deadline,
            recoveryPolicyHash: staged.recoveryPolicyHash
        });
        bytes32 expected = adapter.hashExpectedPostconditions(postInputs);
        OperationalBinding memory binding = OperationalBinding({
            chainId: block.chainid,
            deploymentId: keccak256("deployment"),
            accountId: AccountId.wrap(keccak256("account")),
            marketId: MarketId.wrap(keccak256("market")),
            seriesId: SeriesId.wrap(keccak256("series")),
            seriesVersion: 1,
            packageId: PackageId.wrap(keccak256("package")),
            packageVersion: 1,
            actionHash: actionHash,
            nonce: 1,
            deadline: staged.deadline,
            minValue: minValue,
            maxValue: maxValue,
            recipientPolicyHash: staged.recoveryPolicyHash,
            expectedPostconditionsHash: expected
        });
        int256 terminalRealized = minValue;
        if (staged.kind == GmxV2OrderAdapter.GmxV2OrderKind.Swap) {
            terminalRealized = int256(staged.initialCollateralDeltaAmount);
        } else {
            terminalRealized = int256(staged.sizeDeltaUsd);
        }
        if (terminalRealized < minValue) terminalRealized = minValue;
        if (terminalRealized > maxValue) terminalRealized = minValue;
        return ExternalVenueRequest({
            binding: binding,
            guaranteeClass: ExecutionGuaranteeClass.BoundedAsync,
            timeoutAt: staged.deadline + 1,
            recoveryDeadline: staged.deadline + 1 days,
            interimExposureOwner: AccountId.wrap(keccak256("solver")),
            recoveryPolicyHash: staged.recoveryPolicyHash,
            reservationHash: keccak256("reservation"),
            maximumResidual: 0,
            terminalFallback: ExternalTerminalFallback({
                state: OperationalActionState.Recovered,
                realizedValue: terminalRealized,
                residualValue: 0,
                postconditionsHash: expected,
                outcomeHash: keccak256("terminal-outcome")
            })
        });
    }

    /// @notice Builds the exact canonical OrderEventUtils.createEventData payload for a staged order.
    function _boundOrderData(bytes32 actionHash) private view returns (GmxV2EventTypes.EventLogData memory orderData) {
        GmxV2OrderAdapter.StagedGmxV2Order memory staged = adapter.getStagedAction(actionHash);
        orderData.addressItems.items = new GmxV2EventTypes.AddressKeyValue[](7);
        orderData.addressItems.items[0] = GmxV2EventTypes.AddressKeyValue({key: "account", value: address(adapter)});
        orderData.addressItems.items[1] = GmxV2EventTypes.AddressKeyValue({key: "receiver", value: staged.receiver});
        orderData.addressItems.items[2] =
            GmxV2EventTypes.AddressKeyValue({key: "callbackContract", value: address(adapter)});
        orderData.addressItems.items[3] =
            GmxV2EventTypes.AddressKeyValue({key: "uiFeeReceiver", value: staged.uiFeeReceiver});
        orderData.addressItems.items[4] = GmxV2EventTypes.AddressKeyValue({key: "market", value: staged.market});
        orderData.addressItems.items[5] =
            GmxV2EventTypes.AddressKeyValue({key: "initialCollateralToken", value: staged.initialCollateralToken});
        orderData.addressItems.items[6] =
            GmxV2EventTypes.AddressKeyValue({key: "cancellationReceiver", value: address(adapter)});
        orderData.addressItems.arrayItems = new GmxV2EventTypes.AddressArrayKeyValue[](1);
        orderData.addressItems.arrayItems[0] =
            GmxV2EventTypes.AddressArrayKeyValue({key: "swapPath", value: staged.swapPath});

        orderData.uintItems.items = new GmxV2EventTypes.UintKeyValue[](12);
        orderData.uintItems.items[0] = GmxV2EventTypes.UintKeyValue({key: "orderType", value: staged.orderType});
        orderData.uintItems.items[1] = GmxV2EventTypes.UintKeyValue({key: "decreasePositionSwapType", value: 0});
        orderData.uintItems.items[2] = GmxV2EventTypes.UintKeyValue({key: "sizeDeltaUsd", value: staged.sizeDeltaUsd});
        orderData.uintItems.items[3] = GmxV2EventTypes.UintKeyValue({
            key: "initialCollateralDeltaAmount", value: staged.initialCollateralDeltaAmount
        });
        orderData.uintItems.items[4] = GmxV2EventTypes.UintKeyValue({key: "triggerPrice", value: staged.triggerPrice});
        orderData.uintItems.items[5] =
            GmxV2EventTypes.UintKeyValue({key: "acceptablePrice", value: staged.acceptablePrice});
        orderData.uintItems.items[6] = GmxV2EventTypes.UintKeyValue({key: "executionFee", value: staged.executionFee});
        orderData.uintItems.items[7] = GmxV2EventTypes.UintKeyValue({key: "callbackGasLimit", value: CALLBACK_GAS});
        orderData.uintItems.items[8] = GmxV2EventTypes.UintKeyValue({key: "minOutputAmount", value: 0});
        orderData.uintItems.items[9] = GmxV2EventTypes.UintKeyValue({key: "updatedAtTime", value: block.timestamp});
        orderData.uintItems.items[10] = GmxV2EventTypes.UintKeyValue({key: "validFromTime", value: 0});
        orderData.uintItems.items[11] = GmxV2EventTypes.UintKeyValue({key: "srcChainId", value: 0});

        orderData.boolItems.items = new GmxV2EventTypes.BoolKeyValue[](3);
        orderData.boolItems.items[0] = GmxV2EventTypes.BoolKeyValue({key: "isLong", value: staged.isLong});
        orderData.boolItems.items[1] =
            GmxV2EventTypes.BoolKeyValue({key: "shouldUnwrapNativeToken", value: staged.shouldUnwrapNativeToken});
        orderData.boolItems.items[2] = GmxV2EventTypes.BoolKeyValue({key: "autoCancel", value: false});

        orderData.bytes32Items.arrayItems = new GmxV2EventTypes.Bytes32ArrayKeyValue[](1);
        bytes32[] memory emptyList = new bytes32[](0);
        orderData.bytes32Items.arrayItems[0] = GmxV2EventTypes.Bytes32ArrayKeyValue({key: "dataList", value: emptyList});
    }

    function _emptyEventData() private pure returns (GmxV2EventTypes.EventLogData memory eventData) {
        eventData.addressItems.items = new GmxV2EventTypes.AddressKeyValue[](0);
        eventData.addressItems.arrayItems = new GmxV2EventTypes.AddressArrayKeyValue[](0);
        eventData.uintItems.items = new GmxV2EventTypes.UintKeyValue[](0);
        eventData.uintItems.arrayItems = new GmxV2EventTypes.UintArrayKeyValue[](0);
        eventData.intItems.items = new GmxV2EventTypes.IntKeyValue[](0);
        eventData.intItems.arrayItems = new GmxV2EventTypes.IntArrayKeyValue[](0);
        eventData.boolItems.items = new GmxV2EventTypes.BoolKeyValue[](0);
        eventData.boolItems.arrayItems = new GmxV2EventTypes.BoolArrayKeyValue[](0);
        eventData.bytes32Items.items = new GmxV2EventTypes.Bytes32KeyValue[](0);
        eventData.bytes32Items.arrayItems = new GmxV2EventTypes.Bytes32ArrayKeyValue[](0);
        eventData.bytesItems.items = new GmxV2EventTypes.BytesKeyValue[](0);
        eventData.bytesItems.arrayItems = new GmxV2EventTypes.BytesArrayKeyValue[](0);
        eventData.stringItems.items = new GmxV2EventTypes.StringKeyValue[](0);
        eventData.stringItems.arrayItems = new GmxV2EventTypes.StringArrayKeyValue[](0);
    }
}
