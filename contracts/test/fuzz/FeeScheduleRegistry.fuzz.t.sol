// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {IFeeScheduleRegistry} from "../../src/interfaces/IFeeScheduleRegistry.sol";
import {FeeScheduleDefinitionLib} from "../../src/libraries/FeeScheduleDefinitionLib.sol";
import {AssetRegistry} from "../../src/registry/AssetRegistry.sol";
import {FeeScheduleRegistry} from "../../src/registry/FeeScheduleRegistry.sol";
import {SettlementAssetRegistry} from "../../src/registry/SettlementAssetRegistry.sol";
import {AssetDefinition} from "../../src/types/AssetDefinition.sol";
import {AssetClass, RegistryStatus} from "../../src/types/Enums.sol";
import {FeeScheduleDefinition, FeeScheduleVersion} from "../../src/types/FeeScheduleDefinition.sol";
import {AssetId, FeeModelId, FeeScheduleId} from "../../src/types/Identifiers.sol";
import {FeeRatePpm, PPM_DENOMINATOR} from "../../src/types/Units.sol";
import {SettlementAssetDefinition} from "../../src/types/SettlementAssetDefinition.sol";
import {MockERC20Metadata} from "../mocks/TokenMocks.sol";

contract FeeScheduleRegistryFuzzTest is Test {
    uint48 internal constant ADMIN_DELAY = 3 days;

    bytes32 internal constant NAMESPACE_ID = keccak256("setryn.fee");
    bytes32 internal constant SCHEDULE_KEY = keccak256("fee:perp:standard");

    uint8 internal constant CANONICAL_DECIMALS = 6;

    address internal admin = makeAddr("admin");
    address internal qualifier = makeAddr("qualifier");

    AssetRegistry internal assets;
    SettlementAssetRegistry internal settlement;
    FeeScheduleRegistry internal registry;

    AssetId internal settlementAssetId;

    function setUp() public {
        assets = new AssetRegistry(ADMIN_DELAY, admin);
        settlement = new SettlementAssetRegistry(ADMIN_DELAY, admin, assets);
        registry = new FeeScheduleRegistry(ADMIN_DELAY, admin, settlement);

        MockERC20Metadata token = new MockERC20Metadata(CANONICAL_DECIMALS);

        vm.startPrank(admin);
        registry.grantRole(registry.FEE_SCHEDULE_QUALIFIER_ROLE(), qualifier);
        settlementAssetId = assets.registerAsset(
            AssetDefinition({
                namespaceId: keccak256("setryn.asset"),
                referenceId: keccak256("iso4217:USD"),
                symbol: "USDC",
                assetClass: AssetClass.Stablecoin,
                decimals: CANONICAL_DECIMALS
            })
        );
        settlement.registerBinding(
            SettlementAssetDefinition({
                assetId: settlementAssetId,
                token: address(token),
                expectedRuntimeCodeHash: address(token).codehash,
                qualificationHash: keccak256("settlement.qualification.v1")
            })
        );
        vm.stopPrank();
    }

    /// @dev The bound envelope must hold across the entire rate and flat domain rather than at the
    /// handful of points a unit test can name. Only two shapes are refused: a rate above the whole,
    /// and an inert schedule with all four levers at zero. Every other combination registers and
    /// stores back exactly what was submitted, including a rebate-only schedule and a rebate envelope
    /// wider than the charge envelope, because the two envelopes are independent per-event ceilings
    /// and funding is the fee engine's obligation rather than this registry's.
    function testFuzz_BoundEnvelopeIsEnforcedAcrossTheWholeDomain(
        uint32 maxChargeRatePpm,
        uint32 maxRebateRatePpm,
        uint128 maxFlatChargeBaseUnits,
        uint128 maxFlatRebateBaseUnits
    ) public {
        FeeScheduleDefinition memory definition = _definition();
        definition.maxChargeRatePpm = FeeRatePpm.wrap(maxChargeRatePpm);
        definition.maxRebateRatePpm = FeeRatePpm.wrap(maxRebateRatePpm);
        definition.maxFlatChargeBaseUnits = maxFlatChargeBaseUnits;
        definition.maxFlatRebateBaseUnits = maxFlatRebateBaseUnits;

        bool rateOutOfRange = maxChargeRatePpm > PPM_DENOMINATOR || maxRebateRatePpm > PPM_DENOMINATOR;
        bool inert = maxChargeRatePpm == 0 && maxRebateRatePpm == 0 && maxFlatChargeBaseUnits == 0
            && maxFlatRebateBaseUnits == 0;

        if (rateOutOfRange || inert) {
            vm.prank(qualifier);
            vm.expectRevert();
            registry.registerFeeSchedule(definition);
            assertEq(registry.feeScheduleCount(), 0);
            return;
        }

        vm.prank(qualifier);
        (FeeScheduleId feeScheduleId, uint32 version) = registry.registerFeeSchedule(definition);

        FeeScheduleVersion memory record = registry.getFeeSchedule(feeScheduleId, version);
        assertEq(FeeRatePpm.unwrap(record.definition.maxChargeRatePpm), maxChargeRatePpm);
        assertEq(FeeRatePpm.unwrap(record.definition.maxRebateRatePpm), maxRebateRatePpm);
        assertEq(record.definition.maxFlatChargeBaseUnits, maxFlatChargeBaseUnits);
        assertEq(record.definition.maxFlatRebateBaseUnits, maxFlatRebateBaseUnits);
        assertEq(uint8(record.status), uint8(RegistryStatus.Paused));
        assertEq(record.definitionHash, FeeScheduleDefinitionLib.hashDefinition(definition, block.chainid));
    }

    /// @dev Identity is the namespaced schedule name alone, so an arbitrary fee model and an
    /// arbitrary pair of rule and recipient commitments must all collapse onto one lineage, take
    /// sequential versions, stay readable unchanged, and never be registrable twice.
    function testFuzz_ArbitraryModelsAndCommitmentsShareOneLineage(bytes32[4] memory seeds) public {
        FeeScheduleId expectedId = FeeScheduleDefinitionLib.deriveFeeScheduleId(_definition());
        bytes32[4] memory storedHashes;

        for (uint256 i = 0; i < seeds.length; i++) {
            FeeScheduleDefinition memory definition = _definition();
            definition.feeModelId = FeeModelId.wrap(keccak256(abi.encode(seeds[i], "model", i)));
            definition.feeRulesHash = keccak256(abi.encode(seeds[i], "rules", i));
            definition.recipientsHash = keccak256(abi.encode(seeds[i], "recipients", i));

            vm.prank(qualifier);
            (FeeScheduleId feeScheduleId, uint32 version) = registry.registerFeeSchedule(definition);

            assertEq(FeeScheduleId.unwrap(feeScheduleId), FeeScheduleId.unwrap(expectedId));
            assertEq(version, uint32(i + 1));
            assertEq(registry.latestVersion(feeScheduleId), version);
            assertEq(registry.feeScheduleCount(), i + 1);

            storedHashes[i] = registry.getFeeSchedule(feeScheduleId, version).definitionHash;

            vm.expectRevert(
                abi.encodeWithSelector(
                    IFeeScheduleRegistry.DuplicateFeeScheduleDefinition.selector,
                    feeScheduleId,
                    storedHashes[i],
                    version
                )
            );
            vm.prank(qualifier);
            registry.registerFeeSchedule(definition);
        }

        for (uint256 i = 0; i < seeds.length; i++) {
            uint32 version = uint32(i + 1);
            FeeScheduleVersion memory record = registry.getFeeSchedule(expectedId, version);

            assertEq(record.version, version);
            assertEq(record.definitionHash, storedHashes[i]);
            assertEq(
                record.versionHash,
                FeeScheduleDefinitionLib.hashVersion(expectedId, version, storedHashes[i], block.chainid)
            );
            assertTrue(registry.isLifecycleEnabled(expectedId, version));
            assertFalse(registry.isOpenForNewRisk(expectedId, version));
        }
    }

    function _definition() private view returns (FeeScheduleDefinition memory) {
        return FeeScheduleDefinition({
            namespaceId: NAMESPACE_ID,
            scheduleKey: SCHEDULE_KEY,
            feeModelId: FeeScheduleDefinitionLib.FEE_MODEL_MAKER_TAKER,
            settlementAssetId: settlementAssetId,
            settlementAssetVersion: 1,
            feeRulesHash: keccak256("fee.rules.v1"),
            recipientsHash: keccak256("fee.recipients.v1"),
            maxChargeRatePpm: FeeRatePpm.wrap(1_000),
            maxRebateRatePpm: FeeRatePpm.wrap(250),
            maxFlatChargeBaseUnits: 5_000_000,
            maxFlatRebateBaseUnits: 1_000_000,
            evidenceHash: keccak256("fee.evidence.v1")
        });
    }
}
