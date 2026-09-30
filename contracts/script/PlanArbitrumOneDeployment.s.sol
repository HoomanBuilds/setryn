// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {VmSafe} from "forge-std/Vm.sol";

import {ISequencerUptimeFeed} from "../src/interfaces/ISequencerUptimeFeed.sol";
import {DeploySetryn} from "./DeploySetryn.s.sol";

/// @notice Planning-only simulation of the production deployment graph on a local fork of Arbitrum One.
/// @dev Invoked as `forge script ... --sig "plan()" --fork-url <rpc> --fork-block-number <n>` without `--broadcast`.
///      Foundry records the exact ordered transactions, including linked-library deployments, into its dry-run
///      output, which scripts/build-arbitrum-one-unsigned-intent.mjs converts into the unsigned intent. The script
///      refuses every broadcast or resume context, uses a keyless planning sender and placeholder principals, and
///      never calls `run()`, whose Arbitrum One hard stop remains in force.
contract PlanArbitrumOneDeployment is DeploySetryn {
    uint256 internal constant PLANNING_CHAIN_ID = 42_161;
    address internal constant PLANNING_SENDER = 0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF;
    address internal constant PLANNING_SEQUENCER_UPTIME_FEED = 0xFdB631F5EE196F0ed6FAa767959853A9F217697D;

    error PlanningOnly();
    error PlanningChainMismatch(uint256 chainId);

    function plan() external returns (Deployment memory deployment) {
        if (
            vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) || vm.isContext(VmSafe.ForgeContext.ScriptResume)
                || !vm.isContext(VmSafe.ForgeContext.ScriptDryRun)
        ) revert PlanningOnly();
        if (block.chainid != PLANNING_CHAIN_ID) revert PlanningChainMismatch(block.chainid);

        DeploymentConfig memory config = DeploymentConfig({
            bootstrapAdmin: PLANNING_SENDER,
            governanceAdmin: 0xA4b1000000000000000000000000000000000001,
            governanceOperator: 0xA4B1000000000000000000000000000000000002,
            guardian: 0xA4b1000000000000000000000000000000000003,
            excessRecovery: 0xa4B1000000000000000000000000000000000004,
            privacyKeyPublisher: 0xA4b1000000000000000000000000000000000005,
            lifecycleWitnessStager: 0xa4b1000000000000000000000000000000000006,
            defaultAdminDelay: 2 days,
            maxLockDuration: 30 days,
            evaluationGasHardCap: 2_000_000,
            maximumRiskAdapterGas: 500_000,
            maximumRiskObservationAge: 5 minutes,
            operationalReadGas: 500_000,
            operationalExecutionGas: 800_000,
            maximumOrderLifetime: 30 days,
            maximumRfqCapacityTail: 1 days,
            sequencerRecoveryGrace: 1 hours,
            deploymentId: keccak256("SetrynArbitrumOneUnsignedPlanningV1"),
            sequencerFeed: ISequencerUptimeFeed(PLANNING_SEQUENCER_UPTIME_FEED),
            statusGovernance: 0xA4b1000000000000000000000000000000000001,
            retainOperatorStatusRoles: false,
            treasuryController: 0xA4B1000000000000000000000000000000000007
        });

        vm.startBroadcast(PLANNING_SENDER);
        (deployment,) = _deployAndWire(config);
        vm.stopBroadcast();
    }
}
