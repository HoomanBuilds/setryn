// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {SeriesDefinitionLib} from "../../src/libraries/SeriesDefinitionLib.sol";
import {DisruptionOutcomeId, ExercisePolicyId, InstrumentId, MarketId, SeriesId} from "../../src/types/Identifiers.sol";
import {SeriesDefinition} from "../../src/types/SeriesDefinition.sol";

contract SeriesRegistryFuzzTest is Test {
    function testFuzz_LineageIgnoresExactVersionAndEconomicFields(
        uint32 marketVersion,
        uint32 instrumentVersion,
        uint128 longDebit,
        bytes32 evidenceHash
    ) public pure {
        marketVersion = marketVersion == 0 ? 1 : marketVersion;
        instrumentVersion = instrumentVersion == 0 ? 1 : instrumentVersion;
        longDebit = longDebit == 0 ? 1 : longDebit;
        evidenceHash = evidenceHash == bytes32(0) ? bytes32(uint256(1)) : evidenceHash;

        SeriesDefinition memory baseline = _definition();
        SeriesDefinition memory revised = baseline;
        revised.marketVersion = marketVersion;
        revised.instrumentVersion = instrumentVersion;
        revised.maxLongDebitMinorPerLot = longDebit;
        revised.qualificationEvidenceHash = evidenceHash;

        SeriesId baselineId = SeriesDefinitionLib.deriveSeriesId(baseline);
        SeriesId revisedId = SeriesDefinitionLib.deriveSeriesId(revised);
        assertEq(SeriesId.unwrap(baselineId), SeriesId.unwrap(revisedId));

        bytes32 baselineHash = SeriesDefinitionLib.hashDefinition(baseline, 42161);
        bytes32 revisedHash = SeriesDefinitionLib.hashDefinition(revised, 42161);
        if (
            baseline.marketVersion != revised.marketVersion || baseline.instrumentVersion != revised.instrumentVersion
                || baseline.maxLongDebitMinorPerLot != revised.maxLongDebitMinorPerLot
                || baseline.qualificationEvidenceHash != revised.qualificationEvidenceHash
        ) assertTrue(baselineHash != revisedHash);
    }

    function testFuzz_DefinitionAndVersionHashesAreChainBound(uint64 firstChain) public pure {
        firstChain = uint64(bound(firstChain, 1, type(uint64).max - 1));
        uint64 secondChain = firstChain + 1;
        SeriesDefinition memory definition = _definition();
        SeriesId seriesId = SeriesDefinitionLib.deriveSeriesId(definition);

        bytes32 firstDefinitionHash = SeriesDefinitionLib.hashDefinition(definition, firstChain);
        bytes32 secondDefinitionHash = SeriesDefinitionLib.hashDefinition(definition, secondChain);
        assertTrue(firstDefinitionHash != secondDefinitionHash);
        assertTrue(
            SeriesDefinitionLib.hashVersion(seriesId, 1, firstDefinitionHash, firstChain)
                != SeriesDefinitionLib.hashVersion(seriesId, 1, secondDefinitionHash, secondChain)
        );
    }

    function testFuzz_PrecommittedTerminalTransferInsideEitherDebitBoundValidates(
        uint128 longDebit,
        uint128 shortDebit,
        uint128 rawAmount,
        bool longPays
    ) public pure {
        longDebit = uint128(bound(longDebit, 1, type(uint128).max));
        shortDebit = uint128(bound(shortDebit, 1, type(uint128).max));

        SeriesDefinition memory definition = _definition();
        definition.disruptionOutcomeId = SeriesDefinitionLib.DISRUPTION_OUTCOME_PRECOMMITTED_VALUE;
        definition.maxLongDebitMinorPerLot = longDebit;
        definition.maxShortDebitMinorPerLot = shortDebit;

        if (longPays) {
            uint128 amount = uint128(bound(rawAmount, 0, longDebit));
            definition.terminalDisruptionTransferMinorPerLot = -int256(uint256(amount));
        } else {
            uint128 amount = uint128(bound(rawAmount, 0, shortDebit));
            definition.terminalDisruptionTransferMinorPerLot = int256(uint256(amount));
        }

        SeriesDefinitionLib.validate(definition);
    }

    function _definition() private pure returns (SeriesDefinition memory) {
        return SeriesDefinition({
            namespaceId: keccak256("namespace"),
            seriesKey: keccak256("series"),
            marketId: MarketId.wrap(keccak256("market")),
            marketVersion: 1,
            instrumentId: InstrumentId.wrap(keccak256("instrument")),
            instrumentVersion: 1,
            tradingStartsAt: 100,
            lastTradingAt: 200,
            expiryAt: 400,
            exerciseOpensAt: 0,
            exerciseCutoffAt: 0,
            fixingWindowOpen: 300,
            fixingWindowClose: 400,
            primaryEvidenceDeadline: 500,
            correctionCutoffAt: 600,
            finalResolutionAt: 700,
            settlementDeadline: 800,
            exercisePolicyId: ExercisePolicyId.wrap(keccak256("SetrynExercisePolicyV1:Automatic")),
            disruptionOutcomeId: DisruptionOutcomeId.wrap(keccak256("SetrynDisruptionOutcomeV1:Flat")),
            terminalDisruptionTransferMinorPerLot: 0,
            payoffTermsHash: keccak256("terms"),
            fixingSlotsHash: keccak256("fixings"),
            dateAdjustmentEvidenceHash: keccak256("dates"),
            maxLongDebitMinorPerLot: 1_000,
            maxShortDebitMinorPerLot: 2_000,
            qualificationEvidenceHash: keccak256("evidence")
        });
    }
}
