// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {CalendarDay, CalendarDefinition} from "../types/CalendarDefinition.sol";
import {CalendarId} from "../types/Identifiers.sol";
import {IdLib} from "./IdLib.sol";

error ZeroCalendarNamespaceId();

error ZeroCalendarReferenceId();

error ZeroTimeZoneId();

error InvalidWeekendMask(uint8 weekendMask);

error EmptyBusinessWeek(uint8 weekendMask);

error InvalidCalendarHorizon(uint32 validFromDay, uint32 validThroughDay);

error ZeroDayStatusRoot();

error ZeroRuleSetHash();

error ZeroCalendarSourceHash();

error ZeroEvidenceHash();

library CalendarDefinitionLib {
    /// @dev Bits 0 through 6 are Monday through Sunday. Bit 7 has no weekday to name, so any mask
    /// above this value is malformed rather than merely unusual.
    uint8 internal constant WEEKEND_MASK_MAX = 0x7f;

    /// @dev Every weekday marked as weekend. A calendar that declares no possible business day can
    /// never open, so it is rejected at registration instead of silently blocking every later date.
    uint8 internal constant FULL_WEEK_MASK = 0x7f;

    /// @dev The typestring is kept beside the typehash so a test can prove they agree. Solidity
    /// cannot hash a string constant inside another constant initializer, so the literal is repeated
    /// rather than referenced.
    ///
    /// @dev Each literal carries its version. A hashing rule may never be edited in place; it is
    /// replaced by a new V2 literal, so previously derived hashes can never silently re-derive.
    ///
    /// @dev The identity key commits namespaceId and referenceId alone, so a revised schedule, a
    /// moved horizon, or a corrected source stays the same CalendarId under a new version.
    string internal constant CALENDAR_KEY_TYPESTRING = "SetrynCalendarKeyV1(bytes32 namespaceId,bytes32 referenceId)";
    bytes32 internal constant CALENDAR_KEY_TYPEHASH =
        keccak256("SetrynCalendarKeyV1(bytes32 namespaceId,bytes32 referenceId)");

    string internal constant CALENDAR_DEFINITION_TYPESTRING =
        "SetrynCalendarDefinitionV1(bytes32 namespaceId,bytes32 referenceId,bytes32 timeZoneId,uint8 weekendMask,uint32 validFromDay,uint32 validThroughDay,bytes32 dayStatusRoot,bytes32 ruleSetHash,bytes32 sourceHash)";
    bytes32 internal constant CALENDAR_DEFINITION_TYPEHASH = keccak256(
        "SetrynCalendarDefinitionV1(bytes32 namespaceId,bytes32 referenceId,bytes32 timeZoneId,uint8 weekendMask,uint32 validFromDay,uint32 validThroughDay,bytes32 dayStatusRoot,bytes32 ruleSetHash,bytes32 sourceHash)"
    );

    /// @dev The version commitment binds the lineage identity and the sequence number to the
    /// definition, so a stored record can never be replayed as a different version of itself or as a
    /// version of a different calendar.
    string internal constant CALENDAR_VERSION_TYPESTRING =
        "SetrynCalendarVersionV1(bytes32 calendarId,uint32 version,bytes32 definitionHash)";
    bytes32 internal constant CALENDAR_VERSION_TYPEHASH =
        keccak256("SetrynCalendarVersionV1(bytes32 calendarId,uint32 version,bytes32 definitionHash)");

    /// @dev The leaf commitment binds calendarId into every day, so a proof built for one calendar
    /// can never be replayed against another calendar that happens to share a root.
    string internal constant CALENDAR_DAY_TYPESTRING =
        "SetrynCalendarDayV1(bytes32 calendarId,uint32 day,bool isBusinessDay,bytes32 evidenceHash)";
    bytes32 internal constant CALENDAR_DAY_TYPEHASH =
        keccak256("SetrynCalendarDayV1(bytes32 calendarId,uint32 day,bool isBusinessDay,bytes32 evidenceHash)");

    function validate(CalendarDefinition memory definition) internal pure {
        if (definition.namespaceId == bytes32(0)) {
            revert ZeroCalendarNamespaceId();
        }
        if (definition.referenceId == bytes32(0)) {
            revert ZeroCalendarReferenceId();
        }
        if (definition.timeZoneId == bytes32(0)) {
            revert ZeroTimeZoneId();
        }
        if (definition.weekendMask > WEEKEND_MASK_MAX) {
            revert InvalidWeekendMask(definition.weekendMask);
        }
        if (definition.weekendMask == FULL_WEEK_MASK) {
            revert EmptyBusinessWeek(definition.weekendMask);
        }
        if (definition.validFromDay > definition.validThroughDay) {
            revert InvalidCalendarHorizon(definition.validFromDay, definition.validThroughDay);
        }
        if (definition.dayStatusRoot == bytes32(0)) {
            revert ZeroDayStatusRoot();
        }
        if (definition.ruleSetHash == bytes32(0)) {
            revert ZeroRuleSetHash();
        }
        if (definition.sourceHash == bytes32(0)) {
            revert ZeroCalendarSourceHash();
        }
    }

    /// @dev Hashes the identity key alone, so republishing a calendar with a later horizon or a
    /// corrected schedule can never mint a second identity for the same namespaced reference.
    function hashKey(CalendarDefinition memory definition) internal pure returns (bytes32) {
        return keccak256(abi.encode(CALENDAR_KEY_TYPEHASH, definition.namespaceId, definition.referenceId));
    }

    /// @dev Hashes every field, including the non-identity ones, so two registrations of one lineage
    /// that would have disagreed on horizon, mask, root, methodology, or provenance are distinct.
    function hashDefinition(CalendarDefinition memory definition) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                CALENDAR_DEFINITION_TYPEHASH,
                definition.namespaceId,
                definition.referenceId,
                definition.timeZoneId,
                definition.weekendMask,
                definition.validFromDay,
                definition.validThroughDay,
                definition.dayStatusRoot,
                definition.ruleSetHash,
                definition.sourceHash
            )
        );
    }

    function hashVersion(CalendarId calendarId, uint32 version, bytes32 definitionHash)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(CALENDAR_VERSION_TYPEHASH, CalendarId.unwrap(calendarId), version, definitionHash));
    }

    function deriveCalendarId(CalendarDefinition memory definition) internal pure returns (CalendarId) {
        return IdLib.deriveCalendarId(hashKey(definition));
    }

    /// @dev The OpenZeppelin StandardMerkleTree leaf convention, hashed exactly as
    /// `keccak256(bytes.concat(keccak256(abi.encode(...))))`. The inner ABI encoding is the tuple
    /// `(bytes32 typehash, bytes32 calendarId, uint32 day, bool isBusinessDay, bytes32 evidenceHash)`,
    /// which an offchain builder reproduces with the Solidity types
    /// `["bytes32", "bytes32", "uint32", "bool", "bytes32"]` and `CALENDAR_DAY_TYPEHASH` as the first
    /// value. The double hash keeps a leaf preimage from ever colliding with an internal node, whose
    /// preimage is exactly 64 bytes.
    ///
    /// @dev Reverts on a zero evidenceHash so a caller cannot build a leaf that no honest schedule
    /// would ever publish. Non-reverting callers must reject the zero value before calling here.
    function hashDay(CalendarId calendarId, CalendarDay memory calendarDay) internal pure returns (bytes32) {
        if (calendarDay.evidenceHash == bytes32(0)) {
            revert ZeroEvidenceHash();
        }
        return keccak256(
            bytes.concat(
                keccak256(
                    abi.encode(
                        CALENDAR_DAY_TYPEHASH,
                        CalendarId.unwrap(calendarId),
                        calendarDay.day,
                        calendarDay.isBusinessDay,
                        calendarDay.evidenceHash
                    )
                )
            )
        );
    }
}
