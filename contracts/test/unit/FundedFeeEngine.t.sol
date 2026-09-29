// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {ICollateralVault} from "../../src/interfaces/ICollateralVault.sol";
import {IFeeScheduleRegistry} from "../../src/interfaces/IFeeScheduleRegistry.sol";
import {IFundedFeeEngine} from "../../src/interfaces/IFundedFeeEngine.sol";
import {FundedFeeEngine} from "../../src/fees/FundedFeeEngine.sol";
import {FeeEngineLib} from "../../src/libraries/FeeEngineLib.sol";
import {FeeScheduleDefinitionLib} from "../../src/libraries/FeeScheduleDefinitionLib.sol";
import {ClearingFeeQuote} from "../../src/types/ClearingTypes.sol";
import {
    FeeActionRequest,
    FeeActionResult,
    FeeRecipient,
    FeeRecipientSet,
    FeeRule,
    FeeTier
} from "../../src/types/FeeEngineTypes.sol";
import {FeeScheduleDefinition} from "../../src/types/FeeScheduleDefinition.sol";
import {
    AccountId,
    AssetId,
    CollateralLockId,
    FeeActionId,
    FeeModelId,
    FeeScheduleId
} from "../../src/types/Identifiers.sol";
import {PublicOrder} from "../../src/types/OrderTypes.sol";
import {FeeRatePpm, Lots, PriceTicks} from "../../src/types/Units.sol";
import {
    FeeSettlementRegistryMock,
    FundedFeeCollateralVaultMock,
    FundedFeeScheduleRegistryMock
} from "../mocks/FundedFeeEngineMocks.sol";
import {FeeEngineHarness} from "./harness/FeeEngineHarness.sol";

