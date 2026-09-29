// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IExternalVenueExecutionAdapterV1} from "../../interfaces/IOperationalAdapters.sol";
import {OperationalAdapterLib} from "../../libraries/OperationalAdapterLib.sol";
import {AccountId, MarketId, PackageId, SeriesId} from "../../types/Identifiers.sol";
import {
    AdapterRuntimeDescriptor,
    ExecutionGuaranteeClass,
    ExternalVenueRequest,
    ExternalVenueResult,
    OperationalActionState,
    OperationalBinding
} from "../../types/OperationalAdapterTypes.sol";

/// @notice Exact GMX V2 Market.Props surface (four addresses).
struct GmxV2MarketProps {
    address marketToken;
    address indexToken;
    address longToken;
    address shortToken;
}

/// @notice Exact GMX V2 CreateOrderParams address surface (IBaseOrderUtils.CreateOrderParamsAddresses).
struct GmxV2CreateOrderParamsAddresses {
    address receiver;
    address cancellationReceiver;
    address callbackContract;
    address uiFeeReceiver;
    address market;
    address initialCollateralToken;
    address[] swapPath;
}

/// @notice Exact GMX V2 CreateOrderParams number surface (IBaseOrderUtils.CreateOrderParamsNumbers).
struct GmxV2CreateOrderParamsNumbers {
    uint256 sizeDeltaUsd;
    uint256 initialCollateralDeltaAmount;
    uint256 triggerPrice;
    uint256 acceptablePrice;
    uint256 executionFee;
    uint256 callbackGasLimit;
    uint256 minOutputAmount;
    uint256 validFromTime;
}

/// @notice Exact GMX V2 CreateOrderParams surface (IBaseOrderUtils.CreateOrderParams).
/// @dev Enums are uint8-backed on the wire; the adapter uses uint8 for the same ABI.
struct GmxV2CreateOrderParams {
    GmxV2CreateOrderParamsAddresses addresses;
    GmxV2CreateOrderParamsNumbers numbers;
    uint8 orderType;
    uint8 decreasePositionSwapType;
    bool isLong;
    bool shouldUnwrapNativeToken;
    bool autoCancel;
    bytes32 referralCode;
    bytes32[] dataList;
}

/// @notice Exact GMX V2 EventUtils.EventLogData nested ABI surface.
/// @dev Field names, shapes, and nesting mirror contracts/event/EventUtils.sol exactly so that
///      callback payloads decode with the production ABI. The adapter never iterates an
///      unbounded nested array or hashes unbounded dynamic bytes/string without a prior bound.
library GmxV2EventTypes {
    struct AddressKeyValue {
        string key;
        address value;
    }

    struct AddressArrayKeyValue {
        string key;
        address[] value;
    }

    struct AddressItems {
        AddressKeyValue[] items;
        AddressArrayKeyValue[] arrayItems;
    }

    struct UintKeyValue {
        string key;
        uint256 value;
    }

    struct UintArrayKeyValue {
        string key;
        uint256[] value;
    }

    struct UintItems {
        UintKeyValue[] items;
        UintArrayKeyValue[] arrayItems;
    }

    struct IntKeyValue {
        string key;
        int256 value;
    }

    struct IntArrayKeyValue {
        string key;
        int256[] value;
    }

    struct IntItems {
        IntKeyValue[] items;
        IntArrayKeyValue[] arrayItems;
    }

    struct BoolKeyValue {
        string key;
        bool value;
    }

    struct BoolArrayKeyValue {
        string key;
        bool[] value;
    }

    struct BoolItems {
        BoolKeyValue[] items;
        BoolArrayKeyValue[] arrayItems;
    }

    struct Bytes32KeyValue {
        string key;
        bytes32 value;
    }

    struct Bytes32ArrayKeyValue {
        string key;
        bytes32[] value;
    }

    struct Bytes32Items {
        Bytes32KeyValue[] items;
        Bytes32ArrayKeyValue[] arrayItems;
    }

    struct BytesKeyValue {
        string key;
        bytes value;
    }

    struct BytesArrayKeyValue {
        string key;
        bytes[] value;
    }

    struct BytesItems {
        BytesKeyValue[] items;
        BytesArrayKeyValue[] arrayItems;
    }

    struct StringKeyValue {
        string key;
        string value;
    }

    struct StringArrayKeyValue {
        string key;
        string[] value;
    }

    struct StringItems {
        StringKeyValue[] items;
        StringArrayKeyValue[] arrayItems;
    }

    struct EventLogData {
        AddressItems addressItems;
        UintItems uintItems;
        IntItems intItems;
        BoolItems boolItems;
        Bytes32Items bytes32Items;
        BytesItems bytesItems;
        StringItems stringItems;
    }
}

/// @notice Exact official GMX V2 ExchangeRouter surface used by this adapter.
interface IGmxV2ExchangeRouter {
    function multicall(bytes[] calldata data) external payable returns (bytes[] memory results);
    function sendWnt(address receiver, uint256 amount) external payable;
    function sendTokens(address token, address receiver, uint256 amount) external;
    function createOrder(GmxV2CreateOrderParams calldata params) external payable returns (bytes32);
    function cancelOrder(bytes32 key) external payable;
}

/// @notice Exact official GMX V2 Router plugin surface used by this adapter.
/// @dev Users approve this Router; ExchangeRouter.sendTokens pulls via pluginTransfer.
interface IGmxV2Router {
    function pluginTransfer(address token, address account, address receiver, uint256 amount) external;
}

/// @notice Minimal official GMX V2 DataStore surface used by this adapter.
/// @dev Pending-order existence is read via containsBytes32 on the canonical ORDER_LIST set,
///      exactly as OrderStoreUtils does. No Reader.getOrder subset is used.
interface IGmxV2DataStore {
    function containsBytes32(bytes32 setKey, bytes32 value) external view returns (bool);
}

/// @notice Exact official GMX V2 Reader market surface used by this adapter.
interface IGmxV2Reader {
    function getMarket(address dataStore, address marketKey) external view returns (GmxV2MarketProps memory);
}

