// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Eip712Lib} from "./Eip712Lib.sol";
import {AccountId, CollateralId, FeeScheduleId, PositionId, RiskDomainId, SeriesId} from "../types/Identifiers.sol";
import {
    LifecycleAction,
    LifecycleActionId,
    LifecycleActionKind,
    LifecycleCollateralReplacement,
    LifecycleConsent,
    LifecycleInput,
    LifecycleSuccessor
} from "../types/LifecycleTypes.sol";
import {Lots, PriceTicks} from "../types/Units.sol";

library LifecycleHashLib {
    uint256 internal constant MAXIMUM_INPUTS = 32;
    uint256 internal constant MAXIMUM_SUCCESSORS = 32;
    uint256 internal constant MAXIMUM_PARTICIPANTS = 32;

    bytes32 internal constant INPUT_TYPEHASH = keccak256(
        "SetrynLifecycleInputV1(bytes32 positionId,bytes32 expectedImmutableHash,bytes32 expectedLifecycleHash,uint128 expectedPositionLots,uint128 actionLots)"
    );
    bytes32 internal constant SUCCESSOR_TYPEHASH = keccak256(
        "SetrynLifecycleSuccessorV1(bytes32 successorKey,bytes32 seriesId,uint32 seriesVersion,bytes32 longAccountId,bytes32 shortAccountId,bytes32 riskDomainId,uint32 riskDomainVersion,bytes32 collateralId,uint128 lots,int128 entryPriceTicks,bytes32 economicsHash,bytes32 packageProvenanceHash,uint128 longTerminalLiabilityBaseUnits,uint128 shortTerminalLiabilityBaseUnits)"
    );
    bytes32 internal constant COLLATERAL_TYPEHASH = keccak256(
        "SetrynLifecycleCollateralV1(bytes32 accountId,bytes32 collateralId,uint128 terminalLiabilityBaseUnits)"
    );
    bytes32 internal constant ACTION_TYPEHASH = keccak256(
        "SetrynLifecycleActionV1(uint8 kind,address actor,bytes32 actorAccountId,bytes32 policyContextHash,bytes32 inputsHash,bytes32 successorsHash,bytes32 collateralReplacementsHash,bytes32 participantSetHash,bytes32 consentsHash,bytes32 riskDomainId,uint32 riskDomainVersion,bytes32 feeScheduleId,uint32 feeScheduleVersion,bytes32 economicTransitionHash,bytes32 compressionPlanId,bool breaksPackageProvenance,bytes32 packageBreakPermissionHash,uint128 actorMaximumLiabilityIncreaseBaseUnits,uint128 actorMaximumCollateralIncreaseBaseUnits,uint16 inputCount,uint16 successorCount,uint16 participantCount,uint64 deadline,uint256 nonce,address permittedExecutor,bytes32 salt,uint256 chainId,address engine)"
    );
    bytes32 internal constant CONSENT_TYPEHASH = keccak256(
        "SetrynLifecycleConsentV1(bytes32 actionId,bytes32 accountId,address signer,uint256 nonce,uint64 deadline,uint128 maximumLiabilityIncreaseBaseUnits,uint128 maximumCollateralIncreaseBaseUnits,bool allowsPackageBreak,bytes32 salt)"
    );
    bytes32 internal constant CONSENT_TERMS_TYPEHASH = keccak256(
        "SetrynLifecycleConsentTermsV1(bytes32 accountId,address signer,uint256 nonce,uint64 deadline,uint128 maximumLiabilityIncreaseBaseUnits,uint128 maximumCollateralIncreaseBaseUnits,bool allowsPackageBreak,bytes32 salt)"
    );

    error InvalidLifecycleInput();
    error InvalidLifecycleSuccessor();
    error InvalidCollateralReplacement();
    error InvalidLifecycleAction();

    function hashInputs(LifecycleInput[] memory inputs) internal pure returns (bytes32 result) {
        if (inputs.length == 0 || inputs.length > MAXIMUM_INPUTS) revert InvalidLifecycleInput();
        bytes32 previous;
        bytes32[] memory hashes = new bytes32[](inputs.length);
        for (uint256 i; i < inputs.length; ++i) {
            LifecycleInput memory input = inputs[i];
            bytes32 positionId = PositionId.unwrap(input.positionId);
            if (
                positionId == bytes32(0) || positionId <= previous || input.expectedImmutableHash == bytes32(0)
                    || input.expectedLifecycleHash == bytes32(0) || Lots.unwrap(input.expectedPositionLots) == 0
                    || Lots.unwrap(input.actionLots) == 0
                    || Lots.unwrap(input.actionLots) > Lots.unwrap(input.expectedPositionLots)
            ) revert InvalidLifecycleInput();
            previous = positionId;
            hashes[i] = keccak256(
                abi.encode(
                    INPUT_TYPEHASH,
                    positionId,
                    input.expectedImmutableHash,
                    input.expectedLifecycleHash,
                    Lots.unwrap(input.expectedPositionLots),
                    Lots.unwrap(input.actionLots)
                )
            );
        }
        result = keccak256(abi.encodePacked(hashes));
    }

    function hashSuccessors(LifecycleSuccessor[] memory successors) internal pure returns (bytes32 result) {
        if (successors.length > MAXIMUM_SUCCESSORS) revert InvalidLifecycleSuccessor();
        bytes32 previous;
        bytes32[] memory hashes = new bytes32[](successors.length);
        for (uint256 i; i < successors.length; ++i) {
            LifecycleSuccessor memory successor = successors[i];
            if (
                successor.successorKey == bytes32(0) || successor.successorKey <= previous
                    || SeriesId.unwrap(successor.seriesId) == bytes32(0) || successor.seriesVersion == 0
                    || AccountId.unwrap(successor.longAccountId) == bytes32(0)
                    || AccountId.unwrap(successor.shortAccountId) == bytes32(0)
                    || AccountId.unwrap(successor.longAccountId) == AccountId.unwrap(successor.shortAccountId)
                    || RiskDomainId.unwrap(successor.riskDomainId) == bytes32(0) || successor.riskDomainVersion == 0
                    || CollateralId.unwrap(successor.collateralId) == bytes32(0) || Lots.unwrap(successor.lots) == 0
                    || successor.economicsHash == bytes32(0)
            ) revert InvalidLifecycleSuccessor();
            previous = successor.successorKey;
            hashes[i] = hashSuccessor(successor);
        }
        result = keccak256(abi.encodePacked(hashes));
    }

    function hashSuccessor(LifecycleSuccessor memory successor) internal pure returns (bytes32) {
        return keccak256(
            bytes.concat(
                abi.encode(
                    SUCCESSOR_TYPEHASH,
                    successor.successorKey,
                    SeriesId.unwrap(successor.seriesId),
                    successor.seriesVersion,
                    AccountId.unwrap(successor.longAccountId),
                    AccountId.unwrap(successor.shortAccountId),
                    RiskDomainId.unwrap(successor.riskDomainId),
                    successor.riskDomainVersion,
                    CollateralId.unwrap(successor.collateralId),
                    Lots.unwrap(successor.lots)
                ),
                abi.encode(
                    PriceTicks.unwrap(successor.entryPriceTicks),
                    successor.economicsHash,
                    successor.packageProvenanceHash,
                    successor.longTerminalLiabilityBaseUnits,
                    successor.shortTerminalLiabilityBaseUnits
                )
            )
        );
    }

    function hashCollateralReplacements(LifecycleCollateralReplacement[] memory replacements)
        internal
        pure
        returns (bytes32 result)
    {
        if (replacements.length == 0 || replacements.length > MAXIMUM_PARTICIPANTS) {
            revert InvalidCollateralReplacement();
        }
        bytes32 previous;
        bytes32[] memory hashes = new bytes32[](replacements.length);
        for (uint256 i; i < replacements.length; ++i) {
            bytes32 accountId = AccountId.unwrap(replacements[i].accountId);
            if (
                accountId == bytes32(0) || accountId <= previous
                    || CollateralId.unwrap(replacements[i].collateralId) == bytes32(0)
            ) revert InvalidCollateralReplacement();
            previous = accountId;
            hashes[i] = keccak256(
                abi.encode(
                    COLLATERAL_TYPEHASH,
                    accountId,
                    CollateralId.unwrap(replacements[i].collateralId),
                    replacements[i].terminalLiabilityBaseUnits
                )
            );
        }
        result = keccak256(abi.encodePacked(hashes));
    }

    function hashParticipantSet(AccountId actorAccountId, LifecycleConsent[] memory consents)
        internal
        pure
        returns (bytes32 result)
    {
        if (AccountId.unwrap(actorAccountId) == bytes32(0) || consents.length >= MAXIMUM_PARTICIPANTS) {
            revert InvalidLifecycleAction();
        }
        bytes32 previous;
        bytes32[] memory accounts = new bytes32[](consents.length + 1);
        accounts[0] = AccountId.unwrap(actorAccountId);
        for (uint256 i; i < consents.length; ++i) {
            bytes32 accountId = AccountId.unwrap(consents[i].accountId);
            if (accountId == bytes32(0) || accountId <= previous || accountId == accounts[0]) {
                revert InvalidLifecycleAction();
            }
            previous = accountId;
            accounts[i + 1] = accountId;
        }
        result = keccak256(abi.encode(accounts));
    }

    function hashConsentTerms(LifecycleConsent[] memory consents) internal pure returns (bytes32 result) {
        bytes32[] memory hashes = new bytes32[](consents.length);
        bytes32 previous;
        for (uint256 i; i < consents.length; ++i) {
            bytes32 accountId = AccountId.unwrap(consents[i].accountId);
            if (
                accountId == bytes32(0) || accountId <= previous || consents[i].signer == address(0)
                    || consents[i].deadline == 0 || consents[i].salt == bytes32(0)
            ) revert InvalidLifecycleAction();
            previous = accountId;
            hashes[i] = keccak256(
                abi.encode(
                    CONSENT_TERMS_TYPEHASH,
                    accountId,
                    consents[i].signer,
                    consents[i].nonce,
                    consents[i].deadline,
                    consents[i].maximumLiabilityIncreaseBaseUnits,
                    consents[i].maximumCollateralIncreaseBaseUnits,
                    consents[i].allowsPackageBreak,
                    consents[i].salt
                )
            );
        }
        result = keccak256(abi.encodePacked(hashes));
    }

    function hashAction(LifecycleAction memory action, uint256 chainId, address engine)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(ACTION_TYPEHASH, action, chainId, engine));
    }

    function actionDigest(LifecycleAction memory action, uint256 chainId, address engine)
        internal
        pure
        returns (bytes32)
    {
        return Eip712Lib.toTypedDataDigest(
            Eip712Lib.domainSeparator(chainId, engine), hashAction(action, chainId, engine)
        );
    }

    function deriveActionId(bytes32 actionHash) internal pure returns (LifecycleActionId) {
        return LifecycleActionId.wrap(keccak256(abi.encode(keccak256("SetrynLifecycleActionIdV1"), actionHash)));
    }

    function consentDigest(LifecycleConsent memory consent, uint256 chainId, address engine)
        internal
        pure
        returns (bytes32)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                CONSENT_TYPEHASH,
                LifecycleActionId.unwrap(consent.actionId),
                AccountId.unwrap(consent.accountId),
                consent.signer,
                consent.nonce,
                consent.deadline,
                consent.maximumLiabilityIncreaseBaseUnits,
                consent.maximumCollateralIncreaseBaseUnits,
                consent.allowsPackageBreak,
                consent.salt
            )
        );
        return Eip712Lib.toTypedDataDigest(Eip712Lib.domainSeparator(chainId, engine), structHash);
    }

    function validateAction(LifecycleAction memory action) internal pure {
        if (
            action.kind == LifecycleActionKind.Unspecified || action.policyContextHash == bytes32(0)
                || action.inputsHash == bytes32(0) || action.collateralReplacementsHash == bytes32(0)
                || action.participantSetHash == bytes32(0) || action.consentsHash == bytes32(0)
                || RiskDomainId.unwrap(action.riskDomainId) == bytes32(0) || action.riskDomainVersion == 0
                || FeeScheduleId.unwrap(action.feeScheduleId) == bytes32(0) || action.feeScheduleVersion == 0
                || action.inputCount == 0 || action.deadline == 0 || action.salt == bytes32(0)
        ) revert InvalidLifecycleAction();
        if (action.successorCount == 0) {
            if (action.successorsHash != keccak256(bytes(""))) revert InvalidLifecycleAction();
        } else if (action.successorsHash == bytes32(0)) {
            revert InvalidLifecycleAction();
        }
        bool isLapse = action.kind == LifecycleActionKind.Lapse;
        if (isLapse) {
            if (
                action.actor != address(0) || AccountId.unwrap(action.actorAccountId) != bytes32(0)
                    || action.permittedExecutor != address(0) || action.nonce != 0 || action.participantCount != 0
                    || action.participantSetHash != keccak256("SetrynPermissionlessLapseV1")
            ) revert InvalidLifecycleAction();
        } else if (
            action.actor == address(0) || AccountId.unwrap(action.actorAccountId) == bytes32(0)
                || action.permittedExecutor == address(0) || action.participantCount == 0
        ) {
            revert InvalidLifecycleAction();
        }
        // Amendment, Novation, Roll and Exercise (contiguous kinds) commit to an economic transition. An exercise commits
        // to its fixing witness (reference and final fixings hash); the executor refuses a witness that does not match.
        bool needsTransition =
            action.kind >= LifecycleActionKind.Amendment && action.kind <= LifecycleActionKind.Exercise;
        if (needsTransition != (action.economicTransitionHash != bytes32(0))) revert InvalidLifecycleAction();
        bool isCompression = action.kind == LifecycleActionKind.CompressionHandoff;
        if (isCompression != (action.compressionPlanId != bytes32(0))) {
            revert InvalidLifecycleAction();
        }
        if (action.breaksPackageProvenance != (action.packageBreakPermissionHash != bytes32(0))) {
            revert InvalidLifecycleAction();
        }
    }
}
