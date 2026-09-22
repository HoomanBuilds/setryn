// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {CalendarId, SessionId, WindowKindId} from "../types/Identifiers.sol";
import {SessionDay, SessionDefinition, SessionWindow} from "../types/SessionDefinition.sol";
import {IdLib} from "./IdLib.sol";

error ZeroSessionNamespaceId();

error ZeroSessionReferenceId();

error ZeroSessionCalendarId();

error ZeroSessionCalendarVersion();

error InvalidSessionHorizon(uint32 validFromDay, uint32 validThroughDay);

error ZeroDayScheduleRoot();

error ZeroWindowKindSetHash();

error ZeroSessionRuleSetHash();

error ZeroSessionSourceHash();

error ZeroWindowKindId();

error ZeroWindowPolicyHash();

error InvalidWindowInterval(uint64 opensAt, uint64 closesAt);

error TooManyWindows(uint256 count);

error UnorderedSessionWindows(uint256 index);

error DuplicateSessionWindow(uint256 index);

error ZeroWindowsHash();

error ZeroSessionEvidenceHash();

library SessionDefinitionLib {
    /// @dev A hard bound on the windows a single day may commit to. It keeps the canonical hashing
    /// path cost bounded for every caller, including view callers, and no realistic venue day needs
    /// more segments than this. Exceeding it is a named error rather than an out-of-gas.
    uint256 internal constant MAX_SESSION_WINDOWS = 16;

    /// @dev Published tags for the kinds V1 consumers are expected to meet first. They are
    /// convenience constants only. Registration and hashing accept any nonzero WindowKindId, so a
    /// kind invented after this deployment needs no change here, and a consumer must still require
    /// the exact kinds it supports instead of assuming this list is exhaustive.
    WindowKindId internal constant WINDOW_KIND_TRADING = WindowKindId.wrap(keccak256("SetrynWindowKindV1:Trading"));
    WindowKindId internal constant WINDOW_KIND_OBSERVATION =
        WindowKindId.wrap(keccak256("SetrynWindowKindV1:Observation"));
    WindowKindId internal constant WINDOW_KIND_FIXING = WindowKindId.wrap(keccak256("SetrynWindowKindV1:Fixing"));
    WindowKindId internal constant WINDOW_KIND_AUCTION = WindowKindId.wrap(keccak256("SetrynWindowKindV1:Auction"));
    WindowKindId internal constant WINDOW_KIND_MAINTENANCE =
        WindowKindId.wrap(keccak256("SetrynWindowKindV1:Maintenance"));

    /// @dev The typestring is kept beside the typehash so a test can prove they agree. Solidity
    /// cannot hash a string constant inside another constant initializer, so the literal is repeated
    /// rather than referenced.
    ///
    /// @dev Each literal carries its version. A hashing rule may never be edited in place; it is
    /// replaced by a new V2 literal, so previously derived hashes can never silently re-derive.
    ///
    /// @dev The identity key commits namespaceId and referenceId alone, so a revised schedule, a
    /// moved horizon, or a newer calendar dependency stays the same SessionId under a new version.
    string internal constant SESSION_KEY_TYPESTRING = "SetrynSessionKeyV1(bytes32 namespaceId,bytes32 referenceId)";
    bytes32 internal constant SESSION_KEY_TYPEHASH =
        keccak256("SetrynSessionKeyV1(bytes32 namespaceId,bytes32 referenceId)");

    string internal constant SESSION_DEFINITION_TYPESTRING =
        "SetrynSessionDefinitionV1(bytes32 namespaceId,bytes32 referenceId,bytes32 calendarId,uint32 calendarVersion,uint32 validFromDay,uint32 validThroughDay,bytes32 dayScheduleRoot,bytes32 windowKindSetHash,bytes32 ruleSetHash,bytes32 sourceHash)";
    bytes32 internal constant SESSION_DEFINITION_TYPEHASH = keccak256(
        "SetrynSessionDefinitionV1(bytes32 namespaceId,bytes32 referenceId,bytes32 calendarId,uint32 calendarVersion,uint32 validFromDay,uint32 validThroughDay,bytes32 dayScheduleRoot,bytes32 windowKindSetHash,bytes32 ruleSetHash,bytes32 sourceHash)"
    );

    /// @dev The version commitment binds the lineage identity and the sequence number to the
    /// definition, so a stored record can never be replayed as a different version of itself or as a
    /// version of a different session.
    string internal constant SESSION_VERSION_TYPESTRING =
        "SetrynSessionVersionV1(bytes32 sessionId,uint32 version,bytes32 definitionHash)";
    bytes32 internal constant SESSION_VERSION_TYPEHASH =
        keccak256("SetrynSessionVersionV1(bytes32 sessionId,uint32 version,bytes32 definitionHash)");

    /// @dev A single window commitment. kindId is hashed as an opaque bytes32, which is exactly what
    /// keeps the kind space open: a tag this deployment has never heard of hashes identically.
    string internal constant SESSION_WINDOW_TYPESTRING =
        "SetrynSessionWindowV1(bytes32 kindId,uint64 opensAt,uint64 closesAt,bytes32 policyHash)";
    bytes32 internal constant SESSION_WINDOW_TYPEHASH =
        keccak256("SetrynSessionWindowV1(bytes32 kindId,uint64 opensAt,uint64 closesAt,bytes32 policyHash)");

    /// @dev The ordered window list of one day, committed as the hash of the packed array of
    /// individual window hashes under its own typehash. Because the list is required to be strictly
    /// sorted, one set of windows has exactly one encoding and therefore exactly one hash.
    string internal constant SESSION_WINDOW_LIST_TYPESTRING = "SetrynSessionWindowListV1(bytes32[] windowHashes)";
    bytes32 internal constant SESSION_WINDOW_LIST_TYPEHASH =
        keccak256("SetrynSessionWindowListV1(bytes32[] windowHashes)");

    /// @dev The leaf commitment binds sessionId into every day, so a proof built for one session can
    /// never be replayed against another session that happens to share a root.
    string internal constant SESSION_DAY_TYPESTRING =
        "SetrynSessionDayV1(bytes32 sessionId,uint32 day,bytes32 windowsHash,bytes32 evidenceHash)";
    bytes32 internal constant SESSION_DAY_TYPEHASH =
        keccak256("SetrynSessionDayV1(bytes32 sessionId,uint32 day,bytes32 windowsHash,bytes32 evidenceHash)");

    function validate(SessionDefinition memory definition) internal pure {
        if (definition.namespaceId == bytes32(0)) {
            revert ZeroSessionNamespaceId();
        }
        if (definition.referenceId == bytes32(0)) {
            revert ZeroSessionReferenceId();
        }
        if (CalendarId.unwrap(definition.calendarId) == bytes32(0)) {
            revert ZeroSessionCalendarId();
        }
        if (definition.calendarVersion == 0) {
            revert ZeroSessionCalendarVersion();
        }
        if (definition.validFromDay > definition.validThroughDay) {
            revert InvalidSessionHorizon(definition.validFromDay, definition.validThroughDay);
        }
        if (definition.dayScheduleRoot == bytes32(0)) {
            revert ZeroDayScheduleRoot();
        }
        if (definition.windowKindSetHash == bytes32(0)) {
            revert ZeroWindowKindSetHash();
        }
        if (definition.ruleSetHash == bytes32(0)) {
            revert ZeroSessionRuleSetHash();
        }
        if (definition.sourceHash == bytes32(0)) {
            revert ZeroSessionSourceHash();
        }
    }

    /// @dev Hashes the identity key alone, so republishing a session with a later horizon, a revised
    /// schedule, or a newer calendar version can never mint a second identity for the same
    /// namespaced reference.
    function hashKey(SessionDefinition memory definition) internal pure returns (bytes32) {
        return keccak256(abi.encode(SESSION_KEY_TYPEHASH, definition.namespaceId, definition.referenceId));
    }

    /// @dev Hashes every field, including the non-identity ones, so two registrations of one lineage
    /// that would have disagreed on calendar dependency, horizon, schedule, kind set, methodology,
    /// or provenance are distinct.
    function hashDefinition(SessionDefinition memory definition) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                SESSION_DEFINITION_TYPEHASH,
                definition.namespaceId,
                definition.referenceId,
                CalendarId.unwrap(definition.calendarId),
                definition.calendarVersion,
                definition.validFromDay,
                definition.validThroughDay,
                definition.dayScheduleRoot,
                definition.windowKindSetHash,
                definition.ruleSetHash,
                definition.sourceHash
            )
        );
    }

    function hashVersion(SessionId sessionId, uint32 version, bytes32 definitionHash) internal pure returns (bytes32) {
        return keccak256(abi.encode(SESSION_VERSION_TYPEHASH, SessionId.unwrap(sessionId), version, definitionHash));
    }

    function deriveSessionId(SessionDefinition memory definition) internal pure returns (SessionId) {
        return IdLib.deriveSessionId(hashKey(definition));
    }

    /// @dev Accepts any nonzero kindId. The library knows nothing about which kinds exist, which is
    /// what keeps the kind space open across deployments; a consumer is responsible for requiring
    /// the exact kinds it supports and failing closed on the rest.
    ///
    /// @dev Reverts on a zero policyHash and on a non-positive interval, so a committed window
    /// always names a rule and always spans real time.
    function hashWindow(SessionWindow calldata window) internal pure returns (bytes32) {
        if (WindowKindId.unwrap(window.kindId) == bytes32(0)) {
            revert ZeroWindowKindId();
        }
        if (window.policyHash == bytes32(0)) {
            revert ZeroWindowPolicyHash();
        }
        if (window.opensAt >= window.closesAt) {
            revert InvalidWindowInterval(window.opensAt, window.closesAt);
        }
        return keccak256(
            abi.encode(
                SESSION_WINDOW_TYPEHASH,
                WindowKindId.unwrap(window.kindId),
                window.opensAt,
                window.closesAt,
                window.policyHash
            )
        );
    }

    /// @dev The canonical windowsHash of one day. The list must be strictly sorted by opensAt, then
    /// closesAt, then unwrapped kindId, then policyHash, so a given set of windows has exactly one
    /// accepted encoding and one hash. An unsorted list and an exactly duplicated window are named
    /// errors rather than a second valid encoding of the same day.
    ///
    /// @dev Overlap across kinds is deliberately allowed. An Observation, Fixing, or Auction window
    /// normally sits inside the Trading window it belongs to, and a Maintenance window may interrupt
    /// one, so an overlap rule would make honest schedules unrepresentable.
    ///
    /// @dev The empty list is legal and is the canonical representation of a closed day. It hashes
    /// to one stable nonzero value, so a closed day is a positive commitment, never a zero field.
    function hashWindows(SessionWindow[] calldata windows) internal pure returns (bytes32) {
        uint256 count = windows.length;
        if (count > MAX_SESSION_WINDOWS) {
            revert TooManyWindows(count);
        }

        bytes32[] memory windowHashes = new bytes32[](count);
        for (uint256 i = 0; i < count; i++) {
            if (i > 0) {
                _requireStrictlyAfter(windows[i - 1], windows[i], i);
            }
            windowHashes[i] = hashWindow(windows[i]);
        }

        return keccak256(abi.encode(SESSION_WINDOW_LIST_TYPEHASH, keccak256(abi.encodePacked(windowHashes))));
    }

    /// @dev The OpenZeppelin StandardMerkleTree leaf convention, hashed exactly as
    /// `keccak256(bytes.concat(keccak256(abi.encode(...))))`. The inner ABI encoding is the tuple
    /// `(bytes32 typehash, bytes32 sessionId, uint32 day, bytes32 windowsHash, bytes32 evidenceHash)`,
    /// which an offchain builder reproduces with the Solidity types
    /// `["bytes32", "bytes32", "uint32", "bytes32", "bytes32"]` and `SESSION_DAY_TYPEHASH` as the
    /// first value. The double hash keeps a leaf preimage from ever colliding with an internal node,
    /// whose preimage is exactly 64 bytes.
    ///
    /// @dev Reverts on a zero windowsHash or a zero evidenceHash so a caller cannot build a leaf
    /// that no honest schedule would ever publish. A closed day carries the canonical empty-list
    /// hash, which is nonzero. Non-reverting callers must reject both zero values before calling.
    function hashDay(SessionId sessionId, SessionDay memory sessionDay) internal pure returns (bytes32) {
        if (sessionDay.windowsHash == bytes32(0)) {
            revert ZeroWindowsHash();
        }
        if (sessionDay.evidenceHash == bytes32(0)) {
            revert ZeroSessionEvidenceHash();
        }
        return keccak256(
            bytes.concat(
                keccak256(
                    abi.encode(
                        SESSION_DAY_TYPEHASH,
                        SessionId.unwrap(sessionId),
                        sessionDay.day,
                        sessionDay.windowsHash,
                        sessionDay.evidenceHash
                    )
                )
            )
        );
    }

    /// @dev Strict lexicographic ordering over the four window fields. Equality on all four is the
    /// exact-duplicate case and is named separately, because a list that repeats a window is a
    /// different mistake from a list that is merely out of order.
    function _requireStrictlyAfter(SessionWindow calldata previous, SessionWindow calldata current, uint256 index)
        private
        pure
    {
        if (previous.opensAt != current.opensAt) {
            if (previous.opensAt > current.opensAt) {
                revert UnorderedSessionWindows(index);
            }
            return;
        }
        if (previous.closesAt != current.closesAt) {
            if (previous.closesAt > current.closesAt) {
                revert UnorderedSessionWindows(index);
            }
            return;
        }

        uint256 previousKind = uint256(WindowKindId.unwrap(previous.kindId));
        uint256 currentKind = uint256(WindowKindId.unwrap(current.kindId));
        if (previousKind != currentKind) {
            if (previousKind > currentKind) {
                revert UnorderedSessionWindows(index);
            }
            return;
        }

        if (previous.policyHash == current.policyHash) {
            revert DuplicateSessionWindow(index);
        }
        if (uint256(previous.policyHash) > uint256(current.policyHash)) {
            revert UnorderedSessionWindows(index);
        }
    }
}
