// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {ICollateralVault} from "../interfaces/ICollateralVault.sol";
import {IDefaultBidderGate} from "../interfaces/IDefaultBidderGate.sol";
import {IDefaultLifecycleExecutor} from "../interfaces/IDefaultLifecycleExecutor.sol";
import {IDefaultProcessEngine} from "../interfaces/IDefaultProcessEngine.sol";
import {IPortfolioRiskEngine} from "../interfaces/IPortfolioRiskEngine.sol";
import {IRiskDomainRegistry} from "../interfaces/IRiskDomainRegistry.sol";
import {DefaultProcessLib} from "../libraries/DefaultProcessLib.sol";
import {RiskDomainDefinitionLib} from "../libraries/RiskDomainDefinitionLib.sol";
import {CollateralLock} from "../types/CollateralTypes.sol";
import {
    DefaultProcess,
    DefaultProcessId,
    DefaultProcessRules,
    DefaultProcessStatus,
    InsuranceDeposit,
    InsuranceDepositId,
    InsuranceDepositStatus,
    InsurancePolicy,
    InsuranceReservation,
    InsuranceReservationId,
    InsuranceReservationStatus,
    LiquidationBidId,
    LiquidationBidRecord,
    LiquidationBidReveal,
    LiquidationBidStatus,
    ObjectiveDefaultState
} from "../types/DefaultTypes.sol";
import {LockStatus} from "../types/Enums.sol";
import {AccountId, CollateralId, CollateralLockId, PositionId, RiskDomainId} from "../types/Identifiers.sol";
import {RiskDomainVersion} from "../types/RiskDomainDefinition.sol";

import {DefaultOpeningLib} from "./DefaultOpeningLib.sol";
import {DefaultAuctionLib} from "./DefaultAuctionLib.sol";
import {DefaultResolutionLib} from "./DefaultResolutionLib.sol";
import {DefaultProcessDependencies} from "./DefaultProcessTypes.sol";

import {IDefaultProcessEngineLinkedErrors} from "./IDefaultProcessEngineLinkedErrors.sol";

