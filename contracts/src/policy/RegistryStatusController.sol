// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IAdapterRegistry} from "../interfaces/IAdapterRegistry.sol";
import {IAssetRegistry} from "../interfaces/IAssetRegistry.sol";
import {IBenchmarkRegistry} from "../interfaces/IBenchmarkRegistry.sol";
import {ICalendarRegistry} from "../interfaces/ICalendarRegistry.sol";
import {IFeeScheduleRegistry} from "../interfaces/IFeeScheduleRegistry.sol";
import {IInstrumentRegistry} from "../interfaces/IInstrumentRegistry.sol";
import {IMarketRegistry} from "../interfaces/IMarketRegistry.sol";
import {IPackageRegistry} from "../interfaces/IPackageRegistry.sol";
import {IPrivacyCommitmentRegistry} from "../interfaces/IPrivacyCommitmentRegistry.sol";
import {IRegistryStatusController} from "../interfaces/IRegistryStatusController.sol";
import {IRiskDomainRegistry} from "../interfaces/IRiskDomainRegistry.sol";
import {ISeriesRegistry} from "../interfaces/ISeriesRegistry.sol";
import {ISessionRegistry} from "../interfaces/ISessionRegistry.sol";
import {ISettlementAssetRegistry} from "../interfaces/ISettlementAssetRegistry.sol";

