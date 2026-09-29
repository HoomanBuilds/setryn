# Setryn session registry

## Purpose

`SessionRegistry` is the canonical source of trading sessions for the protocol. A calendar answers
"was day D a business day for calendar C". A session answers the next question: "on civil business
day D, exactly which UTC intervals was market S open, observing, fixing, auctioning, or under
maintenance, and under which policy".

Like the calendar registry, it solves that without storing a schedule onchain. Session computation is
offchain. What lands onchain is an immutable, versioned commitment to an already resolved per-day
window schedule over a finite horizon, plus the machinery to prove one day against it.

## Boundary

- The registry stores no day arrays, no windows, no proofs, and no holidays. Storage cost per version
  is constant in the length of the schedule.
- It computes no timezone and no daylight saving arithmetic. `dayScheduleRoot` commits the outcome
  after timezone conversion, DST transitions, public holidays, early closes, exceptional closes, and
  maintenance breaks have all been resolved offchain.
- It holds no funds and never uses `delegatecall`. Its only external calls are view reads of its
  immutable `ICalendarRegistry` dependency, and every one of them completes before any storage write.
- It contains no token addresses, no venue list, no chain-specific branches, and no
  deployment-specific behavior.

Benchmarks, instruments, vaults, execution, and market wiring are out of scope for this contract and
belong to later registries.

## Day numbering and window time

`day` is the unsigned UTC day number `floor(timestamp / 1 days)`, the same numbering the calendar
uses. It labels a **civil business day**.

`opensAt` and `closesAt` are **absolute UTC seconds**, not offsets inside that day. The split is
deliberate. A session labeled with civil business day D may open on the UTC date before or after D,
and a single window may cross UTC midnight. The civil label lives on the `SessionDay` leaf; the real
instants live on the `SessionWindow`.

## Identity and versions

```solidity
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
```

`SessionId` is derived as `IdLib.deriveSessionId(SessionDefinitionLib.hashKey(definition))`, and the V1
key commits `namespaceId` and `referenceId` alone:

```
SetrynSessionKeyV1(bytes32 namespaceId,bytes32 referenceId)
```

Extending a horizon, correcting a schedule, changing the methodology, or repointing the session at a
newer calendar version produces a new version of the same `SessionId`, never a second session. Like
every Setryn identifier, `SessionId` excludes `chainId` and `verifyingContract`, so one canonical
session keeps one identity across Arbitrum Sepolia and Arbitrum One.

Two further commitments are stored per version:

- `definitionHash` commits all ten fields under `SetrynSessionDefinitionV1(...)`.
- `versionHash` commits `SetrynSessionVersionV1(bytes32 sessionId,uint32 version,bytes32 definitionHash)`,
  so a stored record can never be replayed as a different version of itself or as a version of another
  session.

Versions are sequential `uint32` values per `SessionId` starting at 1, so 0 is an unambiguous
no-such-version sentinel for both the latest and the active pointer. An identical `definitionHash` may
not be registered twice for the same `SessionId` (`DuplicateSessionDefinition`). Exhausting the
`uint32` space raises the named `SessionVersionExhausted` rather than an opaque `Panic(0x11)`.

Historical versions are immutable and are never deleted. Status is the only mutable field.

## Window kinds are open

`WindowKindId` is `type WindowKindId is bytes32`, an open typed tag, not a Solidity enum. Any nonzero
value is accepted at registration and hashing. `SessionDefinitionLib` publishes convenience constants
for the kinds V1 consumers meet first:

| Constant | Preimage |
| --- | --- |
| `WINDOW_KIND_TRADING` | `SetrynWindowKindV1:Trading` |
| `WINDOW_KIND_OBSERVATION` | `SetrynWindowKindV1:Observation` |
| `WINDOW_KIND_FIXING` | `SetrynWindowKindV1:Fixing` |
| `WINDOW_KIND_AUCTION` | `SetrynWindowKindV1:Auction` |
| `WINDOW_KIND_MAINTENANCE` | `SetrynWindowKindV1:Maintenance` |

That list is convenience, never an allowlist. A kind invented after this deployment hashes exactly
like a published one and needs no redeploy, no enum reordering, and no migration.

`IdLib` deliberately publishes no `deriveWindowKindId`. Window kinds are namespaced capability tags
chosen by their producer, not registry lineage identifiers, so there is nothing to derive from a
definition hash.

`windowKindSetHash` commits the set of kinds a schedule may use. It is evidence for auditors, never an
onchain filter. **Downstream consumers must explicitly require the exact kinds they support and fail
closed on anything else.** A committed window is a commitment, not an instruction: this registry gives
no meaning to `WINDOW_KIND_AUCTION` beyond "the publisher said this interval is an auction".

## Validation

Registration rejects, with a named error in each case:

