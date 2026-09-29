// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Script} from "forge-std/Script.sol";

import {DeployArtifacts} from "./DeployArtifacts.sol";

/// @notice Creates contracts from their standalone full-build artifacts instead of code embedded in the script.
/// @dev Under via-IR, creation code compiled inside a script job can differ from the artifact of the same contract in
/// the full build, and explorer verification recompiles the full-build input. Linking and creating the artifact bytes
/// here makes the deployed bytecode equal to the verified artifact. Linked libraries are created through the
/// deterministic CREATE2 deployer, dependencies first, so their addresses depend only on their own linked init code.
abstract contract ArtifactDeployer is Script {
    address internal constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    bytes32 internal constant LIBRARY_SALT = bytes32(0);
    uint256 private constant NOT_FOUND = type(uint256).max;

    string[] private _linkPlaceholders;
    string[] private _linkAddresses;
    bool private _librariesLinked;

    error ArtifactNotLinked(string artifact);
    error ArtifactCreationFailed(string artifact);
    error LibraryDeploymentFailed(string artifact, address expected);

    /// @notice Creates `contractName` from its standalone artifact with ABI-encoded constructor arguments.
    function _create(string memory contractName, bytes memory constructorArguments)
        internal
        returns (address payable deployed)
    {
        _deployArtifactLibraries();
        uint256 scratch = _memoryCheckpoint();
        string memory artifact = DeployArtifacts.artifactOf(contractName);
        bytes memory initCode = bytes.concat(_linkedCode(artifact), constructorArguments);
        assembly ("memory-safe") {
            deployed := create(0, add(initCode, 0x20), mload(initCode))
        }
        if (deployed == address(0) || deployed.code.length == 0) revert ArtifactCreationFailed(artifact);
        _releaseMemory(scratch);
    }

    /// @notice Deploys every linked library once, dependencies first; existing CREATE2 deployments are reused.
    /// @dev A CREATE2 address commits to the hash of its init code, so code already at the expected address was
    /// created from exactly this linked library artifact.
    function _deployArtifactLibraries() internal {
        if (_librariesLinked) return;
        _librariesLinked = true;
        DeployArtifacts.LinkedLibrary[] memory libraries = DeployArtifacts.linkedLibraries();
        for (uint256 index; index < libraries.length; ++index) {
            uint256 scratch = _memoryCheckpoint();
            bytes memory initCode = _linkedCode(libraries[index].artifact);
            address expected = vm.computeCreate2Address(LIBRARY_SALT, keccak256(initCode), CREATE2_DEPLOYER);
            if (expected.code.length == 0) {
                (bool success,) = CREATE2_DEPLOYER.call(abi.encodePacked(LIBRARY_SALT, initCode));
                if (!success || expected.code.length == 0) {
                    revert LibraryDeploymentFailed(libraries[index].artifact, expected);
                }
            }
            _linkPlaceholders.push(_placeholder(libraries[index].qualifiedName));
            _linkAddresses.push(_hex(abi.encodePacked(expected)));
            _releaseMemory(scratch);
        }
    }

    /// @notice Creation code of a standalone artifact with every known library placeholder replaced.
    function _linkedCode(string memory artifact) internal view returns (bytes memory) {
        string memory code = vm.parseJsonString(vm.readFile(_artifactPath(artifact)), ".bytecode.object");
        for (uint256 index; index < _linkPlaceholders.length; ++index) {
            string memory placeholder = _linkPlaceholders[index];
            if (vm.indexOf(code, placeholder) != NOT_FOUND) {
                code = vm.replace(code, placeholder, _linkAddresses[index]);
            }
        }
        if (vm.indexOf(code, "__$") != NOT_FOUND) revert ArtifactNotLinked(artifact);
        return vm.parseBytes(code);
    }

    /// @dev Artifact JSON and linked code are large and EVM memory never shrinks within a call, so each creation
    /// works in scratch memory that is released afterwards. Only stack values and storage outlive the scratch region.
    function _memoryCheckpoint() private pure returns (uint256 pointer) {
        assembly ("memory-safe") {
            pointer := mload(0x40)
        }
    }

    function _releaseMemory(uint256 pointer) private pure {
        assembly ("memory-safe") {
            mstore(0x40, pointer)
        }
    }

    function _artifactPath(string memory artifact) private view returns (string memory) {
        string[] memory parts = vm.split(artifact, ":");
        return string.concat(vm.projectRoot(), "/out/", parts[0], "/", parts[1], ".json");
    }

    /// @dev Solidity's link placeholder: `__$` + the first 17 bytes of keccak256(qualified name) in hex + `$__`.
    function _placeholder(string memory qualifiedName) private pure returns (string memory) {
        bytes32 digest = keccak256(bytes(qualifiedName));
        bytes memory prefix = new bytes(17);
        for (uint256 index; index < 17; ++index) {
            prefix[index] = digest[index];
        }
        return string.concat("__$", _hex(prefix), "$__");
    }

    function _hex(bytes memory data) private pure returns (string memory) {
        bytes16 digits = "0123456789abcdef";
        bytes memory text = new bytes(data.length * 2);
        for (uint256 index; index < data.length; ++index) {
            text[index * 2] = digits[uint8(data[index]) >> 4];
            text[index * 2 + 1] = digits[uint8(data[index]) & 0x0f];
        }
        return string(text);
    }
}
