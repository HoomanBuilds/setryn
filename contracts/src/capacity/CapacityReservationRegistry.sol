// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";

import {ICapacityReservationRegistry} from "../interfaces/ICapacityReservationRegistry.sol";
import {CollateralLockId} from "../types/Identifiers.sol";

contract CapacityReservationRegistry is ICapacityReservationRegistry, AccessControlDefaultAdminRules {
    bytes32 public constant CAPACITY_CLAIMANT_ROLE = keccak256("SETRYN_CAPACITY_CLAIMANT_ROLE");

    struct CapacityReference {
        bytes32 capacityId;
        CollateralLockId lockId;
        address claimant;
        bool closed;
    }

    mapping(bytes32 reservationKey => CapacityReference capacityRef) private _references;

    constructor(uint48 defaultAdminDelay, address initialAdmin)
        AccessControlDefaultAdminRules(defaultAdminDelay, _requireInitialAdmin(initialAdmin))
    {}

    function claimCapacityReference(bytes32 reservationKey, bytes32 capacityId, CollateralLockId lockId)
        external
        onlyRole(CAPACITY_CLAIMANT_ROLE)
    {
        if (reservationKey == bytes32(0) || capacityId == bytes32(0) || CollateralLockId.unwrap(lockId) == bytes32(0)) revert InvalidCapacityReference();
        CapacityReference storage existing = _references[reservationKey];
        if (existing.capacityId != bytes32(0)) {
            revert CapacityReferenceAlreadyClaimed(reservationKey, existing.capacityId);
        }
        _references[reservationKey] =
            CapacityReference({capacityId: capacityId, lockId: lockId, claimant: msg.sender, closed: false});
        emit CapacityReferenceClaimed(reservationKey, capacityId, lockId, msg.sender);
    }

    function closeCapacityReference(bytes32 reservationKey, bytes32 closeReference) external {
        CapacityReference storage capacityRef = _references[reservationKey];
        if (capacityRef.claimant != msg.sender) revert UnauthorizedCapacityClaimant(msg.sender);
        if (capacityRef.closed || closeReference == bytes32(0)) revert InvalidCapacityReference();
        capacityRef.closed = true;
        emit CapacityReferenceClosed(reservationKey, closeReference, msg.sender);
    }

    function capacityReference(bytes32 reservationKey)
        external
        view
        returns (bytes32 capacityId, CollateralLockId lockId, address claimant, bool closed)
    {
        CapacityReference storage capacityRef = _references[reservationKey];
        return (capacityRef.capacityId, capacityRef.lockId, capacityRef.claimant, capacityRef.closed);
    }

    function _requireInitialAdmin(address initialAdmin) private pure returns (address) {
        if (initialAdmin == address(0)) revert ZeroInitialAdmin();
        return initialAdmin;
    }
}
