// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {LockStatus} from "../types/Enums.sol";
import {AccountId, AssetId, CollateralId, CollateralLockId} from "../types/Identifiers.sol";
import {CollateralLock} from "../types/CollateralTypes.sol";
import {ISettlementAssetRegistry} from "./ISettlementAssetRegistry.sol";

/// @dev The first value-custody contract in the protocol. It holds ERC-20 collateral for segregated
/// accounts, keyed by the exact settlement binding the collateral was deposited under, and lets
/// bounded operators pledge and settle that collateral without ever being able to withdraw it.
///
/// @dev Every balance is keyed by AccountId plus an exact CollateralId, and a CollateralId commits
/// to one immutable binding version. A replacement or requalification of the same physical token is
/// a new binding version and therefore a new CollateralId, so balances under an older binding are
/// never silently merged forward. Aggregate liability is tracked twice for exactly that reason: per
/// CollateralId for per-binding accounting, and per token address because several binding versions
/// may alias one physical token and solvency is a property of the token contract, not of the
/// binding.
///
/// @dev Custody invariants this contract is responsible for. One, every credited unit is backed by a
/// unit actually received: there is no admin credit path, no minting, and no unbacked balance. Two,
/// withdrawal never requires the binding to be Active, only to have existed, so pausing or
/// deprecating an asset can never strand a credited balance. Three, locked collateral is never
/// withdrawable, transferable, or consumable beyond the lock that pledged it. Four, a lock operator
/// creates a pledge and may give it back early, but it can never move collateral to another account
/// and never out of the vault: only the one settlement operator pinned into the lock at creation can
/// consume it, and only ever into another account of this same vault. Five, recovery can only ever
/// touch token balance strictly above total token liability.
///
/// @dev The two-layer trust boundary behind every pledge. The account controller decides which lock
/// operators may pledge its collateral at all, and governance decides which addresses may hold the
/// narrow global settler role. A lock operator then picks the settlement engine for its own lock,
/// but only from inside that intersection: it must already have been approved by the controller, and
/// the engine it names must already hold the settler role. Neither layer alone is enough, and the
/// pinning means a later grant of the settler role to a new address gives that address no power over
/// any lock already created.
///
/// @dev Explicit non-features. No native ETH path, no payable receive or fallback, no delegatecall,
/// no arbitrary target call, no approval the vault ever grants, no upgradeability, and no silent
/// binding to the registry's moving activeVersion pointer. Every entry point that names a binding
/// names the exact immutable version.
///
/// @dev Runtime exact-transfer checks reject fee-on-transfer, short-receipt, and malformed transfer
/// behavior, but they do not make an arbitrary ERC-20 safe. Excluding rebasing, reentrant, upgradable
/// and otherwise adversarial tokens remains the job of the offchain qualification evidence committed
/// to in the settlement asset registry.
interface ICollateralVault {
    event AccountCreated(AccountId indexed accountId, address indexed controller, bytes32 salt);

    event AccountControlProposed(
        AccountId indexed accountId, address indexed controller, address indexed pendingController
    );

    event AccountControlProposalCancelled(
        AccountId indexed accountId, address indexed controller, address indexed cancelledController
    );

    /// @dev newLockOperatorEpoch is the generation the account moved to, so an indexer can mark every
    /// approval granted under an earlier epoch dead from this log alone.
    event AccountControlTransferred(
        AccountId indexed accountId,
        address indexed previousController,
        address indexed newController,
        uint64 newLockOperatorEpoch
    );

    /// @dev epoch is the generation the approval was written under. It is live only while it still
    /// equals the account's current epoch, so a later control transfer retires this log entry without
    /// emitting a revocation for it.
    event LockOperatorSet(
        AccountId indexed accountId, address indexed operator, bool approved, uint64 epoch, address indexed controller
    );

    /// @dev Carries the resolved token and the exact binding alongside the CollateralId so an indexer
    /// can rebuild the whole ledger from logs without replaying registry state. The vault keeps no
    /// enumerable arrays; these events are the enumeration source.
    event CollateralDeposited(
        AccountId indexed accountId,
        CollateralId indexed collateralId,
        address indexed token,
        AssetId assetId,
        uint32 bindingVersion,
        address payer,
        uint128 amount,
        uint128 newTotal
    );