contract DefaultProcessEngine is IDefaultProcessEngineLinkedErrors, IDefaultProcessEngine, ReentrancyGuard {
    uint16 internal constant HARD_MAXIMUM_BIDS = 32;
    bytes32 internal constant DEFAULTER_LOCK = keccak256("SETRYN_DEFAULT_COLLATERAL");
    bytes32 internal constant CURE_LOCK = keccak256("SETRYN_DEFAULT_CURE_COLLATERAL");
    bytes32 internal constant BID_BOND_LOCK = keccak256("SETRYN_DEFAULT_BID_BOND");
    bytes32 internal constant BID_CAPACITY_LOCK = keccak256("SETRYN_DEFAULT_BID_CAPACITY");
    bytes32 internal constant INSURANCE_LOCK = keccak256("SETRYN_DEFAULT_INSURANCE");

    IPortfolioRiskEngine private immutable _portfolioRiskEngine;
    ICollateralVault private immutable _collateralVault;
    IRiskDomainRegistry private immutable _riskDomainRegistry;
    IDefaultBidderGate private immutable _bidderGate;
    IDefaultLifecycleExecutor private immutable _lifecycleExecutor;

    mapping(DefaultProcessId processId => DefaultProcess process) private _processes;
    mapping(PositionId positionId => DefaultProcessId processId) private _positionProcess;
    mapping(DefaultProcessId processId => LiquidationBidId[] bidIds) private _processBidIds;
    mapping(LiquidationBidId bidId => LiquidationBidRecord bid) private _bids;
    mapping(InsuranceDepositId depositId => InsuranceDeposit deposit) private _insuranceDeposits;
    mapping(InsuranceReservationId reservationId => InsuranceReservation reservation) private _insuranceReservations;

    constructor(
        IPortfolioRiskEngine portfolioRiskEngine_,
        IDefaultBidderGate bidderGate_,
        IDefaultLifecycleExecutor lifecycleExecutor_
    ) {
        _requireDependency(address(portfolioRiskEngine_));
        _requireDependency(address(bidderGate_));
        _requireDependency(address(lifecycleExecutor_));
        ICollateralVault vault = portfolioRiskEngine_.collateralVault();
        IRiskDomainRegistry registry = portfolioRiskEngine_.riskDomainRegistry();
        _requireDependency(address(vault));
        _requireDependency(address(registry));
        if (address(vault.riskDomainRegistry()) != address(registry)) {
            revert DependencyGraphMismatch(address(registry), address(vault.riskDomainRegistry()));
        }
        _portfolioRiskEngine = portfolioRiskEngine_;
        _collateralVault = vault;
        _riskDomainRegistry = registry;
        _bidderGate = bidderGate_;
        _lifecycleExecutor = lifecycleExecutor_;
    }

    function openDefault(
        PositionId positionId,
        AccountId accountId,
        RiskDomainId riskDomainId,
        uint32 riskDomainVersion,
        DefaultProcessRules calldata rules,
        InsurancePolicy calldata policy
    ) external nonReentrant returns (DefaultProcessId processId) {
        processId = _positionProcess[positionId];
        if (DefaultProcessId.unwrap(processId) != bytes32(0)) return processId;
        DefaultOpeningLib.validateRules(rules, policy, accountId);
        RiskDomainVersion memory domain =
            DefaultOpeningLib.requireDomain(_dependencies(), riskDomainId, riskDomainVersion, rules, policy);
        ObjectiveDefaultState memory state =
            DefaultOpeningLib.readState(_dependencies(), positionId, accountId, riskDomainId, riskDomainVersion);
        DefaultOpeningLib.requireFreshState(state, rules.maximumProofAgeSeconds, 0);
        if (state.deficiencyMinor == 0) revert PositionNotDeficient();
        if (state.settlementDeadline <= state.finalResolutionAt) revert DefaultStateMismatch();
        if (CollateralId.unwrap(state.collateralId) != CollateralId.unwrap(_domainCollateral(domain))) {
            revert DefaultStateMismatch();
        }

        processId = DefaultProcessLib.deriveProcessId(block.chainid, address(this), state, state.stateHash);
        if (_processes[processId].status != DefaultProcessStatus.Unspecified) {
            revert DuplicateDefaultProcess(processId);
        }

        (uint64 cureEndsAt, uint64 commitEndsAt, uint64 revealEndsAt, uint64 executionEndsAt) =
            DefaultOpeningLib.deriveDeadlines(state.finalResolutionAt, rules);
        CollateralLockId collateralLockId;
        if (state.availableCollateralMinor != 0) {
            collateralLockId = _createLock(
                keccak256(abi.encode(DEFAULTER_LOCK, DefaultProcessId.unwrap(processId))),
                accountId,
                domain,
                state.availableCollateralMinor,
                state.settlementDeadline
            );
        }
        _processes[processId] = DefaultProcess({
            processId: processId,
            positionId: positionId,
            accountId: accountId,
            riskDomainId: riskDomainId,
            collateralId: state.collateralId,
            defaultProcessHash: domain.definition.defaultProcessHash,
            insurancePolicyHash: domain.definition.insurancePolicyHash,
            openingProofHash: state.stateHash,
            uncuredProofHash: bytes32(0),
            outcomeHash: bytes32(0),
            riskDomainVersion: riskDomainVersion,
            openedAt: uint64(block.timestamp),
            cureEndsAt: cureEndsAt,
            commitEndsAt: commitEndsAt,
            revealEndsAt: revealEndsAt,
            executionEndsAt: executionEndsAt,
            finalResolutionAt: state.finalResolutionAt,
            settlementDeadline: state.settlementDeadline,
            deficiencyMinor: state.deficiencyMinor,
            lockedDefaulterCollateralMinor: state.availableCollateralMinor,
            takeoverContributionMinor: 0,
            insuranceDrawMinor: 0,
            terminalResidualMinor: 0,
            openingRiskSequence: state.sequence,
            uncuredRiskSequence: 0,
            status: DefaultProcessStatus.CureOpen,
            winningBidId: LiquidationBidId.wrap(bytes32(0)),
            insuranceReservationId: InsuranceReservationId.wrap(bytes32(0)),
            defaulterCollateralLockId: collateralLockId,
            cureCollateralLockId: CollateralLockId.wrap(bytes32(0)),
            cureCollateralMinor: 0
        });
        _positionProcess[positionId] = processId;
        emit DefaultOpened(
            processId,
            positionId,
            accountId,
            riskDomainId,
            riskDomainVersion,
            state.stateHash,
            state.deficiencyMinor,
            state.availableCollateralMinor,
            cureEndsAt,
            state.finalResolutionAt
        );
    }

    function lockCureCollateral(DefaultProcessId processId, uint128 amountMinor) external nonReentrant {
        DefaultOpeningLib.lockCureCollateral(_dependencies(), _processes, processId, amountMinor);
    }

    function recheckCure(DefaultProcessId processId, DefaultProcessRules calldata rules)
        external
        nonReentrant
        returns (bool cured)
    {
        return DefaultOpeningLib.recheckCure(_dependencies(), _processes, processId, rules);
    }

    function advanceProcess(DefaultProcessId processId, DefaultProcessRules calldata rules) external nonReentrant {
        DefaultOpeningLib.advanceProcess(_dependencies(), _processes, processId, rules);
    }

    function commitBid(
        DefaultProcessId processId,
        DefaultProcessRules calldata rules,
        AccountId bidderAccountId,
        bytes32 sealedBidHash,
        bytes32 eligibilityEvidenceHash,
        uint128 capacityMinor
    ) external nonReentrant returns (LiquidationBidId bidId) {
        return DefaultAuctionLib.commitBid(
            _dependencies(),
            _processes,
            _processBidIds,
            _bids,
            processId,
            rules,
            bidderAccountId,
            sealedBidHash,
            eligibilityEvidenceHash,
            capacityMinor
        );
    }

    function revealBid(
        LiquidationBidId bidId,
        DefaultProcessRules calldata rules,
        InsurancePolicy calldata policy,
        LiquidationBidReveal calldata reveal
    ) external nonReentrant {
        DefaultAuctionLib.revealBid(_dependencies(), _processes, _bids, bidId, rules, policy, reveal);
    }

    function clearAuction(
        DefaultProcessId processId,
        DefaultProcessRules calldata rules,
        InsurancePolicy calldata policy
    ) external nonReentrant returns (LiquidationBidId winningBidId) {
        return DefaultAuctionLib.clearAuction(
            _dependencies(), _processes, _processBidIds, _bids, processId, rules, policy
        );
    }

    function depositInsurance(
        RiskDomainId riskDomainId,
        uint32 riskDomainVersion,
        AccountId funderAccountId,
        uint128 amountMinor,
        uint64 expiry,
        bytes32 salt,
        InsurancePolicy calldata policy
    ) external nonReentrant returns (InsuranceDepositId depositId) {
        return DefaultResolutionLib.depositInsurance(
            _dependencies(),
            _insuranceDeposits,
            riskDomainId,
            riskDomainVersion,
            funderAccountId,
            amountMinor,
            expiry,
            salt,
            policy
        );
    }

    function reserveInsurance(
        DefaultProcessId processId,
        InsurancePolicy calldata policy,
        InsuranceDepositId[] calldata depositIds
    ) external nonReentrant returns (InsuranceReservationId reservationId) {
        return DefaultResolutionLib.reserveInsurance(
            _dependencies(), _processes, _insuranceDeposits, _insuranceReservations, processId, policy, depositIds
        );
    }

    function withdrawInsuranceDeposit(InsuranceDepositId depositId) external nonReentrant {
        DefaultResolutionLib.withdrawInsuranceDeposit(_dependencies(), _insuranceDeposits, depositId);
    }

    function executeLiquidation(
        DefaultProcessId processId,
        DefaultProcessRules calldata rules,
        InsurancePolicy calldata policy
    ) external nonReentrant returns (bytes32 outcomeHash) {
        return DefaultResolutionLib.executeLiquidation(
            _dependencies(), _processes, _bids, _insuranceDeposits, _insuranceReservations, processId, rules, policy
        );
    }

    function resolveTerminalDefault(
        DefaultProcessId processId,
        DefaultProcessRules calldata rules,
        InsurancePolicy calldata policy,
        InsuranceDepositId[] calldata depositIds
    ) external nonReentrant returns (bytes32 outcomeHash) {
        return DefaultResolutionLib.resolveTerminalDefault(
            _dependencies(),
            _processes,
            _bids,
            _insuranceDeposits,
            _insuranceReservations,
            processId,
            rules,
            policy,
            depositIds
        );
    }

    function portfolioRiskEngine() external view returns (IPortfolioRiskEngine) {
        return _portfolioRiskEngine;
    }

    function collateralVault() external view returns (ICollateralVault) {
        return _collateralVault;
    }

    function bidderGate() external view returns (IDefaultBidderGate) {
        return _bidderGate;
    }

    function lifecycleExecutor() external view returns (IDefaultLifecycleExecutor) {
        return _lifecycleExecutor;
    }

    function getDefaultProcess(DefaultProcessId processId) external view returns (DefaultProcess memory process) {
        process = _processes[processId];
        if (process.status == DefaultProcessStatus.Unspecified) revert UnknownDefaultProcess(processId);
    }

    function getBid(LiquidationBidId bidId) external view returns (LiquidationBidRecord memory bid) {
        bid = _bids[bidId];
        if (bid.status == LiquidationBidStatus.Unspecified) revert UnknownBid(bidId);
    }

    function getInsuranceDeposit(InsuranceDepositId depositId) external view returns (InsuranceDeposit memory deposit) {
        deposit = _insuranceDeposits[depositId];
        if (deposit.status == InsuranceDepositStatus.Unspecified) revert UnknownInsuranceDeposit(depositId);
    }

    function getInsuranceReservation(InsuranceReservationId reservationId)
        external
        view
        returns (InsuranceReservation memory reservation)
    {
        reservation = _insuranceReservations[reservationId];
        if (reservation.status == InsuranceReservationStatus.Unspecified) revert InsuranceReservationMismatch();
    }

    function _releaseDefaulterRemainder(DefaultProcess storage process) private {
        _releaseIfActive(process.defaulterCollateralLockId);
        _releaseIfActive(process.cureCollateralLockId);
    }

    function _requireInsuranceDomain(
        RiskDomainId riskDomainId,
        uint32 riskDomainVersion,
        InsurancePolicy calldata policy
    ) private view returns (RiskDomainVersion memory domain) {
        if (!_riskDomainRegistry.isLifecycleEnabled(riskDomainId, riskDomainVersion)) {
            revert RiskDomainRecordMismatch();
        }
        domain = _riskDomainRegistry.getRiskDomain(riskDomainId, riskDomainVersion);
        bytes32 definitionHash = RiskDomainDefinitionLib.hashDefinition(domain.definition, block.chainid);
        if (
            domain.version != riskDomainVersion || domain.definitionHash != definitionHash
                || RiskDomainId.unwrap(RiskDomainDefinitionLib.deriveRiskDomainId(domain.definition))
                    != RiskDomainId.unwrap(riskDomainId)
                || domain.versionHash
                    != RiskDomainDefinitionLib.hashVersion(
                        riskDomainId, riskDomainVersion, definitionHash, block.chainid
                    )
        ) revert RiskDomainRecordMismatch();
        bytes32 policyHash = DefaultProcessLib.hashInsurancePolicy(policy);
        if (policyHash != domain.definition.insurancePolicyHash) {
            revert InvalidPolicyWitness(domain.definition.insurancePolicyHash, policyHash);
        }
    }

    function _requireRules(DefaultProcess storage process, DefaultProcessRules calldata rules) private view {
        bytes32 supplied = DefaultProcessLib.hashRules(rules);
        if (supplied != process.defaultProcessHash) revert InvalidPolicyWitness(process.defaultProcessHash, supplied);
    }

    function _requirePolicy(DefaultProcess storage process, InsurancePolicy calldata policy) private view {
        bytes32 supplied = DefaultProcessLib.hashInsurancePolicy(policy);
        if (supplied != process.insurancePolicyHash) {
            revert InvalidPolicyWitness(process.insurancePolicyHash, supplied);
        }
    }

    function _requireWitnesses(
        DefaultProcess storage process,
        DefaultProcessRules calldata rules,
        InsurancePolicy calldata policy
    ) private view {
        _requireRules(process, rules);
        _requirePolicy(process, policy);
    }

    function _createLock(
        bytes32 lockReference,
        AccountId accountId,
        RiskDomainVersion memory domain,
        uint128 amount,
        uint64 expiry
    ) private returns (CollateralLockId) {
        return _collateralVault.createLock(
            lockReference,
            accountId,
            domain.definition.collateralAssetId,
            domain.definition.collateralAssetVersion,
            amount,
            expiry,
            address(this)
        );
    }

    function _domainCollateral(RiskDomainVersion memory domain) private view returns (CollateralId) {
        return _collateralVault.deriveCollateralId(
            domain.definition.collateralAssetId, domain.definition.collateralAssetVersion
        );
    }

    function _releaseIfActive(CollateralLockId lockId) private {
        if (CollateralLockId.unwrap(lockId) == bytes32(0)) return;
        if (_collateralVault.lockStatusOf(lockId) != LockStatus.Active) return;
        CollateralLock memory lock = _collateralVault.getLock(lockId);
        if (block.timestamp < lock.expiry) _collateralVault.releaseLock(lockId);
        else _collateralVault.releaseExpiredLock(lockId);
    }

    function _setStatus(DefaultProcess storage process, DefaultProcessStatus status, bytes32 evidenceHash) private {
        DefaultProcessStatus previous = process.status;
        process.status = status;
        emit DefaultStatusChanged(process.processId, previous, status, evidenceHash, msg.sender);
    }

    function _requireProcess(DefaultProcessId processId) private view returns (DefaultProcess storage process) {
        process = _processes[processId];
        if (process.status == DefaultProcessStatus.Unspecified) revert UnknownDefaultProcess(processId);
    }

    function _minimum(uint128 left, uint128 right) private pure returns (uint128) {
        return left < right ? left : right;
    }

    /// Linked libraries execute in this contract's context and receive the immutable dependency graph explicitly.
    function _dependencies() private view returns (DefaultProcessDependencies memory) {
        return DefaultProcessDependencies({
            portfolioRiskEngine: _portfolioRiskEngine,
            collateralVault: _collateralVault,
            riskDomainRegistry: _riskDomainRegistry,
            bidderGate: _bidderGate,
            lifecycleExecutor: _lifecycleExecutor
        });
    }

    function _requireDependency(address dependency) private view {
        if (dependency == address(0)) revert ZeroDependency(dependency);
        if (dependency.code.length == 0) revert DependencyHasNoCode(dependency);
    }
}
