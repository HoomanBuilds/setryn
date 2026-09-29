// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {ICollateralVault} from "../interfaces/ICollateralVault.sol";
import {PositionTerminalState} from "../interfaces/IPositionEngineTerminalState.sol";
import {IRiskDomainRegistry} from "../interfaces/IRiskDomainRegistry.sol";
import {ISettlementAssetRegistry} from "../interfaces/ISettlementAssetRegistry.sol";
import {CollateralIdLib} from "../libraries/CollateralIdLib.sol";
import {
    CollateralAccount,
    CollateralBalance,
    CollateralLock,
    TerminalClaim,
    TerminalLiabilityReplacement,
    TerminalLiabilityReservation
} from "../types/CollateralTypes.sol";
import {LockStatus, TerminalClaimStatus, TerminalLiabilityReservationStatus} from "../types/Enums.sol";
import {
    AccountId,
    AssetId,
    CollateralId,
    CollateralLockId,
    RiskDomainId,
    TerminalClaimId,
    TerminalLiabilityReservationId
} from "../types/Identifiers.sol";

/// @dev Value custody for qualified settlement assets. The settlement asset registry stays the
/// authority on which ERC-20 contract a canonical asset settles against on this chain. The risk
/// domain registry supplies the exact collateral relationship and liability caps for new terminal
/// reservations.
///
/// @dev Global roles are separate on purpose. Pre-trade lockers and settlers cannot create or
/// qualify position engines for new terminal liability, terminal reservation creators cannot choose
/// outcomes, and recovery can sweep only unbacked surplus. Historical terminalization is
/// permissionless and reads the pinned engine, so revoking a qualification role cannot strand prior
/// reservations. None can withdraw a user balance or change a controller.
///
/// @dev Neither global role is ever sufficient on its own, which is the two-layer trust boundary
/// this contract enforces. Pledging needs the locker role plus a live approval from the account
/// controller; consuming needs the settler role plus having been pinned into that specific lock by
/// the lock operator that created it. The lock operator therefore chooses the settlement engine, but
/// only after the controller admitted that operator and governance admitted that engine, so neither
/// governance nor a controller can unilaterally point an existing pledge at a new settler.
import {CollateralReservationLib} from "./CollateralReservationLib.sol";
import {CollateralVaultDependencies} from "./CollateralVaultTypes.sol";