    event CollateralWithdrawn(
        AccountId indexed accountId,
        CollateralId indexed collateralId,
        address indexed token,
        AssetId assetId,
        uint32 bindingVersion,
        address controller,
        address recipient,
        uint128 amount,
        uint128 newTotal
    );

    event CollateralTransferred(
        AccountId indexed fromAccountId,
        AccountId indexed toAccountId,
        CollateralId indexed collateralId,
        uint128 amount,
        uint128 newFromTotal,
        uint128 newToTotal,
        address controller
    );

    /// @dev lockReference is carried so a manager can correlate the derived lockId back to its own
    /// key, and settlementOperator so a reviewer can see from logs alone which single engine was
    /// pinned to this pledge.
    event CollateralLockCreated(
        CollateralLockId indexed lockId,
        AccountId indexed accountId,
        CollateralId indexed collateralId,
        bytes32 lockReference,
        AssetId assetId,
        uint32 bindingVersion,
        address operator,
        address settlementOperator,
        uint128 amount,
        uint64 expiry
    );

    /// @dev One event for both give-back paths. newStatus distinguishes an early operator release
    /// from a permissionless expiry sweep, and releasedAmount is whatever was still pledged.
    event CollateralLockReleased(
        CollateralLockId indexed lockId,
        AccountId indexed accountId,
        CollateralId indexed collateralId,
        uint128 releasedAmount,
        LockStatus newStatus,
        address caller
    );

    event CollateralLockConsumed(
        CollateralLockId indexed lockId,
        AccountId indexed payerAccountId,
        AccountId indexed recipientAccountId,
        CollateralId collateralId,
        uint128 amount,
        uint128 remainingAmount,
        LockStatus newStatus,
        address settler
    );

    /// @dev tokenLiability is logged as it stood before the transfer, so a reviewer can verify from
    /// logs alone that the recovered amount sat strictly above backing.
    event ExcessRecovered(
        AssetId indexed assetId,
        address indexed token,
        address indexed recipient,
        uint32 bindingVersion,
        uint128 amount,
        uint256 tokenLiability,
        address operator
    );

    error ZeroInitialAdmin();

    error ZeroSettlementAssetRegistry();

    error SettlementAssetRegistryHasNoCode(address settlementAssetRegistry);

    error ZeroMaxLockDuration();

    error AccountAlreadyExists(AccountId accountId);

    error UnknownAccount(AccountId accountId);

    error NotAccountController(AccountId accountId, address caller);

    error ZeroController();

    error ControllerUnchanged(AccountId accountId, address controller);

    error NoPendingController(AccountId accountId);

    error NotPendingController(AccountId accountId, address caller);

    /// @dev Unreachable in practice: it needs 2^64 - 1 completed handovers on one account. It is
    /// named rather than left to wrap because a silently wrapped epoch would resurrect every
    /// approval granted under generation zero.
    error LockOperatorEpochExhausted(AccountId accountId);

    error ZeroLockOperator();

    error ZeroAmount();

    error ZeroRecipient();

    /// @dev The vault is never a valid transfer destination. Sending to itself would leave the
    /// ledger debited while the tokens never left, which is the one shape the exact-transfer check
    /// cannot distinguish from a successful move.
    error VaultRecipient();

    /// @dev Raised for a version the settlement registry never registered. It is the fail-closed
    /// answer for an unsupported collateral asset on every path, including the withdrawal path.
    error UnknownBindingVersion(AssetId assetId, uint32 bindingVersion);

    error BindingClosedForNewRisk(AssetId assetId, uint32 bindingVersion);

    error InsufficientAvailable(AccountId accountId, CollateralId collateralId, uint128 available, uint128 requested);

    error BalanceOverflow(AccountId accountId, CollateralId collateralId, uint128 current, uint128 amount);

    error SelfTransfer(AccountId accountId);

    /// @dev The vault received fewer units than it asked for, or more. Either way the deposit is
    /// rejected before anything is credited, which is what keeps fee-on-transfer, short-receipt, and
    /// silently-no-op tokens from producing an unbacked balance.
    error InexactDepositReceipt(address token, uint128 amount, uint256 balanceBefore, uint256 balanceAfter);

