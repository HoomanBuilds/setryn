// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IAdapterRegistry} from "../interfaces/IAdapterRegistry.sol";
import {IAuctionValidationGate} from "../interfaces/IAuctionValidationGate.sol";
import {IExecutionPolicyRegistry} from "../interfaces/IExecutionPolicyRegistry.sol";
import {IPackageRegistry} from "../interfaces/IPackageRegistry.sol";
import {IPackageWitnessRegistry} from "../interfaces/IPackageWitnessRegistry.sol";
import {ISeriesRegistry} from "../interfaces/ISeriesRegistry.sol";
import {ITradingSessionPolicy} from "../interfaces/ITradingSessionPolicy.sol";
import {ExecutionPolicyLib} from "../libraries/ExecutionPolicyLib.sol";
import {PolicyGateBase} from "./PolicyGateBase.sol";
import {AdapterVersion} from "../types/AdapterDefinition.sol";
import {AssetId, RiskDomainId} from "../types/Identifiers.sol";
import {
    AuctionDefinition,
    AuctionTargetKind,
    BidCommitAuthorization,
    SealedBid,
    SolverAction,
    SolverRoute
} from "../types/AuctionTypes.sol";
import {OrderTargetKind} from "../types/OrderTypes.sol";
import {PackageLeg} from "../types/PackageDefinition.sol";
import {Lots, PriceTicks} from "../types/Units.sol";

contract AuctionValidationGate is IAuctionValidationGate, PolicyGateBase {
    bytes32 public constant CAPACITY_POLICY = keccak256("SETRYN_POLICY_AUCTION_CAPACITY");
    bytes32 public constant BOND_POLICY = keccak256("SETRYN_POLICY_AUCTION_BOND");
    bytes32 public constant ALLOCATION_POLICY = keccak256("SETRYN_POLICY_AUCTION_ALLOCATION");
    bytes32 public constant GUARANTEE_POLICY = keccak256("SETRYN_POLICY_SETTLEMENT_GUARANTEE");

    error InvalidAuctionPolicy();

    constructor(
        ISeriesRegistry seriesRegistry_,
        IPackageRegistry packageRegistry_,
        IExecutionPolicyRegistry policyRegistry_,
        ITradingSessionPolicy sessionPolicy_,
        IPackageWitnessRegistry packageWitnessRegistry_
    ) PolicyGateBase(seriesRegistry_, packageRegistry_, policyRegistry_, sessionPolicy_, packageWitnessRegistry_) {}

    function validateDefinition(AuctionDefinition calldata definition, PackageLeg[] calldata packageLegs)
        external
        view
    {
        if (
            block.timestamp > definition.commitClosesAt
                || !policyRegistry.policyTagAllowed(CAPACITY_POLICY, definition.capacityPolicyHash)
                || !policyRegistry.policyTagAllowed(BOND_POLICY, definition.bondPolicyHash)
                || !policyRegistry.policyTagAllowed(ALLOCATION_POLICY, definition.allocationPolicyHash)
                || !policyRegistry.policyTagAllowed(GUARANTEE_POLICY, definition.guaranteeClassId)
                || !marketRegistry.settlementAssetRegistry()
                    .isOpenForNewRisk(definition.bondAssetId, definition.bondBindingVersion)
        ) revert InvalidAuctionPolicy();
        ExecutionPolicyLib.ResolvedTarget memory resolved =
            _validateTarget(definition, packageLegs, definition.totalLots, PriceTicks.wrap(0), false);
        if (
            AssetId.unwrap(resolved.settlementAssetId) != AssetId.unwrap(definition.settlementAssetId)
                || resolved.settlementAssetVersion != definition.settlementAssetVersion
                || RiskDomainId.unwrap(resolved.riskDomainId) != RiskDomainId.unwrap(definition.riskDomainId)
                || resolved.riskDomainVersion != definition.riskDomainVersion
        ) revert InvalidAuctionPolicy();
    }

    function validateCommit(
        AuctionDefinition calldata definition,
        BidCommitAuthorization calldata authorization,
        bytes32[] calldata eligibilityProof
    ) external view {
        if (
            block.timestamp < definition.commitOpensAt || block.timestamp >= definition.commitClosesAt
                || authorization.deadline > definition.commitClosesAt || block.timestamp > authorization.deadline
                || !policyRegistry.eligible(definition.eligibilityPolicyHash, authorization.bidder, eligibilityProof)
        ) revert InvalidAuctionPolicy();
    }

    function validateBid(AuctionDefinition calldata definition, SealedBid calldata bid) external view {
        if (
            block.timestamp < definition.commitClosesAt || block.timestamp >= definition.revealClosesAt
                || bid.maximumFeeMinor > definition.initiatorMaximumFeeMinor
        ) revert InvalidAuctionPolicy();
        PackageLeg[] memory legs = _legs(definition);
        _validateTarget(definition, legs, bid.lots, bid.priceTicks, true);
    }

    function validateRoute(
        AuctionDefinition calldata definition,
        SolverRoute calldata route,
        PackageLeg[] calldata routeLegs,
        SolverAction[] calldata actions
    ) external view {
        if (
            block.timestamp >= definition.revealClosesAt || route.maximumFeeMinor > definition.initiatorMaximumFeeMinor
                || route.expiry <= definition.settlementDeadline || route.capacityAmount == 0
                || packageRegistry.hashLegs(routeLegs) != route.packageLegsHash
        ) revert InvalidAuctionPolicy();
        _validateTarget(definition, routeLegs, definition.totalLots, route.packageOutcomeTicks, true);
        IAdapterRegistry adapters = marketRegistry.riskDomainRegistry().adapterRegistry();
        for (uint256 i; i < actions.length; ++i) {
            SolverAction calldata action = actions[i];
            if (!adapters.isOpenForNewRisk(action.adapterId, action.adapterVersion)) {
                revert InvalidAuctionPolicy();
            }
            AdapterVersion memory adapter = adapters.getAdapter(action.adapterId, action.adapterVersion);
            if (adapter.definition.capabilityHash != action.adapterCapabilityHash) {
                revert InvalidAuctionPolicy();
            }
        }
    }

    function _validateTarget(
        AuctionDefinition calldata definition,
        PackageLeg[] memory legs,
        Lots lots,
        PriceTicks price,
        bool validatePrice
    ) private view returns (ExecutionPolicyLib.ResolvedTarget memory) {
        return ExecutionPolicyLib.validateTarget(
            _dependencies(),
            _targetKind(definition.targetKind),
            definition.seriesId,
            definition.packageId,
            definition.targetVersion,
            legs,
            definition.feeScheduleId,
            definition.feeScheduleVersion,
            definition.executionModeId,
            lots,
            price,
            validatePrice
        );
    }

    function _legs(AuctionDefinition calldata definition) private view returns (PackageLeg[] memory legs) {
        if (definition.targetKind == AuctionTargetKind.Package) {
            legs = packageWitnessRegistry.getLegs(definition.packageId, definition.targetVersion);
            if (packageRegistry.hashLegs(legs) != definition.packageLegsHash) revert InvalidAuctionPolicy();
        }
    }

    function _targetKind(AuctionTargetKind kind) private pure returns (OrderTargetKind) {
        if (kind == AuctionTargetKind.Series) return OrderTargetKind.Series;
        if (kind == AuctionTargetKind.Package) return OrderTargetKind.Package;
        revert InvalidAuctionPolicy();
    }
}
