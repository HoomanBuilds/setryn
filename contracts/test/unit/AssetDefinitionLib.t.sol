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
import {AssetDefinitionHarness} from "./harness/AssetDefinitionHarness.sol";

contract AssetDefinitionLibTest is Test {
    /// @dev The fixture is pinned as raw bytes so the vectors below can never move. The values are
    /// the right-padded ASCII of "setryn.crypto", "ethereum:native", and "WETH".
    bytes32 internal constant GOLDEN_NAMESPACE_ID = 0x73657472796e2e63727970746f00000000000000000000000000000000000000;
    bytes32 internal constant GOLDEN_REFERENCE_ID = 0x657468657265756d3a6e61746976650000000000000000000000000000000000;
    bytes32 internal constant GOLDEN_SYMBOL = 0x5745544800000000000000000000000000000000000000000000000000000000;

    bytes32 internal constant ALTERNATE_NAMESPACE_ID = keccak256("setryn.fx");
    bytes32 internal constant ALTERNATE_REFERENCE_ID = keccak256("ethereum:weth");
    bytes32 internal constant ALTERNATE_SYMBOL = keccak256("WETH9");

    bytes32 internal constant GOLDEN_KEY_TYPEHASH = 0x31745b1d79faea2f157742bd6af378c3c2921a839f8b31c9a6dbf5d3f75a9d9a;
    bytes32 internal constant GOLDEN_DEFINITION_TYPEHASH =
        0x587943913c33d237e9d5881f60ccef9f62d397c4851c536b839eac28fc5a6acc;

    bytes32 internal constant GOLDEN_KEY_HASH = 0x17c984797a4160ae0c48735a0f7bddd7702b98aaccf6e7bd76390707fe24cbe0;
    bytes32 internal constant GOLDEN_DEFINITION_HASH =
        0xd3ae754c4c93ad746f8c804845a7b23cedeb27679dace1da2b841280d9a4317f;
    bytes32 internal constant GOLDEN_ASSET_ID = 0x7c25c65f641a90495b0e4a899e948458716a123e4b9a0cff7a235db4c6d5d766;

    AssetDefinitionHarness internal harness;

    function setUp() public {
        harness = new AssetDefinitionHarness();
    }

    function test_TypehashesMatchVersionedLiterals() public pure {
        assertEq(
            AssetDefinitionLib.ASSET_KEY_TYPEHASH,
            keccak256(bytes("SetrynAssetKeyV1(bytes32 namespaceId,bytes32 referenceId)"))
        );
        assertEq(
            AssetDefinitionLib.ASSET_DEFINITION_TYPEHASH,
            keccak256(
                bytes(
                    "SetrynAssetDefinitionV1(bytes32 namespaceId,bytes32 referenceId,bytes32 symbol,uint8 assetClass,uint8 decimals)"
                )
            )
        );
    }

    function test_TypehashesMatchTypestrings() public pure {
        assertEq(AssetDefinitionLib.ASSET_KEY_TYPEHASH, keccak256(bytes(AssetDefinitionLib.ASSET_KEY_TYPESTRING)));
        assertEq(
            AssetDefinitionLib.ASSET_DEFINITION_TYPEHASH,
            keccak256(bytes(AssetDefinitionLib.ASSET_DEFINITION_TYPESTRING))
        );
    }

    function test_TypehashesAreFrozen() public pure {
        assertEq(AssetDefinitionLib.ASSET_KEY_TYPEHASH, GOLDEN_KEY_TYPEHASH);
        assertEq(AssetDefinitionLib.ASSET_DEFINITION_TYPEHASH, GOLDEN_DEFINITION_TYPEHASH);
    }

    function test_KeyAndDefinitionTypehashesAreDistinct() public pure {
        assertTrue(AssetDefinitionLib.ASSET_KEY_TYPEHASH != AssetDefinitionLib.ASSET_DEFINITION_TYPEHASH);
    }

    function test_GoldenFixtureFieldsAreDistinctAndNonZero() public pure {
        assertTrue(GOLDEN_NAMESPACE_ID != bytes32(0));
        assertTrue(GOLDEN_REFERENCE_ID != bytes32(0));
        assertTrue(GOLDEN_SYMBOL != bytes32(0));
        assertTrue(GOLDEN_NAMESPACE_ID != GOLDEN_REFERENCE_ID);
        assertTrue(GOLDEN_REFERENCE_ID != GOLDEN_SYMBOL);
    }

    function test_GoldenKeyHash() public pure {
        assertEq(AssetDefinitionLib.hashKey(_golden()), GOLDEN_KEY_HASH);
    }

    function test_GoldenDefinitionHash() public pure {
        assertEq(AssetDefinitionLib.hashDefinition(_golden()), GOLDEN_DEFINITION_HASH);
    }

    function test_GoldenAssetId() public pure {
        assertEq(AssetId.unwrap(AssetDefinitionLib.deriveAssetId(_golden())), GOLDEN_ASSET_ID);
    }

    function test_KeyHashMatchesCanonicalPreimage() public pure {
        AssetDefinition memory definition = _golden();

        assertEq(
            AssetDefinitionLib.hashKey(definition),
            keccak256(abi.encode(AssetDefinitionLib.ASSET_KEY_TYPEHASH, definition.namespaceId, definition.referenceId))
        );
    }

    function test_DefinitionHashMatchesCanonicalPreimage() public pure {
        AssetDefinition memory definition = _golden();

        assertEq(
            AssetDefinitionLib.hashDefinition(definition),
            keccak256(
                abi.encode(
                    AssetDefinitionLib.ASSET_DEFINITION_TYPEHASH,
                    definition.namespaceId,
                    definition.referenceId,
                    definition.symbol,
                    uint8(definition.assetClass),
                    definition.decimals
                )
            )
        );
    }

    function test_AssetIdIsDerivedFromKeyHash() public pure {
        AssetDefinition memory definition = _golden();

        assertEq(
            AssetId.unwrap(AssetDefinitionLib.deriveAssetId(definition)),
            AssetId.unwrap(IdLib.deriveAssetId(AssetDefinitionLib.hashKey(definition)))
        );
    }

    function test_KeyHashAndDefinitionHashDifferForTheSameDefinition() public pure {
        AssetDefinition memory definition = _golden();

        assertTrue(AssetDefinitionLib.hashKey(definition) != AssetDefinitionLib.hashDefinition(definition));
    }

    function test_SymbolDoesNotAffectAssetId() public pure {
        AssetDefinition memory changed = _golden();
        changed.symbol = ALTERNATE_SYMBOL;

        assertEq(
            AssetId.unwrap(AssetDefinitionLib.deriveAssetId(changed)),
            AssetId.unwrap(AssetDefinitionLib.deriveAssetId(_golden()))
        );
        assertTrue(AssetDefinitionLib.hashDefinition(changed) != GOLDEN_DEFINITION_HASH);
    }

    function test_AssetClassDoesNotAffectAssetId() public pure {
        AssetDefinition memory changed = _golden();
        changed.assetClass = AssetClass.TokenizedAsset;

        assertEq(
            AssetId.unwrap(AssetDefinitionLib.deriveAssetId(changed)),
            AssetId.unwrap(AssetDefinitionLib.deriveAssetId(_golden()))
        );
        assertTrue(AssetDefinitionLib.hashDefinition(changed) != GOLDEN_DEFINITION_HASH);
    }

    function test_DecimalsDoNotAffectAssetId() public pure {
        AssetDefinition memory changed = _golden();
        changed.decimals = 6;

        assertEq(
            AssetId.unwrap(AssetDefinitionLib.deriveAssetId(changed)),
            AssetId.unwrap(AssetDefinitionLib.deriveAssetId(_golden()))
        );
        assertTrue(AssetDefinitionLib.hashDefinition(changed) != GOLDEN_DEFINITION_HASH);
    }

    function test_NamespaceChangesAssetId() public pure {
        AssetDefinition memory changed = _golden();
        changed.namespaceId = ALTERNATE_NAMESPACE_ID;

        assertTrue(
            AssetId.unwrap(AssetDefinitionLib.deriveAssetId(changed))
                != AssetId.unwrap(AssetDefinitionLib.deriveAssetId(_golden()))
        );
    }

    function test_ReferenceChangesAssetId() public pure {
        AssetDefinition memory changed = _golden();
        changed.referenceId = ALTERNATE_REFERENCE_ID;

        assertTrue(
            AssetId.unwrap(AssetDefinitionLib.deriveAssetId(changed))
                != AssetId.unwrap(AssetDefinitionLib.deriveAssetId(_golden()))
        );
    }

    /// @dev A namespace and reference swap must not collide, which abi.encodePacked would permit.
    function test_SwappedIdentityFieldsDoNotCollide() public pure {
        AssetDefinition memory swapped = _golden();
        swapped.namespaceId = GOLDEN_REFERENCE_ID;
        swapped.referenceId = GOLDEN_NAMESPACE_ID;

        assertTrue(AssetDefinitionLib.hashKey(swapped) != GOLDEN_KEY_HASH);
    }

    function test_ValidateAcceptsGoldenDefinition() public view {
        harness.validate(_golden());
    }

    function test_ValidateImposesNoDecimalCap() public view {
        AssetDefinition memory zeroDecimals = _golden();
        zeroDecimals.decimals = 0;
        harness.validate(zeroDecimals);

        AssetDefinition memory maxDecimals = _golden();
        maxDecimals.decimals = type(uint8).max;
        harness.validate(maxDecimals);
    }

    function test_ValidateRejectsZeroNamespaceId() public {
        AssetDefinition memory invalid = _golden();
        invalid.namespaceId = bytes32(0);

        vm.expectRevert(ZeroNamespaceId.selector);
        harness.validate(invalid);
    }

    function test_ValidateRejectsZeroReferenceId() public {
        AssetDefinition memory invalid = _golden();
        invalid.referenceId = bytes32(0);

        vm.expectRevert(ZeroReferenceId.selector);
        harness.validate(invalid);
    }

    function test_ValidateRejectsZeroSymbol() public {
        AssetDefinition memory invalid = _golden();
        invalid.symbol = bytes32(0);

        vm.expectRevert(ZeroSymbol.selector);
        harness.validate(invalid);
    }

    function test_ValidateRejectsUnspecifiedAssetClass() public {
        AssetDefinition memory invalid = _golden();
        invalid.assetClass = AssetClass.Unspecified;

        vm.expectRevert(UnspecifiedAssetClass.selector);
        harness.validate(invalid);
    }

    function test_ValidateRejectsAnEmptyDefinition() public {
        AssetDefinition memory empty;

        vm.expectRevert(ZeroNamespaceId.selector);
        harness.validate(empty);
    }

    function test_DerivationIgnoresChainAndCallerContext() public {
        AssetDefinitionHarness other = new AssetDefinitionHarness();
        assertTrue(address(other) != address(harness));

        bytes32 baselineKey = harness.hashKey(_golden());
        bytes32 baselineDefinition = harness.hashDefinition(_golden());
        AssetId baselineId = harness.deriveAssetId(_golden());

        vm.chainId(421614);
        vm.roll(block.number + 10_000);
        vm.warp(block.timestamp + 10_000);
        vm.prank(address(0xBEEF));

        assertEq(other.hashKey(_golden()), baselineKey);
        assertEq(other.hashDefinition(_golden()), baselineDefinition);
        assertEq(AssetId.unwrap(other.deriveAssetId(_golden())), AssetId.unwrap(baselineId));
    }

    function _golden() internal pure returns (AssetDefinition memory) {
        return AssetDefinition({
            namespaceId: GOLDEN_NAMESPACE_ID,
            referenceId: GOLDEN_REFERENCE_ID,
            symbol: GOLDEN_SYMBOL,
            assetClass: AssetClass.Crypto,
            decimals: 18
        });
    }
}