contract FundedFeeEngineTest is Test {
    uint32 internal constant VERSION = 1;
    AssetId internal constant ASSET = AssetId.wrap(keccak256("usdc"));
    AccountId internal constant COLLECTOR_A = AccountId.wrap(bytes32(uint256(1)));
    AccountId internal constant COLLECTOR_B = AccountId.wrap(bytes32(uint256(2)));
    AccountId internal constant CHARGE_PAYER = AccountId.wrap(bytes32(uint256(10)));
    AccountId internal constant REBATE_RECIPIENT = AccountId.wrap(bytes32(uint256(20)));
    AccountId internal constant BUDGET_ACCOUNT = AccountId.wrap(bytes32(uint256(30)));

    FundedFeeScheduleRegistryMock internal schedules;
    FundedFeeCollateralVaultMock internal vault;
    FeeEngineHarness internal harness;
    FundedFeeEngine internal engine;
    FeeScheduleId internal scheduleId;

    function setUp() public {
        FeeSettlementRegistryMock settlementRegistry = new FeeSettlementRegistryMock();
        schedules = new FundedFeeScheduleRegistryMock(address(settlementRegistry));
        vault = new FundedFeeCollateralVaultMock(address(settlementRegistry));
        harness = new FeeEngineHarness();
        engine = new FundedFeeEngine(
            0, address(this), IFeeScheduleRegistry(address(schedules)), ICollateralVault(address(vault))
        );

        FeeRule[] memory rules = _makerTakerRules();
        FeeRecipientSet memory recipients = _splitRecipients();
        FeeScheduleDefinition memory definition = _definition(FeeScheduleDefinitionLib.FEE_MODEL_MAKER_TAKER);
        definition.feeRulesHash = harness.hashRules(rules);
        definition.recipientsHash = harness.hashRecipients(recipients);
        scheduleId = schedules.setSchedule(definition, VERSION, true, true);
        vault.createAccount(COLLECTOR_A);
        vault.createAccount(COLLECTOR_B);
        engine.installScheduleWitness(scheduleId, VERSION, rules, recipients);
    }

    function test_ConsumesFundedChargeAndRebateOnceWithConservedEntries() public {
        vm.warp(100);
        bytes32 parentActionId = keccak256("fill");
        bytes32 consumptionId = engine.deriveConsumptionId(
            parentActionId,
            scheduleId,
            VERSION,
            FeeScheduleDefinitionLib.FEE_ACTION_MAKER_FILL,
            CHARGE_PAYER,
            REBATE_RECIPIENT,
            0
        );
        CollateralLockId chargeLock =
            _fundLock(consumptionId, engine.CHARGE_FUNDING_PURPOSE(), CHARGE_PAYER, 102, address(0xCA11));
        CollateralLockId budgetLock =
            _fundLock(consumptionId, engine.BUDGET_FUNDING_PURPOSE(), BUDGET_ACCOUNT, 99, address(0xB0D6));
        FeeActionRequest memory request = FeeActionRequest({
            parentActionId: parentActionId,
            consumptionId: consumptionId,
            feeScheduleId: scheduleId,
            feeScheduleVersion: VERSION,
            actionId: FeeScheduleDefinitionLib.FEE_ACTION_MAKER_FILL,
            chargePayerAccountId: CHARGE_PAYER,
            rebateRecipientAccountId: REBATE_RECIPIENT,
            notionalMinor: 1_000_001,
            qualifyingVolumeMinor: 0,
            maxFeeMinor: 102,
            chargeLockId: chargeLock,
            budgetLockId: budgetLock,
            actionOrdinal: 0
        });

        FeeActionResult memory result = engine.consumeFeeAction(request);

        assertEq(result.chargeMinor, 102);
        assertEq(result.rebateMinor, 99);
        assertEq(result.entries.length, 5);
        assertEq(vault.credited(COLLECTOR_A), 34);
        assertEq(vault.credited(COLLECTOR_B), 68);
        assertEq(vault.credited(REBATE_RECIPIENT), 99);
        assertTrue(engine.feeActionConsumed(consumptionId));

        vm.expectPartialRevert(IFundedFeeEngine.FeeActionAlreadyConsumed.selector);
        engine.consumeFeeAction(request);
    }

    function test_NewFillRuleRequiresExactScheduleToRemainOpen() public {
        schedules.setOpen(scheduleId, VERSION, false);
        bytes32 parentActionId = keccak256("fill.closed");
        bytes32 consumptionId = engine.deriveConsumptionId(
            parentActionId,
            scheduleId,
            VERSION,
            FeeScheduleDefinitionLib.FEE_ACTION_MAKER_FILL,
            CHARGE_PAYER,
            REBATE_RECIPIENT,
            0
        );
        FeeActionRequest memory request;
        request.parentActionId = parentActionId;
        request.consumptionId = consumptionId;
        request.feeScheduleId = scheduleId;
        request.feeScheduleVersion = VERSION;
        request.actionId = FeeScheduleDefinitionLib.FEE_ACTION_MAKER_FILL;
        request.chargePayerAccountId = CHARGE_PAYER;
        request.rebateRecipientAccountId = REBATE_RECIPIENT;
        request.notionalMinor = 1_000_001;
        request.maxFeeMinor = 102;

        vm.expectPartialRevert(IFundedFeeEngine.FeeScheduleNotOpen.selector);
        engine.consumeFeeAction(request);
    }

    function test_HistoricalLifecycleActionUsesPausedExactScheduleWithFundedBudget() public {
        FeeRule[] memory rules = new FeeRule[](1);
        rules[0].actionId = FeeScheduleDefinitionLib.FEE_ACTION_SETTLEMENT;
        rules[0].requiresOpenSchedule = false;
        rules[0].flatChargeMinor = 5;
        rules[0].flatRebateMinor = 3;
        FeeRecipientSet memory recipients = _singleRecipient();
        FeeScheduleDefinition memory definition = _definition(FeeScheduleDefinitionLib.FEE_MODEL_FLAT_PER_ACTION);
        definition.scheduleKey = keccak256("historical.schedule");
        definition.maxChargeRatePpm = FeeRatePpm.wrap(0);
        definition.maxRebateRatePpm = FeeRatePpm.wrap(0);
        definition.maxFlatChargeBaseUnits = 5;
        definition.maxFlatRebateBaseUnits = 3;
        definition.feeRulesHash = harness.hashRules(rules);
        definition.recipientsHash = harness.hashRecipients(recipients);
        FeeScheduleId historicalId = schedules.setSchedule(definition, VERSION, true, false);
        engine.installScheduleWitness(historicalId, VERSION, rules, recipients);

        vm.warp(100);
        bytes32 parentActionId = keccak256("historical.settlement");
        bytes32 consumptionId = engine.deriveConsumptionId(
            parentActionId,
            historicalId,
            VERSION,
            FeeScheduleDefinitionLib.FEE_ACTION_SETTLEMENT,
            CHARGE_PAYER,
            REBATE_RECIPIENT,
            0
        );
        FeeActionRequest memory request = FeeActionRequest({
            parentActionId: parentActionId,
            consumptionId: consumptionId,
            feeScheduleId: historicalId,
            feeScheduleVersion: VERSION,
            actionId: FeeScheduleDefinitionLib.FEE_ACTION_SETTLEMENT,
            chargePayerAccountId: CHARGE_PAYER,
            rebateRecipientAccountId: REBATE_RECIPIENT,
            notionalMinor: 0,
            qualifyingVolumeMinor: 0,
            maxFeeMinor: 5,
            chargeLockId: _fundLock(consumptionId, engine.CHARGE_FUNDING_PURPOSE(), CHARGE_PAYER, 5, address(0xCA12)),
            budgetLockId: _fundLock(consumptionId, engine.BUDGET_FUNDING_PURPOSE(), BUDGET_ACCOUNT, 3, address(0xB0D7)),
            actionOrdinal: 0
        });

        FeeActionResult memory result = engine.consumeFeeAction(request);

        assertEq(result.chargeMinor, 5);
        assertEq(result.rebateMinor, 3);
    }

    function test_RejectsWitnessThatDoesNotMatchExactScheduleCommitment() public {
        FeeRule[] memory rules = _makerTakerRules();
        FeeRecipientSet memory recipients = _splitRecipients();
        FeeScheduleDefinition memory definition = _definition(FeeScheduleDefinitionLib.FEE_MODEL_MAKER_TAKER);
        definition.feeRulesHash = harness.hashRules(rules);
        definition.recipientsHash = harness.hashRecipients(recipients);
        definition.scheduleKey = keccak256("other.schedule");
        FeeScheduleId otherSchedule = schedules.setSchedule(definition, VERSION, true, true);
        rules[0].chargeRatePpm = FeeRatePpm.wrap(FeeRatePpm.unwrap(rules[0].chargeRatePpm) + 1);

        vm.expectPartialRevert(IFundedFeeEngine.FeeRulesCommitmentMismatch.selector);
        engine.installScheduleWitness(otherSchedule, VERSION, rules, recipients);
    }

    function test_RejectsWitnessWithUnknownRecipientUntilAccountCreated() public {
        AccountId unknown = AccountId.wrap(bytes32(uint256(99)));
        FeeRule[] memory rules = _makerTakerRules();
        FeeRecipientSet memory recipients;
        recipients.remainderPolicyId = FeeEngineLib.REMAINDER_TO_DESIGNATED_RECIPIENT;
        recipients.remainderRecipientIndex = 0;
        recipients.recipients = new FeeRecipient[](1);
        recipients.recipients[0] = FeeRecipient({accountId: unknown, sharePpm: 1_000_000});
        FeeScheduleDefinition memory definition = _definition(FeeScheduleDefinitionLib.FEE_MODEL_MAKER_TAKER);
        definition.scheduleKey = keccak256("unknown.recipient.schedule");
        definition.feeRulesHash = harness.hashRules(rules);
        definition.recipientsHash = harness.hashRecipients(recipients);
        FeeScheduleId unknownSchedule = schedules.setSchedule(definition, VERSION, true, true);

        vm.expectRevert(abi.encodeWithSelector(IFundedFeeEngine.UnknownFeeRecipient.selector, unknown));
        engine.installScheduleWitness(unknownSchedule, VERSION, rules, recipients);

        vault.createAccount(unknown);
        engine.installScheduleWitness(unknownSchedule, VERSION, rules, recipients);
        assertTrue(engine.witnessInstalled(unknownSchedule, VERSION));
    }

    function test_LegacyClearingFailsClosedForRebatesAndRecipientSplits() public {
        PublicOrder memory taker;
        PublicOrder memory maker;
        taker.feeScheduleId = scheduleId;
        taker.feeScheduleVersion = VERSION;
        taker.maxFeeMinor = type(uint128).max;
        maker.feeScheduleId = scheduleId;
        maker.feeScheduleVersion = VERSION;
        maker.maxFeeMinor = type(uint128).max;

        vm.expectPartialRevert(IFundedFeeEngine.LegacyScheduleUnsupported.selector);
        engine.quoteFees(taker, maker, Lots.wrap(1), PriceTicks.wrap(1), keccak256("target.witness"));
    }

    function test_LegacyClearingQuotesOnlyFlatChargeAndOneCollector() public {
        FeeRule[] memory rules = _legacyRules();
        FeeRecipientSet memory recipients = _singleRecipient();
        FeeScheduleDefinition memory definition = _definition(FeeScheduleDefinitionLib.FEE_MODEL_FLAT_PER_ACTION);
        definition.scheduleKey = keccak256("legacy.schedule");
        definition.maxChargeRatePpm = FeeRatePpm.wrap(0);
        definition.maxRebateRatePpm = FeeRatePpm.wrap(0);
        definition.maxFlatChargeBaseUnits = 20;
        definition.maxFlatRebateBaseUnits = 0;
        definition.feeRulesHash = harness.hashRules(rules);
        definition.recipientsHash = harness.hashRecipients(recipients);
        FeeScheduleId legacyId = schedules.setSchedule(definition, VERSION, true, true);
        engine.installScheduleWitness(legacyId, VERSION, rules, recipients);

        PublicOrder memory taker;
        PublicOrder memory maker;
        taker.feeScheduleId = legacyId;
        taker.feeScheduleVersion = VERSION;
        taker.maxFeeMinor = 20;
        maker.feeScheduleId = legacyId;
        maker.feeScheduleVersion = VERSION;
        maker.maxFeeMinor = 20;
        ClearingFeeQuote memory quote =
            engine.quoteFees(taker, maker, Lots.wrap(5), PriceTicks.wrap(10), keccak256("target.witness"));

        assertEq(quote.makerFeeMinor, 7);
        assertEq(quote.takerFeeMinor, 11);
        assertEq(AccountId.unwrap(quote.recipientAccountId), AccountId.unwrap(COLLECTOR_A));
        assertTrue(quote.quoteReference != bytes32(0));
    }

    function test_VolumeTierSelectsHighestReachedThreshold() public view {
        FeeScheduleDefinition memory definition = _definition(FeeScheduleDefinitionLib.FEE_MODEL_VOLUME_TIERED);
        definition.maxChargeRatePpm = FeeRatePpm.wrap(1_000);
        definition.maxRebateRatePpm = FeeRatePpm.wrap(1_000);
        FeeRule memory rule;
        rule.actionId = FeeActionId.wrap(keccak256("volume.action"));
        rule.tiers = new FeeTier[](2);
        rule.tiers[0].chargeRatePpm = FeeRatePpm.wrap(900);
        rule.tiers[1].minimumVolumeMinor = 1_000_000;
        rule.tiers[1].chargeRatePpm = FeeRatePpm.wrap(400);

        assertEq(harness.compute(definition, rule, 1_000_000, 999_999).chargeMinor, 900);
        assertEq(harness.compute(definition, rule, 1_000_000, 1_000_000).chargeMinor, 400);
    }

    function _fundLock(bytes32 consumptionId, bytes32 purpose, AccountId accountId, uint128 amount, address operator)
        private
        returns (CollateralLockId)
    {
        return vault.setLock(
            operator,
            engine.deriveFundingReference(consumptionId, purpose),
            accountId,
            ASSET,
            VERSION,
            amount,
            1_000,
            address(engine)
        );
    }

    function _makerTakerRules() private pure returns (FeeRule[] memory rules) {
        rules = new FeeRule[](2);
        rules[0].actionId = FeeScheduleDefinitionLib.FEE_ACTION_MAKER_FILL;
        rules[0].requiresOpenSchedule = true;
        rules[0].chargeRatePpm = FeeRatePpm.wrap(101);
        rules[0].rebateRatePpm = FeeRatePpm.wrap(99);
        rules[1].actionId = FeeScheduleDefinitionLib.FEE_ACTION_TAKER_FILL;
        rules[1].requiresOpenSchedule = true;
        rules[1].chargeRatePpm = FeeRatePpm.wrap(200);
        if (FeeActionId.unwrap(rules[0].actionId) > FeeActionId.unwrap(rules[1].actionId)) {
            FeeRule memory swap = rules[0];
            rules[0] = rules[1];
            rules[1] = swap;
        }
    }

    function _legacyRules() private pure returns (FeeRule[] memory rules) {
        rules = new FeeRule[](2);
        rules[0].actionId = FeeScheduleDefinitionLib.FEE_ACTION_MAKER_FILL;
        rules[0].requiresOpenSchedule = true;
        rules[0].flatChargeMinor = 7;
        rules[1].actionId = FeeScheduleDefinitionLib.FEE_ACTION_TAKER_FILL;
        rules[1].requiresOpenSchedule = true;
        rules[1].flatChargeMinor = 11;
        if (FeeActionId.unwrap(rules[0].actionId) > FeeActionId.unwrap(rules[1].actionId)) {
            FeeRule memory swap = rules[0];
            rules[0] = rules[1];
            rules[1] = swap;
        }
    }

    function _splitRecipients() private pure returns (FeeRecipientSet memory recipients) {
        recipients.remainderPolicyId = FeeEngineLib.REMAINDER_TO_DESIGNATED_RECIPIENT;
        recipients.remainderRecipientIndex = 0;
        recipients.recipients = new FeeRecipient[](2);
        recipients.recipients[0] = FeeRecipient({accountId: COLLECTOR_A, sharePpm: 333_333});
        recipients.recipients[1] = FeeRecipient({accountId: COLLECTOR_B, sharePpm: 666_667});
    }

    function _singleRecipient() private pure returns (FeeRecipientSet memory recipients) {
        recipients.remainderPolicyId = FeeEngineLib.REMAINDER_TO_DESIGNATED_RECIPIENT;
        recipients.remainderRecipientIndex = 0;
        recipients.recipients = new FeeRecipient[](1);
        recipients.recipients[0] = FeeRecipient({accountId: COLLECTOR_A, sharePpm: 1_000_000});
    }

    function _definition(FeeModelId model) private pure returns (FeeScheduleDefinition memory) {
        return FeeScheduleDefinition({
            namespaceId: keccak256("setryn"),
            scheduleKey: keccak256("maker.taker.schedule"),
            feeModelId: model,
            settlementAssetId: ASSET,
            settlementAssetVersion: VERSION,
            feeRulesHash: bytes32(uint256(1)),
            recipientsHash: bytes32(uint256(1)),
            maxChargeRatePpm: FeeRatePpm.wrap(300),
            maxRebateRatePpm: FeeRatePpm.wrap(200),
            maxFlatChargeBaseUnits: 0,
            maxFlatRebateBaseUnits: 0,
            evidenceHash: keccak256("fee.evidence")
        });
    }
}
