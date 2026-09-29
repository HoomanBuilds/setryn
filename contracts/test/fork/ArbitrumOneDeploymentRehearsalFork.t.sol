// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {DeploySetryn} from "../../script/DeploySetryn.s.sol";
import {ISequencerUptimeFeed} from "../../src/interfaces/ISequencerUptimeFeed.sol";

interface IPendingDefaultAdmin {
    function pendingDefaultAdmin() external view returns (address newAdmin, uint48 acceptSchedule);
}

/// @notice Read-only Arbitrum One fork rehearsal of the exact deployment graph.
/// @dev Inherits the deployment script so the internal wiring is exercised directly.
///      Never calls `run()`, never broadcasts, never touches a private key.
contract ArbitrumOneDeploymentRehearsalForkTest is Test, DeploySetryn {
    uint256 internal constant ARBITRUM_ONE_CHAIN_ID = 42_161;
    address internal constant NATIVE_USDC = 0xaf88d065e77c8cC2239327C5EDb3A432268e5831;

    bytes4 internal constant TOTAL_SUPPLY_SELECTOR = bytes4(keccak256("totalSupply()"));

    bytes32 internal constant REHEARSAL_DEPLOYMENT_ID = keccak256("SetrynArbitrumOneForkRehearsalV1");

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
        string memory blockNumber = vm.envOr("ARBITRUM_ONE_FORK_BLOCK_NUMBER", string(""));
        address configuredFeed = vm.envOr("SETRYN_SEQUENCER_UPTIME_FEED", address(0));

        if (bytes(rpcUrl).length == 0 || bytes(blockNumber).length == 0 || configuredFeed == address(0)) {
            vm.skip(
                true,
                "Set ARBITRUM_RPC_URL, ARBITRUM_ONE_FORK_BLOCK_NUMBER and SETRYN_SEQUENCER_UPTIME_FEED to run the fork rehearsal"
            );
        }

        vm.createSelectFork(rpcUrl, vm.parseUint(blockNumber));
        assertEq(block.chainid, ARBITRUM_ONE_CHAIN_ID, "RPC must resolve to Arbitrum One");
        assertGt(configuredFeed.code.length, 0, "configured sequencer feed must have code at the pinned block");

        sequencerFeed = configuredFeed;
        usdcCodeHashBefore = NATIVE_USDC.codehash;
        usdcSupplyBefore = _totalSupply();
        assertGt(NATIVE_USDC.code.length, 0, "native USDC must have runtime code at the pinned block");
    }

    function test_RehearseDeploymentGraphOnArbitrumOneFork() public {
        address bootstrap = makeAddr("setryn-rehearsal-bootstrap");
        address governanceAdmin = makeAddr("setryn-rehearsal-gov-admin");
        address governanceOperator = makeAddr("setryn-rehearsal-gov-operator");
        address guardian = makeAddr("setryn-rehearsal-guardian");
        address excessRecovery = makeAddr("setryn-rehearsal-excess");
        address privacyKeyPublisher = makeAddr("setryn-rehearsal-privacy");
        address lifecycleWitnessStager = makeAddr("setryn-rehearsal-witness");

        assertTrue(bootstrap != governanceAdmin, "principals must be separated");
        assertTrue(bootstrap != governanceOperator, "principals must be separated");
        assertTrue(governanceAdmin != governanceOperator, "principals must be separated");
        assertTrue(guardian != excessRecovery, "operationals must be distinct");
        assertTrue(privacyKeyPublisher != lifecycleWitnessStager, "operationals must be distinct");

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
            sequencerFeed: ISequencerUptimeFeed(sequencerFeed)
        });

        // Mirror production: the bootstrap deployer is the contract creator.
        // Prank only changes msg.sender on this fork; no broadcast, no key, no write to mainnet.
        vm.startPrank(bootstrap);
        (Deployment memory deployment,) = _deployAndWire(config);
        vm.stopPrank();

        assertEq(address(deployment.sequencerUptimeFeed), sequencerFeed, "must reuse the configured feed");

        _assertAllComponentsHaveCode(deployment);
        _assertCriticalRoles(
            deployment,
            bootstrap,
            governanceAdmin,
            governanceOperator,
            guardian,
            excessRecovery,
            privacyKeyPublisher,
            lifecycleWitnessStager
        );
        _assertAdminTransfers(deployment, governanceAdmin);

        assertEq(NATIVE_USDC.codehash, usdcCodeHashBefore, "native USDC code must be unchanged");
        assertEq(_totalSupply(), usdcSupplyBefore, "native USDC supply must be unchanged");
    }

    function _assertAllComponentsHaveCode(Deployment memory d) private view {
        _assertCode(address(d.assetRegistry), "assetRegistry");
        _assertCode(address(d.adapterRegistry), "adapterRegistry");
        _assertCode(address(d.calendarRegistry), "calendarRegistry");
        _assertCode(address(d.sessionRegistry), "sessionRegistry");
        _assertCode(address(d.settlementAssetRegistry), "settlementAssetRegistry");
        _assertCode(address(d.benchmarkRegistry), "benchmarkRegistry");
        _assertCode(address(d.feeScheduleRegistry), "feeScheduleRegistry");
        _assertCode(address(d.riskDomainRegistry), "riskDomainRegistry");
        _assertCode(address(d.instrumentRegistry), "instrumentRegistry");
        _assertCode(address(d.marketRegistry), "marketRegistry");
        _assertCode(address(d.seriesRegistry), "seriesRegistry");
        _assertCode(address(d.collateralVault), "collateralVault");
        _assertCode(address(d.packageRegistry), "packageRegistry");
        _assertCode(address(d.strategyCompiler), "strategyCompiler");
        _assertCode(address(d.positionEngine), "positionEngine");
        _assertCode(address(d.fixingEngine), "fixingEngine");
        _assertCode(address(d.fundedFeeEngine), "fundedFeeEngine");
        _assertCode(address(d.portfolioRiskEngine), "portfolioRiskEngine");
        _assertCode(address(d.sequencerUptimeFeed), "sequencerUptimeFeed");
        _assertCode(address(d.executionPolicyRegistry), "executionPolicyRegistry");
        _assertCode(address(d.tradingSessionPolicy), "tradingSessionPolicy");
        _assertCode(address(d.packageWitnessRegistry), "packageWitnessRegistry");
        _assertCode(address(d.riskAdmissionBindingRegistry), "riskAdmissionBindingRegistry");
        _assertCode(address(d.orderValidationGate), "orderValidationGate");
        _assertCode(address(d.orderState), "orderState");
        _assertCode(address(d.clearingAdmissionGate), "clearingAdmissionGate");
        _assertCode(address(d.atomicClearingEngine), "atomicClearingEngine");
        _assertCode(address(d.privateRfqValidationGate), "privateRfqValidationGate");
        _assertCode(address(d.privateRfqBook), "privateRfqBook");
        _assertCode(address(d.publicBookEligibilityGate), "publicBookEligibilityGate");
        _assertCode(address(d.publicOrderBook), "publicOrderBook");
        _assertCode(address(d.positionLifecycleExecutor), "positionLifecycleExecutor");
        _assertCode(address(d.accountPolicyAuthority), "accountPolicyAuthority");
        _assertCode(address(d.lifecyclePolicyValidator), "lifecyclePolicyValidator");
        _assertCode(address(d.signedLifecycleEngine), "signedLifecycleEngine");
        _assertCode(address(d.compressionCoordinator), "compressionCoordinator");
        _assertCode(address(d.defaultBidderGate), "defaultBidderGate");
        _assertCode(address(d.defaultProcessEngine), "defaultProcessEngine");
        _assertCode(address(d.cashSettlementCoordinator), "cashSettlementCoordinator");
        _assertCode(address(d.privacyCommitmentRegistry), "privacyCommitmentRegistry");
        _assertCode(address(d.operationalAdapterExecutor), "operationalAdapterExecutor");
        _assertCode(address(d.cappedForwardPayoffModule), "cappedForwardPayoffModule");
        _assertCode(address(d.ndfPayoffModule), "ndfPayoffModule");
        _assertCode(address(d.europeanCallPayoffModule), "europeanCallPayoffModule");
        _assertCode(address(d.europeanPutPayoffModule), "europeanPutPayoffModule");
        _assertCode(address(d.collarPayoffModule), "collarPayoffModule");
        _assertCode(address(d.rateForwardPayoffModule), "rateForwardPayoffModule");
        _assertCode(address(d.rateCapPayoffModule), "rateCapPayoffModule");
        _assertCode(address(d.rateFloorPayoffModule), "rateFloorPayoffModule");
        _assertCode(address(d.rateCollarPayoffModule), "rateCollarPayoffModule");
        _assertCode(address(d.basisSpreadPayoffModule), "basisSpreadPayoffModule");
        _assertCode(address(d.calendarSpreadPayoffModule), "calendarSpreadPayoffModule");
        _assertCode(address(d.windowAverageScalarPayoffModule), "windowAverageScalarPayoffModule");
        _assertCode(address(d.correlationDispersionScalarPayoffModule), "correlationDispersionScalarPayoffModule");
    }

    function _assertCriticalRoles(
        Deployment memory d,
        address bootstrap,
        address governanceAdmin,
        address governanceOperator,
        address guardian,
        address excessRecovery,
        address privacyKeyPublisher,
        address lifecycleWitnessStager
    ) private view {
        assertTrue(
            d.assetRegistry.hasRole(d.assetRegistry.REGISTRAR_ROLE(), governanceOperator),
            "operator must hold registrar role"
        );
        assertFalse(
            d.assetRegistry.hasRole(d.assetRegistry.REGISTRAR_ROLE(), bootstrap),
            "bootstrap registrar role must be revoked"
        );
        assertTrue(
            d.executionPolicyRegistry.hasRole(d.executionPolicyRegistry.POLICY_ADMIN_ROLE(), governanceOperator),
            "operator must hold policy admin role"
        );
        assertFalse(
            d.executionPolicyRegistry.hasRole(d.executionPolicyRegistry.POLICY_ADMIN_ROLE(), bootstrap),
            "bootstrap policy admin role must be revoked"
        );

        assertTrue(
            d.publicOrderBook.hasRole(d.publicOrderBook.DEFAULT_ADMIN_ROLE(), governanceAdmin),
            "gov admin must hold book admin role"
        );
        assertTrue(
            d.publicOrderBook.hasRole(d.publicOrderBook.ROUTE_RESERVER_ROLE(), governanceOperator),
            "operator must hold book reserver role"
        );
        assertFalse(
            d.publicOrderBook.hasRole(d.publicOrderBook.DEFAULT_ADMIN_ROLE(), bootstrap),
            "bootstrap book admin role must be revoked"
        );
        assertFalse(
            d.publicOrderBook.hasRole(d.publicOrderBook.ROUTE_RESERVER_ROLE(), bootstrap),
            "bootstrap book reserver role must be revoked"
        );
        assertTrue(
            d.privateRfqBook.hasRole(d.privateRfqBook.ROUTE_RESERVER_ROLE(), governanceOperator),
            "operator must hold rfq reserver role"
        );
        assertFalse(
            d.privateRfqBook.hasRole(d.privateRfqBook.ROUTE_RESERVER_ROLE(), bootstrap),
            "bootstrap rfq reserver role must be revoked"
        );

        assertTrue(
            d.orderState.hasRole(d.orderState.ORDER_CONSUMER_ROLE(), address(d.atomicClearingEngine)),
            "clearing engine must consume orders"
        );
        assertFalse(
            d.orderState.hasRole(d.orderState.ORDER_CONSUMER_ROLE(), bootstrap),
            "bootstrap order consumer role must be revoked"
        );
        assertTrue(
            d.atomicClearingEngine.hasRole(d.atomicClearingEngine.MATCH_EXECUTOR_ROLE(), address(d.publicOrderBook)),
            "book must execute matches"
        );
        assertFalse(
            d.atomicClearingEngine.hasRole(d.atomicClearingEngine.MATCH_EXECUTOR_ROLE(), bootstrap),
            "bootstrap match executor role must be revoked"
        );
        assertTrue(
            d.positionEngine.hasRole(d.positionEngine.CLEARING_ENGINE_ROLE(), address(d.atomicClearingEngine)),
            "clearing engine must drive positions"
        );
        assertFalse(
            d.positionEngine.hasRole(d.positionEngine.CLEARING_ENGINE_ROLE(), bootstrap),
            "bootstrap clearing engine role must be revoked"
        );

        assertTrue(
            d.portfolioRiskEngine
                .hasRole(d.portfolioRiskEngine.EXPOSURE_REDUCER_ROLE(), address(d.positionLifecycleExecutor)),
            "lifecycle executor must reduce exposure"
        );
        assertTrue(
            d.portfolioRiskEngine
                .hasRole(d.portfolioRiskEngine.EXPOSURE_REDUCER_ROLE(), address(d.cashSettlementCoordinator)),
            "settlement coordinator must reduce exposure"
        );
        assertTrue(
            d.portfolioRiskEngine
            .hasRole(d.portfolioRiskEngine.EXPOSURE_REDUCER_ROLE(), address(d.defaultProcessEngine)),
            "default engine must reduce exposure"
        );
        assertFalse(
            d.portfolioRiskEngine.hasRole(d.portfolioRiskEngine.EXPOSURE_REDUCER_ROLE(), bootstrap),
            "bootstrap exposure reducer role must be revoked"
        );

        assertTrue(
            d.collateralVault.hasRole(d.collateralVault.EXCESS_RECOVERY_ROLE(), excessRecovery),
            "excess recovery must be granted"
        );
        assertFalse(
            d.collateralVault.hasRole(d.collateralVault.EXCESS_RECOVERY_ROLE(), bootstrap),
            "bootstrap excess recovery role must be revoked"
        );
        assertTrue(
            d.signedLifecycleEngine.hasRole(d.signedLifecycleEngine.LIFECYCLE_GUARDIAN_ROLE(), guardian),
            "guardian must guard signed lifecycle"
        );
        assertFalse(
            d.signedLifecycleEngine.hasRole(d.signedLifecycleEngine.LIFECYCLE_GUARDIAN_ROLE(), bootstrap),
            "bootstrap lifecycle guardian role must be revoked"
        );
        assertTrue(
            d.compressionCoordinator.hasRole(d.compressionCoordinator.COMPRESSION_GUARDIAN_ROLE(), guardian),
            "guardian must guard compression"
        );
        assertTrue(
            d.privacyCommitmentRegistry
                .hasRole(d.privacyCommitmentRegistry.EPOCH_KEY_PUBLISHER_ROLE(), privacyKeyPublisher),
            "publisher must publish epoch keys"
        );
        assertFalse(
            d.privacyCommitmentRegistry.hasRole(d.privacyCommitmentRegistry.POLICY_QUALIFIER_ROLE(), bootstrap),
            "bootstrap privacy qualifier role must be revoked"
        );
        assertTrue(
            d.positionLifecycleExecutor
                .hasRole(d.positionLifecycleExecutor.WITNESS_STAGER_ROLE(), lifecycleWitnessStager),
            "stager must hold witness role"
        );
        assertFalse(
            d.positionLifecycleExecutor.hasRole(d.positionLifecycleExecutor.WITNESS_STAGER_ROLE(), bootstrap),
            "bootstrap witness stager role must be revoked"
        );
    }

    function _assertAdminTransfers(Deployment memory d, address governanceAdmin) private view {
        _assertPendingAdmin(address(d.assetRegistry), governanceAdmin);
        _assertPendingAdmin(address(d.adapterRegistry), governanceAdmin);
        _assertPendingAdmin(address(d.calendarRegistry), governanceAdmin);
        _assertPendingAdmin(address(d.sessionRegistry), governanceAdmin);
        _assertPendingAdmin(address(d.settlementAssetRegistry), governanceAdmin);
        _assertPendingAdmin(address(d.benchmarkRegistry), governanceAdmin);
        _assertPendingAdmin(address(d.feeScheduleRegistry), governanceAdmin);
        _assertPendingAdmin(address(d.riskDomainRegistry), governanceAdmin);
        _assertPendingAdmin(address(d.instrumentRegistry), governanceAdmin);
        _assertPendingAdmin(address(d.marketRegistry), governanceAdmin);
        _assertPendingAdmin(address(d.seriesRegistry), governanceAdmin);
        _assertPendingAdmin(address(d.collateralVault), governanceAdmin);
        _assertPendingAdmin(address(d.packageRegistry), governanceAdmin);
        _assertPendingAdmin(address(d.positionEngine), governanceAdmin);
        _assertPendingAdmin(address(d.fundedFeeEngine), governanceAdmin);
        _assertPendingAdmin(address(d.portfolioRiskEngine), governanceAdmin);
        _assertPendingAdmin(address(d.positionLifecycleExecutor), governanceAdmin);
        _assertPendingAdmin(address(d.signedLifecycleEngine), governanceAdmin);
        _assertPendingAdmin(address(d.compressionCoordinator), governanceAdmin);
        _assertPendingAdmin(address(d.privacyCommitmentRegistry), governanceAdmin);
        _assertPendingAdmin(address(d.executionPolicyRegistry), governanceAdmin);
        _assertPendingAdmin(address(d.orderState), governanceAdmin);
        _assertPendingAdmin(address(d.atomicClearingEngine), governanceAdmin);
        _assertPendingAdmin(address(d.privateRfqBook), governanceAdmin);
    }

    function _assertPendingAdmin(address target, address governanceAdmin) private view {
        (address pending, uint48 schedule) = IPendingDefaultAdmin(target).pendingDefaultAdmin();
        assertEq(pending, governanceAdmin, "pending admin must transfer to governance admin");
        assertGt(schedule, 0, "pending admin schedule must be set");
    }

    function _assertCode(address target, string memory label) private view {
        assertTrue(target != address(0), string.concat(label, " must be deployed"));
        assertGt(target.code.length, 0, string.concat(label, " must have code"));
    }

    function _totalSupply() private view returns (uint256 supply) {
        (bool success, bytes memory data) = NATIVE_USDC.staticcall(abi.encodeWithSelector(TOTAL_SUPPLY_SELECTOR));
        assertTrue(success, "native USDC supply read failed");
        supply = abi.decode(data, (uint256));
    }
}
