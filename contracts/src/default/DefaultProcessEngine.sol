// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {ICollateralVault} from "../interfaces/ICollateralVault.sol";
import {IDefaultBidderGate} from "../interfaces/IDefaultBidderGate.sol";
import {IDefaultLifecycleExecutor} from "../interfaces/IDefaultLifecycleExecutor.sol";
import {IDefaultProcessEngine} from "../interfaces/IDefaultProcessEngine.sol";
import {IDefaultRiskSource} from "../interfaces/IDefaultRiskSource.sol";
import {IPortfolioRiskEngine} from "../interfaces/IPortfolioRiskEngine.sol";
import {IRiskDomainRegistry} from "../interfaces/IRiskDomainRegistry.sol";
import {DefaultProcessLib} from "../libraries/DefaultProcessLib.sol";
import {RiskDomainDefinitionLib} from "../libraries/RiskDomainDefinitionLib.sol";
import {CollateralLock} from "../types/CollateralTypes.sol";
import {
    DefaultExecutionResult,
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
    InsuranceReservationLine,
    InsuranceReservationStatus,
    LiquidationBidId,
    LiquidationBidRecord,
    LiquidationBidReveal,
    LiquidationBidStatus,
    ObjectiveDefaultState
} from "../types/DefaultTypes.sol";
import {LockStatus} from "../types/Enums.sol";
import {AccountId, AssetId, CollateralId, CollateralLockId, PositionId, RiskDomainId} from "../types/Identifiers.sol";
import {RiskDomainVersion} from "../types/RiskDomainDefinition.sol";

