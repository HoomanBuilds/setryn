// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {PackageDefinition, PackageLeg} from "../types/PackageDefinition.sol";
import {AssetId, PackageId, QuoteUnitId, SeriesId} from "../types/Identifiers.sol";
import {Lots, PriceTicks, TickSizeMinor} from "../types/Units.sol";
import {IdLib} from "./IdLib.sol";
import {NotionalLib} from "./NotionalLib.sol";

error ZeroPackageNamespaceId();
error ZeroPackageKey();
error ZeroPackageSettlementAssetId();
error ZeroPackageSettlementAssetVersion();
error ZeroPackageLegsHash();
error UnsupportedPackageQuoteUnit(QuoteUnitId quoteUnitId);
error ZeroPackageTickSize();
error ZeroPackageLotBound();
error InvalidPackageLotBounds(Lots lotStep, Lots minOrderLots, Lots maxOrderLots);
error InvalidPackagePriceBounds(PriceTicks minPriceTicks, PriceTicks maxPriceTicks);
error ZeroPackageDebitBounds();
error ZeroPackageLifecyclePolicyHash();
error ZeroPackageQualificationEvidenceHash();
error InvalidPackageLegCount(uint256 count, uint256 minimum, uint256 maximum);
error ZeroPackageSeriesId(uint256 index);
error ZeroPackageSeriesVersion(uint256 index);
error ZeroPackageLegRatio(uint256 index);
error InvalidPackageLegOrder(uint256 index);
error InvalidPackageOrientation(int32 firstRatio);
error NonPrimitivePackageRatios(uint256 greatestCommonDivisor);
error PackageLegsHashMismatch(bytes32 expected, bytes32 actual);
error PackageLegBoundsLengthMismatch(uint256 legs, uint256 longBounds, uint256 shortBounds);
error PackageTerminalDebitOverflow(bool longSide, uint256 value);
error PackageLegLotsOverflow(uint128 packageLots, int32 ratio);
error InvalidPackageOrderLots(Lots lots, Lots lotStep, Lots minimum, Lots maximum);
error InvalidPackageOrderPrice(PriceTicks priceTicks, PriceTicks minimum, PriceTicks maximum);

