// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {RegistryStatus} from "../types/Enums.sol";
import {CalendarId, SessionId} from "../types/Identifiers.sol";
import {SessionDay, SessionDefinition, SessionVersion, SessionWindow} from "../types/SessionDefinition.sol";
import {ICalendarRegistry} from "./ICalendarRegistry.sol";

/// @dev The canonical session registry. It stores versioned commitments to already resolved trading
/// schedules, expressed as exact absolute UTC windows per civil business day, gates which version
/// may take new risk, and verifies individual day schedules against the committed Merkle root of a
/// version.
///
/// @dev It stores no day arrays, no windows, no proofs, and no holidays, so onchain cost is constant
/// in the length of a schedule. It holds no funds, never delegatecalls, and makes external calls
/// only to its immutable calendar registry dependency.
///
/// @dev Timezone conversion, daylight saving transitions, holidays, early closes, exceptional
/// closes, and maintenance breaks are never computed onchain. `dayScheduleRoot` commits their
/// resolved outcome over a finite horizon; `ruleSetHash` and `sourceHash` commit the methodology and
/// the provenance behind that outcome.
///
/// @dev A session depends on one exact immutable calendar version. Registration proves that version
/// exists and covers both session horizon endpoints; activation additionally requires it to be open
/// for new risk. Registration against a paused or deprecated calendar is allowed, because
/// registration grants no risk authority at all.
interface ISessionRegistry {
    /// @dev Carries every definition field of the version so an indexer can rebuild the complete
    /// session set from logs alone. The registry keeps no enumerable array; these events are the
    /// enumeration source.
    ///
    /// @dev The definition rides as a whole tuple rather than as ten flattened parameters, because
    /// flattening them alongside the commitments exhausts the EVM stack at the emit site. The ABI
    /// encoding carries exactly the same ten fields either way.
    ///
    /// @dev initialStatus is always Paused today. It is logged rather than assumed so an indexer
    /// reconstructing a lineage never has to hardcode the registration landing state.
    event SessionRegistered(
        SessionId indexed sessionId,
        uint32 indexed version,
        bytes32 indexed versionHash,
        bytes32 definitionHash,
        SessionDefinition definition,
        RegistryStatus initialStatus,
        address operator
    );

    event SessionStatusChanged(
        SessionId indexed sessionId,
        uint32 indexed version,
        RegistryStatus previousStatus,
        RegistryStatus newStatus,
        address indexed operator
    );

    /// @dev Emitted whenever the single active pointer for a session moves, including when it is
    /// cleared to zero. Zero is the no-active-version sentinel, because versions start at one.
    event SessionActiveVersionChanged(
        SessionId indexed sessionId, uint32 previousVersion, uint32 newVersion, address indexed operator
    );

    error ZeroInitialAdmin();

    error ZeroCalendarRegistry();

    error CalendarRegistryHasNoCode(address calendarRegistry);

    error DuplicateSessionDefinition(SessionId sessionId, bytes32 definitionHash, uint32 existingVersion);

    /// @dev Raised instead of an arithmetic panic when a session has already consumed every uint32
    /// version. Unreachable in practice, but a named error keeps the exhausted case a stated
    /// protocol outcome rather than an opaque Panic(0x11).
    error SessionVersionExhausted(SessionId sessionId);

    error UnknownSessionVersion(SessionId sessionId, uint32 version);

    error InvalidSessionTransition(
        SessionId sessionId, uint32 version, RegistryStatus previousStatus, RegistryStatus newStatus
    );

    error AnotherSessionVersionActive(SessionId sessionId, uint32 activeVersion);

    /// @dev The named calendar version was never registered. A session may never commit to a
    /// dependency that does not exist, not even while it is only Paused.
    error UnknownCalendarDependency(CalendarId calendarId, uint32 calendarVersion);

    /// @dev The named calendar version exists but its committed horizon does not contain both
    /// session horizon endpoints, so some session day could never be resolved against it.
    error CalendarHorizonTooNarrow(
        CalendarId calendarId, uint32 calendarVersion, uint32 validFromDay, uint32 validThroughDay
    );

    /// @dev Activation is refused because the calendar dependency is not open for new risk across
    /// the session horizon, whether because it is not the active calendar version, is not Active, or
    /// no longer covers an endpoint. The session stays registered and historically verifiable.
    error CalendarDependencyNotOpen(
        CalendarId calendarId, uint32 calendarVersion, uint32 validFromDay, uint32 validThroughDay
    );

    /// @dev The immutable trusted dependency every session resolves its business days against.
    function calendarRegistry() external view returns (ICalendarRegistry);

    /// @dev Registration lands the version in Paused, so the registrar who publishes a schedule is
    /// never the party that opens new risk against it. It proves the calendar dependency exists and
    /// covers the horizon, but deliberately does not require that dependency to be active.
    function registerSession(SessionDefinition calldata definition)
        external
        returns (SessionId sessionId, uint32 version);

