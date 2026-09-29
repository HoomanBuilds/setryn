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

/// @notice Minimal Aave V3 PoolAddressesProvider surface required for fail-closed Pool resolution.
interface IAaveV3PoolAddressesProvider {
    function getPool() external view returns (address);
}

/// @notice Minimal official Aave V3 Pool surface required for supply/withdraw execution.
interface IAaveV3Pool {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
    function withdraw(address asset, uint256 amount, address to) external returns (uint256);
}

/// @notice Solver-funded Aave V3 supply/withdraw external venue adapter.
/// @dev Binds one chain, one exact PoolAddressesProvider, one exact Pool resolved through
///      getPool and validated at staging and execution, one exact executor caller, one delayed
///      admin, one action stager, and one inventory manager. Supports only AtomicSameDomain.
///      Staged SUPPLY and WITHDRAW actions are keyed by distinct canonical action hashes and
///      reserve solver inventory per underlying asset for supply. Inventory is funded by ordinary
///      ERC20 transfers plus explicit sync that can only ever reflect the live balance.
///      Adapter-owned Aave position capacity is tracked explicitly per underlying asset in
///      managed position inventory. Only a successful supply whose onBehalfOf is address(this)
///      increases managed position capacity; an external onBehalfOf supply never creates
///      adapter-owned withdrawal capacity. Staged WITHDRAW actions reserve real managed
///      position capacity so concurrent actions cannot overbook the same aToken position.
///      Submission is executor-only, marks consumed before the external call, uses an exact
///      transient allowance for supply that is cleared, verifies exact balance deltas and exact
///      returned amounts, releases the supply reservation, decrements both reserved and
///      managed position capacity on successful exact withdraw, and stores an immutable
///      complete result. A revert rolls back the whole atomic submission, leaving staged,
///      inventory, and position state unchanged. Withdraw inventory is the adapter-owned
///      aToken position; the recipient must receive the exact underlying returned by
///      Pool.withdraw. No borrowing, no credit delegation, no flash loans, no arbitrary
///      calldata, no arbitrary targets, no approvals left behind, no partial fill claims,
///      and no admin path mutates a consumed result.
contract AaveV3SupplyWithdrawAdapter is
    IExternalVenueExecutionAdapterV1,
    AccessControlDefaultAdminRules,
    ReentrancyGuard
{
    using SafeERC20 for IERC20;

    bytes32 public constant ACTION_STAGER_ROLE = keccak256("SETRYN_AAVE_V3_STAGER_ROLE");
    bytes32 public constant INVENTORY_MANAGER_ROLE = keccak256("SETRYN_AAVE_V3_INVENTORY_MANAGER_ROLE");

    uint8 public constant KIND_SUPPLY = 1;
    uint8 public constant KIND_WITHDRAW = 2;

    uint256 public immutable expectedChainId;
    IAaveV3PoolAddressesProvider public immutable poolAddressesProvider;
    address public immutable expectedPool;
    address public immutable executor;

    struct StagedAaveV3Action {
        uint8 kind;
        address asset;
        uint256 amount;
        address onBehalfOfOrRecipient;
        uint16 referralCode;
        uint64 deadline;
        bytes32 policyHash;
        address expectedPool;
        bool consumed;
        bool cancelled;
    }

    mapping(bytes32 actionHash => StagedAaveV3Action staged) private _staged;
    mapping(address token => uint256 inventoried) private _inventory;
    mapping(address token => uint256 reserved) private _reserved;
    mapping(address token => uint256 managedPosition) private _managedPosition;
    mapping(address token => uint256 reservedPosition) private _reservedPosition;
    mapping(bytes32 requestHash => ExternalVenueResult result) private _results;
    mapping(bytes32 requestHash => bool stored) private _resultStored;

    event AaveV3SupplyStaged(
        bytes32 indexed actionHash,
        address indexed asset,
        uint256 amount,
        address indexed onBehalfOf,
        uint16 referralCode,
        uint64 deadline
    );
    event AaveV3WithdrawStaged(
        bytes32 indexed actionHash, address indexed asset, uint256 amount, address indexed recipient, uint64 deadline
    );
    event AaveV3ActionCancelled(bytes32 indexed actionHash, address indexed asset, uint256 amount, uint8 kind);
    event AaveV3InventorySynced(address indexed token, uint256 inventoried);
    event AaveV3InventoryWithdrawn(
        address indexed token, address indexed recipient, uint256 amount, uint256 inventoried
    );
    event AaveV3SupplyCompleted(
        bytes32 indexed requestHash, bytes32 indexed actionHash, address indexed asset, uint256 amount
    );
    event AaveV3WithdrawCompleted(
        bytes32 indexed requestHash, bytes32 indexed actionHash, address indexed asset, uint256 amount
    );

    error WrongDeploymentChain(uint256 expectedChainId, uint256 actualChainId);
    error ZeroInitialAdmin();
    error ZeroProvider();
    error ProviderWithoutCode(address provider);
    error ZeroExpectedPool();
    error ExpectedPoolWithoutCode(address pool);
    error PoolMismatch(address expected, address actual);
    error ZeroExecutor();
    error ExecutorWithoutCode(address executor);
    error ZeroActionStager();
    error ZeroInventoryManager();
    error ZeroAsset();
    error AssetWithoutCode(address asset);
    error ZeroOnBehalfOf();
    error ZeroRecipient();
    error ZeroAmount();
    error AmountOverflow(uint256 amount);
    error ZeroPolicyHash();
    error ActionExpired(uint64 deadline, uint256 timestamp);
    error DuplicateAction(bytes32 actionHash);
    error OverReserved(address token, uint256 requested, uint256 inventoried, uint256 reserved);
    error OverReservedPosition(address token, uint256 requested, uint256 managed, uint256 reserved);
    error InsufficientManagedPosition(address token, uint256 requested, uint256 managed, uint256 reserved);
    error UnknownStagedAction(bytes32 actionHash);
    error ActionCancelled(bytes32 actionHash);
    error ActionAlreadyConsumed(bytes32 actionHash);
    error ActionHashMismatch(bytes32 expected, bytes32 actual);
    error PolicyMismatch(bytes32 expected, bytes32 actual);
    error ExpectedPostconditionsMismatch(bytes32 expected, bytes32 actual);
    error BindingDeadlineMismatch(uint64 bindingDeadline, uint64 stagedDeadline);
    error BindingMinValueMismatch(int256 bindingMinValue, uint256 stagedAmount);
    error RealizedValueOutOfRange(uint256 realized, int256 minValue, int256 maxValue);
    error OnlyExecutor(address caller, address expected);
    error UnsupportedGuaranteeClass();
    error InvalidAtomicBounds();
    error BindingChainMismatch(uint256 bindingChainId, uint256 actualChainId);
    error BindingExpired(uint64 deadline, uint256 timestamp);
    error InvalidBinding();
    error RequestAlreadySubmitted(bytes32 requestHash);
    error UnknownRequest(bytes32 requestHash);
    error InsufficientInventory(address token, uint256 balance, uint256 required);
    error InexactSupplySpend(address token, uint256 expected, uint256 actual);
    error InexactWithdrawReceipt(address token, uint256 expected, uint256 actual);
    error InexactAdapterBalance(address token, uint256 expected, uint256 actual);
    error PartialWithdraw(uint256 expected, uint256 actual);
    error AllowanceNotCleared(address token, uint256 allowance);
    error ZeroEvidenceCommitment();
    error InsufficientUnreserved(address token, uint256 requested, uint256 unreserved);
    error InsufficientBalance(address token, uint256 balance, uint256 requested);
    error NotAuthorizedToCancel(address caller);
    error NoRecoveryForAtomic();
    error UnsupportedKind(uint8 kind);

    constructor(
        uint256 expectedChainId_,
        address provider_,
        address expectedPool_,
        address executor_,
        uint48 defaultAdminDelay_,
        address initialAdmin_,
        address actionStager_,
        address inventoryManager_
    ) AccessControlDefaultAdminRules(defaultAdminDelay_, _requireInitialAdmin(initialAdmin_)) {
        if (expectedChainId_ == 0 || expectedChainId_ != block.chainid) {
            revert WrongDeploymentChain(expectedChainId_, block.chainid);
        }
        if (provider_ == address(0)) revert ZeroProvider();
        if (provider_.code.length == 0) revert ProviderWithoutCode(provider_);
        if (expectedPool_ == address(0)) revert ZeroExpectedPool();
        if (expectedPool_.code.length == 0) revert ExpectedPoolWithoutCode(expectedPool_);
        address livePool = IAaveV3PoolAddressesProvider(provider_).getPool();
        if (livePool != expectedPool_) revert PoolMismatch(expectedPool_, livePool);
        if (executor_ == address(0)) revert ZeroExecutor();
        if (executor_.code.length == 0) revert ExecutorWithoutCode(executor_);
        if (actionStager_ == address(0)) revert ZeroActionStager();
        if (inventoryManager_ == address(0)) revert ZeroInventoryManager();
        expectedChainId = expectedChainId_;
        poolAddressesProvider = IAaveV3PoolAddressesProvider(provider_);
        expectedPool = expectedPool_;
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

    function hashStagedSupply(
        address asset,
        uint256 amount,
        address onBehalfOf,
        uint16 referralCode,
        uint64 deadline,
        bytes32 policyHash,
        address pool
    ) public pure returns (bytes32) {
        return keccak256(
            abi.encode("SetrynAaveV3SupplyV1", asset, amount, onBehalfOf, referralCode, deadline, policyHash, pool)
        );
    }

    function hashStagedWithdraw(
        address asset,
        uint256 amount,
        address recipient,
        uint64 deadline,
        bytes32 policyHash,
        address pool
    ) public pure returns (bytes32) {
        return keccak256(abi.encode("SetrynAaveV3WithdrawV1", asset, amount, recipient, deadline, policyHash, pool));
    }

    /// @notice Canonical executor-precommittable expected postconditions for a staged supply.
    /// @dev Fully precomputable (pure) before execution via off-chain re-encoding; commits to
    ///      the staged supply constraints, never to any realized value beyond the exact staged
    ///      amount which is itself staged.
    function hashSupplyPostconditions(
        bytes32 actionHash,
        address asset,
        uint256 amount,
        address onBehalfOf,
        uint16 referralCode,
        uint64 deadline,
        bytes32 policyHash,
        address pool
    ) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                "SetrynAaveV3SupplyPostconditionsV1",
                actionHash,
                asset,
                amount,
                onBehalfOf,
                referralCode,
                deadline,
                policyHash,
                pool
            )
        );
    }

    /// @notice Canonical executor-precommittable expected postconditions for a staged withdraw.
    /// @dev Fully precomputable (pure) before execution via off-chain re-encoding; commits to
    ///      the staged withdraw constraints, never to any realized value beyond the exact staged
    ///      amount which is itself staged.
    function hashWithdrawPostconditions(
        bytes32 actionHash,
        address asset,
        uint256 amount,
        address recipient,
        uint64 deadline,
        bytes32 policyHash,
        address pool
    ) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                "SetrynAaveV3WithdrawPostconditionsV1", actionHash, asset, amount, recipient, deadline, policyHash, pool
            )
        );
    }

    function stageSupply(
        address asset,
        uint256 amount,
        address onBehalfOf,
        uint16 referralCode,
        uint64 deadline,
        bytes32 policyHash
    ) external onlyRole(ACTION_STAGER_ROLE) nonReentrant returns (bytes32 actionHash) {
        if (asset == address(0)) revert ZeroAsset();
        if (asset.code.length == 0) revert AssetWithoutCode(asset);
        if (amount == 0) revert ZeroAmount();
        if (amount > uint256(uint256(type(int256).max))) revert AmountOverflow(amount);
        if (onBehalfOf == address(0)) revert ZeroOnBehalfOf();
        if (policyHash == bytes32(0)) revert ZeroPolicyHash();
        if (deadline <= block.timestamp) revert ActionExpired(deadline, block.timestamp);
        address livePool = poolAddressesProvider.getPool();
        if (livePool != expectedPool) revert PoolMismatch(expectedPool, livePool);
        if (livePool.code.length == 0) revert ExpectedPoolWithoutCode(livePool);

        actionHash = hashStagedSupply(asset, amount, onBehalfOf, referralCode, deadline, policyHash, livePool);
        if (_staged[actionHash].asset != address(0)) revert DuplicateAction(actionHash);

        uint256 inventoried = _inventory[asset];
        uint256 reservedBefore = _reserved[asset];
        if (reservedBefore + amount > inventoried) {
            revert OverReserved(asset, amount, inventoried, reservedBefore);
        }

        _staged[actionHash] = StagedAaveV3Action({
            kind: KIND_SUPPLY,
            asset: asset,
            amount: amount,
            onBehalfOfOrRecipient: onBehalfOf,
            referralCode: referralCode,
            deadline: deadline,
            policyHash: policyHash,
            expectedPool: livePool,
            consumed: false,
            cancelled: false
        });
        _reserved[asset] = reservedBefore + amount;

        emit AaveV3SupplyStaged(actionHash, asset, amount, onBehalfOf, referralCode, deadline);
    }

    function stageWithdraw(address asset, uint256 amount, address recipient, uint64 deadline, bytes32 policyHash)
        external
        onlyRole(ACTION_STAGER_ROLE)
        nonReentrant
        returns (bytes32 actionHash)
    {
        if (asset == address(0)) revert ZeroAsset();
        if (asset.code.length == 0) revert AssetWithoutCode(asset);
        if (amount == 0) revert ZeroAmount();
        if (amount > uint256(uint256(type(int256).max))) revert AmountOverflow(amount);
        if (recipient == address(0)) revert ZeroRecipient();
        if (policyHash == bytes32(0)) revert ZeroPolicyHash();
        if (deadline <= block.timestamp) revert ActionExpired(deadline, block.timestamp);
        address livePool = poolAddressesProvider.getPool();
        if (livePool != expectedPool) revert PoolMismatch(expectedPool, livePool);
        if (livePool.code.length == 0) revert ExpectedPoolWithoutCode(livePool);

        actionHash = hashStagedWithdraw(asset, amount, recipient, deadline, policyHash, livePool);
        if (_staged[actionHash].asset != address(0)) revert DuplicateAction(actionHash);

        uint256 managedBefore = _managedPosition[asset];
        uint256 reservedPositionBefore = _reservedPosition[asset];
        if (reservedPositionBefore + amount > managedBefore) {
            revert OverReservedPosition(asset, amount, managedBefore, reservedPositionBefore);
        }

        _staged[actionHash] = StagedAaveV3Action({
            kind: KIND_WITHDRAW,
            asset: asset,
            amount: amount,
            onBehalfOfOrRecipient: recipient,
            referralCode: 0,
            deadline: deadline,
            policyHash: policyHash,
            expectedPool: livePool,
            consumed: false,
            cancelled: false
        });
        _reservedPosition[asset] = reservedPositionBefore + amount;

        emit AaveV3WithdrawStaged(actionHash, asset, amount, recipient, deadline);
    }

    function syncInventory(address token) external nonReentrant {
        if (token == address(0)) revert ZeroAsset();
        if (token.code.length == 0) revert AssetWithoutCode(token);
        uint256 actual = IERC20(token).balanceOf(address(this));
        _inventory[token] = actual;
        emit AaveV3InventorySynced(token, actual);
    }

    function withdrawInventory(address token, uint256 amount, address recipient)
        external
        onlyRole(INVENTORY_MANAGER_ROLE)
        nonReentrant
    {
        if (token == address(0)) revert ZeroAsset();
        if (recipient == address(0)) revert ZeroRecipient();
        if (amount == 0) revert ZeroAmount();
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
            revert InexactWithdrawReceipt(token, amount, balanceBefore - balanceAfter);
        }
        emit AaveV3InventoryWithdrawn(token, recipient, amount, inventoried - amount);
    }

    function cancelStagedAction(bytes32 actionHash) external nonReentrant {
        if (!hasRole(ACTION_STAGER_ROLE, msg.sender) && !hasRole(INVENTORY_MANAGER_ROLE, msg.sender)) {
            revert NotAuthorizedToCancel(msg.sender);
        }
        StagedAaveV3Action storage staged = _staged[actionHash];
        if (staged.asset == address(0)) revert UnknownStagedAction(actionHash);
        if (staged.consumed) revert ActionAlreadyConsumed(actionHash);
        if (staged.cancelled) revert ActionCancelled(actionHash);
        staged.cancelled = true;
        if (staged.kind == KIND_SUPPLY) {
            _reserved[staged.asset] -= staged.amount;
        } else if (staged.kind == KIND_WITHDRAW) {
            _reservedPosition[staged.asset] -= staged.amount;
        } else {
            revert UnsupportedKind(staged.kind);
        }
        emit AaveV3ActionCancelled(actionHash, staged.asset, staged.amount, staged.kind);
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

        StagedAaveV3Action storage staged = _staged[binding.actionHash];
        if (staged.asset == address(0)) revert UnknownStagedAction(binding.actionHash);
        if (staged.cancelled) revert ActionCancelled(binding.actionHash);
        if (staged.consumed) revert ActionAlreadyConsumed(binding.actionHash);
        if (block.timestamp > staged.deadline) revert ActionExpired(staged.deadline, block.timestamp);
        if (staged.policyHash != binding.recipientPolicyHash) {
            revert PolicyMismatch(staged.policyHash, binding.recipientPolicyHash);
        }

        bytes32 derived;
        bytes32 expectedPostconditions;
        if (staged.kind == KIND_SUPPLY) {
            derived = hashStagedSupply(
                staged.asset,
                staged.amount,
                staged.onBehalfOfOrRecipient,
                staged.referralCode,
                staged.deadline,
                staged.policyHash,
                staged.expectedPool
            );
            expectedPostconditions = hashSupplyPostconditions(
                binding.actionHash,
                staged.asset,
                staged.amount,
                staged.onBehalfOfOrRecipient,
                staged.referralCode,
                staged.deadline,
                staged.policyHash,
                staged.expectedPool
            );
        } else if (staged.kind == KIND_WITHDRAW) {
            derived = hashStagedWithdraw(
                staged.asset,
                staged.amount,
                staged.onBehalfOfOrRecipient,
                staged.deadline,
                staged.policyHash,
                staged.expectedPool
            );
            expectedPostconditions = hashWithdrawPostconditions(
                binding.actionHash,
                staged.asset,
                staged.amount,
                staged.onBehalfOfOrRecipient,
                staged.deadline,
                staged.policyHash,
                staged.expectedPool
            );
        } else {
            revert UnsupportedKind(staged.kind);
        }
        if (derived != binding.actionHash) revert ActionHashMismatch(binding.actionHash, derived);
        if (binding.deadline != staged.deadline) {
            revert BindingDeadlineMismatch(binding.deadline, staged.deadline);
        }
        int256 stagedValue = int256(staged.amount);
        if (binding.minValue > stagedValue) {
            revert BindingMinValueMismatch(binding.minValue, staged.amount);
        }
        if (stagedValue > binding.maxValue) {
            revert RealizedValueOutOfRange(staged.amount, binding.minValue, binding.maxValue);
        }
        if (binding.expectedPostconditionsHash != expectedPostconditions) {
            revert ExpectedPostconditionsMismatch(expectedPostconditions, binding.expectedPostconditionsHash);
        }

        ExternalVenueRequest memory requestCopy = request;
        bytes32 requestHash = OperationalAdapterLib.hashExternalRequest(requestCopy);
        if (_resultStored[requestHash]) revert RequestAlreadySubmitted(requestHash);

        staged.consumed = true;

        address livePool = poolAddressesProvider.getPool();
        if (livePool != staged.expectedPool || livePool != expectedPool) {
            revert PoolMismatch(staged.expectedPool, livePool);
        }
        if (livePool.code.length == 0) revert ExpectedPoolWithoutCode(livePool);

        if (staged.kind == KIND_SUPPLY) {
            result = _executeSupply(requestHash, binding, staged, livePool);
        } else {
            result = _executeWithdraw(requestHash, binding, staged, livePool);
        }

        _results[requestHash] = result;
        _resultStored[requestHash] = true;
    }

    function reconcileExternalAction(bytes32 requestHash) external view returns (ExternalVenueResult memory result) {
        if (!_resultStored[requestHash]) revert UnknownRequest(requestHash);
        result = _results[requestHash];
    }

    function recoverExternalAction(bytes32) external pure returns (ExternalVenueResult memory) {
        revert NoRecoveryForAtomic();
    }

    function getStagedAction(bytes32 actionHash) external view returns (StagedAaveV3Action memory) {
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

    function managedPositionCapacity(address token) external view returns (uint256) {
        return _managedPosition[token];
    }

    function reservedPositionCapacity(address token) external view returns (uint256) {
        return _reservedPosition[token];
    }

    function unreservedPositionCapacity(address token) external view returns (uint256) {
        uint256 managed = _managedPosition[token];
        uint256 reservedPositionAmount = _reservedPosition[token];
        return managed > reservedPositionAmount ? managed - reservedPositionAmount : 0;
    }

    function resultStored(bytes32 requestHash) external view returns (bool) {
        return _resultStored[requestHash];
    }

    function _executeSupply(
        bytes32 requestHash,
        OperationalBinding calldata binding,
        StagedAaveV3Action storage staged,
        address livePool
    ) private returns (ExternalVenueResult memory result) {
        address asset = staged.asset;
        uint256 amount = staged.amount;
        address onBehalfOf = staged.onBehalfOfOrRecipient;
        uint16 referralCode = staged.referralCode;
        uint64 deadline = staged.deadline;

        uint256 adapterBefore = IERC20(asset).balanceOf(address(this));
        if (adapterBefore < amount) revert InsufficientInventory(asset, adapterBefore, amount);

        IERC20(asset).forceApprove(livePool, amount);
        IAaveV3Pool(livePool).supply(asset, amount, onBehalfOf, referralCode);
        IERC20(asset).forceApprove(livePool, 0);
        if (IERC20(asset).allowance(address(this), livePool) != 0) {
            revert AllowanceNotCleared(asset, IERC20(asset).allowance(address(this), livePool));
        }

        if (amount > uint256(uint256(type(int256).max))) revert AmountOverflow(amount);
        int256 realized = int256(amount);
        if (realized < binding.minValue || realized > binding.maxValue) {
            revert RealizedValueOutOfRange(amount, binding.minValue, binding.maxValue);
        }

        uint256 adapterAfter = IERC20(asset).balanceOf(address(this));
        if (adapterBefore - adapterAfter != amount) {
            revert InexactSupplySpend(asset, amount, adapterBefore - adapterAfter);
        }

        _reserved[asset] -= amount;
        _inventory[asset] = adapterAfter;
        if (onBehalfOf == address(this)) {
            _managedPosition[asset] += amount;
        }

        bytes32 evidenceHash = keccak256(
            abi.encode(
                "SetrynAaveV3SupplyEvidenceV1",
                expectedChainId,
                address(this),
                address(poolAddressesProvider),
                livePool,
                requestHash,
                binding.actionHash,
                asset,
                amount,
                onBehalfOf,
                referralCode,
                deadline
            )
        );
        if (evidenceHash == bytes32(0)) revert ZeroEvidenceCommitment();

        result = ExternalVenueResult({
            state: OperationalActionState.Complete,
            realizedValue: realized,
            residualValue: 0,
            postconditionsHash: binding.expectedPostconditionsHash,
            venueActionReference: binding.actionHash,
            evidenceHash: evidenceHash,
            recoveryOutcomeHash: bytes32(0)
        });

        emit AaveV3SupplyCompleted(requestHash, binding.actionHash, asset, amount);
    }

    function _executeWithdraw(
        bytes32 requestHash,
        OperationalBinding calldata binding,
        StagedAaveV3Action storage staged,
        address livePool
    ) private returns (ExternalVenueResult memory result) {
        address asset = staged.asset;
        uint256 amount = staged.amount;
        address recipient = staged.onBehalfOfOrRecipient;
        uint64 deadline = staged.deadline;

        uint256 adapterBefore = IERC20(asset).balanceOf(address(this));
        uint256 recipientBefore = recipient == address(this) ? adapterBefore : IERC20(asset).balanceOf(recipient);

        uint256 returned = IAaveV3Pool(livePool).withdraw(asset, amount, recipient);
        if (returned != amount) revert PartialWithdraw(amount, returned);
        if (returned == 0) revert ZeroAmount();
        if (returned > uint256(uint256(type(int256).max))) revert AmountOverflow(returned);
        int256 realized = int256(returned);
        if (realized < binding.minValue || realized > binding.maxValue) {
            revert RealizedValueOutOfRange(returned, binding.minValue, binding.maxValue);
        }

        if (recipient == address(this)) {
            uint256 adapterAfter = IERC20(asset).balanceOf(address(this));
            if (adapterAfter - adapterBefore != returned) {
                revert InexactWithdrawReceipt(asset, returned, adapterAfter - adapterBefore);
            }
            _inventory[asset] = adapterAfter;
        } else {
            uint256 adapterAfter = IERC20(asset).balanceOf(address(this));
            if (adapterAfter != adapterBefore) {
                revert InexactAdapterBalance(asset, adapterBefore, adapterAfter);
            }
            uint256 recipientAfter = IERC20(asset).balanceOf(recipient);
            if (recipientAfter - recipientBefore != returned) {
                revert InexactWithdrawReceipt(asset, returned, recipientAfter - recipientBefore);
            }
            _inventory[asset] = adapterAfter;
        }

        uint256 reservedPositionBefore = _reservedPosition[asset];
        uint256 managedBefore = _managedPosition[asset];
        if (amount > reservedPositionBefore || amount > managedBefore) {
            revert InsufficientManagedPosition(asset, amount, managedBefore, reservedPositionBefore);
        }
        _reservedPosition[asset] = reservedPositionBefore - amount;
        _managedPosition[asset] = managedBefore - amount;

        bytes32 evidenceHash = keccak256(
            abi.encode(
                "SetrynAaveV3WithdrawEvidenceV1",
                expectedChainId,
                address(this),
                address(poolAddressesProvider),
                livePool,
                requestHash,
                binding.actionHash,
                asset,
                amount,
                returned,
                recipient,
                deadline
            )
        );
        if (evidenceHash == bytes32(0)) revert ZeroEvidenceCommitment();

        result = ExternalVenueResult({
            state: OperationalActionState.Complete,
            realizedValue: realized,
            residualValue: 0,
            postconditionsHash: binding.expectedPostconditionsHash,
            venueActionReference: binding.actionHash,
            evidenceHash: evidenceHash,
            recoveryOutcomeHash: bytes32(0)
        });

        emit AaveV3WithdrawCompleted(requestHash, binding.actionHash, asset, returned);
    }

    function _requireInitialAdmin(address initialAdmin) private pure returns (address) {
        if (initialAdmin == address(0)) {
            revert ZeroInitialAdmin();
        }
        return initialAdmin;
    }
}
