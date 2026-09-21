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
import {KernelHarness} from "../unit/harness/KernelHarness.sol";

contract IdLibFuzzTest is Test {
    KernelHarness internal harness;

    function setUp() public {
        harness = new KernelHarness();
    }

    function testFuzz_DerivationIsDeterministic(bytes32 definitionHash) public pure {
        vm.assume(definitionHash != bytes32(0));

        bytes32[10] memory first = _allIds(definitionHash);
        bytes32[10] memory second = _allIds(definitionHash);

        for (uint256 i = 0; i < first.length; i++) {
            assertEq(first[i], second[i]);
        }
    }

    function testFuzz_PairwiseDomainSeparation(bytes32 definitionHash) public pure {
        vm.assume(definitionHash != bytes32(0));

        bytes32[10] memory ids = _allIds(definitionHash);

        for (uint256 i = 0; i < ids.length; i++) {
            for (uint256 j = i + 1; j < ids.length; j++) {
                assertTrue(ids[i] != ids[j], "identifier kinds must not share a value");
            }
        }
    }

    function testFuzz_DerivationMatchesCanonicalPreimage(bytes32 definitionHash) public pure {
        vm.assume(definitionHash != bytes32(0));

        assertEq(
            AssetId.unwrap(IdLib.deriveAssetId(definitionHash)),
            keccak256(abi.encode(IdLib.ASSET_ID_TYPE_TAG, definitionHash))
        );
        assertEq(
            MarketId.unwrap(IdLib.deriveMarketId(definitionHash)),
            keccak256(abi.encode(IdLib.MARKET_ID_TYPE_TAG, definitionHash))
        );
        assertEq(
            PackageId.unwrap(IdLib.derivePackageId(definitionHash)),
            keccak256(abi.encode(IdLib.PACKAGE_ID_TYPE_TAG, definitionHash))
        );
    }

    function testFuzz_ChainContextDoesNotAffectIdentity(
        bytes32 definitionHash,
        uint64 chainId,
        uint64 blockNumber,
        uint64 timestamp
    ) public {
        vm.assume(definitionHash != bytes32(0));
        chainId = uint64(bound(uint256(chainId), 1, type(uint64).max));
        blockNumber = uint64(bound(uint256(blockNumber), 1, type(uint64).max));
        timestamp = uint64(bound(uint256(timestamp), 1, type(uint64).max));

        bytes32[10] memory baseline = _allIds(definitionHash);

        vm.chainId(chainId);
        vm.roll(blockNumber);
        vm.warp(timestamp);

        bytes32[10] memory shifted = _allIds(definitionHash);

        for (uint256 i = 0; i < baseline.length; i++) {
            assertEq(baseline[i], shifted[i]);
        }
    }

    function testFuzz_ZeroDefinitionHashRejectedRegardlessOfContext(uint64 chainId) public {
        chainId = uint64(bound(uint256(chainId), 1, type(uint64).max));
        vm.chainId(chainId);

        vm.expectRevert(ZeroDefinitionHash.selector);
        harness.deriveAssetId(bytes32(0));

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
