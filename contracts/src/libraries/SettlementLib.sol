// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {
    CanonicalSettlementFixing,
    SettlementCollateralDelta,
    SettlementFeeReceipt,
    SettlementMode
} from "../types/SettlementTypes.sol";
import {AccountId, FeeActionId, PositionId, SettlementId} from "../types/Identifiers.sol";

library SettlementLib {
    bytes32 internal constant FIXING_TYPEHASH = keccak256(
        "SetrynCanonicalSettlementFixingV1(bytes32 fixingKey,bytes32 resultHash,uint8 resolutionKind,int256 value,int256 terminalDisruptionTransferMinorPerLot,uint64 effectiveAt,uint8 slot,uint8 decimals)"
    );
    bytes32 internal constant FIXINGS_TYPEHASH = keccak256("SetrynCanonicalSettlementFixingsV1(bytes32 hashesHash)");
    bytes32 internal constant SETTLEMENT_ID_TYPEHASH = keccak256(
        "SetrynSettlementIdV1(uint256 chainId,address coordinator,bytes32 positionId,uint8 mode,bytes32 fixingsHash)"
    );
    bytes32 internal constant FEE_RECEIPT_TYPEHASH = keccak256(
        "SetrynSettlementFeeReceiptV1(bytes32 actionId,bytes32 consumptionId,bytes32 resultHash,uint128 chargeMinor,uint128 rebateMinor)"
    );
    bytes32 internal constant COLLATERAL_DELTA_TYPEHASH = keccak256(
        "SetrynSettlementCollateralDeltaV1(bytes32 reservationId,bytes32 claimId,uint8 status,bytes32 payerAccountId,bytes32 receiverAccountId,uint128 reservedBefore,uint128 claimAmount,uint128 releasedAmount)"
    );
    bytes32 internal constant OUTCOME_TYPEHASH = keccak256(
        "SetrynSettlementOutcomeV1(bytes32 settlementId,bytes32 positionId,uint8 mode,bytes32 seriesVersionHash,bytes32 payoffTermsHash,bytes32 fixingSlotsHash,bytes32 fixingsHash,bytes32 positionOutcomeReference,int256 terminalTransferMinor,bytes32 feeReceiptsHash,bytes32 longCollateralHash,bytes32 shortCollateralHash)"
    );

    function hashFixings(CanonicalSettlementFixing[] memory fixings) internal pure returns (bytes32) {
        bytes32[] memory hashes = new bytes32[](fixings.length);
        for (uint256 i; i < fixings.length; ++i) {
            CanonicalSettlementFixing memory fixing = fixings[i];
            hashes[i] = keccak256(
                abi.encode(
                    FIXING_TYPEHASH,
                    fixing.fixingKey,
                    fixing.resultHash,
                    uint8(fixing.resolutionKind),
                    fixing.value,
                    fixing.terminalDisruptionTransferMinorPerLot,
                    fixing.effectiveAt,
                    fixing.slot,
                    fixing.decimals
                )
            );
        }
        return keccak256(abi.encode(FIXINGS_TYPEHASH, keccak256(abi.encodePacked(hashes))));
    }

    function deriveSettlementId(
        uint256 chainId,
        address coordinator,
        PositionId positionId,
        SettlementMode mode,
        bytes32 fixingsHash
    ) internal pure returns (SettlementId) {
        return SettlementId.wrap(
            keccak256(
                abi.encode(
                    SETTLEMENT_ID_TYPEHASH,
                    chainId,
                    coordinator,
                    PositionId.unwrap(positionId),
                    uint8(mode),
                    fixingsHash
                )
            )
        );
    }

    function hashFeeReceipts(SettlementFeeReceipt[] memory receipts) internal pure returns (bytes32) {
        bytes32[] memory hashes = new bytes32[](receipts.length);
        for (uint256 i; i < receipts.length; ++i) {
            hashes[i] = keccak256(
                abi.encode(
                    FEE_RECEIPT_TYPEHASH,
                    FeeActionId.unwrap(receipts[i].actionId),
                    receipts[i].consumptionId,
                    receipts[i].resultHash,
                    receipts[i].chargeMinor,
                    receipts[i].rebateMinor
                )
            );
        }
        return keccak256(abi.encodePacked(hashes));
    }

    function hashCollateralDelta(SettlementCollateralDelta memory delta) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                COLLATERAL_DELTA_TYPEHASH,
                delta.reservationId,
                delta.claimId,
                uint8(delta.status),
                AccountId.unwrap(delta.payerAccountId),
                AccountId.unwrap(delta.receiverAccountId),
                delta.reservedBefore,
                delta.claimAmount,
                delta.releasedAmount
            )
        );
    }

    function hashOutcome(
        SettlementId settlementId,
        PositionId positionId,
        SettlementMode mode,
        bytes32 seriesVersionHash,
        bytes32 payoffTermsHash,
        bytes32 fixingSlotsHash,
        bytes32 fixingsHash,
        bytes32 positionOutcomeReference,
        int256 terminalTransferMinor,
        SettlementFeeReceipt[] memory feeReceipts,
        SettlementCollateralDelta memory longCollateral,
        SettlementCollateralDelta memory shortCollateral
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                OUTCOME_TYPEHASH,
                SettlementId.unwrap(settlementId),
                PositionId.unwrap(positionId),
                uint8(mode),
                seriesVersionHash,
                payoffTermsHash,
                fixingSlotsHash,
                fixingsHash,
                positionOutcomeReference,
                terminalTransferMinor,
                hashFeeReceipts(feeReceipts),
                hashCollateralDelta(longCollateral),
                hashCollateralDelta(shortCollateral)
            )
        );
    }
}
