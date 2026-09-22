// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {AdapterDefinition, AdapterVersion} from "../types/AdapterDefinition.sol";
import {RegistryStatus} from "../types/Enums.sol";
import {AdapterId} from "../types/Identifiers.sol";

/// @dev The chain-local adapter registry. It qualifies which deployed implementation on this chain
/// stands behind a stable, chain-portable AdapterId, assigns an immutable version per qualification,
/// and gates which version may take new risk. Core modules depend on this interface plus an
/// AdapterId and version, never on a vendor name or a concrete implementation type.
///
/// @dev The registry holds no funds, grants no approvals, and never calls, staticcalls,
/// delegatecalls, or interface-probes an implementation. Its only introspection of an
/// implementation is `extcodesize` and `extcodehash`. It qualifies identity and bytecode; it never
/// executes adapter behavior. Calling an adapter is the job of the consuming module.
///
/// @dev A runtime code hash attests the bytecode at the implementation address, which behind a proxy
/// is the proxy bytecode alone. `evidenceHash` is where the implementation slot, the upgrade
/// authority, the admin controls, the external dependencies, and the configuration must be covered.
/// Detecting a swapped implementation behind an unchanged proxy is the job of a future monitor, not
/// of this contract.
///
/// @dev The kind space is open. Any nonzero AdapterKindId is accepted, so a capability category
/// invented after this deployment needs no change here. A consumer must require the exact kind and
/// capability commitment it supports and fail closed on every other combination.
interface IAdapterRegistry {
    /// @dev Carries every definition field of the version so an indexer can rebuild the complete
    /// adapter set from logs alone. The registry keeps no enumerable array; these events are the
    /// enumeration source.
    ///
    /// @dev The definition rides as a whole tuple rather than as nine flattened parameters, because
    /// flattening them alongside the commitments exhausts the EVM stack at the emit site. The ABI
    /// encoding carries exactly the same nine fields either way.
    ///
    /// @dev chainId is logged because qualification is chain-local, and initialStatus is logged
    /// rather than assumed so an indexer never has to hardcode the registration landing state.
    event AdapterRegistered(
        AdapterId indexed adapterId,
        uint32 indexed version,
        bytes32 indexed versionHash,
        bytes32 definitionHash,
        AdapterDefinition definition,
        uint256 chainId,
        RegistryStatus initialStatus,
        address operator
    );

    event AdapterStatusChanged(
        AdapterId indexed adapterId,
        uint32 indexed version,
        RegistryStatus previousStatus,
        RegistryStatus newStatus,
        address indexed operator
    );

    /// @dev Emitted whenever the single active pointer for an adapter moves, including when it is
    /// cleared to zero. Zero is the no-active-version sentinel, because versions start at one.
    event AdapterActiveVersionChanged(
        AdapterId indexed adapterId, uint32 previousVersion, uint32 newVersion, address indexed operator
    );

    error ZeroInitialAdmin();

    error DuplicateAdapterDefinition(AdapterId adapterId, bytes32 definitionHash, uint32 existingVersion);

    /// @dev Raised instead of an arithmetic panic when an adapter has already consumed every uint32
    /// version. Unreachable in practice, but a named error keeps the exhausted case a stated
    /// protocol outcome rather than an opaque Panic(0x11).
    error AdapterVersionExhausted(AdapterId adapterId);

    error UnknownAdapterVersion(AdapterId adapterId, uint32 version);

    error InvalidAdapterTransition(
        AdapterId adapterId, uint32 version, RegistryStatus previousStatus, RegistryStatus newStatus
    );

    error AnotherAdapterVersionActive(AdapterId adapterId, uint32 activeVersion);

    /// @dev Registration lands the version in Paused, so the qualifier who proposes an
    /// implementation is never the party that opens new risk against it. It proves the declared
    /// bytecode is live at the declared address right now, which is evidence, never authorization.
    function registerAdapter(AdapterDefinition calldata definition)
        external
        returns (AdapterId adapterId, uint32 version);

    /// @dev Every mutation reverts UnknownAdapterVersion for a version that was never registered. A
    /// mutation must never treat an absent record as a Paused one and quietly create it.
    ///
    /// @dev Activation revalidates that the implementation still holds code and that its runtime
    /// code hash still equals the qualified one, because the address may have been redeployed or
    /// destroyed since registration. It fails closed rather than activating on stale evidence.
    function activateAdapter(AdapterId adapterId, uint32 version) external;

    function pauseAdapter(AdapterId adapterId, uint32 version) external;

    function deprecateAdapter(AdapterId adapterId, uint32 version) external;

    /// @dev The one read that reverts UnknownAdapterVersion rather than answering with a sentinel,
    /// because a zeroed AdapterVersion names the zero implementation and would read as a usable
    /// record. Callers that want a total function gate on isLifecycleEnabled.
    function getAdapter(AdapterId adapterId, uint32 version) external view returns (AdapterVersion memory record);

    /// @dev Zero means no version was ever registered for the adapter. Versions start at one.
    function latestVersion(AdapterId adapterId) external view returns (uint32);

    /// @dev Zero means no version is active right now, whether because none was ever registered or
    /// because the active one was paused or deprecated.
    function activeVersion(AdapterId adapterId) external view returns (uint32);

    /// @dev RegistryStatus.Unspecified is the never-registered sentinel. It is not a reachable
    /// stored state, so it is an unambiguous answer for an unknown version.
    function statusOf(AdapterId adapterId, uint32 version) external view returns (RegistryStatus);

    /// @dev Counts immutable versions, not unique adapter lineages. Two versions of one adapter
    /// count as two.
    function adapterCount() external view returns (uint256);

    function exists(AdapterId adapterId, uint32 version) external view returns (bool);

    /// @dev Monitoring only: whether the implementation still holds code whose hash equals the one
    /// this version was qualified against. It is never permission, and it never proves anything
    /// about the implementation behind a proxy. False for an unknown version.
    function runtimeMatches(AdapterId adapterId, uint32 version) external view returns (bool);

    /// @dev The only gate a consumer may use to route new risk through an adapter. True only when
    /// the version is the active pointer, its status is Active, and the live runtime code hash still
    /// matches. It does not say that the adapter supports the caller's kind or capabilities: the
    /// caller must read the definition and require its exact kindId, interfaceHash, and
    /// capabilityHash, failing closed on every other combination. False for an unknown version.
    function isOpenForNewRisk(AdapterId adapterId, uint32 version) external view returns (bool);

    /// @dev Historical resolvability. True for every registered version, including Paused and
    /// Deprecated ones, and regardless of the current runtime code hash. Settlement, fixing,
    /// unwind, receipt replay, and audit of positions already opened through a retired adapter must
    /// never require current Active status. False for an unknown version.
    function isLifecycleEnabled(AdapterId adapterId, uint32 version) external view returns (bool);

    /// @dev The stable chain-portable lineage identity of a definition, derived from the V1 key of
    /// namespaceId, referenceId, and kindId alone. Exposed so a deployer or a consuming module can
    /// compute the identity it intends to depend on without having registered anything.
    function deriveAdapterId(AdapterDefinition calldata definition) external pure returns (AdapterId);
}