    /// @dev Every mutation reverts UnknownSessionVersion for a version that was never registered. A
    /// mutation must never treat an absent record as a Paused one and quietly create it.
    ///
    /// @dev Activation fails closed on the calendar dependency with CalendarDependencyNotOpen.
    function activateSession(SessionId sessionId, uint32 version) external;

    function pauseSession(SessionId sessionId, uint32 version) external;

    function deprecateSession(SessionId sessionId, uint32 version) external;

    /// @dev The one read that reverts UnknownSessionVersion rather than answering with a sentinel,
    /// because a zeroed SessionVersion carries a zero horizon and a zero root that a caller could
    /// mistake for a real record. Callers that want a total function gate on isLifecycleEnabled.
    function getSession(SessionId sessionId, uint32 version) external view returns (SessionVersion memory record);

    /// @dev Zero means no version was ever registered for the session. Versions start at one.
    function latestVersion(SessionId sessionId) external view returns (uint32);

    /// @dev Zero means no version is active right now, whether because none was ever registered or
    /// because the active one was paused or deprecated.
    function activeVersion(SessionId sessionId) external view returns (uint32);

    /// @dev RegistryStatus.Unspecified is the never-registered sentinel. It is not a reachable
    /// stored state, so it is an unambiguous answer for an unknown version.
    function statusOf(SessionId sessionId, uint32 version) external view returns (RegistryStatus);

    /// @dev Counts immutable versions, not unique session lineages. Two versions of one session
    /// count as two.
    function sessionCount() external view returns (uint256);

    function exists(SessionId sessionId, uint32 version) external view returns (bool);

    /// @dev Whether the committed horizon of the version contains the day, independent of status and
    /// independent of the calendar dependency. A deprecated version still covers the days it
    /// committed to, because settlement of an already opened position must stay resolvable. False
    /// for an unknown version.
    function coversDay(SessionId sessionId, uint32 version, uint32 day) external view returns (bool);

    /// @dev The only gate a consumer may use to open new risk against a session day. True only when
    /// the version is the active pointer, is in Active status, the day falls inside the committed
    /// session horizon, and the calendar dependency itself is open for new risk on that day. It does
    /// not say what the windows of that day are: a caller that needs them must also verify the leaf
    /// with verifyDay. False for an unknown version.
    function isOpenForNewRisk(SessionId sessionId, uint32 version, uint32 day) external view returns (bool);

    /// @dev Historical resolvability. True for every registered version, including Paused and
    /// Deprecated ones, and regardless of the current status of the calendar dependency. Future
    /// expiry, fixing, settlement, unwind, and receipt replay must never require current Active
    /// status for a historical version, otherwise pausing a calendar would strand open positions.
    /// False for an unknown version.
    function isLifecycleEnabled(SessionId sessionId, uint32 version) external view returns (bool);

    /// @dev The commitment for one window under the V1 window typehash. Accepts any nonzero kindId,
    /// which is what keeps the kind space open; reverts on a zero kindId, a zero policyHash, or an
    /// interval where opensAt is not strictly before closesAt.
    function hashWindow(SessionWindow calldata window) external pure returns (bytes32);

    /// @dev The canonical windowsHash of one day, over a strictly sorted list of at most
    /// MAX_SESSION_WINDOWS windows. The empty list is legal and is the canonical closed day.
    ///
    /// @dev There is deliberately no non-reverting windowsMatch helper. This function is the single
    /// canonical encoder and it reverts on every malformed list, so a caller that holds windows must
    /// call hashWindows, compare the result against SessionDay.windowsHash itself, and only then
    /// build or verify the leaf. Folding that comparison into a boolean view here would have meant
    /// either duplicating every validation rule or swallowing its reverts.
    function hashWindows(SessionWindow[] calldata windows) external pure returns (bytes32);

    /// @dev The Merkle leaf for a committed day under the V1 leaf typehash, using the OpenZeppelin
    /// StandardMerkleTree double-hash convention. Reverts on a zero windowsHash or evidenceHash.
    function hashDay(SessionId sessionId, SessionDay calldata sessionDay) external pure returns (bytes32);

    /// @dev Historical evidence, never permission. A true answer proves the version committed to
    /// this exact day schedule for this exact civil business day; isOpenForNewRisk is the separate
    /// activation, horizon, and dependency gate.
    ///
    /// @dev Returns false rather than reverting for an unknown version, a zero windowsHash, a zero
    /// evidenceHash, a day outside the horizon of that version, or an invalid proof. It verifies
    /// Paused and Deprecated versions too, and never consults the calendar dependency, because
    /// settlement and replay must remain possible after a session or its calendar is retired.
    function verifyDay(SessionId sessionId, uint32 version, SessionDay calldata sessionDay, bytes32[] calldata proof)
        external
        view
        returns (bool);
}
