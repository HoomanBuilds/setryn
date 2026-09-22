// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Test} from "forge-std/Test.sol";

import {CollateralVault} from "../../src/collateral/CollateralVault.sol";
import {ICollateralVault} from "../../src/interfaces/ICollateralVault.sol";
import {ISettlementAssetRegistry} from "../../src/interfaces/ISettlementAssetRegistry.sol";
import {CollateralIdLib} from "../../src/libraries/CollateralIdLib.sol";
import {AssetRegistry} from "../../src/registry/AssetRegistry.sol";
import {SettlementAssetRegistry} from "../../src/registry/SettlementAssetRegistry.sol";
import {AssetDefinition} from "../../src/types/AssetDefinition.sol";
import {CollateralLock} from "../../src/types/CollateralTypes.sol";
import {AssetClass, LockStatus} from "../../src/types/Enums.sol";
import {AccountId, AssetId, CollateralId, CollateralLockId} from "../../src/types/Identifiers.sol";
import {SettlementAssetDefinition} from "../../src/types/SettlementAssetDefinition.sol";
import {
    FalseReturnERC20,
    FeeOnTransferERC20,
    MockCollateralERC20,
    ReentrantERC20,
    SilentNoOpERC20
} from "../mocks/CollateralTokenMocks.sol";

