// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {FeeEngineLib} from "../../src/libraries/FeeEngineLib.sol";
import {FeeScheduleDefinitionLib} from "../../src/libraries/FeeScheduleDefinitionLib.sol";
import {FeeComputation, FeeRecipient, FeeRecipientSet, FeeRule} from "../../src/types/FeeEngineTypes.sol";
import {FeeScheduleDefinition} from "../../src/types/FeeScheduleDefinition.sol";
import {AccountId, AssetId, FeeActionId} from "../../src/types/Identifiers.sol";
import {FeeRatePpm, PPM_DENOMINATOR} from "../../src/types/Units.sol";
import {FeeEngineHarness} from "../unit/harness/FeeEngineHarness.sol";

contract FeeEngineFuzzTest is Test {
    FeeEngineHarness internal harness;

    function setUp() public {
        harness = new FeeEngineHarness();
    }

    function testFuzz_ChargeRoundsUpAndRebateRoundsDown(uint128 notional, uint32 chargeRate, uint32 rebateRate)
        public
        view
    {
        chargeRate = uint32(bound(chargeRate, 0, PPM_DENOMINATOR));
        rebateRate = uint32(bound(rebateRate, 0, PPM_DENOMINATOR));
        vm.assume(chargeRate != 0 || rebateRate != 0);
        FeeScheduleDefinition memory definition = _definition(chargeRate, rebateRate);
        FeeRule memory rule;
        rule.actionId = FeeActionId.wrap(keccak256("action"));
        rule.chargeRatePpm = FeeRatePpm.wrap(chargeRate);
        rule.rebateRatePpm = FeeRatePpm.wrap(rebateRate);

        FeeComputation memory result = harness.compute(definition, rule, notional, 0);
        uint256 chargeProduct = uint256(notional) * chargeRate;
        uint256 rebateProduct = uint256(notional) * rebateRate;
        uint256 expectedCharge = chargeProduct == 0 ? 0 : (chargeProduct - 1) / PPM_DENOMINATOR + 1;

        assertEq(result.chargeMinor, expectedCharge);
        assertEq(result.rebateMinor, rebateProduct / PPM_DENOMINATOR);
    }

    function testFuzz_RecipientSplitAlwaysConservesCharge(uint128 charge, uint32 firstShare) public view {
        firstShare = uint32(bound(firstShare, 1, PPM_DENOMINATOR - 1));
        FeeRecipientSet memory recipients;
        recipients.remainderPolicyId = FeeEngineLib.REMAINDER_TO_DESIGNATED_RECIPIENT;
        recipients.remainderRecipientIndex = 1;
        recipients.recipients = new FeeRecipient[](2);
        recipients.recipients[0] = FeeRecipient({accountId: AccountId.wrap(bytes32(uint256(1))), sharePpm: firstShare});
        recipients.recipients[1] = FeeRecipient({
            accountId: AccountId.wrap(bytes32(uint256(2))), sharePpm: uint32(PPM_DENOMINATOR) - firstShare
        });

        uint128[] memory amounts = harness.splitCharge(charge, recipients);

        assertEq(uint256(amounts[0]) + uint256(amounts[1]), charge);
    }

    function _definition(uint32 chargeRate, uint32 rebateRate) private pure returns (FeeScheduleDefinition memory) {
        return FeeScheduleDefinition({
            namespaceId: keccak256("setryn"),
            scheduleKey: keccak256("fuzz"),
            feeModelId: FeeScheduleDefinitionLib.FEE_MODEL_AD_VALOREM,
            settlementAssetId: AssetId.wrap(keccak256("usdc")),
            settlementAssetVersion: 1,
            feeRulesHash: keccak256("rules"),
            recipientsHash: keccak256("recipients"),
            maxChargeRatePpm: FeeRatePpm.wrap(chargeRate),
            maxRebateRatePpm: FeeRatePpm.wrap(rebateRate),
            maxFlatChargeBaseUnits: 0,
            maxFlatRebateBaseUnits: 0,
            evidenceHash: keccak256("evidence")
        });
    }
}
