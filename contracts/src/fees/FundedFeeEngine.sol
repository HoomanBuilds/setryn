// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IClearingFeePolicy} from "../interfaces/IClearingFeePolicy.sol";
import {ICollateralVault} from "../interfaces/ICollateralVault.sol";
import {IFeeScheduleRegistry} from "../interfaces/IFeeScheduleRegistry.sol";
import {IFundedFeeEngine} from "../interfaces/IFundedFeeEngine.sol";
import {FeeEngineLib} from "../libraries/FeeEngineLib.sol";
import {FeeScheduleDefinitionLib} from "../libraries/FeeScheduleDefinitionLib.sol";
import {CollateralLock} from "../types/CollateralTypes.sol";
import {ClearingFeeQuote} from "../types/ClearingTypes.sol";
import {LockStatus} from "../types/Enums.sol";
import {
    FeeActionRequest,
    FeeActionResult,
    FeeComputation,
    FeeLedgerEntry,
    FeeLedgerEntryKind,
    FeeRecipientSet,
    FeeRule
} from "../types/FeeEngineTypes.sol";
import {FeeScheduleDefinition, FeeScheduleVersion} from "../types/FeeScheduleDefinition.sol";
import {AccountId, AssetId, CollateralId, CollateralLockId, FeeActionId, FeeScheduleId} from "../types/Identifiers.sol";
import {PublicOrder} from "../types/OrderTypes.sol";
import {FeeRatePpm, Lots, PriceTicks} from "../types/Units.sol";

