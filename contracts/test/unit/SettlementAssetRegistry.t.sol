// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Test} from "forge-std/Test.sol";

import {IAssetRegistry} from "../../src/interfaces/IAssetRegistry.sol";
import {ISettlementAssetRegistry} from "../../src/interfaces/ISettlementAssetRegistry.sol";
import {
    RuntimeCodeHashMismatch,
    SettlementAssetLib,
    SettlementTokenHasNoCode,
    ZeroQualificationHash,
    ZeroRuntimeCodeHash,
    ZeroSettlementToken
} from "../../src/libraries/SettlementAssetLib.sol";
import {AssetRegistry} from "../../src/registry/AssetRegistry.sol";
import {SettlementAssetRegistry} from "../../src/registry/SettlementAssetRegistry.sol";
import {AssetDefinition} from "../../src/types/AssetDefinition.sol";
import {AssetClass, RegistryStatus} from "../../src/types/Enums.sol";
import {AssetId} from "../../src/types/Identifiers.sol";
import {SettlementAssetBinding, SettlementAssetDefinition} from "../../src/types/SettlementAssetDefinition.sol";
import {MAX_DECIMALS} from "../../src/types/Units.sol";
import {
    MockERC20Metadata,
    OversizedDecimalsToken,
    RevertingDecimalsToken,
    ShortReturnDecimalsToken,
    SilentDecimalsToken
} from "../mocks/TokenMocks.sol";

