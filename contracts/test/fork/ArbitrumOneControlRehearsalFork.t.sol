// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {DeploySetryn} from "../../script/DeploySetryn.s.sol";
import {OperationalAdapterExecutor} from "../../src/adapters/operational/OperationalAdapterExecutor.sol";
import {IExternalVenueExecutionAdapterV1} from "../../src/interfaces/IOperationalAdapters.sol";
import {ISequencerUptimeFeed} from "../../src/interfaces/ISequencerUptimeFeed.sol";
import {IAdapterRegistry} from "../../src/interfaces/IAdapterRegistry.sol";
import {IRegistryStatusController} from "../../src/interfaces/IRegistryStatusController.sol";
import {RegistryStatusController} from "../../src/policy/RegistryStatusController.sol";
import {AdapterDefinitionLib} from "../../src/libraries/AdapterDefinitionLib.sol";
import {OperationalAdapterLib} from "../../src/libraries/OperationalAdapterLib.sol";
import {AdapterDefinition, AdapterVersion} from "../../src/types/AdapterDefinition.sol";
import {RegistryStatus} from "../../src/types/Enums.sol";
import {AccountId, AdapterId, MarketId, PackageId, SeriesId} from "../../src/types/Identifiers.sol";
import {
    AdapterReference,
    AdapterRuntimeDescriptor,
    ExecutionGuaranteeClass,
    ExternalTerminalFallback,
    ExternalVenueRequest,
    ExternalVenueResult,
    OperationalActionState,
    OperationalBinding
} from "../../src/types/OperationalAdapterTypes.sol";

/// @dev Minimal bounded-async venue mock. Submit enters Submitted, reconcile moves to
/// Reconciling, recover emits a terminal Recovered commitment bound to the submitted
/// expected postconditions. Time gating lives in the executor, not here.
contract ControlAsyncVenueV1 is IExternalVenueExecutionAdapterV1 {
    mapping(bytes32 requestHash => bytes32 expectedPostconditions) private _expected;

    function buildVersion() external pure returns (uint256) {
        return 1;
    }

    function operationalAdapterDescriptor() external view returns (AdapterRuntimeDescriptor memory) {
        return AdapterRuntimeDescriptor({
            self: address(this),
            chainId: block.chainid,
            interfaceHash: OperationalAdapterLib.INTERFACE_EXTERNAL_VENUE,
            capabilityHash: OperationalAdapterLib.CAPABILITY_EXTERNAL_ASYNC,
            proxyFree: true,
            valueMoving: true
        });
    }

    function submitExternalAction(ExternalVenueRequest calldata request) external returns (ExternalVenueResult memory) {
        bytes32 requestHash = keccak256(abi.encode(request));
        _expected[requestHash] = request.binding.expectedPostconditionsHash;
        return ExternalVenueResult({
            state: OperationalActionState.Submitted,
            realizedValue: 0,
            residualValue: 0,
            postconditionsHash: bytes32(0),
            venueActionReference: keccak256("control-venue-action"),
            evidenceHash: keccak256("control-venue-evidence"),
            recoveryOutcomeHash: bytes32(0)
        });
    }

    function reconcileExternalAction(bytes32) external view returns (ExternalVenueResult memory) {
        return ExternalVenueResult({
            state: OperationalActionState.Reconciling,
            realizedValue: 0,
            residualValue: 0,
            postconditionsHash: bytes32(0),
            venueActionReference: keccak256("control-venue-action"),
            evidenceHash: keccak256("control-venue-evidence"),
            recoveryOutcomeHash: bytes32(0)
        });
    }

    function recoverExternalAction(bytes32 requestHash) external returns (ExternalVenueResult memory) {
        return ExternalVenueResult({
            state: OperationalActionState.Recovered,
            realizedValue: 0,
            residualValue: 0,
            postconditionsHash: _expected[requestHash],
            venueActionReference: keccak256("control-venue-action"),
            evidenceHash: keccak256("control-venue-evidence"),
            recoveryOutcomeHash: keccak256("control-recovery-outcome")
        });
    }
}

