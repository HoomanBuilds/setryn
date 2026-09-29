// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IRiskDomainRegistry} from "../interfaces/IRiskDomainRegistry.sol";
import {ISettlementAssetRegistry} from "../interfaces/ISettlementAssetRegistry.sol";

// Shared definitions for CollateralVault and its linked logic libraries.

// The immutable dependency graph of CollateralVault, passed to linked libraries that execute in its context.
struct CollateralVaultDependencies {
    ISettlementAssetRegistry settlementAssetRegistry;
    IRiskDomainRegistry riskDomainRegistry;
    uint64 maxLockDuration;
}

struct PositionEngineQualification {
    bytes32 positionEngineId;
    bytes32 positionEngineCodeHash;
    uint64 settlementDeadline;
    uint64 finalResolutionAt;
}
