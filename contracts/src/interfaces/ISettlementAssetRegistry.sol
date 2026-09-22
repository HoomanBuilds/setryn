// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IAssetRegistry} from "./IAssetRegistry.sol";
import {RegistryStatus} from "../types/Enums.sol";
import {AssetId} from "../types/Identifiers.sol";
import {SettlementAssetBinding, SettlementAssetDefinition} from "../types/SettlementAssetDefinition.sol";

/// @dev The chain-local settlement asset registry. It qualifies which ERC-20 contract a canonical
/// AssetId settles against on this chain, assigns an immutable version per qualification, and gates
/// new risk. It holds no funds, never calls transfer or approve, and never delegatecalls.
interface ISettlementAssetRegistry {
    /// @dev Carries every field of the version so an indexer can rebuild the complete binding set
    /// from logs alone. The registry keeps no enumerable array; these events are the enumeration
    /// source.
    event SettlementAssetRegistered(
        AssetId indexed assetId,
        uint32 indexed version,
        bytes32 indexed versionHash,
        bytes32 definitionHash,
        address token,
        bytes32 expectedRuntimeCodeHash,
        uint8 decimals,
        bytes32 qualificationHash,
        uint256 chainId,
        address operator
    );

    event SettlementAssetStatusChanged(
        AssetId indexed assetId,
        uint32 indexed version,
        RegistryStatus previousStatus,
        RegistryStatus newStatus,
        address indexed operator
    );

    /// @dev Emitted whenever the single active pointer for an asset moves, including when it is
    /// cleared to zero. Zero is the no-active-version sentinel, because versions start at one.
    event SettlementAssetActiveVersionChanged(
        AssetId indexed assetId, uint32 previousVersion, uint32 newVersion, address indexed operator
    );

    error ZeroInitialAdmin();

    error ZeroAssetRegistry();

    error AssetRegistryHasNoCode(address assetRegistry);

    error UnknownCanonicalAsset(AssetId assetId);

    error CanonicalDecimalsOutOfRange(AssetId assetId, uint8 decimals, uint8 maxDecimals);

    error TokenDecimalsUnavailable(address token);

    error TokenDecimalsMalformed(address token, uint256 reportedDecimals);

    error TokenDecimalsMismatch(address token, uint8 canonicalDecimals, uint8 reportedDecimals);

    error TokenBoundToDifferentAsset(address token, AssetId boundAssetId, AssetId submittedAssetId);

    error DuplicateSettlementDefinition(AssetId assetId, bytes32 definitionHash, uint32 existingVersion);

    /// @dev Raised instead of an arithmetic panic when an asset has already consumed every uint32
    /// version. Unreachable in practice, but a named error keeps the exhausted case a stated
    /// protocol outcome rather than an opaque Panic(0x11).
    error VersionExhausted(AssetId assetId);

    error UnknownBinding(AssetId assetId, uint32 version);

    error InvalidBindingTransition(
        AssetId assetId, uint32 version, RegistryStatus previousStatus, RegistryStatus newStatus
    );

    error AnotherVersionActive(AssetId assetId, uint32 activeVersion);

    error CanonicalAssetNotActive(AssetId assetId, RegistryStatus status);

    function registerBinding(SettlementAssetDefinition calldata definition) external returns (uint32 version);

    /// @dev Every mutation reverts UnknownBinding for a version that was never registered. A
    /// mutation must never treat an absent record as a Paused one and quietly create it.
    function activateBinding(AssetId assetId, uint32 version) external;

    function pauseBinding(AssetId assetId, uint32 version) external;

    function deprecateBinding(AssetId assetId, uint32 version) external;

    function assetRegistry() external view returns (IAssetRegistry);

    /// @dev The one read that reverts UnknownBinding rather than answering with a sentinel, because
    /// a zeroed SettlementAssetBinding is indistinguishable from a real one that a caller could act
    /// on. Callers that want a total function must gate on isLifecycleEnabled first.
    function getBinding(AssetId assetId, uint32 version) external view returns (SettlementAssetBinding memory binding);

    /// @dev Zero means no version was ever registered for the asset. Versions start at one.
    function latestVersion(AssetId assetId) external view returns (uint32);

    /// @dev Zero means no version is active right now, whether because none was ever registered or
    /// because the active one was paused or deprecated.
    function activeVersion(AssetId assetId) external view returns (uint32);

    /// @dev RegistryStatus.Unspecified is the never-registered sentinel. It is not a reachable
    /// stored state, so it is an unambiguous answer for an unknown version.
    function statusOf(AssetId assetId, uint32 version) external view returns (RegistryStatus);

    function bindingCount() external view returns (uint256);

    /// @dev The zero AssetId means the token is bound to no canonical asset on this chain.
    function tokenAsset(address token) external view returns (AssetId);

    /// @dev Non-reverting operational monitoring signal. It answers whether the token still carries
    /// the qualified runtime bytecode and still reports the snapshotted decimals, nothing more. An
    /// unknown version answers false rather than reverting, so a monitor can poll blind.
    function runtimeMatches(AssetId assetId, uint32 version) external view returns (bool);

    /// @dev The only gate a consumer may use to accept new collateral or open new risk. False for
    /// an unknown version.
    function isOpenForNewRisk(AssetId assetId, uint32 version) external view returns (bool);

    /// @dev Historical resolvability. True for every registered version, including Paused and
    /// Deprecated ones. A vault must never require Active status to withdraw an already credited
    /// balance, otherwise pausing an asset would strand user funds. This says the binding resolves,
    /// not that a transfer will succeed. False for an unknown version.
    function isLifecycleEnabled(AssetId assetId, uint32 version) external view returns (bool);
}