1. Zero `namespaceId` (`ZeroSessionNamespaceId`) or zero `referenceId` (`ZeroSessionReferenceId`).
2. Zero `calendarId` (`ZeroSessionCalendarId`) or zero `calendarVersion` (`ZeroSessionCalendarVersion`);
   calendar versions start at 1.
3. `validFromDay > validThroughDay` (`InvalidSessionHorizon`).
4. Zero `dayScheduleRoot`, `windowKindSetHash`, `ruleSetHash`, or `sourceHash`.
5. A calendar version that was never registered (`UnknownCalendarDependency`).
6. A calendar version whose committed horizon does not contain both session horizon endpoints
   (`CalendarHorizonTooNarrow`).

Checks 5 and 6 are the only external reads on the registration path, and both complete before any
storage is touched. They do **not** require the calendar to be Active. A session may be published
against a Paused or Deprecated calendar version, because registration grants no risk authority at all.

## Window and day commitments

```solidity
struct SessionWindow {
    WindowKindId kindId;
    uint64 opensAt;
    uint64 closesAt;
    bytes32 policyHash;
}

struct SessionDay {
    uint32 day;
    bytes32 windowsHash;
    bytes32 evidenceHash;
}
```

`hashWindow` accepts any nonzero `kindId`, requires a nonzero `policyHash`, and requires
`opensAt < closesAt`.

`hashWindows` is the single canonical encoder for the window list of one day:

- 0 to `MAX_SESSION_WINDOWS` (16) windows. More is `TooManyWindows`.
- The list must be **strictly** sorted by `opensAt`, then `closesAt`, then unwrapped `kindId`, then
  `policyHash`. An out-of-order list is `UnorderedSessionWindows(index)`; a window repeated exactly is
  `DuplicateSessionWindow(index)`. One set of windows therefore has exactly one accepted encoding and
  exactly one hash.
- Overlap **across kinds is allowed on purpose**. An Observation, Fixing, or Auction window normally
  sits inside the Trading window it belongs to, and a Maintenance window may interrupt one. An overlap
  rule would make honest schedules unrepresentable.
- The result is `keccak256(abi.encode(SESSION_WINDOW_LIST_TYPEHASH, keccak256(abi.encodePacked(windowHashes))))`.
- The **empty list is legal** and is the canonical representation of a closed day. It hashes to one
  stable nonzero value. A closed day is therefore a positive, provable commitment, never a zero field.

`hashDay` binds `sessionId`, `day`, `windowsHash`, and `evidenceHash` under
`SetrynSessionDayV1(bytes32 sessionId,uint32 day,bytes32 windowsHash,bytes32 evidenceHash)` using the
OpenZeppelin `StandardMerkleTree` double-hash leaf convention,
`keccak256(bytes.concat(keccak256(abi.encode(...))))`. An offchain builder reproduces the inner
encoding with the Solidity types `["bytes32", "bytes32", "uint32", "bytes32", "bytes32"]` and
`SESSION_DAY_TYPEHASH` as the first value. Binding `sessionId` into every leaf means a proof built for
one session can never be replayed against another that happens to share a root.

`hashDay` reverts on a zero `windowsHash` (`ZeroWindowsHash`) or zero `evidenceHash`
(`ZeroSessionEvidenceHash`).

### Comparing windows to a day: exact semantics

There is deliberately **no** `windowsMatch` view. `hashWindows` reverts on every malformed list, so a
non-reverting boolean wrapper would have meant either duplicating every validation rule or swallowing
its reverts. The contract is:

1. The caller holds `SessionWindow[] windows` and a `SessionDay day`.
2. The caller calls `hashWindows(windows)`. If it reverts, the list is not a valid commitment and the
   caller has its answer.
3. The caller compares the result to `day.windowsHash` itself. Equal means these windows are exactly
   what that day committed to.
4. Only then does the caller call `verifyDay(sessionId, version, day, proof)` to prove that the day
   itself belongs to the version.

Step 3 is the caller's, not the registry's.

## State model

- Registration lands in `Paused`. The registrar who publishes a schedule is never the party that opens
  new risk against it.
- Transitions: `Paused -> Active`, `Active -> Paused`, `Active | Paused -> Deprecated`. `Deprecated` is
  terminal. Nothing is ever deleted.
- At most one `Active` version per `SessionId`. Activating a second one reverts
  `AnotherSessionVersionActive`; it never silently pauses the incumbent. Pausing or deprecating the
  active version clears the pointer to 0 and emits the change.
- Two roles: `SESSION_REGISTRAR_ROLE` registers, `SESSION_STATUS_MANAGER_ROLE` moves status. The
  constructor requires a nonzero `initialAdmin` and a nonzero, deployed `ICalendarRegistry`, and grants
  both operational roles to the initial admin.

### Activation is the dependency gate

