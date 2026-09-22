// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {ISettlementAssetRegistry} from "../../src/interfaces/ISettlementAssetRegistry.sol";
import {SettlementAssetLib} from "../../src/libraries/SettlementAssetLib.sol";
import {AssetRegistry} from "../../src/registry/AssetRegistry.sol";
import {SettlementAssetRegistry} from "../../src/registry/SettlementAssetRegistry.sol";
import {AssetDefinition} from "../../src/types/AssetDefinition.sol";
import {AssetClass, RegistryStatus} from "../../src/types/Enums.sol";
import {AssetId} from "../../src/types/Identifiers.sol";
import {SettlementAssetBinding, SettlementAssetDefinition} from "../../src/types/SettlementAssetDefinition.sol";
import {MAX_DECIMALS} from "../../src/types/Units.sol";
import {MockERC20Metadata} from "../mocks/TokenMocks.sol";

contract SettlementAssetRegistryFuzzTest is Test {
    uint48 internal constant ADMIN_DELAY = 3 days;

    bytes32 internal constant NAMESPACE_ID = keccak256("setryn.stablecoin");
    bytes32 internal constant REFERENCE_PRIMARY = keccak256("usd:primary");
    bytes32 internal constant SYMBOL = keccak256("SYM");

    uint8 internal constant CANONICAL_DECIMALS = 6;

    address internal admin = makeAddr("admin");
    address internal qualifier = makeAddr("qualifier");
    address internal statusManager = makeAddr("statusManager");

    AssetRegistry internal canonical;
    SettlementAssetRegistry internal registry;

    function setUp() public {
        canonical = new AssetRegistry(ADMIN_DELAY, admin);
        registry = new SettlementAssetRegistry(ADMIN_DELAY, admin, canonical);

        vm.startPrank(admin);
        registry.grantRole(registry.QUALIFIER_ROLE(), qualifier);
        registry.grantRole(registry.STATUS_MANAGER_ROLE(), statusManager);
        vm.stopPrank();
    }

    /// @dev The same token on two chains is two different contracts, so the two qualifications must
    /// commit to different hashes and must both be registrable.
    function testFuzz_DefinitionHashSeparatesChains(uint64 firstChainId, uint64 secondChainId) public {
        firstChainId = uint64(bound(firstChainId, 1, type(uint64).max));
        secondChainId = uint64(bound(secondChainId, 1, type(uint64).max));
        vm.assume(firstChainId != secondChainId);

        AssetId assetId = _registerCanonicalAsset(REFERENCE_PRIMARY, CANONICAL_DECIMALS);
        address token = address(new MockERC20Metadata(CANONICAL_DECIMALS));
        SettlementAssetDefinition memory definition = _definition(assetId, token, keccak256("qualification"));

        vm.chainId(firstChainId);
        vm.prank(qualifier);
        uint32 first = registry.registerBinding(definition);

        vm.chainId(secondChainId);
        vm.prank(qualifier);
        uint32 second = registry.registerBinding(definition);

        assertEq(first, 1);
        assertEq(second, 2);

        bytes32 firstHash = registry.getBinding(assetId, first).definitionHash;
        bytes32 secondHash = registry.getBinding(assetId, second).definitionHash;

        assertEq(firstHash, SettlementAssetLib.hashDefinition(definition, firstChainId));
        assertEq(secondHash, SettlementAssetLib.hashDefinition(definition, secondChainId));
        assertTrue(firstHash != secondHash);
    }

    /// @dev Versions are handed out in order, every one of them stays readable and unchanged, and a
    /// resubmission of any already stored definition is always rejected.
    function testFuzz_VersionsAreSequentialAndImmutable(bytes32[4] memory qualificationSeeds) public {
        AssetId assetId = _registerCanonicalAsset(REFERENCE_PRIMARY, CANONICAL_DECIMALS);
        address token = address(new MockERC20Metadata(CANONICAL_DECIMALS));

        bytes32[4] memory storedHashes;

        for (uint256 i = 0; i < qualificationSeeds.length; i++) {
            SettlementAssetDefinition memory definition =
                _definition(assetId, token, keccak256(abi.encode(qualificationSeeds[i], i)));

            vm.prank(qualifier);
            uint32 version = registry.registerBinding(definition);

            assertEq(version, uint32(i + 1));
            assertEq(registry.latestVersion(assetId), version);
            assertEq(registry.bindingCount(), i + 1);

            storedHashes[i] = registry.getBinding(assetId, version).definitionHash;

            vm.expectRevert(
                abi.encodeWithSelector(
                    ISettlementAssetRegistry.DuplicateSettlementDefinition.selector, assetId, storedHashes[i], version
                )
            );
            vm.prank(qualifier);
            registry.registerBinding(definition);
        }

        for (uint256 i = 0; i < qualificationSeeds.length; i++) {
            uint32 version = uint32(i + 1);
            SettlementAssetBinding memory binding = registry.getBinding(assetId, version);

            assertEq(binding.version, version);
            assertEq(binding.definitionHash, storedHashes[i]);
            assertEq(binding.decimals, CANONICAL_DECIMALS);
            assertEq(binding.definition.token, token);
            assertEq(binding.versionHash, SettlementAssetLib.hashVersion(storedHashes[i], version, CANONICAL_DECIMALS));
            assertEq(uint8(binding.status), uint8(RegistryStatus.Paused));
            assertTrue(registry.isLifecycleEnabled(assetId, version));
            assertFalse(registry.isOpenForNewRisk(assetId, version));
        }
    }

    function testFuzz_ReportedDecimalsMustEqualCanonical(uint8 canonicalDecimals, uint8 reportedDecimals) public {
        canonicalDecimals = uint8(bound(canonicalDecimals, 0, MAX_DECIMALS));

        AssetId assetId = _registerCanonicalAsset(REFERENCE_PRIMARY, canonicalDecimals);
        address token = address(new MockERC20Metadata(reportedDecimals));
        SettlementAssetDefinition memory definition = _definition(assetId, token, keccak256("qualification"));

        if (reportedDecimals != canonicalDecimals) {
            vm.expectRevert(
                abi.encodeWithSelector(
                    ISettlementAssetRegistry.TokenDecimalsMismatch.selector, token, canonicalDecimals, reportedDecimals
                )
            );
            vm.prank(qualifier);
            registry.registerBinding(definition);

            assertEq(registry.bindingCount(), 0);
            return;
        }

        vm.prank(qualifier);
        uint32 version = registry.registerBinding(definition);

        assertEq(registry.getBinding(assetId, version).decimals, canonicalDecimals);
    }

    function testFuzz_UnknownBindingsAreNeverMutable(bytes32 rawAssetId, uint32 version) public {
        AssetId unknown = AssetId.wrap(rawAssetId);

        assertEq(uint8(registry.statusOf(unknown, version)), uint8(RegistryStatus.Unspecified));
        assertFalse(registry.isLifecycleEnabled(unknown, version));
        assertFalse(registry.isOpenForNewRisk(unknown, version));
        assertFalse(registry.runtimeMatches(unknown, version));

        vm.expectRevert(abi.encodeWithSelector(ISettlementAssetRegistry.UnknownBinding.selector, unknown, version));
        registry.getBinding(unknown, version);

        vm.startPrank(statusManager);
        vm.expectRevert(abi.encodeWithSelector(ISettlementAssetRegistry.UnknownBinding.selector, unknown, version));
        registry.activateBinding(unknown, version);

        vm.expectRevert(abi.encodeWithSelector(ISettlementAssetRegistry.UnknownBinding.selector, unknown, version));
        registry.pauseBinding(unknown, version);

        vm.expectRevert(abi.encodeWithSelector(ISettlementAssetRegistry.UnknownBinding.selector, unknown, version));
        registry.deprecateBinding(unknown, version);
        vm.stopPrank();

        assertEq(registry.bindingCount(), 0);
        assertEq(registry.activeVersion(unknown), 0);
        assertEq(registry.latestVersion(unknown), 0);
    }

    function _registerCanonicalAsset(bytes32 referenceId, uint8 decimals) internal returns (AssetId) {
        vm.prank(admin);
        return canonical.registerAsset(
            AssetDefinition({
                namespaceId: NAMESPACE_ID,
                referenceId: referenceId,
                symbol: SYMBOL,
                assetClass: AssetClass.Stablecoin,
                decimals: decimals
            })
        );
    }

    function _definition(AssetId assetId, address token, bytes32 qualificationHash)
        internal
        view
        returns (SettlementAssetDefinition memory)
    {
        return SettlementAssetDefinition({
            assetId: assetId,
            token: token,
            expectedRuntimeCodeHash: token.codehash,
            qualificationHash: qualificationHash
        });
    }
}
