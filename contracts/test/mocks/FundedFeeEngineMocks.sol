// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {FeeScheduleDefinitionLib} from "../../src/libraries/FeeScheduleDefinitionLib.sol";
import {CollateralLock} from "../../src/types/CollateralTypes.sol";
import {LockStatus, RegistryStatus} from "../../src/types/Enums.sol";
import {FeeScheduleDefinition, FeeScheduleVersion} from "../../src/types/FeeScheduleDefinition.sol";
import {AccountId, AssetId, CollateralId, CollateralLockId, FeeScheduleId} from "../../src/types/Identifiers.sol";

contract FeeSettlementRegistryMock {}

contract FundedFeeScheduleRegistryMock {
    address public immutable settlementAssetRegistry;
    mapping(FeeScheduleId feeScheduleId => mapping(uint32 version => FeeScheduleVersion record)) private _records;
    mapping(FeeScheduleId feeScheduleId => mapping(uint32 version => bool value)) private _lifecycle;
    mapping(FeeScheduleId feeScheduleId => mapping(uint32 version => bool value)) private _open;

    constructor(address settlementAssetRegistry_) {
        settlementAssetRegistry = settlementAssetRegistry_;
    }

    function setSchedule(FeeScheduleDefinition calldata definition, uint32 version, bool lifecycle, bool open)
        external
        returns (FeeScheduleId feeScheduleId)
    {
        feeScheduleId = FeeScheduleDefinitionLib.deriveFeeScheduleId(definition);
        bytes32 definitionHash = FeeScheduleDefinitionLib.hashDefinition(definition, block.chainid);
        _records[feeScheduleId][version] = FeeScheduleVersion({
            definition: definition,
            definitionHash: definitionHash,
            versionHash: FeeScheduleDefinitionLib.hashVersion(feeScheduleId, version, definitionHash, block.chainid),
            version: version,
            status: open ? RegistryStatus.Active : RegistryStatus.Paused
        });
        _lifecycle[feeScheduleId][version] = lifecycle;
        _open[feeScheduleId][version] = open;
    }

    function setOpen(FeeScheduleId feeScheduleId, uint32 version, bool value) external {
        _open[feeScheduleId][version] = value;
    }

    function getFeeSchedule(FeeScheduleId feeScheduleId, uint32 version)
        external
        view
        returns (FeeScheduleVersion memory)
    {
        return _records[feeScheduleId][version];
    }

    function isLifecycleEnabled(FeeScheduleId feeScheduleId, uint32 version) external view returns (bool) {
        return _lifecycle[feeScheduleId][version];
    }

    function isOpenForNewRisk(FeeScheduleId feeScheduleId, uint32 version) external view returns (bool) {
        return _open[feeScheduleId][version];
    }
}

contract FundedFeeCollateralVaultMock {
    address public immutable settlementAssetRegistry;
    mapping(CollateralLockId lockId => CollateralLock lock) private _locks;
    mapping(AccountId accountId => uint128 amount) public credited;
    mapping(AccountId accountId => bool exists) private _accounts;

    constructor(address settlementAssetRegistry_) {
        settlementAssetRegistry = settlementAssetRegistry_;
    }

    function setLock(
        address operator,
        bytes32 lockReference,
        AccountId accountId,
        AssetId assetId,
        uint32 bindingVersion,
        uint128 amount,
        uint64 expiry,
        address settlementOperator
    ) external returns (CollateralLockId lockId) {
        lockId = deriveLockId(operator, lockReference);
        _locks[lockId] = CollateralLock({
            accountId: accountId,
            collateralId: deriveCollateralId(assetId, bindingVersion),
            assetId: assetId,
            lockReference: lockReference,
            operator: operator,
            bindingVersion: bindingVersion,
            expiry: expiry,
            settlementOperator: settlementOperator,
            status: LockStatus.Active,
            initialAmount: amount,
            remainingAmount: amount
        });
    }

    function consumeLock(CollateralLockId lockId, AccountId recipientAccountId, uint128 amount) external {
        CollateralLock storage lock = _locks[lockId];
        require(lock.status == LockStatus.Active && lock.settlementOperator == msg.sender);
        require(amount != 0 && amount <= lock.remainingAmount);
        lock.remainingAmount -= amount;
        if (lock.remainingAmount == 0) lock.status = LockStatus.Consumed;
        credited[recipientAccountId] += amount;
    }

    function deriveLockId(address operator, bytes32 lockReference) public view returns (CollateralLockId) {
        return CollateralLockId.wrap(keccak256(abi.encode(block.chainid, address(this), operator, lockReference)));
    }

    function deriveCollateralId(AssetId assetId, uint32 bindingVersion) public view returns (CollateralId) {
        return
            CollateralId.wrap(
                keccak256(abi.encode(block.chainid, address(this), AssetId.unwrap(assetId), bindingVersion))
            );
    }

    function getLock(CollateralLockId lockId) external view returns (CollateralLock memory lock) {
        return _locks[lockId];
    }

    function createAccount(AccountId accountId) external {
        _accounts[accountId] = true;
    }

    function accountExists(AccountId accountId) external view returns (bool) {
        return _accounts[accountId];
    }
}
