// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {DefaultProcessLib} from "../../src/libraries/DefaultProcessLib.sol";
import {RiskDomainDefinitionLib} from "../../src/libraries/RiskDomainDefinitionLib.sol";
import {CollateralLock} from "../../src/types/CollateralTypes.sol";
import {
    DefaultExecutionResult,
    DefaultProcess,
    DefaultProcessId,
    DefaultProcessRules,
    InsurancePolicy,
    LiquidationBidRecord,
    ObjectiveDefaultState
} from "../../src/types/DefaultTypes.sol";
import {LockStatus, RegistryStatus} from "../../src/types/Enums.sol";
import {
    AccountId,
    AssetId,
    CollateralId,
    CollateralLockId,
    PositionId,
    RiskDomainId
} from "../../src/types/Identifiers.sol";
import {RiskDomainDefinition, RiskDomainVersion} from "../../src/types/RiskDomainDefinition.sol";

contract DefaultRiskDomainRegistryMock {
    mapping(RiskDomainId id => mapping(uint32 version => RiskDomainVersion record)) private _records;

    function setDomain(RiskDomainDefinition calldata definition, uint32 version)
        external
        returns (RiskDomainId riskDomainId)
    {
        riskDomainId = RiskDomainDefinitionLib.deriveRiskDomainId(definition);
        bytes32 definitionHash = RiskDomainDefinitionLib.hashDefinition(definition, block.chainid);
        _records[riskDomainId][version] = RiskDomainVersion({
            definition: definition,
            definitionHash: definitionHash,
            versionHash: RiskDomainDefinitionLib.hashVersion(riskDomainId, version, definitionHash, block.chainid),
            version: version,
            status: RegistryStatus.Paused
        });
    }

    function isLifecycleEnabled(RiskDomainId riskDomainId, uint32 version) external view returns (bool) {
        return _records[riskDomainId][version].version != 0;
    }

    function getRiskDomain(RiskDomainId riskDomainId, uint32 version) external view returns (RiskDomainVersion memory) {
        return _records[riskDomainId][version];
    }
}

contract DefaultCollateralVaultMock {
    address public immutable riskDomainRegistry;
    mapping(AccountId accountId => address controller) private _controllers;
    mapping(CollateralLockId lockId => CollateralLock lock) private _locks;

    constructor(address registry) {
        riskDomainRegistry = registry;
    }

    function setController(AccountId accountId, address controller) external {
        _controllers[accountId] = controller;
    }

    function getAccount(AccountId accountId) external view returns (address controller, address pendingController) {
        return (_controllers[accountId], address(0));
    }

    function deriveCollateralId(AssetId assetId, uint32 bindingVersion) public pure returns (CollateralId) {
        return CollateralId.wrap(keccak256(abi.encode(assetId, bindingVersion)));
    }

    function deriveLockId(address operator, bytes32 lockReference) public view returns (CollateralLockId) {
        return CollateralLockId.wrap(keccak256(abi.encode(block.chainid, address(this), operator, lockReference)));
    }

    function createLock(
        bytes32 lockReference,
        AccountId accountId,
        AssetId assetId,
        uint32 bindingVersion,
        uint128 amount,
        uint64 expiry,
        address settlementOperator
    ) external returns (CollateralLockId lockId) {
        lockId = deriveLockId(msg.sender, lockReference);
        _locks[lockId] = CollateralLock({
            accountId: accountId,
            collateralId: deriveCollateralId(assetId, bindingVersion),
            assetId: assetId,
            lockReference: lockReference,
            operator: msg.sender,
            bindingVersion: bindingVersion,
            expiry: expiry,
            settlementOperator: settlementOperator,
            status: LockStatus.Active,
            initialAmount: amount,
            remainingAmount: amount
        });
    }

    function consumeLock(CollateralLockId lockId, AccountId, uint128 amount) external {
        CollateralLock storage lock = _locks[lockId];
        lock.remainingAmount -= amount;
        if (lock.remainingAmount == 0) lock.status = LockStatus.Consumed;
    }

    function releaseLock(CollateralLockId lockId) external {
        _locks[lockId].remainingAmount = 0;
        _locks[lockId].status = LockStatus.Released;
    }

    function releaseExpiredLock(CollateralLockId lockId) external {
        _locks[lockId].remainingAmount = 0;
        _locks[lockId].status = LockStatus.Expired;
    }

    function getLock(CollateralLockId lockId) external view returns (CollateralLock memory) {
        return _locks[lockId];
    }

    function lockStatusOf(CollateralLockId lockId) external view returns (LockStatus) {
        return _locks[lockId].status;
    }
}

