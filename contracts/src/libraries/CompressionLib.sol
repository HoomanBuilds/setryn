// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Eip712Lib} from "./Eip712Lib.sol";
import {AccountId, CollateralId, PositionId, RiskDomainId, SeriesId} from "../types/Identifiers.sol";
import {
    CompressionConsent,
    CompressionPlanDefinition,
    CompressionPlanId,
    CompressionPosition,
    CompressionSuccessor,
    ReplacementCollateral
} from "../types/CompressionTypes.sol";
import {Lots, PriceTicks} from "../types/Units.sol";

library CompressionLib {
    uint256 internal constant MAXIMUM_INPUTS = 32;
    uint256 internal constant MAXIMUM_SUCCESSORS = 32;
    uint256 internal constant MAXIMUM_ACCOUNTS = 32;

    bytes32 internal constant POSITION_TYPEHASH = keccak256(
        "SetrynCompressionPositionV1(bytes32 positionId,bytes32 seriesId,uint32 seriesVersion,bytes32 longAccountId,bytes32 shortAccountId,bytes32 riskDomainId,uint32 riskDomainVersion,bytes32 collateralId,uint128 lots,int128 entryPriceTicks,bytes32 economicsHash,uint128 longTerminalLiabilityBaseUnits,uint128 shortTerminalLiabilityBaseUnits,bytes32 lifecycleHash)"
    );
    bytes32 internal constant SUCCESSOR_TYPEHASH = keccak256(
        "SetrynCompressionSuccessorV1(bytes32 successorKey,bytes32 seriesId,uint32 seriesVersion,bytes32 longAccountId,bytes32 shortAccountId,bytes32 riskDomainId,uint32 riskDomainVersion,bytes32 collateralId,uint128 lots,int128 entryPriceTicks,bytes32 economicsHash,uint128 longTerminalLiabilityBaseUnits,uint128 shortTerminalLiabilityBaseUnits)"
    );
    bytes32 internal constant REPLACEMENT_TYPEHASH = keccak256(
        "SetrynReplacementCollateralV1(bytes32 accountId,bytes32 collateralId,uint128 terminalLiabilityBaseUnits)"
    );
    bytes32 internal constant CONSENT_TYPEHASH = keccak256(
        "SetrynCompressionConsentV1(bytes32 planId,bytes32 accountId,address signer,uint256 nonce,uint64 deadline,uint128 maximumLiabilityIncreaseBaseUnits,uint128 maximumPayoffReductionBaseUnits,bytes32 salt)"
    );
    bytes32 internal constant PLAN_TYPEHASH = keccak256(
        "SetrynCompressionPlanV1(bytes32 namespaceId,bytes32 planNonce,bytes32 riskDomainId,uint32 riskDomainVersion,bytes32 collateralId,bytes32 inputsHash,bytes32 successorsHash,bytes32 replacementCollateralHash,uint16 inputCount,uint16 successorCount,uint16 accountCount,uint64 deadline,bytes32 qualificationHash,uint256 chainId,address coordinator)"
    );

    error InvalidCompressionInput();
    error InvalidCompressionSuccessor();
    error CrossRiskDomainCompression();
    error CrossCollateralCompression();
    error ExposureNotConserved(bytes32 accountId, bytes32 seriesId, bytes32 economicsHash);
    error LiabilityToleranceExceeded(bytes32 accountId, uint256 beforeAmount, uint256 afterAmount, uint256 tolerance);
    error ReplacementCollateralMismatch(bytes32 accountId);

    function hashPosition(CompressionPosition memory position) internal pure returns (bytes32) {
        return keccak256(
            bytes.concat(
                abi.encode(
                    POSITION_TYPEHASH,
                    PositionId.unwrap(position.positionId),
                    SeriesId.unwrap(position.seriesId),
                    position.seriesVersion,
                    AccountId.unwrap(position.longAccountId),
                    AccountId.unwrap(position.shortAccountId),
                    RiskDomainId.unwrap(position.riskDomainId),
                    position.riskDomainVersion,
                    CollateralId.unwrap(position.collateralId),
                    Lots.unwrap(position.lots)
                ),
                abi.encode(
                    PriceTicks.unwrap(position.entryPriceTicks),
                    position.economicsHash,
                    position.longTerminalLiabilityBaseUnits,
                    position.shortTerminalLiabilityBaseUnits,
                    position.lifecycleHash
                )
            )
        );
    }

    function hashSuccessor(CompressionSuccessor memory successor) internal pure returns (bytes32) {
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
                    successor.longTerminalLiabilityBaseUnits,
                    successor.shortTerminalLiabilityBaseUnits
                )
            )
        );
    }

    function hashInputs(CompressionPosition[] memory inputs) internal pure returns (bytes32 result) {
        if (inputs.length == 0 || inputs.length > MAXIMUM_INPUTS) revert InvalidCompressionInput();
        bytes32[] memory hashes = new bytes32[](inputs.length);
        bytes32 previous;
        for (uint256 i; i < inputs.length; ++i) {
            bytes32 positionId = PositionId.unwrap(inputs[i].positionId);
            if (positionId == bytes32(0) || positionId <= previous) revert InvalidCompressionInput();
            _validatePosition(inputs[i]);
            previous = positionId;
            hashes[i] = hashPosition(inputs[i]);
        }
        result = keccak256(abi.encodePacked(hashes));
    }

    function hashSuccessors(CompressionSuccessor[] memory successors) internal pure returns (bytes32 result) {
        if (successors.length > MAXIMUM_SUCCESSORS) revert InvalidCompressionSuccessor();
        bytes32[] memory hashes = new bytes32[](successors.length);
        bytes32 previous;
        for (uint256 i; i < successors.length; ++i) {
            if (successors[i].successorKey == bytes32(0) || successors[i].successorKey <= previous) {
                revert InvalidCompressionSuccessor();
            }
            _validateSuccessor(successors[i]);
            previous = successors[i].successorKey;
            hashes[i] = hashSuccessor(successors[i]);
        }
        result = keccak256(abi.encodePacked(hashes));
    }

    function hashReplacementCollateral(ReplacementCollateral[] memory replacement)
        internal
        pure
        returns (bytes32 result)
    {
        if (replacement.length == 0 || replacement.length > MAXIMUM_ACCOUNTS) {
            revert ReplacementCollateralMismatch(bytes32(0));
        }
        bytes32[] memory hashes = new bytes32[](replacement.length);
        bytes32 previous;
        for (uint256 i; i < replacement.length; ++i) {
            bytes32 accountId = AccountId.unwrap(replacement[i].accountId);
            if (
                accountId == bytes32(0) || accountId <= previous
                    || CollateralId.unwrap(replacement[i].collateralId) == bytes32(0)
            ) revert ReplacementCollateralMismatch(accountId);
            previous = accountId;
            hashes[i] = keccak256(
                abi.encode(
                    REPLACEMENT_TYPEHASH,
                    accountId,
                    CollateralId.unwrap(replacement[i].collateralId),
                    replacement[i].terminalLiabilityBaseUnits
                )
            );
        }
        result = keccak256(abi.encodePacked(hashes));
    }

    function hashDefinition(CompressionPlanDefinition memory definition, uint256 chainId, address coordinator)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(PLAN_TYPEHASH, definition, chainId, coordinator));
    }

    function derivePlanId(bytes32 definitionHash) internal pure returns (CompressionPlanId) {
        return CompressionPlanId.wrap(keccak256(abi.encode(keccak256("SetrynCompressionPlanIdV1"), definitionHash)));
    }

    function consentDigest(CompressionConsent memory consent, uint256 chainId, address coordinator)
        internal
        pure
        returns (bytes32)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                CONSENT_TYPEHASH,
                CompressionPlanId.unwrap(consent.planId),
                AccountId.unwrap(consent.accountId),
                consent.signer,
                consent.nonce,
                consent.deadline,
                consent.maximumLiabilityIncreaseBaseUnits,
                consent.maximumPayoffReductionBaseUnits,
                consent.salt
            )
        );
        return Eip712Lib.toTypedDataDigest(Eip712Lib.domainSeparator(chainId, coordinator), structHash);
    }

    function validateConservation(
        CompressionPlanDefinition memory definition,
        CompressionPosition[] memory inputs,
        CompressionSuccessor[] memory successors,
        ReplacementCollateral[] memory replacement,
        CompressionConsent[] memory consents
    ) internal pure {
        if (replacement.length != consents.length || consents.length != definition.accountCount) {
            revert ReplacementCollateralMismatch(bytes32(0));
        }
        _validateDomains(definition, inputs, successors, replacement);
        for (uint256 i; i < inputs.length; ++i) {
            _requireExposureConserved(inputs[i].longAccountId, inputs[i], inputs, successors);
            _requireExposureConserved(inputs[i].shortAccountId, inputs[i], inputs, successors);
        }
        for (uint256 i; i < successors.length; ++i) {
            _requireSuccessorExposureConserved(successors[i].longAccountId, successors[i], inputs, successors);
            _requireSuccessorExposureConserved(successors[i].shortAccountId, successors[i], inputs, successors);
        }
        for (uint256 i; i < replacement.length; ++i) {
            bytes32 accountId = AccountId.unwrap(replacement[i].accountId);
            if (accountId != AccountId.unwrap(consents[i].accountId)) revert ReplacementCollateralMismatch(accountId);
            uint256 beforeLiability = _inputLiability(replacement[i].accountId, inputs);
            uint256 afterLiability = _successorLiability(replacement[i].accountId, successors);
            if (afterLiability > beforeLiability + consents[i].maximumLiabilityIncreaseBaseUnits) {
                revert LiabilityToleranceExceeded(
                    accountId, beforeLiability, afterLiability, consents[i].maximumLiabilityIncreaseBaseUnits
                );
            }
            if (
                afterLiability != replacement[i].terminalLiabilityBaseUnits
                    || consents[i].maximumPayoffReductionBaseUnits != 0
            ) revert ReplacementCollateralMismatch(accountId);
        }
    }

    function _validatePosition(CompressionPosition memory position) private pure {
        if (
            SeriesId.unwrap(position.seriesId) == bytes32(0) || position.seriesVersion == 0
                || AccountId.unwrap(position.longAccountId) == bytes32(0)
                || AccountId.unwrap(position.shortAccountId) == bytes32(0)
                || AccountId.unwrap(position.longAccountId) == AccountId.unwrap(position.shortAccountId)
                || RiskDomainId.unwrap(position.riskDomainId) == bytes32(0) || position.riskDomainVersion == 0
                || CollateralId.unwrap(position.collateralId) == bytes32(0) || Lots.unwrap(position.lots) == 0
                || position.economicsHash == bytes32(0) || position.lifecycleHash == bytes32(0)
        ) revert InvalidCompressionInput();
    }

    function _validateSuccessor(CompressionSuccessor memory successor) private pure {
        if (
            SeriesId.unwrap(successor.seriesId) == bytes32(0) || successor.seriesVersion == 0
                || AccountId.unwrap(successor.longAccountId) == bytes32(0)
                || AccountId.unwrap(successor.shortAccountId) == bytes32(0)
                || AccountId.unwrap(successor.longAccountId) == AccountId.unwrap(successor.shortAccountId)
                || RiskDomainId.unwrap(successor.riskDomainId) == bytes32(0) || successor.riskDomainVersion == 0
                || CollateralId.unwrap(successor.collateralId) == bytes32(0) || Lots.unwrap(successor.lots) == 0
                || successor.economicsHash == bytes32(0)
        ) revert InvalidCompressionSuccessor();
    }

    function _validateDomains(
        CompressionPlanDefinition memory definition,
        CompressionPosition[] memory inputs,
        CompressionSuccessor[] memory successors,
        ReplacementCollateral[] memory replacement
    ) private pure {
        for (uint256 i; i < inputs.length; ++i) {
            if (
                RiskDomainId.unwrap(inputs[i].riskDomainId) != RiskDomainId.unwrap(definition.riskDomainId)
                    || inputs[i].riskDomainVersion != definition.riskDomainVersion
            ) revert CrossRiskDomainCompression();
            if (CollateralId.unwrap(inputs[i].collateralId) != CollateralId.unwrap(definition.collateralId)) {
                revert CrossCollateralCompression();
            }
        }
        for (uint256 i; i < successors.length; ++i) {
            if (
                RiskDomainId.unwrap(successors[i].riskDomainId) != RiskDomainId.unwrap(definition.riskDomainId)
                    || successors[i].riskDomainVersion != definition.riskDomainVersion
            ) revert CrossRiskDomainCompression();
            if (CollateralId.unwrap(successors[i].collateralId) != CollateralId.unwrap(definition.collateralId)) {
                revert CrossCollateralCompression();
            }
        }
        for (uint256 i; i < replacement.length; ++i) {
            if (CollateralId.unwrap(replacement[i].collateralId) != CollateralId.unwrap(definition.collateralId)) {
                revert CrossCollateralCompression();
            }
        }
    }

    function _requireExposureConserved(
        AccountId accountId,
        CompressionPosition memory key,
        CompressionPosition[] memory inputs,
        CompressionSuccessor[] memory successors
    ) private pure {
        int256 beforeExposure = _inputExposure(
            accountId, key.seriesId, key.seriesVersion, key.entryPriceTicks, key.economicsHash, inputs
        );
        int256 afterExposure = _successorExposure(
            accountId, key.seriesId, key.seriesVersion, key.entryPriceTicks, key.economicsHash, successors
        );
        if (beforeExposure != afterExposure) {
            revert ExposureNotConserved(AccountId.unwrap(accountId), SeriesId.unwrap(key.seriesId), key.economicsHash);
        }
    }

    function _requireSuccessorExposureConserved(
        AccountId accountId,
        CompressionSuccessor memory key,
        CompressionPosition[] memory inputs,
        CompressionSuccessor[] memory successors
    ) private pure {
        int256 beforeExposure = _inputExposure(
            accountId, key.seriesId, key.seriesVersion, key.entryPriceTicks, key.economicsHash, inputs
        );
        int256 afterExposure = _successorExposure(
            accountId, key.seriesId, key.seriesVersion, key.entryPriceTicks, key.economicsHash, successors
        );
        if (beforeExposure != afterExposure) {
            revert ExposureNotConserved(AccountId.unwrap(accountId), SeriesId.unwrap(key.seriesId), key.economicsHash);
        }
    }

    function _inputExposure(
        AccountId accountId,
        SeriesId seriesId,
        uint32 seriesVersion,
        PriceTicks entryPriceTicks,
        bytes32 economicsHash,
        CompressionPosition[] memory inputs
    ) private pure returns (int256 exposure) {
        for (uint256 i; i < inputs.length; ++i) {
            if (!_sameEconomics(seriesId, seriesVersion, entryPriceTicks, economicsHash, inputs[i])) continue;
            int256 lots = int256(uint256(Lots.unwrap(inputs[i].lots)));
            if (AccountId.unwrap(inputs[i].longAccountId) == AccountId.unwrap(accountId)) exposure += lots;
            if (AccountId.unwrap(inputs[i].shortAccountId) == AccountId.unwrap(accountId)) exposure -= lots;
        }
    }

    function _successorExposure(
        AccountId accountId,
        SeriesId seriesId,
        uint32 seriesVersion,
        PriceTicks entryPriceTicks,
        bytes32 economicsHash,
        CompressionSuccessor[] memory successors
    ) private pure returns (int256 exposure) {
        for (uint256 i; i < successors.length; ++i) {
            if (!_sameSuccessorEconomics(seriesId, seriesVersion, entryPriceTicks, economicsHash, successors[i])) continue;
            int256 lots = int256(uint256(Lots.unwrap(successors[i].lots)));
            if (AccountId.unwrap(successors[i].longAccountId) == AccountId.unwrap(accountId)) exposure += lots;
            if (AccountId.unwrap(successors[i].shortAccountId) == AccountId.unwrap(accountId)) exposure -= lots;
        }
    }

    function _sameEconomics(
        SeriesId seriesId,
        uint32 seriesVersion,
        PriceTicks entryPriceTicks,
        bytes32 economicsHash,
        CompressionPosition memory position
    ) private pure returns (bool) {
        return SeriesId.unwrap(position.seriesId) == SeriesId.unwrap(seriesId)
            && position.seriesVersion == seriesVersion
            && PriceTicks.unwrap(position.entryPriceTicks) == PriceTicks.unwrap(entryPriceTicks)
            && position.economicsHash == economicsHash;
    }

    function _sameSuccessorEconomics(
        SeriesId seriesId,
        uint32 seriesVersion,
        PriceTicks entryPriceTicks,
        bytes32 economicsHash,
        CompressionSuccessor memory successor
    ) private pure returns (bool) {
        return SeriesId.unwrap(successor.seriesId) == SeriesId.unwrap(seriesId)
            && successor.seriesVersion == seriesVersion
            && PriceTicks.unwrap(successor.entryPriceTicks) == PriceTicks.unwrap(entryPriceTicks)
            && successor.economicsHash == economicsHash;
    }

    function _inputLiability(AccountId accountId, CompressionPosition[] memory inputs)
        private
        pure
        returns (uint256 liability)
    {
        for (uint256 i; i < inputs.length; ++i) {
            if (AccountId.unwrap(inputs[i].longAccountId) == AccountId.unwrap(accountId)) {
                liability += inputs[i].longTerminalLiabilityBaseUnits;
            }
            if (AccountId.unwrap(inputs[i].shortAccountId) == AccountId.unwrap(accountId)) {
                liability += inputs[i].shortTerminalLiabilityBaseUnits;
            }
        }
    }

    function _successorLiability(AccountId accountId, CompressionSuccessor[] memory successors)
        private
        pure
        returns (uint256 liability)
    {
        for (uint256 i; i < successors.length; ++i) {
            if (AccountId.unwrap(successors[i].longAccountId) == AccountId.unwrap(accountId)) {
                liability += successors[i].longTerminalLiabilityBaseUnits;
            }
            if (AccountId.unwrap(successors[i].shortAccountId) == AccountId.unwrap(accountId)) {
                liability += successors[i].shortTerminalLiabilityBaseUnits;
            }
        }
    }
}
