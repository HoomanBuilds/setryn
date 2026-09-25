// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IFirmCapacityRiskRegistry, IFirmCapacityVault} from "../../src/interfaces/IFirmCapacityVault.sol";
import {IPrivateRfqValidationGate} from "../../src/interfaces/IPrivateRfqValidationGate.sol";
import {CollateralLock} from "../../src/types/CollateralTypes.sol";
import {LockStatus, RegistryStatus} from "../../src/types/Enums.sol";
import {AccountId, AssetId, CollateralId, CollateralLockId, RiskDomainId} from "../../src/types/Identifiers.sol";
import {PackageLeg} from "../../src/types/PackageDefinition.sol";
import {RiskDomainVersion} from "../../src/types/RiskDomainDefinition.sol";
import {MakerQuote, PrivateRfqRequest, RfqSelectionAuthorization} from "../../src/types/RfqTypes.sol";
import {Lots} from "../../src/types/Units.sol";

contract FirmCapacityRiskRegistryMock is IFirmCapacityRiskRegistry {
    RiskDomainVersion private _record;
    bool public open = true;

    function configure(
        AssetId assetId,
        uint32 bindingVersion,
        uint128 accountReservationCap,
        uint128 aggregateReservationCap
    ) external {
        _record.definition.collateralAssetId = assetId;
        _record.definition.collateralAssetVersion = bindingVersion;
        _record.definition.maxAccountReservationBaseUnits = accountReservationCap;
        _record.definition.maxAggregateReservationBaseUnits = aggregateReservationCap;
        _record.version = 1;
        _record.status = RegistryStatus.Active;
    }

    function setOpen(bool open_) external {
        open = open_;
    }

    function isOpenForNewRisk(RiskDomainId, uint32) external view returns (bool) {
        return open;
    }

    function getRiskDomain(RiskDomainId, uint32) external view returns (RiskDomainVersion memory record) {
        return _record;
    }
}

contract FirmCapacityVaultMock is IFirmCapacityVault {
    IFirmCapacityRiskRegistry private immutable _risks;
    mapping(CollateralLockId lockId => CollateralLock lock) private _locks;

    constructor(IFirmCapacityRiskRegistry risks_) {
        _risks = risks_;
    }

    function createLock(
        bytes32 lockReference,
        AccountId accountId,
        AssetId assetId,
        uint32 bindingVersion,
        uint128 amount,
        uint64 expiry,
        address settlementOperator
    ) external returns (CollateralLockId lockId) {
        lockId = CollateralLockId.wrap(keccak256(abi.encode(block.chainid, address(this), msg.sender, lockReference)));
        CollateralId collateralId = deriveCollateralId(assetId, bindingVersion);
        _locks[lockId] = CollateralLock({
            accountId: accountId,
            collateralId: collateralId,
            assetId: assetId,
            lockReference: lockReference,
            operator: msg.sender,
            bindingVersion: bindingVersion,
            expiry: expiry,
            settlementOperator: settlementOperator,
            status: LockStatus.Active,
            initialAmount: amount,
            remainingAmount: amount
        });
    }

    function releaseLock(CollateralLockId lockId) external {
        CollateralLock storage lock = _locks[lockId];
        require(msg.sender == lock.operator);
        lock.remainingAmount = 0;
        lock.status = LockStatus.Released;
    }

    function releaseExpiredLock(CollateralLockId lockId) external {
        CollateralLock storage lock = _locks[lockId];
        require(block.timestamp >= lock.expiry);
        lock.remainingAmount = 0;
        lock.status = LockStatus.Expired;
    }

    function consumeLock(CollateralLockId lockId, uint128 amount) external {
        CollateralLock storage lock = _locks[lockId];
        require(msg.sender == lock.settlementOperator);
        require(amount <= lock.remainingAmount);
        lock.remainingAmount -= amount;
        if (lock.remainingAmount == 0) lock.status = LockStatus.Consumed;
    }

    function deriveCollateralId(AssetId assetId, uint32 bindingVersion) public view returns (CollateralId) {
        return CollateralId.wrap(keccak256(abi.encode(block.chainid, address(this), assetId, bindingVersion)));
    }

    function getLock(CollateralLockId lockId) external view returns (CollateralLock memory lock) {
        return _locks[lockId];
    }

    function riskDomainRegistry() external view returns (IFirmCapacityRiskRegistry) {
        return _risks;
    }
}

contract PrivateRfqValidationGateMock is IPrivateRfqValidationGate {
    error UnsupportedPrivacyMode(bytes32 privacyModeId);
    error UnsupportedExecutionMode(bytes32 executionModeId);
    error IneligibleMaker(address maker);
    error HandoffRejected();

    mapping(bytes32 tag => bool supported) public privacyModes;
    mapping(bytes32 tag => bool supported) public executionModes;
    bool public handoffAllowed = true;

    function setPrivacyMode(bytes32 tag, bool supported) external {
        privacyModes[tag] = supported;
    }

    function setExecutionMode(bytes32 tag, bool supported) external {
        executionModes[tag] = supported;
    }

    function setHandoffAllowed(bool allowed) external {
        handoffAllowed = allowed;
    }

    function validateRequest(PrivateRfqRequest calldata request, PackageLeg[] calldata) external view {
        _validateTags(request.privacyModeId, request.executionModeId);
    }

    function validateQuote(PrivateRfqRequest calldata request, MakerQuote calldata quote, bytes32[] calldata)
        external
        view
    {
        _validateTags(quote.privacyModeId, quote.executionModeId);
        if (request.eligibleMakerSetHash != keccak256(abi.encode(quote.maker))) revert IneligibleMaker(quote.maker);
    }

    function validateSelection(
        PrivateRfqRequest calldata request,
        MakerQuote calldata quote,
        RfqSelectionAuthorization calldata
    ) external view {
        _validateTags(request.privacyModeId, quote.executionModeId);
    }

    function validateHandoff(PrivateRfqRequest calldata request, MakerQuote calldata quote, address, Lots, uint128)
        external
        view
    {
        if (!handoffAllowed) revert HandoffRejected();
        _validateTags(request.privacyModeId, quote.executionModeId);
    }

    function _validateTags(bytes32 privacyModeId, bytes32 executionModeId) private view {
        if (!privacyModes[privacyModeId]) revert UnsupportedPrivacyMode(privacyModeId);
        if (!executionModes[executionModeId]) revert UnsupportedExecutionMode(executionModeId);
    }
}
