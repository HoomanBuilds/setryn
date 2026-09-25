// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {OperationalAdapterExecutor} from "../../src/adapters/operational/OperationalAdapterExecutor.sol";
import {AdapterRegistry} from "../../src/registry/AdapterRegistry.sol";
import {AdapterDefinition} from "../../src/types/AdapterDefinition.sol";
import {AccountId, AdapterId, AdapterKindId, MarketId, PackageId, SeriesId} from "../../src/types/Identifiers.sol";
import {
    AdapterReference,
    ExecutionGuaranteeClass,
    ExternalTerminalFallback,
    ExternalVenueRequest,
    OperationalActionState,
    OperationalBinding
} from "../../src/types/OperationalAdapterTypes.sol";
import {MockOperationalAdapter} from "../mocks/OperationalAdapterMocks.sol";

contract OperationalAdapterExecutorTest is Test {
    bytes32 private constant DEPLOYMENT_ID = keccak256("deployment");
    bytes32 private constant INTERFACE_CURVE = keccak256("SetrynCurveRateSnapshotAdapterV1");
    bytes32 private constant CAPABILITY_CURVE = keccak256("SetrynCapabilityV1:CurveRate:ProxyFree");
    bytes32 private constant INTERFACE_NATIVE = keccak256("SetrynNativeLedgerExecutionAdapterV1");
    bytes32 private constant CAPABILITY_NATIVE = keccak256("SetrynCapabilityV1:NativeLedgerExecution:ProxyFree");
    bytes32 private constant INTERFACE_VENUE = keccak256("SetrynExternalVenueExecutionAdapterV1");
    bytes32 private constant CAPABILITY_ASYNC = keccak256("SetrynCapabilityV1:ExternalVenue:BoundedAsync:ProxyFree");

    AdapterRegistry private registry;
    OperationalAdapterExecutor private executor;

    function setUp() external {
        registry = new AdapterRegistry(0, address(this));
        executor = new OperationalAdapterExecutor(registry, DEPLOYMENT_ID, 500_000, 800_000);
    }

    function testCurveReadIsExactVersionAndBounded() external {
        MockOperationalAdapter adapter = new MockOperationalAdapter(INTERFACE_CURVE, CAPABILITY_CURVE, false);
        adapter.configure(OperationalActionState.Unspecified, 420, bytes32(uint256(1)), true);
        AdapterReference memory adapterRef = _register(
            adapter, AdapterKindId.wrap(keccak256("SetrynAdapterKindV1:Curve")), INTERFACE_CURVE, CAPABILITY_CURVE
        );
        assertEq(executor.readCurveRate(adapterRef, _binding()).value, 420);
    }

    function testProxyDescriptorFailsClosed() external {
        MockOperationalAdapter adapter = new MockOperationalAdapter(INTERFACE_CURVE, CAPABILITY_CURVE, false);
        adapter.configure(OperationalActionState.Unspecified, 420, bytes32(uint256(1)), false);
        AdapterReference memory adapterRef = _register(
            adapter, AdapterKindId.wrap(keccak256("SetrynAdapterKindV1:Curve")), INTERFACE_CURVE, CAPABILITY_CURVE
        );
        vm.expectRevert(OperationalAdapterExecutor.ProxyAdapterForbidden.selector);
        executor.readCurveRate(adapterRef, _binding());
    }

    function testNativeActionCannotReplay() external {
        MockOperationalAdapter adapter = new MockOperationalAdapter(INTERFACE_NATIVE, CAPABILITY_NATIVE, true);
        OperationalBinding memory binding = _binding();
        adapter.configure(OperationalActionState.Complete, 420, binding.expectedPostconditionsHash, true);
        AdapterReference memory adapterRef = _register(
            adapter,
            AdapterKindId.wrap(keccak256("SetrynAdapterKindV1:NativeLedger")),
            INTERFACE_NATIVE,
            CAPABILITY_NATIVE
        );
        executor.executeNativeLedger(adapterRef, binding);
        vm.expectRevert(OperationalAdapterExecutor.ActionAlreadyConsumed.selector);
        executor.executeNativeLedger(adapterRef, binding);
    }

    function testAsyncProgressAndRecoveryArePrecommitted() external {
        MockOperationalAdapter adapter = new MockOperationalAdapter(INTERFACE_VENUE, CAPABILITY_ASYNC, true);
        OperationalBinding memory binding = _binding();
        adapter.configure(OperationalActionState.Submitted, 0, bytes32(0), true);
        AdapterReference memory adapterRef = _register(
            adapter, AdapterKindId.wrap(keccak256("SetrynAdapterKindV1:Venue")), INTERFACE_VENUE, CAPABILITY_ASYNC
        );
        ExternalVenueRequest memory request = ExternalVenueRequest({
            binding: binding,
            guaranteeClass: ExecutionGuaranteeClass.BoundedAsync,
            timeoutAt: binding.deadline + 1,
            recoveryDeadline: binding.deadline + 1 days,
            interimExposureOwner: AccountId.wrap(keccak256("solver")),
            recoveryPolicyHash: keccak256("recovery"),
            reservationHash: keccak256("reservation"),
            maximumResidual: 0,
            terminalFallback: ExternalTerminalFallback({
                state: OperationalActionState.NoEffect,
                realizedValue: 0,
                residualValue: 0,
                postconditionsHash: binding.expectedPostconditionsHash,
                outcomeHash: keccak256("terminal-fallback")
            })
        });
        (bytes32 actionId,) = executor.submitExternal(adapterRef, request);

        adapter.configure(OperationalActionState.Reconciling, 0, bytes32(0), true);
        executor.reconcileExternal(actionId);
        adapter.configure(OperationalActionState.Recovered, 0, keccak256("recovered"), true);
        vm.warp(request.timeoutAt);
        executor.recoverExternal(actionId);
        assertEq(uint8(executor.getExternalAction(actionId).state), uint8(OperationalActionState.Recovered));
    }

    function testFuzzBindingValueBounds(int128 minimum, int128 maximum, int128 value) external {
        vm.assume(minimum <= maximum);
        vm.assume(value >= minimum && value <= maximum);
        MockOperationalAdapter adapter = new MockOperationalAdapter(INTERFACE_CURVE, CAPABILITY_CURVE, false);
        adapter.configure(OperationalActionState.Unspecified, value, bytes32(uint256(1)), true);
        AdapterReference memory adapterRef = _register(
            adapter, AdapterKindId.wrap(keccak256("SetrynAdapterKindV1:Curve")), INTERFACE_CURVE, CAPABILITY_CURVE
        );
        OperationalBinding memory binding = _binding();
        binding.minValue = minimum;
        binding.maxValue = maximum;
        assertEq(executor.readCurveRate(adapterRef, binding).value, value);
    }

    function _register(
        MockOperationalAdapter implementation,
        AdapterKindId kind,
        bytes32 interfaceHash,
        bytes32 capabilityHash
    ) private returns (AdapterReference memory adapterRef) {
        AdapterDefinition memory definition = AdapterDefinition({
            namespaceId: keccak256(abi.encode(address(implementation))),
            referenceId: keccak256("reference"),
            kindId: kind,
            implementation: address(implementation),
            expectedRuntimeCodeHash: address(implementation).codehash,
            interfaceHash: interfaceHash,
            capabilityHash: capabilityHash,
            configurationSchemaHash: keccak256("schema"),
            evidenceHash: keccak256("evidence")
        });
        (AdapterId adapterId, uint32 version) = registry.registerAdapter(definition);
        registry.activateAdapter(adapterId, version);
        return AdapterReference(adapterId, version);
    }

    function _binding() private view returns (OperationalBinding memory) {
        return OperationalBinding({
            chainId: block.chainid,
            deploymentId: DEPLOYMENT_ID,
            accountId: AccountId.wrap(keccak256("account")),
            marketId: MarketId.wrap(keccak256("market")),
            seriesId: SeriesId.wrap(keccak256("series")),
            seriesVersion: 1,
            packageId: PackageId.wrap(keccak256("package")),
            packageVersion: 1,
            actionHash: keccak256("action"),
            nonce: 1,
            deadline: uint64(block.timestamp + 1 hours),
            minValue: 0,
            maxValue: 1_000,
            recipientPolicyHash: keccak256("recipient"),
            expectedPostconditionsHash: keccak256("postconditions")
        });
    }
}
