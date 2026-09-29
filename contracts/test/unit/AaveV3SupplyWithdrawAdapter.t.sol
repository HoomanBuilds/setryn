// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import {
    AaveV3SupplyWithdrawAdapter,
    IAaveV3Pool,
    IAaveV3PoolAddressesProvider
} from "../../src/adapters/venue/AaveV3SupplyWithdrawAdapter.sol";
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

contract MockAaveMintable is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockAaveProvider is IAaveV3PoolAddressesProvider {
    address public pool;

    constructor(address pool_) {
        pool = pool_;
    }

    function setPool(address pool_) external {
        pool = pool_;
    }

    function getPool() external view returns (address) {
        return pool;
    }
}

contract MockAavePool is IAaveV3Pool {
    bool public shouldRevert;
    bool public supplyPullShort;
    bool public withdrawSendShort;
    uint256 public nextWithdrawReturnOverride;
    uint256 public supplyCalls;
    uint256 public withdrawCalls;

    function setShouldRevert(bool value) external {
        shouldRevert = value;
    }

    function setSupplyPullShort(bool value) external {
        supplyPullShort = value;
    }

    function setWithdrawSendShort(bool value) external {
        withdrawSendShort = value;
    }

    function setNextWithdrawReturnOverride(uint256 value) external {
        nextWithdrawReturnOverride = value;
    }

    function supply(address asset, uint256 amount, address, uint16) external {
        supplyCalls += 1;
        if (shouldRevert) revert("mock pool supply revert");
        uint256 toPull = supplyPullShort ? (amount > 0 ? amount - 1 : 0) : amount;
        if (toPull > 0) {
            IERC20(asset).transferFrom(msg.sender, address(this), toPull);
        }
    }

    function withdraw(address asset, uint256 amount, address to) external returns (uint256) {
        withdrawCalls += 1;
        if (shouldRevert) revert("mock pool withdraw revert");
        uint256 ret = nextWithdrawReturnOverride == 0 ? amount : nextWithdrawReturnOverride;
        uint256 toSend = withdrawSendShort ? (ret > 0 ? ret - 1 : 0) : ret;
        if (toSend > 0) {
            IERC20(asset).transfer(to, toSend);
        }
        return ret;
    }
}

