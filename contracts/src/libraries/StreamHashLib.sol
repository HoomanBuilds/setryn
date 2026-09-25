// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Eip712Lib} from "./Eip712Lib.sol";
import {Side} from "../types/Enums.sol";
import {AccountId, FeeScheduleId, PackageId, RiskDomainId, SeriesId} from "../types/Identifiers.sol";
import {StreamId, StreamLadderLevel, StreamPolicy, StreamPricingKind, StreamSizeBand} from "../types/StreamTypes.sol";
import {Lots, PriceTicks} from "../types/Units.sol";
import {OrderTargetKind} from "../types/OrderTypes.sol";

library StreamHashLib {
    uint8 internal constant MAXIMUM_SIZE_BANDS = 8;
    uint8 internal constant MAXIMUM_LADDER_LEVELS = 8;
    bytes32 internal constant POLICY_TYPEHASH = keccak256(
        "StreamPolicy(address maker,bytes32 makerAccountId,bytes32 makerOrderHash,uint8 targetKind,bytes32 seriesId,bytes32 packageId,uint32 targetVersion,bytes32 packageWitnessHash,uint8 makerSide,uint8 pricingKind,bytes32 sizeBandsHash,bytes32 ladderHash,int128 baseBidPriceTicks,int128 baseAskPriceTicks,int128 sizeSlopeTicksPerLot,int128 inventorySkewTicksPerLot,uint128 maximumAbsoluteInventoryLots,uint128 maximumAbsoluteSkewTicks,uint32 refreshInterval,uint32 quoteLifetime,uint64 validAfter,uint64 expiry,bytes32 feeScheduleId,uint32 feeScheduleVersion,bytes32 riskDomainId,uint32 riskDomainVersion,bytes32 executionModeId,address permittedExecutor,bytes32 capacityPolicyHash,bytes32 capacityReservationId,uint256 nonce,bytes32 salt)"
    );
    bytes32 internal constant SIZE_BAND_TYPEHASH =
        keccak256("StreamSizeBand(uint128 minimumLots,uint128 maximumLots,uint128 lotStep)");
    bytes32 internal constant LADDER_LEVEL_TYPEHASH =
        keccak256("StreamLadderLevel(uint128 maximumLots,int128 bidPriceTicks,int128 askPriceTicks)");

    error InvalidStreamPolicy();
    error InvalidStreamTarget();
    error InvalidStreamWindow();
    error InvalidSizeBands();
    error InvalidLadder();

    function hashPolicy(StreamPolicy memory policy) internal pure returns (bytes32) {
        return keccak256(
            bytes.concat(
                abi.encode(
                    POLICY_TYPEHASH,
                    policy.maker,
                    AccountId.unwrap(policy.makerAccountId),
                    policy.makerOrderHash,
                    policy.targetKind,
                    SeriesId.unwrap(policy.seriesId),
                    PackageId.unwrap(policy.packageId),
                    policy.targetVersion,
                    policy.packageWitnessHash,
                    policy.makerSide,
                    policy.pricingKind,
                    policy.sizeBandsHash,
                    policy.ladderHash,
                    PriceTicks.unwrap(policy.baseBidPriceTicks),
                    PriceTicks.unwrap(policy.baseAskPriceTicks),
                    policy.sizeSlopeTicksPerLot,
                    policy.inventorySkewTicksPerLot
                ),
                abi.encode(
                    policy.maximumAbsoluteInventoryLots,
                    policy.maximumAbsoluteSkewTicks,
                    policy.refreshInterval,
                    policy.quoteLifetime,
                    policy.validAfter,
                    policy.expiry,
                    FeeScheduleId.unwrap(policy.feeScheduleId),
                    policy.feeScheduleVersion,
                    RiskDomainId.unwrap(policy.riskDomainId),
                    policy.riskDomainVersion,
                    policy.executionModeId,
                    policy.permittedExecutor,
                    policy.capacityPolicyHash,
                    policy.capacityReservationId,
                    policy.nonce,
                    policy.salt
                )
            )
        );
    }

    function digest(StreamPolicy memory policy, uint256 chainId, address verifyingContract)
        internal
        pure
        returns (bytes32)
    {
        return Eip712Lib.toTypedDataDigest(Eip712Lib.domainSeparator(chainId, verifyingContract), hashPolicy(policy));
    }

    function streamId(StreamPolicy memory policy, uint256 chainId, address verifyingContract)
        internal
        pure
        returns (StreamId)
    {
        return StreamId.wrap(digest(policy, chainId, verifyingContract));
    }

    function hashSizeBands(StreamSizeBand[] memory bands) internal pure returns (bytes32 hash) {
        for (uint256 i; i < bands.length; ++i) {
            hash = keccak256(
                abi.encode(
                    hash,
                    SIZE_BAND_TYPEHASH,
                    Lots.unwrap(bands[i].minimumLots),
                    Lots.unwrap(bands[i].maximumLots),
                    Lots.unwrap(bands[i].lotStep)
                )
            );
        }
    }

    function hashLadder(StreamLadderLevel[] memory levels) internal pure returns (bytes32 hash) {
        for (uint256 i; i < levels.length; ++i) {
            hash = keccak256(
                abi.encode(
                    hash,
                    LADDER_LEVEL_TYPEHASH,
                    Lots.unwrap(levels[i].maximumLots),
                    PriceTicks.unwrap(levels[i].bidPriceTicks),
                    PriceTicks.unwrap(levels[i].askPriceTicks)
                )
            );
        }
    }

    function validate(StreamPolicy memory policy, StreamSizeBand[] memory bands, StreamLadderLevel[] memory levels)
        internal
        pure
    {
        if (
            policy.maker == address(0) || AccountId.unwrap(policy.makerAccountId) == bytes32(0)
                || policy.makerOrderHash == bytes32(0) || policy.targetVersion == 0
                || FeeScheduleId.unwrap(policy.feeScheduleId) == bytes32(0) || policy.feeScheduleVersion == 0
                || RiskDomainId.unwrap(policy.riskDomainId) == bytes32(0) || policy.riskDomainVersion == 0
                || policy.executionModeId == bytes32(0) || policy.capacityPolicyHash == bytes32(0)
                || policy.capacityReservationId == bytes32(0) || policy.salt == bytes32(0)
                || (policy.makerSide != Side.Buy && policy.makerSide != Side.Sell)
                || policy.permittedExecutor == address(0)
                || PriceTicks.unwrap(policy.baseBidPriceTicks) > PriceTicks.unwrap(policy.baseAskPriceTicks)
                || policy.sizeSlopeTicksPerLot < 0 || policy.maximumAbsoluteInventoryLots == 0
        ) revert InvalidStreamPolicy();
        bool seriesTarget = policy.targetKind == OrderTargetKind.Series;
        bool packageTarget = policy.targetKind == OrderTargetKind.Package;
        if (
            (seriesTarget
                    && (SeriesId.unwrap(policy.seriesId) == bytes32(0)
                        || PackageId.unwrap(policy.packageId) != bytes32(0)
                        || policy.packageWitnessHash != bytes32(0)))
                || (packageTarget
                    && (PackageId.unwrap(policy.packageId) == bytes32(0)
                        || SeriesId.unwrap(policy.seriesId) != bytes32(0)
                        || policy.packageWitnessHash == bytes32(0))) || (!seriesTarget && !packageTarget)
        ) revert InvalidStreamTarget();
        if (
            policy.refreshInterval == 0 || policy.quoteLifetime == 0 || policy.quoteLifetime > policy.refreshInterval
                || policy.validAfter >= policy.expiry
        ) revert InvalidStreamWindow();
        if (bands.length == 0 || bands.length > MAXIMUM_SIZE_BANDS || hashSizeBands(bands) != policy.sizeBandsHash) {
            revert InvalidSizeBands();
        }
        _validateBands(bands);
        if (policy.pricingKind == StreamPricingKind.AffineV1) {
            if (levels.length != 0 || policy.ladderHash != bytes32(0)) revert InvalidLadder();
        } else if (policy.pricingKind == StreamPricingKind.LadderV1) {
            if (
                levels.length == 0 || levels.length > MAXIMUM_LADDER_LEVELS || hashLadder(levels) != policy.ladderHash
                    || policy.sizeSlopeTicksPerLot != 0 || policy.inventorySkewTicksPerLot != 0
            ) revert InvalidLadder();
            _validateLadder(levels);
        } else {
            revert InvalidStreamPolicy();
        }
    }

    function _validateBands(StreamSizeBand[] memory bands) private pure {
        uint128 previousMaximum;
        for (uint256 i; i < bands.length; ++i) {
            uint128 minimum = Lots.unwrap(bands[i].minimumLots);
            uint128 maximum = Lots.unwrap(bands[i].maximumLots);
            uint128 step = Lots.unwrap(bands[i].lotStep);
            if (minimum == 0 || maximum < minimum || step == 0 || (i != 0 && minimum <= previousMaximum)) {
                revert InvalidSizeBands();
            }
            previousMaximum = maximum;
        }
    }

    function _validateLadder(StreamLadderLevel[] memory levels) private pure {
        uint128 previousMaximum;
        for (uint256 i; i < levels.length; ++i) {
            uint128 maximum = Lots.unwrap(levels[i].maximumLots);
            if (
                maximum == 0 || (i != 0 && maximum <= previousMaximum)
                    || PriceTicks.unwrap(levels[i].bidPriceTicks) > PriceTicks.unwrap(levels[i].askPriceTicks)
            ) revert InvalidLadder();
            previousMaximum = maximum;
        }
    }
}
