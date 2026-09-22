// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {RegistryStatus} from "../types/Enums.sol";
import {AdapterId, AdapterKindId, AssetId, RiskDomainId} from "../types/Identifiers.sol";
import {RiskDomainDefinition, RiskDomainVersion} from "../types/RiskDomainDefinition.sol";
import {IAdapterRegistry} from "./IAdapterRegistry.sol";
import {ISettlementAssetRegistry} from "./ISettlementAssetRegistry.sol";

/// @dev The canonical risk domain registry. It qualifies which immutable isolated clearing perimeter
/// a market may carry risk inside, binds that perimeter to the exact collateral binding it is
/// margined in and the exact risk adapter it was reviewed against, and gates which version may take
/// new risk right now.
///
/// @dev It clears nothing. There is no margin computation, no liquidation, no token transfer, no
/// approval, no balance, no value custody, no delegatecall, and no call into caller-supplied code
/// anywhere in this contract. A clearing engine and a risk engine consume these commitments later.
/// Its only external calls are view reads of its two immutable registry dependencies, and every one
/// of them completes before any storage write.
///
/// @dev The risk adapter is qualification evidence, never an implicit arbitrary call target. This
/// registry never calls an adapter implementation; it only compares the adapter's stored kind,
/// interface, and capability commitments against what the domain requires. A risk engine that does
/// call the implementation must itself require the exact riskModelId, interfaceHash, and
/// capabilityHash it implements and fail closed on every other combination.
///
/// @dev The model space is open. Any nonzero RiskModelId is accepted, so isolated margin, portfolio
/// margin, a scenario grid, and a model invented after this deployment all qualify through the same
/// path. This registry never branches on the value.
///
/// @dev The rule space is open and is not stored here at all. Which margin rules, which scenarios,
/// which concentration limits, which default waterfall, and which insurance policy a domain runs
/// under lives behind six commitment hashes that a risk engine proves concrete data against. That is
/// what lets a new rule, a new scenario, or a revised waterfall enter the protocol as a new domain
/// version rather than as a redeployment of this registry.
///
/// @dev Qualification is not solvency. The five caps are an outer monetary envelope in collateral
/// base units and nothing more. They do not prove the insurance fund is funded, that margin is
/// sufficient for the scenario set, that the default process terminates, or that the market behaves.
/// A clearing engine must compute and enforce actual margin, actual liability, and actual funding
/// against live state, and must never carry risk merely because this registry accepted the envelope.
///
/// @dev Reservations are an optional execution capability of a domain, not a universal one. A domain
/// whose maxAggregateReservationBaseUnits and maxAccountReservationBaseUnits are both zero has
/// reservation-backed quote modes disabled entirely, and a consumer asked for such a mode inside that
/// domain must fail closed rather than quote against an unreserved path. When both are nonzero, the
/// per-account envelope sits inside the whole-domain one and each sits inside the liability envelope
/// at its own scope.
interface IRiskDomainRegistry {
    /// @dev Carries every definition field of the version so an indexer can rebuild the complete
    /// risk domain set from logs alone. The registry keeps no enumerable array; these events are the
    /// enumeration source.
    ///
    /// @dev The definition rides as a whole tuple rather than as twenty-one flattened parameters,
    /// which keeps the emit site inside the EVM stack and matches the pattern the other registries
    /// use. The ABI encoding carries exactly the same twenty-one fields either way.
    ///
    /// @dev chainId is logged because qualification is chain-local, and initialStatus is logged
    /// rather than assumed so an indexer never has to hardcode the registration landing state.
    event RiskDomainRegistered(
        RiskDomainId indexed riskDomainId,
        uint32 indexed version,
        bytes32 indexed versionHash,
        bytes32 definitionHash,
        RiskDomainDefinition definition,
        uint256 chainId,
        RegistryStatus initialStatus,
        address operator
    );

