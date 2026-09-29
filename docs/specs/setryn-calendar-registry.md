# Setryn calendar registry

## Purpose

`CalendarRegistry` is the canonical source of business-day calendars for the protocol. Every market,
schedule, expiry, fixing, and settlement date in Setryn eventually resolves against a calendar, so the
answer to "was day D a business day for calendar C" has to be deterministic, provable, and stable
forever, including long after the calendar itself stops taking new risk.

The registry solves that without ever storing a holiday list onchain. Calendar computation is
offchain. What lands onchain is an immutable, versioned commitment to an already resolved schedule
over a finite horizon, plus the machinery to prove one day against it.

## Boundary

- The registry stores no day arrays, no proofs, and no individual holidays. Storage cost per version
  is constant in the length of the schedule.
- It computes no timezone and no daylight saving arithmetic. `dayStatusRoot` commits the outcome
  after timezone conversion, DST transitions, public holidays, exceptional closures, and source
  corrections have all been resolved offchain.
- It holds no funds, makes no external calls, and never uses `delegatecall`.
- It contains no token addresses, no chain-specific branches, and no deployment-specific behavior.

Sessions, benchmarks, instruments, vaults, and market wiring are out of scope for this contract and
belong to later registries.

## Day numbering

`day` is the unsigned UTC day number `floor(timestamp / 1 days)`. It is a plain `uint32` index, not a
date and not a timestamp. The civil timezone a schedule was resolved in is recorded as `timeZoneId`
and is evidence only; it is never interpreted onchain.

## Identity and versions

```solidity
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
```

`CalendarId` is derived as `IdLib.deriveCalendarId(CalendarDefinitionLib.hashKey(definition))`, and the
V1 key commits `namespaceId` and `referenceId` alone:

```
SetrynCalendarKeyV1(bytes32 namespaceId,bytes32 referenceId)
```

That is the whole point of the split. Extending a horizon, correcting a schedule, changing the
methodology, or re-sourcing the data produces a new version of the same `CalendarId`, never a second
calendar. Like every Setryn identifier, `CalendarId` excludes `chainId` and `verifyingContract`, so one
canonical calendar keeps one identity across Arbitrum Sepolia and Arbitrum One.

Two further commitments are stored per version:

- `definitionHash` commits all nine fields under
  `SetrynCalendarDefinitionV1(bytes32 namespaceId,bytes32 referenceId,bytes32 timeZoneId,uint8 weekendMask,uint32 validFromDay,uint32 validThroughDay,bytes32 dayStatusRoot,bytes32 ruleSetHash,bytes32 sourceHash)`.
- `versionHash` commits `SetrynCalendarVersionV1(bytes32 calendarId,uint32 version,bytes32 definitionHash)`,
  so a stored record can never be replayed as a different version of itself or as a version of another
  calendar.

Versions are sequential `uint32` values per `CalendarId` starting at 1, so 0 is an unambiguous
no-such-version sentinel for both the latest and the active pointer. An identical `definitionHash` may
not be registered twice for the same `CalendarId` (`DuplicateCalendarDefinition`). Exhausting the
`uint32` space raises the named `CalendarVersionExhausted` rather than an opaque `Panic(0x11)`.

Historical versions are immutable and are never deleted. Status is the only mutable field.

## Validation

Registration rejects, with a named error in each case:

1. Zero `namespaceId` (`ZeroCalendarNamespaceId`) or zero `referenceId` (`ZeroCalendarReferenceId`).
2. Zero `timeZoneId` (`ZeroTimeZoneId`).
3. A `weekendMask` above `0x7f` (`InvalidWeekendMask`). Bits 0 through 6 are Monday through Sunday;
   bit 7 has no weekday to name.
4. A `weekendMask` of exactly `0x7f` (`EmptyBusinessWeek`), which declares no possible business day.
   A zero mask is accepted and is the 24/7 calendar.
5. `validFromDay > validThroughDay` (`InvalidCalendarHorizon`). A single-day horizon is valid.
6. A zero `dayStatusRoot` (`ZeroDayStatusRoot`), `ruleSetHash` (`ZeroRuleSetHash`), or `sourceHash`
   (`ZeroCalendarSourceHash`).

`weekendMask` is a commitment to the recurring weekly rule for auditors and offchain builders. It is
never evaluated onchain, because `dayStatusRoot` already carries the exact per-day answer.

## Day proof

```solidity
struct CalendarDay {
    uint32 day;
    bool isBusinessDay;
    bytes32 evidenceHash;
}
```

The leaf uses the OpenZeppelin `StandardMerkleTree` double-hash convention exactly:

```
leaf = keccak256(bytes.concat(keccak256(abi.encode(
    CALENDAR_DAY_TYPEHASH, calendarId, day, isBusinessDay, evidenceHash
))))
```

where `CALENDAR_DAY_TYPEHASH` is
`keccak256("SetrynCalendarDayV1(bytes32 calendarId,uint32 day,bool isBusinessDay,bytes32 evidenceHash)")`.
An offchain builder reproduces it with the Solidity leaf encoding
`["bytes32", "bytes32", "uint32", "bool", "bytes32"]` and the typehash as the first value. The outer
hash keeps a leaf preimage from ever colliding with an internal node, whose preimage is exactly 64
bytes. Internal nodes use the sorted-pair ordering that `MerkleProof` verifies against.

