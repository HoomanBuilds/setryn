// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Test} from "forge-std/Test.sol";

import {IFeeScheduleRegistry} from "../../src/interfaces/IFeeScheduleRegistry.sol";
import {ISettlementAssetRegistry} from "../../src/interfaces/ISettlementAssetRegistry.sol";
import {
    FeeChargeRateOutOfRange,
    FeeRebateRateOutOfRange,
    FeeScheduleDefinitionLib,
    IneffectiveFeeSchedule,
    ZeroFeeModelId,
    ZeroFeeRecipientsHash,
    ZeroFeeRulesHash,
    ZeroFeeScheduleEvidenceHash,
    ZeroFeeScheduleKey,
    ZeroFeeScheduleNamespaceId,
    ZeroFeeScheduleSettlementAssetId,
    ZeroFeeScheduleSettlementAssetVersion
} from "../../src/libraries/FeeScheduleDefinitionLib.sol";
import {AssetRegistry} from "../../src/registry/AssetRegistry.sol";
import {FeeScheduleRegistry} from "../../src/registry/FeeScheduleRegistry.sol";
import {SettlementAssetRegistry} from "../../src/registry/SettlementAssetRegistry.sol";
import {AssetDefinition} from "../../src/types/AssetDefinition.sol";
import {AssetClass, RegistryStatus} from "../../src/types/Enums.sol";
import {FeeScheduleDefinition, FeeScheduleVersion} from "../../src/types/FeeScheduleDefinition.sol";
import {AssetId, FeeActionId, FeeModelId, FeeScheduleId} from "../../src/types/Identifiers.sol";
import {FeeRatePpm, PPM_DENOMINATOR} from "../../src/types/Units.sol";
import {SettlementAssetDefinition} from "../../src/types/SettlementAssetDefinition.sol";
import {MockERC20Metadata} from "../mocks/TokenMocks.sol";

