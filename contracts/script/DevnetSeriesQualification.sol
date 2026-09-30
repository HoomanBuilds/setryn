// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {SeriesDefinitionLib} from "../src/libraries/SeriesDefinitionLib.sol";
import {SessionDefinitionLib} from "../src/libraries/SessionDefinitionLib.sol";
import {CalendarDay} from "../src/types/CalendarDefinition.sol";
import {BenchmarkId} from "../src/types/Identifiers.sol";
import {SeriesDefinition} from "../src/types/SeriesDefinition.sol";
import {
    CalendarDayProof,
    FixingCandidate,
    FixingSlot,
    SeriesDateKind,
    SeriesDateProof,
    SeriesQualificationData
} from "../src/types/SeriesQualification.sol";

/// @notice The local devnet's series qualification witness, shared by the bootstrap that first qualifies each series and
/// by the fee schedule update that re-versions it onto a new market version. Both must publish byte-identical data for
/// the same series, so it lives in one place. Local devnet only: the calendar is one published business day and every
/// date proof points at it.
library DevnetSeriesQualification {
    /// The devnet registers each benchmark once, so every fixing candidate names its first version.
    uint32 internal constant BENCHMARK_VERSION = 1;
    /// The capped forward terms schema the devnet instrument commits to.
    bytes32 internal constant TERMS_SCHEMA = keccak256("SETRYN_CANONICAL_CAPPED_FORWARD_TERMS_V1");

    function qualification(
        uint32 day,
        BenchmarkId benchmarkId,
        SeriesDefinition memory definition,
        bytes memory payoffTerms
    ) internal pure returns (SeriesQualificationData memory data) {
        data.payoffTerms = payoffTerms;
        data.fixingSlots = new FixingSlot[](1);
        data.fixingSlots[0].slot = 0;
        data.fixingSlots[0].candidates = new FixingCandidate[](1);
        data.fixingSlots[0].candidates[0] = FixingCandidate({
            benchmarkId: benchmarkId,
            benchmarkVersion: BENCHMARK_VERSION,
            requiredWindowKindId: SessionDefinitionLib.WINDOW_KIND_FIXING,
            selectionRuleId: SeriesDefinitionLib.FIXING_SELECTION_OFFICIAL,
            targetAt: definition.fixingWindowOpen + 15 minutes,
            windowStartsAt: definition.fixingWindowOpen,
            windowEndsAt: definition.fixingWindowOpen + 30 minutes,
            unavailableAfter: definition.fixingWindowClose + 30 minutes,
            maxPublicationLagSeconds: 30 minutes,
            minimumObservations: 1,
            maximumObservations: 1,
            selectionParametersHash: keccak256(abi.encode("SETRYN_SERIES_FIXING_SELECTION_V1", benchmarkId))
        });

        data.dateProofs = new SeriesDateProof[](11);
        CalendarDay memory published = calendarDay(day);
        for (uint8 rawKind = 1; rawKind <= 11; ++rawKind) {
            uint256 index = uint256(rawKind) - 1;
            data.dateProofs[index].kind = SeriesDateKind(rawKind);
            data.dateProofs[index].conventionId = SeriesDefinitionLib.DATE_ADJUSTMENT_UNADJUSTED;
            data.dateProofs[index].scheduledDay = day;
            data.dateProofs[index].calendarDays = new CalendarDayProof[](1);
            data.dateProofs[index].calendarDays[0].calendarDay = published;
            data.dateProofs[index].calendarDays[0].merkleProof = new bytes32[](0);
        }
    }

    function calendarDay(uint32 day) internal pure returns (CalendarDay memory) {
        return CalendarDay({day: day, isBusinessDay: true, evidenceHash: keccak256("SETRYN_LOCAL_CALENDAR_DAY_V1")});
    }
}