    /// @dev The vault balance did not fall by exactly the amount, or the recipient balance did not
    /// rise by exactly the amount. The whole call reverts atomically rather than leaving a debited
    /// ledger behind a partial transfer.
    error InexactTransferSettlement(address token, address recipient, uint128 amount);

    error ZeroLockReference();

    error ZeroSettlementOperator();

    /// @dev The engine the lock operator named does not hold the global settler role, so it may not
    /// be pinned. Checked at creation rather than at consumption so a lock is never created against
    /// an engine that could never settle it.
    error SettlementOperatorNotAuthorized(address settlementOperator);

    /// @dev The caller holds the global settler role but is not the engine pinned into this lock.
    /// The role is a necessary condition for consumption, never a sufficient one.
    error NotLockSettlementOperator(CollateralLockId lockId, address pinnedSettlementOperator, address caller);

    error LockAlreadyExists(CollateralLockId lockId);

    error UnknownLock(CollateralLockId lockId);

    error LockNotActive(CollateralLockId lockId, LockStatus status);

    error LockExpired(CollateralLockId lockId, uint64 expiry);

    error LockNotExpired(CollateralLockId lockId, uint64 expiry);

    error InvalidLockExpiry(uint64 expiry, uint64 nowTs, uint256 maxExpiry);

    error LockOperatorNotApproved(AccountId accountId, address operator);

    error NotLockOperator(CollateralLockId lockId, address caller);

    /// @dev The original operator kept the lock but lost the global locker role, so it may no longer
    /// act. The lock is not stranded: the permissionless expiry path still returns the collateral.
    error LockOperatorNotAuthorized(CollateralLockId lockId, address operator);

    error AmountAboveLockRemaining(CollateralLockId lockId, uint128 remaining, uint128 requested);

    error SelfConsumption(AccountId accountId);

    error InsufficientExcess(address token, uint256 tokenBalance, uint256 tokenLiability, uint128 requested);

    function createAccount(bytes32 salt) external returns (AccountId accountId);

    function proposeController(AccountId accountId, address newController) external;

    function cancelControllerProposal(AccountId accountId) external;

    /// @dev The handover completes only when the incoming controller acts, so a mistyped address can
    /// never take custody of an account. Balances and locks follow the stable AccountId and are
    /// untouched by the change.
    ///
    /// @dev Acceptance bumps the lock operator epoch, which retires every approval the outgoing
    /// controller granted in one write and with no enumeration. Existing locks survive it intact: an
    /// early release depends on the operator pinned into the lock plus its live global role, never on
    /// a current account approval, so an incoming controller inherits no stranded pledges and no
    /// inherited authority to create new ones.
    function acceptController(AccountId accountId) external;

    /// @dev Per-account authorization, granted and revoked by the controller alone. Revoking stops
    /// new locks immediately and never invalidates or strands an existing one. An approval is
    /// written under the account's current epoch and stops counting the moment that epoch moves.
    function setLockOperator(AccountId accountId, address operator, bool approved) external;

    /// @dev Callable by anyone for an existing account, because funding another party's account is a
    /// gift and cannot harm it. New collateral is accepted only while the exact binding is open for
    /// new risk.
    function deposit(AssetId assetId, uint32 bindingVersion, AccountId accountId, uint128 amount) external;

    /// @dev Available balance only, and deliberately available for every historically registered
    /// binding including Paused and Deprecated ones. There is no admin withdrawal pause, because a
    /// custody contract that can freeze exits is not custody.
    function withdraw(AssetId assetId, uint32 bindingVersion, AccountId accountId, uint128 amount, address recipient)
        external;

    /// @dev An internal ledger move under one exact binding. It touches no token, changes no
    /// aggregate liability, and can never reach locked collateral.
    function transferAvailable(
        AssetId assetId,
        uint32 bindingVersion,
        AccountId fromAccountId,
        AccountId toAccountId,
        uint128 amount
    ) external;

    /// @dev Requires both the global locker role and a live per-account approval. Two independent
    /// grants are needed to pledge anything, and either one revoked is enough to stop new pledges.
    ///
    /// @dev The returned lockId is derived from the caller and its own nonzero lockReference, never
    /// supplied by the caller, so one manager can never claim or grief another manager's handle. The
    /// same caller reusing a reference deterministically hits the existing lock and reverts.
    ///
    /// @dev settlementOperator names the one engine allowed to consume this lock. It must hold the
    /// global settler role now, and it stays pinned even if that role is later granted elsewhere.
    function createLock(
        bytes32 lockReference,
        AccountId accountId,
        AssetId assetId,
        uint32 bindingVersion,
        uint128 amount,
        uint64 expiry,
        address settlementOperator
    ) external returns (CollateralLockId lockId);

