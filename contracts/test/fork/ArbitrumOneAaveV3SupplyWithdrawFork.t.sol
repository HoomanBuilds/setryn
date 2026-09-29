// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {AaveV3SupplyWithdrawAdapter} from "../../src/adapters/venue/AaveV3SupplyWithdrawAdapter.sol";
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

interface IForkAaveProvider {
    function getPool() external view returns (address);
}

interface IForkAavePool {
    function getReserveData(address asset)
        external
        view
        returns (
            uint256 configuration,
            uint128 liquidityIndex,
            uint128 currentLiquidityRate,
            uint128 variableBorrowIndex,
            uint128 currentVariableBorrowRate,
            uint128 currentStableBorrowRate,
            uint40 lastUpdateTimestamp,
            uint16 id,
            address aTokenAddress,
            address stableDebtTokenAddress,
            address variableDebtTokenAddress,
            address interestRateStrategyAddress,
            uint128 accruedToTreasury,
            uint128 unbacked,
            uint128 isolationModeTotalDebt
        );
}

interface IForkDecimals {
    function decimals() external view returns (uint8);
}

/// @notice Pinned Arbitrum One fork qualification for the Aave V3 supply/withdraw adapter.
/// @dev Read-only by default: verifies dependency code, provider.getPool equality, reserve
///      aToken address, native USDC decimals, descriptor, canonical hashing, and allowance
///      hygiene without moving value, requiring no keys and never broadcasting. The
///      value-moving supply/withdraw case runs only on the local fork when an explicit fixture
///      amount variable is configured; otherwise it is skipped honestly.
contract ArbitrumOneAaveV3SupplyWithdrawForkTest is Test {
    uint256 internal constant ARBITRUM_ONE_CHAIN_ID = 42_161;

    address internal provider;
    address internal pool;
    address internal usdc;
    address internal ausdc;
    AaveV3SupplyWithdrawAdapter internal adapter;

    function setUp() public {
        string memory rpcUrl = vm.envOr("ARBITRUM_RPC_URL", string(""));
        string memory blockNumber = vm.envOr("ARBITRUM_ONE_FORK_BLOCK_NUMBER", string(""));
        address configuredProvider = vm.envOr("SETRYN_AAVE_V3_PROVIDER", address(0));
        address configuredPool = vm.envOr("SETRYN_AAVE_V3_POOL", address(0));
        address configuredUsdc = vm.envOr("SETRYN_AAVE_V3_USDC", address(0));
        address configuredAusdc = vm.envOr("SETRYN_AAVE_V3_AUSDC", address(0));

        if (
            bytes(rpcUrl).length == 0 || bytes(blockNumber).length == 0 || configuredProvider == address(0)
                || configuredPool == address(0) || configuredUsdc == address(0) || configuredAusdc == address(0)
        ) {
            vm.skip(
                true,
                "Set ARBITRUM_RPC_URL, ARBITRUM_ONE_FORK_BLOCK_NUMBER, SETRYN_AAVE_V3_PROVIDER, SETRYN_AAVE_V3_POOL, SETRYN_AAVE_V3_USDC and SETRYN_AAVE_V3_AUSDC to run the Aave V3 fork suite"
            );
        }
        if (!_startsWithHttps(rpcUrl)) {
            vm.skip(true, "ARBITRUM_RPC_URL must be an explicit HTTPS URL to run the Aave V3 fork suite");
        }
        if (!_isDecimal(blockNumber)) {
            vm.skip(true, "ARBITRUM_ONE_FORK_BLOCK_NUMBER must be a decimal block number to run the Aave V3 fork suite");
        }

        vm.createSelectFork(rpcUrl, vm.parseUint(blockNumber));
        assertEq(block.chainid, ARBITRUM_ONE_CHAIN_ID, "RPC must resolve to Arbitrum One");
        assertGt(configuredProvider.code.length, 0, "configured Aave provider must have code at the pinned block");
        assertGt(configuredPool.code.length, 0, "configured Aave pool must have code at the pinned block");
        assertGt(configuredUsdc.code.length, 0, "configured USDC must have code at the pinned block");
        assertGt(configuredAusdc.code.length, 0, "configured aUSDC must have code at the pinned block");

        provider = configuredProvider;
        pool = configuredPool;
        usdc = configuredUsdc;
        ausdc = configuredAusdc;
        adapter = new AaveV3SupplyWithdrawAdapter(
            ARBITRUM_ONE_CHAIN_ID, provider, pool, address(this), 0, address(this), address(this), address(this)
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

    function test_DependencyCodeAndProviderPoolEqualityReadOnly() public view {
        assertGt(provider.code.length, 0, "provider must retain code");
        assertGt(pool.code.length, 0, "pool must retain code");
        assertGt(usdc.code.length, 0, "USDC must retain code");
        assertGt(ausdc.code.length, 0, "aUSDC must retain code");
        assertEq(IForkAaveProvider(provider).getPool(), pool, "provider.getPool must equal the staged pool");
        assertEq(address(adapter.poolAddressesProvider()), provider, "adapter must bind the exact provider");
        assertEq(adapter.expectedPool(), pool, "adapter must bind the exact pool");
        assertEq(adapter.executor(), address(this), "adapter must bind the exact executor");
        assertEq(adapter.expectedChainId(), ARBITRUM_ONE_CHAIN_ID, "adapter must bind Arbitrum One");
        assertEq(IERC20(usdc).allowance(address(adapter), pool), 0, "adapter must hold no pool allowance");
    }

    function test_ReserveATokenAndDecimalsReadOnly() public view {
        (,,,,,,,, address aToken,,,,,,) = IForkAavePool(pool).getReserveData(usdc);
        assertEq(aToken, ausdc, "reserve aToken must equal the expected aUSDC");
        assertEq(IForkDecimals(usdc).decimals(), 6, "native USDC must use 6 decimals");
        assertEq(IERC20(usdc).allowance(address(adapter), pool), 0, "read-only path must leave no allowance");
    }

    function test_CanonicalActionHashIsDeterministic() public view {
        bytes32 policy = keccak256("fork-recipient-policy");
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 firstSupply = adapter.hashStagedSupply(usdc, 1_000_000, address(adapter), 0, deadline, policy, pool);
        bytes32 secondSupply = adapter.hashStagedSupply(usdc, 1_000_000, address(adapter), 0, deadline, policy, pool);
        assertEq(firstSupply, secondSupply, "supply action hash must be deterministic");
        assertTrue(firstSupply != bytes32(0), "supply action hash must be nonzero");
        bytes32 firstWithdraw = adapter.hashStagedWithdraw(usdc, 1_000_000, address(this), deadline, policy, pool);
        bytes32 secondWithdraw = adapter.hashStagedWithdraw(usdc, 1_000_000, address(this), deadline, policy, pool);
        assertEq(firstWithdraw, secondWithdraw, "withdraw action hash must be deterministic");
        assertTrue(firstWithdraw != bytes32(0), "withdraw action hash must be nonzero");
        assertTrue(firstSupply != firstWithdraw, "supply and withdraw domains must not collide");
    }

    function test_ValueMovingSupplyWithdrawWhenFixtureFunded() public {
        uint256 fixtureAmount = vm.envOr("SETRYN_AAVE_FORK_FIXTURE_AMOUNT", uint256(0));
        if (fixtureAmount == 0) {
            vm.skip(
                true,
                "Set SETRYN_AAVE_FORK_FIXTURE_AMOUNT to run the value-moving fork supply/withdraw case; read-only qualification above already passed"
            );
        }
        // Fund from a real native-USDC holder at the pinned block instead of rewriting FiatToken storage.
        address holder = vm.envOr("SETRYN_AAVE_FORK_USDC_HOLDER", address(0));
        assertTrue(holder != address(0), "SETRYN_AAVE_FORK_USDC_HOLDER must name a funded native USDC holder");
        assertEq(holder.code.length, 0, "fixture holder must be an externally owned account");
        uint256 holderBefore = IERC20(usdc).balanceOf(holder);
        uint256 adapterBefore = IERC20(usdc).balanceOf(address(adapter));
        assertGe(holderBefore, fixtureAmount, "fixture holder must hold the fixture amount at the pinned block");
        vm.prank(holder);
        assertTrue(IERC20(usdc).transfer(address(adapter), fixtureAmount), "fixture transfer must succeed");
        assertEq(IERC20(usdc).balanceOf(holder), holderBefore - fixtureAmount, "holder must lose the exact fixture");
        assertEq(
            IERC20(usdc).balanceOf(address(adapter)),
            adapterBefore + fixtureAmount,
            "adapter must gain the exact fixture"
        );
        adapter.syncInventory(usdc);

        bytes32 policy = keccak256("fork-recipient-policy");
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 supplyHash = adapter.stageSupply(usdc, fixtureAmount, address(adapter), 0, deadline, policy);
        OperationalBinding memory supplyBinding = OperationalBinding({
            chainId: block.chainid,
            deploymentId: keccak256("fork-qualification"),
            accountId: AccountId.wrap(keccak256("account")),
            marketId: MarketId.wrap(keccak256("market")),
            seriesId: SeriesId.wrap(keccak256("series")),
            seriesVersion: 1,
            packageId: PackageId.wrap(keccak256("package")),
            packageVersion: 1,
            actionHash: supplyHash,
            nonce: 1,
            deadline: deadline,
            minValue: int256(fixtureAmount),
            maxValue: type(int256).max,
            recipientPolicyHash: policy,
            expectedPostconditionsHash: adapter.hashSupplyPostconditions(
                supplyHash, usdc, fixtureAmount, address(adapter), 0, deadline, policy, pool
            )
        });
        ExternalVenueRequest memory supplyRequest = ExternalVenueRequest({
            binding: supplyBinding,
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
        ExternalVenueResult memory supplyResult = adapter.submitExternalAction(supplyRequest);
        assertEq(uint8(supplyResult.state), uint8(OperationalActionState.Complete), "fork supply must complete");
        assertEq(supplyResult.residualValue, 0, "atomic supply must leave zero residual");
        assertEq(IERC20(usdc).allowance(address(adapter), pool), 0, "allowance must be cleared after supply");
        // Aave scales supplies by the liquidity index, so the observable aToken balance can round down by one unit.
        uint256 aTokenBalance = IERC20(ausdc).balanceOf(address(adapter));
        assertLe(aTokenBalance, fixtureAmount + 1, "aToken position must not exceed the fixture beyond rounding");
        assertGe(aTokenBalance + 1, fixtureAmount, "aToken position must match the fixture within one unit");
        uint256 withdrawAmount = aTokenBalance < fixtureAmount ? aTokenBalance : fixtureAmount;

        bytes32 withdrawHash = adapter.stageWithdraw(usdc, withdrawAmount, address(this), deadline, policy);
        OperationalBinding memory withdrawBinding = OperationalBinding({
            chainId: block.chainid,
            deploymentId: keccak256("fork-qualification"),
            accountId: AccountId.wrap(keccak256("account")),
            marketId: MarketId.wrap(keccak256("market")),
            seriesId: SeriesId.wrap(keccak256("series")),
            seriesVersion: 1,
            packageId: PackageId.wrap(keccak256("package")),
            packageVersion: 2,
            actionHash: withdrawHash,
            nonce: 2,
            deadline: deadline,
            minValue: int256(withdrawAmount),
            maxValue: type(int256).max,
            recipientPolicyHash: policy,
            expectedPostconditionsHash: adapter.hashWithdrawPostconditions(
                withdrawHash, usdc, withdrawAmount, address(this), deadline, policy, pool
            )
        });
        ExternalVenueRequest memory withdrawRequest = ExternalVenueRequest({
            binding: withdrawBinding,
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
        uint256 recipientBefore = IERC20(usdc).balanceOf(address(this));
        ExternalVenueResult memory withdrawResult = adapter.submitExternalAction(withdrawRequest);
        assertEq(uint8(withdrawResult.state), uint8(OperationalActionState.Complete), "fork withdraw must complete");
        assertEq(
            IERC20(usdc).balanceOf(address(this)) - recipientBefore,
            withdrawAmount,
            "recipient must receive the exact underlying"
        );

        ExternalVenueRequest memory copy = withdrawRequest;
        bytes32 requestHash = OperationalAdapterLib.hashExternalRequest(copy);
        ExternalVenueResult memory reconciled = adapter.reconcileExternalAction(requestHash);
        assertEq(
            reconciled.postconditionsHash, withdrawResult.postconditionsHash, "reconcile must return stored result"
        );
    }

    function _startsWithHttps(string memory value) private pure returns (bool) {
        bytes memory data = bytes(value);
        if (data.length < 8) return false;
        return data[0] == "h" && data[1] == "t" && data[2] == "t" && data[3] == "p" && data[4] == "s" && data[5] == ":"
            && data[6] == "/" && data[7] == "/";
    }

    function _isDecimal(string memory value) private pure returns (bool) {
        bytes memory data = bytes(value);
        if (data.length == 0) return false;
        for (uint256 i = 0; i < data.length; i++) {
            if (data[i] < "0" || data[i] > "9") return false;
        }
        return true;
    }
}
