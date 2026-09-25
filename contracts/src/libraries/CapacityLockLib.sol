// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {ICollateralVault} from "../interfaces/ICollateralVault.sol";
import {IPositionEngine} from "../interfaces/IPositionEngine.sol";
import {CollateralLock} from "../types/CollateralTypes.sol";
import {LockStatus} from "../types/Enums.sol";
import {AccountId, AssetId, CollateralLockId} from "../types/Identifiers.sol";

library CapacityLockLib {
    error CapacityLockMismatch(CollateralLockId lockId);

    function requireExact(
        IPositionEngine positionEngine,
        ICollateralVault vault,
        CollateralLockId lockId,
        bytes32 lockReference,
        AccountId accountId,
        AssetId assetId,
        uint32 bindingVersion,
        uint128 remainingAmount,
        uint64 expiry,
        address requester
    ) internal view returns (CollateralLock memory lock) {
        lock = vault.getLock(lockId);
        if (
            lock.status != LockStatus.Active || lock.operator != address(positionEngine)
                || lock.settlementOperator != address(positionEngine) || lock.lockReference != lockReference
                || lock.accountId != accountId || lock.assetId != assetId || lock.bindingVersion != bindingVersion
                || lock.remainingAmount != remainingAmount || lock.expiry != expiry || expiry <= block.timestamp
                || vault.deriveLockId(address(positionEngine), lockReference) != lockId
                || positionEngine.positionFundingRequester(lockId) != requester
        ) revert CapacityLockMismatch(lockId);
    }
}
