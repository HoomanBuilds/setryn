// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {AdapterId, AdapterKindId, AssetId, RiskDomainId, RiskModelId} from "../types/Identifiers.sol";
import {RiskDomainDefinition} from "../types/RiskDomainDefinition.sol";
import {IdLib} from "./IdLib.sol";

error ZeroRiskDomainNamespaceId();

error ZeroRiskDomainKey();

error ZeroRiskModelId();

error ZeroRiskDomainCollateralAssetId();

error ZeroRiskDomainCollateralAssetVersion();

error ZeroRiskDomainAdapterId();

error ZeroRiskDomainAdapterVersion();

error ZeroRiskDomainRequiredAdapterKindId();

error ZeroRiskDomainRequiredInterfaceHash();

error ZeroRiskDomainRequiredCapabilityHash();

error ZeroMarginRulesHash();

error ZeroScenarioSetHash();

error ZeroConcentrationRulesHash();

error ZeroDefaultProcessHash();

error ZeroInsurancePolicyHash();

error ZeroRiskDomainEvidenceHash();

error ZeroMaxOpenInterest();

error ZeroMaxAggregateLiability();

error ZeroMaxAccountLiability();

/// @dev One account may never be permitted to owe more than the whole domain may owe.
error AccountLiabilityExceedsAggregate(uint128 maxAccountLiabilityBaseUnits, uint128 maxAggregateLiabilityBaseUnits);

/// @dev Reservations are enabled by both reservation caps together and disabled by both at zero. One
/// zero and one nonzero is a partial envelope: a whole-domain reservation ceiling with no per-account
/// ceiling, or a per-account ceiling with no whole-domain ceiling, is incoherent rather than a
/// policy.
error PartialReservationEnablement(uint128 maxAggregateReservationBaseUnits, uint128 maxAccountReservationBaseUnits);

/// @dev One account may never be permitted to reserve more than the whole domain may reserve.
error AccountReservationExceedsAggregateReservation(
    uint128 maxAccountReservationBaseUnits, uint128 maxAggregateReservationBaseUnits
);

/// @dev A reservation is a pre-commitment against liability headroom at its own scope, so the
/// whole-domain reservation envelope may never exceed the whole-domain liability envelope.
error AggregateReservationExceedsAggregateLiability(
    uint128 maxAggregateReservationBaseUnits, uint128 maxAggregateLiabilityBaseUnits
);

/// @dev The per-account reservation envelope may never exceed that account's own liability headroom.
error AccountReservationExceedsAccountLiability(
    uint128 maxAccountReservationBaseUnits, uint128 maxAccountLiabilityBaseUnits
);