contract FeeScheduleRegistryTest is Test {
    uint48 internal constant ADMIN_DELAY = 3 days;

    bytes32 internal constant NAMESPACE_ID = keccak256("setryn.fee");
    bytes32 internal constant SCHEDULE_KEY = keccak256("fee:perp:standard");

    bytes32 internal constant FEE_RULES_HASH = keccak256("fee.rules.v1");
    bytes32 internal constant RECIPIENTS_HASH = keccak256("fee.recipients.v1");
    bytes32 internal constant EVIDENCE_HASH = keccak256("fee.evidence.v1");

    uint32 internal constant MAX_CHARGE_PPM = 1_000;
    uint32 internal constant MAX_REBATE_PPM = 250;
    uint128 internal constant MAX_FLAT_CHARGE = 5_000_000;
    uint128 internal constant MAX_FLAT_REBATE = 1_000_000;

    uint8 internal constant CANONICAL_DECIMALS = 6;

    /// @dev One entry per required nonzero field of a definition, in the order `validate` checks
    /// them, so the table below and `_definitionWithZeroField` stay a single aligned sweep.
    uint256 internal constant ZERO_FIELD_COUNT = 8;

    address internal admin = makeAddr("admin");
    address internal qualifier = makeAddr("qualifier");
    address internal statusManager = makeAddr("statusManager");
    address internal outsider = makeAddr("outsider");

    AssetRegistry internal assets;
    SettlementAssetRegistry internal settlement;
    FeeScheduleRegistry internal registry;

    MockERC20Metadata internal token;

    AssetId internal settlementAssetId;
    FeeScheduleId internal feeScheduleId;

    function setUp() public {
        assets = new AssetRegistry(ADMIN_DELAY, admin);
        settlement = new SettlementAssetRegistry(ADMIN_DELAY, admin, assets);
        registry = new FeeScheduleRegistry(ADMIN_DELAY, admin, settlement);

        token = new MockERC20Metadata(CANONICAL_DECIMALS);

        vm.startPrank(admin);
        registry.grantRole(registry.FEE_SCHEDULE_QUALIFIER_ROLE(), qualifier);
        registry.grantRole(registry.FEE_SCHEDULE_STATUS_MANAGER_ROLE(), statusManager);

        settlementAssetId = assets.registerAsset(_assetDefinition(keccak256("iso4217:USD"), "USDC"));
        settlement.registerBinding(_bindingDefinition(address(token), keccak256("settlement.qualification.v1")));
        settlement.activateBinding(settlementAssetId, 1);
        vm.stopPrank();

        feeScheduleId = FeeScheduleDefinitionLib.deriveFeeScheduleId(_definition());
    }

    /// @dev Every hashing rule is versioned inside its own literal, and both published tag sets are
    /// convenience constants over open bytes32 spaces rather than enums, so the literals must be
    /// frozen and no tag may collide with another in either space.
    function test_ConstantsAreFrozenAndDistinct() public view {
        assertEq(
            keccak256(bytes(FeeScheduleDefinitionLib.FEE_SCHEDULE_KEY_TYPESTRING)),
            FeeScheduleDefinitionLib.FEE_SCHEDULE_KEY_TYPEHASH
        );
        assertEq(
            keccak256(bytes(FeeScheduleDefinitionLib.FEE_SCHEDULE_DEFINITION_TYPESTRING)),
            FeeScheduleDefinitionLib.FEE_SCHEDULE_DEFINITION_TYPEHASH
        );
        assertEq(
            keccak256(bytes(FeeScheduleDefinitionLib.FEE_SCHEDULE_VERSION_TYPESTRING)),
            FeeScheduleDefinitionLib.FEE_SCHEDULE_VERSION_TYPEHASH
        );

        FeeModelId[4] memory models = [
            FeeScheduleDefinitionLib.FEE_MODEL_FLAT_PER_ACTION,
            FeeScheduleDefinitionLib.FEE_MODEL_AD_VALOREM,
            FeeScheduleDefinitionLib.FEE_MODEL_MAKER_TAKER,
            FeeScheduleDefinitionLib.FEE_MODEL_VOLUME_TIERED
        ];
        assertEq(FeeModelId.unwrap(models[0]), keccak256(bytes("SetrynFeeModelV1:FlatPerAction")));
        for (uint256 i = 0; i < models.length; i++) {
            assertTrue(FeeModelId.unwrap(models[i]) != bytes32(0));
            for (uint256 j = i + 1; j < models.length; j++) {
                assertTrue(FeeModelId.unwrap(models[i]) != FeeModelId.unwrap(models[j]));
            }
        }

        FeeActionId[6] memory actions = [
            FeeScheduleDefinitionLib.FEE_ACTION_MAKER_FILL,
            FeeScheduleDefinitionLib.FEE_ACTION_TAKER_FILL,
            FeeScheduleDefinitionLib.FEE_ACTION_SETTLEMENT,
            FeeScheduleDefinitionLib.FEE_ACTION_EXERCISE,
            FeeScheduleDefinitionLib.FEE_ACTION_LIQUIDATION,
            FeeScheduleDefinitionLib.FEE_ACTION_FUNDING
        ];
        assertEq(FeeActionId.unwrap(actions[0]), keccak256(bytes("SetrynFeeActionV1:MakerFill")));
        for (uint256 i = 0; i < actions.length; i++) {
            assertTrue(FeeActionId.unwrap(actions[i]) != bytes32(0));
            for (uint256 j = i + 1; j < actions.length; j++) {
                assertTrue(FeeActionId.unwrap(actions[i]) != FeeActionId.unwrap(actions[j]));
            }
        }

        assertEq(PPM_DENOMINATOR, 1e6);
        assertEq(registry.FEE_RATE_PPM_DENOMINATOR(), PPM_DENOMINATOR);
        assertEq(registry.FEE_SCHEDULE_QUALIFIER_ROLE(), keccak256(bytes("SETRYN_FEE_SCHEDULE_QUALIFIER_ROLE")));
        assertEq(
            registry.FEE_SCHEDULE_STATUS_MANAGER_ROLE(), keccak256(bytes("SETRYN_FEE_SCHEDULE_STATUS_MANAGER_ROLE"))
        );
        assertTrue(registry.FEE_SCHEDULE_QUALIFIER_ROLE() != registry.FEE_SCHEDULE_STATUS_MANAGER_ROLE());
        assertTrue(registry.FEE_SCHEDULE_QUALIFIER_ROLE() != registry.DEFAULT_ADMIN_ROLE());
        assertTrue(registry.FEE_SCHEDULE_STATUS_MANAGER_ROLE() != registry.DEFAULT_ADMIN_ROLE());
    }

    function test_ConstructorWiresDependencyAndGrantsRoles() public {
        FeeScheduleRegistry fresh = new FeeScheduleRegistry(ADMIN_DELAY, admin, settlement);

        assertTrue(fresh.hasRole(fresh.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(fresh.hasRole(fresh.FEE_SCHEDULE_QUALIFIER_ROLE(), admin));
        assertTrue(fresh.hasRole(fresh.FEE_SCHEDULE_STATUS_MANAGER_ROLE(), admin));
        assertEq(fresh.defaultAdmin(), admin);
        assertEq(fresh.defaultAdminDelay(), ADMIN_DELAY);
        assertEq(address(fresh.settlementAssetRegistry()), address(settlement));
        assertEq(fresh.feeScheduleCount(), 0);
    }

    function test_ConstructorRejectsZeroAdminAndUndeployedDependency() public {
        vm.expectRevert(IFeeScheduleRegistry.ZeroInitialAdmin.selector);
        new FeeScheduleRegistry(ADMIN_DELAY, address(0), settlement);

        vm.expectRevert(IFeeScheduleRegistry.ZeroSettlementAssetRegistry.selector);
        new FeeScheduleRegistry(ADMIN_DELAY, admin, ISettlementAssetRegistry(address(0)));

        vm.expectRevert(
            abi.encodeWithSelector(IFeeScheduleRegistry.SettlementAssetRegistryHasNoCode.selector, outsider)
        );
        new FeeScheduleRegistry(ADMIN_DELAY, admin, ISettlementAssetRegistry(outsider));
    }

    /// @dev The V1 key commits the namespaced schedule name alone. Repricing, switching fee model,
    /// repointing at a newer settlement binding, and revising the rule or recipient commitments all
    /// land on the same lineage under a new version, which is what keeps a schedule reference inside
    /// a signed order stable across repricings. Only the namespace or the key mints a new lineage.
    function test_FeeScheduleIdIsStableAcrossRepricingAndSplitsOnNamespaceOrKey() public {
        vm.prank(admin);
        settlement.registerBinding(_bindingDefinition(address(token), keccak256("settlement.qualification.v2")));

        FeeScheduleDefinition memory repriced = _definition();
        repriced.feeModelId = FeeScheduleDefinitionLib.FEE_MODEL_VOLUME_TIERED;
        repriced.settlementAssetVersion = 2;
        repriced.feeRulesHash = keccak256("fee.rules.v2");
        repriced.recipientsHash = keccak256("fee.recipients.v2");
        repriced.maxChargeRatePpm = FeeRatePpm.wrap(2_000);

        FeeScheduleDefinition memory otherNamespace = _definition();
        otherNamespace.namespaceId = keccak256("acme.fee");

        FeeScheduleDefinition memory otherKey = _definition();
        otherKey.scheduleKey = keccak256("fee:perp:vip");

        vm.startPrank(qualifier);
        (FeeScheduleId firstId, uint32 firstVersion) = registry.registerFeeSchedule(_definition());
        (FeeScheduleId secondId, uint32 secondVersion) = registry.registerFeeSchedule(repriced);
        (FeeScheduleId namespaceId, uint32 namespaceVersion) = registry.registerFeeSchedule(otherNamespace);
        (FeeScheduleId keyId, uint32 keyVersion) = registry.registerFeeSchedule(otherKey);
        vm.stopPrank();

        assertEq(FeeScheduleId.unwrap(firstId), FeeScheduleId.unwrap(secondId));
        assertEq(firstVersion, 1);
        assertEq(secondVersion, 2);
        assertEq(registry.latestVersion(firstId), 2);

        assertTrue(FeeScheduleId.unwrap(firstId) != FeeScheduleId.unwrap(namespaceId));
        assertTrue(FeeScheduleId.unwrap(firstId) != FeeScheduleId.unwrap(keyId));
        assertTrue(FeeScheduleId.unwrap(namespaceId) != FeeScheduleId.unwrap(keyId));
        assertEq(namespaceVersion, 1);
        assertEq(keyVersion, 1);
        assertEq(registry.feeScheduleCount(), 4);
    }

    /// @dev Identity is chain portable; the qualification commitment is not, because the settlement
    /// binding is chain local and every flat bound is denominated in that chain-local token. Each
    /// economic field must move the definition hash on its own, otherwise the duplicate check could
    /// silently accept a repricing as an exact resubmission.
    function test_DefinitionHashBindsChainIdAndEveryEconomicField() public view {
        FeeScheduleDefinition memory definition = _definition();
        bytes32 here = FeeScheduleDefinitionLib.hashDefinition(definition, block.chainid);

        assertTrue(here != FeeScheduleDefinitionLib.hashDefinition(definition, block.chainid + 1));

        for (uint256 i = 0; i < 10; i++) {
            assertTrue(here != FeeScheduleDefinitionLib.hashDefinition(_definitionWithMutatedField(i), block.chainid));
        }

        assertTrue(
            FeeScheduleDefinitionLib.hashVersion(feeScheduleId, 1, here, block.chainid)
                != FeeScheduleDefinitionLib.hashVersion(feeScheduleId, 1, here, block.chainid + 1)
        );
        assertTrue(
            FeeScheduleDefinitionLib.hashVersion(feeScheduleId, 1, here, block.chainid)
                != FeeScheduleDefinitionLib.hashVersion(feeScheduleId, 2, here, block.chainid)
        );
        assertEq(
            FeeScheduleId.unwrap(FeeScheduleDefinitionLib.deriveFeeScheduleId(definition)),
            FeeScheduleId.unwrap(registry.deriveFeeScheduleId(definition))
        );
    }

    /// @dev Every identifier, the dependency version number, and every commitment hash is required,
    /// so the whole set is swept as one table against the error each field must raise by itself.
    function test_RegistrationRejectsZeroDefinitionFields() public {
        bytes4[ZERO_FIELD_COUNT] memory expected = [
            ZeroFeeScheduleNamespaceId.selector,
            ZeroFeeScheduleKey.selector,
            ZeroFeeModelId.selector,
            ZeroFeeScheduleSettlementAssetId.selector,
            ZeroFeeScheduleSettlementAssetVersion.selector,
            ZeroFeeRulesHash.selector,
            ZeroFeeRecipientsHash.selector,
            ZeroFeeScheduleEvidenceHash.selector
        ];

        vm.startPrank(qualifier);
        for (uint256 i = 0; i < ZERO_FIELD_COUNT; i++) {
            vm.expectRevert(expected[i]);
            registry.registerFeeSchedule(_definitionWithZeroField(i));
        }
        vm.stopPrank();

        assertEq(registry.feeScheduleCount(), 0);
    }

    /// @dev A rate above the whole is not a fee and a schedule with all four levers at zero can never
    /// charge or pay anything. Those are the only bound failures: the charge and rebate envelopes are
    /// independent, so no comparison between them is asserted here. Both are refused before any
    /// storage is touched.
    function test_RegistrationRejectsOutOfRangeAndInertBounds() public {
        FeeRatePpm aboveWhole = FeeRatePpm.wrap(uint32(PPM_DENOMINATOR) + 1);

        vm.startPrank(qualifier);

        FeeScheduleDefinition memory definition = _definition();
        definition.maxChargeRatePpm = aboveWhole;
        vm.expectRevert(abi.encodeWithSelector(FeeChargeRateOutOfRange.selector, aboveWhole));
        registry.registerFeeSchedule(definition);

        definition = _definition();
        definition.maxRebateRatePpm = aboveWhole;
        vm.expectRevert(abi.encodeWithSelector(FeeRebateRateOutOfRange.selector, aboveWhole));
        registry.registerFeeSchedule(definition);

        definition = _definition();
        definition.maxChargeRatePpm = FeeRatePpm.wrap(0);
        definition.maxRebateRatePpm = FeeRatePpm.wrap(0);
        definition.maxFlatChargeBaseUnits = 0;
        definition.maxFlatRebateBaseUnits = 0;
        vm.expectRevert(IneffectiveFeeSchedule.selector);
        registry.registerFeeSchedule(definition);

        vm.stopPrank();
        assertEq(registry.feeScheduleCount(), 0);
    }

    /// @dev Zero on a single lever means that lever is disabled, which is ordinary policy: a pure ad
    /// valorem schedule has no flat bound and a venue that never pays a rebate has no rebate bound.
    /// The last case proves the whole-of-notional boundary is accepted rather than silently clamped.
    function test_RegistrationAcceptsIndividuallyDisabledLevers() public {
        vm.startPrank(qualifier);

        FeeScheduleDefinition memory adValorem = _definition();
        adValorem.maxFlatChargeBaseUnits = 0;
        adValorem.maxFlatRebateBaseUnits = 0;
        (, uint32 adValoremVersion) = registry.registerFeeSchedule(adValorem);

        FeeScheduleDefinition memory flatOnly = _definition();
        flatOnly.maxChargeRatePpm = FeeRatePpm.wrap(0);
        flatOnly.maxRebateRatePpm = FeeRatePpm.wrap(0);
        (, uint32 flatOnlyVersion) = registry.registerFeeSchedule(flatOnly);

        FeeScheduleDefinition memory whole = _definition();
        whole.maxChargeRatePpm = FeeRatePpm.wrap(uint32(PPM_DENOMINATOR));
        whole.maxRebateRatePpm = FeeRatePpm.wrap(uint32(PPM_DENOMINATOR));
        whole.maxFlatChargeBaseUnits = type(uint128).max;
        whole.maxFlatRebateBaseUnits = type(uint128).max;
        (, uint32 wholeVersion) = registry.registerFeeSchedule(whole);

        vm.stopPrank();

        assertEq(adValoremVersion, 1);
        assertEq(flatOnlyVersion, 2);
        assertEq(wholeVersion, 3);
    }

    /// @dev A fee schedule is a per-event policy envelope, not a solvency proof, so the charge and
    /// rebate envelopes are independent. A rebate-only liquidity program with no charge lever at all,
    /// and a schedule whose rebate envelope is wider than its charge envelope on both axes, are
    /// legitimate policies funded from a separately reserved incentive budget. Acceptance here is
    /// never evidence that the rebate is funded; the fee engine must reserve and verify that itself.
    function test_RegistrationAcceptsRebateOnlyAndRebateWiderThanCharge() public {
        FeeScheduleDefinition memory rebateOnly = _definition();
        rebateOnly.maxChargeRatePpm = FeeRatePpm.wrap(0);
        rebateOnly.maxFlatChargeBaseUnits = 0;

        FeeScheduleDefinition memory rebateWider = _definition();
        rebateWider.maxRebateRatePpm = FeeRatePpm.wrap(MAX_CHARGE_PPM + 1);
        rebateWider.maxFlatRebateBaseUnits = MAX_FLAT_CHARGE + 1;

        vm.startPrank(qualifier);
        (, uint32 rebateOnlyVersion) = registry.registerFeeSchedule(rebateOnly);
        (, uint32 rebateWiderVersion) = registry.registerFeeSchedule(rebateWider);
        vm.stopPrank();

        assertEq(rebateOnlyVersion, 1);
        assertEq(rebateWiderVersion, 2);

        FeeScheduleVersion memory onlyRecord = registry.getFeeSchedule(feeScheduleId, 1);
        assertEq(FeeRatePpm.unwrap(onlyRecord.definition.maxChargeRatePpm), 0);
        assertEq(onlyRecord.definition.maxFlatChargeBaseUnits, 0);
        assertEq(FeeRatePpm.unwrap(onlyRecord.definition.maxRebateRatePpm), MAX_REBATE_PPM);
        assertEq(onlyRecord.definition.maxFlatRebateBaseUnits, MAX_FLAT_REBATE);

        FeeScheduleVersion memory widerRecord = registry.getFeeSchedule(feeScheduleId, 2);
        assertEq(FeeRatePpm.unwrap(widerRecord.definition.maxRebateRatePpm), MAX_CHARGE_PPM + 1);
        assertEq(widerRecord.definition.maxFlatRebateBaseUnits, MAX_FLAT_CHARGE + 1);
    }

    /// @dev The binding is named by an exact version, so an unregistered asset and a version number
    /// that was never qualified both fail closed rather than leaving the base units of every flat
    /// bound unresolvable.
    function test_RegistrationRejectsUnknownSettlementBinding() public {
        AssetId ghost = AssetId.wrap(keccak256("ghost.asset"));

        vm.startPrank(qualifier);

        FeeScheduleDefinition memory definition = _definition();
        definition.settlementAssetId = ghost;
        vm.expectRevert(
            abi.encodeWithSelector(IFeeScheduleRegistry.UnknownSettlementAssetDependency.selector, ghost, uint32(1))
        );
        registry.registerFeeSchedule(definition);

        definition = _definition();
        definition.settlementAssetVersion = 9;
        vm.expectRevert(
            abi.encodeWithSelector(
                IFeeScheduleRegistry.UnknownSettlementAssetDependency.selector, settlementAssetId, uint32(9)
            )
        );
        registry.registerFeeSchedule(definition);

        vm.stopPrank();
    }

    function test_RegistrationLandsPausedAndStoresTheWholeDefinition() public {
        FeeScheduleDefinition memory definition = _definition();
        bytes32 definitionHash = FeeScheduleDefinitionLib.hashDefinition(definition, block.chainid);
        bytes32 versionHash = FeeScheduleDefinitionLib.hashVersion(feeScheduleId, 1, definitionHash, block.chainid);

        vm.expectEmit(true, true, true, true, address(registry));
        emit IFeeScheduleRegistry.FeeScheduleRegistered(
            feeScheduleId, 1, versionHash, definitionHash, definition, block.chainid, RegistryStatus.Paused, qualifier
        );

        vm.prank(qualifier);
        registry.registerFeeSchedule(definition);

        FeeScheduleVersion memory record = registry.getFeeSchedule(feeScheduleId, 1);
        assertEq(uint8(record.status), uint8(RegistryStatus.Paused));
        assertEq(record.version, 1);
        assertEq(record.definitionHash, definitionHash);
        assertEq(record.versionHash, versionHash);
        assertEq(FeeModelId.unwrap(record.definition.feeModelId), FeeModelId.unwrap(definition.feeModelId));
        assertEq(AssetId.unwrap(record.definition.settlementAssetId), AssetId.unwrap(settlementAssetId));
        assertEq(record.definition.settlementAssetVersion, 1);
        assertEq(record.definition.feeRulesHash, FEE_RULES_HASH);
        assertEq(record.definition.recipientsHash, RECIPIENTS_HASH);
        assertEq(FeeRatePpm.unwrap(record.definition.maxChargeRatePpm), MAX_CHARGE_PPM);
        assertEq(FeeRatePpm.unwrap(record.definition.maxRebateRatePpm), MAX_REBATE_PPM);
        assertEq(record.definition.maxFlatChargeBaseUnits, MAX_FLAT_CHARGE);
        assertEq(record.definition.maxFlatRebateBaseUnits, MAX_FLAT_REBATE);
        assertEq(record.definition.evidenceHash, EVIDENCE_HASH);

        assertEq(registry.feeScheduleCount(), 1);
        assertEq(registry.latestVersion(feeScheduleId), 1);
        assertEq(registry.activeVersion(feeScheduleId), 0);
        assertTrue(registry.exists(feeScheduleId, 1));
        assertFalse(registry.isOpenForNewRisk(feeScheduleId, 1));
        assertTrue(registry.isLifecycleEnabled(feeScheduleId, 1));
    }

    /// @dev Qualification opens no risk, so a rate card may be published ahead of the settlement
    /// binding it will eventually be switched on against.
    function test_RegistrationSucceedsAgainstPausedAndDeprecatedBinding() public {
        vm.startPrank(admin);
        settlement.pauseBinding(settlementAssetId, 1);
        settlement.registerBinding(_bindingDefinition(address(token), keccak256("settlement.qualification.v2")));
        settlement.deprecateBinding(settlementAssetId, 2);
        vm.stopPrank();

        FeeScheduleDefinition memory deprecatedBinding = _definition();
        deprecatedBinding.settlementAssetVersion = 2;

        vm.startPrank(qualifier);
        (FeeScheduleId pausedId, uint32 pausedVersion) = registry.registerFeeSchedule(_definition());
        (, uint32 deprecatedVersion) = registry.registerFeeSchedule(deprecatedBinding);
        vm.stopPrank();

        assertEq(FeeScheduleId.unwrap(pausedId), FeeScheduleId.unwrap(feeScheduleId));
        assertEq(pausedVersion, 1);
        assertEq(deprecatedVersion, 2);
        assertEq(uint8(registry.statusOf(feeScheduleId, 1)), uint8(RegistryStatus.Paused));
    }

    /// @dev Versions are append-only and never edited: the same definition is refused as a duplicate
    /// of the version that already carries it, a repricing becomes the next version, and neither a
    /// later registration nor a status change may rewrite an earlier record.
    function test_VersionsAreAppendOnlyImmutableAndDeduplicated() public {
        vm.prank(qualifier);
        (, uint32 first) = registry.registerFeeSchedule(_definition());
        FeeScheduleVersion memory before = registry.getFeeSchedule(feeScheduleId, 1);

        FeeScheduleDefinition memory repriced = _definition();
        repriced.maxChargeRatePpm = FeeRatePpm.wrap(MAX_CHARGE_PPM + 1);
        vm.prank(qualifier);
        (, uint32 second) = registry.registerFeeSchedule(repriced);

        bytes32 duplicateHash = FeeScheduleDefinitionLib.hashDefinition(_definition(), block.chainid);
        vm.prank(qualifier);
        vm.expectRevert(
            abi.encodeWithSelector(
                IFeeScheduleRegistry.DuplicateFeeScheduleDefinition.selector, feeScheduleId, duplicateHash, uint32(1)
            )
        );
        registry.registerFeeSchedule(_definition());

        vm.startPrank(statusManager);
        registry.activateFeeSchedule(feeScheduleId, 1);
        registry.pauseFeeSchedule(feeScheduleId, 1);
        vm.stopPrank();

        FeeScheduleVersion memory afterChanges = registry.getFeeSchedule(feeScheduleId, 1);
        assertEq(first, 1);
        assertEq(second, 2);
        assertEq(registry.feeScheduleCount(), 2);
        assertEq(registry.latestVersion(feeScheduleId), 2);
        assertEq(afterChanges.definitionHash, before.definitionHash);
        assertEq(afterChanges.versionHash, before.versionHash);
        assertEq(FeeRatePpm.unwrap(afterChanges.definition.maxChargeRatePpm), MAX_CHARGE_PPM);
        assertEq(
            FeeRatePpm.unwrap(registry.getFeeSchedule(feeScheduleId, 2).definition.maxChargeRatePpm), MAX_CHARGE_PPM + 1
        );
    }

    /// @dev Exhaustion is unreachable in practice, so the latest-version pointer is poked directly to
    /// prove the named error replaces what would otherwise be an opaque arithmetic panic. The slot is
    /// discovered through the getter rather than hardcoded, so an inherited storage layout change
    /// cannot silently point this at the wrong word.
    function test_VersionExhaustionIsANamedError() public {
        vm.record();
        registry.latestVersion(feeScheduleId);
        (bytes32[] memory readSlots,) = vm.accesses(address(registry));
        vm.store(address(registry), readSlots[0], bytes32(uint256(type(uint32).max)));

        vm.prank(qualifier);
        vm.expectRevert(
            abi.encodeWithSelector(IFeeScheduleRegistry.FeeScheduleVersionExhausted.selector, feeScheduleId)
        );
        registry.registerFeeSchedule(_definition());
    }

    /// @dev Proposing a rate card and opening risk under it are different authorities, so the
    /// qualifier may never move status and an outsider may never qualify anything.
    function test_MutationsAreGatedByRoles() public {
        bytes memory unqualified = abi.encodeWithSelector(
            IAccessControl.AccessControlUnauthorizedAccount.selector, outsider, registry.FEE_SCHEDULE_QUALIFIER_ROLE()
        );

        vm.prank(outsider);
        vm.expectRevert(unqualified);
        registry.registerFeeSchedule(_definition());

        vm.prank(qualifier);
        registry.registerFeeSchedule(_definition());

        bytes memory expected = abi.encodeWithSelector(
            IAccessControl.AccessControlUnauthorizedAccount.selector,
            qualifier,
            registry.FEE_SCHEDULE_STATUS_MANAGER_ROLE()
        );

        vm.startPrank(qualifier);
        vm.expectRevert(expected);
        registry.activateFeeSchedule(feeScheduleId, 1);
        vm.expectRevert(expected);
        registry.pauseFeeSchedule(feeScheduleId, 1);
        vm.expectRevert(expected);
        registry.deprecateFeeSchedule(feeScheduleId, 1);
        vm.stopPrank();
    }

    /// @dev At most one version of a lineage may be active, an old version is never silently paused
    /// to make room, and pausing the active one clears the pointer rather than leaving it dangling.
    function test_OnlyOneVersionIsActiveAndPausingClearsThePointer() public {
        FeeScheduleDefinition memory repriced = _definition();
        repriced.feeRulesHash = keccak256("fee.rules.v2");

        vm.startPrank(qualifier);
        registry.registerFeeSchedule(_definition());
        registry.registerFeeSchedule(repriced);
        vm.stopPrank();

        vm.startPrank(statusManager);
        registry.activateFeeSchedule(feeScheduleId, 1);
        assertEq(registry.activeVersion(feeScheduleId), 1);

        vm.expectRevert(
            abi.encodeWithSelector(
                IFeeScheduleRegistry.AnotherFeeScheduleVersionActive.selector, feeScheduleId, uint32(1)
            )
        );
        registry.activateFeeSchedule(feeScheduleId, 2);
        assertEq(uint8(registry.statusOf(feeScheduleId, 1)), uint8(RegistryStatus.Active));

        vm.expectEmit(true, true, false, true, address(registry));
        emit IFeeScheduleRegistry.FeeScheduleActiveVersionChanged(feeScheduleId, 1, 0, statusManager);
        registry.pauseFeeSchedule(feeScheduleId, 1);
        assertEq(registry.activeVersion(feeScheduleId), 0);

        registry.activateFeeSchedule(feeScheduleId, 2);
        assertEq(registry.activeVersion(feeScheduleId), 2);
        vm.stopPrank();
    }

    function test_DeprecationIsTerminalAndNothingIsDeleted() public {
        vm.prank(qualifier);
        registry.registerFeeSchedule(_definition());

        vm.startPrank(statusManager);
        registry.activateFeeSchedule(feeScheduleId, 1);
        registry.deprecateFeeSchedule(feeScheduleId, 1);

        assertEq(registry.activeVersion(feeScheduleId), 0);
        assertEq(uint8(registry.statusOf(feeScheduleId, 1)), uint8(RegistryStatus.Deprecated));

        vm.expectRevert(
            abi.encodeWithSelector(
                IFeeScheduleRegistry.InvalidFeeScheduleTransition.selector,
                feeScheduleId,
                uint32(1),
                RegistryStatus.Deprecated,
                RegistryStatus.Active
            )
        );
        registry.activateFeeSchedule(feeScheduleId, 1);

        vm.expectRevert(
            abi.encodeWithSelector(
                IFeeScheduleRegistry.InvalidFeeScheduleTransition.selector,
                feeScheduleId,
                uint32(1),
                RegistryStatus.Deprecated,
                RegistryStatus.Paused
            )
        );
        registry.pauseFeeSchedule(feeScheduleId, 1);
        vm.stopPrank();

        assertTrue(registry.exists(feeScheduleId, 1));
        assertTrue(registry.isLifecycleEnabled(feeScheduleId, 1));
    }

    /// @dev Activation is the dependency-aware gate that registration deliberately is not: the exact
    /// settlement binding must be open for new risk at the moment the schedule is switched on, and
    /// it must be reachable again once the binding reopens.
    function test_ActivationRequiresAnOpenSettlementBinding() public {
        vm.prank(qualifier);
        registry.registerFeeSchedule(_definition());

        vm.prank(admin);
        settlement.pauseBinding(settlementAssetId, 1);

        vm.prank(statusManager);
        vm.expectRevert(
            abi.encodeWithSelector(
                IFeeScheduleRegistry.SettlementAssetDependencyNotOpen.selector, settlementAssetId, uint32(1)
            )
        );
        registry.activateFeeSchedule(feeScheduleId, 1);
        assertEq(uint8(registry.statusOf(feeScheduleId, 1)), uint8(RegistryStatus.Paused));

        vm.prank(admin);
        settlement.activateBinding(settlementAssetId, 1);
        vm.prank(statusManager);
        registry.activateFeeSchedule(feeScheduleId, 1);

        assertTrue(registry.isOpenForNewRisk(feeScheduleId, 1));
    }

    /// @dev The live gate keeps watching after activation: pausing the settlement binding closes the
    /// schedule for new risk without any status change here, and reopening the binding reopens it.
    function test_LiveGateReactsToSettlementBindingPause() public {
        _registerAndActivate();
        assertTrue(registry.isOpenForNewRisk(feeScheduleId, 1));

        vm.prank(admin);
        settlement.pauseBinding(settlementAssetId, 1);
        assertFalse(registry.isOpenForNewRisk(feeScheduleId, 1));
        assertEq(uint8(registry.statusOf(feeScheduleId, 1)), uint8(RegistryStatus.Active));
        assertTrue(registry.isLifecycleEnabled(feeScheduleId, 1));

        vm.prank(admin);
        settlement.activateBinding(settlementAssetId, 1);
        assertTrue(registry.isOpenForNewRisk(feeScheduleId, 1));
    }

    /// @dev Charging an accrued fee, verifying a receipt, replaying a signed order, and auditing an
    /// accounting entry priced under a retired schedule must never require current Active status
    /// anywhere in the dependency graph.
    function test_LifecycleSurvivesFullRetirement() public {
        _registerAndActivate();

        vm.startPrank(admin);
        settlement.pauseBinding(settlementAssetId, 1);
        settlement.deprecateBinding(settlementAssetId, 1);
        assets.deprecateAsset(settlementAssetId);
        vm.stopPrank();
        vm.prank(statusManager);
        registry.deprecateFeeSchedule(feeScheduleId, 1);

        assertTrue(registry.isLifecycleEnabled(feeScheduleId, 1));
        assertFalse(registry.isOpenForNewRisk(feeScheduleId, 1));

        FeeScheduleVersion memory record = registry.getFeeSchedule(feeScheduleId, 1);
        assertEq(record.definition.feeRulesHash, FEE_RULES_HASH);
        assertEq(record.definition.recipientsHash, RECIPIENTS_HASH);
        assertEq(uint8(record.status), uint8(RegistryStatus.Deprecated));
    }

    /// @dev Reads split deliberately: the record getter reverts, because a zeroed record would name
    /// the zero model and the zero settlement asset and would read as a usable free schedule, while
    /// the gate views answer with sentinels so a router may probe blind.
    function test_UnknownFeeScheduleRevertsOnGetAndAnswersSentinelsElsewhere() public {
        FeeScheduleId ghost = FeeScheduleId.wrap(keccak256("ghost.schedule"));

        vm.expectRevert(
            abi.encodeWithSelector(IFeeScheduleRegistry.UnknownFeeScheduleVersion.selector, ghost, uint32(1))
        );
        registry.getFeeSchedule(ghost, 1);

        vm.prank(statusManager);
        vm.expectRevert(
            abi.encodeWithSelector(IFeeScheduleRegistry.UnknownFeeScheduleVersion.selector, ghost, uint32(1))
        );
        registry.activateFeeSchedule(ghost, 1);

        assertEq(registry.latestVersion(ghost), 0);
        assertEq(registry.activeVersion(ghost), 0);
        assertEq(uint8(registry.statusOf(ghost, 1)), uint8(RegistryStatus.Unspecified));
        assertFalse(registry.exists(ghost, 1));
        assertFalse(registry.isOpenForNewRisk(ghost, 1));
        assertFalse(registry.isLifecycleEnabled(ghost, 1));
    }

    function _registerAndActivate() private {
        vm.prank(qualifier);
        registry.registerFeeSchedule(_definition());
        vm.prank(statusManager);
        registry.activateFeeSchedule(feeScheduleId, 1);
    }

    /// @dev Zeroes exactly one required field, indexed in the order `validate` checks them so the
    /// expectation table in the sweep above reads as one aligned list.
    function _definitionWithZeroField(uint256 index) private view returns (FeeScheduleDefinition memory definition) {
        definition = _definition();
        if (index == 0) {
            definition.namespaceId = bytes32(0);
        } else if (index == 1) {
            definition.scheduleKey = bytes32(0);
        } else if (index == 2) {
            definition.feeModelId = FeeModelId.wrap(bytes32(0));
        } else if (index == 3) {
            definition.settlementAssetId = AssetId.wrap(bytes32(0));
        } else if (index == 4) {
            definition.settlementAssetVersion = 0;
        } else if (index == 5) {
            definition.feeRulesHash = bytes32(0);
        } else if (index == 6) {
            definition.recipientsHash = bytes32(0);
        } else {
            definition.evidenceHash = bytes32(0);
        }
    }

    /// @dev Moves exactly one economic field to a different legal value, so the hash sweep proves
    /// every one of them is inside the commitment rather than merely stored beside it.
    function _definitionWithMutatedField(uint256 index) private view returns (FeeScheduleDefinition memory definition) {
        definition = _definition();
        if (index == 0) {
            definition.namespaceId = keccak256("acme.fee");
        } else if (index == 1) {
            definition.scheduleKey = keccak256("fee:perp:vip");
        } else if (index == 2) {
            definition.feeModelId = FeeScheduleDefinitionLib.FEE_MODEL_VOLUME_TIERED;
        } else if (index == 3) {
            definition.settlementAssetId = AssetId.wrap(keccak256("other.asset"));
        } else if (index == 4) {
            definition.settlementAssetVersion = 2;
        } else if (index == 5) {
            definition.feeRulesHash = keccak256("fee.rules.v2");
        } else if (index == 6) {
            definition.recipientsHash = keccak256("fee.recipients.v2");
        } else if (index == 7) {
            definition.maxChargeRatePpm = FeeRatePpm.wrap(MAX_CHARGE_PPM + 1);
        } else if (index == 8) {
            definition.maxRebateRatePpm = FeeRatePpm.wrap(MAX_REBATE_PPM + 1);
        } else {
            definition.maxFlatRebateBaseUnits = MAX_FLAT_REBATE + 1;
        }
    }

    function _assetDefinition(bytes32 referenceId, bytes32 symbol) private pure returns (AssetDefinition memory) {
        return AssetDefinition({
            namespaceId: keccak256("setryn.asset"),
            referenceId: referenceId,
            symbol: symbol,
            assetClass: AssetClass.Stablecoin,
            decimals: CANONICAL_DECIMALS
        });
    }

    function _bindingDefinition(address token_, bytes32 qualificationHash)
        private
        view
        returns (SettlementAssetDefinition memory)
    {
        return SettlementAssetDefinition({
            assetId: settlementAssetId,
            token: token_,
            expectedRuntimeCodeHash: token_.codehash,
            qualificationHash: qualificationHash
        });
    }

    function _definition() private view returns (FeeScheduleDefinition memory) {
        return FeeScheduleDefinition({
            namespaceId: NAMESPACE_ID,
            scheduleKey: SCHEDULE_KEY,
            feeModelId: FeeScheduleDefinitionLib.FEE_MODEL_MAKER_TAKER,
            settlementAssetId: settlementAssetId,
            settlementAssetVersion: 1,
            feeRulesHash: FEE_RULES_HASH,
            recipientsHash: RECIPIENTS_HASH,
            maxChargeRatePpm: FeeRatePpm.wrap(MAX_CHARGE_PPM),
            maxRebateRatePpm: FeeRatePpm.wrap(MAX_REBATE_PPM),
            maxFlatChargeBaseUnits: MAX_FLAT_CHARGE,
            maxFlatRebateBaseUnits: MAX_FLAT_REBATE,
            evidenceHash: EVIDENCE_HASH
        });
    }
}
