// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IAdapterRegistry} from "../interfaces/IAdapterRegistry.sol";
import {IPortfolioRiskAdapterV1} from "../interfaces/IPortfolioRiskAdapterV1.sol";
import {IRiskDomainRegistry} from "../interfaces/IRiskDomainRegistry.sol";
import {PortfolioRiskLib} from "../libraries/PortfolioRiskLib.sol";
import {AdapterVersion} from "../types/AdapterDefinition.sol";
import {RiskDomainVersion} from "../types/RiskDomainDefinition.sol";
import {
    PortfolioPositionWitness,
    PortfolioRiskMetrics,
    PortfolioRiskResult,
    RiskEvaluationContext,
    RiskObservation
} from "../types/RiskTypes.sol";

/// @notice Portfolio risk adapter for fully collateralized, bounded-payoff series.
/// @dev Every series a domain using this adapter admits has a payoff whose terminal transfer is bounded per lot by its
/// qualified debit caps, and the position engine reserves exactly that bound as terminal liability. Margin is therefore
/// the bound itself: initial margin equals the account's current plus requested terminal liability, so an account can
/// never owe more than it locked, and no mark, model, or observation can lower it. Maintenance margin is eight tenths
/// of it, as on the devnet adapter this replaces. Headroom is the free collateral above initial margin, further bounded
/// by the risk domain's open interest, account liability, and aggregate liability caps.
///
/// @dev The adapter has no owner and no mutable state. Its registries and the observation age it hashes with are fixed at
/// construction and must be the ones the PortfolioRiskEngine uses, or the engine rejects every result it returns.
/// Replacing it is a new adapter version in the AdapterRegistry and a new risk domain version pinning it.
contract FullyCollateralizedRiskAdapter is IPortfolioRiskAdapterV1 {
    IRiskDomainRegistry public immutable riskDomainRegistry;
    IAdapterRegistry public immutable adapterRegistry;
    /// @dev Must equal the PortfolioRiskEngine's maximum observation age, which salts the observations hash.
    uint64 public immutable maximumObservationAge;

    error InvalidDependency(address dependency);
    error ZeroObservationAge();

    constructor(
        IRiskDomainRegistry riskDomainRegistry_,
        IAdapterRegistry adapterRegistry_,
        uint64 maximumObservationAge_
    ) {
        if (address(riskDomainRegistry_) == address(0) || address(riskDomainRegistry_).code.length == 0) {
            revert InvalidDependency(address(riskDomainRegistry_));
        }
        if (address(adapterRegistry_) == address(0) || address(adapterRegistry_).code.length == 0) {
            revert InvalidDependency(address(adapterRegistry_));
        }
        if (maximumObservationAge_ == 0) revert ZeroObservationAge();
        riskDomainRegistry = riskDomainRegistry_;
        adapterRegistry = adapterRegistry_;
        maximumObservationAge = maximumObservationAge_;
    }

    function evaluatePortfolio(
        RiskEvaluationContext calldata context,
        PortfolioPositionWitness[] calldata positions,
        RiskObservation[] calldata observations
    ) external view returns (PortfolioRiskResult memory result) {
        RiskDomainVersion memory domain = riskDomainRegistry.getRiskDomain(
            context.riskDomainId, context.riskDomainVersion
        );
        AdapterVersion memory adapter =
            adapterRegistry.getAdapter(domain.definition.riskAdapterId, domain.definition.riskAdapterVersion);
        uint128 openInterest = context.currentOpenInterestBaseUnits + context.requestedOpenInterestBaseUnits;
        uint128 accountLiability =
            context.currentAccountTerminalLiabilityBaseUnits + context.requestedAccountTerminalLiabilityBaseUnits;
        uint128 aggregateLiability =
            context.currentAggregateTerminalLiabilityBaseUnits + context.requestedAggregateTerminalLiabilityBaseUnits;
        // Fully collateralized: the bounded terminal liability is the margin.
        uint128 initialMargin = accountLiability;
        uint128 maintenanceMargin = uint128(uint256(initialMargin) * 8 / 10);
        uint128 headroom = context.collateralAvailableBaseUnits > initialMargin
            ? context.collateralAvailableBaseUnits - initialMargin
            : 0;
        headroom = _minimum(headroom, _remaining(domain.definition.maxOpenInterestBaseUnits, openInterest));
        headroom = _minimum(headroom, _remaining(domain.definition.maxAccountLiabilityBaseUnits, accountLiability));
        headroom = _minimum(headroom, _remaining(domain.definition.maxAggregateLiabilityBaseUnits, aggregateLiability));
        result = PortfolioRiskResult({
            configurationHash: keccak256(
                abi.encode(
                    keccak256("SetrynRiskConfigurationV1"),
                    domain.versionHash,
                    adapter.versionHash,
                    domain.definition.riskModelId,
                    domain.definition.marginRulesHash,
                    domain.definition.scenarioSetHash,
                    domain.definition.concentrationRulesHash
                )
            ),
            witnessHash: PortfolioRiskLib.hashPositions(positions),
            observationsHash: PortfolioRiskLib.hashObservations(observations, maximumObservationAge, block.timestamp),
            metrics: PortfolioRiskMetrics({
                initialMarginBaseUnits: initialMargin,
                maintenanceMarginBaseUnits: maintenanceMargin,
                stressLossBaseUnits: accountLiability,
                concentrationBaseUnits: accountLiability,
                openInterestBaseUnits: openInterest,
                accountTerminalLiabilityBaseUnits: accountLiability,
                aggregateTerminalLiabilityBaseUnits: aggregateLiability,
                liquidationDistanceBaseUnits: int256(uint256(context.collateralAvailableBaseUnits))
                    - int256(uint256(maintenanceMargin)),
                availableHeadroomBaseUnits: headroom
            })
        });
    }

    function _minimum(uint128 first, uint128 second) private pure returns (uint128) {
        return first < second ? first : second;
    }

    function _remaining(uint128 limit, uint128 current) private pure returns (uint128) {
        return current >= limit ? 0 : limit - current;
    }
}