contract CollateralVaultTest is Test {
    uint48 internal constant ADMIN_DELAY = 3 days;
    uint64 internal constant MAX_LOCK_DURATION = 7 days;
    uint8 internal constant DECIMALS = 6;
    uint128 internal constant UNIT = 1e6;
    uint128 internal constant FUNDING = 1_000_000e6;

    bytes32 internal constant NAMESPACE_ID = keccak256("setryn.stablecoin");
    bytes32 internal constant SYMBOL = keccak256("SYM");
    bytes32 internal constant QUALIFICATION_ONE = keccak256("qualification.one");
    bytes32 internal constant QUALIFICATION_TWO = keccak256("qualification.two");

    /// @dev References are per operator, so the same two literals are reused by every operator in
    /// this file and still name different locks. The derived handles below are the locker's.
    bytes32 internal constant REF_ONE = keccak256("lock.one");
    bytes32 internal constant REF_TWO = keccak256("lock.two");

    address internal admin = makeAddr("admin");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal locker = makeAddr("locker");
    address internal settler = makeAddr("settler");
    address internal recoverer = makeAddr("recoverer");
    address internal outsider = makeAddr("outsider");

    AssetRegistry internal canonical;
    SettlementAssetRegistry internal settlement;
    CollateralVault internal vault;
    MockCollateralERC20 internal token;

    AssetId internal assetId;
    uint32 internal versionOne;
    CollateralId internal collateralOne;

    AccountId internal aliceAccount;
    AccountId internal bobAccount;

    CollateralLockId internal lockOne;
    CollateralLockId internal lockTwo;

    /// @dev Cached because reading a role constant off the vault inside a pranked step would consume
    /// the single-shot prank before the call under test runs.
    bytes32 internal lockerRole;
    bytes32 internal settlerRole;
    bytes32 internal recoveryRole;

    function setUp() public {
        canonical = new AssetRegistry(ADMIN_DELAY, admin);
        settlement = new SettlementAssetRegistry(ADMIN_DELAY, admin, canonical);
        token = new MockCollateralERC20(DECIMALS);

        vm.startPrank(admin);
        assetId = canonical.registerAsset(_asset(keccak256("usd:primary")));
        versionOne = settlement.registerBinding(_settlementDefinition(assetId, address(token), QUALIFICATION_ONE));
        settlement.activateBinding(assetId, versionOne);
        vm.stopPrank();

        vault = new CollateralVault(ADMIN_DELAY, admin, settlement, MAX_LOCK_DURATION);
        collateralOne = vault.deriveCollateralId(assetId, versionOne);
        lockOne = vault.deriveLockId(locker, REF_ONE);
        lockTwo = vault.deriveLockId(locker, REF_TWO);

        lockerRole = vault.COLLATERAL_LOCKER_ROLE();
        settlerRole = vault.COLLATERAL_SETTLER_ROLE();
        recoveryRole = vault.EXCESS_RECOVERY_ROLE();

        vm.startPrank(admin);
        vault.grantRole(lockerRole, locker);
        vault.grantRole(settlerRole, settler);
        vault.grantRole(recoveryRole, recoverer);
        vm.stopPrank();

        aliceAccount = _createAccount(alice, keccak256("alice.primary"));
        bobAccount = _createAccount(bob, keccak256("bob.primary"));

        token.mint(alice, FUNDING);
        token.mint(bob, FUNDING);
        vm.prank(alice);
        token.approve(address(vault), type(uint256).max);
        vm.prank(bob);
        token.approve(address(vault), type(uint256).max);
    }

    function test_ConstructorWiresDependenciesBootstrapsRolesAndRejectsBadArguments() public {
        assertEq(address(vault.settlementAssetRegistry()), address(settlement));
        assertEq(vault.maxLockDuration(), MAX_LOCK_DURATION);
        assertEq(vault.defaultAdmin(), admin);

        assertEq(vault.COLLATERAL_LOCKER_ROLE(), keccak256(bytes("SETRYN_COLLATERAL_LOCKER_ROLE")));
        assertEq(vault.COLLATERAL_SETTLER_ROLE(), keccak256(bytes("SETRYN_COLLATERAL_SETTLER_ROLE")));
        assertEq(vault.EXCESS_RECOVERY_ROLE(), keccak256(bytes("SETRYN_EXCESS_RECOVERY_ROLE")));
        assertTrue(vault.COLLATERAL_LOCKER_ROLE() != vault.COLLATERAL_SETTLER_ROLE());
        assertTrue(vault.COLLATERAL_SETTLER_ROLE() != vault.EXCESS_RECOVERY_ROLE());
        assertTrue(vault.COLLATERAL_LOCKER_ROLE() != vault.EXCESS_RECOVERY_ROLE());

        assertTrue(vault.hasRole(vault.COLLATERAL_LOCKER_ROLE(), admin));
        assertTrue(vault.hasRole(vault.COLLATERAL_SETTLER_ROLE(), admin));
        assertTrue(vault.hasRole(vault.EXCESS_RECOVERY_ROLE(), admin));

        vm.expectRevert(ICollateralVault.ZeroInitialAdmin.selector);
        new CollateralVault(ADMIN_DELAY, address(0), settlement, MAX_LOCK_DURATION);

        vm.expectRevert(ICollateralVault.ZeroSettlementAssetRegistry.selector);
        new CollateralVault(ADMIN_DELAY, admin, ISettlementAssetRegistry(address(0)), MAX_LOCK_DURATION);

        vm.expectRevert(abi.encodeWithSelector(ICollateralVault.SettlementAssetRegistryHasNoCode.selector, outsider));
        new CollateralVault(ADMIN_DELAY, admin, ISettlementAssetRegistry(outsider), MAX_LOCK_DURATION);

        vm.expectRevert(ICollateralVault.ZeroMaxLockDuration.selector);
        new CollateralVault(ADMIN_DELAY, admin, settlement, 0);
    }

    function test_AccountIdIsDeterministicPerVaultCreatorAndSalt() public {
        bytes32 salt = keccak256("alice.secondary");
        AccountId expected = vault.deriveAccountId(alice, salt);
        assertEq(
            AccountId.unwrap(expected),
            AccountId.unwrap(CollateralIdLib.deriveAccountId(block.chainid, address(vault), alice, salt))
        );

        AccountId created = _createAccount(alice, salt);
        assertEq(AccountId.unwrap(created), AccountId.unwrap(expected));
        assertTrue(vault.accountExists(created));
        (address controller, address pending) = vault.getAccount(created);
        assertEq(controller, alice);
        assertEq(pending, address(0));

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ICollateralVault.AccountAlreadyExists.selector, created));
        vault.createAccount(salt);

        assertTrue(AccountId.unwrap(vault.deriveAccountId(bob, salt)) != AccountId.unwrap(expected));
        assertTrue(AccountId.unwrap(vault.deriveAccountId(alice, keccak256("other"))) != AccountId.unwrap(expected));

        CollateralVault otherVault = new CollateralVault(ADMIN_DELAY, admin, settlement, MAX_LOCK_DURATION);
        assertTrue(AccountId.unwrap(otherVault.deriveAccountId(alice, salt)) != AccountId.unwrap(expected));
    }

    function test_TwoStepControllerTransferRetiresApprovalsAndKeepsBalancesAndLocks() public {
        _deposit(alice, aliceAccount, 100 * UNIT);
        _approveOperator(alice, aliceAccount, locker);
        _createLock(REF_ONE, aliceAccount, 40 * UNIT, uint64(block.timestamp + 1 days));
        assertEq(vault.lockOperatorEpoch(aliceAccount), 1);
        assertTrue(vault.isLockOperator(aliceAccount, locker));

        vm.startPrank(alice);
        vm.expectRevert(ICollateralVault.ZeroController.selector);
        vault.proposeController(aliceAccount, address(0));

        vm.expectRevert(abi.encodeWithSelector(ICollateralVault.ControllerUnchanged.selector, aliceAccount, alice));
        vault.proposeController(aliceAccount, alice);

        vault.proposeController(aliceAccount, carol);
        vm.stopPrank();

        vm.prank(outsider);
        vm.expectRevert(abi.encodeWithSelector(ICollateralVault.NotPendingController.selector, aliceAccount, outsider));
        vault.acceptController(aliceAccount);

        vm.prank(alice);
        vault.cancelControllerProposal(aliceAccount);

        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(ICollateralVault.NotPendingController.selector, aliceAccount, carol));
        vault.acceptController(aliceAccount);

        vm.prank(alice);
        vault.proposeController(aliceAccount, carol);
        vm.prank(carol);
        vault.acceptController(aliceAccount);

        (address controller, address pending) = vault.getAccount(aliceAccount);
        assertEq(controller, carol);
        assertEq(pending, address(0));

        (uint128 total, uint128 locked, uint128 available) = vault.balanceOf(aliceAccount, collateralOne);
        assertEq(total, 100 * UNIT);
        assertEq(locked, 40 * UNIT);
        assertEq(available, 60 * UNIT);
        assertEq(uint8(vault.lockStatusOf(lockOne)), uint8(LockStatus.Active));

        assertEq(vault.lockOperatorEpoch(aliceAccount), 2);
        assertFalse(vault.isLockOperator(aliceAccount, locker));
        vm.prank(locker);
        vm.expectRevert(abi.encodeWithSelector(ICollateralVault.LockOperatorNotApproved.selector, aliceAccount, locker));
        vault.createLock(
            REF_TWO, aliceAccount, assetId, versionOne, 1 * UNIT, uint64(block.timestamp + 1 days), settler
        );

        vm.prank(settler);
        vault.consumeLock(lockOne, bobAccount, 10 * UNIT);
        vm.prank(locker);
        vault.releaseLock(lockOne);
        assertEq(uint8(vault.lockStatusOf(lockOne)), uint8(LockStatus.Released));

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ICollateralVault.NotAccountController.selector, aliceAccount, alice));
        vault.withdraw(assetId, versionOne, aliceAccount, 1 * UNIT, alice);

        vm.prank(carol);
        vault.withdraw(assetId, versionOne, aliceAccount, 60 * UNIT, carol);
        assertEq(token.balanceOf(carol), 60 * UNIT);

        _approveOperator(carol, aliceAccount, locker);
        assertEq(vault.lockOperatorEpoch(aliceAccount), 2);
        assertTrue(vault.isLockOperator(aliceAccount, locker));
        _createLock(REF_TWO, aliceAccount, 30 * UNIT, uint64(block.timestamp + 1 days));
        assertEq(uint8(vault.lockStatusOf(lockTwo)), uint8(LockStatus.Active));
    }

    function test_DepositCreditsExactReceiptAndBothLiabilities() public {
        uint128 amount = 250 * UNIT;

        vm.expectEmit(true, true, true, true, address(vault));
        emit ICollateralVault.CollateralDeposited(
            aliceAccount, collateralOne, address(token), assetId, versionOne, bob, amount, amount
        );
        vm.prank(bob);
        vault.deposit(assetId, versionOne, aliceAccount, amount);

        (uint128 total, uint128 locked, uint128 available) = vault.balanceOf(aliceAccount, collateralOne);
        assertEq(total, amount);
        assertEq(locked, 0);
        assertEq(available, amount);
        assertEq(vault.collateralLiability(collateralOne), amount);
        assertEq(vault.tokenLiability(address(token)), amount);
        assertEq(vault.tokenBalance(address(token)), amount);
        assertEq(vault.excessOf(address(token)), 0);
        assertTrue(vault.isSolvent(address(token)));
        assertEq(token.balanceOf(bob), FUNDING - amount);
    }

    function test_DepositRejectsFeeOnTransferSilentAndFalseReturnTokens() public {
        (AssetId feeAsset, uint32 feeVersion, FeeOnTransferERC20 feeToken) = _registerFeeToken();
        (AssetId silentAsset, uint32 silentVersion, SilentNoOpERC20 silentToken) = _registerSilentToken();
        (AssetId falseAsset, uint32 falseVersion, FalseReturnERC20 falseToken) = _registerFalseToken();

        vm.startPrank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                ICollateralVault.InexactDepositReceipt.selector, address(feeToken), 100 * UNIT, 0, 100 * UNIT - 1
            )
        );
        vault.deposit(feeAsset, feeVersion, aliceAccount, 100 * UNIT);

        vm.expectRevert(
            abi.encodeWithSelector(
                ICollateralVault.InexactDepositReceipt.selector, address(silentToken), 100 * UNIT, 0, 0
            )
        );
        vault.deposit(silentAsset, silentVersion, aliceAccount, 100 * UNIT);

        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(falseToken)));
        vault.deposit(falseAsset, falseVersion, aliceAccount, 100 * UNIT);
        vm.stopPrank();

        assertEq(vault.tokenLiability(address(feeToken)), 0);
        assertEq(vault.tokenLiability(address(silentToken)), 0);
        assertEq(vault.tokenLiability(address(falseToken)), 0);
    }

    function test_DepositRejectsClosedBindingUnknownAccountAndZeroAmount() public {
        AccountId ghost = vault.deriveAccountId(outsider, keccak256("ghost"));

        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(ICollateralVault.UnknownAccount.selector, ghost));
        vault.deposit(assetId, versionOne, ghost, 1 * UNIT);

        vm.expectRevert(ICollateralVault.ZeroAmount.selector);
        vault.deposit(assetId, versionOne, aliceAccount, 0);

        vm.expectRevert(abi.encodeWithSelector(ICollateralVault.BindingClosedForNewRisk.selector, assetId, uint32(99)));
        vault.deposit(assetId, 99, aliceAccount, 1 * UNIT);
        vm.stopPrank();

        vm.prank(admin);
        settlement.pauseBinding(assetId, versionOne);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ICollateralVault.BindingClosedForNewRisk.selector, assetId, versionOne));
        vault.deposit(assetId, versionOne, aliceAccount, 1 * UNIT);
    }

    function test_BindingVersionsAreIsolatedButShareTokenLiability() public {
        _deposit(alice, aliceAccount, 100 * UNIT);

        uint32 versionTwo = _rotateToSecondVersion();
        CollateralId collateralTwo = vault.deriveCollateralId(assetId, versionTwo);
        assertTrue(CollateralId.unwrap(collateralOne) != CollateralId.unwrap(collateralTwo));

        vm.prank(alice);
        vault.deposit(assetId, versionTwo, aliceAccount, 60 * UNIT);

        (uint128 totalOne,,) = vault.balanceOf(aliceAccount, collateralOne);
        (uint128 totalTwo,,) = vault.balanceOf(aliceAccount, collateralTwo);
        assertEq(totalOne, 100 * UNIT);
        assertEq(totalTwo, 60 * UNIT);
        assertEq(vault.collateralLiability(collateralOne), 100 * UNIT);
        assertEq(vault.collateralLiability(collateralTwo), 60 * UNIT);
        assertEq(vault.tokenLiability(address(token)), 160 * UNIT);
        assertEq(vault.tokenBalance(address(token)), 160 * UNIT);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                ICollateralVault.InsufficientAvailable.selector, aliceAccount, collateralTwo, 60 * UNIT, 100 * UNIT
            )
        );
        vault.withdraw(assetId, versionTwo, aliceAccount, 100 * UNIT, alice);

        vm.prank(alice);
        vault.withdraw(assetId, versionOne, aliceAccount, 100 * UNIT, alice);

        assertEq(vault.collateralLiability(collateralOne), 0);
        assertEq(vault.collateralLiability(collateralTwo), 60 * UNIT);
        assertEq(vault.tokenLiability(address(token)), 60 * UNIT);
        assertTrue(vault.isSolvent(address(token)));
    }

    function test_WithdrawalSurvivesPausedAndDeprecatedBindings() public {
        _deposit(alice, aliceAccount, 100 * UNIT);

        vm.prank(admin);
        settlement.pauseBinding(assetId, versionOne);

        vm.prank(alice);
        vault.withdraw(assetId, versionOne, aliceAccount, 40 * UNIT, alice);

        vm.prank(admin);
        settlement.deprecateBinding(assetId, versionOne);

        vm.prank(alice);
        vault.withdraw(assetId, versionOne, aliceAccount, 60 * UNIT, alice);

        assertEq(vault.collateralLiability(collateralOne), 0);
        assertEq(vault.tokenLiability(address(token)), 0);
        assertEq(token.balanceOf(alice), FUNDING);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ICollateralVault.UnknownBindingVersion.selector, assetId, uint32(99)));
        vault.withdraw(assetId, 99, aliceAccount, 1, alice);
    }

    function test_WithdrawSpendsAvailableOnlyAndRejectsBadRecipients() public {
        _deposit(alice, aliceAccount, 100 * UNIT);
        _approveOperator(alice, aliceAccount, locker);
        _createLock(REF_ONE, aliceAccount, 70 * UNIT, uint64(block.timestamp + 1 days));

        vm.startPrank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                ICollateralVault.InsufficientAvailable.selector, aliceAccount, collateralOne, 30 * UNIT, 31 * UNIT
            )
        );
        vault.withdraw(assetId, versionOne, aliceAccount, 31 * UNIT, alice);

        vm.expectRevert(ICollateralVault.ZeroRecipient.selector);
        vault.withdraw(assetId, versionOne, aliceAccount, 1 * UNIT, address(0));

        vm.expectRevert(ICollateralVault.VaultRecipient.selector);
        vault.withdraw(assetId, versionOne, aliceAccount, 1 * UNIT, address(vault));

        vm.expectRevert(ICollateralVault.ZeroAmount.selector);
        vault.withdraw(assetId, versionOne, aliceAccount, 0, alice);

        vault.withdraw(assetId, versionOne, aliceAccount, 30 * UNIT, carol);
        vm.stopPrank();

        vm.prank(outsider);
        vm.expectRevert(abi.encodeWithSelector(ICollateralVault.NotAccountController.selector, aliceAccount, outsider));
        vault.withdraw(assetId, versionOne, aliceAccount, 1, outsider);

        (uint128 total, uint128 locked, uint128 available) = vault.balanceOf(aliceAccount, collateralOne);
        assertEq(total, 70 * UNIT);
        assertEq(locked, 70 * UNIT);
        assertEq(available, 0);
        assertEq(token.balanceOf(carol), 30 * UNIT);
    }

    function test_TransferAvailableMovesLedgerWithoutChangingAggregates() public {
        _deposit(alice, aliceAccount, 100 * UNIT);
        _approveOperator(alice, aliceAccount, locker);
        _createLock(REF_ONE, aliceAccount, 70 * UNIT, uint64(block.timestamp + 1 days));

        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(ICollateralVault.SelfTransfer.selector, aliceAccount));
        vault.transferAvailable(assetId, versionOne, aliceAccount, aliceAccount, 1 * UNIT);

        vm.expectRevert(
            abi.encodeWithSelector(
                ICollateralVault.InsufficientAvailable.selector, aliceAccount, collateralOne, 30 * UNIT, 31 * UNIT
            )
        );
        vault.transferAvailable(assetId, versionOne, aliceAccount, bobAccount, 31 * UNIT);

        vault.transferAvailable(assetId, versionOne, aliceAccount, bobAccount, 30 * UNIT);
        vm.stopPrank();

        (uint128 aliceTotal, uint128 aliceLocked,) = vault.balanceOf(aliceAccount, collateralOne);
        (uint128 bobTotal,, uint128 bobAvailable) = vault.balanceOf(bobAccount, collateralOne);
        assertEq(aliceTotal, 70 * UNIT);
        assertEq(aliceLocked, 70 * UNIT);
        assertEq(bobTotal, 30 * UNIT);
        assertEq(bobAvailable, 30 * UNIT);

        assertEq(vault.collateralLiability(collateralOne), 100 * UNIT);
        assertEq(vault.tokenLiability(address(token)), 100 * UNIT);
        assertEq(vault.tokenBalance(address(token)), 100 * UNIT);
    }

    function test_CreateLockNeedsGlobalRoleAndLivePerAccountApproval() public {
        _deposit(alice, aliceAccount, 100 * UNIT);
        uint64 expiry = uint64(block.timestamp + 1 days);

        vm.prank(locker);
        vm.expectRevert(abi.encodeWithSelector(ICollateralVault.LockOperatorNotApproved.selector, aliceAccount, locker));
        vault.createLock(REF_ONE, aliceAccount, assetId, versionOne, 10 * UNIT, expiry, settler);

        _approveOperator(alice, aliceAccount, outsider);
        vm.prank(outsider);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, outsider, lockerRole)
        );
        vault.createLock(REF_ONE, aliceAccount, assetId, versionOne, 10 * UNIT, expiry, settler);

        _approveOperator(alice, aliceAccount, locker);
        assertTrue(vault.isLockOperator(aliceAccount, locker));
        assertEq(
            CollateralLockId.unwrap(_createLock(REF_ONE, aliceAccount, 10 * UNIT, expiry)),
            CollateralLockId.unwrap(lockOne)
        );

        vm.prank(alice);
        vault.setLockOperator(aliceAccount, locker, false);

        vm.prank(locker);
        vm.expectRevert(abi.encodeWithSelector(ICollateralVault.LockOperatorNotApproved.selector, aliceAccount, locker));
        vault.createLock(REF_TWO, aliceAccount, assetId, versionOne, 10 * UNIT, expiry, settler);

        assertEq(uint8(vault.lockStatusOf(lockOne)), uint8(LockStatus.Active));
        vm.prank(locker);
        vault.releaseLock(lockOne);
        assertEq(uint8(vault.lockStatusOf(lockOne)), uint8(LockStatus.Released));
    }

    function test_CreateLockNamespacesTheReferenceAndValidatesItsInputs() public {
        _deposit(alice, aliceAccount, 100 * UNIT);
        _approveOperator(alice, aliceAccount, locker);
        _approveOperator(alice, aliceAccount, outsider);
        vm.startPrank(admin);
        vault.grantRole(lockerRole, outsider);
        vault.grantRole(settlerRole, carol);
        vm.stopPrank();

        uint64 nowTs = uint64(block.timestamp);
        uint256 maxExpiry = uint256(nowTs) + MAX_LOCK_DURATION;

        vm.startPrank(locker);
        vm.expectRevert(ICollateralVault.ZeroLockReference.selector);
        vault.createLock(bytes32(0), aliceAccount, assetId, versionOne, 1, nowTs + 1, settler);

        vm.expectRevert(ICollateralVault.ZeroSettlementOperator.selector);
        vault.createLock(REF_ONE, aliceAccount, assetId, versionOne, 1, nowTs + 1, address(0));

        vm.expectRevert(abi.encodeWithSelector(ICollateralVault.SettlementOperatorNotAuthorized.selector, outsider));
        vault.createLock(REF_ONE, aliceAccount, assetId, versionOne, 1, nowTs + 1, outsider);

        vm.expectRevert(ICollateralVault.ZeroAmount.selector);
        vault.createLock(REF_ONE, aliceAccount, assetId, versionOne, 0, nowTs + 1, settler);

        vm.expectRevert(abi.encodeWithSelector(ICollateralVault.InvalidLockExpiry.selector, nowTs, nowTs, maxExpiry));
        vault.createLock(REF_ONE, aliceAccount, assetId, versionOne, 1, nowTs, settler);

        vm.expectRevert(
            abi.encodeWithSelector(ICollateralVault.InvalidLockExpiry.selector, uint64(maxExpiry + 1), nowTs, maxExpiry)
        );
        vault.createLock(REF_ONE, aliceAccount, assetId, versionOne, 1, uint64(maxExpiry + 1), settler);

        vault.createLock(REF_ONE, aliceAccount, assetId, versionOne, 1 * UNIT, uint64(maxExpiry), settler);

        vm.expectRevert(abi.encodeWithSelector(ICollateralVault.LockAlreadyExists.selector, lockOne));
        vault.createLock(REF_ONE, aliceAccount, assetId, versionOne, 1 * UNIT, nowTs + 1, settler);

        vm.expectRevert(abi.encodeWithSelector(ICollateralVault.BindingClosedForNewRisk.selector, assetId, uint32(99)));
        vault.createLock(REF_TWO, aliceAccount, assetId, 99, 1 * UNIT, nowTs + 1, settler);
        vm.stopPrank();

        vm.prank(outsider);
        CollateralLockId outsiderLock =
            vault.createLock(REF_ONE, aliceAccount, assetId, versionOne, 1 * UNIT, nowTs + 1, carol);
        assertEq(CollateralLockId.unwrap(outsiderLock), CollateralLockId.unwrap(vault.deriveLockId(outsider, REF_ONE)));
        assertTrue(CollateralLockId.unwrap(outsiderLock) != CollateralLockId.unwrap(lockOne));

        CollateralLock memory lock = vault.getLock(lockOne);
        assertEq(AccountId.unwrap(lock.accountId), AccountId.unwrap(aliceAccount));
        assertEq(CollateralId.unwrap(lock.collateralId), CollateralId.unwrap(collateralOne));
        assertEq(lock.lockReference, REF_ONE);
        assertEq(lock.operator, locker);
        assertEq(lock.settlementOperator, settler);
        assertEq(lock.bindingVersion, versionOne);
        assertEq(lock.initialAmount, 1 * UNIT);
        assertEq(lock.remainingAmount, 1 * UNIT);
        assertEq(lock.expiry, uint64(maxExpiry));

        assertEq(vault.getLock(outsiderLock).lockReference, REF_ONE);
        assertEq(vault.getLock(outsiderLock).settlementOperator, carol);
    }

    function test_EarlyReleaseIsLimitedToTheOriginalOperatorWithALiveRole() public {
        _deposit(alice, aliceAccount, 100 * UNIT);
        _approveOperator(alice, aliceAccount, locker);
        _createLock(REF_ONE, aliceAccount, 70 * UNIT, uint64(block.timestamp + 1 days));

        vm.prank(admin);
        vault.grantRole(lockerRole, outsider);
        vm.prank(outsider);
        vm.expectRevert(abi.encodeWithSelector(ICollateralVault.NotLockOperator.selector, lockOne, outsider));
        vault.releaseLock(lockOne);

        vm.prank(admin);
        vault.revokeRole(lockerRole, locker);
        vm.prank(locker);
        vm.expectRevert(abi.encodeWithSelector(ICollateralVault.LockOperatorNotAuthorized.selector, lockOne, locker));
        vault.releaseLock(lockOne);

        vm.startPrank(admin);
        vault.grantRole(lockerRole, locker);
        settlement.pauseBinding(assetId, versionOne);
        settlement.deprecateBinding(assetId, versionOne);
        vm.stopPrank();

        vm.prank(locker);
        vault.releaseLock(lockOne);

        (uint128 total, uint128 locked, uint128 available) = vault.balanceOf(aliceAccount, collateralOne);
        assertEq(total, 100 * UNIT);
        assertEq(locked, 0);
        assertEq(available, 100 * UNIT);
        assertEq(uint8(vault.lockStatusOf(lockOne)), uint8(LockStatus.Released));

        vm.prank(locker);
        vm.expectRevert(abi.encodeWithSelector(ICollateralVault.LockNotActive.selector, lockOne, LockStatus.Released));
        vault.releaseLock(lockOne);
    }

    /// @dev Also proves a revoked pinned settler cannot strand collateral: it stops consuming the
    /// moment the role goes, and the permissionless expiry path still gives the pledge back.
    function test_ExpiredLockReleaseIsPermissionlessAtTheExpiryBoundary() public {
        _deposit(alice, aliceAccount, 100 * UNIT);
        _approveOperator(alice, aliceAccount, locker);

        uint64 expiry = uint64(block.timestamp + 1 days);
        _createLock(REF_ONE, aliceAccount, 70 * UNIT, expiry);

        vm.warp(expiry - 1);
        vm.prank(outsider);
        vm.expectRevert(abi.encodeWithSelector(ICollateralVault.LockNotExpired.selector, lockOne, expiry));
        vault.releaseExpiredLock(lockOne);

        vm.prank(admin);
        vault.revokeRole(settlerRole, settler);
        vm.prank(settler);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, settler, settlerRole)
        );
        vault.consumeLock(lockOne, bobAccount, 1 * UNIT);
        vm.prank(admin);
        vault.grantRole(settlerRole, settler);

        vm.warp(expiry);
        vm.prank(locker);
        vm.expectRevert(abi.encodeWithSelector(ICollateralVault.LockExpired.selector, lockOne, expiry));
        vault.releaseLock(lockOne);

        vm.prank(settler);
        vm.expectRevert(abi.encodeWithSelector(ICollateralVault.LockExpired.selector, lockOne, expiry));
        vault.consumeLock(lockOne, bobAccount, 1 * UNIT);

        vm.prank(admin);
        vault.revokeRole(settlerRole, settler);
        vm.prank(outsider);
        vault.releaseExpiredLock(lockOne);

        (uint128 total, uint128 locked, uint128 available) = vault.balanceOf(aliceAccount, collateralOne);
        assertEq(total, 100 * UNIT);
        assertEq(locked, 0);
        assertEq(available, 100 * UNIT);
        assertEq(uint8(vault.lockStatusOf(lockOne)), uint8(LockStatus.Expired));
    }

    function test_ConsumeLockSupportsPartialThenFinalSettlement() public {
        _deposit(alice, aliceAccount, 100 * UNIT);
        _approveOperator(alice, aliceAccount, locker);
        _createLock(REF_ONE, aliceAccount, 70 * UNIT, uint64(block.timestamp + 1 days));

        vm.prank(settler);
        vault.consumeLock(lockOne, bobAccount, 20 * UNIT);

        (uint128 aliceTotal, uint128 aliceLocked, uint128 aliceAvailable) = vault.balanceOf(aliceAccount, collateralOne);
        (uint128 bobTotal,,) = vault.balanceOf(bobAccount, collateralOne);
        assertEq(aliceTotal, 80 * UNIT);
        assertEq(aliceLocked, 50 * UNIT);
        assertEq(aliceAvailable, 30 * UNIT);
        assertEq(bobTotal, 20 * UNIT);
        assertEq(uint8(vault.lockStatusOf(lockOne)), uint8(LockStatus.Active));
        assertEq(vault.getLock(lockOne).remainingAmount, 50 * UNIT);

        assertEq(vault.collateralLiability(collateralOne), 100 * UNIT);
        assertEq(vault.tokenLiability(address(token)), 100 * UNIT);
        assertEq(vault.tokenBalance(address(token)), 100 * UNIT);

        vm.prank(settler);
        vault.consumeLock(lockOne, bobAccount, 50 * UNIT);

        (aliceTotal, aliceLocked, aliceAvailable) = vault.balanceOf(aliceAccount, collateralOne);
        (bobTotal,,) = vault.balanceOf(bobAccount, collateralOne);
        assertEq(aliceTotal, 30 * UNIT);
        assertEq(aliceLocked, 0);
        assertEq(aliceAvailable, 30 * UNIT);
        assertEq(bobTotal, 70 * UNIT);
        assertEq(uint8(vault.lockStatusOf(lockOne)), uint8(LockStatus.Consumed));
        assertEq(vault.collateralLiability(collateralOne), 100 * UNIT);
        assertEq(vault.tokenLiability(address(token)), 100 * UNIT);
        assertTrue(vault.isSolvent(address(token)));

        vm.prank(bob);
        vault.withdraw(assetId, versionOne, bobAccount, 70 * UNIT, bob);
        assertEq(token.balanceOf(bob), FUNDING + 70 * UNIT);
    }

    function test_ConsumeLockIsLimitedToThePinnedSettlerAndValidatesItsInputs() public {
        _deposit(alice, aliceAccount, 100 * UNIT);
        _approveOperator(alice, aliceAccount, locker);
        _createLock(REF_ONE, aliceAccount, 70 * UNIT, uint64(block.timestamp + 1 days));

        AccountId ghost = vault.deriveAccountId(outsider, keccak256("ghost"));
        AccountId aliceSecond = _createAccount(alice, keccak256("alice.secondary"));
        _deposit(alice, aliceSecond, 1 * UNIT);
        _approveOperator(alice, aliceSecond, locker);

        vm.prank(admin);
        vault.grantRole(settlerRole, carol);
        vm.prank(carol);
        vm.expectRevert(
            abi.encodeWithSelector(ICollateralVault.NotLockSettlementOperator.selector, lockOne, settler, carol)
        );
        vault.consumeLock(lockOne, bobAccount, 1 * UNIT);

        vm.startPrank(settler);
        vm.expectRevert(abi.encodeWithSelector(ICollateralVault.UnknownLock.selector, lockTwo));
        vault.consumeLock(lockTwo, bobAccount, 1 * UNIT);

        vm.expectRevert(abi.encodeWithSelector(ICollateralVault.UnknownAccount.selector, ghost));
        vault.consumeLock(lockOne, ghost, 1 * UNIT);

        vm.expectRevert(ICollateralVault.ZeroAmount.selector);
        vault.consumeLock(lockOne, bobAccount, 0);

        vm.expectRevert(
            abi.encodeWithSelector(ICollateralVault.AmountAboveLockRemaining.selector, lockOne, 70 * UNIT, 71 * UNIT)
        );
        vault.consumeLock(lockOne, bobAccount, 71 * UNIT);
        vm.stopPrank();

        _createLock(REF_TWO, aliceSecond, 1 * UNIT, uint64(block.timestamp + 1 days));
        vm.prank(settler);
        vm.expectRevert(abi.encodeWithSelector(ICollateralVault.SelfConsumption.selector, aliceSecond));
        vault.consumeLock(lockTwo, aliceSecond, 1 * UNIT);

        (uint128 total, uint128 locked,) = vault.balanceOf(aliceAccount, collateralOne);
        assertEq(total, 100 * UNIT);
        assertEq(locked, 70 * UNIT);
    }

    function test_RolesAreSeparateAndNoneCanTouchUserBalances() public {
        _deposit(alice, aliceAccount, 100 * UNIT);
        _approveOperator(alice, aliceAccount, locker);
        _approveOperator(alice, aliceAccount, settler);
        _createLock(REF_ONE, aliceAccount, 70 * UNIT, uint64(block.timestamp + 1 days));

        vm.prank(locker);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, locker, settlerRole)
        );
        vault.consumeLock(lockOne, bobAccount, 1 * UNIT);

        vm.prank(settler);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, settler, lockerRole)
        );
        vault.createLock(
            REF_TWO, aliceAccount, assetId, versionOne, 1 * UNIT, uint64(block.timestamp + 1 days), settler
        );

        vm.prank(settler);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, settler, recoveryRole)
        );
        vault.recoverExcess(assetId, versionOne, settler, 1);

        vm.prank(recoverer);
        vm.expectRevert(abi.encodeWithSelector(ICollateralVault.NotAccountController.selector, aliceAccount, recoverer));
        vault.withdraw(assetId, versionOne, aliceAccount, 1 * UNIT, recoverer);

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ICollateralVault.NotAccountController.selector, aliceAccount, admin));
        vault.withdraw(assetId, versionOne, aliceAccount, 1 * UNIT, admin);

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ICollateralVault.NotAccountController.selector, aliceAccount, admin));
        vault.setLockOperator(aliceAccount, admin, true);

        assertEq(vault.tokenBalance(address(token)), 100 * UNIT);
        assertEq(vault.tokenLiability(address(token)), 100 * UNIT);
    }

    function test_TokenCallbackCannotCrossFunctionReenter() public {
        (AssetId evilAsset, uint32 evilVersion, ReentrantERC20 evil) = _registerReentrantToken();

        evil.arm(address(vault), abi.encodeCall(ICollateralVault.reentrancyCheck, ()));
        vm.prank(alice);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        vault.deposit(evilAsset, evilVersion, aliceAccount, 10 * UNIT);

        evil.arm(
            address(vault), abi.encodeCall(ICollateralVault.withdraw, (evilAsset, evilVersion, aliceAccount, 1, alice))
        );
        vm.prank(alice);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        vault.deposit(evilAsset, evilVersion, aliceAccount, 10 * UNIT);

        vault.reentrancyCheck();
        assertEq(vault.tokenLiability(address(evil)), 0);
        assertEq(vault.tokenBalance(address(evil)), 0);

        evil.disarm();
        vm.prank(alice);
        vault.deposit(evilAsset, evilVersion, aliceAccount, 10 * UNIT);
        assertEq(vault.tokenLiability(address(evil)), 10 * UNIT);
    }

    function test_RecoverExcessIsCappedByUnbackedSurplusOnly() public {
        _deposit(alice, aliceAccount, 100 * UNIT);
        token.mint(address(vault), 40 * UNIT);

        assertEq(vault.excessOf(address(token)), 40 * UNIT);
        assertTrue(vault.isSolvent(address(token)));

        vm.startPrank(recoverer);
        vm.expectRevert(
            abi.encodeWithSelector(
                ICollateralVault.InsufficientExcess.selector, address(token), 140 * UNIT, 100 * UNIT, uint128(41 * UNIT)
            )
        );
        vault.recoverExcess(assetId, versionOne, carol, 41 * UNIT);

        vm.expectRevert(ICollateralVault.ZeroRecipient.selector);
        vault.recoverExcess(assetId, versionOne, address(0), 1);

        vm.expectRevert(ICollateralVault.VaultRecipient.selector);
        vault.recoverExcess(assetId, versionOne, address(vault), 1);

        vm.expectRevert(ICollateralVault.ZeroAmount.selector);
        vault.recoverExcess(assetId, versionOne, carol, 0);

        vm.expectRevert(abi.encodeWithSelector(ICollateralVault.UnknownBindingVersion.selector, assetId, uint32(99)));
        vault.recoverExcess(assetId, 99, carol, 1);

        vault.recoverExcess(assetId, versionOne, carol, 40 * UNIT);
        vm.stopPrank();

        assertEq(token.balanceOf(carol), 40 * UNIT);
        assertEq(vault.excessOf(address(token)), 0);
        assertEq(vault.tokenLiability(address(token)), 100 * UNIT);
        assertEq(vault.tokenBalance(address(token)), 100 * UNIT);
        assertTrue(vault.isSolvent(address(token)));

        vm.prank(admin);
        settlement.pauseBinding(assetId, versionOne);
        vm.prank(admin);
        settlement.deprecateBinding(assetId, versionOne);

        token.mint(address(vault), 5 * UNIT);
        vm.prank(recoverer);
        vault.recoverExcess(assetId, versionOne, carol, 5 * UNIT);
        assertEq(token.balanceOf(carol), 45 * UNIT);

        vm.prank(recoverer);
        vm.expectRevert(
            abi.encodeWithSelector(
                ICollateralVault.InsufficientExcess.selector, address(token), 100 * UNIT, 100 * UNIT, uint128(1)
            )
        );
        vault.recoverExcess(assetId, versionOne, carol, 1);
    }

    function test_LockAndAccountReadsFailClosedOnUnknownRecords() public {
        AccountId ghost = vault.deriveAccountId(outsider, keccak256("ghost"));

        assertFalse(vault.accountExists(ghost));
        assertEq(uint8(vault.lockStatusOf(lockOne)), uint8(LockStatus.Unspecified));

        vm.expectRevert(abi.encodeWithSelector(ICollateralVault.UnknownLock.selector, lockOne));
        vault.getLock(lockOne);

        vm.expectRevert(abi.encodeWithSelector(ICollateralVault.UnknownAccount.selector, ghost));
        vault.lockOperatorEpoch(ghost);
        assertFalse(vault.isLockOperator(ghost, locker));
        assertEq(vault.lockOperatorEpoch(aliceAccount), 1);

        vm.prank(outsider);
        vm.expectRevert(abi.encodeWithSelector(ICollateralVault.UnknownAccount.selector, ghost));
        vault.proposeController(ghost, carol);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ICollateralVault.NoPendingController.selector, aliceAccount));
        vault.cancelControllerProposal(aliceAccount);

        vm.prank(alice);
        vm.expectRevert(ICollateralVault.ZeroLockOperator.selector);
        vault.setLockOperator(aliceAccount, address(0), true);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ICollateralVault.UnknownAccount.selector, ghost));
        vault.transferAvailable(assetId, versionOne, aliceAccount, ghost, 1);
    }

    function testFuzz_DepositAndWithdrawConserveBacking(uint128 depositAmount, uint128 withdrawAmount) public {
        depositAmount = uint128(bound(depositAmount, 1, FUNDING));
        withdrawAmount = uint128(bound(withdrawAmount, 1, depositAmount));

        _deposit(alice, aliceAccount, depositAmount);
        vm.prank(alice);
        vault.withdraw(assetId, versionOne, aliceAccount, withdrawAmount, carol);

        uint128 remaining = depositAmount - withdrawAmount;
        (uint128 total, uint128 locked, uint128 available) = vault.balanceOf(aliceAccount, collateralOne);
        assertEq(total, remaining);
        assertEq(locked, 0);
        assertEq(available, remaining);
        assertEq(vault.collateralLiability(collateralOne), remaining);
        assertEq(vault.tokenLiability(address(token)), remaining);
        assertEq(vault.tokenBalance(address(token)), remaining);
        assertEq(vault.excessOf(address(token)), 0);
        assertTrue(vault.isSolvent(address(token)));
        assertEq(token.balanceOf(carol), withdrawAmount);
    }

    function testFuzz_LockLifecycleConservesTheLedger(uint128 depositAmount, uint128 lockAmount, uint128 consumeAmount)
        public
    {
        depositAmount = uint128(bound(depositAmount, 1, FUNDING));
        lockAmount = uint128(bound(lockAmount, 1, depositAmount));
        consumeAmount = uint128(bound(consumeAmount, 1, lockAmount));

        _deposit(alice, aliceAccount, depositAmount);
        _approveOperator(alice, aliceAccount, locker);
        _createLock(REF_ONE, aliceAccount, lockAmount, uint64(block.timestamp + 1 days));

        vm.prank(settler);
        vault.consumeLock(lockOne, bobAccount, consumeAmount);

        (uint128 aliceTotal, uint128 aliceLocked, uint128 aliceAvailable) = vault.balanceOf(aliceAccount, collateralOne);
        (uint128 bobTotal, uint128 bobLocked,) = vault.balanceOf(bobAccount, collateralOne);

        assertEq(aliceTotal, depositAmount - consumeAmount);
        assertEq(aliceLocked, lockAmount - consumeAmount);
        assertEq(aliceAvailable, aliceTotal - aliceLocked);
        assertEq(bobTotal, consumeAmount);
        assertEq(bobLocked, 0);
        assertEq(aliceTotal + bobTotal, depositAmount);

        assertEq(vault.collateralLiability(collateralOne), depositAmount);
        assertEq(vault.tokenLiability(address(token)), depositAmount);
        assertEq(vault.tokenBalance(address(token)), depositAmount);
        assertTrue(vault.isSolvent(address(token)));

        if (consumeAmount == lockAmount) {
            assertEq(uint8(vault.lockStatusOf(lockOne)), uint8(LockStatus.Consumed));
        } else {
            assertEq(uint8(vault.lockStatusOf(lockOne)), uint8(LockStatus.Active));
        }
    }

    function _asset(bytes32 referenceId) internal pure returns (AssetDefinition memory) {
        return AssetDefinition({
            namespaceId: NAMESPACE_ID,
            referenceId: referenceId,
            symbol: SYMBOL,
            assetClass: AssetClass.Stablecoin,
            decimals: DECIMALS
        });
    }

    function _settlementDefinition(AssetId targetAssetId, address targetToken, bytes32 qualificationHash)
        internal
        view
        returns (SettlementAssetDefinition memory)
    {
        return SettlementAssetDefinition({
            assetId: targetAssetId,
            token: targetToken,
            expectedRuntimeCodeHash: targetToken.codehash,
            qualificationHash: qualificationHash
        });
    }

    function _registerActiveBinding(bytes32 referenceId, address targetToken)
        internal
        returns (AssetId newAssetId, uint32 version)
    {
        vm.startPrank(admin);
        newAssetId = canonical.registerAsset(_asset(referenceId));
        version = settlement.registerBinding(_settlementDefinition(newAssetId, targetToken, QUALIFICATION_ONE));
        settlement.activateBinding(newAssetId, version);
        vm.stopPrank();
    }

    /// @dev Registers a second immutable binding version naming the same physical token, then moves
    /// the active pointer onto it. Only one version of an asset may be active at a time.
    function _rotateToSecondVersion() internal returns (uint32 versionTwo) {
        vm.startPrank(admin);
        versionTwo = settlement.registerBinding(_settlementDefinition(assetId, address(token), QUALIFICATION_TWO));
        settlement.pauseBinding(assetId, versionOne);
        settlement.activateBinding(assetId, versionTwo);
        vm.stopPrank();
    }

    function _registerFeeToken() internal returns (AssetId, uint32, FeeOnTransferERC20) {
        FeeOnTransferERC20 feeToken = new FeeOnTransferERC20(DECIMALS, 1);
        (AssetId newAssetId, uint32 version) = _registerActiveBinding(keccak256("usd:fee"), address(feeToken));
        feeToken.mint(alice, FUNDING);
        vm.prank(alice);
        feeToken.approve(address(vault), type(uint256).max);
        return (newAssetId, version, feeToken);
    }

    function _registerSilentToken() internal returns (AssetId, uint32, SilentNoOpERC20) {
        SilentNoOpERC20 silentToken = new SilentNoOpERC20(DECIMALS);
        (AssetId newAssetId, uint32 version) = _registerActiveBinding(keccak256("usd:silent"), address(silentToken));
        silentToken.mint(alice, FUNDING);
        return (newAssetId, version, silentToken);
    }

    function _registerFalseToken() internal returns (AssetId, uint32, FalseReturnERC20) {
        FalseReturnERC20 falseToken = new FalseReturnERC20(DECIMALS);
        (AssetId newAssetId, uint32 version) = _registerActiveBinding(keccak256("usd:false"), address(falseToken));
        falseToken.mint(alice, FUNDING);
        return (newAssetId, version, falseToken);
    }

    function _registerReentrantToken() internal returns (AssetId, uint32, ReentrantERC20) {
        ReentrantERC20 evil = new ReentrantERC20(DECIMALS);
        (AssetId newAssetId, uint32 version) = _registerActiveBinding(keccak256("usd:evil"), address(evil));
        evil.mint(alice, FUNDING);
        vm.prank(alice);
        evil.approve(address(vault), type(uint256).max);
        return (newAssetId, version, evil);
    }

    function _createAccount(address controller, bytes32 salt) internal returns (AccountId) {
        vm.prank(controller);
        return vault.createAccount(salt);
    }

    function _deposit(address payer, AccountId accountId, uint128 amount) internal {
        vm.prank(payer);
        vault.deposit(assetId, versionOne, accountId, amount);
    }

    function _approveOperator(address controller, AccountId accountId, address operator) internal {
        vm.prank(controller);
        vault.setLockOperator(accountId, operator, true);
    }

    function _createLock(bytes32 lockReference, AccountId accountId, uint128 amount, uint64 expiry)
        internal
        returns (CollateralLockId)
    {
        vm.prank(locker);
        return vault.createLock(lockReference, accountId, assetId, versionOne, amount, expiry, settler);
    }
}