/// @dev Second async build with distinct runtime bytecode so the upgrade is a real
/// codehash change under an unchanged lineage identity.
contract ControlAsyncVenueV2 is IExternalVenueExecutionAdapterV1 {
    mapping(bytes32 requestHash => bytes32 expectedPostconditions) private _expected;

    function buildVersion() external pure returns (uint256) {
        return 2;
    }

    function migrationMarker() external pure returns (bytes32) {
        return keccak256("control-async-venue-v2");
    }

    function operationalAdapterDescriptor() external view returns (AdapterRuntimeDescriptor memory) {
        return AdapterRuntimeDescriptor({
            self: address(this),
            chainId: block.chainid,
            interfaceHash: OperationalAdapterLib.INTERFACE_EXTERNAL_VENUE,
            capabilityHash: OperationalAdapterLib.CAPABILITY_EXTERNAL_ASYNC,
            proxyFree: true,
            valueMoving: true
        });
    }

    function submitExternalAction(ExternalVenueRequest calldata request) external returns (ExternalVenueResult memory) {
        bytes32 requestHash = keccak256(abi.encode(request));
        _expected[requestHash] = request.binding.expectedPostconditionsHash;
        return ExternalVenueResult({
            state: OperationalActionState.Submitted,
            realizedValue: 0,
            residualValue: 0,
            postconditionsHash: bytes32(0),
            venueActionReference: keccak256("control-venue-action"),
            evidenceHash: keccak256("control-venue-evidence"),
            recoveryOutcomeHash: bytes32(0)
        });
    }

    function reconcileExternalAction(bytes32) external view returns (ExternalVenueResult memory) {
        return ExternalVenueResult({
            state: OperationalActionState.Reconciling,
            realizedValue: 0,
            residualValue: 0,
            postconditionsHash: bytes32(0),
            venueActionReference: keccak256("control-venue-action"),
            evidenceHash: keccak256("control-venue-evidence"),
            recoveryOutcomeHash: bytes32(0)
        });
    }

    function recoverExternalAction(bytes32 requestHash) external returns (ExternalVenueResult memory) {
        return ExternalVenueResult({
            state: OperationalActionState.Recovered,
            realizedValue: 0,
            residualValue: 0,
            postconditionsHash: _expected[requestHash],
            venueActionReference: keccak256("control-venue-action"),
            evidenceHash: keccak256("control-venue-evidence"),
            recoveryOutcomeHash: keccak256("control-recovery-outcome")
        });
    }
}

/// @dev Atomic venue mock that performs observable state movement before an optional
/// downstream failure, so a revert proves the whole action rolled back.
contract ControlAtomicVenueMock is IExternalVenueExecutionAdapterV1 {
    bool public shouldRevert;
    uint256 public ledgerBalance;
    uint256 public reservationBalance;

    function setShouldRevert(bool value) external {
        shouldRevert = value;
    }

    function operationalAdapterDescriptor() external view returns (AdapterRuntimeDescriptor memory) {
        return AdapterRuntimeDescriptor({
            self: address(this),
            chainId: block.chainid,
            interfaceHash: OperationalAdapterLib.INTERFACE_EXTERNAL_VENUE,
            capabilityHash: OperationalAdapterLib.CAPABILITY_EXTERNAL_ATOMIC,
            proxyFree: true,
            valueMoving: true
        });
    }

    function submitExternalAction(ExternalVenueRequest calldata request) external returns (ExternalVenueResult memory) {
        ledgerBalance += 1;
        reservationBalance += 1;
        if (shouldRevert) {
            revert("control downstream failure");
        }
        return ExternalVenueResult({
            state: OperationalActionState.Complete,
            realizedValue: 0,
            residualValue: 0,
            postconditionsHash: request.binding.expectedPostconditionsHash,
            venueActionReference: keccak256("control-atomic-action"),
            evidenceHash: keccak256("control-atomic-evidence"),
            recoveryOutcomeHash: bytes32(0)
        });
    }

    function reconcileExternalAction(bytes32) external view returns (ExternalVenueResult memory) {
        revert("control atomic terminal");
    }

    function recoverExternalAction(bytes32) external returns (ExternalVenueResult memory) {
        revert("control atomic terminal");
    }
}