    /// @dev Early give-back by the original operator only, and only while it still holds the locker
    /// role. Risk-reducing, so it stays available even if the binding was paused or deprecated.
    function releaseLock(CollateralLockId lockId) external;

    /// @dev Permissionless at or after expiry. This is the path that guarantees a lock can never
    /// strand collateral, whatever happens to the operator or to the asset binding.
    function releaseExpiredLock(CollateralLockId lockId) external;

    /// @dev Settles part or all of a live lock to another existing account under the same exact
    /// CollateralId. It moves ledger entries only: no token leaves the vault and neither aggregate
    /// liability changes. Full consumption marks the lock Consumed; a partial one leaves it Active.
    ///
    /// @dev Callable only by the settlement operator pinned into this lock, and only while it still
    /// holds the global settler role. Revoking that role stops consumption, and cannot strand the
    /// collateral: the permissionless expiry path returns it regardless.
    function consumeLock(CollateralLockId lockId, AccountId recipientAccountId, uint128 amount) external;

    /// @dev Only the token balance strictly above total token liability across every binding version
    /// may leave this way, so recovery can never reduce backing. It works for any historically known
    /// binding, which is how a donated or stuck balance under a deprecated binding is still
    /// recoverable.
    function recoverExcess(AssetId assetId, uint32 bindingVersion, address recipient, uint128 amount) external;

    function settlementAssetRegistry() external view returns (ISettlementAssetRegistry);

    function maxLockDuration() external view returns (uint64);

    function deriveAccountId(address creator, bytes32 salt) external view returns (AccountId);

    function deriveCollateralId(AssetId assetId, uint32 bindingVersion) external view returns (CollateralId);

    /// @dev The handle a given operator would claim for a given reference. Two operators passing one
    /// reference get two different answers, which is the whole point of the derivation.
    function deriveLockId(address operator, bytes32 lockReference) external view returns (CollateralLockId);

    function accountExists(AccountId accountId) external view returns (bool);

    function getAccount(AccountId accountId) external view returns (address controller, address pendingController);

    /// @dev Published for clients and indexers that cache approvals: a change here means every
    /// cached approval for this account is stale. Reverts UnknownAccount rather than answering zero,
    /// because zero is never a stored epoch and would read as a usable generation.
    function lockOperatorEpoch(AccountId accountId) external view returns (uint64);

    /// @dev Live approval only. An approval granted under a superseded epoch, or one against an
    /// account that does not exist, reads as false.
    function isLockOperator(AccountId accountId, address operator) external view returns (bool);

    function balanceOf(AccountId accountId, CollateralId collateralId)
        external
        view
        returns (uint128 total, uint128 locked, uint128 available);

    function collateralLiability(CollateralId collateralId) external view returns (uint256);

    function tokenLiability(address token) external view returns (uint256);

    function tokenBalance(address token) external view returns (uint256);

    /// @dev Token balance above liability. Zero when the vault holds exactly its backing, which is
    /// the normal state.
    function excessOf(address token) external view returns (uint256);

    /// @dev The custody solvency check for one token: the vault holds at least what it owes. It must
    /// hold at every block for every token the vault has ever credited.
    function isSolvent(address token) external view returns (bool);

    /// @dev Reverts UnknownLock rather than answering with a zeroed record, because an all-zero lock
    /// names the zero account and would read as a usable one.
    function getLock(CollateralLockId lockId) external view returns (CollateralLock memory lock);

    /// @dev Sentinel read. An unknown lock reads back as Unspecified, which is never a stored state.
    function lockStatusOf(CollateralLockId lockId) external view returns (LockStatus);

    /// @dev Reverts while the vault's reentrancy guard is entered. A downstream contract that reads
    /// this vault inside a token callback can call this first and fail closed rather than acting on
    /// a mid-transaction view of the ledger.
    function reentrancyCheck() external view;
}
