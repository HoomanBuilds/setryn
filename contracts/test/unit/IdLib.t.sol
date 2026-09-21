// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {IdLib} from "../../src/libraries/IdLib.sol";
import {ZeroDefinitionHash} from "../../src/types/Errors.sol";
import {
    AdapterId,
    AssetId,
    BenchmarkId,
    CalendarId,
    InstrumentId,
    MarketId,
    PackageId,
    RiskDomainId,
    SeriesId,
    SessionId
} from "../../src/types/Identifiers.sol";
import {KernelHarness} from "./harness/KernelHarness.sol";

contract IdLibTest is Test {
    bytes32 internal constant DEFINITION = keccak256("SetrynGoldenDefinitionV1");

    bytes32 internal constant GOLDEN_DEFINITION = 0x5771e269aa03bde8ea57bdaa3c3ad8c3518be50237ed3ae289ff3d40f8ab8247;

    bytes32 internal constant GOLDEN_ASSET_ID = 0xb313eaea4bb77fd0fc510d67cdca667d893a1dd2ea3e7533e2df5971cf969ea5;
    bytes32 internal constant GOLDEN_BENCHMARK_ID = 0xf951b5f28a468abdd50d6ffd6dc12ab5cfb0eb980f961242b03c25d97ebcf245;
    bytes32 internal constant GOLDEN_CALENDAR_ID = 0xd7ca21333a2a78a73d77810c4a20810a0c5051a1d949d02f4ca1dafdd999fec7;
    bytes32 internal constant GOLDEN_SESSION_ID = 0x0fe03317459635c90edefbb392d787d5089565c8881bd4838f53e6aaad5ddecb;
    bytes32 internal constant GOLDEN_ADAPTER_ID = 0xd378ee57d038173587424b441e2540268ff4d81c24d124456043d8d7227fecc8;
    bytes32 internal constant GOLDEN_RISK_DOMAIN_ID =
        0x215f0142a74f26bff450925b454f73fcc3e033c2b6a146dca28ac8d2b9049617;
    bytes32 internal constant GOLDEN_MARKET_ID = 0x2a7f7b623238737b7c5b56f9b600548058a2db4e2a367a57707686af4bc9bb2d;
    bytes32 internal constant GOLDEN_INSTRUMENT_ID = 0xbb8f25bbc231cbc361dacdd1b1bbb7bb15e318b93f8b0cd734a92e5ec128d114;
    bytes32 internal constant GOLDEN_SERIES_ID = 0xe0ba77c5a323cb97b0c77ed24af802e29b0e7d33cc8cca42429779061f299eca;
    bytes32 internal constant GOLDEN_PACKAGE_ID = 0x37bcd6072e7b3b70c7e32a0d2feac16e25896474abefbbf78d0296c985153f85;

    KernelHarness internal harness;

    function setUp() public {
        harness = new KernelHarness();
    }

    function test_TypeTagsMatchVersionedLiterals() public pure {
        assertEq(IdLib.ASSET_ID_TYPE_TAG, keccak256(bytes("SetrynAssetIdV1(bytes32 definitionHash)")));
        assertEq(IdLib.BENCHMARK_ID_TYPE_TAG, keccak256(bytes("SetrynBenchmarkIdV1(bytes32 definitionHash)")));
        assertEq(IdLib.CALENDAR_ID_TYPE_TAG, keccak256(bytes("SetrynCalendarIdV1(bytes32 definitionHash)")));
        assertEq(IdLib.SESSION_ID_TYPE_TAG, keccak256(bytes("SetrynSessionIdV1(bytes32 definitionHash)")));
        assertEq(IdLib.ADAPTER_ID_TYPE_TAG, keccak256(bytes("SetrynAdapterIdV1(bytes32 definitionHash)")));
        assertEq(IdLib.RISK_DOMAIN_ID_TYPE_TAG, keccak256(bytes("SetrynRiskDomainIdV1(bytes32 definitionHash)")));
        assertEq(IdLib.MARKET_ID_TYPE_TAG, keccak256(bytes("SetrynMarketIdV1(bytes32 definitionHash)")));
        assertEq(IdLib.INSTRUMENT_ID_TYPE_TAG, keccak256(bytes("SetrynInstrumentIdV1(bytes32 definitionHash)")));
        assertEq(IdLib.SERIES_ID_TYPE_TAG, keccak256(bytes("SetrynSeriesIdV1(bytes32 definitionHash)")));
        assertEq(IdLib.PACKAGE_ID_TYPE_TAG, keccak256(bytes("SetrynPackageIdV1(bytes32 definitionHash)")));
    }

    function test_GoldenDefinitionIsFrozen() public pure {
        assertEq(DEFINITION, GOLDEN_DEFINITION);
    }

    function test_GoldenVectorsForEveryIdentifierKind() public pure {
        assertEq(AssetId.unwrap(IdLib.deriveAssetId(GOLDEN_DEFINITION)), GOLDEN_ASSET_ID);
        assertEq(BenchmarkId.unwrap(IdLib.deriveBenchmarkId(GOLDEN_DEFINITION)), GOLDEN_BENCHMARK_ID);
        assertEq(CalendarId.unwrap(IdLib.deriveCalendarId(GOLDEN_DEFINITION)), GOLDEN_CALENDAR_ID);
        assertEq(SessionId.unwrap(IdLib.deriveSessionId(GOLDEN_DEFINITION)), GOLDEN_SESSION_ID);
        assertEq(AdapterId.unwrap(IdLib.deriveAdapterId(GOLDEN_DEFINITION)), GOLDEN_ADAPTER_ID);
        assertEq(RiskDomainId.unwrap(IdLib.deriveRiskDomainId(GOLDEN_DEFINITION)), GOLDEN_RISK_DOMAIN_ID);
        assertEq(MarketId.unwrap(IdLib.deriveMarketId(GOLDEN_DEFINITION)), GOLDEN_MARKET_ID);
        assertEq(InstrumentId.unwrap(IdLib.deriveInstrumentId(GOLDEN_DEFINITION)), GOLDEN_INSTRUMENT_ID);
        assertEq(SeriesId.unwrap(IdLib.deriveSeriesId(GOLDEN_DEFINITION)), GOLDEN_SERIES_ID);
        assertEq(PackageId.unwrap(IdLib.derivePackageId(GOLDEN_DEFINITION)), GOLDEN_PACKAGE_ID);
    }

    function test_GoldenVectorsAreDistinct() public pure {
        bytes32[10] memory golden = [
            GOLDEN_ASSET_ID,
            GOLDEN_BENCHMARK_ID,
            GOLDEN_CALENDAR_ID,
            GOLDEN_SESSION_ID,
            GOLDEN_ADAPTER_ID,
            GOLDEN_RISK_DOMAIN_ID,
            GOLDEN_MARKET_ID,
            GOLDEN_INSTRUMENT_ID,
            GOLDEN_SERIES_ID,
            GOLDEN_PACKAGE_ID
        ];

        for (uint256 i = 0; i < golden.length; i++) {
            for (uint256 j = i + 1; j < golden.length; j++) {
                assertTrue(golden[i] != golden[j], "frozen vectors must not repeat");
            }
        }
    }

    function test_DerivationIsDeterministic() public pure {
        bytes32[10] memory first = _allIds(DEFINITION);
        bytes32[10] memory second = _allIds(DEFINITION);

        for (uint256 i = 0; i < first.length; i++) {
            assertEq(first[i], second[i]);
        }
    }

    function test_PairwiseDomainSeparation() public pure {
        bytes32[10] memory ids = _allIds(DEFINITION);

        for (uint256 i = 0; i < ids.length; i++) {
            for (uint256 j = i + 1; j < ids.length; j++) {
                assertTrue(ids[i] != ids[j], "identifier kinds must not share a value");
            }
        }
    }

    function test_ChainContextDoesNotAffectIdentity() public {
        bytes32[10] memory onArbitrumOne = _allIds(DEFINITION);

        vm.chainId(421614);
        vm.roll(block.number + 5_000);
        vm.warp(block.timestamp + 5_000);
        bytes32[10] memory onArbitrumSepolia = _allIds(DEFINITION);

        for (uint256 i = 0; i < onArbitrumOne.length; i++) {
            assertEq(onArbitrumOne[i], onArbitrumSepolia[i]);
        }
    }

    function test_ZeroDefinitionHashRejectedForEveryKind() public {
        vm.expectRevert(ZeroDefinitionHash.selector);
        harness.deriveAssetId(bytes32(0));

        vm.expectRevert(ZeroDefinitionHash.selector);
        harness.deriveBenchmarkId(bytes32(0));

        vm.expectRevert(ZeroDefinitionHash.selector);
        harness.deriveCalendarId(bytes32(0));

        vm.expectRevert(ZeroDefinitionHash.selector);
        harness.deriveSessionId(bytes32(0));

        vm.expectRevert(ZeroDefinitionHash.selector);
        harness.deriveAdapterId(bytes32(0));

        vm.expectRevert(ZeroDefinitionHash.selector);
        harness.deriveRiskDomainId(bytes32(0));

        vm.expectRevert(ZeroDefinitionHash.selector);
        harness.deriveMarketId(bytes32(0));

        vm.expectRevert(ZeroDefinitionHash.selector);
        harness.deriveInstrumentId(bytes32(0));

        vm.expectRevert(ZeroDefinitionHash.selector);
        harness.deriveSeriesId(bytes32(0));

        vm.expectRevert(ZeroDefinitionHash.selector);
        harness.derivePackageId(bytes32(0));
    }

    function _allIds(bytes32 definitionHash) internal pure returns (bytes32[10] memory ids) {
        ids[0] = AssetId.unwrap(IdLib.deriveAssetId(definitionHash));
        ids[1] = BenchmarkId.unwrap(IdLib.deriveBenchmarkId(definitionHash));
        ids[2] = CalendarId.unwrap(IdLib.deriveCalendarId(definitionHash));
        ids[3] = SessionId.unwrap(IdLib.deriveSessionId(definitionHash));
        ids[4] = AdapterId.unwrap(IdLib.deriveAdapterId(definitionHash));
        ids[5] = RiskDomainId.unwrap(IdLib.deriveRiskDomainId(definitionHash));
        ids[6] = MarketId.unwrap(IdLib.deriveMarketId(definitionHash));
        ids[7] = InstrumentId.unwrap(IdLib.deriveInstrumentId(definitionHash));
        ids[8] = SeriesId.unwrap(IdLib.deriveSeriesId(definitionHash));
        ids[9] = PackageId.unwrap(IdLib.derivePackageId(definitionHash));
    }
}
