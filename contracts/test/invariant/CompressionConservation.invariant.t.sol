// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {AccountId, CollateralId, PositionId, RiskDomainId, SeriesId} from "../../src/types/Identifiers.sol";
import {
    CompressionConsent,
    CompressionPlanDefinition,
    CompressionPlanId,
    CompressionPosition,
    CompressionSuccessor,
    ReplacementCollateral
} from "../../src/types/CompressionTypes.sol";
import {Lots, PriceTicks} from "../../src/types/Units.sol";
import {CompressionHarness} from "../unit/harness/CompressionHarness.sol";

contract CompressionConservationInvariantTest is Test {
    CompressionHarness internal harness;
    CompressionPlanDefinition internal definition;
    CompressionPosition[] internal inputs;
    CompressionSuccessor[] internal successors;
    ReplacementCollateral[] internal replacement;
    CompressionConsent[] internal consents;

    function setUp() public {
        harness = new CompressionHarness();
        AccountId first = AccountId.wrap(bytes32(uint256(1)));
        AccountId second = AccountId.wrap(bytes32(uint256(2)));
        RiskDomainId domain = RiskDomainId.wrap(bytes32(uint256(3)));
        CollateralId collateral = CollateralId.wrap(bytes32(uint256(4)));
        SeriesId series = SeriesId.wrap(bytes32(uint256(5)));
        bytes32 economics = keccak256("economics");
        inputs.push(
            CompressionPosition({
                positionId: PositionId.wrap(bytes32(uint256(1))),
                seriesId: series,
                seriesVersion: 1,
                longAccountId: first,
                shortAccountId: second,
                riskDomainId: domain,
                riskDomainVersion: 1,
                collateralId: collateral,
                lots: Lots.wrap(10),
                entryPriceTicks: PriceTicks.wrap(100),
                economicsHash: economics,
                longTerminalLiabilityBaseUnits: 10,
                shortTerminalLiabilityBaseUnits: 10,
                lifecycleHash: keccak256("live")
            })
        );
        successors.push(
            CompressionSuccessor({
                successorKey: bytes32(uint256(1)),
                seriesId: series,
                seriesVersion: 1,
                longAccountId: first,
                shortAccountId: second,
                riskDomainId: domain,
                riskDomainVersion: 1,
                collateralId: collateral,
                lots: Lots.wrap(10),
                entryPriceTicks: PriceTicks.wrap(100),
                economicsHash: economics,
                longTerminalLiabilityBaseUnits: 10,
                shortTerminalLiabilityBaseUnits: 10
            })
        );
        replacement.push(
            ReplacementCollateral({accountId: first, collateralId: collateral, terminalLiabilityBaseUnits: 10})
        );
        replacement.push(
            ReplacementCollateral({accountId: second, collateralId: collateral, terminalLiabilityBaseUnits: 10})
        );
        consents.push(_consent(first));
        consents.push(_consent(second));
        definition.riskDomainId = domain;
        definition.riskDomainVersion = 1;
        definition.collateralId = collateral;
        definition.accountCount = 2;
    }

    function invariant_CommittedExposureAndLiabilityRemainConserved() public view {
        harness.validateConservation(definition, inputs, successors, replacement, consents);
    }

    function _consent(AccountId accountId) internal pure returns (CompressionConsent memory) {
        return CompressionConsent({
            planId: CompressionPlanId.wrap(bytes32(uint256(1))),
            accountId: accountId,
            signer: address(1),
            nonce: 1,
            deadline: 1,
            maximumLiabilityIncreaseBaseUnits: 0,
            maximumPayoffReductionBaseUnits: 0,
            salt: keccak256(abi.encode(accountId))
        });
    }
}
