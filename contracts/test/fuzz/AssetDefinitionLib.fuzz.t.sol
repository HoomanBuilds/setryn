// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {
    AssetDefinitionLib,
    UnspecifiedAssetClass,
    ZeroNamespaceId,
    ZeroReferenceId,
    ZeroSymbol
} from "../../src/libraries/AssetDefinitionLib.sol";
import {IdLib} from "../../src/libraries/IdLib.sol";
import {AssetDefinition} from "../../src/types/AssetDefinition.sol";
import {AssetClass} from "../../src/types/Enums.sol";
import {AssetId} from "../../src/types/Identifiers.sol";
import {AssetDefinitionHarness} from "../unit/harness/AssetDefinitionHarness.sol";

contract AssetDefinitionLibFuzzTest is Test {
    AssetDefinitionHarness internal harness;

    function setUp() public {
        harness = new AssetDefinitionHarness();
    }

    function testFuzz_AssetIdDependsOnIdentityFieldsOnly(
        bytes32 namespaceId,
        bytes32 referenceId,
        bytes32 symbolA,
        bytes32 symbolB,
        uint8 classA,
        uint8 classB,
        uint8 decimalsA,
        uint8 decimalsB
    ) public pure {
        AssetDefinition memory first = _definition(namespaceId, referenceId, symbolA, classA, decimalsA);
        AssetDefinition memory second = _definition(namespaceId, referenceId, symbolB, classB, decimalsB);

        assertEq(
            AssetId.unwrap(AssetDefinitionLib.deriveAssetId(first)),
            AssetId.unwrap(AssetDefinitionLib.deriveAssetId(second))
        );
        assertEq(AssetDefinitionLib.hashKey(first), AssetDefinitionLib.hashKey(second));
    }

    function testFuzz_DefinitionHashSeparatesNonIdentityFields(
        bytes32 namespaceId,
        bytes32 referenceId,
        bytes32 symbolA,
        bytes32 symbolB,
        uint8 classA,
        uint8 classB,
        uint8 decimalsA,
        uint8 decimalsB
    ) public pure {
        vm.assume(symbolA != symbolB || classA % 8 != classB % 8 || decimalsA != decimalsB);

        AssetDefinition memory first = _definition(namespaceId, referenceId, symbolA, classA, decimalsA);
        AssetDefinition memory second = _definition(namespaceId, referenceId, symbolB, classB, decimalsB);

        assertTrue(AssetDefinitionLib.hashDefinition(first) != AssetDefinitionLib.hashDefinition(second));
        assertEq(
            AssetId.unwrap(AssetDefinitionLib.deriveAssetId(first)),
            AssetId.unwrap(AssetDefinitionLib.deriveAssetId(second))
        );
    }

    function testFuzz_IdentityFieldsChangeAssetId(
        bytes32 namespaceId,
        bytes32 referenceId,
        bytes32 otherNamespaceId,
        bytes32 otherReferenceId,
        bytes32 symbol,
        uint8 assetClass,
        uint8 decimals
    ) public pure {
        vm.assume(namespaceId != otherNamespaceId);
        vm.assume(referenceId != otherReferenceId);

        AssetDefinition memory base = _definition(namespaceId, referenceId, symbol, assetClass, decimals);
        AssetDefinition memory otherNamespace = _definition(otherNamespaceId, referenceId, symbol, assetClass, decimals);
        AssetDefinition memory otherReference = _definition(namespaceId, otherReferenceId, symbol, assetClass, decimals);

        bytes32 baseId = AssetId.unwrap(AssetDefinitionLib.deriveAssetId(base));

        assertTrue(baseId != AssetId.unwrap(AssetDefinitionLib.deriveAssetId(otherNamespace)));
        assertTrue(baseId != AssetId.unwrap(AssetDefinitionLib.deriveAssetId(otherReference)));
    }

    function testFuzz_HashesMatchCanonicalPreimages(
        bytes32 namespaceId,
        bytes32 referenceId,
        bytes32 symbol,
        uint8 assetClass,
        uint8 decimals
    ) public pure {
        AssetDefinition memory definition = _definition(namespaceId, referenceId, symbol, assetClass, decimals);

        assertEq(
            AssetDefinitionLib.hashKey(definition),
            keccak256(abi.encode(AssetDefinitionLib.ASSET_KEY_TYPEHASH, namespaceId, referenceId))
        );
        assertEq(
            AssetDefinitionLib.hashDefinition(definition),
            keccak256(
                abi.encode(
                    AssetDefinitionLib.ASSET_DEFINITION_TYPEHASH,
                    namespaceId,
                    referenceId,
                    symbol,
                    uint8(definition.assetClass),
                    decimals
                )
            )
        );
        assertEq(
            AssetId.unwrap(AssetDefinitionLib.deriveAssetId(definition)),
            AssetId.unwrap(IdLib.deriveAssetId(AssetDefinitionLib.hashKey(definition)))
        );
    }

    function testFuzz_ValidAcrossEveryDecimalValue(
        bytes32 namespaceId,
        bytes32 referenceId,
        bytes32 symbol,
        uint8 decimals
    ) public view {
        vm.assume(namespaceId != bytes32(0));
        vm.assume(referenceId != bytes32(0));
        vm.assume(symbol != bytes32(0));

        harness.validate(_definition(namespaceId, referenceId, symbol, 1, decimals));
    }

    function testFuzz_ValidateRejectsEveryInvalidField(bytes32 namespaceId, bytes32 referenceId, bytes32 symbol)
        public
    {
        vm.assume(namespaceId != bytes32(0));
        vm.assume(referenceId != bytes32(0));
        vm.assume(symbol != bytes32(0));

        AssetDefinition memory zeroNamespace = _definition(namespaceId, referenceId, symbol, 1, 18);
        zeroNamespace.namespaceId = bytes32(0);
        vm.expectRevert(ZeroNamespaceId.selector);
        harness.validate(zeroNamespace);

        AssetDefinition memory zeroReference = _definition(namespaceId, referenceId, symbol, 1, 18);
        zeroReference.referenceId = bytes32(0);
        vm.expectRevert(ZeroReferenceId.selector);
        harness.validate(zeroReference);

        AssetDefinition memory zeroSymbol = _definition(namespaceId, referenceId, symbol, 1, 18);
        zeroSymbol.symbol = bytes32(0);
        vm.expectRevert(ZeroSymbol.selector);
        harness.validate(zeroSymbol);

        AssetDefinition memory unspecifiedClass = _definition(namespaceId, referenceId, symbol, 1, 18);
        unspecifiedClass.assetClass = AssetClass.Unspecified;
        vm.expectRevert(UnspecifiedAssetClass.selector);
        harness.validate(unspecifiedClass);
    }

    function testFuzz_DerivationIgnoresChainAndCallerContext(
        bytes32 namespaceId,
        bytes32 referenceId,
        bytes32 symbol,
        uint8 assetClass,
        uint8 decimals,
        uint64 chainId,
        uint64 blockNumber,
        uint64 timestamp,
        address caller
    ) public {
        chainId = uint64(bound(uint256(chainId), 1, type(uint64).max));
        blockNumber = uint64(bound(uint256(blockNumber), 1, type(uint64).max));
        timestamp = uint64(bound(uint256(timestamp), 1, type(uint64).max));
        vm.assume(caller != address(0));

        AssetDefinition memory definition = _definition(namespaceId, referenceId, symbol, assetClass, decimals);

        bytes32 baselineKey = harness.hashKey(definition);
        bytes32 baselineDefinition = harness.hashDefinition(definition);

        AssetDefinitionHarness other = new AssetDefinitionHarness();
        vm.chainId(chainId);
        vm.roll(blockNumber);
        vm.warp(timestamp);

        vm.prank(caller);
        assertEq(other.hashKey(definition), baselineKey);
        vm.prank(caller);
        assertEq(other.hashDefinition(definition), baselineDefinition);
    }

    function _definition(bytes32 namespaceId, bytes32 referenceId, bytes32 symbol, uint8 assetClass, uint8 decimals)
        internal
        pure
        returns (AssetDefinition memory)
    {
        return AssetDefinition({
            namespaceId: namespaceId,
            referenceId: referenceId,
            symbol: symbol,
            assetClass: AssetClass(assetClass % 8),
            decimals: decimals
        });
    }
}