contract FundedFeeEngine is IFundedFeeEngine, IClearingFeePolicy, AccessControlDefaultAdminRules, ReentrancyGuard {
    bytes32 public constant FEE_ACTION_CONSUMER_ROLE = keccak256("SETRYN_FEE_ACTION_CONSUMER_ROLE");
    bytes32 public constant CHARGE_FUNDING_PURPOSE = keccak256("SETRYN_FEE_ACTION_CHARGE");
    bytes32 public constant BUDGET_FUNDING_PURPOSE = keccak256("SETRYN_FEE_ACTION_BUDGET");
    bytes32 public constant LEGACY_CHARGE_ONLY_CAPABILITY =
        keccak256("SetrynLegacyClearingFeePolicyV1:FlatChargeOnly:SingleCollector:NoRebates");

    bytes32 private constant CONSUMPTION_ID_TYPEHASH = keccak256(
        "SetrynFeeConsumptionIdV1(uint256 chainId,address feeEngine,bytes32 parentActionId,bytes32 feeScheduleId,uint32 feeScheduleVersion,bytes32 actionId,bytes32 chargePayerAccountId,bytes32 rebateRecipientAccountId,uint32 actionOrdinal)"
    );
    bytes32 private constant FUNDING_REFERENCE_TYPEHASH = keccak256(
        "SetrynFeeFundingReferenceV1(uint256 chainId,address feeEngine,bytes32 consumptionId,bytes32 purpose)"
    );
    bytes32 private constant RESULT_TYPEHASH = keccak256(
        "SetrynFeeActionResultV1(bytes32 consumptionId,bytes32 parentActionId,bytes32 feeScheduleId,uint32 feeScheduleVersion,bytes32 actionId,uint128 notionalMinor,uint128 qualifyingVolumeMinor,uint128 maxFeeMinor,uint128 chargeMinor,uint128 rebateMinor,uint32 chargeRatePpm,uint32 rebateRatePpm,uint128 flatChargeMinor,uint128 flatRebateMinor,uint16 tierIndex,bytes32 entriesHash)"
    );
    bytes32 private constant ENTRY_TYPEHASH =
        keccak256("SetrynFeeLedgerEntryV1(uint8 kind,bytes32 actionId,bytes32 accountId,int256 amountMinor)");

    IFeeScheduleRegistry private immutable _feeScheduleRegistry;
    ICollateralVault private immutable _collateralVault;

    mapping(bytes32 scheduleKey => bytes encodedRules) private _rules;
    mapping(bytes32 scheduleKey => bytes encodedRecipients) private _recipients;
    mapping(bytes32 consumptionId => bool consumed) private _consumed;

    constructor(
        uint48 defaultAdminDelay,
        address initialAdmin,
        IFeeScheduleRegistry feeScheduleRegistry_,
        ICollateralVault collateralVault_
    ) AccessControlDefaultAdminRules(defaultAdminDelay, _requireInitialAdmin(initialAdmin)) {
        if (address(feeScheduleRegistry_) == address(0)) revert ZeroFeeScheduleRegistry();
        if (address(feeScheduleRegistry_).code.length == 0) {
            revert FeeScheduleRegistryHasNoCode(address(feeScheduleRegistry_));
        }
        if (address(collateralVault_) == address(0)) revert ZeroCollateralVault();
        if (address(collateralVault_).code.length == 0) {
            revert CollateralVaultHasNoCode(address(collateralVault_));
        }
        address expectedSettlementRegistry = address(feeScheduleRegistry_.settlementAssetRegistry());
        address actualSettlementRegistry = address(collateralVault_.settlementAssetRegistry());
        if (expectedSettlementRegistry != actualSettlementRegistry) {
            revert SettlementRegistryMismatch(expectedSettlementRegistry, actualSettlementRegistry);
        }
        _feeScheduleRegistry = feeScheduleRegistry_;
        _collateralVault = collateralVault_;
        _grantRole(FEE_ACTION_CONSUMER_ROLE, initialAdmin);
    }

    function installScheduleWitness(
        FeeScheduleId feeScheduleId,
        uint32 feeScheduleVersion,
        FeeRule[] calldata rules,
        FeeRecipientSet calldata recipients
    ) external {
        FeeScheduleVersion memory schedule = _requireSchedule(feeScheduleId, feeScheduleVersion, false);
        bytes32 key = _scheduleKey(feeScheduleId, feeScheduleVersion);
        if (_rules[key].length != 0) revert FeeWitnessAlreadyInstalled(feeScheduleId, feeScheduleVersion);

        FeeRule[] memory ruleWitness = rules;
        FeeRecipientSet memory recipientWitness = recipients;
        FeeEngineLib.validateRules(schedule.definition, ruleWitness);
        FeeEngineLib.validateRecipients(recipientWitness);
        bytes32 rulesHash = FeeEngineLib.hashRules(ruleWitness);
        bytes32 recipientsHash = FeeEngineLib.hashRecipients(recipientWitness);
        if (rulesHash != schedule.definition.feeRulesHash) {
            revert FeeRulesCommitmentMismatch(schedule.definition.feeRulesHash, rulesHash);
        }
        if (recipientsHash != schedule.definition.recipientsHash) {
            revert FeeRecipientsCommitmentMismatch(schedule.definition.recipientsHash, recipientsHash);
        }
        for (uint256 i; i < recipientWitness.recipients.length; ++i) {
            AccountId recipientAccount = recipientWitness.recipients[i].accountId;
            if (!_collateralVault.accountExists(recipientAccount)) {
                revert UnknownFeeRecipient(recipientAccount);
            }
        }

        _rules[key] = abi.encode(ruleWitness);
        _recipients[key] = abi.encode(recipientWitness);
        emit FeeWitnessInstalled(
            feeScheduleId, feeScheduleVersion, schedule.versionHash, rulesHash, recipientsHash, msg.sender
        );
    }

    function consumeFeeAction(FeeActionRequest calldata request)
        external
        nonReentrant
        onlyRole(FEE_ACTION_CONSUMER_ROLE)
        returns (FeeActionResult memory result)
    {
        if (request.parentActionId == bytes32(0)) revert ZeroParentActionId();
        bytes32 expectedConsumptionId = _deriveConsumptionId(request);
        if (request.consumptionId != expectedConsumptionId) {
            revert InvalidFeeConsumptionId(expectedConsumptionId, request.consumptionId);
        }
        if (_consumed[request.consumptionId]) revert FeeActionAlreadyConsumed(request.consumptionId);

        (FeeScheduleVersion memory schedule, FeeRule[] memory rules, FeeRecipientSet memory recipients) =
            _loadWitness(request.feeScheduleId, request.feeScheduleVersion);
        FeeRule memory rule = FeeEngineLib.findRule(rules, request.actionId);
        if (rule.requiresOpenSchedule) {
            if (!_feeScheduleRegistry.isOpenForNewRisk(request.feeScheduleId, request.feeScheduleVersion)) {
                revert FeeScheduleNotOpen(request.feeScheduleId, request.feeScheduleVersion);
            }
        }
        FeeComputation memory computation =
            FeeEngineLib.compute(schedule.definition, rule, request.notionalMinor, request.qualifyingVolumeMinor);
        if (computation.chargeMinor > request.maxFeeMinor) {
            revert FeeAboveMaximum(request.maxFeeMinor, computation.chargeMinor);
        }
        if (computation.chargeMinor != 0 && AccountId.unwrap(request.chargePayerAccountId) == bytes32(0)) {
            revert MissingChargePayer();
        }
        if (computation.rebateMinor != 0 && AccountId.unwrap(request.rebateRecipientAccountId) == bytes32(0)) {
            revert MissingRebateRecipient();
        }

        uint128[] memory chargeSplits = FeeEngineLib.splitCharge(computation.chargeMinor, recipients);
        _requireFundingLock(
            request.consumptionId,
            CHARGE_FUNDING_PURPOSE,
            request.chargeLockId,
            schedule.definition,
            request.chargePayerAccountId,
            computation.chargeMinor
        );
        CollateralLock memory budgetLock = _requireFundingLock(
            request.consumptionId,
            BUDGET_FUNDING_PURPOSE,
            request.budgetLockId,
            schedule.definition,
            AccountId.wrap(bytes32(0)),
            computation.rebateMinor
        );

        FeeLedgerEntry[] memory entries = _buildEntries(
            request.actionId,
            request.chargePayerAccountId,
            request.rebateRecipientAccountId,
            budgetLock.accountId,
            recipients,
            chargeSplits,
            computation
        );
        bytes32 resultHash = _hashResult(request, computation, entries);

        _consumed[request.consumptionId] = true;
        for (uint256 i; i < chargeSplits.length; ++i) {
            if (chargeSplits[i] != 0) {
                _collateralVault.consumeLock(request.chargeLockId, recipients.recipients[i].accountId, chargeSplits[i]);
            }
        }
        if (computation.rebateMinor != 0) {
            _collateralVault.consumeLock(
                request.budgetLockId, request.rebateRecipientAccountId, computation.rebateMinor
            );
        }

        for (uint256 i; i < entries.length; ++i) {
            emit FeeLedgerEntryRecorded(
                request.consumptionId,
                entries[i].kind,
                entries[i].actionId,
                entries[i].accountId,
                entries[i].amountMinor
            );
        }
        emit FeeActionConsumed(
            request.consumptionId,
            request.parentActionId,
            request.actionId,
            request.feeScheduleId,
            request.feeScheduleVersion,
            request.notionalMinor,
            request.qualifyingVolumeMinor,
            request.maxFeeMinor,
            computation,
            resultHash,
            msg.sender
        );
        return FeeActionResult({
            consumptionId: request.consumptionId,
            resultHash: resultHash,
            feeScheduleId: request.feeScheduleId,
            feeScheduleVersion: request.feeScheduleVersion,
            chargeMinor: computation.chargeMinor,
            rebateMinor: computation.rebateMinor,
            computation: computation,
            entries: entries
        });
    }

    function quoteFees(
        PublicOrder calldata takerOrder,
        PublicOrder calldata makerOrder,
        Lots fillLots,
        PriceTicks executionPriceTicks,
        bytes32 witnessHash
    ) external view returns (ClearingFeeQuote memory quote) {
        if (
            FeeScheduleId.unwrap(takerOrder.feeScheduleId) != FeeScheduleId.unwrap(makerOrder.feeScheduleId)
                || takerOrder.feeScheduleVersion != makerOrder.feeScheduleVersion
        ) revert LegacyScheduleUnsupported(takerOrder.feeScheduleId, takerOrder.feeScheduleVersion);
        (FeeScheduleVersion memory schedule, FeeRule[] memory rules, FeeRecipientSet memory recipients) =
            _loadWitness(takerOrder.feeScheduleId, takerOrder.feeScheduleVersion);
        if (!_feeScheduleRegistry.isOpenForNewRisk(takerOrder.feeScheduleId, takerOrder.feeScheduleVersion)) {
            revert FeeScheduleNotOpen(takerOrder.feeScheduleId, takerOrder.feeScheduleVersion);
        }
        if (recipients.recipients.length != 1) {
            revert LegacyScheduleUnsupported(takerOrder.feeScheduleId, takerOrder.feeScheduleVersion);
        }

        FeeRule memory makerRule = FeeEngineLib.findRule(rules, FeeScheduleDefinitionLib.FEE_ACTION_MAKER_FILL);
        FeeRule memory takerRule = FeeEngineLib.findRule(rules, FeeScheduleDefinitionLib.FEE_ACTION_TAKER_FILL);
        _requireLegacyRule(makerRule, takerOrder.feeScheduleId, takerOrder.feeScheduleVersion);
        _requireLegacyRule(takerRule, takerOrder.feeScheduleId, takerOrder.feeScheduleVersion);
        uint128 makerFee = makerRule.flatChargeMinor;
        uint128 takerFee = takerRule.flatChargeMinor;
        if (makerFee > makerOrder.maxFeeMinor) {
            revert LegacyFeeAboveOrderMaximum(keccak256(abi.encode(makerOrder)), makerOrder.maxFeeMinor, makerFee);
        }
        if (takerFee > takerOrder.maxFeeMinor) {
            revert LegacyFeeAboveOrderMaximum(keccak256(abi.encode(takerOrder)), takerOrder.maxFeeMinor, takerFee);
        }
        quote = ClearingFeeQuote({
            recipientAccountId: recipients.recipients[0].accountId,
            feeScheduleId: takerOrder.feeScheduleId,
            feeScheduleVersion: takerOrder.feeScheduleVersion,
            makerFeeMinor: makerFee,
            takerFeeMinor: takerFee,
            quoteReference: keccak256(
                abi.encode(
                    LEGACY_CHARGE_ONLY_CAPABILITY,
                    schedule.versionHash,
                    FeeEngineLib.hashRules(rules),
                    FeeEngineLib.hashRecipients(recipients),
                    Lots.unwrap(fillLots),
                    PriceTicks.unwrap(executionPriceTicks),
                    witnessHash,
                    makerFee,
                    takerFee
                )
            )
        });
    }

    function previewFeeAction(
        FeeScheduleId feeScheduleId,
        uint32 feeScheduleVersion,
        FeeActionId actionId,
        uint128 notionalMinor,
        uint128 qualifyingVolumeMinor
    ) external view returns (FeeComputation memory computation) {
        (FeeScheduleVersion memory schedule, FeeRule[] memory rules,) = _loadWitness(feeScheduleId, feeScheduleVersion);
        return FeeEngineLib.compute(
            schedule.definition, FeeEngineLib.findRule(rules, actionId), notionalMinor, qualifyingVolumeMinor
        );
    }

    function feeScheduleRegistry() external view returns (IFeeScheduleRegistry) {
        return _feeScheduleRegistry;
    }

    function collateralVault() external view returns (ICollateralVault) {
        return _collateralVault;
    }

    function witnessInstalled(FeeScheduleId feeScheduleId, uint32 feeScheduleVersion) external view returns (bool) {
        return _rules[_scheduleKey(feeScheduleId, feeScheduleVersion)].length != 0;
    }

    function feeActionConsumed(bytes32 consumptionId) external view returns (bool) {
        return _consumed[consumptionId];
    }

    function getScheduleWitness(FeeScheduleId feeScheduleId, uint32 feeScheduleVersion)
        external
        view
        returns (FeeRule[] memory rules, FeeRecipientSet memory recipients)
    {
        (, rules, recipients) = _loadWitness(feeScheduleId, feeScheduleVersion);
    }

    function deriveConsumptionId(
        bytes32 parentActionId,
        FeeScheduleId feeScheduleId,
        uint32 feeScheduleVersion,
        FeeActionId actionId,
        AccountId chargePayerAccountId,
        AccountId rebateRecipientAccountId,
        uint32 actionOrdinal
    ) external view returns (bytes32) {
        return _deriveConsumptionId(
            parentActionId,
            feeScheduleId,
            feeScheduleVersion,
            actionId,
            chargePayerAccountId,
            rebateRecipientAccountId,
            actionOrdinal
        );
    }

    function deriveFundingReference(bytes32 consumptionId, bytes32 purpose) external view returns (bytes32) {
        return _deriveFundingReference(consumptionId, purpose);
    }

    function _loadWitness(FeeScheduleId feeScheduleId, uint32 feeScheduleVersion)
        private
        view
        returns (FeeScheduleVersion memory schedule, FeeRule[] memory rules, FeeRecipientSet memory recipients)
    {
        schedule = _requireSchedule(feeScheduleId, feeScheduleVersion, false);
        bytes32 key = _scheduleKey(feeScheduleId, feeScheduleVersion);
        bytes memory encodedRules = _rules[key];
        if (encodedRules.length == 0) revert FeeWitnessNotInstalled(feeScheduleId, feeScheduleVersion);
        rules = abi.decode(encodedRules, (FeeRule[]));
        recipients = abi.decode(_recipients[key], (FeeRecipientSet));
    }

    function _requireSchedule(FeeScheduleId feeScheduleId, uint32 version, bool requireOpen)
        private
        view
        returns (FeeScheduleVersion memory schedule)
    {
        if (!_feeScheduleRegistry.isLifecycleEnabled(feeScheduleId, version)) {
            revert UnknownFeeScheduleVersion(feeScheduleId, version);
        }
        if (requireOpen && !_feeScheduleRegistry.isOpenForNewRisk(feeScheduleId, version)) {
            revert FeeScheduleNotOpen(feeScheduleId, version);
        }
        schedule = _feeScheduleRegistry.getFeeSchedule(feeScheduleId, version);
        FeeScheduleDefinitionLib.validate(schedule.definition);
        bytes32 definitionHash = FeeScheduleDefinitionLib.hashDefinition(schedule.definition, block.chainid);
        if (
            schedule.version != version
                || FeeScheduleId.unwrap(FeeScheduleDefinitionLib.deriveFeeScheduleId(schedule.definition))
                    != FeeScheduleId.unwrap(feeScheduleId) || schedule.definitionHash != definitionHash
                || schedule.versionHash
                    != FeeScheduleDefinitionLib.hashVersion(feeScheduleId, version, definitionHash, block.chainid)
        ) revert FeeScheduleRecordMismatch(feeScheduleId, version);
    }

    function _requireFundingLock(
        bytes32 consumptionId,
        bytes32 purpose,
        CollateralLockId lockId,
        FeeScheduleDefinition memory definition,
        AccountId expectedAccountId,
        uint128 amount
    ) private view returns (CollateralLock memory lock) {
        if (amount == 0) {
            if (CollateralLockId.unwrap(lockId) != bytes32(0)) {
                revert FundingLockUnexpected(consumptionId, purpose);
            }
            return lock;
        }
        if (CollateralLockId.unwrap(lockId) == bytes32(0)) revert FundingLockRequired(consumptionId, purpose);
        lock = _collateralVault.getLock(lockId);
        bytes32 expectedReference = _deriveFundingReference(consumptionId, purpose);
        CollateralLockId expectedLockId = _collateralVault.deriveLockId(lock.operator, expectedReference);
        CollateralId expectedCollateral =
            _collateralVault.deriveCollateralId(definition.settlementAssetId, definition.settlementAssetVersion);
        if (
            CollateralLockId.unwrap(expectedLockId) != CollateralLockId.unwrap(lockId)
                || lock.lockReference != expectedReference || lock.settlementOperator != address(this)
                || lock.status != LockStatus.Active || lock.remainingAmount != amount || block.timestamp >= lock.expiry
                || CollateralId.unwrap(lock.collateralId) != CollateralId.unwrap(expectedCollateral)
                || AssetId.unwrap(lock.assetId) != AssetId.unwrap(definition.settlementAssetId)
                || lock.bindingVersion != definition.settlementAssetVersion
                || (AccountId.unwrap(expectedAccountId) != bytes32(0)
                    && AccountId.unwrap(lock.accountId) != AccountId.unwrap(expectedAccountId))
        ) revert FundingLockMismatch(lockId, purpose);
    }

    function _buildEntries(
        FeeActionId actionId,
        AccountId chargePayer,
        AccountId rebateRecipient,
        AccountId budgetAccount,
        FeeRecipientSet memory recipients,
        uint128[] memory chargeSplits,
        FeeComputation memory computation
    ) private pure returns (FeeLedgerEntry[] memory entries) {
        uint256 count = computation.chargeMinor == 0 ? 0 : 1;
        for (uint256 i; i < chargeSplits.length; ++i) {
            if (chargeSplits[i] != 0) ++count;
        }
        if (computation.rebateMinor != 0) count += 2;
        entries = new FeeLedgerEntry[](count);

        uint256 cursor;
        int256 net;
        if (computation.chargeMinor != 0) {
            entries[cursor++] = FeeLedgerEntry({
                kind: FeeLedgerEntryKind.ChargeDebit,
                actionId: actionId,
                accountId: chargePayer,
                amountMinor: -int256(uint256(computation.chargeMinor))
            });
            net -= int256(uint256(computation.chargeMinor));
            for (uint256 i; i < chargeSplits.length; ++i) {
                if (chargeSplits[i] == 0) continue;
                entries[cursor++] = FeeLedgerEntry({
                    kind: FeeLedgerEntryKind.ChargeCredit,
                    actionId: actionId,
                    accountId: recipients.recipients[i].accountId,
                    amountMinor: int256(uint256(chargeSplits[i]))
                });
                net += int256(uint256(chargeSplits[i]));
            }
        }
        if (computation.rebateMinor != 0) {
            entries[cursor++] = FeeLedgerEntry({
                kind: FeeLedgerEntryKind.BudgetDebit,
                actionId: actionId,
                accountId: budgetAccount,
                amountMinor: -int256(uint256(computation.rebateMinor))
            });
            net -= int256(uint256(computation.rebateMinor));
            entries[cursor] = FeeLedgerEntry({
                kind: FeeLedgerEntryKind.RebateCredit,
                actionId: actionId,
                accountId: rebateRecipient,
                amountMinor: int256(uint256(computation.rebateMinor))
            });
            net += int256(uint256(computation.rebateMinor));
        }
        if (net != 0) revert LedgerDoesNotConserve(net);
    }

    function _hashResult(
        FeeActionRequest calldata request,
        FeeComputation memory computation,
        FeeLedgerEntry[] memory entries
    ) private pure returns (bytes32) {
        bytes32[] memory entryHashes = new bytes32[](entries.length);
        for (uint256 i; i < entries.length; ++i) {
            entryHashes[i] = keccak256(
                abi.encode(
                    ENTRY_TYPEHASH,
                    uint8(entries[i].kind),
                    FeeActionId.unwrap(entries[i].actionId),
                    AccountId.unwrap(entries[i].accountId),
                    entries[i].amountMinor
                )
            );
        }
        return keccak256(
            abi.encode(
                RESULT_TYPEHASH,
                request.consumptionId,
                request.parentActionId,
                FeeScheduleId.unwrap(request.feeScheduleId),
                request.feeScheduleVersion,
                FeeActionId.unwrap(request.actionId),
                request.notionalMinor,
                request.qualifyingVolumeMinor,
                request.maxFeeMinor,
                computation.chargeMinor,
                computation.rebateMinor,
                FeeRatePpm.unwrap(computation.chargeRatePpm),
                FeeRatePpm.unwrap(computation.rebateRatePpm),
                computation.flatChargeMinor,
                computation.flatRebateMinor,
                computation.tierIndex,
                keccak256(abi.encodePacked(entryHashes))
            )
        );
    }

    function _requireLegacyRule(FeeRule memory rule, FeeScheduleId feeScheduleId, uint32 version) private pure {
        if (
            !rule.requiresOpenSchedule || rule.tiers.length != 0 || FeeRatePpm.unwrap(rule.chargeRatePpm) != 0
                || FeeRatePpm.unwrap(rule.rebateRatePpm) != 0 || rule.flatRebateMinor != 0
        ) revert LegacyScheduleUnsupported(feeScheduleId, version);
    }

    function _deriveConsumptionId(FeeActionRequest calldata request) private view returns (bytes32) {
        return _deriveConsumptionId(
            request.parentActionId,
            request.feeScheduleId,
            request.feeScheduleVersion,
            request.actionId,
            request.chargePayerAccountId,
            request.rebateRecipientAccountId,
            request.actionOrdinal
        );
    }

    function _deriveConsumptionId(
        bytes32 parentActionId,
        FeeScheduleId feeScheduleId,
        uint32 feeScheduleVersion,
        FeeActionId actionId,
        AccountId chargePayerAccountId,
        AccountId rebateRecipientAccountId,
        uint32 actionOrdinal
    ) private view returns (bytes32) {
        return keccak256(
            abi.encode(
                CONSUMPTION_ID_TYPEHASH,
                block.chainid,
                address(this),
                parentActionId,
                FeeScheduleId.unwrap(feeScheduleId),
                feeScheduleVersion,
                FeeActionId.unwrap(actionId),
                AccountId.unwrap(chargePayerAccountId),
                AccountId.unwrap(rebateRecipientAccountId),
                actionOrdinal
            )
        );
    }

    function _deriveFundingReference(bytes32 consumptionId, bytes32 purpose) private view returns (bytes32) {
        return keccak256(abi.encode(FUNDING_REFERENCE_TYPEHASH, block.chainid, address(this), consumptionId, purpose));
    }

    function _scheduleKey(FeeScheduleId feeScheduleId, uint32 feeScheduleVersion) private pure returns (bytes32) {
        return keccak256(abi.encode(FeeScheduleId.unwrap(feeScheduleId), feeScheduleVersion));
    }

    function _requireInitialAdmin(address initialAdmin) private pure returns (address) {
        if (initialAdmin == address(0)) revert ZeroInitialAdmin();
        return initialAdmin;
    }
}
