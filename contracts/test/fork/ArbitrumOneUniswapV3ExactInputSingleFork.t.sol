// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {UniswapV3ExactInputSingleAdapter} from "../../src/adapters/venue/UniswapV3ExactInputSingleAdapter.sol";
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

/// @notice Pinned Arbitrum One fork qualification for the Uniswap V3 exact-input-single adapter.
/// @dev Read-only by default: verifies dependency code, descriptor, canonical hashing, and router
///      allowance hygiene without moving value, requiring no keys and never broadcasting. The
///      value-moving swap case runs only when an explicit fixture amount variable is configured;
///      otherwise it is skipped honestly.
contract ArbitrumOneUniswapV3ExactInputSingleForkTest is Test {
    uint256 internal constant ARBITRUM_ONE_CHAIN_ID = 42_161;

    address internal router;
    address internal tokenIn;
    address internal tokenOut;
    uint24 internal poolFee;
    UniswapV3ExactInputSingleAdapter internal adapter;

    function setUp() public {
        string memory rpcUrl = vm.envOr("ARBITRUM_RPC_URL", string(""));
        string memory blockNumber = vm.envOr("ARBITRUM_ONE_FORK_BLOCK_NUMBER", string(""));
        address configuredRouter = vm.envOr("SETRYN_UNISWAP_V3_ROUTER", address(0));
        address configuredTokenIn = vm.envOr("SETRYN_UNISWAP_TOKEN_IN", address(0));
        address configuredTokenOut = vm.envOr("SETRYN_UNISWAP_TOKEN_OUT", address(0));
        uint256 configuredFee = vm.envOr("SETRYN_UNISWAP_POOL_FEE", uint256(0));

        if (
            bytes(rpcUrl).length == 0 || bytes(blockNumber).length == 0 || configuredRouter == address(0)
                || configuredTokenIn == address(0) || configuredTokenOut == address(0) || configuredFee == 0
        ) {
            vm.skip(
                true,
                "Set ARBITRUM_RPC_URL, ARBITRUM_ONE_FORK_BLOCK_NUMBER, SETRYN_UNISWAP_V3_ROUTER, SETRYN_UNISWAP_TOKEN_IN, SETRYN_UNISWAP_TOKEN_OUT and SETRYN_UNISWAP_POOL_FEE to run the Uniswap V3 fork suite"
            );
        }

        vm.createSelectFork(rpcUrl, vm.parseUint(blockNumber));
        assertEq(block.chainid, ARBITRUM_ONE_CHAIN_ID, "RPC must resolve to Arbitrum One");
        assertGt(configuredRouter.code.length, 0, "configured Uniswap router must have code at the pinned block");
        assertGt(configuredTokenIn.code.length, 0, "configured tokenIn must have code at the pinned block");
        assertGt(configuredTokenOut.code.length, 0, "configured tokenOut must have code at the pinned block");
        assertTrue(configuredFee <= type(uint24).max, "configured pool fee must fit in uint24");

        router = configuredRouter;
        tokenIn = configuredTokenIn;
        tokenOut = configuredTokenOut;
        poolFee = uint24(configuredFee);
        adapter = new UniswapV3ExactInputSingleAdapter(
            ARBITRUM_ONE_CHAIN_ID, router, address(this), 0, address(this), address(this), address(this)
        );
    }

    function test_DescriptorIsProxyFreeValueMovingAtomic() public view {
        AdapterRuntimeDescriptor memory descriptor = adapter.operationalAdapterDescriptor();
        assertEq(descriptor.self, address(adapter));
        assertEq(descriptor.chainId, ARBITRUM_ONE_CHAIN_ID);
        assertEq(descriptor.interfaceHash, OperationalAdapterLib.INTERFACE_EXTERNAL_VENUE);
        assertEq(descriptor.capabilityHash, OperationalAdapterLib.CAPABILITY_EXTERNAL_ATOMIC);
        assertTrue(descriptor.proxyFree);
        assertTrue(descriptor.valueMoving);
    }

    function test_DependencyCodeAndAllowanceHygieneReadOnly() public view {
        assertGt(router.code.length, 0, "router must retain code");
        assertGt(tokenIn.code.length, 0, "tokenIn must retain code");
        assertGt(tokenOut.code.length, 0, "tokenOut must retain code");
        assertEq(address(adapter.swapRouter()), router, "adapter must bind the exact configured router");
        assertEq(adapter.executor(), address(this), "adapter must bind the exact executor");
        assertEq(adapter.expectedChainId(), ARBITRUM_ONE_CHAIN_ID, "adapter must bind Arbitrum One");
        assertEq(IERC20(tokenIn).allowance(address(adapter), router), 0, "adapter must hold no router allowance");
        assertEq(IERC20(tokenOut).allowance(address(adapter), router), 0, "adapter must hold no router allowance");
    }

    function test_CanonicalActionHashIsDeterministic() public view {
        bytes32 policy = keccak256("fork-recipient-policy");
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 first =
            adapter.hashStagedAction(tokenIn, tokenOut, poolFee, 1_000_000, 1, address(adapter), deadline, policy);
        bytes32 second =
            adapter.hashStagedAction(tokenIn, tokenOut, poolFee, 1_000_000, 1, address(adapter), deadline, policy);
        assertEq(first, second, "canonical action hash must be deterministic");
        assertTrue(first != bytes32(0), "canonical action hash must be nonzero");
    }

    function test_ValueMovingSwapWhenFixtureFunded() public {
        uint256 fixtureAmount = vm.envOr("SETRYN_UNISWAP_FORK_FIXTURE_AMOUNT", uint256(0));
        if (fixtureAmount == 0) {
            vm.skip(
                true,
                "Set SETRYN_UNISWAP_FORK_FIXTURE_AMOUNT to run the value-moving fork swap case; read-only qualification above already passed"
            );
        }
        deal(tokenIn, address(adapter), fixtureAmount, true);
        adapter.syncInventory(tokenIn);
        adapter.syncInventory(tokenOut);

        bytes32 policy = keccak256("fork-recipient-policy");
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 actionHash =
            adapter.stageSwap(tokenIn, tokenOut, poolFee, fixtureAmount, 1, address(adapter), deadline, policy);

        OperationalBinding memory binding = OperationalBinding({
            chainId: block.chainid,
            deploymentId: keccak256("fork-qualification"),
            accountId: AccountId.wrap(keccak256("account")),
            marketId: MarketId.wrap(keccak256("market")),
            seriesId: SeriesId.wrap(keccak256("series")),
            seriesVersion: 1,
            packageId: PackageId.wrap(keccak256("package")),
            packageVersion: 1,
            actionHash: actionHash,
            nonce: 1,
            deadline: deadline,
            minValue: int256(uint256(1)),
            maxValue: type(int256).max,
            recipientPolicyHash: policy,
            expectedPostconditionsHash: adapter.hashExpectedPostconditions(
                actionHash, tokenIn, tokenOut, poolFee, fixtureAmount, 1, address(adapter), deadline, policy
            )
        });
        ExternalVenueRequest memory request = ExternalVenueRequest({
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

        ExternalVenueResult memory result = adapter.submitExternalAction(request);
        assertEq(uint8(result.state), uint8(OperationalActionState.Complete), "fork swap must complete atomically");
        assertEq(result.residualValue, 0, "atomic swap must leave zero residual");
        assertEq(
            result.postconditionsHash,
            binding.expectedPostconditionsHash,
            "postconditions must return the precommitted expected hash"
        );
        assertTrue(result.evidenceHash != bytes32(0), "evidence must be committed");
        assertEq(IERC20(tokenIn).allowance(address(adapter), router), 0, "allowance must be cleared after swap");

        ExternalVenueRequest memory copy = request;
        bytes32 requestHash = OperationalAdapterLib.hashExternalRequest(copy);
        ExternalVenueResult memory reconciled = adapter.reconcileExternalAction(requestHash);
        assertEq(reconciled.postconditionsHash, result.postconditionsHash, "reconcile must return stored result");
    }
}
