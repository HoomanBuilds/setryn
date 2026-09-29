// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {CompressionLib} from "../../src/libraries/CompressionLib.sol";
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
import {CompressionHarness} from "./harness/CompressionHarness.sol";

contract CompressionLibTest is Test {
    CompressionHarness internal harness;

    function setUp() public {
        harness = new CompressionHarness();
    }

    function test_ExactEconomicExposureCanBeCompressed() public view {
        (
            CompressionPlanDefinition memory definition,
            CompressionPosition[] memory inputs,
            CompressionSuccessor[] memory successors,
            ReplacementCollateral[] memory replacement,
            CompressionConsent[] memory consents
        ) = _fixture(10, 4);
        harness.validateConservation(definition, inputs, successors, replacement, consents);
    }

    function testFuzz_ConservationRejectsChangedResidual(uint128 firstLots, uint128 secondLots) public {
        firstLots = uint128(bound(firstLots, 2, 1_000));
        secondLots = uint128(bound(secondLots, 1, firstLots - 1));
        (
            CompressionPlanDefinition memory definition,
            CompressionPosition[] memory inputs,
            CompressionSuccessor[] memory successors,
            ReplacementCollateral[] memory replacement,
            CompressionConsent[] memory consents
        ) = _fixture(firstLots, secondLots);
        successors[0].lots = Lots.wrap(firstLots - secondLots + 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                CompressionLib.ExposureNotConserved.selector,
                AccountId.unwrap(inputs[0].longAccountId),
                SeriesId.unwrap(inputs[0].seriesId),
                inputs[0].economicsHash
            )
        );
        harness.validateConservation(definition, inputs, successors, replacement, consents);
    }

    function _fixture(uint128 firstLots, uint128 secondLots)
        internal
        pure
        returns (
            CompressionPlanDefinition memory definition,
            CompressionPosition[] memory inputs,
            CompressionSuccessor[] memory successors,
            ReplacementCollateral[] memory replacement,
            CompressionConsent[] memory consents
        )
    {
        AccountId first = AccountId.wrap(bytes32(uint256(1)));
        AccountId second = AccountId.wrap(bytes32(uint256(2)));
        RiskDomainId domain = RiskDomainId.wrap(bytes32(uint256(3)));
        CollateralId collateral = CollateralId.wrap(bytes32(uint256(4)));
        SeriesId series = SeriesId.wrap(bytes32(uint256(5)));
        bytes32 economics = keccak256("economics");
        inputs = new CompressionPosition[](2);
        inputs[0] = _position(1, series, first, second, domain, collateral, firstLots, economics);
        inputs[1] = _position(2, series, second, first, domain, collateral, secondLots, economics);
        successors = new CompressionSuccessor[](1);
        successors[0] = CompressionSuccessor({
            successorKey: bytes32(uint256(1)),
            seriesId: series,
            seriesVersion: 1,
            longAccountId: first,
            shortAccountId: second,
            riskDomainId: domain,
            riskDomainVersion: 1,
            collateralId: collateral,
            lots: Lots.wrap(firstLots - secondLots),
            entryPriceTicks: PriceTicks.wrap(100),
            economicsHash: economics,
            longTerminalLiabilityBaseUnits: firstLots - secondLots,
            shortTerminalLiabilityBaseUnits: firstLots - secondLots
        });
        replacement = new ReplacementCollateral[](2);
        replacement[0] = ReplacementCollateral({
            accountId: first, collateralId: collateral, terminalLiabilityBaseUnits: firstLots - secondLots
        });
        replacement[1] = ReplacementCollateral({
            accountId: second, collateralId: collateral, terminalLiabilityBaseUnits: firstLots - secondLots
        });
        consents = new CompressionConsent[](2);
        consents[0] = _consent(first);
        consents[1] = _consent(second);
        definition = CompressionPlanDefinition({
            namespaceId: keccak256("namespace"),
            planNonce: keccak256("nonce"),
            riskDomainId: domain,
            riskDomainVersion: 1,
            collateralId: collateral,
            inputsHash: bytes32(0),
            successorsHash: bytes32(0),
            replacementCollateralHash: bytes32(0),
            inputCount: 2,
            successorCount: 1,
            accountCount: 2,
            deadline: 1,
            qualificationHash: keccak256("qualification")
        });
    }

    function _position(
        uint256 id,
        SeriesId series,
        AccountId longAccount,
        AccountId shortAccount,
        RiskDomainId domain,
        CollateralId collateral,
        uint128 lots,
        bytes32 economics
    ) internal pure returns (CompressionPosition memory) {
        return CompressionPosition({
            positionId: PositionId.wrap(bytes32(id)),
            seriesId: series,
            seriesVersion: 1,
            longAccountId: longAccount,
            shortAccountId: shortAccount,
            riskDomainId: domain,
            riskDomainVersion: 1,
            collateralId: collateral,
            lots: Lots.wrap(lots),
            entryPriceTicks: PriceTicks.wrap(100),
            economicsHash: economics,
            longTerminalLiabilityBaseUnits: lots,
            shortTerminalLiabilityBaseUnits: lots,
            lifecycleHash: keccak256(abi.encode("live", id))
        });
    }

    function _consent(AccountId accountId) internal pure returns (CompressionConsent memory) {
        return CompressionConsent({
            planId: CompressionPlanId.wrap(bytes32(uint256(1))),
            accountId: accountId,
            signer: address(uint160(uint256(AccountId.unwrap(accountId)))),
            nonce: 1,
            deadline: 1,
            maximumLiabilityIncreaseBaseUnits: 0,
            maximumPayoffReductionBaseUnits: 0,
            salt: keccak256(abi.encode(accountId))
        });
    }
}
