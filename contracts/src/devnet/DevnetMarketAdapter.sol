// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IAdapterRegistry} from "../interfaces/IAdapterRegistry.sol";
import {IFixingObservationAdapterV1} from "../interfaces/IFixingObservationAdapterV1.sol";
import {IPortfolioRiskAdapterV1} from "../interfaces/IPortfolioRiskAdapterV1.sol";
import {IRiskDomainRegistry} from "../interfaces/IRiskDomainRegistry.sol";
import {PortfolioRiskLib} from "../libraries/PortfolioRiskLib.sol";
import {AdapterVersion} from "../types/AdapterDefinition.sol";
import {ObservationBatchValidation, ObservationValidationContext} from "../types/FixingTypes.sol";
import {EvidenceOriginId, RiskDomainId} from "../types/Identifiers.sol";
import {RiskDomainVersion} from "../types/RiskDomainDefinition.sol";
import {
    PortfolioPositionWitness,
    PortfolioRiskMetrics,
    PortfolioRiskResult,
    RiskEvaluationContext,
    RiskObservation
} from "../types/RiskTypes.sol";

contract DevnetMarketAdapter is IPortfolioRiskAdapterV1, IFixingObservationAdapterV1 {
    uint256 private constant ARBITRUM_ONE_CHAIN_ID = 42161;
    uint256 private constant ARBITRUM_SEPOLIA_CHAIN_ID = 421614;

    IRiskDomainRegistry public immutable riskDomainRegistry;
    IAdapterRegistry public immutable adapterRegistry;
    uint64 public immutable maximumObservationAge;

    error PublicNetworkDeploymentDisabled(uint256 chainId);
    error InvalidDependency();

    constructor(
        IRiskDomainRegistry riskDomainRegistry_,
        IAdapterRegistry adapterRegistry_,
        uint64 maximumObservationAge_
    ) {
        if (block.chainid == ARBITRUM_ONE_CHAIN_ID || block.chainid == ARBITRUM_SEPOLIA_CHAIN_ID) {
            revert PublicNetworkDeploymentDisabled(block.chainid);
        }
        if (
            address(riskDomainRegistry_) == address(0) || address(riskDomainRegistry_).code.length == 0
                || address(adapterRegistry_) == address(0) || address(adapterRegistry_).code.length == 0
                || maximumObservationAge_ == 0
        ) revert InvalidDependency();
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

    function validateObservationBatch(ObservationValidationContext calldata context, bytes calldata evidence)
        external
        pure
        returns (ObservationBatchValidation memory validation)
    {
        validation = ObservationBatchValidation({
            observationsHash: context.observationsHash,
            // Devnet observations stand in for a signed external feed, one of the origins the fixing engine accepts.
            evidenceOriginId: EvidenceOriginId.wrap(keccak256("SetrynEvidenceOriginV1:EXTERNAL_SIGNED")),
            feedKey: context.feedKey,
            capabilityHash: context.requiredCapabilityHash,
            completenessHash: keccak256(abi.encode(context.selectionParametersHash, evidence)),
            evidenceHash: keccak256(evidence),
            batchSequence: 1,
            complete: true,
            outageIndependent: false
        });
    }

    function _minimum(uint128 first, uint128 second) private pure returns (uint128) {
        return first < second ? first : second;
    }

    function _remaining(uint128 limit, uint128 current) private pure returns (uint128) {
        return current >= limit ? 0 : limit - current;
    }
}
