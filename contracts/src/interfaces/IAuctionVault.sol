// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {CollateralLock} from "../types/CollateralTypes.sol";
import {AccountId, AssetId, CollateralId, CollateralLockId} from "../types/Identifiers.sol";

interface IAuctionVault {
    function createLock(
        bytes32 lockReference,
        AccountId accountId,
        AssetId assetId,
        uint32 bindingVersion,
        uint128 amount,
        uint64 expiry,
        address settlementOperator
    ) external returns (CollateralLockId lockId);
    function releaseLock(CollateralLockId lockId) external;
    function releaseExpiredLock(CollateralLockId lockId) external;
    function consumeLock(CollateralLockId lockId, AccountId recipientAccountId, uint128 amount) external;
    function deriveCollateralId(AssetId assetId, uint32 bindingVersion) external view returns (CollateralId);
    function getLock(CollateralLockId lockId) external view returns (CollateralLock memory lock);
}
