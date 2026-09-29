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

/// @notice Minimal Uniswap V3 SwapRouter02 (IV3SwapRouter) surface required for exact-input-single execution.
/// @dev SwapRouter02 takes no deadline in the swap tuple. The adapter enforces the staged deadline itself before
///      calling the router, inside the same transaction.
interface IUniswapV3ExactInputSingleRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

/// @notice Solver-funded Uniswap V3 exact-input-single external venue adapter.
/// @dev Binds one chain, one exact router, one exact executor caller, one delayed admin,
///      one action stager, and one inventory manager. Supports only AtomicSameDomain.
///      Staged actions are keyed by the canonical action hash and reserve solver inventory
///      per input token. Inventory is funded by ordinary ERC20 transfers plus explicit sync
///      that can only ever reflect the live balance. Submission is executor-only, marks
///      consumed before the external call, uses an exact transient allowance that is cleared,
///      verifies balance deltas and minimum output, releases the reservation, and stores an
///      immutable complete result. No arbitrary targets, no delegatecall, no caller calldata,
///      no partial fills, no async claims, and no admin path mutates a consumed result.
contract UniswapV3ExactInputSingleAdapter is
    IExternalVenueExecutionAdapterV1,
    AccessControlDefaultAdminRules,
    ReentrancyGuard
{
    using SafeERC20 for IERC20;

    bytes32 public constant ACTION_STAGER_ROLE = keccak256("SETRYN_UNISWAP_V3_STAGER_ROLE");
    bytes32 public constant INVENTORY_MANAGER_ROLE = keccak256("SETRYN_UNISWAP_V3_INVENTORY_MANAGER_ROLE");

    uint256 public immutable expectedChainId;
    IUniswapV3ExactInputSingleRouter public immutable swapRouter;
    address public immutable executor;

    struct StagedUniswapV3Swap {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        uint256 amountIn;
        uint256 amountOutMinimum;
        address recipient;
        uint64 deadline;
        bytes32 recipientPolicyHash;
        bool consumed;
        bool cancelled;
    }

    mapping(bytes32 actionHash => StagedUniswapV3Swap staged) private _staged;
    mapping(address token => uint256 inventoried) private _inventory;
    mapping(address token => uint256 reserved) private _reserved;
    mapping(bytes32 requestHash => ExternalVenueResult result) private _results;
    mapping(bytes32 requestHash => bool stored) private _resultStored;

    event UniswapV3SwapStaged(
        bytes32 indexed actionHash,
        address indexed tokenIn,
        address indexed tokenOut,
        uint24 fee,
        uint256 amountIn,
        uint256 amountOutMinimum,
        address recipient,
        uint64 deadline
    );
    event UniswapV3SwapCancelled(bytes32 indexed actionHash, address indexed tokenIn, uint256 amountIn);
    event UniswapV3InventorySynced(address indexed token, uint256 inventoried);
    event UniswapV3InventoryWithdrawn(
        address indexed token, address indexed recipient, uint256 amount, uint256 inventoried
    );
    event UniswapV3SwapCompleted(
        bytes32 indexed requestHash, bytes32 indexed actionHash, uint256 amountIn, uint256 amountOut
    );

    error WrongDeploymentChain(uint256 expectedChainId, uint256 actualChainId);
    error ZeroRouter();
    error ZeroInitialAdmin();
    error RouterWithoutCode(address router);
    error ZeroExecutor();
    error ExecutorWithoutCode(address executor);
    error ZeroActionStager();
    error ZeroInventoryManager();
    error ZeroToken();
    error SameToken(address token);
    error TokenWithoutCode(address token);
    error ZeroRecipient();
    error ZeroAmountIn();
    error ZeroMinimumOut();
    error ZeroFee();
    error ZeroRecipientPolicyHash();
    error ActionExpired(uint64 deadline, uint256 timestamp);
    error DuplicateAction(bytes32 actionHash);
    error OverReserved(address token, uint256 requested, uint256 inventoried, uint256 reserved);
    error UnknownStagedAction(bytes32 actionHash);
    error ActionCancelled(bytes32 actionHash);
    error ActionAlreadyConsumed(bytes32 actionHash);
    error ActionHashMismatch(bytes32 expected, bytes32 actual);
    error RecipientPolicyMismatch(bytes32 expected, bytes32 actual);
    error ExpectedPostconditionsMismatch(bytes32 expected, bytes32 actual);
    error BindingDeadlineMismatch(uint64 bindingDeadline, uint64 stagedDeadline);
    error BindingMinValueMismatch(int256 bindingMinValue, uint256 stagedMinimum);
    error RealizedValueOutOfRange(uint256 amountOut, int256 minValue, int256 maxValue);
    error OnlyExecutor(address caller, address expected);
    error UnsupportedGuaranteeClass();
    error InvalidAtomicBounds();
    error BindingChainMismatch(uint256 bindingChainId, uint256 actualChainId);
    error BindingExpired(uint64 deadline, uint256 timestamp);
    error InvalidBinding();
    error RequestAlreadySubmitted(bytes32 requestHash);
    error UnknownRequest(bytes32 requestHash);
    error InsufficientInventory(address token, uint256 balance, uint256 required);
    error MinimumOutputNotMet(uint256 amountOut, uint256 minimum);
    error InexactInputSpend(address token, uint256 expected, uint256 actual);
    error InexactOutputReceipt(address token, uint256 expected, uint256 actual);
    error AllowanceNotCleared(address token, uint256 allowance);
    error OutputOverflow(uint256 amountOut);
    error ZeroEvidenceCommitment();
    error InsufficientUnreserved(address token, uint256 requested, uint256 unreserved);
    error InsufficientBalance(address token, uint256 balance, uint256 requested);
    error NotAuthorizedToCancel(address caller);
    error NoRecoveryForAtomic();

    constructor(
        uint256 expectedChainId_,
        address router_,
        address executor_,
        uint48 defaultAdminDelay_,
        address initialAdmin_,
        address actionStager_,
        address inventoryManager_
    ) AccessControlDefaultAdminRules(defaultAdminDelay_, _requireInitialAdmin(initialAdmin_)) {
        if (expectedChainId_ == 0 || expectedChainId_ != block.chainid) {
            revert WrongDeploymentChain(expectedChainId_, block.chainid);
        }
        if (router_ == address(0)) revert ZeroRouter();
        if (router_.code.length == 0) revert RouterWithoutCode(router_);
        if (executor_ == address(0)) revert ZeroExecutor();
        if (executor_.code.length == 0) revert ExecutorWithoutCode(executor_);
        if (actionStager_ == address(0)) revert ZeroActionStager();
        if (inventoryManager_ == address(0)) revert ZeroInventoryManager();
        expectedChainId = expectedChainId_;
        swapRouter = IUniswapV3ExactInputSingleRouter(router_);
        executor = executor_;
        _grantRole(ACTION_STAGER_ROLE, actionStager_);
        _grantRole(INVENTORY_MANAGER_ROLE, inventoryManager_);
        _grantRole(ACTION_STAGER_ROLE, initialAdmin_);
        _grantRole(INVENTORY_MANAGER_ROLE, initialAdmin_);
    }

    function operationalAdapterDescriptor() external view returns (AdapterRuntimeDescriptor memory descriptor) {
        descriptor = AdapterRuntimeDescriptor({
            self: address(this),
            chainId: block.chainid,
            interfaceHash: OperationalAdapterLib.INTERFACE_EXTERNAL_VENUE,
            capabilityHash: OperationalAdapterLib.CAPABILITY_EXTERNAL_ATOMIC,
            proxyFree: true,
            valueMoving: true
        });
    }

    function hashStagedAction(
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint256 amountIn,
        uint256 amountOutMinimum,
        address recipient,
        uint64 deadline,
        bytes32 recipientPolicyHash
    ) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                "SetrynUniswapV3ExactInputSingleV1",
                tokenIn,
                tokenOut,
                fee,
                amountIn,
                amountOutMinimum,
                recipient,
                deadline,
                recipientPolicyHash
            )
        );
    }

    /// @notice Canonical executor-precommittable expected postconditions for staged constraints.
    /// @dev Fully precomputable (pure) before execution via off-chain re-encoding;
    ///      commits to the staged minimum output, deadline, and route, never the realized
    ///      amountOut, which is unknowable before the swap and lives only in evidenceHash
    ///      plus realizedValue.
    function hashExpectedPostconditions(
        bytes32 actionHash,
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint256 amountIn,
        uint256 amountOutMinimum,
        address recipient,
        uint64 deadline,
        bytes32 recipientPolicyHash
    ) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                "SetrynUniswapV3PostconditionsV1",
                actionHash,
                tokenIn,
                tokenOut,
                fee,
                amountIn,
                amountOutMinimum,
                recipient,
                deadline,
                recipientPolicyHash
            )
        );
    }

    function stageSwap(
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint256 amountIn,
        uint256 amountOutMinimum,
        address recipient,
        uint64 deadline,
        bytes32 recipientPolicyHash
    ) external onlyRole(ACTION_STAGER_ROLE) nonReentrant returns (bytes32 actionHash) {
        if (tokenIn == address(0) || tokenOut == address(0)) revert ZeroToken();
        if (tokenIn == tokenOut) revert SameToken(tokenIn);
        if (tokenIn.code.length == 0) revert TokenWithoutCode(tokenIn);
        if (tokenOut.code.length == 0) revert TokenWithoutCode(tokenOut);
        if (recipient == address(0)) revert ZeroRecipient();
        if (amountIn == 0) revert ZeroAmountIn();
        if (amountOutMinimum == 0) revert ZeroMinimumOut();
        if (fee == 0) revert ZeroFee();
        if (recipientPolicyHash == bytes32(0)) revert ZeroRecipientPolicyHash();
        if (deadline <= block.timestamp) revert ActionExpired(deadline, block.timestamp);

        actionHash = hashStagedAction(
            tokenIn, tokenOut, fee, amountIn, amountOutMinimum, recipient, deadline, recipientPolicyHash
        );
        if (_staged[actionHash].tokenIn != address(0)) revert DuplicateAction(actionHash);

        uint256 inventoried = _inventory[tokenIn];
        uint256 reservedBefore = _reserved[tokenIn];
        if (reservedBefore + amountIn > inventoried) {
            revert OverReserved(tokenIn, amountIn, inventoried, reservedBefore);
        }

        _staged[actionHash] = StagedUniswapV3Swap({
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            fee: fee,
            amountIn: amountIn,
            amountOutMinimum: amountOutMinimum,
            recipient: recipient,
            deadline: deadline,
            recipientPolicyHash: recipientPolicyHash,
            consumed: false,
            cancelled: false
        });
        _reserved[tokenIn] = reservedBefore + amountIn;

        emit UniswapV3SwapStaged(actionHash, tokenIn, tokenOut, fee, amountIn, amountOutMinimum, recipient, deadline);
    }

    function syncInventory(address token) external nonReentrant {
        if (token == address(0)) revert ZeroToken();
        if (token.code.length == 0) revert TokenWithoutCode(token);
        uint256 actual = IERC20(token).balanceOf(address(this));
        _inventory[token] = actual;
        emit UniswapV3InventorySynced(token, actual);
    }

    function withdrawInventory(address token, uint256 amount, address recipient)
        external
        onlyRole(INVENTORY_MANAGER_ROLE)
        nonReentrant
    {
        if (token == address(0)) revert ZeroToken();
        if (recipient == address(0)) revert ZeroRecipient();
        if (amount == 0) revert ZeroAmountIn();
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
            revert InexactOutputReceipt(token, amount, balanceBefore - balanceAfter);
        }
        emit UniswapV3InventoryWithdrawn(token, recipient, amount, inventoried - amount);
    }

    function cancelStagedAction(bytes32 actionHash) external nonReentrant {
        if (!hasRole(ACTION_STAGER_ROLE, msg.sender) && !hasRole(INVENTORY_MANAGER_ROLE, msg.sender)) {
            revert NotAuthorizedToCancel(msg.sender);
        }
        StagedUniswapV3Swap storage staged = _staged[actionHash];
        if (staged.tokenIn == address(0)) revert UnknownStagedAction(actionHash);
        if (staged.consumed) revert ActionAlreadyConsumed(actionHash);
        if (staged.cancelled) revert ActionCancelled(actionHash);
        staged.cancelled = true;
        _reserved[staged.tokenIn] -= staged.amountIn;
        emit UniswapV3SwapCancelled(actionHash, staged.tokenIn, staged.amountIn);
    }

    function submitExternalAction(ExternalVenueRequest calldata request)
        external
        nonReentrant
        returns (ExternalVenueResult memory result)
    {
        if (msg.sender != executor) revert OnlyExecutor(msg.sender, executor);
        if (request.guaranteeClass != ExecutionGuaranteeClass.AtomicSameDomain) {
            revert UnsupportedGuaranteeClass();
        }
        if (
            request.timeoutAt != 0 || request.recoveryDeadline != 0
                || AccountId.unwrap(request.interimExposureOwner) != bytes32(0)
                || request.recoveryPolicyHash != bytes32(0) || request.reservationHash != bytes32(0)
                || request.maximumResidual != 0 || request.terminalFallback.state != OperationalActionState.Unspecified
                || request.terminalFallback.realizedValue != 0 || request.terminalFallback.residualValue != 0
                || request.terminalFallback.postconditionsHash != bytes32(0)
                || request.terminalFallback.outcomeHash != bytes32(0)
        ) revert InvalidAtomicBounds();

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

        StagedUniswapV3Swap storage staged = _staged[binding.actionHash];
        if (staged.tokenIn == address(0)) revert UnknownStagedAction(binding.actionHash);
        if (staged.cancelled) revert ActionCancelled(binding.actionHash);
        if (staged.consumed) revert ActionAlreadyConsumed(binding.actionHash);
        if (block.timestamp > staged.deadline) revert ActionExpired(staged.deadline, block.timestamp);
        if (staged.recipientPolicyHash != binding.recipientPolicyHash) {
            revert RecipientPolicyMismatch(staged.recipientPolicyHash, binding.recipientPolicyHash);
        }
        bytes32 derived = hashStagedAction(
            staged.tokenIn,
            staged.tokenOut,
            staged.fee,
            staged.amountIn,
            staged.amountOutMinimum,
            staged.recipient,
            staged.deadline,
            staged.recipientPolicyHash
        );
        if (derived != binding.actionHash) revert ActionHashMismatch(binding.actionHash, derived);
        if (binding.deadline != staged.deadline) {
            revert BindingDeadlineMismatch(binding.deadline, staged.deadline);
        }
        if (binding.minValue < 0 || uint256(binding.minValue) != staged.amountOutMinimum) {
            revert BindingMinValueMismatch(binding.minValue, staged.amountOutMinimum);
        }
        bytes32 expectedPostconditions = hashExpectedPostconditions(
            binding.actionHash,
            staged.tokenIn,
            staged.tokenOut,
            staged.fee,
            staged.amountIn,
            staged.amountOutMinimum,
            staged.recipient,
            staged.deadline,
            staged.recipientPolicyHash
        );
        if (binding.expectedPostconditionsHash != expectedPostconditions) {
            revert ExpectedPostconditionsMismatch(expectedPostconditions, binding.expectedPostconditionsHash);
        }

        ExternalVenueRequest memory requestCopy = request;
        bytes32 requestHash = OperationalAdapterLib.hashExternalRequest(requestCopy);
        if (_resultStored[requestHash]) revert RequestAlreadySubmitted(requestHash);

        staged.consumed = true;

        address tokenIn = staged.tokenIn;
        address tokenOut = staged.tokenOut;
        uint256 amountIn = staged.amountIn;
        uint256 minimumOut = staged.amountOutMinimum;
        address recipient = staged.recipient;
        uint64 swapDeadline = staged.deadline;
        uint24 fee = staged.fee;

        uint256 inAdapterBefore = IERC20(tokenIn).balanceOf(address(this));
        if (inAdapterBefore < amountIn) revert InsufficientInventory(tokenIn, inAdapterBefore, amountIn);
        uint256 outAdapterBefore = IERC20(tokenOut).balanceOf(address(this));
        uint256 outRecipientBefore =
            recipient == address(this) ? outAdapterBefore : IERC20(tokenOut).balanceOf(recipient);

        IERC20(tokenIn).forceApprove(address(swapRouter), amountIn);
        uint256 amountOut = swapRouter.exactInputSingle(
            IUniswapV3ExactInputSingleRouter.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: fee,
                recipient: recipient,
                amountIn: amountIn,
                amountOutMinimum: minimumOut,
                sqrtPriceLimitX96: 0
            })
        );
        IERC20(tokenIn).forceApprove(address(swapRouter), 0);
        if (IERC20(tokenIn).allowance(address(this), address(swapRouter)) != 0) {
            revert AllowanceNotCleared(tokenIn, IERC20(tokenIn).allowance(address(this), address(swapRouter)));
        }

        if (amountOut < minimumOut) revert MinimumOutputNotMet(amountOut, minimumOut);
        if (amountOut > uint256(uint256(type(int256).max))) revert OutputOverflow(amountOut);
        int256 realized = int256(amountOut);
        if (realized < binding.minValue || realized > binding.maxValue) {
            revert RealizedValueOutOfRange(amountOut, binding.minValue, binding.maxValue);
        }

        uint256 inAdapterAfter = IERC20(tokenIn).balanceOf(address(this));
        if (inAdapterBefore - inAdapterAfter != amountIn) {
            revert InexactInputSpend(tokenIn, amountIn, inAdapterBefore - inAdapterAfter);
        }
        if (recipient == address(this)) {
            uint256 outAdapterAfter = IERC20(tokenOut).balanceOf(address(this));
            if (outAdapterAfter - outAdapterBefore != amountOut) {
                revert InexactOutputReceipt(tokenOut, amountOut, outAdapterAfter - outAdapterBefore);
            }
            _inventory[tokenOut] = outAdapterAfter;
        } else {
            uint256 outAdapterAfter = IERC20(tokenOut).balanceOf(address(this));
            if (outAdapterAfter != outAdapterBefore) {
                revert InexactOutputReceipt(tokenOut, 0, outAdapterAfter - outAdapterBefore);
            }
            uint256 outRecipientAfter = IERC20(tokenOut).balanceOf(recipient);
            if (outRecipientAfter - outRecipientBefore != amountOut) {
                revert InexactOutputReceipt(tokenOut, amountOut, outRecipientAfter - outRecipientBefore);
            }
            _inventory[tokenOut] = outAdapterAfter;
        }

        _reserved[tokenIn] -= amountIn;
        _inventory[tokenIn] = inAdapterAfter;

        bytes32 evidenceHash = keccak256(
            abi.encode(
                "SetrynUniswapV3EvidenceV1",
                expectedChainId,
                address(this),
                address(swapRouter),
                requestHash,
                binding.actionHash,
                tokenIn,
                tokenOut,
                fee,
                amountIn,
                amountOut,
                recipient,
                swapDeadline
            )
        );
        if (evidenceHash == bytes32(0)) revert ZeroEvidenceCommitment();

        result = ExternalVenueResult({
            state: OperationalActionState.Complete,
            realizedValue: int256(amountOut),
            residualValue: 0,
            postconditionsHash: binding.expectedPostconditionsHash,
            venueActionReference: binding.actionHash,
            evidenceHash: evidenceHash,
            recoveryOutcomeHash: bytes32(0)
        });
        _results[requestHash] = result;
        _resultStored[requestHash] = true;

        emit UniswapV3SwapCompleted(requestHash, binding.actionHash, amountIn, amountOut);
    }

    function reconcileExternalAction(bytes32 requestHash) external view returns (ExternalVenueResult memory result) {
        if (!_resultStored[requestHash]) revert UnknownRequest(requestHash);
        result = _results[requestHash];
    }

    function recoverExternalAction(bytes32) external pure returns (ExternalVenueResult memory) {
        revert NoRecoveryForAtomic();
    }

    function getStagedAction(bytes32 actionHash) external view returns (StagedUniswapV3Swap memory) {
        return _staged[actionHash];
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

    function resultStored(bytes32 requestHash) external view returns (bool) {
        return _resultStored[requestHash];
    }

    function _requireInitialAdmin(address initialAdmin) private pure returns (address) {
        if (initialAdmin == address(0)) {
            revert ZeroInitialAdmin();
        }
        return initialAdmin;
    }
}