`activateSession` re-reads the calendar dependency, because it may have been paused, deprecated, or
displaced as the active pointer since registration. It requires
`calendarRegistry.isOpenForNewRisk(calendarId, calendarVersion, day)` to be true at **both** session
horizon endpoints. Otherwise it reverts `CalendarDependencyNotOpen(calendarId, calendarVersion,
validFromDay, validThroughDay)` and the session stays exactly as it was.

The calendar registry is an immutable trusted dependency, but activation still fails closed on it.

## New risk against lifecycle

- `isOpenForNewRisk(sessionId, version, day)` is the only gate a consumer may use to open new risk. It
  is dependency aware and requires **all** of: the version is the active pointer, its status is
  `Active`, `day` is inside the session horizon, and `calendarRegistry.isOpenForNewRisk(calendarId,
  calendarVersion, day)` is true. A session that is Active on its own terms closes the moment its
  calendar version stops being open.
- `isLifecycleEnabled(sessionId, version)` is true for **every** registered version, including Paused
  and Deprecated ones, and regardless of the current status of the calendar dependency.
- `coversDay` is the committed horizon alone, independent of status and of the calendar.
- `verifyDay` is historical evidence, never permission. It verifies Paused and Deprecated versions and
  never consults the calendar, so settlement, fixing, unwind, receipt replay, and audit stay possible
  after a session or its calendar is retired. It returns `false` rather than reverting for an unknown
  version, a zero `windowsHash` or `evidenceHash`, a day outside the horizon, or an invalid proof.

Registration and proof validity are not authorization to open risk. Qualification (the calendar
dependency check) and activation are separate, fail-closed gates.

## Unknown records

`getSession`, `activateSession`, `pauseSession`, and `deprecateSession` revert
`UnknownSessionVersion(sessionId, version)`. A mutation must never treat an absent record as a Paused
one and quietly create it.

Monitoring, pointer, and boolean views use explicit sentinels instead: `statusOf` answers
`RegistryStatus.Unspecified` (never a reachable stored state), `latestVersion` and `activeVersion`
answer 0 (versions start at 1), and `exists`, `coversDay`, `isOpenForNewRisk`, `isLifecycleEnabled`,
and `verifyDay` answer `false`.

## Events

Enumerability comes from logs, not from onchain arrays.

- `SessionRegistered(sessionId, version, versionHash, definitionHash, definition, initialStatus, operator)`
  carries the whole `SessionDefinition` tuple, so an indexer can rebuild every version from logs alone.
  The definition rides as a tuple rather than ten flattened parameters because flattening exhausts the
  EVM stack at the emit site; the ABI encoding carries the same ten fields either way. `initialStatus`
  is logged rather than assumed.
- `SessionStatusChanged(sessionId, version, previousStatus, newStatus, operator)`.
- `SessionActiveVersionChanged(sessionId, previousVersion, newVersion, operator)`, including when the
  pointer is cleared to 0.

## Offchain responsibilities

The publisher of a session must, before registration:

1. Resolve the venue schedule for every civil business day in the horizon, applying timezone, DST,
   holidays, early closes, exceptional closes, and maintenance notices.
2. Encode each day's windows as a strictly sorted `SessionWindow[]` of at most 16 entries, with a
   nonzero `policyHash` per window, and hash it exactly as `hashWindows` does. Closed days get the
   empty list.
3. Build one `SessionDay` leaf per civil business day in the horizon, using the double-hash leaf
   convention above, and a `StandardMerkleTree` over those leaves. The root is `dayScheduleRoot`.
4. Publish `windowKindSetHash`, `ruleSetHash`, and `sourceHash` alongside the retrievable evidence they
   commit to.

## Extensibility proof

1. `SessionId` is a stable, chain-portable lineage ID derived from a V1 key containing only
   `namespaceId` and `referenceId`. No schedule revision can split or merge a lineage.
2. New schedule revisions become append-only immutable versions under that ID. Nothing is ever
   overwritten or deleted.
3. `WindowKindId` is an open typed `bytes32`, not a closed enum. Registration and hashing accept any
   nonzero value; the published constants are convenience only; consumers fail closed on kinds they do
   not support.
4. Registration never grants risk authority. Calendar dependency qualification and a separate,
   separately-roled activation are both required, and activation fails closed on the dependency.
5. Historical versions remain verifiable through `isLifecycleEnabled` and `verifyDay` after pause, after
   deprecation, and after the calendar dependency itself is no longer active.

## Files

- `contracts/src/types/Identifiers.sol` (adds `WindowKindId`)
- `contracts/src/types/SessionDefinition.sol`
- `contracts/src/libraries/SessionDefinitionLib.sol`
- `contracts/src/interfaces/ISessionRegistry.sol`
- `contracts/src/registry/SessionRegistry.sol`
- `contracts/test/unit/SessionRegistry.t.sol`
- `contracts/test/fuzz/SessionRegistry.fuzz.t.sol`