/// @notice Solver-funded GMX V2 bounded-asynchronous order adapter.
/// @dev Binds one chain, one exact ExchangeRouter, one exact Router token-transfer target,
///      one exact OrderVault fee/collateral receiver, one exact OrderHandler callback sender,
///      one exact DataStore, one exact Reader, one pinned WNT reference, one exact executor
///      caller, one delayed admin, one action stager, one inventory manager, and one callback
///      gas limit. Supports only staged canonical increase / decrease / swap orders.
///
///      Execution fees are native ETH, never WNT ERC20: the adapter holds an explicit native
///      inventory with reservations, funds it through a restricted payable entrypoint, accepts
///      GMX native refunds through a silent receive policy (GMX forwards a small fixed gas
///      stipend on native sends, so receive carries no logic), and forwards the exact fee as
///      multicall value so ExchangeRouter.sendWnt can wrap it into WNT for the OrderVault.
///
///      Collateral approvals target only the exact Router plugin; collateral and wrapped fee
///      are sent only to the exact OrderVault. Increase and swap orders move collateral in a
///      three-leg multicall (sendWnt, sendTokens, createOrder); decrease orders never transfer
///      or reserve collateral because initialCollateralDeltaAmount is withdrawal intent, so
///      they use a two-leg multicall (sendWnt, createOrder). Router allowance is cleared and
///      verified after every submission.
///
///      GMX treats adapter callbacks as best effort (try/catch at the OrderHandler), so
///      cancellation and recovery never assume a callback fired: recovery confirms order
///      absence via DataStore.containsBytes32 on ORDER_LIST, reconciles live ERC20 collateral
///      plus live native fee balances, releases each reservation exactly once, and only then
///      applies the precommitted terminal fallback. Execution becomes Complete only after
///      exact authenticated orderData binding plus a nonzero evidence commitment over bounded
///      order and event data; the adapter never invents an execution price (realized tracks
///      the authenticated staged delta, not a fill price).
contract GmxV2OrderAdapter is IExternalVenueExecutionAdapterV1, AccessControlDefaultAdminRules, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant ACTION_STAGER_ROLE = keccak256("SETRYN_GMX_V2_STAGER_ROLE");
    bytes32 public constant INVENTORY_MANAGER_ROLE = keccak256("SETRYN_GMX_V2_INVENTORY_MANAGER_ROLE");

    /// @notice Canonical DataStore order set, identical to Keys.ORDER_LIST.
    bytes32 public constant ORDER_LIST = keccak256(abi.encode("ORDER_LIST"));

    uint8 public constant MARKET_SWAP = 0;
    uint8 public constant LIMIT_SWAP = 1;
    uint8 public constant MARKET_INCREASE = 2;
    uint8 public constant LIMIT_INCREASE = 3;
    uint8 public constant MARKET_DECREASE = 4;
    uint8 public constant LIMIT_DECREASE = 5;
    uint8 public constant STOP_LOSS_DECREASE = 6;
    uint8 public constant STOP_INCREASE = 8;

    uint8 public constant NO_SWAP = 0;

    uint256 public constant MAX_SWAP_PATH_LENGTH = 5;
    uint256 public constant MAX_EVENT_ITEMS = 64;
    uint256 public constant MAX_EVENT_ARRAY_ITEMS = 16;
    uint256 public constant MAX_EVENT_ARRAY_ELEMENTS = 128;
    uint256 public constant MAX_EVENT_BYTES = 2_048;

    enum GmxV2OrderKind {
        Increase,
        Decrease,
        Swap
    }

    struct StagedGmxV2Order {
        GmxV2OrderKind kind;
        address market;
        address initialCollateralToken;
        address[] swapPath;
        bytes32 swapPathHash;
        address receiver;
        address uiFeeReceiver;
        uint256 sizeDeltaUsd;
        uint256 initialCollateralDeltaAmount;
        uint256 triggerPrice;
        uint256 acceptablePrice;
        uint256 executionFee;
        uint8 orderType;
        bool isLong;
        bool shouldUnwrapNativeToken;
        bytes32 referralCode;
        uint64 deadline;
        bytes32 recoveryPolicyHash;
        bool consumed;
        bool cancelled;
    }

    struct StoredGmxV2Request {
        bytes32 actionHash;
        GmxV2OrderKind kind;
        bytes32 orderKey;
        address market;
        address initialCollateralToken;
        uint256 collateralAmount;
        uint256 executionFee;
        uint256 sizeDeltaUsd;
        uint64 timeoutAt;
        uint64 recoveryDeadline;
        bytes32 expectedPostconditionsHash;
        int256 minValue;
        int256 maxValue;
        uint256 maximumResidual;
        bytes32 recoveryPolicyHash;
        bool reservationReleased;
        OperationalActionState terminalState;
        int256 terminalRealized;
        int256 terminalResidual;
        bytes32 terminalPostconditions;
        bytes32 terminalOutcome;
    }

    uint256 public immutable expectedChainId;
    IGmxV2ExchangeRouter public immutable exchangeRouter;
    address public immutable tokenTransferRouter;
    address public immutable orderVault;
    address public immutable orderHandler;
    IGmxV2DataStore public immutable dataStore;
    IGmxV2Reader public immutable reader;
    address public immutable wnt;
    address public immutable executor;
    uint256 public immutable callbackGasLimit;

    mapping(bytes32 actionHash => StagedGmxV2Order staged) private _staged;
    mapping(address token => uint256 inventoried) private _inventory;
    mapping(address token => uint256 reserved) private _reserved;
    uint256 private _nativeInventoried;
    uint256 private _nativeReserved;
    mapping(bytes32 requestHash => StoredGmxV2Request stored) private _requests;
    mapping(bytes32 requestHash => ExternalVenueResult result) private _results;
    mapping(bytes32 requestHash => bool storedResult) private _resultStored;
    mapping(bytes32 orderKey => bytes32 requestHash) private _orderToRequest;

    event GmxV2OrderStaged(bytes32 indexed actionHash, address indexed market, address indexed collateralToken);
    event GmxV2StagedCancelled(bytes32 indexed actionHash);
    event GmxV2InventorySynced(address indexed token, uint256 inventoried);
    event GmxV2InventoryWithdrawn(address indexed token, address indexed recipient, uint256 amount);
    event GmxV2NativeInventoryFunded(address indexed funder, uint256 amount, uint256 inventoried);
    event GmxV2NativeInventorySynced(uint256 inventoried);
    event GmxV2NativeInventoryWithdrawn(address indexed recipient, uint256 amount);
    event GmxV2ExecutionFeeRefunded(bytes32 indexed orderKey, uint256 amount);
    event GmxV2OrderSubmitted(bytes32 indexed requestHash, bytes32 indexed actionHash, bytes32 indexed orderKey);
    event GmxV2OrderExecuted(bytes32 indexed requestHash, bytes32 indexed orderKey, int256 realizedValue);
    event GmxV2OrderCancelled(bytes32 indexed requestHash, bytes32 indexed orderKey);
    event GmxV2OrderFrozen(bytes32 indexed requestHash, bytes32 indexed orderKey);
    event GmxV2OrderRecovered(bytes32 indexed requestHash, bytes32 indexed orderKey, uint8 state);

    error WrongDeploymentChain(uint256 expectedChainId, uint256 actualChainId);
    error ZeroExchangeRouter();
    error ExchangeRouterWithoutCode(address router);
    error ZeroTokenTransferRouter();
    error TokenTransferRouterWithoutCode(address router);
    error ZeroOrderVault();
    error OrderVaultWithoutCode(address vault);
    error ZeroOrderHandler();
    error OrderHandlerWithoutCode(address handler);
    error ZeroDataStore();
    error DataStoreWithoutCode(address store);
    error ZeroReader();
    error ReaderWithoutCode(address reader_);
    error ZeroWnt();
    error WntWithoutCode(address wnt_);
    error ZeroExecutor();
    error ExecutorWithoutCode(address executor_);
    error ZeroActionStager();
    error ZeroInventoryManager();
    error ZeroInitialAdmin();
    error ZeroCallbackGasLimit();
    error ZeroMarket();
    error MarketWithoutCode(address market);
    error UnexpectedMarketForSwap(address market);
    error EmptySwapPath();
    error ZeroCollateralToken();
    error CollateralWithoutCode(address token);
    error ZeroReceiver();
    error ZeroCollateralAmount();
    error ZeroSizeDelta();
    error NonzeroSizeForSwap();
    error ZeroExecutionFee();
    error InvalidOrderTypeForKind(uint8 orderType, uint8 kind);
    error UnknownOrderType(uint8 orderType);
    error LimitOrderMissingTrigger(uint8 orderType);
    error SwapPathTooLong(uint256 length);
    error SwapPathTokenWithoutCode(address token);
    error ZeroRecoveryPolicyHash();
    error ActionExpired(uint64 deadline, uint256 timestamp);
    error DuplicateAction(bytes32 actionHash);
    error OverReserved(address token, uint256 requested, uint256 inventoried, uint256 reserved);
    error NativeOverReserved(uint256 requested, uint256 inventoried, uint256 reserved);
    error UnknownStagedAction(bytes32 actionHash);
    error ActionCancelled(bytes32 actionHash);
    error ActionAlreadyConsumed(bytes32 actionHash);
    error ActionHashMismatch(bytes32 expected, bytes32 actual);
    error RecoveryPolicyMismatch(bytes32 expected, bytes32 actual);
    error ExpectedPostconditionsMismatch(bytes32 expected, bytes32 actual);
    error BindingDeadlineMismatch(uint64 bindingDeadline, uint64 stagedDeadline);
    error OnlyExecutor(address caller, address expected);
    error UnsupportedGuaranteeClass();
    error InvalidAsyncBounds();
    error BindingChainMismatch(uint256 bindingChainId, uint256 actualChainId);
    error BindingExpired(uint64 deadline, uint256 timestamp);
    error InvalidBinding();
    error RequestAlreadySubmitted(bytes32 requestHash);
    error UnknownRequest(bytes32 requestHash);
    error UnknownOrder(bytes32 orderKey);
    error InsufficientInventory(address token, uint256 balance, uint256 required);
    error InsufficientNativeFee(uint256 balance, uint256 required);
    error InexactTokenDelta(address token, uint256 expected, uint256 actual);
    error InexactNativeDelta(uint256 expected, uint256 actual);
    error AllowanceNotCleared(address token, uint256 allowance);
    error MulticallArityMismatch(uint256 expected, uint256 actual);
    error ZeroOrderKey();
    error UnauthorizedCallback(address caller, address expected);
    error AccountMismatch(address expected, address actual);
    error CallbackContractMismatch(address expected, address actual);
    error CancellationReceiverMismatch(address expected, address actual);
    error InvalidOrderData(bytes32 orderKey);
    error OrderFieldMismatch(bytes32 orderKey);
    error RealizedValueOutOfRange(int256 realized, int256 minValue, int256 maxValue);
    error RealizedOverflow(uint256 value);
    error OrderAlreadyResolved(bytes32 orderKey);
    error OrderStillPending(bytes32 orderKey);
    error RecoveryNotAvailable(uint64 timeoutAt, uint64 recoveryDeadline, uint256 timestamp);
    error ZeroEvidenceCommitment();
    error InvalidTerminalFallback();
    error MaximumResidualExceeded(uint256 residual, uint256 maximum);
    error InsufficientUnreserved(address token, uint256 requested, uint256 unreserved);
    error InsufficientBalance(address token, uint256 balance, uint256 requested);
    error InsufficientNativeUnreserved(uint256 requested, uint256 unreserved);
    error InsufficientNativeBalance(uint256 balance, uint256 requested);
    error ZeroNativeFunding();
    error ZeroNativeAmount();
    error NativeTransferFailed(address recipient, uint256 amount);
    error ReservationAlreadyReleased(bytes32 requestHash);
    error EventDataOutOfBounds();
    error NotAuthorizedToCancel(address caller);
    error MarketMembershipMismatch(address market, address collateral);
    error MarketMissing(address market);
    error NoRecoveryForTerminal(bytes32 requestHash);

    constructor(
        uint256 expectedChainId_,
        address exchangeRouter_,
        address tokenTransferRouter_,
        address orderVault_,
        address orderHandler_,
        address dataStore_,
        address reader_,
        address wnt_,
        address executor_,
        uint48 defaultAdminDelay_,
        address initialAdmin_,
        address actionStager_,
        address inventoryManager_,
        uint256 callbackGasLimit_
    ) AccessControlDefaultAdminRules(defaultAdminDelay_, _requireInitialAdmin(initialAdmin_)) {
        if (expectedChainId_ == 0 || expectedChainId_ != block.chainid) {
            revert WrongDeploymentChain(expectedChainId_, block.chainid);
        }
        if (exchangeRouter_ == address(0)) revert ZeroExchangeRouter();
        if (exchangeRouter_.code.length == 0) revert ExchangeRouterWithoutCode(exchangeRouter_);
        if (tokenTransferRouter_ == address(0)) revert ZeroTokenTransferRouter();
        if (tokenTransferRouter_.code.length == 0) revert TokenTransferRouterWithoutCode(tokenTransferRouter_);
        if (orderVault_ == address(0)) revert ZeroOrderVault();
        if (orderVault_.code.length == 0) revert OrderVaultWithoutCode(orderVault_);
        if (orderHandler_ == address(0)) revert ZeroOrderHandler();
        if (orderHandler_.code.length == 0) revert OrderHandlerWithoutCode(orderHandler_);
        if (dataStore_ == address(0)) revert ZeroDataStore();
        if (dataStore_.code.length == 0) revert DataStoreWithoutCode(dataStore_);
        if (reader_ == address(0)) revert ZeroReader();
        if (reader_.code.length == 0) revert ReaderWithoutCode(reader_);
        if (wnt_ == address(0)) revert ZeroWnt();
        if (wnt_.code.length == 0) revert WntWithoutCode(wnt_);
        if (executor_ == address(0)) revert ZeroExecutor();
        if (executor_.code.length == 0) revert ExecutorWithoutCode(executor_);
        if (actionStager_ == address(0)) revert ZeroActionStager();
        if (inventoryManager_ == address(0)) revert ZeroInventoryManager();
        if (callbackGasLimit_ == 0) revert ZeroCallbackGasLimit();
        expectedChainId = expectedChainId_;
        exchangeRouter = IGmxV2ExchangeRouter(exchangeRouter_);
        tokenTransferRouter = tokenTransferRouter_;
        orderVault = orderVault_;
        orderHandler = orderHandler_;
        dataStore = IGmxV2DataStore(dataStore_);
        reader = IGmxV2Reader(reader_);
        wnt = wnt_;
        executor = executor_;
        callbackGasLimit = callbackGasLimit_;
        _grantRole(ACTION_STAGER_ROLE, actionStager_);
        _grantRole(INVENTORY_MANAGER_ROLE, inventoryManager_);
        _grantRole(ACTION_STAGER_ROLE, initialAdmin_);
        _grantRole(INVENTORY_MANAGER_ROLE, initialAdmin_);
    }

    /// @notice Accepts native ETH refunds from GMX (execution-fee refunds and unwrapped
    ///         collateral payouts target this adapter as cancellationReceiver).
    /// @dev Intentionally logic-free: GMX forwards a small fixed gas stipend on native sends,
    ///      so any logging or accounting here could push delivery over budget and force a
    ///      WNT-ERC20 fallback. Funding is tracked via the restricted payable entrypoint and
    ///      reconciled explicitly in recovery.
    receive() external payable {}

    function operationalAdapterDescriptor() external view returns (AdapterRuntimeDescriptor memory descriptor) {
        descriptor = AdapterRuntimeDescriptor({
            self: address(this),
            chainId: block.chainid,
            interfaceHash: OperationalAdapterLib.INTERFACE_EXTERNAL_VENUE,
            capabilityHash: OperationalAdapterLib.CAPABILITY_EXTERNAL_ASYNC,
            proxyFree: true,
            valueMoving: true
        });
    }

    function hashSwapPath(address[] memory swapPath) public pure returns (bytes32) {
        return keccak256(abi.encode("SetrynGmxV2SwapPathV1", swapPath));
    }

    /// @notice Staging inputs for canonical hashing (explicit bounded fields, no arrays).
    struct GmxV2ActionHashInputs {
        uint8 kind;
        address market;
        address initialCollateralToken;
        bytes32 swapPathHash;
        address receiver;
        address uiFeeReceiver;
        uint256 sizeDeltaUsd;
        uint256 initialCollateralDeltaAmount;
        uint256 triggerPrice;
        uint256 acceptablePrice;
        uint256 executionFee;
        uint8 orderType;
        bool isLong;
        bool shouldUnwrapNativeToken;
        bytes32 referralCode;
        uint64 deadline;
        bytes32 recoveryPolicyHash;
    }

    /// @notice Precommittable postcondition inputs (explicit bounded fields).
    struct GmxV2PostconditionsInputs {
        bytes32 actionHash;
        address market;
        address initialCollateralToken;
        bytes32 swapPathHash;
        address receiver;
        uint256 sizeDeltaUsd;
        uint256 initialCollateralDeltaAmount;
        uint256 triggerPrice;
        uint256 acceptablePrice;
        uint256 executionFee;
        uint8 orderType;
        bool isLong;
        bool shouldUnwrapNativeToken;
        uint64 deadline;
        bytes32 recoveryPolicyHash;
    }

    /// @notice Staging call inputs (explicit bounded fields plus bounded swap path).
    struct GmxV2StageOrderInputs {
        GmxV2OrderKind kind;
        address market;
        address initialCollateralToken;
        address[] swapPath;
        address receiver;
        address uiFeeReceiver;
        uint256 sizeDeltaUsd;
        uint256 initialCollateralDeltaAmount;
        uint256 triggerPrice;
        uint256 acceptablePrice;
        uint256 executionFee;
        uint8 orderType;
        bool isLong;
        bool shouldUnwrapNativeToken;
        bytes32 referralCode;
        uint64 deadline;
        bytes32 recoveryPolicyHash;
    }

    function hashStagedAction(GmxV2ActionHashInputs memory inputs) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                "SetrynGmxV2OrderV1",
                inputs.kind,
                inputs.market,
                inputs.initialCollateralToken,
                inputs.swapPathHash,
                inputs.receiver,
                inputs.uiFeeReceiver,
                inputs.sizeDeltaUsd,
                inputs.initialCollateralDeltaAmount,
                inputs.triggerPrice,
                inputs.acceptablePrice,
                inputs.executionFee,
                inputs.orderType,
                inputs.isLong,
                inputs.shouldUnwrapNativeToken,
                inputs.referralCode,
                inputs.deadline,
                inputs.recoveryPolicyHash
            )
        );
    }

    /// @notice Canonical executor-precommittable expected postconditions for a staged GMX V2 order.
    /// @dev Pure and precomputable before submission; commits to the staged market, collateral,
    ///      size, prices, execution fee, route hash, order type, direction, and policy, never to
    ///      the keeper-returned order key or realized fill, which live only in evidenceHash.
    function hashExpectedPostconditions(GmxV2PostconditionsInputs memory inputs) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                "SetrynGmxV2PostconditionsV1",
                inputs.actionHash,
                inputs.market,
                inputs.initialCollateralToken,
                inputs.swapPathHash,
                inputs.receiver,
                inputs.sizeDeltaUsd,
                inputs.initialCollateralDeltaAmount,
                inputs.triggerPrice,
                inputs.acceptablePrice,
                inputs.executionFee,
                inputs.orderType,
                inputs.isLong,
                inputs.shouldUnwrapNativeToken,
                inputs.deadline,
                inputs.recoveryPolicyHash
            )
        );
    }

    function stageOrder(GmxV2StageOrderInputs calldata inputs)
        external
        onlyRole(ACTION_STAGER_ROLE)
        nonReentrant
        returns (bytes32 actionHash)
    {
        address market = inputs.market;
        address initialCollateralToken = inputs.initialCollateralToken;
        address receiver = inputs.receiver;
        uint256 sizeDeltaUsd = inputs.sizeDeltaUsd;
        uint256 initialCollateralDeltaAmount = inputs.initialCollateralDeltaAmount;
        uint256 triggerPrice = inputs.triggerPrice;
        uint256 executionFee = inputs.executionFee;
        uint8 orderType = inputs.orderType;
        GmxV2OrderKind kind = inputs.kind;
        if (receiver == address(0)) revert ZeroReceiver();
        if (initialCollateralToken == address(0)) revert ZeroCollateralToken();
        if (initialCollateralToken.code.length == 0) revert CollateralWithoutCode(initialCollateralToken);
        if (executionFee == 0) revert ZeroExecutionFee();
        if (inputs.recoveryPolicyHash == bytes32(0)) revert ZeroRecoveryPolicyHash();
        if (inputs.deadline <= block.timestamp) revert ActionExpired(inputs.deadline, block.timestamp);
        if (inputs.swapPath.length > MAX_SWAP_PATH_LENGTH) revert SwapPathTooLong(inputs.swapPath.length);
        for (uint256 i = 0; i < inputs.swapPath.length; i++) {
            if (inputs.swapPath[i] == address(0) || inputs.swapPath[i].code.length == 0) {
                revert SwapPathTokenWithoutCode(inputs.swapPath[i]);
            }
        }
        _validateKindAndType(kind, orderType, sizeDeltaUsd, initialCollateralDeltaAmount, triggerPrice, inputs.swapPath);

        if (kind == GmxV2OrderKind.Swap) {
            // Production swaps carry no market; the swap path is a bounded list of market
            // addresses (never collateral tokens), so no first-hop token check applies.
            if (market != address(0)) revert UnexpectedMarketForSwap(market);
            if (inputs.swapPath.length == 0) revert EmptySwapPath();
        } else {
            if (market == address(0)) revert ZeroMarket();
            if (market.code.length == 0) revert MarketWithoutCode(market);
            _validateMarketMembership(market, initialCollateralToken);
        }

        bytes32 swapPathHash = hashSwapPath(inputs.swapPath);
        GmxV2ActionHashInputs memory hashInputs = GmxV2ActionHashInputs({
            kind: uint8(kind),
            market: market,
            initialCollateralToken: initialCollateralToken,
            swapPathHash: swapPathHash,
            receiver: receiver,
            uiFeeReceiver: inputs.uiFeeReceiver,
            sizeDeltaUsd: sizeDeltaUsd,
            initialCollateralDeltaAmount: initialCollateralDeltaAmount,
            triggerPrice: triggerPrice,
            acceptablePrice: inputs.acceptablePrice,
            executionFee: executionFee,
            orderType: orderType,
            isLong: inputs.isLong,
            shouldUnwrapNativeToken: inputs.shouldUnwrapNativeToken,
            referralCode: inputs.referralCode,
            deadline: inputs.deadline,
            recoveryPolicyHash: inputs.recoveryPolicyHash
        });
        actionHash = hashStagedAction(hashInputs);
        if (_staged[actionHash].initialCollateralToken != address(0)) revert DuplicateAction(actionHash);

        _reserve(kind, initialCollateralToken, initialCollateralDeltaAmount, executionFee);

        StagedGmxV2Order storage staged = _staged[actionHash];
        staged.kind = kind;
        staged.market = market;
        staged.initialCollateralToken = initialCollateralToken;
        staged.swapPathHash = swapPathHash;
        staged.receiver = receiver;
        staged.uiFeeReceiver = inputs.uiFeeReceiver;
        staged.sizeDeltaUsd = sizeDeltaUsd;
        staged.initialCollateralDeltaAmount = initialCollateralDeltaAmount;
        staged.triggerPrice = triggerPrice;
        staged.acceptablePrice = inputs.acceptablePrice;
        staged.executionFee = executionFee;
        staged.orderType = orderType;
        staged.isLong = inputs.isLong;
        staged.shouldUnwrapNativeToken = inputs.shouldUnwrapNativeToken;
        staged.referralCode = inputs.referralCode;
        staged.deadline = inputs.deadline;
        staged.recoveryPolicyHash = inputs.recoveryPolicyHash;
        for (uint256 i = 0; i < inputs.swapPath.length; i++) {
            staged.swapPath.push(inputs.swapPath[i]);
        }

        emit GmxV2OrderStaged(actionHash, market, initialCollateralToken);
    }

    function syncInventory(address token) external nonReentrant {
        if (token == address(0) || token.code.length == 0) revert CollateralWithoutCode(token);
        uint256 actual = IERC20(token).balanceOf(address(this));
        _inventory[token] = actual;
        emit GmxV2InventorySynced(token, actual);
    }

    function withdrawInventory(address token, uint256 amount, address recipient)
        external
        onlyRole(INVENTORY_MANAGER_ROLE)
        nonReentrant
    {
        if (token == address(0)) revert ZeroCollateralToken();
        if (recipient == address(0)) revert ZeroReceiver();
        if (amount == 0) revert ZeroCollateralAmount();
        uint256 inventoried = _inventory[token];
        uint256 reservedAmount = _reserved[token];
        if (reservedAmount > inventoried) revert InsufficientUnreserved(token, amount, 0);
        uint256 unreserved = inventoried - reservedAmount;
        if (amount > unreserved) revert InsufficientUnreserved(token, amount, unreserved);
        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        if (amount > balanceBefore) revert InsufficientBalance(token, balanceBefore, amount);
        _inventory[token] = inventoried - amount;
        IERC20(token).safeTransfer(recipient, amount);
        uint256 balanceAfter = IERC20(token).balanceOf(address(this));
        if (balanceBefore - balanceAfter != amount) {
            revert InexactTokenDelta(token, amount, balanceBefore - balanceAfter);
        }
        emit GmxV2InventoryWithdrawn(token, recipient, amount);
    }

    /// @notice Restricted payable funding path for the native execution-fee inventory.
    function fundNativeExecutionInventory() external payable onlyRole(INVENTORY_MANAGER_ROLE) nonReentrant {
        if (msg.value == 0) revert ZeroNativeFunding();
        _nativeInventoried += msg.value;
        emit GmxV2NativeInventoryFunded(msg.sender, msg.value, _nativeInventoried);
    }

    function syncNativeInventory() external nonReentrant {
        _nativeInventoried = address(this).balance;
        emit GmxV2NativeInventorySynced(_nativeInventoried);
    }

    function withdrawNativeInventory(uint256 amount, address recipient)
        external
        onlyRole(INVENTORY_MANAGER_ROLE)
        nonReentrant
    {
        if (recipient == address(0)) revert ZeroReceiver();
        if (amount == 0) revert ZeroNativeAmount();
        uint256 inventoried = _nativeInventoried;
        uint256 reservedAmount = _nativeReserved;
        if (reservedAmount > inventoried) revert InsufficientNativeUnreserved(amount, 0);
        uint256 unreserved = inventoried - reservedAmount;
        if (amount > unreserved) revert InsufficientNativeUnreserved(amount, unreserved);
        uint256 balanceBefore = address(this).balance;
        if (amount > balanceBefore) revert InsufficientNativeBalance(balanceBefore, amount);
        _nativeInventoried = inventoried - amount;
        (bool ok,) = recipient.call{value: amount}("");
        if (!ok) revert NativeTransferFailed(recipient, amount);
        uint256 balanceAfter = address(this).balance;
        if (balanceBefore - balanceAfter != amount) {
            revert InexactNativeDelta(amount, balanceBefore - balanceAfter);
        }
        emit GmxV2NativeInventoryWithdrawn(recipient, amount);
    }

    function cancelStagedAction(bytes32 actionHash) external nonReentrant {
        if (!hasRole(ACTION_STAGER_ROLE, msg.sender) && !hasRole(INVENTORY_MANAGER_ROLE, msg.sender)) {
            revert NotAuthorizedToCancel(msg.sender);
        }
        StagedGmxV2Order storage staged = _staged[actionHash];
        if (staged.initialCollateralToken == address(0)) revert UnknownStagedAction(actionHash);
        if (staged.consumed) revert ActionAlreadyConsumed(actionHash);
        if (staged.cancelled) revert ActionCancelled(actionHash);
        staged.cancelled = true;
        _releaseStaged(staged);
        emit GmxV2StagedCancelled(actionHash);
    }

    function submitExternalAction(ExternalVenueRequest calldata request)
        external
        nonReentrant
        returns (ExternalVenueResult memory result)
    {
        if (msg.sender != executor) revert OnlyExecutor(msg.sender, executor);
        if (request.guaranteeClass != ExecutionGuaranteeClass.BoundedAsync) revert UnsupportedGuaranteeClass();
        _validateAsyncBounds(request);

        OperationalBinding calldata binding = request.binding;
        if (binding.chainId != block.chainid || binding.chainId != expectedChainId) {
            revert BindingChainMismatch(binding.chainId, block.chainid);
        }
        if (block.timestamp > binding.deadline) revert BindingExpired(binding.deadline, block.timestamp);
        if (
            binding.deploymentId == bytes32(0) || AccountId.unwrap(binding.accountId) == bytes32(0)
                || MarketId.unwrap(binding.marketId) == bytes32(0) || SeriesId.unwrap(binding.seriesId) == bytes32(0)
                || binding.seriesVersion == 0 || PackageId.unwrap(binding.packageId) == bytes32(0)
                || binding.packageVersion == 0 || binding.actionHash == bytes32(0) || binding.nonce == 0
                || binding.minValue > binding.maxValue || binding.recipientPolicyHash == bytes32(0)
                || binding.expectedPostconditionsHash == bytes32(0)
        ) revert InvalidBinding();

        StagedGmxV2Order storage staged = _staged[binding.actionHash];
        if (staged.initialCollateralToken == address(0)) revert UnknownStagedAction(binding.actionHash);
        if (staged.cancelled) revert ActionCancelled(binding.actionHash);
        if (staged.consumed) revert ActionAlreadyConsumed(binding.actionHash);
        if (block.timestamp > staged.deadline) revert ActionExpired(staged.deadline, block.timestamp);
        if (staged.recoveryPolicyHash != binding.recipientPolicyHash) {
            revert RecoveryPolicyMismatch(staged.recoveryPolicyHash, binding.recipientPolicyHash);
        }
        if (staged.recoveryPolicyHash != request.recoveryPolicyHash) {
            revert RecoveryPolicyMismatch(staged.recoveryPolicyHash, request.recoveryPolicyHash);
        }
        bytes32 derived = hashStagedAction(
            GmxV2ActionHashInputs({
                kind: uint8(staged.kind),
                market: staged.market,
                initialCollateralToken: staged.initialCollateralToken,
                swapPathHash: staged.swapPathHash,
                receiver: staged.receiver,
                uiFeeReceiver: staged.uiFeeReceiver,
                sizeDeltaUsd: staged.sizeDeltaUsd,
                initialCollateralDeltaAmount: staged.initialCollateralDeltaAmount,
                triggerPrice: staged.triggerPrice,
                acceptablePrice: staged.acceptablePrice,
                executionFee: staged.executionFee,
                orderType: staged.orderType,
                isLong: staged.isLong,
                shouldUnwrapNativeToken: staged.shouldUnwrapNativeToken,
                referralCode: staged.referralCode,
                deadline: staged.deadline,
                recoveryPolicyHash: staged.recoveryPolicyHash
            })
        );
        if (derived != binding.actionHash) revert ActionHashMismatch(binding.actionHash, derived);
        if (binding.deadline != staged.deadline) revert BindingDeadlineMismatch(binding.deadline, staged.deadline);
        bytes32 expectedPostconditions = hashExpectedPostconditions(
            GmxV2PostconditionsInputs({
                actionHash: binding.actionHash,
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
            })
        );
        if (binding.expectedPostconditionsHash != expectedPostconditions) {
            revert ExpectedPostconditionsMismatch(expectedPostconditions, binding.expectedPostconditionsHash);
        }
        _validateTerminalFallback(request, binding);

        ExternalVenueRequest memory requestCopy = request;
        bytes32 requestHash = OperationalAdapterLib.hashExternalRequest(requestCopy);
        if (_resultStored[requestHash]) revert RequestAlreadySubmitted(requestHash);

        staged.consumed = true;

        bool isDecrease = staged.kind == GmxV2OrderKind.Decrease;
        address collateral = staged.initialCollateralToken;
        // Decrease orders never move collateral: initialCollateralDeltaAmount is withdrawal intent.
        uint256 collateralAmount = isDecrease ? 0 : staged.initialCollateralDeltaAmount;
        uint256 executionFee = staged.executionFee;

        uint256 nativeBefore = address(this).balance;
        if (nativeBefore < executionFee) revert InsufficientNativeFee(nativeBefore, executionFee);
        uint256 collateralBefore;
        if (!isDecrease) {
            collateralBefore = IERC20(collateral).balanceOf(address(this));
            if (collateralBefore < collateralAmount) {
                revert InsufficientInventory(collateral, collateralBefore, collateralAmount);
            }
            IERC20(collateral).forceApprove(tokenTransferRouter, collateralAmount);
        }

        bytes32[] memory emptyDataList = new bytes32[](0);
        GmxV2CreateOrderParams memory params = GmxV2CreateOrderParams({
            addresses: GmxV2CreateOrderParamsAddresses({
                receiver: staged.receiver,
                cancellationReceiver: address(this),
                callbackContract: address(this),
                uiFeeReceiver: staged.uiFeeReceiver,
                market: staged.market,
                initialCollateralToken: staged.initialCollateralToken,
                swapPath: staged.swapPath
            }),
            numbers: GmxV2CreateOrderParamsNumbers({
                sizeDeltaUsd: staged.sizeDeltaUsd,
                initialCollateralDeltaAmount: staged.initialCollateralDeltaAmount,
                triggerPrice: staged.triggerPrice,
                acceptablePrice: staged.acceptablePrice,
                executionFee: staged.executionFee,
                callbackGasLimit: callbackGasLimit,
                minOutputAmount: 0,
                validFromTime: 0
            }),
            orderType: staged.orderType,
            decreasePositionSwapType: NO_SWAP,
            isLong: staged.isLong,
            shouldUnwrapNativeToken: staged.shouldUnwrapNativeToken,
            autoCancel: false,
            referralCode: staged.referralCode,
            dataList: emptyDataList
        });

        bytes[] memory calls;
        if (isDecrease) {
            calls = new bytes[](2);
            calls[0] = abi.encodeCall(IGmxV2ExchangeRouter.sendWnt, (orderVault, executionFee));
            calls[1] = abi.encodeCall(IGmxV2ExchangeRouter.createOrder, (params));
        } else {
            calls = new bytes[](3);
            calls[0] = abi.encodeCall(IGmxV2ExchangeRouter.sendWnt, (orderVault, executionFee));
            calls[1] = abi.encodeCall(IGmxV2ExchangeRouter.sendTokens, (collateral, orderVault, collateralAmount));
            calls[2] = abi.encodeCall(IGmxV2ExchangeRouter.createOrder, (params));
        }

        bytes[] memory multicallResults = exchangeRouter.multicall{value: executionFee}(calls);
        if (!isDecrease) {
            IERC20(collateral).forceApprove(tokenTransferRouter, 0);
            if (IERC20(collateral).allowance(address(this), tokenTransferRouter) != 0) {
                revert AllowanceNotCleared(collateral, IERC20(collateral).allowance(address(this), tokenTransferRouter));
            }
        }
        if (multicallResults.length != calls.length) {
            revert MulticallArityMismatch(calls.length, multicallResults.length);
        }
        bytes32 orderKey = abi.decode(multicallResults[multicallResults.length - 1], (bytes32));
        if (orderKey == bytes32(0)) revert ZeroOrderKey();

        uint256 nativeAfter = address(this).balance;
        if (nativeBefore - nativeAfter != executionFee) {
            revert InexactNativeDelta(executionFee, nativeBefore - nativeAfter);
        }
        _nativeInventoried -= executionFee;
        if (!isDecrease) {
            uint256 collateralAfter = IERC20(collateral).balanceOf(address(this));
            if (collateralBefore - collateralAfter != collateralAmount) {
                revert InexactTokenDelta(collateral, collateralAmount, collateralBefore - collateralAfter);
            }
            _inventory[collateral] -= collateralAmount;
        }

        _requests[requestHash] = StoredGmxV2Request({
            actionHash: binding.actionHash,
            kind: staged.kind,
            orderKey: orderKey,
            market: staged.market,
            initialCollateralToken: collateral,
            collateralAmount: collateralAmount,
            executionFee: executionFee,
            sizeDeltaUsd: staged.sizeDeltaUsd,
            timeoutAt: request.timeoutAt,
            recoveryDeadline: request.recoveryDeadline,
            expectedPostconditionsHash: binding.expectedPostconditionsHash,
            minValue: binding.minValue,
            maxValue: binding.maxValue,
            maximumResidual: request.maximumResidual,
            recoveryPolicyHash: request.recoveryPolicyHash,
            reservationReleased: false,
            terminalState: request.terminalFallback.state,
            terminalRealized: request.terminalFallback.realizedValue,
            terminalResidual: request.terminalFallback.residualValue,
            terminalPostconditions: request.terminalFallback.postconditionsHash,
            terminalOutcome: request.terminalFallback.outcomeHash
        });
        _orderToRequest[orderKey] = requestHash;

        bytes32 evidenceHash = keccak256(
            abi.encode(
                "SetrynGmxV2SubmissionV1",
                expectedChainId,
                address(this),
                address(exchangeRouter),
                tokenTransferRouter,
                orderVault,
                orderHandler,
                requestHash,
                binding.actionHash,
                orderKey,
                collateral,
                collateralAmount,
                executionFee
            )
        );
        if (evidenceHash == bytes32(0)) revert ZeroEvidenceCommitment();

        result = ExternalVenueResult({
            state: OperationalActionState.Submitted,
            realizedValue: 0,
            residualValue: 0,
            postconditionsHash: bytes32(0),
            venueActionReference: orderKey,
            evidenceHash: evidenceHash,
            recoveryOutcomeHash: bytes32(0)
        });
        _results[requestHash] = result;
        _resultStored[requestHash] = true;

        emit GmxV2OrderSubmitted(requestHash, binding.actionHash, orderKey);
    }

    /// @notice Exact GMX V2 execution callback entrypoint (IOrderCallbackReceiver).
    /// @dev Authenticated against the configured OrderHandler, never the ExchangeRouter:
    ///      CallbackUtils invokes the callback from the OrderHandler execution context.
    ///      Marks Complete only after exact orderData binding and a nonzero evidence
    ///      commitment over bounded order and event data. Never invents an execution price:
    ///      realized tracks the authenticated staged delta, not a fill price.
    function afterOrderExecution(
        bytes32 key,
        GmxV2EventTypes.EventLogData memory orderData,
        GmxV2EventTypes.EventLogData memory eventData
    ) external nonReentrant {
        if (msg.sender != orderHandler) {
            revert UnauthorizedCallback(msg.sender, orderHandler);
        }
        bytes32 requestHash = _orderToRequest[key];
        if (requestHash == bytes32(0)) revert UnknownOrder(key);
        StoredGmxV2Request storage storedReq = _requests[requestHash];
        ExternalVenueResult storage current = _results[requestHash];
        if (!_resultStored[requestHash]) revert UnknownRequest(requestHash);
        if (current.state != OperationalActionState.Submitted) revert OrderAlreadyResolved(key);
        StagedGmxV2Order storage staged = _staged[storedReq.actionHash];
        (bytes32 orderCommitment, uint256 sizeDeltaUsd, uint256 collateralDelta) =
            _validateAndCommitOrderData(key, orderData, staged);
        if (staged.market != storedReq.market) revert OrderFieldMismatch(key);

        // Realized is the authenticated staged delta (position notional or swap input),
        // never a keeper-reported fill price: GMX callbacks carry no execution price.
        int256 realized = _realizedForKind(staged.kind, sizeDeltaUsd, collateralDelta);
        if (realized < storedReq.minValue || realized > storedReq.maxValue) {
            revert RealizedValueOutOfRange(realized, storedReq.minValue, storedReq.maxValue);
        }
        bytes32 eventCommitment = _hashBoundedEventData(eventData);

        bytes32 evidenceHash = keccak256(
            abi.encode(
                "SetrynGmxV2ExecutionV1",
                expectedChainId,
                address(this),
                orderHandler,
                requestHash,
                key,
                orderCommitment,
                eventCommitment,
                realized
            )
        );
        if (evidenceHash == bytes32(0)) revert ZeroEvidenceCommitment();

        _releaseOnce(requestHash, storedReq);

        current.state = OperationalActionState.Complete;
        current.realizedValue = realized;
        current.residualValue = 0;
        current.postconditionsHash = storedReq.expectedPostconditionsHash;
        current.venueActionReference = key;
        current.evidenceHash = evidenceHash;
        current.recoveryOutcomeHash = bytes32(0);

        emit GmxV2OrderExecuted(requestHash, key, realized);
    }

    /// @notice Exact GMX V2 cancellation callback entrypoint (IOrderCallbackReceiver).
    /// @dev Best effort by construction (the OrderHandler try/catches callbacks): moves to
    ///      Recovering with retained accounting and releases nothing; recovery reconciles.
    function afterOrderCancellation(
        bytes32 key,
        GmxV2EventTypes.EventLogData memory orderData,
        GmxV2EventTypes.EventLogData memory eventData
    ) external nonReentrant {
        if (msg.sender != orderHandler) {
            revert UnauthorizedCallback(msg.sender, orderHandler);
        }
        bytes32 requestHash = _orderToRequest[key];
        if (requestHash == bytes32(0)) revert UnknownOrder(key);
        if (!_resultStored[requestHash]) revert UnknownRequest(requestHash);
        ExternalVenueResult storage current = _results[requestHash];
        if (current.state != OperationalActionState.Submitted) revert OrderAlreadyResolved(key);
        StoredGmxV2Request storage storedReq = _requests[requestHash];
        StagedGmxV2Order storage staged = _staged[storedReq.actionHash];
        (bytes32 orderCommitment,,) = _validateAndCommitOrderData(key, orderData, staged);
        bytes32 eventCommitment = _hashBoundedEventData(eventData);

        bytes32 evidenceHash = keccak256(
            abi.encode(
                "SetrynGmxV2CancellationV1",
                expectedChainId,
                address(this),
                orderHandler,
                requestHash,
                key,
                orderCommitment,
                eventCommitment
            )
        );
        if (evidenceHash == bytes32(0)) revert ZeroEvidenceCommitment();

        current.state = OperationalActionState.Recovering;
        current.realizedValue = 0;
        current.residualValue = 0;
        current.postconditionsHash = bytes32(0);
        current.venueActionReference = key;
        current.evidenceHash = evidenceHash;
        current.recoveryOutcomeHash = bytes32(0);

        emit GmxV2OrderCancelled(requestHash, key);
    }

    /// @notice Exact GMX V2 frozen-order callback entrypoint (IOrderCallbackReceiver).
    /// @dev Best effort like cancellation: Recovering with retained accounting, no release.
    function afterOrderFrozen(
        bytes32 key,
        GmxV2EventTypes.EventLogData memory orderData,
        GmxV2EventTypes.EventLogData memory eventData
    ) external nonReentrant {
        if (msg.sender != orderHandler) {
            revert UnauthorizedCallback(msg.sender, orderHandler);
        }
        bytes32 requestHash = _orderToRequest[key];
        if (requestHash == bytes32(0)) revert UnknownOrder(key);
        if (!_resultStored[requestHash]) revert UnknownRequest(requestHash);
        ExternalVenueResult storage current = _results[requestHash];
        if (current.state != OperationalActionState.Submitted) revert OrderAlreadyResolved(key);
        StoredGmxV2Request storage storedReq = _requests[requestHash];
        StagedGmxV2Order storage staged = _staged[storedReq.actionHash];
        (bytes32 orderCommitment,,) = _validateAndCommitOrderData(key, orderData, staged);
        bytes32 eventCommitment = _hashBoundedEventData(eventData);

        bytes32 evidenceHash = keccak256(
            abi.encode(
                "SetrynGmxV2FrozenV1",
                expectedChainId,
                address(this),
                orderHandler,
                requestHash,
                key,
                orderCommitment,
                eventCommitment
            )
        );
        if (evidenceHash == bytes32(0)) revert ZeroEvidenceCommitment();

        current.state = OperationalActionState.Recovering;
        current.realizedValue = 0;
        current.residualValue = 0;
        current.postconditionsHash = bytes32(0);
        current.venueActionReference = key;
        current.evidenceHash = evidenceHash;
        current.recoveryOutcomeHash = bytes32(0);

        emit GmxV2OrderFrozen(requestHash, key);
    }

    /// @notice Exact GMX V2 execution-fee refund entrypoint (IGasFeeCallbackReceiver).
    /// @dev Called by the OrderHandler with leftover native fee after keeper payment. Accepts
    ///      the value for later explicit reconciliation in recovery; carries no iteration so
    ///      no event-data bounds apply.
    function refundExecutionFee(bytes32 key, GmxV2EventTypes.EventLogData memory _eventData)
        external
        payable
        nonReentrant
    {
        _eventData;
        if (msg.sender != orderHandler) {
            revert UnauthorizedCallback(msg.sender, orderHandler);
        }
        emit GmxV2ExecutionFeeRefunded(key, msg.value);
    }

    function reconcileExternalAction(bytes32 requestHash) external view returns (ExternalVenueResult memory result) {
        if (!_resultStored[requestHash]) revert UnknownRequest(requestHash);
        result = _results[requestHash];
    }

    function recoverExternalAction(bytes32 requestHash)
        external
        nonReentrant
        returns (ExternalVenueResult memory result)
    {
        if (!_resultStored[requestHash]) revert UnknownRequest(requestHash);
        StoredGmxV2Request storage storedReq = _requests[requestHash];
        ExternalVenueResult storage current = _results[requestHash];
        if (
            current.state == OperationalActionState.Complete || current.state == OperationalActionState.Recovered
                || current.state == OperationalActionState.NoEffect
        ) revert NoRecoveryForTerminal(requestHash);
        if (block.timestamp < storedReq.timeoutAt || block.timestamp > storedReq.recoveryDeadline) {
            revert RecoveryNotAvailable(storedReq.timeoutAt, storedReq.recoveryDeadline, block.timestamp);
        }

        bool wasSubmitted = current.state == OperationalActionState.Submitted;
        if (wasSubmitted) {
            // Best effort: the order may already be gone (executed, cancelled, or frozen
            // callbacks fire under try/catch), in which case cancellation reverts and the
            // absence check below carries the decision.
            try exchangeRouter.cancelOrder(storedReq.orderKey) {} catch {}
        }

        bool absent = !dataStore.containsBytes32(ORDER_LIST, storedReq.orderKey);
        if (!absent) {
            if (!wasSubmitted) revert OrderStillPending(storedReq.orderKey);
            current.state = OperationalActionState.Recovering;
            current.realizedValue = 0;
            current.residualValue = 0;
            current.postconditionsHash = bytes32(0);
            current.venueActionReference = storedReq.orderKey;
            bytes32 pendingEvidence = keccak256(
                abi.encode(
                    "SetrynGmxV2RecoveryPendingV1",
                    expectedChainId,
                    address(this),
                    orderHandler,
                    requestHash,
                    storedReq.orderKey
                )
            );
            if (pendingEvidence == bytes32(0)) revert ZeroEvidenceCommitment();
            current.evidenceHash = pendingEvidence;
            current.recoveryOutcomeHash = bytes32(0);
            result = current;
            emit GmxV2OrderCancelled(requestHash, storedReq.orderKey);
            return result;
        }

        // Order absent: reconcile returned collateral plus refunded native fee first.
        address collateral = storedReq.initialCollateralToken;
        uint256 collateralLive = IERC20(collateral).balanceOf(address(this));
        uint256 nativeLive = address(this).balance;
        _inventory[collateral] = collateralLive;
        _nativeInventoried = nativeLive;
        _releaseOnce(requestHash, storedReq);

        bytes32 evidenceHash = keccak256(
            abi.encode(
                "SetrynGmxV2RecoveryV1",
                expectedChainId,
                address(this),
                orderHandler,
                requestHash,
                storedReq.orderKey,
                collateralLive,
                nativeLive,
                storedReq.terminalOutcome
            )
        );
        if (evidenceHash == bytes32(0)) revert ZeroEvidenceCommitment();

        current.state = storedReq.terminalState;
        current.realizedValue = storedReq.terminalRealized;
        current.residualValue = storedReq.terminalResidual;
        current.postconditionsHash = storedReq.terminalPostconditions;
        current.venueActionReference = storedReq.orderKey;
        current.evidenceHash = evidenceHash;
        current.recoveryOutcomeHash = storedReq.terminalOutcome;
        result = current;

        emit GmxV2OrderRecovered(requestHash, storedReq.orderKey, uint8(current.state));
    }

    function getStagedAction(bytes32 actionHash) external view returns (StagedGmxV2Order memory) {
        return _staged[actionHash];
    }

    function getStoredRequest(bytes32 requestHash) external view returns (StoredGmxV2Request memory) {
        if (!_resultStored[requestHash]) revert UnknownRequest(requestHash);
        return _requests[requestHash];
    }

    function getOrderRequest(bytes32 orderKey) external view returns (bytes32) {
        bytes32 requestHash = _orderToRequest[orderKey];
        if (requestHash == bytes32(0)) revert UnknownOrder(orderKey);
        return requestHash;
    }

    function orderExists(bytes32 orderKey) external view returns (bool) {
        return dataStore.containsBytes32(ORDER_LIST, orderKey);
    }

    function inventoriedBalance(address token) external view returns (uint256) {
        return _inventory[token];
    }

    function reservedBalance(address token) external view returns (uint256) {
        return _reserved[token];
    }

    function unreservedBalance(address token) external view returns (uint256) {
        uint256 inventoried = _inventory[token];
        uint256 reservedAmount = _reserved[token];
        return inventoried > reservedAmount ? inventoried - reservedAmount : 0;
    }

    function nativeInventoried() external view returns (uint256) {
        return _nativeInventoried;
    }

    function nativeReserved() external view returns (uint256) {
        return _nativeReserved;
    }

    function nativeUnreserved() external view returns (uint256) {
        return _nativeInventoried > _nativeReserved ? _nativeInventoried - _nativeReserved : 0;
    }

    function resultStored(bytes32 requestHash) external view returns (bool) {
        return _resultStored[requestHash];
    }

    function _validateKindAndType(
        GmxV2OrderKind kind,
        uint8 orderType,
        uint256 sizeDeltaUsd,
        uint256 collateralDelta,
        uint256 triggerPrice,
        address[] calldata swapPath
    ) private pure {
        if (
            orderType != MARKET_SWAP && orderType != LIMIT_SWAP && orderType != MARKET_INCREASE
                && orderType != LIMIT_INCREASE && orderType != MARKET_DECREASE && orderType != LIMIT_DECREASE
                && orderType != STOP_LOSS_DECREASE && orderType != STOP_INCREASE
        ) revert UnknownOrderType(orderType);
        if (kind == GmxV2OrderKind.Increase) {
            if (orderType != MARKET_INCREASE && orderType != LIMIT_INCREASE && orderType != STOP_INCREASE) {
                revert InvalidOrderTypeForKind(orderType, uint8(kind));
            }
            if (sizeDeltaUsd == 0) revert ZeroSizeDelta();
            if (collateralDelta == 0) revert ZeroCollateralAmount();
        } else if (kind == GmxV2OrderKind.Decrease) {
            if (orderType != MARKET_DECREASE && orderType != LIMIT_DECREASE && orderType != STOP_LOSS_DECREASE) {
                revert InvalidOrderTypeForKind(orderType, uint8(kind));
            }
            if (sizeDeltaUsd == 0) revert ZeroSizeDelta();
        } else {
            if (orderType != MARKET_SWAP && orderType != LIMIT_SWAP) {
                revert InvalidOrderTypeForKind(orderType, uint8(kind));
            }
            if (sizeDeltaUsd != 0) revert NonzeroSizeForSwap();
            if (collateralDelta == 0) revert ZeroCollateralAmount();
        }
        if (
            (orderType == LIMIT_SWAP
                    || orderType == LIMIT_INCREASE
                    || orderType == LIMIT_DECREASE
                    || orderType == STOP_LOSS_DECREASE
                    || orderType == STOP_INCREASE) && triggerPrice == 0
        ) {
            revert LimitOrderMissingTrigger(orderType);
        }
        if (swapPath.length > MAX_SWAP_PATH_LENGTH) revert SwapPathTooLong(swapPath.length);
    }

    function _validateMarketMembership(address market, address collateral) private view {
        GmxV2MarketProps memory props = reader.getMarket(address(dataStore), market);
        if (props.marketToken == address(0)) revert MarketMissing(market);
        if (collateral != props.longToken && collateral != props.shortToken) {
            revert MarketMembershipMismatch(market, collateral);
        }
    }

    function _reserve(GmxV2OrderKind kind, address collateral, uint256 collateralAmount, uint256 executionFee) private {
        uint256 nativeInventoriedBefore = _nativeInventoried;
        uint256 nativeReservedBefore = _nativeReserved;
        if (nativeReservedBefore + executionFee > nativeInventoriedBefore) {
            revert NativeOverReserved(executionFee, nativeInventoriedBefore, nativeReservedBefore);
        }
        _nativeReserved = nativeReservedBefore + executionFee;
        // Decrease orders never reserve collateral: initialCollateralDeltaAmount is withdrawal intent.
        if (kind == GmxV2OrderKind.Decrease) return;
        uint256 inventoriedCollateral = _inventory[collateral];
        uint256 reservedCollateral = _reserved[collateral];
        if (reservedCollateral + collateralAmount > inventoriedCollateral) {
            revert OverReserved(collateral, collateralAmount, inventoriedCollateral, reservedCollateral);
        }
        _reserved[collateral] = reservedCollateral + collateralAmount;
    }

    function _releaseStaged(StagedGmxV2Order storage staged) private {
        uint256 executionFee = staged.executionFee;
        if (_nativeReserved < executionFee) {
            revert NativeOverReserved(executionFee, _nativeInventoried, _nativeReserved);
        }
        _nativeReserved -= executionFee;
        if (staged.kind == GmxV2OrderKind.Decrease) return;
        address collateral = staged.initialCollateralToken;
        uint256 collateralAmount = staged.initialCollateralDeltaAmount;
        if (_reserved[collateral] < collateralAmount) {
            revert OverReserved(collateral, collateralAmount, _inventory[collateral], _reserved[collateral]);
        }
        _reserved[collateral] -= collateralAmount;
    }

    /// @notice Releases a stored request reservation exactly once; loud on double release.
    function _releaseOnce(bytes32 requestHash, StoredGmxV2Request storage storedReq) private {
        if (storedReq.reservationReleased) revert ReservationAlreadyReleased(requestHash);
        storedReq.reservationReleased = true;
        uint256 executionFee = storedReq.executionFee;
        if (_nativeReserved < executionFee) {
            revert NativeOverReserved(executionFee, _nativeInventoried, _nativeReserved);
        }
        _nativeReserved -= executionFee;
        if (storedReq.kind == GmxV2OrderKind.Decrease) return;
        address collateral = storedReq.initialCollateralToken;
        uint256 collateralAmount = storedReq.collateralAmount;
        if (_reserved[collateral] < collateralAmount) {
            revert OverReserved(collateral, collateralAmount, _inventory[collateral], _reserved[collateral]);
        }
        _reserved[collateral] -= collateralAmount;
    }

    function _validateAsyncBounds(ExternalVenueRequest calldata request) private view {
        if (
            request.timeoutAt <= request.binding.deadline || request.recoveryDeadline <= request.timeoutAt
                || AccountId.unwrap(request.interimExposureOwner) == bytes32(0)
                || request.recoveryPolicyHash == bytes32(0) || request.reservationHash == bytes32(0)
        ) revert InvalidAsyncBounds();
        uint256 absMin = _absolute(request.binding.minValue);
        uint256 absMax = _absolute(request.binding.maxValue);
        uint256 bound = absMin > absMax ? absMin : absMax;
        if (request.maximumResidual > bound) revert InvalidAsyncBounds();
    }

    function _validateTerminalFallback(ExternalVenueRequest calldata request, OperationalBinding calldata binding)
        private
        pure
    {
        if (
            request.terminalFallback.state != OperationalActionState.Recovered
                && request.terminalFallback.state != OperationalActionState.NoEffect
        ) revert InvalidTerminalFallback();
        if (request.terminalFallback.postconditionsHash != binding.expectedPostconditionsHash) {
            revert InvalidTerminalFallback();
        }
        if (request.terminalFallback.outcomeHash == bytes32(0)) revert InvalidTerminalFallback();
        if (
            request.terminalFallback.realizedValue < binding.minValue
                || request.terminalFallback.realizedValue > binding.maxValue
        ) revert InvalidTerminalFallback();
        if (_absolute(request.terminalFallback.residualValue) > request.maximumResidual) {
            revert MaximumResidualExceeded(_absolute(request.terminalFallback.residualValue), request.maximumResidual);
        }
        if (
            request.terminalFallback.state == OperationalActionState.NoEffect
                && (request.terminalFallback.realizedValue != 0 || request.terminalFallback.residualValue != 0)
        ) revert InvalidTerminalFallback();
    }

    /// @notice Validates the canonical OrderEventUtils.createEventData shape, keys, and values.
    /// @dev Returns a commitment over the bounded order data plus the authenticated deltas used
    ///      for realized accounting. Every nested array is length-checked before hashing.
    function _validateAndCommitOrderData(
        bytes32 key,
        GmxV2EventTypes.EventLogData memory orderData,
        StagedGmxV2Order storage staged
    ) private view returns (bytes32 commitment, uint256 sizeDeltaUsd, uint256 collateralDelta) {
        if (orderData.addressItems.items.length != 7) revert InvalidOrderData(key);
        if (orderData.addressItems.arrayItems.length != 1) revert InvalidOrderData(key);
        if (orderData.uintItems.items.length != 12) revert InvalidOrderData(key);
        if (orderData.uintItems.arrayItems.length != 0) revert InvalidOrderData(key);
        if (orderData.intItems.items.length != 0 || orderData.intItems.arrayItems.length != 0) {
            revert InvalidOrderData(key);
        }
        if (orderData.boolItems.items.length != 3) revert InvalidOrderData(key);
        if (orderData.boolItems.arrayItems.length != 0) revert InvalidOrderData(key);
        if (orderData.bytes32Items.items.length != 0) revert InvalidOrderData(key);
        if (orderData.bytes32Items.arrayItems.length != 1) revert InvalidOrderData(key);
        if (orderData.bytesItems.items.length != 0 || orderData.bytesItems.arrayItems.length != 0) {
            revert InvalidOrderData(key);
        }
        if (orderData.stringItems.items.length != 0 || orderData.stringItems.arrayItems.length != 0) {
            revert InvalidOrderData(key);
        }

        _requireItemKey(orderData.addressItems.items[0].key, "account", key);
        _requireItemKey(orderData.addressItems.items[1].key, "receiver", key);
        _requireItemKey(orderData.addressItems.items[2].key, "callbackContract", key);
        _requireItemKey(orderData.addressItems.items[3].key, "uiFeeReceiver", key);
        _requireItemKey(orderData.addressItems.items[4].key, "market", key);
        _requireItemKey(orderData.addressItems.items[5].key, "initialCollateralToken", key);
        _requireItemKey(orderData.addressItems.items[6].key, "cancellationReceiver", key);
        _requireItemKey(orderData.addressItems.arrayItems[0].key, "swapPath", key);

        _requireItemKey(orderData.uintItems.items[0].key, "orderType", key);
        _requireItemKey(orderData.uintItems.items[1].key, "decreasePositionSwapType", key);
        _requireItemKey(orderData.uintItems.items[2].key, "sizeDeltaUsd", key);
        _requireItemKey(orderData.uintItems.items[3].key, "initialCollateralDeltaAmount", key);
        _requireItemKey(orderData.uintItems.items[4].key, "triggerPrice", key);
        _requireItemKey(orderData.uintItems.items[5].key, "acceptablePrice", key);
        _requireItemKey(orderData.uintItems.items[6].key, "executionFee", key);
        _requireItemKey(orderData.uintItems.items[7].key, "callbackGasLimit", key);
        _requireItemKey(orderData.uintItems.items[8].key, "minOutputAmount", key);
        _requireItemKey(orderData.uintItems.items[9].key, "updatedAtTime", key);
        _requireItemKey(orderData.uintItems.items[10].key, "validFromTime", key);
        _requireItemKey(orderData.uintItems.items[11].key, "srcChainId", key);

        _requireItemKey(orderData.boolItems.items[0].key, "isLong", key);
        _requireItemKey(orderData.boolItems.items[1].key, "shouldUnwrapNativeToken", key);
        _requireItemKey(orderData.boolItems.items[2].key, "autoCancel", key);

        _requireItemKey(orderData.bytes32Items.arrayItems[0].key, "dataList", key);

        if (orderData.addressItems.items[0].value != address(this)) {
            revert AccountMismatch(address(this), orderData.addressItems.items[0].value);
        }
        if (orderData.addressItems.items[1].value != staged.receiver) {
            revert OrderFieldMismatch(key);
        }
        if (orderData.addressItems.items[2].value != address(this)) {
            revert CallbackContractMismatch(address(this), orderData.addressItems.items[2].value);
        }
        if (orderData.addressItems.items[3].value != staged.uiFeeReceiver) {
            revert OrderFieldMismatch(key);
        }
        if (orderData.addressItems.items[4].value != staged.market) revert OrderFieldMismatch(key);
        if (orderData.addressItems.items[5].value != staged.initialCollateralToken) {
            revert OrderFieldMismatch(key);
        }
        if (orderData.addressItems.items[6].value != address(this)) {
            revert CancellationReceiverMismatch(address(this), orderData.addressItems.items[6].value);
        }

        if (orderData.addressItems.arrayItems[0].value.length > MAX_SWAP_PATH_LENGTH) {
            revert InvalidOrderData(key);
        }
        if (hashSwapPath(orderData.addressItems.arrayItems[0].value) != staged.swapPathHash) {
            revert OrderFieldMismatch(key);
        }

        if (orderData.uintItems.items[0].value != staged.orderType) revert OrderFieldMismatch(key);
        if (orderData.uintItems.items[1].value != NO_SWAP) revert OrderFieldMismatch(key);
        sizeDeltaUsd = orderData.uintItems.items[2].value;
        collateralDelta = orderData.uintItems.items[3].value;
        if (sizeDeltaUsd != staged.sizeDeltaUsd) revert OrderFieldMismatch(key);
        if (collateralDelta != staged.initialCollateralDeltaAmount) revert OrderFieldMismatch(key);
        if (orderData.uintItems.items[4].value != staged.triggerPrice) revert OrderFieldMismatch(key);
        if (orderData.uintItems.items[5].value != staged.acceptablePrice) revert OrderFieldMismatch(key);
        if (orderData.uintItems.items[6].value != staged.executionFee) revert OrderFieldMismatch(key);
        if (orderData.uintItems.items[7].value != callbackGasLimit) revert OrderFieldMismatch(key);
        // Adapter policy: no slippage floor, no delayed validity, same-chain only, no auto-cancel,
        // no auxiliary data. Each is bound here so keepers cannot substitute values.
        if (orderData.uintItems.items[8].value != 0) revert OrderFieldMismatch(key);
        if (orderData.uintItems.items[10].value != 0) revert OrderFieldMismatch(key);
        if (orderData.uintItems.items[11].value != 0) revert OrderFieldMismatch(key);

        if (orderData.boolItems.items[0].value != staged.isLong) revert OrderFieldMismatch(key);
        if (orderData.boolItems.items[1].value != staged.shouldUnwrapNativeToken) {
            revert OrderFieldMismatch(key);
        }
        if (orderData.boolItems.items[2].value) revert OrderFieldMismatch(key);

        if (orderData.bytes32Items.arrayItems[0].value.length != 0) revert OrderFieldMismatch(key);

        commitment = keccak256(abi.encode(orderData));
    }

    function _requireItemKey(string memory actual, string memory expected, bytes32 key) private pure {
        if (keccak256(bytes(actual)) != keccak256(bytes(expected))) revert InvalidOrderData(key);
    }

    /// @notice Bounds every nested array and dynamic element before hashing event data.
    function _hashBoundedEventData(GmxV2EventTypes.EventLogData memory eventData) private pure returns (bytes32) {
        _boundEventItems(eventData.addressItems.items.length, eventData.addressItems.arrayItems.length);
        _boundEventItems(eventData.uintItems.items.length, eventData.uintItems.arrayItems.length);
        _boundEventItems(eventData.intItems.items.length, eventData.intItems.arrayItems.length);
        _boundEventItems(eventData.boolItems.items.length, eventData.boolItems.arrayItems.length);
        _boundEventItems(eventData.bytes32Items.items.length, eventData.bytes32Items.arrayItems.length);
        _boundEventItems(eventData.bytesItems.items.length, eventData.bytesItems.arrayItems.length);
        _boundEventItems(eventData.stringItems.items.length, eventData.stringItems.arrayItems.length);
        _boundNestedAddresses(eventData.addressItems.arrayItems);
        _boundNestedUints(eventData.uintItems.arrayItems);
        _boundNestedInts(eventData.intItems.arrayItems);
        _boundNestedBools(eventData.boolItems.arrayItems);
        _boundNestedBytes32(eventData.bytes32Items.arrayItems);
        _boundBytesElements(eventData.bytesItems.items);
        _boundNestedBytesElements(eventData.bytesItems.arrayItems);
        _boundStringElements(eventData.stringItems.items);
        _boundNestedStringElements(eventData.stringItems.arrayItems);
        for (uint256 i = 0; i < eventData.addressItems.items.length; i++) {
            _boundStringLength(bytes(eventData.addressItems.items[i].key));
        }
        for (uint256 i = 0; i < eventData.uintItems.items.length; i++) {
            _boundStringLength(bytes(eventData.uintItems.items[i].key));
        }
        for (uint256 i = 0; i < eventData.intItems.items.length; i++) {
            _boundStringLength(bytes(eventData.intItems.items[i].key));
        }
        for (uint256 i = 0; i < eventData.boolItems.items.length; i++) {
            _boundStringLength(bytes(eventData.boolItems.items[i].key));
        }
        for (uint256 i = 0; i < eventData.bytes32Items.items.length; i++) {
            _boundStringLength(bytes(eventData.bytes32Items.items[i].key));
        }
        for (uint256 i = 0; i < eventData.bytesItems.items.length; i++) {
            _boundStringLength(bytes(eventData.bytesItems.items[i].key));
        }
        for (uint256 i = 0; i < eventData.stringItems.items.length; i++) {
            _boundStringLength(bytes(eventData.stringItems.items[i].key));
            _boundStringLength(bytes(eventData.stringItems.items[i].value));
        }
        return keccak256(abi.encode(eventData));
    }

    function _boundEventItems(uint256 items, uint256 arrayItems) private pure {
        if (items > MAX_EVENT_ITEMS || arrayItems > MAX_EVENT_ARRAY_ITEMS) revert EventDataOutOfBounds();
    }

    function _boundStringLength(bytes memory raw) private pure {
        if (raw.length > MAX_EVENT_BYTES) revert EventDataOutOfBounds();
    }

    function _boundNestedAddresses(GmxV2EventTypes.AddressArrayKeyValue[] memory arrayItems) private pure {
        for (uint256 i = 0; i < arrayItems.length; i++) {
            _boundStringLength(bytes(arrayItems[i].key));
            if (arrayItems[i].value.length > MAX_EVENT_ARRAY_ELEMENTS) revert EventDataOutOfBounds();
        }
    }

    function _boundNestedUints(GmxV2EventTypes.UintArrayKeyValue[] memory arrayItems) private pure {
        for (uint256 i = 0; i < arrayItems.length; i++) {
            _boundStringLength(bytes(arrayItems[i].key));
            if (arrayItems[i].value.length > MAX_EVENT_ARRAY_ELEMENTS) revert EventDataOutOfBounds();
        }
    }

    function _boundNestedInts(GmxV2EventTypes.IntArrayKeyValue[] memory arrayItems) private pure {
        for (uint256 i = 0; i < arrayItems.length; i++) {
            _boundStringLength(bytes(arrayItems[i].key));
            if (arrayItems[i].value.length > MAX_EVENT_ARRAY_ELEMENTS) revert EventDataOutOfBounds();
        }
    }

    function _boundNestedBools(GmxV2EventTypes.BoolArrayKeyValue[] memory arrayItems) private pure {
        for (uint256 i = 0; i < arrayItems.length; i++) {
            _boundStringLength(bytes(arrayItems[i].key));
            if (arrayItems[i].value.length > MAX_EVENT_ARRAY_ELEMENTS) revert EventDataOutOfBounds();
        }
    }

    function _boundNestedBytes32(GmxV2EventTypes.Bytes32ArrayKeyValue[] memory arrayItems) private pure {
        for (uint256 i = 0; i < arrayItems.length; i++) {
            _boundStringLength(bytes(arrayItems[i].key));
            if (arrayItems[i].value.length > MAX_EVENT_ARRAY_ELEMENTS) revert EventDataOutOfBounds();
        }
    }

    function _boundBytesElements(GmxV2EventTypes.BytesKeyValue[] memory items) private pure {
        for (uint256 i = 0; i < items.length; i++) {
            _boundStringLength(bytes(items[i].key));
            _boundStringLength(items[i].value);
        }
    }

    function _boundNestedBytesElements(GmxV2EventTypes.BytesArrayKeyValue[] memory arrayItems) private pure {
        for (uint256 i = 0; i < arrayItems.length; i++) {
            _boundStringLength(bytes(arrayItems[i].key));
            if (arrayItems[i].value.length > MAX_EVENT_ARRAY_ELEMENTS) revert EventDataOutOfBounds();
            for (uint256 j = 0; j < arrayItems[i].value.length; j++) {
                _boundStringLength(arrayItems[i].value[j]);
            }
        }
    }

    function _boundStringElements(GmxV2EventTypes.StringKeyValue[] memory items) private pure {
        for (uint256 i = 0; i < items.length; i++) {
            _boundStringLength(bytes(items[i].key));
            _boundStringLength(bytes(items[i].value));
        }
    }

    function _boundNestedStringElements(GmxV2EventTypes.StringArrayKeyValue[] memory arrayItems) private pure {
        for (uint256 i = 0; i < arrayItems.length; i++) {
            _boundStringLength(bytes(arrayItems[i].key));
            if (arrayItems[i].value.length > MAX_EVENT_ARRAY_ELEMENTS) revert EventDataOutOfBounds();
            for (uint256 j = 0; j < arrayItems[i].value.length; j++) {
                _boundStringLength(bytes(arrayItems[i].value[j]));
            }
        }
    }

    function _realizedForKind(GmxV2OrderKind kind, uint256 sizeDeltaUsd, uint256 collateralDelta)
        private
        pure
        returns (int256)
    {
        uint256 value = kind == GmxV2OrderKind.Swap ? collateralDelta : sizeDeltaUsd;
        if (value > uint256(uint256(type(int256).max))) revert RealizedOverflow(value);
        return int256(value);
    }

    function _absolute(int256 value) private pure returns (uint256) {
        if (value >= 0) return uint256(value);
        if (value == type(int256).min) return uint256(type(int256).max) + 1;
        return uint256(-value);
    }

    function _requireInitialAdmin(address initialAdmin) private pure returns (address) {
        if (initialAdmin == address(0)) revert ZeroInitialAdmin();
        return initialAdmin;
    }
}
