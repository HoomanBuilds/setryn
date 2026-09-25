// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {CollateralLockId} from "../types/Identifiers.sol";

interface ICapacityReservationRegistry {
    event CapacityReferenceClaimed(
        bytes32 indexed reservationKey, bytes32 indexed capacityId, CollateralLockId indexed lockId, address claimant
    );
    event CapacityReferenceClosed(bytes32 indexed reservationKey, bytes32 indexed closeReference, address claimant);

    error ZeroInitialAdmin();
    error InvalidCapacityReference();
    error CapacityReferenceAlreadyClaimed(bytes32 reservationKey, bytes32 capacityId);
    error UnauthorizedCapacityClaimant(address claimant);

    function CAPACITY_CLAIMANT_ROLE() external view returns (bytes32);
    function claimCapacityReference(bytes32 reservationKey, bytes32 capacityId, CollateralLockId lockId) external;
    function closeCapacityReference(bytes32 reservationKey, bytes32 closeReference) external;
    function capacityReference(bytes32 reservationKey)
        external
        view
        returns (bytes32 capacityId, CollateralLockId lockId, address claimant, bool closed);
}