    event RiskDomainStatusChanged(
        RiskDomainId indexed riskDomainId,
        uint32 indexed version,
        RegistryStatus previousStatus,
        RegistryStatus newStatus,
        address indexed operator
    );

    /// @dev Emitted whenever the single active pointer for a domain moves, including when it is
    /// cleared to zero. Zero is the no-active-version sentinel, because versions start at one.
    event RiskDomainActiveVersionChanged(
        RiskDomainId indexed riskDomainId, uint32 previousVersion, uint32 newVersion, address indexed operator
    );

    error ZeroInitialAdmin();

    error ZeroSettlementAssetRegistry();

    error SettlementAssetRegistryHasNoCode(address settlementAssetRegistry);

    error ZeroAdapterRegistry();

    error AdapterRegistryHasNoCode(address adapterRegistry);

    error DuplicateRiskDomainDefinition(RiskDomainId riskDomainId, bytes32 definitionHash, uint32 existingVersion);

    /// @dev Raised instead of an arithmetic panic when a domain has already consumed every uint32
    /// version. Unreachable in practice, but a named error keeps the exhausted case a stated
    /// protocol outcome rather than an opaque Panic(0x11).
    error RiskDomainVersionExhausted(RiskDomainId riskDomainId);

    error UnknownRiskDomainVersion(RiskDomainId riskDomainId, uint32 version);

    error InvalidRiskDomainTransition(
        RiskDomainId riskDomainId, uint32 version, RegistryStatus previousStatus, RegistryStatus newStatus
    );

    error AnotherRiskDomainVersionActive(RiskDomainId riskDomainId, uint32 activeVersion);

    /// @dev The exact collateral binding version named by the definition was never registered, so
    /// the base units every cap is denominated in do not resolve. A domain may never commit to
    /// collateral it cannot name, not even while it is only Paused.
    error UnknownCollateralDependency(AssetId collateralAssetId, uint32 collateralAssetVersion);

    error UnknownRiskAdapterDependency(AdapterId riskAdapterId, uint32 riskAdapterVersion);

    /// @dev The three compatibility failures are separate errors rather than one, because a domain
    /// pointed at the wrong capability category, at a different ABI revision, and at a different
    /// capability set are three different qualification mistakes. Each is exact equality: a superset
    /// is refused as firmly as an unrelated adapter, because an implementation that does more than
    /// was demanded was still reviewed against a different commitment.
    error RiskAdapterKindMismatch(
        AdapterId riskAdapterId, uint32 riskAdapterVersion, AdapterKindId required, AdapterKindId actual
    );

    error RiskAdapterInterfaceMismatch(
        AdapterId riskAdapterId, uint32 riskAdapterVersion, bytes32 required, bytes32 actual
    );

    error RiskAdapterCapabilityMismatch(
        AdapterId riskAdapterId, uint32 riskAdapterVersion, bytes32 required, bytes32 actual
    );

    /// @dev Activation is refused because the collateral binding is not currently open for new risk.
    /// Registration against a paused or deprecated binding stays legal, because it opens no risk.
    error CollateralDependencyNotOpen(AssetId collateralAssetId, uint32 collateralAssetVersion);

    error RiskAdapterDependencyNotOpen(AdapterId riskAdapterId, uint32 riskAdapterVersion);

    /// @dev The immutable chain-local source of qualified collateral tokens. Every cap in every
    /// domain is denominated in the base units of a binding resolved through it.
    function settlementAssetRegistry() external view returns (ISettlementAssetRegistry);

    /// @dev The immutable chain-local source of qualified risk adapters. It is read for evidence
    /// only: this registry compares stored commitments and never calls an implementation.
    function adapterRegistry() external view returns (IAdapterRegistry);

