// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {ICollateralVault} from "./ICollateralVault.sol";
import {IFeeScheduleRegistry} from "./IFeeScheduleRegistry.sol";
import {
    FeeActionRequest,
    FeeActionResult,
    FeeComputation,
    FeeLedgerEntryKind,
    FeeRecipientSet,
    FeeRule
} from "../types/FeeEngineTypes.sol";
import {AccountId, CollateralLockId, FeeActionId, FeeScheduleId} from "../types/Identifiers.sol";

interface IFundedFeeEngine {
    function CHARGE_FUNDING_PURPOSE() external view returns (bytes32);
    function BUDGET_FUNDING_PURPOSE() external view returns (bytes32);

    event FeeWitnessInstalled(
        FeeScheduleId indexed feeScheduleId,
        uint32 indexed feeScheduleVersion,
        bytes32 indexed versionHash,
        bytes32 feeRulesHash,
        bytes32 recipientsHash,
        address installer
    );

    event FeeActionConsumed(
        bytes32 indexed consumptionId,
        bytes32 indexed parentActionId,
        FeeActionId indexed actionId,
        FeeScheduleId feeScheduleId,
        uint32 feeScheduleVersion,
        uint128 notionalMinor,
        uint128 qualifyingVolumeMinor,
        uint128 maxFeeMinor,
        FeeComputation computation,
        bytes32 resultHash,
        address consumer
    );

    event FeeLedgerEntryRecorded(
        bytes32 indexed consumptionId,
        FeeLedgerEntryKind indexed kind,
        FeeActionId indexed actionId,
        AccountId accountId,
        int256 amountMinor
    );

    error ZeroInitialAdmin();
    error ZeroFeeScheduleRegistry();
    error FeeScheduleRegistryHasNoCode(address dependency);
    error ZeroCollateralVault();
    error CollateralVaultHasNoCode(address dependency);
    error SettlementRegistryMismatch(address expected, address actual);
    error UnknownFeeScheduleVersion(FeeScheduleId feeScheduleId, uint32 version);
    error FeeScheduleRecordMismatch(FeeScheduleId feeScheduleId, uint32 version);
    error FeeRulesCommitmentMismatch(bytes32 expected, bytes32 actual);
    error FeeRecipientsCommitmentMismatch(bytes32 expected, bytes32 actual);
    error FeeWitnessAlreadyInstalled(FeeScheduleId feeScheduleId, uint32 version);
    error FeeWitnessNotInstalled(FeeScheduleId feeScheduleId, uint32 version);
    error FeeScheduleNotOpen(FeeScheduleId feeScheduleId, uint32 version);
    error FeeActionAlreadyConsumed(bytes32 consumptionId);
    error InvalidFeeConsumptionId(bytes32 expected, bytes32 supplied);
    error ZeroParentActionId();
    error FeeAboveMaximum(uint128 maximum, uint128 actual);
    error MissingChargePayer();
    error MissingRebateRecipient();
    error FundingLockRequired(bytes32 consumptionId, bytes32 purpose);
    error FundingLockUnexpected(bytes32 consumptionId, bytes32 purpose);
    error FundingLockMismatch(CollateralLockId lockId, bytes32 purpose);
    error LegacyScheduleUnsupported(FeeScheduleId feeScheduleId, uint32 version);
    error LegacyFeeAboveOrderMaximum(bytes32 orderHash, uint128 maximum, uint128 actual);
    error LedgerDoesNotConserve(int256 netAmount);

    function feeScheduleRegistry() external view returns (IFeeScheduleRegistry);
    function collateralVault() external view returns (ICollateralVault);
    function installScheduleWitness(
        FeeScheduleId feeScheduleId,
        uint32 feeScheduleVersion,
        FeeRule[] calldata rules,
        FeeRecipientSet calldata recipients
    ) external;
    function consumeFeeAction(FeeActionRequest calldata request) external returns (FeeActionResult memory result);
    function previewFeeAction(
        FeeScheduleId feeScheduleId,
        uint32 feeScheduleVersion,
        FeeActionId actionId,
        uint128 notionalMinor,
        uint128 qualifyingVolumeMinor
    ) external view returns (FeeComputation memory computation);
    function deriveConsumptionId(
        bytes32 parentActionId,
        FeeScheduleId feeScheduleId,
        uint32 feeScheduleVersion,
        FeeActionId actionId,
        AccountId chargePayerAccountId,
        AccountId rebateRecipientAccountId,
        uint32 actionOrdinal
    ) external view returns (bytes32);
    function deriveFundingReference(bytes32 consumptionId, bytes32 purpose) external view returns (bytes32);
    function witnessInstalled(FeeScheduleId feeScheduleId, uint32 feeScheduleVersion) external view returns (bool);
    function feeActionConsumed(bytes32 consumptionId) external view returns (bool);
    function getScheduleWitness(FeeScheduleId feeScheduleId, uint32 feeScheduleVersion)
        external
        view
        returns (FeeRule[] memory rules, FeeRecipientSet memory recipients);
}
