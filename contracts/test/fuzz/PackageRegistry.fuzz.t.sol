// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {PackageDefinitionLib} from "../../src/libraries/PackageDefinitionLib.sol";
import {AssetId, PackageId, SeriesId} from "../../src/types/Identifiers.sol";
import {PackageDefinition, PackageLeg} from "../../src/types/PackageDefinition.sol";
import {Lots, PriceTicks, TickSizeMinor} from "../../src/types/Units.sol";
import {PackageDefinitionHarness} from "../unit/harness/PackageDefinitionHarness.sol";

contract PackageRegistryFuzzTest is Test {
    PackageDefinitionHarness internal harness;

    function setUp() public {
        harness = new PackageDefinitionHarness();
    }

    function testFuzz_TerminalBoundsRespectLegOrientation(
        uint32 firstLong,
        uint32 firstShort,
        uint32 secondLong,
        uint32 secondShort,
        uint16 secondRatio
    ) public view {
        secondRatio = uint16(bound(secondRatio, 1, type(uint16).max));
        PackageLeg[] memory legs = _legs(1, -int32(uint32(secondRatio)));
        uint128[] memory longBounds = new uint128[](2);
        uint128[] memory shortBounds = new uint128[](2);
        longBounds[0] = firstLong;
        longBounds[1] = secondLong;
        shortBounds[0] = firstShort;
        shortBounds[1] = secondShort;

        (uint128 longDebit, uint128 shortDebit) = harness.deriveTerminalDebitBounds(legs, longBounds, shortBounds);

        assertEq(longDebit, uint256(firstLong) + uint256(secondRatio) * uint256(secondShort));
        assertEq(shortDebit, uint256(firstShort) + uint256(secondRatio) * uint256(secondLong));
    }

    function testFuzz_LegLotsCompileExactly(uint96 rawPackageLots, int16 rawRatio) public view {
        uint128 packageLots = uint128(bound(rawPackageLots, 1, type(uint96).max));
        int32 ratio = int32(rawRatio);
        if (ratio == 0) ratio = 1;
        uint256 magnitude = ratio < 0 ? uint256(-int256(ratio)) : uint256(int256(ratio));

        Lots compiled = harness.legLots(Lots.wrap(packageLots), ratio);

        assertEq(Lots.unwrap(compiled), uint256(packageLots) * magnitude);
    }

    function testFuzz_LineageIgnoresEconomicRevision(uint128 tickSize, uint128 maximumLots, bytes32 evidenceHash)
        public
        pure
    {
        tickSize = tickSize == 0 ? 1 : tickSize;
        maximumLots = maximumLots == 0 ? 1 : maximumLots;
        evidenceHash = evidenceHash == bytes32(0) ? bytes32(uint256(1)) : evidenceHash;
        PackageDefinition memory baseline = _definition();
        PackageDefinition memory revised = baseline;
        revised.tickSizeMinor = TickSizeMinor.wrap(tickSize);
        revised.maxOrderLots = Lots.wrap(maximumLots);
        revised.qualificationEvidenceHash = evidenceHash;

        PackageId baselineId = PackageDefinitionLib.derivePackageId(baseline);
        PackageId revisedId = PackageDefinitionLib.derivePackageId(revised);
        assertEq(PackageId.unwrap(baselineId), PackageId.unwrap(revisedId));

        if (
            TickSizeMinor.unwrap(baseline.tickSizeMinor) != TickSizeMinor.unwrap(revised.tickSizeMinor)
                || Lots.unwrap(baseline.maxOrderLots) != Lots.unwrap(revised.maxOrderLots)
                || baseline.qualificationEvidenceHash != revised.qualificationEvidenceHash
        ) {
            assertTrue(
                PackageDefinitionLib.hashDefinition(baseline, 42161)
                    != PackageDefinitionLib.hashDefinition(revised, 42161)
            );
        }
    }

    function testFuzz_DefinitionAndVersionHashesAreChainBound(uint64 firstChain) public pure {
        firstChain = uint64(bound(firstChain, 1, type(uint64).max - 1));
        uint64 secondChain = firstChain + 1;
        PackageDefinition memory definition = _definition();
        PackageId packageId = PackageDefinitionLib.derivePackageId(definition);
        bytes32 firstHash = PackageDefinitionLib.hashDefinition(definition, firstChain);
        bytes32 secondHash = PackageDefinitionLib.hashDefinition(definition, secondChain);

        assertTrue(firstHash != secondHash);
        assertTrue(
            PackageDefinitionLib.hashVersion(packageId, 1, firstHash, firstChain)
                != PackageDefinitionLib.hashVersion(packageId, 1, secondHash, secondChain)
        );
    }

    function testFuzz_OrderBoundsAcceptExactGrid(uint64 stepSeed, uint64 multiplierSeed, int64 priceSeed) public view {
        uint128 step = uint128(bound(stepSeed, 1, type(uint32).max));
        uint128 multiplier = uint128(bound(multiplierSeed, 1, type(uint16).max));
        uint128 lots = step * multiplier;
        int128 price = int128(bound(priceSeed, -1_000_000, 1_000_000));
        PackageDefinition memory definition = _definition();
        definition.lotStep = Lots.wrap(step);
        definition.minOrderLots = Lots.wrap(step);
        definition.maxOrderLots = Lots.wrap(lots);

        int256 notional = harness.compileFillNotional(definition, Lots.wrap(lots), PriceTicks.wrap(price));
        assertEq(notional, int256(uint256(lots)) * int256(price));
    }

    function _legs(int32 firstRatio, int32 secondRatio) private pure returns (PackageLeg[] memory legs) {
        legs = new PackageLeg[](2);
        legs[0] = PackageLeg({seriesId: SeriesId.wrap(bytes32(uint256(1))), seriesVersion: 1, ratio: firstRatio});
        legs[1] = PackageLeg({seriesId: SeriesId.wrap(bytes32(uint256(2))), seriesVersion: 1, ratio: secondRatio});
    }

    function _definition() private pure returns (PackageDefinition memory) {
        PackageLeg[] memory legs = _legs(1, -1);
        return PackageDefinition({
            namespaceId: keccak256("setryn"),
            packageKey: keccak256("package"),
            settlementAssetId: AssetId.wrap(keccak256("usdc")),
            settlementAssetVersion: 1,
            legsHash: PackageDefinitionLib.hashLegs(legs),
            quoteUnitId: PackageDefinitionLib.QUOTE_UNIT_SETTLEMENT_MINOR_PER_LOT,
            tickSizeMinor: TickSizeMinor.wrap(1),
            lotStep: Lots.wrap(1),
            minOrderLots: Lots.wrap(1),
            maxOrderLots: Lots.wrap(100),
            minPriceTicks: PriceTicks.wrap(-1_000_000),
            maxPriceTicks: PriceTicks.wrap(1_000_000),
            maxLongDebitMinorPerPackageLot: 1,
            maxShortDebitMinorPerPackageLot: 1,
            lifecyclePolicyHash: keccak256("lifecycle"),
            qualificationEvidenceHash: keccak256("evidence")
        });
    }
}
