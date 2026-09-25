// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {PackageId} from "../types/Identifiers.sol";
import {PackageLeg} from "../types/PackageDefinition.sol";

interface IPackageWitnessRegistry {
    function publishWitness(PackageId packageId, uint32 packageVersion, PackageLeg[] calldata legs) external;
    function witnessHash(PackageId packageId, uint32 packageVersion) external view returns (bytes32);
    function getLegs(PackageId packageId, uint32 packageVersion) external view returns (PackageLeg[] memory legs);
}
