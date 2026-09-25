// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {
    AccountId,
    AssetId,
    CollateralId,
    CollateralLockId,
    TerminalClaimId,
    TerminalLiabilityReservationId
} from "../types/Identifiers.sol";

/// @dev Derivation for the vault's chain-local operational identifiers. This library is deliberately
/// separate from IdLib: IdLib derives chain-portable product identities and therefore excludes
/// chainId and verifyingContract, while everything here is scoped to one deployment on one chain and
/// must hash both in. Routing an AccountId or a CollateralId through IdLib would let two deployments
/// or two chains collide on one custody key.
///
/// @dev Each tag carries its version inside the hashed literal. A derivation rule may never be
/// edited in place; it is replaced by a new V2 tag, so previously derived identifiers can never
/// silently re-derive to different values.
library CollateralIdLib {
    /// @dev The typestring is kept beside the tag so a test can prove they agree. Solidity cannot
    /// hash a string constant inside another constant initializer, so the literal is repeated.
    string internal constant ACCOUNT_ID_TYPESTRING =
        "SetrynCollateralAccountIdV1(uint256 chainId,address vault,address creator,bytes32 salt)";
    bytes32 internal constant ACCOUNT_ID_TYPE_TAG =
        keccak256("SetrynCollateralAccountIdV1(uint256 chainId,address vault,address creator,bytes32 salt)");

    /// @dev The settlement registry address is hashed in because a CollateralId means nothing without
    /// the registry that qualified the binding. Two registries may number their versions identically
    /// and still name different tokens, so the qualifying authority is part of the key.
    string internal constant COLLATERAL_ID_TYPESTRING =
        "SetrynCollateralIdV1(uint256 chainId,address settlementAssetRegistry,bytes32 assetId,uint32 bindingVersion)";
    bytes32 internal constant COLLATERAL_ID_TYPE_TAG = keccak256(
        "SetrynCollateralIdV1(uint256 chainId,address settlementAssetRegistry,bytes32 assetId,uint32 bindingVersion)"
    );

    function deriveAccountId(uint256 chainId, address vault, address creator, bytes32 salt)
        internal
        pure
        returns (AccountId)
    {
        return AccountId.wrap(keccak256(abi.encode(ACCOUNT_ID_TYPE_TAG, chainId, vault, creator, salt)));
    }

    /// @dev The lock operator is hashed in so a lock reference is namespaced per operator rather
    /// than global. Without it, any address holding the locker role could claim a handle a different
    /// manager intended to use and permanently deny it that handle, which is a collision grief the
    /// vault cannot detect from a reference alone.
    string internal constant LOCK_ID_TYPESTRING =
        "SetrynCollateralLockIdV1(uint256 chainId,address vault,address operator,bytes32 lockReference)";
    bytes32 internal constant LOCK_ID_TYPE_TAG =
        keccak256("SetrynCollateralLockIdV1(uint256 chainId,address vault,address operator,bytes32 lockReference)");

    string internal constant TERMINAL_RESERVATION_ID_TYPESTRING =
        "SetrynTerminalLiabilityReservationIdV2(uint256 chainId,address vault,address positionEngine,bytes32 positionEngineId,bytes32 positionId)";
    bytes32 internal constant TERMINAL_RESERVATION_ID_TYPE_TAG = keccak256(
        "SetrynTerminalLiabilityReservationIdV2(uint256 chainId,address vault,address positionEngine,bytes32 positionEngineId,bytes32 positionId)"
    );

    string internal constant TERMINAL_CLAIM_ID_TYPESTRING =
        "SetrynTerminalClaimIdV1(uint256 chainId,address vault,bytes32 reservationId,bytes32 terminalOutcomeReference)";
    bytes32 internal constant TERMINAL_CLAIM_ID_TYPE_TAG = keccak256(
        "SetrynTerminalClaimIdV1(uint256 chainId,address vault,bytes32 reservationId,bytes32 terminalOutcomeReference)"
    );

    /// @dev bindingVersion is the exact immutable version, never the registry's moving active
    /// pointer. A caller that resolved activeVersion must pass the concrete number it read, so the
    /// balance it touches is the one it decided on.
    function deriveCollateralId(
        uint256 chainId,
        address settlementAssetRegistry,
        AssetId assetId,
        uint32 bindingVersion
    ) internal pure returns (CollateralId) {
        return CollateralId.wrap(
            keccak256(
                abi.encode(
                    COLLATERAL_ID_TYPE_TAG, chainId, settlementAssetRegistry, AssetId.unwrap(assetId), bindingVersion
                )
            )
        );
    }

    function deriveLockId(uint256 chainId, address vault, address operator, bytes32 lockReference)
        internal
        pure
        returns (CollateralLockId)
    {
        return CollateralLockId.wrap(keccak256(abi.encode(LOCK_ID_TYPE_TAG, chainId, vault, operator, lockReference)));
    }

    function deriveTerminalLiabilityReservationId(
        uint256 chainId,
        address vault,
        address positionEngine,
        bytes32 positionEngineId,
        bytes32 positionId
    ) internal pure returns (TerminalLiabilityReservationId) {
        return TerminalLiabilityReservationId.wrap(
            keccak256(
                abi.encode(
                    TERMINAL_RESERVATION_ID_TYPE_TAG, chainId, vault, positionEngine, positionEngineId, positionId
                )
            )
        );
    }

    function deriveTerminalClaimId(
        uint256 chainId,
        address vault,
        TerminalLiabilityReservationId reservationId,
        bytes32 terminalOutcomeReference
    ) internal pure returns (TerminalClaimId) {
        return TerminalClaimId.wrap(
            keccak256(
                abi.encode(
                    TERMINAL_CLAIM_ID_TYPE_TAG,
                    chainId,
                    vault,
                    TerminalLiabilityReservationId.unwrap(reservationId),
                    terminalOutcomeReference
                )
            )
        );
    }
}
