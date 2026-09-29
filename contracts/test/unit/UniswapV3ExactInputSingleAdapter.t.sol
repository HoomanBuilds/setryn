// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import {
    IUniswapV3ExactInputSingleRouter,
    UniswapV3ExactInputSingleAdapter
} from "../../src/adapters/venue/UniswapV3ExactInputSingleAdapter.sol";
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

contract MockUniswapV3Router is IUniswapV3ExactInputSingleRouter {
    uint256 public nextAmountOut;
    bool public shouldRevert;
    uint256 public calls;

    function setNextAmountOut(uint256 amount) external {
        nextAmountOut = amount;
    }

    function setShouldRevert(bool value) external {
        shouldRevert = value;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut) {
        calls += 1;
        if (shouldRevert) revert("mock router revert");
        IERC20(params.tokenIn).transferFrom(msg.sender, address(this), params.amountIn);
        amountOut = nextAmountOut;
        if (amountOut < params.amountOutMinimum) revert("mock slippage");
        IERC20(params.tokenOut).transfer(params.recipient, amountOut);
    }
}

contract UniswapV3ExactInputSingleAdapterTest is Test {
    uint24 private constant FEE = 3_000;

    MockMintableERC20 private tokenIn;
    MockMintableERC20 private tokenOut;
    MockUniswapV3Router private router;
    UniswapV3ExactInputSingleAdapter private adapter;

    function setUp() external {
        tokenIn = new MockMintableERC20("TokenIn", "TIN");
        tokenOut = new MockMintableERC20("TokenOut", "TOU");
        router = new MockUniswapV3Router();
        adapter = new UniswapV3ExactInputSingleAdapter(
            block.chainid, address(router), address(this), 0, address(this), address(this), address(this)
        );
        tokenIn.mint(address(this), 1_000_000 ether);
        tokenOut.mint(address(router), 1_000_000 ether);
        router.setNextAmountOut(1 ether);
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

    function test_StagingReservesInventoryAndDerivesActionHash() external {
        uint256 amountIn = 10 ether;
        _fundAndSync(address(tokenIn), amountIn);
        bytes32 actionHash = adapter.stageSwap(
            address(tokenIn),
            address(tokenOut),
            FEE,
            amountIn,
            1 ether,
            address(adapter),
            uint64(block.timestamp + 1 hours),
            keccak256("recipient-policy")
        );
        bytes32 expected = adapter.hashStagedAction(
            address(tokenIn),
            address(tokenOut),
            FEE,
            amountIn,
            1 ether,
            address(adapter),
            uint64(block.timestamp + 1 hours),
            keccak256("recipient-policy")
        );
        assertEq(actionHash, expected);
        assertEq(adapter.reservedBalance(address(tokenIn)), amountIn);
        assertEq(adapter.unreservedBalance(address(tokenIn)), 0);
    }

    function test_RevertWhenOverReservation() external {
        _fundAndSync(address(tokenIn), 5 ether);
        adapter.stageSwap(
            address(tokenIn),
            address(tokenOut),
            FEE,
            5 ether,
            1 ether,
            address(adapter),
            uint64(block.timestamp + 1 hours),
            keccak256("policy")
        );
        vm.expectRevert();
        adapter.stageSwap(
            address(tokenIn),
            address(tokenOut),
            FEE,
            1,
            1,
            address(adapter),
            uint64(block.timestamp + 1 hours),
            keccak256("policy-2")
        );
    }

    function test_RevertOnInvalidStagingInputs() external {
        _fundAndSync(address(tokenIn), 10 ether);
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 policy = keccak256("policy");
        vm.expectRevert(UniswapV3ExactInputSingleAdapter.ZeroAmountIn.selector);
        adapter.stageSwap(address(tokenIn), address(tokenOut), FEE, 0, 1, address(adapter), deadline, policy);
        vm.expectRevert(abi.encodeWithSelector(UniswapV3ExactInputSingleAdapter.SameToken.selector, address(tokenIn)));
        adapter.stageSwap(address(tokenIn), address(tokenIn), FEE, 1, 1, address(adapter), deadline, policy);
        address codeless = makeAddr("codeless-token");
        vm.expectRevert();
        adapter.stageSwap(codeless, address(tokenOut), FEE, 1, 1, address(adapter), deadline, policy);
        vm.expectRevert(UniswapV3ExactInputSingleAdapter.ZeroRecipient.selector);
        adapter.stageSwap(address(tokenIn), address(tokenOut), FEE, 1, 1, address(0), deadline, policy);
        vm.expectRevert();
        adapter.stageSwap(
            address(tokenIn), address(tokenOut), FEE, 1, 1, address(adapter), uint64(block.timestamp), policy
        );
        bytes32 first =
            adapter.stageSwap(address(tokenIn), address(tokenOut), FEE, 1 ether, 1, address(adapter), deadline, policy);
        assertTrue(first != bytes32(0));
        vm.expectRevert();
        adapter.stageSwap(address(tokenIn), address(tokenOut), FEE, 1 ether, 1, address(adapter), deadline, policy);
    }

    function test_SuccessfulExactSwapClearsAllowanceAndStoresResult() external {
        uint256 amountIn = 10 ether;
        uint256 amountOut = 9 ether;
        router.setNextAmountOut(amountOut);
        _fundAndSync(address(tokenIn), amountIn);
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 policy = keccak256("recipient-policy");
        bytes32 actionHash = adapter.stageSwap(
            address(tokenIn), address(tokenOut), FEE, amountIn, 1 ether, address(adapter), deadline, policy
        );
        ExternalVenueRequest memory request = _request(actionHash, deadline, policy);
        ExternalVenueRequest memory copy = request;
        bytes32 requestHash = OperationalAdapterLib.hashExternalRequest(copy);

        uint256 inBefore = tokenIn.balanceOf(address(adapter));
        uint256 outBefore = tokenOut.balanceOf(address(adapter));
        bytes32 precommitted = adapter.hashExpectedPostconditions(
            actionHash, address(tokenIn), address(tokenOut), FEE, amountIn, 1 ether, address(adapter), deadline, policy
        );
        assertEq(request.binding.expectedPostconditionsHash, precommitted);
        ExternalVenueResult memory result = adapter.submitExternalAction(request);

        assertEq(uint8(result.state), uint8(OperationalActionState.Complete));
        assertEq(result.realizedValue, int256(amountOut));
        assertEq(result.residualValue, 0);
        assertEq(result.venueActionReference, actionHash);
        assertEq(result.postconditionsHash, precommitted);
        assertEq(result.postconditionsHash, request.binding.expectedPostconditionsHash);
        assertTrue(result.evidenceHash != bytes32(0));
        assertEq(result.recoveryOutcomeHash, bytes32(0));
        assertEq(tokenIn.balanceOf(address(adapter)), inBefore - amountIn);
        assertEq(tokenOut.balanceOf(address(adapter)), outBefore + amountOut);
        assertEq(tokenIn.allowance(address(adapter), address(router)), 0);
        assertEq(adapter.reservedBalance(address(tokenIn)), 0);

        ExternalVenueResult memory reconciled = adapter.reconcileExternalAction(requestHash);
        assertEq(reconciled.postconditionsHash, result.postconditionsHash);
        assertEq(reconciled.evidenceHash, result.evidenceHash);
        assertEq(uint8(reconciled.state), uint8(OperationalActionState.Complete));
    }

    function test_ExpectedPostconditionsPrecomputableBeforeExecution() external view {
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 policy = keccak256("recipient-policy");
        bytes32 actionHash = adapter.hashStagedAction(
            address(tokenIn), address(tokenOut), FEE, 10 ether, 1 ether, address(adapter), deadline, policy
        );
        bytes32 first = adapter.hashExpectedPostconditions(
            actionHash, address(tokenIn), address(tokenOut), FEE, 10 ether, 1 ether, address(adapter), deadline, policy
        );
        bytes32 second = adapter.hashExpectedPostconditions(
            actionHash, address(tokenIn), address(tokenOut), FEE, 10 ether, 1 ether, address(adapter), deadline, policy
        );
        assertEq(first, second);
        assertTrue(first != bytes32(0));
    }

    function test_RevertOnWrongExpectedPostconditions() external {
        uint256 amountIn = 10 ether;
        _fundAndSync(address(tokenIn), amountIn);
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 policy = keccak256("policy");
        bytes32 actionHash = adapter.stageSwap(
            address(tokenIn), address(tokenOut), FEE, amountIn, 1 ether, address(adapter), deadline, policy
        );
        ExternalVenueRequest memory request = _request(actionHash, deadline, policy);
        bytes32 correct = request.binding.expectedPostconditionsHash;
        request.binding.expectedPostconditionsHash = keccak256("wrong-postconditions");
        vm.expectRevert(
            abi.encodeWithSelector(
                UniswapV3ExactInputSingleAdapter.ExpectedPostconditionsMismatch.selector,
                correct,
                keccak256("wrong-postconditions")
            )
        );
        adapter.submitExternalAction(request);
        assertEq(adapter.reservedBalance(address(tokenIn)), amountIn);
        assertFalse(adapter.getStagedAction(actionHash).consumed);
        assertEq(tokenIn.allowance(address(adapter), address(router)), 0);
    }

    function test_RevertOnBindingDeadlineMismatch() external {
        uint256 amountIn = 2 ether;
        _fundAndSync(address(tokenIn), amountIn);
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 policy = keccak256("policy");
        bytes32 actionHash = adapter.stageSwap(
            address(tokenIn), address(tokenOut), FEE, amountIn, 1 ether, address(adapter), deadline, policy
        );
        ExternalVenueRequest memory request = _request(actionHash, deadline, policy);
        request.binding.deadline = deadline + 1;
        vm.expectRevert(
            abi.encodeWithSelector(
                UniswapV3ExactInputSingleAdapter.BindingDeadlineMismatch.selector, deadline + 1, deadline
            )
        );
        adapter.submitExternalAction(request);
        assertEq(adapter.reservedBalance(address(tokenIn)), amountIn);
        assertFalse(adapter.getStagedAction(actionHash).consumed);
        assertEq(tokenIn.allowance(address(adapter), address(router)), 0);
    }

    function test_RevertOnBindingMinValueMismatch() external {
        uint256 amountIn = 2 ether;
        uint256 minimum = 1 ether;
        _fundAndSync(address(tokenIn), amountIn);
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 policy = keccak256("policy");
        bytes32 actionHash = adapter.stageSwap(
            address(tokenIn), address(tokenOut), FEE, amountIn, minimum, address(adapter), deadline, policy
        );
        ExternalVenueRequest memory tooLow = _request(actionHash, deadline, policy);
        tooLow.binding.minValue = 0;
        vm.expectRevert(
            abi.encodeWithSelector(
                UniswapV3ExactInputSingleAdapter.BindingMinValueMismatch.selector, int256(0), minimum
            )
        );
        adapter.submitExternalAction(tooLow);
        ExternalVenueRequest memory negative = _request(actionHash, deadline, policy);
        negative.binding.minValue = -1;
        vm.expectRevert(
            abi.encodeWithSelector(
                UniswapV3ExactInputSingleAdapter.BindingMinValueMismatch.selector, int256(-1), minimum
            )
        );
        adapter.submitExternalAction(negative);
        assertEq(adapter.reservedBalance(address(tokenIn)), amountIn);
        assertFalse(adapter.getStagedAction(actionHash).consumed);
        assertEq(tokenIn.allowance(address(adapter), address(router)), 0);
    }

    function test_RevertWhenRealizedAboveMaxValueRollsBackAtomically() external {
        uint256 amountIn = 10 ether;
        uint256 minimum = 1 ether;
        uint256 realized = 9 ether;
        router.setNextAmountOut(realized);
        _fundAndSync(address(tokenIn), amountIn);
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 policy = keccak256("policy");
        bytes32 actionHash = adapter.stageSwap(
            address(tokenIn), address(tokenOut), FEE, amountIn, minimum, address(adapter), deadline, policy
        );
        ExternalVenueRequest memory request = _request(actionHash, deadline, policy);
        request.binding.maxValue = int256(2 ether);
        vm.expectRevert(
            abi.encodeWithSelector(
                UniswapV3ExactInputSingleAdapter.RealizedValueOutOfRange.selector,
                realized,
                int256(minimum),
                int256(2 ether)
            )
        );
        adapter.submitExternalAction(request);
        assertEq(adapter.reservedBalance(address(tokenIn)), amountIn);
        assertFalse(adapter.getStagedAction(actionHash).consumed);
        assertEq(tokenIn.allowance(address(adapter), address(router)), 0);
    }

    function test_SlippageFailureRollsBackAtomically() external {
        uint256 amountIn = 10 ether;
        _fundAndSync(address(tokenIn), amountIn);
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 policy = keccak256("policy");
        router.setNextAmountOut(0.5 ether);
        bytes32 actionHash = adapter.stageSwap(
            address(tokenIn), address(tokenOut), FEE, amountIn, 9 ether, address(adapter), deadline, policy
        );
        ExternalVenueRequest memory request = _request(actionHash, deadline, policy);
        vm.expectRevert();
        adapter.submitExternalAction(request);
        assertEq(adapter.reservedBalance(address(tokenIn)), amountIn);
        assertFalse(adapter.getStagedAction(actionHash).consumed);
        assertEq(tokenIn.allowance(address(adapter), address(router)), 0);
    }

    function test_RevertOnReplayAndStoredResultImmutability() external {
        uint256 amountIn = 2 ether;
        router.setNextAmountOut(1 ether);
        _fundAndSync(address(tokenIn), amountIn);
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 policy = keccak256("policy");
        bytes32 actionHash = adapter.stageSwap(
            address(tokenIn), address(tokenOut), FEE, amountIn, 0.5 ether, address(adapter), deadline, policy
        );
        ExternalVenueRequest memory request = _request(actionHash, deadline, policy);
        ExternalVenueResult memory first = adapter.submitExternalAction(request);
        vm.expectRevert();
        adapter.submitExternalAction(request);
        ExternalVenueRequest memory copy = request;
        bytes32 requestHash = OperationalAdapterLib.hashExternalRequest(copy);
        ExternalVenueResult memory again = adapter.reconcileExternalAction(requestHash);
        assertEq(again.postconditionsHash, first.postconditionsHash);
        assertEq(again.evidenceHash, first.evidenceHash);
    }

    function test_RevertWhenCallerIsNotBoundExecutor() external {
        _fundAndSync(address(tokenIn), 2 ether);
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 policy = keccak256("policy");
        bytes32 actionHash =
            adapter.stageSwap(address(tokenIn), address(tokenOut), FEE, 2 ether, 1, address(adapter), deadline, policy);
        ExternalVenueRequest memory request = _request(actionHash, deadline, policy);
        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        vm.expectRevert();
        adapter.submitExternalAction(request);
    }

    function test_CancelReleasesOnlyUnconsumedReservation() external {
        _fundAndSync(address(tokenIn), 5 ether);
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 policy = keccak256("policy");
        bytes32 actionHash =
            adapter.stageSwap(address(tokenIn), address(tokenOut), FEE, 5 ether, 1, address(adapter), deadline, policy);
        assertEq(adapter.reservedBalance(address(tokenIn)), 5 ether);
        adapter.cancelStagedAction(actionHash);
        assertEq(adapter.reservedBalance(address(tokenIn)), 0);
        assertTrue(adapter.getStagedAction(actionHash).cancelled);
        ExternalVenueRequest memory request = _request(actionHash, deadline, policy);
        vm.expectRevert();
        adapter.submitExternalAction(request);
        vm.expectRevert();
        adapter.cancelStagedAction(actionHash);
    }

    function test_WithdrawLimitedToUnreservedBalance() external {
        _fundAndSync(address(tokenIn), 10 ether);
        adapter.stageSwap(
            address(tokenIn),
            address(tokenOut),
            FEE,
            6 ether,
            1,
            address(adapter),
            uint64(block.timestamp + 1 hours),
            keccak256("policy")
        );
        address recipient = makeAddr("recipient");
        vm.expectRevert();
        adapter.withdrawInventory(address(tokenIn), 5 ether, recipient);
        adapter.withdrawInventory(address(tokenIn), 4 ether, recipient);
        assertEq(tokenIn.balanceOf(recipient), 4 ether);
        assertEq(adapter.reservedBalance(address(tokenIn)), 6 ether);
    }

    function test_RecoverAlwaysRejectsForAtomicRoutes() external {
        vm.expectRevert(UniswapV3ExactInputSingleAdapter.NoRecoveryForAtomic.selector);
        adapter.recoverExternalAction(bytes32(uint256(1)));
    }

    function test_RevertWhenGuaranteeIsNotAtomic() external {
        _fundAndSync(address(tokenIn), 2 ether);
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 policy = keccak256("policy");
        bytes32 actionHash =
            adapter.stageSwap(address(tokenIn), address(tokenOut), FEE, 2 ether, 1, address(adapter), deadline, policy);
        ExternalVenueRequest memory request = _request(actionHash, deadline, policy);
        request.guaranteeClass = ExecutionGuaranteeClass.BoundedAsync;
        vm.expectRevert();
        adapter.submitExternalAction(request);
    }

    function _fundAndSync(address token, uint256 amount) private {
        MockMintableERC20(token).transfer(address(adapter), amount);
        adapter.syncInventory(token);
    }

    function _request(bytes32 actionHash, uint64 swapDeadline, bytes32 policy)
        private
        view
        returns (ExternalVenueRequest memory)
    {
        UniswapV3ExactInputSingleAdapter.StagedUniswapV3Swap memory staged = adapter.getStagedAction(actionHash);
        bytes32 expected = adapter.hashExpectedPostconditions(
            actionHash,
            staged.tokenIn,
            staged.tokenOut,
            staged.fee,
            staged.amountIn,
            staged.amountOutMinimum,
            staged.recipient,
            staged.deadline,
            staged.recipientPolicyHash
        );
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
            deadline: swapDeadline,
            minValue: int256(staged.amountOutMinimum),
            maxValue: type(int256).max,
            recipientPolicyHash: policy,
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