contract DefaultProcessEngine is IDefaultProcessEngine, ReentrancyGuard {
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
        _validateRules(rules, policy, accountId);
        RiskDomainVersion memory domain = _requireDomain(riskDomainId, riskDomainVersion, rules, policy);
        ObjectiveDefaultState memory state = _readState(positionId, accountId, riskDomainId, riskDomainVersion);
        _requireFreshState(state, rules.maximumProofAgeSeconds, 0);
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
            _deriveDeadlines(state.finalResolutionAt, rules);
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
        if (amountMinor == 0) revert ZeroAmount();
        DefaultProcess storage process = _requireProcess(processId);
        if (process.status != DefaultProcessStatus.CureOpen) revert InvalidDefaultProcessStatus(process.status);
        if (block.timestamp >= process.cureEndsAt) revert PhaseClosed(process.cureEndsAt, block.timestamp);
        if (CollateralLockId.unwrap(process.cureCollateralLockId) != bytes32(0)) revert InvalidBidFunding();
        RiskDomainVersion memory domain =
            _riskDomainRegistry.getRiskDomain(process.riskDomainId, process.riskDomainVersion);
        process.cureCollateralLockId = _createLock(
            keccak256(abi.encode(CURE_LOCK, DefaultProcessId.unwrap(processId))),
            process.accountId,
            domain,
            amountMinor,
            process.settlementDeadline
        );
        process.cureCollateralMinor = amountMinor;
        process.lockedDefaulterCollateralMinor += amountMinor;
        emit CureCollateralLocked(
            processId, CollateralLockId.unwrap(process.cureCollateralLockId), amountMinor, msg.sender
        );
    }

    function recheckCure(DefaultProcessId processId, DefaultProcessRules calldata rules)
        external
        nonReentrant
        returns (bool cured)
    {
        DefaultProcess storage process = _requireProcess(processId);
        _requireRules(process, rules);
        if (process.status == DefaultProcessStatus.Cured) return true;
        if (process.status != DefaultProcessStatus.CureOpen) revert InvalidDefaultProcessStatus(process.status);
        if (block.timestamp >= process.cureEndsAt) revert PhaseClosed(process.cureEndsAt, block.timestamp);
        ObjectiveDefaultState memory state =
            _readState(process.positionId, process.accountId, process.riskDomainId, process.riskDomainVersion);
        _requireFreshState(state, rules.maximumProofAgeSeconds, process.openingRiskSequence);
        if (state.deficiencyMinor != 0) return false;
        _markCured(process, state.stateHash);
        return true;
    }

    function advanceProcess(DefaultProcessId processId, DefaultProcessRules calldata rules) external nonReentrant {
        DefaultProcess storage process = _requireProcess(processId);
        _requireRules(process, rules);
        if (process.status == DefaultProcessStatus.CureOpen) {
            if (block.timestamp < process.cureEndsAt) revert PhaseNotOpen(process.cureEndsAt, block.timestamp);
            ObjectiveDefaultState memory state =
                _readState(process.positionId, process.accountId, process.riskDomainId, process.riskDomainVersion);
            _requireFreshState(state, rules.maximumProofAgeSeconds, process.openingRiskSequence);
            if (state.deficiencyMinor == 0) {
                _markCured(process, state.stateHash);
                return;
            }
            process.deficiencyMinor = state.deficiencyMinor;
            process.uncuredProofHash = state.stateHash;
            process.uncuredRiskSequence = state.sequence;
            _setStatus(process, DefaultProcessStatus.CommitOpen, state.stateHash);
            return;
        }
        if (process.status == DefaultProcessStatus.CommitOpen) {
            if (block.timestamp < process.commitEndsAt) revert PhaseNotOpen(process.commitEndsAt, block.timestamp);
            _setStatus(process, DefaultProcessStatus.RevealOpen, process.uncuredProofHash);
            return;
        }
        if (process.status == DefaultProcessStatus.RevealOpen) {
            if (block.timestamp < process.revealEndsAt) revert PhaseNotOpen(process.revealEndsAt, block.timestamp);
            _setStatus(process, DefaultProcessStatus.ReadyToClear, process.uncuredProofHash);
            return;
        }
        if (
            process.status == DefaultProcessStatus.AuctionCleared && block.timestamp >= process.executionEndsAt
                && block.timestamp < process.finalResolutionAt
        ) {
            _setStatus(process, DefaultProcessStatus.RecoveryRequired, process.uncuredProofHash);
            return;
        }
        revert InvalidDefaultProcessStatus(process.status);
    }

    function commitBid(
        DefaultProcessId processId,
        DefaultProcessRules calldata rules,
        AccountId bidderAccountId,
        bytes32 sealedBidHash,
        bytes32 eligibilityEvidenceHash,
        uint128 capacityMinor
    ) external nonReentrant returns (LiquidationBidId bidId) {
        DefaultProcess storage process = _requireProcess(processId);
        _requireRules(process, rules);
        if (process.status != DefaultProcessStatus.CommitOpen) revert InvalidDefaultProcessStatus(process.status);
        if (block.timestamp >= process.commitEndsAt) revert PhaseClosed(process.commitEndsAt, block.timestamp);
        if (sealedBidHash == bytes32(0) || eligibilityEvidenceHash == bytes32(0)) revert BidCommitmentMismatch();
        if (capacityMinor < rules.minimumCapacityMinor) revert InvalidBidFunding();
        LiquidationBidId[] storage bidIds = _processBidIds[processId];
        if (bidIds.length >= rules.maximumBids) revert BidCapacityReached(rules.maximumBids);
        (address controller,) = _collateralVault.getAccount(bidderAccountId);
        if (controller != msg.sender) revert BidderControllerMismatch(controller, msg.sender);
        if (!_bidderGate.isQualified(
                processId,
                msg.sender,
                bidderAccountId,
                process.riskDomainId,
                process.riskDomainVersion,
                rules.bidderQualificationHash,
                eligibilityEvidenceHash
            )) revert BidderNotQualified(msg.sender, bidderAccountId);
        bidId = DefaultProcessLib.deriveBidId(processId, msg.sender, bidderAccountId, sealedBidHash);
        if (_bids[bidId].status != LiquidationBidStatus.Unspecified) return bidId;
        RiskDomainVersion memory domain =
            _riskDomainRegistry.getRiskDomain(process.riskDomainId, process.riskDomainVersion);
        CollateralLockId bondLockId = _createLock(
            keccak256(abi.encode(BID_BOND_LOCK, LiquidationBidId.unwrap(bidId))),
            bidderAccountId,
            domain,
            rules.requiredBondMinor,
            process.settlementDeadline
        );
        CollateralLockId capacityLockId = _createLock(
            keccak256(abi.encode(BID_CAPACITY_LOCK, LiquidationBidId.unwrap(bidId))),
            bidderAccountId,
            domain,
            capacityMinor,
            process.settlementDeadline
        );
        _bids[bidId] = LiquidationBidRecord({
            bidId: bidId,
            processId: processId,
            bidder: msg.sender,
            bidderAccountId: bidderAccountId,
            sealedBidHash: sealedBidHash,
            eligibilityEvidenceHash: eligibilityEvidenceHash,
            bondLockId: bondLockId,
            capacityLockId: capacityLockId,
            capacityMinor: capacityMinor,
            takeoverContributionMinor: 0,
            discountMinor: 0,
            maximumInsuranceDrawMinor: 0,
            status: LiquidationBidStatus.Committed
        });
        bidIds.push(bidId);
        emit LiquidationBidCommitted(
            processId,
            bidId,
            msg.sender,
            sealedBidHash,
            CollateralLockId.unwrap(bondLockId),
            CollateralLockId.unwrap(capacityLockId),
            capacityMinor
        );
    }

    function revealBid(
        LiquidationBidId bidId,
        DefaultProcessRules calldata rules,
        InsurancePolicy calldata policy,
        LiquidationBidReveal calldata reveal
    ) external nonReentrant {
        LiquidationBidRecord storage bid = _bids[bidId];
        if (bid.status == LiquidationBidStatus.Unspecified) revert UnknownBid(bidId);
        if (bid.status != LiquidationBidStatus.Committed) {
            if (
                DefaultProcessLib.hashBidReveal(reveal) == bid.sealedBidHash
                    && bid.takeoverContributionMinor == reveal.takeoverContributionMinor
                    && bid.discountMinor == reveal.discountMinor
                    && bid.maximumInsuranceDrawMinor == reveal.maximumInsuranceDrawMinor
            ) return;
            revert BidCommitmentMismatch();
        }
        DefaultProcess storage process = _requireProcess(bid.processId);
        _requireWitnesses(process, rules, policy);
        if (process.status != DefaultProcessStatus.RevealOpen) revert InvalidDefaultProcessStatus(process.status);
        if (block.timestamp >= process.revealEndsAt) revert PhaseClosed(process.revealEndsAt, block.timestamp);
        if (
            DefaultProcessId.unwrap(reveal.processId) != DefaultProcessId.unwrap(bid.processId)
                || reveal.bidder != bid.bidder || msg.sender != bid.bidder
                || AccountId.unwrap(reveal.bidderAccountId) != AccountId.unwrap(bid.bidderAccountId)
                || reveal.eligibilityEvidenceHash != bid.eligibilityEvidenceHash
                || DefaultProcessLib.hashBidReveal(reveal) != bid.sealedBidHash
        ) revert BidCommitmentMismatch();
        if (
            reveal.takeoverContributionMinor == 0 || reveal.takeoverContributionMinor > bid.capacityMinor
                || reveal.maximumInsuranceDrawMinor > policy.maximumDrawPerDefaultMinor
        ) revert InvalidBidFunding();
        if (!_bidderGate.isQualified(
                bid.processId,
                bid.bidder,
                bid.bidderAccountId,
                process.riskDomainId,
                process.riskDomainVersion,
                rules.bidderQualificationHash,
                reveal.eligibilityEvidenceHash
            )) revert BidderNotQualified(bid.bidder, bid.bidderAccountId);
        bid.takeoverContributionMinor = reveal.takeoverContributionMinor;
        bid.discountMinor = reveal.discountMinor;
        bid.maximumInsuranceDrawMinor = reveal.maximumInsuranceDrawMinor;
        bid.status = LiquidationBidStatus.Revealed;
        emit LiquidationBidRevealed(
            bid.processId,
            bidId,
            reveal.takeoverContributionMinor,
            reveal.discountMinor,
            reveal.maximumInsuranceDrawMinor
        );
    }

    function clearAuction(
        DefaultProcessId processId,
        DefaultProcessRules calldata rules,
        InsurancePolicy calldata policy
    ) external nonReentrant returns (LiquidationBidId winningBidId) {
        DefaultProcess storage process = _requireProcess(processId);
        _requireWitnesses(process, rules, policy);
        if (process.status == DefaultProcessStatus.AuctionCleared || process.status == DefaultProcessStatus.Resolved) {
            return process.winningBidId;
        }
        if (process.status == DefaultProcessStatus.RecoveryRequired) return LiquidationBidId.wrap(bytes32(0));
        if (process.status != DefaultProcessStatus.ReadyToClear) revert InvalidDefaultProcessStatus(process.status);
        LiquidationBidId[] storage bidIds = _processBidIds[processId];
        for (uint256 i; i < bidIds.length; ++i) {
            LiquidationBidRecord storage candidate = _bids[bidIds[i]];
            if (candidate.status != LiquidationBidStatus.Revealed) continue;
            if (
                LiquidationBidId.unwrap(winningBidId) == bytes32(0)
                    || DefaultProcessLib.isBetterBid(
                        candidate.takeoverContributionMinor,
                        candidate.discountMinor,
                        candidate.bidId,
                        _bids[winningBidId].takeoverContributionMinor,
                        _bids[winningBidId].discountMinor,
                        winningBidId
                    )
            ) winningBidId = candidate.bidId;
        }
        if (LiquidationBidId.unwrap(winningBidId) == bytes32(0)) {
            _releaseNonWinningBids(processId, LiquidationBidId.wrap(bytes32(0)));
            _setStatus(process, DefaultProcessStatus.RecoveryRequired, process.uncuredProofHash);
            return winningBidId;
        }
        _releaseNonWinningBids(processId, winningBidId);
        LiquidationBidRecord storage winner = _bids[winningBidId];
        winner.status = LiquidationBidStatus.Winner;
        process.winningBidId = winningBidId;
        uint128 residual = process.deficiencyMinor;
        uint128 defaulterApplied = _minimum(residual, process.lockedDefaulterCollateralMinor);
        residual -= defaulterApplied;
        uint128 takeoverApplied = _minimum(residual, winner.takeoverContributionMinor);
        residual -= takeoverApplied;
        uint128 insuranceDraw = _minimum(residual, policy.maximumDrawPerDefaultMinor);
        insuranceDraw = _minimum(insuranceDraw, winner.maximumInsuranceDrawMinor);
        residual -= insuranceDraw;
        process.takeoverContributionMinor = takeoverApplied;
        process.insuranceDrawMinor = insuranceDraw;
        process.terminalResidualMinor = residual;
        _setStatus(process, DefaultProcessStatus.AuctionCleared, winner.sealedBidHash);
        emit LiquidationAuctionCleared(
            processId, winningBidId, defaulterApplied, takeoverApplied, insuranceDraw, residual
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
        if (amountMinor == 0) revert ZeroAmount();
        if (salt == bytes32(0)) revert ZeroSalt();
        RiskDomainVersion memory domain = _requireInsuranceDomain(riskDomainId, riskDomainVersion, policy);
        if (AccountId.unwrap(funderAccountId) != AccountId.unwrap(policy.insuranceAccountId)) {
            revert InsuranceDepositMismatch(InsuranceDepositId.wrap(bytes32(0)));
        }
        (address controller,) = _collateralVault.getAccount(funderAccountId);
        if (controller != msg.sender) revert BidderControllerMismatch(controller, msg.sender);
        if (expiry <= block.timestamp) revert PhaseClosed(expiry, block.timestamp);
        depositId = DefaultProcessLib.deriveInsuranceDepositId(
            block.chainid, address(this), riskDomainId, riskDomainVersion, funderAccountId, salt
        );
        if (_insuranceDeposits[depositId].status != InsuranceDepositStatus.Unspecified) return depositId;
        CollateralLockId lockId = _createLock(
            keccak256(abi.encode(INSURANCE_LOCK, InsuranceDepositId.unwrap(depositId))),
            funderAccountId,
            domain,
            amountMinor,
            expiry
        );
        _insuranceDeposits[depositId] = InsuranceDeposit({
            depositId: depositId,
            funderAccountId: funderAccountId,
            riskDomainId: riskDomainId,
            collateralId: _domainCollateral(domain),
            lockId: lockId,
            insurancePolicyHash: domain.definition.insurancePolicyHash,
            riskDomainVersion: riskDomainVersion,
            expiry: expiry,
            fundedMinor: amountMinor,
            reservedMinor: 0,
            consumedMinor: 0,
            status: InsuranceDepositStatus.Funded
        });
        emit InsuranceDeposited(
            depositId,
            riskDomainId,
            riskDomainVersion,
            funderAccountId,
            CollateralLockId.unwrap(lockId),
            amountMinor,
            expiry
        );
    }

    function reserveInsurance(
        DefaultProcessId processId,
        InsurancePolicy calldata policy,
        InsuranceDepositId[] calldata depositIds
    ) external nonReentrant returns (InsuranceReservationId reservationId) {
        DefaultProcess storage process = _requireProcess(processId);
        _requirePolicy(process, policy);
        if (process.status != DefaultProcessStatus.AuctionCleared) revert InvalidDefaultProcessStatus(process.status);
        return _reserveInsurance(process, policy, depositIds, process.insuranceDrawMinor);
    }

    function withdrawInsuranceDeposit(InsuranceDepositId depositId) external nonReentrant {
        InsuranceDeposit storage deposit = _insuranceDeposits[depositId];
        if (deposit.status == InsuranceDepositStatus.Unspecified) revert UnknownInsuranceDeposit(depositId);
        if (deposit.status == InsuranceDepositStatus.Withdrawn) return;
        (address controller,) = _collateralVault.getAccount(deposit.funderAccountId);
        if (controller != msg.sender) revert BidderControllerMismatch(controller, msg.sender);
        if (deposit.reservedMinor != 0 || deposit.status != InsuranceDepositStatus.Funded) {
            revert InsuranceDepositMismatch(depositId);
        }
        _releaseIfActive(deposit.lockId);
        deposit.status = InsuranceDepositStatus.Withdrawn;
    }

    function executeLiquidation(
        DefaultProcessId processId,
        DefaultProcessRules calldata rules,
        InsurancePolicy calldata policy
    ) external nonReentrant returns (bytes32 outcomeHash) {
        DefaultProcess storage process = _requireProcess(processId);
        _requireWitnesses(process, rules, policy);
        if (process.status == DefaultProcessStatus.Resolved) return process.outcomeHash;
        if (process.status != DefaultProcessStatus.AuctionCleared) revert InvalidDefaultProcessStatus(process.status);
        if (block.timestamp >= process.executionEndsAt) revert PhaseClosed(process.executionEndsAt, block.timestamp);
        if (
            process.insuranceDrawMinor != 0
                && InsuranceReservationId.unwrap(process.insuranceReservationId) == bytes32(0)
        ) revert InsuranceReservationMismatch();
        LiquidationBidRecord storage winner = _bids[process.winningBidId];
        uint128 defaulterApplied = _minimum(process.deficiencyMinor, process.lockedDefaulterCollateralMinor);
        _consumeDefaulter(process, rules.recoveryAccountId, defaulterApplied);
        if (process.takeoverContributionMinor != 0) {
            _collateralVault.consumeLock(
                winner.capacityLockId, rules.recoveryAccountId, process.takeoverContributionMinor
            );
        }
        _consumeInsurance(process, rules.recoveryAccountId);
        DefaultExecutionResult memory result = _lifecycleExecutor.executeDefaultNovation(
            process, rules, policy, winner, process.insuranceDrawMinor, process.terminalResidualMinor
        );
        _validateExecutionResult(
            result,
            winner.bidderAccountId,
            defaulterApplied,
            process.takeoverContributionMinor,
            process.insuranceDrawMinor,
            process.terminalResidualMinor
        );
        _releaseIfActive(winner.bondLockId);
        _releaseIfActive(winner.capacityLockId);
        winner.status = LiquidationBidStatus.Settled;
        _releaseDefaulterRemainder(process);
        return _recordOutcome(process, result, DefaultProcessStatus.Resolved);
    }

    function resolveTerminalDefault(
        DefaultProcessId processId,
        DefaultProcessRules calldata rules,
        InsurancePolicy calldata policy,
        InsuranceDepositId[] calldata depositIds
    ) external nonReentrant returns (bytes32 outcomeHash) {
        DefaultProcess storage process = _requireProcess(processId);
        _requireWitnesses(process, rules, policy);
        if (process.status == DefaultProcessStatus.TerminalResolved) return process.outcomeHash;
        if (block.timestamp < process.finalResolutionAt) {
            revert PhaseNotOpen(process.finalResolutionAt, block.timestamp);
        }
        if (process.status == DefaultProcessStatus.Cured || process.status == DefaultProcessStatus.Resolved) {
            revert InvalidDefaultProcessStatus(process.status);
        }
        uint128 residual = process.deficiencyMinor;
        uint128 defaulterApplied = _minimum(residual, process.lockedDefaulterCollateralMinor);
        residual -= defaulterApplied;
        uint128 insuranceDraw = _minimum(residual, policy.maximumDrawPerDefaultMinor);
        residual -= insuranceDraw;
        InsuranceReservationId existingReservationId = process.insuranceReservationId;
        if (InsuranceReservationId.unwrap(existingReservationId) != bytes32(0)) {
            InsuranceReservation storage existingReservation = _insuranceReservations[existingReservationId];
            if (
                existingReservation.status != InsuranceReservationStatus.Reserved
                    || existingReservation.amountMinor != insuranceDraw
            ) {
                _releaseReservation(existingReservationId);
                process.insuranceReservationId = InsuranceReservationId.wrap(bytes32(0));
            }
        }
        process.takeoverContributionMinor = 0;
        process.insuranceDrawMinor = insuranceDraw;
        process.terminalResidualMinor = residual;
        _reserveInsurance(process, policy, depositIds, insuranceDraw);
        _consumeDefaulter(process, rules.recoveryAccountId, defaulterApplied);
        _consumeInsurance(process, rules.recoveryAccountId);
        if (LiquidationBidId.unwrap(process.winningBidId) != bytes32(0)) {
            LiquidationBidRecord storage winner = _bids[process.winningBidId];
            _releaseIfActive(winner.bondLockId);
            _releaseIfActive(winner.capacityLockId);
            winner.status = LiquidationBidStatus.Loser;
        }
        DefaultExecutionResult memory result =
            _lifecycleExecutor.applyTerminalDefaultRule(process, rules, policy, insuranceDraw, residual);
        _validateExecutionResult(result, AccountId.wrap(bytes32(0)), defaulterApplied, 0, insuranceDraw, residual);
        _releaseDefaulterRemainder(process);
        return _recordOutcome(process, result, DefaultProcessStatus.TerminalResolved);
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

    function _reserveInsurance(
        DefaultProcess storage process,
        InsurancePolicy calldata policy,
        InsuranceDepositId[] calldata depositIds,
        uint128 required
    ) private returns (InsuranceReservationId reservationId) {
        if (required == 0) return InsuranceReservationId.wrap(bytes32(0));
        if (InsuranceReservationId.unwrap(process.insuranceReservationId) != bytes32(0)) {
            return process.insuranceReservationId;
        }
        if (depositIds.length == 0 || depositIds.length > policy.maximumDepositsPerDraw) {
            revert InsuranceFundingInsufficient(required, 0);
        }
        reservationId = DefaultProcessLib.deriveInsuranceReservationId(process.processId, required);
        if (_insuranceReservations[reservationId].status != InsuranceReservationStatus.Unspecified) {
            revert InsuranceAlreadyReserved(reservationId);
        }
        InsuranceReservation storage reservation = _insuranceReservations[reservationId];
        reservation.reservationId = reservationId;
        reservation.processId = process.processId;
        reservation.amountMinor = required;
        reservation.status = InsuranceReservationStatus.Reserved;
        uint128 remaining = required;
        bytes32 previous;
        for (uint256 i; i < depositIds.length && remaining != 0; ++i) {
            bytes32 current = InsuranceDepositId.unwrap(depositIds[i]);
            if (current <= previous) revert InsuranceDepositOrderMismatch(i);
            previous = current;
            InsuranceDeposit storage deposit = _insuranceDeposits[depositIds[i]];
            _requireInsuranceDeposit(process, depositIds[i], deposit);
            uint128 available = deposit.fundedMinor - deposit.reservedMinor - deposit.consumedMinor;
            uint128 amount = _minimum(available, remaining);
            if (amount == 0) continue;
            deposit.reservedMinor += amount;
            reservation.lines.push(InsuranceReservationLine({depositId: depositIds[i], amountMinor: amount}));
            remaining -= amount;
        }
        if (remaining != 0) revert InsuranceFundingInsufficient(required, required - remaining);
        process.insuranceReservationId = reservationId;
        emit InsuranceReserved(reservationId, process.processId, required, keccak256(abi.encode(reservation.lines)));
    }

    function _consumeInsurance(DefaultProcess storage process, AccountId recipient) private {
        if (process.insuranceDrawMinor == 0) return;
        InsuranceReservation storage reservation = _insuranceReservations[process.insuranceReservationId];
        if (
            reservation.status != InsuranceReservationStatus.Reserved
                || reservation.amountMinor != process.insuranceDrawMinor
        ) revert InsuranceReservationMismatch();
        for (uint256 i; i < reservation.lines.length; ++i) {
            InsuranceReservationLine storage line = reservation.lines[i];
            InsuranceDeposit storage deposit = _insuranceDeposits[line.depositId];
            deposit.reservedMinor -= line.amountMinor;
            deposit.consumedMinor += line.amountMinor;
            _collateralVault.consumeLock(deposit.lockId, recipient, line.amountMinor);
            if (deposit.consumedMinor == deposit.fundedMinor) deposit.status = InsuranceDepositStatus.Exhausted;
        }
        reservation.status = InsuranceReservationStatus.Consumed;
        emit InsuranceConsumed(reservation.reservationId, process.processId, reservation.amountMinor);
    }

    function _releaseReservation(InsuranceReservationId reservationId) private {
        if (InsuranceReservationId.unwrap(reservationId) == bytes32(0)) return;
        InsuranceReservation storage reservation = _insuranceReservations[reservationId];
        if (reservation.status != InsuranceReservationStatus.Reserved) return;
        for (uint256 i; i < reservation.lines.length; ++i) {
            InsuranceReservationLine storage line = reservation.lines[i];
            _insuranceDeposits[line.depositId].reservedMinor -= line.amountMinor;
        }
        reservation.status = InsuranceReservationStatus.Released;
    }

    function _consumeDefaulter(DefaultProcess storage process, AccountId recipient, uint128 amount) private {
        uint128 remaining = amount;
        remaining = _consumeFromLock(process.defaulterCollateralLockId, recipient, remaining);
        remaining = _consumeFromLock(process.cureCollateralLockId, recipient, remaining);
        if (remaining != 0) revert InvalidExecutionResult();
    }

    function _consumeFromLock(CollateralLockId lockId, AccountId recipient, uint128 amount)
        private
        returns (uint128 remaining)
    {
        if (amount == 0 || CollateralLockId.unwrap(lockId) == bytes32(0)) return amount;
        CollateralLock memory lock = _collateralVault.getLock(lockId);
        uint128 consumed = _minimum(amount, lock.remainingAmount);
        if (consumed != 0) _collateralVault.consumeLock(lockId, recipient, consumed);
        return amount - consumed;
    }

    function _releaseDefaulterRemainder(DefaultProcess storage process) private {
        _releaseIfActive(process.defaulterCollateralLockId);
        _releaseIfActive(process.cureCollateralLockId);
    }

    function _releaseNonWinningBids(DefaultProcessId processId, LiquidationBidId winningBidId) private {
        LiquidationBidId[] storage bidIds = _processBidIds[processId];
        for (uint256 i; i < bidIds.length; ++i) {
            if (LiquidationBidId.unwrap(bidIds[i]) == LiquidationBidId.unwrap(winningBidId)) continue;
            LiquidationBidRecord storage bid = _bids[bidIds[i]];
            if (bid.status == LiquidationBidStatus.Committed) bid.status = LiquidationBidStatus.Unrevealed;
            else if (bid.status == LiquidationBidStatus.Revealed) bid.status = LiquidationBidStatus.Loser;
            _releaseIfActive(bid.bondLockId);
            _releaseIfActive(bid.capacityLockId);
        }
    }

    function _recordOutcome(
        DefaultProcess storage process,
        DefaultExecutionResult memory result,
        DefaultProcessStatus status
    ) private returns (bytes32 outcomeHash) {
        outcomeHash = DefaultProcessLib.hashOutcome(
            process.processId,
            process.winningBidId,
            process.insuranceReservationId,
            result,
            process.terminalResidualMinor
        );
        process.outcomeHash = outcomeHash;
        _setStatus(process, status, outcomeHash);
        emit DefaultResolved(process.processId, outcomeHash, result.positionOutcomeReference, status, result);
    }

    function _validateExecutionResult(
        DefaultExecutionResult memory result,
        AccountId expectedSuccessor,
        uint128 defaulterApplied,
        uint128 takeoverApplied,
        uint128 insuranceApplied,
        uint128 terminalResidual
    ) private pure {
        if (
            result.executionHash == bytes32(0) || result.positionOutcomeReference == bytes32(0)
                || AccountId.unwrap(result.successorAccountId) != AccountId.unwrap(expectedSuccessor)
                || result.defaulterCollateralAppliedMinor != defaulterApplied
                || result.takeoverContributionAppliedMinor != takeoverApplied
                || result.insuranceAppliedMinor != insuranceApplied || result.unbackedClaimMinor != 0
                || result.fullyBackedClaimMinor > terminalResidual
        ) revert InvalidExecutionResult();
    }

    function _markCured(DefaultProcess storage process, bytes32 proofHash) private {
        _releaseDefaulterRemainder(process);
        _setStatus(process, DefaultProcessStatus.Cured, proofHash);
    }

    function _readState(PositionId positionId, AccountId accountId, RiskDomainId riskDomainId, uint32 riskDomainVersion)
        private
        view
        returns (ObjectiveDefaultState memory state)
    {
        state = IDefaultRiskSource(address(_portfolioRiskEngine))
            .objectiveDefaultState(positionId, accountId, riskDomainId, riskDomainVersion);
        if (
            PositionId.unwrap(state.positionId) != PositionId.unwrap(positionId)
                || AccountId.unwrap(state.accountId) != AccountId.unwrap(accountId)
                || RiskDomainId.unwrap(state.riskDomainId) != RiskDomainId.unwrap(riskDomainId)
                || state.riskDomainVersion != riskDomainVersion
                || state.stateHash != DefaultProcessLib.hashObjectiveState(state)
                || state.maintenanceRequirementMinor < state.collateralValueMinor
                || state.deficiencyMinor != state.maintenanceRequirementMinor - state.collateralValueMinor
        ) revert DefaultStateMismatch();
    }

    function _requireFreshState(ObjectiveDefaultState memory state, uint32 maximumAge, uint64 previousSequence)
        private
        view
    {
        if (state.evaluatedAt > block.timestamp || block.timestamp - state.evaluatedAt > maximumAge) {
            revert StaleDefaultProof(state.evaluatedAt, block.timestamp);
        }
        if (state.sequence <= previousSequence) revert DefaultProofNotNewer(previousSequence, state.sequence);
    }

    function _requireDomain(
        RiskDomainId riskDomainId,
        uint32 riskDomainVersion,
        DefaultProcessRules calldata rules,
        InsurancePolicy calldata policy
    ) private view returns (RiskDomainVersion memory domain) {
        domain = _requireInsuranceDomain(riskDomainId, riskDomainVersion, policy);
        bytes32 rulesHash = DefaultProcessLib.hashRules(rules);
        if (rulesHash != domain.definition.defaultProcessHash) {
            revert InvalidPolicyWitness(domain.definition.defaultProcessHash, rulesHash);
        }
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

    function _validateRules(DefaultProcessRules calldata rules, InsurancePolicy calldata policy, AccountId accountId)
        private
        pure
    {
        if (
            rules.maximumProofAgeSeconds == 0 || rules.cureWindowSeconds == 0 || rules.commitWindowSeconds == 0
                || rules.revealWindowSeconds == 0 || rules.executionWindowSeconds == 0 || rules.maximumBids == 0
                || rules.maximumBids > HARD_MAXIMUM_BIDS || rules.requiredBondMinor == 0
                || rules.minimumCapacityMinor == 0 || AccountId.unwrap(rules.recoveryAccountId) == bytes32(0)
                || AccountId.unwrap(rules.recoveryAccountId) == AccountId.unwrap(accountId)
                || rules.bidderQualificationHash == bytes32(0) || rules.scoringRuleId != DefaultProcessLib.SCORING_RULE
                || rules.terminalRuleId == bytes32(0) || policy.maximumDrawPerDefaultMinor == 0
                || policy.maximumDepositsPerDraw == 0 || AccountId.unwrap(policy.insuranceAccountId) == bytes32(0)
                || AccountId.unwrap(policy.insuranceAccountId) == AccountId.unwrap(rules.recoveryAccountId)
                || policy.allocationRuleId != DefaultProcessLib.INSURANCE_ALLOCATION_RULE
        ) revert InvalidProcessRules();
    }

    function _deriveDeadlines(uint64 finalResolutionAt, DefaultProcessRules calldata rules)
        private
        view
        returns (uint64 cureEndsAt, uint64 commitEndsAt, uint64 revealEndsAt, uint64 executionEndsAt)
    {
        cureEndsAt = _addDeadline(uint64(block.timestamp), rules.cureWindowSeconds, finalResolutionAt);
        commitEndsAt = _addDeadline(cureEndsAt, rules.commitWindowSeconds, finalResolutionAt);
        revealEndsAt = _addDeadline(commitEndsAt, rules.revealWindowSeconds, finalResolutionAt);
        executionEndsAt = _addDeadline(revealEndsAt, rules.executionWindowSeconds, finalResolutionAt);
    }

    function _addDeadline(uint64 start, uint32 duration, uint64 finalResolutionAt) private pure returns (uint64 value) {
        uint256 candidate = uint256(start) + duration;
        if (candidate > finalResolutionAt) revert DeadlineOutsideFinalResolution(uint64(candidate), finalResolutionAt);
        return uint64(candidate);
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

    function _requireInsuranceDeposit(
        DefaultProcess storage process,
        InsuranceDepositId depositId,
        InsuranceDeposit storage deposit
    ) private view {
        if (
            deposit.status != InsuranceDepositStatus.Funded
                || RiskDomainId.unwrap(deposit.riskDomainId) != RiskDomainId.unwrap(process.riskDomainId)
                || deposit.riskDomainVersion != process.riskDomainVersion
                || CollateralId.unwrap(deposit.collateralId) != CollateralId.unwrap(process.collateralId)
                || deposit.insurancePolicyHash != process.insurancePolicyHash
                || deposit.expiry <= process.settlementDeadline
        ) revert InsuranceDepositMismatch(depositId);
        CollateralLock memory lock = _collateralVault.getLock(deposit.lockId);
        if (
            lock.status != LockStatus.Active || lock.settlementOperator != address(this)
                || CollateralId.unwrap(lock.collateralId) != CollateralId.unwrap(process.collateralId)
                || lock.remainingAmount != deposit.fundedMinor - deposit.consumedMinor
        ) revert InsuranceDepositMismatch(depositId);
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

    function _requireDependency(address dependency) private view {
        if (dependency == address(0)) revert ZeroDependency(dependency);
        if (dependency.code.length == 0) revert DependencyHasNoCode(dependency);
    }
}