/// @notice Pinned Arbitrum One fork rehearsal for upgrade, migration, pause, recovery, rollback.
/// @dev Deploys the exact production graph via _deployAndWire. No broadcast, no keys, no mainnet writes.
contract ArbitrumOneControlRehearsalForkTest is Test, DeploySetryn {
    uint256 internal constant ARBITRUM_ONE_CHAIN_ID = 42_161;
    address internal constant NATIVE_USDC = 0xaf88d065e77c8cC2239327C5EDb3A432268e5831;

    bytes4 internal constant TOTAL_SUPPLY_SELECTOR = bytes4(keccak256("totalSupply()"));

    bytes32 internal constant REHEARSAL_DEPLOYMENT_ID = keccak256("SetrynArbitrumOneForkRehearsalV1");
    bytes32 internal constant CONTROL_NAMESPACE = keccak256("SetrynControlRehearsal:VenueNamespace");
    bytes32 internal constant CONTROL_REFERENCE = keccak256("control-venue-primary");
    bytes32 internal constant ATOMIC_NAMESPACE = keccak256("SetrynControlRehearsal:AtomicNamespace");
    bytes32 internal constant ATOMIC_REFERENCE = keccak256("control-atomic-primary");

    uint48 internal constant REHEARSAL_ADMIN_DELAY = 2 days;
    uint64 internal constant REHEARSAL_MAX_LOCK = 30 days;
    uint64 internal constant REHEARSAL_EVAL_GAS_CAP = 2_000_000;
    uint64 internal constant REHEARSAL_RISK_ADAPTER_GAS = 500_000;
    uint64 internal constant REHEARSAL_RISK_OBSERVATION_AGE = 5 minutes;
    uint64 internal constant REHEARSAL_READ_GAS = 500_000;
    uint64 internal constant REHEARSAL_EXECUTION_GAS = 800_000;
    uint64 internal constant REHEARSAL_ORDER_LIFETIME = 30 days;
    uint64 internal constant REHEARSAL_RFQ_TAIL = 1 days;
    uint64 internal constant REHEARSAL_RECOVERY_GRACE = 1 hours;

    address internal sequencerFeed;
    bytes32 internal usdcCodeHashBefore;
    uint256 internal usdcSupplyBefore;

    function setUp() public {
        string memory rpcUrl = vm.envOr("ARBITRUM_RPC_URL", string(""));
        string memory blockNumberStr = vm.envOr("ARBITRUM_ONE_FORK_BLOCK_NUMBER", string(""));
        address configuredFeed = vm.envOr("SETRYN_SEQUENCER_UPTIME_FEED", address(0));

        if (bytes(rpcUrl).length == 0 || bytes(blockNumberStr).length == 0 || configuredFeed == address(0)) {
            vm.skip(
                true,
                "Set ARBITRUM_RPC_URL, ARBITRUM_ONE_FORK_BLOCK_NUMBER and SETRYN_SEQUENCER_UPTIME_FEED to run the control rehearsal"
            );
        }
        require(_isHttps(rpcUrl), "ARBITRUM_RPC_URL must be explicit HTTPS");
        require(_isDecimal(blockNumberStr), "ARBITRUM_ONE_FORK_BLOCK_NUMBER must be decimal");
        uint256 pinnedBlock = vm.parseUint(blockNumberStr);
        require(pinnedBlock != 0, "ARBITRUM_ONE_FORK_BLOCK_NUMBER must be nonzero");

        vm.createSelectFork(rpcUrl, pinnedBlock);
        assertEq(block.chainid, ARBITRUM_ONE_CHAIN_ID, "RPC must resolve to Arbitrum One");
        assertGt(configuredFeed.code.length, 0, "configured sequencer feed must have code at the pinned block");

        sequencerFeed = configuredFeed;
        usdcCodeHashBefore = NATIVE_USDC.codehash;
        usdcSupplyBefore = _totalSupply();
    }

    function test_RehearseControlsOnArbitrumOneFork() public {
        address bootstrap = makeAddr("control-bootstrap");
        address governanceAdmin = makeAddr("control-gov-admin");
        address governanceOperator = makeAddr("control-gov-operator");
        address guardian = makeAddr("control-guardian");
        address excessRecovery = makeAddr("control-excess");
        address privacyKeyPublisher = makeAddr("control-privacy");
        address lifecycleWitnessStager = makeAddr("control-witness");

        DeploymentConfig memory config = DeploymentConfig({
            bootstrapAdmin: bootstrap,
            governanceAdmin: governanceAdmin,
            governanceOperator: governanceOperator,
            guardian: guardian,
            excessRecovery: excessRecovery,
            privacyKeyPublisher: privacyKeyPublisher,
            lifecycleWitnessStager: lifecycleWitnessStager,
            defaultAdminDelay: REHEARSAL_ADMIN_DELAY,
            maxLockDuration: REHEARSAL_MAX_LOCK,
            evaluationGasHardCap: REHEARSAL_EVAL_GAS_CAP,
            maximumRiskAdapterGas: REHEARSAL_RISK_ADAPTER_GAS,
            maximumRiskObservationAge: REHEARSAL_RISK_OBSERVATION_AGE,
            operationalReadGas: REHEARSAL_READ_GAS,
            operationalExecutionGas: REHEARSAL_EXECUTION_GAS,
            maximumOrderLifetime: REHEARSAL_ORDER_LIFETIME,
            maximumRfqCapacityTail: REHEARSAL_RFQ_TAIL,
            sequencerRecoveryGrace: REHEARSAL_RECOVERY_GRACE,
            deploymentId: REHEARSAL_DEPLOYMENT_ID,
            sequencerFeed: ISequencerUptimeFeed(sequencerFeed),
            statusGovernance: governanceAdmin,
            retainOperatorStatusRoles: false,
            treasuryController: makeAddr("treasury-safe")
        });

        vm.startPrank(bootstrap);
        (Deployment memory deployment,) = _deployAndWire(config);
        vm.stopPrank();
        assertEq(address(deployment.sequencerUptimeFeed), sequencerFeed, "must reuse the configured feed");

        OperationalAdapterExecutor executor = deployment.operationalAdapterExecutor;
        address operator = governanceOperator;
        assertTrue(
            deployment.adapterRegistry.hasRole(deployment.adapterRegistry.ADAPTER_QUALIFIER_ROLE(), operator),
            "operator must hold qualifier role"
        );
        RegistryStatusController statusController = deployment.registryStatusController;
        bytes32 adapterStatusRole = deployment.adapterRegistry.ADAPTER_STATUS_MANAGER_ROLE();
        assertTrue(
            deployment.adapterRegistry.hasRole(adapterStatusRole, address(statusController)),
            "status controller must hold the combined status role"
        );
        assertFalse(deployment.adapterRegistry.hasRole(adapterStatusRole, operator), "operator must not hold status");
        assertFalse(deployment.adapterRegistry.hasRole(adapterStatusRole, guardian), "guardian must not hold status");
        assertEq(statusController.guardian(), guardian, "controller guardian");
        assertEq(statusController.governance(), governanceAdmin, "controller governance is the timelock");
        StatusPrincipals memory status =
            StatusPrincipals({controller: statusController, guardian: guardian, governance: governanceAdmin});

        // 1) Upgrade: register and activate a new immutable version; old stays reconstructible.
        ControlAsyncVenueV1 implV1 = new ControlAsyncVenueV1();
        AdapterDefinition memory defV1 = _asyncDefinition(address(implV1), keccak256("control-evidence-v1"));
        vm.prank(operator);
        (AdapterId lineageId, uint32 v1) = deployment.adapterRegistry.registerAdapter(defV1);
        assertEq(v1, 1, "first version must be one");
        assertEq(uint8(deployment.adapterRegistry.statusOf(lineageId, 1)), uint8(RegistryStatus.Paused));
        assertEq(deployment.adapterRegistry.latestVersion(lineageId), 1);
        assertEq(deployment.adapterRegistry.activeVersion(lineageId), 0);
        assertFalse(deployment.adapterRegistry.isOpenForNewRisk(lineageId, 1));
        assertTrue(deployment.adapterRegistry.isLifecycleEnabled(lineageId, 1));

        bytes32 defHashV1 = AdapterDefinitionLib.hashDefinition(defV1, block.chainid);
        AdapterVersion memory recV1 = deployment.adapterRegistry.getAdapter(lineageId, 1);
        assertEq(recV1.definitionHash, defHashV1, "v1 definition hash must reconstruct");
        assertEq(
            recV1.versionHash,
            AdapterDefinitionLib.hashVersion(lineageId, 1, defHashV1, block.chainid),
            "v1 version hash must reconstruct"
        );

        // The guardian can never reach activation, and the operator no longer holds the status role directly.
        vm.prank(guardian);
        vm.expectRevert(
            abi.encodeWithSelector(
                IRegistryStatusController.StatusCallerUnauthorized.selector,
                guardian,
                IRegistryStatusController.StatusCallClass.Govern
            )
        );
        statusController.govern(
            address(deployment.adapterRegistry), abi.encodeCall(IAdapterRegistry.activateAdapter, (lineageId, 1))
        );
        vm.prank(operator);
        vm.expectRevert();
        deployment.adapterRegistry.activateAdapter(lineageId, 1);
        _activateAdapter(status, deployment, lineageId, 1);
        assertEq(deployment.adapterRegistry.activeVersion(lineageId), 1);
        assertTrue(deployment.adapterRegistry.isOpenForNewRisk(lineageId, 1));

        ControlAsyncVenueV2 implV2 = new ControlAsyncVenueV2();
        assertTrue(address(implV1).codehash != address(implV2).codehash, "upgrade builds must differ in runtime");
        AdapterDefinition memory defV2 = _asyncDefinition(address(implV2), keccak256("control-evidence-v2"));
        vm.prank(operator);
        (AdapterId lineageIdV2, uint32 v2) = deployment.adapterRegistry.registerAdapter(defV2);
        assertEq(AdapterId.unwrap(lineageIdV2), AdapterId.unwrap(lineageId), "upgrade must keep lineage");
        assertEq(v2, 2, "upgrade must mint version two");
        assertEq(deployment.adapterRegistry.latestVersion(lineageId), 2);
        assertEq(deployment.adapterRegistry.activeVersion(lineageId), 1, "register must not move active");
        assertEq(uint8(deployment.adapterRegistry.statusOf(lineageId, 2)), uint8(RegistryStatus.Paused));
        AdapterVersion memory recV1After = deployment.adapterRegistry.getAdapter(lineageId, 1);
        assertEq(recV1After.definitionHash, defHashV1, "old version must stay reconstructible");
        assertEq(recV1After.definition.implementation, address(implV1), "old implementation must be pinned");
        assertTrue(deployment.adapterRegistry.isLifecycleEnabled(lineageId, 1));

        // 2) Migration: move the active pointer; new requests resolve only the new version.
        _pauseAdapter(status, deployment, lineageId, 1);
        assertEq(deployment.adapterRegistry.activeVersion(lineageId), 0);
        _activateAdapter(status, deployment, lineageId, 2);
        assertEq(deployment.adapterRegistry.activeVersion(lineageId), 2);
        assertTrue(deployment.adapterRegistry.isOpenForNewRisk(lineageId, 2));
        assertFalse(deployment.adapterRegistry.isOpenForNewRisk(lineageId, 1));
        assertTrue(deployment.adapterRegistry.isLifecycleEnabled(lineageId, 1));
        assertTrue(deployment.adapterRegistry.isLifecycleEnabled(lineageId, 2));

        AdapterReference memory oldRef = AdapterReference({adapterId: lineageId, adapterVersion: 1});
        AdapterReference memory newRef = AdapterReference({adapterId: lineageId, adapterVersion: 2});
        OperationalBinding memory bindingOld = _binding(executor, 1);
        ExternalVenueRequest memory requestOld = _asyncRequest(bindingOld, 1);
        vm.expectRevert(
            abi.encodeWithSelector(OperationalAdapterExecutor.AdapterUnavailable.selector, lineageId, uint32(1))
        );
        executor.submitExternal(oldRef, requestOld);

        OperationalBinding memory bindingA = _binding(executor, 2);
        ExternalVenueRequest memory requestA = _asyncRequest(bindingA, 2);
        (bytes32 actionA, ExternalVenueResult memory resultA) = executor.submitExternal(newRef, requestA);
        assertEq(uint8(resultA.state), uint8(OperationalActionState.Submitted));
        assertEq(executor.getExternalAction(actionA).adapterVersion, 2);
        AdapterVersion memory histV1 = deployment.adapterRegistry.getAdapter(lineageId, 1);
        assertEq(histV1.definition.implementation, address(implV1), "history must remain readable");
        assertEq(uint8(histV1.status), uint8(RegistryStatus.Paused));

        // 3) Pause: stop new risk while historical lifecycle and terminal resolution continue.
        OperationalBinding memory bindingB = _binding(executor, 3);
        ExternalVenueRequest memory requestB = _asyncRequest(bindingB, 3);
        (bytes32 actionB,) = executor.submitExternal(newRef, requestB);

        _pauseAdapter(status, deployment, lineageId, 2);
        assertEq(deployment.adapterRegistry.activeVersion(lineageId), 0);
        assertFalse(deployment.adapterRegistry.isOpenForNewRisk(lineageId, 2));
        assertTrue(deployment.adapterRegistry.isLifecycleEnabled(lineageId, 2));
        assertTrue(deployment.adapterRegistry.runtimeMatches(lineageId, 2));

        OperationalBinding memory bindingC = _binding(executor, 4);
        ExternalVenueRequest memory requestC = _asyncRequest(bindingC, 4);
        vm.expectRevert(
            abi.encodeWithSelector(OperationalAdapterExecutor.AdapterUnavailable.selector, lineageId, uint32(2))
        );
        executor.submitExternal(newRef, requestC);

        ExternalVenueResult memory reconciledB = executor.reconcileExternal(actionB);
        assertEq(uint8(reconciledB.state), uint8(OperationalActionState.Reconciling));
        vm.warp(requestB.recoveryDeadline + 1);
        ExternalVenueResult memory terminalB = executor.terminalizeExternal(actionB);
        assertEq(uint8(terminalB.state), uint8(OperationalActionState.NoEffect));
        assertTrue(executor.getExternalAction(actionB).resultHash != bytes32(0));

        // 4) Bounded async recovery: Pending, recoverable only at timeout, terminal, deadline-bound.
        _activateAdapter(status, deployment, lineageId, 2);
        assertTrue(deployment.adapterRegistry.isOpenForNewRisk(lineageId, 2));

        OperationalBinding memory bindingR1 = _binding(executor, 10);
        ExternalVenueRequest memory requestR1 = _asyncRequest(bindingR1, 10);
        (bytes32 actionR1, ExternalVenueResult memory resultR1) = executor.submitExternal(newRef, requestR1);
        assertEq(uint8(resultR1.state), uint8(OperationalActionState.Submitted));

        vm.expectRevert(
            abi.encodeWithSelector(
                OperationalAdapterExecutor.RecoveryNotAvailable.selector,
                requestR1.timeoutAt,
                requestR1.recoveryDeadline,
                vm.getBlockTimestamp()
            )
        );
        executor.recoverExternal(actionR1);

        vm.warp(requestR1.timeoutAt);
        ExternalVenueResult memory recoveredR1 = executor.recoverExternal(actionR1);
        assertEq(uint8(recoveredR1.state), uint8(OperationalActionState.Recovered));
        assertEq(recoveredR1.postconditionsHash, bindingR1.expectedPostconditionsHash);
        assertTrue(recoveredR1.recoveryOutcomeHash != bytes32(0));
        assertEq(uint8(executor.getExternalAction(actionR1).state), uint8(OperationalActionState.Recovered));
        vm.expectRevert(abi.encodeWithSelector(OperationalAdapterExecutor.TerminalAction.selector, actionR1));
        executor.reconcileExternal(actionR1);

        OperationalBinding memory bindingR2 = _binding(executor, 11);
        ExternalVenueRequest memory requestR2 = _asyncRequest(bindingR2, 11);
        (bytes32 actionR2,) = executor.submitExternal(newRef, requestR2);
        vm.warp(requestR2.recoveryDeadline + 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                OperationalAdapterExecutor.RecoveryNotAvailable.selector,
                requestR2.timeoutAt,
                requestR2.recoveryDeadline,
                vm.getBlockTimestamp()
            )
        );
        executor.recoverExternal(actionR2);
        vm.expectRevert(
            abi.encodeWithSelector(
                OperationalAdapterExecutor.RecoveryDeadlineElapsed.selector,
                requestR2.recoveryDeadline,
                vm.getBlockTimestamp()
            )
        );
        executor.reconcileExternal(actionR2);
        ExternalVenueResult memory terminalR2 = executor.terminalizeExternal(actionR2);
        assertEq(uint8(terminalR2.state), uint8(OperationalActionState.NoEffect));

        // 5) Atomic rollback: downstream failure rolls back consumption, balances, records.
        ControlAtomicVenueMock implAtomic = new ControlAtomicVenueMock();
        AdapterDefinition memory defAtomic = _atomicDefinition(address(implAtomic));
        vm.prank(operator);
        (AdapterId atomicId, uint32 atomicVersion) = deployment.adapterRegistry.registerAdapter(defAtomic);
        _activateAdapter(status, deployment, atomicId, atomicVersion);
        AdapterReference memory atomicRef = AdapterReference({adapterId: atomicId, adapterVersion: atomicVersion});

        OperationalBinding memory bindingAtom = _binding(executor, 20);
        ExternalVenueRequest memory requestAtom = _atomicRequest(bindingAtom);
        bytes32 atomActionId = _actionId(executor, atomicRef, bindingAtom);

        implAtomic.setShouldRevert(true);
        uint256 ledgerBefore = implAtomic.ledgerBalance();
        vm.expectRevert(
            abi.encodeWithSelector(
                OperationalAdapterExecutor.AdapterCallFailed.selector,
                IExternalVenueExecutionAdapterV1.submitExternalAction.selector
            )
        );
        executor.submitExternal(atomicRef, requestAtom);
        assertFalse(executor.actionConsumed(atomActionId), "consumption must roll back");
        assertEq(implAtomic.ledgerBalance(), ledgerBefore, "ledger movement must roll back");
        assertEq(implAtomic.reservationBalance(), 0, "reservation movement must roll back");
        vm.expectRevert(abi.encodeWithSelector(OperationalAdapterExecutor.UnknownExternalAction.selector, atomActionId));
        executor.getExternalAction(atomActionId);

        implAtomic.setShouldRevert(false);
        (bytes32 atomOk, ExternalVenueResult memory atomResult) = executor.submitExternal(atomicRef, requestAtom);
        assertEq(atomOk, atomActionId, "retry must reuse the rolled-back action id");
        assertEq(uint8(atomResult.state), uint8(OperationalActionState.Complete));
        assertTrue(executor.actionConsumed(atomActionId));
        assertEq(implAtomic.ledgerBalance(), ledgerBefore + 1);
        assertEq(uint8(executor.getExternalAction(atomActionId).state), uint8(OperationalActionState.Complete));

        assertEq(NATIVE_USDC.codehash, usdcCodeHashBefore, "native USDC code must be unchanged");
        assertEq(_totalSupply(), usdcSupplyBefore, "native USDC supply must be unchanged");
    }

    function _asyncDefinition(address implementation, bytes32 evidence)
        private
        view
        returns (AdapterDefinition memory)
    {
        return AdapterDefinition({
            namespaceId: CONTROL_NAMESPACE,
            referenceId: CONTROL_REFERENCE,
            kindId: OperationalAdapterLib.KIND_VENUE,
            implementation: implementation,
            expectedRuntimeCodeHash: implementation.codehash,
            interfaceHash: OperationalAdapterLib.INTERFACE_EXTERNAL_VENUE,
            capabilityHash: OperationalAdapterLib.CAPABILITY_EXTERNAL_ASYNC,
            configurationSchemaHash: keccak256("control-config-schema-v1"),
            evidenceHash: evidence
        });
    }

    function _atomicDefinition(address implementation) private view returns (AdapterDefinition memory) {
        return AdapterDefinition({
            namespaceId: ATOMIC_NAMESPACE,
            referenceId: ATOMIC_REFERENCE,
            kindId: OperationalAdapterLib.KIND_VENUE,
            implementation: implementation,
            expectedRuntimeCodeHash: implementation.codehash,
            interfaceHash: OperationalAdapterLib.INTERFACE_EXTERNAL_VENUE,
            capabilityHash: OperationalAdapterLib.CAPABILITY_EXTERNAL_ATOMIC,
            configurationSchemaHash: keccak256("control-config-schema-atomic"),
            evidenceHash: keccak256("control-evidence-atomic")
        });
    }

    function _binding(OperationalAdapterExecutor executor, uint64 nonce)
        private
        view
        returns (OperationalBinding memory)
    {
        return OperationalBinding({
            chainId: block.chainid,
            deploymentId: executor.deploymentId(),
            accountId: AccountId.wrap(keccak256(abi.encode("control-account", nonce))),
            marketId: MarketId.wrap(keccak256("control-market")),
            seriesId: SeriesId.wrap(keccak256("control-series")),
            seriesVersion: 1,
            packageId: PackageId.wrap(keccak256("control-package")),
            packageVersion: 1,
            actionHash: keccak256(abi.encode("control-action", nonce)),
            nonce: nonce,
            deadline: uint64(vm.getBlockTimestamp() + 1 hours),
            minValue: 0,
            maxValue: 1_000,
            recipientPolicyHash: keccak256("control-recipient"),
            expectedPostconditionsHash: keccak256(abi.encode("control-postconditions", nonce))
        });
    }

    function _asyncRequest(OperationalBinding memory binding, uint64 nonce)
        private
        pure
        returns (ExternalVenueRequest memory)
    {
        return ExternalVenueRequest({
            binding: binding,
            guaranteeClass: ExecutionGuaranteeClass.BoundedAsync,
            timeoutAt: binding.deadline + 1,
            recoveryDeadline: binding.deadline + 1 days,
            interimExposureOwner: AccountId.wrap(keccak256("control-solver")),
            recoveryPolicyHash: keccak256("control-recovery-policy"),
            reservationHash: keccak256(abi.encode("control-reservation", nonce)),
            maximumResidual: 0,
            terminalFallback: ExternalTerminalFallback({
                state: OperationalActionState.NoEffect,
                realizedValue: 0,
                residualValue: 0,
                postconditionsHash: binding.expectedPostconditionsHash,
                outcomeHash: keccak256(abi.encode("control-terminal-fallback", nonce))
            })
        });
    }

    function _atomicRequest(OperationalBinding memory binding) private pure returns (ExternalVenueRequest memory) {
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

    function _actionId(
        OperationalAdapterExecutor executor,
        AdapterReference memory adapterRef,
        OperationalBinding memory binding
    ) private view returns (bytes32) {
        return keccak256(
            abi.encode(
                block.chainid,
                address(executor),
                adapterRef.adapterId,
                adapterRef.adapterVersion,
                keccak256(abi.encode(binding))
            )
        );
    }

    function _isHttps(string memory url) private pure returns (bool) {
        bytes memory raw = bytes(url);
        if (raw.length < 8) {
            return false;
        }
        return raw[0] == "h" && raw[1] == "t" && raw[2] == "t" && raw[3] == "p" && raw[4] == "s" && raw[5] == ":"
            && raw[6] == "/" && raw[7] == "/";
    }

    function _isDecimal(string memory value) private pure returns (bool) {
        bytes memory raw = bytes(value);
        if (raw.length == 0) {
            return false;
        }
        for (uint256 i; i < raw.length; ++i) {
            if (raw[i] < "0" || raw[i] > "9") {
                return false;
            }
        }
        return true;
    }

    function _totalSupply() private view returns (uint256 supply) {
        (bool success, bytes memory data) = NATIVE_USDC.staticcall(abi.encodeWithSelector(TOTAL_SUPPLY_SELECTOR));
        assertTrue(success, "native USDC supply read failed");
        supply = abi.decode(data, (uint256));
    }

    struct StatusPrincipals {
        RegistryStatusController controller;
        address guardian;
        address governance;
    }

    /// Activation and resumption go through the controller's governance path only.
    function _activateAdapter(StatusPrincipals memory status, Deployment memory d, AdapterId id, uint32 version)
        internal
    {
        vm.prank(status.governance);
        status.controller
            .govern(address(d.adapterRegistry), abi.encodeCall(IAdapterRegistry.activateAdapter, (id, version)));
    }

    /// Emergency pause goes through the controller's guardian path only.
    function _pauseAdapter(StatusPrincipals memory status, Deployment memory d, AdapterId id, uint32 version) internal {
        vm.prank(status.guardian);
        status.controller
            .pause(address(d.adapterRegistry), abi.encodeCall(IAdapterRegistry.pauseAdapter, (id, version)));
    }
}

