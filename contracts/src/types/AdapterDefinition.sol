// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {RegistryStatus} from "./Enums.sol";
import {AdapterKindId} from "./Identifiers.sol";

/// @dev An adapter definition is a chain-local qualification of one deployed implementation behind a
/// stable, chain-portable adapter identity. Identity is the namespaceId, referenceId, and kindId
/// triple alone, so replacing the implementation, re-qualifying it against a newer interface
/// revision, or deploying the same logical adapter on another chain never mints a second lineage.
///
/// @dev implementation and expectedRuntimeCodeHash are deployment facts and are deliberately
/// chain-local: the same address on two chains is two different contracts. That is why the
/// definition commitment hashes block.chainid in, the opposite of canonical identity derivation.
///
/// @dev kindId is an open typed tag rather than an enum, so Benchmark, Venue, Settlement, Delivery,
/// Curve, Risk, Privacy, and any kind invented later all encode identically. One implementation
/// address may back several adapter identities and several kinds, because a multi-capability
/// implementation is a legitimate deployment, so address uniqueness is never enforced.
///
/// @dev The four commitment hashes are evidence anchors, never computation inputs, and every one of
/// them must be nonzero:
/// - interfaceHash commits the exact interface IDs and ABI revision the implementation was qualified
///   against, so an ABI change is a new version rather than a silent reinterpretation;
/// - capabilityHash commits the supported operations and their stated limitations, so a consumer can
///   require an exact capability set and fail closed on anything else;
/// - configurationSchemaHash commits the shape of the configuration that was validated;
/// - evidenceHash commits the broader review record, which must cover the proxy implementation slot,
///   upgrade authority, admin controls, external dependencies, and configuration, because a runtime
///   code hash attests the proxy bytecode alone.
struct AdapterDefinition {
    bytes32 namespaceId;
    bytes32 referenceId;
    AdapterKindId kindId;
    address implementation;
    bytes32 expectedRuntimeCodeHash;
    bytes32 interfaceHash;
    bytes32 capabilityHash;
    bytes32 configurationSchemaHash;
    bytes32 evidenceHash;
}

/// @dev One immutable chain-local version of an adapter lineage. Status is the only mutable field
/// and it gates future qualification only; a version is never edited and never deleted.
struct AdapterVersion {
    AdapterDefinition definition;
    bytes32 definitionHash;
    bytes32 versionHash;
    uint32 version;
    RegistryStatus status;
}
