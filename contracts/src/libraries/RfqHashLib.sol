// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Eip712Lib} from "./Eip712Lib.sol";
import {PackageDefinitionLib} from "./PackageDefinitionLib.sol";
import {AccountId, AssetId, FeeScheduleId, PackageId, RiskDomainId, SeriesId} from "../types/Identifiers.sol";
import {PackageLeg} from "../types/PackageDefinition.sol";
import {RemainderPolicy} from "../types/OrderTypes.sol";
import {
    CapacityCancelAuthorization,
    MakerQuote,
    MakerQuoteId,
    PrivateRfqRequest,
    RfqId,
    RfqSelectionAuthorization,
    RfqSidePolicy,
    RfqTargetKind
} from "../types/RfqTypes.sol";
import {Lots, PriceTicks} from "../types/Units.sol";

library RfqHashLib {
    bytes32 internal constant REQUEST_TYPEHASH = keccak256(
        "PrivateRfqRequest(address taker,bytes32 takerAccountId,uint8 targetKind,bytes32 seriesId,bytes32 packageId,uint32 targetVersion,bool hasPackageLegCommitment,bytes32 packageLegsHash,uint8 sidePolicy,uint128 lots,bool allowPartialFills,uint128 minimumFillLots,uint8 remainderPolicy,bytes32 feeScheduleId,uint32 feeScheduleVersion,uint128 maxFeeMinor,bytes32 riskDomainId,uint32 riskDomainVersion,bytes32 privacyModeId,bytes32 executionModeId,bytes32 disclosurePolicyHash,bytes32 eligibleMakerSetHash,uint64 deadline,address permittedExecutor,uint256 nonce,bytes32 salt)"
    );
    bytes32 internal constant QUOTE_TYPEHASH = keccak256(
        "MakerQuote(bytes32 rfqId,address maker,bytes32 makerAccountId,bytes32 takerAccountId,uint8 targetKind,bytes32 seriesId,bytes32 packageId,uint32 targetVersion,bool hasPackageLegCommitment,bytes32 packageLegsHash,uint8 sidePolicy,uint128 lots,bool allowPartialFills,uint128 minimumFillLots,uint8 remainderPolicy,int128 bidPriceTicks,int128 askPriceTicks,bytes32 feeScheduleId,uint32 feeScheduleVersion,uint128 maxFeeMinor,bytes32 riskDomainId,uint32 riskDomainVersion,bytes32 collateralAssetId,uint32 collateralBindingVersion,uint128 maximumLiability,bytes32 privacyModeId,bytes32 executionModeId,bytes32 disclosurePolicyHash,bytes32 eligibleMakerSetHash,uint64 deadline,uint64 capacityExpiry,address permittedExecutor,uint256 nonce,bytes32 salt)"
    );
    bytes32 internal constant SELECTION_TYPEHASH = keccak256(
        "RfqSelectionAuthorization(bytes32 rfqId,bytes32 quoteId,address taker,address executor,uint256 nonce,uint64 deadline,bytes32 salt)"
    );
    bytes32 internal constant CAPACITY_CANCEL_TYPEHASH = keccak256(
        "CapacityCancelAuthorization(bytes32 quoteId,address maker,uint256 nonce,uint64 deadline,bytes32 salt)"
    );

    error InvalidRfqTarget();
    error InvalidRfqSidePolicy();
    error InvalidPackageLegCommitment();
    error ZeroRfqField();
    error InvalidRfqDeadline(uint64 deadline, uint256 currentTimestamp);
    error InvalidPartialFillPolicy();
    error InvalidQuotePricePolicy();
    error InvalidCapacityExpiry();

    function hashRequest(PrivateRfqRequest memory request) internal pure returns (bytes32) {
        return keccak256(
            bytes.concat(
                abi.encode(
                    REQUEST_TYPEHASH,
                    request.taker,
                    AccountId.unwrap(request.takerAccountId),
                    request.targetKind,
                    SeriesId.unwrap(request.seriesId),
                    PackageId.unwrap(request.packageId),
                    request.targetVersion,
                    request.hasPackageLegCommitment,
                    request.packageLegsHash,
                    request.sidePolicy,
                    Lots.unwrap(request.lots),
                    request.allowPartialFills,
                    Lots.unwrap(request.minimumFillLots),
                    request.remainderPolicy
                ),
                abi.encode(
                    FeeScheduleId.unwrap(request.feeScheduleId),
                    request.feeScheduleVersion,
                    request.maxFeeMinor,
                    RiskDomainId.unwrap(request.riskDomainId),
                    request.riskDomainVersion,
                    request.privacyModeId,
                    request.executionModeId,
                    request.disclosurePolicyHash,
                    request.eligibleMakerSetHash,
                    request.deadline,
                    request.permittedExecutor,
                    request.nonce,
                    request.salt
                )
            )
        );
    }

    function hashQuote(MakerQuote memory quote) internal pure returns (bytes32) {
        return keccak256(
            bytes.concat(
                abi.encode(
                    QUOTE_TYPEHASH,
                    RfqId.unwrap(quote.rfqId),
                    quote.maker,
                    AccountId.unwrap(quote.makerAccountId),
                    AccountId.unwrap(quote.takerAccountId),
                    quote.targetKind,
                    SeriesId.unwrap(quote.seriesId),
                    PackageId.unwrap(quote.packageId),
                    quote.targetVersion,
                    quote.hasPackageLegCommitment,
                    quote.packageLegsHash,
                    quote.sidePolicy,
                    Lots.unwrap(quote.lots),
                    quote.allowPartialFills,
                    Lots.unwrap(quote.minimumFillLots),
                    quote.remainderPolicy,
                    PriceTicks.unwrap(quote.bidPriceTicks),
                    PriceTicks.unwrap(quote.askPriceTicks)
                ),
                abi.encode(
                    FeeScheduleId.unwrap(quote.feeScheduleId),
                    quote.feeScheduleVersion,
                    quote.maxFeeMinor,
                    RiskDomainId.unwrap(quote.riskDomainId),
                    quote.riskDomainVersion,
                    AssetId.unwrap(quote.collateralAssetId),
                    quote.collateralBindingVersion,
                    quote.maximumLiability,
                    quote.privacyModeId,
                    quote.executionModeId,
                    quote.disclosurePolicyHash,
                    quote.eligibleMakerSetHash,
                    quote.deadline,
                    quote.capacityExpiry,
                    quote.permittedExecutor,
                    quote.nonce,
                    quote.salt
                )
            )
        );
    }

    function hashSelection(RfqSelectionAuthorization memory selection) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                SELECTION_TYPEHASH,
                RfqId.unwrap(selection.rfqId),
                MakerQuoteId.unwrap(selection.quoteId),
                selection.taker,
                selection.executor,
                selection.nonce,
                selection.deadline,
                selection.salt
            )
        );
    }

    function hashCapacityCancel(CapacityCancelAuthorization memory cancellation) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                CAPACITY_CANCEL_TYPEHASH,
                MakerQuoteId.unwrap(cancellation.quoteId),
                cancellation.maker,
                cancellation.nonce,
                cancellation.deadline,
                cancellation.salt
            )
        );
    }

    function requestDigest(PrivateRfqRequest memory request, uint256 chainId, address verifyingContract)
        internal
        pure
        returns (bytes32)
    {
        return Eip712Lib.toTypedDataDigest(Eip712Lib.domainSeparator(chainId, verifyingContract), hashRequest(request));
    }

    function quoteDigest(MakerQuote memory quote, uint256 chainId, address verifyingContract)
        internal
        pure
        returns (bytes32)
    {
        return Eip712Lib.toTypedDataDigest(Eip712Lib.domainSeparator(chainId, verifyingContract), hashQuote(quote));
    }

    function selectionDigest(RfqSelectionAuthorization memory selection, uint256 chainId, address verifyingContract)
        internal
        pure
        returns (bytes32)
    {
        return
            Eip712Lib.toTypedDataDigest(Eip712Lib.domainSeparator(chainId, verifyingContract), hashSelection(selection));
    }

    function capacityCancelDigest(
        CapacityCancelAuthorization memory cancellation,
        uint256 chainId,
        address verifyingContract
    ) internal pure returns (bytes32) {
        return Eip712Lib.toTypedDataDigest(
            Eip712Lib.domainSeparator(chainId, verifyingContract), hashCapacityCancel(cancellation)
        );
    }

    function validateRequest(
        PrivateRfqRequest memory request,
        PackageLeg[] memory packageLegs,
        uint256 currentTimestamp
    ) internal pure {
        if (
            request.taker == address(0) || AccountId.unwrap(request.takerAccountId) == bytes32(0)
                || request.targetVersion == 0 || Lots.unwrap(request.lots) == 0
                || FeeScheduleId.unwrap(request.feeScheduleId) == bytes32(0) || request.feeScheduleVersion == 0
                || RiskDomainId.unwrap(request.riskDomainId) == bytes32(0) || request.riskDomainVersion == 0
                || request.privacyModeId == bytes32(0) || request.executionModeId == bytes32(0)
                || request.disclosurePolicyHash == bytes32(0) || request.eligibleMakerSetHash == bytes32(0)
                || request.salt == bytes32(0)
        ) revert ZeroRfqField();
        _validateTarget(
            request.targetKind,
            request.seriesId,
            request.packageId,
            request.hasPackageLegCommitment,
            request.packageLegsHash,
            packageLegs
        );
        _validateSidePolicy(request.sidePolicy);
        _validateFillPolicy(request.lots, request.allowPartialFills, request.minimumFillLots, request.remainderPolicy);
        if (request.deadline < currentTimestamp) revert InvalidRfqDeadline(request.deadline, currentTimestamp);
    }

    function validateQuote(MakerQuote memory quote, uint256 currentTimestamp) internal pure {
        if (
            RfqId.unwrap(quote.rfqId) == bytes32(0) || quote.maker == address(0)
                || AccountId.unwrap(quote.makerAccountId) == bytes32(0)
                || AccountId.unwrap(quote.takerAccountId) == bytes32(0) || quote.targetVersion == 0
                || Lots.unwrap(quote.lots) == 0 || FeeScheduleId.unwrap(quote.feeScheduleId) == bytes32(0)
                || quote.feeScheduleVersion == 0 || RiskDomainId.unwrap(quote.riskDomainId) == bytes32(0)
                || quote.riskDomainVersion == 0 || AssetId.unwrap(quote.collateralAssetId) == bytes32(0)
                || quote.collateralBindingVersion == 0 || quote.maximumLiability == 0
                || quote.privacyModeId == bytes32(0) || quote.executionModeId == bytes32(0)
                || quote.disclosurePolicyHash == bytes32(0) || quote.eligibleMakerSetHash == bytes32(0)
                || quote.salt == bytes32(0)
        ) revert ZeroRfqField();
        _validateTargetCommitment(
            quote.targetKind, quote.seriesId, quote.packageId, quote.hasPackageLegCommitment, quote.packageLegsHash
        );
        _validateSidePolicy(quote.sidePolicy);
        _validateFillPolicy(quote.lots, quote.allowPartialFills, quote.minimumFillLots, quote.remainderPolicy);
        if (quote.deadline < currentTimestamp) revert InvalidRfqDeadline(quote.deadline, currentTimestamp);
        if (quote.capacityExpiry <= quote.deadline) revert InvalidCapacityExpiry();
        if (quote.sidePolicy == RfqSidePolicy.BuyOnly && PriceTicks.unwrap(quote.bidPriceTicks) != 0) {
            revert InvalidQuotePricePolicy();
        }
        if (quote.sidePolicy == RfqSidePolicy.SellOnly && PriceTicks.unwrap(quote.askPriceTicks) != 0) {
            revert InvalidQuotePricePolicy();
        }
        if (
            quote.sidePolicy == RfqSidePolicy.TwoWay
                && PriceTicks.unwrap(quote.bidPriceTicks) > PriceTicks.unwrap(quote.askPriceTicks)
        ) revert InvalidQuotePricePolicy();
    }

    function _validateTarget(
        RfqTargetKind targetKind,
        SeriesId seriesId,
        PackageId packageId,
        bool hasLegCommitment,
        bytes32 packageLegsHash,
        PackageLeg[] memory packageLegs
    ) private pure {
        _validateTargetCommitment(targetKind, seriesId, packageId, hasLegCommitment, packageLegsHash);
        if (hasLegCommitment) {
            if (PackageDefinitionLib.hashLegs(packageLegs) != packageLegsHash) revert InvalidPackageLegCommitment();
        } else if (packageLegs.length != 0) {
            revert InvalidPackageLegCommitment();
        }
    }

    function _validateTargetCommitment(
        RfqTargetKind targetKind,
        SeriesId seriesId,
        PackageId packageId,
        bool hasLegCommitment,
        bytes32 packageLegsHash
    ) private pure {
        bool hasSeries = SeriesId.unwrap(seriesId) != bytes32(0);
        bool hasPackage = PackageId.unwrap(packageId) != bytes32(0);
        if (targetKind == RfqTargetKind.Series) {
            if (!hasSeries || hasPackage || hasLegCommitment || packageLegsHash != bytes32(0)) {
                revert InvalidRfqTarget();
            }
        } else if (targetKind == RfqTargetKind.Package) {
            if (!hasPackage || hasSeries) revert InvalidRfqTarget();
            if (hasLegCommitment != (packageLegsHash != bytes32(0))) revert InvalidPackageLegCommitment();
        } else {
            revert InvalidRfqTarget();
        }
    }

    function _validateSidePolicy(RfqSidePolicy sidePolicy) private pure {
        if (
            sidePolicy != RfqSidePolicy.BuyOnly && sidePolicy != RfqSidePolicy.SellOnly
                && sidePolicy != RfqSidePolicy.TwoWay
        ) revert InvalidRfqSidePolicy();
    }

    function _validateFillPolicy(
        Lots lots,
        bool allowPartialFills,
        Lots minimumFillLots,
        RemainderPolicy remainderPolicy
    ) private pure {
        uint128 total = Lots.unwrap(lots);
        uint128 minimum = Lots.unwrap(minimumFillLots);
        if (minimum == 0 || minimum > total || remainderPolicy == RemainderPolicy.Unspecified) {
            revert InvalidPartialFillPolicy();
        }
        if (!allowPartialFills && (minimum != total || remainderPolicy != RemainderPolicy.KeepOpen)) {
            revert InvalidPartialFillPolicy();
        }
    }
}
