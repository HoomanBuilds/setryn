// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {DeployArtifacts} from "../../../script/DeployArtifacts.sol";
import {DeploySetryn} from "../../../script/DeploySetryn.s.sol";

/// @notice Runs the production DeploySetryn wiring inside a forge test. It differs from a broadcast deployment in one
/// place only: each contract's creation code comes from the compiler's own linked artifacts (vm.getCode) rather than
/// from out/ plus CREATE2 libraries, so the test builds against whatever FOUNDRY_OUT the run uses. The harness is the
/// bootstrap admin: the config it is given must name `address(this)` as `bootstrapAdmin`.
contract SetrynDeploymentHarness is DeploySetryn {
    function deploy(DeploymentConfig memory config) external returns (Deployment memory deployment) {
        (deployment,) = _deployAndWire(config);
    }

    function _create(string memory contractName, bytes memory constructorArguments)
        internal
        override
        returns (address payable deployed)
    {
        string memory artifact = DeployArtifacts.artifactOf(contractName);
        bytes memory initCode = bytes.concat(vm.getCode(artifact), constructorArguments);
        assembly ("memory-safe") {
            deployed := create(0, add(initCode, 0x20), mload(initCode))
        }
        if (deployed == address(0) || deployed.code.length == 0) revert ArtifactCreationFailed(artifact);
    }
}
