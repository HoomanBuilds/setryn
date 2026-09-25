// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IPackageRegistry} from "../interfaces/IPackageRegistry.sol";
import {IPackageWitnessRegistry} from "../interfaces/IPackageWitnessRegistry.sol";
import {PackageId} from "../types/Identifiers.sol";
import {PackageLeg, PackageVersion} from "../types/PackageDefinition.sol";

contract PackageWitnessRegistry is IPackageWitnessRegistry {
    uint256 public constant MAXIMUM_PACKAGE_LEGS = 16;

    IPackageRegistry public immutable packageRegistry;
    mapping(PackageId packageId => mapping(uint32 version => PackageLeg[] legs)) private _legs;
    mapping(PackageId packageId => mapping(uint32 version => bytes32 hash)) private _hashes;

    error ZeroDependency();
    error InvalidPackageWitness();
    error DuplicatePackageWitness();

    event PackageWitnessPublished(
        PackageId indexed packageId, uint32 indexed packageVersion, bytes32 indexed legsHash, PackageLeg[] legs
    );

    constructor(IPackageRegistry packageRegistry_) {
        if (address(packageRegistry_) == address(0) || address(packageRegistry_).code.length == 0) {
            revert ZeroDependency();
        }
        packageRegistry = packageRegistry_;
    }

    function publishWitness(PackageId packageId, uint32 packageVersion, PackageLeg[] calldata legs) external {
        if (_hashes[packageId][packageVersion] != bytes32(0)) revert DuplicatePackageWitness();
        if (legs.length == 0 || legs.length > MAXIMUM_PACKAGE_LEGS) revert InvalidPackageWitness();
        PackageVersion memory package = packageRegistry.getPackage(packageId, packageVersion);
        bytes32 legsHash = packageRegistry.hashLegs(legs);
        if (legsHash != package.definition.legsHash) revert InvalidPackageWitness();
        _hashes[packageId][packageVersion] = legsHash;
        for (uint256 i; i < legs.length; ++i) {
            _legs[packageId][packageVersion].push(legs[i]);
        }
        emit PackageWitnessPublished(packageId, packageVersion, legsHash, legs);
    }

    function witnessHash(PackageId packageId, uint32 packageVersion) external view returns (bytes32) {
        return _hashes[packageId][packageVersion];
    }

    function getLegs(PackageId packageId, uint32 packageVersion) external view returns (PackageLeg[] memory legs) {
        legs = _legs[packageId][packageVersion];
        if (legs.length == 0) revert InvalidPackageWitness();
    }
}