    /// @dev Registration lands the version in Paused, so the qualifier who proposes a risk policy is
    /// never the party that opens new risk against it. It proves the exact collateral binding and
    /// the exact adapter version exist and are historically resolvable, and that the adapter's kind,
    /// interface, and capability commitments are exactly what the domain requires, but deliberately
    /// does not require either dependency to be open: qualification grants no risk authority at all,
    /// and a risk policy is often published ahead of the dependencies it will be switched on
    /// against.
    function registerRiskDomain(RiskDomainDefinition calldata definition)
        external
        returns (RiskDomainId riskDomainId, uint32 version);

    /// @dev Every mutation reverts UnknownRiskDomainVersion for a version that was never registered.
    /// A mutation must never treat an absent record as a Paused one and quietly create it.
    ///
    /// @dev Activation revalidates existence and exact compatibility of both dependencies and
    /// additionally requires both to be open for new risk, so a domain can never be switched on
    /// against collateral that has since been paused or an adapter that has drifted from its
    /// qualified bytecode.
    function activateRiskDomain(RiskDomainId riskDomainId, uint32 version) external;

    function pauseRiskDomain(RiskDomainId riskDomainId, uint32 version) external;

    function deprecateRiskDomain(RiskDomainId riskDomainId, uint32 version) external;

    /// @dev The one read that reverts UnknownRiskDomainVersion rather than answering with a
    /// sentinel, because a zeroed RiskDomainVersion names the zero model and the zero collateral
    /// asset and would read as a usable uncapped domain. Callers that want a total function gate on
    /// isLifecycleEnabled.
    function getRiskDomain(RiskDomainId riskDomainId, uint32 version)
        external
        view
        returns (RiskDomainVersion memory record);

    /// @dev Zero means no version was ever registered for the domain. Versions start at one.
    function latestVersion(RiskDomainId riskDomainId) external view returns (uint32);

    /// @dev Zero means no version is active right now, whether because none was ever registered or
    /// because the active one was paused or deprecated.
    function activeVersion(RiskDomainId riskDomainId) external view returns (uint32);

    /// @dev RegistryStatus.Unspecified is the never-registered sentinel. It is not a reachable
    /// stored state, so it is an unambiguous answer for an unknown version.
    function statusOf(RiskDomainId riskDomainId, uint32 version) external view returns (RegistryStatus);

    /// @dev Counts immutable versions, not unique domain lineages. Two versions of one domain count
    /// as two.
    function riskDomainCount() external view returns (uint256);

    function exists(RiskDomainId riskDomainId, uint32 version) external view returns (bool);

    /// @dev The only gate a consumer may use to open new risk inside a domain. True only when the
    /// version is the active pointer, its status is Active, and both the exact collateral binding
    /// and the exact risk adapter are themselves open for new risk. False for an unknown version
    /// rather than a revert, so a router may probe blind.
    ///
    /// @dev It does not say that the domain is of the risk model the caller implements, nor that any
    /// particular margin rule or scenario is in force: the caller must read the definition, require
    /// its exact riskModelId and its exact adapter interface and capability commitments, resolve the
    /// rule and scenario commitments, and fail closed on everything else. It is also not a solvency
    /// statement: the caps it gates are ceilings, not funding.
    function isOpenForNewRisk(RiskDomainId riskDomainId, uint32 version) external view returns (bool);

    /// @dev Historical resolvability. True for every registered version, including Paused and
    /// Deprecated ones, and regardless of the current status of either dependency. Carrying an open
    /// position, running a default process, settling, recovering, replaying a receipt, and auditing
    /// under a retired domain must never require current Active status. False for an unknown
    /// version.
    function isLifecycleEnabled(RiskDomainId riskDomainId, uint32 version) external view returns (bool);

    /// @dev The stable chain-portable lineage identity of a definition, derived from the V1 key of
    /// namespaceId and domainKey alone. Exposed so a deployer or a consuming module can compute the
    /// identity it intends to depend on without having registered anything.
    function deriveRiskDomainId(RiskDomainDefinition calldata definition) external pure returns (RiskDomainId);
}
