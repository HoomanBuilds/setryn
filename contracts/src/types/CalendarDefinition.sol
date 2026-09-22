// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {RegistryStatus} from "./Enums.sol";

/// @dev A calendar definition is a versioned commitment to a finite, already resolved business-day
/// schedule. Identity is the namespaceId plus referenceId pair alone, so revising a schedule, moving
/// its horizon, or correcting its source never mints a second calendar identity.
///
/// @dev Day is the unsigned UTC day number `floor(timestamp / 1 days)`. Calendar computation is
/// offchain. Timezone conversion, daylight saving transitions, public holidays, exceptional
/// closures, and source corrections are all resolved before registration; `dayStatusRoot` commits
/// only their outcome, one leaf per day across the horizon.
///
/// @dev weekendMask bits 0 through 6 are Monday through Sunday. Bit 7 is invalid. A zero mask
/// declares a 24/7 calendar. A 0x7f mask declares no possible business day and is rejected.
/// The mask is a commitment to the recurring weekly rule; it is never evaluated onchain, because
/// `dayStatusRoot` already carries the exact per-day answer.
///
/// @dev timeZoneId, ruleSetHash, and sourceHash commit the civil timezone the schedule was resolved
/// in, the methodology that produced it, and the provenance of the underlying source data. They are
/// evidence anchors, never onchain computation inputs.
struct CalendarDefinition {
    bytes32 namespaceId;
    bytes32 referenceId;
    bytes32 timeZoneId;
    uint8 weekendMask;
    uint32 validFromDay;
    uint32 validThroughDay;
    bytes32 dayStatusRoot;
    bytes32 ruleSetHash;
    bytes32 sourceHash;
}

/// @dev One immutable historical version of a calendar lineage. Status is the only mutable field and
/// it gates future qualification only; a version is never edited and never deleted.
struct CalendarVersion {
    CalendarDefinition definition;
    bytes32 definitionHash;
    bytes32 versionHash;
    uint32 version;
    RegistryStatus status;
}

/// @dev One classified day inside a committed horizon. It is never stored onchain: it is the
/// preimage a caller supplies alongside a Merkle proof against the version `dayStatusRoot`.
///
/// @dev evidenceHash binds the day to the offchain record that justifies its classification, so two
/// calendars that happen to agree on a date still produce distinct leaves. It must be nonzero.
struct CalendarDay {
    uint32 day;
    bool isBusinessDay;
    bytes32 evidenceHash;
}
