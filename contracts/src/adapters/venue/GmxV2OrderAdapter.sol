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
import {
    AdapterRuntimeDescriptor,
    ExternalVenueRequest,
    ExternalVenueResult,
    OperationalActionState
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
import {GmxV2OrderSubmissionLib} from "./GmxV2OrderSubmissionLib.sol";
import {GmxV2OrderCallbackLib} from "./GmxV2OrderCallbackLib.sol";
import {GmxV2OrderDependencies} from "./GmxV2OrderTypes.sol";

import {IGmxV2OrderAdapterLinkedErrors} from "./IGmxV2OrderAdapterLinkedErrors.sol";

contract GmxV2OrderAdapter is
    IGmxV2OrderAdapterLinkedErrors,
    IExternalVenueExecutionAdapterV1,
    AccessControlDefaultAdminRules,
    ReentrancyGuard
{
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
        return GmxV2OrderSubmissionLib.stageOrder(
            _dependencies(), _staged, _inventory, _reserved, _nativeInventoriedSlot(), _nativeReservedSlot(), inputs
        );
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
        GmxV2OrderSubmissionLib.withdrawInventory(_inventory, _reserved, token, amount, recipient);
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
        GmxV2OrderSubmissionLib.withdrawNativeInventory(
            _nativeInventoriedSlot(), _nativeReservedSlot(), amount, recipient
        );
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
        return GmxV2OrderSubmissionLib.submitExternalAction(
            _dependencies(),
            _staged,
            _inventory,
            _nativeInventoriedSlot(),
            _requests,
            _results,
            _resultStored,
            _orderToRequest,
            request
        );
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
        GmxV2OrderCallbackLib.afterOrderExecution(
            _dependencies(),
            _staged,
            _inventory,
            _reserved,
            _nativeInventoriedSlot(),
            _nativeReservedSlot(),
            _requests,
            _results,
            _resultStored,
            _orderToRequest,
            key,
            orderData,
            eventData
        );
    }

    /// @notice Exact GMX V2 cancellation callback entrypoint (IOrderCallbackReceiver).
    /// @dev Best effort by construction (the OrderHandler try/catches callbacks): moves to
    ///      Recovering with retained accounting and releases nothing; recovery reconciles.
    function afterOrderCancellation(
        bytes32 key,
        GmxV2EventTypes.EventLogData memory orderData,
        GmxV2EventTypes.EventLogData memory eventData
    ) external nonReentrant {
        GmxV2OrderCallbackLib.afterOrderCancellation(
            _dependencies(), _staged, _requests, _results, _resultStored, _orderToRequest, key, orderData, eventData
        );
    }

    /// @notice Exact GMX V2 frozen-order callback entrypoint (IOrderCallbackReceiver).
    /// @dev Best effort like cancellation: Recovering with retained accounting, no release.
    function afterOrderFrozen(
        bytes32 key,
        GmxV2EventTypes.EventLogData memory orderData,
        GmxV2EventTypes.EventLogData memory eventData
    ) external nonReentrant {
        GmxV2OrderCallbackLib.afterOrderFrozen(
            _dependencies(), _staged, _requests, _results, _resultStored, _orderToRequest, key, orderData, eventData
        );
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
        return GmxV2OrderCallbackLib.recoverExternalAction(
            _dependencies(),
            _inventory,
            _reserved,
            _nativeInventoriedSlot(),
            _nativeReservedSlot(),
            _requests,
            _results,
            _resultStored,
            requestHash
        );
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

    function _absolute(int256 value) private pure returns (uint256) {
        if (value >= 0) return uint256(value);
        if (value == type(int256).min) return uint256(type(int256).max) + 1;
        return uint256(-value);
    }

    /// Linked libraries execute in this contract's context and receive the immutable dependency graph explicitly.
    function _dependencies() private view returns (GmxV2OrderDependencies memory) {
        return GmxV2OrderDependencies({
            expectedChainId: expectedChainId,
            exchangeRouter: exchangeRouter,
            tokenTransferRouter: tokenTransferRouter,
            orderVault: orderVault,
            orderHandler: orderHandler,
            dataStore: dataStore,
            reader: reader,
            wnt: wnt,
            executor: executor,
            callbackGasLimit: callbackGasLimit
        });
    }

    function _nativeInventoriedSlot() private pure returns (bytes32 slot) {
        assembly ("memory-safe") {
            slot := _nativeInventoried.slot
        }
    }

    function _nativeReservedSlot() private pure returns (bytes32 slot) {
        assembly ("memory-safe") {
            slot := _nativeReserved.slot
        }
    }

    function _requireInitialAdmin(address initialAdmin) private pure returns (address) {
        if (initialAdmin == address(0)) revert ZeroInitialAdmin();
        return initialAdmin;
    }
}
