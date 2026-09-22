// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {RegistryStatus} from "./Enums.sol";
import {CalendarId, WindowKindId} from "./Identifiers.sol";

/// @dev A session definition is a versioned commitment to an already resolved trading schedule:
/// which exact UTC windows a venue or market convention opens on each civil business day of a finite
/// horizon. Identity is the namespaceId plus referenceId pair alone, so revising a schedule, moving
/// its horizon, or repointing it at a newer calendar version never mints a second session identity.
///
/// @dev Session computation is offchain, exactly as calendar computation is. Timezone conversion,
/// daylight saving transitions, public holidays, early closes, exceptional closes, and maintenance
/// breaks are all resolved before registration. `dayScheduleRoot` commits only their outcome, one
/// SessionDay leaf per civil business day across the declared horizon.
///
/// @dev calendarId and calendarVersion name the exact immutable calendar version this schedule was
/// resolved against. The dependency is checked at registration for existence and horizon coverage,
/// and again at activation for open-for-new-risk status, so a session can be published against a
/// paused calendar but can never be switched on against one.
///
/// @dev validFromDay and validThroughDay are unsigned UTC day numbers `floor(timestamp / 1 days)`,
/// the same numbering the calendar uses. They label civil business days, not the UTC dates that the
/// windows of those days happen to open on.
///
/// @dev windowKindSetHash commits the set of WindowKindId values this schedule may use, so an
/// auditor can tell from the definition alone which kinds a consumer has to understand. It is
/// evidence, never an onchain filter: the hashing path accepts any nonzero kind, and a consumer that
/// needs a specific kind must require it explicitly.
///
/// @dev ruleSetHash and sourceHash commit the methodology that produced the schedule and the
/// provenance of the underlying venue notices. They are evidence anchors, never computation inputs.
struct SessionDefinition {
    bytes32 namespaceId;
    bytes32 referenceId;
    CalendarId calendarId;
    uint32 calendarVersion;
    uint32 validFromDay;
    uint32 validThroughDay;
    bytes32 dayScheduleRoot;
    bytes32 windowKindSetHash;
    bytes32 ruleSetHash;
    bytes32 sourceHash;
}

/// @dev One immutable historical version of a session lineage. Status is the only mutable field and
/// it gates future qualification only; a version is never edited and never deleted.
struct SessionVersion {
    SessionDefinition definition;
    bytes32 definitionHash;
    bytes32 versionHash;
    uint32 version;
    RegistryStatus status;
}

/// @dev One committed window inside one session day. It is never stored onchain: it is part of the
/// preimage a caller supplies alongside a Merkle proof against the version `dayScheduleRoot`.
///
/// @dev opensAt and closesAt are absolute UTC seconds, not offsets inside a day. That is deliberate:
/// a session may open on the UTC date before or after the civil business day it is labeled with, and
/// a window may cross UTC midnight. The civil label lives in the SessionDay `day` field; the window
/// carries the real instants.
///
/// @dev kindId is an open typed tag rather than an enum, so Trading, Observation, Fixing, Auction,
/// Maintenance, and any kind invented later all encode identically. policyHash commits the offchain
/// policy that governs the window, and must be nonzero so a window can never be committed without a
/// stated rule behind it.
struct SessionWindow {
    WindowKindId kindId;
    uint64 opensAt;
    uint64 closesAt;
    bytes32 policyHash;
}

/// @dev One committed civil business day inside a session horizon. It is never stored onchain: it is
/// the preimage a caller supplies alongside a Merkle proof against the version `dayScheduleRoot`.
///
/// @dev windowsHash is the canonical hash of the ordered window list of that day. A closed day is a
/// real leaf carrying the canonical hash of the empty window list, never a zero windowsHash, so
/// "this day is closed" is an explicit, provable commitment rather than the absence of one.
///
/// @dev evidenceHash binds the day to the offchain record that justifies its schedule, so two
/// sessions that happen to agree on windows still produce distinct leaves. It must be nonzero.
struct SessionDay {
    uint32 day;
    bytes32 windowsHash;
    bytes32 evidenceHash;
}
