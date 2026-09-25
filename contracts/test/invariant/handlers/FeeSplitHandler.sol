// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {FeeEngineLib} from "../../../src/libraries/FeeEngineLib.sol";
import {FeeRecipient, FeeRecipientSet} from "../../../src/types/FeeEngineTypes.sol";
import {AccountId} from "../../../src/types/Identifiers.sol";
import {PPM_DENOMINATOR} from "../../../src/types/Units.sol";
import {FeeEngineHarness} from "../../unit/harness/FeeEngineHarness.sol";

contract FeeSplitHandler {
    FeeEngineHarness public immutable harness;
    uint128 public lastCharge;
    uint256 public lastAllocated;

    constructor(FeeEngineHarness harness_) {
        harness = harness_;
    }

    function split(uint128 charge, uint32 shareSeed, bool remainderToFirst) external {
        uint32 firstShare = uint32(uint256(shareSeed) % (PPM_DENOMINATOR - 1)) + 1;
        FeeRecipientSet memory recipients;
        recipients.remainderPolicyId = FeeEngineLib.REMAINDER_TO_DESIGNATED_RECIPIENT;
        recipients.remainderRecipientIndex = remainderToFirst ? 0 : 1;
        recipients.recipients = new FeeRecipient[](2);
        recipients.recipients[0] = FeeRecipient({accountId: AccountId.wrap(bytes32(uint256(1))), sharePpm: firstShare});
        recipients.recipients[1] = FeeRecipient({
            accountId: AccountId.wrap(bytes32(uint256(2))), sharePpm: uint32(PPM_DENOMINATOR) - firstShare
        });
        uint128[] memory amounts = harness.splitCharge(charge, recipients);
        lastCharge = charge;
        lastAllocated = uint256(amounts[0]) + uint256(amounts[1]);
    }
}
