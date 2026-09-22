// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {BenchmarkDefinition} from "../types/BenchmarkDefinition.sol";
import {AdapterId, AssetId, BenchmarkId, BenchmarkKindId, CalendarId, SessionId} from "../types/Identifiers.sol";
import {BPS_DENOMINATOR, MAX_DECIMALS} from "../types/Units.sol";
import {IdLib} from "./IdLib.sol";

error ZeroBenchmarkNamespaceId();

error ZeroBenchmarkReferenceId();

error ZeroBenchmarkKindId();

error ZeroBenchmarkBaseAssetId();

error ZeroBenchmarkQuoteAssetId();

error IdenticalBenchmarkAssets(AssetId assetId);

error ZeroBenchmarkAdapterId();

error ZeroBenchmarkAdapterVersion();

error ZeroBenchmarkCalendarId();

error ZeroBenchmarkCalendarVersion();

error ZeroBenchmarkSessionId();

error ZeroBenchmarkSessionVersion();

error ZeroBenchmarkFeedKey();

error ZeroBenchmarkRequiredInterfaceHash();

error ZeroBenchmarkRequiredCapabilityHash();

error BenchmarkDecimalsOutOfRange(uint8 outputDecimals);

error ZeroBenchmarkMaxStalenessSeconds();

error BenchmarkConfidenceOutOfRange(uint16 maxConfidenceBps);

error ZeroBenchmarkObservationRuleHash();

error ZeroBenchmarkFallbackPolicyHash();

error ZeroBenchmarkDisruptionPolicyHash();

error ZeroBenchmarkDataRightsHash();

error ZeroBenchmarkEvidenceHash();