contract AaveV3SupplyWithdrawAdapterTest is Test {
    MockAaveMintable private asset;
    MockAavePool private pool;
    MockAaveProvider private provider;
    AaveV3SupplyWithdrawAdapter private adapter;

    address private stager;
    address private manager;

    function setUp() external {
        asset = new MockAaveMintable("Asset", "AST");
        pool = new MockAavePool();
        provider = new MockAaveProvider(address(pool));
        stager = address(this);
        manager = address(this);
        adapter = new AaveV3SupplyWithdrawAdapter(
            block.chainid, address(provider), address(pool), address(this), 0, address(this), stager, manager
        );
        asset.mint(address(this), 1_000_000 ether);
        asset.mint(address(pool), 1_000_000 ether);
    }

    function test_DescriptorIsProxyFreeValueMovingAtomic() external view {
        AdapterRuntimeDescriptor memory descriptor = adapter.operationalAdapterDescriptor();
        assertEq(descriptor.self, address(adapter));
        assertEq(descriptor.chainId, block.chainid);
        assertEq(descriptor.interfaceHash, OperationalAdapterLib.INTERFACE_EXTERNAL_VENUE);
        assertEq(descriptor.capabilityHash, OperationalAdapterLib.CAPABILITY_EXTERNAL_ATOMIC);
        assertTrue(descriptor.proxyFree);
        assertTrue(descriptor.valueMoving);
    }

    function test_StageSupplyReservesInventory() external {
        uint256 amount = 10 ether;
        _fundAndSync(address(asset), amount);
        bytes32 actionHash = adapter.stageSupply(
            address(asset), amount, address(adapter), 0, uint64(block.timestamp + 1 hours), keccak256("policy")
        );
        bytes32 expected = adapter.hashStagedSupply(
            address(asset),
            amount,
            address(adapter),
            0,
            uint64(block.timestamp + 1 hours),
            keccak256("policy"),
            address(pool)
        );
        assertEq(actionHash, expected);
        assertEq(adapter.reservedBalance(address(asset)), amount);
        assertEq(adapter.unreservedBalance(address(asset)), 0);
    }

    function test_StageWithdrawReservesPositionCapacity() external {
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 policy = keccak256("policy");
        _fundAndSync(address(asset), 5 ether);
        bytes32 supplyHash = adapter.stageSupply(address(asset), 5 ether, address(adapter), 0, deadline, policy);
        adapter.submitExternalAction(_request(supplyHash));
        assertEq(adapter.managedPositionCapacity(address(asset)), 5 ether);
        bytes32 actionHash = adapter.stageWithdraw(address(asset), 2 ether, address(this), deadline, policy);
        assertTrue(actionHash != bytes32(0));
        assertEq(adapter.reservedPositionCapacity(address(asset)), 2 ether);
        assertEq(adapter.unreservedPositionCapacity(address(asset)), 3 ether);
        assertEq(adapter.reservedBalance(address(asset)), 0);
        assertEq(adapter.managedPositionCapacity(address(asset)), 5 ether);
    }

    function test_RevertWhenOverReservation() external {
        _fundAndSync(address(asset), 5 ether);
        adapter.stageSupply(
            address(asset), 5 ether, address(adapter), 0, uint64(block.timestamp + 1 hours), keccak256("policy")
        );
        vm.expectRevert();
        adapter.stageSupply(
            address(asset), 1, address(adapter), 0, uint64(block.timestamp + 1 hours), keccak256("policy-2")
        );
    }

    function test_RevertOnInvalidSupplyStaging() external {
        _fundAndSync(address(asset), 10 ether);
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 policy = keccak256("policy");
        vm.expectRevert(AaveV3SupplyWithdrawAdapter.ZeroAmount.selector);
        adapter.stageSupply(address(asset), 0, address(adapter), 0, deadline, policy);
        vm.expectRevert(AaveV3SupplyWithdrawAdapter.ZeroOnBehalfOf.selector);
        adapter.stageSupply(address(asset), 1 ether, address(0), 0, deadline, policy);
        vm.expectRevert(AaveV3SupplyWithdrawAdapter.ZeroPolicyHash.selector);
        adapter.stageSupply(address(asset), 1 ether, address(adapter), 0, deadline, bytes32(0));
        vm.expectRevert();
        adapter.stageSupply(address(asset), 1 ether, address(adapter), 0, uint64(block.timestamp), policy);
        address codeless = makeAddr("codeless");
        vm.expectRevert();
        adapter.stageSupply(codeless, 1 ether, address(adapter), 0, deadline, policy);
        vm.expectRevert(
            abi.encodeWithSelector(AaveV3SupplyWithdrawAdapter.AmountOverflow.selector, uint256(type(int256).max) + 1)
        );
        adapter.stageSupply(address(asset), uint256(type(int256).max) + 1, address(adapter), 0, deadline, policy);
    }

    function test_RevertOnInvalidWithdrawStaging() external {
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 policy = keccak256("policy");
        vm.expectRevert(AaveV3SupplyWithdrawAdapter.ZeroRecipient.selector);
        adapter.stageWithdraw(address(asset), 1 ether, address(0), deadline, policy);
        vm.expectRevert(AaveV3SupplyWithdrawAdapter.ZeroAmount.selector);
        adapter.stageWithdraw(address(asset), 0, address(this), deadline, policy);
        vm.expectRevert(abi.encodeWithSelector(AaveV3SupplyWithdrawAdapter.AmountOverflow.selector, type(uint256).max));
        adapter.stageWithdraw(address(asset), type(uint256).max, address(this), deadline, policy);
    }

    function test_SuccessfulSupplyClearsAllowanceAndStoresResult() external {
        uint256 amount = 10 ether;
        _fundAndSync(address(asset), amount);
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 policy = keccak256("policy");
        bytes32 actionHash = adapter.stageSupply(address(asset), amount, address(adapter), 7, deadline, policy);
        ExternalVenueRequest memory request = _request(actionHash);
        ExternalVenueRequest memory copy = request;
        bytes32 requestHash = OperationalAdapterLib.hashExternalRequest(copy);
        uint256 before = asset.balanceOf(address(adapter));
        ExternalVenueResult memory result = adapter.submitExternalAction(request);
        assertEq(uint8(result.state), uint8(OperationalActionState.Complete));
        assertEq(result.realizedValue, int256(amount));
        assertEq(result.residualValue, 0);
        assertEq(result.venueActionReference, actionHash);
        assertEq(result.postconditionsHash, request.binding.expectedPostconditionsHash);
        assertTrue(result.evidenceHash != bytes32(0));
        assertEq(result.recoveryOutcomeHash, bytes32(0));
        assertEq(asset.balanceOf(address(adapter)), before - amount);
        assertEq(asset.allowance(address(adapter), address(pool)), 0);
        assertEq(adapter.reservedBalance(address(asset)), 0);
        ExternalVenueResult memory reconciled = adapter.reconcileExternalAction(requestHash);
        assertEq(reconciled.evidenceHash, result.evidenceHash);
    }

    function test_SuccessfulWithdrawToExternalRecipient() external {
        uint256 amount = 4 ether;
        _fundAndSync(address(asset), amount);
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 policy = keccak256("policy");
        bytes32 supplyHash = adapter.stageSupply(address(asset), amount, address(adapter), 0, deadline, policy);
        adapter.submitExternalAction(_request(supplyHash));
        assertEq(adapter.managedPositionCapacity(address(asset)), amount);
        address recipient = makeAddr("recipient");
        bytes32 actionHash = adapter.stageWithdraw(address(asset), amount, recipient, deadline, policy);
        ExternalVenueRequest memory request = _request(actionHash);
        uint256 adapterBefore = asset.balanceOf(address(adapter));
        uint256 recipientBefore = asset.balanceOf(recipient);
        ExternalVenueResult memory result = adapter.submitExternalAction(request);
        assertEq(uint8(result.state), uint8(OperationalActionState.Complete));
        assertEq(result.realizedValue, int256(amount));
        assertEq(asset.balanceOf(address(adapter)), adapterBefore);
        assertEq(asset.balanceOf(recipient), recipientBefore + amount);
        assertEq(adapter.inventoriedBalance(address(asset)), adapterBefore);
        assertEq(adapter.managedPositionCapacity(address(asset)), 0);
        assertEq(adapter.reservedPositionCapacity(address(asset)), 0);
    }

    function test_SuccessfulWithdrawToAdapterUpdatesInventory() external {
        uint256 supplyAmount = 3 ether;
        _fundAndSync(address(asset), 5 ether);
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 policy = keccak256("policy");
        bytes32 supplyHash = adapter.stageSupply(address(asset), supplyAmount, address(adapter), 0, deadline, policy);
        adapter.submitExternalAction(_request(supplyHash));
        assertEq(adapter.managedPositionCapacity(address(asset)), supplyAmount);
        bytes32 actionHash = adapter.stageWithdraw(address(asset), supplyAmount, address(adapter), deadline, policy);
        ExternalVenueRequest memory request = _request(actionHash);
        uint256 before = asset.balanceOf(address(adapter));
        ExternalVenueResult memory result = adapter.submitExternalAction(request);
        assertEq(result.realizedValue, int256(supplyAmount));
        assertEq(asset.balanceOf(address(adapter)), before + supplyAmount);
        assertEq(adapter.inventoriedBalance(address(asset)), before + supplyAmount);
        assertEq(adapter.managedPositionCapacity(address(asset)), 0);
        assertEq(adapter.reservedPositionCapacity(address(asset)), 0);
    }

    function test_PostconditionsPrecomputable() external view {
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 policy = keccak256("policy");
        bytes32 supplyHash =
            adapter.hashStagedSupply(address(asset), 1 ether, address(adapter), 0, deadline, policy, address(pool));
        bytes32 first = adapter.hashSupplyPostconditions(
            supplyHash, address(asset), 1 ether, address(adapter), 0, deadline, policy, address(pool)
        );
        bytes32 second = adapter.hashSupplyPostconditions(
            supplyHash, address(asset), 1 ether, address(adapter), 0, deadline, policy, address(pool)
        );
        assertEq(first, second);
        assertTrue(first != bytes32(0));
        bytes32 withdrawHash =
            adapter.hashStagedWithdraw(address(asset), 1 ether, address(this), deadline, policy, address(pool));
        bytes32 wFirst = adapter.hashWithdrawPostconditions(
            withdrawHash, address(asset), 1 ether, address(this), deadline, policy, address(pool)
        );
        bytes32 wSecond = adapter.hashWithdrawPostconditions(
            withdrawHash, address(asset), 1 ether, address(this), deadline, policy, address(pool)
        );
        assertEq(wFirst, wSecond);
        assertTrue(wFirst != bytes32(0));
        assertTrue(wFirst != first);
    }

    function test_RevertOnWrongPostconditions() external {
        _fundAndSync(address(asset), 2 ether);
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 policy = keccak256("policy");
        bytes32 actionHash = adapter.stageSupply(address(asset), 2 ether, address(adapter), 0, deadline, policy);
        ExternalVenueRequest memory request = _request(actionHash);
        bytes32 correct = request.binding.expectedPostconditionsHash;
        request.binding.expectedPostconditionsHash = keccak256("wrong");
        vm.expectRevert(
            abi.encodeWithSelector(
                AaveV3SupplyWithdrawAdapter.ExpectedPostconditionsMismatch.selector, correct, keccak256("wrong")
            )
        );
        adapter.submitExternalAction(request);
        assertFalse(adapter.getStagedAction(actionHash).consumed);
        assertEq(asset.allowance(address(adapter), address(pool)), 0);
    }

    function test_RevertOnBindingDeadlineMismatch() external {
        _fundAndSync(address(asset), 2 ether);
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 policy = keccak256("policy");
        bytes32 actionHash = adapter.stageSupply(address(asset), 2 ether, address(adapter), 0, deadline, policy);
        ExternalVenueRequest memory request = _request(actionHash);
        request.binding.deadline = deadline + 1;
        vm.expectRevert(
            abi.encodeWithSelector(AaveV3SupplyWithdrawAdapter.BindingDeadlineMismatch.selector, deadline + 1, deadline)
        );
        adapter.submitExternalAction(request);
        assertFalse(adapter.getStagedAction(actionHash).consumed);
    }

    function test_RevertOnBindingMinValueMismatch() external {
        _fundAndSync(address(asset), 2 ether);
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 policy = keccak256("policy");
        bytes32 actionHash = adapter.stageSupply(address(asset), 2 ether, address(adapter), 0, deadline, policy);
        ExternalVenueRequest memory request = _request(actionHash);
        request.binding.minValue = int256(3 ether);
        request.binding.maxValue = int256(4 ether);
        vm.expectRevert(
            abi.encodeWithSelector(
                AaveV3SupplyWithdrawAdapter.BindingMinValueMismatch.selector, int256(3 ether), 2 ether
            )
        );
        adapter.submitExternalAction(request);
    }

    function test_RevertWhenRealizedAboveMaxRollsBack() external {
        _fundAndSync(address(asset), 2 ether);
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 policy = keccak256("policy");
        bytes32 actionHash = adapter.stageSupply(address(asset), 2 ether, address(adapter), 0, deadline, policy);
        ExternalVenueRequest memory request = _request(actionHash);
        request.binding.minValue = int256(1 ether);
        request.binding.maxValue = int256(1 ether);
        vm.expectRevert(
            abi.encodeWithSelector(
                AaveV3SupplyWithdrawAdapter.RealizedValueOutOfRange.selector, 2 ether, int256(1 ether), int256(1 ether)
            )
        );
        adapter.submitExternalAction(request);
        assertFalse(adapter.getStagedAction(actionHash).consumed);
        assertEq(adapter.reservedBalance(address(asset)), 2 ether);
        assertEq(asset.allowance(address(adapter), address(pool)), 0);
    }

    function test_PointerChangeFailsClosed() external {
        _fundAndSync(address(asset), 5 ether);
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 policy = keccak256("policy");
        bytes32 actionHash = adapter.stageSupply(address(asset), 2 ether, address(adapter), 0, deadline, policy);
        MockAavePool newPool = new MockAavePool();
        asset.mint(address(newPool), 1 ether);
        provider.setPool(address(newPool));
        ExternalVenueRequest memory request = _request(actionHash);
        vm.expectRevert();
        adapter.submitExternalAction(request);
        assertFalse(adapter.getStagedAction(actionHash).consumed);
        assertEq(adapter.reservedBalance(address(asset)), 2 ether);
        vm.expectRevert(
            abi.encodeWithSelector(AaveV3SupplyWithdrawAdapter.PoolMismatch.selector, address(pool), address(newPool))
        );
        adapter.stageSupply(address(asset), 1 ether, address(adapter), 0, deadline, keccak256("other"));
    }

    function test_SupplyFeeOnTransferReverts() external {
        _fundAndSync(address(asset), 5 ether);
        pool.setSupplyPullShort(true);
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 policy = keccak256("policy");
        bytes32 actionHash = adapter.stageSupply(address(asset), 2 ether, address(adapter), 0, deadline, policy);
        ExternalVenueRequest memory request = _request(actionHash);
        vm.expectRevert();
        adapter.submitExternalAction(request);
        assertFalse(adapter.getStagedAction(actionHash).consumed);
        assertEq(adapter.reservedBalance(address(asset)), 2 ether);
        assertEq(asset.allowance(address(adapter), address(pool)), 0);
    }

    function test_WithdrawInexactReceiptReverts() external {
        _fundAndSync(address(asset), 2 ether);
        uint64 supplyDeadline = uint64(block.timestamp + 1 hours);
        bytes32 supplyPolicy = keccak256("supply-policy");
        bytes32 supplyHash =
            adapter.stageSupply(address(asset), 2 ether, address(adapter), 0, supplyDeadline, supplyPolicy);
        adapter.submitExternalAction(_request(supplyHash));
        pool.setWithdrawSendShort(true);
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 policy = keccak256("policy");
        address recipient = makeAddr("recipient");
        bytes32 actionHash = adapter.stageWithdraw(address(asset), 2 ether, recipient, deadline, policy);
        ExternalVenueRequest memory request = _request(actionHash);
        vm.expectRevert();
        adapter.submitExternalAction(request);
        assertFalse(adapter.getStagedAction(actionHash).consumed);
        assertEq(adapter.managedPositionCapacity(address(asset)), 2 ether);
        assertEq(adapter.reservedPositionCapacity(address(asset)), 2 ether);
    }

    function test_WithdrawPartialFillReverts() external {
        _fundAndSync(address(asset), 2 ether);
        uint64 supplyDeadline = uint64(block.timestamp + 1 hours);
        bytes32 supplyPolicy = keccak256("supply-policy");
        bytes32 supplyHash =
            adapter.stageSupply(address(asset), 2 ether, address(adapter), 0, supplyDeadline, supplyPolicy);
        adapter.submitExternalAction(_request(supplyHash));
        pool.setNextWithdrawReturnOverride(1 ether);
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 policy = keccak256("policy");
        bytes32 actionHash = adapter.stageWithdraw(address(asset), 2 ether, address(this), deadline, policy);
        ExternalVenueRequest memory request = _request(actionHash);
        vm.expectRevert(abi.encodeWithSelector(AaveV3SupplyWithdrawAdapter.PartialWithdraw.selector, 2 ether, 1 ether));
        adapter.submitExternalAction(request);
        assertFalse(adapter.getStagedAction(actionHash).consumed);
        assertEq(adapter.managedPositionCapacity(address(asset)), 2 ether);
        assertEq(adapter.reservedPositionCapacity(address(asset)), 2 ether);
    }

    function test_RevertOnReplayAndImmutability() external {
        _fundAndSync(address(asset), 2 ether);
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 policy = keccak256("policy");
        bytes32 actionHash = adapter.stageSupply(address(asset), 2 ether, address(adapter), 0, deadline, policy);
        ExternalVenueRequest memory request = _request(actionHash);
        ExternalVenueResult memory first = adapter.submitExternalAction(request);
        vm.expectRevert();
        adapter.submitExternalAction(request);
        ExternalVenueRequest memory copy = request;
        bytes32 requestHash = OperationalAdapterLib.hashExternalRequest(copy);
        ExternalVenueResult memory again = adapter.reconcileExternalAction(requestHash);
        assertEq(again.evidenceHash, first.evidenceHash);
    }

    function test_RoleRestrictions() external {
        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        vm.expectRevert();
        adapter.stageSupply(
            address(asset), 1 ether, address(adapter), 0, uint64(block.timestamp + 1 hours), keccak256("p")
        );
        vm.prank(stranger);
        vm.expectRevert();
        adapter.stageWithdraw(address(asset), 1 ether, stranger, uint64(block.timestamp + 1 hours), keccak256("p"));
        _fundAndSync(address(asset), 2 ether);
        bytes32 actionHash = adapter.stageSupply(
            address(asset), 2 ether, address(adapter), 0, uint64(block.timestamp + 1 hours), keccak256("policy")
        );
        ExternalVenueRequest memory request = _request(actionHash);
        vm.prank(stranger);
        vm.expectRevert();
        adapter.submitExternalAction(request);
        vm.prank(stranger);
        vm.expectRevert();
        adapter.withdrawInventory(address(asset), 1, stranger);
        vm.prank(stranger);
        vm.expectRevert();
        adapter.cancelStagedAction(actionHash);
    }

    function test_ExpiryReverts() external {
        _fundAndSync(address(asset), 2 ether);
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 policy = keccak256("policy");
        bytes32 actionHash = adapter.stageSupply(address(asset), 2 ether, address(adapter), 0, deadline, policy);
        ExternalVenueRequest memory request = _request(actionHash);
        vm.warp(deadline + 1);
        vm.expectRevert();
        adapter.submitExternalAction(request);
    }

    function test_BoundsChecks() external {
        _fundAndSync(address(asset), 2 ether);
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 policy = keccak256("policy");
        bytes32 actionHash = adapter.stageSupply(address(asset), 2 ether, address(adapter), 0, deadline, policy);
        ExternalVenueRequest memory request = _request(actionHash);
        request.guaranteeClass = ExecutionGuaranteeClass.BoundedAsync;
        vm.expectRevert();
        adapter.submitExternalAction(request);
        ExternalVenueRequest memory atomic = _request(actionHash);
        atomic.timeoutAt = 1;
        vm.expectRevert(AaveV3SupplyWithdrawAdapter.InvalidAtomicBounds.selector);
        adapter.submitExternalAction(atomic);
    }

    function test_CancelReleasesSupplyOnly() external {
        _fundAndSync(address(asset), 5 ether);
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 policy = keccak256("policy");
        bytes32 supplyHash = adapter.stageSupply(address(asset), 5 ether, address(adapter), 0, deadline, policy);
        assertEq(adapter.reservedBalance(address(asset)), 5 ether);
        adapter.cancelStagedAction(supplyHash);
        assertEq(adapter.reservedBalance(address(asset)), 0);
        ExternalVenueRequest memory request = _request(supplyHash);
        vm.expectRevert();
        adapter.submitExternalAction(request);
        _fundAndSync(address(asset), 2 ether);
        bytes32 managedSupplyHash =
            adapter.stageSupply(address(asset), 2 ether, address(adapter), 0, deadline, keccak256("managed"));
        adapter.submitExternalAction(_request(managedSupplyHash));
        assertEq(adapter.managedPositionCapacity(address(asset)), 2 ether);
        bytes32 withdrawHash = adapter.stageWithdraw(address(asset), 1 ether, address(this), deadline, policy);
        assertEq(adapter.reservedPositionCapacity(address(asset)), 1 ether);
        adapter.cancelStagedAction(withdrawHash);
        assertEq(adapter.reservedPositionCapacity(address(asset)), 0);
        assertEq(adapter.managedPositionCapacity(address(asset)), 2 ether);
        vm.expectRevert();
        adapter.cancelStagedAction(withdrawHash);
    }

    function test_ExternalOnBehalfOfDoesNotCreditPositionCapacity() external {
        _fundAndSync(address(asset), 10 ether);
        address externalRecipient = makeAddr("externalOnBehalfOf");
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 policy = keccak256("external-policy");
        bytes32 supplyHash = adapter.stageSupply(address(asset), 6 ether, externalRecipient, 0, deadline, policy);
        adapter.submitExternalAction(_request(supplyHash));
        assertEq(adapter.managedPositionCapacity(address(asset)), 0);
        assertEq(adapter.reservedPositionCapacity(address(asset)), 0);
        assertEq(adapter.unreservedPositionCapacity(address(asset)), 0);
        assertEq(adapter.reservedBalance(address(asset)), 0);
        vm.expectRevert(
            abi.encodeWithSelector(
                AaveV3SupplyWithdrawAdapter.OverReservedPosition.selector, address(asset), 1 ether, 0, 0
            )
        );
        adapter.stageWithdraw(address(asset), 1 ether, address(this), deadline, policy);
    }

    function test_WithdrawOverbookingReverts() external {
        _fundAndSync(address(asset), 5 ether);
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 supplyHash =
            adapter.stageSupply(address(asset), 5 ether, address(adapter), 0, deadline, keccak256("supply-policy"));
        adapter.submitExternalAction(_request(supplyHash));
        assertEq(adapter.managedPositionCapacity(address(asset)), 5 ether);
        adapter.stageWithdraw(address(asset), 3 ether, makeAddr("recipient-a"), deadline, keccak256("policy-a"));
        assertEq(adapter.reservedPositionCapacity(address(asset)), 3 ether);
        assertEq(adapter.unreservedPositionCapacity(address(asset)), 2 ether);
        vm.expectRevert(
            abi.encodeWithSelector(
                AaveV3SupplyWithdrawAdapter.OverReservedPosition.selector, address(asset), 3 ether, 5 ether, 3 ether
            )
        );
        adapter.stageWithdraw(address(asset), 3 ether, makeAddr("recipient-b"), deadline, keccak256("policy-b"));
        assertEq(adapter.reservedPositionCapacity(address(asset)), 3 ether);
        adapter.stageWithdraw(address(asset), 2 ether, makeAddr("recipient-c"), deadline, keccak256("policy-c"));
        assertEq(adapter.reservedPositionCapacity(address(asset)), 5 ether);
        assertEq(adapter.unreservedPositionCapacity(address(asset)), 0);
    }

    function test_WithdrawCancelReleasesPositionReservation() external {
        _fundAndSync(address(asset), 4 ether);
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 supplyHash =
            adapter.stageSupply(address(asset), 4 ether, address(adapter), 0, deadline, keccak256("supply-policy"));
        adapter.submitExternalAction(_request(supplyHash));
        assertEq(adapter.managedPositionCapacity(address(asset)), 4 ether);
        bytes32 withdrawHash =
            adapter.stageWithdraw(address(asset), 3 ether, address(this), deadline, keccak256("withdraw-policy"));
        assertEq(adapter.reservedPositionCapacity(address(asset)), 3 ether);
        assertEq(adapter.unreservedPositionCapacity(address(asset)), 1 ether);
        adapter.cancelStagedAction(withdrawHash);
        assertEq(adapter.reservedPositionCapacity(address(asset)), 0);
        assertEq(adapter.unreservedPositionCapacity(address(asset)), 4 ether);
        assertEq(adapter.managedPositionCapacity(address(asset)), 4 ether);
        bytes32 fullHash =
            adapter.stageWithdraw(address(asset), 4 ether, address(this), deadline, keccak256("full-policy"));
        assertEq(adapter.reservedPositionCapacity(address(asset)), 4 ether);
        ExternalVenueRequest memory cancelledRequest = _request(withdrawHash);
        vm.expectRevert(abi.encodeWithSelector(AaveV3SupplyWithdrawAdapter.ActionCancelled.selector, withdrawHash));
        adapter.submitExternalAction(cancelledRequest);
        assertTrue(adapter.getStagedAction(fullHash).cancelled == false);
    }

    function test_SupplyToSelfThenWithdrawAccountsPosition() external {
        _fundAndSync(address(asset), 10 ether);
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 supplyPolicy = keccak256("supply-policy");
        bytes32 supplyHash = adapter.stageSupply(address(asset), 6 ether, address(adapter), 0, deadline, supplyPolicy);
        adapter.submitExternalAction(_request(supplyHash));
        assertEq(adapter.managedPositionCapacity(address(asset)), 6 ether);
        assertEq(adapter.reservedPositionCapacity(address(asset)), 0);
        assertEq(adapter.unreservedPositionCapacity(address(asset)), 6 ether);
        address recipient = makeAddr("withdraw-recipient");
        bytes32 withdrawPolicy = keccak256("withdraw-policy");
        bytes32 withdrawHash = adapter.stageWithdraw(address(asset), 4 ether, recipient, deadline, withdrawPolicy);
        assertEq(adapter.reservedPositionCapacity(address(asset)), 4 ether);
        assertEq(adapter.unreservedPositionCapacity(address(asset)), 2 ether);
        uint256 recipientBefore = asset.balanceOf(recipient);
        ExternalVenueResult memory result = adapter.submitExternalAction(_request(withdrawHash));
        assertEq(uint8(result.state), uint8(OperationalActionState.Complete));
        assertEq(asset.balanceOf(recipient) - recipientBefore, 4 ether);
        assertEq(adapter.managedPositionCapacity(address(asset)), 2 ether);
        assertEq(adapter.reservedPositionCapacity(address(asset)), 0);
        assertEq(adapter.unreservedPositionCapacity(address(asset)), 2 ether);
        bytes32 secondWithdrawHash =
            adapter.stageWithdraw(address(asset), 2 ether, recipient, deadline, keccak256("withdraw-policy-2"));
        ExternalVenueResult memory second = adapter.submitExternalAction(_request(secondWithdrawHash));
        assertEq(uint8(second.state), uint8(OperationalActionState.Complete));
        assertEq(adapter.managedPositionCapacity(address(asset)), 0);
        assertEq(adapter.reservedPositionCapacity(address(asset)), 0);
        assertEq(adapter.unreservedPositionCapacity(address(asset)), 0);
    }

    function test_WithdrawInventoryLimitedToUnreserved() external {
        _fundAndSync(address(asset), 10 ether);
        adapter.stageSupply(
            address(asset), 6 ether, address(adapter), 0, uint64(block.timestamp + 1 hours), keccak256("policy")
        );
        address recipient = makeAddr("recipient");
        vm.expectRevert();
        adapter.withdrawInventory(address(asset), 5 ether, recipient);
        adapter.withdrawInventory(address(asset), 4 ether, recipient);
        assertEq(asset.balanceOf(recipient), 4 ether);
    }

    function test_SyncInventoryReflectsActual() external {
        asset.transfer(address(adapter), 3 ether);
        adapter.syncInventory(address(asset));
        assertEq(adapter.inventoriedBalance(address(asset)), 3 ether);
        asset.transfer(address(adapter), 1 ether);
        adapter.syncInventory(address(asset));
        assertEq(adapter.inventoriedBalance(address(asset)), 4 ether);
    }

    function test_RecoverAlwaysRejects() external {
        vm.expectRevert(AaveV3SupplyWithdrawAdapter.NoRecoveryForAtomic.selector);
        adapter.recoverExternalAction(bytes32(uint256(1)));
    }

    function test_PoolRevertRollsBackAtomically() external {
        _fundAndSync(address(asset), 5 ether);
        pool.setShouldRevert(true);
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 policy = keccak256("policy");
        bytes32 actionHash = adapter.stageSupply(address(asset), 2 ether, address(adapter), 0, deadline, policy);
        ExternalVenueRequest memory request = _request(actionHash);
        vm.expectRevert();
        adapter.submitExternalAction(request);
        assertFalse(adapter.getStagedAction(actionHash).consumed);
        assertEq(adapter.reservedBalance(address(asset)), 2 ether);
        assertEq(asset.allowance(address(adapter), address(pool)), 0);
    }

    function _fundAndSync(address token, uint256 amount) private {
        MockAaveMintable(token).transfer(address(adapter), amount);
        adapter.syncInventory(token);
    }

    function _request(bytes32 actionHash) private view returns (ExternalVenueRequest memory) {
        AaveV3SupplyWithdrawAdapter.StagedAaveV3Action memory staged = adapter.getStagedAction(actionHash);
        bytes32 expected;
        if (staged.kind == adapter.KIND_SUPPLY()) {
            expected = adapter.hashSupplyPostconditions(
                actionHash,
                staged.asset,
                staged.amount,
                staged.onBehalfOfOrRecipient,
                staged.referralCode,
                staged.deadline,
                staged.policyHash,
                staged.expectedPool
            );
        } else {
            expected = adapter.hashWithdrawPostconditions(
                actionHash,
                staged.asset,
                staged.amount,
                staged.onBehalfOfOrRecipient,
                staged.deadline,
                staged.policyHash,
                staged.expectedPool
            );
        }
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
            minValue: int256(staged.amount),
            maxValue: type(int256).max,
            recipientPolicyHash: staged.policyHash,
            expectedPostconditionsHash: expected
        });
        return ExternalVenueRequest({
            binding: binding,
            guaranteeClass: ExecutionGuaranteeClass.AtomicSameDomain,
            timeoutAt: 0,
            recoveryDeadline: 0,
            interimExposureOwner: AccountId.wrap(bytes32(0)),
            recoveryPolicyHash: bytes32(0),
            reservationHash: bytes32(0),
            maximumResidual: 0,
            terminalFallback: ExternalTerminalFallback({
                state: OperationalActionState.Unspecified,
                realizedValue: 0,
                residualValue: 0,
                postconditionsHash: bytes32(0),
                outcomeHash: bytes32(0)
            })
        });
    }
}
