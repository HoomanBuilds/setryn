// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IAdapterRegistry} from "../interfaces/IAdapterRegistry.sol";
import {ICollateralVault} from "../interfaces/ICollateralVault.sol";
import {IPositionEngine} from "../interfaces/IPositionEngine.sol";
import {IRiskDomainRegistry} from "../interfaces/IRiskDomainRegistry.sol";
import {AccountId, RiskDomainId} from "../types/Identifiers.sol";
import {RiskAdmissionId} from "../types/RiskTypes.sol";

// Shared definitions for PortfolioRiskEngine and its linked logic libraries.

// The immutable dependency graph of PortfolioRiskEngine, passed to linked libraries that execute in its context.
struct PortfolioRiskDependencies {
    IRiskDomainRegistry riskDomainRegistry;
    IAdapterRegistry adapterRegistry;
    ICollateralVault collateralVault;
    IPositionEngine positionEngine;
    uint64 maximumAdapterGas;
    uint64 maximumObservationAge;
}

struct PendingRiskExposure {
    RiskAdmissionId admissionId;
    AccountId accountId;
    RiskDomainId riskDomainId;
    uint32 riskDomainVersion;
    uint128 openInterestBaseUnits;
    uint16 expectedPositionCount;
    bool bound;
}
