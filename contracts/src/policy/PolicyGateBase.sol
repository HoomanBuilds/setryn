// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IExecutionPolicyRegistry} from "../interfaces/IExecutionPolicyRegistry.sol";
import {IMarketRegistry} from "../interfaces/IMarketRegistry.sol";
import {IPackageRegistry} from "../interfaces/IPackageRegistry.sol";
import {IPackageWitnessRegistry} from "../interfaces/IPackageWitnessRegistry.sol";
import {ISeriesRegistry} from "../interfaces/ISeriesRegistry.sol";
import {ITradingSessionPolicy} from "../interfaces/ITradingSessionPolicy.sol";
import {ExecutionPolicyLib} from "../libraries/ExecutionPolicyLib.sol";
import {OrderTargetKind, PublicOrder} from "../types/OrderTypes.sol";
import {PackageLeg} from "../types/PackageDefinition.sol";

abstract contract PolicyGateBase {
    ISeriesRegistry public immutable seriesRegistry;
    IPackageRegistry public immutable packageRegistry;
    IMarketRegistry public immutable marketRegistry;
    IExecutionPolicyRegistry public immutable policyRegistry;
    ITradingSessionPolicy public immutable sessionPolicy;
    IPackageWitnessRegistry public immutable packageWitnessRegistry;

    error ZeroPolicyDependency(address dependency);

    constructor(
        ISeriesRegistry seriesRegistry_,
        IPackageRegistry packageRegistry_,
        IExecutionPolicyRegistry policyRegistry_,
        ITradingSessionPolicy sessionPolicy_,
        IPackageWitnessRegistry packageWitnessRegistry_
    ) {
        _requireDependency(address(seriesRegistry_));
        _requireDependency(address(packageRegistry_));
        _requireDependency(address(policyRegistry_));
        _requireDependency(address(sessionPolicy_));
        _requireDependency(address(packageWitnessRegistry_));
        IMarketRegistry marketRegistry_ = seriesRegistry_.marketRegistry();
        _requireDependency(address(marketRegistry_));
        if (address(packageRegistry_.seriesRegistry()) != address(seriesRegistry_)) {
            revert ZeroPolicyDependency(address(packageRegistry_));
        }
        seriesRegistry = seriesRegistry_;
        packageRegistry = packageRegistry_;
        marketRegistry = marketRegistry_;
        policyRegistry = policyRegistry_;
        sessionPolicy = sessionPolicy_;
        packageWitnessRegistry = packageWitnessRegistry_;
    }

    function _validateOrder(PublicOrder calldata order)
        internal
        view
        returns (ExecutionPolicyLib.ResolvedTarget memory resolved)
    {
        PackageLeg[] memory legs;
        if (order.targetKind == OrderTargetKind.Package) {
            legs = packageWitnessRegistry.getLegs(order.packageId, order.targetVersion);
        }
        return ExecutionPolicyLib.validateTarget(
            _dependencies(),
            order.targetKind,
            order.seriesId,
            order.packageId,
            order.targetVersion,
            legs,
            order.feeScheduleId,
            order.feeScheduleVersion,
            order.executionModeId,
            order.lots,
            order.priceTicks,
            true
        );
    }

    function _dependencies() internal view returns (ExecutionPolicyLib.Dependencies memory) {
        return ExecutionPolicyLib.Dependencies({
            seriesRegistry: seriesRegistry,
            packageRegistry: packageRegistry,
            marketRegistry: marketRegistry,
            policyRegistry: policyRegistry,
            sessionPolicy: sessionPolicy
        });
    }

    function _requireDependency(address dependency) private view {
        if (dependency == address(0) || dependency.code.length == 0) revert ZeroPolicyDependency(dependency);
    }
}