contract DefaultRiskEngineMock {
    address public immutable collateralVault;
    address public immutable riskDomainRegistry;
    ObjectiveDefaultState private _state;

    constructor(address vault, address registry) {
        collateralVault = vault;
        riskDomainRegistry = registry;
    }

    function setState(ObjectiveDefaultState calldata state) external {
        _state = state;
        _state.stateHash = DefaultProcessLib.hashObjectiveState(state);
    }

    function objectiveDefaultState(PositionId, AccountId, RiskDomainId, uint32)
        external
        view
        returns (ObjectiveDefaultState memory)
    {
        return _state;
    }
}

contract DefaultBidderGateMock {
    bool public qualified = true;

    function setQualified(bool value) external {
        qualified = value;
    }

    function isQualified(DefaultProcessId, address, AccountId, RiskDomainId, uint32, bytes32, bytes32)
        external
        view
        returns (bool)
    {
        return qualified;
    }
}

contract DefaultLifecycleExecutorMock {
    function executeDefaultNovation(
        DefaultProcess calldata process,
        DefaultProcessRules calldata,
        InsurancePolicy calldata,
        LiquidationBidRecord calldata winningBid,
        uint128 insuranceDrawMinor,
        uint128 terminalResidualMinor
    ) external pure returns (DefaultExecutionResult memory result) {
        uint128 defaulterApplied = _minimum(process.deficiencyMinor, process.lockedDefaulterCollateralMinor);
        return DefaultExecutionResult({
            executionHash: keccak256(abi.encode(process.processId, winningBid.bidId)),
            positionOutcomeReference: keccak256(abi.encode(process.positionId, winningBid.bidderAccountId)),
            successorAccountId: winningBid.bidderAccountId,
            defaulterCollateralAppliedMinor: defaulterApplied,
            takeoverContributionAppliedMinor: process.takeoverContributionMinor,
            insuranceAppliedMinor: insuranceDrawMinor,
            terminalResidualMinor: terminalResidualMinor,
            fullyBackedClaimMinor: 0,
            unbackedClaimMinor: 0
        });
    }

    function applyTerminalDefaultRule(
        DefaultProcess calldata process,
        DefaultProcessRules calldata,
        InsurancePolicy calldata,
        uint128 insuranceDrawMinor,
        uint128 terminalResidualMinor
    ) external pure returns (DefaultExecutionResult memory result) {
        uint128 defaulterApplied = _minimum(process.deficiencyMinor, process.lockedDefaulterCollateralMinor);
        return DefaultExecutionResult({
            executionHash: keccak256(abi.encode(process.processId, "terminal")),
            positionOutcomeReference: keccak256(abi.encode(process.positionId, "terminal")),
            successorAccountId: AccountId.wrap(bytes32(0)),
            defaulterCollateralAppliedMinor: defaulterApplied,
            takeoverContributionAppliedMinor: 0,
            insuranceAppliedMinor: insuranceDrawMinor,
            terminalResidualMinor: terminalResidualMinor,
            fullyBackedClaimMinor: 0,
            unbackedClaimMinor: 0
        });
    }

    function _minimum(uint128 left, uint128 right) private pure returns (uint128) {
        return left < right ? left : right;
    }
}