contract SettlementAssetRegistryTest is Test {
    uint48 internal constant ADMIN_DELAY = 3 days;

    bytes32 internal constant NAMESPACE_ID = keccak256("setryn.stablecoin");
    bytes32 internal constant REFERENCE_PRIMARY = keccak256("usd:primary");
    bytes32 internal constant REFERENCE_SECONDARY = keccak256("usd:secondary");
    bytes32 internal constant REFERENCE_WIDE = keccak256("usd:wide");
    bytes32 internal constant SYMBOL = keccak256("SYM");

    bytes32 internal constant QUALIFICATION_ONE = keccak256("qualification.one");
    bytes32 internal constant QUALIFICATION_TWO = keccak256("qualification.two");

    uint8 internal constant CANONICAL_DECIMALS = 6;

    address internal admin = makeAddr("admin");
    address internal qualifier = makeAddr("qualifier");
    address internal statusManager = makeAddr("statusManager");
    address internal outsider = makeAddr("outsider");

    AssetRegistry internal canonical;
    SettlementAssetRegistry internal registry;

    MockERC20Metadata internal token;
    MockERC20Metadata internal otherToken;

    AssetId internal assetId;
    AssetId internal secondaryAssetId;

    function setUp() public {
        canonical = new AssetRegistry(ADMIN_DELAY, admin);
        registry = new SettlementAssetRegistry(ADMIN_DELAY, admin, canonical);

        vm.startPrank(admin);
        registry.grantRole(registry.QUALIFIER_ROLE(), qualifier);
        registry.grantRole(registry.STATUS_MANAGER_ROLE(), statusManager);
        assetId = canonical.registerAsset(_canonicalDefinition(REFERENCE_PRIMARY, CANONICAL_DECIMALS));
        secondaryAssetId = canonical.registerAsset(_canonicalDefinition(REFERENCE_SECONDARY, CANONICAL_DECIMALS));
        vm.stopPrank();

        token = new MockERC20Metadata(CANONICAL_DECIMALS);
        otherToken = new MockERC20Metadata(CANONICAL_DECIMALS);
    }

    function test_RoleConstantsAreFrozenAndDistinct() public view {
        assertEq(registry.QUALIFIER_ROLE(), keccak256(bytes("SETRYN_QUALIFIER_ROLE")));
        assertEq(registry.STATUS_MANAGER_ROLE(), keccak256(bytes("SETRYN_SETTLEMENT_STATUS_MANAGER_ROLE")));
        assertTrue(registry.QUALIFIER_ROLE() != registry.STATUS_MANAGER_ROLE());
        assertTrue(registry.QUALIFIER_ROLE() != registry.DEFAULT_ADMIN_ROLE());
        assertTrue(registry.STATUS_MANAGER_ROLE() != registry.DEFAULT_ADMIN_ROLE());
        assertTrue(registry.STATUS_MANAGER_ROLE() != canonical.STATUS_MANAGER_ROLE());
    }

    function test_ConstructorGrantsOperationalRolesToInitialAdmin() public {
        SettlementAssetRegistry fresh = new SettlementAssetRegistry(ADMIN_DELAY, admin, canonical);

        assertTrue(fresh.hasRole(fresh.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(fresh.hasRole(fresh.QUALIFIER_ROLE(), admin));
        assertTrue(fresh.hasRole(fresh.STATUS_MANAGER_ROLE(), admin));
        assertEq(fresh.defaultAdmin(), admin);
        assertEq(fresh.defaultAdminDelay(), ADMIN_DELAY);
        assertEq(address(fresh.assetRegistry()), address(canonical));
        assertEq(fresh.bindingCount(), 0);
    }

    function test_ConstructorRejectsZeroInitialAdmin() public {
        vm.expectRevert(ISettlementAssetRegistry.ZeroInitialAdmin.selector);
        new SettlementAssetRegistry(ADMIN_DELAY, address(0), canonical);
    }

    function test_ConstructorRejectsZeroAssetRegistry() public {
        vm.expectRevert(ISettlementAssetRegistry.ZeroAssetRegistry.selector);
        new SettlementAssetRegistry(ADMIN_DELAY, admin, IAssetRegistry(address(0)));
    }

    function test_ConstructorRejectsAssetRegistryWithoutCode() public {
        vm.expectRevert(abi.encodeWithSelector(ISettlementAssetRegistry.AssetRegistryHasNoCode.selector, outsider));
        new SettlementAssetRegistry(ADMIN_DELAY, admin, IAssetRegistry(outsider));
    }

    function test_QualifierCannotChangeStatusWithoutTheStatusRole() public {
        uint32 version = _register(_definition(assetId, address(token), QUALIFICATION_ONE));
        bytes32 statusRole = registry.STATUS_MANAGER_ROLE();

        assertFalse(registry.hasRole(statusRole, qualifier));

        vm.startPrank(qualifier);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, qualifier, statusRole)
        );
        registry.activateBinding(assetId, version);

        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, qualifier, statusRole)
        );
        registry.pauseBinding(assetId, version);

        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, qualifier, statusRole)
        );
        registry.deprecateBinding(assetId, version);
        vm.stopPrank();

        assertEq(uint8(registry.statusOf(assetId, version)), uint8(RegistryStatus.Paused));
        assertEq(registry.activeVersion(assetId), 0);
    }

    function test_StatusManagerAndOutsiderCannotRegister() public {
        SettlementAssetDefinition memory definition = _definition(assetId, address(token), QUALIFICATION_ONE);
        bytes32 qualifierRole = registry.QUALIFIER_ROLE();

        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, statusManager, qualifierRole
            )
        );
        vm.prank(statusManager);
        registry.registerBinding(definition);

        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, outsider, qualifierRole)
        );
        vm.prank(outsider);
        registry.registerBinding(definition);

        assertEq(registry.bindingCount(), 0);
    }

    function test_RegisterStoresImmutableVersionAndEmitsCompleteEvent() public {
        SettlementAssetDefinition memory definition = _definition(assetId, address(token), QUALIFICATION_ONE);
        bytes32 definitionHash = SettlementAssetLib.hashDefinition(definition, block.chainid);
        bytes32 versionHash = SettlementAssetLib.hashVersion(definitionHash, 1, CANONICAL_DECIMALS);

        vm.expectEmit(true, true, true, true, address(registry));
        emit ISettlementAssetRegistry.SettlementAssetRegistered(
            assetId,
            1,
            versionHash,
            definitionHash,
            address(token),
            address(token).codehash,
            CANONICAL_DECIMALS,
            QUALIFICATION_ONE,
            block.chainid,
            qualifier
        );

        vm.prank(qualifier);
        uint32 version = registry.registerBinding(definition);

        assertEq(version, 1);

        SettlementAssetBinding memory binding = registry.getBinding(assetId, version);

        assertEq(AssetId.unwrap(binding.definition.assetId), AssetId.unwrap(assetId));
        assertEq(binding.definition.token, address(token));
        assertEq(binding.definition.expectedRuntimeCodeHash, address(token).codehash);
        assertEq(binding.definition.qualificationHash, QUALIFICATION_ONE);
        assertEq(binding.definitionHash, definitionHash);
        assertEq(binding.versionHash, versionHash);
        assertEq(binding.version, 1);
        assertEq(binding.decimals, CANONICAL_DECIMALS);
        assertEq(uint8(binding.status), uint8(RegistryStatus.Paused));

        assertEq(registry.latestVersion(assetId), 1);
        assertEq(registry.bindingCount(), 1);
        assertEq(AssetId.unwrap(registry.tokenAsset(address(token))), AssetId.unwrap(assetId));

        assertEq(registry.activeVersion(assetId), 0);
        assertFalse(registry.isOpenForNewRisk(assetId, version));
        assertTrue(registry.isLifecycleEnabled(assetId, version));
        assertTrue(registry.runtimeMatches(assetId, version));
    }

    function test_VersionsAreSequentialPerAsset() public {
        uint32 first = _register(_definition(assetId, address(token), QUALIFICATION_ONE));
        uint32 second = _register(_definition(assetId, address(otherToken), QUALIFICATION_TWO));
        address secondaryToken = address(new MockERC20Metadata(CANONICAL_DECIMALS));
        uint32 otherAssetFirst = _register(_definition(secondaryAssetId, secondaryToken, QUALIFICATION_ONE));

        assertEq(first, 1);
        assertEq(second, 2);
        assertEq(otherAssetFirst, 1);
        assertEq(registry.latestVersion(assetId), 2);
        assertEq(registry.latestVersion(secondaryAssetId), 1);
        assertEq(registry.bindingCount(), 3);
    }

    function test_DuplicateDefinitionHashIsRejected() public {
        SettlementAssetDefinition memory definition = _definition(assetId, address(token), QUALIFICATION_ONE);
        uint32 version = _register(definition);

        vm.expectRevert(
            abi.encodeWithSelector(
                ISettlementAssetRegistry.DuplicateSettlementDefinition.selector,
                assetId,
                SettlementAssetLib.hashDefinition(definition, block.chainid),
                version
            )
        );
        vm.prank(qualifier);
        registry.registerBinding(definition);

        assertEq(registry.latestVersion(assetId), 1);
        assertEq(registry.bindingCount(), 1);
    }

    function test_RegisterRejectsUnknownCanonicalAsset() public {
        AssetId unknown = AssetId.wrap(keccak256("never registered"));

        vm.expectRevert(abi.encodeWithSelector(ISettlementAssetRegistry.UnknownCanonicalAsset.selector, unknown));
        vm.prank(qualifier);
        registry.registerBinding(_definition(unknown, address(token), QUALIFICATION_ONE));

        assertEq(registry.bindingCount(), 0);
    }

    function test_RegisterRejectsMalformedDefinitionFields() public {
        SettlementAssetDefinition memory zeroToken = _definition(assetId, address(0), QUALIFICATION_ONE);
        zeroToken.expectedRuntimeCodeHash = keccak256("placeholder");

        vm.expectRevert(ZeroSettlementToken.selector);
        vm.prank(qualifier);
        registry.registerBinding(zeroToken);

        SettlementAssetDefinition memory codeless = _definition(assetId, outsider, QUALIFICATION_ONE);
        codeless.expectedRuntimeCodeHash = keccak256("placeholder");

        vm.expectRevert(abi.encodeWithSelector(SettlementTokenHasNoCode.selector, outsider));
        vm.prank(qualifier);
        registry.registerBinding(codeless);

        vm.expectRevert(ZeroQualificationHash.selector);
        vm.prank(qualifier);
        registry.registerBinding(_definition(assetId, address(token), bytes32(0)));

        assertEq(registry.bindingCount(), 0);
    }

    function test_RegisterRejectsZeroOrMismatchedRuntimeCodeHash() public {
        SettlementAssetDefinition memory zeroHash = _definition(assetId, address(token), QUALIFICATION_ONE);
        zeroHash.expectedRuntimeCodeHash = bytes32(0);

        vm.expectRevert(ZeroRuntimeCodeHash.selector);
        vm.prank(qualifier);
        registry.registerBinding(zeroHash);

        SettlementAssetDefinition memory wrongHash = _definition(assetId, address(token), QUALIFICATION_ONE);
        wrongHash.expectedRuntimeCodeHash = keccak256("some other runtime");

        vm.expectRevert(
            abi.encodeWithSelector(
                RuntimeCodeHashMismatch.selector,
                address(token),
                wrongHash.expectedRuntimeCodeHash,
                address(token).codehash
            )
        );
        vm.prank(qualifier);
        registry.registerBinding(wrongHash);

        assertEq(registry.bindingCount(), 0);
    }

    function test_RegisterRejectsUnreadableDecimals() public {
        address reverting = address(new RevertingDecimalsToken());
        address silent = address(new SilentDecimalsToken());
        address short = address(new ShortReturnDecimalsToken());
        address oversized = address(new OversizedDecimalsToken());

        vm.startPrank(qualifier);
        vm.expectRevert(abi.encodeWithSelector(ISettlementAssetRegistry.TokenDecimalsUnavailable.selector, reverting));
        registry.registerBinding(_definition(assetId, reverting, QUALIFICATION_ONE));

        vm.expectRevert(abi.encodeWithSelector(ISettlementAssetRegistry.TokenDecimalsUnavailable.selector, silent));
        registry.registerBinding(_definition(assetId, silent, QUALIFICATION_ONE));

        vm.expectRevert(abi.encodeWithSelector(ISettlementAssetRegistry.TokenDecimalsUnavailable.selector, short));
        registry.registerBinding(_definition(assetId, short, QUALIFICATION_ONE));

        vm.expectRevert(
            abi.encodeWithSelector(ISettlementAssetRegistry.TokenDecimalsMalformed.selector, oversized, uint256(300))
        );
        registry.registerBinding(_definition(assetId, oversized, QUALIFICATION_ONE));
        vm.stopPrank();

        assertEq(registry.bindingCount(), 0);
    }

    function test_RegisterRejectsDecimalsMismatch() public {
        token.setDecimals(CANONICAL_DECIMALS + 1);

        vm.expectRevert(
            abi.encodeWithSelector(
                ISettlementAssetRegistry.TokenDecimalsMismatch.selector,
                address(token),
                CANONICAL_DECIMALS,
                CANONICAL_DECIMALS + 1
            )
        );
        vm.prank(qualifier);
        registry.registerBinding(_definition(assetId, address(token), QUALIFICATION_ONE));

        assertEq(registry.bindingCount(), 0);
    }

    function test_RegisterRejectsCanonicalDecimalsAboveMaxDecimals() public {
        uint8 wideDecimals = MAX_DECIMALS + 1;

        vm.prank(admin);
        AssetId wideAssetId = canonical.registerAsset(_canonicalDefinition(REFERENCE_WIDE, wideDecimals));

        vm.expectRevert(
            abi.encodeWithSelector(
                ISettlementAssetRegistry.CanonicalDecimalsOutOfRange.selector, wideAssetId, wideDecimals, MAX_DECIMALS
            )
        );
        vm.prank(qualifier);
        registry.registerBinding(_definition(wideAssetId, address(token), QUALIFICATION_ONE));

        assertEq(registry.bindingCount(), 0);
    }

    function test_TokenCannotBindToASecondAsset() public {
        _register(_definition(assetId, address(token), QUALIFICATION_ONE));

        vm.expectRevert(
            abi.encodeWithSelector(
                ISettlementAssetRegistry.TokenBoundToDifferentAsset.selector, address(token), assetId, secondaryAssetId
            )
        );
        vm.prank(qualifier);
        registry.registerBinding(_definition(secondaryAssetId, address(token), QUALIFICATION_ONE));

        assertEq(registry.bindingCount(), 1);
        assertEq(AssetId.unwrap(registry.tokenAsset(address(token))), AssetId.unwrap(assetId));

        uint32 second = _register(_definition(assetId, address(token), QUALIFICATION_TWO));

        assertEq(second, 2);
        assertEq(registry.getBinding(assetId, second).definition.token, address(token));
    }

    function test_TransitionGraphAndTerminalDeprecation() public {
        uint32 version = _register(_definition(assetId, address(token), QUALIFICATION_ONE));

        vm.startPrank(statusManager);
        _expectInvalidTransition(version, RegistryStatus.Paused, RegistryStatus.Paused);
        registry.pauseBinding(assetId, version);

        vm.expectEmit(true, true, true, true, address(registry));
        emit ISettlementAssetRegistry.SettlementAssetStatusChanged(
            assetId, version, RegistryStatus.Paused, RegistryStatus.Active, statusManager
        );
        registry.activateBinding(assetId, version);

        _expectInvalidTransition(version, RegistryStatus.Active, RegistryStatus.Active);
        registry.activateBinding(assetId, version);

        registry.pauseBinding(assetId, version);
        assertEq(uint8(registry.statusOf(assetId, version)), uint8(RegistryStatus.Paused));

        registry.deprecateBinding(assetId, version);
        assertEq(uint8(registry.statusOf(assetId, version)), uint8(RegistryStatus.Deprecated));

        _expectInvalidTransition(version, RegistryStatus.Deprecated, RegistryStatus.Active);
        registry.activateBinding(assetId, version);

        _expectInvalidTransition(version, RegistryStatus.Deprecated, RegistryStatus.Paused);
        registry.pauseBinding(assetId, version);

        _expectInvalidTransition(version, RegistryStatus.Deprecated, RegistryStatus.Deprecated);
        registry.deprecateBinding(assetId, version);
        vm.stopPrank();

        assertEq(uint8(registry.statusOf(assetId, version)), uint8(RegistryStatus.Deprecated));
    }

    function test_OnlyOneVersionPerAssetMayBeActive() public {
        uint32 first = _register(_definition(assetId, address(token), QUALIFICATION_ONE));
        uint32 second = _register(_definition(assetId, address(token), QUALIFICATION_TWO));

        vm.prank(statusManager);
        registry.activateBinding(assetId, first);

        vm.expectRevert(abi.encodeWithSelector(ISettlementAssetRegistry.AnotherVersionActive.selector, assetId, first));
        vm.prank(statusManager);
        registry.activateBinding(assetId, second);

        assertEq(registry.activeVersion(assetId), first);
        assertEq(uint8(registry.statusOf(assetId, second)), uint8(RegistryStatus.Paused));
        assertTrue(registry.isOpenForNewRisk(assetId, first));
        assertFalse(registry.isOpenForNewRisk(assetId, second));
    }

    function test_PausingOrDeprecatingTheActiveVersionClearsThePointer() public {
        uint32 first = _register(_definition(assetId, address(token), QUALIFICATION_ONE));
        uint32 second = _register(_definition(assetId, address(token), QUALIFICATION_TWO));

        vm.startPrank(statusManager);
        registry.activateBinding(assetId, first);

        vm.expectEmit(true, true, true, true, address(registry));
        emit ISettlementAssetRegistry.SettlementAssetActiveVersionChanged(assetId, first, 0, statusManager);
        registry.pauseBinding(assetId, first);

        assertEq(registry.activeVersion(assetId), 0);

        registry.activateBinding(assetId, second);
        assertEq(registry.activeVersion(assetId), second);
        assertEq(uint8(registry.statusOf(assetId, first)), uint8(RegistryStatus.Paused));

        vm.expectEmit(true, true, true, true, address(registry));
        emit ISettlementAssetRegistry.SettlementAssetActiveVersionChanged(assetId, second, 0, statusManager);
        registry.deprecateBinding(assetId, second);
        vm.stopPrank();

        assertEq(registry.activeVersion(assetId), 0);
    }

    function test_CanonicalPauseBlocksNewRiskAndActivationButNotLifecycle() public {
        uint32 version = _register(_definition(assetId, address(token), QUALIFICATION_ONE));

        vm.prank(statusManager);
        registry.activateBinding(assetId, version);
        assertTrue(registry.isOpenForNewRisk(assetId, version));

        vm.prank(admin);
        canonical.pauseAsset(assetId);

        assertFalse(registry.isOpenForNewRisk(assetId, version));
        assertTrue(registry.isLifecycleEnabled(assetId, version));
        assertTrue(registry.runtimeMatches(assetId, version));

        vm.startPrank(statusManager);
        registry.pauseBinding(assetId, version);

        vm.expectRevert(
            abi.encodeWithSelector(
                ISettlementAssetRegistry.CanonicalAssetNotActive.selector, assetId, RegistryStatus.Paused
            )
        );
        registry.activateBinding(assetId, version);
        vm.stopPrank();

        assertTrue(registry.isLifecycleEnabled(assetId, version));
    }

    function test_RuntimeDriftBlocksActivationAndNewRisk() public {
        uint32 version = _register(_definition(assetId, address(token), QUALIFICATION_ONE));
        bytes32 expectedCodeHash = address(token).codehash;

        vm.prank(statusManager);
        registry.activateBinding(assetId, version);
        assertTrue(registry.isOpenForNewRisk(assetId, version));

        vm.etch(address(token), address(new RevertingDecimalsToken()).code);
        bytes32 driftedCodeHash = address(token).codehash;
        assertTrue(driftedCodeHash != expectedCodeHash);

        assertFalse(registry.runtimeMatches(assetId, version));
        assertFalse(registry.isOpenForNewRisk(assetId, version));
        assertTrue(registry.isLifecycleEnabled(assetId, version));

        vm.startPrank(statusManager);
        registry.pauseBinding(assetId, version);

        vm.expectRevert(
            abi.encodeWithSelector(RuntimeCodeHashMismatch.selector, address(token), expectedCodeHash, driftedCodeHash)
        );
        registry.activateBinding(assetId, version);
        vm.stopPrank();
    }

    function test_DecimalsDriftBlocksActivationAndNewRisk() public {
        uint32 version = _register(_definition(assetId, address(token), QUALIFICATION_ONE));

        vm.prank(statusManager);
        registry.activateBinding(assetId, version);

        token.setDecimals(CANONICAL_DECIMALS + 2);

        assertFalse(registry.runtimeMatches(assetId, version));
        assertFalse(registry.isOpenForNewRisk(assetId, version));
        assertTrue(registry.isLifecycleEnabled(assetId, version));

        vm.startPrank(statusManager);
        registry.pauseBinding(assetId, version);

        vm.expectRevert(
            abi.encodeWithSelector(
                ISettlementAssetRegistry.TokenDecimalsMismatch.selector,
                address(token),
                CANONICAL_DECIMALS,
                CANONICAL_DECIMALS + 2
            )
        );
        registry.activateBinding(assetId, version);
        vm.stopPrank();
    }

    function test_PausedAndDeprecatedVersionsStayLifecycleEnabled() public {
        uint32 first = _register(_definition(assetId, address(token), QUALIFICATION_ONE));
        uint32 second = _register(_definition(assetId, address(token), QUALIFICATION_TWO));

        vm.startPrank(statusManager);
        registry.activateBinding(assetId, first);
        registry.deprecateBinding(assetId, first);
        registry.activateBinding(assetId, second);
        vm.stopPrank();

        assertEq(uint8(registry.statusOf(assetId, first)), uint8(RegistryStatus.Deprecated));
        assertTrue(registry.isLifecycleEnabled(assetId, first));
        assertFalse(registry.isOpenForNewRisk(assetId, first));

        vm.prank(statusManager);
        registry.pauseBinding(assetId, second);

        assertTrue(registry.isLifecycleEnabled(assetId, second));
        assertFalse(registry.isOpenForNewRisk(assetId, second));
    }

    function test_HistoricalVersionsNeverMutate() public {
        SettlementAssetDefinition memory definition = _definition(assetId, address(token), QUALIFICATION_ONE);
        uint32 first = _register(definition);
        SettlementAssetBinding memory original = registry.getBinding(assetId, first);

        uint32 second = _register(_definition(assetId, address(token), QUALIFICATION_TWO));

        vm.startPrank(statusManager);
        registry.activateBinding(assetId, first);
        registry.deprecateBinding(assetId, first);
        registry.activateBinding(assetId, second);
        registry.pauseBinding(assetId, second);
        vm.stopPrank();

        SettlementAssetBinding memory replayed = registry.getBinding(assetId, first);

        assertEq(AssetId.unwrap(replayed.definition.assetId), AssetId.unwrap(original.definition.assetId));
        assertEq(replayed.definition.token, original.definition.token);
        assertEq(replayed.definition.expectedRuntimeCodeHash, original.definition.expectedRuntimeCodeHash);
        assertEq(replayed.definition.qualificationHash, original.definition.qualificationHash);
        assertEq(replayed.definitionHash, original.definitionHash);
        assertEq(replayed.versionHash, original.versionHash);
        assertEq(replayed.version, original.version);
        assertEq(replayed.decimals, original.decimals);
        assertEq(uint8(replayed.status), uint8(RegistryStatus.Deprecated));
    }

    function test_UnknownBindingQueriesUseExplicitBehavior() public {
        uint32 unknownVersion = 7;

        assertEq(uint8(registry.statusOf(assetId, unknownVersion)), uint8(RegistryStatus.Unspecified));
        assertFalse(registry.isLifecycleEnabled(assetId, unknownVersion));
        assertFalse(registry.isOpenForNewRisk(assetId, unknownVersion));
        assertFalse(registry.runtimeMatches(assetId, unknownVersion));
        assertEq(registry.latestVersion(assetId), 0);
        assertEq(registry.activeVersion(assetId), 0);
        assertEq(AssetId.unwrap(registry.tokenAsset(address(token))), bytes32(0));

        vm.expectRevert(
            abi.encodeWithSelector(ISettlementAssetRegistry.UnknownBinding.selector, assetId, unknownVersion)
        );
        registry.getBinding(assetId, unknownVersion);

        vm.startPrank(statusManager);
        vm.expectRevert(
            abi.encodeWithSelector(ISettlementAssetRegistry.UnknownBinding.selector, assetId, unknownVersion)
        );
        registry.activateBinding(assetId, unknownVersion);

        vm.expectRevert(
            abi.encodeWithSelector(ISettlementAssetRegistry.UnknownBinding.selector, assetId, unknownVersion)
        );
        registry.pauseBinding(assetId, unknownVersion);

        vm.expectRevert(
            abi.encodeWithSelector(ISettlementAssetRegistry.UnknownBinding.selector, assetId, unknownVersion)
        );
        registry.deprecateBinding(assetId, unknownVersion);
        vm.stopPrank();
    }

    /// @dev The counter is forced to its ceiling directly, because reaching it by registration is
    /// not executable. The slot is discovered through the getter rather than hardcoded, so inherited
    /// storage layout changes cannot silently point this at the wrong word.
    function test_VersionExhaustionRevertsWithNamedErrorInsteadOfPanicking() public {
        _register(_definition(assetId, address(token), QUALIFICATION_ONE));

        vm.record();
        registry.latestVersion(assetId);
        (bytes32[] memory readSlots,) = vm.accesses(address(registry));
        vm.store(address(registry), readSlots[0], bytes32(uint256(type(uint32).max)));

        assertEq(registry.latestVersion(assetId), type(uint32).max);

        vm.expectRevert(abi.encodeWithSelector(ISettlementAssetRegistry.VersionExhausted.selector, assetId));
        vm.prank(qualifier);
        registry.registerBinding(_definition(assetId, address(token), QUALIFICATION_TWO));

        assertEq(registry.latestVersion(assetId), type(uint32).max);
        assertEq(registry.bindingCount(), 1);
    }

    function test_TypestringsMatchTheirTypehashes() public pure {
        assertEq(
            keccak256(bytes(SettlementAssetLib.SETTLEMENT_ASSET_DEFINITION_TYPESTRING)),
            SettlementAssetLib.SETTLEMENT_ASSET_DEFINITION_TYPEHASH
        );
        assertEq(
            keccak256(bytes(SettlementAssetLib.SETTLEMENT_ASSET_VERSION_TYPESTRING)),
            SettlementAssetLib.SETTLEMENT_ASSET_VERSION_TYPEHASH
        );
    }

    function _expectInvalidTransition(uint32 version, RegistryStatus previousStatus, RegistryStatus newStatus)
        internal
    {
        vm.expectRevert(
            abi.encodeWithSelector(
                ISettlementAssetRegistry.InvalidBindingTransition.selector, assetId, version, previousStatus, newStatus
            )
        );
    }

    function _register(SettlementAssetDefinition memory definition) internal returns (uint32 version) {
        vm.prank(qualifier);
        version = registry.registerBinding(definition);
    }

    function _definition(AssetId targetAssetId, address targetToken, bytes32 qualificationHash)
        internal
        view
        returns (SettlementAssetDefinition memory)
    {
        return SettlementAssetDefinition({
            assetId: targetAssetId,
            token: targetToken,
            expectedRuntimeCodeHash: targetToken.codehash,
            qualificationHash: qualificationHash
        });
    }

    function _canonicalDefinition(bytes32 referenceId, uint8 decimals) internal pure returns (AssetDefinition memory) {
        return AssetDefinition({
            namespaceId: NAMESPACE_ID,
            referenceId: referenceId,
            symbol: SYMBOL,
            assetClass: AssetClass.Stablecoin,
            decimals: decimals
        });
    }
}