library BenchmarkDefinitionLib {
    /// @dev Published tags for the kinds V1 consumers are expected to meet first. They are
    /// convenience constants only. Registration and hashing accept any nonzero BenchmarkKindId, so a
    /// kind invented after this deployment needs no change here, and a consumer must still require
    /// the exact kinds it supports instead of assuming this list is exhaustive.
    BenchmarkKindId internal constant BENCHMARK_KIND_SPOT =
        BenchmarkKindId.wrap(keccak256("SetrynBenchmarkKindV1:Spot"));
    BenchmarkKindId internal constant BENCHMARK_KIND_PERPETUAL_MARK =
        BenchmarkKindId.wrap(keccak256("SetrynBenchmarkKindV1:PerpetualMark"));
    BenchmarkKindId internal constant BENCHMARK_KIND_INDEX =
        BenchmarkKindId.wrap(keccak256("SetrynBenchmarkKindV1:Index"));
    BenchmarkKindId internal constant BENCHMARK_KIND_NAV = BenchmarkKindId.wrap(keccak256("SetrynBenchmarkKindV1:NAV"));
    BenchmarkKindId internal constant BENCHMARK_KIND_REDEMPTION =
        BenchmarkKindId.wrap(keccak256("SetrynBenchmarkKindV1:Redemption"));
    BenchmarkKindId internal constant BENCHMARK_KIND_REFERENCE_RATE =
        BenchmarkKindId.wrap(keccak256("SetrynBenchmarkKindV1:ReferenceRate"));
    BenchmarkKindId internal constant BENCHMARK_KIND_SETTLEMENT_FIXING =
        BenchmarkKindId.wrap(keccak256("SetrynBenchmarkKindV1:SettlementFixing"));

    /// @dev The typestring is kept beside the typehash so a test can prove they agree. Solidity
    /// cannot hash a string constant inside another constant initializer, so the literal is repeated
    /// rather than referenced.
    ///
    /// @dev Each literal carries its version. A hashing rule may never be edited in place; it is
    /// replaced by a new V2 literal, so previously derived hashes can never silently re-derive.
    ///
    /// @dev The identity key commits the namespaced reference, the economic kind, and the ordered
    /// asset pair alone, so a replacement oracle adapter, a corrected observation rule, a newer
    /// calendar or session version, or a deployment on another chain stays the same BenchmarkId
    /// under a new chain-local version.
    string internal constant BENCHMARK_KEY_TYPESTRING =
        "SetrynBenchmarkKeyV1(bytes32 namespaceId,bytes32 referenceId,bytes32 kindId,bytes32 baseAssetId,bytes32 quoteAssetId)";
    bytes32 internal constant BENCHMARK_KEY_TYPEHASH = keccak256(
        "SetrynBenchmarkKeyV1(bytes32 namespaceId,bytes32 referenceId,bytes32 kindId,bytes32 baseAssetId,bytes32 quoteAssetId)"
    );

    /// @dev chainId is hashed in deliberately, the opposite of canonical identity. Adapter, calendar,
    /// and session qualification versions are chain-local operational dependencies, so the same
    /// economic reference qualified on two chains must never share one commitment.
    string internal constant BENCHMARK_DEFINITION_TYPESTRING =
        "SetrynBenchmarkDefinitionV1(bytes32 namespaceId,bytes32 referenceId,bytes32 kindId,bytes32 baseAssetId,bytes32 quoteAssetId,bytes32 adapterId,uint32 adapterVersion,bytes32 calendarId,uint32 calendarVersion,bytes32 sessionId,uint32 sessionVersion,bytes32 feedKey,bytes32 requiredInterfaceHash,bytes32 requiredCapabilityHash,uint8 outputDecimals,uint32 maxStalenessSeconds,uint32 maxFutureSkewSeconds,uint16 maxConfidenceBps,bytes32 observationRuleHash,bytes32 fallbackPolicyHash,bytes32 disruptionPolicyHash,bytes32 dataRightsHash,bytes32 evidenceHash,uint256 chainId)";
    bytes32 internal constant BENCHMARK_DEFINITION_TYPEHASH = keccak256(
        "SetrynBenchmarkDefinitionV1(bytes32 namespaceId,bytes32 referenceId,bytes32 kindId,bytes32 baseAssetId,bytes32 quoteAssetId,bytes32 adapterId,uint32 adapterVersion,bytes32 calendarId,uint32 calendarVersion,bytes32 sessionId,uint32 sessionVersion,bytes32 feedKey,bytes32 requiredInterfaceHash,bytes32 requiredCapabilityHash,uint8 outputDecimals,uint32 maxStalenessSeconds,uint32 maxFutureSkewSeconds,uint16 maxConfidenceBps,bytes32 observationRuleHash,bytes32 fallbackPolicyHash,bytes32 disruptionPolicyHash,bytes32 dataRightsHash,bytes32 evidenceHash,uint256 chainId)"
    );

    /// @dev The version commitment binds the lineage identity, the sequence number, and the chain to
    /// the definition, so a stored record can never be replayed as a different version of itself, as
    /// a version of a different benchmark, or as the same version on another chain.
    string internal constant BENCHMARK_VERSION_TYPESTRING =
        "SetrynBenchmarkVersionV1(bytes32 benchmarkId,uint32 version,bytes32 definitionHash,uint256 chainId)";
    bytes32 internal constant BENCHMARK_VERSION_TYPEHASH = keccak256(
        "SetrynBenchmarkVersionV1(bytes32 benchmarkId,uint32 version,bytes32 definitionHash,uint256 chainId)"
    );

    /// @dev Checks only what the definition can be judged on by itself. Dependency existence,
    /// adapter kind and commitment compatibility, and the session-to-calendar agreement belong to
    /// the registry, which owns the external reads.
    ///
    /// @dev Every identifier, every version number, and every commitment hash must be nonzero, and
    /// the two legs of the pair must be different assets, so a benchmark can never quote an asset
    /// against itself or commit to a dependency lineage without naming a version of it.
    function validate(BenchmarkDefinition memory definition) internal pure {
        if (definition.namespaceId == bytes32(0)) {
            revert ZeroBenchmarkNamespaceId();
        }
        if (definition.referenceId == bytes32(0)) {
            revert ZeroBenchmarkReferenceId();
        }
        if (BenchmarkKindId.unwrap(definition.kindId) == bytes32(0)) {
            revert ZeroBenchmarkKindId();
        }
        if (AssetId.unwrap(definition.baseAssetId) == bytes32(0)) {
            revert ZeroBenchmarkBaseAssetId();
        }
        if (AssetId.unwrap(definition.quoteAssetId) == bytes32(0)) {
            revert ZeroBenchmarkQuoteAssetId();
        }
        if (AssetId.unwrap(definition.baseAssetId) == AssetId.unwrap(definition.quoteAssetId)) {
            revert IdenticalBenchmarkAssets(definition.baseAssetId);
        }
        if (AdapterId.unwrap(definition.adapterId) == bytes32(0)) {
            revert ZeroBenchmarkAdapterId();
        }
        if (definition.adapterVersion == 0) {
            revert ZeroBenchmarkAdapterVersion();
        }
        if (CalendarId.unwrap(definition.calendarId) == bytes32(0)) {
            revert ZeroBenchmarkCalendarId();
        }
        if (definition.calendarVersion == 0) {
            revert ZeroBenchmarkCalendarVersion();
        }
        if (SessionId.unwrap(definition.sessionId) == bytes32(0)) {
            revert ZeroBenchmarkSessionId();
        }
        if (definition.sessionVersion == 0) {
            revert ZeroBenchmarkSessionVersion();
        }
        if (definition.feedKey == bytes32(0)) {
            revert ZeroBenchmarkFeedKey();
        }
        if (definition.requiredInterfaceHash == bytes32(0)) {
            revert ZeroBenchmarkRequiredInterfaceHash();
        }
        if (definition.requiredCapabilityHash == bytes32(0)) {
            revert ZeroBenchmarkRequiredCapabilityHash();
        }
        _validateBounds(definition);
        _validateCommitments(definition);
    }

    /// @dev Hashes the identity key alone, so re-qualifying a reference against a different adapter,
    /// calendar, session, validity bound, or policy can never mint a second identity for the same
    /// namespaced reference, kind, and asset pair.
    function hashKey(BenchmarkDefinition memory definition) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                BENCHMARK_KEY_TYPEHASH,
                definition.namespaceId,
                definition.referenceId,
                BenchmarkKindId.unwrap(definition.kindId),
                AssetId.unwrap(definition.baseAssetId),
                AssetId.unwrap(definition.quoteAssetId)
            )
        );
    }

    /// @dev Hashes every field plus the chain, so two qualifications of one lineage that would have
    /// disagreed on any dependency version, feed, validity bound, policy, or review evidence are
    /// distinct.
    ///
    /// @dev The encoding is split across two abi.encode calls purely to keep the twenty-four values
    /// off one stack frame. Every field is a static type, so the concatenation is byte-identical to
    /// the single ABI encoding the typestring describes, which `hashDefinitionUnsplit` proves.
    function hashDefinition(BenchmarkDefinition memory definition, uint256 chainId) internal pure returns (bytes32) {
        return keccak256(
            bytes.concat(
                abi.encode(
                    BENCHMARK_DEFINITION_TYPEHASH,
                    definition.namespaceId,
                    definition.referenceId,
                    BenchmarkKindId.unwrap(definition.kindId),
                    AssetId.unwrap(definition.baseAssetId),
                    AssetId.unwrap(definition.quoteAssetId),
                    AdapterId.unwrap(definition.adapterId),
                    definition.adapterVersion,
                    CalendarId.unwrap(definition.calendarId),
                    definition.calendarVersion,
                    SessionId.unwrap(definition.sessionId),
                    definition.sessionVersion,
                    definition.feedKey
                ),
                abi.encode(
                    definition.requiredInterfaceHash,
                    definition.requiredCapabilityHash,
                    definition.outputDecimals,
                    definition.maxStalenessSeconds,
                    definition.maxFutureSkewSeconds,
                    definition.maxConfidenceBps,
                    definition.observationRuleHash,
                    definition.fallbackPolicyHash,
                    definition.disruptionPolicyHash,
                    definition.dataRightsHash,
                    definition.evidenceHash,
                    chainId
                )
            )
        );
    }

    /// @dev The same commitment expressed as one ABI encoding of the whole tuple. It exists so a
    /// test can prove the split encoding above is not a different commitment, and it is never used
    /// on a write path.
    function hashDefinitionUnsplit(BenchmarkDefinition memory definition, uint256 chainId)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(bytes.concat(abi.encode(BENCHMARK_DEFINITION_TYPEHASH, definition), abi.encode(chainId)));
    }

    function hashVersion(BenchmarkId benchmarkId, uint32 version, bytes32 definitionHash, uint256 chainId)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(BENCHMARK_VERSION_TYPEHASH, BenchmarkId.unwrap(benchmarkId), version, definitionHash, chainId)
        );
    }

    function deriveBenchmarkId(BenchmarkDefinition memory definition) internal pure returns (BenchmarkId) {
        return IdLib.deriveBenchmarkId(hashKey(definition));
    }

    /// @dev maxFutureSkewSeconds is deliberately allowed to be zero: a venue whose observations are
    /// never stamped ahead of the chain clock has no legitimate skew tolerance to grant.
    function _validateBounds(BenchmarkDefinition memory definition) private pure {
        if (definition.outputDecimals > MAX_DECIMALS) {
            revert BenchmarkDecimalsOutOfRange(definition.outputDecimals);
        }
        if (definition.maxStalenessSeconds == 0) {
            revert ZeroBenchmarkMaxStalenessSeconds();
        }
        if (uint256(definition.maxConfidenceBps) > BPS_DENOMINATOR) {
            revert BenchmarkConfidenceOutOfRange(definition.maxConfidenceBps);
        }
    }

    function _validateCommitments(BenchmarkDefinition memory definition) private pure {
        if (definition.observationRuleHash == bytes32(0)) {
            revert ZeroBenchmarkObservationRuleHash();
        }
        if (definition.fallbackPolicyHash == bytes32(0)) {
            revert ZeroBenchmarkFallbackPolicyHash();
        }
        if (definition.disruptionPolicyHash == bytes32(0)) {
            revert ZeroBenchmarkDisruptionPolicyHash();
        }
        if (definition.dataRightsHash == bytes32(0)) {
            revert ZeroBenchmarkDataRightsHash();
        }
        if (definition.evidenceHash == bytes32(0)) {
            revert ZeroBenchmarkEvidenceHash();
        }
    }
}