/// @notice Policy controller that holds each registry's combined status-manager role and splits it by selector.
/// @dev Non-upgradeable and without an admin. The guardian and governance principals and the exact selector table are
/// fixed at construction; the table is derived from the registry interfaces for each declared registry kind, so the
/// guardian's reach is readable from this bytecode alone. An unknown registry or selector reverts. Rotating a
/// principal or adding a registry is a new deployment plus a timelocked role grant.
contract RegistryStatusController is IRegistryStatusController {
    address public immutable guardian;
    address public immutable governance;

    RegistryBinding[] private _registries;
    mapping(address registry => RegistryKind kind) private _kinds;
    mapping(address registry => mapping(bytes4 selector => StatusCallClass callClass)) private _classes;

    constructor(address guardian_, address governance_, RegistryBinding[] memory bindings) {
        if (guardian_ == address(0)) revert InvalidStatusPrincipal(guardian_);
        if (governance_ == address(0) || governance_ == guardian_) revert InvalidStatusPrincipal(governance_);
        if (bindings.length == 0) revert EmptyStatusRegistrySet();
        guardian = guardian_;
        governance = governance_;
        emit StatusPrincipalsBound(guardian_, governance_);

        for (uint256 index; index < bindings.length; ++index) {
            RegistryBinding memory binding = bindings[index];
            address registry = binding.registry;
            if (
                binding.kind == RegistryKind.Unspecified || registry.code.length == 0 || registry == guardian_
                    || registry == governance_
            ) revert InvalidStatusRegistry(registry, binding.kind);
            if (_kinds[registry] != RegistryKind.Unspecified) revert DuplicateStatusRegistry(registry);
            _kinds[registry] = binding.kind;
            _registries.push(binding);

            (bytes4 pauseSelector, bytes4 activateSelector, bytes4 deprecateSelector) = _selectors(binding.kind);
            _bind(registry, pauseSelector, binding.kind, StatusCallClass.Pause);
            _bind(registry, activateSelector, binding.kind, StatusCallClass.Govern);
            _bind(registry, deprecateSelector, binding.kind, StatusCallClass.Govern);
        }
    }

    /// @inheritdoc IRegistryStatusController
    function pause(address registry, bytes calldata data) external returns (bytes memory result) {
        if (msg.sender != guardian) revert StatusCallerUnauthorized(msg.sender, StatusCallClass.Pause);
        return _forward(registry, data, StatusCallClass.Pause);
    }

    /// @inheritdoc IRegistryStatusController
    function govern(address registry, bytes calldata data) external returns (bytes memory result) {
        if (msg.sender != governance) revert StatusCallerUnauthorized(msg.sender, StatusCallClass.Govern);
        return _forward(registry, data, StatusCallClass.Govern);
    }

    function statusCallClass(address registry, bytes4 selector) external view returns (StatusCallClass) {
        return _classes[registry][selector];
    }

    function registryKind(address registry) external view returns (RegistryKind) {
        return _kinds[registry];
    }

    function registries() external view returns (RegistryBinding[] memory) {
        return _registries;
    }

    function _forward(address registry, bytes calldata data, StatusCallClass requiredClass)
        private
        returns (bytes memory result)
    {
        if (data.length < 4) revert MalformedStatusCall(data.length);
        bytes4 selector = bytes4(data[:4]);
        StatusCallClass boundClass = _classes[registry][selector];
        if (boundClass == StatusCallClass.Unspecified) revert UnknownStatusCall(registry, selector);
        if (boundClass != requiredClass) {
            revert StatusCallClassMismatch(registry, selector, requiredClass, boundClass);
        }

        bool success;
        (success, result) = registry.call(data);
        if (!success) {
            assembly ("memory-safe") {
                revert(add(result, 0x20), mload(result))
            }
        }
        emit StatusCallForwarded(registry, selector, msg.sender, boundClass, keccak256(data));
    }

    function _bind(address registry, bytes4 selector, RegistryKind kind, StatusCallClass callClass) private {
        _classes[registry][selector] = callClass;
        emit StatusSelectorBound(registry, selector, kind, callClass);
    }

    /// @dev The exact status selectors of each registry kind: one pause selector, then activate and deprecate.
    function _selectors(RegistryKind kind)
        private
        pure
        returns (bytes4 pauseSelector, bytes4 activateSelector, bytes4 deprecateSelector)
    {
        if (kind == RegistryKind.Asset) {
            return (
                IAssetRegistry.pauseAsset.selector,
                IAssetRegistry.activateAsset.selector,
                IAssetRegistry.deprecateAsset.selector
            );
        }
        if (kind == RegistryKind.Adapter) {
            return (
                IAdapterRegistry.pauseAdapter.selector,
                IAdapterRegistry.activateAdapter.selector,
                IAdapterRegistry.deprecateAdapter.selector
            );
        }
        if (kind == RegistryKind.Calendar) {
            return (
                ICalendarRegistry.pauseCalendar.selector,
                ICalendarRegistry.activateCalendar.selector,
                ICalendarRegistry.deprecateCalendar.selector
            );
        }
        if (kind == RegistryKind.Session) {
            return (
                ISessionRegistry.pauseSession.selector,
                ISessionRegistry.activateSession.selector,
                ISessionRegistry.deprecateSession.selector
            );
        }
        if (kind == RegistryKind.SettlementAsset) {
            return (
                ISettlementAssetRegistry.pauseBinding.selector,
                ISettlementAssetRegistry.activateBinding.selector,
                ISettlementAssetRegistry.deprecateBinding.selector
            );
        }
        if (kind == RegistryKind.Benchmark) {
            return (
                IBenchmarkRegistry.pauseBenchmark.selector,
                IBenchmarkRegistry.activateBenchmark.selector,
                IBenchmarkRegistry.deprecateBenchmark.selector
            );
        }
        if (kind == RegistryKind.FeeSchedule) {
            return (
                IFeeScheduleRegistry.pauseFeeSchedule.selector,
                IFeeScheduleRegistry.activateFeeSchedule.selector,
                IFeeScheduleRegistry.deprecateFeeSchedule.selector
            );
        }
        if (kind == RegistryKind.RiskDomain) {
            return (
                IRiskDomainRegistry.pauseRiskDomain.selector,
                IRiskDomainRegistry.activateRiskDomain.selector,
                IRiskDomainRegistry.deprecateRiskDomain.selector
            );
        }
        if (kind == RegistryKind.Instrument) {
            return (
                IInstrumentRegistry.pauseInstrument.selector,
                IInstrumentRegistry.activateInstrument.selector,
                IInstrumentRegistry.deprecateInstrument.selector
            );
        }
        if (kind == RegistryKind.Market) {
            return (
                IMarketRegistry.pauseMarket.selector,
                IMarketRegistry.activateMarket.selector,
                IMarketRegistry.deprecateMarket.selector
            );
        }
        if (kind == RegistryKind.Series) {
            return (
                ISeriesRegistry.pauseSeries.selector,
                ISeriesRegistry.activateSeries.selector,
                ISeriesRegistry.deprecateSeries.selector
            );
        }
        if (kind == RegistryKind.Package) {
            return (
                IPackageRegistry.pausePackage.selector,
                IPackageRegistry.activatePackage.selector,
                IPackageRegistry.deprecatePackage.selector
            );
        }
        return (
            IPrivacyCommitmentRegistry.pausePolicy.selector,
            IPrivacyCommitmentRegistry.activatePolicy.selector,
            IPrivacyCommitmentRegistry.deprecatePolicy.selector
        );
    }
}