contract CollateralVault is ICollateralVault, AccessControlDefaultAdminRules, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant COLLATERAL_LOCKER_ROLE = keccak256("SETRYN_COLLATERAL_LOCKER_ROLE");
    bytes32 public constant COLLATERAL_SETTLER_ROLE = keccak256("SETRYN_COLLATERAL_SETTLER_ROLE");
    bytes32 public constant TERMINAL_RESERVATION_CREATOR_ROLE = keccak256("SETRYN_TERMINAL_RESERVATION_CREATOR_ROLE");
    bytes32 public constant TERMINAL_RESERVATION_RESOLVER_ROLE = keccak256("SETRYN_TERMINAL_RESERVATION_RESOLVER_ROLE");
    bytes32 public constant EXCESS_RECOVERY_ROLE = keccak256("SETRYN_EXCESS_RECOVERY_ROLE");

    uint32 public constant POSITION_ENGINE_TERMINAL_STATE_INTERFACE_VERSION = 1;
    uint32 public constant TERMINAL_RESERVATION_CAPABILITY_VERSION = 1;

    ISettlementAssetRegistry private immutable _settlementAssetRegistry;
    IRiskDomainRegistry private immutable _riskDomainRegistry;

    /// @dev The outer bound on how long any operator may hold collateral pledged. It is immutable
    /// because a custody deadline that governance can extend after the fact is not a deadline.
    uint64 private immutable _maxLockDuration;

    mapping(AccountId accountId => CollateralAccount account) private _accounts;

    mapping(AccountId accountId => mapping(CollateralId collateralId => CollateralBalance balance)) private _balances;

    /// @dev The stored value is the epoch the approval was granted under, never a bool. Zero is the
    /// never-approved sentinel, and any epoch below the account's current one is a dead approval from
    /// a previous controller, so a handover revokes every approval at once without enumerating any.
    mapping(AccountId accountId => mapping(address operator => uint64 approvalEpoch)) private _lockOperators;

    mapping(CollateralId collateralId => uint256 liability) private _collateralLiability;

    /// @dev Tracked separately from the per-binding figure because several immutable binding versions
    /// may name one physical token. Solvency and excess recovery are properties of the token
    /// contract, so they must be measured against the sum across every binding that aliases it.
    mapping(address token => uint256 liability) private _tokenLiability;

    mapping(CollateralLockId lockId => CollateralLock lock) private _locks;

    mapping(AccountId accountId => mapping(CollateralId collateralId => uint128 amount)) private _preTradeLocked;
    mapping(AccountId accountId => mapping(CollateralId collateralId => uint128 amount)) private _terminalReserved;
    mapping(AccountId accountId => mapping(CollateralId collateralId => uint128 amount)) private _terminalClaimBacking;

    mapping(CollateralId collateralId => uint256 amount) private _preTradeEncumbrance;
    mapping(CollateralId collateralId => uint256 amount) private _terminalReservationEncumbrance;
    mapping(CollateralId collateralId => uint256 amount) private _terminalClaimEncumbrance;

    mapping(TerminalLiabilityReservationId reservationId => TerminalLiabilityReservation reservation) private
        _terminalLiabilityReservations;
    mapping(TerminalClaimId claimId => TerminalClaim claim) private _terminalClaims;
    mapping(RiskDomainId riskDomainId => mapping(uint32 version => uint256 amount)) private
        _riskDomainTerminalLiability;
    mapping(AccountId accountId => mapping(RiskDomainId riskDomainId => mapping(uint32 version => uint256 amount)))
        private _accountRiskDomainTerminalLiability;

    /// @dev The zero check runs inside the base constructor argument so a Setryn error, not the
    /// OpenZeppelin one, is what a caller sees for a zero admin.
    constructor(
        uint48 defaultAdminDelay,
        address initialAdmin,
        ISettlementAssetRegistry settlementAssetRegistry_,
        IRiskDomainRegistry riskDomainRegistry_,
        uint64 maxLockDuration_
    ) AccessControlDefaultAdminRules(defaultAdminDelay, _requireInitialAdmin(initialAdmin)) {
        if (address(settlementAssetRegistry_) == address(0)) {
            revert ZeroSettlementAssetRegistry();
        }
        if (address(settlementAssetRegistry_).code.length == 0) {
            revert SettlementAssetRegistryHasNoCode(address(settlementAssetRegistry_));
        }
        if (address(riskDomainRegistry_) == address(0)) {
            revert ZeroRiskDomainRegistry();
        }
        if (address(riskDomainRegistry_).code.length == 0) {
            revert RiskDomainRegistryHasNoCode(address(riskDomainRegistry_));
        }
        address riskSettlementRegistry = address(riskDomainRegistry_.settlementAssetRegistry());
        if (riskSettlementRegistry != address(settlementAssetRegistry_)) {
            revert RiskDomainSettlementRegistryMismatch(address(settlementAssetRegistry_), riskSettlementRegistry);
        }
        if (maxLockDuration_ == 0) {
            revert ZeroMaxLockDuration();
        }

        _settlementAssetRegistry = settlementAssetRegistry_;
        _riskDomainRegistry = riskDomainRegistry_;
        _maxLockDuration = maxLockDuration_;

        _grantRole(COLLATERAL_LOCKER_ROLE, initialAdmin);
        _grantRole(COLLATERAL_SETTLER_ROLE, initialAdmin);
        _grantRole(TERMINAL_RESERVATION_CREATOR_ROLE, initialAdmin);
        _grantRole(TERMINAL_RESERVATION_RESOLVER_ROLE, initialAdmin);
        _grantRole(EXCESS_RECOVERY_ROLE, initialAdmin);
    }

    function createAccount(bytes32 salt) external returns (AccountId accountId) {
        accountId = CollateralIdLib.deriveAccountId(block.chainid, address(this), msg.sender, salt);

        CollateralAccount storage account = _accounts[accountId];
        if (account.controller != address(0)) {
            revert AccountAlreadyExists(accountId);
        }
        account.controller = msg.sender;
        account.lockOperatorEpoch = 1;

        emit AccountCreated(accountId, msg.sender, salt);
    }

    function proposeController(AccountId accountId, address newController) external {
        CollateralAccount storage account = _requireController(accountId);
        if (newController == address(0)) {
            revert ZeroController();
        }
        if (newController == msg.sender) {
            revert ControllerUnchanged(accountId, newController);
        }

        account.pendingController = newController;

        emit AccountControlProposed(accountId, msg.sender, newController);
    }

    function cancelControllerProposal(AccountId accountId) external {
        CollateralAccount storage account = _requireController(accountId);

        address cancelled = account.pendingController;
        if (cancelled == address(0)) {
            revert NoPendingController(accountId);
        }
        account.pendingController = address(0);

        emit AccountControlProposalCancelled(accountId, msg.sender, cancelled);
    }

    /// @dev The epoch bump is the revocation. Every approval the outgoing controller granted was
    /// stored against the old generation and stops being live the instant this number moves, so no
    /// operator list is ever walked and no gas cost depends on how many were approved. Existing locks
    /// are untouched: they carry their own pinned operator and settlement operator.
    function acceptController(AccountId accountId) external {
        CollateralAccount storage account = _accounts[accountId];
        address previousController = account.controller;
        if (previousController == address(0)) {
            revert UnknownAccount(accountId);
        }
        if (msg.sender != account.pendingController) {
            revert NotPendingController(accountId, msg.sender);
        }

        uint64 epoch = account.lockOperatorEpoch;
        if (epoch == type(uint64).max) {
            revert LockOperatorEpochExhausted(accountId);
        }
        unchecked {
            epoch = epoch + 1;
        }

        account.controller = msg.sender;
        account.pendingController = address(0);
        account.lockOperatorEpoch = epoch;

        emit AccountControlTransferred(accountId, previousController, msg.sender, epoch);
    }

    function setLockOperator(AccountId accountId, address operator, bool approved) external {
        CollateralAccount storage account = _requireController(accountId);
        if (operator == address(0)) {
            revert ZeroLockOperator();
        }

        uint64 epoch = account.lockOperatorEpoch;
        _lockOperators[accountId][operator] = approved ? epoch : 0;

        emit LockOperatorSet(accountId, operator, approved, epoch, msg.sender);
    }

    /// @dev The credit happens only after the vault has proved it received exactly the amount, so no
    /// path exists from a misbehaving transfer to an unbacked balance.
    function deposit(AssetId assetId, uint32 bindingVersion, AccountId accountId, uint128 amount)
        external
        nonReentrant
    {
        _requireAccount(accountId);
        if (amount == 0) {
            revert ZeroAmount();
        }
        if (!_settlementAssetRegistry.isOpenForNewRisk(assetId, bindingVersion)) {
            revert BindingClosedForNewRisk(assetId, bindingVersion);
        }

        address token = _resolveToken(assetId, bindingVersion);
        CollateralId collateralId = _collateralId(assetId, bindingVersion);

        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        uint256 balanceAfter = IERC20(token).balanceOf(address(this));
        if (balanceAfter < balanceBefore || balanceAfter - balanceBefore != amount) {
            revert InexactDepositReceipt(token, amount, balanceBefore, balanceAfter);
        }

        CollateralBalance storage balance = _balances[accountId][collateralId];
        uint128 newTotal = _addTotal(accountId, collateralId, balance.total, amount);
        balance.total = newTotal;

        _collateralLiability[collateralId] += amount;
        _tokenLiability[token] += amount;

        emit CollateralDeposited(accountId, collateralId, token, assetId, bindingVersion, msg.sender, amount, newTotal);
    }

    /// @dev Historical existence of the binding is the only registry gate here. Requiring Active
    /// status would let a pause strand credited balances, which is the failure this contract exists
    /// to make impossible.
    function withdraw(AssetId assetId, uint32 bindingVersion, AccountId accountId, uint128 amount, address recipient)
        external
        nonReentrant
    {
        _requireController(accountId);
        if (amount == 0) {
            revert ZeroAmount();
        }
        _requireRecipient(recipient);

        address token = _requireHistoricalToken(assetId, bindingVersion);
        CollateralId collateralId = _collateralId(assetId, bindingVersion);

        uint128 newTotal = _debitAvailable(accountId, collateralId, amount);
        _collateralLiability[collateralId] -= amount;
        _tokenLiability[token] -= amount;

        _transferOutExact(token, recipient, amount);

        emit CollateralWithdrawn(
            accountId, collateralId, token, assetId, bindingVersion, msg.sender, recipient, amount, newTotal
        );
    }

    function transferAvailable(
        AssetId assetId,
        uint32 bindingVersion,
        AccountId fromAccountId,
        AccountId toAccountId,
        uint128 amount
    ) external nonReentrant {
        _requireController(fromAccountId);
        _requireAccount(toAccountId);
        if (amount == 0) {
            revert ZeroAmount();
        }
        if (AccountId.unwrap(fromAccountId) == AccountId.unwrap(toAccountId)) {
            revert SelfTransfer(fromAccountId);
        }
        if (!_settlementAssetRegistry.isLifecycleEnabled(assetId, bindingVersion)) {
            revert UnknownBindingVersion(assetId, bindingVersion);
        }

        CollateralId collateralId = _collateralId(assetId, bindingVersion);

        uint128 newFromTotal = _debitAvailable(fromAccountId, collateralId, amount);
        uint128 newToTotal = _creditTotal(toAccountId, collateralId, amount);

        emit CollateralTransferred(
            fromAccountId, toAccountId, collateralId, amount, newFromTotal, newToTotal, msg.sender
        );
    }

    /// @dev Two independent grants are required: the global locker role, and a live approval from
    /// the account controller. No token moves; the collateral stays in the account and only becomes
    /// unavailable.
    ///
    /// @dev The handle is derived from the caller and its own reference rather than accepted from
    /// the caller, so the reference namespace is per operator: two managers may pick the same
    /// reference and get two different locks, and neither can burn a handle the other wanted.
    ///
    /// @dev The settlement engine is checked for the settler role here and then pinned, so the lock
    /// can only ever be consumed by the one address the operator chose out of the set governance had
    /// already authorized. Granting the role to another address later gives it nothing over this lock.
    function createLock(
        bytes32 lockReference,
        AccountId accountId,
        AssetId assetId,
        uint32 bindingVersion,
        uint128 amount,
        uint64 expiry,
        address settlementOperator
    ) external nonReentrant onlyRole(COLLATERAL_LOCKER_ROLE) returns (CollateralLockId lockId) {
        if (lockReference == bytes32(0)) {
            revert ZeroLockReference();
        }
        if (settlementOperator == address(0)) {
            revert ZeroSettlementOperator();
        }
        if (!hasRole(COLLATERAL_SETTLER_ROLE, settlementOperator)) {
            revert SettlementOperatorNotAuthorized(settlementOperator);
        }

        lockId = CollateralIdLib.deriveLockId(block.chainid, address(this), msg.sender, lockReference);
        if (_locks[lockId].status != LockStatus.Unspecified) {
            revert LockAlreadyExists(lockId);
        }
        _requireAccount(accountId);
        if (!_isLockOperator(accountId, msg.sender)) {
            revert LockOperatorNotApproved(accountId, msg.sender);
        }
        if (amount == 0) {
            revert ZeroAmount();
        }
        _requireExpiry(expiry);
        if (!_settlementAssetRegistry.isOpenForNewRisk(assetId, bindingVersion)) {
            revert BindingClosedForNewRisk(assetId, bindingVersion);
        }

        CollateralId collateralId = _collateralId(assetId, bindingVersion);
        _pledgeAvailable(accountId, collateralId, amount);
        _preTradeLocked[accountId][collateralId] += amount;
        _preTradeEncumbrance[collateralId] += amount;

        _openLock(
            lockId,
            CollateralLock({
                accountId: accountId,
                collateralId: collateralId,
                assetId: assetId,
                lockReference: lockReference,
                operator: msg.sender,
                bindingVersion: bindingVersion,
                expiry: expiry,
                settlementOperator: settlementOperator,
                status: LockStatus.Active,
                initialAmount: amount,
                remainingAmount: amount
            })
        );
    }

    /// @dev Authority here is the operator pinned into the lock plus its live global locker role,
    /// deliberately never the account's current approval. A control transfer retires the approval and
    /// must not also take away the operator's ability to hand back what it already pledged.
    function releaseLock(CollateralLockId lockId) external nonReentrant {
        CollateralLock storage lock = _requireActiveLock(lockId);
        if (msg.sender != lock.operator) {
            revert NotLockOperator(lockId, msg.sender);
        }
        if (!hasRole(COLLATERAL_LOCKER_ROLE, msg.sender)) {
            revert LockOperatorNotAuthorized(lockId, msg.sender);
        }
        if (block.timestamp >= lock.expiry) {
            revert LockExpired(lockId, lock.expiry);
        }

        _releaseRemaining(lockId, lock, LockStatus.Released);
    }

    function releaseExpiredLock(CollateralLockId lockId) external nonReentrant {
        CollateralLock storage lock = _requireActiveLock(lockId);
        if (block.timestamp < lock.expiry) {
            revert LockNotExpired(lockId, lock.expiry);
        }

        _releaseRemaining(lockId, lock, LockStatus.Expired);
    }

    /// @dev The payer's locked figure falls with its total, so a settlement can never leave a lock
    /// pledging collateral the account no longer owns. Neither aggregate liability moves, because
    /// nothing entered or left the vault.
    ///
    /// @dev The role modifier proves the caller may settle at all and the pinned check proves it may
    /// settle this lock. Losing the role stops consumption without stranding anything, because the
    /// permissionless expiry path never consults either condition.
    function consumeLock(CollateralLockId lockId, AccountId recipientAccountId, uint128 amount)
        external
        nonReentrant
        onlyRole(COLLATERAL_SETTLER_ROLE)
    {
        CollateralReservationLib.consumeLock(
            _accounts, _balances, _locks, _preTradeLocked, _preTradeEncumbrance, lockId, recipientAccountId, amount
        );
    }

    function createTerminalLiabilityReservation(
        bytes32 positionId,
        AccountId payerAccountId,
        AssetId assetId,
        uint32 bindingVersion,
        RiskDomainId riskDomainId,
        uint32 riskDomainVersion,
        uint128 amount,
        address positionEngine
    )
        external
        nonReentrant
        onlyRole(TERMINAL_RESERVATION_CREATOR_ROLE)
        returns (TerminalLiabilityReservationId reservationId)
    {
        return CollateralReservationLib.createTerminalLiabilityReservation(
            _dependencies(),
            _accounts,
            _balances,
            _lockOperators,
            _terminalReserved,
            _terminalReservationEncumbrance,
            _terminalLiabilityReservations,
            _riskDomainTerminalLiability,
            _accountRiskDomainTerminalLiability,
            positionId,
            payerAccountId,
            assetId,
            bindingVersion,
            riskDomainId,
            riskDomainVersion,
            amount,
            positionEngine
        );
    }

    function convertLockToTerminalLiabilityReservation(
        CollateralLockId lockId,
        bytes32 positionId,
        RiskDomainId riskDomainId,
        uint32 riskDomainVersion,
        uint128 amount
    )
        external
        nonReentrant
        onlyRole(TERMINAL_RESERVATION_CREATOR_ROLE)
        returns (TerminalLiabilityReservationId reservationId)
    {
        return CollateralReservationLib.convertLockToTerminalLiabilityReservation(
            _dependencies(),
            _accounts,
            _lockOperators,
            _locks,
            _preTradeLocked,
            _terminalReserved,
            _preTradeEncumbrance,
            _terminalReservationEncumbrance,
            _terminalLiabilityReservations,
            _riskDomainTerminalLiability,
            _accountRiskDomainTerminalLiability,
            lockId,
            positionId,
            riskDomainId,
            riskDomainVersion,
            amount
        );
    }

    function replaceTerminalLiabilityReservations(
        TerminalLiabilityReservationId[] calldata sourceReservationIds,
        TerminalLiabilityReplacement[] calldata replacements
    )
        external
        nonReentrant
        onlyRole(TERMINAL_RESERVATION_CREATOR_ROLE)
        returns (TerminalLiabilityReservationId[] memory replacementReservationIds)
    {
        return CollateralReservationLib.replaceTerminalLiabilityReservations(
            _balances,
            _terminalReserved,
            _terminalReservationEncumbrance,
            _terminalLiabilityReservations,
            _riskDomainTerminalLiability,
            _accountRiskDomainTerminalLiability,
            sourceReservationIds,
            replacements
        );
    }

    function finalizeTerminalLiabilityReservation(TerminalLiabilityReservationId reservationId)
        external
        nonReentrant
        returns (TerminalClaimId claimId)
    {
        return CollateralReservationLib._finalizeTerminalLiabilityReservation(
            _accounts,
            _balances,
            _terminalReserved,
            _terminalClaimBacking,
            _terminalReservationEncumbrance,
            _terminalClaimEncumbrance,
            _terminalLiabilityReservations,
            _terminalClaims,
            _riskDomainTerminalLiability,
            _accountRiskDomainTerminalLiability,
            reservationId,
            false
        );
    }

    function materializeTerminalClaimAfterFinalResolution(TerminalLiabilityReservationId reservationId)
        external
        nonReentrant
        returns (TerminalClaimId claimId)
    {
        TerminalLiabilityReservation storage reservation = _requireActiveTerminalLiabilityReservation(reservationId);
        uint64 nowTs = uint64(block.timestamp);
        if (nowTs < reservation.finalResolutionAt) {
            revert TerminalClaimFallbackNotReached(reservation.finalResolutionAt, nowTs);
        }
        return CollateralReservationLib._finalizeTerminalLiabilityReservation(
            _accounts,
            _balances,
            _terminalReserved,
            _terminalClaimBacking,
            _terminalReservationEncumbrance,
            _terminalClaimEncumbrance,
            _terminalLiabilityReservations,
            _terminalClaims,
            _riskDomainTerminalLiability,
            _accountRiskDomainTerminalLiability,
            reservationId,
            true
        );
    }

    function fulfillTerminalClaim(TerminalClaimId claimId) external nonReentrant {
        TerminalClaim storage claim = _terminalClaims[claimId];
        TerminalClaimStatus status = claim.status;
        if (status == TerminalClaimStatus.Unspecified) {
            revert UnknownTerminalClaim(claimId);
        }
        if (status != TerminalClaimStatus.Active) {
            revert TerminalClaimNotActive(claimId, status);
        }

        AccountId payerAccountId = claim.payerAccountId;
        AccountId receiverAccountId = claim.receiverAccountId;
        CollateralId collateralId = claim.collateralId;
        uint128 amount = claim.amount;

        claim.status = TerminalClaimStatus.Fulfilled;
        CollateralBalance storage payerBalance = _balances[payerAccountId][collateralId];
        payerBalance.total -= amount;
        payerBalance.locked -= amount;
        _terminalClaimBacking[payerAccountId][collateralId] -= amount;
        _terminalClaimEncumbrance[collateralId] -= amount;
        _creditTotal(receiverAccountId, collateralId, amount);
        _decreaseRiskDomainTerminalLiability(payerAccountId, claim.riskDomainId, claim.riskDomainVersion, amount);

        emit TerminalClaimFulfilled(
            claimId, claim.reservationId, receiverAccountId, payerAccountId, collateralId, amount, msg.sender
        );
    }

    function recoverExcess(AssetId assetId, uint32 bindingVersion, address recipient, uint128 amount)
        external
        nonReentrant
        onlyRole(EXCESS_RECOVERY_ROLE)
    {
        if (amount == 0) {
            revert ZeroAmount();
        }
        _requireRecipient(recipient);

        address token = _requireHistoricalToken(assetId, bindingVersion);

        uint256 liability = _tokenLiability[token];
        uint256 tokenBalance_ = IERC20(token).balanceOf(address(this));
        uint256 excess = tokenBalance_ > liability ? tokenBalance_ - liability : 0;
        if (amount > excess) {
            revert InsufficientExcess(token, tokenBalance_, liability, amount);
        }

        _transferOutExact(token, recipient, amount);

        emit ExcessRecovered(assetId, token, recipient, bindingVersion, amount, liability, msg.sender);
    }

    function settlementAssetRegistry() external view returns (ISettlementAssetRegistry) {
        return _settlementAssetRegistry;
    }

    function riskDomainRegistry() external view returns (IRiskDomainRegistry) {
        return _riskDomainRegistry;
    }

    function terminalReservationCapabilityVersion() external pure returns (uint32) {
        return TERMINAL_RESERVATION_CAPABILITY_VERSION;
    }

    function supportsTerminalReservationCapability(uint32 version) external pure returns (bool) {
        return version == TERMINAL_RESERVATION_CAPABILITY_VERSION;
    }

    function maxLockDuration() external view returns (uint64) {
        return _maxLockDuration;
    }

    function deriveAccountId(address creator, bytes32 salt) external view returns (AccountId) {
        return CollateralIdLib.deriveAccountId(block.chainid, address(this), creator, salt);
    }

    function deriveCollateralId(AssetId assetId, uint32 bindingVersion) external view returns (CollateralId) {
        return _collateralId(assetId, bindingVersion);
    }

    function deriveLockId(address operator, bytes32 lockReference) external view returns (CollateralLockId) {
        return CollateralIdLib.deriveLockId(block.chainid, address(this), operator, lockReference);
    }

    function deriveTerminalLiabilityReservationId(address positionEngine, bytes32 positionEngineId, bytes32 positionId)
        external
        view
        returns (TerminalLiabilityReservationId)
    {
        return _deriveTerminalLiabilityReservationId(positionEngine, positionEngineId, positionId);
    }

    function deriveTerminalClaimId(TerminalLiabilityReservationId reservationId, bytes32 terminalOutcomeReference)
        external
        view
        returns (TerminalClaimId)
    {
        return _deriveTerminalClaimId(reservationId, terminalOutcomeReference);
    }

    function accountExists(AccountId accountId) external view returns (bool) {
        return _accounts[accountId].controller != address(0);
    }

    function getAccount(AccountId accountId) external view returns (address controller, address pendingController) {
        CollateralAccount storage account = _accounts[accountId];
        return (account.controller, account.pendingController);
    }

    function lockOperatorEpoch(AccountId accountId) external view returns (uint64) {
        CollateralAccount storage account = _accounts[accountId];
        if (account.controller == address(0)) {
            revert UnknownAccount(accountId);
        }
        return account.lockOperatorEpoch;
    }

    function isLockOperator(AccountId accountId, address operator) external view returns (bool) {
        return _isLockOperator(accountId, operator);
    }

    function balanceOf(AccountId accountId, CollateralId collateralId)
        external
        view
        returns (uint128 total, uint128 locked, uint128 available)
    {
        CollateralBalance storage balance = _balances[accountId][collateralId];
        total = balance.total;
        locked = balance.locked;
        available = total - locked;
    }

    function collateralLiability(CollateralId collateralId) external view returns (uint256) {
        return _collateralLiability[collateralId];
    }

    function tokenLiability(address token) external view returns (uint256) {
        return _tokenLiability[token];
    }

    function tokenBalance(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    function excessOf(address token) external view returns (uint256) {
        uint256 liability = _tokenLiability[token];
        uint256 held = IERC20(token).balanceOf(address(this));
        return held > liability ? held - liability : 0;
    }

    function isSolvent(address token) external view returns (bool) {
        return IERC20(token).balanceOf(address(this)) >= _tokenLiability[token];
    }

    function getLock(CollateralLockId lockId) external view returns (CollateralLock memory) {
        CollateralLock storage lock = _locks[lockId];
        if (lock.status == LockStatus.Unspecified) {
            revert UnknownLock(lockId);
        }
        return lock;
    }

    function lockStatusOf(CollateralLockId lockId) external view returns (LockStatus) {
        return _locks[lockId].status;
    }

    function terminalLiabilityReservationOf(TerminalLiabilityReservationId reservationId)
        external
        view
        returns (TerminalLiabilityReservation memory reservation)
    {
        TerminalLiabilityReservation storage stored = _terminalLiabilityReservations[reservationId];
        if (stored.status == TerminalLiabilityReservationStatus.Unspecified) {
            revert UnknownTerminalLiabilityReservation(reservationId);
        }
        return stored;
    }

    function terminalLiabilityReservationStatusOf(TerminalLiabilityReservationId reservationId)
        external
        view
        returns (TerminalLiabilityReservationStatus)
    {
        return _terminalLiabilityReservations[reservationId].status;
    }

    function terminalClaimOf(TerminalClaimId claimId) external view returns (TerminalClaim memory claim) {
        TerminalClaim storage stored = _terminalClaims[claimId];
        if (stored.status == TerminalClaimStatus.Unspecified) {
            revert UnknownTerminalClaim(claimId);
        }
        return stored;
    }

    function terminalClaimStatusOf(TerminalClaimId claimId) external view returns (TerminalClaimStatus) {
        return _terminalClaims[claimId].status;
    }

    function encumbranceOf(AccountId accountId, CollateralId collateralId)
        external
        view
        returns (uint128 preTradeLocked, uint128 terminalReserved, uint128 terminalClaimBacking, uint128 totalLocked)
    {
        preTradeLocked = _preTradeLocked[accountId][collateralId];
        terminalReserved = _terminalReserved[accountId][collateralId];
        terminalClaimBacking = _terminalClaimBacking[accountId][collateralId];
        totalLocked = _balances[accountId][collateralId].locked;
    }

    function collateralEncumbrance(CollateralId collateralId)
        external
        view
        returns (uint256 preTradeLocked, uint256 terminalReserved, uint256 terminalClaimBacking)
    {
        return (
            _preTradeEncumbrance[collateralId],
            _terminalReservationEncumbrance[collateralId],
            _terminalClaimEncumbrance[collateralId]
        );
    }

    function riskDomainTerminalLiability(RiskDomainId riskDomainId, uint32 version) external view returns (uint256) {
        return _riskDomainTerminalLiability[riskDomainId][version];
    }

    function accountRiskDomainTerminalLiability(AccountId accountId, RiskDomainId riskDomainId, uint32 version)
        external
        view
        returns (uint256)
    {
        return _accountRiskDomainTerminalLiability[accountId][riskDomainId][version];
    }

    function reentrancyCheck() external view nonReentrantView {}

    function _requirePositionStateIdentity(bytes32 positionId, PositionTerminalState memory state) private pure {
        if (state.positionId != positionId) {
            revert PositionStateMismatch(positionId, state.positionId);
        }
    }

    function _increaseRiskDomainTerminalLiability(
        AccountId payerAccountId,
        RiskDomainId riskDomainId,
        uint32 riskDomainVersion,
        uint128 amount
    ) private {
        _riskDomainTerminalLiability[riskDomainId][riskDomainVersion] += amount;
        _accountRiskDomainTerminalLiability[payerAccountId][riskDomainId][riskDomainVersion] += amount;
    }

    function _decreaseRiskDomainTerminalLiability(
        AccountId payerAccountId,
        RiskDomainId riskDomainId,
        uint32 riskDomainVersion,
        uint128 amount
    ) private {
        _riskDomainTerminalLiability[riskDomainId][riskDomainVersion] -= amount;
        _accountRiskDomainTerminalLiability[payerAccountId][riskDomainId][riskDomainVersion] -= amount;
    }

    function _pledgeAvailable(AccountId accountId, CollateralId collateralId, uint128 amount) private {
        CollateralBalance storage balance = _balances[accountId][collateralId];
        uint128 available = balance.total - balance.locked;
        if (available < amount) {
            revert InsufficientAvailable(accountId, collateralId, available, amount);
        }
        balance.locked = balance.locked + amount;
    }

    /// @dev The record is built and logged here rather than inline in createLock so the caller's
    /// seven arguments and the event's ten do not have to be live on the stack at the same time.
    function _openLock(CollateralLockId lockId, CollateralLock memory pending) private {
        _locks[lockId] = pending;

        emit CollateralLockCreated(
            lockId,
            pending.accountId,
            pending.collateralId,
            pending.lockReference,
            pending.assetId,
            pending.bindingVersion,
            pending.operator,
            pending.settlementOperator,
            pending.initialAmount,
            pending.expiry
        );
    }

    function _releaseRemaining(CollateralLockId lockId, CollateralLock storage lock, LockStatus newStatus) private {
        uint128 remaining = lock.remainingAmount;
        lock.remainingAmount = 0;
        lock.status = newStatus;

        CollateralBalance storage balance = _balances[lock.accountId][lock.collateralId];
        balance.locked = balance.locked - remaining;
        _preTradeLocked[lock.accountId][lock.collateralId] -= remaining;
        _preTradeEncumbrance[lock.collateralId] -= remaining;

        emit CollateralLockReleased(lockId, lock.accountId, lock.collateralId, remaining, newStatus, msg.sender);
    }

    function _emitTerminalLiabilityReservationCreated(
        TerminalLiabilityReservationId reservationId,
        TerminalLiabilityReservation storage reservation,
        CollateralLockId sourceLockId
    ) private {
        emit TerminalLiabilityReservationCreated(
            reservationId,
            reservation.positionId,
            reservation.payerAccountId,
            reservation.collateralId,
            reservation.assetId,
            reservation.riskDomainId,
            reservation.bindingVersion,
            reservation.riskDomainVersion,
            reservation.creator,
            reservation.positionEngine,
            reservation.positionEngineId,
            reservation.positionEngineCodeHash,
            reservation.initialAmount,
            reservation.settlementDeadline,
            reservation.finalResolutionAt,
            sourceLockId
        );
    }

    function _debitAvailable(AccountId accountId, CollateralId collateralId, uint128 amount)
        private
        returns (uint128 newTotal)
    {
        CollateralBalance storage balance = _balances[accountId][collateralId];
        uint128 total = balance.total;
        uint128 available = total - balance.locked;
        if (available < amount) {
            revert InsufficientAvailable(accountId, collateralId, available, amount);
        }

        newTotal = total - amount;
        balance.total = newTotal;
    }

    function _creditTotal(AccountId accountId, CollateralId collateralId, uint128 amount)
        private
        returns (uint128 newTotal)
    {
        CollateralBalance storage balance = _balances[accountId][collateralId];
        newTotal = _addTotal(accountId, collateralId, balance.total, amount);
        balance.total = newTotal;
    }

    /// @dev A named overflow outcome rather than an opaque Panic(0x11), so an exhausted uint128
    /// balance is a stated protocol failure instead of an arithmetic accident.
    function _addTotal(AccountId accountId, CollateralId collateralId, uint128 current, uint128 amount)
        private
        pure
        returns (uint128)
    {
        uint256 next = uint256(current) + uint256(amount);
        if (next > type(uint128).max) {
            revert BalanceOverflow(accountId, collateralId, current, amount);
        }
        return uint128(next);
    }

    /// @dev Both legs are measured. A token that debits the vault without crediting the recipient, or
    /// that credits a different amount than it debits, reverts the whole call rather than leaving the
    /// ledger and the token contract disagreeing.
    function _transferOutExact(address token, address recipient, uint128 amount) private {
        uint256 vaultBefore = IERC20(token).balanceOf(address(this));
        uint256 recipientBefore = IERC20(token).balanceOf(recipient);

        IERC20(token).safeTransfer(recipient, amount);

        uint256 vaultAfter = IERC20(token).balanceOf(address(this));
        uint256 recipientAfter = IERC20(token).balanceOf(recipient);

        if (
            vaultAfter > vaultBefore || vaultBefore - vaultAfter != amount || recipientAfter < recipientBefore
                || recipientAfter - recipientBefore != amount
        ) {
            revert InexactTransferSettlement(token, recipient, amount);
        }
    }

    function _requireExpiry(uint64 expiry) private view {
        uint64 nowTs = uint64(block.timestamp);
        uint256 maxExpiry = uint256(nowTs) + uint256(_maxLockDuration);
        if (expiry <= nowTs || uint256(expiry) > maxExpiry) {
            revert InvalidLockExpiry(expiry, nowTs, maxExpiry);
        }
    }

    function _requireRecipient(address recipient) private view {
        if (recipient == address(0)) {
            revert ZeroRecipient();
        }
        if (recipient == address(this)) {
            revert VaultRecipient();
        }
    }

    function _requireController(AccountId accountId) private view returns (CollateralAccount storage account) {
        account = _accounts[accountId];
        address controller = account.controller;
        if (controller == address(0)) {
            revert UnknownAccount(accountId);
        }
        if (msg.sender != controller) {
            revert NotAccountController(accountId, msg.sender);
        }
    }

    function _requireAccount(AccountId accountId) private view {
        if (_accounts[accountId].controller == address(0)) {
            revert UnknownAccount(accountId);
        }
    }

    /// @dev An approval counts only while the epoch it was written under is still the account's
    /// current one. The nonzero test carries the unknown-account case for free: such an account has
    /// epoch zero and every stored approval against it is also zero.
    function _isLockOperator(AccountId accountId, address operator) private view returns (bool) {
        uint64 approvalEpoch = _lockOperators[accountId][operator];
        return approvalEpoch != 0 && approvalEpoch == _accounts[accountId].lockOperatorEpoch;
    }

    function _requireActiveLock(CollateralLockId lockId) private view returns (CollateralLock storage lock) {
        lock = _locks[lockId];
        LockStatus status = lock.status;
        if (status == LockStatus.Unspecified) {
            revert UnknownLock(lockId);
        }
        if (status != LockStatus.Active) {
            revert LockNotActive(lockId, status);
        }
    }

    function _requireActiveTerminalLiabilityReservation(TerminalLiabilityReservationId reservationId)
        private
        view
        returns (TerminalLiabilityReservation storage reservation)
    {
        reservation = _terminalLiabilityReservations[reservationId];
        TerminalLiabilityReservationStatus status = reservation.status;
        if (status == TerminalLiabilityReservationStatus.Unspecified) {
            revert UnknownTerminalLiabilityReservation(reservationId);
        }
        if (status != TerminalLiabilityReservationStatus.Active) {
            revert TerminalLiabilityReservationNotActive(reservationId, status);
        }
    }

    function _requireUnusedTerminalLiabilityReservation(TerminalLiabilityReservationId reservationId) private view {
        if (_terminalLiabilityReservations[reservationId].status != TerminalLiabilityReservationStatus.Unspecified) {
            revert TerminalLiabilityReservationAlreadyExists(reservationId);
        }
    }

    function _deriveTerminalLiabilityReservationId(address positionEngine, bytes32 positionEngineId, bytes32 positionId)
        private
        view
        returns (TerminalLiabilityReservationId)
    {
        return CollateralIdLib.deriveTerminalLiabilityReservationId(
            block.chainid, address(this), positionEngine, positionEngineId, positionId
        );
    }

    function _deriveTerminalClaimId(TerminalLiabilityReservationId reservationId, bytes32 terminalOutcomeReference)
        private
        view
        returns (TerminalClaimId)
    {
        return
            CollateralIdLib.deriveTerminalClaimId(block.chainid, address(this), reservationId, terminalOutcomeReference);
    }

    /// @dev Historical resolvability only. This is the gate every risk-reducing path uses, so an
    /// exit never depends on the current status of the binding.
    function _requireHistoricalToken(AssetId assetId, uint32 bindingVersion) private view returns (address) {
        if (!_settlementAssetRegistry.isLifecycleEnabled(assetId, bindingVersion)) {
            revert UnknownBindingVersion(assetId, bindingVersion);
        }
        return _resolveToken(assetId, bindingVersion);
    }

    function _resolveToken(AssetId assetId, uint32 bindingVersion) private view returns (address) {
        return _settlementAssetRegistry.getBinding(assetId, bindingVersion).definition.token;
    }

    function _collateralId(AssetId assetId, uint32 bindingVersion) private view returns (CollateralId) {
        return
            CollateralIdLib.deriveCollateralId(
                block.chainid, address(_settlementAssetRegistry), assetId, bindingVersion
            );
    }

    /// Linked libraries execute in this contract's context and receive the immutable dependency graph explicitly.
    function _dependencies() private view returns (CollateralVaultDependencies memory) {
        return CollateralVaultDependencies({
            settlementAssetRegistry: _settlementAssetRegistry,
            riskDomainRegistry: _riskDomainRegistry,
            maxLockDuration: _maxLockDuration
        });
    }

    function _requireInitialAdmin(address initialAdmin) private pure returns (address) {
        if (initialAdmin == address(0)) {
            revert ZeroInitialAdmin();
        }
        return initialAdmin;
    }
}
