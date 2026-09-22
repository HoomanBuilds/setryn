// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {RegistryStatus} from "./Enums.sol";
import {AdapterId, AssetId, BenchmarkKindId, CalendarId, SessionId} from "./Identifiers.sol";

/// @dev A benchmark definition is a chain-local qualification of one economic reference against the
/// exact asset, adapter, calendar, and session versions it is allowed to be observed through.
/// Identity is the namespaceId, referenceId, kindId, baseAssetId, and quoteAssetId tuple alone, so
/// repointing the reference at a replacement oracle adapter, a corrected observation rule, a newer
/// calendar or session version, or a different chain never mints a second lineage.
///
/// @dev kindId is an open typed tag rather than an enum, so FX, crypto, commodity, rate, index, NAV,
/// redemption, perpetual mark, and any kind invented later all encode identically. It belongs in the
/// identity key because a reference that changes economic kind is a different benchmark, not a new
/// version of the old one.
///
/// @dev adapterId, adapterVersion, calendarId, calendarVersion, sessionId, and sessionVersion name
/// exact immutable dependency versions rather than lineages, so a benchmark can never be silently
/// repointed at a replacement implementation or a revised schedule. They are chain-local operational
/// qualification, which is why the definition commitment hashes block.chainid in, the opposite of
/// canonical identity derivation.
///
/// @dev requiredInterfaceHash and requiredCapabilityHash are the exact adapter commitments this
/// benchmark demands. The registry compares them for equality against the referenced adapter version
/// and fails closed; it never accepts a superset, a subset, or a best-effort match.
///
/// @dev feedKey, outputDecimals, maxStalenessSeconds, maxFutureSkewSeconds, and maxConfidenceBps are
/// stored here but consumed later. This registry performs no price read, no feed lookup, and no
/// validity check against live oracle data. A benchmark adapter and the fixing engine are the
/// components that resolve feedKey and enforce these bounds at observation time.
///
/// @dev The five policy and evidence hashes are anchors, never computation inputs, and every one of
/// them must be nonzero:
/// - observationRuleHash commits how an observation is taken, averaged, and timestamped;
/// - fallbackPolicyHash commits what happens when the primary source is unavailable;
/// - disruptionPolicyHash commits what happens on a market disruption, a halt, or a stale fixing;
/// - dataRightsHash commits the licensing and redistribution terms of the underlying data;
/// - evidenceHash commits the broader review record behind the qualification.
struct BenchmarkDefinition {
    bytes32 namespaceId;
    bytes32 referenceId;
    BenchmarkKindId kindId;
    AssetId baseAssetId;
    AssetId quoteAssetId;
    AdapterId adapterId;
    uint32 adapterVersion;
    CalendarId calendarId;
    uint32 calendarVersion;
    SessionId sessionId;
    uint32 sessionVersion;
    bytes32 feedKey;
    bytes32 requiredInterfaceHash;
    bytes32 requiredCapabilityHash;
    uint8 outputDecimals;
    uint32 maxStalenessSeconds;
    uint32 maxFutureSkewSeconds;
    uint16 maxConfidenceBps;
    bytes32 observationRuleHash;
    bytes32 fallbackPolicyHash;
    bytes32 disruptionPolicyHash;
    bytes32 dataRightsHash;
    bytes32 evidenceHash;
}

/// @dev One immutable chain-local version of a benchmark lineage. Status is the only mutable field
/// and it gates future qualification only; a version is never edited and never deleted.
struct BenchmarkVersion {
    BenchmarkDefinition definition;
    bytes32 definitionHash;
    bytes32 versionHash;
    uint32 version;
    RegistryStatus status;
}