library RiskDomainDefinitionLib {
    /// @dev Published tags for the risk models V1 consumers are expected to meet first. They are
    /// convenience constants only. Registration and hashing accept any nonzero RiskModelId, so a
    /// model invented after this deployment needs no change here, and a risk engine must still
    /// require the exact model it implements instead of assuming this list is exhaustive.
    RiskModelId internal constant RISK_MODEL_ISOLATED_MARGIN =
        RiskModelId.wrap(keccak256("SetrynRiskModelV1:IsolatedMargin"));
    RiskModelId internal constant RISK_MODEL_PORTFOLIO_MARGIN =
        RiskModelId.wrap(keccak256("SetrynRiskModelV1:PortfolioMargin"));
    RiskModelId internal constant RISK_MODEL_SCENARIO_GRID =
        RiskModelId.wrap(keccak256("SetrynRiskModelV1:ScenarioGrid"));
    RiskModelId internal constant RISK_MODEL_FULLY_COLLATERALIZED =
        RiskModelId.wrap(keccak256("SetrynRiskModelV1:FullyCollateralized"));

    /// @dev The typestring is kept beside the typehash so a test can prove they agree. Solidity
    /// cannot hash a string constant inside another constant initializer, so the literal is repeated
    /// rather than referenced.
    ///
    /// @dev Each literal carries its version. A hashing rule may never be edited in place; it is
    /// replaced by a new V2 literal, so previously derived hashes can never silently re-derive.
    ///
    /// @dev The identity key is deliberately minimal: the namespaced domain name and nothing else.
    /// Retuning margin, replacing the scenario set, changing risk model, repointing at a newer
    /// collateral binding or adapter version, and deploying on another chain all stay the same
    /// RiskDomainId under a new chain-local version, which is what keeps a domain reference inside
    /// an open position, a default record, or a stored receipt stable across retunings.
    string internal constant RISK_DOMAIN_KEY_TYPESTRING =
        "SetrynRiskDomainKeyV1(bytes32 namespaceId,bytes32 domainKey)";
    bytes32 internal constant RISK_DOMAIN_KEY_TYPEHASH =
        keccak256("SetrynRiskDomainKeyV1(bytes32 namespaceId,bytes32 domainKey)");

    /// @dev chainId is hashed in deliberately, the opposite of canonical identity. The collateral
    /// binding and the adapter version are chain-local operational dependencies and every cap below
    /// is denominated in that chain-local token, so the same risk policy qualified on two chains
    /// must never share one commitment.
    string internal constant RISK_DOMAIN_DEFINITION_TYPESTRING =
        "SetrynRiskDomainDefinitionV1(bytes32 namespaceId,bytes32 domainKey,bytes32 riskModelId,bytes32 collateralAssetId,uint32 collateralAssetVersion,bytes32 riskAdapterId,uint32 riskAdapterVersion,bytes32 requiredAdapterKindId,bytes32 requiredInterfaceHash,bytes32 requiredCapabilityHash,bytes32 marginRulesHash,bytes32 scenarioSetHash,bytes32 concentrationRulesHash,bytes32 defaultProcessHash,bytes32 insurancePolicyHash,bytes32 qualificationEvidenceHash,uint128 maxOpenInterestBaseUnits,uint128 maxAggregateLiabilityBaseUnits,uint128 maxAccountLiabilityBaseUnits,uint128 maxAggregateReservationBaseUnits,uint128 maxAccountReservationBaseUnits,uint256 chainId)";
    bytes32 internal constant RISK_DOMAIN_DEFINITION_TYPEHASH = keccak256(
        "SetrynRiskDomainDefinitionV1(bytes32 namespaceId,bytes32 domainKey,bytes32 riskModelId,bytes32 collateralAssetId,uint32 collateralAssetVersion,bytes32 riskAdapterId,uint32 riskAdapterVersion,bytes32 requiredAdapterKindId,bytes32 requiredInterfaceHash,bytes32 requiredCapabilityHash,bytes32 marginRulesHash,bytes32 scenarioSetHash,bytes32 concentrationRulesHash,bytes32 defaultProcessHash,bytes32 insurancePolicyHash,bytes32 qualificationEvidenceHash,uint128 maxOpenInterestBaseUnits,uint128 maxAggregateLiabilityBaseUnits,uint128 maxAccountLiabilityBaseUnits,uint128 maxAggregateReservationBaseUnits,uint128 maxAccountReservationBaseUnits,uint256 chainId)"
    );

    /// @dev The version commitment binds the lineage identity, the sequence number, and the chain to
    /// the definition, so a stored record can never be replayed as a different version of itself, as
    /// a version of a different domain, or as the same version on another chain.
    string internal constant RISK_DOMAIN_VERSION_TYPESTRING =
        "SetrynRiskDomainVersionV1(bytes32 riskDomainId,uint32 version,bytes32 definitionHash,uint256 chainId)";
    bytes32 internal constant RISK_DOMAIN_VERSION_TYPEHASH = keccak256(
        "SetrynRiskDomainVersionV1(bytes32 riskDomainId,uint32 version,bytes32 definitionHash,uint256 chainId)"
    );

    /// @dev Checks only what the definition can be judged on by itself. Existence, exact
    /// compatibility, and current status of the collateral binding and the risk adapter belong to
    /// the registry, which owns the external reads.
    function validate(RiskDomainDefinition memory definition) internal pure {
        _validateIdentity(definition);
        _validateDependencyFields(definition);
        _validateCommitments(definition);
        _validateCaps(definition);
    }

    /// @dev Hashes the identity key alone, so retuning margin, replacing the scenario set, changing
    /// risk model, or repointing at a newer collateral binding or adapter version can never mint a
    /// second identity for the same namespaced domain name.
    function hashKey(RiskDomainDefinition memory definition) internal pure returns (bytes32) {
        return keccak256(abi.encode(RISK_DOMAIN_KEY_TYPEHASH, definition.namespaceId, definition.domainKey));
    }

    /// @dev Hashes every field plus the chain, so two qualifications of one lineage that would have
    /// disagreed on the model, either dependency version, any compatibility requirement, any of the
    /// six commitments, or any of the five caps are distinct and the duplicate check is exact.
    ///
    /// @dev The encoding is split across two abi.encode calls purely to keep the twenty-two values
    /// off one stack frame. Every field is a static type, so the concatenation is byte-identical to
    /// the single ABI encoding the typestring describes, which `hashDefinitionUnsplit` proves.
    function hashDefinition(RiskDomainDefinition memory definition, uint256 chainId) internal pure returns (bytes32) {
        return keccak256(
            bytes.concat(
                abi.encode(
                    RISK_DOMAIN_DEFINITION_TYPEHASH,
                    definition.namespaceId,
                    definition.domainKey,
                    RiskModelId.unwrap(definition.riskModelId),
                    AssetId.unwrap(definition.collateralAssetId),
                    definition.collateralAssetVersion,
                    AdapterId.unwrap(definition.riskAdapterId),
                    definition.riskAdapterVersion,
                    AdapterKindId.unwrap(definition.requiredAdapterKindId),
                    definition.requiredInterfaceHash,
                    definition.requiredCapabilityHash
                ),
                abi.encode(
                    definition.marginRulesHash,
                    definition.scenarioSetHash,
                    definition.concentrationRulesHash,
                    definition.defaultProcessHash,
                    definition.insurancePolicyHash,
                    definition.qualificationEvidenceHash,
                    definition.maxOpenInterestBaseUnits,
                    definition.maxAggregateLiabilityBaseUnits,
                    definition.maxAccountLiabilityBaseUnits,
                    definition.maxAggregateReservationBaseUnits,
                    definition.maxAccountReservationBaseUnits,
                    chainId
                )
            )
        );
    }

    /// @dev The same commitment expressed as one ABI encoding of the whole tuple. It exists so a
    /// test can prove the split encoding above is not a different commitment, and it is never used
    /// on a write path.
    function hashDefinitionUnsplit(RiskDomainDefinition memory definition, uint256 chainId)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(bytes.concat(abi.encode(RISK_DOMAIN_DEFINITION_TYPEHASH, definition), abi.encode(chainId)));
    }

    function hashVersion(RiskDomainId riskDomainId, uint32 version, bytes32 definitionHash, uint256 chainId)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                RISK_DOMAIN_VERSION_TYPEHASH, RiskDomainId.unwrap(riskDomainId), version, definitionHash, chainId
            )
        );
    }

    function deriveRiskDomainId(RiskDomainDefinition memory definition) internal pure returns (RiskDomainId) {
        return IdLib.deriveRiskDomainId(hashKey(definition));
    }

    function _validateIdentity(RiskDomainDefinition memory definition) private pure {
        if (definition.namespaceId == bytes32(0)) {
            revert ZeroRiskDomainNamespaceId();
        }
        if (definition.domainKey == bytes32(0)) {
            revert ZeroRiskDomainKey();
        }
        if (RiskModelId.unwrap(definition.riskModelId) == bytes32(0)) {
            revert ZeroRiskModelId();
        }
    }

    function _validateDependencyFields(RiskDomainDefinition memory definition) private pure {
        if (AssetId.unwrap(definition.collateralAssetId) == bytes32(0)) {
            revert ZeroRiskDomainCollateralAssetId();
        }
        if (definition.collateralAssetVersion == 0) {
            revert ZeroRiskDomainCollateralAssetVersion();
        }
        if (AdapterId.unwrap(definition.riskAdapterId) == bytes32(0)) {
            revert ZeroRiskDomainAdapterId();
        }
        if (definition.riskAdapterVersion == 0) {
            revert ZeroRiskDomainAdapterVersion();
        }
        if (AdapterKindId.unwrap(definition.requiredAdapterKindId) == bytes32(0)) {
            revert ZeroRiskDomainRequiredAdapterKindId();
        }
        if (definition.requiredInterfaceHash == bytes32(0)) {
            revert ZeroRiskDomainRequiredInterfaceHash();
        }
        if (definition.requiredCapabilityHash == bytes32(0)) {
            revert ZeroRiskDomainRequiredCapabilityHash();
        }
    }

    function _validateCommitments(RiskDomainDefinition memory definition) private pure {
        if (definition.marginRulesHash == bytes32(0)) {
            revert ZeroMarginRulesHash();
        }
        if (definition.scenarioSetHash == bytes32(0)) {
            revert ZeroScenarioSetHash();
        }
        if (definition.concentrationRulesHash == bytes32(0)) {
            revert ZeroConcentrationRulesHash();
        }
        if (definition.defaultProcessHash == bytes32(0)) {
            revert ZeroDefaultProcessHash();
        }
        if (definition.insurancePolicyHash == bytes32(0)) {
            revert ZeroInsurancePolicyHash();
        }
        if (definition.qualificationEvidenceHash == bytes32(0)) {
            revert ZeroRiskDomainEvidenceHash();
        }
    }

    /// @dev Zero is never a legitimate open interest or liability cap, unlike a fee lever that can be
    /// switched off: a domain that may carry no notional exposure or absorb no loss is inert, and an
    /// inert clearing perimeter is a qualification mistake rather than a policy.
    ///
    /// @dev The two reservation caps are the one optional part of the envelope, because reservations
    /// are an optional execution capability. Both zero disables reservation-backed quote modes for
    /// this domain; both nonzero enables them under the containment rules below. One zero and one
    /// nonzero is refused as a partial envelope.
    ///
    /// @dev Every asserted relationship is containment of one measure inside a wider one at the same
    /// or a wider scope. Open interest is notional exposure while the liability and reservation caps
    /// are loss exposure; they are different risk measures with no objective ordering, so none is
    /// invented. Accepting these caps proves nothing about solvency, insurance funding, margin
    /// sufficiency, or market behavior: the clearing engine must compute and enforce all of those
    /// against live state.
    function _validateCaps(RiskDomainDefinition memory definition) private pure {
        if (definition.maxOpenInterestBaseUnits == 0) {
            revert ZeroMaxOpenInterest();
        }
        if (definition.maxAggregateLiabilityBaseUnits == 0) {
            revert ZeroMaxAggregateLiability();
        }
        if (definition.maxAccountLiabilityBaseUnits == 0) {
            revert ZeroMaxAccountLiability();
        }
        if (definition.maxAccountLiabilityBaseUnits > definition.maxAggregateLiabilityBaseUnits) {
            revert AccountLiabilityExceedsAggregate(
                definition.maxAccountLiabilityBaseUnits, definition.maxAggregateLiabilityBaseUnits
            );
        }
        _validateReservationCaps(definition);
    }

    function _validateReservationCaps(RiskDomainDefinition memory definition) private pure {
        uint128 aggregateReservation = definition.maxAggregateReservationBaseUnits;
        uint128 accountReservation = definition.maxAccountReservationBaseUnits;

        if (aggregateReservation == 0 && accountReservation == 0) {
            return;
        }
        if (aggregateReservation == 0 || accountReservation == 0) {
            revert PartialReservationEnablement(aggregateReservation, accountReservation);
        }
        if (accountReservation > aggregateReservation) {
            revert AccountReservationExceedsAggregateReservation(accountReservation, aggregateReservation);
        }
        if (aggregateReservation > definition.maxAggregateLiabilityBaseUnits) {
            revert AggregateReservationExceedsAggregateLiability(
                aggregateReservation, definition.maxAggregateLiabilityBaseUnits
            );
        }
        if (accountReservation > definition.maxAccountLiabilityBaseUnits) {
            revert AccountReservationExceedsAccountLiability(
                accountReservation, definition.maxAccountLiabilityBaseUnits
            );
        }
    }
}