`calendarId` is bound into every leaf, so a proof built for one calendar can never be replayed against
another calendar that happens to publish the same root. `evidenceHash` binds the classification to the
offchain record that justifies it and must be nonzero.

- `hashDay(calendarId, calendarDay)` returns the leaf and reverts `ZeroEvidenceHash` on a zero
  `evidenceHash`.
- `verifyDay(calendarId, version, calendarDay, proof)` returns `false`, never reverts, for an unknown
  version, a zero `evidenceHash`, a day outside that version horizon, or an invalid proof. The zero
  and horizon checks run before the hashing helper, so the helper revert can never escape a view that
  promises a boolean.

## State model

`AccessControlDefaultAdminRules`, with two operational roles:

- `CALENDAR_REGISTRAR_ROLE` registers immutable versions.
- `CALENDAR_STATUS_MANAGER_ROLE` activates, pauses, and deprecates.

The constructor rejects a zero admin with `ZeroInitialAdmin` and grants both roles to the initial
admin.

Registration lands in `Paused`, so the registrar who publishes a schedule can never be the party that
opens new risk against it. Permitted transitions:

- `Paused -> Active`
- `Active -> Paused`
- `Active -> Deprecated` and `Paused -> Deprecated`
- `Deprecated` is terminal. Nothing is ever deleted.

Anything else raises `InvalidCalendarTransition`. A mutation on a version that was never registered
raises `UnknownCalendarVersion`; it must never treat an absent record as a `Paused` one and quietly
create it.

At most one version per `CalendarId` is active. Activating a second version raises
`AnotherCalendarVersionActive` rather than silently pausing the live one, because a silent swap would
move the whole protocol onto a new schedule inside a single transaction nobody reviewed as such.
Pausing or deprecating the active version clears the active pointer to 0 and emits the change.

## New risk against lifecycle

This is the distinction the rest of the protocol depends on.

- `isOpenForNewRisk(calendarId, version, day)` is the only gate for opening new risk. It is true only
  when the version is the active pointer, is in `Active` status, and the day falls inside the committed
  horizon. It does not say the day is a business day; a caller that needs the classification must also
  call `verifyDay`.
- `isLifecycleEnabled(calendarId, version)` is true for every registered version, including `Paused`
  and `Deprecated` ones.
- `coversDay(calendarId, version, day)` answers the horizon question alone, independent of status.

Future expiry, fixing, settlement, unwind, and receipt replay must never require current `Active`
status for a historical version. Requiring it would mean that pausing a calendar strands every open
position that references it. Proof verification is historical evidence, not permission.

## Unknown records

Explicit and split by purpose:

- `getCalendar` and every mutation revert `UnknownCalendarVersion`, because a zeroed `CalendarVersion`
  carries a zero horizon and a zero root that a caller could mistake for a real record.
- `statusOf` returns `RegistryStatus.Unspecified`, which is never a reachable stored state.
- `latestVersion` and `activeVersion` return 0, because versions start at 1.
- `exists`, `isLifecycleEnabled`, `coversDay`, `isOpenForNewRisk`, and `verifyDay` return `false`, so a
  monitor can poll blind.

## Events

The registry keeps no enumerable array. The events are the enumeration source, and an indexer can
rebuild every immutable version and every transition from logs alone.

- `CalendarRegistered(calendarId, version, versionHash, definitionHash, definition, initialStatus, operator)`.
  The definition rides as a whole tuple rather than as nine flattened parameters, because flattening
  them alongside the commitments exhausts the EVM stack at the emit site. The ABI encoding carries
  exactly the same nine fields either way. `initialStatus` is always `Paused` today and is logged
  rather than assumed, so an indexer never has to hardcode the landing state.
- `CalendarStatusChanged(calendarId, version, previousStatus, newStatus, operator)`.
- `CalendarActiveVersionChanged(calendarId, previousVersion, newVersion, operator)`, emitted whenever
  the single active pointer moves, including when it is cleared to 0.

## Offchain responsibilities

The registry cannot check any of this, so it is stated here as the obligation of whoever publishes a
schedule:

- The Merkle tree contains exactly one leaf per day in `[validFromDay, validThroughDay]`, with no gaps
  and no duplicates.
- The classification of each day is consistent with the declared `weekendMask` and with the
  methodology committed by `ruleSetHash`.
- `sourceHash` commits the provenance of the underlying source data, and `evidenceHash` per day
  commits the specific record behind that day.
- A horizon is finite by design. Extending coverage is a new version and an explicit activation, never
  an edit.

## Files

- `contracts/src/types/CalendarDefinition.sol`
- `contracts/src/libraries/CalendarDefinitionLib.sol`
- `contracts/src/interfaces/ICalendarRegistry.sol`
- `contracts/src/registry/CalendarRegistry.sol`
- `contracts/test/unit/CalendarRegistry.t.sol`
- `contracts/test/fuzz/CalendarRegistry.fuzz.t.sol`