library PackageDefinitionLib {
    uint256 internal constant MIN_PACKAGE_LEGS = 2;
    uint256 internal constant MAX_PACKAGE_LEGS = 16;

    QuoteUnitId internal constant QUOTE_UNIT_SETTLEMENT_MINOR_PER_LOT =
        QuoteUnitId.wrap(keccak256("SetrynQuoteUnitV1:SettlementMinorPerLot"));

    string internal constant PACKAGE_KEY_TYPESTRING = "SetrynPackageKeyV1(bytes32 namespaceId,bytes32 packageKey)";
    bytes32 internal constant PACKAGE_KEY_TYPEHASH =
        keccak256("SetrynPackageKeyV1(bytes32 namespaceId,bytes32 packageKey)");

    string internal constant PACKAGE_LEG_TYPESTRING =
        "SetrynPackageLegV1(bytes32 seriesId,uint32 seriesVersion,int32 ratio)";
    bytes32 internal constant PACKAGE_LEG_TYPEHASH =
        keccak256("SetrynPackageLegV1(bytes32 seriesId,uint32 seriesVersion,int32 ratio)");

    string internal constant PACKAGE_LEGS_TYPESTRING = "SetrynPackageLegsV1(bytes32 legHashesHash)";
    bytes32 internal constant PACKAGE_LEGS_TYPEHASH = keccak256("SetrynPackageLegsV1(bytes32 legHashesHash)");

    string internal constant PACKAGE_DEFINITION_TYPESTRING =
        "SetrynPackageDefinitionV1(bytes32 namespaceId,bytes32 packageKey,bytes32 settlementAssetId,uint32 settlementAssetVersion,bytes32 legsHash,bytes32 quoteUnitId,uint128 tickSizeMinor,uint128 lotStep,uint128 minOrderLots,uint128 maxOrderLots,int128 minPriceTicks,int128 maxPriceTicks,uint128 maxLongDebitMinorPerPackageLot,uint128 maxShortDebitMinorPerPackageLot,bytes32 lifecyclePolicyHash,bytes32 qualificationEvidenceHash,uint256 chainId)";
    bytes32 internal constant PACKAGE_DEFINITION_TYPEHASH = keccak256(
        "SetrynPackageDefinitionV1(bytes32 namespaceId,bytes32 packageKey,bytes32 settlementAssetId,uint32 settlementAssetVersion,bytes32 legsHash,bytes32 quoteUnitId,uint128 tickSizeMinor,uint128 lotStep,uint128 minOrderLots,uint128 maxOrderLots,int128 minPriceTicks,int128 maxPriceTicks,uint128 maxLongDebitMinorPerPackageLot,uint128 maxShortDebitMinorPerPackageLot,bytes32 lifecyclePolicyHash,bytes32 qualificationEvidenceHash,uint256 chainId)"
    );

    string internal constant PACKAGE_VERSION_TYPESTRING =
        "SetrynPackageVersionV1(bytes32 packageId,uint32 version,bytes32 definitionHash,uint256 chainId)";
    bytes32 internal constant PACKAGE_VERSION_TYPEHASH =
        keccak256("SetrynPackageVersionV1(bytes32 packageId,uint32 version,bytes32 definitionHash,uint256 chainId)");

    function validate(PackageDefinition memory definition, PackageLeg[] memory legs) internal pure {
        if (definition.namespaceId == bytes32(0)) revert ZeroPackageNamespaceId();
        if (definition.packageKey == bytes32(0)) revert ZeroPackageKey();
        if (AssetId.unwrap(definition.settlementAssetId) == bytes32(0)) revert ZeroPackageSettlementAssetId();
        if (definition.settlementAssetVersion == 0) revert ZeroPackageSettlementAssetVersion();
        if (definition.legsHash == bytes32(0)) revert ZeroPackageLegsHash();
        if (QuoteUnitId.unwrap(definition.quoteUnitId) != QuoteUnitId.unwrap(QUOTE_UNIT_SETTLEMENT_MINOR_PER_LOT)) {
            revert UnsupportedPackageQuoteUnit(definition.quoteUnitId);
        }
        if (TickSizeMinor.unwrap(definition.tickSizeMinor) == 0) revert ZeroPackageTickSize();
        _validateLots(definition);
        if (PriceTicks.unwrap(definition.minPriceTicks) > PriceTicks.unwrap(definition.maxPriceTicks)) {
            revert InvalidPackagePriceBounds(definition.minPriceTicks, definition.maxPriceTicks);
        }
        if (definition.maxLongDebitMinorPerPackageLot == 0 && definition.maxShortDebitMinorPerPackageLot == 0) {
            revert ZeroPackageDebitBounds();
        }
        if (definition.lifecyclePolicyHash == bytes32(0)) revert ZeroPackageLifecyclePolicyHash();
        if (definition.qualificationEvidenceHash == bytes32(0)) {
            revert ZeroPackageQualificationEvidenceHash();
        }

        bytes32 actualLegsHash = hashLegs(legs);
        if (actualLegsHash != definition.legsHash) {
            revert PackageLegsHashMismatch(definition.legsHash, actualLegsHash);
        }

        for (uint256 i; i < legs.length; ++i) {
            legLots(definition.maxOrderLots, legs[i].ratio);
        }
    }

    function hashKey(PackageDefinition memory definition) internal pure returns (bytes32) {
        return keccak256(abi.encode(PACKAGE_KEY_TYPEHASH, definition.namespaceId, definition.packageKey));
    }

    function hashLeg(PackageLeg memory leg) internal pure returns (bytes32) {
        return keccak256(abi.encode(PACKAGE_LEG_TYPEHASH, SeriesId.unwrap(leg.seriesId), leg.seriesVersion, leg.ratio));
    }

    function hashLegs(PackageLeg[] memory legs) internal pure returns (bytes32) {
        _validateLegs(legs);
        return hashLegsUnchecked(legs);
    }

    function hashLegsUnchecked(PackageLeg[] memory legs) internal pure returns (bytes32) {
        bytes32[] memory legHashes = new bytes32[](legs.length);
        for (uint256 i; i < legs.length; ++i) {
            legHashes[i] = hashLeg(legs[i]);
        }
        return keccak256(abi.encode(PACKAGE_LEGS_TYPEHASH, keccak256(abi.encodePacked(legHashes))));
    }

    function hashDefinition(PackageDefinition memory definition, uint256 chainId) internal pure returns (bytes32) {
        return keccak256(
            bytes.concat(
                abi.encode(
                    PACKAGE_DEFINITION_TYPEHASH,
                    definition.namespaceId,
                    definition.packageKey,
                    AssetId.unwrap(definition.settlementAssetId),
                    definition.settlementAssetVersion,
                    definition.legsHash,
                    QuoteUnitId.unwrap(definition.quoteUnitId),
                    TickSizeMinor.unwrap(definition.tickSizeMinor),
                    Lots.unwrap(definition.lotStep),
                    Lots.unwrap(definition.minOrderLots)
                ),
                abi.encode(
                    Lots.unwrap(definition.maxOrderLots),
                    PriceTicks.unwrap(definition.minPriceTicks),
                    PriceTicks.unwrap(definition.maxPriceTicks),
                    definition.maxLongDebitMinorPerPackageLot,
                    definition.maxShortDebitMinorPerPackageLot,
                    definition.lifecyclePolicyHash,
                    definition.qualificationEvidenceHash,
                    chainId
                )
            )
        );
    }

    function hashVersion(PackageId packageId, uint32 version, bytes32 definitionHash, uint256 chainId)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(PACKAGE_VERSION_TYPEHASH, PackageId.unwrap(packageId), version, definitionHash, chainId)
        );
    }

    function derivePackageId(PackageDefinition memory definition) internal pure returns (PackageId) {
        return IdLib.derivePackageId(hashKey(definition));
    }

    function deriveTerminalDebitBounds(
        PackageLeg[] memory legs,
        uint128[] memory longDebitBounds,
        uint128[] memory shortDebitBounds
    ) internal pure returns (uint128 longDebit, uint128 shortDebit) {
        if (legs.length != longDebitBounds.length || legs.length != shortDebitBounds.length) {
            revert PackageLegBoundsLengthMismatch(legs.length, longDebitBounds.length, shortDebitBounds.length);
        }

        uint256 longTotal;
        uint256 shortTotal;
        for (uint256 i; i < legs.length; ++i) {
            uint256 magnitude = ratioMagnitude(legs[i].ratio);
            if (legs[i].ratio > 0) {
                longTotal += magnitude * uint256(longDebitBounds[i]);
                shortTotal += magnitude * uint256(shortDebitBounds[i]);
            } else {
                longTotal += magnitude * uint256(shortDebitBounds[i]);
                shortTotal += magnitude * uint256(longDebitBounds[i]);
            }
        }
        if (longTotal > type(uint128).max) revert PackageTerminalDebitOverflow(true, longTotal);
        if (shortTotal > type(uint128).max) revert PackageTerminalDebitOverflow(false, shortTotal);
        return (uint128(longTotal), uint128(shortTotal));
    }

    function legLots(Lots packageLots, int32 ratio) internal pure returns (Lots) {
        uint256 legLotCount = uint256(Lots.unwrap(packageLots)) * ratioMagnitude(ratio);
        if (legLotCount > type(uint128).max) revert PackageLegLotsOverflow(Lots.unwrap(packageLots), ratio);
        return Lots.wrap(uint128(legLotCount));
    }

    function validateOrder(PackageDefinition memory definition, Lots packageLots, PriceTicks priceTicks) internal pure {
        uint128 rawLots = Lots.unwrap(packageLots);
        uint128 step = Lots.unwrap(definition.lotStep);
        if (
            step == 0 || rawLots < Lots.unwrap(definition.minOrderLots)
                || rawLots > Lots.unwrap(definition.maxOrderLots) || rawLots % step != 0
        ) {
            revert InvalidPackageOrderLots(
                packageLots, definition.lotStep, definition.minOrderLots, definition.maxOrderLots
            );
        }
        if (
            PriceTicks.unwrap(priceTicks) < PriceTicks.unwrap(definition.minPriceTicks)
                || PriceTicks.unwrap(priceTicks) > PriceTicks.unwrap(definition.maxPriceTicks)
        ) revert InvalidPackageOrderPrice(priceTicks, definition.minPriceTicks, definition.maxPriceTicks);
    }

    function compileFillNotional(PackageDefinition memory definition, Lots packageLots, PriceTicks priceTicks)
        internal
        pure
        returns (int256)
    {
        validateOrder(definition, packageLots, priceTicks);
        return NotionalLib.fillNotional(packageLots, priceTicks, definition.tickSizeMinor);
    }

    function ratioMagnitude(int32 ratio) internal pure returns (uint256) {
        int256 widened = int256(ratio);
        return widened < 0 ? uint256(-widened) : uint256(widened);
    }

    function _validateLegs(PackageLeg[] memory legs) private pure {
        uint256 count = legs.length;
        if (count < MIN_PACKAGE_LEGS || count > MAX_PACKAGE_LEGS) {
            revert InvalidPackageLegCount(count, MIN_PACKAGE_LEGS, MAX_PACKAGE_LEGS);
        }

        uint256 divisor;
        for (uint256 i; i < count; ++i) {
            PackageLeg memory leg = legs[i];
            if (SeriesId.unwrap(leg.seriesId) == bytes32(0)) revert ZeroPackageSeriesId(i);
            if (leg.seriesVersion == 0) revert ZeroPackageSeriesVersion(i);
            if (leg.ratio == 0) revert ZeroPackageLegRatio(i);
            if (i == 0) {
                if (leg.ratio < 0) revert InvalidPackageOrientation(leg.ratio);
            } else if (!_strictlyAfter(legs[i - 1], leg)) {
                revert InvalidPackageLegOrder(i);
            }
            divisor = _greatestCommonDivisor(divisor, ratioMagnitude(leg.ratio));
        }
        if (divisor != 1) revert NonPrimitivePackageRatios(divisor);
    }

    function _strictlyAfter(PackageLeg memory previous, PackageLeg memory current) private pure returns (bool) {
        uint256 previousId = uint256(SeriesId.unwrap(previous.seriesId));
        uint256 currentId = uint256(SeriesId.unwrap(current.seriesId));
        if (currentId > previousId) return true;
        return currentId == previousId && current.seriesVersion > previous.seriesVersion;
    }

    function _greatestCommonDivisor(uint256 a, uint256 b) private pure returns (uint256) {
        while (b != 0) {
            (a, b) = (b, a % b);
        }
        return a;
    }

    function _validateLots(PackageDefinition memory definition) private pure {
        uint128 lotStep = Lots.unwrap(definition.lotStep);
        uint128 minimum = Lots.unwrap(definition.minOrderLots);
        uint128 maximum = Lots.unwrap(definition.maxOrderLots);
        if (lotStep == 0 || minimum == 0 || maximum == 0) revert ZeroPackageLotBound();
        if (minimum > maximum || minimum % lotStep != 0 || maximum % lotStep != 0) {
            revert InvalidPackageLotBounds(definition.lotStep, definition.minOrderLots, definition.maxOrderLots);
        }
    }
}
