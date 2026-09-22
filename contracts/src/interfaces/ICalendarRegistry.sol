// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {CalendarDay, CalendarDefinition, CalendarVersion} from "../types/CalendarDefinition.sol";
import {RegistryStatus} from "../types/Enums.sol";
import {CalendarId} from "../types/Identifiers.sol";

/// @dev The canonical calendar registry. It stores versioned commitments to already resolved
/// business-day schedules, gates which version may take new risk, and verifies individual day
/// classifications against the committed Merkle root of a version.
///
/// @dev It stores no day arrays, no proofs, and no individual holidays, so onchain cost is constant
/// in the length of a schedule. It holds no funds, makes no external calls, and never delegatecalls.
///
/// @dev Timezone and daylight saving rules are never computed onchain. `dayStatusRoot` commits their
/// resolved outcome over a finite horizon; `ruleSetHash` and `sourceHash` commit the methodology and
/// the provenance behind that outcome.
interface ICalendarRegistry {
    /// @dev Carries every definition field of the version so an indexer can rebuild the complete
    /// calendar set from logs alone. The registry keeps no enumerable array; these events are the
    /// enumeration source.
    ///
    /// @dev The definition rides as a whole tuple rather than as nine flattened parameters, because
    /// flattening them alongside the commitments exhausts the EVM stack at the emit site. The ABI
    /// encoding carries exactly the same nine fields either way.
    ///
    /// @dev initialStatus is always Paused today. It is logged rather than assumed so an indexer
    /// reconstructing a lineage never has to hardcode the registration landing state.
    event CalendarRegistered(
        CalendarId indexed calendarId,
        uint32 indexed version,
        bytes32 indexed versionHash,
        bytes32 definitionHash,
        CalendarDefinition definition,
        RegistryStatus initialStatus,
        address operator
    );

    event CalendarStatusChanged(
        CalendarId indexed calendarId,
        uint32 indexed version,
        RegistryStatus previousStatus,
        RegistryStatus newStatus,
        address indexed operator
    );

    /// @dev Emitted whenever the single active pointer for a calendar moves, including when it is
    /// cleared to zero. Zero is the no-active-version sentinel, because versions start at one.
    event CalendarActiveVersionChanged(
        CalendarId indexed calendarId, uint32 previousVersion, uint32 newVersion, address indexed operator
    );

    error ZeroInitialAdmin();

    error DuplicateCalendarDefinition(CalendarId calendarId, bytes32 definitionHash, uint32 existingVersion);

    /// @dev Raised instead of an arithmetic panic when a calendar has already consumed every uint32
    /// version. Unreachable in practice, but a named error keeps the exhausted case a stated
    /// protocol outcome rather than an opaque Panic(0x11).
    error CalendarVersionExhausted(CalendarId calendarId);

    error UnknownCalendarVersion(CalendarId calendarId, uint32 version);

    error InvalidCalendarTransition(
        CalendarId calendarId, uint32 version, RegistryStatus previousStatus, RegistryStatus newStatus
    );

    error AnotherCalendarVersionActive(CalendarId calendarId, uint32 activeVersion);

    /// @dev Registration lands the version in Paused, so the registrar who publishes a schedule is
    /// never the party that opens new risk against it.
    function registerCalendar(CalendarDefinition calldata definition)
        external
        returns (CalendarId calendarId, uint32 version);

    /// @dev Every mutation reverts UnknownCalendarVersion for a version that was never registered. A
    /// mutation must never treat an absent record as a Paused one and quietly create it.
    function activateCalendar(CalendarId calendarId, uint32 version) external;

    function pauseCalendar(CalendarId calendarId, uint32 version) external;

    function deprecateCalendar(CalendarId calendarId, uint32 version) external;

    /// @dev The one read that reverts UnknownCalendarVersion rather than answering with a sentinel,
    /// because a zeroed CalendarVersion carries a zero horizon and a zero root that a caller could
    /// mistake for a real record. Callers that want a total function gate on isLifecycleEnabled.
    function getCalendar(CalendarId calendarId, uint32 version) external view returns (CalendarVersion memory record);

    /// @dev Zero means no version was ever registered for the calendar. Versions start at one.
    function latestVersion(CalendarId calendarId) external view returns (uint32);

    /// @dev Zero means no version is active right now, whether because none was ever registered or
    /// because the active one was paused or deprecated.
    function activeVersion(CalendarId calendarId) external view returns (uint32);

    /// @dev RegistryStatus.Unspecified is the never-registered sentinel. It is not a reachable
    /// stored state, so it is an unambiguous answer for an unknown version.
    function statusOf(CalendarId calendarId, uint32 version) external view returns (RegistryStatus);

    /// @dev Counts immutable versions, not unique calendar lineages. Two versions of one calendar
    /// count as two.
    function calendarCount() external view returns (uint256);

    function exists(CalendarId calendarId, uint32 version) external view returns (bool);

    /// @dev Whether the committed horizon of the version contains the day, independent of status. A
    /// deprecated version still covers the days it committed to, because settlement of an already
    /// opened position must stay resolvable. False for an unknown version.
    function coversDay(CalendarId calendarId, uint32 version, uint32 day) external view returns (bool);

    /// @dev The only gate a consumer may use to open new risk against a calendar day. True only when
    /// the version is the active pointer, is in Active status, and the day falls inside the committed
    /// horizon. It does not say the day is a business day: a caller that needs the classification
    /// must also verify the leaf with verifyDay. False for an unknown version.
    function isOpenForNewRisk(CalendarId calendarId, uint32 version, uint32 day) external view returns (bool);

    /// @dev Historical resolvability. True for every registered version, including Paused and
    /// Deprecated ones. Future expiry, fixing, settlement, unwind, and receipt replay must never
    /// require current Active status for a historical version, otherwise pausing a calendar would
    /// strand open positions. False for an unknown version.
    function isLifecycleEnabled(CalendarId calendarId, uint32 version) external view returns (bool);

    /// @dev The Merkle leaf for a classified day under the V1 leaf typehash, using the OpenZeppelin
    /// StandardMerkleTree double-hash convention. Reverts on a zero evidenceHash.
    function hashDay(CalendarId calendarId, CalendarDay calldata calendarDay) external pure returns (bytes32);

    /// @dev Historical evidence, never permission. A true answer proves the version committed to
    /// this exact classification for this exact day; isOpenForNewRisk is the separate activation and
    /// horizon gate.
    ///
    /// @dev Returns false rather than reverting for an unknown version, a zero evidenceHash, a day
    /// outside the horizon of that version, or an invalid proof. It verifies Paused and Deprecated
    /// versions too, because settlement and replay must remain possible after a calendar is retired.
    function verifyDay(
        CalendarId calendarId,
        uint32 version,
        CalendarDay calldata calendarDay,
        bytes32[] calldata proof
    ) external view returns (bool);
}
