// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {ICollateralVault} from "../../src/interfaces/ICollateralVault.sol";
import {AccountPolicyAuthority} from "../../src/policy/AccountPolicyAuthority.sol";
import {AccountId} from "../../src/types/Identifiers.sol";

contract AccountPolicyVaultMock {
    struct Account {
        address controller;
        uint64 epoch;
    }

    mapping(AccountId accountId => Account account) private _accounts;
    mapping(AccountId accountId => mapping(address operator => bool approved)) private _operators;

    function setAccount(AccountId accountId, address controller, uint64 epoch) external {
        _accounts[accountId] = Account(controller, epoch);
    }

    function setOperator(AccountId accountId, address operator, bool approved) external {
        _operators[accountId][operator] = approved;
    }

    function getAccount(AccountId accountId) external view returns (address controller, address pendingController) {
        return (_accounts[accountId].controller, address(0));
    }

    function lockOperatorEpoch(AccountId accountId) external view returns (uint64) {
        return _accounts[accountId].epoch;
    }

    function isLockOperator(AccountId accountId, address operator) external view returns (bool) {
        return _operators[accountId][operator];
    }
}

contract AccountPolicyAuthorityTest is Test {
    AccountId internal constant ACCOUNT = AccountId.wrap(bytes32(uint256(1)));
    bytes32 internal constant POLICY = keccak256("policy");

    AccountPolicyVaultMock internal vault;
    AccountPolicyAuthority internal authority;
    address internal controller = makeAddr("controller");
    address internal delegate = makeAddr("delegate");

    function setUp() public {
        vault = new AccountPolicyVaultMock();
        vault.setAccount(ACCOUNT, controller, 1);
        vault.setOperator(ACCOUNT, delegate, true);
        authority = new AccountPolicyAuthority(ICollateralVault(address(vault)));
        vm.prank(controller);
        authority.delegatePolicy(ACCOUNT, delegate, POLICY, uint64(block.timestamp + 1 days));
    }

    function test_DelegateIsBoundToExactPolicyAndCurrentOperatorEpoch() public {
        assertTrue(authority.isAuthorizedSignerForPolicy(ACCOUNT, delegate, POLICY));
        assertFalse(authority.isAuthorizedSignerForPolicy(ACCOUNT, delegate, keccak256("other")));

        vault.setAccount(ACCOUNT, controller, 2);
        assertFalse(authority.isAuthorizedSignerForPolicy(ACCOUNT, delegate, POLICY));
    }

    function testFuzz_CompressionPolicyNonceIsOneShot(uint256 nonce) public {
        assertTrue(authority.consumeAuthorizedSigner(ACCOUNT, delegate, POLICY, nonce));
        assertFalse(authority.consumeAuthorizedSigner(ACCOUNT, delegate, POLICY, nonce));
    }

    function test_ControllerDoesNotNeedDelegationButStillConsumesNonce() public {
        assertTrue(authority.isAuthorizedSignerForPolicy(ACCOUNT, controller, keccak256("any exact action")));
        assertTrue(authority.consumeAuthorizedSigner(ACCOUNT, controller, keccak256("plan"), 7));
        assertFalse(authority.consumeAuthorizedSigner(ACCOUNT, controller, keccak256("plan"), 7));
    }

    function test_RevocationIsImmediate() public {
        vm.prank(controller);
        authority.revokePolicy(ACCOUNT, delegate);
        assertFalse(authority.isAuthorizedSignerForPolicy(ACCOUNT, delegate, POLICY));
    }
}