/// @dev Local-only checks for the rehearsal mocks and async progression rules. No fork, no RPC.
contract ControlRehearsalLocalTest is Test {
    function test_TerminalStatesAreExactlyCompleteRecoveredNoEffect() public pure {
        assertTrue(OperationalAdapterLib.terminal(OperationalActionState.Complete));
        assertTrue(OperationalAdapterLib.terminal(OperationalActionState.Recovered));
        assertTrue(OperationalAdapterLib.terminal(OperationalActionState.NoEffect));
        assertFalse(OperationalAdapterLib.terminal(OperationalActionState.Submitted));
        assertFalse(OperationalAdapterLib.terminal(OperationalActionState.Reconciling));
        assertFalse(OperationalAdapterLib.terminal(OperationalActionState.Recovering));
    }

    function test_AsyncProgressionAllowsSubmittedToRecoveredButNotReverse() public pure {
        assertTrue(
            OperationalAdapterLib.isAsyncProgression(OperationalActionState.Submitted, OperationalActionState.Recovered)
        );
        assertTrue(
            OperationalAdapterLib.isAsyncProgression(
                OperationalActionState.Reconciling, OperationalActionState.NoEffect
            )
        );
        assertFalse(
            OperationalAdapterLib.isAsyncProgression(OperationalActionState.Recovered, OperationalActionState.Complete)
        );
        assertFalse(
            OperationalAdapterLib.isAsyncProgression(OperationalActionState.Submitted, OperationalActionState.Submitted)
        );
    }

    function test_MockDescriptorsAreProxyFreeAndValueMoving() public {
        ControlAsyncVenueV1 asyncV1 = new ControlAsyncVenueV1();
        AdapterRuntimeDescriptor memory asyncDescriptor = asyncV1.operationalAdapterDescriptor();
        assertEq(asyncDescriptor.self, address(asyncV1));
        assertEq(asyncDescriptor.chainId, block.chainid);
        assertEq(asyncDescriptor.interfaceHash, OperationalAdapterLib.INTERFACE_EXTERNAL_VENUE);
        assertEq(asyncDescriptor.capabilityHash, OperationalAdapterLib.CAPABILITY_EXTERNAL_ASYNC);
        assertTrue(asyncDescriptor.proxyFree);
        assertTrue(asyncDescriptor.valueMoving);

        ControlAtomicVenueMock atomic = new ControlAtomicVenueMock();
        AdapterRuntimeDescriptor memory atomicDescriptor = atomic.operationalAdapterDescriptor();
        assertEq(atomicDescriptor.capabilityHash, OperationalAdapterLib.CAPABILITY_EXTERNAL_ATOMIC);
        assertTrue(atomicDescriptor.proxyFree);
        assertTrue(atomicDescriptor.valueMoving);
    }
}
