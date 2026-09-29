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

/// Mutates a compression plan only in ways that must keep committed exposure and liability conserved: splitting an
/// input or successor into two lots that sum to the original, or adding an offsetting input pair that nets to zero.
contract CompressionPlanHandler is Test {
    uint256 private constant MAX_ENTRIES = 12;

    CompressionPosition[] internal _inputs;
    CompressionSuccessor[] internal _successors;
    uint256 private _nextKey = 2;

    constructor(CompressionPosition memory input, CompressionSuccessor memory successor) {
        _inputs.push(input);
        _successors.push(successor);
    }

    function splitInput(uint256 indexSeed, uint256 lotSeed) external {
        if (_inputs.length >= MAX_ENTRIES) return;
        uint256 index = indexSeed % _inputs.length;
        CompressionPosition memory position = _inputs[index];
        uint128 lots = Lots.unwrap(position.lots);
        if (lots < 2) return;
        uint128 moved = uint128(bound(lotSeed, 1, lots - 1));
        uint128 longMoved = _share(position.longTerminalLiabilityBaseUnits, moved, lots);
        uint128 shortMoved = _share(position.shortTerminalLiabilityBaseUnits, moved, lots);
        CompressionPosition memory remainder = _inputs[index];
        remainder.lots = Lots.wrap(lots - moved);
        remainder.longTerminalLiabilityBaseUnits -= longMoved;
        remainder.shortTerminalLiabilityBaseUnits -= shortMoved;
        position.lots = Lots.wrap(moved);
        position.longTerminalLiabilityBaseUnits = longMoved;
        position.shortTerminalLiabilityBaseUnits = shortMoved;
        position.positionId = PositionId.wrap(bytes32(_nextKey++));
        _inputs[index] = remainder;
        _inputs.push(position);
    }

    function splitSuccessor(uint256 indexSeed, uint256 lotSeed) external {
        if (_successors.length >= MAX_ENTRIES) return;
        uint256 index = indexSeed % _successors.length;
        CompressionSuccessor memory successor = _successors[index];
        uint128 lots = Lots.unwrap(successor.lots);
        if (lots < 2) return;
        uint128 moved = uint128(bound(lotSeed, 1, lots - 1));
        uint128 longMoved = _share(successor.longTerminalLiabilityBaseUnits, moved, lots);
        uint128 shortMoved = _share(successor.shortTerminalLiabilityBaseUnits, moved, lots);
        CompressionSuccessor memory remainder = _successors[index];
        remainder.lots = Lots.wrap(lots - moved);
        remainder.longTerminalLiabilityBaseUnits -= longMoved;
        remainder.shortTerminalLiabilityBaseUnits -= shortMoved;
        successor.lots = Lots.wrap(moved);
        successor.longTerminalLiabilityBaseUnits = longMoved;
        successor.shortTerminalLiabilityBaseUnits = shortMoved;
        successor.successorKey = bytes32(_nextKey++);
        _successors[index] = remainder;
        _successors.push(successor);
    }

    function addOffsettingInputs(uint256 indexSeed, uint256 lotSeed) external {
        if (_inputs.length + 2 > MAX_ENTRIES) return;
        CompressionPosition memory position = _inputs[indexSeed % _inputs.length];
        uint128 lots = uint128(bound(lotSeed, 1, 1_000));
        position.lots = Lots.wrap(lots);
        position.longTerminalLiabilityBaseUnits = lots;
        position.shortTerminalLiabilityBaseUnits = lots;
        position.positionId = PositionId.wrap(bytes32(_nextKey++));
        _inputs.push(position);
        (position.longAccountId, position.shortAccountId) = (position.shortAccountId, position.longAccountId);
        position.positionId = PositionId.wrap(bytes32(_nextKey++));
        _inputs.push(position);
    }

    function inputs() external view returns (CompressionPosition[] memory) {
        return _inputs;
    }

    function successors() external view returns (CompressionSuccessor[] memory) {
        return _successors;
    }

    function _share(uint128 amount, uint128 part, uint128 whole) private pure returns (uint128) {
        return uint128((uint256(amount) * part) / whole);
    }
}

contract CompressionConservationInvariantTest is Test {
    CompressionHarness internal harness;
    CompressionPlanHandler internal handler;
    CompressionPlanDefinition internal definition;
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
        CompressionPosition memory input = CompressionPosition({
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
        });
        CompressionSuccessor memory successor = CompressionSuccessor({
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
        });
        handler = new CompressionPlanHandler(input, successor);
        targetContract(address(handler));
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
        harness.validateConservation(definition, handler.inputs(), handler.successors(), replacement, consents);
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
