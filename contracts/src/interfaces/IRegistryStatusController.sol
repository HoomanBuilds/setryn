// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

/// @notice Scope-restricted holder of every registry's combined status-manager role.
/// @dev Registries expose activation, pause, and deprecation behind one status role. The controller holds that role
/// and splits it by exact selector: the guardian reaches only pause selectors, governance only activate (which also
/// resumes a paused version) and deprecate selectors. Emergency pause and activation never share a callable path.
interface IRegistryStatusController {
    /// @dev Each kind fixes exactly one pause selector and one activate and one deprecate selector, taken from the
    /// registry interface. Numeric values are part of the event encoding and are append-only.
    enum RegistryKind {
        Unspecified,
        Asset,
        Adapter,
        Calendar,
        Session,
        SettlementAsset,
        Benchmark,
        FeeSchedule,
        RiskDomain,
        Instrument,
        Market,
        Series,
        Package,
        PrivacyPolicy
    }

    /// @dev `Pause` is reachable only by the guardian through `pause`; `Govern` only by governance through `govern`.
    enum StatusCallClass {
        Unspecified,
        Pause,
        Govern
    }

    struct RegistryBinding {
        RegistryKind kind;
        address registry;
    }

    event StatusPrincipalsBound(address indexed guardian, address indexed governance);
    event StatusSelectorBound(
        address indexed registry, bytes4 indexed selector, RegistryKind kind, StatusCallClass callClass
    );
    event StatusCallForwarded(
        address indexed registry,
        bytes4 indexed selector,
        address indexed caller,
        StatusCallClass callClass,
        bytes32 callDataHash
    );

    error InvalidStatusPrincipal(address principal);
    error EmptyStatusRegistrySet();
    error InvalidStatusRegistry(address registry, RegistryKind kind);
    error DuplicateStatusRegistry(address registry);
    error StatusCallerUnauthorized(address caller, StatusCallClass callClass);
    error MalformedStatusCall(uint256 length);
    error UnknownStatusCall(address registry, bytes4 selector);
    error StatusCallClassMismatch(
        address registry, bytes4 selector, StatusCallClass requiredClass, StatusCallClass boundClass
    );

    function guardian() external view returns (address);

    function governance() external view returns (address);

    /// @notice Guardian-only: forwards `data` to `registry` when its selector is a bound pause selector.
    function pause(address registry, bytes calldata data) external returns (bytes memory result);

    /// @notice Governance-only: forwards `data` to `registry` when its selector is a bound activate or deprecate
    /// selector. Activating a paused version is the resume path.
    function govern(address registry, bytes calldata data) external returns (bytes memory result);

    function statusCallClass(address registry, bytes4 selector) external view returns (StatusCallClass);

    function registryKind(address registry) external view returns (RegistryKind);

    function registries() external view returns (RegistryBinding[] memory);
}
