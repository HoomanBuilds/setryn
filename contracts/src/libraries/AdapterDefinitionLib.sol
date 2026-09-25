// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {AdapterDefinition} from "../types/AdapterDefinition.sol";
import {AdapterId, AdapterKindId} from "../types/Identifiers.sol";
import {IdLib} from "./IdLib.sol";

error ZeroAdapterNamespaceId();

error ZeroAdapterReferenceId();

error ZeroAdapterKindId();

error ZeroAdapterImplementation();

error AdapterImplementationHasNoCode(address implementation);

error ZeroAdapterRuntimeCodeHash();

error ZeroAdapterInterfaceHash();

error ZeroAdapterCapabilityHash();

error ZeroAdapterConfigurationSchemaHash();

error ZeroAdapterEvidenceHash();

error AdapterRuntimeCodeHashMismatch(address implementation, bytes32 expectedCodeHash, bytes32 actualCodeHash);

library AdapterDefinitionLib {
    /// @dev Published tags for the kinds V1 consumers are expected to meet first. They are
    /// convenience constants only. Registration and hashing accept any nonzero AdapterKindId, so a
    /// kind invented after this deployment needs no change here, and a consumer must still require
    /// the exact kind and capabilities it supports instead of assuming this list is exhaustive.
    AdapterKindId internal constant ADAPTER_KIND_BENCHMARK =
        AdapterKindId.wrap(keccak256("SetrynAdapterKindV1:Benchmark"));
    AdapterKindId internal constant ADAPTER_KIND_VENUE = AdapterKindId.wrap(keccak256("SetrynAdapterKindV1:Venue"));
    AdapterKindId internal constant ADAPTER_KIND_SETTLEMENT =
        AdapterKindId.wrap(keccak256("SetrynAdapterKindV1:Settlement"));
    AdapterKindId internal constant ADAPTER_KIND_DELIVERY =
        AdapterKindId.wrap(keccak256("SetrynAdapterKindV1:Delivery"));
    AdapterKindId internal constant ADAPTER_KIND_CURVE = AdapterKindId.wrap(keccak256("SetrynAdapterKindV1:Curve"));
    AdapterKindId internal constant ADAPTER_KIND_RISK = AdapterKindId.wrap(keccak256("SetrynAdapterKindV1:Risk"));
    AdapterKindId internal constant ADAPTER_KIND_PRIVACY = AdapterKindId.wrap(keccak256("SetrynAdapterKindV1:Privacy"));
    AdapterKindId internal constant ADAPTER_KIND_PAYOFF = AdapterKindId.wrap(keccak256("SetrynAdapterKindV1:Payoff"));

    /// @dev The typestring is kept beside the typehash so a test can prove they agree. Solidity
    /// cannot hash a string constant inside another constant initializer, so the literal is repeated
    /// rather than referenced.
    ///
    /// @dev Each literal carries its version. A hashing rule may never be edited in place; it is
    /// replaced by a new V2 literal, so previously derived hashes can never silently re-derive.
    ///
    /// @dev The identity key commits namespaceId, referenceId, and kindId alone, so a replacement
    /// implementation, a newer interface revision, or a deployment on another chain stays the same
    /// AdapterId under a new chain-local version. kindId belongs in the key because an adapter that
    /// changes capability category is a different logical adapter, not a new version of the old one.
    string internal constant ADAPTER_KEY_TYPESTRING =
        "SetrynAdapterKeyV1(bytes32 namespaceId,bytes32 referenceId,bytes32 kindId)";
    bytes32 internal constant ADAPTER_KEY_TYPEHASH =
        keccak256("SetrynAdapterKeyV1(bytes32 namespaceId,bytes32 referenceId,bytes32 kindId)");

    /// @dev chainId is hashed in deliberately, the opposite of canonical identity. The same
    /// implementation address on two chains is two different contracts, so the two qualifications
    /// must never share one commitment.
    string internal constant ADAPTER_DEFINITION_TYPESTRING =
        "SetrynAdapterDefinitionV1(bytes32 namespaceId,bytes32 referenceId,bytes32 kindId,address implementation,bytes32 expectedRuntimeCodeHash,bytes32 interfaceHash,bytes32 capabilityHash,bytes32 configurationSchemaHash,bytes32 evidenceHash,uint256 chainId)";
    bytes32 internal constant ADAPTER_DEFINITION_TYPEHASH = keccak256(
        "SetrynAdapterDefinitionV1(bytes32 namespaceId,bytes32 referenceId,bytes32 kindId,address implementation,bytes32 expectedRuntimeCodeHash,bytes32 interfaceHash,bytes32 capabilityHash,bytes32 configurationSchemaHash,bytes32 evidenceHash,uint256 chainId)"
    );

    /// @dev The version commitment binds the lineage identity, the sequence number, and the chain to
    /// the definition, so a stored record can never be replayed as a different version of itself, as
    /// a version of a different adapter, or as the same version on another chain.
    string internal constant ADAPTER_VERSION_TYPESTRING =
        "SetrynAdapterVersionV1(bytes32 adapterId,uint32 version,bytes32 definitionHash,uint256 chainId)";
    bytes32 internal constant ADAPTER_VERSION_TYPEHASH =
        keccak256("SetrynAdapterVersionV1(bytes32 adapterId,uint32 version,bytes32 definitionHash,uint256 chainId)");

    /// @dev Every bytes32 field and the kind must be nonzero, and the implementation must be a
    /// nonzero address that currently holds code whose hash is exactly the declared one. The library
    /// never calls, staticcalls, or delegatecalls the implementation and never probes it for an
    /// interface: it qualifies identity and bytecode, never behavior.
    function validate(AdapterDefinition memory definition) internal view {
        if (definition.namespaceId == bytes32(0)) {
            revert ZeroAdapterNamespaceId();
        }
        if (definition.referenceId == bytes32(0)) {
            revert ZeroAdapterReferenceId();
        }
        if (AdapterKindId.unwrap(definition.kindId) == bytes32(0)) {
            revert ZeroAdapterKindId();
        }
        if (definition.implementation == address(0)) {
            revert ZeroAdapterImplementation();
        }
        if (definition.expectedRuntimeCodeHash == bytes32(0)) {
            revert ZeroAdapterRuntimeCodeHash();
        }
        if (definition.interfaceHash == bytes32(0)) {
            revert ZeroAdapterInterfaceHash();
        }
        if (definition.capabilityHash == bytes32(0)) {
            revert ZeroAdapterCapabilityHash();
        }
        if (definition.configurationSchemaHash == bytes32(0)) {
            revert ZeroAdapterConfigurationSchemaHash();
        }
        if (definition.evidenceHash == bytes32(0)) {
            revert ZeroAdapterEvidenceHash();
        }
        requireLiveRuntime(definition.implementation, definition.expectedRuntimeCodeHash);
    }

    /// @dev The no-code case is named separately from the mismatch case even though an account
    /// without code also fails the hash comparison, because "never deployed or self-destructed" and
    /// "deployed but not the reviewed bytecode" are different operational findings.
    function requireLiveRuntime(address implementation, bytes32 expectedCodeHash) internal view {
        if (implementation.code.length == 0) {
            revert AdapterImplementationHasNoCode(implementation);
        }
        bytes32 actualCodeHash = implementation.codehash;
        if (actualCodeHash != expectedCodeHash) {
            revert AdapterRuntimeCodeHashMismatch(implementation, expectedCodeHash, actualCodeHash);
        }
    }

    function runtimeMatches(address implementation, bytes32 expectedCodeHash) internal view returns (bool) {
        return implementation.code.length != 0 && implementation.codehash == expectedCodeHash;
    }

    /// @dev Hashes the identity key alone, so a replacement implementation, a re-qualification, or a
    /// deployment on another chain can never mint a second identity for the same namespaced
    /// reference and kind.
    function hashKey(AdapterDefinition memory definition) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                ADAPTER_KEY_TYPEHASH,
                definition.namespaceId,
                definition.referenceId,
                AdapterKindId.unwrap(definition.kindId)
            )
        );
    }

    /// @dev Hashes every field plus the chain, so two qualifications of one lineage that would have
    /// disagreed on implementation, bytecode, interface, capabilities, configuration shape, review
    /// evidence, or chain are distinct.
    function hashDefinition(AdapterDefinition memory definition, uint256 chainId) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                ADAPTER_DEFINITION_TYPEHASH,
                definition.namespaceId,
                definition.referenceId,
                AdapterKindId.unwrap(definition.kindId),
                definition.implementation,
                definition.expectedRuntimeCodeHash,
                definition.interfaceHash,
                definition.capabilityHash,
                definition.configurationSchemaHash,
                definition.evidenceHash,
                chainId
            )
        );
    }

    function hashVersion(AdapterId adapterId, uint32 version, bytes32 definitionHash, uint256 chainId)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(ADAPTER_VERSION_TYPEHASH, AdapterId.unwrap(adapterId), version, definitionHash, chainId)
        );
    }

    function deriveAdapterId(AdapterDefinition memory definition) internal pure returns (AdapterId) {
        return IdLib.deriveAdapterId(hashKey(definition));
    }
}
